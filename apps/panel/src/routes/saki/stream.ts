import type { SakiAgentRunEvents, SakiStreamWriter } from "./types.js";

export function startSakiEventStream(reply: any): SakiStreamWriter {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  reply.raw.flushHeaders();

  const send = (type: string, payload?: Record<string, unknown>) => {
    const data = payload ? JSON.stringify(payload) : "";
    reply.raw.write(`event: ${type}\ndata: ${data}\n\n`);
  };

  const end = () => {
    try {
      reply.raw.write("event: done\ndata: {}\n\n");
    } catch {}
    try {
      reply.raw.end();
    } catch {}
  };

  return { send, end };
}

export function createSakiAgentEvents(writer: SakiStreamWriter): SakiAgentRunEvents {
  return {
    workflow: (event) => {
      writer.send("workflow", event as unknown as Record<string, unknown>);
    },
    action: (action) => {
      writer.send("action", action as unknown as Record<string, unknown>);
    },
    delta: (text) => {
      writer.send("delta", { text });
    }
  };
}
