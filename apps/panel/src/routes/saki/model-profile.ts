import { normalizeProviderId } from "./types.js";

export type SakiModelFamily = "claude" | "gpt" | "gemini" | "qwen" | "deepseek" | "glm" | "local" | "copilot" | "generic";

export interface SakiModelProfile {
  family: SakiModelFamily;
  nativeTools: boolean;
  preferXml: boolean;
  compactPrompt: boolean;
  maxAdvertisedTools: number;
  invalidReplyRetries: number;
}

const smallLocalModelPattern =
  /(^|[:/_-])(0\.5b|1\.5b|1b|2b|3b|4b|7b|8b|9b)(\b|$)|tiny|mini|phi-?3|gemma-?2?-?(2b|4b)|qwen2\.5?:?(0\.5|1\.5|3|7)b|llama-?3\.2/i;

export function sakiModelProfile(provider: unknown, model?: string | null): SakiModelProfile {
  const providerId = normalizeProviderId(provider);
  const modelId = (model ?? "").toLowerCase();

  if (providerId === "anthropic" || modelId.includes("claude")) {
    return { family: "claude", nativeTools: true, preferXml: false, compactPrompt: false, maxAdvertisedTools: 36, invalidReplyRetries: 1 };
  }
  if (providerId === "copilot") {
    return { family: "copilot", nativeTools: false, preferXml: true, compactPrompt: false, maxAdvertisedTools: 28, invalidReplyRetries: 2 };
  }
  if (providerId === "gemini" || modelId.includes("gemini")) {
    return { family: "gemini", nativeTools: true, preferXml: false, compactPrompt: false, maxAdvertisedTools: 24, invalidReplyRetries: 2 };
  }
  if (providerId === "tongyi" || modelId.includes("qwen") || modelId.includes("dashscope")) {
    return { family: "qwen", nativeTools: true, preferXml: true, compactPrompt: false, maxAdvertisedTools: 26, invalidReplyRetries: 2 };
  }
  if (providerId === "deepseek" || modelId.includes("deepseek")) {
    return { family: "deepseek", nativeTools: true, preferXml: false, compactPrompt: false, maxAdvertisedTools: 28, invalidReplyRetries: 2 };
  }
  if (providerId === "zhipu" || modelId.includes("glm")) {
    return { family: "glm", nativeTools: true, preferXml: true, compactPrompt: false, maxAdvertisedTools: 24, invalidReplyRetries: 2 };
  }
  if (providerId === "openai" || modelId.includes("gpt") || /\bo[1-9]\b/.test(modelId)) {
    return { family: "gpt", nativeTools: true, preferXml: false, compactPrompt: false, maxAdvertisedTools: 32, invalidReplyRetries: 1 };
  }
  if (providerId === "ollama" || providerId === "lmstudio") {
    const compact = smallLocalModelPattern.test(modelId);
    return {
      family: "local",
      nativeTools: true,
      preferXml: true,
      compactPrompt: compact,
      maxAdvertisedTools: compact ? 14 : 22,
      invalidReplyRetries: 2
    };
  }
  return { family: "generic", nativeTools: true, preferXml: true, compactPrompt: false, maxAdvertisedTools: 24, invalidReplyRetries: 2 };
}

export function xmlToolFormatReminder(): string {
  return `If native tools are unavailable, output clean XML (no JSON wrapper, no markdown fences):
<tool_call name="toolName">
<paramName>value</paramName>
</tool_call>
If the task is complete, reply in plain text with no tool calls.`;
}

const nativeThinkingModelPattern =
  /(?:^|[^a-z0-9])(?:r1|reasoner|thinking|qwq|qwen3|glm-4\.5|glm-4\.6|glm-z1|deepseek-r1|o1|o3|o4|gpt-5|claude-3-7|claude-sonnet-4|claude-opus-4|claude-haiku-4|claude-4|gemini-2\.5|kimi-k1|k2)(?:[^a-z0-9]|$)/i;

export function sakiModelWantsNativeThinking(provider: unknown, model?: string | null): boolean {
  const modelId = (model ?? "").toLowerCase();
  if (!modelId) return false;
  const family = sakiModelProfile(provider, model).family;
  if (family === "claude") return /claude-(3-7|sonnet-4|opus-4|haiku-4|4-)/i.test(modelId);
  return nativeThinkingModelPattern.test(modelId);
}

export function anthropicSupportsThinking(model?: string | null): boolean {
  return /claude-(3-7|sonnet-4|opus-4|haiku-4|4-)/i.test(model ?? "");
}

export function nativeThinkingChatExtras(provider: unknown, model?: string | null): Record<string, unknown> {
  if (!sakiModelWantsNativeThinking(provider, model)) return {};
  const family = sakiModelProfile(provider, model).family;
  const providerId = normalizeProviderId(provider);
  const modelId = (model ?? "").toLowerCase();

  if (family === "glm") return { thinking: { type: "enabled" } };
  if (family === "qwen") return { enable_thinking: true };
  if (family === "deepseek") return {};
  if (family === "gpt") {
    if (providerId === "openai" && /(?:^|[^a-z0-9])(o[1-4]|gpt-5)(?:[^a-z0-9]|$)/.test(modelId)) {
      return { reasoning_effort: "medium" };
    }
    if (/qwen|qwq/.test(modelId)) return { enable_thinking: true };
    if (/glm/.test(modelId)) return { thinking: { type: "enabled" } };
    if (/thinking|reasoner|r1/.test(modelId) && providerId !== "openai") return { enable_thinking: true };
    return {};
  }
  if (family === "claude") return {};
  if (/qwen|qwq|thinking|reasoner|r1/.test(modelId)) return { enable_thinking: true };
  return {};
}
