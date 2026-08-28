import type { SakiChatRequest, SakiConfigResponse, SakiModelOption, SakiProviderConfig } from "@webops/shared";
import type { ParsedToolCall, SakiModelToolTurn } from "../types.js";
import {
  chatTextFromContent,
  imageAttachments,
  isLikelyChatModel,
  localProviderUrls,
  modelOptionFromItem,
  normalizeHttpBaseUrl,
  normalizeProviderId,
  objectValue,
  openAiBaseUrl,
  providerBaseUrl,
  providerConfigFor,
  providerDefaults,
  RouteError,
  stripThinking,
  trimString,
  uniqueModels
} from "../types.js";
import { anthropicToolSchemas, normalizeStructuredToolCall, openAiToolSchemas, parseAnyToolCalls, parseJsonMaybe } from "../tools.js";
import type { DirectChatMessage, DirectProviderMessage } from "../prompt.js";
import { withTurnUsage } from "./common.js";
import { requestJsonPayload } from "./http.js";

export function collectModelItems(payload: unknown): unknown[] {
  const item = objectValue(payload);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(item?.data)) return item.data;
  if (Array.isArray(item?.models)) return item.models;
  if (Array.isArray(item?.result)) return item.result;
  return [];
}

export function requireChatModel(config: SakiConfigResponse, provider: string): string {
  const model = trimString(config.model);
  if (!model) {
    throw new RouteError(`Please select a model for ${provider}.`, 400);
  }
  return model;
}

export function requireCloudConfig(config: SakiConfigResponse, provider: string): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = providerBaseUrl(provider, config);
  const apiKey = trimString(config.apiKey);
  const model = requireChatModel(config, provider);
  if (!baseUrl) {
    throw new RouteError(`Please configure API Base URL for ${provider}.`, 400);
  }
  if (provider !== "lmstudio" && !apiKey) {
    throw new RouteError(`Please configure API Key for ${provider}.`, 400);
  }
  return { baseUrl, apiKey, model };
}

export function lastUserMessageIndex(messages: readonly DirectProviderMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

export function withOpenAiImageInputs(messages: DirectChatMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const result: DirectProviderMessage[] = messages.map((message) => ({ ...message }));
  const lastUserIndex = lastUserMessageIndex(result);
  if (lastUserIndex < 0) return result;
  const lastUser = result[lastUserIndex] as DirectProviderMessage;
  result[lastUserIndex] = {
    ...lastUser,
    content: [
      { type: "text", text: trimString(lastUser.content) },
      ...images.map((image) => ({
        type: "image_url",
        image_url: { url: image.dataUrl }
      }))
    ]
  };
  return result;
}

export function withAnthropicImageInputs(messages: DirectChatMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const result: DirectProviderMessage[] = messages.map((message) => ({ ...message }));
  const lastUserIndex = lastUserMessageIndex(result);
  if (lastUserIndex < 0) return result;
  const lastUser = result[lastUserIndex] as DirectProviderMessage;
  result[lastUserIndex] = {
    ...lastUser,
    content: [
      { type: "text", text: trimString(lastUser.content) },
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
  return result;
}

export function withOllamaImageInputs(messages: DirectChatMessage[], input: SakiChatRequest): DirectProviderMessage[] {
  const images = imageAttachments(input);
  if (images.length === 0) return messages;
  const result: DirectProviderMessage[] = messages.map((message) => ({ ...message }));
  const lastUserIndex = lastUserMessageIndex(result);
  if (lastUserIndex < 0) return result;
  const lastUser = result[lastUserIndex] as DirectProviderMessage;
  result[lastUserIndex] = {
    ...lastUser,
    images: images.map((image) => image.base64)
  };
  return result;
}

export function extractOpenAiChatText(payload: unknown): string {
  const root = objectValue(payload);
  const choice = Array.isArray(root?.choices) ? objectValue(root.choices[0]) : null;
  const message = objectValue(choice?.message);
  return stripThinking(chatTextFromContent(message?.content) || trimString(choice?.text));
}

export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  return parseAnyToolCalls(text);
}

export function nativeToolCalls(value: unknown): ParsedToolCall[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const calls: ParsedToolCall[] = [];
  for (const raw of list) {
    try {
      calls.push(normalizeStructuredToolCall(raw));
    } catch {
      // Ignore malformed native tool calls
    }
  }
  return calls;
}

export function extractOpenAiChatTurn(payload: unknown, prompt = ""): SakiModelToolTurn {
  const root = objectValue(payload);
  const choice = Array.isArray(root?.choices) ? objectValue(root.choices[0]) : null;
  const message = objectValue(choice?.message);
  const content = stripThinking(chatTextFromContent(message?.content) || trimString(choice?.text));
  const toolCalls = nativeToolCalls(message?.tool_calls ?? message?.toolCalls);
  const legacy = objectValue(message?.function_call) ?? objectValue(message?.functionCall);
  if (legacy && trimString(legacy.name)) {
    try {
      toolCalls.push(normalizeStructuredToolCall({ name: legacy.name, arguments: legacy.arguments ?? legacy.args }));
    } catch {
      // Ignore malformed legacy function_call
    }
  }
  const turn: SakiModelToolTurn = {
    content,
    toolCalls: toolCalls.length ? toolCalls : parseToolCallsFromText(content)
  };
  return withTurnUsage(turn, prompt, payload, true);
}

export function isToolCallingUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /tools?|tool_choice|function.?call|unsupported parameter|unknown parameter|unrecognized/.test(message);
}

export async function fetchOpenAiModelCatalog(provider: string, config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const { baseUrl, apiKey } = requireCloudConfig({ ...config, model: config.model || "model-detection" }, provider);
  const payload = await requestJsonPayload(
    `${baseUrl}/models`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`
      }
    },
    30000
  );
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem(provider, item))
      .filter((model): model is SakiModelOption => Boolean(model))
  ).sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchAnthropicModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const { baseUrl, apiKey } = requireCloudConfig({ ...config, model: config.model || "model-detection" }, "anthropic");
  const payload = await requestJsonPayload(
    `${baseUrl}/models`,
    {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    },
    30000
  );
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem("anthropic", item))
      .filter((model): model is SakiModelOption => Boolean(model))
  ).sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchOllamaModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const baseUrl = normalizeHttpBaseUrl(config.ollamaUrl, localProviderUrls.ollama);
  const payload = await requestJsonPayload(`${baseUrl}/api/tags`, { method: "GET" }, 12000);
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem("ollama", item))
      .filter((model): model is SakiModelOption => Boolean(model))
  );
}

export async function fetchLmStudioModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const baseUrl = providerBaseUrl("lmstudio", config);
  const payload = await requestJsonPayload(`${baseUrl}/models`, { method: "GET" }, 12000);
  return uniqueModels(
    collectModelItems(payload)
      .map((item) => modelOptionFromItem("lmstudio", item))
      .filter((model): model is SakiModelOption => Boolean(model))
  );
}
