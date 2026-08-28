import type { DaemonEventResponse, DaemonInstanceSnapshot, DaemonInstanceStatusEvent, IncidentTrigger } from "@webops/shared";
import { prisma } from "../db.js";
import { instanceAccessInclude } from "../instance-access.js";
import { evaluateCrash, evaluateResource, materializeIncident } from "./detector.js";
import { listActiveRestartLeases } from "./leases.js";
import { readWatchPolicy } from "./policy.js";
import { findActiveIncident, updateIncident } from "./incidents.js";

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
  if (typeof logTail === "string") return logTail;
  return logTail.map((line) => `[${line.stream}] ${line.text}`).join("\n");
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

  const incident = await materializeIncident({
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

  if (decision.reason === "rate limited") {
    await updateIncident(incident.id, {
      status: "rate_limited",
      summary: "实例反复崩溃，本小时诊断次数已达上限。不会再自动消耗额度。"
    });
  }

  return { ok: true, suppressRestartUntil: decision.suppressRestartUntil };
}

export async function ingestHeartbeatSnapshots(
  nodeId: string,
  snapshots: DaemonInstanceSnapshot[] | undefined,
  metrics?: { diskUsage: number; memoryUsage: number }
): Promise<Array<{ instanceId: string; suppressUntil: string }>> {
  for (const snapshot of snapshots ?? []) {
    await syncInstanceStatus(snapshot.instanceId, snapshot.status, snapshot.exitCode ?? null);
  }

  if (metrics) {
    const resource = await evaluateResource({ nodeId, diskUsage: metrics.diskUsage, memoryUsage: metrics.memoryUsage });
    if (resource.disk || resource.memory) {
      const nodeInstances = await prisma.instance.findMany({
        where: { nodeId },
        orderBy: { updatedAt: "desc" }
      });
      const instance = nodeInstances.length === 1 ? nodeInstances[0] : null;
      if (instance) {
        const policy = await readWatchPolicy(instance.id);
        if (policy.enabled && policy.mode !== "off") {
          const trigger: IncidentTrigger = resource.disk ? "disk" : "memory";
          const fingerprint = `${instance.id}:${trigger}`;
          const existing = await findActiveIncident(instance.id, fingerprint);
          if (!existing) {
            await materializeIncident({
              instanceId: instance.id,
              nodeId,
              fingerprint,
              trigger,
              logTail: resource.disk
                ? `Node disk usage is ${metrics.diskUsage.toFixed(1)}%.`
                : `Node memory usage is ${metrics.memoryUsage.toFixed(1)}%.`,
              summary: resource.disk
                ? "节点磁盘占用超过 90%。确认后 Saki 才会开始诊断（会消耗模型额度）。"
                : "节点内存占用超过 95%。确认后 Saki 才会开始诊断（会消耗模型额度）。"
            });
          }
        }
      }
    }
  }

  const nodeInstanceIds = new Set(
    (await prisma.instance.findMany({ where: { nodeId }, select: { id: true } })).map((row) => row.id)
  );
  return listActiveRestartLeases().filter((lease) => nodeInstanceIds.has(lease.instanceId));
}
