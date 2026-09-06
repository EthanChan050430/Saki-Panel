// Template management — lists built-in + user templates, creates templates
// from existing instances, supports update/delete for user templates only.
import type { FastifyInstance } from "fastify";
import type {
  CreateInstanceFromTemplateRequest,
  DeleteTemplateResponse,
  InstanceTemplate,
  InstanceType,
  InstanceOwnerRole,
  ManagedInstance,
  RestartPolicy,
  SaveTemplateFromInstanceRequest,
  UpdateTemplateRequest
} from "@webops/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { loadCurrentUser, requirePermission } from "../auth.js";
import { canAccessInstance } from "../instance-access.js";
import { canAccessNode } from "../node-access.js";
import {
  classifyInstanceUser,
  instanceAssignedUserIds,
  instanceAssignedUserSummaries,
  instanceAccessInclude,
  resolveAssignableUserId,
  resolveAssignableUserIds,
  type InstanceWithAccess
} from "../instance-access.js";
import { writeAuditLog } from "../audit.js";
import { findDangerousCommandReason } from "../security.js";

// ---------------------------------------------------------------------------
// Built-in templates ship with the app; they can't be edited or deleted.
// On startup, seed them into the `templates` table so the mixed list query
// always has data. If you add new builtins, also bump BUILTIN_TEMPLATE_SEED.
// ---------------------------------------------------------------------------

interface BuiltinTemplateSeed {
  id: string;                 // also the template's DB id (cuid compatible)
  name: string;
  description: string;
  type: InstanceType;
  defaultStartCommand: string;
  defaultStopCommand: string | null;
  defaultWorkingDirectoryPrefix: string;
  ports: Array<{ port: number; description: string }>;
  envs: Array<{ key: string; value: string }>;
}

const BUILTIN_TEMPLATE_SEED = [
  {
    id: "tpl_builtin_generic",
    name: "通用命令实例",
    description: "运行任意长驻命令或脚本",
    type: "generic_command" as InstanceType,
    defaultStartCommand: "",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "instances",
    ports: [],
    envs: []
  },
  {
    id: "tpl_builtin_nodejs",
    name: "Node.js 项目",
    description: "适合 npm run start 或 node server.js 的 Node 服务",
    type: "nodejs" as InstanceType,
    defaultStartCommand: "npm run start",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "nodejs",
    ports: [{ port: 3000, description: "Web 服务" }],
    envs: [{ key: "NODE_ENV", value: "production" }]
  },
  {
    id: "tpl_builtin_python",
    name: "Python 项目",
    description: "适合 Python 脚本或轻量服务",
    type: "python" as InstanceType,
    defaultStartCommand: "python app.py",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "python",
    ports: [{ port: 8000, description: "Web 服务" }],
    envs: []
  },
  {
    id: "tpl_builtin_java_jar",
    name: "Java Jar 服务",
    description: "运行 app.jar 一类的 Java 服务",
    type: "java_jar" as InstanceType,
    defaultStartCommand: "java -jar app.jar",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "java",
    ports: [{ port: 8080, description: "HTTP 服务" }],
    envs: []
  },
  {
    id: "tpl_builtin_docker_container",
    name: "Docker 容器",
    description: "通过 docker run 启动容器实例",
    type: "docker_container" as InstanceType,
    defaultStartCommand: "docker run --rm --name saki-panel-demo nginx:alpine",
    defaultStopCommand: "docker stop saki-panel-demo",
    defaultWorkingDirectoryPrefix: "docker",
    ports: [{ port: 80, description: "容器服务" }],
    envs: []
  }
] satisfies BuiltinTemplateSeed[];

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

function portsFromJson(raw: string | null | undefined): InstanceTemplate["ports"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ port: number; description: string }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function envsFromJson(raw: string | null | undefined): InstanceTemplate["envs"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ key: string; value: string }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toInstanceTemplateRow(row: {
  id: string;
  name: string;
  description: string | null;
  type: string;
  defaultStartCommand: string;
  defaultStopCommand: string | null;
  defaultWorkingDirectoryPrefix: string;
  portsJson: string | null;
  envsJson: string | null;
  autoStart: boolean;
  restartPolicy: string;
  restartMaxRetries: number;
  runAsUser: string | null;
  memoryLimit: number | null;
  cpuLimit: number | null;
  fromInstanceId: string | null;
  isBuiltin: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { username: string } | null;
}): InstanceTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as InstanceType,
    defaultStartCommand: row.defaultStartCommand,
    defaultStopCommand: row.defaultStopCommand,
    defaultWorkingDirectoryPrefix: row.defaultWorkingDirectoryPrefix,
    ports: portsFromJson(row.portsJson),
    envs: envsFromJson(row.envsJson),
    autoStart: row.autoStart,
    restartPolicy: row.restartPolicy as RestartPolicy,
    restartMaxRetries: row.restartMaxRetries,
    runAsUser: row.runAsUser,
    memoryLimit: row.memoryLimit,
    cpuLimit: row.cpuLimit,
    isBuiltin: row.isBuiltin,
    fromInstanceId: row.fromInstanceId,
    createdById: row.createdById,
    createdByUsername: row.createdBy?.username ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function normalizeRestartPolicy(value: unknown): RestartPolicy {
  if (value === "never" || value === "on_failure" || value === "always" || value === "fixed_interval") {
    return value;
  }
  return "never";
}

// ---------------------------------------------------------------------------
// Seed built-in templates on first access (no-op once they exist)
// ---------------------------------------------------------------------------

let builtinSeedDone = false;
async function ensureBuiltinTemplatesSeeded(): Promise<void> {
  if (builtinSeedDone) return;
  try {
    for (const seed of BUILTIN_TEMPLATE_SEED) {
      await prisma.template.upsert({
        where: { id: seed.id },
        update: {
          name: seed.name,
          description: seed.description,
          type: seed.type,
          defaultStartCommand: seed.defaultStartCommand,
          defaultStopCommand: seed.defaultStopCommand,
          defaultWorkingDirectoryPrefix: seed.defaultWorkingDirectoryPrefix,
          portsJson: JSON.stringify(seed.ports),
          envsJson: JSON.stringify(seed.envs),
          autoStart: false,
          restartPolicy: "never",
          restartMaxRetries: 0,
          runAsUser: null,
          memoryLimit: null,
          cpuLimit: null,
          fromInstanceId: null,
          isBuiltin: true,
          createdById: null
        },
        create: {
          id: seed.id,
          name: seed.name,
          description: seed.description,
          type: seed.type,
          defaultStartCommand: seed.defaultStartCommand,
          defaultStopCommand: seed.defaultStopCommand,
          defaultWorkingDirectoryPrefix: seed.defaultWorkingDirectoryPrefix,
          portsJson: JSON.stringify(seed.ports),
          envsJson: JSON.stringify(seed.envs),
          autoStart: false,
          restartPolicy: "never",
          restartMaxRetries: 0,
          runAsUser: null,
          memoryLimit: null,
          cpuLimit: null,
          fromInstanceId: null,
          isBuiltin: true,
          createdById: null
        }
      });
    }
    builtinSeedDone = true;
  } catch (err) {
    // Seed on every request if first attempt failed (DB not ready yet, etc.)
    // eslint-disable-next-line no-console
    console.warn("[template] builtin seed failed, will retry on next request:", err);
  }
}

// ---------------------------------------------------------------------------
// Instance serialiser (shared with instances.ts to avoid drift)
// ---------------------------------------------------------------------------

function toManagedInstance(instance: InstanceWithAccess): ManagedInstance {
  const assignees = instanceAssignedUserSummaries(instance);
  const primaryAssignee = assignees[0] ?? null;
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
    assignedToUserId: primaryAssignee?.userId ?? null,
    assignedToUsername: primaryAssignee?.username ?? null,
    assignedToDisplayName: primaryAssignee?.displayName ?? null,
    assignedToRole: primaryAssignee?.role ?? null,
    assignees,
    lastStartedAt: instance.lastStartedAt?.toISOString() ?? null,
    lastStoppedAt: instance.lastStoppedAt?.toISOString() ?? null,
    lastExitCode: instance.lastExitCode,
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString()
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  // GET  /api/templates — list all (built-in + user templates)
  app.get("/api/templates", { preHandler: requirePermission("template.view") }, async () => {
    await ensureBuiltinTemplatesSeeded();
    const rows = await prisma.template.findMany({
      orderBy: [
        { isBuiltin: "desc" },          // builtins first
        { createdAt: "desc" }
      ],
      include: { createdBy: { select: { username: true } } }
    });
    return rows.map(toInstanceTemplateRow) satisfies InstanceTemplate[];
  });

  // POST /api/templates/from-instance — snapshot an existing instance as a template
  app.post(
    "/api/templates/from-instance",
    { preHandler: requirePermission("template.create") },
    async (request, reply) => {
      const body = request.body as { instanceId: string; data: SaveTemplateFromInstanceRequest };
      const instanceId = body.instanceId?.trim();
      const data = body.data;
      if (!instanceId || !data?.name?.trim()) {
        reply.code(400).send({ message: "instanceId and name are required" });
        return;
      }

      const user = await loadCurrentUser(request.user.sub);
      if (!user) {
        reply.code(401).send({ message: "Unauthorized" });
        return;
      }

      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        include: instanceAccessInclude
      });
      if (!instance || !canAccessInstance(
        {
          userId: user.id,
          role: (user.isSuperAdmin ? "super_admin" : user.isAdmin ? "admin" : "user") as InstanceOwnerRole,
          roleNames: user.roleNames
        },
        instance
      )) {
        reply.code(404).send({ message: "Instance not found" });
        return;
      }

      const startCommand = data.startCommand?.trim() || instance.startCommand;
      const stopCommand = data.stopCommand === undefined
        ? instance.stopCommand
        : data.stopCommand?.trim() || null;

      const blocked = findDangerousCommandReason(startCommand);
      if (blocked) {
        await writeAuditLog({
          request,
          userId: request.user.sub,
          action: "security.command_blocked",
          resourceType: "template",
          payload: { commandPreview: startCommand.slice(0, 200), reason: blocked },
          result: "FAILURE"
        });
        reply.code(400).send({ message: blocked });
        return;
      }

      const id = randomUUID();
      const template = await prisma.template.create({
        data: {
          id,
          name: data.name.trim(),
          description: data.description?.trim() || instance.description || null,
          type: instance.type,
          defaultStartCommand: startCommand,
          defaultStopCommand: stopCommand,
          defaultWorkingDirectoryPrefix:
            data.workingDirectoryPrefix?.trim() || extractPrefix(instance.workingDirectory),
          portsJson: JSON.stringify([]),
          envsJson: JSON.stringify([]),
          autoStart: instance.autoStart,
          restartPolicy: instance.restartPolicy,
          restartMaxRetries: instance.restartMaxRetries,
          runAsUser: instance.runAsUser,
          memoryLimit: instance.memoryLimit,
          cpuLimit: instance.cpuLimit,
          fromInstanceId: instance.id,
          isBuiltin: false,
          createdById: request.user.sub
        },
        include: { createdBy: { select: { username: true } } }
      });

      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "template.create",
        resourceType: "template",
        resourceId: id,
        payload: { fromInstanceId: instance.id, name: template.name }
      });

      return toInstanceTemplateRow(template);
    }
  );

  // PUT /api/templates/:id — update a user template (builtins are frozen)
  app.put(
    "/api/templates/:id",
    { preHandler: requirePermission("template.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await loadCurrentUser(request.user.sub);
      if (!user) {
        reply.code(401).send({ message: "Unauthorized" });
        return;
      }

      const existing = await prisma.template.findUnique({ where: { id } });
      if (!existing) {
        reply.code(404).send({ message: "Template not found" });
        return;
      }
      if (existing.isBuiltin) {
        reply.code(400).send({ message: "Built-in templates cannot be edited" });
        return;
      }
      if (existing.createdById && existing.createdById !== user.id && !user.permissions.includes("template.create")) {
        // Non-admin users can only edit their own templates
        reply.code(403).send({ message: "You do not have permission to edit this template" });
        return;
      }

      const body = request.body as UpdateTemplateRequest;
      const startCommand = body.defaultStartCommand?.trim();
      if (startCommand !== undefined) {
        const blocked = findDangerousCommandReason(startCommand);
        if (blocked) {
          reply.code(400).send({ message: blocked });
          return;
        }
      }

      const updated = await prisma.template.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(startCommand !== undefined ? { defaultStartCommand: startCommand } : {}),
          ...(body.defaultStopCommand !== undefined
            ? { defaultStopCommand: body.defaultStopCommand?.trim() || null }
            : {}),
          ...(body.defaultWorkingDirectoryPrefix !== undefined
            ? { defaultWorkingDirectoryPrefix: body.defaultWorkingDirectoryPrefix.trim() }
            : {}),
          ...(body.ports !== undefined ? { portsJson: JSON.stringify(body.ports) } : {}),
          ...(body.envs !== undefined ? { envsJson: JSON.stringify(body.envs) } : {}),
          ...(body.autoStart !== undefined ? { autoStart: body.autoStart } : {}),
          ...(body.restartPolicy !== undefined ? { restartPolicy: normalizeRestartPolicy(body.restartPolicy) } : {}),
          ...(body.restartMaxRetries !== undefined
            ? { restartMaxRetries: Math.max(0, Math.min(Math.floor(body.restartMaxRetries), 99)) }
            : {}),
          ...(body.runAsUser !== undefined ? { runAsUser: body.runAsUser || null } : {}),
          ...(body.memoryLimit !== undefined ? { memoryLimit: body.memoryLimit } : {}),
          ...(body.cpuLimit !== undefined ? { cpuLimit: body.cpuLimit } : {})
        },
        include: { createdBy: { select: { username: true } } }
      });

      return toInstanceTemplateRow(updated);
    }
  );

  // DELETE /api/templates/:id — delete a user template (builtins are frozen)
  app.delete(
    "/api/templates/:id",
    { preHandler: requirePermission("template.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await loadCurrentUser(request.user.sub);
      if (!user) {
        reply.code(401).send({ message: "Unauthorized" });
        return;
      }

      const existing = await prisma.template.findUnique({ where: { id } });
      if (!existing) {
        reply.code(404).send({ message: "Template not found" });
        return;
      }
      if (existing.isBuiltin) {
        reply.code(400).send({ message: "Built-in templates cannot be deleted" });
        return;
      }
      if (existing.createdById && existing.createdById !== user.id && !user.permissions.includes("template.create")) {
        reply.code(403).send({ message: "You do not have permission to delete this template" });
        return;
      }

      await prisma.template.delete({ where: { id } });

      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "template.delete",
        resourceType: "template",
        resourceId: id,
        payload: { name: existing.name, fromInstanceId: existing.fromInstanceId }
      });

      const response: DeleteTemplateResponse = { success: true, id };
      return response;
    }
  );

  // POST /api/templates/:id/instances — existing endpoint, now against DB
  app.post(
    "/api/templates/:id/instances",
    { preHandler: requirePermission("template.create") },
    async (request, reply) => {
      await ensureBuiltinTemplatesSeeded();
      const { id: templateId } = request.params as { id: string };
      const template = await prisma.template.findUnique({
        where: { id: templateId },
        include: { createdBy: { select: { username: true } } }
      });
      if (!template) {
        reply.code(404).send({ message: "Template not found" });
        return;
      }

      const body = request.body as Partial<CreateInstanceFromTemplateRequest>;
      if (!body.nodeId || !body.name) {
        reply.code(400).send({ message: "nodeId and name are required" });
        return;
      }

      const user = await loadCurrentUser(request.user.sub);
      const node = await prisma.node.findUnique({ where: { id: body.nodeId } });
      if (!node || !user || !canAccessNode(user, node)) {
        reply.code(404).send({ message: "Node not found" });
        return;
      }

      const startCommand = body.startCommand?.trim() || template.defaultStartCommand;
      if (!startCommand) {
        reply.code(400).send({ message: "startCommand is required" });
        return;
      }
      const blocked = findDangerousCommandReason(startCommand);
      if (blocked) {
        await writeAuditLog({
          request,
          userId: request.user.sub,
          action: "security.command_blocked",
          resourceType: "template",
          resourceId: template.id,
          payload: { commandPreview: startCommand.slice(0, 200), reason: blocked },
          result: "FAILURE"
        });
        reply.code(400).send({ message: blocked });
        return;
      }

      let assignedUserIds: string[] | undefined;
      try {
        if (body.assignedToUserIds !== undefined) {
          assignedUserIds = await resolveAssignableUserIds(request.user.sub, body.assignedToUserIds);
        } else {
          const assignedToId = await resolveAssignableUserId(request.user.sub, body.assignedToUserId);
          assignedUserIds = assignedToId === undefined ? undefined : assignedToId ? [assignedToId] : [];
        }
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
            ? error.statusCode
            : 400;
        reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Invalid assignee" });
        return;
      }

      const instanceId = randomUUID();
      const initialAssignedUserIds = assignedUserIds ?? [];
      const instance = await prisma.instance.create({
        data: {
          id: instanceId,
          nodeId: body.nodeId,
          name: body.name.trim(),
          type: template.type,
          workingDirectory:
            body.workingDirectory?.trim() || `${template.defaultWorkingDirectoryPrefix}/${instanceId}`,
          startCommand,
          stopCommand:
            body.stopCommand === undefined
              ? template.defaultStopCommand
              : body.stopCommand?.trim() || null,
          description: body.description?.trim() || template.description || null,
          autoStart: body.autoStart ?? template.autoStart,
          restartPolicy: normalizeRestartPolicy(body.restartPolicy ?? template.restartPolicy),
          restartMaxRetries: Math.max(0, Math.min(Math.floor(body.restartMaxRetries ?? template.restartMaxRetries), 99)),
          runAsUser: template.runAsUser,
          memoryLimit: template.memoryLimit,
          cpuLimit: template.cpuLimit,
          createdById: request.user.sub,
          assignedToId: initialAssignedUserIds[0] ?? null,
          ...(initialAssignedUserIds.length
            ? {
                assignedUsers: {
                  create: initialAssignedUserIds.map((userId) => ({ userId }))
                }
              }
            : {}),
          status: "CREATED"
        },
        include: instanceAccessInclude
      });

      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "template.instance.create",
        resourceType: "instance",
        resourceId: instance.id,
        payload: { templateId: template.id, name: instance.name, assignedUserIds: instanceAssignedUserIds(instance) }
      });

      return toManagedInstance(instance);
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPrefix(workingDirectory: string): string {
  const trimmed = workingDirectory.replace(/^[\\/]+/, "");
  const slash = trimmed.indexOf("/");
  const backslash = trimmed.indexOf("\\");
  const firstSep = slash === -1 ? backslash : backslash === -1 ? slash : Math.min(slash, backslash);
  return firstSep === -1 ? trimmed : trimmed.slice(0, firstSep);
}
