import type {
  RegistrationIdentity,
  SakiConfigResponse,
  SakiProviderConfig,
  SakiSkillDetail
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
  systemPrompt: "",
  appearance: defaultPanelAppearance,
  configPath: "",
  globalConfigPath: ""
};

export const providerBaseUrlDefaults: Record<string, string> = {
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
      model: "llama3",
      ollamaUrl: localProviderUrlDefaults.ollama
    };
  }
  if (provider === "lmstudio") {
    return {
      model: "",
      ollamaUrl: localProviderUrlDefaults.lmstudio
    };
  }
  return {
    model: "",
    baseUrl: providerBaseUrlDefaults[provider] ?? "",
    apiKey: ""
  };
}

export function providerConfigFromForm(form: SakiConfigResponse, provider: string): SakiProviderConfig {
  return {
    ...defaultProviderConfig(provider),
    ...(form.providerConfigs?.[provider] ?? {})
  };
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
