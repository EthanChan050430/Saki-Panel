import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CurrentUser, TerminalClientMessage, TerminalServerMessage } from "@webops/shared";
import { WebSocket } from "ws";
import { isAuthDisabled, loadAuthDisabledCurrentUser, loadCurrentUser, type JwtUser } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { loadVisibleInstance } from "../instance-access.js";
import { panelConfig } from "../config.js";
import { findDangerousCommandReason } from "../security.js";

function send(socket: WebSocket, payload: TerminalServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function closeWithError(socket: WebSocket, message: string, code = 1008): void {
  send(socket, { type: "error", message });
  if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) return;
  socket.close(code, websocketCloseReason(message));
}

function websocketCloseReason(message: string): string {
  const fallback = "Terminal bridge error";
  const normalized = message.replace(/\s+/g, " ").trim() || fallback;
  if (Buffer.byteLength(normalized, "utf8") <= 123) return normalized;

  let reason = normalized;
  while (reason.length > 0 && Buffer.byteLength(`${reason}...`, "utf8") > 123) {
    reason = reason.slice(0, -1);
  }
  return reason ? `${reason}...` : fallback;
}

function parseClientMessage(raw: WebSocket.RawData): TerminalClientMessage | null {
  try {
    const parsed: any = JSON.parse(raw.toString());
    if (parsed?.type === "auth" && typeof parsed.token === "string" && typeof parsed.instanceId === "string") {
      const msg: TerminalClientMessage = {
        type: "auth",
        token: parsed.token,
        instanceId: parsed.instanceId
      };
      if (parsed.sessionId != null) (msg as { sessionId?: string }).sessionId = parsed.sessionId;
      return msg;
    }
    if (parsed?.type === "input" && typeof parsed.data === "string") {
      const msg: TerminalClientMessage = {
        type: "input",
        data: parsed.data,
        echo: parsed.echo !== false
      };
      if (parsed.sessionId != null) (msg as { sessionId?: string }).sessionId = parsed.sessionId;
      return msg;
    }
    if (parsed?.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
      const msg: TerminalClientMessage = {
        type: "resize",
        cols: Math.max(10, Math.min(parsed.cols, 500)),
        rows: Math.max(5, Math.min(parsed.rows, 200))
      };
      if (parsed.sessionId != null) (msg as { sessionId?: string }).sessionId = parsed.sessionId;
      return msg;
    }
    if (parsed?.type === "ping") {
      return { type: "ping" };
    }
    return null;
  } catch {
    return null;
  }
}

function toWebSocketUrl(
  node: { protocol: string; host: string; port: number },
  path: string,
  protocolOverride?: string,
  hostOverride?: string
): string {
  const protocol = (protocolOverride ?? node.protocol) === "https" ? "wss" : "ws";
  return `${protocol}://${hostOverride ?? node.host}:${node.port}${path}`;
}

function shouldRetryWebSocketAsHttps(error: unknown, protocol: string): boolean {
  if (protocol === "https") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /Expected HTTP|HPE_INVALID_CONSTANT|wrong version number|EPROTO|socket hang up/i.test(message);
}

function shouldRetryWebSocketAsHttp(error: unknown, protocol: string): boolean {
  if (protocol !== "https") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /wrong version number|EPROTO|socket hang up|ECONNRESET/i.test(message);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function hostnameFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isPanelPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const candidates = [
    hostnameFromUrl(panelConfig.publicUrl),
    hostnameFromUrl(panelConfig.webOrigin),
    panelConfig.ssl?.hostname
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => candidate.toLowerCase());
  return candidates.includes(normalized);
}

function shouldRetryWebSocketOnLoopback(error: unknown, host: string): boolean {
  if (isLoopbackHostname(host) || !isPanelPublicHostname(host)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EPROTO|Expected HTTP|wrong version number|socket hang up/i.test(message);
}

async function authenticateTerminalUser(
  app: FastifyInstance,
  socket: WebSocket,
  token: string
): Promise<CurrentUser | null> {
  if (isAuthDisabled()) {
    return loadAuthDisabledCurrentUser();
  }

  let payload: JwtUser;
  try {
    payload = app.jwt.verify<JwtUser>(token);
  } catch {
    closeWithError(socket, "Unauthorized terminal session");
    return null;
  }

  const user = await loadCurrentUser(payload.sub);
  if (!user || user.status !== "ACTIVE") {
    closeWithError(socket, "Unauthorized terminal session");
    return null;
  }

  if (!user.permissions.includes("terminal.view")) {
    closeWithError(socket, "Terminal permission denied");
    return null;
  }

  return user;
}

function inputPreview(input: string): string {
  return input
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .replace(/[\u0000-\u001F\u007F]/g, (char) => {
      if (char === "\n") return "\\n";
      if (char === "\t") return "\\t";
      if (char === "\u001b") return "^[";
      if (char === "\u007f") return "^?";
      const code = char.charCodeAt(0);
      return `^${String.fromCharCode(code + 64)}`;
    })
    .slice(0, 200);
}

export async function registerTerminalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ws/terminal", { websocket: true }, (browserSocket, request) => {
    let daemonSocket: WebSocket | null = null;
    let user: CurrentUser | null = null;
    let instanceId: string | null = null;
    let authInProgress = false;
    const pendingMessages: TerminalClientMessage[] = [];

    const flushPending = () => {
      if (!user) return;
      while (pendingMessages.length > 0) {
        const msg = pendingMessages.shift()!;
        processClientMessage(msg);
      }
    };

    const connectDaemonSocket = (protocolOverride?: string, hostOverride?: string, sid?: string, instance?: any) => {
      if (!instance) return;
      const activeProtocol = protocolOverride ?? instance.node.protocol;
      const activeHost = hostOverride ?? instance.node.host;
      let daemonPath = `/ws/instances/${instance.id}/terminal`;
      if (sid) {
        daemonPath += `?sessionId=${encodeURIComponent(sid)}`;
      }
      const socket = new WebSocket(
        toWebSocketUrl(instance.node, daemonPath, protocolOverride, hostOverride),
        {
          rejectUnauthorized: false,
          headers: {
            "x-node-id": instance.node.id,
            "x-panel-token": instance.node.tokenHash
          }
        }
      );
      daemonSocket = socket;
      let opened = false;

      socket.on("open", () => {
        opened = true;
        flushPending();
      });

      socket.on("message", (raw) => {
        if (browserSocket.readyState === WebSocket.OPEN) {
          browserSocket.send(raw.toString());
        }
      });

      socket.on("close", () => {
        if (daemonSocket === socket) {
          closeWithError(browserSocket, "Daemon terminal disconnected", 1011);
        }
      });

      socket.on("error", (error) => {
        if (!opened && shouldRetryWebSocketAsHttp(error, activeProtocol)) {
          socket.removeAllListeners("close");
          connectDaemonSocket("http", hostOverride, sid, instance);
          return;
        }
        if (!opened && shouldRetryWebSocketAsHttps(error, activeProtocol)) {
          socket.removeAllListeners("close");
          connectDaemonSocket("https", hostOverride, sid, instance);
          return;
        }
        if (!opened && shouldRetryWebSocketOnLoopback(error, activeHost)) {
          socket.removeAllListeners("close");
          connectDaemonSocket(protocolOverride, "127.0.0.1", sid, instance);
          return;
        }
        request.log.error(error);
        closeWithError(browserSocket, error instanceof Error ? error.message : "Daemon terminal error", 1011);
      });
    };

    const connectDaemon = async (token: string, requestedInstanceId: string, sessionId?: string) => {
      if (authInProgress || user) return;
      authInProgress = true;
      try {
        const authenticatedUser = await authenticateTerminalUser(app, browserSocket, token);
        if (!authenticatedUser) {
          authInProgress = false;
          pendingMessages.length = 0;
          return;
        }

        const instance = await loadVisibleInstance(authenticatedUser.id, requestedInstanceId);
        if (!instance) {
          authInProgress = false;
          pendingMessages.length = 0;
          closeWithError(browserSocket, "Instance not found", 1008);
          return;
        }

        user = authenticatedUser;
        instanceId = instance.id;
        authInProgress = false;
        connectDaemonSocket(undefined, undefined, sessionId, instance);
      } catch (e) {
        authInProgress = false;
        pendingMessages.length = 0;
        throw e;
      }
    };

    const processClientMessage = (message: TerminalClientMessage) => {
      if (!user) {
        send(browserSocket, { type: "error", message: "Terminal session is not authenticated" });
        return;
      }

      if (message.type === "resize") {
        if (daemonSocket && daemonSocket.readyState === WebSocket.OPEN) {
          daemonSocket.send(JSON.stringify(message));
        } else {
          pendingMessages.push(message);
        }
        return;
      }

      if (message.type === "input") {
        if (!user.permissions.includes("terminal.input")) {
          send(browserSocket, { type: "error", message: "Terminal input permission denied" });
          return;
        }
        if (message.data.length > 4096) {
          send(browserSocket, { type: "error", message: "Terminal input is too large" });
          return;
        }
        const commandPreview = inputPreview(message.data);
        const blocked = findDangerousCommandReason(commandPreview);
        if (blocked) {
          send(browserSocket, { type: "error", message: blocked });
          void writeAuditLog({
            request,
            userId: user.id,
            action: "security.command_blocked",
            resourceType: "instance",
            resourceId: instanceId,
            payload: {
              inputPreview: commandPreview,
              inputLength: message.data.length,
              reason: blocked
            },
            result: "FAILURE"
          }).catch((error: unknown) => {
            request.log.error(error);
          });
          return;
        }
        if (!daemonSocket || daemonSocket.readyState !== WebSocket.OPEN || !instanceId) {
          pendingMessages.push(message);
          return;
        }

        daemonSocket.send(JSON.stringify(message));
        if (message.data.includes("\n") || message.data.includes("\r") || message.data.length > 8) {
          void writeAuditLog({
            request,
            userId: user.id,
            action: "terminal.input",
            resourceType: "instance",
            resourceId: instanceId,
            payload: {
              inputPreview: inputPreview(message.data),
              inputLength: message.data.length
            }
          }).catch((error: unknown) => {
            request.log.error(error);
          });
        }
        return;
      }

      if (daemonSocket && daemonSocket.readyState === WebSocket.OPEN) {
        daemonSocket.send(JSON.stringify(message));
      } else {
        send(browserSocket, { type: "pong", time: new Date().toISOString() });
      }
    };

    browserSocket.on("message", (raw) => {
      const message = parseClientMessage(raw);
      if (!message) {
        send(browserSocket, { type: "error", message: "Unsupported terminal message" });
        return;
      }

      if (message.type === "auth") {
        const sid = (message as any).sessionId as string | undefined;
        void connectDaemon(message.token, message.instanceId, sid).catch((error: unknown) => {
          request.log.error(error);
          closeWithError(browserSocket, error instanceof Error ? error.message : "Terminal bridge failed", 1011);
        });
        return;
      }

      if (authInProgress) {
        pendingMessages.push(message);
        return;
      }

      processClientMessage(message);
    });

    browserSocket.on("close", () => {
      daemonSocket?.close(1000, "Browser disconnected");
    });
  });
}
