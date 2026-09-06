import type { FastifyReply, FastifyRequest } from "fastify";
import { resolvePanelCorsOrigin } from "../cors.js";
import type { ManagedIncident } from "@webops/shared";
import { prisma } from "../db.js";

interface IncidentStreamWriter {
  userId: string;
  instanceIds: Set<string>;
  instanceIdsResolvedAt: number;
  send(type: string, payload: Record<string, unknown>): void;
  end(): void;
}

const subscribers = new Set<IncidentStreamWriter>();

// 可见实例集合是连接时的快照；通过 resolver 定期重新解析，
// 避免权限变更后长期推送已越权的数据。
const visibilityRefreshMs = 30 * 1000;
let visibilityResolver: ((userId: string) => Promise<string[]>) | null = null;

export function setIncidentVisibilityResolver(resolver: (userId: string) => Promise<string[]>): void {
  visibilityResolver = resolver;
}

// 与 incidents.ts 的 activeIncidentStatuses 保持一致（避免循环依赖，这里单独维护一份）。
const activeIncidentStatuses = [
  "open",
  "diagnosing",
  "diagnosed",
  "awaiting_approval",
  "applying",
  "verifying",
  "rate_limited"
];

// 同一 incident 同一状态的推送节流，崩溃风暴时 occurrenceCount 仍会准确落库，
// 但 SSE 最多每 5 秒推一次。
const publishThrottleMs = 5000;
const publishThrottle = new Map<string, number>();

async function visibleInstanceIdsFor(subscriber: IncidentStreamWriter): Promise<Set<string>> {
  if (visibilityResolver && Date.now() - subscriber.instanceIdsResolvedAt > visibilityRefreshMs) {
    try {
      subscriber.instanceIds = new Set(await visibilityResolver(subscriber.userId));
      subscriber.instanceIdsResolvedAt = Date.now();
    } catch {
      // 刷新失败时沿用旧快照，下一次推送再试。
    }
  }
  return subscriber.instanceIds;
}

async function openCountFor(instanceIds: Set<string>): Promise<number> {
  if (instanceIds.size === 0) return 0;
  return prisma.incident.count({
    where: { status: { in: activeIncidentStatuses }, instanceId: { in: [...instanceIds] } }
  });
}

export function startIncidentEventStream(
  request: FastifyRequest,
  reply: FastifyReply,
  instanceIds: string[]
): IncidentStreamWriter {
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

  const writer: IncidentStreamWriter = {
    userId: request.user.sub,
    instanceIds: new Set(instanceIds),
    instanceIdsResolvedAt: Date.now(),
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

export function publishIncident(incident: ManagedIncident): void {
  const throttleKey = `${incident.id}:${incident.status}`;
  const now = Date.now();
  const lastPublished = publishThrottle.get(throttleKey) ?? 0;
  if (now - lastPublished < publishThrottleMs) return;
  publishThrottle.set(throttleKey, now);
  // 防御性清理，避免节流表无界增长。
  if (publishThrottle.size > 5000) {
    for (const [key, ts] of publishThrottle) {
      if (now - ts > 10 * 60 * 1000) publishThrottle.delete(key);
    }
  }
  void (async () => {
    for (const subscriber of [...subscribers]) {
      const visibleIds = await visibleInstanceIdsFor(subscriber);
      if (!visibleIds.has(incident.instanceId)) continue;
      // openCount 按每个订阅者自己的可见实例集合计算，避免越权泄漏与徽章错误。
      const openCount = await openCountFor(visibleIds);
      subscriber.send("incident", { incident, openCount });
    }
  })();
}

export function publishIncidentCounts(): void {
  void (async () => {
    for (const subscriber of [...subscribers]) {
      const visibleIds = await visibleInstanceIdsFor(subscriber);
      subscriber.send("counts", { openCount: await openCountFor(visibleIds) });
    }
  })();
}
