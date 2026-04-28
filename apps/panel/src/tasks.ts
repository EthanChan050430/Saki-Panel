import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type {
  CreateScheduledTaskRequest,
  ManagedScheduledTask,
  ManagedTaskRun,
  RestartPolicy,
  ScheduledTaskPayload,
  ScheduledTaskType,
  TaskRunStatus,
  UpdateScheduledTaskRequest
} from "@webops/shared";
import { prisma } from "./db.js";
import { writeAuditLog } from "./audit.js";
import {
  restartDaemonInstance,
  sendDaemonInstanceInput,
  startDaemonInstance,
  stopDaemonInstance,
  type DaemonInstanceSpec
} from "./daemon-client.js";

interface ScheduledTaskRow {
  id: string;
  node_id: string | null;
  instance_id: string | null;
  instance_name: string | null;
  name: string;
  type: ScheduledTaskType;
  cron: string;
  payload: string | null;
  enabled: number | boolean;
  last_run_at: string | Date | null;
  next_run_at: string | Date | null;
  created_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface TaskRunRow {
  id: string;
  task_id: string;
  status: TaskRunStatus;
  output: string | null;
  error: string | null;
  started_at: string | Date;
  finished_at: string | Date | null;
}

type InstanceWithNode = NonNullable<Awaited<ReturnType<typeof loadInstance>>>;

const runningTaskIds = new Set<string>();

function toIso(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePayload(value: string | null): ScheduledTaskPayload {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as ScheduledTaskPayload;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function serializePayload(value: ScheduledTaskPayload | undefined): string {
  return JSON.stringify(value ?? {});
}

function toManagedTask(row: ScheduledTaskRow): ManagedScheduledTask {
  return {
    id: row.id,
    nodeId: row.node_id,
    instanceId: row.instance_id,
    instanceName: row.instance_name,
    name: row.name,
    type: row.type,
    cron: row.cron,
    payload: parsePayload(row.payload),
    enabled: row.enabled === true || row.enabled === 1,
    lastRunAt: toIso(row.last_run_at),
    nextRunAt: toIso(row.next_run_at),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

function toManagedRun(row: TaskRunRow): ManagedTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    output: row.output,
    error: row.error,
    startedAt: toIso(row.started_at) ?? new Date().toISOString(),
    finishedAt: toIso(row.finished_at)
  };
}

function normalizeTaskType(value: unknown): ScheduledTaskType {
  if (value === "run_command" || value === "restart_instance" || value === "stop_instance" || value === "start_instance") {
    return value;
  }
  throw new Error("Unsupported task type");
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function nextMinuteBoundary(from: Date): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return next;
}

function parseMinutePart(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 59) return null;
  return parsed;
}

function parseHourPart(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return null;
  return parsed;
}

export function computeNextRunAt(cron: string, from = new Date()): string | null {
  const normalized = cron.trim();
  if (!normalized || normalized === "@manual" || normalized === "manual") return null;

  const everyMatch = normalized.match(/^@?every\s+(\d+)(s|m|h)$/i);
  if (everyMatch) {
    const amount = Number(everyMatch[1]);
    const unit = everyMatch[2]?.toLowerCase();
    const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
    return addMs(from, Math.max(1, amount) * multiplier).toISOString();
  }

  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Schedule must be @every 5m, @manual, or a 5-field cron expression");
  }

  const [minutePart, hourPart] = parts;
  const base = nextMinuteBoundary(from);

  if (minutePart === "*" && hourPart === "*") {
    return base.toISOString();
  }

  const stepMatch = minutePart?.match(/^\*\/(\d+)$/);
  if (stepMatch && hourPart === "*") {
    const step = Math.max(1, Math.min(Number(stepMatch[1]), 59));
    const next = new Date(base);
    while (next.getMinutes() % step !== 0) {
      next.setMinutes(next.getMinutes() + 1);
    }
    return next.toISOString();
  }

  const minute = parseMinutePart(minutePart ?? "");
  if (minute === null) {
    throw new Error("Only *, */n, or a fixed minute are supported");
  }

  if (hourPart === "*") {
    const next = new Date(base);
    next.setMinutes(minute, 0, 0);
    if (next <= from) {
      next.setHours(next.getHours() + 1);
    }
    return next.toISOString();
  }

  const hour = parseHourPart(hourPart ?? "");
  if (hour === null) {
    throw new Error("Only * or a fixed hour are supported");
  }

  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  if (next <= from) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function normalizeEnabled(value: boolean | undefined): boolean {
  return value ?? true;
}

async function queryTasks(sql: string, ...values: unknown[]): Promise<ManagedScheduledTask[]> {
  const rows = await prisma.$queryRawUnsafe<ScheduledTaskRow[]>(sql, ...values);
  return rows.map(toManagedTask);
}

export async function listScheduledTasks(instanceId?: string): Promise<ManagedScheduledTask[]> {
  const whereClause = instanceId ? "WHERE t.instanceId = ?" : "";
  return queryTasks(
    `SELECT
       t.id,
       t.nodeId AS node_id,
       t.instanceId AS instance_id,
       i.name AS instance_name,
       t.name,
       t.type,
       t.cron,
       t.payload,
       t.enabled,
       t.lastRunAt AS last_run_at,
       t.nextRunAt AS next_run_at,
       t.createdBy AS created_by,
       t.createdAt AS created_at,
       t.updatedAt AS updated_at
     FROM scheduled_tasks t
     LEFT JOIN instances i ON i.id = t.instanceId
     ${whereClause}
     ORDER BY t.createdAt DESC`,
    ...(instanceId ? [instanceId] : [])
  );
}

export async function getScheduledTask(id: string): Promise<ManagedScheduledTask | null> {
  const tasks = await queryTasks(
    `SELECT
       t.id,
       t.nodeId AS node_id,
       t.instanceId AS instance_id,
       i.name AS instance_name,
       t.name,
       t.type,
       t.cron,
       t.payload,
       t.enabled,
       t.lastRunAt AS last_run_at,
       t.nextRunAt AS next_run_at,
       t.createdBy AS created_by,
       t.createdAt AS created_at,
       t.updatedAt AS updated_at
     FROM scheduled_tasks t
     LEFT JOIN instances i ON i.id = t.instanceId
     WHERE t.id = ?
     LIMIT 1`,
    id
  );
  return tasks[0] ?? null;
}

export async function createScheduledTask(
  input: CreateScheduledTaskRequest,
  createdBy: string | null
): Promise<ManagedScheduledTask> {
  const taskId = randomUUID();
  const type = normalizeTaskType(input.type);
  const enabled = normalizeEnabled(input.enabled);
  const now = new Date().toISOString();
  const nextRunAt = enabled ? computeNextRunAt(input.cron, new Date()) : null;
  const instance = input.instanceId ? await loadInstance(input.instanceId) : null;

  if ((type !== "run_command" || input.payload?.command) && !input.instanceId) {
    throw new Error("instanceId is required");
  }
  if (type === "run_command" && !input.payload?.command?.trim()) {
    throw new Error("payload.command is required for command tasks");
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO scheduled_tasks
      (id, nodeId, instanceId, name, type, cron, payload, enabled, lastRunAt, nextRunAt, createdBy, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    taskId,
    instance?.nodeId ?? null,
    input.instanceId ?? null,
    input.name.trim(),
    type,
    input.cron.trim(),
    serializePayload(input.payload),
    enabled ? 1 : 0,
    nextRunAt,
    createdBy,
    now,
    now
  );

  const created = await getScheduledTask(taskId);
  if (!created) throw new Error("Task creation failed");
  return created;
}

export async function updateScheduledTask(id: string, input: UpdateScheduledTaskRequest): Promise<ManagedScheduledTask> {
  const existing = await getScheduledTask(id);
  if (!existing) throw new Error("Task not found");

  const type = normalizeTaskType(input.type ?? existing.type);
  const instanceId = input.instanceId === undefined ? existing.instanceId ?? null : input.instanceId;
  const instance = instanceId ? await loadInstance(instanceId) : null;
  const payload = input.payload ?? existing.payload;
  const cron = (input.cron ?? existing.cron).trim();
  const enabled = input.enabled ?? existing.enabled;

  if ((type !== "run_command" || payload.command) && !instanceId) {
    throw new Error("instanceId is required");
  }
  if (type === "run_command" && !payload.command?.trim()) {
    throw new Error("payload.command is required for command tasks");
  }

  const now = new Date().toISOString();
  const nextRunAt = enabled ? computeNextRunAt(cron, new Date()) : null;
  await prisma.$executeRawUnsafe(
    `UPDATE scheduled_tasks
     SET nodeId = ?, instanceId = ?, name = ?, type = ?, cron = ?, payload = ?, enabled = ?,
         nextRunAt = ?, updatedAt = ?
     WHERE id = ?`,
    instance?.nodeId ?? null,
    instanceId,
    (input.name ?? existing.name).trim(),
    type,
    cron,
    serializePayload(payload),
    enabled ? 1 : 0,
    nextRunAt,
    now,
    id
  );

  const updated = await getScheduledTask(id);
  if (!updated) throw new Error("Task not found");
  return updated;
}

export async function deleteScheduledTask(id: string): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM scheduled_tasks WHERE id = ?`, id);
}

export async function listTaskRuns(taskId: string): Promise<ManagedTaskRun[]> {
  const rows = await prisma.$queryRawUnsafe<TaskRunRow[]>(
    `SELECT
       id,
       taskId AS task_id,
       status,
       output,
       error,
       startedAt AS started_at,
       finishedAt AS finished_at
     FROM task_runs
     WHERE taskId = ?
     ORDER BY startedAt DESC
     LIMIT 50`,
    taskId
  );
  return rows.map(toManagedRun);
}

async function loadInstance(id: string) {
  return prisma.instance.findUnique({
    where: { id },
    include: { node: true }
  });
}

function specFromInstance(instance: InstanceWithNode): DaemonInstanceSpec {
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

async function updateInstanceStatus(instanceId: string, status: string, exitCode?: number | null): Promise<void> {
  const now = new Date();
  await prisma.instance.update({
    where: { id: instanceId },
    data: {
      status: status as never,
      lastExitCode: exitCode ?? null,
      ...(status === "RUNNING" ? { lastStartedAt: now } : {}),
      ...(status === "STOPPED" || status === "CRASHED" ? { lastStoppedAt: now } : {})
    }
  });
}

async function loadRequiredTaskInstance(task: ManagedScheduledTask): Promise<InstanceWithNode> {
  if (!task.instanceId) {
    throw new Error("Task has no bound instance");
  }
  const instance = await loadInstance(task.instanceId);
  if (!instance) {
    throw new Error("Task instance not found");
  }
  return instance;
}

async function executeTaskOperation(task: ManagedScheduledTask): Promise<string> {
  const instance = await loadRequiredTaskInstance(task);

  if (task.type === "start_instance") {
    await prisma.instance.update({ where: { id: instance.id }, data: { status: "STARTING" } });
    const state = await startDaemonInstance(instance.node, specFromInstance(instance));
    await updateInstanceStatus(instance.id, state.status, state.exitCode);
    return `Started instance ${instance.name}`;
  }

  if (task.type === "stop_instance") {
    await prisma.instance.update({ where: { id: instance.id }, data: { status: "STOPPING" } });
    const state = await stopDaemonInstance(instance.node, { id: instance.id, stopCommand: instance.stopCommand });
    await updateInstanceStatus(instance.id, state.status, state.exitCode);
    return `Stopped instance ${instance.name}`;
  }

  if (task.type === "restart_instance") {
    await prisma.instance.update({ where: { id: instance.id }, data: { status: "STOPPING" } });
    const state = await restartDaemonInstance(instance.node, specFromInstance(instance));
    await updateInstanceStatus(instance.id, state.status, state.exitCode);
    return `Restarted instance ${instance.name}`;
  }

  const command = task.payload.command?.trim();
  if (!command) {
    throw new Error("Task command is empty");
  }
  const state = await sendDaemonInstanceInput(instance.node, instance.id, `${command}\n`);
  await updateInstanceStatus(instance.id, state.status, state.exitCode);
  return `Sent command to ${instance.name}: ${command.slice(0, 200)}`;
}

async function createTaskRun(taskId: string): Promise<string> {
  const runId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO task_runs (id, taskId, status, startedAt) VALUES (?, ?, ?, ?)`,
    runId,
    taskId,
    "RUNNING",
    new Date().toISOString()
  );
  return runId;
}

async function finishTaskRun(runId: string, status: TaskRunStatus, output: string | null, error: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE task_runs SET status = ?, output = ?, error = ?, finishedAt = ? WHERE id = ?`,
    status,
    output,
    error,
    new Date().toISOString(),
    runId
  );
}

async function markTaskRunComplete(task: ManagedScheduledTask): Promise<void> {
  const now = new Date();
  const nextRunAt = task.enabled ? computeNextRunAt(task.cron, now) : null;
  await prisma.$executeRawUnsafe(
    `UPDATE scheduled_tasks SET lastRunAt = ?, nextRunAt = ?, updatedAt = ? WHERE id = ?`,
    now.toISOString(),
    nextRunAt,
    now.toISOString(),
    task.id
  );
}

export async function executeScheduledTask(
  taskId: string,
  options: { trigger: "manual" | "schedule"; request?: FastifyRequest; userId?: string | null }
): Promise<ManagedTaskRun> {
  if (runningTaskIds.has(taskId)) {
    throw new Error("Task is already running");
  }

  const task = await getScheduledTask(taskId);
  if (!task) throw new Error("Task not found");

  runningTaskIds.add(taskId);
  const runId = await createTaskRun(taskId);
  try {
    const output = await executeTaskOperation(task);
    await finishTaskRun(runId, "SUCCESS", output, null);
    await markTaskRunComplete(task);
    await writeAuditLog({
      ...(options.request ? { request: options.request } : {}),
      userId: options.userId ?? null,
      action: "task.run",
      resourceType: "scheduled_task",
      resourceId: task.id,
      payload: { trigger: options.trigger, type: task.type }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task execution failed";
    await finishTaskRun(runId, "FAILURE", null, message);
    await markTaskRunComplete(task);
    await writeAuditLog({
      ...(options.request ? { request: options.request } : {}),
      userId: options.userId ?? null,
      action: "task.run",
      resourceType: "scheduled_task",
      resourceId: task.id,
      payload: { trigger: options.trigger, type: task.type, error: message },
      result: "FAILURE"
    });
  } finally {
    runningTaskIds.delete(taskId);
  }

  const runs = await listTaskRuns(taskId);
  const run = runs.find((item) => item.id === runId);
  if (!run) throw new Error("Task run result not found");
  return run;
}

async function dueTaskIds(now: Date): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
     FROM scheduled_tasks
     WHERE enabled = 1 AND nextRunAt IS NOT NULL AND nextRunAt <= ?
     ORDER BY nextRunAt ASC
     LIMIT 10`,
    now.toISOString()
  );
  return rows.map((row) => row.id);
}

async function restoreAutoStartInstances(logger: FastifyBaseLogger): Promise<void> {
  const instances = await prisma.instance.findMany({
    where: { autoStart: true },
    include: { node: true },
    orderBy: { createdAt: "asc" }
  });

  for (const instance of instances) {
    try {
      await prisma.instance.update({ where: { id: instance.id }, data: { status: "STARTING" } });
      const state = await startDaemonInstance(instance.node, specFromInstance(instance));
      await updateInstanceStatus(instance.id, state.status, state.exitCode);
      await writeAuditLog({
        userId: null,
        action: "instance.autostart",
        resourceType: "instance",
        resourceId: instance.id,
        payload: { name: instance.name }
      });
    } catch (error) {
      logger.warn({ err: error, instanceId: instance.id }, "Auto-start failed");
      await prisma.instance.update({ where: { id: instance.id }, data: { status: "UNKNOWN" } }).catch(() => undefined);
      await writeAuditLog({
        userId: null,
        action: "instance.autostart",
        resourceType: "instance",
        resourceId: instance.id,
        payload: { error: error instanceof Error ? error.message : "Auto-start failed" },
        result: "FAILURE"
      });
    }
  }
}

export function startTaskScheduler(logger: FastifyBaseLogger): () => void {
  const timers: NodeJS.Timeout[] = [];
  const runDueTasks = async () => {
    try {
      const ids = await dueTaskIds(new Date());
      for (const id of ids) {
        void executeScheduledTask(id, { trigger: "schedule" }).catch((error) => {
          logger.warn({ err: error, taskId: id }, "Scheduled task failed");
        });
      }
    } catch (error) {
      logger.warn({ err: error }, "Task scheduler tick failed");
    }
  };

  timers.push(
    setTimeout(() => void restoreAutoStartInstances(logger), 2500),
    setTimeout(() => void restoreAutoStartInstances(logger), 12000),
    setInterval(() => void runDueTasks(), 15000)
  );
  void runDueTasks();

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  };
}
