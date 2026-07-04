import type { FastifyReply, FastifyRequest } from "fastify";
import { resolvePanelCorsOrigin } from "../../cors.js";
import type { SakiAgentRunEvents, SakiStreamWriter } from "./types.js";

function sakiCorsOrigin(request: FastifyRequest): string | null {
  return resolvePanelCorsOrigin(request) || null;
}

export function startSakiEventStream(request: FastifyRequest, reply: FastifyReply): SakiStreamWriter {
  const corsOrigin = sakiCorsOrigin(request);
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
    if (typeof raw.flush === "function") {
      raw.flush();
    }
  };
  const write = (chunk: string) => {
    if (ended || reply.raw.destroyed) return;
    try {
      reply.raw.write(chunk);
      flushRaw();
    } catch {
      ended = true;
      clearInterval(heartbeat);
    }
  };
  const heartbeat = setInterval(() => {
    const ts = Date.now();
    write(`event: heartbeat\ndata: ${JSON.stringify({ type: "heartbeat", ts })}\n\n`);
  }, 12000);
  reply.raw.on("close", () => {
    ended = true;
    clearInterval(heartbeat);
  });
  write(": connected\n\n");

  return {
    send(type, payload = {}) {
      write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
    },
    end() {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      reply.raw.end();
    }
  };
}

export function createSakiAgentEvents(writer: SakiStreamWriter): Required<SakiAgentRunEvents> {
  return {
    workflow: (event) => {
      writer.send("workflow", event as unknown as Record<string, unknown>);
    },
    action: (action) => {
      writer.send("action", { action });
    },
    delta: (text) => {
      writer.send("delta", { text });
    },
    thinking: (text) => {
      writer.send("thinking", { text });
    }
  };
}