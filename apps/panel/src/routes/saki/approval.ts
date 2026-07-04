import type { FastifyRequest } from "fastify";
import type { SakiActionDecisionResponse, SakiAgentAction, SakiChatResponse } from "@webops/shared";
import { writeAuditLog } from "../../audit.js";
import { runSakiAgent, renderToolCall, observationForAgentPrompt } from "./loop.js";
import { auditAgentTool, executeSakiAgentTool, rollbackCheckpoint } from "./executor.js";
import { completedSakiActions, pendingSakiActions, removeCheckpoint, removePendingSakiAction, sakiCheckpoints } from "./state.js";
import { toolArgs } from "./tools.js";
import type { PendingSakiAction, SakiAgentResumeState, SakiAgentRuntime } from "./types.js";
import { effectiveSakiAgentPermissionMode, RouteError } from "./types.js";
import { readEffectiveSakiConfig } from "./config.js";
import { resolveSakiContext } from "./chat.js";

function assertPendingSakiActionOwner(request: FastifyRequest, pending: PendingSakiAction): void {
  if (pending.userId !== request.user.sub) {
    throw new RouteError("Pending Saki action not found or already handled.", 404);
  }
}

async function runtimeForSakiActionDecision(request: FastifyRequest, pending: PendingSakiAction): Promise<SakiAgentRuntime> {
  const context = await resolveSakiContext(request.user.sub, pending.contextInstanceId, false);
  const config = await readEffectiveSakiConfig();
  return {
    request,
    input: pending.resume?.input ?? {
      message: "approved Saki action",
      history: [],
      instanceId: pending.contextInstanceId,
      mode: "agent"
    },
    context,
    skills: pending.resume?.skills ?? [],
    userId: request.user.sub,
    permissions: request.user.permissions,
    config
  };
}

function resumeAfterSakiActionDecision(pending: PendingSakiAction, action: SakiAgentAction): SakiAgentResumeState | null {
  if (!pending.resume) return null;
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
    toolExecutions: pending.resume.toolExecutions + 1
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

export async function approvePendingSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  const pending = pendingSakiActions.get(id);
  if (!pending) throw new RouteError("Pending Saki action not found or already handled.", 404);
  assertPendingSakiActionOwner(request, pending);
  const runtime = await runtimeForSakiActionDecision(request, pending);
  const action = await executeSakiAgentTool(runtime, pending.call, { approved: true, actionId: id });
  await removePendingSakiAction(id);
  const response = await continueSakiAgentAfterActionDecision(pending, action, runtime);
  return {
    action,
    message: action.ok ? "Saki action approved and executed." : "Saki action was approved but failed.",
    ...(response ? { response } : {})
  };
}

export async function rejectPendingSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  const pending = pendingSakiActions.get(id);
  if (!pending) throw new RouteError("Pending Saki action not found or already handled.", 404);
  assertPendingSakiActionOwner(request, pending);
  await removePendingSakiAction(id);
  const runtime = await runtimeForSakiActionDecision(request, pending);
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
  await auditAgentTool(runtime, action);
  return { action, message: "Saki action rejected." };
}

export async function rollbackSakiAction(request: FastifyRequest, id: string): Promise<SakiActionDecisionResponse> {
  const existing = completedSakiActions.get(id);
  if (!existing?.approval?.checkpointId) {
    throw new RouteError("No rollback checkpoint is available for this action.", 400);
  }
  const checkpoint = sakiCheckpoints.get(existing.approval.checkpointId);
  if (!checkpoint) throw new RouteError("Rollback checkpoint expired or was already removed.", 404);
  const observation = await rollbackCheckpoint(request.user.sub, checkpoint);
  await removeCheckpoint(checkpoint.id);
  const action: SakiAgentAction = {
    ...existing,
    observation,
    ok: true,
    status: "rolled_back",
    approval: {
      ...existing.approval,
      rollbackAvailable: false
    },
    createdAt: new Date().toISOString()
  };
  completedSakiActions.set(id, action);
  await writeAuditLog({
    request,
    userId: request.user.sub,
    action: "saki.agent.rollback",
    resourceType: "saki",
    resourceId: id,
    payload: { checkpointId: checkpoint.id, checkpointType: checkpoint.type }
  });
  return { action, message: "Rollback completed." };
}
