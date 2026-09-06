import type { FastifyInstance } from "fastify";
import type { TerminalClientMessage, TerminalServerMessage } from "@webops/shared";
import { WebSocket } from "ws";
import { authenticatePanelRequest } from "../daemon-auth.js";
import { instanceManager } from "../instance-manager.js";

const terminalDataChunkChars = 16 * 1024;

function send(socket: WebSocket, payload: TerminalServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function sendPtyData(socket: WebSocket, data: string): void {
  if (!data || socket.readyState !== WebSocket.OPEN) return;
  if (data.length <= terminalDataChunkChars) {
    send(socket, { type: "data", data });
    return;
  }
  for (let index = 0; index < data.length; ) {
    let end = Math.min(index + terminalDataChunkChars, data.length);
    const last = data.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff && end < data.length) {
      end += 1;
    }
    send(socket, { type: "data", data: data.slice(index, end) });
    index = end;
  }
}

function parseClientMessage(raw: WebSocket.RawData): TerminalClientMessage | null {
  try {
    const parsed: any = JSON.parse(raw.toString());
    if (parsed.type === "auth" && typeof parsed.token === "string" && typeof parsed.instanceId === "string") {
      return {
        type: "auth",
        token: parsed.token,
        instanceId: parsed.instanceId,
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {})
      };
    }
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return {
        type: "input",
        data: parsed.data,
        echo: parsed.echo !== false,
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {})
      };
    }
    if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
      if (!Number.isFinite(parsed.cols) || !Number.isFinite(parsed.rows)) return null;
      return {
        type: "resize",
        cols: Math.max(10, Math.min(Math.floor(parsed.cols), 500)),
        rows: Math.max(5, Math.min(Math.floor(parsed.rows), 200)),
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {})
      };
    }
    if (parsed.type === "ping") {
      return { type: "ping" };
    }
    return null;
  } catch {
    return null;
  }
}

export async function registerTerminalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ws/instances/:id/terminal", { websocket: true, preHandler: authenticatePanelRequest }, (socket, request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;
    const initialSessionId = query.sessionId || undefined;

    let shellUnsubscribe: (() => void) | null = null;
    let activeSessionId: string | null = initialSessionId || null;

    const attachToMain = () => {
      const initialState = instanceManager.state(id);
      send(socket, {
        type: "hello",
        instanceId: id,
        status: initialState.status,
        exitCode: initialState.exitCode,
        lines: initialState.logs.slice(-500)
      });

      const unsubscribe = instanceManager.subscribe(id, {
        onData: (data) => sendPtyData(socket, data),
        onLog: (line) => {
          if (line.stream === "system") {
            send(socket, { type: "line", line });
          }
        },
        onStatus: (state) =>
          send(socket, {
            type: "status",
            instanceId: state.instanceId,
            status: state.status,
            exitCode: state.exitCode
          })
      });
      return unsubscribe;
    };

    let unsubscribe: (() => void) | null = null;

    if (activeSessionId) {
      send(socket, {
        type: "hello",
        instanceId: id,
        status: "RUNNING",
        exitCode: null,
        lines: []
      });
      try {
        shellUnsubscribe = instanceManager.subscribeShell(activeSessionId, {
          onData: (text: string) => {
            sendPtyData(socket, text);
          },
          onExit: (exit) => {
            sendPtyData(socket, `\r\n\x1b[33m[Shell session ended (code ${exit?.code ?? 0})]\x1b[0m\r\n`);
          }
        });
      } catch (e) {
        send(socket, { type: "error", message: e instanceof Error ? e.message : "Failed to attach shell" });
      }
    } else {
      unsubscribe = attachToMain();
    }

    socket.on("message", (raw) => {
      const message = parseClientMessage(raw);
      if (!message) {
        send(socket, { type: "error", message: "Unsupported terminal message" });
        return;
      }

      if (message.type === "ping") {
        send(socket, { type: "pong", time: new Date().toISOString() });
        return;
      }

      if (message.type === "resize") {
        const targetSid = message.sessionId || activeSessionId;
        if (targetSid) {
          instanceManager.resizeShell(id, targetSid, message.cols, message.rows);
        } else {
          instanceManager.resize(id, message.cols, message.rows);
        }
        return;
      }

      if (message.type !== "input") {
        send(socket, { type: "error", message: "Unsupported terminal message" });
        return;
      }

      const targetSid = message.sessionId || activeSessionId;
      if (targetSid) {
        try {
          instanceManager.writeShellInput(id, targetSid, message.data);
        } catch (error) {
          send(socket, { type: "error", message: error instanceof Error ? error.message : "Shell input failed" });
        }
        return;
      }

      void instanceManager.writeInput(id, message.data, { logInput: message.echo !== false }).catch((error: unknown) => {
        send(socket, { type: "error", message: error instanceof Error ? error.message : "Input failed" });
      });
    });

    socket.on("close", () => {
      if (shellUnsubscribe) shellUnsubscribe();
      if (unsubscribe) unsubscribe();
    });
    socket.on("error", () => {
      if (shellUnsubscribe) shellUnsubscribe();
      if (unsubscribe) unsubscribe();
    });
  });
}
