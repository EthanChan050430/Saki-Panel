import type { SakiChatRequest, SakiConfigResponse } from "@webops/shared";
import type { SakiAgentRuntime, SakiModelToolTurn } from "../types.js";
import {
  agentModelConfig,
  createStreamingTextState,
  effectiveSakiAgentPermissionMode,
  flushStreamingTextState,
  logSakiModelEvent,
  normalizeProviderId,
  pushStreamingTextDelta,
  RouteError,
  sakiVerboseModelLogsEnabled,
  stripThinking,
  withAgentAbortSignal
} from "../types.js";
import { agentSystemPromptForConfig, withAgentTurnConversation } from "../agent-messages.js";
import { buildAgentWorkspacePrefix } from "../prompt.js";
import { toolSchemasForRuntime, withAdvertisedSakiToolSchemas } from "../tools.js";
import {
  callCopilotSdkAgentTurn,
  callCopilotSdkModel,
  callCopilotSdkModelStream
} from "./copilot.js";
import {
  callOpenAiCompatibleAgentTurn,
  callOpenAiCompatibleAgentTurnStream,
  callOpenAiCompatibleAgentTurnStreamWithFallback,
  callOpenAiCompatibleAgentTurnWithFallback,
  callOpenAiCompatibleModel,
  callOpenAiCompatibleModelStream,
  callOpenAiCompatiblePromptAgentTurn,
  callOpenAiCompatiblePromptAgentTurnStream
} from "./openai.js";
import {
  callAnthropicAgentTurn,
  callAnthropicAgentTurnStream,
  callAnthropicAgentTurnStreamWithFallback,
  callAnthropicModel,
  callAnthropicModelStream
} from "./anthropic.js";
import {
  callAntigravityAgentTurn,
  callAntigravityAgentTurnStream,
  callAntigravityModel,
  callAntigravityModelStream
} from "./antigravity.js";
import {
  callOllamaAgentTurn,
  callOllamaAgentTurnStream,
  callOllamaAgentTurnStreamWithFallback,
  callOllamaModel,
  callOllamaModelStream
} from "./ollama.js";
import { streamPromptAgentTurnWithFilteredDelta } from "./common.js";

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
  if (provider === "antigravity") {
    return callAntigravityModel(config, input, prompt);
  }
  return callOpenAiCompatibleModel(provider, config, input, prompt);
}

export async function callConfiguredPromptStream(
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  config: SakiConfigResponse,
  onThinking?: (text: string) => void
) {
  const provider = normalizeProviderId(config.provider);

  if (provider === "ollama") {
    return callOllamaModelStream(config, input, prompt, onDelta, onThinking);
  }
  if (provider === "lmstudio") {
    return callOpenAiCompatibleModelStream("lmstudio", config, input, prompt, onDelta, onThinking);
  }
  if (provider === "anthropic") {
    return callAnthropicModelStream(config, input, prompt, onDelta, onThinking);
  }
  if (provider === "copilot") {
    return callCopilotSdkModelStream(config, input, prompt, onDelta, onThinking);
  }
  if (provider === "antigravity") {
    return callAntigravityModelStream(config, input, prompt, onDelta, onThinking);
  }
  return callOpenAiCompatibleModelStream(provider, config, input, prompt, onDelta, onThinking);
}

export async function callCopilotPromptAgentTurnStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  return streamPromptAgentTurnWithFilteredDelta(
    (filteredDelta) => callCopilotSdkModelStream(config, input, prompt, filteredDelta, onThinking),
    onDelta,
    onThinking
  );
}

export async function callConfiguredAgentTurnStream(
  runtime: SakiAgentRuntime,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const provider = normalizeProviderId(runtime.config.provider);
  const config = agentModelConfig(runtime.config);
  if (provider === "ollama") {
    return callOllamaAgentTurnStreamWithFallback(config, runtime.input, prompt, onDelta, onThinking);
  }
  if (provider === "lmstudio") {
    return callOpenAiCompatibleAgentTurnStreamWithFallback("lmstudio", config, runtime.input, prompt, onDelta, onThinking);
  }
  if (provider === "anthropic") {
    return callAnthropicAgentTurnStreamWithFallback(config, runtime.input, prompt, onDelta, onThinking);
  }
  if (provider === "copilot") {
    return callCopilotPromptAgentTurnStream(config, runtime.input, prompt, onDelta, onThinking);
  }
  if (provider === "antigravity") {
    return callAntigravityAgentTurnStream(config, runtime.input, prompt, onDelta, onThinking);
  }
  return callOpenAiCompatibleAgentTurnStreamWithFallback(provider, config, runtime.input, prompt, onDelta, onThinking);
}

export async function callConfiguredAgentTurn(
  runtime: SakiAgentRuntime,
  prompt: string,
  onDelta?: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  // Bind the task abort signal into this async context so every provider HTTP
  // call made for the turn is hard-aborted the moment the task is cancelled.
  return withAgentAbortSignal(runtime.abortController?.signal, () =>
    withAdvertisedSakiToolSchemas(toolSchemasForRuntime(runtime), () =>
      withAgentTurnConversation(
        runtime.turnMessages?.length
          ? {
              systemPrompt: `${agentSystemPromptForConfig(runtime.config, runtime.systemPromptOverride)}\n\n${buildAgentWorkspacePrefix(runtime)}`,
              messages: runtime.turnMessages
            }
          : undefined,
        () => callConfiguredAgentTurnUnfiltered(runtime, prompt, onDelta, onThinking)
      )
    )
  );
}

export async function callConfiguredAgentTurnUnfiltered(
  runtime: SakiAgentRuntime,
  prompt: string,
  onDelta?: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const provider = normalizeProviderId(runtime.config.provider);
  const config = agentModelConfig(runtime.config);
  const startedAt = Date.now();
  try {
    let turn: SakiModelToolTurn;
    if (onDelta) {
      turn = await callConfiguredAgentTurnStream(runtime, prompt, onDelta, onThinking);
    } else if (provider === "ollama") {
      turn = { ...(await callOllamaAgentTurn(config, runtime.input, prompt)), forwardedDeltaText: false };
    } else if (provider === "lmstudio") {
      turn = { ...(await callOpenAiCompatibleAgentTurnWithFallback("lmstudio", config, runtime.input, prompt)), forwardedDeltaText: false };
    } else if (provider === "anthropic") {
      turn = { ...(await callAnthropicAgentTurn(config, runtime.input, prompt)), forwardedDeltaText: false };
    } else if (provider === "copilot") {
      turn = { ...(await callCopilotSdkAgentTurn(config, runtime.input, prompt)), forwardedDeltaText: false };
    } else if (provider === "antigravity") {
      turn = { ...(await callAntigravityAgentTurn(config, runtime.input, prompt)), forwardedDeltaText: false };
    } else {
      turn = { ...(await callOpenAiCompatibleAgentTurnWithFallback(provider, config, runtime.input, prompt)), forwardedDeltaText: false };
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
    if (sakiVerboseModelLogsEnabled()) {
      console.info(`[Saki debug] agent.turn content:\n${turn.content}`);
      console.info(`[Saki debug] agent.turn toolCalls (${turn.toolCalls.length}):\n${JSON.stringify(turn.toolCalls, null, 2)}`);
    }
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

