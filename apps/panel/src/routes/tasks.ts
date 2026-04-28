import type { FastifyInstance } from "fastify";
import type { CreateScheduledTaskRequest, UpdateScheduledTaskRequest } from "@webops/shared";
import { requirePermission } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { listVisibleInstances, loadVisibleInstance } from "../instance-access.js";
import {
  createScheduledTask,
  deleteScheduledTask,
  executeScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  listTaskRuns,
  updateScheduledTask
} from "../tasks.js";

async function ensureTask(id: string) {
  const task = await getScheduledTask(id);
  if (!task) {
    throw Object.assign(new Error("Task not found"), { statusCode: 404 });
  }
  return task;
}

async function ensureVisibleTask(id: string, userId: string) {
  const task = await ensureTask(id);
  if (task.instanceId && !(await loadVisibleInstance(userId, task.instanceId))) {
    throw Object.assign(new Error("Task not found"), { statusCode: 404 });
  }
  return task;
}

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks", { preHandler: requirePermission("task.view") }, async (request) => {
    const query = request.query as { instanceId?: string };
    const instanceId = query.instanceId?.trim() || undefined;
    if (instanceId && !(await loadVisibleInstance(request.user.sub, instanceId))) {
      throw Object.assign(new Error("Instance not found"), { statusCode: 404 });
    }
    const tasks = await listScheduledTasks(instanceId);
    if (instanceId) return tasks;
    const visibleInstanceIds = new Set((await listVisibleInstances(request.user.sub)).map((instance) => instance.id));
    return tasks.filter((task) => !task.instanceId || visibleInstanceIds.has(task.instanceId));
  });

  app.post("/api/tasks", { preHandler: requirePermission("task.create") }, async (request, reply) => {
    const body = request.body as Partial<CreateScheduledTaskRequest>;
    if (!body.name || !body.type || !body.cron) {
      reply.code(400).send({ message: "name, type and cron are required" });
      return;
    }
    if (body.instanceId && !(await loadVisibleInstance(request.user.sub, body.instanceId))) {
      reply.code(404).send({ message: "Instance not found" });
      return;
    }

    const task = await createScheduledTask(
      {
        name: body.name,
        type: body.type,
        cron: body.cron,
        instanceId: body.instanceId ?? null,
        payload: body.payload ?? {},
        enabled: body.enabled ?? true
      },
      request.user.sub
    );
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "task.create",
      resourceType: "scheduled_task",
      resourceId: task.id,
      payload: { name: task.name, type: task.type }
    });
    return task;
  });

  app.get("/api/tasks/:id", { preHandler: requirePermission("task.view") }, async (request) => {
    const { id } = request.params as { id: string };
    return ensureVisibleTask(id, request.user.sub);
  });

  app.put("/api/tasks/:id", { preHandler: requirePermission("task.update") }, async (request) => {
    const { id } = request.params as { id: string };
    await ensureVisibleTask(id, request.user.sub);
    const body = request.body as UpdateScheduledTaskRequest;
    if (body.instanceId && !(await loadVisibleInstance(request.user.sub, body.instanceId))) {
      throw Object.assign(new Error("Instance not found"), { statusCode: 404 });
    }
    const task = await updateScheduledTask(id, body);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "task.update",
      resourceType: "scheduled_task",
      resourceId: id,
      payload: { name: task.name, type: task.type }
    });
    return task;
  });

  app.delete("/api/tasks/:id", { preHandler: requirePermission("task.delete") }, async (request) => {
    const { id } = request.params as { id: string };
    await ensureVisibleTask(id, request.user.sub);
    await deleteScheduledTask(id);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "task.delete",
      resourceType: "scheduled_task",
      resourceId: id
    });
    return { ok: true };
  });

  app.post("/api/tasks/:id/run", { preHandler: requirePermission("task.run") }, async (request) => {
    const { id } = request.params as { id: string };
    await ensureVisibleTask(id, request.user.sub);
    return executeScheduledTask(id, {
      trigger: "manual",
      request,
      userId: request.user.sub
    });
  });

  app.get("/api/tasks/:id/runs", { preHandler: requirePermission("task.view") }, async (request) => {
    const { id } = request.params as { id: string };
    await ensureVisibleTask(id, request.user.sub);
    return listTaskRuns(id);
  });
}
