import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { currentAgentAbortSignal, logSakiModelEvent, RequestTimeoutError, RouteError } from "../types.js";

export const modelTurnRetryDelaysMs = [2000, 4000, 8000] as const;
const modelTurnRetryStore = new AsyncLocalStorage<boolean>();

export function isModelTurnRetryManaged(): boolean {
  return modelTurnRetryStore.getStore() === true;
}

export interface ModelTurnRetryEvent {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  reason: string;
}

export function isRetryableModelTurnError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  if (/quota exceeded|billing|credit|balance|insufficient|reset delay too long/i.test(error.message)) return false;
  if (error instanceof RouteError) return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
  if (error instanceof RequestTimeoutError) return true;
  // Fetch body failures are often a TypeError('terminated') with a socket
  // error in cause, rather than the RouteError used for HTTP failures.
  const cause = error.cause as { code?: unknown } | undefined;
  const code = (error as Error & { code?: unknown }).code ?? cause?.code;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|UND_ERR_(?:SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)/i.test(String(code ?? ""))
    || /fetch failed|terminated|socket hang up|network error|connection (?:reset|closed|lost)|timed out|timeout|stream ended before/i.test(error.message);
}

/** Retry the whole inference with fresh provider state, before any tools run. */
export async function withModelTurnRetry<T>(
  operation: () => Promise<T>,
  options: {
    signal?: AbortSignal | undefined;
    onRetry?: ((event: ModelTurnRetryEvent) => void) | undefined;
    retryDelaysMs?: readonly number[];
  } = {}
): Promise<T> {
  const signal = options.signal ?? currentAgentAbortSignal();
  const retryDelays = options.retryDelaysMs ?? modelTurnRetryDelaysMs;
  return modelTurnRetryStore.run(true, async () => {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await operation();
      } catch (error) {
        signal?.throwIfAborted();
        if (!isRetryableModelTurnError(error)) throw error;
        const reason = (error as Error).message;
        if (attempt >= retryDelays.length) {
          throw Object.assign(new RouteError(`模型连接连续失败，已自动重试 ${attempt} 次。最后错误：${reason}`, 502), { cause: error, modelRetries: attempt });
        }
        const event = { attempt: attempt + 1, maxRetries: retryDelays.length, delayMs: retryDelays[attempt]!, reason };
        logSakiModelEvent("agent.model.retry", { ...event, reason: reason.slice(0, 200) });
        options.onRetry?.(event);
        await delay(event.delayMs, undefined, { signal });
      }
    }
  });
}

/** Suppress a regenerated prefix already displayed by an interrupted attempt. */
export function createRetryDeltaForwarder(forward?: (text: string) => void): {
  beginAttempt: () => ((text: string) => void) | undefined;
  completeAttempt: () => void;
} {
  let displayed = "";
  let attemptText = "";
  let matchedPrefix = false;
  return {
    beginAttempt: () => {
      if (!forward) return undefined;
      attemptText = "";
      matchedPrefix = false;
      return text => {
        if (!text) return;
        attemptText += text;
        if (matchedPrefix) {
          displayed += text;
          forward(text);
        } else if (attemptText.startsWith(displayed)) {
          const extra = attemptText.slice(displayed.length);
          displayed = attemptText;
          matchedPrefix = true;
          if (extra) forward(extra);
        } else if (!displayed.startsWith(attemptText)) {
          // Regeneration can choose different wording. Keep it visibly separate
          // from the incomplete attempt, never splice the two replies together.
          displayed = attemptText;
          matchedPrefix = true;
          forward(`\n\n${attemptText}`);
        }
      };
    },
    completeAttempt: () => {
      // A successful regenerated answer may be shorter than the failed prefix.
      // Make that answer visible instead of leaving the stale longer text last.
      if (forward && !matchedPrefix && attemptText && attemptText !== displayed) {
        displayed = attemptText;
        forward(`\n\n${attemptText}`);
      }
    }
  };
}
