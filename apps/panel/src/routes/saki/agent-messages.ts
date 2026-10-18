import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SakiChatRequest, SakiConfigResponse } from "@webops/shared";
import type { ParsedToolCall, SakiAssistantState } from "./types.js";
import { imageAttachments, trimString } from "./types.js";
import type { DirectChatMessage, DirectProviderMessage } from "./prompt.js";
import { buildDirectMessages, buildDirectSystemPrompt, buildStaticAgentSystemPrompt } from "./prompt.js";
import { sakiModelProfile, xmlToolFormatReminder } from "./model-profile.js";
import { advertisedSakiToolSchemas } from "./tools.js";
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
  assistantState?: SakiAssistantState;
}

export interface SakiAgentTurnConversation {
  systemPrompt: string;
  messages: SakiAgentTurnMessage[];
}

export function closeInterruptedToolCalls(messages: SakiAgentTurnMessage[], interruptedContent = "Execution interrupted before a result was recorded. This call is unconfirmed; inspect the target before retrying a mutation."): SakiAgentTurnMessage[] {
  const result: SakiAgentTurnMessage[] = [];
  let pending: ParsedToolCall[] = [];
  const close = () => {
    for (const call of pending) result.push({ role: "tool", toolCallId: ensureToolCallId(call), name: call.name,
      content: interruptedContent });
    pending = [];
  };
  for (const message of messages) {
    if (message.role !== "tool") close();
    result.push(message);
    if (message.role === "assistant") pending = [...(message.toolCalls ?? [])];
    if (message.role === "tool") pending = pending.filter((call) => ensureToolCallId(call) !== message.toolCallId);
  }
  close();
  return result;
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
          function: { name: call.name, arguments: jsonArgs(call) },
          ...(call.extraContent ? { extra_content: call.extraContent } : {})
        })),
        ...(turn.assistantState?.reasoningContent !== undefined ? { reasoning_content: turn.assistantState.reasoningContent } : {})
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
    messages.push({
      role: turn.role,
      content: turn.content,
      ...(turn.role === "assistant" && turn.assistantState?.reasoningContent !== undefined ? { reasoning_content: turn.assistantState.reasoningContent } : {})
    });
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
      const blocks: unknown[] = [...(turn.assistantState?.thinkingBlocks ?? [])];
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

export function toOllamaMessages(conversation: SakiAgentTurnConversation): DirectProviderMessage[] {
  const messages: DirectProviderMessage[] = [];
  if (conversation.systemPrompt.trim()) messages.push({ role: "system", content: conversation.systemPrompt });
  for (const turn of conversation.messages) {
    if (turn.role === "tool") {
      messages.push({ role: "tool", content: turn.content, ...(turn.name ? { tool_name: turn.name } : {}) });
    } else {
      messages.push({
        role: turn.role,
        content: turn.content,
        ...(turn.role === "assistant" && turn.assistantState?.reasoningContent !== undefined ? { thinking: turn.assistantState.reasoningContent } : {}),
        ...(turn.toolCalls?.length ? {
          tool_calls: turn.toolCalls.map((call, index) => ({
            type: "function",
            function: { index, name: call.name, arguments: Array.isArray(call.args) ? {} : call.args ?? {} }
          }))
        } : {})
      });
    }
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
    return attachOllamaImages(toOllamaMessages(conversation), input);
  }
  return withOllamaImageInputs(buildDirectMessages(input, prompt, buildDirectSystemPrompt(config)), input);
}

export function buildPromptFallbackMessages(
  input: SakiChatRequest,
  prompt: string,
  config: SakiConfigResponse
): DirectChatMessage[] {
  const conversation = currentAgentTurnConversation();
  const toolInstructions = `Native function calling is unavailable for this request. Saki Panel can still execute the tools below when you output XML tool calls. Do not claim tools are unavailable just because native function calling is disabled.
${xmlToolFormatReminder()}
Available Saki tools (names, descriptions and JSON parameter schemas; only use these tools):
${JSON.stringify(advertisedSakiToolSchemas().map(({ name, description, parameters }) => ({ name, description, parameters })))}`;
  if (conversation?.messages.length) {
    return [
      { role: "system", content: `${conversation.systemPrompt}\n\n${toolInstructions}` },
      { role: "user", content: serializeTurnMessagesForPrompt({ systemPrompt: "", messages: conversation.messages }) }
    ];
  }
  return buildDirectMessages(input, prompt, `${buildDirectSystemPrompt(config)}\n\n${toolInstructions}`);
}

export function compactAgentTurnMessages(messages: SakiAgentTurnMessage[], maxChars = 60000): SakiAgentTurnMessage[] {
  const sizeOf = (message: SakiAgentTurnMessage) => message.content.length
    + (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0)
    + (message.assistantState ? JSON.stringify(message.assistantState).length : 0);
  if (messages.reduce((sum, message) => sum + sizeOf(message), 0) <= maxChars) return messages;
  const excerpt = (content: string, limit: number) => {
    if (content.length <= limit) return content;
    const marker = `\n... [compacted ${content.length - limit} chars; middle omitted] ...\n`;
    const available = Math.max(0, limit - marker.length);
    const head = Math.ceil(available * 0.65);
    return content.slice(0, head) + marker + content.slice(-(available - head));
  };
  const compacted = messages.map((message, index) => {
    if (message.role !== "tool" || message.content.length < 800 || message.name?.toLowerCase() === "askuser") return message;
    const fromEnd = messages.length - index;
    const limit = fromEnd <= 2 ? 28000 : fromEnd <= 6 ? 2500 : 500;
    if (message.content.length <= limit) return message;
    return {
      ...message,
      content: excerpt(message.content, limit)
    };
  });
  if (compacted.reduce((sum, message) => sum + sizeOf(message), 0) <= maxChars || compacted.length < 2) return compacted;

  // Summarize only complete protocol groups, including large historical write
  // arguments/reasoning. Keep the original goal and any unconfirmed calls.
  const first = compacted[0]!;
  const groups: Array<{ messages: SakiAgentTurnMessage[]; size: number; keep: boolean }> = [];
  for (let index = 1; index < compacted.length; index++) {
    const message = compacted[index]!;
    if (message.role !== "tool" || !groups.length) groups.push({ messages: [], size: 0, keep: true });
    const group = groups.at(-1)!;
    group.messages.push(message);
    group.size += sizeOf(message);
  }
  const summaries: string[] = [];
  let latestTodos: string | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "tool" && message.name?.toLowerCase() === "managetodos") latestTodos = message.content;
    if (message.content.startsWith("[Compacted execution history")) {
      latestTodos = message.content.match(/Current checklist:\n([\s\S]*?)(?=\n(?:Assistant:|Result |User note:)|$)/)?.[1];
    }
    if (latestTodos) break;
  }
  const firstSize = sizeOf(first);
  const memoryBudget = Math.max(400, Math.min(8000, Math.floor(maxChars / 3), maxChars - firstSize - 300));
  const todoBudget = latestTodos ? Math.min(5000, Math.floor(memoryBudget / 2)) : 0;
  const summary = (): SakiAgentTurnMessage => ({ role: "user", content: `[Compacted execution history — retain completed work; continue the unfinished step]\n${latestTodos ? `Current checklist:\n${latestTodos.slice(0, todoBudget)}\n` : ""}${summaries.slice(-20).join("\n").slice(-(memoryBudget - todoBudget))}` });
  const remember = (text: string) => {
    summaries.push(text);
    if (summaries.length > 20) summaries.shift();
  };
  let remainingSize = firstSize + groups.reduce((sum, group) => sum + group.size, 0);
  let lastAssistant = -1;
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!;
    const message = group.messages[0]!;
    if (message.role === "assistant") lastAssistant = index;
    if (group.messages.length === 1 && message.role === "user" && message.content.startsWith("[Compacted execution history")) {
      remember(message.content.replace(/^\[Compacted execution history[^\n]*\n/, "").slice(-memoryBudget));
      group.keep = false;
      remainingSize -= group.size;
    }
  }
  for (let cursor = 0; cursor <= groups.length; cursor++) {
    if (remainingSize + (summaries.length ? summary().content.length : 0) <= maxChars) break;
    const index = cursor === groups.length ? lastAssistant : cursor;
    if (index < 0 || (index === lastAssistant && cursor !== groups.length)) continue;
    const group = groups[index]!;
    if (!group.keep) continue;
    if (group.messages[0]?.role !== "assistant" || group.messages.some((message) => message.name?.toLowerCase() === "askuser")) continue;
    const calls = group.messages[0]?.toolCalls ?? [];
    const confirmed = new Set(group.messages.filter((message) => message.role === "tool").map((message) => message.toolCallId));
    if (calls.some((call) => !call.id || !confirmed.has(call.id))) continue;
    group.keep = false;
    remainingSize -= group.size;
    for (const message of group.messages) {
      if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) {
          const args = Array.isArray(call.args) ? {} : call.args;
          const target = Object.fromEntries(Object.entries(args).filter(([key]) => /path|query|command|symbol|instanceId/i.test(key)));
          remember(`${call.name} ${JSON.stringify(target).slice(0, 500)}`);
        }
        if (message.content.trim()) remember(`Assistant: ${excerpt(message.content, 400)}`);
      } else {
        remember(`${message.role === "tool" ? `Result ${message.name ?? "tool"}` : "User note"}: ${excerpt(message.content, 800)}`);
      }
    }
  }
  return [first, ...(summaries.length ? [summary()] : []), ...groups.filter((group) => group.keep).flatMap((group) => group.messages)];
}
