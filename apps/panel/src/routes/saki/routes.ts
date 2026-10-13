import fs from "node:fs/promises";
import { sakiWorkspaceContextKey, sakiWorkspaceIdsFromContextKey } from "@webops/shared";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateSakiSkillRequest,
  DownloadSakiSkillRequest,
  SakiChatRequest,
  SakiChatResponse,
  SakiSkillDetail,
  SakiStatusResponse,
  UpdateSakiConfigRequest,
  UpdateSakiSkillRequest
} from "@webops/shared";
import { requireAnyPermission, requirePermission } from "../../auth.js";
import { loadVisibleInstance, listVisibleInstances } from "../../instance-access.js";
import { requestDaemon } from "../../daemon-client.js";
import { writeAuditLog } from "../../audit.js";
import {
  answerPendingSakiQuestion,
  approvePendingSakiAction,
  rejectPendingSakiAction,
  rollbackSakiAction,
  rollbackSakiTask
} from "./approval.js";
import { ensureSakiModulesReady } from "./bootstrap.js";
import {
  auditSakiChatResponse,
  callConfiguredModel,
  callConfiguredModelStream,
  detectSakiModels,
  directLocalFallback,
  prepareSakiChatInvocation
} from "./chat.js";
import { readEffectiveSakiConfig, saveSakiConfig } from "./config.js";
import { startAppearanceEventStream } from "./appearance-events.js";
import { executeSakiAgentTool } from "./executor.js";
import { readSakiGeneratedImage } from "./generated-images.js";
import { emitAgentFinalText, runSakiAgent } from "./loop.js";
import { buildChatModeSystemPrompt } from "./prompt.js";
import { assertUserHasSpendablePoints, recordAgentTokenUsage } from "../../points.js";
import {
  checkAntigravityAuthStatus,
  exchangeAntigravityOAuthCode,
  getAntigravityLoginUrl,
  loginAntigravityAccount,
  logoutAntigravityAccount,
  readCopilotAuthStatus,
  readCopilotLoginState,
  saveCopilotToken,
  startCopilotDeviceLogin,
  switchAntigravityAccount
} from "./providers.js";
import {
  downloadSakiSkill,
  loadSakiSkills,
  normalizeSkillInput,
  readSakiSkill,
  sakiSkillDirectory,
  saveSakiSkill,
  toSkillSummary
} from "./skills.js";
import { prisma } from "../../db.js";
import { createSakiAgentEvents, startSakiEventStream } from "./stream.js";
import { connectSakiTaskStream } from "./task-stream.js";
import { assertSakiSessionAccess, assertSakiTaskAccess, hasSakiProjectAccess, sakiProjectPermissions } from "./session-access.js";
import { withSakiWorkspaceMutation } from "./workspace-mutation.js";
import { createSakiTerminal } from "./terminals.js";
import { assertSakiWorkspaceBinding, bindSakiWorkspace } from "./workspace-binding.js";
import { runTrackedSakiTask, trackedSakiTaskEvents } from "./task-runner.js";
import { saveClientSakiConversation, withSakiConversationLock } from "./conversations.js";
import {
  cancelActiveSakiTask,
  activeSakiTasks,
  assertSakiTaskContextAvailable,
  cancelAllRunningSakiTasks,
  cancelRunningSakiTasksForContext,
  clearFinishedSakiTasks,
  createActiveSakiTask,
  deleteSakiTask,
  enqueueSakiTaskSteer,
  emitActiveSakiTaskEvent,
  finishActiveSakiTask,
  getActiveSakiTask,
  getActiveSakiTaskById,
  findSakiTaskByRequest,
  getLatestSakiTask,
  listSakiActiveTasks,
  pendingSakiActions,
  formatSessionFollowUpContext,
  getSessionAgentMemory,
  sessionAgentMemoriesReady,
  sakiActionsReady,
  startSakiTaskMaintenance,
  toSakiActiveTaskSummary
} from "./state.js";
import {
  effectiveSakiAgentPermissionMode,
  effectiveSakiTerminalSandbox,
  getModelPointsMultiplier,
  isSakiContinuationMessage,
  normalizeProviderId,
  objectValue,
  RouteError,
  sakiUsePermissions,
  trimString,
  withRequestedSakiModel,
  type SakiActiveTaskEvent,
  type SakiAgentResumeState,
  type SakiAgentRunEvents
} from "./types.js";

async function sakiGitTarget(request: FastifyRequest, instanceId: string, mutating: boolean) {
  if (!instanceId) throw new RouteError("请先选择项目。", 400);
  const mode = !mutating && !request.user.permissions.includes("saki.agent") ? "chat" : "agent";
  const { user } = await assertSakiSessionAccess(request.user.sub, null, mode);
  const instance = await loadVisibleInstance(user.id, instanceId);
  if (!instance || !hasSakiProjectAccess(user, instance)) throw new RouteError("Instance not found.", 404);
  const scoped = sakiProjectPermissions(user, instance, request.user.permissions);
  if (!scoped.includes("instance.view") || !(mutating ? scoped.includes("saki.agent") : scoped.includes("saki.agent") || scoped.includes("saki.chat"))) throw new RouteError("Instance not found.", 404);
  const required = mutating ? ["file.read", "file.write", "file.delete"] as const : ["file.read"] as const;
  if (!required.every((code) => scoped.includes(code))) throw new RouteError("Forbidden.", 403);
  return instance;
}

export async function startSakiTaskInvocation(request: FastifyRequest, prepared: Awaited<ReturnType<typeof prepareSakiChatInvocation>>) {
  const { modelInput, context, skills } = prepared;
  const scopeKey = sakiWorkspaceContextKey(modelInput.instanceId, modelInput.workspaceInstanceIds);
  const matchesScope = (input: SakiChatRequest) => scopeKey === sakiWorkspaceContextKey(input.instanceId, input.workspaceInstanceIds);
  await Promise.all([sessionAgentMemoriesReady, sakiActionsReady]);
  const previous = findSakiTaskByRequest(request.user.sub, modelInput.clientRequestId);
  if (previous) {
    await assertSakiTaskAccess(request.user.sub, previous);
    if (!matchesScope(previous.input) || previous.input.conversationId !== modelInput.conversationId) throw new RouteError("Client request belongs to another workspace or conversation.", 409);
    return previous;
  }
  const instanceId = context.workspace?.instanceId ?? null;
  let memory = getSessionAgentMemory(request.user.sub, instanceId);
  const continuation = Boolean(modelInput.resumeTaskId) || isSakiContinuationMessage(modelInput.message);
  if (memory && !matchesScope(memory.resumeState.input)) {
    if (continuation) throw new RouteError("工作区选择已改变，请描述一个新任务。", 409);
    memory = null;
  }
  if (memory && context.instance) {
    try {
      if (!memory.resumeState.workspaceBinding) throw new RouteError("Resume record has no workspace binding.", 409);
      assertSakiWorkspaceBinding(context.instance, memory.resumeState.workspaceBinding);
      for (const binding of memory.resumeState.workspaceBindings ?? []) {
        const target = context.instances?.find(item => item.id === binding.instanceId);
        if (!target) throw new RouteError("Workspace selection changed.", 409);
        assertSakiWorkspaceBinding(target, binding);
      }
    } catch {
      if (continuation) throw new RouteError("Workspace or node changed, or this resume record predates workspace binding. Describe a new task.", 409);
      memory = null;
    }
  }
  if (modelInput.resumeTaskId && memory?.resumeState.taskId !== modelInput.resumeTaskId) throw new RouteError("该任务的恢复记录已失效，无法安全重试。请重新描述任务。", 409);
  const config = withRequestedSakiModel(await readEffectiveSakiConfig(), modelInput);
  const resume = continuation ? memory?.resumeState : undefined;
  const input = resume ? { ...resume.input, ...modelInput, message: resume.input.message, attachments: resume.input.attachments ?? [] }
    : memory ? { ...modelInput, contextText: [modelInput.contextText, formatSessionFollowUpContext(memory)].filter(Boolean).join("\n\n") } : modelInput;
  // No await between this second deduplication check and claiming the context.
  const concurrent = findSakiTaskByRequest(request.user.sub, modelInput.clientRequestId);
  if (concurrent) {
    if (!matchesScope(concurrent.input) || concurrent.input.conversationId !== modelInput.conversationId) throw new RouteError("Client request belongs to another workspace or conversation.", 409);
    return concurrent;
  }
  assertSakiTaskContextAvailable(request.user.sub, instanceId);
  const abortController = new AbortController();
  const task = createActiveSakiTask(randomUUID(), request.user.sub, instanceId, modelInput, abortController);
  if (context.instance) task.workspaceBinding = bindSakiWorkspace(context.instance);
  if (context.instances) task.workspaceBindings = context.instances.map(bindSakiWorkspace);
  void runTrackedSakiTask(task, async () => {
    const response = await runSakiAgent({ request, input, context, skills, userId: request.user.sub, permissions: request.user.permissions, config, abortController, taskId: task.id }, trackedSakiTaskEvents(task.id), resume, executeSakiAgentTool);
    try { await auditSakiChatResponse(request, prepared, response); }
    catch (error) { console.warn("[Saki] Task audit failed:", error instanceof Error ? error.message : String(error)); }
    return response;
  });
  return task;
}
async function acceptQueryBearer(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const query = request.query as { token?: string };
  if (!request.headers.authorization && typeof query.token === "string" && query.token.trim()) {
    request.headers.authorization = `Bearer ${query.token.trim()}`;
  }
}

export async function registerSakiRoutes(app: FastifyInstance): Promise<void> {
  ensureSakiModulesReady();
  const stopTaskMaintenance = startSakiTaskMaintenance();
  app.addHook("onClose", async () => stopTaskMaintenance());
  app.get("/api/saki/appearance", async () => {
    const config = await readEffectiveSakiConfig();
    return config.appearance;
  });

  app.get("/api/saki/appearance/stream", async (request, reply) => {
    const config = await readEffectiveSakiConfig();
    const stream = startAppearanceEventStream(request, reply);
    stream.send("appearance", { appearance: config.appearance as unknown as Record<string, unknown> });
  });

  app.get("/api/saki/status", { preHandler: requireAnyPermission(sakiUsePermissions) }, async () => {
    const skillsState = await loadSakiSkills("coding");
    const config = await readEffectiveSakiConfig();
    const provider = normalizeProviderId(config.provider);
    const copilotAuth = provider === "copilot" ? await readCopilotAuthStatus() : null;
    const configured =
      provider === "ollama"
        ? Boolean(trimString(config.ollamaUrl) && trimString(config.model))
        : provider === "lmstudio"
          ? Boolean(trimString(config.ollamaUrl) && trimString(config.model))
          : provider === "copilot"
            ? Boolean(trimString(config.model) && copilotAuth?.authenticated)
            : Boolean(trimString(config.baseUrl) && trimString(config.apiKey) && trimString(config.model));
    const response: SakiStatusResponse = {
      reachable: configured,
      configured,
      skills: skillsState.skills,
      provider,
      model: config.model
    };
    if (!configured) response.message = copilotAuth?.message || "Model provider is not fully configured.";
    return response;
  });

  app.get("/api/saki/copilot/status", { preHandler: requirePermission("saki.configure") }, async () => {
    return readCopilotAuthStatus();
  });

  app.get("/api/saki/copilot/login", { preHandler: requirePermission("saki.configure") }, async () => {
    return readCopilotLoginState();
  });

  app.post("/api/saki/copilot/login", { preHandler: requirePermission("saki.configure") }, async (request) => {
    const body = objectValue(request.body) ?? {};
    const rawToken = body.token ?? body.gitHubToken ?? body.githubToken;
    const result = trimString(rawToken) ? await saveCopilotToken(trimString(rawToken)) : await startCopilotDeviceLogin();
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.copilot.login",
      resourceType: "saki",
      payload: {
        status: result.status,
        hasToken: Boolean(trimString(rawToken)),
        hasUserCode: Boolean(result.userCode)
      }
    });
    return result;
  });

  app.get("/api/saki/antigravity/status", { preHandler: requirePermission("saki.configure") }, async () => {
    const config = await readEffectiveSakiConfig();
    return checkAntigravityAuthStatus(config);
  });

  app.get("/api/saki/antigravity/login", { preHandler: requirePermission("saki.configure") }, async () => {
    return getAntigravityLoginUrl();
  });

  app.post("/api/saki/antigravity/exchange", { preHandler: requirePermission("saki.configure") }, async (request) => {
    const body = objectValue(request.body) ?? {};
    const code = trimString(body.code ?? body.authorizationCode ?? body.token);
    const sessionId = trimString(body.sessionId);
    const accountEmail = trimString(body.accountEmail ?? body.email);
    const config = await readEffectiveSakiConfig();
    const result = await exchangeAntigravityOAuthCode({ code, ...(sessionId ? { sessionId } : {}), ...(accountEmail ? { accountEmail } : {}) }, config);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.antigravity.exchange",
      resourceType: "saki",
      payload: {
        accountEmail: result.accountEmail,
        authenticated: result.authenticated
      }
    });
    return result;
  });

  app.post("/api/saki/antigravity/login", { preHandler: requirePermission("saki.configure") }, async (request) => {
    const body = objectValue(request.body) ?? {};
    const tokenOrKey = trimString(body.tokenOrKey ?? body.token ?? body.apiKey);
    const accountEmail = trimString(body.accountEmail ?? body.email);
    const config = await readEffectiveSakiConfig();
    const result = await loginAntigravityAccount({ tokenOrKey, ...(accountEmail ? { accountEmail } : {}) }, config);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.antigravity.login",
      resourceType: "saki",
      payload: {
        accountEmail: result.accountEmail,
        authenticated: result.authenticated
      }
    });
    return result;
  });

  app.post("/api/saki/antigravity/switch-account", { preHandler: requirePermission("saki.configure") }, async (request) => {
    const body = objectValue(request.body) ?? {};
    const accountEmail = trimString(body.accountEmail ?? body.email);
    const config = await readEffectiveSakiConfig();
    const result = await switchAntigravityAccount({ accountEmail }, config);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.antigravity.switch_account",
      resourceType: "saki",
      payload: {
        activeAccount: result.accountEmail
      }
    });
    return result;
  });

  app.post("/api/saki/antigravity/logout", { preHandler: requirePermission("saki.configure") }, async (request) => {
    const body = objectValue(request.body) ?? {};
    const accountEmail = trimString(body.accountEmail ?? body.email);
    const config = await readEffectiveSakiConfig();
    const result = await logoutAntigravityAccount({ ...(accountEmail ? { accountEmail } : {}) }, config);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.antigravity.logout",
      resourceType: "saki",
      payload: {
        removedAccount: accountEmail || "active"
      }
    });
    return result;
  });

  app.get("/api/saki/skills", { preHandler: requirePermission("saki.skills") }, async (request) => {
    const query = trimString((request.query as { q?: string }).q);
    const includeDisabled = (request.query as { all?: string }).all === "1";
    const state = await loadSakiSkills(query, includeDisabled);
    return state.skills;
  });

  app.get("/api/saki/skills/:id", { preHandler: requirePermission("saki.skills") }, async (request) => {
    const { id } = request.params as { id: string };
    const skill = await readSakiSkill(id, true);
    return {
      ...toSkillSummary(skill),
      content: skill.content,
      path: skill.filePath
    } satisfies SakiSkillDetail;
  });

  app.post("/api/saki/skills", { preHandler: requirePermission("saki.skills") }, async (request) => {
    const body = request.body as CreateSakiSkillRequest;
    const skill = await saveSakiSkill(normalizeSkillInput(body));
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.skill.create",
      resourceType: "saki",
      resourceId: skill.id,
      payload: { name: skill.name, tags: skill.tags ?? [] }
    });
    return {
      ...toSkillSummary(skill),
      content: skill.content,
      path: skill.filePath
    } satisfies SakiSkillDetail;
  });

  app.put("/api/saki/skills/:id", { preHandler: requirePermission("saki.skills") }, async (request) => {
    const { id } = request.params as { id: string };
    const current = await readSakiSkill(id, true);
    const body = request.body as UpdateSakiSkillRequest;
    const skill = await saveSakiSkill({
      ...normalizeSkillInput(body, current),
      id: current.id,
      sourceType: current.sourceType ?? "local",
      sourceUrl: current.sourceUrl ?? null
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.skill.update",
      resourceType: "saki",
      resourceId: skill.id,
      payload: { name: skill.name, enabled: skill.enabled !== false, tags: skill.tags ?? [] }
    });
    return {
      ...toSkillSummary(skill),
      content: skill.content,
      path: skill.filePath
    } satisfies SakiSkillDetail;
  });

  app.delete("/api/saki/skills/:id", { preHandler: requirePermission("saki.skills") }, async (request) => {
    const { id } = request.params as { id: string };
    const skill = await readSakiSkill(id, true);
    if (skill.builtin) {
      throw new RouteError("Built-in Skills can be disabled but not deleted.", 400);
    }
    await fs.rm(sakiSkillDirectory(skill.id), { recursive: true, force: true });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.skill.delete",
      resourceType: "saki",
      resourceId: skill.id,
      payload: { name: skill.name }
    });
    return { ok: true };
  });

  app.post("/api/saki/skills/download", { preHandler: requirePermission("saki.skills") }, async (request) => {
    const body = request.body as DownloadSakiSkillRequest;
    const skill = await downloadSakiSkill(body);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.skill.download",
      resourceType: "saki",
      resourceId: skill.id,
      payload: { name: skill.name, sourceUrl: skill.sourceUrl ?? null }
    });
    return {
      ...toSkillSummary(skill),
      content: skill.content,
      path: skill.filePath
    } satisfies SakiSkillDetail;
  });

  app.get("/api/saki/config", { preHandler: requirePermission("saki.configure") }, async () => {
    return readEffectiveSakiConfig();
  });

  app.put("/api/saki/config", { preHandler: requirePermission("saki.configure") }, async (request) => {
    const body = request.body as UpdateSakiConfigRequest;
    const saved = await saveSakiConfig(body);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.config.update",
      resourceType: "saki",
      payload: {
        provider: saved.provider,
        model: saved.model,
        ollamaUrl: saved.ollamaUrl,
        searchEnabled: saved.searchEnabled,
        mcpEnabled: saved.mcpEnabled,
        imageGenEnabled: saved.imageGen.enabled,
        imageGenProvider: saved.imageGen.provider,
        requestTimeoutMs: saved.requestTimeoutMs,
        appearanceTitle: saved.appearance.appTitle
      }
    });
    return saved;
  });

  app.post("/api/saki/models", { preHandler: requirePermission("saki.configure") }, async (request) => {
    const body = request.body as UpdateSakiConfigRequest;
    const result = await detectSakiModels(body);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.models.detect",
      resourceType: "saki",
      payload: {
        provider: result.provider,
        modelCount: result.models.length,
        warningCount: result.warnings.length
      }
    });
    return result;
  });

  app.post("/api/saki/actions/:id/approve", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { id } = request.params as { id: string };
    return approvePendingSakiAction(request, id);
  });

  app.post("/api/saki/terminals", { preHandler: requirePermission("saki.agent") }, async (request) => {
    const body = request.body as { instanceId?: unknown } | undefined;
    return createSakiTerminal(request.user.sub, request.user.permissions, typeof body?.instanceId === "string" ? body.instanceId.trim() : "");
  });

  app.post("/api/saki/actions/:id/reject", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { id } = request.params as { id: string };
    return rejectPendingSakiAction(request, id);
  });

  app.post("/api/saki/actions/:id/answer", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { id } = request.params as { id: string };
    return answerPendingSakiQuestion(request, id, (request.body ?? {}) as { selection?: unknown; customText?: unknown; skipped?: unknown });
  });

  app.post("/api/saki/actions/:id/rollback", { preHandler: requirePermission("saki.agent") }, async (request) => {
    const { id } = request.params as { id: string };
    return rollbackSakiAction(request, id);
  });

  app.post("/api/saki/chat/stream", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request, reply) => {
    const prepared = await prepareSakiChatInvocation(request, request.body as Partial<SakiChatRequest>);
    const { modelInput, context, skills } = prepared;
    await assertUserHasSpendablePoints(request.user.sub);
    if (modelInput.mode === "agent") {
      const task = await startSakiTaskInvocation(request, prepared);
      await assertSakiTaskAccess(request.user.sub, task);
      connectSakiTaskStream(task, request, reply, () => assertSakiTaskAccess(request.user.sub, task));
      return;
    }
    const stream = startSakiEventStream(request, reply);
    const directEvents = createSakiAgentEvents(stream);
    const taskAbortController = new AbortController();
    const abortDirectChat = () => taskAbortController.abort();
    reply.raw.once("close", abortDirectChat);
    const events = directEvents;

    try {
      const config = withRequestedSakiModel(await readEffectiveSakiConfig(), modelInput);
      stream.send("meta", {
        source: "direct-model",
        mode: modelInput.mode,
        agentPermissionMode: effectiveSakiAgentPermissionMode(modelInput),
        terminalSandbox: effectiveSakiTerminalSandbox(modelInput, config),
        workspace: context.workspace,
        skills
      });
      let response: SakiChatResponse;
      if (config.imageGen?.enabled || config.searchEnabled) {
        response = await runSakiAgent(
          {
            request,
            input: modelInput,
            context,
            skills,
            userId: request.user.sub,
            permissions: request.user.permissions,
            config,
            kind: "chat",
            toolProfile: "chat",
            maxLoops: 12,
            systemPromptOverride: buildChatModeSystemPrompt(Boolean(config.imageGen?.enabled), config.systemPrompt, config.searchEnabled),
            abortController: taskAbortController
          },
          events,
          undefined,
          executeSakiAgentTool
        );
      } else {
        let streamedAnyText = false;
        let replyText = "";
        let accumulatedThinking = "";
        let chatTokensUsed = 0;
        try {
          const streamed = await callConfiguredModelStream(
            modelInput,
            context,
            skills,
            (text) => {
              streamedAnyText = true;
              events.delta(text);
            },
            (text) => {
              accumulatedThinking += text;
              events.thinking(text);
            }
          );
          replyText = streamed.text;
          chatTokensUsed = streamed.tokensUsed;
        } catch (streamError) {
          const fallbackChat = await callConfiguredModel(modelInput, context, skills);
          replyText = fallbackChat.text;
          chatTokensUsed = fallbackChat.tokensUsed;
          if (!streamedAnyText) {
            await emitAgentFinalText(events, replyText);
          }
        }
        let chatUsage: any;
        try {
          const effectiveModel = modelInput.model || config.model || "default";
          const multiplier = getModelPointsMultiplier(config, effectiveModel, config.provider);
          chatUsage = await recordAgentTokenUsage(
            request.user.sub,
            chatTokensUsed,
            `Chat [${effectiveModel}]: ${String(modelInput.message || "问答").slice(0, 45)}`,
            multiplier
          );
        } catch {}
        response = {
          source: "direct-model",
          message: replyText,
          ...(accumulatedThinking.trim() ? { thinking: accumulatedThinking.trim() } : {}),
          terminalSandbox: effectiveSakiTerminalSandbox(modelInput, config),
          workspace: context.workspace,
          skills,
          ...(chatUsage ? { usage: chatUsage } : {})
        };
      }

      await auditSakiChatResponse(request, prepared, response);
      stream.send("done", { response });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Saki request failed";
      const fallback = directLocalFallback(modelInput, context, skills, reason);
      await auditSakiChatResponse(request, prepared, fallback, "FAILURE", reason);
      stream.send("done", { response: fallback });
    } finally {
      reply.raw.off("close", abortDirectChat);
      stream.end();
    }
  });

  app.get("/api/saki/active-tasks", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const candidates = listSakiActiveTasks(request.user.sub);
    const access = await Promise.all(candidates.map(async (task) => { try { await assertSakiTaskAccess(request.user.sub, task); return true; } catch { return false; } }));
    const tasks = candidates.filter((_, index) => access[index]);
    return {
      tasks: tasks.map(toSakiActiveTaskSummary),
      runningCount: tasks.filter((task) => task.status === "running").length
    };
  });

  app.get("/api/saki/active-task", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const query = request.query as { instanceId?: string; includeFinished?: string };
    const task = query.includeFinished === "1" ? getLatestSakiTask(request.user.sub, query.instanceId ?? null) : getActiveSakiTask(request.user.sub, query.instanceId ?? null);
    if (!task) {
      return { hasActiveTask: false };
    }
    await assertSakiTaskAccess(request.user.sub, task);
    return {
      hasActiveTask: true,
      task: toSakiActiveTaskSummary(task)
    };
  });

  app.get("/api/saki/tasks/:taskId", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const task = getActiveSakiTaskById((request.params as { taskId: string }).taskId);
    if (!task || task.userId !== request.user.sub) throw new RouteError("Task not found.", 404);
    await assertSakiTaskAccess(request.user.sub, task);
    return toSakiActiveTaskSummary(task);
  });

  app.get("/api/saki/tasks/:taskId/stream", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = getActiveSakiTaskById(taskId);
    if (!task || task.userId !== request.user.sub) {
      throw new RouteError("Task not found.", 404);
    }
    await assertSakiTaskAccess(request.user.sub, task);
    connectSakiTaskStream(task, request, reply, () => assertSakiTaskAccess(request.user.sub, task));
  });

  app.post("/api/saki/tasks/:taskId/cancel", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const task = getActiveSakiTaskById(taskId);
    if (!task || task.userId !== request.user.sub) {
      throw new RouteError("Task not found.", 404);
    }
    const cancelled = cancelActiveSakiTask(taskId);
    return { ok: cancelled };
  });

  app.post("/api/saki/tasks/:taskId/steer", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const task = getActiveSakiTaskById(taskId);
    if (!task || task.userId !== request.user.sub) {
      throw new RouteError("Task not found.", 404);
    }
    await assertSakiTaskAccess(request.user.sub, task);
    const body = objectValue(request.body) ?? {};
    const message = trimString(body.message);
    if (!message) {
      throw new RouteError("Steer message is required.", 400);
    }
    const ok = enqueueSakiTaskSteer(taskId, message);
    if (!ok) {
      throw new RouteError("Task is not running.", 409);
    }
    return { ok: true };
  });

  app.post("/api/saki/tasks/cancel-all", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const cancelledCount = cancelAllRunningSakiTasks(request.user.sub);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.agent.cancel_all_tasks",
      resourceType: "saki_task",
      payload: { cancelledCount }
    });
    return { ok: true, cancelledCount };
  });

  app.delete("/api/saki/tasks/finished", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const deletedCount = clearFinishedSakiTasks(request.user.sub);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.agent.clear_finished_tasks",
      resourceType: "saki_task",
      payload: { deletedCount }
    });
    return { ok: true, deletedCount };
  });

  app.delete("/api/saki/tasks/:taskId", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    const task = getActiveSakiTaskById(taskId);
    if (!task || task.userId !== request.user.sub) {
      throw new RouteError("Task not found.", 404);
    }
    const deleted = deleteSakiTask(taskId, request.user.sub);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "saki.agent.delete_task",
      resourceType: "saki_task",
      resourceId: taskId
    });
    return { ok: deleted };
  });

  app.post("/api/saki/tasks/:taskId/rollback", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { taskId } = request.params as { taskId: string };
    return rollbackSakiTask(request, taskId);
  });

  app.get("/api/saki/git/changes-summary", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const query = request.query as { instanceId?: string } | undefined;
    const instanceId = typeof query?.instanceId === "string" ? query.instanceId.trim() : "";
    if (!instanceId) {
      return { available: false, initialized: false, filesCount: 0, additions: 0, deletions: 0, changes: [], diff: "", canRestore: false };
    }
    const targetInstance = await sakiGitTarget(request, instanceId, false);
    const q = new URLSearchParams({ workingDirectory: targetInstance.workingDirectory });
    return requestDaemon(targetInstance.node, `/api/instances/${encodeURIComponent(targetInstance.id)}/git/changes-summary?${q}`, {}, 30000);
  });

  for (const operation of ["revert-all", "restore-all"] as const) {
    app.post(`/api/saki/git/${operation}`, { preHandler: requirePermission("saki.agent") }, async (request) => {
      const body = request.body as { instanceId?: string } | undefined;
      const instanceId = typeof body?.instanceId === "string" ? body.instanceId.trim() : "";
      if (!instanceId) throw new RouteError("请先选择项目。", 400);
      return withSakiWorkspaceMutation(instanceId, async () => {
        const instance = await sakiGitTarget(request, instanceId, true);
        const result = await requestDaemon(instance.node, `/api/instances/${encodeURIComponent(instance.id)}/git/${operation}`, {
          method: "POST", body: JSON.stringify({ workingDirectory: instance.workingDirectory })
        }, 45000);
        await writeAuditLog({ request, userId: request.user.sub, action: `saki.git.${operation}`, resourceType: "instance", resourceId: instance.id });
        return result;
      });
    });
  }

  app.post("/api/saki/chat", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const prepared = await prepareSakiChatInvocation(request, request.body as Partial<SakiChatRequest>);
    const { modelInput, context, skills } = prepared;
    await assertUserHasSpendablePoints(request.user.sub);
    if (modelInput.mode === "agent") {
      const task = await startSakiTaskInvocation(request, prepared);
      return task.execution ?? task.response;
    }

    try {
      const config = withRequestedSakiModel(await readEffectiveSakiConfig(), modelInput);
      if (config.imageGen?.enabled || config.searchEnabled) {
        const response = await runSakiAgent(
          {
            request,
            input: modelInput,
            context,
            skills,
            userId: request.user.sub,
            permissions: request.user.permissions,
            config,
            kind: "chat",
            toolProfile: "chat",
            maxLoops: 12,
            systemPromptOverride: buildChatModeSystemPrompt(Boolean(config.imageGen?.enabled), config.systemPrompt, config.searchEnabled)
          },
          undefined,
          undefined,
          executeSakiAgentTool
        );
        await auditSakiChatResponse(request, prepared, response);
        return response;
      }

      const reply = await callConfiguredModel(modelInput, context, skills);
      let chatUsage: any;
      try {
        const effectiveModel = modelInput.model || config.model || "default";
        const multiplier = getModelPointsMultiplier(config, effectiveModel, config.provider);
        chatUsage = await recordAgentTokenUsage(
          request.user.sub,
          reply.tokensUsed,
          `Chat [${effectiveModel}]: ${String(modelInput.message || "问答").slice(0, 45)}`,
          multiplier
        );
      } catch {}
      const response = {
        source: "direct-model",
        message: reply.text,
        workspace: context.workspace,
        skills,
        usage: chatUsage
      } satisfies SakiChatResponse;
      await auditSakiChatResponse(request, prepared, response);
      return response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Saki request failed";
      const fallback = directLocalFallback(modelInput, context, skills, reason);
      await auditSakiChatResponse(request, prepared, fallback, "FAILURE", reason);
      return fallback;
    }
  });

  app.get(
    "/api/saki/generated-images/:id",
    { preHandler: [acceptQueryBearer, requireAnyPermission(sakiUsePermissions)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { record, bytes } = await readSakiGeneratedImage(request.user.sub, id);
      reply.header("content-type", record.mimeType || "image/png");
      reply.header("cache-control", "private, max-age=86400");
      reply.header("content-disposition", `inline; filename="${record.fileName.replace(/"/g, "")}"`);
      return reply.send(bytes);
    }
  );

  app.get("/api/saki/conversations", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const rows = await prisma.sakiConversation.findMany({
      where: { userId: request.user.sub },
      orderBy: { updatedAt: "desc" },
      take: 80
    });
    return rows.map((r) => {
      let parsedMessages: any[] = [];
      try {
        parsedMessages = JSON.parse(r.messages);
      } catch {}
      return {
        id: r.id,
        contextKey: r.contextKey,
        workspaceInstanceIds: sakiWorkspaceIdsFromContextKey(r.contextKey, r.instanceId),
        label: r.label,
        detail: r.detail,
        instanceId: r.instanceId,
        title: r.title,
        messages: parsedMessages,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString()
      };
    });
  });

  app.put("/api/saki/conversations/:id", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (!body || typeof body !== "object") {
      throw new RouteError("Invalid conversation data.", 400);
    }
    return saveClientSakiConversation(request.user.sub, id, body);
  });

  app.delete("/api/saki/conversations/:id", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { id } = request.params as { id: string };
    await withSakiConversationLock(id, async () => {
      const liveTask = [...activeSakiTasks.values()].some((task) => task.userId === request.user.sub && (task.input.conversationId ?? `task-${task.id}`) === id && (task.status === "running" || task.status === "pending_approval" || task.status === "pending_input" || task.execution || task.decisionInFlight || task.pendingHistorySync));
      const pendingDecision = [...pendingSakiActions.values()].some((pending) => pending.userId === request.user.sub && pending.resume && (pending.resume.input.conversationId ?? `task-${pending.resume.taskId}`) === id);
      if (liveTask || pendingDecision) throw new RouteError("请先停止或处理该对话的任务，再删除记录。", 409);
      await prisma.sakiConversation.deleteMany({ where: { id, userId: request.user.sub } });
    });
    return { ok: true };
  });

  app.delete("/api/saki/conversations", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    if ([...activeSakiTasks.values()].some((task) => task.userId === request.user.sub && (task.status === "running" || task.status === "pending_approval" || task.status === "pending_input" || task.execution || task.decisionInFlight || task.pendingHistorySync)) || [...pendingSakiActions.values()].some((pending) => pending.userId === request.user.sub && pending.resume)) throw new RouteError("请先停止、处理或完成同步中的任务，再清空记录。", 409);
    await prisma.sakiConversation.deleteMany({
      where: { userId: request.user.sub }
    });
    return { ok: true };
  });
}

