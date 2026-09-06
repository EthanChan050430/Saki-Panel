// Panel-side global event bus. Every state mutation inside the panel (instance
// start/stop, watch incident created, Saki task finished, node heartbeat
// offline, etc.) broadcasts a structured event here so all connected browser
// sessions (multi-tab, multi-device) stay in sync without polling.
//
// The bus has two transports:
//   1. In-process EventEmitter — local subscribers (React hooks, background jobs).
//   2. WebSocket push to every connected browser session via /ws/events.
//
// Lifecycle rules:
//   - Subscribers MUST call unsubscribe() on unmount to avoid listener leaks.
//   - Broadcasts are best-effort (fire-and-forget to WebSocket); dropped events
//     are acceptable because browsers already poll key endpoints on focus.

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
  private readonly MAX_LISTENERS_PER_TYPE = 64;

  registerSocket(socket: NodeWebSocket): () => void {
    this.sockets.add(socket);
    return () => {
      this.sockets.delete(socket);
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
    // Local subscribers (React hooks etc.)
    this.emitter.emit(type, event);
    // WebSocket — best-effort
    if (this.sockets.size === 0) return;
    const payload = JSON.stringify(event);
    for (const socket of Array.from(this.sockets)) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.sockets.delete(socket);
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        // Socket died; leave it for the client to reconnect.
        this.sockets.delete(socket);
      }
    }
  }
}

export const globalEventBus = new PanelGlobalEventBus();

export function registerGlobalEventSocket(app: FastifyInstance): void {
  app.get("/ws/events", { websocket: true }, (socket, request) => {
    // Auth: require a valid panel JWT in query or Authorization header.
    // This keeps events private to authenticated sessions only.
    const authHeader = (request.headers["authorization"] as string) ?? "";
    const queryToken = typeof request.query === "object" && request.query !== null && "token" in request.query
      ? (request.query as { token?: string }).token
      : undefined;
    const rawToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : (typeof queryToken === "string" ? queryToken : "");

    // Verify JWT — use fastify's built-in jwt instance if present.
    const jwt = app.jwt as undefined | { verify: (t: string) => Promise<unknown> };
    if (!rawToken || !jwt) {
      socket.close(1008, "auth required");
      return;
    }
    jwt.verify(rawToken).catch(() => {
      socket.close(1008, "invalid token");
    }).then((payload) => {
      if (!payload) { socket.close(1008, "invalid token"); return; }
      const detach = globalEventBus.registerSocket(socket);
      socket.on("close", detach);
      socket.on("error", detach);
      socket.send(JSON.stringify({ type: "HELLO", timestamp: Date.now() }));
    }).catch(() => {
      // close already called above
    });
  });
}
