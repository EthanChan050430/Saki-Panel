import type { FastifyRequest } from "fastify";
import type { PermissionCode, SakiActionDecisionResponse, SakiAgentAction, SakiChatResponse } from "@webops/shared";
import { writeAuditLog } from "../../audit.js";
import { assertUserHasSpendablePoints } from "../../points.js";
import { runSakiAgent, renderToolCall, observationForAgentPrompt } from "./loop.js";
import { ensureToolCallId } from "./agent-messages.js";
import { auditAgentTool, executeSakiAgentTool, rollbackCheckpoint } from "./executor.js";
import {
  cancelActiveSakiTask,
  completedSakiActions,
  getActiveSakiTaskById,
  invalidateInstanceFileCache,
  pendingSakiActions,
  removeCheckpoint,
  removePendingSakiAction,
  sakiCheckpoints,
  saveCompletedSakiAction
} from "./state.js";
import { toolArgs } from "./tools.js";
import type { PendingSakiAction, SakiAgentResumeState, SakiAgentRuntime, SakiCheckpoint } from "./types.js";
import { effectiveSakiAgentPermissionMode, RouteError, withRequestedSakiModel } from "./types.js";
import { readEffectiveSakiConfig } from "./config.js";
import { resolveSakiContext } from "./chat.js";
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
  const context = await resolveSakiContext(user.id, pending.contextInstanceId, false);
  const input = pending.resume?.input ?? {
    message: "approved Saki action",
    history: [],
    instanceId: pending.contextInstanceId,
    mode: "agent" as const
  };
  const config = withRequestedSakiModel(await readEffectiveSakiConfig(), input);
  return {
    ...(request ? { request } : {}),
    input,
    context,
    skills: pending.resume?.skills ?? [],
    userId: user.id,
    permissions: user.permissions,
    config,
    ...(pending.kind ? { kind: pending.kind } : {}),
    ...(pending.incidentId ? { incidentId: pending.incidentId } : {}),
    ...(pending.watchMode ? { watchMode: pending.watchMode } : {}),
    ...(pending.maxLoops ? { maxLoops: pending.maxLoops } : {}),
    ...(pending.systemPromptOverride ? { systemPromptOverride: pending.systemPromptOverride } : {})
  };
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

async function continueSakiAgentAfterActionDecision(
  pending: PendingSakiAction,
  action: SakiAgentAction,
  runtime: SakiAgentRuntime
): Promise<SakiChatResponse | undefined> {
  const resume = resumeAfterSakiActionDecision(pending, action);
  if (!resume) return undefined;
  try {
    await assertUserHasSpendablePoints(runtime.userId);
    return await runSakiAgent(runtime, undefined, resume, executeSakiAgentTool);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Saki request failed";
    return {
      source: "local-fallback",
      message: `The action ran, but Saki could not continue the follow-up response: ${reason}`,
      workspace: runtime.context.workspace,
      agentPermissionMode: effectiveSakiAgentPermissionMode(runtime.input),
      skills: runtime.skills,
      actions: resume.actions
    };
  }
}

// 请求无关的批准执行核心：HTTP 处理器与 watch 自治策略共用同一条路径，行为保持一致。
export async function executeApprovedSakiAction(
  id: string,
  user: { id: string; permissions: PermissionCode[] },
  request?: FastifyRequest
): Promise<SakiActionDecisionResponse> {
  const pending = pendingSakiActions.get(id);
  if (!pending) throw new RouteError("Pending Saki action not found or already handled.", 404);
  assertPendingSakiActionOwner(user.id, pending);
  const runtime = await runtimeForSakiActionDecision(user, pending, request);
  const action = await executeSakiAgentTool(runtime, pending.call, { approved: true, actionId: id });
  await removePendingSakiAction(id);
  const response = await continueSakiAgentAfterActionDecision(pending, action, runtime);
  if (pending.incidentId) {
    await maybeFinishWatchIncident(pending.incidentId);
  }
  return {
    action,
    message: action.ok ? "Saki action approved and executed." : "Saki action was approved but failed.",
    ...(response ? { response } : {})
  };
}

export async function approvePendingSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  return executeApprovedSakiAction(id, { id: request.user.sub, permissions: request.user.permissions }, request);
}

export async function rejectPendingSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  const pending = pendingSakiActions.get(id);
  if (!pending) throw new RouteError("Pending Saki action not found or already handled.", 404);
  assertPendingSakiActionOwner(request.user.sub, pending);
  await removePendingSakiAction(id);
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
  if (pending.incidentId) {
    await updateIncident(pending.incidentId, {
      status: "diagnosed",
      summary: "用户拒绝了这次自动修复。诊断结果仍可查看。"
    });
  }
  return { action, message: "Saki action rejected." };
}

export async function rollbackSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
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
      await saveCompletedSakiAction(existing);
    } else {
      throw new RouteError("No rollback checkpoint is available for this action.", 400);
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

export async function rollbackSakiTask(
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
    return timeB - timeA;
  });

  const notes: string[] = [];
  for (const cp of matchedCheckpoints) {
    try {
      const note = await rollbackCheckpoint(request.user.sub, cp);
      notes.push(note);
      await removeCheckpoint(cp.id);
    } catch (err) {
      notes.push(`检查点回退失败 (${cp.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const actionId of actionIds) {
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
    payload: { rolledBackCount: notes.length, notes }
  });

  return {
    ok: true,
    rolledBackCount: notes.length,
    notes,
    message: `已成功回溯 ${notes.length} 处修改。`
  };
}
