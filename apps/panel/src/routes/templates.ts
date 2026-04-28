import type { FastifyInstance } from "fastify";
import type {
  CreateInstanceFromTemplateRequest,
  InstanceTemplate,
  InstanceType,
  ManagedInstance,
  RestartPolicy
} from "@webops/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { requirePermission } from "../auth.js";
import {
  classifyInstanceUser,
  instanceAccessInclude,
  resolveAssignableUserId,
  type InstanceWithAccess
} from "../instance-access.js";
import { writeAuditLog } from "../audit.js";
import { findDangerousCommandReason } from "../security.js";

const instanceTemplates: InstanceTemplate[] = [
  {
    id: "generic-command",
    name: "通用命令实例",
    description: "运行任意长驻命令或脚本",
    type: "generic_command",
    defaultStartCommand: "node -e \"let i=0; setInterval(()=>console.log('tick '+(++i)),1000)\"",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "instances",
    ports: [],
    envs: []
  },
  {
    id: "nodejs",
    name: "Node.js 项目",
    description: "适合 npm run start 或 node server.js 的 Node 服务",
    type: "nodejs",
    defaultStartCommand: "npm run start",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "nodejs",
    ports: [{ port: 3000, description: "Web 服务" }],
    envs: [{ key: "NODE_ENV", value: "production" }]
  },
  {
    id: "python",
    name: "Python 项目",
    description: "适合 Python 脚本或轻量服务",
    type: "python",
    defaultStartCommand: "python app.py",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "python",
    ports: [{ port: 8000, description: "Web 服务" }],
    envs: []
  },
  {
    id: "java-jar",
    name: "Java Jar 服务",
    description: "运行 app.jar 一类的 Java 服务",
    type: "java_jar",
    defaultStartCommand: "java -jar app.jar",
    defaultStopCommand: null,
    defaultWorkingDirectoryPrefix: "java",
    ports: [{ port: 8080, description: "HTTP 服务" }],
    envs: []
  },
  {
    id: "docker-container",
    name: "Docker 容器",
    description: "通过 docker run 启动容器实例",
    type: "docker_container",
    defaultStartCommand: "docker run --rm --name saki-panel-demo nginx:alpine",
    defaultStopCommand: "docker stop saki-panel-demo",
    defaultWorkingDirectoryPrefix: "docker",
    ports: [{ port: 80, description: "容器服务" }],
    envs: []
  }
];

function normalizeRestartPolicy(value: unknown): RestartPolicy {
  if (value === "never" || value === "on_failure" || value === "always" || value === "fixed_interval") {
    return value;
  }
  return "never";
}

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

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/templates", { preHandler: requirePermission("template.view") }, async () => instanceTemplates);

  app.post("/api/templates/:id/instances", { preHandler: requirePermission("template.create") }, async (request, reply) => {
    const { id: templateId } = request.params as { id: string };
    const template = instanceTemplates.find((item) => item.id === templateId);
    if (!template) {
      reply.code(404).send({ message: "Template not found" });
      return;
    }

    const body = request.body as Partial<CreateInstanceFromTemplateRequest>;
    if (!body.nodeId || !body.name) {
      reply.code(400).send({ message: "nodeId and name are required" });
      return;
    }

    const node = await prisma.node.findUnique({ where: { id: body.nodeId } });
    if (!node) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    const startCommand = body.startCommand?.trim() || template.defaultStartCommand;
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

    const instanceId = randomUUID();
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
            ? template.defaultStopCommand ?? null
            : body.stopCommand?.trim() || null,
        description: body.description?.trim() || template.description,
        autoStart: body.autoStart ?? false,
        restartPolicy: normalizeRestartPolicy(body.restartPolicy),
        restartMaxRetries: Math.max(0, Math.min(Math.floor(body.restartMaxRetries ?? 0), 99)),
        createdById: request.user.sub,
        assignedToId: assignedToId ?? null,
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
      payload: { templateId: template.id, name: instance.name, assignedToId: instance.assignedToId }
    });

    return toManagedInstance(instance);
  });
}
