import type { SakiChatRequest, SakiConfigResponse } from "@webops/shared";
import type { JsonSchema, ParsedToolCall, SakiAgentRuntime, SakiModelToolTurn } from "../types.js";
import {
  chatTextFromContent,
  createStreamingTextState,
  effectiveSakiAgentPermissionMode,
  flushStreamingTextState,
  objectValue,
  openAiBaseUrl,
  providerConfigFor,
  pushStreamingTextDelta,
  RouteError,
  streamingThinkingText,
  stripThinking,
  trimString
} from "../types.js";
import { normalizeStructuredToolCall, openAiToolSchemas, parseJsonMaybe, toolSchemasForRuntime, withAdvertisedSakiToolSchemas } from "../tools.js";
import { buildDirectMessages, buildDirectSystemPrompt } from "../prompt.js";
import { extractProviderUsage, mergeModelUsage, type ModelUsage } from "../../../tokenizer.js";
import {
  isOfficialOpenAiEndpoint,
  openAiCompatibleChatBody,
  shouldSendCustomTemperature,
  streamPromptAgentTurnWithFilteredDelta,
  withTurnUsage
} from "./common.js";
import { readServerSentEventData, requestOpenAiCompatibleJsonPayload, requestOpenAiCompatibleStreamingPayload } from "./http.js";
import {
  extractOpenAiChatText,
  extractOpenAiChatTurn,
  isToolCallingUnsupportedError,
  nativeToolCalls,
  parseToolCallsFromText,
  requireChatModel,
  requireCloudConfig,
  withOpenAiImageInputs
} from "./catalog.js";

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

export function openAiStreamDelta(payload: unknown): { content: string; reasoningContent?: string | undefined } {
  const root = objectValue(payload);
  const choice = Array.isArray(root?.choices) ? objectValue(root.choices[0]) : null;
  const delta = objectValue(choice?.delta);
  const content = chatTextFromContent(delta?.content) || trimString(delta?.text) || trimString(choice?.text);
  const reasoningContent = delta?.reasoning_content || delta?.reasoning || delta?.thinking;
  return { content, reasoningContent: reasoningContent ? String(reasoningContent) : undefined };
}

export async function callOpenAiCompatibleModelStream(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
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
        stream: true,
        stream_options: { include_usage: true }
      },
      0.3
    ),
    config.requestTimeoutMs,
    async (response) => {
      await readServerSentEventData(response, (data) => {
        if (data === "[DONE]") return;
        const chunk = openAiStreamDelta(JSON.parse(data) as unknown);
        pushStreamingTextDelta(state, chunk.content, onDelta, onThinking, chunk.reasoningContent);
      });
    }
  );
  flushStreamingTextState(state, onDelta, onThinking);
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
  return extractOpenAiChatTurn(payload, prompt);
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
  return withTurnUsage({ content, toolCalls: parseToolCallsFromText(content) }, prompt, payload, false);
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

export function openAiStreamChunk(payload: unknown): { content: string; toolCalls: unknown[]; reasoningContent?: string | undefined } {
  const root = objectValue(payload);
  const choice = Array.isArray(root?.choices) ? objectValue(root.choices[0]) : null;
  const delta = objectValue(choice?.delta);
  const content = chatTextFromContent(delta?.content) || trimString(delta?.text) || trimString(choice?.text);
  const toolCalls: unknown[] = Array.isArray(delta?.tool_calls)
    ? [...delta.tool_calls]
    : Array.isArray(delta?.toolCalls)
      ? [...delta.toolCalls]
      : [];
  const legacy = objectValue(delta?.function_call) ?? objectValue(delta?.functionCall);
  if (legacy && (legacy.name || legacy.arguments)) {
    toolCalls.push({ index: 0, function: legacy });
  }
  const reasoningContent = delta?.reasoning_content || delta?.reasoning || delta?.thinking;
  return { content, toolCalls, reasoningContent: reasoningContent ? String(reasoningContent) : undefined };
}

export class OpenAiStreamToolCallAccumulator {
  private readonly parts = new Map<number, { id?: string; name: string; arguments: string }>();

  ingest(toolCalls: unknown[]): void {
    for (const raw of toolCalls) {
      const item = objectValue(raw);
      if (!item) continue;
      const index = typeof item.index === "number" ? item.index : 0;
      const existing = this.parts.get(index) ?? { name: "", arguments: "" };
      const id = trimString(item.id);
      if (id) existing.id = id;
      const fn = objectValue(item.function);
      const name = trimString(fn?.name);
      if (name) existing.name = name;
      const args = fn?.arguments;
      if (args !== undefined && args !== null) existing.arguments += String(args);
      this.parts.set(index, existing);
    }
  }

  toParsedToolCalls(): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];
    for (const index of [...this.parts.keys()].sort((left, right) => left - right)) {
      const part = this.parts.get(index);
      if (!part?.name) continue;
      try {
        calls.push(
          normalizeStructuredToolCall({
            ...(part.id ? { id: part.id } : {}),
            name: part.name,
            arguments: part.arguments ? parseJsonMaybe(part.arguments) : {}
          })
        );
      } catch {
        // Ignore malformed streamed tool calls; the agent loop can retry if none remain.
      }
    }
    return calls;
  }
}

export async function callOpenAiCompatibleAgentTurnStream(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, provider);
  const state = createStreamingTextState();
  const toolAccumulator = new OpenAiStreamToolCallAccumulator();
  const usageHolder: { current: ModelUsage | null } = { current: null };
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
        tools: openAiToolSchemas(),
        tool_choice: "auto",
        stream: true,
        stream_options: { include_usage: true }
      },
      0.2
    ),
    config.requestTimeoutMs,
    async (response) => {
      await readServerSentEventData(response, (data) => {
        if (data === "[DONE]") return;
        const parsed = JSON.parse(data) as unknown;
        usageHolder.current = mergeModelUsage(usageHolder.current, extractProviderUsage(parsed));
        const chunk = openAiStreamChunk(parsed);
        toolAccumulator.ingest(chunk.toolCalls);
        pushStreamingTextDelta(state, chunk.content, onDelta, onThinking, chunk.reasoningContent);
      });
    }
  );
  flushStreamingTextState(state, onDelta, onThinking);
  const content = stripThinking(state.raw);
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
    true
  );
}

export async function callOpenAiCompatiblePromptAgentTurnStream(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  return streamPromptAgentTurnWithFilteredDelta(
    (filteredDelta) => callOpenAiCompatibleModelStream(provider, config, input, prompt, filteredDelta),
    onDelta,
    onThinking
  );
}

export async function callOpenAiCompatibleAgentTurnStreamWithFallback(
  provider: string,
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  try {
    return await callOpenAiCompatibleAgentTurnStream(provider, config, input, prompt, onDelta, onThinking);
  } catch (error) {
    if (isToolCallingUnsupportedError(error)) {
      return callOpenAiCompatiblePromptAgentTurnStream(provider, config, input, prompt, onDelta, onThinking);
    }
    throw error;
  }
}

