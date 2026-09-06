import type { FastifyInstance } from "fastify";
import type { DaemonInstanceStatusEvent, HeartbeatRequest, RegisterDaemonRequest } from "@webops/shared";
import { panelConfig } from "../config.js";
import { prisma } from "../db.js";
import { generateSecretToken, hashToken, safeEqual, tokenLast4, verifyToken } from "../security.js";
import { writeAuditLog } from "../audit.js";
import { handleDaemonInstanceEvent, ingestHeartbeatSnapshots } from "../watch/events.js";

type HeartbeatNodeUpdate = HeartbeatRequest & {
  host?: string;
  port?: number;
  protocol?: string;
};

async function findRegistrationNode(name: string, host: string, port: number) {
  const candidates = await prisma.node.findMany({
    where: {
      name,
      OR: [{ host }, { port }]
    },
    include: {
      _count: {
        select: {
          instances: true
        }
      }
    }
  });

  return (
    candidates.sort((left, right) => {
      const instanceDelta = right._count.instances - left._count.instances;
      if (instanceDelta !== 0) return instanceDelta;

      const leftExact = left.host === host && left.port === port ? 1 : 0;
      const rightExact = right.host === host && right.port === port ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;

      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })[0] ?? null
  );
}

export async function registerDaemonRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/daemon/register", async (request, reply) => {
    const registrationToken = request.headers["x-registration-token"];
    if (typeof registrationToken !== "string" || !registrationToken.trim()) {
      await writeAuditLog({
        request,
        action: "daemon.register",
        resourceType: "node",
        result: "FAILURE"
      });
      reply.code(401).send({ message: "Missing registration token" });
      return;
    }

    const trimmedToken = registrationToken.trim();
    let isGlobalToken = false;
    let enrollmentRecord: {
      id: string;
      groupName: string | null;
      tags: string | null;
      maxUsage: number;
      usedCount: number;
      expiresAt: Date;
      createdById: string | null;
    } | null = null;

    if (safeEqual(trimmedToken, panelConfig.daemonRegistrationToken)) {
      isGlobalToken = true;
    } else {
      const hashed = hashToken(trimmedToken);
      const found = await prisma.nodeEnrollmentToken.findUnique({
        where: { tokenHash: hashed }
      });
      if (found) {
        if (found.expiresAt.getTime() < Date.now()) {
          reply.code(401).send({ message: "Registration token has expired" });
          return;
        }
        if (found.usedCount >= found.maxUsage) {
          reply.code(401).send({ message: "Registration token usage limit reached" });
          return;
        }
        enrollmentRecord = found;
      }
    }

    if (!isGlobalToken && !enrollmentRecord) {
      await writeAuditLog({
        request,
        action: "daemon.register",
        resourceType: "node",
        result: "FAILURE"
      });
      reply.code(401).send({ message: "Invalid registration token" });
      return;
    }

    const body = request.body as Partial<RegisterDaemonRequest>;
    if (!body.name || !body.host || !body.port || !body.protocol) {
      reply.code(400).send({ message: "name, host, port and protocol are required" });
      return;
    }

    // Smart host resolution: if body.host is loopback but caller comes from a remote IP, use caller IP
    const callerIp = request.ip;
    const isCallerRemote = Boolean(callerIp && callerIp !== "127.0.0.1" && callerIp !== "::1" && callerIp !== "localhost");
    const isBodyHostLoopback = body.host === "127.0.0.1" || body.host === "localhost" || body.host === "::1";
    const effectiveHost = isBodyHostLoopback && isCallerRemote ? callerIp : body.host;

    const nodeToken = generateSecretToken();
    const existing = await findRegistrationNode(body.name, effectiveHost, body.port);

    const node = existing
      ? await prisma.node.update({
          where: { id: existing.id },
          data: {
            protocol: body.protocol,
            host: effectiveHost,
            port: body.port,
            os: body.os ?? existing.os,
            arch: body.arch ?? existing.arch,
            version: body.version ?? existing.version,
            tokenHash: hashToken(nodeToken),
            tokenLast4: tokenLast4(nodeToken),
            status: "ONLINE",
            lastSeenAt: new Date(),
            createdById: enrollmentRecord?.createdById ?? existing.createdById
          }
        })
      : await prisma.node.create({
          data: {
            name: body.name,
            host: effectiveHost,
            port: body.port,
            protocol: body.protocol,
            os: body.os ?? null,
            arch: body.arch ?? null,
            version: body.version ?? null,
            groupName: enrollmentRecord?.groupName ?? null,
            tags: enrollmentRecord?.tags ?? null,
            tokenHash: hashToken(nodeToken),
            tokenLast4: tokenLast4(nodeToken),
            status: "ONLINE",
            lastSeenAt: new Date(),
            createdById: enrollmentRecord?.createdById ?? null
          }
        });

    if (enrollmentRecord) {
      await prisma.nodeEnrollmentToken.update({
        where: { id: enrollmentRecord.id },
        data: { usedCount: { increment: 1 } }
      });
    }

    await writeAuditLog({
      request,
      action: "daemon.register",
      resourceType: "node",
      resourceId: node.id,
      payload: { name: node.name, host: node.host, port: node.port }
    });

    return {
      nodeId: node.id,
      nodeToken,
      heartbeatSeconds: panelConfig.daemonHeartbeatSeconds
    };
  });

  app.post("/api/daemon/heartbeat", async (request, reply) => {
    const nodeId = request.headers["x-node-id"];
    const nodeToken = request.headers["x-node-token"];
    if (typeof nodeId !== "string" || typeof nodeToken !== "string") {
      reply.code(401).send({ message: "Missing node credentials" });
      return;
    }

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node || !verifyToken(nodeToken, node.tokenHash)) {
      await writeAuditLog({
        request,
        action: "daemon.heartbeat",
        resourceType: "node",
        resourceId: nodeId,
        result: "FAILURE"
      });
      reply.code(401).send({ message: "Invalid node credentials" });
      return;
    }

    const body = request.body as Partial<HeartbeatNodeUpdate>;
    const metrics = body.metrics;
    if (!metrics) {
      reply.code(400).send({ message: "metrics are required" });
      return;
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.node.update({
        where: { id: node.id },
        data: {
          status: "ONLINE",
          host: body.host?.trim() || node.host,
          port: Number.isInteger(body.port) && body.port && body.port > 0 && body.port <= 65535 ? body.port : node.port,
          protocol: body.protocol === "http" || body.protocol === "https" ? body.protocol : node.protocol,
          os: body.os ?? node.os,
          arch: body.arch ?? node.arch,
          version: body.version ?? node.version,
          lastSeenAt: now
        }
      }),
      prisma.nodeMetric.create({
        data: {
          nodeId: node.id,
          cpuUsage: metrics.cpuUsage,
          memoryUsage: metrics.memoryUsage,
          diskUsage: metrics.diskUsage,
          totalMemoryMb: metrics.totalMemoryMb ?? null,
          usedMemoryMb: metrics.usedMemoryMb ?? null,
          totalDiskGb: metrics.totalDiskGb ?? null,
          usedDiskGb: metrics.usedDiskGb ?? null,
          uptimeSeconds: metrics.uptimeSeconds ?? null,
          loadAverage1m: metrics.loadAverage1m ?? null
        }
      })
    ]);

    let restartLeases: Array<{ instanceId: string; suppressUntil: string }> = [];
    try {
      restartLeases = await ingestHeartbeatSnapshots(node.id, body.instances, {
        diskUsage: metrics.diskUsage,
        memoryUsage: metrics.memoryUsage
      });
    } catch (error) {
      request.log.warn({ err: error }, "heartbeat watch ingest failed");
    }

    return {
      ok: true,
      heartbeatSeconds: panelConfig.daemonHeartbeatSeconds,
      restartLeases
    };
  });

  app.post("/api/daemon/events", async (request, reply) => {
    const nodeId = request.headers["x-node-id"];
    const nodeToken = request.headers["x-node-token"];
    if (typeof nodeId !== "string" || typeof nodeToken !== "string") {
      reply.code(401).send({ message: "Missing node credentials" });
      return;
    }

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node || !verifyToken(nodeToken, node.tokenHash)) {
      reply.code(401).send({ message: "Invalid node credentials" });
      return;
    }

    const body = request.body as Partial<DaemonInstanceStatusEvent>;
    if (body.type !== "instance.status" || typeof body.instanceId !== "string" || typeof body.status !== "string") {
      reply.code(400).send({ message: "instance.status event is required" });
      return;
    }

    const instance = await prisma.instance.findFirst({
      where: { id: body.instanceId, nodeId: node.id },
      select: { id: true }
    });
    if (!instance) {
      reply.code(404).send({ message: "Instance not found on this node" });
      return;
    }

    const statuses = new Set(["CREATED", "STARTING", "RUNNING", "STOPPING", "STOPPED", "CRASHED", "UNKNOWN"]);
    if (!statuses.has(body.status)) {
      reply.code(400).send({ message: "invalid instance status" });
      return;
    }

    return handleDaemonInstanceEvent({
      type: "instance.status",
      instanceId: body.instanceId,
      status: body.status as DaemonInstanceStatusEvent["status"],
      occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : new Date().toISOString(),
      ...(typeof body.exitCode === "number" || body.exitCode === null ? { exitCode: body.exitCode } : {}),
      ...(Array.isArray(body.logTail) ? { logTail: body.logTail } : {}),
      ...(body.restart ? { restart: body.restart } : {})
    });
  });
}
