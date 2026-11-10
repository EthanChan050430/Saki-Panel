import EventEmitter from "node:events";
import type { FastifyInstance } from "fastify";
import type { WebSocket as NodeWebSocket } from "ws";

export interface GlobalEvent {
  type: string;
  timestamp: number;
  data?: unknown;
}

type Listener = (event: GlobalEvent) => void;

class PanelGlobalEventBus {
  private emitter = new EventEmitter();
  private sockets = new Set<NodeWebSocket>();
  private socketUsers = new Map<NodeWebSocket, string>();
  private readonly MAX_LISTENERS_PER_TYPE = 64;

  registerSocket(socket: NodeWebSocket, userId?: string): () => void {
    this.sockets.add(socket);
    if (userId) this.socketUsers.set(socket, userId);
    return () => {
      this.sockets.delete(socket);
      this.socketUsers.delete(socket);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try { socket.close(1000, "client gone"); } catch {}
      }
    };
  }

  subscribe(type: string | string[], listener: Listener): () => void {
    const types = Array.isArray(type) ? type : [type];
    for (const t of types) {
      if (this.emitter.listenerCount(t) >= this.MAX_LISTENERS_PER_TYPE) {
        this.emitter.setMaxListeners(this.MAX_LISTENERS_PER_TYPE * 2);
      }
      this.emitter.on(t, listener);
    }
    return () => {
      for (const t of types) this.emitter.removeListener(t, listener);
    };
  }

  broadcast(type: string, data?: unknown): void {
    const event: GlobalEvent = { type, timestamp: Date.now(), data };
        this.emitter.emit(type, event);
        if (this.sockets.size === 0) return;
    const payload = JSON.stringify(event);
    for (const socket of Array.from(this.sockets)) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.sockets.delete(socket);
        this.socketUsers.delete(socket);
        continue;
      }
      try {
        socket.send(payload);
      } catch {
                this.sockets.delete(socket);
        this.socketUsers.delete(socket);
      }
    }
  }
  sendToUsers(type: string, data: unknown, userIds: Iterable<string>): void {
    const targets = new Set(userIds);
    const payload = JSON.stringify({ type, timestamp: Date.now(), data } satisfies GlobalEvent);
    for (const [socket, userId] of Array.from(this.socketUsers)) {
      if (!targets.has(userId)) continue;
      if (socket.readyState !== WebSocket.OPEN) {
        this.sockets.delete(socket);
        this.socketUsers.delete(socket);
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        this.sockets.delete(socket);
        this.socketUsers.delete(socket);
      }
    }
  }
}

export const globalEventBus = new PanelGlobalEventBus();

export function registerGlobalEventSocket(app: FastifyInstance): void {
  app.get("/ws/events", { websocket: true }, (socket, request) => {
        // Reject unauthenticated WebSocket connections
    const authHeader = (request.headers["authorization"] as string) ?? "";
    const queryToken = typeof request.query === "object" && request.query !== null && "token" in request.query
      ? (request.query as { token?: string }).token
      : undefined;
    const rawToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : (typeof queryToken === "string" ? queryToken : "");

    // Verify JWT — use fastify's built-in jwt instance if present.
    // @fastify/jwt's verify returns the payload synchronously (or throws), it
    // is not a promise; calling .then() on it rejected every events socket.
    const jwt = app.jwt as undefined | { verify: (t: string) => unknown };
    if (!rawToken || !jwt) {
      socket.close(1008, "auth required");
      return;
    }
    try {
      const payload = jwt.verify(rawToken);
      if (!payload) { socket.close(1008, "invalid token"); return; }
      const sub = (payload as { sub?: unknown }).sub;
      const detach = globalEventBus.registerSocket(socket, typeof sub === "string" ? sub : undefined);
      socket.on("close", detach);
      socket.on("error", detach);
      socket.send(JSON.stringify({ type: "HELLO", timestamp: Date.now() }));
    } catch {
      socket.close(1008, "invalid token");
    }
  });
}
