import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CurrentUser, TerminalClientMessage, TerminalServerMessage } from "@webops/shared";
import { WebSocket } from "ws";
import { isAuthDisabled, loadAuthDisabledCurrentUser, loadCurrentUser, type JwtUser } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { loadVisibleInstance } from "../instance-access.js";
import { findDangerousCommandReason } from "../security.js";

function send(socket: WebSocket, payload: TerminalServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function closeWithError(socket: WebSocket, message: string, code = 1008): void {
  send(socket, { type: "error", message });
  socket.close(code, message);
}

function parseClientMessage(raw: WebSocket.RawData): TerminalClientMessage | null {
  try {
    const parsed = JSON.parse(raw.toString()) as Partial<TerminalClientMessage>;
    if (parsed.type === "auth" && typeof parsed.token === "string" && typeof parsed.instanceId === "string") {
      return { type: "auth", token: parsed.token, instanceId: parsed.instanceId };
    }
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return { type: "input", data: parsed.data, echo: parsed.echo !== false };
    }
    if (parsed.type === "ping") {
      return { type: "ping" };
    }
    return null;
  } catch {
    return null;
  }
}

function toWebSocketUrl(node: { protocol: string; host: string; port: number }, path: string): string {
  const protocol = node.protocol === "https" ? "wss" : "ws";
  return `${protocol}://${node.host}:${node.port}${path}`;
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

    const connectDaemon = async (token: string, requestedInstanceId: string) => {
      if (authInProgress || user) return;
      authInProgress = true;
      user = await authenticateTerminalUser(app, browserSocket, token);
      if (!user) return;

      const instance = await loadVisibleInstance(user.id, requestedInstanceId);
      if (!instance) {
        closeWithError(browserSocket, "Instance not found", 1008);
        return;
      }

      instanceId = instance.id;
      daemonSocket = new WebSocket(toWebSocketUrl(instance.node, `/ws/instances/${instance.id}/terminal`), {
        headers: {
          "x-node-id": instance.node.id,
          "x-panel-token": instance.node.tokenHash
        }
      });

      daemonSocket.on("message", (raw) => {
        if (browserSocket.readyState === WebSocket.OPEN) {
          browserSocket.send(raw.toString());
        }
      });

      daemonSocket.on("close", () => {
        closeWithError(browserSocket, "Daemon terminal disconnected", 1011);
      });

      daemonSocket.on("error", (error) => {
        request.log.error(error);
        closeWithError(browserSocket, error instanceof Error ? error.message : "Daemon terminal error", 1011);
      });
    };

    browserSocket.on("message", (raw) => {
      const message = parseClientMessage(raw);
      if (!message) {
        send(browserSocket, { type: "error", message: "Unsupported terminal message" });
        return;
      }

      if (message.type === "auth") {
        void connectDaemon(message.token, message.instanceId).catch((error: unknown) => {
          request.log.error(error);
          closeWithError(browserSocket, error instanceof Error ? error.message : "Terminal bridge failed", 1011);
        });
        return;
      }

      if (!user) {
        send(browserSocket, { type: "error", message: "Terminal session is not authenticated" });
        return;
      }

      if (message.type === "input") {
        if (!user?.permissions.includes("terminal.input")) {
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
          send(browserSocket, { type: "error", message: "Terminal is not connected" });
          return;
        }

        daemonSocket.send(JSON.stringify(message));
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
        return;
      }

      if (daemonSocket && daemonSocket.readyState === WebSocket.OPEN) {
        daemonSocket.send(JSON.stringify(message));
      } else {
        send(browserSocket, { type: "pong", time: new Date().toISOString() });
      }
    });

    browserSocket.on("close", () => {
      daemonSocket?.close(1000, "Browser disconnected");
    });
  });
}
