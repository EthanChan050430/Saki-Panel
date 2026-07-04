import type { FastifyRequest } from "fastify";
import type {
  SakiChatRequest,
  SakiChatResponse,
  SakiConfigResponse,
  SakiModelListResponse,
  SakiModelOption,
  SakiSkillSummary,
  UpdateSakiConfigRequest
} from "@webops/shared";
import { writeAuditLog } from "../../audit.js";
import { readDaemonInstanceLogs } from "../../daemon-client.js";
import { loadVisibleInstance } from "../../instance-access.js";
import { buildPrompt } from "./prompt.js";
import {
  callConfiguredPrompt,
  callConfiguredPromptStream,
  fetchAnthropicModelCatalog,
  fetchCopilotModelCatalog,
  fetchLmStudioModelCatalog,
  fetchOllamaModelCatalog,
  fetchOpenAiModelCatalog
} from "./providers.js";
import { buildAuditSearchContext } from "./audit.js";
import { loadSakiSkills, readSakiSkillsByIds, buildAutoAppliedSakiSkillContext } from "./skills.js";
import { readEffectiveSakiConfig } from "./config.js";
import {
  combinedSakiContextText,
  effectiveSakiAgentPermissionMode,
  hasPermission,
  logSakiModelEvent,
  normalizeProviderId,
  normalizeSakiAgentPermissionMode,
  requireSakiModePermission,
  requireUserPermission,
  sanitizeSakiInputAttachments,
  trimContextText,
  objectValue,
  trimString,
  type InstanceWithNode,
  type PreparedSakiChatInvocation,
  type ResolvedSakiContext
} from "./types.js";
import type { SakiWorkspaceContext } from "@webops/shared";

export function toWorkspaceContext(instance: InstanceWithNode | null): SakiWorkspaceContext | null {
  if (!instance) return null;
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    nodeName: instance.node.name,
    workingDirectory: instance.workingDirectory,
    status: instance.status,
    lastExitCode: instance.lastExitCode ?? null
  };
}

export async function resolveSakiContext(
  userId: string,
  instanceId: string | null | undefined,
  includeLogs = false
): Promise<ResolvedSakiContext> {
  if (!instanceId) {
    return { instance: null, workspace: null, logs: [] };
  }

  const instance = await loadVisibleInstance(userId, instanceId);
  if (!instance) {
    return { instance: null, workspace: null, logs: [] };
  }

  if (!includeLogs) {
    return {
      instance,
      workspace: toWorkspaceContext(instance),
      logs: []
    };
  }

  try {
    const logs = await readDaemonInstanceLogs(instance.node, instance.id, 180);
    return {
      instance,
      workspace: toWorkspaceContext(instance),
      logs: logs.lines
    };
  } catch {
    return {
      instance,
      workspace: toWorkspaceContext(instance),
      logs: []
    };
  }
}


export async function callConfiguredModel(input: SakiChatRequest, context: ResolvedSakiContext, skills: SakiSkillSummary[]) {
  const config = await readEffectiveSakiConfig();
  const prompt = buildPrompt(input, context, skills);
  const startedAt = Date.now();
  try {
    const text = await callConfiguredPrompt(input, prompt, config);
    logSakiModelEvent("chat.response", {
      mode: input.mode ?? "chat",
      promptChars: prompt.length,
      messageChars: text.length,
      durationMs: Date.now() - startedAt
    });
    return text;
  } catch (error) {
    logSakiModelEvent("chat.error", {
      mode: input.mode ?? "chat",
      promptChars: prompt.length,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function callConfiguredModelStream(
  input: SakiChatRequest,
  context: ResolvedSakiContext,
  skills: SakiSkillSummary[],
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
) {
  const config = await readEffectiveSakiConfig();
  const prompt = buildPrompt(input, context, skills);
  const startedAt = Date.now();
  try {
    const text = await callConfiguredPromptStream(input, prompt, onDelta, config, onThinking);
    logSakiModelEvent("chat.stream.response", {
      mode: input.mode ?? "chat",
      promptChars: prompt.length,
      messageChars: text.length,
      durationMs: Date.now() - startedAt
    });
    return text;
  } catch (error) {
    logSakiModelEvent("chat.stream.error", {
      mode: input.mode ?? "chat",
      promptChars: prompt.length,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function directLocalFallback(input: SakiChatRequest, context: ResolvedSakiContext, skills: SakiSkillSummary[], reason: string): SakiChatResponse {
  return {
    source: "local-fallback",
    workspace: context.workspace,
    ...(input.mode === "agent" ? { agentPermissionMode: effectiveSakiAgentPermissionMode(input) } : {}),
    skills,
    message: `模型接口暂时不可用：${reason}\n\n请检查模型服务、网络或 API 配置后重试。`
  };
}

function mapSakiModel(raw: unknown): SakiModelOption | null {
  const item = objectValue(raw);
  if (!item) return null;
  const provider = normalizeProviderId(item.provider);
  const id = trimString(item.id) || trimString(item.name);
  if (!id) return null;
  return {
    provider,
    id,
    name: trimString(item.name) || id,
    label: trimString(item.label) || id,
    vendor: trimString(item.vendor)
  };
}

export async function detectSakiModels(input: UpdateSakiConfigRequest = {}): Promise<SakiModelListResponse> {
  const current = await readEffectiveSakiConfig();
  const effective: SakiConfigResponse = {
    ...current,
    provider: input.provider !== undefined ? normalizeProviderId(input.provider) : current.provider,
    model: input.model !== undefined ? trimString(input.model) || current.model : current.model,
    ollamaUrl: input.ollamaUrl !== undefined ? trimString(input.ollamaUrl) || current.ollamaUrl : current.ollamaUrl,
    baseUrl: input.baseUrl !== undefined ? trimString(input.baseUrl) : current.baseUrl,
    apiKey: input.apiKey !== undefined ? trimString(input.apiKey) : current.apiKey,
    searchEnabled: input.searchEnabled !== undefined ? Boolean(input.searchEnabled) : current.searchEnabled,
    mcpEnabled: input.mcpEnabled !== undefined ? Boolean(input.mcpEnabled) : current.mcpEnabled
  };
  const providerId = normalizeProviderId(effective.provider);
  const warnings: SakiModelListResponse["warnings"] = [];
  let models: SakiModelOption[] = [];

  if (providerId === "ollama") {
    models = await fetchOllamaModelCatalog(effective);
  } else if (providerId === "lmstudio") {
    models = await fetchLmStudioModelCatalog(effective);
  } else if (providerId === "anthropic") {
    models = await fetchAnthropicModelCatalog(effective);
  } else if (providerId === "copilot") {
    models = await fetchCopilotModelCatalog(effective);
  } else {
    models = await fetchOpenAiModelCatalog(providerId, effective);
  }

  return {
    provider: providerId,
    models,
    warnings,
    message: models.length > 0 ? `Detected ${models.length} model(s).` : "No models were detected for this provider."
  };
}

export async function prepareSakiChatInvocation(
  request: FastifyRequest,
  body: Partial<SakiChatRequest>
): Promise<PreparedSakiChatInvocation> {
  const message = trimString(body.message);
  if (!message) {
    throw new Error("message is required");
  }

  const input: SakiChatRequest = {
    message,
    history: Array.isArray(body.history) ? body.history : [],
    instanceId: trimString(body.instanceId) || null,
    panelError: trimString(body.panelError) || null,
    contextTitle: trimString(body.contextTitle) || null,
    contextText: trimContextText(body.contextText) || null,
    auditSearch: trimString(body.auditSearch) || null,
    mode: body.mode === "agent" ? "agent" : "chat",
    agentPermissionMode: normalizeSakiAgentPermissionMode(body.agentPermissionMode),
    selectedSkillIds: Array.isArray(body.selectedSkillIds) ? body.selectedSkillIds.map(trimString).filter(Boolean) : [],
    attachments: sanitizeSakiInputAttachments(body.attachments)
  };
  requireSakiModePermission(request.user.permissions, input.mode ?? "chat");
  const auditSearchContext = input.auditSearch
    ? await buildAuditSearchContext(input.auditSearch, request.user.permissions.includes("audit.view"))
    : "";
  const modelInput: SakiChatRequest = auditSearchContext
    ? {
        ...input,
        contextTitle: input.contextTitle ?? `审计日志检索：${input.auditSearch}`,
        contextText: [input.contextText, auditSearchContext].filter(Boolean).join("\n\n")
      }
    : input;
  if (input.instanceId) {
    requireUserPermission(request.user.permissions, "instance.view");
  }
  const includeInstanceLogs = Boolean(input.instanceId && hasPermission(request.user.permissions, "instance.logs"));
  const context = await resolveSakiContext(request.user.sub, input.instanceId, includeInstanceLogs);
  const skillQuery =
    `${message} ${modelInput.panelError ?? ""} ${modelInput.contextTitle ?? ""} ${combinedSakiContextText(modelInput).slice(0, 1200)}`.trim() ||
    "coding";
  const skillState = await loadSakiSkills(skillQuery, false, input.mode === "agent" ? 20 : 12);
  const skills = input.selectedSkillIds?.length
    ? await readSakiSkillsByIds(input.selectedSkillIds)
    : skillState.skills;
  const autoAppliedSkillContext = await buildAutoAppliedSakiSkillContext(skills, skillQuery, input.selectedSkillIds ?? []);
  const enhancedModelInput: SakiChatRequest = autoAppliedSkillContext
    ? {
        ...modelInput,
        contextTitle: modelInput.contextTitle ?? "Auto-applied Saki Skills",
        contextText: [modelInput.contextText, autoAppliedSkillContext].filter(Boolean).join("\n\n")
      }
    : modelInput;

  return { input, modelInput: enhancedModelInput, context, skills };
}

export async function auditSakiChatResponse(
  request: FastifyRequest,
  prepared: PreparedSakiChatInvocation,
  response: SakiChatResponse,
  result: "SUCCESS" | "FAILURE" = "SUCCESS",
  error?: string
): Promise<void> {
  const { input, modelInput, context } = prepared;
  await writeAuditLog({
    request,
    userId: request.user.sub,
    action: "saki.chat",
    resourceType: "saki",
    ...(context.workspace?.instanceId ? { resourceId: context.workspace.instanceId } : {}),
    payload: {
      source: response.source,
      ...(error ? { error } : {}),
      mode: modelInput.mode,
      agentPermissionMode: modelInput.mode === "agent" ? effectiveSakiAgentPermissionMode(modelInput) : null,
      workspace: context.workspace?.workingDirectory ?? null,
      contextTitle: modelInput.contextTitle ?? null,
      auditSearch: input.auditSearch ?? null,
      attachmentCount: modelInput.attachments?.length ?? 0,
      ...(response.actions?.length ? { actionCount: response.actions.length } : {}),
      conversation: {
        userMessage: modelInput.message,
        assistantMessage: response.message
      }
    },
    result
  });
}
