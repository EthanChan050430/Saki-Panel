import type { IncidentTrigger, ManagedIncident, ManagedWatchPolicy } from "@webops/shared";
import { prisma } from "../db.js";
import { crashFingerprint, findActiveIncidentForInstance, openOrRefreshIncident } from "./incidents.js";
import { readWatchPolicy } from "./policy.js";
import { restartLeaseUntil } from "./leases.js";

const crashWindowMs = 10 * 60 * 1000;
const crashLoopThreshold = 3;
const crashTimes = new Map<string, number[]>();
const watchRunTimes = new Map<string, number[]>();
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

export function recordWatchRun(instanceId: string): number {
  const next = pruneTimestamps(watchRunTimes.get(instanceId) ?? [], 60 * 60 * 1000);
  next.push(Date.now());
  watchRunTimes.set(instanceId, next);
  return next.length;
}

export function watchRunsInLastHour(instanceId: string): number {
  const next = pruneTimestamps(watchRunTimes.get(instanceId) ?? [], 60 * 60 * 1000);
  watchRunTimes.set(instanceId, next);
  return next.length;
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
  const crashCount = recordCrashSample(input.instanceId);
  const loop = crashCount >= crashLoopThreshold;
  const trigger: IncidentTrigger = loop ? "crash_loop" : "crash";

  if (!policy.enabled || policy.mode === "off") {
    return {
      shouldOpen: false,
      shouldRun: false,
      trigger,
      fingerprint,
      reason: "watch disabled",
      policy,
      suppressRestartUntil: restartLeaseUntil(input.instanceId)
    };
  }

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
  let disk = input.diskUsage >= 90 ? previous.disk + 1 : 0;
  let memory = input.memoryUsage >= 95 ? previous.memory + 1 : 0;
  const diskFired = disk >= 2;
  const memoryFired = memory >= 2;
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
}): Promise<ManagedIncident> {
  const { incident } = await openOrRefreshIncident(input);
  return incident;
}
