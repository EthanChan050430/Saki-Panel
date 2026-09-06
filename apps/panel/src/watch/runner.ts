import { randomUUID } from "node:crypto";
import type { CurrentUser, WatchDiagnosis, WatchPolicyMode } from "@webops/shared";
import { loadCurrentUser } from "../auth.js";
import { prisma } from "../db.js";
import { instanceAccessInclude } from "../instance-access.js";
import { readEffectiveSakiConfig } from "../routes/saki/config.js";
import { resolveSakiContext } from "../routes/saki/chat.js";
import { executeSakiAgentTool } from "../routes/saki/executor.js";
import { runSakiAgent } from "../routes/saki/loop.js";
import { loadSakiSkills } from "../routes/saki/skills.js";
import {
  cancelActiveSakiTask,
  createActiveSakiTask,
  emitActiveSakiTaskEvent,
  finishActiveSakiTask,
  pendingSakiActions
} from "../routes/saki/state.js";
import type { SakiAgentRuntime } from "../routes/saki/types.js";
import { buildWatchSystemPrompt, buildWatchUserMessage, watchChatRequest } from "../routes/saki/watch-prompt.js";
import { executeApprovedSakiAction } from "../routes/saki/approval.js";
import { emitIncident, getIncident, updateIncident } from "./incidents.js";
import { collectWatchEvidence, formatWatchEvidenceSection } from "./evidence.js";
import { recordWatchRun, watchCooldownRemainingSeconds, watchRunsInLastHour } from "./detector.js";
import { clearRestartLease, suppressRestart } from "./leases.js";
import { readWatchPolicy } from "./policy.js";
import { assertUserHasSpendablePoints, InsufficientPointsError } from "../points.js";
import { verifyIncident } from "./verify.js";

const runningInstanceIds = new Set<string>();
const finishing = new Set<string>();

function parseWatchDiagnosis(text: string): WatchDiagnosis | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    if (!trimmed) return null;
    return { summary: trimmed.slice(0, 400), confidence: 0.4 };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as WatchDiagnosis;
    if (!parsed || typeof parsed !== "object") return null;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) return null;
    const diagnosis: WatchDiagnosis = { summary };
    if (typeof parsed.rootCause === "string") diagnosis.rootCause = parsed.rootCause;
    if (Array.isArray(parsed.changes)) {
      diagnosis.changes = parsed.changes.filter((item) => item && typeof item.path === "string");
    }
    if (parsed.risk) diagnosis.risk = parsed.risk;
    diagnosis.needRestart = Boolean(parsed.needRestart);
    if (typeof parsed.confidence === "number") diagnosis.confidence = parsed.confidence;
    return diagnosis;
  } catch {
    return { summary: trimmed.slice(0, 400), confidence: 0.4 };
  }
}

export function pendingActionsForIncident(incidentId: string) {
  return [...pendingSakiActions.values()].filter((pending) => pending.incidentId === incidentId);
}

async function resolveWatchUser(
  instance: {
    assignedToId: string | null;
    createdById: string | null;
  },
  approverUserId?: string | null
): Promise<CurrentUser | null> {
  const candidates = [approverUserId, instance.assignedToId, instance.createdById].filter(
    (value): value is string => Boolean(value)
  );
  for (const userId of candidates) {
    const user = await loadCurrentUser(userId);
    if (user && user.status === "ACTIVE" && user.permissions.includes("saki.agent")) {
      return user;
    }
  }
  return null;
}

export async function maybeFinishWatchIncident(incidentId: string): Promise<void> {
  if (finishing.has(incidentId)) return;
  const incident = await getIncident(incidentId);
  if (!incident) return;
  if (incident.status === "verifying" || incident.status === "resolved" || incident.status === "rolled_back" || incident.status === "failed" || incident.status === "ignored") {
    return;
  }
  if (pendingActionsForIncident(incidentId).length > 0) {
    if (incident.status !== "awaiting_approval") {
      await updateIncident(incidentId, { status: "awaiting_approval" });
    }
    return;
  }

  finishing.add(incidentId);
  try {
    if (incident.rollbackSet.length > 0) {
      await verifyIncident(incidentId);
      return;
    }
    // 诊断完成但没有文件改动（或 diagnose_only 模式）：不会进入验证，立即释放 restart lease。
    clearRestartLease(incident.instanceId);
    let summary = incident.diagnosis?.summary ?? incident.summary ?? "Saki 已完成诊断，等待你接手。";
    // 没有后续自动动作时，若实例仍处于崩溃/停止状态，在 summary 里明确提示人工启动。
    const instanceRow = await prisma.instance.findUnique({
      where: { id: incident.instanceId },
      select: { status: true }
    });
    if (instanceRow && (instanceRow.status === "CRASHED" || instanceRow.status === "STOPPED")) {
      summary = `${summary} 实例仍未运行，需要手动启动。`;
    }
    await updateIncident(incidentId, { status: "diagnosed", summary });
  } finally {
    finishing.delete(incidentId);
  }
}

// 风险分级自治：诊断 risk 不高于策略阈值且置信度达标时，自动批准本次诊断产生的待审批动作。
// 任一动作执行失败都退回 awaiting_approval 交人工处理；diagnose_only 模式永不自动执行。
const autoApproveRiskRank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

async function maybeAutoApproveWatchActions(
  incidentId: string,
  actionIds: string[],
  diagnosis: WatchDiagnosis | null,
  instanceId: string,
  mode: Exclude<WatchPolicyMode, "off">,
  user: CurrentUser
): Promise<void> {
  if (mode === "diagnose_only") return;
  const policyRow = await prisma.watchPolicy.findUnique({ where: { instanceId } }).catch(() => null);
  const autoApproveRisk = policyRow?.autoApproveRisk ?? "none";
  if (autoApproveRisk !== "low" && autoApproveRisk !== "medium") return;
  if (!diagnosis?.risk) return;
  const policyRank = autoApproveRisk === "low" ? 1 : 2;
  const diagnosisRank = autoApproveRiskRank[diagnosis.risk] ?? Number.MAX_SAFE_INTEGER;
  if (diagnosisRank > policyRank) return;
  if ((diagnosis.confidence ?? 0) < (policyRow?.autoApproveMinConfidence ?? 0.85)) return;

  try {
    for (const actionId of actionIds) {
      await executeApprovedSakiAction(actionId, { id: user.id, permissions: user.permissions });
    }
    const current = await getIncident(incidentId);
    if (!current || current.status === "ignored" || current.status === "rolled_back") return;
    await updateIncident(incidentId, {
      autoApplied: true,
      summary: `${current.summary ?? diagnosis.summary}（已按自治策略自动执行）`
    });
  } catch (error) {
    // 自动执行失败：退回人工审批。maybeFinishWatchIncident 会在仍有 pending 动作时
    // 置回 awaiting_approval，已完成执行的动作不受影响。
    console.error("watch auto-approve failed:", error instanceof Error ? error.stack ?? error.message : error);
    const current = await getIncident(incidentId);
    if (!current || current.status === "ignored" || current.status === "rolled_back") return;
    await maybeFinishWatchIncident(incidentId);
  }
}

export class WatchRunConflictError extends Error {
  constructor() {
    super("Saki is already diagnosing this instance.");
  }
}

export async function startWatchRun(input: {
  incidentId: string;
  instanceId: string;
  exitCode?: number | null;
  logTail: string;
  trigger: string;
  willRetry: boolean;
  mode: Exclude<WatchPolicyMode, "off">;
  requestedByUserId?: string;
}): Promise<void> {
  if (runningInstanceIds.has(input.instanceId)) {
    throw new WatchRunConflictError();
  }
  runningInstanceIds.add(input.instanceId);
  suppressRestart(input.instanceId);
  const abortController = new AbortController();

  try {
    const latest = await getIncident(input.incidentId);
    if (!latest || latest.status === "ignored" || latest.status === "rolled_back") {
      clearRestartLease(input.instanceId);
      return;
    }

    const instance = await prisma.instance.findUnique({
      where: { id: input.instanceId },
      include: instanceAccessInclude
    });
    if (!instance) {
      await updateIncident(input.incidentId, { status: "failed", summary: "实例已不存在。" });
      clearRestartLease(input.instanceId);
      return;
    }

    const policy = await readWatchPolicy(instance.id);
    const requestedBy = input.requestedByUserId ? await loadCurrentUser(input.requestedByUserId) : null;
    const user =
      requestedBy && requestedBy.status === "ACTIVE" && requestedBy.permissions.includes("saki.agent")
        ? requestedBy
        : await resolveWatchUser(instance, policy.approverUserId);
    if (!user) {
      await updateIncident(input.incidentId, {
        status: "open",
        summary: "需要拥有 saki.agent 权限的账号确认后，才能开始诊断。"
      });
      clearRestartLease(input.instanceId);
      return;
    }

    const taskId = randomUUID();
    const context = await resolveSakiContext(user.id, instance.id, true);
    // 诊断前采集证据包（日志/崩溃历史/节点资源/最近变更），失败不阻断诊断。
    let evidenceSection = "";
    try {
      const evidence = await collectWatchEvidence(latest);
      evidenceSection = formatWatchEvidenceSection(evidence, latest.recurrenceCount);
    } catch (error) {
      console.error("watch evidence collection failed:", error instanceof Error ? error.stack ?? error.message : error);
    }
    const message = buildWatchUserMessage({
      instance,
      context,
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      logTail: input.logTail,
      trigger: input.trigger,
      mode: input.mode,
      willRetry: input.willRetry
    }) + (evidenceSection ? `\n\n${evidenceSection}` : "");
    const chatInput = watchChatRequest(message, instance.id);
    const skills = (await loadSakiSkills("runtime crash logs diagnostics", false, 8)).skills;
    const config = await readEffectiveSakiConfig();
    createActiveSakiTask(taskId, user.id, instance.id, chatInput, abortController);
    await updateIncident(input.incidentId, {
      status: "diagnosing",
      taskId,
      assigneeUserId: user.id,
      summary: input.trigger === "crash_loop" ? "检测到崩溃循环，Saki 正在诊断。" : "实例崩溃，Saki 正在诊断。"
    });
    recordWatchRun(input.instanceId);

    const runtime: SakiAgentRuntime = {
      input: chatInput,
      context,
      skills,
      userId: user.id,
      permissions: user.permissions,
      config,
      kind: "watch",
      incidentId: input.incidentId,
      watchMode: input.mode,
      maxLoops: 12,
      systemPromptOverride: buildWatchSystemPrompt(input.mode),
      abortController
    };

    const events = {
      workflow: (update: { id: string; stage: string; message: string; status: string; tool?: string; call?: string; actionId?: string; detail?: string }) => {
        emitActiveSakiTaskEvent(taskId, "workflow", update as unknown as Record<string, unknown>);
      },
      action: (action: { id: string }) => {
        emitActiveSakiTaskEvent(taskId, "action", { action: action as unknown as Record<string, unknown> });
      },
      delta: (text: string) => {
        emitActiveSakiTaskEvent(taskId, "delta", { text });
      },
      thinking: (text: string) => {
        emitActiveSakiTaskEvent(taskId, "thinking", { text });
      }
    };

    try {
      await assertUserHasSpendablePoints(user.id);
      const response = await runSakiAgent(runtime, events, undefined, executeSakiAgentTool);
      finishActiveSakiTask(taskId, abortController.signal.aborted ? "cancelled" : "completed", response);
      const current = await getIncident(input.incidentId);
      if (!current || current.status === "ignored" || current.status === "rolled_back" || abortController.signal.aborted) {
        return;
      }
      const diagnosis = parseWatchDiagnosis(response.message);
      const pending = pendingActionsForIncident(input.incidentId);
      await updateIncident(input.incidentId, {
        status: pending.length ? "awaiting_approval" : "diagnosed",
        summary: diagnosis?.summary ?? response.message.slice(0, 400),
        rootCause: diagnosis?.rootCause ?? null,
        diagnosis
      });
      if (pending.length) {
        await maybeAutoApproveWatchActions(input.incidentId, pending.map((action) => action.id), diagnosis, instance.id, input.mode, user);
      } else {
        await maybeFinishWatchIncident(input.incidentId);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Saki watch failed";
      console.error("Saki watch diagnosis failed:", error instanceof Error ? error.stack ?? error.message : error);
      finishActiveSakiTask(taskId, abortController.signal.aborted ? "cancelled" : "failed", undefined, reason);
      const current = await getIncident(input.incidentId);
      if (!current || current.status === "ignored" || current.status === "rolled_back" || abortController.signal.aborted) {
        return;
      }
      // 诊断失败：不会进入验证，释放 restart lease；对外用友好文案，内部细节只进服务端日志。
      clearRestartLease(input.instanceId);
      await updateIncident(input.incidentId, {
        status: "diagnosed",
        summary: "Saki 值班诊断失败，请稍后重试或人工接手。"
      });
    }
  } finally {
    runningInstanceIds.delete(input.instanceId);
  }
}

// rate_limited 不计入"已在运行"的阻塞：一小时窗口过去后允许重新 claim（预算会重新检查）。
const diagnosableStatuses = new Set(["open", "diagnosed", "failed", "rate_limited"]);

// watchRunsInLastHour 检查与 recordWatchRun 之间按实例串行化，降低并发确认导致的超预算。
const confirmLocks = new Map<string, Promise<unknown>>();

export async function confirmWatchDiagnosis(input: {
  incidentId: string;
  requestedByUserId: string;
}): Promise<void> {
  await assertUserHasSpendablePoints(input.requestedByUserId);
  const incident = await getIncident(input.incidentId);
  if (!incident) {
    throw new Error("Incident not found");
  }
  const previous = confirmLocks.get(incident.instanceId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => confirmWatchDiagnosisLocked(input));
  confirmLocks.set(incident.instanceId, task);
  try {
    await task;
  } finally {
    if (confirmLocks.get(incident.instanceId) === task) confirmLocks.delete(incident.instanceId);
  }
}

async function confirmWatchDiagnosisLocked(input: {
  incidentId: string;
  requestedByUserId: string;
}): Promise<void> {
  const incident = await getIncident(input.incidentId);
  if (!incident) {
    throw new Error("Incident not found");
  }
  if (!diagnosableStatuses.has(incident.status)) {
    throw new Error("This incident is already being handled or does not need a new diagnosis.");
  }

  const policy = await readWatchPolicy(incident.instanceId);
  if (!policy.enabled || policy.mode === "off") {
    throw new Error("Watch is disabled for this instance.");
  }
  const cooldownRemaining = watchCooldownRemainingSeconds(incident.instanceId, policy.cooldownSeconds);
  if (cooldownRemaining > 0) {
    throw new Error(`距离上次诊断不足 ${policy.cooldownSeconds} 秒的冷却期，请约 ${cooldownRemaining} 秒后再试。`);
  }
  if (watchRunsInLastHour(incident.instanceId) >= policy.maxRunsPerHour) {
    await updateIncident(incident.id, {
      status: "rate_limited",
      summary: "本小时诊断次数已达上限，未消耗新的模型额度。"
    });
    throw new Error("Hourly watch budget reached. Saki will not start another diagnosis.");
  }

  const mode = policy.mode === "diagnose_only" ? "diagnose_only" : "diagnose_and_patch";
  const claimed = await prisma.incident.updateMany({
    where: { id: incident.id, status: { in: [...diagnosableStatuses] } },
    data: {
      status: "diagnosing",
      assigneeUserId: input.requestedByUserId,
      summary: "你已确认本次诊断。Saki 即将开始（会消耗模型额度）。"
    }
  });
  if (claimed.count === 0) {
    throw new Error("This incident is already being handled or does not need a new diagnosis.");
  }
  // claim 用 updateMany 保证原子性，但不会触发 SSE；这里补推 diagnosing 中间态。
  void emitIncident(incident.id);
  void startWatchRun({
    incidentId: incident.id,
    instanceId: incident.instanceId,
    ...(incident.exitCode !== undefined && incident.exitCode !== null ? { exitCode: incident.exitCode } : {}),
    logTail: incident.logTail,
    trigger: incident.trigger,
    willRetry: false,
    mode,
    requestedByUserId: input.requestedByUserId
  }).catch(async (error) => {
    // startWatchRun 内部已处理 agent 层的失败；能走到这里的都是启动阶段的异常
    // （含 runningInstanceIds 已占用的同步抛错），把单子退回 open 而不是留在 diagnosing + taskId null。
    console.error("Saki watch run failed to start:", error instanceof Error ? error.stack ?? error.message : error);
    const current = await getIncident(incident.id);
    if (!current || current.status === "ignored" || current.status === "rolled_back") {
      return;
    }
    if (current.taskId) {
      cancelActiveSakiTask(current.taskId);
    }
    if (!(error instanceof WatchRunConflictError)) {
      // 冲突错误说明 lease/运行锁属于另一个正在进行的诊断，不能清；其余情况是我们自己留下的。
      clearRestartLease(incident.instanceId);
    }
    await updateIncident(incident.id, {
      status: "open",
      taskId: null,
      summary:
        error instanceof WatchRunConflictError
          ? "该实例已有另一个诊断正在进行，请稍后再确认。额度未继续消耗。"
          : "未能开始诊断，请稍后重试。额度未继续消耗。"
    }).catch(() => undefined);
  });
}

const cancelWatchdogMs = 30 * 1000;

export async function cancelWatchIncident(incidentId: string): Promise<void> {
  const incident = await getIncident(incidentId);
  if (!incident?.taskId) return;
  const taskId = incident.taskId;
  cancelActiveSakiTask(taskId);
  // 看门狗：abort 后任务若 30 秒仍未结束，强制释放运行锁并把单子退回 open，
  // 避免 runningInstanceIds 被永久占用、该实例再也无法诊断。
  const watchdog = setTimeout(() => {
    void (async () => {
      const current = await getIncident(incidentId);
      if (!current || current.taskId !== taskId) return;
      if (current.status !== "diagnosing" && current.status !== "applying" && current.status !== "awaiting_approval") return;
      runningInstanceIds.delete(current.instanceId);
      clearRestartLease(current.instanceId);
      await updateIncident(incidentId, {
        status: "open",
        taskId: null,
        summary: "诊断任务未能在取消后正常结束，已强制中止并退回待确认状态。"
      }).catch(() => undefined);
    })();
  }, cancelWatchdogMs);
  watchdog.unref?.();
}
