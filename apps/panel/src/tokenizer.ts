import { encoding_for_model, type TiktokenModel } from "tiktoken";

let encoder: ReturnType<typeof encoding_for_model> | null = null;
let currentModelName: string | null = null;

const modelFamilyMap: Record<string, TiktokenModel> = {
  "gpt-4": "gpt-4",
  "gpt-4o": "gpt-4o",
  "gpt-4-turbo": "gpt-4-turbo",
  "gpt-3.5-turbo": "gpt-3.5-turbo",
  "o1": "o1",
  "o1-mini": "o1-mini",
  "o3-mini": "o3-mini",
  "claude": "gpt-4",
  "deepseek": "gpt-4",
  "qwen": "gpt-4",
  "gemini": "gpt-4",
};

function resolveTiktokenModel(modelId: string): TiktokenModel {
  const lower = modelId.toLowerCase();
  for (const [key, model] of Object.entries(modelFamilyMap)) {
    if (lower.startsWith(key)) return model;
  }
  return "gpt-4";
}

function getEncoder(modelId: string): ReturnType<typeof encoding_for_model> {
  const tiktokenModel = resolveTiktokenModel(modelId);
  if (encoder && currentModelName === tiktokenModel) return encoder;
  if (encoder) encoder.free();
  encoder = encoding_for_model(tiktokenModel);
  currentModelName = tiktokenModel;
  return encoder;
}

export function countTokens(text: string, modelId: string = "gpt-4"): number {
  try {
    const enc = getEncoder(modelId);
    return enc.encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function countMessageTokens(messages: Array<{ role: string; content: string }>, modelId: string = "gpt-4"): number {
  let total = 0;
  for (const message of messages) {
    total += 4;
    total += countTokens(message.role, modelId);
    total += countTokens(message.content, modelId);
  }
  total += 2;
  return total;
}

export interface TokenBudget {
  total: number;
  systemPrompt: number;
  history: number;
  scratchpad: number;
  tools: number;
  available: number;
}

const defaultContextWindowSizes: Record<string, number> = {
  "gpt-4": 8192,
  "gpt-4-32k": 32768,
  "gpt-4-turbo": 128000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-3.5-turbo": 16385,
  "o1": 200000,
  "o1-mini": 128000,
  "o3-mini": 200000,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "claude-3.5-sonnet": 200000,
  "claude-4-sonnet": 200000,
  "deepseek-chat": 65536,
  "deepseek-reasoner": 65536,
  "qwen-max": 32768,
  "qwen-plus": 131072,
  "qwen-turbo": 131072,
  "gemini-pro": 32768,
  "gemini-1.5-pro": 2097152,
  "gemini-2.0-flash": 1048576,
};

export function getContextWindowSize(modelId: string): number {
  const lower = modelId.toLowerCase();
  for (const [key, size] of Object.entries(defaultContextWindowSizes)) {
    if (lower.includes(key.toLowerCase())) return size;
  }
  return 128000;
}

export function calculateTokenBudget(
  modelId: string,
  systemPromptTokens: number,
  historyTokens: number,
  scratchpadTokens: number,
  toolsTokens: number
): TokenBudget {
  const total = getContextWindowSize(modelId);
  const reserved = 4096;
  const available = Math.max(0, total - systemPromptTokens - historyTokens - scratchpadTokens - toolsTokens - reserved);
  return {
    total,
    systemPrompt: systemPromptTokens,
    history: historyTokens,
    scratchpad: scratchpadTokens,
    tools: toolsTokens,
    available
  };
}

export function truncateToTokenLimit(text: string, maxTokens: number, modelId: string = "gpt-4"): string {
  const tokens = countTokens(text, modelId);
  if (tokens <= maxTokens) return text;
  const ratio = maxTokens / tokens;
  const charLimit = Math.floor(text.length * ratio * 0.95);
  return text.slice(0, charLimit);
}
