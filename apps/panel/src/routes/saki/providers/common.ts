import { randomUUID } from "node:crypto";
import { normalizeSakiReasoningEffort, type SakiReasoningEffort, type SakiChatRequest, type SakiConfigResponse, type SakiModelOption } from "@webops/shared";
import { sakiNvidiaDefaultModel } from "@webops/shared";
import type { SakiModelToolTurn } from "../types.js";
import {
  compactDebugText,
  currentAgentAbortSignal,
  errorMessageFromJson,
  logSakiModelEvent,
  looksLikeDsmlMarkup,
  looksLikeSpecialToolToken,
  toolCallMarkupStartIndex,
  normalizeHttpBaseUrl,
  normalizeProviderId,
  objectValue,
  openAiBaseUrl,
  providerBaseUrl,
  providerConfigFor,
  providerDefaults,
  RequestTimeoutError,
  RouteError,
  safeModelLogUrl,
  sanitizeProviderConfig,
  sakiVerboseModelLogsEnabled,
  streamingThinkingText,
  stripDsmlWrappers,
  stripThinking,
  trimString
} from "../types.js";
import { openAiToolSchemas } from "../tools.js";
import { isGlm53Flash, nativeThinkingChatExtras } from "../model-profile.js";
import { glmPreservedThinkingOptions } from "./prompt-cache.js";
import { extractProviderUsage, estimateModelCallTokens, mergeModelUsage, modelUsageTotal, type ModelUsage } from "../../../tokenizer.js";
import { parseToolCallsFromText } from "./catalog.js";
import { currentAgentTurnConversation } from "../agent-messages.js";
import { copyText } from "../text-memory.js";
import { isModelTurnRetryManaged } from "./model-retry.js";

export const defaultTemperatureOnlyModelKeys = new Set<string>();

export function modelOutputWasTruncated(payload: unknown): boolean {
  const root = objectValue(payload);
  const reasons = [root?.stop_reason, root?.done_reason, objectValue(root?.delta)?.stop_reason];
  for (const choice of Array.isArray(root?.choices) ? root.choices : []) reasons.push(objectValue(choice)?.finish_reason);
  return reasons.some((reason) => reason === "length" || reason === "max_tokens" || reason === "max_output_tokens");
}

export function withTurnUsage(
  turn: SakiModelToolTurn,
  prompt: string,
  payload?: unknown,
  includeToolSchemas = false
): SakiModelToolTurn {
  const modelUsage = extractProviderUsage(payload);
  const fromApi = modelUsageTotal(modelUsage);
  const tokens =
    fromApi ||
    estimateModelCallTokens(
      prompt,
      turn.content,
      turn.toolCalls,
      "gpt-4",
      includeToolSchemas ? JSON.stringify(openAiToolSchemas()) : undefined
    );
  return { ...turn, ...(modelUsage ? { modelUsage } : {}), ...(tokens > 0 ? { usageTokens: tokens } : {}), ...(modelOutputWasTruncated(payload) ? { truncated: true } : {}) };
}

export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 2000;
export const RATE_LIMIT_STATUS = 429;

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof RouteError)) return false;
  // Retrying after emitted tokens duplicates reasoning/text and spends tokens again.
  if ("partialStream" in error && error.partialStream) return false;
  const message = error.message.toLowerCase();
  if (/quota exceeded|billing|credit|balance|insufficient|reset delay too long/i.test(message)) {
    return false;
  }
  return (
    error.statusCode === RATE_LIMIT_STATUS ||
    error.statusCode === 503 ||
    error.statusCode === 502 ||
    /rate limit|too many requests|capacity|overload|temporarily unavailable|timeout/i.test(message)
  );
}

export function parseRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  const xRateLimitReset = response.headers.get("x-ratelimit-reset");
  if (xRateLimitReset) {
    const resetTime = parseInt(xRateLimitReset, 10) * 1000;
    const delay = resetTime - Date.now();
    if (delay > 0) return Math.min(delay, 60000);
  }
  return null;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  requestId: string
): Promise<T> {
  // The agent retries complete turns so provider accumulators are recreated.
  // Do not multiply that budget with retries inside each HTTP request.
  if (isModelTurnRetryManaged()) return operation();
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new RouteError(String(error), 500);
      // A user-cancelled run must surface immediately, never be retried.
      if (currentAgentAbortSignal()?.aborted) {
        throw error;
      }
      // A long reasoning timeout should immediately offer explicit recovery,
      // not queue several identical multi-minute inference requests.
      if (currentAgentTurnConversation() && /timed out|timeout/i.test(lastError.message)) throw error;
      if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      logSakiModelEvent("retry", {
        requestId,
        operation: operationName,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs: delay,
        error: lastError.message.slice(0, 200)
      });
      const abortSignal = currentAgentAbortSignal();
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", onAbort);
          reject(error);
        };
        const timer = setTimeout(() => {
          abortSignal?.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
        if (!abortSignal) return;
        if (abortSignal.aborted) {
          onAbort();
          return;
        }
        abortSignal.addEventListener("abort", onAbort);
      });
    }
  }
  throw lastError ?? new RouteError(`${operationName} failed after retries`, 502);
}

export function modelTemperatureKey(provider: string, baseUrl: string, model: string): string {
  return `${provider}|${safeModelLogUrl(baseUrl).toLowerCase()}|${model.toLowerCase()}`;
}

export function isOfficialOpenAiEndpoint(provider: string, baseUrl: string): boolean {
  if (provider === "openai") return true;
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

export function isKnownDefaultTemperatureOnlyModel(model: string): boolean {
  const normalized = trimString(model).toLowerCase();
  const id = normalized.includes("/") ? normalized.split("/").pop() ?? normalized : normalized;
  return /^(?:o(?:1|3|4)(?:[-.]|$)|gpt-5(?:[-.]|$)|chatgpt-5(?:[-.]|$))/.test(id);
}

export function shouldSendCustomTemperature(provider: string, baseUrl: string, model: string): boolean {
  const key = modelTemperatureKey(provider, baseUrl, model);
  return !defaultTemperatureOnlyModelKeys.has(key) && !(isOfficialOpenAiEndpoint(provider, baseUrl) && isKnownDefaultTemperatureOnlyModel(model));
}

export function openAiCompatibleChatBody(
  provider: string,
  baseUrl: string,
  model: string,
  body: Record<string, unknown>,
  preferredTemperature: number,
  reasoningEffort?: SakiReasoningEffort
): Record<string, unknown> {
  // These sampling and reasoning defaults belong to this Nemotron model,
  // rather than every model hosted by NVIDIA's OpenAI-compatible API.
  const isNvidiaNemotron = provider === "nvidia" && model.trim().toLowerCase() === sakiNvidiaDefaultModel;
  const effort = normalizeSakiReasoningEffort(reasoningEffort, model, provider);
  const explicitThinking = effort !== "auto" && /(?:^|\/)(?:deepseek-|glm-)/i.test(model)
    ? { thinking: { type: "enabled" } } : {};
  const withThinking = {
    ...(isNvidiaNemotron ? { max_tokens: 65536, reasoning_budget: 16384, top_p: 0.95 } : {}),
    ...body,
    ...nativeThinkingChatExtras(provider, model),
    ...explicitThinking,
    ...(isGlm53Flash(model) && currentAgentTurnConversation() ? glmPreservedThinkingOptions(baseUrl) : {}),
    ...(effort !== "auto" ? { reasoning_effort: effort } : {})
  };
  if (!shouldSendCustomTemperature(provider, baseUrl, model)) return withThinking;
  return { ...withThinking, temperature: isNvidiaNemotron ? 0.6 : preferredTemperature };
}

export function withoutTemperature(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next.temperature;
  return next;
}

export function withoutNativeThinking(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next.enable_thinking;
  delete next.thinking;
  delete next.reasoning_effort;
  delete next.reasoning_budget;
  delete next.reasoning;
  return next;
}

export function isThinkingRequestError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /enable_thinking|reasoning_effort|reasoning_budget|\bthinking\b/.test(message) && /unsupported|unknown|invalid|unrecognized|not\s+support|unexpected/.test(message);
}

export function isContextOverflowError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /context[_ ]?length|context window|maximum context|too many tokens|prompt is too long|context_length_exceeded|reduce the length|exceeds? the (?:model|max(?:imum)?) (?:context|token)|request too large|exceeded.*token/i.test(message);
}

export function isTemperatureRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /temperature/i.test(message) && /(?:only\s+1|default|unsupported|not\s+support|not\s+supported|invalid|unknown|unrecognized|for this model)/i.test(message);
}

export function summarizeModelRequestBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "string") return {};
  const summary: Record<string, unknown> = {
    bodyChars: body.length
  };
  try {
    const payload = JSON.parse(body) as unknown;
    const item = objectValue(payload);
    if (item) {
      if ("model" in item) summary.model = item.model;
      if ("stream" in item) summary.stream = item.stream;
      if ("tools" in item) summary.toolCount = Array.isArray(item.tools) ? item.tools.length : undefined;
      if ("messages" in item) summary.messageCount = Array.isArray(item.messages) ? item.messages.length : undefined;
    }
  } catch {}
  return summary;
}

export function summarizeModelResponsePayload(payload: unknown, text: string): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const item = objectValue(payload);
  if (item) {
    if ("model" in item) summary.model = item.model;
    if ("usage" in item) summary.usage = item.usage;
  }
  summary.responseChars = text.length;
  if (sakiVerboseModelLogsEnabled()) {
    summary.responsePreview = compactDebugText(text, 1200);
  }
  return summary;
}

/** First index in `text` where a tool-call / DSML payload begins, or -1. */
export function findAgentStreamStopIndex(text: string): number {
  return toolCallMarkupStartIndex(text);
}

export async function streamPromptAgentTurnWithFilteredDelta(
  contentStream: (onDelta: (text: string) => void) => Promise<string>,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  let accumulated = "";
  let stoppedStreaming = false;
  let forwardedIndex = 0;
  let thinkingEmitted = 0;
  const emitThinking = () => {
    if (!onThinking) return;
    const thinking = streamingThinkingText(accumulated);
    if (thinking.length > thinkingEmitted) {
      onThinking(copyText(thinking.slice(thinkingEmitted)));
      thinkingEmitted = thinking.length;
    }
  };
  const maxPrefixLen = 64;
  const filteredDelta = (text: string) => {
    accumulated += text;
    emitThinking();
    if (stoppedStreaming) return;
    const stopIndex = findAgentStreamStopIndex(accumulated);
    if (stopIndex !== -1) {
      stoppedStreaming = true;
      if (stopIndex > forwardedIndex) onDelta(copyText(accumulated.slice(forwardedIndex, stopIndex)));
      forwardedIndex = stopIndex;
      return;
    }
    const safeEnd = accumulated.length - maxPrefixLen;
    if (safeEnd > forwardedIndex) {
      onDelta(copyText(accumulated.slice(forwardedIndex, safeEnd)));
      forwardedIndex = safeEnd;
    }
  };

  const content = await contentStream(filteredDelta);
  emitThinking();
  // 把 accumulated 里残留的工具调用 / DSML 包装拦住，避免流式尾段漏到前端
  if (!stoppedStreaming && forwardedIndex < accumulated.length) {
    const rest = accumulated.slice(forwardedIndex);
    if (findAgentStreamStopIndex(rest) === -1 && findAgentStreamStopIndex(stripDsmlWrappers(rest)) === -1 && !looksLikeDsmlMarkup(rest) && !looksLikeSpecialToolToken(rest)) {
      const tail = stripDsmlWrappers(stripThinking(rest));
      if (tail && !/<(?:tool_call|tool_calls|function_calls|command|invoke|function|action|call|calls)\b/i.test(tail) && !/"?tool_calls"?\s*:/i.test(tail)) {
        onDelta(copyText(tail));
        forwardedIndex = accumulated.length;
      }
    }
  }
  return {
    content: stripDsmlWrappers(content),
    toolCalls: parseToolCallsFromText(content),
    forwardedDeltaText: forwardedIndex > 0,
    forwardedDeltaContent: stripDsmlWrappers(accumulated.slice(0, forwardedIndex))
  };
}

