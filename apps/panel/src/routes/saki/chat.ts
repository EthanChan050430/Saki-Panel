import type { FastifyRequest } from "fastify";
import type {
  SakiChatRequest,
  SakiChatResponse,
  SakiConfigResponse,
  SakiModelListResponse,
  SakiModelOption,
  SakiProviderConfig,
  SakiSkillSummary,
  SakiWorkspaceContext,
  UpdateSakiConfigRequest
} from "@webops/shared";
import { sakiListedModelSupportsVision } from "@webops/shared";
import { writeAuditLog } from "../../audit.js";
import { readDaemonInstanceFile, readDaemonInstanceLogs } from "../../daemon-client.js";
import { loadVisibleInstance, instancePermissionOverride } from "../../instance-access.js";
import { loadCurrentUser } from "../../auth.js";
import type { InstanceOwnerRole, PermissionCode } from "@webops/shared";
import { buildDirectSystemPrompt, buildPrompt } from "./prompt.js";
import { estimateModelCallTokens } from "../../tokenizer.js";
import {
  callConfiguredPrompt,
  callConfiguredPromptStream,
  fetchAnthropicModelCatalog,
  fetchAntigravityModelCatalog,
  fetchCopilotModelCatalog,
  fetchLmStudioModelCatalog,
  fetchOllamaModelCatalog,
  fetchOpenAiModelCatalog
} from "./providers.js";
import { buildAuditSearchContext } from "./audit.js";
import { loadSakiSkills, readSakiSkillsByIds, buildAutoAppliedSakiSkillContext } from "./skills.js";
import { readEffectiveSakiConfig } from "./config.js";
import { getCachedInstanceFile, recordInstanceFileRead } from "./state.js";
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
  sanitizeRequestedSakiModel,
  withRequestedSakiModel,
  trimContextText,
  objectValue,
  trimString,
  type InstanceWithNode,
  type PreparedSakiChatInvocation,
  type ResolvedSakiContext
} from "./types.js";
import { hydrateSakiAttachmentsForModel } from "./ocr.js";

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

function estimateChatTokens(input: SakiChatRequest, prompt: string, reply: string, config: SakiConfigResponse): number {
  const system = buildDirectSystemPrompt(config);
  const history = (input.history ?? []).map((message) => `${message.role}\n${message.content}`).join("\n");
  return estimateModelCallTokens(`${system}\n${history}\n${prompt}`, reply, undefined, config.model);
}

export async function callConfiguredModel(input: SakiChatRequest, context: ResolvedSakiContext, skills: SakiSkillSummary[]) {
  const config = withRequestedSakiModel(await readEffectiveSakiConfig(), input);
  const prompt = buildPrompt(input, context, skills);
  const startedAt = Date.now();
  try {
    const text = await callConfiguredPrompt(input, prompt, config);
    logSakiModelEvent("chat.response", {
      mode: input.mode ?? "chat",
      model: config.model,
      promptChars: prompt.length,
      messageChars: text.length,
      durationMs: Date.now() - startedAt
    });
    return { text, tokensUsed: estimateChatTokens(input, prompt, text, config) };
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
  const config = withRequestedSakiModel(await readEffectiveSakiConfig(), input);
  const prompt = buildPrompt(input, context, skills);
  const startedAt = Date.now();
  try {
    const text = await callConfiguredPromptStream(input, prompt, onDelta, config, onThinking);
    logSakiModelEvent("chat.stream.response", {
      mode: input.mode ?? "chat",
      model: config.model,
      promptChars: prompt.length,
      messageChars: text.length,
      durationMs: Date.now() - startedAt
    });
    return { text, tokensUsed: estimateChatTokens(input, prompt, text, config) };
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
  let friendlyMessage = `模型接口暂时不可用：${reason}\n\n请检查模型服务、网络或 API 配置后重试。`;

  if (reason.includes("No flow routing") || reason.includes("routing entries")) {
    friendlyMessage = `⚠️ **反向代理未配置该模型的路由条目**\n\n${reason}\n\n#### 💡 解决方法：\n1. 请在 Saki 顶部的【模型名称 (Model)】下拉菜单中，选择反代支持的标准模型（如 **Gemini 2.5 Flash** 或 **Gemini 2.5 Pro**）；\n2. 点击【保存设置】后重新发送消息即可正常使用。`;
  } else if (reason.includes("402") || reason.includes("Insufficient Balance") || reason.includes("insufficient_quota")) {
    const isDeepSeek =
      (input.model && input.model.toLowerCase().includes("deepseek")) ||
      reason.toLowerCase().includes("deepseek");

    if (isDeepSeek) {
      friendlyMessage = `⚠️ **DeepSeek API 调用失败：账户余额不足 (402 Insufficient Balance)**

DeepSeek 官方平台返回了 \`402 Insufficient Balance\` 状态码。这表示您当前的 DeepSeek 账户余额已为 0，或赠送的体验额度已过期/耗尽。

---
#### 💡 解决方法：
1. **前往 DeepSeek 官方控制台充值**：
   - 打开 [DeepSeek 开放平台](https://platform.deepseek.com/) 并登录；
   - 点击左侧导航栏的 **【财务】或【Top up】**，检查“可用余额”；
   - 若余额不足，充值少量金额（如 10 元）后即可立刻恢复使用；
2. **确认 API Key 所属账号**：
   - 在 DeepSeek 控制台【API keys】页面确认当前配置的密钥是否属于已有余额的账号；
3. **免费替代渠道**：
   - **硅基流动 (SiliconFlow)**：提供兼容 OpenAI 的 DeepSeek-V3 / R1 接口（Base URL 为 \`https://api.siliconflow.cn/v1\`）；
   - **本地 Ollama**：在 Saki 设置中切换为 Ollama，直接使用本地 DeepSeek-R1（完全离线免费）；
   - **切换其他模型**：在设置中切换为 Moonshot、Google Gemini 或 GitHub Copilot。`;
    } else {
      friendlyMessage = `⚠️ **模型服务调用失败：账户余额或代理额度不足 (402 Insufficient Balance)**\n\n${
        reason.includes("•")
          ? reason
          : `上游模型提供商或反向代理网关返回了额度耗尽提示 (402: Insufficient Balance)。\n\n#### 💡 排查与解决方法：\n1. **检查账户余额或配额**：请前往您当前配置的模型服务商后台（如 DeepSeek、OpenAI 或反代平台）检查账户余额并充值；\n2. **检查 API Key**：确认当前填入的 API Key 是否有效且属于有额度的账号；\n3. **切换其他模型**：可在设置中切换为 Moonshot、Google Gemini、GitHub Copilot 或 Ollama 本地模型。`
      }`;
    }
  }

  return {
    source: "local-fallback",
    workspace: context.workspace,
    ...(input.mode === "agent" ? { agentPermissionMode: effectiveSakiAgentPermissionMode(input) } : {}),
    skills,
    message: friendlyMessage
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
    vendor: trimString(item.vendor),
    supportsVision: sakiListedModelSupportsVision({
      id,
      provider,
      name: trimString(item.name) || id,
      label: trimString(item.label) || id,
      supportsVision: item.supportsVision === true
    })
  };
}

async function fetchCatalogForProvider(
  providerId: string,
  config: SakiConfigResponse,
  warnings: SakiModelListResponse["warnings"]
): Promise<SakiModelOption[]> {
  try {
    if (providerId === "ollama") {
      return await fetchOllamaModelCatalog(config);
    } else if (providerId === "lmstudio") {
      return await fetchLmStudioModelCatalog(config);
    } else if (providerId === "anthropic") {
      return await fetchAnthropicModelCatalog(config);
    } else if (providerId === "copilot") {
      return await fetchCopilotModelCatalog(config);
    } else if (providerId === "antigravity") {
      return await fetchAntigravityModelCatalog(config, warnings);
    } else {
      return await fetchOpenAiModelCatalog(providerId, config);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({ provider: providerId, message });
    return [];
  }
}

export async function detectSakiModels(input: UpdateSakiConfigRequest = {}): Promise<SakiModelListResponse> {
  const current = await readEffectiveSakiConfig();
  const providerConfigs: Record<string, SakiProviderConfig> = {
    ...(current.providerConfigs || {})
  };
  if (input.providerConfigs && typeof input.providerConfigs === "object") {
    for (const [k, v] of Object.entries(input.providerConfigs)) {
      const pid = normalizeProviderId(k);
      providerConfigs[pid] = {
        ...(providerConfigs[pid] || {}),
        ...v
      };
    }
  }

  const customModelNames: Record<string, string> = {
    ...(current.customModelNames || {}),
    ...(input.customModelNames || {})
  };

  const effective: SakiConfigResponse = {
    ...current,
    provider: input.provider !== undefined ? normalizeProviderId(input.provider) : current.provider,
    model: input.model !== undefined ? trimString(input.model) || current.model : current.model,
    ollamaUrl: input.ollamaUrl !== undefined ? trimString(input.ollamaUrl) || current.ollamaUrl : current.ollamaUrl,
    baseUrl: input.baseUrl !== undefined ? trimString(input.baseUrl) : current.baseUrl,
    apiKey: input.apiKey !== undefined ? trimString(input.apiKey) : current.apiKey,
    providerConfigs,
    customModelNames,
    searchEnabled: input.searchEnabled !== undefined ? Boolean(input.searchEnabled) : current.searchEnabled,
    mcpEnabled: input.mcpEnabled !== undefined ? Boolean(input.mcpEnabled) : current.mcpEnabled
  };

  const warnings: SakiModelListResponse["warnings"] = [];

  const enabledProviders = Object.keys(providerConfigs).filter((p) => {
    return providerConfigs[p]?.enabled === true;
  });
  const uniqueEnabled = Array.from(new Set(enabledProviders));

  if (uniqueEnabled.length === 0) {
    return {
      provider: effective.provider,
      models: [],
      warnings: [],
      message: "未开启任何模型服务商，请在设置中开启服务商开关。"
    };
  }

  const results = await Promise.allSettled(
    uniqueEnabled.map(async (p) => {
      const pConfig = providerConfigs[p] ?? {};
      const singleConfig: SakiConfigResponse = {
        ...effective,
        provider: p,
        model: pConfig.model || "",
        ollamaUrl: pConfig.ollamaUrl || (p === "lmstudio" ? "http://localhost:1234" : "http://localhost:11434"),
        baseUrl: pConfig.baseUrl || "",
        apiKey: pConfig.apiKey || "",
        providerConfigs: {
          ...effective.providerConfigs,
          [p]: pConfig
        }
      };
      return {
        provider: p,
        models: await fetchCatalogForProvider(p, singleConfig, warnings)
      };
    })
  );

  const allModels: SakiModelOption[] = [];
  for (const res of results) {
    if (res.status === "fulfilled") {
      allModels.push(...res.value.models);
    }
  }

  const idCount = new Map<string, number>();
  for (const m of allModels) {
    idCount.set(m.id, (idCount.get(m.id) ?? 0) + 1);
  }

  const processedModels: SakiModelOption[] = allModels.map((m) => {
    const isConflict = (idCount.get(m.id) ?? 0) > 1;
    const defaultName = isConflict ? `${m.id}-${m.provider}` : (m.name || m.id);
    const defaultLabel = isConflict ? `${m.id}-${m.provider}` : (m.label || m.id);

    const customName =
      customModelNames[`${m.provider}:${m.id}`] ??
      customModelNames[defaultName] ??
      customModelNames[m.id];

    return {
      ...m,
      name: customName || defaultName,
      label: customName || defaultLabel,
      customName: customName || undefined,
      isConflict
    };
  });

  return {
    provider: effective.provider,
    models: processedModels,
    warnings,
    message: processedModels.length > 0 ? `已成功同步 ${processedModels.length} 个最新模型。` : "未能检测到可用模型。"
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

  const requestedModel = sanitizeRequestedSakiModel(body.model);
  const config = withRequestedSakiModel(await readEffectiveSakiConfig(), {
    model: requestedModel || null,
    provider: body.provider || null
  });
  const attachments = await hydrateSakiAttachmentsForModel(
    sanitizeSakiInputAttachments(body.attachments),
    message,
    config
  );

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
    attachments,
    ...(requestedModel || trimString(body.provider) ? { model: config.model, provider: config.provider } : {})
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
  let includeInstanceLogs = Boolean(input.instanceId && hasPermission(request.user.permissions, "instance.logs"));
  let includeInstanceFiles = request.user.permissions.includes("file.read");
  const context = await resolveSakiContext(request.user.sub, input.instanceId, false);
  if (context.instance) {
    const sakiPermission: PermissionCode = input.mode === "agent" ? "saki.agent" : "saki.chat";
    const sakiUser = await loadCurrentUser(request.user.sub);
    if (sakiUser) {
      const profile = {
        userId: sakiUser.id,
        role: (sakiUser.isSuperAdmin ? "super_admin" : sakiUser.isAdmin ? "admin" : "user") as InstanceOwnerRole,
        roleNames: sakiUser.roleNames
      };
      const override = instancePermissionOverride(profile, context.instance, sakiUser.permissions);
      if (override !== null && !override.includes(sakiPermission)) {
        throw Object.assign(new Error("该实例的分配权限未包含使用 Saki"), { statusCode: 403 });
      }
      if (override !== null) {
        includeInstanceLogs = includeInstanceLogs && override.includes("instance.logs");
        includeInstanceFiles = includeInstanceFiles && override.includes("file.read");
      }
    }
  }
  if (includeInstanceLogs && context.instance) {
    try {
      context.logs = (await readDaemonInstanceLogs(context.instance.node, context.instance.id, 180)).lines;
    } catch {
      context.logs = [];
    }
  }
  const projectMemory = includeInstanceFiles ? await loadInstanceProjectMemory(context.instance) : null;
  const memoryContext = projectMemory ?? "";

  const skillQuery =
    `${message} ${modelInput.panelError ?? ""} ${modelInput.contextTitle ?? ""} ${combinedSakiContextText(modelInput).slice(0, 1200)}`.trim() ||
    "coding";
  const skillState = await loadSakiSkills(skillQuery, false, input.mode === "agent" ? 20 : 12);
  const skills = input.selectedSkillIds?.length
    ? await readSakiSkillsByIds(input.selectedSkillIds)
    : skillState.skills;
  const autoAppliedSkillContext = await buildAutoAppliedSakiSkillContext(skills, skillQuery, input.selectedSkillIds ?? []);

  const combinedContextParts = [
    modelInput.contextText,
    memoryContext,
    autoAppliedSkillContext
  ].filter(Boolean);

  const enhancedModelInput: SakiChatRequest = combinedContextParts.length > 0
    ? {
        ...modelInput,
        contextText: combinedContextParts.join("\n\n")
      }
    : modelInput;

  return { input, modelInput: enhancedModelInput, context, skills };
}

async function loadInstanceProjectMemory(instance: InstanceWithNode | null): Promise<string | null> {
  if (!instance) return null;
  const chunks: string[] = [];
  for (const name of ["SAKI.md", "AGENTS.md"]) {
    const cached = getCachedInstanceFile(instance.id, name);
    if (cached?.content) {
      chunks.push(`[Project Memory (${name})]\n${cached.content.slice(0, 2500)}`);
      continue;
    }
    try {
      const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, name);
      if (file?.content) {
        recordInstanceFileRead(instance.id, name, { content: file.content, size: file.size, modifiedAt: file.modifiedAt });
        chunks.push(`[Project Memory (${name})]\n${file.content.slice(0, 2500)}`);
      }
    } catch {
      // optional project instruction file
    }
  }
  return chunks.length ? chunks.join("\n\n") : null;
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
