import type { SakiChatRequest, SakiConfigResponse } from "@webops/shared";
import type { ParsedToolCall, SakiAgentRuntime, SakiModelToolTurn } from "../types.js";
import {
  chatTextFromContent,
  createStreamingTextState,
  effectiveSakiAgentPermissionMode,
  flushStreamingTextState,
  localProviderUrls,
  normalizeHttpBaseUrl,
  objectValue,
  providerConfigFor,
  pushStreamingTextDelta,
  RouteError,
  extractReasoningText,
  stripThinking,
  trimString
} from "../types.js";
import { sakiModelWantsNativeThinking } from "../model-profile.js";
import { openAiToolSchemas, toolSchemasForRuntime, withAdvertisedSakiToolSchemas } from "../tools.js";
import { buildDirectMessages, buildDirectSystemPrompt } from "../prompt.js";
import { buildOllamaAgentMessages } from "../agent-messages.js";
import { extractProviderUsage, mergeModelUsage, type ModelUsage } from "../../../tokenizer.js";
import { streamPromptAgentTurnWithFilteredDelta, withTurnUsage } from "./common.js";
import { readJsonLineData, requestJsonPayload, requestStreamingPayload } from "./http.js";
import {
  extractOpenAiChatText,
  extractOpenAiChatTurn,
  isToolCallingUnsupportedError,
  nativeToolCalls,
  parseToolCallsFromText,
  requireChatModel,
  withOllamaImageInputs
} from "./catalog.js";
import { OpenAiStreamToolCallAccumulator } from "./openai.js";

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
        ...(sakiModelWantsNativeThinking("ollama", config.model) ? { think: true } : {}),
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

export function ollamaStreamDelta(payload: unknown): { content: string; reasoningContent?: string | undefined } {
  const item = objectValue(payload);
  const message = objectValue(item?.message);
  const content = chatTextFromContent(message?.content) || trimString(item?.response);
  const reasoningContent =
    extractReasoningText(message) ||
    extractReasoningText(item) ||
    trimString(message?.thinking);
  return { content, reasoningContent: reasoningContent || undefined };
}

export async function callOllamaModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
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
        ...(sakiModelWantsNativeThinking("ollama", config.model) ? { think: true } : {}),
        messages: withOllamaImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input)
      })
    },
    config.requestTimeoutMs,
    async (response) => {
      await readJsonLineData(response, (payload) => {
        const chunk = ollamaStreamDelta(payload);
        pushStreamingTextDelta(state, chunk.content, onDelta, onThinking, chunk.reasoningContent);
      });
    }
  );
  flushStreamingTextState(state, onDelta, onThinking);
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
          ...(sakiModelWantsNativeThinking("ollama", config.model) ? { think: true } : {}),
          messages: buildOllamaAgentMessages(input, prompt, config),
          ...(withTools ? { tools: openAiToolSchemas() } : {})
        })
      },
      config.requestTimeoutMs
    );
    const message = objectValue(objectValue(payload)?.message);
    const content = stripThinking(chatTextFromContent(message?.content) || trimString(objectValue(payload)?.response));
    const toolCalls = nativeToolCalls(message?.tool_calls);
    return withTurnUsage(
      { content, toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content) },
      prompt,
      payload,
      withTools
    );
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

export function ollamaAgentStreamChunk(payload: unknown): { content: string; toolCalls: unknown[]; reasoningContent?: string | undefined } {
  const item = objectValue(payload);
  const message = objectValue(item?.message);
  const content = chatTextFromContent(message?.content) || trimString(item?.response);
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const reasoningContent =
    extractReasoningText(message) ||
    extractReasoningText(item) ||
    trimString(message?.thinking);
  return { content, toolCalls, reasoningContent: reasoningContent || undefined };
}

export async function callOllamaAgentTurnStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  withTools: boolean,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const baseUrl = normalizeHttpBaseUrl(config.ollamaUrl, localProviderUrls.ollama);
  const state = createStreamingTextState();
  const toolAccumulator = new OpenAiStreamToolCallAccumulator();
  const usageHolder: { current: ModelUsage | null } = { current: null };
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
        ...(sakiModelWantsNativeThinking("ollama", config.model) ? { think: true } : {}),
        messages: buildOllamaAgentMessages(input, prompt, config),
        ...(withTools ? { tools: openAiToolSchemas() } : {})
      })
    },
    config.requestTimeoutMs,
    async (response) => {
      await readJsonLineData(response, (payload) => {
        usageHolder.current = mergeModelUsage(usageHolder.current, extractProviderUsage(payload));
        const chunk = ollamaAgentStreamChunk(payload);
        toolAccumulator.ingest(chunk.toolCalls);
        pushStreamingTextDelta(state, chunk.content, onDelta, onThinking, chunk.reasoningContent);
      });
    }
  );
  flushStreamingTextState(state, onDelta, onThinking);
  const content = stripThinking(state.raw);
  if (!content && !withTools) throw new RouteError("Ollama returned an empty response.", 502);
  const toolCalls = toolAccumulator.toParsedToolCalls();
  return withTurnUsage(
    {
      content,
      toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content),
      forwardedDeltaText: state.emittedLength > 0,
      forwardedDeltaContent: state.raw.slice(0, state.emittedLength)
    },
    prompt,
    usageHolder.current
      ? { usage: { prompt_tokens: usageHolder.current.promptTokens, completion_tokens: usageHolder.current.completionTokens } }
      : undefined,
    withTools
  );
}

export async function callOllamaAgentTurnStreamWithFallback(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  try {
    return await callOllamaAgentTurnStream(config, input, prompt, onDelta, true, onThinking);
  } catch (error) {
    if (isToolCallingUnsupportedError(error)) {
      return streamPromptAgentTurnWithFilteredDelta(
        (filteredDelta) => callOllamaModelStream(config, input, prompt, filteredDelta, onThinking),
        onDelta,
        onThinking
      );
    }
    throw error;
  }
}

