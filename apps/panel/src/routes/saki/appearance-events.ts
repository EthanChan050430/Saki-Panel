import type { FastifyReply, FastifyRequest } from "fastify";
import type { PanelAppearanceSettings } from "@webops/shared";
import { resolvePanelCorsOrigin } from "../../cors.js";

interface AppearanceStreamWriter {
  send(type: string, payload: Record<string, unknown>): void;
  end(): void;
}

const subscribers = new Set<AppearanceStreamWriter>();

export function startAppearanceEventStream(request: FastifyRequest, reply: FastifyReply): AppearanceStreamWriter {
  const corsOrigin = resolvePanelCorsOrigin(request) || null;
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "transfer-encoding": "chunked",
    ...(corsOrigin
      ? {
          "access-control-allow-origin": corsOrigin,
          "access-control-allow-credentials": "true",
          vary: "Origin"
        }
      : {})
  });
  if (typeof reply.raw.flushHeaders === "function") {
    reply.raw.flushHeaders();
  }

  let ended = false;
  const flushRaw = () => {
    const raw = reply.raw as typeof reply.raw & { flush?: () => void };
    if (typeof raw.flush === "function") raw.flush();
  };
  const write = (chunk: string) => {
    if (ended || reply.raw.destroyed) return;
    try {
      reply.raw.write(chunk);
      flushRaw();
    } catch {
      ended = true;
      clearInterval(heartbeat);
      subscribers.delete(writer);
    }
  };
  const heartbeat = setInterval(() => {
    write(`event: heartbeat\ndata: ${JSON.stringify({ type: "heartbeat", ts: Date.now() })}\n\n`);
  }, 15000);
  reply.raw.on("close", () => {
    ended = true;
    clearInterval(heartbeat);
    subscribers.delete(writer);
  });
  write(": connected\n\n");

  const writer: AppearanceStreamWriter = {
    send(type, payload = {}) {
      write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
    },
    end() {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      subscribers.delete(writer);
      reply.raw.end();
    }
  };
  subscribers.add(writer);
  return writer;
}

export function publishAppearanceUpdate(appearance: PanelAppearanceSettings): void {
  for (const subscriber of subscribers) {
    subscriber.send("appearance", { appearance: appearance as unknown as Record<string, unknown> });
  }
}
