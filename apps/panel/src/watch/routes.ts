import type { FastifyInstance } from "fastify";
import type {
  CreateSilenceRuleRequest,
  IgnoreIncidentRequest,
  ManagedIncident,
  NotificationChannelType,
  NotificationEventKind,
  UpsertNotificationChannelRequest,
  UpdateWatchPolicyRequest
} from "@webops/shared";
import { notificationChannelTypes, notificationEventKinds } from "@webops/shared";
import { requireAnyPermission, requirePermission } from "../auth.js";
import { listVisibleInstances, loadVisibleInstance } from "../instance-access.js";
import { approvePendingSakiAction } from "../routes/saki/approval.js";
import { sakiUsePermissions } from "../routes/saki/types.js";
import {
  countOpenIncidents,
  getIncident,
  listIncidents,
  updateIncident
} from "./incidents.js";
import { startIncidentEventStream, setIncidentVisibilityResolver } from "./notify.js";
import { readWatchPolicy, upsertWatchPolicy } from "./policy.js";
import { cancelWatchIncident, confirmWatchDiagnosis, maybeFinishWatchIncident, pendingActionsForIncident } from "./runner.js";
import { rollbackIncidentChanges } from "./verify.js";
import { clearRestartLease } from "./leases.js";
import { createSilenceRule, deleteSilenceRule, listSilenceRules } from "./silence-rules.js";
import { testNotificationChannel } from "./notify-outbound.js";
import { buildIncidentReport } from "./report.js";
import { prisma } from "../db.js";

async function visibleInstanceIds(userId: string): Promise<string[]> {
  const instances = await listVisibleInstances(userId);
  return instances.map((instance) => instance.id);
}

// 忽略 incident 的公共逻辑：取消 watch 流程、清重启租约、标记 ignored。
// /ignore 与 /silence 两个路由共用，避免语义漂移。
async function ignoreIncidentFor(id: string, incident: ManagedIncident, minutes: number, summary?: string) {
  const ignoredUntil = new Date(Date.now() + minutes * 60 * 1000);
  await cancelWatchIncident(id);
  clearRestartLease(incident.instanceId);
  return updateIncident(id, {
    status: "ignored",
    ignoredUntil,
    summary: summary ?? incident.summary ?? `已忽略 ${minutes} 分钟。`
  });
}

function normalizeChannelEvents(value: unknown): NotificationEventKind[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NotificationEventKind =>
    typeof item === "string" && (notificationEventKinds as readonly string[]).includes(item));
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function parseEventsJson(eventsJson: string): NotificationEventKind[] {
  try {
    return normalizeChannelEvents(JSON.parse(eventsJson || "[]"));
  } catch {
    return [];
  }
}

function toManagedNotificationChannel(row: {
  id: string;
  name: string;
  type: string;
  url: string;
  secret: string | null;
  enabled: boolean;
  eventsJson: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type as NotificationChannelType,
    url: row.url,
    hasSecret: Boolean(row.secret),
    enabled: row.enabled,
    events: parseEventsJson(row.eventsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function registerWatchRoutes(app: FastifyInstance): Promise<void> {
  // SSE 推送前按订阅者动态刷新可见实例集合（30s 缓存），避免权限变更后长期推送越权数据。
  setIncidentVisibilityResolver((userId) => visibleInstanceIds(userId));

  app.get("/api/incidents", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const ids = await visibleInstanceIds(request.user.sub);
    const incidents = ids.length ? await listIncidents(ids, 50) : [];
    return {
      incidents,
      openCount: await countOpenIncidents(ids)
    };
  });

  app.get("/api/incidents/stream", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request, reply) => {
    const ids = await visibleInstanceIds(request.user.sub);
    const stream = startIncidentEventStream(request, reply, ids);
    stream.send("counts", { openCount: await countOpenIncidents(ids) });
    const incidents = ids.length ? await listIncidents(ids, 20) : [];
    stream.send("snapshot", { incidents, openCount: await countOpenIncidents(ids) });
  });

  app.get("/api/incidents/:id", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);
    if (!incident) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const instance = await loadVisibleInstance(request.user.sub, incident.instanceId);
    if (!instance) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    return incident;
  });

  app.post("/api/incidents/:id/diagnose", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);
    if (!incident) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const instance = await loadVisibleInstance(request.user.sub, incident.instanceId);
    if (!instance) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    try {
      await confirmWatchDiagnosis({ incidentId: id, requestedByUserId: request.user.sub });
    } catch (error) {
      reply.code(409).send({ message: error instanceof Error ? error.message : "Cannot start diagnosis" });
      return;
    }
    return {
      ok: true,
      incident: await getIncident(id)
    };
  });

  app.post("/api/incidents/:id/approve", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);
    if (!incident) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const instance = await loadVisibleInstance(request.user.sub, incident.instanceId);
    if (!instance) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const ownedPending = pendingActionsForIncident(id).filter((action) => action.userId === request.user.sub);
    const allPending = pendingActionsForIncident(id);
    if (!ownedPending.length) {
      if (allPending.length) {
        reply.code(403).send({ message: "只有发起这次诊断的用户可以批准修复。" });
        return;
      }
      await maybeFinishWatchIncident(id);
      return { ok: true, incident: await getIncident(id) };
    }
    const pending = ownedPending;
    // 逐项应用并收集结果：单个失败不抛出 500，避免掩盖前面已生效的变更。
    const results: Array<{ actionId: string; ok: boolean; message?: string }> = [];
    let lastResponse = null;
    for (const action of pending) {
      try {
        lastResponse = await approvePendingSakiAction(request, action.id);
        results.push({ actionId: action.id, ok: true });
      } catch (error) {
        console.error("approve watch action failed:", error instanceof Error ? error.stack ?? error.message : error);
        results.push({ actionId: action.id, ok: false, message: "该变更应用失败，已跳过；其余变更不受影响。" });
      }
    }
    return {
      ok: results.every((result) => result.ok),
      results,
      incident: await getIncident(id),
      ...(lastResponse ? { response: lastResponse.response, action: lastResponse.action } : {})
    };
  });

  app.post("/api/incidents/:id/ignore", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);
    if (!incident) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const instance = await loadVisibleInstance(request.user.sub, incident.instanceId);
    if (!instance) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const body = (request.body ?? {}) as IgnoreIncidentRequest;
    const minutes = Math.max(15, Math.min(Number(body.minutes) || 60, 24 * 60));
    return ignoreIncidentFor(id, incident, minutes);
  });

  app.post("/api/incidents/:id/rollback", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);
    if (!incident) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const instance = await loadVisibleInstance(request.user.sub, incident.instanceId);
    if (!instance) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const notes = await rollbackIncidentChanges(id, request.user.sub);
    clearRestartLease(incident.instanceId);
    return updateIncident(id, {
      status: "rolled_back",
      summary: notes.length ? `已回滚这次修复。${notes.join(" ")}` : "没有可回滚的文件改动。",
      resolvedAt: new Date()
    });
  });

  app.get("/api/instances/:id/watch-policy", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadVisibleInstance(request.user.sub, id);
    if (!instance) {
      reply.code(404).send({ message: "Instance not found" });
      return;
    }
    return readWatchPolicy(id);
  });

  app.put("/api/instances/:id/watch-policy", { preHandler: requirePermission("instance.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadVisibleInstance(request.user.sub, id);
    if (!instance) {
      reply.code(404).send({ message: "Instance not found" });
      return;
    }
    return upsertWatchPolicy(id, (request.body ?? {}) as UpdateWatchPolicyRequest);
  });

  // ---- 静默规则 ----
  app.get("/api/incidents/silences", { preHandler: requireAnyPermission(sakiUsePermissions) }, async () => {
    return { rules: await listSilenceRules() };
  });

  app.post("/api/incidents/silences", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const body = (request.body ?? {}) as CreateSilenceRuleRequest;
    if (!body.instanceId && !body.fingerprint && !body.trigger) {
      reply.code(400).send({ message: "instanceId、fingerprint、trigger 至少填一个（全空规则不匹配任何事件）。" });
      return;
    }
    if (body.trigger && !["crash", "crash_loop", "disk", "memory", "webhook", "health"].includes(body.trigger)) {
      reply.code(400).send({ message: "trigger 不合法。" });
      return;
    }
    const minutes = body.minutes !== undefined ? Math.max(1, Math.min(Number(body.minutes) || 0, 365 * 24 * 60)) : undefined;
    return createSilenceRule({ ...body, ...(minutes !== undefined ? { minutes } : {}) });
  });

  app.delete("/api/incidents/silences/:id", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteSilenceRule(id))) {
      reply.code(404).send({ message: "Silence rule not found" });
      return;
    }
    return { ok: true };
  });

  // 从某个 incident 一键静默：按该单的 instanceId+fingerprint 建规则，同时忽略当前单。
  app.post("/api/incidents/:id/silence", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);
    if (!incident) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const instance = await loadVisibleInstance(request.user.sub, incident.instanceId);
    if (!instance) {
      reply.code(404).send({ message: "Incident not found" });
      return;
    }
    const body = (request.body ?? {}) as { minutes?: number; reason?: string };
    const rule = await createSilenceRule({
      instanceId: incident.instanceId,
      fingerprint: incident.fingerprint,
      ...(body.reason ? { reason: body.reason } : {}),
      ...(typeof body.minutes === "number" ? { minutes: body.minutes } : {})
    });
    const minutes = Math.max(15, Math.min(Number(body.minutes) || 60, 24 * 60));
    const updated = await ignoreIncidentFor(id, incident, minutes, `已静默该类告警${body.minutes ? ` ${minutes} 分钟` : ""}。`);
    return { ok: true, rule, incident: updated };
  });

  // ---- 出站通知渠道 ----
  app.get("/api/incidents/notify/channels", { preHandler: requireAnyPermission(sakiUsePermissions) }, async () => {
    const rows = await prisma.notificationChannel.findMany({ orderBy: { createdAt: "desc" } });
    // secret 永不出接口，只暴露 hasSecret。
    return { channels: rows.map(toManagedNotificationChannel) };
  });

  app.post("/api/incidents/notify/channels", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const body = (request.body ?? {}) as UpsertNotificationChannelRequest;
    if (!body.name?.trim()) {
      reply.code(400).send({ message: "name is required" });
      return;
    }
    if (!(notificationChannelTypes as readonly string[]).includes(body.type)) {
      reply.code(400).send({ message: "type must be one of webhook/dingtalk/wecom/telegram" });
      return;
    }
    if (!isHttpUrl(body.url)) {
      reply.code(400).send({ message: "url 必须是 http(s) 地址" });
      return;
    }
    const row = await prisma.notificationChannel.create({
      data: {
        name: body.name.trim(),
        type: body.type,
        url: body.url.trim(),
        secret: body.secret?.trim() || null,
        enabled: body.enabled ?? true,
        eventsJson: JSON.stringify(normalizeChannelEvents(body.events))
      }
    });
    return toManagedNotificationChannel(row);
  });

  app.put("/api/incidents/notify/channels/:id", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.notificationChannel.findUnique({ where: { id } });
    if (!existing) {
      reply.code(404).send({ message: "Channel not found" });
      return;
    }
    const body = (request.body ?? {}) as Partial<UpsertNotificationChannelRequest>;
    if (body.type !== undefined && !(notificationChannelTypes as readonly string[]).includes(body.type)) {
      reply.code(400).send({ message: "type must be one of webhook/dingtalk/wecom/telegram" });
      return;
    }
    if (body.url !== undefined && !isHttpUrl(body.url)) {
      reply.code(400).send({ message: "url 必须是 http(s) 地址" });
      return;
    }
    const row = await prisma.notificationChannel.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.url !== undefined ? { url: body.url.trim() } : {}),
        // secret: undefined=保持不变，null/空串=清除，非空=更新。
        ...(body.secret !== undefined ? { secret: body.secret?.trim() || null } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.events !== undefined ? { eventsJson: JSON.stringify(normalizeChannelEvents(body.events)) } : {})
      }
    });
    return toManagedNotificationChannel(row);
  });

  app.delete("/api/incidents/notify/channels/:id", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.notificationChannel.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      reply.code(404).send({ message: "Channel not found" });
      return;
    }
    await prisma.notificationChannel.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/incidents/notify/channels/:id/test", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await testNotificationChannel(id);
    if (!result.ok && result.error === "渠道不存在") {
      reply.code(404).send({ message: "Channel not found" });
      return;
    }
    return result;
  });

  app.get("/api/incidents/notify/deliveries", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { limit } = request.query as { limit?: string };
    const take = Math.max(1, Math.min(Number(limit) || 50, 200));
    const rows = await prisma.notificationDelivery.findMany({
      include: { channel: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take
    });
    return {
      deliveries: rows.map((row) => ({
        id: row.id,
        channelId: row.channelId,
        channelName: row.channel?.name,
        incidentId: row.incidentId,
        kind: row.kind,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt.toISOString()
      }))
    };
  });

  // ---- 可靠性报告 ----
  app.get("/api/incidents/report", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { days } = request.query as { days?: string };
    return buildIncidentReport(Number(days) || 7);
  });
}
