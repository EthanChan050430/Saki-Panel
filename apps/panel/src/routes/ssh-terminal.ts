import type { FastifyInstance } from "fastify";
import type { CurrentUser, PermissionCode, SshTerminalServerMessage } from "@webops/shared";
import type { Client, ClientChannel } from "ssh2";
import { WebSocket } from "ws";
import { isAuthDisabled, loadAuthDisabledCurrentUser, loadCurrentUser, type JwtUser } from "../auth.js";
import { loadVisibleNode } from "../node-access.js";
import { openSshShell } from "../ssh-nodes.js";
import { writeAuditLog } from "../audit.js";

export function sshTerminalSize(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

export async function registerSshTerminalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ws/ssh-terminal", { websocket: true }, (socket, request) => {
    let client: Client | undefined;
    let stream: ClientChannel | undefined;
    let user: CurrentUser | null = null;
    let nodeId = "";
    let credentialPermissions: PermissionCode[] = [];
    let authenticating = false;
    let ready = false;
    let checkedAt = 0;
    let checking: Promise<void> | undefined;
    let pendingMessages = 0;
    let chain: Promise<void> = Promise.resolve();
    const send = (message: SshTerminalServerMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
    const fail = (message: string) => { send({ type: "error", message }); socket.close(1008, "SSH terminal closed"); cleanup(); };
    const authTimeout = setTimeout(() => fail("SSH 终端认证超时，请重新连接。"), 10000);
    const cleanup = () => { ready = false; clearTimeout(authTimeout); clearInterval(accessTimer); stream?.destroy(); client?.end(); };
    const requireAccess = async (force = false) => {
      if (!user) throw new Error("请先登录 SSH 终端。");
      if (!force && Date.now() - checkedAt < 5000) return;
      if (!checking) checking = (async () => {
        const current = isAuthDisabled() ? await loadAuthDisabledCurrentUser() : await loadCurrentUser(user!.id);
        if (!current || current.status !== "ACTIVE" || !current.permissions.includes("node.view") || !current.permissions.includes("terminal.view")
          || !credentialPermissions.includes("node.view") || !credentialPermissions.includes("terminal.view")) throw new Error("服务器终端访问权限已失效。");
        const node = await loadVisibleNode(current, nodeId);
        if (!node || node.protocol !== "ssh") throw new Error("SSH 服务器不存在或无权访问。");
        user = current; checkedAt = Date.now();
      })();
      try { await checking; } finally { checking = undefined; }
    };
    const canInput = () => Boolean(user?.permissions.includes("terminal.input") && credentialPermissions.includes("terminal.input"));
    const accessTimer = setInterval(() => {
      if (ready) void requireAccess(true).catch(error => fail((error as Error).message));
    }, 15000);
    accessTimer.unref();
    const output = (chunk: Buffer) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 2 * 1024 * 1024) { fail("终端输出过快，请重新连接。"); return; }
      socket.send(chunk, { binary: true });
    };
    const handle = async (raw: WebSocket.RawData) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(raw.toString()); }
      catch { throw new Error("无效的 SSH 终端消息。"); }
      if (!message || typeof message !== "object") throw new Error("无效的 SSH 终端消息。");
      if (message.type === "auth") {
        if (authenticating || user) throw new Error("SSH 终端已认证。");
        if (typeof message.token !== "string" || typeof message.nodeId !== "string") throw new Error("SSH 终端认证信息无效。");
        authenticating = true;
        clearTimeout(authTimeout);
        if (isAuthDisabled()) { user = await loadAuthDisabledCurrentUser(); credentialPermissions = user.permissions; }
        else {
          const claims = app.jwt.verify<JwtUser>(message.token);
          user = await loadCurrentUser(claims.sub);
          credentialPermissions = Array.isArray(claims.permissions) ? claims.permissions : [];
        }
        nodeId = message.nodeId;
        await requireAccess(true);
        const opened = await openSshShell(nodeId, sshTerminalSize(message.cols, 100, 10, 500), sshTerminalSize(message.rows, 30, 5, 200));
        client = opened.client; stream = opened.stream;
        if (socket.readyState !== WebSocket.OPEN) { cleanup(); return; }
        client.on("error", () => fail("SSH 连接已断开，请重新连接。"));
        client.once("close", () => { if (socket.readyState === WebSocket.OPEN) { send({ type: "exit", code: null }); socket.close(1000); } });
        stream.on("data", output); stream.stderr.on("data", output);
        stream.on("error", () => fail("SSH 终端已断开，请重新连接。"));
        stream.once("close", (code: number | null) => { send({ type: "exit", code: code ?? null }); socket.close(1000); cleanup(); });
        ready = true; send({ type: "ready", canInput: canInput() });
        void writeAuditLog({ request, userId: user!.id, action: "ssh.terminal.open", resourceType: "node", resourceId: nodeId }).catch(error => request.log.warn({ err: error }, "SSH terminal audit failed"));
        return;
      }
      if (!ready || !stream) throw new Error("SSH 终端尚未连接。");
      await requireAccess();
      if (message.type === "input") {
        if (!canInput()) throw new Error("没有终端输入权限。");
        if (typeof message.data !== "string" || message.data.length > 16384) throw new Error("终端输入过长。");
        if (stream.writableLength > 512 * 1024) throw new Error("SSH 输入等待发送过多，请稍后重新连接。");
        stream.write(message.data);
      } else if (message.type === "resize") {
        stream.setWindow(sshTerminalSize(message.rows, 30, 5, 200), sshTerminalSize(message.cols, 100, 10, 500), 0, 0);
      } else if (message.type === "ping") send({ type: "pong" });
      else throw new Error("不支持的 SSH 终端消息。");
    };
    socket.on("message", raw => {
      if (raw.toString().length > 65536 || pendingMessages >= 128) { fail("SSH 终端输入过快或过长。"); return; }
      pendingMessages++;
      chain = chain.then(() => socket.readyState === WebSocket.OPEN ? handle(raw) : undefined)
        .catch(error => { request.log.warn({ err: error }, "SSH terminal failed"); fail("SSH 终端连接失败：" + (error instanceof Error ? error.message : "请检查服务器连接")); })
        .finally(() => { pendingMessages--; });
    });
    socket.on("close", cleanup); socket.on("error", cleanup);
  });
}
