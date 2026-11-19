import { randomUUID } from "node:crypto";
import { isAgentChecklistTool } from "./agent-tool-guard.js";
import type { SakiChatRequest, SakiConfigResponse, SakiInputAttachment } from "@webops/shared";
import { currentAgentTurnConversation, currentAgentToolImages } from "./agent-turn-context.js";
export { withAgentTurnConversation, currentAgentTurnConversation } from "./agent-turn-context.js";
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
  /** Local-only reference; expanded before compaction can remove its source. */
  toolResultReference?: string;
  /** Pixels returned by an authorized image read, kept outside textual observations. */
  images?: SakiInputAttachment[];
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

function toolImageTurns(messages: SakiAgentTurnMessage[]): SakiAgentTurnMessage[] {
  const latest = new Map<string, number>();
  messages.forEach((turn, index) => imageAttachments({ message: "", attachments: turn.images ?? [] }).forEach(image => {
    latest.delete(image.dataUrl);
    latest.set(image.dataUrl, index);
  }));
  const selected = new Set([...latest.keys()].slice(-8));
  const result: SakiAgentTurnMessage[] = [];
  let pending: SakiInputAttachment[] = [];
  const flush = () => {
    if (pending.length) result.push({ role: "user", content: `Images returned by file tools: ${pending.map(image => image.name).join(", ")}`, images: pending });
    pending = [];
  };
  messages.forEach((turn, index) => {
    if (turn.role !== "tool") flush();
    result.push(turn);
    if (turn.role === "tool") pending.push(...(turn.images ?? []).filter(image => image.dataUrl && selected.has(image.dataUrl) && latest.get(image.dataUrl) === index));
  });
  flush();
  return result;
}

export function toOpenAiMessages(conversation: SakiAgentTurnConversation): DirectProviderMessage[] {
  const messages: DirectProviderMessage[] = [];
  if (conversation.systemPrompt.trim()) {
    messages.push({ role: "system", content: conversation.systemPrompt });
  }
  for (const turn of toolImageTurns(conversation.messages)) {
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
      const images = imageAttachments({ message: "", attachments: turn.images ?? [] });
      if (images.length) {
        messages.push({ role: "user", content: [{ type: "text", text: turn.content },
          ...images.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } }))] });
        continue;
      }
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

  for (const turn of toolImageTurns(conversation.messages)) {
    if (turn.role === "user") {
      const blocks: unknown[] = turn.content.trim() ? [{ type: "text", text: turn.content }] : [];
      blocks.push(...imageAttachments({ message: "", attachments: turn.images ?? [] }).map(image => ({ type: "image",
        source: { type: "base64", media_type: image.mimeType, data: image.base64 } })));
      if (blocks.length) push("user", blocks);
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
  for (const turn of toolImageTurns(conversation.messages)) {
    if (turn.role === "tool") {
      messages.push({ role: "tool", content: turn.content, ...(turn.name ? { tool_name: turn.name } : {}) });
    } else {
      messages.push({
        role: turn.role,
        content: turn.content,
        ...(turn.role === "user" && turn.images?.length ? { images: imageAttachments({ message: "", attachments: turn.images ?? [] }).map(image => image.base64) } : {}),
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
  const images = imageAttachments(input).slice(0, Math.max(0, 8 - currentAgentToolImages().length));
  if (images.length === 0) return messages;
  const index = messages.findIndex((message) => message.role === "user");
  if (index < 0) return messages;
  const target = messages[index]!;
  const blocks = Array.isArray(target.content) ? target.content : [{ type: "text", text: String(target.content ?? "") }];
  const next = [...messages];
  next[index] = {
    ...target,
    content: [
      ...blocks,
      ...images.map((image) => ({
        type: "image_url",
        image_url: { url: image.dataUrl }
      }))
    ]
  };
  return next;
}

function attachAnthropicImages(messages: DirectProviderMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input).slice(0, Math.max(0, 8 - currentAgentToolImages().length));
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
  const images = imageAttachments(input).slice(0, Math.max(0, 8 - currentAgentToolImages().length));
  if (images.length === 0) return messages;
  const index = messages.findIndex((message) => message.role === "user");
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = {
    ...next[index]!,
    images: [...(next[index]?.images ?? []), ...images.map((image) => image.base64)]
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

export function appendAgentToolObservation(messages: SakiAgentTurnMessage[], message: SakiAgentTurnMessage, cacheHit = false): void {
  if (cacheHit && message.role === "tool" && message.content.length > 256) {
    const source = messages.find((previous) => previous.role === "tool" && previous.toolCallId
      && !previous.toolResultReference && previous.name?.toLowerCase() === message.name?.toLowerCase()
      && previous.content === message.content);
    if (source?.toolCallId) {
      const resultNumber = messages.slice(0, messages.indexOf(source) + 1).filter((previous) => previous.role === "tool").length;
      const content = `Cached result unchanged. Reuse tool result #${resultNumber} above (${source.name}, call ${source.toolCallId}).`;
      if (content.length < message.content.length) {
        messages.push({ ...message, content, toolResultReference: source.toolCallId });
        return;
      }
    }
  }
  messages.push(message);
}

const internalScratchpadNotePattern = /^(?:\[(?:Compacted execution history|No new evidence this turn|No progress|Repeated investigation|Repeated observation|Recover from repeated (?:file reads|investigation)|Self-Healing (?:Alert|Guidance)|Diagnostics|Completion check|Long task continuation|Output truncated|Loop breaker|Context overflow recovery|Provider retry)\b|Assistant visible note:|System correction:|If the error is caused by missing permission, blocked safety policy, or missing active instance)/;

function isInternalAgentScratchpadNote(content: string): boolean {
  return internalScratchpadNotePattern.test(content.trim());
}

export function agentHistorySize(messages: readonly SakiAgentTurnMessage[]): number {
  return messages.reduce((size, message) => size + message.content.length
    + (message.images?.length ?? 0) * 2000
    + (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0)
    + (message.assistantState ? JSON.stringify(message.assistantState).length : 0), 0);
}

export function hasOpenAgentToolCalls(messages: readonly SakiAgentTurnMessage[]): boolean {
  const pending = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "tool" && message.toolCallId) pending.add(message.toolCallId);
    if (message.role === "assistant") return Boolean(message.toolCalls?.some(call => !call.id || !pending.has(call.id)));
    if (message.role === "user") break;
  }
  return false;
}

function agentHistoryExcerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n[… earlier content omitted …]\n";
  if (limit <= marker.length) return text.slice(0, limit);
  const head = Math.ceil((limit - marker.length) * 0.6);
  return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}

export function compactAgentTurnMessages(messages: SakiAgentTurnMessage[], maxChars = 60000): SakiAgentTurnMessage[] {
  const budget = Math.max(0, Math.floor(maxChars));
  if (agentHistorySize(messages) <= budget) return messages;
  if (!budget) return [];
  const observations = new Map(messages.filter(message => message.role === "tool" && !message.toolResultReference)
    .map(message => [message.toolCallId, message.content]));
  const groups: SakiAgentTurnMessage[][] = [];
  for (const message of messages) {
    if (message.role !== "tool") {
      groups.push([message]);
      continue;
    }
    const assistant = groups.at(-1)?.[0];
    if (assistant?.role !== "assistant" || !assistant.toolCalls?.some(call => call.id && call.id === message.toolCallId)) continue;
    const { toolResultReference, ...raw } = message;
    groups.at(-1)!.push(toolResultReference ? {
      ...raw, content: observations.get(toolResultReference) ?? "[Earlier tool observation omitted.]"
    } : message);
  }

  const userTurns = groups.filter(group => group[0]!.role === "user" && !isInternalAgentScratchpadNote(group[0]!.content));
  const originalGoal = userTurns[0];
  const currentGoal = userTurns.at(-1);
  const compactedGoal = (group: SakiAgentTurnMessage[], limit: number): SakiAgentTurnMessage => {
    const { content, images } = group[0]!;
    const keptImages = images?.slice(-Math.floor(Math.max(0, limit - 1000) / 2000)).slice(-2) ?? [];
    const keep = Math.floor(Math.max(0, limit - 1000) / 2000) ? keptImages : [];
    return { role: "user", content: agentHistoryExcerpt(content, Math.max(0, limit - keep.length * 2000)),
      ...(keep.length ? { images: keep } : {}) };
  };

  // Reserve space for the active request and oldest goal. Context between them
  // can be summarized, including earlier user turns. Full chat history stays saved.
  const protectedMessages = new Map<SakiAgentTurnMessage[], SakiAgentTurnMessage>();
  if (currentGoal) protectedMessages.set(currentGoal, compactedGoal(currentGoal, Math.floor(budget * 0.6)));
  if (originalGoal && originalGoal !== currentGoal) {
    protectedMessages.set(originalGoal, compactedGoal(originalGoal, Math.floor(budget * 0.15)));
  }
  const summaryLimit = Math.min(7500, Math.floor(budget * 0.2));
  let remaining = budget - summaryLimit - agentHistorySize([...protectedMessages.values()]);
  const keepGroups = new Set<SakiAgentTurnMessage[]>();
  const preserveTailStart = Math.max(0, groups.length - 20);
  for (let index = groups.length - 1; index >= preserveTailStart; index--) {
    const group = groups[index]!;
    if (protectedMessages.has(group)) continue;
    const lead = group[0]!;
    if (lead.role === "user" && /^\[Compacted execution history/.test(lead.content)) continue;
    const ids = new Set(group.slice(1).map(message => message.toolCallId));
    if (lead.toolCalls?.some(call => !call.id || !ids.has(call.id))) continue;
    const size = agentHistorySize(group);
    if (size > remaining) continue;
    keepGroups.add(group);
    remaining -= size;
  }

  const summaryLines: string[] = [];
  for (const group of groups) {
    if (keepGroups.has(group) || protectedMessages.has(group)) continue;
    for (const message of group) {
      if (message.role === "tool") {
        if (!message.name || !isAgentChecklistTool(message.name)) summaryLines.push(`Result ${message.name ?? "tool"}: ${agentHistoryExcerpt(message.content, 420)}`);
        continue;
      }
      if (message.role === "user" && isInternalAgentScratchpadNote(message.content)) {
        if (message.content.startsWith("[Compacted execution history")) summaryLines.push(message.content.split("\n").slice(1).join("\n"));
        continue;
      }
      if (message.content.trim()) summaryLines.push(`${message.role === "user" ? "Earlier user request" : "Assistant"}: ${agentHistoryExcerpt(message.content, 600)}`);
      for (const call of message.toolCalls ?? []) {
        if (isAgentChecklistTool(call.name)) continue;
        const args = Array.isArray(call.args) ? {} : call.args;
        const paths = Object.fromEntries(Object.entries(args ?? {}).filter(([key]) => /path|query|command|symbol|instanceId/i.test(key)));
        summaryLines.push(`${call.name} ${agentHistoryExcerpt(JSON.stringify(paths), 300)}`);
      }
    }
  }

  const summary = summaryLines.length && summaryLimit > 150 ? {
    role: "user" as const,
    content: agentHistoryExcerpt(`[Compacted execution history — continue from verified results]\n${summaryLines.join("\n").slice(-summaryLimit)}`, summaryLimit)
  } : undefined;
  const result: SakiAgentTurnMessage[] = [];
  for (const group of groups) {
    const goal = protectedMessages.get(group);
    if (goal) result.push(goal);
    else if (keepGroups.has(group)) result.push(...group);
    if (group === originalGoal && summary) result.push(summary);
  }
  if (!originalGoal && summary) result.unshift(summary);
  return result;
}
