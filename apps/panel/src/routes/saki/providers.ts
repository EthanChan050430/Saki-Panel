import { createHash, randomUUID } from "node:crypto";
import { CopilotClient, type MessageOptions, type ModelInfo, type PermissionHandler } from "@github/copilot-sdk";
import type { SakiChatRequest, SakiConfigResponse, SakiCopilotAuthStatusResponse, SakiCopilotLoginResponse, SakiModelOption, SakiProviderConfig } from "@webops/shared";
import { panelConfig } from "../../config.js";
import type { JsonSchema, ParsedToolCall, SakiAgentRuntime, SakiModelToolTurn } from "./types.js";
import {
  agentModelConfig,
  chatTextFromContent,
  compactDebugText,
  createStreamingTextState,
  effectiveSakiAgentPermissionMode,
  errorMessageFromJson,
  fetchWithTimeout,
  imageAttachments,
  isLikelyChatModel,
  localProviderUrls,
  logSakiModelEvent,
  modelOptionFromItem,
  normalizeHttpBaseUrl,
  normalizeProviderId,
  objectValue,
  openAiBaseUrl,
  providerBaseUrl,
  providerConfigFor,
  providerDefaults,
  pushStreamingTextDelta,
  RequestTimeoutError,
  RouteError,
  safeModelLogUrl,
  sanitizeProviderConfig,
  sakiVerboseModelLogsEnabled,
  stripThinking,
  trimString,
  uniqueModels,
} from "./types.js";
import { normalizeStructuredToolCall, openAiToolSchemas, parseStructuredToolCalls, sakiToolSchemas } from "./tools.js";
import { buildDirectMessages, buildDirectSystemPrompt, type DirectChatMessage, type DirectProviderMessage } from "./prompt.js";

const defaultTemperatureOnlyModelKeys = new Set<string>();

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const RATE_LIMIT_STATUS = 429;

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof RouteError)) return false;
  const message = error.message.toLowerCase();
  return (
    error.statusCode === RATE_LIMIT_STATUS ||
    error.statusCode === 503 ||
    error.statusCode === 502 ||
    /rate limit|too many requests|quota exceeded|capacity|overload|temporarily unavailable|timeout/i.test(message)
  );
}

function parseRetryAfterMs(response: Response): number | null {
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
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
      await sleep(delay);
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
  if (!shouldSendCustomTemperature(provider, baseUrl, model)) return body;
  return { ...body, temperature: preferredTemperature };
}

function withoutTemperature(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next.temperature;
  return next;
}

function isTemperatureRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /temperature/i.test(message) && /(?:only\s+1|default|unsupported|not\s+support|not\s+supported|invalid|unknown|unrecognized|for this model)/i.test(message);
}

async function doRequestJsonPayload(url: string, options: RequestInit, timeoutMs: number, requestId: string): Promise<unknown> {
  const startedAt = Date.now();
  logSakiModelEvent("request", {
    requestId,
    method: options.method ?? "GET",
    url: safeModelLogUrl(url),
    timeoutMs,
    ...summarizeModelRequestBody(options.body)
  });
  let response: Response;
  try {
    response = await fetchWithTimeout(url, options, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    logSakiModelEvent("error", {
      requestId,
      url: safeModelLogUrl(url),
      durationMs: Date.now() - startedAt,
      error: message
    });
    throw new RouteError(`Cannot reach ${url}: ${message}`, 502);
  }

  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      if (response.ok) {
        throw new RouteError(`Invalid JSON response from ${url}`, 502);
      }
    }
  }

  if (!response.ok) {
    const message = errorMessageFromJson(payload) || text.slice(0, 240) || response.statusText;
    const statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    logSakiModelEvent("response.error", {
      requestId,
      url: safeModelLogUrl(url),
      status: response.status,
      durationMs: Date.now() - startedAt,
      error: message,
      ...(sakiVerboseModelLogsEnabled() ? { responsePreview: compactDebugText(text, 1200) } : {})
    });
    const retryAfter = parseRetryAfterMs(response);
    const error = new RouteError(`Model API request failed with ${response.status}: ${message}`, statusCode);
    if (retryAfter && statusCode === RATE_LIMIT_STATUS) {
      await sleep(retryAfter);
    }
    throw error;
  }

  logSakiModelEvent("response", {
    requestId,
    url: safeModelLogUrl(url),
    status: response.status,
    durationMs: Date.now() - startedAt,
    ...summarizeModelResponsePayload(payload, text)
  });
  return payload ?? {};
}

export async function requestJsonPayload(url: string, options: RequestInit, timeoutMs: number): Promise<unknown> {
  const requestId = randomUUID().slice(0, 8);
  return withRetry(
    () => doRequestJsonPayload(url, options, timeoutMs, requestId),
    "requestJsonPayload",
    requestId
  );
}

async function doRequestStreamingPayload<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
  requestId: string
): Promise<T> {
  const startedAt = Date.now();
  logSakiModelEvent("stream.request", {
    requestId,
    method: options.method ?? "GET",
    url: safeModelLogUrl(url),
    timeoutMs,
    ...summarizeModelRequestBody(options.body)
  });
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    const message = timedOut ? new RequestTimeoutError(timeoutMs).message : error instanceof Error ? error.message : "request failed";
    clearTimeout(timeout);
    logSakiModelEvent("stream.error", {
      requestId,
      url: safeModelLogUrl(url),
      durationMs: Date.now() - startedAt,
      error: message
    });
    throw new RouteError(`Cannot reach ${url}: ${message}`, 502);
  }

  try {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = null;
        }
      }
      const message = errorMessageFromJson(payload) || text.slice(0, 240) || response.statusText;
      const statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      logSakiModelEvent("stream.response.error", {
        requestId,
        url: safeModelLogUrl(url),
        status: response.status,
        durationMs: Date.now() - startedAt,
        error: message,
        ...(sakiVerboseModelLogsEnabled() ? { responsePreview: compactDebugText(text, 1200) } : {})
      });
      const retryAfter = parseRetryAfterMs(response);
      const error = new RouteError(`Model API request failed with ${response.status}: ${message}`, statusCode);
      if (retryAfter && statusCode === RATE_LIMIT_STATUS) {
        await sleep(retryAfter);
      }
      throw error;
    }
    if (!response.body) {
      throw new RouteError(`Model API response from ${url} did not include a stream.`, 502);
    }
    let result: T;
    try {
      result = await consume(response);
    } catch (error) {
      if (timedOut) {
        const message = new RequestTimeoutError(timeoutMs).message;
        logSakiModelEvent("stream.error", {
          requestId,
          url: safeModelLogUrl(url),
          durationMs: Date.now() - startedAt,
          error: message
        });
        throw new RouteError(`Cannot reach ${url}: ${message}`, 502);
      }
      throw error;
    }
    logSakiModelEvent("stream.response", {
      requestId,
      url: safeModelLogUrl(url),
      status: response.status,
      durationMs: Date.now() - startedAt
    });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestStreamingPayload<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const requestId = randomUUID().slice(0, 8);
  return withRetry(
    () => doRequestStreamingPayload(url, options, timeoutMs, consume, requestId),
    "requestStreamingPayload",
    requestId
  );
}

export async function requestOpenAiCompatibleJsonPayload(
  provider: string,
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const url = `${baseUrl}/chat/completions`;
  const request = (payload: Record<string, unknown>) =>
    requestJsonPayload(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      },
      timeoutMs
    );

  try {
    return await request(body);
  } catch (error) {
    if (!("temperature" in body) || !isTemperatureRequestError(error)) throw error;
    defaultTemperatureOnlyModelKeys.add(modelTemperatureKey(provider, baseUrl, model));
    logSakiModelEvent("temperature.retry", {
      provider,
      model,
      url: safeModelLogUrl(url),
      retry: "without-temperature"
    });
    return request(withoutTemperature(body));
  }
}

export async function requestOpenAiCompatibleStreamingPayload<T>(
  provider: string,
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const url = `${baseUrl}/chat/completions`;
  const request = (payload: Record<string, unknown>) =>
    requestStreamingPayload(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      },
      timeoutMs,
      consume
    );

  try {
    return await request(body);
  } catch (error) {
    if (!("temperature" in body) || !isTemperatureRequestError(error)) throw error;
    defaultTemperatureOnlyModelKeys.add(modelTemperatureKey(provider, baseUrl, model));
    logSakiModelEvent("temperature.retry", {
      provider,
      model,
      url: safeModelLogUrl(url),
      retry: "without-temperature"
    });
    return request(withoutTemperature(body));
  }
}

export async function readUtf8Stream(response: Response, onChunk: (chunk: string) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new RouteError("Model API stream is not readable.", 502);
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
  } finally {
    reader.releaseLock();
  }
}

export async function readServerSentEventData(response: Response, onData: (data: string) => void): Promise<void> {
  let buffer = "";
  await readUtf8Stream(response, (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary < 0) break;
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) onData(data);
    }
  });

  const data = buffer
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (data) onData(data);
}

export async function readJsonLineData(response: Response, onJson: (payload: unknown) => void): Promise<void> {
  let buffer = "";
  await readUtf8Stream(response, (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (true) {
      const boundary = buffer.indexOf("\n");
      if (boundary < 0) break;
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      if (!line) continue;
      onJson(JSON.parse(line) as unknown);
    }
  });
  const line = buffer.trim();
  if (line) onJson(JSON.parse(line) as unknown);
}

function summarizeModelRequestBody(body: unknown): Record<string, unknown> {
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

function summarizeModelResponsePayload(payload: unknown, text: string): Record<string, unknown> {
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

export function collectModelItems(payload: unknown): unknown[] {
  const item = objectValue(payload);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(item?.data)) return item.data;
  if (Array.isArray(item?.models)) return item.models;
  if (Array.isArray(item?.result)) return item.result;
  return [];
}

export function requireChatModel(config: SakiConfigResponse, provider: string): string {
  const model = trimString(config.model);
  if (!model) {
    throw new RouteError(`Please select a model for ${provider}.`, 400);
  }
  return model;
}

export function requireCloudConfig(config: SakiConfigResponse, provider: string): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = providerBaseUrl(provider, config);
  const apiKey = trimString(config.apiKey);
  const model = requireChatModel(config, provider);
  if (!baseUrl) {
    throw new RouteError(`Please configure API Base URL for ${provider}.`, 400);
  }
  if (provider !== "lmstudio" && !apiKey) {
    throw new RouteError(`Please configure API Key for ${provider}.`, 400);
  }
  return { baseUrl, apiKey, model };
}

export function lastUserMessageIndex(messages: readonly DirectProviderMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

export function withOpenAiImageInputs(messages: DirectChatMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const result: DirectProviderMessage[] = messages.map((message) => ({ ...message }));
  const lastUserIndex = lastUserMessageIndex(result);
  if (lastUserIndex < 0) return result;
  const lastUser = result[lastUserIndex] as DirectProviderMessage;
  result[lastUserIndex] = {
    ...lastUser,
    content: [
      { type: "text", text: trimString(lastUser.content) },
      ...images.map((image) => ({
        type: "image_url",
        image_url: { url: image.dataUrl }
      }))
    ]
  };
  return result;
}

export function withAnthropicImageInputs(messages: DirectChatMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const result: DirectProviderMessage[] = messages.map((message) => ({ ...message }));
  const lastUserIndex = lastUserMessageIndex(result);
  if (lastUserIndex < 0) return result;
  const lastUser = result[lastUserIndex] as DirectProviderMessage;
  result[lastUserIndex] = {
    ...lastUser,
    content: [
      { type: "text", text: trimString(lastUser.content) },
      ...images.map((image) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType,
          data: image.base64
        }
      }))
    ]
  };
  return result;
}

export function withOllamaImageInputs(messages: DirectChatMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const result: DirectProviderMessage[] = messages.map((message) => ({ ...message }));
  const lastUserIndex = lastUserMessageIndex(result);
  if (lastUserIndex < 0) return result;
  const lastUser = result[lastUserIndex] as DirectProviderMessage;
  result[lastUserIndex] = {
    ...lastUser,
    images: images.map((image) => image.base64)
  };
  return result;
}

export function extractOpenAiChatText(payload: unknown): string {
  const root = objectValue(payload);
  const choice = Array.isArray(root?.choices) ? objectValue(root.choices[0]) : null;
  const message = objectValue(choice?.message);
  return stripThinking(chatTextFromContent(message?.content) || trimString(choice?.text));
}

export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  try {
    return parseStructuredToolCalls(text);
  } catch {
    return [];
  }
}

export function nativeToolCalls(value: unknown): ParsedToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ParsedToolCall[] = [];
  for (const raw of value) {
    try {
      calls.push(normalizeStructuredToolCall(raw));
    } catch {
      // Ignore malformed native tool calls
    }
  }
  return calls;
}

export function extractOpenAiChatTurn(payload: unknown): SakiModelToolTurn {
  const root = objectValue(payload);
  const choice = Array.isArray(root?.choices) ? objectValue(root.choices[0]) : null;
  const message = objectValue(choice?.message);
  const content = stripThinking(chatTextFromContent(message?.content) || trimString(choice?.text));
  const toolCalls = nativeToolCalls(message?.tool_calls);
  return {
    content,
    toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content)
  };
}

export function isToolCallingUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /tools?|tool_choice|function.?call|unsupported parameter|unknown parameter|unrecognized/.test(message);
}

// --- Model catalog fetching ---

export async function fetchOpenAiModelCatalog(provider: string, config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const { baseUrl, apiKey } = requireCloudConfig({ ...config, model: config.model || "model-detection" }, provider);
  const payload = await requestJsonPayload(
    `${baseUrl}/models`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`
      }
    },
    30000
  );
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem(provider, item))
      .filter((model): model is SakiModelOption => Boolean(model))
  ).sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchAnthropicModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const { baseUrl, apiKey } = requireCloudConfig({ ...config, model: config.model || "model-detection" }, "anthropic");
  const payload = await requestJsonPayload(
    `${baseUrl}/models`,
    {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    },
    30000
  );
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem("anthropic", item))
      .filter((model): model is SakiModelOption => Boolean(model))
  ).sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchOllamaModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const baseUrl = normalizeHttpBaseUrl(config.ollamaUrl, localProviderUrls.ollama);
  const payload = await requestJsonPayload(`${baseUrl}/api/tags`, { method: "GET" }, 12000);
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem("ollama", item))
      .filter((model): model is SakiModelOption => Boolean(model))
  );
}

export async function fetchLmStudioModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const baseUrl = providerBaseUrl("lmstudio", config);
  const payload = await requestJsonPayload(`${baseUrl}/models`, { method: "GET" }, 12000);
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem("lmstudio", item))
      .filter((model): model is SakiModelOption => Boolean(model))
  );
}

// --- Copilot SDK ---

let copilotClient: CopilotClient | null = null;
let copilotClientPromise: Promise<CopilotClient> | null = null;
let copilotClientTokenFingerprint = "";
let copilotClientPromiseTokenFingerprint = "";
let copilotLoginState: SakiCopilotLoginResponse = {
  status: "idle",
  command: "GitHub Device Flow",
  message: "\u5C1A\u672A\u767B\u5F55 GitHub Copilot\u3002"
};
const copilotMissingTokenMessage = "\u8BF7\u5148\u70B9\u51FB\u767B\u5F55 GitHub \u5B8C\u6210\u6388\u6743\u3002";
const copilotClassicTokenMessage =
  "\u5F53\u524D\u4FDD\u5B58\u7684\u662F Personal access tokens (classic)\u3002GitHub Copilot SDK \u9700\u8981 Fine-grained personal access token\uFF0C\u5E76\u5728 Permissions \u4E2D\u6DFB\u52A0 Copilot Requests\uFF1Bclassic PAT \u65E0\u6CD5\u8BA4\u8BC1\u3002";
const githubDeviceCodeUrl = "https://github.com/login/device/code";
const githubAccessTokenUrl = "https://github.com/login/oauth/access_token";
const githubDeviceGrantType = "urn:ietf:params:oauth:grant-type:device_code";

interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface GitHubAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

interface CopilotDeviceLoginSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  polling?: Promise<void>;
}

let copilotDeviceLoginSession: CopilotDeviceLoginSession | null = null;

const denyCopilotToolUse: PermissionHandler = () => ({
  kind: "user-not-available"
});

function copilotErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/auth|login|token|credential|not authenticated/i.test(message)) {
    return "GitHub Token \u672A\u901A\u8FC7 Copilot \u8BA4\u8BC1\u3002\u8BF7\u786E\u8BA4\u5B83\u662F Fine-grained PAT\u3001Permissions \u4E2D\u5DF2\u6DFB\u52A0 Copilot Requests\u3001\u8BE5\u8D26\u53F7\u6709\u6709\u6548 Copilot \u8BB8\u53EF\uFF0C\u4E14\u7EC4\u7EC7/\u4F01\u4E1A\u6CA1\u6709\u7981\u7528 Copilot CLI/SDK\u3002";
  }
  if (/copilot.*not.*found|could not find @github\/copilot|cli.*not.*found/i.test(message)) {
    return "GitHub Copilot SDK \u8FD0\u884C\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u786E\u8BA4 @github/copilot-sdk \u4F9D\u8D56\u5DF2\u5B89\u88C5\u3002";
  }
  return message || "GitHub Copilot \u6682\u65F6\u4E0D\u53EF\u7528\u3002";
}

function copilotTokenProblem(token: string): string | null {
  if (!token) return copilotMissingTokenMessage;
  if (/^ghp_/i.test(token)) return copilotClassicTokenMessage;
  return null;
}

function copilotTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function copilotTokenFromConfig(config: SakiConfigResponse, includeActiveApiKey = false): string {
  const savedToken = trimString(providerConfigFor(config.providerConfigs, "copilot").apiKey);
  if (includeActiveApiKey && normalizeProviderId(config.provider) === "copilot") {
    return trimString(config.apiKey) || savedToken;
  }
  return savedToken;
}

async function resetCopilotClient(): Promise<void> {
  const client = copilotClient;
  copilotClient = null;
  copilotClientPromise = null;
  copilotClientTokenFingerprint = "";
  copilotClientPromiseTokenFingerprint = "";
  if (client) {
    await client.stop().catch(() => []);
  }
}

async function getCopilotClient(gitHubToken: string): Promise<CopilotClient> {
  const token = trimString(gitHubToken);
  const tokenProblem = copilotTokenProblem(token);
  if (tokenProblem) throw new RouteError(tokenProblem, 400);

  const fingerprint = copilotTokenFingerprint(token);
  if (copilotClient && copilotClientTokenFingerprint === fingerprint) return copilotClient;
  if (copilotClient && copilotClientTokenFingerprint !== fingerprint) {
    await resetCopilotClient();
  }
  if (copilotClientPromise && copilotClientPromiseTokenFingerprint !== fingerprint) {
    await copilotClientPromise.catch(() => undefined);
    await resetCopilotClient();
  }
  if (!copilotClientPromise) {
    copilotClientPromiseTokenFingerprint = fingerprint;
    copilotClientPromise = (async () => {
      const client = new CopilotClient({
        logLevel: "error",
        sessionIdleTimeoutSeconds: 90,
        gitHubToken: token,
        useLoggedInUser: false,
        env: {
          ...process.env,
          COPILOT_GITHUB_TOKEN: token
        }
      });
      try {
        await client.start();
        copilotClient = client;
        copilotClientTokenFingerprint = fingerprint;
        return client;
      } catch (error) {
        await client.forceStop().catch(() => undefined);
        throw new RouteError(copilotErrorMessage(error), 503);
      }
    })().finally(() => {
      copilotClientPromise = null;
      copilotClientPromiseTokenFingerprint = "";
    });
  }
  return copilotClientPromise;
}

function copilotModelOptionFromInfo(model: ModelInfo): SakiModelOption | null {
  const id = trimString(model.id);
  if (!id) return null;
  if (model.policy?.state === "disabled") return null;
  return {
    provider: "copilot",
    id,
    name: trimString(model.name) || id,
    label: trimString(model.name) || id,
    vendor: "GitHub Copilot"
  };
}

export async function fetchCopilotModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  try {
    const client = await getCopilotClient(copilotTokenFromConfig(config, true));
    const models = await client.listModels();
    return uniqueModels(
      models
        .map(copilotModelOptionFromInfo)
        .filter((model): model is SakiModelOption => Boolean(model))
    ).sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(copilotErrorMessage(error), 401);
  }
}

export { copilotLoginState, copilotDeviceLoginSession };

export function getCopilotLoginState(): SakiCopilotLoginResponse {
  return copilotLoginState;
}

function githubOAuthClientId(): string {
  return trimString(panelConfig.githubOAuthClientId);
}

function githubOAuthErrorMessage(payload: { error?: string; error_description?: string }, fallback: string): string {
  const code = trimString(payload.error);
  const description = trimString(payload.error_description);
  if (code === "authorization_pending") return "\u7B49\u5F85 GitHub \u6388\u6743\u5B8C\u6210\u3002";
  if (code === "slow_down") return "GitHub \u8981\u6C42\u964D\u4F4E\u8F6E\u8BE2\u9891\u7387\uFF0C\u6B63\u5728\u7EE7\u7EED\u7B49\u5F85\u6388\u6743\u3002";
  if (code === "expired_token" || code === "token_expired") return "\u9A8C\u8BC1\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u767B\u5F55 GitHub\u3002";
  if (code === "access_denied") return "GitHub \u6388\u6743\u5DF2\u53D6\u6D88\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u767B\u5F55 GitHub\u3002";
  if (code === "device_flow_disabled") {
    return "GitHub OAuth App \u6CA1\u6709\u542F\u7528 Device Flow\uFF0C\u8BF7\u5728 OAuth App \u8BBE\u7F6E\u4E2D\u5F00\u542F\u3002";
  }
  if (code === "incorrect_client_credentials") {
    return "GITHUB_OAUTH_CLIENT_ID \u4E0D\u6B63\u786E\uFF0C\u8BF7\u68C0\u67E5 GitHub OAuth App \u7684 Client ID\u3002";
  }
  return description || code || fallback;
}

async function postGitHubOAuth<T extends { error?: string; error_description?: string }>(
  url: string,
  body: Record<string, string>
): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(body)
    },
    15000
  );
  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch {
    throw new RouteError(`GitHub OAuth returned ${response.status} without JSON.`, 502);
  }
  if (!response.ok) {
    throw new RouteError(githubOAuthErrorMessage(payload, `GitHub OAuth request failed with ${response.status}.`), response.status);
  }
  return payload;
}

export async function startCopilotDeviceLogin(): Promise<SakiCopilotLoginResponse> {
  const clientId = githubOAuthClientId();
  if (!clientId) {
    throw new RouteError("\u8BF7\u5148\u914D\u7F6E GITHUB_OAUTH_CLIENT_ID\uFF0C\u5E76\u5728 GitHub OAuth App \u4E2D\u542F\u7528 Device Flow\u3002", 400);
  }
  const payload = await postGitHubOAuth<GitHubDeviceCodeResponse>(githubDeviceCodeUrl, {
    client_id: clientId,
    ...(panelConfig.githubOAuthScope ? { scope: panelConfig.githubOAuthScope } : {})
  });
  if (payload.error) {
    throw new RouteError(githubOAuthErrorMessage(payload, "GitHub OAuth \u8BBE\u5907\u767B\u5F55\u542F\u52A8\u5931\u8D25\u3002"), 400);
  }
  const deviceCode = trimString(payload.device_code);
  const userCode = trimString(payload.user_code);
  const verificationUri = trimString(payload.verification_uri) || "https://github.com/login/device";
  if (!deviceCode || !userCode) {
    throw new RouteError("GitHub OAuth \u6CA1\u6709\u8FD4\u56DE\u8BBE\u5907\u9A8C\u8BC1\u7801\u3002", 502);
  }
  const expiresInMs = Math.max(60, Number(payload.expires_in) || 900) * 1000;
  const intervalMs = Math.max(3, Number(payload.interval) || 5) * 1000;
  copilotDeviceLoginSession = {
    deviceCode,
    userCode,
    verificationUri,
    expiresAt: Date.now() + expiresInMs,
    intervalMs,
    nextPollAt: Date.now() + intervalMs
  };
  copilotLoginState = {
    status: "running",
    command: "GitHub Device Flow",
    startedAt: new Date().toISOString(),
    verificationUri,
    userCode,
    message: "\u8BF7\u5728 GitHub \u8BBE\u5907\u767B\u5F55\u9875\u8F93\u5165\u9A8C\u8BC1\u7801\uFF0C\u6388\u6743\u5B8C\u6210\u540E\u8FD9\u91CC\u4F1A\u81EA\u52A8\u4FDD\u5B58\u767B\u5F55\u72B6\u6001\u3002"
  };
  return copilotLoginState;
}

export async function pollCopilotDeviceLogin(): Promise<void> {
  const session = copilotDeviceLoginSession;
  if (!session || copilotLoginState.status !== "running") return;
  const now = Date.now();
  if (now >= session.expiresAt) {
    copilotDeviceLoginSession = null;
    copilotLoginState = {
      ...copilotLoginState,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: "\u9A8C\u8BC1\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u767B\u5F55 GitHub\u3002"
    };
    return;
  }
  if (session.polling) {
    await session.polling;
    return;
  }
  if (now < session.nextPollAt) return;
  const clientId = githubOAuthClientId();
  if (!clientId) {
    copilotDeviceLoginSession = null;
    copilotLoginState = {
      ...copilotLoginState,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: "GITHUB_OAUTH_CLIENT_ID \u672A\u914D\u7F6E\uFF0C\u65E0\u6CD5\u5B8C\u6210 GitHub \u767B\u5F55\u3002"
    };
    return;
  }

  session.nextPollAt = now + session.intervalMs;
  session.polling = (async () => {
    try {
      const payload = await postGitHubOAuth<GitHubAccessTokenResponse>(githubAccessTokenUrl, {
        client_id: clientId,
        device_code: session.deviceCode,
        grant_type: githubDeviceGrantType
      });
      const accessToken = trimString(payload.access_token);
      if (accessToken) {
        await persistCopilotToken(accessToken);
        copilotDeviceLoginSession = null;
        copilotLoginState = {
          status: "completed",
          command: "GitHub Device Flow",
          ...(copilotLoginState.startedAt ? { startedAt: copilotLoginState.startedAt } : {}),
          finishedAt: new Date().toISOString(),
          message: "GitHub \u767B\u5F55\u5B8C\u6210\uFF0CToken \u5DF2\u8BB0\u5F55\u3002"
        };
        return;
      }
      const code = trimString(payload.error);
      if (code === "authorization_pending") {
        copilotLoginState = {
          ...copilotLoginState,
          message: "\u7B49\u5F85 GitHub \u6388\u6743\u5B8C\u6210\u3002"
        };
        return;
      }
      if (code === "slow_down") {
        session.intervalMs = Math.max(session.intervalMs + 5000, (Number(payload.interval) || 0) * 1000);
        copilotLoginState = {
          ...copilotLoginState,
          message: "GitHub \u8981\u6C42\u964D\u4F4E\u8F6E\u8BE2\u9891\u7387\uFF0C\u6B63\u5728\u7EE7\u7EED\u7B49\u5F85\u6388\u6743\u3002"
        };
        return;
      }
      copilotDeviceLoginSession = null;
      copilotLoginState = {
        ...copilotLoginState,
        status: "failed",
        finishedAt: new Date().toISOString(),
        message: githubOAuthErrorMessage(payload, "GitHub \u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5C1D\u8BD5\u3002")
      };
    } catch (error) {
      copilotDeviceLoginSession = null;
      copilotLoginState = {
        ...copilotLoginState,
        status: "failed",
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "GitHub \u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5C1D\u8BD5\u3002"
      };
    } finally {
      if (copilotDeviceLoginSession === session) {
        delete session.polling;
      }
    }
  })();
  await session.polling;
}

export async function readCopilotLoginState(): Promise<SakiCopilotLoginResponse> {
  await pollCopilotDeviceLogin();
  return copilotLoginState;
}

export async function readCopilotAuthStatus(): Promise<SakiCopilotAuthStatusResponse> {
  throw new RouteError("readCopilotAuthStatus requires config access; use index.ts wrapper.", 500);
}

async function persistCopilotToken(gitHubToken: string): Promise<void> {
  throw new RouteError("persistCopilotToken requires config access; use index.ts wrapper.", 500);
}

export async function saveCopilotToken(gitHubToken: string): Promise<SakiCopilotLoginResponse> {
  throw new RouteError("saveCopilotToken requires config access; use index.ts wrapper.", 500);
}

function copilotPromptFromMessages(input: SakiChatRequest, prompt: string): string {
  const messages = buildDirectMessages(input, prompt);
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");
}

function copilotMessageOptions(input: SakiChatRequest, prompt: string): MessageOptions {
  const images = imageAttachments(input);
  if (images.length === 0) {
    return { prompt };
  }
  return {
    prompt,
    attachments: images.map((image, index) => ({
      type: "blob" as const,
      data: image.base64,
      mimeType: image.mimeType,
      displayName: `attachment-${index + 1}`
    }))
  };
}

async function createCopilotSession(config: SakiConfigResponse, streaming: boolean) {
  const client = await getCopilotClient(copilotTokenFromConfig(config, true));
  return client.createSession({
    clientName: "Saki Panel",
    model: requireChatModel(config, "copilot"),
    enableConfigDiscovery: false,
    availableTools: [],
    streaming,
    systemMessage: {
      content: buildDirectSystemPrompt(config)
    },
    infiniteSessions: {
      enabled: false
    },
    onPermissionRequest: denyCopilotToolUse
  });
}

export async function callCopilotSdkModel(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<string> {
  let session: Awaited<ReturnType<typeof createCopilotSession>> | null = null;
  try {
    session = await createCopilotSession(config, false);
    const response = await session.sendAndWait(
      copilotMessageOptions(input, copilotPromptFromMessages(input, prompt)),
      config.requestTimeoutMs
    );
    const text = stripThinking(response?.data.content ?? "");
    if (!text) throw new RouteError("GitHub Copilot returned an empty response.", 502);
    return text;
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(copilotErrorMessage(error), 502);
  } finally {
    if (session) {
      await session.disconnect().catch(() => undefined);
    }
  }
}

export async function callCopilotSdkModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void
): Promise<string> {
  let session: Awaited<ReturnType<typeof createCopilotSession>> | null = null;
  let unsubscribe: (() => void) | null = null;
  const state = createStreamingTextState();
  try {
    session = await createCopilotSession(config, true);
    unsubscribe = session.on("assistant.message_delta", (event) => {
      pushStreamingTextDelta(state, event.data.deltaContent, onDelta);
    });
    const response = await session.sendAndWait(
      copilotMessageOptions(input, copilotPromptFromMessages(input, prompt)),
      config.requestTimeoutMs
    );
    const text = stripThinking(response?.data.content ?? state.raw);
    if (!text) throw new RouteError("GitHub Copilot returned an empty response.", 502);
    return text;
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(copilotErrorMessage(error), 502);
  } finally {
    if (unsubscribe) unsubscribe();
    if (session) {
      await session.disconnect().catch(() => undefined);
    }
  }
}

export async function callCopilotSdkAgentTurn(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<SakiModelToolTurn> {
  const content = await callCopilotSdkModel(config, input, prompt);
  return {
    content,
    toolCalls: parseToolCallsFromText(content)
  };
}

// --- OpenAI-compatible provider calls ---

export async function callOpenAiCompatibleModel(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, provider);
  const payload = await requestOpenAiCompatibleJsonPayload(
    provider,
    baseUrl,
    model,
    {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    openAiCompatibleChatBody(
      provider,
      baseUrl,
      model,
      {
        model,
        messages: withOpenAiImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input)
      },
      0.3
    ),
    config.requestTimeoutMs
  );
  const text = extractOpenAiChatText(payload);
  if (!text) throw new RouteError("Model API returned an empty response.", 502);
  return text;
}

function openAiStreamDelta(payload: unknown): string {
  const root = objectValue(payload);
  const choice = Array.isArray(root?.choices) ? objectValue(root.choices[0]) : null;
  const delta = objectValue(choice?.delta);
  return chatTextFromContent(delta?.content) || trimString(delta?.text) || trimString(choice?.text);
}

export async function callOpenAiCompatibleModelStream(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void
): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, provider);
  const state = createStreamingTextState();
  await requestOpenAiCompatibleStreamingPayload(
    provider,
    baseUrl,
    model,
    {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    openAiCompatibleChatBody(
      provider,
      baseUrl,
      model,
      {
        model,
        messages: withOpenAiImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input),
        stream: true
      },
      0.3
    ),
    config.requestTimeoutMs,
    async (response) => {
      await readServerSentEventData(response, (data) => {
        if (data === "[DONE]") return;
        const chunk = openAiStreamDelta(JSON.parse(data) as unknown);
        pushStreamingTextDelta(state, chunk, onDelta);
      });
    }
  );
  const text = stripThinking(state.raw);
  if (!text) throw new RouteError("Model API returned an empty response.", 502);
  return text;
}

export async function callOpenAiCompatibleAgentTurn(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<SakiModelToolTurn> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, provider);
  const payload = await requestOpenAiCompatibleJsonPayload(
    provider,
    baseUrl,
    model,
    {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    openAiCompatibleChatBody(
      provider,
      baseUrl,
      model,
      {
        model,
        messages: withOpenAiImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input),
        tools: openAiToolSchemas(),
        tool_choice: "auto"
      },
      0.2
    ),
    config.requestTimeoutMs
  );
  return extractOpenAiChatTurn(payload);
}

export async function callOpenAiCompatiblePromptAgentTurn(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<SakiModelToolTurn> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, provider);
  const payload = await requestOpenAiCompatibleJsonPayload(
    provider,
    baseUrl,
    model,
    {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    openAiCompatibleChatBody(
      provider,
      baseUrl,
      model,
      {
        model,
        messages: withOpenAiImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input)
      },
      0.2
    ),
    config.requestTimeoutMs
  );
  const content = extractOpenAiChatText(payload);
  return { content, toolCalls: parseToolCallsFromText(content) };
}

export async function callOpenAiCompatibleAgentTurnWithFallback(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<SakiModelToolTurn> {
  try {
    return await callOpenAiCompatibleAgentTurn(provider, config, input, prompt);
  } catch (error) {
    if (isToolCallingUnsupportedError(error)) {
      return callOpenAiCompatiblePromptAgentTurn(provider, config, input, prompt);
    }
    throw error;
  }
}

// --- Anthropic provider calls ---

export async function callAnthropicModel(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const messages = withAnthropicImageInputs(buildDirectMessages(input, prompt), input).filter((message) => message.role !== "system");
  const payload = await requestJsonPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: buildDirectSystemPrompt(config),
        messages
      })
    },
    config.requestTimeoutMs
  );
  const text = stripThinking(chatTextFromContent(objectValue(payload)?.content));
  if (!text) throw new RouteError("Model API returned an empty response.", 502);
  return text;
}

function anthropicStreamDelta(payload: unknown): string {
  const item = objectValue(payload);
  const type = trimString(item?.type);
  if (type === "content_block_delta") {
    const delta = objectValue(item?.delta);
    return trimString(delta?.text);
  }
  if (type === "content_block_start") {
    const block = objectValue(item?.content_block);
    return trimString(block?.text);
  }
  return "";
}

export async function callAnthropicModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void
): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const messages = withAnthropicImageInputs(buildDirectMessages(input, prompt), input).filter((message) => message.role !== "system");
  const state = createStreamingTextState();
  await requestStreamingPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: buildDirectSystemPrompt(config),
        messages,
        stream: true
      })
    },
    config.requestTimeoutMs,
    async (response) => {
      await readServerSentEventData(response, (data) => {
        const chunk = anthropicStreamDelta(JSON.parse(data) as unknown);
        pushStreamingTextDelta(state, chunk, onDelta);
      });
    }
  );
  const text = stripThinking(state.raw);
  if (!text) throw new RouteError("Model API returned an empty response.", 502);
  return text;
}

export async function callAnthropicAgentTurn(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<SakiModelToolTurn> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const messages = withAnthropicImageInputs(buildDirectMessages(input, prompt), input).filter((message) => message.role !== "system");
  const payload = await requestJsonPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: buildDirectSystemPrompt(config),
        messages,
        tools: sakiToolSchemas.map((schema) => ({
          name: schema.name,
          description: schema.description,
          input_schema: schema.parameters
        }))
      })
    },
    config.requestTimeoutMs
  );
  const blocks = Array.isArray(objectValue(payload)?.content) ? (objectValue(payload)?.content as unknown[]) : [];
  const toolCalls = nativeToolCalls(
    blocks
      .map((block) => {
        const item = objectValue(block);
        return item?.type === "tool_use"
          ? { id: item.id, name: item.name, arguments: item.input }
          : null;
      })
      .filter(Boolean)
  );
  const content = stripThinking(chatTextFromContent(blocks));
  return { content, toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content) };
}

// --- Ollama provider calls ---

export async function callOllamaModel(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<string> {
  const baseUrl = normalizeHttpBaseUrl(config.ollamaUrl, localProviderUrls.ollama);
  const payload = await requestJsonPayload(
    `${baseUrl}/api/chat`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: requireChatModel(config, "ollama"),
        stream: false,
        messages: withOllamaImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input)
      })
    },
    config.requestTimeoutMs
  );
  const message = objectValue(objectValue(payload)?.message);
  const text = stripThinking(chatTextFromContent(message?.content) || trimString(objectValue(payload)?.response));
  if (!text) throw new RouteError("Ollama returned an empty response.", 502);
  return text;
}

function ollamaStreamDelta(payload: unknown): string {
  const item = objectValue(payload);
  const message = objectValue(item?.message);
  return chatTextFromContent(message?.content) || trimString(item?.response);
}

export async function callOllamaModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void
): Promise<string> {
  const baseUrl = normalizeHttpBaseUrl(config.ollamaUrl, localProviderUrls.ollama);
  const state = createStreamingTextState();
  await requestStreamingPayload(
    `${baseUrl}/api/chat`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: requireChatModel(config, "ollama"),
        stream: true,
        messages: withOllamaImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input)
      })
    },
    config.requestTimeoutMs,
    async (response) => {
      await readJsonLineData(response, (payload) => {
        const chunk = ollamaStreamDelta(payload);
        pushStreamingTextDelta(state, chunk, onDelta);
      });
    }
  );
  const text = stripThinking(state.raw);
  if (!text) throw new RouteError("Ollama returned an empty response.", 502);
  return text;
}

export async function callOllamaAgentTurn(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<SakiModelToolTurn> {
  const baseUrl = normalizeHttpBaseUrl(config.ollamaUrl, localProviderUrls.ollama);
  const requestTurn = async (withTools: boolean): Promise<SakiModelToolTurn> => {
    const payload = await requestJsonPayload(
      `${baseUrl}/api/chat`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: requireChatModel(config, "ollama"),
          stream: false,
          messages: withOllamaImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input),
          ...(withTools ? { tools: openAiToolSchemas() } : {})
        })
      },
      config.requestTimeoutMs
    );
    const message = objectValue(objectValue(payload)?.message);
    const content = stripThinking(chatTextFromContent(message?.content) || trimString(objectValue(payload)?.response));
    const toolCalls = nativeToolCalls(message?.tool_calls);
    return { content, toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content) };
  };

  try {
    return await requestTurn(true);
  } catch (error) {
    if (isToolCallingUnsupportedError(error)) {
      return requestTurn(false);
    }
    throw error;
  }
}

// --- Configured provider dispatch ---

export async function callConfiguredPrompt(input: SakiChatRequest, prompt: string, config: SakiConfigResponse) {
  const provider = normalizeProviderId(config.provider);

  if (provider === "ollama") {
    return callOllamaModel(config, input, prompt);
  }
  if (provider === "lmstudio") {
    return callOpenAiCompatibleModel("lmstudio", config, input, prompt);
  }
  if (provider === "anthropic") {
    return callAnthropicModel(config, input, prompt);
  }
  if (provider === "copilot") {
    return callCopilotSdkModel(config, input, prompt);
  }
  return callOpenAiCompatibleModel(provider, config, input, prompt);
}

export async function callConfiguredPromptStream(input: SakiChatRequest, prompt: string, onDelta: (text: string) => void, config: SakiConfigResponse) {
  const provider = normalizeProviderId(config.provider);

  if (provider === "ollama") {
    return callOllamaModelStream(config, input, prompt, onDelta);
  }
  if (provider === "lmstudio") {
    return callOpenAiCompatibleModelStream("lmstudio", config, input, prompt, onDelta);
  }
  if (provider === "anthropic") {
    return callAnthropicModelStream(config, input, prompt, onDelta);
  }
  if (provider === "copilot") {
    return callCopilotSdkModelStream(config, input, prompt, onDelta);
  }
  return callOpenAiCompatibleModelStream(provider, config, input, prompt, onDelta);
}

export async function callConfiguredAgentTurn(runtime: SakiAgentRuntime, prompt: string): Promise<SakiModelToolTurn> {
  const provider = normalizeProviderId(runtime.config.provider);
  const config = agentModelConfig(runtime.config);
  const startedAt = Date.now();
  try {
    let turn: SakiModelToolTurn;
    if (provider === "ollama") {
      turn = await callOllamaAgentTurn(config, runtime.input, prompt);
    } else if (provider === "lmstudio") {
      turn = await callOpenAiCompatibleAgentTurnWithFallback("lmstudio", config, runtime.input, prompt);
    } else if (provider === "anthropic") {
      turn = await callAnthropicAgentTurn(config, runtime.input, prompt);
    } else if (provider === "copilot") {
      turn = await callCopilotSdkAgentTurn(config, runtime.input, prompt);
    } else {
      turn = await callOpenAiCompatibleAgentTurnWithFallback(provider, config, runtime.input, prompt);
    }
    logSakiModelEvent("agent.turn", {
      provider,
      model: config.model,
      mode: runtime.input.mode ?? "agent",
      permissionMode: effectiveSakiAgentPermissionMode(runtime.input),
      timeoutMs: config.requestTimeoutMs,
      promptChars: prompt.length,
      contentChars: turn.content.length,
      toolCalls: turn.toolCalls.map((call) => call.name),
      durationMs: Date.now() - startedAt
    });
    return turn;
  } catch (error) {
    logSakiModelEvent("agent.turn.error", {
      provider,
      model: config.model,
      mode: runtime.input.mode ?? "agent",
      timeoutMs: config.requestTimeoutMs,
      promptChars: prompt.length,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
