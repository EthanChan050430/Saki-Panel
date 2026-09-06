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

// 修复后健康检查：2xx/3xx 视为通过，其余状态码、超时或网络错误都算未通过。永不抛出。
async function runInstanceHealthCheck(url: string, timeoutSeconds: number): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(Math.max(1, timeoutSeconds) * 1000),
      redirect: "follow"
    });
    return { ok: response.status >= 200 && response.status < 400, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
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
  // readWatchPolicy 的 DTO 未必带出新增字段，健康检查配置直接读原始行（prisma 默认值兜底）。
  const policyRow = await prisma.watchPolicy.findUnique({ where: { instanceId: instance.id } }).catch(() => null);
  const healthCheckUrl = policyRow?.healthCheckUrl ?? null;
  const healthCheckTimeoutSeconds = policyRow?.healthCheckTimeoutSeconds ?? 5;
  const userId = incident.assigneeUserId ?? instance.createdById ?? "";
  const checkpoints = await incidentRollbackSet(incidentId);
  const shouldStart = checkpoints.length > 0;

  await updateIncident(incidentId, { status: "verifying" });
  suppressRestart(instance.id, Math.max(policy.verifyWaitSeconds + 15, 30) * 1000);

  // 重启前记录日志游标：daemon 的日志环形缓冲在实例重启时不会清空，
  // 验证只判定游标之后的新日志，避免修复前的 fatal/panic 旧日志造成误判。
  let logCursor: number | null = null;
  try {
    const before = await readDaemonInstanceLogs(instance.node, instance.id, 200);
    logCursor = before.lines.reduce((max, line) => Math.max(max, line.id), 0);
  } catch {
    logCursor = null; // 游标不可用时退回旧行为（判定全部日志）
  }

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
      console.error("watch verify: restart failed:", error instanceof Error ? error.stack ?? error.message : error);
      if (userId) {
        const notes = await rollbackIncidentChanges(incidentId, userId);
        void notes;
        await updateIncident(incidentId, {
          status: "rolled_back",
          summary: "修复已写入，但实例重新启动失败，已回滚这次修改。",
          resolvedAt: new Date()
        });
      } else {
        // 无操作用户时不执行回滚，也不得谎报 rolled_back。
        await updateIncident(incidentId, {
          status: "failed",
          summary: "修复已写入，但实例重新启动失败；未能回滚（无操作用户），改动仍保留在磁盘上，请人工处理。",
          resolvedAt: new Date()
        });
      }
      clearRestartLease(instance.id);
      return;
    }
  }

  await sleep(Math.max(5, policy.verifyWaitSeconds) * 1000);

  try {
    const state = await readDaemonInstanceStatus(instance.node, instance.id, 4000);
    const logs = await readDaemonInstanceLogs(instance.node, instance.id, 200);
    const freshLines = logCursor === null ? logs.lines : logs.lines.filter((line) => line.id > logCursor);
    const logText = freshLines.map((line) => `[${line.stream}] ${line.text}`).join("\n");
    await prisma.instance.update({
      where: { id: instance.id },
      data: {
        status: state.status,
        lastExitCode: state.exitCode ?? null,
        ...(state.status === "STOPPED" || state.status === "CRASHED" ? { lastStoppedAt: new Date() } : {})
      }
    });

    // 验证窗口内实例处于 STOPPED：多半是用户手动停机。中止验证，
    // 不回滚也不判失败，改动保留，等人工启动后确认。
    if (state.status === "STOPPED") {
      await updateIncident(incidentId, {
        status: "diagnosed",
        summary: `${incident.diagnosis?.summary ?? incident.summary ?? "修改已应用。"} 验证期间实例处于停止状态（可能被手动停止），已跳过自动验证；改动已保留，请手动启动实例后确认。`
      });
      clearRestartLease(instance.id);
      return;
    }

    const crashedAgain = state.status === "CRASHED";
    const strictFingerprint = crashFingerprint(instance.id, state.exitCode ?? null, logText);
    // exitCode 任一侧为 null 时按无 exitCode 的指纹宽松比对，避免 null 差异导致"该回滚时不回滚"。
    const relaxedFingerprint =
      (state.exitCode ?? null) === null || (incident.exitCode ?? null) === null
        ? crashFingerprint(incident.instanceId, null, logText) === crashFingerprint(incident.instanceId, null, incident.logTail)
        : false;
    const sameFingerprint = strictFingerprint === incident.fingerprint || relaxedFingerprint;
    const fatalBurst = freshLines.length > 0 && /(?:fatal|panic|cannot bind|address already in use|permission denied)/i.test(logText);

    // 健康检查：只在进程处于 RUNNING 时有意义（STOPPED 已在上面提前返回），
    // 进程活着但服务不可用时按"验证失败"处理，与再次崩溃同等对待。
    const healthCheck =
      healthCheckUrl && state.status === "RUNNING"
        ? await runInstanceHealthCheck(healthCheckUrl, healthCheckTimeoutSeconds)
        : null;
    const healthFailed = healthCheck !== null && !healthCheck.ok;
    const crashFailure = crashedAgain && (sameFingerprint || fatalBurst);
    const failureNote = healthFailed && !crashFailure ? `健康检查未通过（${healthCheck.detail}）` : null;

    if ((crashFailure || healthFailed) && checkpoints.length > 0) {
      if (userId) {
        await rollbackIncidentChanges(incidentId, userId);
        await updateIncident(incidentId, {
          status: "rolled_back",
          summary: incident.diagnosis?.summary
            ? `${incident.diagnosis.summary}。验证失败${failureNote ? `（${failureNote}）` : ""}，已回滚这次修改。`
            : `验证失败${failureNote ? `（${failureNote}）` : ""}，已回滚这次修改。实例仍未恢复。`,
          resolvedAt: new Date()
        });
      } else {
        // 无操作用户时不执行回滚，也不得谎报 rolled_back。
        await updateIncident(incidentId, {
          status: "failed",
          summary: failureNote
            ? `验证未通过：${failureNote}；未能回滚（无操作用户），改动仍保留在磁盘上，请人工处理。`
            : "验证未通过，实例再次崩溃；未能回滚（无操作用户），改动仍保留在磁盘上，请人工处理。",
          resolvedAt: new Date()
        });
      }
      clearRestartLease(instance.id);
      return;
    }

    // 健康检查未通过但没有可回滚的改动：进程在跑但服务不可用，判 failed 交人工。
    if (healthFailed) {
      await updateIncident(incidentId, {
        status: "failed",
        summary: `验证未通过：健康检查未通过（${healthCheck.detail}），实例进程在运行但服务不可用，请人工处理。`,
        resolvedAt: new Date()
      });
      clearRestartLease(instance.id);
      return;
    }

    if (state.status === "RUNNING" && !fatalBurst) {
      const baseSummary = incident.diagnosis?.summary ?? incident.summary ?? "Saki 已完成诊断，实例正在运行。";
      await updateIncident(incidentId, {
        status: "resolved",
        summary: healthCheck ? `${baseSummary}（健康检查通过：${healthCheck.detail}）` : baseSummary,
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
    console.error("watch verify failed:", error instanceof Error ? error.stack ?? error.message : error);
    await updateIncident(incidentId, {
      status: "failed",
      summary: "验证阶段出现异常，请人工检查实例状态。"
    });
    clearRestartLease(instance.id);
  }
}
