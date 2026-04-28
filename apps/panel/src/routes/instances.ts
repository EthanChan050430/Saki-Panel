import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import type {
  CreateInstanceRequest,
  InstanceAssignee,
  InstanceActionResponse,
  InstanceCommandResponse,
  InstanceLogsResponse,
  InstanceStatus,
  InstanceType,
  ManagedInstance,
  RestartPolicy,
  UpdateInstanceRequest
} from "@webops/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { requirePermission } from "../auth.js";
import {
  classifyInstanceUser,
  instanceAccessInclude,
  listInstanceAssignees,
  listVisibleInstances,
  loadVisibleInstance,
  resolveAssignableUserId,
  type InstanceWithAccess
} from "../instance-access.js";
import { writeAuditLog } from "../audit.js";
import { findDangerousCommandReason } from "../security.js";
import {
  killDaemonInstance,
  readDaemonInstanceLogs,
  readDaemonInstanceStatus,
  restartDaemonInstance,
  runDaemonInstanceCommand,
  startDaemonInstance,
  stopDaemonInstance,
  type DaemonInstanceSpec
} from "../daemon-client.js";

function toManagedInstance(instance: InstanceWithAccess): ManagedInstance {
  return {
    id: instance.id,
    nodeId: instance.nodeId,
    nodeName: instance.node.name,
    name: instance.name,
    type: instance.type as InstanceType,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    stopCommand: instance.stopCommand,
    status: instance.status,
    autoStart: instance.autoStart,
    restartPolicy: instance.restartPolicy as RestartPolicy,
    restartMaxRetries: instance.restartMaxRetries,
    runAsUser: instance.runAsUser,
    memoryLimit: instance.memoryLimit,
    cpuLimit: instance.cpuLimit,
    description: instance.description,
    createdByUserId: instance.createdById,
    createdByUsername: instance.createdBy?.username ?? null,
    createdByDisplayName: instance.createdBy?.displayName ?? null,
    createdByRole: instance.createdBy ? classifyInstanceUser(instance.createdBy) : null,
    assignedToUserId: instance.assignedToId,
    assignedToUsername: instance.assignedTo?.username ?? null,
    assignedToDisplayName: instance.assignedTo?.displayName ?? null,
    assignedToRole: instance.assignedTo ? classifyInstanceUser(instance.assignedTo) : null,
    lastStartedAt: instance.lastStartedAt?.toISOString() ?? null,
    lastStoppedAt: instance.lastStoppedAt?.toISOString() ?? null,
    lastExitCode: instance.lastExitCode,
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString()
  };
}

async function loadInstance(request: FastifyRequest, id: string): Promise<InstanceWithAccess | null> {
  return loadVisibleInstance(request.user.sub, id);
}

function specFromInstance(instance: InstanceWithAccess): DaemonInstanceSpec {
  return {
    id: instance.id,
    name: instance.name,
    type: instance.type,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    stopCommand: instance.stopCommand,
    restartPolicy: instance.restartPolicy as RestartPolicy,
    restartMaxRetries: instance.restartMaxRetries
  };
}

function normalizeRestartPolicy(value: unknown, fallback: RestartPolicy): RestartPolicy {
  if (value === "never" || value === "on_failure" || value === "always" || value === "fixed_interval") {
    return value;
  }
  return fallback;
}

function normalizeRetryCount(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.floor(value), 99));
}

function statusPatch(status: InstanceStatus, exitCode?: number | null): Prisma.InstanceUpdateInput {
  const now = new Date();
  const data: Prisma.InstanceUpdateInput = {
    status,
    lastExitCode: exitCode ?? null
  };
  if (status === "RUNNING") {
    data.lastStartedAt = now;
  }
  if (status === "STOPPED" || status === "CRASHED") {
    data.lastStoppedAt = now;
  }
  return data;
}

async function updateStatus(id: string, status: InstanceStatus, exitCode?: number | null): Promise<InstanceWithAccess> {
  return prisma.instance.update({
    where: { id },
    data: statusPatch(status, exitCode),
    include: instanceAccessInclude
  });
}

const volatileStatuses = new Set<InstanceStatus>(["STARTING", "RUNNING", "STOPPING", "UNKNOWN"]);

function normalizeListedStatus(instance: InstanceWithAccess, status: InstanceStatus): InstanceStatus {
  if (status === "CREATED" && instance.status !== "CREATED") {
    return "STOPPED";
  }
  return status;
}

async function refreshVolatileStatus(instance: InstanceWithAccess): Promise<InstanceWithAccess> {
  if (!volatileStatuses.has(instance.status)) {
    return instance;
  }

  try {
    const state = await readDaemonInstanceStatus(instance.node, instance.id);
    const nextStatus = normalizeListedStatus(instance, state.status);
    const nextExitCode = state.exitCode ?? null;
    if (nextStatus === instance.status && nextExitCode === (instance.lastExitCode ?? null)) {
      return instance;
    }
    return updateStatus(instance.id, nextStatus, nextExitCode);
  } catch {
    if (instance.status === "UNKNOWN") {
      return instance;
    }
    return updateStatus(instance.id, "UNKNOWN", instance.lastExitCode);
  }
}

async function sendNotFound(reply: FastifyReply): Promise<void> {
  reply.code(404).send({ message: "Instance not found" });
}

async function runInstanceAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: "start" | "stop" | "restart" | "kill"
) {
  const { id } = request.params as { id: string };
  const instance = await loadInstance(request, id);
  if (!instance) {
    await sendNotFound(reply);
    return;
  }

  try {
    if (action === "start") {
      await prisma.instance.update({ where: { id }, data: { status: "STARTING" } });
      const state = await startDaemonInstance(instance.node, specFromInstance(instance));
      const updated = await updateStatus(id, state.status, state.exitCode);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.start",
        resourceType: "instance",
        resourceId: id
      });
      return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
    }

    if (action === "stop") {
      await prisma.instance.update({ where: { id }, data: { status: "STOPPING" } });
      const state = await stopDaemonInstance(instance.node, { id, stopCommand: instance.stopCommand });
      const updated = await updateStatus(id, state.status, state.exitCode);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.stop",
        resourceType: "instance",
        resourceId: id
      });
      return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
    }

    if (action === "restart") {
      await prisma.instance.update({ where: { id }, data: { status: "STOPPING" } });
      const state = await restartDaemonInstance(instance.node, specFromInstance(instance));
      const updated = await updateStatus(id, state.status, state.exitCode);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.restart",
        resourceType: "instance",
        resourceId: id
      });
      return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
    }

    await prisma.instance.update({ where: { id }, data: { status: "STOPPING" } });
    const state = await killDaemonInstance(instance.node, id);
    const updated = await updateStatus(id, state.status, state.exitCode);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.kill",
      resourceType: "instance",
      resourceId: id
    });
    return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
  } catch (error) {
    await prisma.instance.update({
      where: { id },
      data: { status: "UNKNOWN" }
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: `instance.${action}`,
      resourceType: "instance",
      resourceId: id,
      payload: { error: error instanceof Error ? error.message : "Unknown error" },
      result: "FAILURE"
    });
    reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
  }
}

export async function registerInstanceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/instances", { preHandler: requirePermission("instance.view") }, async (request) => {
    const instances = await listVisibleInstances(request.user.sub);
    const refreshed = await Promise.all(instances.map(refreshVolatileStatus));
    return refreshed.map(toManagedInstance);
  });

  app.get("/api/instances/assignees", { preHandler: requirePermission("instance.update") }, async (request) => {
    return listInstanceAssignees(request.user.sub) satisfies Promise<InstanceAssignee[]>;
  });

  app.post("/api/instances", { preHandler: requirePermission("instance.create") }, async (request, reply) => {
    const body = request.body as Partial<CreateInstanceRequest>;
    if (!body.nodeId || !body.name || !body.startCommand) {
      reply.code(400).send({ message: "nodeId, name and startCommand are required" });
      return;
    }
    const blocked = findDangerousCommandReason(body.startCommand);
    if (blocked) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "security.command_blocked",
        resourceType: "instance",
        payload: { commandPreview: body.startCommand.slice(0, 200), reason: blocked },
        result: "FAILURE"
      });
      reply.code(400).send({ message: blocked });
      return;
    }

    const node = await prisma.node.findUnique({ where: { id: body.nodeId } });
    if (!node) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    let assignedToId: string | null | undefined;
    try {
      assignedToId = await resolveAssignableUserId(request.user.sub, body.assignedToUserId);
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : 400;
      reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Invalid assignee" });
      return;
    }

    const id = randomUUID();
    const instance = await prisma.instance.create({
      data: {
        id,
        nodeId: body.nodeId,
        name: body.name,
        type: body.type ?? "generic_command",
        workingDirectory: body.workingDirectory?.trim() || `instances/${id}`,
        startCommand: body.startCommand,
        stopCommand: body.stopCommand?.trim() || null,
        description: body.description?.trim() || null,
        autoStart: body.autoStart ?? false,
        restartPolicy: normalizeRestartPolicy(body.restartPolicy, "never"),
        restartMaxRetries: normalizeRetryCount(body.restartMaxRetries, 0),
        createdById: request.user.sub,
        assignedToId: assignedToId ?? null,
        status: "CREATED"
      },
      include: instanceAccessInclude
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.create",
      resourceType: "instance",
      resourceId: instance.id,
      payload: { name: instance.name, nodeId: instance.nodeId, assignedToId: instance.assignedToId }
    });

    return toManagedInstance(instance);
  });

  app.put("/api/instances/:id", { preHandler: requirePermission("instance.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<UpdateInstanceRequest>;
    const existing = await loadInstance(request, id);
    if (!existing) {
      await sendNotFound(reply);
      return;
    }
    if (body.startCommand) {
      const blocked = findDangerousCommandReason(body.startCommand);
      if (blocked) {
        await writeAuditLog({
          request,
          userId: request.user.sub,
          action: "security.command_blocked",
          resourceType: "instance",
          resourceId: id,
          payload: { commandPreview: body.startCommand.slice(0, 200), reason: blocked },
          result: "FAILURE"
        });
        reply.code(400).send({ message: blocked });
        return;
      }
    }

    let nextNodeId: string | undefined;
    if (body.nodeId !== undefined) {
      const trimmedNodeId = body.nodeId.trim();
      if (!trimmedNodeId) {
        reply.code(400).send({ message: "nodeId cannot be empty" });
        return;
      }
      if (trimmedNodeId !== existing.nodeId) {
        const node = await prisma.node.findUnique({ where: { id: trimmedNodeId } });
        if (!node) {
          reply.code(404).send({ message: "Node not found" });
          return;
        }
        nextNodeId = trimmedNodeId;
      }
    }
    const nodeChanged = nextNodeId !== undefined;

    let assignedToId: string | null | undefined;
    try {
      assignedToId = await resolveAssignableUserId(request.user.sub, body.assignedToUserId);
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : 400;
      reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Invalid assignee" });
      return;
    }

    const updateData: Prisma.InstanceUpdateInput = {
      name: body.name ?? existing.name,
      workingDirectory: body.workingDirectory ?? existing.workingDirectory,
      startCommand: body.startCommand ?? existing.startCommand,
      stopCommand: body.stopCommand === undefined ? existing.stopCommand : body.stopCommand,
      description: body.description === undefined ? existing.description : body.description,
      autoStart: body.autoStart ?? existing.autoStart,
      restartPolicy: normalizeRestartPolicy(body.restartPolicy, existing.restartPolicy as RestartPolicy),
      restartMaxRetries: normalizeRetryCount(body.restartMaxRetries, existing.restartMaxRetries)
    };
    if (assignedToId !== undefined) {
      updateData.assignedTo = assignedToId ? { connect: { id: assignedToId } } : { disconnect: true };
    }
    if (nodeChanged && nextNodeId) {
      updateData.node = { connect: { id: nextNodeId } };
      updateData.status = existing.status === "CREATED" ? "CREATED" : "STOPPED";
      updateData.lastExitCode = null;
      if (existing.status !== "CREATED") updateData.lastStoppedAt = new Date();
    }

    const instance = await prisma.instance.update({
      where: { id },
      data: updateData,
      include: instanceAccessInclude
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.update",
      resourceType: "instance",
      resourceId: id,
      payload: {
        ...(nodeChanged ? { previousNodeId: existing.nodeId, nodeId: instance.nodeId } : {}),
        ...(assignedToId !== undefined ? { previousAssignedToId: existing.assignedToId, assignedToId } : {})
      }
    });

    return toManagedInstance(instance);
  });

  app.delete("/api/instances/:id", { preHandler: requirePermission("instance.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await loadInstance(request, id);
    if (!existing) {
      await sendNotFound(reply);
      return;
    }

    await prisma.instance.delete({ where: { id } });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.delete",
      resourceType: "instance",
      resourceId: id
    });
    return { ok: true };
  });

  app.post("/api/instances/:id/start", { preHandler: requirePermission("instance.start") }, (request, reply) =>
    runInstanceAction(request, reply, "start")
  );

  app.post("/api/instances/:id/stop", { preHandler: requirePermission("instance.stop") }, (request, reply) =>
    runInstanceAction(request, reply, "stop")
  );

  app.post("/api/instances/:id/restart", { preHandler: requirePermission("instance.restart") }, (request, reply) =>
    runInstanceAction(request, reply, "restart")
  );

  app.post("/api/instances/:id/kill", { preHandler: requirePermission("instance.kill") }, (request, reply) =>
    runInstanceAction(request, reply, "kill")
  );

  app.get("/api/instances/:id/logs", { preHandler: requirePermission("instance.logs") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { lines?: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }

    try {
      const logs = await readDaemonInstanceLogs(instance.node, id, Number(query.lines ?? 200) || 200);
      await updateStatus(id, logs.status, logs.exitCode);
      return logs satisfies InstanceLogsResponse;
    } catch (error) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.logs",
        resourceType: "instance",
        resourceId: id,
        payload: { error: error instanceof Error ? error.message : "Unknown error" },
        result: "FAILURE"
      });
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });

  app.post("/api/instances/:id/command", { preHandler: requirePermission("terminal.input") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { command?: string; timeoutMs?: number; input?: string };
    const command = body.command?.trim();
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    if (!command) {
      reply.code(400).send({ message: "command is required" });
      return;
    }
    const blocked = findDangerousCommandReason(command);
    if (blocked) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "security.command_blocked",
        resourceType: "instance",
        resourceId: id,
        payload: { commandPreview: command.slice(0, 200), reason: blocked },
        result: "FAILURE"
      });
      reply.code(400).send({ message: blocked });
      return;
    }

    try {
      const result = await runDaemonInstanceCommand(instance.node, id, {
        command,
        workingDirectory: instance.workingDirectory,
        ...(typeof body.timeoutMs === "number" ? { timeoutMs: body.timeoutMs } : {}),
        ...(typeof body.input === "string" ? { input: body.input } : {})
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.command",
        resourceType: "instance",
        resourceId: id,
        payload: {
          preview: command.slice(0, 200),
          length: command.length,
          inputLength: typeof body.input === "string" ? body.input.length : 0,
          workingDirectory: result.workingDirectory,
          exitCode: result.exitCode,
          signal: result.signal ?? null,
          durationMs: result.durationMs
        },
        result: result.exitCode === 0 ? "SUCCESS" : "FAILURE"
      });
      return result satisfies InstanceCommandResponse;
    } catch (error) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.command",
        resourceType: "instance",
        resourceId: id,
        payload: { error: error instanceof Error ? error.message : "Unknown error" },
        result: "FAILURE"
      });
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });
}
