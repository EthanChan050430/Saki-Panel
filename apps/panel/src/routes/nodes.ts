import type { FastifyInstance } from "fastify";
import type { CreateNodeRequest, ManagedNode, NodeMetricSnapshot, UpdateNodeRequest } from "@webops/shared";
import { panelConfig } from "../config.js";
import { prisma } from "../db.js";
import { requirePermission } from "../auth.js";
import { generateSecretToken, hashToken, tokenLast4 } from "../security.js";
import { writeAuditLog } from "../audit.js";

function normalizeProtocol(value: unknown): "http" | "https" | null {
  return value === "http" || value === "https" ? value : null;
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isOffline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return true;
  const ageSeconds = (Date.now() - lastSeenAt.getTime()) / 1000;
  return ageSeconds > panelConfig.heartbeatOfflineSeconds;
}

function toMetricSnapshot(metric: {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  totalMemoryMb: number | null;
  usedMemoryMb: number | null;
  totalDiskGb: number | null;
  usedDiskGb: number | null;
  uptimeSeconds: number | null;
  loadAverage1m: number | null;
  createdAt: Date;
}): NodeMetricSnapshot {
  return {
    cpuUsage: metric.cpuUsage,
    memoryUsage: metric.memoryUsage,
    diskUsage: metric.diskUsage,
    totalMemoryMb: metric.totalMemoryMb ?? undefined,
    usedMemoryMb: metric.usedMemoryMb ?? undefined,
    totalDiskGb: metric.totalDiskGb ?? undefined,
    usedDiskGb: metric.usedDiskGb ?? undefined,
    uptimeSeconds: metric.uptimeSeconds ?? undefined,
    loadAverage1m: metric.loadAverage1m ?? undefined,
    createdAt: metric.createdAt.toISOString()
  };
}

export function toManagedNode(node: {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  status: "UNKNOWN" | "ONLINE" | "OFFLINE";
  os: string | null;
  arch: string | null;
  version: string | null;
  remarks: string | null;
  groupName: string | null;
  tags: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metrics?: Array<Parameters<typeof toMetricSnapshot>[0]>;
}): ManagedNode {
  const derivedStatus = isOffline(node.lastSeenAt) ? "OFFLINE" : node.status;
  return {
    id: node.id,
    name: node.name,
    host: node.host,
    port: node.port,
    protocol: node.protocol,
    status: derivedStatus,
    os: node.os,
    arch: node.arch,
    version: node.version,
    remarks: node.remarks,
    groupName: node.groupName,
    tags: node.tags,
    lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    latestMetric: node.metrics?.[0] ? toMetricSnapshot(node.metrics[0]) : null
  };
}

export async function registerNodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/nodes", { preHandler: requirePermission("node.view") }, async () => {
    const nodes = await prisma.node.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });
    return nodes.map(toManagedNode);
  });

  app.post("/api/nodes", { preHandler: requirePermission("node.create") }, async (request) => {
    const body = request.body as Partial<CreateNodeRequest>;
    const protocol = normalizeProtocol(body.protocol);
    if (
      !body.name?.trim() ||
      !body.host?.trim() ||
      !body.port ||
      !Number.isInteger(body.port) ||
      body.port <= 0 ||
      body.port > 65535 ||
      !protocol
    ) {
      throw Object.assign(new Error("name, host, port and protocol are required"), { statusCode: 400 });
    }

    const nodeToken = generateSecretToken();
    const node = await prisma.node.create({
      data: {
        name: body.name.trim(),
        host: body.host.trim(),
        port: body.port,
        protocol,
        remarks: normalizeOptionalText(body.remarks) ?? null,
        groupName: normalizeOptionalText(body.groupName) ?? null,
        tags: normalizeOptionalText(body.tags) ?? null,
        tokenHash: hashToken(nodeToken),
        tokenLast4: tokenLast4(nodeToken),
        status: "UNKNOWN"
      },
      include: {
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.create",
      resourceType: "node",
      resourceId: node.id,
      payload: { name: node.name, host: node.host, port: node.port }
    });

    return {
      node: toManagedNode(node),
      nodeToken
    };
  });

  app.put("/api/nodes/:id", { preHandler: requirePermission("node.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.node.findUnique({
      where: { id },
      include: {
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });
    if (!existing) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    const body = request.body as UpdateNodeRequest;
    const protocol = body.protocol === undefined ? undefined : normalizeProtocol(body.protocol);
    if (body.protocol !== undefined && !protocol) {
      reply.code(400).send({ message: "protocol must be http or https" });
      return;
    }
    if (body.name !== undefined && !body.name.trim()) {
      reply.code(400).send({ message: "name cannot be empty" });
      return;
    }
    if (body.host !== undefined && !body.host.trim()) {
      reply.code(400).send({ message: "host cannot be empty" });
      return;
    }
    if (body.port !== undefined && (!Number.isInteger(body.port) || body.port <= 0 || body.port > 65535)) {
      reply.code(400).send({ message: "port must be an integer between 1 and 65535" });
      return;
    }

    const node = await prisma.node.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.host !== undefined ? { host: body.host.trim() } : {}),
        ...(body.port !== undefined ? { port: body.port } : {}),
        ...(protocol ? { protocol } : {}),
        ...(body.remarks !== undefined ? { remarks: normalizeOptionalText(body.remarks) ?? null } : {}),
        ...(body.groupName !== undefined ? { groupName: normalizeOptionalText(body.groupName) ?? null } : {}),
        ...(body.tags !== undefined ? { tags: normalizeOptionalText(body.tags) ?? null } : {})
      },
      include: {
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.update",
      resourceType: "node",
      resourceId: node.id,
      payload: { name: node.name, host: node.host, port: node.port }
    });

    return toManagedNode(node);
  });

  app.delete("/api/nodes/:id", { preHandler: requirePermission("node.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const node = await prisma.node.findUnique({ where: { id } });
    if (!node) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    await prisma.node.delete({ where: { id } });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.delete",
      resourceType: "node",
      resourceId: id,
      payload: { name: node.name, host: node.host, port: node.port }
    });

    return { ok: true };
  });

  app.post("/api/nodes/:id/test", { preHandler: requirePermission("node.test") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const node = await prisma.node.findUnique({ where: { id } });
    if (!node) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${node.protocol}://${node.host}:${node.port}/health`, {
        signal: controller.signal
      });
      const ok = response.ok;
      await prisma.node.update({
        where: { id: node.id },
        data: {
          status: ok ? "ONLINE" : "OFFLINE",
          lastSeenAt: ok ? new Date() : node.lastSeenAt
        }
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "node.test",
        resourceType: "node",
        resourceId: node.id,
        result: ok ? "SUCCESS" : "FAILURE"
      });
      return { ok, statusCode: response.status };
    } catch (error) {
      await prisma.node.update({
        where: { id: node.id },
        data: { status: "OFFLINE" }
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "node.test",
        resourceType: "node",
        resourceId: node.id,
        payload: { error: error instanceof Error ? error.message : "Unknown error" },
        result: "FAILURE"
      });
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    } finally {
      clearTimeout(timeout);
    }
  });
}
