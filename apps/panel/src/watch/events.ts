import type { DaemonEventResponse, DaemonInstanceSnapshot, DaemonInstanceStatusEvent } from "@webops/shared";
import { prisma } from "../db.js";
import { instanceAccessInclude } from "../instance-access.js";
import {
  diskUsageThresholdPercent,
  evaluateCrash,
  evaluateResource,
  heartbeatCrashDedupMs,
  materializeIncident,
  memoryUsageThresholdPercent,
  recentCrashSampleCount,
  resourceFingerprint
} from "./detector.js";
import { listActiveRestartLeases } from "./leases.js";
import { readWatchPolicy, toManagedWatchPolicy } from "./policy.js";
import { truncateLogTail, updateIncident } from "./incidents.js";

function statusPatch(status: string, exitCode?: number | null) {
  const now = new Date();
  return {
    status: status as "CREATED" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "CRASHED" | "UNKNOWN",
    lastExitCode: exitCode ?? null,
    ...(status === "RUNNING" || status === "STARTING" ? { lastStartedAt: now } : {}),
    ...(status === "STOPPED" || status === "CRASHED" ? { lastStoppedAt: now } : {})
  };
}

async function syncInstanceStatus(instanceId: string, status: string, exitCode?: number | null): Promise<void> {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId }, select: { id: true, status: true, lastExitCode: true } });
  if (!instance) return;
  if (instance.status === status && (instance.lastExitCode ?? null) === (exitCode ?? null)) return;
  await prisma.instance.update({
    where: { id: instanceId },
    data: statusPatch(status, exitCode)
  });
}

function logTailText(logTail: Array<{ stream: string; text: string }> | string | undefined): string {
  if (!logTail) return "";
  const text = typeof logTail === "string" ? logTail : logTail.map((line) => `[${line.stream}] ${line.text}`).join("\n");
  return truncateLogTail(text);
}

export async function handleDaemonInstanceEvent(event: DaemonInstanceStatusEvent): Promise<DaemonEventResponse> {
  if (event.status !== "CRASHED" && event.status !== "STOPPED") {
    await syncInstanceStatus(event.instanceId, event.status, event.exitCode ?? null);
    return { ok: true, suppressRestartUntil: null };
  }

  await syncInstanceStatus(event.instanceId, event.status, event.exitCode ?? null);
  if (event.status !== "CRASHED") {
    return { ok: true, suppressRestartUntil: null };
  }

  const instance = await prisma.instance.findUnique({
    where: { id: event.instanceId },
    include: instanceAccessInclude
  });
  if (!instance) return { ok: true, suppressRestartUntil: null };

  const logTail = logTailText(event.logTail);
  const decision = await evaluateCrash({
    instanceId: instance.id,
    nodeId: instance.nodeId,
    exitCode: event.exitCode ?? null,
    logTail,
    willRetry: Boolean(event.restart?.willRetry)
  });

  if (!decision.shouldOpen) {
    return { ok: true, suppressRestartUntil: decision.suppressRestartUntil };
  }

  const { incident, created } = await materializeIncident({
    instanceId: instance.id,
    nodeId: instance.nodeId,
    fingerprint: decision.fingerprint,
    trigger: decision.trigger,
    exitCode: event.exitCode ?? null,
    logTail,
    assigneeUserId: decision.policy.approverUserId ?? instance.assignedToId ?? instance.createdById,
    summary:
      decision.reason === "rate limited"
        ? "实例反复崩溃，本小时诊断次数已达上限。"
        : decision.trigger === "crash_loop"
          ? "检测到崩溃循环。确认后 Saki 才会开始诊断（会消耗模型额度）。"
          : "实例已崩溃。确认后 Saki 才会开始诊断（会消耗模型额度）。"
  });

  // 超预算时只在状态需要变化时写库（occurrenceCount 已在 materialize 里准确累加），
  // 避免崩溃风暴反复刷 updatedAt 与 SSE。
  if (decision.reason === "rate limited" && (created || incident.status !== "rate_limited")) {
    await updateIncident(incident.id, {
      status: "rate_limited",
      summary: "实例反复崩溃，本小时诊断次数已达上限。不会再自动消耗额度。"
    });
  }

  return { ok: true, suppressRestartUntil: decision.suppressRestartUntil };
}

// 心跳补偿通道：崩溃事件可能因网络等原因丢失，这里在快照中发现 CRASHED 时补走 evaluateCrash。
// 通过近期崩溃采样去重：事件通道上报过的崩溃不会在这里重复开单。
async function evaluateHeartbeatCrash(snapshot: DaemonInstanceSnapshot, nodeId: string): Promise<void> {
  if (snapshot.status !== "CRASHED") return;
  const instance = await prisma.instance.findUnique({
    where: { id: snapshot.instanceId },
    include: instanceAccessInclude
  });
  if (!instance) return;
  const policy = await readWatchPolicy(instance.id);
  if (!policy.enabled || policy.mode === "off") return;
  if (recentCrashSampleCount(instance.id, heartbeatCrashDedupMs) > 0) return;

  const decision = await evaluateCrash({
    instanceId: instance.id,
    nodeId,
    exitCode: snapshot.exitCode ?? null,
    logTail: "",
    willRetry: false
  });
  if (!decision.shouldOpen) return;

  const { incident, created } = await materializeIncident({
    instanceId: instance.id,
    nodeId,
    fingerprint: decision.fingerprint,
    trigger: decision.trigger,
    exitCode: snapshot.exitCode ?? null,
    logTail: "",
    assigneeUserId: policy.approverUserId ?? instance.assignedToId ?? instance.createdById,
    summary:
      decision.reason === "rate limited"
        ? "实例反复崩溃，本小时诊断次数已达上限。"
        : "心跳发现实例处于崩溃状态（崩溃事件可能丢失）。确认后 Saki 才会开始诊断（会消耗模型额度）。"
  });
  if (decision.reason === "rate limited" && (created || incident.status !== "rate_limited")) {
    await updateIncident(incident.id, {
      status: "rate_limited",
      summary: "实例反复崩溃，本小时诊断次数已达上限。不会再自动消耗额度。"
    });
  }
}

// 节点级指标，单节点单触发类型绑定单个活跃实例
async function openNodeResourceIncident(input: {
  nodeId: string;
  trigger: "disk" | "memory";
  usage: number;
  threshold: number;
}): Promise<void> {
  const nodeInstances = await prisma.instance.findMany({
    where: { nodeId: input.nodeId },
    include: { watchPolicy: true },
    orderBy: { id: "asc" }
  });
  const watched = nodeInstances.filter((instance) => {
    const policy = toManagedWatchPolicy(instance.id, instance.watchPolicy);
    return policy.enabled && policy.mode !== "off";
  });
  if (!watched.length) return;

  const running = watched.filter((instance) => instance.status === "RUNNING" || instance.status === "STARTING");
  const anchor = running[0] ?? watched[0];
  if (!anchor) return;

  const policy = toManagedWatchPolicy(anchor.id, anchor.watchPolicy);
  const metricLabel = input.trigger === "disk" ? "磁盘" : "内存";
  await materializeIncident({
    instanceId: anchor.id,
    nodeId: input.nodeId,
    fingerprint: resourceFingerprint(input.nodeId, input.trigger),
    trigger: input.trigger,
    logTail: `节点${metricLabel}占用 ${input.usage.toFixed(1)}%。`,
    assigneeUserId: policy.approverUserId ?? anchor.assignedToId ?? anchor.createdById,
    summary: `节点${metricLabel}占用超过 ${input.threshold}%。这是节点级告警，同一节点只开一单。确认后 Saki 才会开始诊断（会消耗模型额度）。`
  });
}

export async function ingestHeartbeatSnapshots(
  nodeId: string,
  snapshots: DaemonInstanceSnapshot[] | undefined,
  metrics?: { diskUsage: number; memoryUsage: number }
): Promise<Array<{ instanceId: string; suppressUntil: string }>> {
  for (const snapshot of snapshots ?? []) {
    await syncInstanceStatus(snapshot.instanceId, snapshot.status, snapshot.exitCode ?? null);
    await evaluateHeartbeatCrash(snapshot, nodeId).catch((error) => {
      console.warn("heartbeat crash evaluation failed:", error instanceof Error ? error.message : error);
    });
  }

  if (metrics) {
    const resource = await evaluateResource({ nodeId, diskUsage: metrics.diskUsage, memoryUsage: metrics.memoryUsage });
    if (resource.disk) {
      await openNodeResourceIncident({
        nodeId,
        trigger: "disk",
        usage: metrics.diskUsage,
        threshold: diskUsageThresholdPercent
      });
    }
    if (resource.memory) {
      await openNodeResourceIncident({
        nodeId,
        trigger: "memory",
        usage: metrics.memoryUsage,
        threshold: memoryUsageThresholdPercent
      });
    }
  }

  const nodeInstanceIds = new Set(
    (await prisma.instance.findMany({ where: { nodeId }, select: { id: true } })).map((row) => row.id)
  );
  return listActiveRestartLeases().filter((lease) => nodeInstanceIds.has(lease.instanceId));
}
