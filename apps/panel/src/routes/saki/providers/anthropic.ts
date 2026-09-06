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
import { buildAnthropicAgentMessages, currentAgentTurnConversation } from "../agent-messages.js";
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

export async function callAnthropicModel(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const messages = withAnthropicImageInputs(buildDirectMessages(input, prompt), input).filter((message) => message.role !== "system");
  const payload = await requestJsonPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: anthropicRequestHeaders(apiKey, model),
      body: JSON.stringify(
        anthropicRequestBody(model, {
          system: buildDirectSystemPrompt(config),
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
    return { content: trimString(delta?.text), reasoningContent: undefined };
  }
  if (type === "content_block_start") {
    const block = objectValue(item?.content_block);
    if (block && block.thinking !== undefined) {
      return { content: "", reasoningContent: String(block.thinking) };
    }
    return { content: trimString(block?.text), reasoningContent: undefined };
  }
  return { content: "", reasoningContent: undefined };
}

export async function callAnthropicModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<string> {
  const { baseUrl, apiKey, model } = requireCloudConfig(config, "anthropic");
  const messages = withAnthropicImageInputs(buildDirectMessages(input, prompt), input).filter((message) => message.role !== "system");
  const state = createStreamingTextState();
  await requestStreamingPayload(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: anthropicRequestHeaders(apiKey, model),
      body: JSON.stringify(
        anthropicRequestBody(model, {
          system: buildDirectSystemPrompt(config),
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
  return withTurnUsage(
    { content, toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content) },
    prompt,
    payload,
    true
  );
}

export class AnthropicStreamToolCallAccumulator {
  private readonly blocks = new Map<number, { id?: string; name: string; input: string }>();

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
        input: ""
      });
      return;
    }
    if (type === "content_block_delta") {
      const delta = objectValue(event.delta);
      if (trimString(delta?.type) !== "input_json_delta") return;
      const existing = this.blocks.get(index) ?? { name: "", input: "" };
      existing.input += trimString(delta?.partial_json);
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
            arguments: block.input ? parseJsonMaybe(block.input) : {}
          })
        );
      } catch {
        // Ignore malformed streamed tool calls; the agent loop can retry if none remain.
      }
    }
    return calls;
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
    return { content: trimString(delta?.text), reasoningContent: undefined };
  }
  if (type === "content_block_start") {
    const block = objectValue(item?.content_block);
    if (block && block.thinking !== undefined) {
      return { content: "", reasoningContent: String(block.thinking) };
    }
    return { content: trimString(block?.text), reasoningContent: undefined };
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
        const chunk = anthropicAgentStreamDelta(event);
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
        (filteredDelta) => callAnthropicModelStream(config, input, prompt, filteredDelta, onThinking),
        onDelta,
        onThinking
      );
    }
    throw error;
  }
}

