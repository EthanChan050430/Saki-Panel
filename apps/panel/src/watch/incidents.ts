import { createHash } from "node:crypto";
import type {
  IncidentStatus,
  IncidentTrigger,
  ManagedIncident,
  WatchDiagnosis
} from "@webops/shared";
import { prisma } from "../db.js";
import { publishIncident, publishIncidentCounts } from "./notify.js";
import { clearRestartLease } from "./leases.js";

// 所有"仍在处理中、需要出现在待办计数里"的 incident 状态。
export const activeIncidentStatuses: IncidentStatus[] = [
  "open",
  "diagnosing",
  "diagnosed",
  "awaiting_approval",
  "applying",
  "verifying",
  "rate_limited"
];

// logTail 入库上限：崩溃日志可能很大，截断到末尾 4000 字符；
// 指纹计算基于同一份截断结果，保证存储与去重一致。
export const maxIncidentLogTailChars = 4000;

export function truncateLogTail(value: string): string {
  return value.length > maxIncidentLogTailChars ? value.slice(-maxIncidentLogTailChars) : value;
}

const incidentInclude = {
  instance: {
    select: {
      name: true,
      node: {
        select: { name: true }
      }
    }
  }
} as const;

export function normalizeLogTail(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, "")
    .replace(/\b(?:pid|PID)[=:\s]\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-4000);
}

export function crashFingerprint(instanceId: string, exitCode: number | null | undefined, logTail: string): string {
  const material = `${instanceId}\n${exitCode ?? ""}\n${normalizeLogTail(logTail)}`;
  return createHash("sha256").update(material).digest("hex");
}

function parseRollbackSet(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function parseDiagnosis(value: string | null | undefined): WatchDiagnosis | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as WatchDiagnosis;
    if (!parsed || typeof parsed !== "object" || typeof parsed.summary !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toManagedIncident(row: {
  id: string;
  instanceId: string;
  nodeId: string;
  fingerprint: string;
  trigger: string;
  status: string;
  exitCode: number | null;
  summary: string | null;
  rootCause: string | null;
  proposedPatch: string | null;
  logTail: string;
  rollbackSet: string | null;
  taskId: string | null;
  assigneeUserId: string | null;
  occurrenceCount: number;
  lastOccurredAt: Date;
  resolvedAt: Date | null;
  ignoredUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  instance?: { name: string; node: { name: string } | null } | null;
}): ManagedIncident {
  return {
    id: row.id,
    instanceId: row.instanceId,
    instanceName: row.instance?.name ?? row.instanceId,
    nodeId: row.nodeId,
    nodeName: row.instance?.node?.name ?? null,
    fingerprint: row.fingerprint,
    trigger: row.trigger as IncidentTrigger,
    status: row.status as IncidentStatus,
    exitCode: row.exitCode,
    summary: row.summary,
    rootCause: row.rootCause,
    diagnosis: parseDiagnosis(row.proposedPatch),
    logTail: row.logTail,
    rollbackSet: parseRollbackSet(row.rollbackSet),
    taskId: row.taskId,
    assigneeUserId: row.assigneeUserId,
    occurrenceCount: row.occurrenceCount,
    lastOccurredAt: row.lastOccurredAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    ignoredUntil: row.ignoredUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function isTerminalIncidentStatus(status: IncidentStatus): boolean {
  return status === "resolved" || status === "rolled_back" || status === "failed" || status === "ignored";
}

export function isActiveIncidentStatus(status: IncidentStatus): boolean {
  return (
    status === "open" ||
    status === "diagnosing" ||
    status === "diagnosed" ||
    status === "awaiting_approval" ||
    status === "applying" ||
    status === "verifying" ||
    status === "rate_limited"
  );
}

export async function emitIncident(id: string): Promise<ManagedIncident | null> {
  const row = await prisma.incident.findUnique({ where: { id }, include: incidentInclude });
  if (!row) return null;
  const incident = toManagedIncident(row);
  publishIncident(incident);
  return incident;
}

export async function countOpenIncidents(instanceIds?: string[]): Promise<number> {
  return prisma.incident.count({
    where: {
      status: { in: activeIncidentStatuses },
      ...(instanceIds ? { instanceId: { in: instanceIds } } : {})
    }
  });
}

// 待处理状态优先（按最近发生时间倒序），已完结的按更新时间倒序；
// 不能按 status 字母序排（failed/ignored 会把 open 单挤出首页）。
export async function listIncidents(instanceIds?: string[], limit = 40): Promise<ManagedIncident[]> {
  const take = Math.max(1, Math.min(limit, 100));
  const scope = instanceIds ? { instanceId: { in: instanceIds } } : {};
  const active = await prisma.incident.findMany({
    where: { ...scope, status: { in: activeIncidentStatuses } },
    include: incidentInclude,
    orderBy: [{ lastOccurredAt: "desc" }],
    take
  });
  const remaining = take - active.length;
  const rest = remaining > 0
    ? await prisma.incident.findMany({
        where: { ...scope, status: { notIn: activeIncidentStatuses } },
        include: incidentInclude,
        orderBy: [{ updatedAt: "desc" }],
        take: remaining
      })
    : [];
  return [...active, ...rest].map(toManagedIncident);
}

export async function getIncident(id: string): Promise<ManagedIncident | null> {
  const row = await prisma.incident.findUnique({ where: { id }, include: incidentInclude });
  return row ? toManagedIncident(row) : null;
}

export async function findActiveIncident(instanceId: string, fingerprint: string): Promise<ManagedIncident | null> {
  const row = await prisma.incident.findFirst({
    where: {
      instanceId,
      fingerprint,
      status: { in: activeIncidentStatuses }
    },
    include: incidentInclude,
    orderBy: { updatedAt: "desc" }
  });
  return row ? toManagedIncident(row) : null;
}

export async function findActiveIncidentForInstance(instanceId: string): Promise<ManagedIncident | null> {
  const row = await prisma.incident.findFirst({
    where: {
      instanceId,
      status: { in: activeIncidentStatuses }
    },
    include: incidentInclude,
    orderBy: { updatedAt: "desc" }
  });
  return row ? toManagedIncident(row) : null;
}

// 进程内互斥锁：没有数据库唯一约束可用（不改 schema），用 per-(instanceId,fingerprint)
// 串行化降低同一崩溃并发重复建单的概率。
const openLocks = new Map<string, Promise<unknown>>();

export async function openOrRefreshIncident(input: {
  instanceId: string;
  nodeId: string;
  fingerprint: string;
  trigger: IncidentTrigger;
  exitCode?: number | null;
  logTail: string;
  assigneeUserId?: string | null;
  summary?: string;
}): Promise<{ incident: ManagedIncident; created: boolean }> {
  const key = `${input.instanceId}:${input.fingerprint}`;
  const previous = openLocks.get(key) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => openOrRefreshIncidentLocked(input));
  openLocks.set(key, task);
  try {
    return await task;
  } finally {
    if (openLocks.get(key) === task) openLocks.delete(key);
  }
}

async function openOrRefreshIncidentLocked(input: {
  instanceId: string;
  nodeId: string;
  fingerprint: string;
  trigger: IncidentTrigger;
  exitCode?: number | null;
  logTail: string;
  assigneeUserId?: string | null;
  summary?: string;
}): Promise<{ incident: ManagedIncident; created: boolean }> {
  const logTail = truncateLogTail(input.logTail);
  // 只有同实例且同 fingerprint 的活跃 incident 才合并（资源类指纹内含 metric，
  // 崩溃类指纹内含 exitCode 与归一化日志）；不同 trigger/fingerprint 新建 incident，
  // 避免资源类文案覆盖崩溃日志等吞证据问题。
  const existing = await findActiveIncident(input.instanceId, input.fingerprint);
  if (existing && isActiveIncidentStatus(existing.status)) {
    const row = await prisma.incident.update({
      where: { id: existing.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastOccurredAt: new Date(),
        // 合并时保留信息更全的那份日志（同 fingerprint 即同类型，取更长的）。
        logTail: logTail.length >= existing.logTail.length ? logTail : existing.logTail,
        ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
        ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {})
      },
      include: incidentInclude
    });
    const incident = toManagedIncident(row);
    publishIncident(incident);
    return { incident, created: false };
  }

  const ignored = await prisma.incident.findFirst({
    where: {
      instanceId: input.instanceId,
      fingerprint: input.fingerprint,
      status: "ignored",
      ignoredUntil: { gt: new Date() }
    },
    orderBy: { updatedAt: "desc" }
  });
  if (ignored) {
    return { incident: toManagedIncident({ ...ignored, instance: null }), created: false };
  }

  const row = await prisma.incident.create({
    data: {
      instanceId: input.instanceId,
      nodeId: input.nodeId,
      fingerprint: input.fingerprint,
      trigger: input.trigger,
      status: "open",
      exitCode: input.exitCode ?? null,
      summary: input.summary ?? null,
      logTail,
      assigneeUserId: input.assigneeUserId ?? null,
      lastOccurredAt: new Date()
    },
    include: incidentInclude
  });
  const incident = toManagedIncident(row);
  publishIncident(incident);
  return { incident, created: true };
}

export async function updateIncident(
  id: string,
  data: {
    status?: IncidentStatus;
    summary?: string | null;
    rootCause?: string | null;
    diagnosis?: WatchDiagnosis | null;
    taskId?: string | null;
    assigneeUserId?: string | null;
    resolvedAt?: Date | null;
    ignoredUntil?: Date | null;
  }
): Promise<ManagedIncident | null> {
  const row = await prisma.incident.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
      ...(data.rootCause !== undefined ? { rootCause: data.rootCause } : {}),
      ...(data.diagnosis !== undefined ? { proposedPatch: data.diagnosis ? JSON.stringify(data.diagnosis) : null } : {}),
      ...(data.taskId !== undefined ? { taskId: data.taskId } : {}),
      ...(data.assigneeUserId !== undefined ? { assigneeUserId: data.assigneeUserId } : {}),
      ...(data.resolvedAt !== undefined ? { resolvedAt: data.resolvedAt } : {}),
      ...(data.ignoredUntil !== undefined ? { ignoredUntil: data.ignoredUntil } : {})
    },
    include: incidentInclude
  });
  const incident = toManagedIncident(row);
  publishIncident(incident);
  return incident;
}

export async function attachIncidentCheckpoint(incidentId: string, checkpointId: string): Promise<void> {
  const row = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!row) return;
  const current = parseRollbackSet(row.rollbackSet);
  if (current.includes(checkpointId)) return;
  await prisma.incident.update({
    where: { id: incidentId },
    data: { rollbackSet: JSON.stringify([...current, checkpointId]) }
  });
}

export async function incidentRollbackSet(incidentId: string): Promise<string[]> {
  const row = await prisma.incident.findUnique({ where: { id: incidentId } });
  return parseRollbackSet(row?.rollbackSet);
}

export async function publishOpenCounts(): Promise<void> {
  publishIncidentCounts();
}

// 面板重启后恢复卡死的 incident：runningInstanceIds / active task 都是纯内存态，
// 重启后 diagnosing/applying/awaiting_approval/verifying 状态的单子会永久卡死
// （evaluateCrash 认为 watch 仍在运行，confirmWatchDiagnosis 也不接受这些状态）。
// 这里在启动时把它们重置为可恢复状态，并清掉残留的 restart lease（内存态本就是空的，防御性清理）。
export async function recoverStuckWatchIncidents(): Promise<void> {
  const stuck = await prisma.incident.findMany({
    where: { status: { in: ["diagnosing", "applying", "awaiting_approval", "verifying"] } },
    select: { id: true, instanceId: true, status: true, summary: true }
  });
  for (const row of stuck) {
    clearRestartLease(row.instanceId);
    if (row.status === "verifying") {
      // 验证过程无法安全续跑（日志游标、时序上下文都已丢失），直接判 failed 让人工接手。
      await updateIncident(row.id, {
        status: "failed",
        taskId: null,
        resolvedAt: new Date(),
        summary: `${row.summary ?? ""}（面板重启导致验证中断，无法确认修复结果，请人工检查实例。）`.trim()
      });
    } else {
      // pending action / active task 都是内存态，重启后已不存在，退回 open 允许重新确认诊断。
      await updateIncident(row.id, {
        status: "open",
        taskId: null,
        summary: `${row.summary ?? ""}（面板重启导致上次处理中断，已退回待确认状态，可重新发起诊断。）`.trim()
      });
    }
  }
}

