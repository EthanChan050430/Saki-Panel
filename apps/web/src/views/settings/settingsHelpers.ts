import type {
  RegistrationIdentity,
  SakiConfigResponse,
  SakiImageGenConfig,
  SakiImageGenProtocol,
  SakiImageGenProviderId,
  SakiProviderConfig,
  SakiSkillDetail
} from "@webops/shared";
import {
  defaultSakiImageGenConfig,
  parseSakiModelSelection,
  resolveSakiImageSize,
  sakiImageGenPreset,
  sakiImageGenProviderPresets,
  sakiNvidiaBaseUrl,
  sakiNvidiaDefaultModel,
  sanitizeSakiImageGenConfig
} from "@webops/shared";
import { defaultPanelAppearance, defaultSakiRequestTimeoutMs } from "../../constants.js";

export const emptySakiConfig: SakiConfigResponse = {
  requestTimeoutMs: defaultSakiRequestTimeoutMs,
  provider: "ollama",
  model: "llama3",
  ollamaUrl: "http://localhost:11434",
  baseUrl: "",
  apiKey: "",
  providerConfigs: {
    ollama: {
      model: "llama3",
      ollamaUrl: "http://localhost:11434"
    }
  },
  modelPointsMultipliers: {},
  searchEnabled: true,
  mcpEnabled: false,
  allowCrossInstanceEnforcement: true,
  imageGen: { ...defaultSakiImageGenConfig },
  systemPrompt: "",
  appearance: defaultPanelAppearance,
  configPath: "",
  globalConfigPath: ""
};

export const providerBaseUrlDefaults: Record<string, string> = {
  nvidia: sakiNvidiaBaseUrl,
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  antigravity: "http://localhost:8080/v1",
  minimax: "https://api.minimaxi.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  tongyi: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  custom: ""
};

export const localProviderUrlDefaults = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234"
};

export const modelProviderOptions = [
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "antigravity", label: "Antigravity CLI" },
  { value: "openai", label: "OpenAI Compatible" },
  { value: "nvidia", label: "NVIDIA" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "zhipu", label: "Zhipu" },
  { value: "gemini", label: "Gemini" },
  { value: "minimax", label: "MiniMax" },
  { value: "anthropic", label: "Anthropic" },
  { value: "moonshot", label: "Moonshot" },
  { value: "tongyi", label: "通义千问" },
  { value: "doubao", label: "豆包" },
  { value: "custom", label: "Custom" }
];

export function isLocalProvider(provider: string): boolean {
  return provider === "ollama" || provider === "lmstudio";
}

export function needsCloudApiFields(provider: string): boolean {
  return !isLocalProvider(provider) && provider !== "copilot" && provider !== "antigravity";
}

export type AntigravityMode = "proxy" | "direct";

/**
 * Effective antigravity connection scheme: explicit `mode` wins; for legacy
 * configs without a mode, an AIzaSy-prefixed key implies "direct".
 */
export function antigravityModeOf(config?: SakiProviderConfig): AntigravityMode {
  if (config?.mode === "proxy" || config?.mode === "direct") return config.mode;
  return (config?.apiKey ?? "").trim().startsWith("AIzaSy") ? "direct" : "proxy";
}

export function defaultProviderConfig(provider: string): SakiProviderConfig {
  if (provider === "ollama") {
    return {
      enabled: false,
      model: "llama3",
      ollamaUrl: localProviderUrlDefaults.ollama
    };
  }
  if (provider === "lmstudio") {
    return {
      enabled: false,
      model: "",
      ollamaUrl: localProviderUrlDefaults.lmstudio
    };
  }
  return {
    enabled: false,
    model: provider === "nvidia" ? sakiNvidiaDefaultModel : "",
    baseUrl: providerBaseUrlDefaults[provider] ?? "",
    apiKey: ""
  };
}

export function isProviderEnabled(form: SakiConfigResponse, providerId: string): boolean {
  return form.providerConfigs?.[providerId]?.enabled === true;
}

export function getEnabledProviders(form: SakiConfigResponse): string[] {
  const list: string[] = [];
  const configs = form.providerConfigs || {};
  for (const [p, cfg] of Object.entries(configs)) {
    if (cfg?.enabled === true) {
      list.push(p);
    }
  }
  return Array.from(new Set(list));
}

export const providerDescriptions: Record<string, string> = {
  nvidia: "NVIDIA API Catalog / NIM，支持 Nemotron 等模型",
  copilot: "GitHub 官方模型网络，支持 GPT-4o、Claude 3.5 Sonnet、o3-mini 等",
  antigravity: "Google 官方 OAuth 授权直连或本地代理网关，支持 Gemini 3.8 Flash / 2.5 Pro",
  deepseek: "DeepSeek 官方开放平台，高性价比推理 DeepSeek-V3 / R1",
  openai: "OpenAI 官方或任意兼容 OpenAI 接口规范的第三方聚合网关",
  anthropic: "Anthropic 官方 API，支持 Claude 3.7 / 3.5 系列",
  gemini: "Google AI Studio 官方 Gemini API 直连通道",
  ollama: "本地运行的 Ollama 开源模型服务（默认 http://localhost:11434）",
  lmstudio: "本地运行的 LM Studio 实例服务（默认 http://localhost:1234）",
  zhipu: "智谱 GLM-4 开放平台",
  minimax: "MiniMax 开放平台大模型",
  moonshot: "Moonshot Kimi 长上下文大模型",
  tongyi: "阿里云百炼 / 通义千问平台",
  doubao: "字节跳动火山引擎豆包大模型平台",
  custom: "自定义 OpenAI 协议模型服务"
};

export const imageGenProtocolOptions: Array<{ value: SakiImageGenProtocol; label: string }> = [
  { value: "openai-images", label: "OpenAI Images (/images/generations)" },
  { value: "sd-webui", label: "Stable Diffusion WebUI (/sdapi/v1/txt2img)" },
  { value: "stability", label: "Stability AI (v2beta)" },
  { value: "gemini", label: "Google Imagen (predict)" },
  { value: "dashscope", label: "DashScope 通义万相" }
];

export const imageGenAspectRatioOptions = [
  { value: "1:1", label: "1:1 方形" },
  { value: "16:9", label: "16:9 横版" },
  { value: "9:16", label: "9:16 竖版" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "21:9", label: "21:9 超宽" }
];

export const imageGenQualityOptions = [
  { value: "draft", label: "草稿 (draft / 512)" },
  { value: "standard", label: "标准 (standard / 1024)" },
  { value: "hd", label: "高清 (hd / 1536+)" }
];

export { sakiImageGenProviderPresets, defaultSakiImageGenConfig, sanitizeSakiImageGenConfig };

export function imageGenFromForm(form: SakiConfigResponse): SakiImageGenConfig {
  return sanitizeSakiImageGenConfig(form.imageGen);
}

export function imageGenNeedsApiKey(config: SakiImageGenConfig): boolean {
  if (config.provider === "sd-webui" || config.protocol === "sd-webui") return false;
  return true;
}

export function withImageGenSizeDefaults(
  current: SakiImageGenConfig,
  patch: Partial<Pick<SakiImageGenConfig, "defaultAspectRatio" | "defaultQuality" | "defaultWidth" | "defaultHeight">>
): Partial<SakiImageGenConfig> {
  const merged = { ...current, ...patch };
  const size = resolveSakiImageSize({
    width: patch.defaultWidth,
    height: patch.defaultHeight,
    aspectRatio: merged.defaultAspectRatio,
    quality: merged.defaultQuality,
    defaults: {
      defaultAspectRatio: merged.defaultAspectRatio,
      defaultQuality: merged.defaultQuality
    }
  });
  return {
    ...patch,
    defaultAspectRatio: size.aspectRatio,
    defaultQuality: size.quality,
    defaultWidth: size.width,
    defaultHeight: size.height
  };
}

export function applyImageGenProvider(current: SakiImageGenConfig, provider: string): SakiImageGenConfig {
  const preset = sakiImageGenPreset(provider);
  const nextProvider = preset.id as SakiImageGenProviderId;
  if (nextProvider === "custom") {
    return sanitizeSakiImageGenConfig({
      ...current,
      provider: "custom"
    });
  }
  return sanitizeSakiImageGenConfig({
    ...current,
    provider: nextProvider,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    model: preset.model || current.model
  });
}

export function providerConfigFromForm(form: SakiConfigResponse, provider: string): SakiProviderConfig {
  return {
    ...defaultProviderConfig(provider),
    ...(form.providerConfigs?.[provider] ?? {})
  };
}

export function updateSakiProviderConfig(
  form: SakiConfigResponse,
  provider: string,
  patch: Partial<SakiProviderConfig>
): SakiConfigResponse {
  const next = {
    ...form,
    providerConfigs: {
      ...form.providerConfigs,
      [provider]: { ...providerConfigFromForm(form, provider), ...patch }
    }
  };
  if (provider === form.provider) {
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.ollamaUrl !== undefined) next.ollamaUrl = patch.ollamaUrl;
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) next.apiKey = patch.apiKey;
  }
  return next;
}

export function selectSakiModel(form: SakiConfigResponse, value: string, provider?: string): SakiConfigResponse {
  const selection = parseSakiModelSelection(value, provider);
  const nextProvider = selection.provider || form.provider;
  const targetConfig = providerConfigFromForm(form, nextProvider);
  return {
    ...form,
    provider: nextProvider,
    model: selection.model,
    ollamaUrl: targetConfig.ollamaUrl || "",
    baseUrl: targetConfig.baseUrl || "",
    apiKey: targetConfig.apiKey || "",
    providerConfigs: {
      ...form.providerConfigs,
      [nextProvider]: { ...targetConfig, model: selection.model }
    }
  };
}

/** Only connection changes require a new catalog; model selection and aliases do not. */
export function sakiModelCatalogSignature(form: SakiConfigResponse): string {
  return JSON.stringify(Object.keys(form.providerConfigs).sort().map((provider) => {
    const config = providerConfigFromForm(form, provider);
    return {
      provider,
      enabled: config.enabled === true,
      baseUrl: config.baseUrl || "",
      ollamaUrl: config.ollamaUrl || "",
      apiKey: config.apiKey || "",
      mode: provider === "antigravity" ? antigravityModeOf(config) : ""
    };
  }));
}

export interface SakiSkillDraft {
  name: string;
  description: string;
  tags: string;
  content: string;
  enabled: boolean;
}

export const emptySakiSkillDraft: SakiSkillDraft = {
  name: "",
  description: "",
  tags: "",
  content: "",
  enabled: true
};

export function parseSakiSkillTags(value: string): string[] {
  return value
    .split(/[,，;；\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 16);
}

export function sakiSkillDraftFromDetail(skill: SakiSkillDetail): SakiSkillDraft {
  return {
    name: skill.name,
    description: skill.description ?? "",
    tags: skill.tags?.join(", ") ?? "",
    content: skill.content,
    enabled: skill.enabled !== false
  };
}

export function formatSessionTimeoutMinutes(value: number): string {
  return Number.isFinite(value) ? String(value) : "120";
}

export function parseSessionTimeoutMinutesDraft(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!trimmed || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error("登录超时时间必须是大于或等于 0 的数字。");
  }
  return Number(parsed.toFixed(3));
}

export const registrationIdentityOptions: Array<{ value: RegistrationIdentity; label: string }> = [
  { value: "none", label: "无角色" },
  { value: "user", label: "用户" },
  { value: "admin", label: "管理员" },
  { value: "super_admin", label: "超级管理员" }
];
