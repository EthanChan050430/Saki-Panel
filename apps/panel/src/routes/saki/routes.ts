import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
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
import { writeAuditLog } from "../../audit.js";
import {
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
import { emitAgentFinalText, runSakiAgent } from "./loop.js";
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
import {
  cancelActiveSakiTask,
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
  listSakiActiveTasks,
  formatSessionFollowUpContext,
  getSessionAgentMemory,
  toSakiActiveTaskSummary
} from "./state.js";
import {
  effectiveSakiAgentPermissionMode,
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
export async function registerSakiRoutes(app: FastifyInstance): Promise<void> {
  ensureSakiModulesReady();
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

  app.post("/api/saki/actions/:id/approve", { preHandler: requirePermission("saki.agent") }, async (request) => {
    const { id } = request.params as { id: string };
    return approvePendingSakiAction(request, id);
  });

  app.post("/api/saki/actions/:id/reject", { preHandler: requirePermission("saki.agent") }, async (request) => {
    const { id } = request.params as { id: string };
    return rejectPendingSakiAction(request, id);
  });

  app.post("/api/saki/actions/:id/rollback", { preHandler: requirePermission("saki.agent") }, async (request) => {
    const { id } = request.params as { id: string };
    return rollbackSakiAction(request, id);
  });

  app.post("/api/saki/chat/stream", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request, reply) => {
    const prepared = await prepareSakiChatInvocation(request, request.body as Partial<SakiChatRequest>);
    const { modelInput, context, skills } = prepared;
    await assertUserHasSpendablePoints(request.user.sub);
    const stream = startSakiEventStream(request, reply);
    const directEvents = createSakiAgentEvents(stream);
    const taskId = randomUUID();
    const isAgent = modelInput.mode === "agent";
    const instanceKeyId = context.workspace?.instanceId ?? null;
    const taskAbortController = new AbortController();

    if (isAgent) {
      cancelRunningSakiTasksForContext(request.user.sub, instanceKeyId);
      createActiveSakiTask(taskId, request.user.sub, instanceKeyId, modelInput, taskAbortController);
    }

    const events: Required<SakiAgentRunEvents> = {
      workflow: (update) => {
        directEvents.workflow(update);
        if (isAgent) emitActiveSakiTaskEvent(taskId, "workflow", update as unknown as Record<string, unknown>);
      },
      action: (action) => {
        directEvents.action(action);
        if (isAgent) emitActiveSakiTaskEvent(taskId, "action", { action: action as unknown as Record<string, unknown> });
      },
      delta: (text) => {
        directEvents.delta(text);
        if (isAgent) emitActiveSakiTaskEvent(taskId, "delta", { text });
      },
      thinking: (text) => {
        directEvents.thinking(text);
        if (isAgent) emitActiveSakiTaskEvent(taskId, "thinking", { text });
      }
    };

    try {
      stream.send("meta", {
        source: "direct-model",
        mode: modelInput.mode,
        agentPermissionMode: effectiveSakiAgentPermissionMode(modelInput),
        workspace: context.workspace,
        skills,
        taskId: isAgent ? taskId : undefined
      });

      const config = withRequestedSakiModel(await readEffectiveSakiConfig(), modelInput);
      let response: SakiChatResponse;
      if (isAgent) {
        const isContinuation = isSakiContinuationMessage(modelInput.message);
        let resumeState: SakiAgentResumeState | undefined;
        let agentInput = modelInput;
        const sessionMemory = getSessionAgentMemory(request.user.sub, instanceKeyId);
        if (sessionMemory) {
          if (isContinuation) {
            resumeState = sessionMemory.resumeState;
          } else {
            const notes = formatSessionFollowUpContext(sessionMemory);
            agentInput = {
              ...modelInput,
              contextText: [modelInput.contextText, notes].filter(Boolean).join("\n\n")
            };
          }
        }

        response = await runSakiAgent(
          {
            request,
            input: agentInput,
            context,
            skills,
            userId: request.user.sub,
            permissions: request.user.permissions,
            config,
            abortController: taskAbortController,
            taskId
          },
          events,
          resumeState,
          executeSakiAgentTool
        );
        finishActiveSakiTask(taskId, "completed", response);
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
      if (isAgent) {
        finishActiveSakiTask(taskId, "failed", fallback, reason);
      }
      await auditSakiChatResponse(request, prepared, fallback, "FAILURE", reason);
      stream.send("done", { response: fallback });
    } finally {
      stream.end();
    }
  });

  app.get("/api/saki/active-tasks", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const tasks = listSakiActiveTasks(request.user.sub);
    return {
      tasks: tasks.map(toSakiActiveTaskSummary),
      runningCount: tasks.filter((task) => task.status === "running").length
    };
  });

  app.get("/api/saki/active-task", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const query = request.query as { instanceId?: string };
    const task = getActiveSakiTask(request.user.sub, query.instanceId ?? null);
    if (!task) {
      return { hasActiveTask: false };
    }
    return {
      hasActiveTask: true,
      task: toSakiActiveTaskSummary(task)
    };
  });

  app.get("/api/saki/tasks/:taskId/stream", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = getActiveSakiTaskById(taskId);
    if (!task || task.userId !== request.user.sub) {
      throw new RouteError("Task not found.", 404);
    }
    const stream = startSakiEventStream(request, reply);
    stream.send("meta", {
      source: "direct-model",
      mode: task.input.mode ?? "agent",
      agentPermissionMode: effectiveSakiAgentPermissionMode(task.input),
      taskId: task.id,
      status: task.status
    });

    // Replay all buffered events that occurred while the client was disconnected:
    for (const event of task.eventsBuffer) {
      stream.send(event.type, event.payload);
    }

    if (task.status === "completed" && task.response) {
      stream.send("done", { response: task.response });
      stream.end();
      return;
    }

    if (task.status === "failed" || task.status === "cancelled") {
      stream.send("error", { message: task.error || "Task failed" });
      stream.end();
      return;
    }

    // Subscribe to live events
    const subscriber = (event: SakiActiveTaskEvent) => {
      stream.send(event.type, event.payload);
      if (event.type === "done" || event.type === "error") {
        stream.end();
        task.subscribers.delete(subscriber);
      }
    };
    task.subscribers.add(subscriber);
    reply.raw.on("close", () => {
      task.subscribers.delete(subscriber);
    });
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

  app.post("/api/saki/chat", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const prepared = await prepareSakiChatInvocation(request, request.body as Partial<SakiChatRequest>);
    const { modelInput, context, skills } = prepared;
    await assertUserHasSpendablePoints(request.user.sub);

    try {
      const config = withRequestedSakiModel(await readEffectiveSakiConfig(), modelInput);
      if (modelInput.mode === "agent") {
        const instanceKeyId = context.workspace?.instanceId ?? null;
        const isContinuation = isSakiContinuationMessage(modelInput.message);
        let resumeState: SakiAgentResumeState | undefined;
        let agentInput = modelInput;
        const sessionMemory = getSessionAgentMemory(request.user.sub, instanceKeyId);
        if (sessionMemory) {
          if (isContinuation) {
            resumeState = sessionMemory.resumeState;
          } else {
            const notes = formatSessionFollowUpContext(sessionMemory);
            agentInput = {
              ...modelInput,
              contextText: [modelInput.contextText, notes].filter(Boolean).join("\n\n")
            };
          }
        }

        const response = await runSakiAgent(
          {
            request,
            input: agentInput,
            context,
            skills,
            userId: request.user.sub,
            permissions: request.user.permissions,
            config
          },
          undefined,
          resumeState,
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
    const existing = await prisma.sakiConversation.findUnique({ where: { id } });
    if (existing && existing.userId !== request.user.sub) {
      throw new RouteError("Forbidden", 403);
    }
    const record = await prisma.sakiConversation.upsert({
      where: { id },
      create: {
        id,
        userId: request.user.sub,
        contextKey: typeof body.contextKey === "string" ? body.contextKey : "global",
        title: typeof body.title === "string" ? body.title : "新对话",
        label: typeof body.label === "string" ? body.label : "Saki",
        detail: typeof body.detail === "string" ? body.detail : "",
        instanceId: typeof body.instanceId === "string" ? body.instanceId : null,
        messages: JSON.stringify(Array.isArray(body.messages) ? body.messages : [])
      },
      update: {
        ...(typeof body.contextKey === "string" ? { contextKey: body.contextKey } : {}),
        ...(typeof body.instanceId === "string" ? { instanceId: body.instanceId } : {}),
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.label === "string" ? { label: body.label } : {}),
        ...(typeof body.detail === "string" ? { detail: body.detail } : {}),
        ...(Array.isArray(body.messages) ? { messages: JSON.stringify(body.messages) } : {})
      }
    });
    return { ok: true, id: record.id };
  });

  app.delete("/api/saki/conversations/:id", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.sakiConversation.deleteMany({
      where: { id, userId: request.user.sub }
    });
    return { ok: true };
  });

  app.delete("/api/saki/conversations", { preHandler: requireAnyPermission(sakiUsePermissions) }, async (request) => {
    await prisma.sakiConversation.deleteMany({
      where: { userId: request.user.sub }
    });
    return { ok: true };
  });
}

