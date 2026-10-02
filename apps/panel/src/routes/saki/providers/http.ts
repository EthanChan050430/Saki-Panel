import { randomUUID } from "node:crypto";
import {
  compactDebugText,
  errorMessageFromJson,
  fetchWithTimeout,
  linkAgentAbortSignal,
  logSakiModelEvent,
  RequestTimeoutError,
  RouteError,
  safeModelLogUrl,
  sakiVerboseModelLogsEnabled
} from "../types.js";
import {
  RATE_LIMIT_STATUS,
  defaultTemperatureOnlyModelKeys,
  isRetryableError,
  isTemperatureRequestError,
  isThinkingRequestError,
  modelTemperatureKey,
  parseRetryAfterMs,
  shouldSendCustomTemperature,
  sleep,
  summarizeModelRequestBody,
  summarizeModelResponsePayload,
  withoutNativeThinking,
  withoutTemperature,
  withRetry
} from "./common.js";

function bodyHasNativeThinking(body: Record<string, unknown>): boolean {
  return "enable_thinking" in body || "thinking" in body || "reasoning_effort" in body || "reasoning_budget" in body || "reasoning" in body;
}

async function requestWithCompatibleParameters<T>(
  provider: string,
  baseUrl: string,
  model: string,
  body: Record<string, unknown>,
  request: (payload: Record<string, unknown>) => Promise<T>
): Promise<T> {
  let compatibleBody = body;
  // A gateway may reject several optional parameters in succession. Each
  // retry removes an actual field, so this loop is bounded by the field count.
  while (true) {
    try {
      return await request(compatibleBody);
    } catch (error) {
      if (error instanceof RouteError && error.statusCode !== 400 && error.statusCode !== 422) throw error;
      if ("stream_options" in compatibleBody && /stream_options|include_usage/i.test(error instanceof Error ? error.message : String(error))) {
        const withoutUsage = { ...compatibleBody };
        delete withoutUsage.stream_options;
        compatibleBody = withoutUsage;
        continue;
      }
      if (bodyHasNativeThinking(compatibleBody) && isThinkingRequestError(error)) {
        logSakiModelEvent("thinking.retry", { provider, model, url: safeModelLogUrl(`${baseUrl}/chat/completions`), retry: "without-thinking" });
        compatibleBody = withoutNativeThinking(compatibleBody);
        continue;
      }
      if ("temperature" in compatibleBody && isTemperatureRequestError(error)) {
        defaultTemperatureOnlyModelKeys.add(modelTemperatureKey(provider, baseUrl, model));
        logSakiModelEvent("temperature.retry", { provider, model, url: safeModelLogUrl(`${baseUrl}/chat/completions`), retry: "without-temperature" });
        compatibleBody = withoutTemperature(compatibleBody);
        continue;
      }
      throw error;
    }
  }
}

export async function doRequestJsonPayload(url: string, options: RequestInit, timeoutMs: number, requestId: string): Promise<unknown> {
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
    const error = new RouteError(
      retryAfter && retryAfter > 3000
        ? `Model API rate limit exceeded (reset delay too long: ${Math.round(retryAfter / 1000)}s). Please try again later.`
        : `Model API request failed with ${response.status}: ${message}`,
      statusCode
    );
    if (retryAfter && retryAfter <= 3000 && statusCode === RATE_LIMIT_STATUS) {
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

export async function doRequestStreamingPayload<T>(
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
  const unlinkAgentAbort = linkAgentAbortSignal(controller);
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
    unlinkAgentAbort();
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
      const error = new RouteError(
        retryAfter && retryAfter > 3000
          ? `Model API rate limit exceeded (reset delay too long: ${Math.round(retryAfter / 1000)}s). Please try again later.`
          : `Model API request failed with ${response.status}: ${message}`,
        statusCode
      );
      if (retryAfter && retryAfter <= 3000 && statusCode === RATE_LIMIT_STATUS) {
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
    unlinkAgentAbort();
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
        headers: { accept: "application/json", ...headers },
        body: JSON.stringify(payload)
      },
      timeoutMs
    );

  return requestWithCompatibleParameters(provider, baseUrl, model, body, request);
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
        headers: { accept: "text/event-stream", ...headers },
        body: JSON.stringify(payload)
      },
      timeoutMs,
      consume
    );

  return requestWithCompatibleParameters(provider, baseUrl, model, body, request);
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

export function parseStreamJsonPayload(data: string): unknown | undefined {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    // A single malformed SSE/NDJSON frame must not abort the whole model stream.
    logSakiModelEvent("stream.bad_json", { preview: data.slice(0, 120) });
    return undefined;
  }
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
      const payload = parseStreamJsonPayload(line);
      if (payload !== undefined) onJson(payload);
    }
  });
  const line = buffer.trim();
  if (line) {
    const payload = parseStreamJsonPayload(line);
    if (payload !== undefined) onJson(payload);
  }
}

