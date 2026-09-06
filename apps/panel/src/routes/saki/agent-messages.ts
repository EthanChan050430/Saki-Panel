import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SakiChatRequest, SakiConfigResponse } from "@webops/shared";
import type { ParsedToolCall } from "./types.js";
import { imageAttachments, trimString } from "./types.js";
import type { DirectChatMessage, DirectProviderMessage } from "./prompt.js";
import { buildDirectMessages, buildDirectSystemPrompt, buildStaticAgentSystemPrompt } from "./prompt.js";
import { sakiModelProfile } from "./model-profile.js";
import {
  withAnthropicImageInputs,
  withOllamaImageInputs,
  withOpenAiImageInputs
} from "./providers/catalog.js";

export interface SakiAgentTurnMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ParsedToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface SakiAgentTurnConversation {
  systemPrompt: string;
  messages: SakiAgentTurnMessage[];
}

const agentTurnConversationStore = new AsyncLocalStorage<SakiAgentTurnConversation>();

export function withAgentTurnConversation<T>(conversation: SakiAgentTurnConversation | undefined, fn: () => T): T {
  if (!conversation?.messages.length) return fn();
  return agentTurnConversationStore.run(conversation, fn);
}

export function currentAgentTurnConversation(): SakiAgentTurnConversation | undefined {
  return agentTurnConversationStore.getStore();
}

export function ensureToolCallId(call: ParsedToolCall): string {
  if (trimString(call.id)) return call.id as string;
  call.id = `call_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  return call.id;
}

export function agentSystemPromptForConfig(config: SakiConfigResponse, override?: string): string {
  if (override && override.trim()) return override.trim();
  return buildStaticAgentSystemPrompt(sakiModelProfile(config.provider, config.model));
}

function jsonArgs(call: ParsedToolCall): string {
  try {
    return JSON.stringify(Array.isArray(call.args) ? {} : call.args ?? {});
  } catch {
    return "{}";
  }
}

function xmlArgs(call: ParsedToolCall): string {
  const args = Array.isArray(call.args) ? {} : call.args ?? {};
  return Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `<${key}>${typeof value === "object" ? JSON.stringify(value) : String(value)}</${key}>`)
    .join("\n");
}

export function toOpenAiMessages(conversation: SakiAgentTurnConversation): DirectProviderMessage[] {
  const messages: DirectProviderMessage[] = [];
  if (conversation.systemPrompt.trim()) {
    messages.push({ role: "system", content: conversation.systemPrompt });
  }
  for (const turn of conversation.messages) {
    if (turn.role === "tool") {
      messages.push({
        role: "tool",
        content: turn.content || "",
        tool_call_id: turn.toolCallId,
        ...(turn.name ? { name: turn.name } : {})
      });
      continue;
    }
    if (turn.role === "assistant" && turn.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: turn.content.trim() ? turn.content : "",
        tool_calls: turn.toolCalls.map((call) => ({
          id: ensureToolCallId(call),
          type: "function",
          function: { name: call.name, arguments: jsonArgs(call) }
        }))
      });
      continue;
    }
    if (turn.role === "user") {
      const last = messages[messages.length - 1];
      if (last?.role === "user" && typeof last.content === "string") {
        last.content = `${last.content}\n\n${turn.content}`;
        continue;
      }
    }
    messages.push({ role: turn.role, content: turn.content });
  }
  return messages;
}

export function toAnthropicMessages(conversation: SakiAgentTurnConversation): DirectProviderMessage[] {
  const messages: DirectProviderMessage[] = [];
  const push = (role: "user" | "assistant", content: unknown[]) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      last.content = [...(last.content as unknown[]), ...content];
      return;
    }
    messages.push({ role, content });
  };

  for (const turn of conversation.messages) {
    if (turn.role === "user") {
      if (turn.content.trim()) push("user", [{ type: "text", text: turn.content }]);
      continue;
    }
    if (turn.role === "assistant") {
      const blocks: unknown[] = [];
      if (turn.content.trim()) blocks.push({ type: "text", text: turn.content });
      for (const call of turn.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: ensureToolCallId(call),
          name: call.name,
          input: Array.isArray(call.args) ? {} : call.args ?? {}
        });
      }
      if (blocks.length) push("assistant", blocks);
      continue;
    }
    push("user", [
      {
        type: "tool_result",
        tool_use_id: turn.toolCallId,
        content: turn.content
      }
    ]);
  }
  return messages;
}

export function serializeTurnMessagesForPrompt(conversation: SakiAgentTurnConversation): string {
  const parts: string[] = [];
  if (conversation.systemPrompt.trim()) parts.push(conversation.systemPrompt);
  for (const turn of conversation.messages) {
    if (turn.role === "user") {
      parts.push(`User:\n${turn.content}`);
      continue;
    }
    if (turn.role === "assistant") {
      const body = [turn.content.trim()].filter(Boolean);
      for (const call of turn.toolCalls ?? []) {
        body.push(`<tool_call name="${call.name}">\n${xmlArgs(call)}\n</tool_call>`);
      }
      parts.push(`Assistant:\n${body.join("\n")}`);
      continue;
    }
    parts.push(`Observation (${turn.name ?? "tool"}):\n${turn.content}`);
  }
  const hasToolHistory = conversation.messages.some((message) => message.role === "tool" || (message.toolCalls?.length ?? 0) > 0);
  if (hasToolHistory) {
    parts.push("Continue the task. If it is complete, reply in plain text with no tool calls.");
  }
  return parts.join("\n\n");
}

function attachOpenAiImages(messages: DirectProviderMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const index = messages.findIndex((message) => message.role === "user");
  if (index < 0) return messages;
  const target = messages[index]!;
  const text = typeof target.content === "string" ? target.content : "";
  const next = [...messages];
  next[index] = {
    ...target,
    content: [
      { type: "text", text },
      ...images.map((image) => ({
        type: "image_url",
        image_url: { url: image.dataUrl }
      }))
    ]
  };
  return next;
}

function attachAnthropicImages(messages: DirectProviderMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const index = messages.findIndex((message) => message.role === "user");
  if (index < 0) return messages;
  const target = messages[index]!;
  const blocks = Array.isArray(target.content) ? [...(target.content as unknown[])] : [{ type: "text", text: String(target.content ?? "") }];
  const next = [...messages];
  next[index] = {
    ...target,
    content: [
      ...blocks,
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
  return next;
}

function attachOllamaImages(messages: DirectProviderMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const index = messages.findIndex((message) => message.role === "user");
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = {
    ...next[index]!,
    images: images.map((image) => image.base64)
  };
  return next;
}

export function buildOpenAiAgentMessages(
  input: SakiChatRequest,
  prompt: string,
  config: SakiConfigResponse
): DirectProviderMessage[] {
  const conversation = currentAgentTurnConversation();
  if (conversation?.messages.length) {
    return attachOpenAiImages(toOpenAiMessages(conversation), input);
  }
  return withOpenAiImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input);
}

export function buildAnthropicAgentMessages(input: SakiChatRequest, prompt: string): DirectProviderMessage[] {
  const conversation = currentAgentTurnConversation();
  if (conversation?.messages.length) {
    return attachAnthropicImages(toAnthropicMessages(conversation), input);
  }
  return withAnthropicImageInputs(buildDirectMessages(input, prompt), input).filter((message) => message.role !== "system");
}

export function buildOllamaAgentMessages(
  input: SakiChatRequest,
  prompt: string,
  config: SakiConfigResponse
): DirectProviderMessage[] {
  const conversation = currentAgentTurnConversation();
  if (conversation?.messages.length) {
    return attachOllamaImages(toOpenAiMessages(conversation), input);
  }
  return withOllamaImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input);
}

export function buildPromptFallbackMessages(
  input: SakiChatRequest,
  prompt: string,
  config: SakiConfigResponse
): DirectChatMessage[] {
  const conversation = currentAgentTurnConversation();
  if (conversation?.messages.length) {
    return [
      { role: "system", content: conversation.systemPrompt },
      { role: "user", content: serializeTurnMessagesForPrompt({ systemPrompt: "", messages: conversation.messages }) }
    ];
  }
  return buildDirectMessages(input, prompt, buildDirectSystemPrompt(config));
}

export function compactAgentTurnMessages(messages: SakiAgentTurnMessage[], maxChars = 60000): SakiAgentTurnMessage[] {
  const totalChars = (items: SakiAgentTurnMessage[]) => items.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars(messages) <= maxChars) return messages;
  // Never drop assistant/tool pairs — that breaks OpenAI/Anthropic/Qwen/GLM tool protocols.
  // Only shrink older tool observations in place.
  return messages.map((message, index) => {
    if (message.role !== "tool" || message.content.length < 800) return message;
    const fromEnd = messages.length - index;
    const limit = fromEnd <= 6 ? 2500 : 500;
    if (message.content.length <= limit) return message;
    return {
      ...message,
      content: `${message.content.slice(0, limit)}\n... [compacted ${message.content.length - limit} chars] ...`
    };
  });
}
