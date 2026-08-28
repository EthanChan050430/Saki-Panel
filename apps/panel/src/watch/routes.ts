import type { FastifyInstance } from "fastify";
import type { IgnoreIncidentRequest, UpdateWatchPolicyRequest } from "@webops/shared";
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
import { startIncidentEventStream } from "./notify.js";
import { readWatchPolicy, upsertWatchPolicy } from "./policy.js";
import { cancelWatchIncident, confirmWatchDiagnosis, maybeFinishWatchIncident, pendingActionsForIncident } from "./runner.js";
import { rollbackIncidentChanges } from "./verify.js";
import { clearRestartLease } from "./leases.js";

async function visibleInstanceIds(userId: string): Promise<string[]> {
  const instances = await listVisibleInstances(userId);
  return instances.map((instance) => instance.id);
}

export async function registerWatchRoutes(app: FastifyInstance): Promise<void> {
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
    let lastResponse = null;
    for (const action of pending) {
      lastResponse = await approvePendingSakiAction(request, action.id);
    }
    return {
      ok: true,
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
    const ignoredUntil = new Date(Date.now() + minutes * 60 * 1000);
    await cancelWatchIncident(id);
    clearRestartLease(incident.instanceId);
    return updateIncident(id, {
      status: "ignored",
      ignoredUntil,
      summary: incident.summary ?? `已忽略 ${minutes} 分钟。`
    });
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
}
