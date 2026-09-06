import { randomUUID } from "node:crypto";
import type { SakiChatRequest, SakiConfigResponse, SakiModelOption } from "@webops/shared";
import type { SakiModelToolTurn } from "../types.js";
import {
  compactDebugText,
  currentAgentAbortSignal,
  errorMessageFromJson,
  logSakiModelEvent,
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
  stripThinking,
  trimString
} from "../types.js";
import { openAiToolSchemas } from "../tools.js";
import { nativeThinkingChatExtras } from "../model-profile.js";
import { extractProviderUsage, estimateModelCallTokens, mergeModelUsage, modelUsageTotal, type ModelUsage } from "../../../tokenizer.js";
import { parseToolCallsFromText } from "./catalog.js";

export const defaultTemperatureOnlyModelKeys = new Set<string>();

export function withTurnUsage(
  turn: SakiModelToolTurn,
  prompt: string,
  payload?: unknown,
  includeToolSchemas = false
): SakiModelToolTurn {
  const fromApi = modelUsageTotal(extractProviderUsage(payload));
  const tokens =
    fromApi ||
    estimateModelCallTokens(
      prompt,
      turn.content,
      turn.toolCalls,
      "gpt-4",
      includeToolSchemas ? JSON.stringify(openAiToolSchemas()) : undefined
    );
  return tokens > 0 ? { ...turn, usageTokens: tokens } : turn;
}

export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 2000;
export const RATE_LIMIT_STATUS = 429;

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof RouteError)) return false;
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
  preferredTemperature: number
): Record<string, unknown> {
  const withThinking = { ...body, ...nativeThinkingChatExtras(provider, model) };
  if (!shouldSendCustomTemperature(provider, baseUrl, model)) return withThinking;
  return { ...withThinking, temperature: preferredTemperature };
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
  delete next.reasoning;
  return next;
}

export function isThinkingRequestError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /enable_thinking|reasoning_effort|\bthinking\b/.test(message) && /unsupported|unknown|invalid|unrecognized|not\s+support|unexpected/.test(message);
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
      onThinking(thinking.slice(thinkingEmitted));
      thinkingEmitted = thinking.length;
    }
  };
  const stopPatterns = ["```json", '{"tool_calls"', '{"toolcalls"', "<tool_call", "<invoke"];
  const maxPrefixLen = Math.max(...stopPatterns.map((pattern) => pattern.length));
  const filteredDelta = (text: string) => {
    accumulated += text;
    emitThinking();
    if (stoppedStreaming) return;
    const lower = accumulated.toLowerCase();
    let stopIndex = -1;
    for (const pattern of stopPatterns) {
      const index = lower.indexOf(pattern.toLowerCase());
      if (index !== -1 && (stopIndex === -1 || index < stopIndex)) stopIndex = index;
    }
    if (stopIndex !== -1) {
      stoppedStreaming = true;
      if (stopIndex > forwardedIndex) onDelta(accumulated.slice(forwardedIndex, stopIndex));
      forwardedIndex = stopIndex;
      return;
    }
    const safeEnd = accumulated.length - maxPrefixLen;
    if (safeEnd > forwardedIndex) {
      onDelta(accumulated.slice(forwardedIndex, safeEnd));
      forwardedIndex = safeEnd;
    }
  };

  const content = await contentStream(filteredDelta);
  emitThinking();
  if (!stoppedStreaming) {
    const visible = stripThinking(accumulated);
    if (forwardedIndex < visible.length) {
      const tail = visible.slice(forwardedIndex);
      if (tail && !/<tool_call/i.test(tail) && !/<invoke/i.test(tail) && !/"?tool_calls"?\s*:/i.test(tail)) {
        onDelta(tail);
        forwardedIndex = visible.length;
      }
    }
  }
  return {
    content,
    toolCalls: parseToolCallsFromText(content),
    forwardedDeltaText: forwardedIndex > 0,
    forwardedDeltaContent: accumulated.slice(0, forwardedIndex)
  };
}

