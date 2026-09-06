import type { IncidentReport, IncidentTrigger } from "@webops/shared";
import { prisma } from "../db.js";
import { countOpenIncidents } from "./incidents.js";

function parseRollbackSet(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// 可靠性报告：窗口内创建的 incident 为基础集合；activeNow 是当前活跃快照（不限窗口）。
export async function buildIncidentReport(days: number): Promise<IncidentReport> {
  const windowDays = Math.max(1, Math.min(Number.isFinite(days) ? Math.floor(days) : 7, 90));
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.incident.findMany({
    where: { createdAt: { gte: since } },
    include: { instance: { select: { name: true } } }
  });

  const resolvedRows = rows.filter((row) => row.resolvedAt !== null);
  const failedRows = rows.filter((row) => row.status === "failed" || row.status === "rolled_back");
  const ignoredRows = rows.filter((row) => row.status === "ignored");

  const mttrValues = resolvedRows.map((row) => (row.resolvedAt!.getTime() - row.createdAt.getTime()) / 60000);
  const mttrMinutes = mttrValues.length ? round1(mttrValues.reduce((sum, value) => sum + value, 0) / mttrValues.length) : null;

  const autoFixAttempted = rows.filter((row) => parseRollbackSet(row.rollbackSet).length > 0);
  const autoFixSucceeded = autoFixAttempted.filter((row) => row.status === "resolved");

  const recurringRows = rows.filter((row) => row.recurrenceCount > 0);

  // 复发 TOP：按 (instanceId, fingerprint) 分组，累计 occurrenceCount。
  const groupMap = new Map<
    string,
    { fingerprint: string; instanceId: string; instanceName: string; trigger: IncidentTrigger; count: number; lastOccurredAt: Date }
  >();
  for (const row of rows) {
    const key = `${row.instanceId}:${row.fingerprint}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.count += row.occurrenceCount;
      if (row.lastOccurredAt > existing.lastOccurredAt) existing.lastOccurredAt = row.lastOccurredAt;
    } else {
      groupMap.set(key, {
        fingerprint: row.fingerprint,
        instanceId: row.instanceId,
        instanceName: row.instance?.name ?? row.instanceId,
        trigger: row.trigger as IncidentTrigger,
        count: row.occurrenceCount,
        lastOccurredAt: row.lastOccurredAt
      });
    }
  }
  const topRecurring = [...groupMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((group) => ({ ...group, lastOccurredAt: group.lastOccurredAt.toISOString() }));

  // 分实例统计。
  const perInstanceMap = new Map<
    string,
    { instanceId: string; instanceName: string; total: number; resolved: number; failed: number; mttrValues: number[] }
  >();
  for (const row of rows) {
    const existing =
      perInstanceMap.get(row.instanceId) ??
      { instanceId: row.instanceId, instanceName: row.instance?.name ?? row.instanceId, total: 0, resolved: 0, failed: 0, mttrValues: [] };
    existing.total += 1;
    if (row.resolvedAt !== null) {
      existing.resolved += 1;
      existing.mttrValues.push((row.resolvedAt.getTime() - row.createdAt.getTime()) / 60000);
    }
    if (row.status === "failed" || row.status === "rolled_back") existing.failed += 1;
    perInstanceMap.set(row.instanceId, existing);
  }
  const perInstance = [...perInstanceMap.values()]
    .map((entry) => ({
      instanceId: entry.instanceId,
      instanceName: entry.instanceName,
      total: entry.total,
      resolved: entry.resolved,
      failed: entry.failed,
      mttrMinutes: entry.mttrValues.length
        ? round1(entry.mttrValues.reduce((sum, value) => sum + value, 0) / entry.mttrValues.length)
        : null
    }))
    .sort((a, b) => b.total - a.total);

  // 按天聚合（窗口内每一天都出现，缺失补 0）。
  const dailyMap = new Map<string, { date: string; opened: number; resolved: number }>();
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const key = dayKey(new Date(Date.now() - offset * 24 * 60 * 60 * 1000));
    dailyMap.set(key, { date: key, opened: 0, resolved: 0 });
  }
  for (const row of rows) {
    const openedKey = dayKey(row.createdAt);
    const openedEntry = dailyMap.get(openedKey);
    if (openedEntry) openedEntry.opened += 1;
    if (row.resolvedAt) {
      const resolvedKey = dayKey(row.resolvedAt);
      const resolvedEntry = dailyMap.get(resolvedKey);
      if (resolvedEntry) resolvedEntry.resolved += 1;
    }
  }

  return {
    days: windowDays,
    generatedAt: new Date().toISOString(),
    totals: {
      opened: rows.length,
      resolved: resolvedRows.length,
      failed: failedRows.length,
      ignored: ignoredRows.length,
      activeNow: await countOpenIncidents()
    },
    mttrMinutes,
    autoFix: {
      attempted: autoFixAttempted.length,
      succeeded: autoFixSucceeded.length,
      successRate: autoFixAttempted.length ? round1(autoFixSucceeded.length / autoFixAttempted.length) : null
    },
    recurrenceRate: rows.length ? round1(recurringRows.length / rows.length) : null,
    topRecurring,
    perInstance,
    daily: [...dailyMap.values()]
  };
}
