import type { FastifyRequest } from "fastify";
import type { PermissionCode, SakiActionDecisionResponse, SakiAgentAction, SakiChatResponse } from "@webops/shared";
import { writeAuditLog } from "../../audit.js";
import { assertUserHasSpendablePoints } from "../../points.js";
import { runSakiAgent, renderToolCall, observationForAgentPrompt } from "./loop.js";
import { ensureToolCallId } from "./agent-messages.js";
import { assertCheckpointRollbackAccess, auditAgentTool, executeSakiAgentTool, rollbackCheckpoint } from "./executor.js";
import {
  cancelActiveSakiTask,
  assertSakiTaskContextAvailable,
  createActiveSakiTask,
  completedSakiActions,
  emitActiveSakiTaskEvent,
  extractConfirmedTodos,
  finishActiveSakiTask,
  getActiveSakiTaskById,
  getRecentWorkingFiles,
  invalidateInstanceFileCache,
  pendingSakiActions,
  persistSessionAgentMemory,
  removeCheckpoint,
  removePendingSakiAction,
  restartActiveSakiTask,
  sakiActionsReady,
  sakiCheckpoints,
  saveCompletedSakiAction
} from "./state.js";
import { withPendingSakiActionDecision } from "./decision-lock.js";
import { syncSakiTaskResult } from "./conversations.js";
import { trackedSakiTaskEvents } from "./task-runner.js";
import { toolArgs } from "./tools.js";
import type { PendingSakiAction, SakiAgentResumeState, SakiAgentRuntime, SakiCheckpoint } from "./types.js";
import { effectiveSakiAgentPermissionMode, RouteError, withRequestedSakiModel } from "./types.js";
import { readEffectiveSakiConfig } from "./config.js";
import { resolveSakiContext } from "./chat.js";
import { assertSakiSessionAccess, assertSakiTaskAccess } from "./session-access.js";
import { assertSakiApprovalBindings } from "./workspace-binding.js";
import { withSakiWorkspaceMutation } from "./workspace-mutation.js";
import { maybeFinishWatchIncident } from "../../watch/runner.js";
import { updateIncident } from "../../watch/incidents.js";

function assertPendingSakiActionOwner(userId: string, pending: PendingSakiAction): void {
  if (pending.userId !== userId) {
    throw new RouteError("Pending Saki action not found or already handled.", 404);
  }
}

// 请求无关的 runtime 构造：HTTP 审批与 watch 自治自动执行共用；
// request 仅用于审计上下文（ip/userAgent），后台路径没有请求对象。
async function runtimeForSakiActionDecision(
  user: { id: string; permissions: PermissionCode[] },
  pending: PendingSakiAction,
  request?: FastifyRequest
): Promise<SakiAgentRuntime> {
  const mode = pending.kind === "chat" || pending.resume?.input.mode === "chat" ? "chat" : "agent";
  const authorized = await assertSakiSessionAccess(user.id, pending.contextInstanceId, mode);
  await assertSakiApprovalBindings(user.id, pending.resourceBindings);
  const context = await resolveSakiContext(user.id, pending.contextInstanceId, false, mode);
  if (pending.contextInstanceId && !context.instance) throw new RouteError("Instance not found.", 404);
  const input = pending.resume?.input ?? {
    message: "approved Saki action",
    history: [],
    instanceId: pending.contextInstanceId,
    mode: "agent" as const
  };
  const config = withRequestedSakiModel(await readEffectiveSakiConfig(), input);
  const task = pending.resume?.taskId ? getActiveSakiTaskById(pending.resume.taskId) : null;
  if (task?.status === "cancelled" || task?.abortController?.signal.aborted) throw new RouteError("Task was cancelled. This action will not execute.", 409);
  return {
    ...(request ? { request } : {}),
    input,
    context,
    skills: pending.resume?.skills ?? [],
    userId: user.id,
    permissions: authorized.user.permissions,
    ...(mode === "chat" ? { toolProfile: "chat" as const } : {}),
    config,
    ...(task ? { taskId: task.id, abortController: task.abortController } : {}),
    ...(pending.kind ? { kind: pending.kind } : {}),
    ...(pending.incidentId ? { incidentId: pending.incidentId } : {}),
    ...(pending.watchMode ? { watchMode: pending.watchMode } : {}),
    ...(pending.maxLoops ? { maxLoops: pending.maxLoops } : {}),
    ...(pending.systemPromptOverride ? { systemPromptOverride: pending.systemPromptOverride } : {})
  };
}

type DecisionResult = SakiActionDecisionResponse & { continuation?: () => Promise<SakiChatResponse> };

async function withTrackedActionDecision(pending: PendingSakiAction, userId: string, work: () => Promise<DecisionResult>): Promise<SakiActionDecisionResponse> {
  const taskId = pending.resume?.taskId;
  if (!taskId) return work();
  let task = getActiveSakiTaskById(taskId);
  if (task && (task.userId !== userId || task.status === "cancelled" || task.status === "running")) throw new RouteError("Task was cancelled or is already running.", 409);
  assertSakiTaskContextAvailable(userId, pending.contextInstanceId, taskId);
  const controller = new AbortController();
  if (task) restartActiveSakiTask(taskId, controller);
  else task = createActiveSakiTask(taskId, userId, pending.contextInstanceId, pending.resume!.input, controller);
  task.decisionInFlight = true;
  const trackedTask = task;
  let background = false;
  const complete = async (response: SakiChatResponse) => {
    await syncSakiTaskResult(trackedTask, response);
    finishActiveSakiTask(trackedTask.id, "completed", response);
    return response;
  };
  const fail = async (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    const confirmed = completedSakiActions.get(pending.id);
    const response: SakiChatResponse = { source: "local-fallback", message: reason, retry: { reason, taskId }, actions: [...(pending.resume?.actions ?? []), ...(confirmed ? [confirmed] : [])] };
    await syncSakiTaskResult(trackedTask, response);
    finishActiveSakiTask(trackedTask.id, "failed", response, reason);
    return response;
  };
  emitActiveSakiTaskEvent(task.id, "workflow", { id: `approval:${pending.id}`, stage: "tool", message: "已收到决定，正在执行并继续任务。", status: "running", tool: pending.call.name });
  try {
    const { continuation, ...result } = await work();
    if (continuation) {
      background = true;
      const execution = Promise.resolve().then(continuation).then(complete).catch(fail).finally(() => {
        delete trackedTask.decisionInFlight;
        if (trackedTask.execution === execution) delete trackedTask.execution;
      });
      trackedTask.execution = execution;
      // The task owns continuation and cancellation after the approval HTTP ends.
      void execution.catch(() => {});
      return { ...result, taskId };
    }
    const response = result.response ?? { source: "direct-model" as const, message: result.message, actions: [...(pending.resume?.actions ?? []), result.action] };
    await complete(response);
    return result;
  } catch (error) {
    await fail(error);
    throw error;
  } finally { if (!background) delete task.decisionInFlight; }
}

function resumeAfterSakiActionDecision(pending: PendingSakiAction, action: SakiAgentAction): SakiAgentResumeState | null {
  if (!pending.resume) return null;
  const toolCallId = ensureToolCallId(pending.call);
  const existingTurnMessages = pending.resume.turnMessages ? [...pending.resume.turnMessages] : [];
  if (existingTurnMessages.length > 0) {
    existingTurnMessages.push({
      role: "tool",
      toolCallId,
      name: pending.call.name,
      content: observationForAgentPrompt(action)
    });
  }
  return {
    ...pending.resume,
    // Approval may have just changed the workspace. Never restore observations
    // from before that mutation as current tool results.
    readOnlyToolCache: [],
    actions: [...pending.resume.actions, action],
    scratchpadEntries: [
      ...pending.resume.scratchpadEntries,
      `\nAssistant: ${renderToolCall(pending.call)}\nObservation:\n${observationForAgentPrompt(action)}\n`,
      ...(!action.ok
        ? ["If the error is caused by missing permission, blocked safety policy, or missing active instance, stop and respond with a concise explanation. Otherwise adjust your plan and continue.\n"]
        : [])
    ],
    toolExecutions: pending.resume.toolExecutions + 1,
    turnMessages: existingTurnMessages
  };
}

async function persistDecisionResult(pending: PendingSakiAction, action: SakiAgentAction, runtime: SakiAgentRuntime): Promise<void> {
  const resumeState = resumeAfterSakiActionDecision(pending, action);
  if (!resumeState) return;
  const instanceId = runtime.context.workspace?.instanceId ?? null;
  await persistSessionAgentMemory({
    userId: runtime.userId, instanceId, resumeState,
    workingFiles: getRecentWorkingFiles(runtime.userId, instanceId),
    lastGoal: resumeState.input.message, lastSummary: action.observation,
    todos: extractConfirmedTodos(resumeState.actions, resumeState.scratchpadEntries), updatedAt: Date.now()
  });
}

async function continueSakiAgentAfterActionDecision(
  pending: PendingSakiAction,
  action: SakiAgentAction,
  runtime: SakiAgentRuntime,
  persisted = false
): Promise<SakiChatResponse | undefined> {
  const resume = resumeAfterSakiActionDecision(pending, action);
  if (!resume) return undefined;
  const task = resume.taskId ? getActiveSakiTaskById(resume.taskId) : null;
  const trackedTaskId = task?.userId === runtime.userId && task.decisionInFlight ? task.id : undefined;
  if (trackedTaskId) {
    runtime.taskId = trackedTaskId;
    for (const confirmed of resume.actions) emitActiveSakiTaskEvent(trackedTaskId, "action", { action: confirmed });
  }
  const events = trackedTaskId ? trackedSakiTaskEvents(trackedTaskId) : undefined;
  try {
    if (!persisted) await persistDecisionResult(pending, action, runtime);
    await assertUserHasSpendablePoints(runtime.userId);
    const response = await runSakiAgent(runtime, events, resume, executeSakiAgentTool);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Saki request failed";
    const response: SakiChatResponse = {
      source: "local-fallback",
      message: `The action ran, but Saki could not continue the follow-up response: ${reason}`,
      retry: { reason, ...(resume.taskId ? { taskId: resume.taskId } : {}) },
      workspace: runtime.context.workspace,
      agentPermissionMode: effectiveSakiAgentPermissionMode(runtime.input),
      skills: runtime.skills,
      actions: resume.actions
    };
    return response;
  }
}

// 请求无关的批准执行核心：HTTP 处理器与 watch 自治策略共用同一条路径，行为保持一致。
async function executeApprovedSakiActionUnlocked(
  id: string,
  user: { id: string; permissions: PermissionCode[] },
  request?: FastifyRequest,
  backgroundContinuation = false
): Promise<SakiActionDecisionResponse> {
  await sakiActionsReady;
  const pending = pendingSakiActions.get(id);
  if (!pending) throw new RouteError("Pending Saki action not found or already handled.", 404);
  if (pending.call.name.toLowerCase() === "askuser") throw new RouteError("Use the answer action for a question.", 400);
  assertPendingSakiActionOwner(user.id, pending);
  return withTrackedActionDecision(pending, user.id, async () => {
  const runtime = await runtimeForSakiActionDecision(user, pending, request);
  // The executor saves its result before auditing. A failed audit/HTTP response
  // must not turn a later approval retry into a second mutation.
  const confirmed = completedSakiActions.get(id);
  const action = confirmed ?? await executeSakiAgentTool(runtime, pending.call, { approved: true, actionId: id, ...(pending.externalRead ? { externalRead: pending.externalRead } : {}) });
  if (confirmed) await auditAgentTool(runtime, confirmed);
  await persistDecisionResult(pending, action, runtime);
  await removePendingSakiAction(id);
  const continueTask = async () => {
    const response = await continueSakiAgentAfterActionDecision(pending, action, runtime, true);
    if (pending.incidentId) await maybeFinishWatchIncident(pending.incidentId);
    return response ?? { source: "direct-model" as const, message: "Saki action executed.", actions: [action] };
  };
  if (backgroundContinuation && pending.resume?.taskId) {
    emitActiveSakiTaskEvent(pending.resume.taskId, "action", { action });
    return { action, message: "Saki action executed; follow-up is running.", continuation: continueTask };
  }
  const response = await continueTask();
  return {
    action,
    message: action.ok ? "Saki action approved and executed." : "Saki action was approved but failed.",
    ...(response ? { response } : {})
  };
  });
}

export function executeApprovedSakiAction(id: string, user: { id: string; permissions: PermissionCode[] }, request?: FastifyRequest, backgroundContinuation = false): Promise<SakiActionDecisionResponse> {
  return withPendingSakiActionDecision(id, () => executeApprovedSakiActionUnlocked(id, user, request, backgroundContinuation));
}

export async function approvePendingSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  const prefer = request.headers.prefer;
  const background = typeof prefer === "string" && prefer.split(",").some((value) => value.trim() === "respond-async");
  return executeApprovedSakiAction(id, { id: request.user.sub, permissions: request.user.permissions }, request, background);
}

async function rejectPendingSakiActionUnlocked(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  await sakiActionsReady;
  const pending = pendingSakiActions.get(id);
  if (!pending) throw new RouteError("Pending Saki action not found or already handled.", 404);
  if (pending.call.name.toLowerCase() === "askuser") throw new RouteError("Use the answer action to skip a question.", 400);
  assertPendingSakiActionOwner(request.user.sub, pending);
  const confirmed = completedSakiActions.get(id);
  if (confirmed && confirmed.status !== "rejected") throw new RouteError("This action already ran. Inspect its result before taking another action.", 409);
  const runtime = await runtimeForSakiActionDecision({ id: request.user.sub, permissions: request.user.permissions }, pending, request);
  const action: SakiAgentAction = {
    id,
    tool: pending.call.name,
    args: toolArgs(pending.call),
    observation: "Rejected by user.",
    ok: false,
    status: "rejected",
    approval: pending.approval,
    createdAt: new Date().toISOString()
  };
  completedSakiActions.set(id, action);
  await saveCompletedSakiAction(action);
  await auditAgentTool(runtime, action);
  await persistDecisionResult(pending, action, runtime);
  await removePendingSakiAction(id);
  if (pending.resume?.taskId) {
    const response: SakiChatResponse = {
      source: "direct-model", message: "Saki action rejected.", workspace: runtime.context.workspace,
      skills: runtime.skills, actions: [...pending.resume.actions, action]
    };
    const task = getActiveSakiTaskById(pending.resume.taskId);
    if (task) await syncSakiTaskResult(task, response);
    finishActiveSakiTask(pending.resume.taskId, "failed", response);
  }
  if (pending.incidentId) {
    await updateIncident(pending.incidentId, {
      status: "diagnosed",
      summary: "用户拒绝了这次自动修复。诊断结果仍可查看。"
    });
  }
  return { action, message: "Saki action rejected." };
}

export function rejectPendingSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  return withPendingSakiActionDecision(id, () => rejectPendingSakiActionUnlocked(request, id));
}

async function answerPendingSakiQuestionUnlocked(
  request: FastifyRequest,
  id: string,
  input: { selection?: unknown; customText?: unknown; skipped?: unknown }
): Promise<SakiActionDecisionResponse> {
  await sakiActionsReady;
  const pending = pendingSakiActions.get(id);
  if (!pending) throw new RouteError("Pending Saki question not found or already handled.", 404);
  assertPendingSakiActionOwner(request.user.sub, pending);
  if (pending.call.name.toLowerCase() !== "askuser") throw new RouteError("This action is not a question.", 400);
  const args = toolArgs(pending.call);
  const options = Array.isArray(args.options) ? args.options.filter((value): value is string => typeof value === "string") : [];
  const skipped = input.skipped === true;
  const selection = typeof input.selection === "string" ? input.selection.trim() : "";
  const customText = typeof input.customText === "string" ? input.customText.trim() : "";
  if (selection && !options.includes(selection)) throw new RouteError("Please choose a listed option.", 400);
  if (customText.length > 4000) throw new RouteError("The answer is too long.", 400);
  if (!skipped && !selection && !customText) throw new RouteError("Choose an option, write an answer, or skip.", 400);
  return withTrackedActionDecision(pending, request.user.sub, async () => {
  const runtime = await runtimeForSakiActionDecision({ id: request.user.sub, permissions: request.user.permissions }, pending, request);
  const answer = skipped ? { skipped: true } : {
    ...(selection ? { selection } : {}),
    ...(customText ? { customText } : {})
  };
  const observation = skipped
    ? "The user skipped this question. Continue using reasonable judgment; do not ask the same question again."
    : `User answer:\n${selection ? `Selected option: ${selection}\n` : ""}${customText ? `Custom answer: ${customText}` : ""}`;
  const action: SakiAgentAction = completedSakiActions.get(id) ?? {
    id, tool: "askUser", args, question: { text: String(args.question ?? ""), options }, answer,
    observation, ok: true, status: "completed", createdAt: new Date().toISOString()
  };
  await saveCompletedSakiAction(action);
  await auditAgentTool(runtime, action);
  await removePendingSakiAction(id);
  const response = await continueSakiAgentAfterActionDecision(pending, action, runtime);
  return { action, message: skipped ? "Question skipped." : "Answer sent to Saki.", ...(response ? { response } : {}) };
  });
}

export function answerPendingSakiQuestion(request: FastifyRequest, id: string, input: { selection?: unknown; customText?: unknown; skipped?: unknown }): Promise<SakiActionDecisionResponse> {
  return withPendingSakiActionDecision(id, () => answerPendingSakiQuestionUnlocked(request, id, input));
}

async function rollbackSakiActionUnlocked(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  await sakiActionsReady;
  let existing = completedSakiActions.get(id);
  if (!existing?.approval?.checkpointId) {
    const matchedCheckpoints: SakiCheckpoint[] = [];
    for (const cp of sakiCheckpoints.values()) {
      if (cp.actionId === id || cp.id === id) {
        matchedCheckpoints.push(cp);
      }
    }
    const firstCp = matchedCheckpoints[0];
    if (firstCp) {
      existing = {
        id,
        tool: "file",
        args: {},
        observation: "",
        ok: true,
        approval: {
          required: false,
          reason: "Restored checkpoint",
          risk: "low",
          checkpointId: firstCp.id,
          relatedCheckpointIds: matchedCheckpoints.slice(1).map((c) => c.id),
          rollbackAvailable: true
        },
        createdAt: firstCp.createdAt
      };
    } else {
      throw new RouteError("此操作没有可用的文件检查点，无法安全撤回代码更改。对话记录未删除。", 400);
    }
  }

  const approval = existing.approval;
  if (!approval?.checkpointId) {
    throw new RouteError("No rollback checkpoint is available for this action.", 400);
  }

  const checkpointIds = [approval.checkpointId, ...(approval.relatedCheckpointIds ?? [])].filter(
    (id): id is string => Boolean(id)
  );
  const observations: string[] = [];
  const expectedContext = request.body as { instanceId?: string | null } | undefined;
  const globalAdmin = expectedContext?.instanceId === null && (await assertSakiSessionAccess(request.user.sub, null)).user.isSuperAdmin;
  for (const checkpointId of checkpointIds) {
    const checkpoint = sakiCheckpoints.get(checkpointId);
    if (!checkpoint) continue;
    if (expectedContext && Object.hasOwn(expectedContext, "instanceId") && "instanceId" in checkpoint
      && checkpoint.instanceId !== expectedContext.instanceId && !globalAdmin) throw new RouteError("Checkpoint does not belong to the active workspace.", 403);
    await assertCheckpointRollbackAccess(request.user.sub, checkpoint);
  }
  for (const checkpointId of [...checkpointIds].reverse()) {
    const checkpoint = sakiCheckpoints.get(checkpointId);
    if (!checkpoint) continue;
    observations.push(await rollbackCheckpoint(request.user.sub, checkpoint));
    await removeCheckpoint(checkpoint.id);
  }
  if (observations.length === 0) throw new RouteError("Rollback checkpoint expired or was already removed.", 404);
  const observation = observations.join("\n");
  const action: SakiAgentAction = {
    ...existing,
    observation,
    ok: true,
    status: "rolled_back",
    approval: {
      ...approval,
      rollbackAvailable: false
    },
    createdAt: new Date().toISOString()
  };
  await saveCompletedSakiAction(action);
  await writeAuditLog({
    request,
    userId: request.user.sub,
    action: "saki.agent.rollback",
    resourceType: "saki",
    resourceId: id,
    payload: { checkpointId: approval.checkpointId, checkpointIds, rolledBackCount: observations.length }
  });
  return { action, message: "Rollback completed." };
}

export function rollbackSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  return withPendingSakiActionDecision(id, async () => {
    await sakiActionsReady;
    const checkpoint = [...sakiCheckpoints.values()].find((item) => item.actionId === id || item.id === id);
    return withSakiWorkspaceMutation(checkpoint && "instanceId" in checkpoint ? checkpoint.instanceId : "global",
      () => rollbackSakiActionUnlocked(request, id));
  });
}

async function rollbackSakiTaskUnlocked(
  request: FastifyRequest,
  taskId: string
): Promise<{ ok: boolean; rolledBackCount: number; notes: string[]; message: string }> {
  const task = getActiveSakiTaskById(taskId);
  if (!task || task.userId !== request.user.sub) {
    throw new RouteError("Task not found.", 404);
  }

  // If task is still running, cancel it first so no new edits occur
  if (task.status === "running") {
    cancelActiveSakiTask(taskId);
  }

  // Gather action IDs produced by this task
  const actionIds = new Set<string>();
  for (const ev of task.eventsBuffer) {
    if (ev.type === "action") {
      const act = ev.payload?.action as { id?: string } | undefined;
      if (act?.id) actionIds.add(act.id);
    }
  }
  if (task.response?.actions) {
    for (const act of task.response.actions) {
      if (act?.id) actionIds.add(act.id);
    }
  }

  // Find all checkpoints related to this task
  const matchedCheckpoints: SakiCheckpoint[] = [];
  for (const cp of sakiCheckpoints.values()) {
    const matchesTaskId = ("taskId" in cp && cp.taskId === taskId) || ("taskOriginId" in cp && cp.taskOriginId === taskId);
    const matchesAction = Boolean(cp.actionId && actionIds.has(cp.actionId));
    if (matchesTaskId || matchesAction) {
      matchedCheckpoints.push(cp);
    }
  }

  if (matchedCheckpoints.length === 0) {
    return {
      ok: true,
      rolledBackCount: 0,
      notes: [],
      message: "该任务没有产生可回溯的代码修改或检查点已失效。"
    };
  }

  // Reverse chronological order
  matchedCheckpoints.sort((a, b) => {
    const timeA = Date.parse(a.createdAt) || 0;
    const timeB = Date.parse(b.createdAt) || 0;
    return timeA - timeB;
  }).reverse();
  for (const checkpoint of matchedCheckpoints) await assertCheckpointRollbackAccess(request.user.sub, checkpoint);

  const notes: string[] = [];
  const restoredActions = new Set<string>();
  let rolledBackCount = 0;
  let failed = false;
  for (const cp of matchedCheckpoints) {
    try {
      const note = await rollbackCheckpoint(request.user.sub, cp);
      notes.push(note);
      await removeCheckpoint(cp.id);
      rolledBackCount++;
      restoredActions.add(cp.actionId);
    } catch (err) {
      notes.push(`检查点回退失败 (${cp.id}): ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
      break;
    }
  }

  for (const actionId of restoredActions) {
    if ([...sakiCheckpoints.values()].some((cp) => cp.actionId === actionId)) continue;
    const action = completedSakiActions.get(actionId);
    if (action) {
      action.status = "rolled_back";
      if (action.approval) {
        action.approval.rollbackAvailable = false;
      }
      await saveCompletedSakiAction(action);
    }
  }

  if (task.instanceId) {
    invalidateInstanceFileCache(task.instanceId);
  }

  await writeAuditLog({
    request,
    userId: request.user.sub,
    action: "saki.agent.task_rollback",
    resourceType: "saki_task",
    resourceId: taskId,
    payload: { rolledBackCount, notes, failed }
  });

  return {
    ok: !failed,
    rolledBackCount,
    notes,
    message: failed ? `已回溯 ${rolledBackCount} 处修改，其余修改未完成，请处理冲突后重试。` : `已成功回溯 ${rolledBackCount} 处修改。`
  };
}

export async function rollbackSakiTask(request: FastifyRequest, taskId: string): Promise<{ ok: boolean; rolledBackCount: number; notes: string[]; message: string }> {
  await sakiActionsReady;
  const task = getActiveSakiTaskById(taskId);
  if (!task || task.userId !== request.user.sub) throw new RouteError("Task not found.", 404);
  await assertSakiTaskAccess(request.user.sub, task);
  if (task.status === "running") {
    cancelActiveSakiTask(taskId);
    await task.execution?.catch(() => undefined);
  }
  return withSakiWorkspaceMutation(task.instanceId ?? "global", () => rollbackSakiTaskUnlocked(request, taskId));
}
