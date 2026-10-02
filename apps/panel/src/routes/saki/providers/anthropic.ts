import type { SakiChatRequest, SakiConfigResponse } from "@webops/shared";
import type { ParsedToolCall, SakiAgentRuntime, SakiModelToolTurn } from "../types.js";
import {
  chatTextFromContent,
  createStreamingTextState,
  effectiveSakiAgentPermissionMode,
  flushStreamingTextState,
  objectValue,
  providerConfigFor,
  pushStreamingTextDelta,
  RouteError,
  stripThinking,
  trimString
} from "../types.js";
import { anthropicToolSchemas, normalizeStructuredToolCall, parseJsonMaybe, toolSchemasForRuntime, withAdvertisedSakiToolSchemas } from "../tools.js";
import { buildDirectMessages, buildDirectSystemPrompt } from "../prompt.js";
import { buildAnthropicAgentMessages, buildPromptFallbackMessages, currentAgentTurnConversation } from "../agent-messages.js";
import { extractProviderUsage, mergeModelUsage, type ModelUsage } from "../../../tokenizer.js";
import { anthropicSupportsThinking } from "../model-profile.js";
import { streamPromptAgentTurnWithFilteredDelta, withTurnUsage } from "./common.js";
import { parseStreamJsonPayload, readServerSentEventData, requestJsonPayload, requestStreamingPayload } from "./http.js";
import {
  isToolCallingUnsupportedError,
  lastUserMessageIndex,
  nativeToolCalls,
  parseToolCallsFromText,
  requireChatModel,
  requireCloudConfig,
  withAnthropicImageInputs
} from "./catalog.js";

function anthropicRequestHeaders(apiKey: string, model: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    ...(anthropicSupportsThinking(model) ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {})
  };
}

function anthropicRequestBody(model: string, rest: Record<string, unknown>): Record<string, unknown> {
  if (!anthropicSupportsThinking(model)) return { model, max_tokens: 4096, ...rest };
  return {
    model,
    max_tokens: 16000,
    thinking: { type: "enabled", budget_tokens: 4096 },
    ...rest
  };
}

export async function callAnthropicModel(config: SakiConfigResponse, input: SakiChatRequest, prompt: string, agentFallback = false): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const directMessages = agentFallback ? buildPromptFallbackMessages(input, prompt, config) : buildDirectMessages(input, prompt);
  const messages = withAnthropicImageInputs(directMessages, input).filter((message) => message.role !== "system");
  const payload = await requestJsonPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: anthropicRequestHeaders(apiKey, model),
      body: JSON.stringify(
        anthropicRequestBody(model, {
          system: agentFallback ? directMessages.find((message) => message.role === "system")?.content : buildDirectSystemPrompt(config),
          messages
        })
      )
    },
    config.requestTimeoutMs
  );
  const text = stripThinking(chatTextFromContent(objectValue(payload)?.content));
  if (!text) throw new RouteError("Model API returned an empty response.", 502);
  return text;
}

export function anthropicStreamDelta(payload: unknown): { content: string; reasoningContent?: string | undefined } {
  const item = objectValue(payload);
  const type = trimString(item?.type);
  if (type === "content_block_delta") {
    const delta = objectValue(item?.delta);
    if (delta && delta.thinking !== undefined) {
      return { content: "", reasoningContent: String(delta.thinking) };
    }
    return { content: typeof delta?.text === "string" ? delta.text : "", reasoningContent: undefined };
  }
  if (type === "content_block_start") {
    const block = objectValue(item?.content_block);
    if (block && block.thinking !== undefined) {
      return { content: "", reasoningContent: String(block.thinking) };
    }
    return { content: typeof block?.text === "string" ? block.text : "", reasoningContent: undefined };
  }
  return { content: "", reasoningContent: undefined };
}

export async function callAnthropicModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void,
  agentFallback = false
): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const directMessages = agentFallback ? buildPromptFallbackMessages(input, prompt, config) : buildDirectMessages(input, prompt);
  const messages = withAnthropicImageInputs(directMessages, input).filter((message) => message.role !== "system");
  const state = createStreamingTextState();
  await requestStreamingPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: anthropicRequestHeaders(apiKey, model),
      body: JSON.stringify(
        anthropicRequestBody(model, {
          system: agentFallback ? directMessages.find((message) => message.role === "system")?.content : buildDirectSystemPrompt(config),
          messages,
          stream: true
        })
      )
    },
    config.requestTimeoutMs,
    async (response) => {
      await readServerSentEventData(response, (data) => {
        const payload = parseStreamJsonPayload(data);
        if (payload === undefined) return;
        const chunk = anthropicStreamDelta(payload);
        pushStreamingTextDelta(state, chunk.content, onDelta, onThinking, chunk.reasoningContent);
      });
    }
  );
  flushStreamingTextState(state, onDelta, onThinking);
  const text = stripThinking(state.raw);
  if (!text) throw new RouteError("Model API returned an empty response.", 502);
  return text;
}

export async function callAnthropicAgentTurn(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<SakiModelToolTurn> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const messages = buildAnthropicAgentMessages(input, prompt);
  const payload = await requestJsonPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: anthropicRequestHeaders(apiKey, model),
      body: JSON.stringify(
        anthropicRequestBody(model, {
          system: currentAgentTurnConversation()?.systemPrompt ?? buildDirectSystemPrompt(config),
          messages,
          tools: anthropicToolSchemas()
        })
      )
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
  const thinkingBlocks = blocks.map(objectValue).filter((block): block is Record<string, unknown> => Boolean(block && (block.type === "thinking" || block.type === "redacted_thinking")));
  return withTurnUsage(
    { content, toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content), ...(thinkingBlocks.length ? { assistantState: { thinkingBlocks } } : {}) },
    prompt,
    payload,
    true
  );
}

export async function callAnthropicAgentTurnWithFallback(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<SakiModelToolTurn> {
  try {
    return await callAnthropicAgentTurn(config, input, prompt);
  } catch (error) {
    if (!isToolCallingUnsupportedError(error)) throw error;
    const content = await callAnthropicModel(config, input, prompt, true);
    return withTurnUsage({ content, toolCalls: parseToolCallsFromText(content) }, prompt);
  }
}

export class AnthropicStreamToolCallAccumulator {
  private readonly blocks = new Map<number, { id?: string; name: string; input: string; initialInput: unknown }>();

  ingest(event: Record<string, unknown>): void {
    const type = trimString(event.type);
    const index = typeof event.index === "number" ? event.index : 0;
    if (type === "content_block_start") {
      const block = objectValue(event.content_block);
      if (trimString(block?.type) !== "tool_use") return;
      const id = trimString(block?.id);
      this.blocks.set(index, {
        ...(id ? { id } : {}),
        name: trimString(block?.name),
        input: "",
        initialInput: block?.input ?? {}
      });
      return;
    }
    if (type === "content_block_delta") {
      const delta = objectValue(event.delta);
      if (trimString(delta?.type) !== "input_json_delta") return;
      const existing = this.blocks.get(index) ?? { name: "", input: "", initialInput: {} };
      if (typeof delta?.partial_json === "string") existing.input += delta.partial_json;
      this.blocks.set(index, existing);
    }
  }

  toParsedToolCalls(): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];
    for (const index of [...this.blocks.keys()].sort((left, right) => left - right)) {
      const block = this.blocks.get(index);
      if (!block?.name) continue;
      try {
        calls.push(
          normalizeStructuredToolCall({
            ...(block.id ? { id: block.id } : {}),
            name: block.name,
            arguments: block.input ? parseJsonMaybe(block.input) : block.initialInput
          })
        );
      } catch {
        // Ignore malformed streamed tool calls; the agent loop can retry if none remain.
      }
    }
    return calls;
  }
}

export class AnthropicStreamThinkingAccumulator {
  private readonly blocks = new Map<number, Record<string, unknown>>();

  ingest(event: Record<string, unknown>): void {
    const index = typeof event.index === "number" ? event.index : 0;
    const block = objectValue(event.content_block);
    if (event.type === "content_block_start" && (block?.type === "thinking" || block?.type === "redacted_thinking")) {
      this.blocks.set(index, { ...block });
    } else if (event.type === "content_block_delta") {
      const existing = this.blocks.get(index);
      const delta = objectValue(event.delta);
      if (!existing) return;
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") existing.thinking = String(existing.thinking ?? "") + delta.thinking;
      if (delta?.type === "signature_delta" && typeof delta.signature === "string") existing.signature = String(existing.signature ?? "") + delta.signature;
    }
  }

  toBlocks(): Record<string, unknown>[] {
    return [...this.blocks.entries()].sort(([left], [right]) => left - right).map(([, block]) => block);
  }
}

export function anthropicAgentStreamDelta(payload: unknown): { content: string; reasoningContent?: string | undefined } {
  const item = objectValue(payload);
  const type = trimString(item?.type);
  if (type === "content_block_delta") {
    const delta = objectValue(item?.delta);
    if (delta && delta.thinking !== undefined) {
      return { content: "", reasoningContent: String(delta.thinking) };
    }
    return { content: typeof delta?.text === "string" ? delta.text : "", reasoningContent: undefined };
  }
  if (type === "content_block_start") {
    const block = objectValue(item?.content_block);
    if (block && block.thinking !== undefined) {
      return { content: "", reasoningContent: String(block.thinking) };
    }
    return { content: typeof block?.text === "string" ? block.text : "", reasoningContent: undefined };
  }
  return { content: "", reasoningContent: undefined };
}

export async function callAnthropicAgentTurnStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const messages = buildAnthropicAgentMessages(input, prompt);
  const state = createStreamingTextState();
  const toolAccumulator = new AnthropicStreamToolCallAccumulator();
  const thinkingAccumulator = new AnthropicStreamThinkingAccumulator();
  const usageHolder: { current: ModelUsage | null } = { current: null };
  await requestStreamingPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: anthropicRequestHeaders(apiKey, model),
      body: JSON.stringify(
        anthropicRequestBody(model, {
          system: currentAgentTurnConversation()?.systemPrompt ?? buildDirectSystemPrompt(config),
          messages,
          stream: true,
          tools: anthropicToolSchemas()
        })
      )
    },
    config.requestTimeoutMs,
    async (response) => {
      await readServerSentEventData(response, (data) => {
        const event = objectValue(parseStreamJsonPayload(data));
        if (!event) return;
        usageHolder.current = mergeModelUsage(usageHolder.current, extractProviderUsage(event));
        toolAccumulator.ingest(event);
        thinkingAccumulator.ingest(event);
        const chunk = anthropicAgentStreamDelta(event);
        pushStreamingTextDelta(state, chunk.content, onDelta, onThinking, chunk.reasoningContent);
      });
    }
  );
  flushStreamingTextState(state, onDelta, onThinking);
  const content = stripThinking(state.raw);
  const toolCalls = toolAccumulator.toParsedToolCalls();
  const thinkingBlocks = thinkingAccumulator.toBlocks();
  return withTurnUsage(
    {
      content,
      toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content),
      forwardedDeltaText: state.emittedLength > 0,
      forwardedDeltaContent: state.raw.slice(0, state.emittedLength),
      ...(thinkingBlocks.length ? { assistantState: { thinkingBlocks } } : {})
    },
    prompt,
    usageHolder.current
      ? { usage: { input_tokens: usageHolder.current.promptTokens, output_tokens: usageHolder.current.completionTokens } }
      : undefined,
    true
  );
}

export async function callAnthropicAgentTurnStreamWithFallback(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  try {
    return await callAnthropicAgentTurnStream(config, input, prompt, onDelta, onThinking);
  } catch (error) {
    if (isToolCallingUnsupportedError(error)) {
      return streamPromptAgentTurnWithFilteredDelta(
        (filteredDelta) => callAnthropicModelStream(config, input, prompt, filteredDelta, onThinking, true),
        onDelta,
        onThinking
      );
    }
    throw error;
  }
}

