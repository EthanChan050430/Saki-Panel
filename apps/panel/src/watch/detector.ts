import type { IncidentTrigger, ManagedIncident, ManagedWatchPolicy } from "@webops/shared";
import { prisma } from "../db.js";
import { crashFingerprint, findActiveIncidentForInstance, openOrRefreshIncident } from "./incidents.js";
import { readWatchPolicy } from "./policy.js";
import { restartLeaseUntil, restartLeaseInstanceIds, retainRestartLeases } from "./leases.js";

// 以下阈值目前是硬编码常量；未来如需按实例配置，可迁移进 watch policy
// （需要同步扩展 prisma schema，本次不做数据库迁移）。
const crashWindowMs = 10 * 60 * 1000; // 崩溃循环判定窗口：10 分钟
const crashLoopThreshold = 3; // 窗口内崩溃次数达到该值判定为崩溃循环
const watchBudgetWindowMs = 60 * 60 * 1000; // maxRunsPerHour 的统计窗口：1 小时
const diskUsageThresholdPercent = 90; // 节点磁盘占用告警阈值
const memoryUsageThresholdPercent = 95; // 节点内存占用告警阈值
const resourceStreakThreshold = 2; // 连续 N 次心跳超阈值才开单
export const heartbeatCrashDedupMs = 2 * 60 * 1000; // 心跳补偿通道与事件通道的去重窗口

const crashTimes = new Map<string, number[]>();
const watchRunTimes = new Map<string, number[]>();
const lastWatchRunAt = new Map<string, number>();
const resourceStreaks = new Map<string, { disk: number; memory: number }>();

function pruneTimestamps(values: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return values.filter((value) => value >= cutoff);
}

export function recordCrashSample(instanceId: string): number {
  const next = pruneTimestamps(crashTimes.get(instanceId) ?? [], crashWindowMs);
  next.push(Date.now());
  crashTimes.set(instanceId, next);
  return next.length;
}

export function recentCrashSampleCount(instanceId: string, withinMs: number): number {
  // 存储仍按崩溃循环窗口 prune，只在统计时套用更短的去重窗口。
  const kept = pruneTimestamps(crashTimes.get(instanceId) ?? [], crashWindowMs);
  crashTimes.set(instanceId, kept);
  const cutoff = Date.now() - withinMs;
  return kept.filter((value) => value >= cutoff).length;
}

export function recordWatchRun(instanceId: string): number {
  const next = pruneTimestamps(watchRunTimes.get(instanceId) ?? [], watchBudgetWindowMs);
  next.push(Date.now());
  watchRunTimes.set(instanceId, next);
  lastWatchRunAt.set(instanceId, Date.now());
  return next.length;
}

export function watchRunsInLastHour(instanceId: string): number {
  const next = pruneTimestamps(watchRunTimes.get(instanceId) ?? [], watchBudgetWindowMs);
  watchRunTimes.set(instanceId, next);
  return next.length;
}

// 注意：冷却时间基于进程内记录，面板重启后冷却重新开始计时。
export function watchCooldownRemainingSeconds(instanceId: string, cooldownSeconds: number): number {
  const last = lastWatchRunAt.get(instanceId);
  if (!last) return 0;
  const remaining = cooldownSeconds - (Date.now() - last) / 1000;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

// 周期性清理内存 Map：丢弃已过期的采样、以及已删除实例/节点对应的 key，
// 避免长时间运行后无界增长。
const maintenanceIntervalMs = 10 * 60 * 1000;
let maintenanceStarted = false;

export function startWatchMaintenance(): void {
  if (maintenanceStarted) return;
  maintenanceStarted = true;
  const sweep = async () => {
    try {
      const instanceIds = new Set<string>([
        ...crashTimes.keys(),
        ...watchRunTimes.keys(),
        ...lastWatchRunAt.keys(),
        ...restartLeaseInstanceIds()
      ]);
      const nodeIds = new Set<string>(resourceStreaks.keys());
      if (instanceIds.size === 0 && nodeIds.size === 0) return;

      const existingInstances = instanceIds.size
        ? await prisma.instance.findMany({ where: { id: { in: [...instanceIds] } }, select: { id: true } })
        : [];
      const validInstanceIds = new Set(existingInstances.map((row) => row.id));
      for (const id of instanceIds) {
        if (!validInstanceIds.has(id)) {
          crashTimes.delete(id);
          watchRunTimes.delete(id);
          lastWatchRunAt.delete(id);
          continue;
        }
        const crashes = pruneTimestamps(crashTimes.get(id) ?? [], crashWindowMs);
        if (crashes.length) crashTimes.set(id, crashes);
        else crashTimes.delete(id);
        const runs = pruneTimestamps(watchRunTimes.get(id) ?? [], watchBudgetWindowMs);
        if (runs.length) watchRunTimes.set(id, runs);
        else watchRunTimes.delete(id);
      }
      retainRestartLeases(validInstanceIds);

      if (nodeIds.size) {
        const existingNodes = await prisma.node.findMany({ where: { id: { in: [...nodeIds] } }, select: { id: true } });
        const validNodeIds = new Set(existingNodes.map((row) => row.id));
        for (const id of nodeIds) {
          if (!validNodeIds.has(id)) resourceStreaks.delete(id);
        }
      }
    } catch (error) {
      console.warn("watch maintenance sweep failed:", error instanceof Error ? error.message : error);
    }
  };
  const timer = setInterval(() => void sweep(), maintenanceIntervalMs);
  timer.unref?.();
}

export interface WatchDecision {
  shouldOpen: boolean;
  shouldRun: boolean;
  trigger: IncidentTrigger;
  fingerprint: string;
  reason: string;
  policy: ManagedWatchPolicy;
  suppressRestartUntil: string | null;
}

export async function evaluateCrash(input: {
  instanceId: string;
  nodeId: string;
  exitCode?: number | null;
  logTail: string;
  willRetry: boolean;
}): Promise<WatchDecision> {
  const policy = await readWatchPolicy(input.instanceId);
  const fingerprint = crashFingerprint(input.instanceId, input.exitCode ?? null, input.logTail);

  // watch 关闭的实例不记录崩溃采样，避免内存 Map 积累无用数据。
  if (!policy.enabled || policy.mode === "off") {
    return {
      shouldOpen: false,
      shouldRun: false,
      trigger: "crash",
      fingerprint,
      reason: "watch disabled",
      policy,
      suppressRestartUntil: restartLeaseUntil(input.instanceId)
    };
  }

  const crashCount = recordCrashSample(input.instanceId);
  const loop = crashCount >= crashLoopThreshold;
  const trigger: IncidentTrigger = loop ? "crash_loop" : "crash";

  const ignored = await prisma.incident.findFirst({
    where: {
      instanceId: input.instanceId,
      fingerprint,
      status: "ignored",
      ignoredUntil: { gt: new Date() }
    },
    select: { id: true }
  });
  if (ignored) {
    return {
      shouldOpen: false,
      shouldRun: false,
      trigger,
      fingerprint,
      reason: "ignored",
      policy,
      suppressRestartUntil: null
    };
  }

  if (input.willRetry && !loop) {
    return {
      shouldOpen: false,
      shouldRun: false,
      trigger,
      fingerprint,
      reason: "restart policy still retrying",
      policy,
      suppressRestartUntil: null
    };
  }

  const active = await findActiveIncidentForInstance(input.instanceId);
  if (active && (active.status === "diagnosing" || active.status === "applying" || active.status === "verifying" || active.status === "awaiting_approval")) {
    return {
      shouldOpen: false,
      shouldRun: false,
      trigger,
      fingerprint,
      reason: "watch already running",
      policy,
      suppressRestartUntil: restartLeaseUntil(input.instanceId)
    };
  }

  const overBudget = watchRunsInLastHour(input.instanceId) >= policy.maxRunsPerHour;
  return {
    shouldOpen: true,
    shouldRun: false,
    trigger,
    fingerprint,
    reason: overBudget ? "rate limited" : "waiting for user confirmation",
    policy,
    suppressRestartUntil: null
  };
}

export async function evaluateResource(input: {
  nodeId: string;
  diskUsage: number;
  memoryUsage: number;
}): Promise<{ disk: boolean; memory: boolean }> {
  const previous = resourceStreaks.get(input.nodeId) ?? { disk: 0, memory: 0 };
  let disk = input.diskUsage >= diskUsageThresholdPercent ? previous.disk + 1 : 0;
  let memory = input.memoryUsage >= memoryUsageThresholdPercent ? previous.memory + 1 : 0;
  const diskFired = disk >= resourceStreakThreshold;
  const memoryFired = memory >= resourceStreakThreshold;
  if (diskFired) disk = 0;
  if (memoryFired) memory = 0;
  resourceStreaks.set(input.nodeId, { disk, memory });
  return { disk: diskFired, memory: memoryFired };
}

export async function materializeIncident(input: {
  instanceId: string;
  nodeId: string;
  fingerprint: string;
  trigger: IncidentTrigger;
  exitCode?: number | null;
  logTail: string;
  assigneeUserId?: string | null;
  summary?: string;
  rateLimited?: boolean;
}): Promise<{ incident: ManagedIncident; created: boolean }> {
  return openOrRefreshIncident(input);
}
