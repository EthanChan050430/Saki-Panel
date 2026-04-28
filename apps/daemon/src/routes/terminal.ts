import type { FastifyInstance } from "fastify";
import type { TerminalClientMessage, TerminalServerMessage } from "@webops/shared";
import { WebSocket } from "ws";
import { authenticatePanelRequest } from "../daemon-auth.js";
import { instanceManager } from "../instance-manager.js";

function send(socket: WebSocket, payload: TerminalServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function parseClientMessage(raw: WebSocket.RawData): TerminalClientMessage | null {
  try {
    const parsed = JSON.parse(raw.toString()) as Partial<TerminalClientMessage>;
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

export async function registerTerminalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ws/instances/:id/terminal", { websocket: true, preHandler: authenticatePanelRequest }, (socket, request) => {
    const { id } = request.params as { id: string };
    const initialState = instanceManager.state(id);

    send(socket, {
      type: "hello",
      instanceId: id,
      status: initialState.status,
      exitCode: initialState.exitCode,
      lines: initialState.logs.slice(-500)
    });

    const unsubscribe = instanceManager.subscribe(id, {
      onLog: (line) => send(socket, { type: "line", line }),
      onStatus: (state) =>
        send(socket, {
          type: "status",
          instanceId: state.instanceId,
          status: state.status,
          exitCode: state.exitCode
        })
    });

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

      if (message.type !== "input") {
        send(socket, { type: "error", message: "Unsupported terminal message" });
        return;
      }

      void instanceManager.writeInput(id, message.data, { logInput: message.echo !== false }).catch((error: unknown) => {
        send(socket, { type: "error", message: error instanceof Error ? error.message : "Input failed" });
      });
    });

    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
  });
}
