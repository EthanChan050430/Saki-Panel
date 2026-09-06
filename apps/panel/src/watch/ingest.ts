import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { CreateIngestTokenRequest, ManagedIngestToken } from "@webops/shared";
import { requireAnyPermission, requirePermission } from "../auth.js";
import { prisma } from "../db.js";
import { sakiUsePermissions } from "../routes/saki/types.js";
import { materializeIncident } from "./detector.js";

interface GenericAlertPayload {
  summary?: string;
  title?: string;
  details?: string;
  fingerprint?: string;
  severity?: string;
}

interface AlertmanagerPayload {
  alerts?: Array<{
    status?: string;
    fingerprint?: string;
    labels?: { alertname?: string; severity?: string; instance?: string };
    annotations?: { summary?: string; description?: string };
  }>;
}

function ingestFingerprint(instanceId: string, provided: string | undefined, material: string): string {
  if (provided && provided.trim()) return provided.trim();
  return createHash("sha256").update(`${instanceId}\n${material}`).digest("hex");
}

function toManagedIngestToken(row: {
  id: string;
  instanceId: string;
  label: string;
  token: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  instance?: { name: string } | null;
}): ManagedIngestToken {
  return {
    id: row.id,
    instanceId: row.instanceId,
    ...(row.instance?.name !== undefined ? { instanceName: row.instance.name } : {}),
    label: row.label,
    token: row.token,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null
  };
}

export async function registerIngestRoutes(app: FastifyInstance): Promise<void> {
  // 外部告警接入：口令即授权（与 daemon 的 x-node-token 同思路），不走面板用户权限。
  app.post("/api/ingest/incidents/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const ingestToken = await prisma.ingestToken.findUnique({
      where: { token },
      include: { instance: { select: { id: true, name: true, nodeId: true } } }
    });
    if (!ingestToken) {
      reply.code(404).send({ message: "Unknown ingest token" });
      return;
    }
    await prisma.ingestToken.update({ where: { id: ingestToken.id }, data: { lastUsedAt: new Date() } });

    const body = (request.body ?? {}) as GenericAlertPayload & AlertmanagerPayload;
    const instanceId = ingestToken.instanceId;
    const nodeId = ingestToken.instance.nodeId;
    const created: string[] = [];

    if (Array.isArray(body.alerts)) {
      // Prometheus Alertmanager webhook：只处理 firing 告警。
      for (const alert of body.alerts) {
        if (alert?.status !== "firing") continue;
        const alertname = alert.labels?.alertname ?? "alert";
        const summary = alert.annotations?.summary ?? alert.annotations?.description ?? alertname;
        const details = alert.annotations?.description ?? "";
        const fingerprint = ingestFingerprint(instanceId, alert.fingerprint, `${alertname}\n${summary}`);
        const { incident } = await materializeIncident({
          instanceId,
          nodeId,
          fingerprint,
          trigger: "webhook",
          logTail: details || summary,
          summary: `外部告警 [${alertname}]：${summary}`
        });
        created.push(incident.id);
      }
    } else {
      const summary = body.summary ?? body.title;
      if (!summary || typeof summary !== "string") {
        reply.code(400).send({ message: "summary or title is required" });
        return;
      }
      const severity = body.severity ? `[${body.severity}] ` : "";
      const fingerprint = ingestFingerprint(instanceId, body.fingerprint, summary);
      const { incident } = await materializeIncident({
        instanceId,
        nodeId,
        fingerprint,
        trigger: "webhook",
        logTail: body.details ?? summary,
        summary: `外部告警 ${severity}${summary}`.replace("  ", " ")
      });
      created.push(incident.id);
    }

    return { ok: true, created };
  });

  app.get("/api/ingest/tokens", { preHandler: requireAnyPermission(sakiUsePermissions) }, async () => {
    const rows = await prisma.ingestToken.findMany({
      include: { instance: { select: { name: true } } },
      orderBy: { createdAt: "desc" }
    });
    return { tokens: rows.map(toManagedIngestToken) };
  });

  app.post("/api/ingest/tokens", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const body = (request.body ?? {}) as CreateIngestTokenRequest;
    if (!body.instanceId) {
      reply.code(400).send({ message: "instanceId is required" });
      return;
    }
    const instance = await prisma.instance.findUnique({ where: { id: body.instanceId }, select: { id: true } });
    if (!instance) {
      reply.code(404).send({ message: "Instance not found" });
      return;
    }
    const row = await prisma.ingestToken.create({
      data: {
        instanceId: body.instanceId,
        label: body.label?.trim() ?? "",
        token: `saki_ing_${randomBytes(12).toString("hex")}`
      },
      include: { instance: { select: { name: true } } }
    });
    return toManagedIngestToken(row);
  });

  app.delete("/api/ingest/tokens/:id", { preHandler: requirePermission("saki.agent") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.ingestToken.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      reply.code(404).send({ message: "Token not found" });
      return;
    }
    await prisma.ingestToken.delete({ where: { id } });
    return { ok: true };
  });
}
