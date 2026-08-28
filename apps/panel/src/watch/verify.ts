import type { RestartPolicy } from "@webops/shared";
import { prisma } from "../db.js";
import { instanceAccessInclude } from "../instance-access.js";
import { readDaemonInstanceLogs, readDaemonInstanceStatus, startDaemonInstance } from "../daemon-client.js";
import { rollbackCheckpoint } from "../routes/saki/executor.js";
import { sakiCheckpoints } from "../routes/saki/state.js";
import { crashFingerprint, getIncident, incidentRollbackSet, updateIncident } from "./incidents.js";
import { clearRestartLease, suppressRestart } from "./leases.js";
import { readWatchPolicy } from "./policy.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function specFromRow(instance: {
  id: string;
  name: string;
  type: string;
  workingDirectory: string;
  startCommand: string;
  stopCommand: string | null;
  restartPolicy: string;
  restartMaxRetries: number;
}) {
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

export async function rollbackIncidentChanges(incidentId: string, userId: string): Promise<string[]> {
  const checkpointIds = await incidentRollbackSet(incidentId);
  const notes: string[] = [];
  for (const checkpointId of [...checkpointIds].reverse()) {
    const checkpoint = sakiCheckpoints.get(checkpointId);
    if (!checkpoint) {
      notes.push(`checkpoint ${checkpointId} missing`);
      continue;
    }
    try {
      notes.push(await rollbackCheckpoint(userId, checkpoint));
    } catch (error) {
      notes.push(error instanceof Error ? error.message : `failed to roll back ${checkpointId}`);
    }
  }
  return notes;
}

export async function verifyIncident(incidentId: string): Promise<void> {
  const incident = await getIncident(incidentId);
  if (!incident) return;
  if (incident.status === "verifying") return;

  const instance = await prisma.instance.findUnique({
    where: { id: incident.instanceId },
    include: instanceAccessInclude
  });
  if (!instance) {
    await updateIncident(incidentId, { status: "failed", summary: incident.summary ?? "实例已不存在，无法验证修复。" });
    clearRestartLease(incident.instanceId);
    return;
  }

  const policy = await readWatchPolicy(instance.id);
  const userId = incident.assigneeUserId ?? instance.createdById ?? "";
  const checkpoints = await incidentRollbackSet(incidentId);
  const shouldStart = checkpoints.length > 0;

  await updateIncident(incidentId, { status: "verifying" });
  suppressRestart(instance.id, Math.max(policy.verifyWaitSeconds + 15, 30) * 1000);

  if (shouldStart) {
    try {
      const state = await startDaemonInstance(instance.node, specFromRow(instance));
      await prisma.instance.update({
        where: { id: instance.id },
        data: {
          status: state.status,
          lastExitCode: state.exitCode ?? null,
          ...(state.status === "RUNNING" || state.status === "STARTING" ? { lastStartedAt: new Date() } : {})
        }
      });
    } catch (error) {
      const notes = userId ? await rollbackIncidentChanges(incidentId, userId) : [];
      await updateIncident(incidentId, {
        status: "rolled_back",
        summary: `修复已写入，但重新启动失败：${error instanceof Error ? error.message : "unknown error"}。已尝试回滚。`,
        resolvedAt: new Date()
      });
      clearRestartLease(instance.id);
      void notes;
      return;
    }
  }

  await sleep(Math.max(5, policy.verifyWaitSeconds) * 1000);

  try {
    const state = await readDaemonInstanceStatus(instance.node, instance.id, 4000);
    const logs = await readDaemonInstanceLogs(instance.node, instance.id, 80);
    const logText = logs.lines.map((line) => `[${line.stream}] ${line.text}`).join("\n");
    const nextFingerprint = crashFingerprint(instance.id, state.exitCode ?? null, logText);
    await prisma.instance.update({
      where: { id: instance.id },
      data: {
        status: state.status,
        lastExitCode: state.exitCode ?? null,
        ...(state.status === "STOPPED" || state.status === "CRASHED" ? { lastStoppedAt: new Date() } : {})
      }
    });

    const crashedAgain = state.status === "CRASHED" || state.status === "STOPPED";
    const sameFingerprint = nextFingerprint === incident.fingerprint;
    const fatalBurst = /(?:fatal|panic|cannot bind|address already in use|permission denied)/i.test(logText);

    if (crashedAgain && (sameFingerprint || fatalBurst) && checkpoints.length > 0 && userId) {
      await rollbackIncidentChanges(incidentId, userId);
      await updateIncident(incidentId, {
        status: "rolled_back",
        summary: incident.diagnosis?.summary
          ? `${incident.diagnosis.summary}。验证失败，已回滚这次修改。`
          : "验证失败，已回滚这次修改。实例仍未恢复。",
        resolvedAt: new Date()
      });
      clearRestartLease(instance.id);
      return;
    }

    if (state.status === "RUNNING" && !fatalBurst) {
      await updateIncident(incidentId, {
        status: "resolved",
        summary: incident.diagnosis?.summary ?? incident.summary ?? "Saki 已完成诊断，实例正在运行。",
        resolvedAt: new Date()
      });
      clearRestartLease(instance.id);
      return;
    }

    await updateIncident(incidentId, {
      status: checkpoints.length ? "failed" : "diagnosed",
      summary: incident.diagnosis?.summary ?? incident.summary ?? "验证未通过，请人工接手。",
      resolvedAt: checkpoints.length ? new Date() : null
    });
    clearRestartLease(instance.id);
  } catch (error) {
    await updateIncident(incidentId, {
      status: "failed",
      summary: `验证阶段失败：${error instanceof Error ? error.message : "unknown error"}`
    });
    clearRestartLease(instance.id);
  }
}
