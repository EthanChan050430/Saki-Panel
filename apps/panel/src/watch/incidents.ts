import { createHash } from "node:crypto";
import type {
  IncidentStatus,
  IncidentTrigger,
  ManagedIncident,
  WatchDiagnosis
} from "@webops/shared";
import { prisma } from "../db.js";
import { publishIncident, publishIncidentCounts } from "./notify.js";

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

async function emitIncident(id: string): Promise<ManagedIncident | null> {
  const row = await prisma.incident.findUnique({ where: { id }, include: incidentInclude });
  if (!row) return null;
  const incident = toManagedIncident(row);
  const openCount = await countOpenIncidents();
  publishIncident(incident, openCount);
  return incident;
}

export async function countOpenIncidents(instanceIds?: string[]): Promise<number> {
  return prisma.incident.count({
    where: {
      status: { in: ["open", "diagnosing", "diagnosed", "awaiting_approval", "applying", "verifying", "rate_limited"] },
      ...(instanceIds ? { instanceId: { in: instanceIds } } : {})
    }
  });
}

export async function listIncidents(instanceIds?: string[], limit = 40): Promise<ManagedIncident[]> {
  const rows = await prisma.incident.findMany({
    ...(instanceIds ? { where: { instanceId: { in: instanceIds } } } : {}),
    include: incidentInclude,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: Math.max(1, Math.min(limit, 100))
  });
  return rows.map(toManagedIncident);
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
      status: { in: ["open", "diagnosing", "diagnosed", "awaiting_approval", "applying", "verifying", "rate_limited"] }
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
      status: { in: ["open", "diagnosing", "diagnosed", "awaiting_approval", "applying", "verifying", "rate_limited"] }
    },
    include: incidentInclude,
    orderBy: { updatedAt: "desc" }
  });
  return row ? toManagedIncident(row) : null;
}

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
  const existing =
    (await findActiveIncident(input.instanceId, input.fingerprint)) ??
    (await findActiveIncidentForInstance(input.instanceId));
  if (existing && isActiveIncidentStatus(existing.status)) {
    const row = await prisma.incident.update({
      where: { id: existing.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastOccurredAt: new Date(),
        logTail: input.logTail || existing.logTail,
        ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
        ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {})
      },
      include: incidentInclude
    });
    const incident = toManagedIncident(row);
    publishIncident(incident, await countOpenIncidents());
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
      logTail: input.logTail,
      assigneeUserId: input.assigneeUserId ?? null,
      lastOccurredAt: new Date()
    },
    include: incidentInclude
  });
  const incident = toManagedIncident(row);
  publishIncident(incident, await countOpenIncidents());
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
  publishIncident(incident, await countOpenIncidents());
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
  publishIncidentCounts(await countOpenIncidents());
}


