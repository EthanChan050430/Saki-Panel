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
import { getIncident, updateIncident } from "./incidents.js";
import { recordWatchRun, watchRunsInLastHour } from "./detector.js";
import { suppressRestart } from "./leases.js";
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
    await updateIncident(incidentId, {
      status: "diagnosed",
      summary: incident.diagnosis?.summary ?? incident.summary ?? "Saki 已完成诊断，等待你接手。"
    });
  } finally {
    finishing.delete(incidentId);
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
    throw new Error("Saki is already diagnosing this instance.");
  }
  runningInstanceIds.add(input.instanceId);
  suppressRestart(input.instanceId);
  const abortController = new AbortController();

  try {
    const latest = await getIncident(input.incidentId);
    if (!latest || latest.status === "ignored" || latest.status === "rolled_back") {
      return;
    }

    const instance = await prisma.instance.findUnique({
      where: { id: input.instanceId },
      include: instanceAccessInclude
    });
    if (!instance) {
      await updateIncident(input.incidentId, { status: "failed", summary: "实例已不存在。" });
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
      return;
    }

    const taskId = randomUUID();
    const context = await resolveSakiContext(user.id, instance.id, true);
    const message = buildWatchUserMessage({
      instance,
      context,
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      logTail: input.logTail,
      trigger: input.trigger,
      mode: input.mode,
      willRetry: input.willRetry
    });
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
      if (!pending.length) {
        await maybeFinishWatchIncident(input.incidentId);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Saki watch failed";
      finishActiveSakiTask(taskId, abortController.signal.aborted ? "cancelled" : "failed", undefined, reason);
      const current = await getIncident(input.incidentId);
      if (!current || current.status === "ignored" || current.status === "rolled_back" || abortController.signal.aborted) {
        return;
      }
      await updateIncident(input.incidentId, {
        status: "diagnosed",
        summary: `Saki 值班诊断失败：${reason}`
      });
    }
  } finally {
    runningInstanceIds.delete(input.instanceId);
  }
}

const diagnosableStatuses = new Set(["open", "diagnosed", "failed"]);

export async function confirmWatchDiagnosis(input: {
  incidentId: string;
  requestedByUserId: string;
}): Promise<void> {
  await assertUserHasSpendablePoints(input.requestedByUserId);
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
    if (runningInstanceIds.has(incident.instanceId)) return;
    const current = await getIncident(incident.id);
    if (!current || current.status === "ignored" || current.status === "rolled_back" || current.status === "diagnosing" && current.taskId) {
      return;
    }
    const reason = error instanceof Error ? error.message : "Saki watch failed";
    await updateIncident(incident.id, {
      status: "open",
      summary: `未能开始诊断：${reason}。额度未继续消耗。`
    }).catch(() => undefined);
  });
}

export async function cancelWatchIncident(incidentId: string): Promise<void> {
  const incident = await getIncident(incidentId);
  if (incident?.taskId) {
    cancelActiveSakiTask(incident.taskId);
  }
}
