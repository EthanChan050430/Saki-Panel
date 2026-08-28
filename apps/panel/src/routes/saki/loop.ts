import { randomUUID } from "node:crypto";
import type { SakiAgentAction, SakiAgentRiskLevel, SakiChatRequest, SakiChatResponse, PermissionCode } from "@webops/shared";
import { countTokens, estimateModelCallTokens } from "../../tokenizer.js";
import { recordAgentTokenUsage } from "../../points.js";
import type { ParsedToolCall, SakiAgentResumeState, SakiAgentRunEvents, SakiAgentRuntime, SakiCheckpoint, SakiModelToolTurn, PendingSakiAction } from "./types.js";
import {
  actionId,
  checkpointId,
  defaultAgentReadFileLineCount,
  effectiveSakiAgentPermissionMode,
  maxAgentCompactedScratchpadChars,
  maxAgentCompactedScratchpadTokens,
  maxAgentLoops,
  maxAgentProgressOnlyRetries,
  maxAgentPromptObservationChars,
  maxAgentPromptObservationTokens,
  maxAgentRecentScratchpadEntries,
  maxAgentScratchpadChars,
  maxAgentScratchpadTokens,
  maxParallelReadOnlyTools,
  normalizeSakiAgentPermissionMode,
  rawStringArg,
  redactSensitiveText,
  RouteError,
  stringArg,
  logSakiModelEvent,
  sakiVerboseModelLogsEnabled,
  stripThinking,
  truncateText,
  trimString,
  combinedSakiContextText,
} from "./types.js";
import { advertisedSakiToolSchemas, isSakiReadOnlyAgentTool, normalizedAgentToolName, shouldRequestSakiApproval, assertSakiPermissionModeAllowsTool, sakiToolSchemas, toolArgs } from "./tools.js";
import { callConfiguredAgentTurn } from "./providers.js";
import { buildAgentPrompt, buildAgentContinuationPrompt } from "./prompt.js";
import { sakiModelProfile, xmlToolFormatReminder } from "./model-profile.js";
import {
  fingerprintAgentText,
  isDegenerateRepetition,
  maxConsecutiveFailedTools,
  maxDegenerateRetries,
  maxIdenticalOutputTurns,
  maxIdenticalToolExecutions,
  maxNoProgressTurns,
  stuckFailuresMessage,
  stuckNoProgressMessage,
  stuckOutputMessage
} from "./agent-guard.js";
import { bootstrapAgentSkills } from "./skills.js";
import {
  completedSakiActions,
  extractTodosFromScratchpad,
  getRecentWorkingFiles,
  pendingSakiActions,
  sakiCheckpoints,
  saveSessionAgentMemory
} from "./state.js";

export { completedSakiActions, pendingSakiActions, sakiCheckpoints, saveSessionAgentMemory } from "./state.js";

export function emitSakiWorkflow(events: SakiAgentRunEvents | undefined, update: { id: string; stage: string; message: string; status: string; tool?: string; call?: string; actionId?: string; detail?: string }): void {
  events?.workflow?.(update as any);
}

export function actionStatusLabel(action: SakiAgentAction): string {
  if (action.status === "pending_approval") return "pending_approval";
  if (action.status === "rolled_back") return "rolled_back";
  if (action.status === "rejected") return "rejected";
  return action.ok ? "completed" : "failed";
}

const compactToolTextLength = 180;

function toolCallArgsForDisplay(call: ParsedToolCall): Record<string, unknown> {
  return Array.isArray(call.args) ? {} : call.args;
}

function toolDisplayArgs(call: ParsedToolCall): string {
  const args = toolCallArgsForDisplay(call);
  const entries: Array<[string, string]> = [];
  const add = (key: string, value: unknown, maxLength = 60) => {
    if (value === undefined || value === null) return;
    const text = String(value).replace(/\s+/g, " ").trim();
    entries.push([key, text.length > maxLength ? `${text.slice(0, maxLength)}...` : text]);
  };

  const toolName = call.name.toLowerCase();
  if (toolName === "writefile") {
    add("path", args.path);
    add("content", args.content, compactToolTextLength);
  } else if (toolName === "replaceinfile") {
    add("path", args.path);
    add("oldText", args.oldText, compactToolTextLength);
    add("newText", args.newText, compactToolTextLength);
  } else if (toolName === "editlines") {
    add("path", args.path);
    add("startLine", args.startLine);
    add("endLine", args.endLine);
    add("replacement", args.replacement, compactToolTextLength);
  } else if (toolName === "uploadbase64") {
    add("path", args.path);
    add("contentBase64", args.contentBase64, compactToolTextLength);
  } else if (toolName === "renamepath") {
    add("fromPath", args.fromPath);
    add("toPath", args.toPath);
  } else if (toolName === "runcommand") {
    add("command", args.command);
    add("cwd", args.cwd || args.workingDirectory);
    add("timeoutMs", args.timeoutMs);
  } else if (toolName === "sendinput") {
    add("instanceId", args.instanceId);
    add("text", args.text, compactToolTextLength);
    add("pressEnter", args.pressEnter);
    add("echo", args.echo);
  } else {
    for (const key of ["instanceId", "path", "query", "url", "skillId", "taskId", "action", "command", "lines", "limit"]) {
      add(key, args[key]);
    }
  }

  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

export function renderToolCall(call: ParsedToolCall): string {
  const args = toolCallArgsForDisplay(call);
  const paramTags = Object.entries(args)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `<${k}>${typeof v === "object" ? JSON.stringify(v) : String(v)}</${k}>`)
    .join("\n");
  return `<tool_call name="${call.name}">\n${paramTags}\n</tool_call>`;
}

function toolTargetPath(call: ParsedToolCall): string {
  const args = toolCallArgsForDisplay(call);
  return stringArg(args, "path") || stringArg(args, "fromPath") || stringArg(args, "toPath");
}

function isFileEditToolCall(call: ParsedToolCall): boolean {
  const toolName = call.name.toLowerCase();
  return toolName === "writefile" || toolName === "replaceinfile" || toolName === "editlines" || toolName === "uploadbase64";
}

function fileEditActionLabel(call: ParsedToolCall): "\u521B\u5EFA" | "\u7F16\u8F91" {
  const toolName = call.name.toLowerCase();
  return toolName === "replaceinfile" || toolName === "editlines" ? "\u7F16\u8F91" : "\u521B\u5EFA";
}

function toolIntentMessage(call: ParsedToolCall): string {
  const toolName = call.name.toLowerCase();
  const args = toolCallArgsForDisplay(call);
  const pathArg = toolTargetPath(call);
  const query = stringArg(args, "query");
  const command = stringArg(args, "command");
  const inputText = rawStringArg(args, "text");
  const note = stringArg(args, "note");
  if (note) return note.slice(0, 180);

  if (isFileEditToolCall(call)) {
    const label = fileEditActionLabel(call);
    return pathArg ? `${label} ${pathArg} \u4E2D\u3002` : `${label}\u6587\u4EF6\u4E2D\u3002`;
  }
  if (toolName === "listinstances") return "\u6211\u8981\u5148\u770B\u6709\u54EA\u4E9B\u5B9E\u4F8B\uFF0C\u786E\u8BA4\u64CD\u4F5C\u76EE\u6807\u3002";
  if (toolName === "describeinstance") return "\u6211\u8981\u5148\u6838\u5BF9\u8FD9\u4E2A\u5B9E\u4F8B\u7684\u914D\u7F6E\u548C\u5DE5\u4F5C\u76EE\u5F55\u3002";
  if (toolName === "instancelogs") return "\u6211\u8981\u5148\u770B\u6700\u8FD1\u65E5\u5FD7\uFF0C\u786E\u8BA4\u9519\u8BEF\u4ECE\u54EA\u91CC\u5F00\u59CB\u3002";
  if (toolName === "listfiles") return pathArg ? `\u6211\u8981\u67E5\u770B ${pathArg} \u91CC\u7684\u6587\u4EF6\u3002` : "\u6211\u8981\u67E5\u770B\u5F53\u524D\u76EE\u5F55\u91CC\u7684\u6587\u4EF6\u3002";
  if (toolName === "readfile") return pathArg ? `\u6211\u8981\u5148\u8BFB ${pathArg}\uFF0C\u770B\u6E05\u695A\u5F53\u524D\u5185\u5BB9\u3002` : "\u6211\u8981\u5148\u8BFB\u76F8\u5173\u6587\u4EF6\uFF0C\u770B\u6E05\u695A\u5F53\u524D\u5185\u5BB9\u3002";
  if (toolName === "mkdir") return pathArg ? `\u6211\u8981\u521B\u5EFA\u76EE\u5F55 ${pathArg}\u3002` : "\u6211\u8981\u521B\u5EFA\u4E00\u4E2A\u76EE\u5F55\u3002";
  if (toolName === "deletepath") return pathArg ? `\u6211\u8981\u5220\u9664 ${pathArg}\uFF0C\u8FD9\u4E00\u6B65\u9700\u8981\u5148\u786E\u8BA4\u3002` : "\u6211\u8981\u5220\u9664\u4E00\u4E2A\u8DEF\u5F84\uFF0C\u8FD9\u4E00\u6B65\u9700\u8981\u5148\u786E\u8BA4\u3002";
  if (toolName === "renamepath") return "\u6211\u8981\u79FB\u52A8\u6216\u91CD\u547D\u540D\u6587\u4EF6\u3002";
  if (toolName === "runcommand") return command ? `\u6211\u9700\u8981\u8FD0\u884C\u9A8C\u8BC1\u547D\u4EE4\uFF1A${command.slice(0, 120)}` : "\u6211\u9700\u8981\u8FD0\u884C\u547D\u4EE4\u6765\u9A8C\u8BC1\u5224\u65AD\u3002";
  if (toolName === "sendinput") return inputText ? `\u6211\u51C6\u5907\u5411\u6B63\u5728\u8FD0\u884C\u7684\u63A7\u5236\u53F0\u8F93\u5165 ${inputText.length} \u4E2A\u5B57\u7B26\u3002` : "\u6211\u51C6\u5907\u5411\u6B63\u5728\u8FD0\u884C\u7684\u63A7\u5236\u53F0\u53D1\u9001\u8F93\u5165\u3002";
  if (toolName === "sendcommand") return command ? `\u6211\u51C6\u5907\u628A\u8F93\u5165\u53D1\u9001\u7ED9\u6B63\u5728\u8FD0\u884C\u7684\u8FDB\u7A0B\uFF1A${command.slice(0, 120)}` : "\u6211\u51C6\u5907\u628A\u8F93\u5165\u53D1\u9001\u7ED9\u6B63\u5728\u8FD0\u884C\u7684\u8FDB\u7A0B\u3002";
  if (toolName === "instanceaction") return "\u6211\u8981\u8C03\u6574\u5B9E\u4F8B\u8FD0\u884C\u72B6\u6001\uFF0C\u8FD9\u4E00\u6B65\u9700\u8981\u8C28\u614E\u786E\u8BA4\u3002";
  if (toolName === "updateinstancesettings") return "\u6211\u8981\u4FEE\u6539\u5B9E\u4F8B\u914D\u7F6E\u3002";
  if (toolName === "searchaudit") return query ? `\u6211\u8981\u5728\u5BA1\u8BA1\u65E5\u5FD7\u91CC\u67E5\u201C${query.slice(0, 80)}\u201D\u3002` : "\u6211\u8981\u67E5\u5BA1\u8BA1\u65E5\u5FD7\u3002";
  if (toolName === "listtasks" || toolName === "taskruns") return "\u6211\u8981\u67E5\u770B\u8BA1\u5212\u4EFB\u52A1\u8BB0\u5F55\u3002";
  if (toolName.includes("scheduledtask") || toolName === "runtask") return "\u6211\u8981\u5904\u7406\u8BA1\u5212\u4EFB\u52A1\u3002";
  if (toolName === "searchweb") return query ? `\u6211\u8981\u641C\u7D22\uFF1A\u201C${query.slice(0, 80)}\u201D\u3002` : "\u6211\u8981\u641C\u7D22\u516C\u5F00\u4FE1\u606F\u3002";
  if (toolName === "browse" || toolName === "crawl" || toolName === "researchweb") return "\u6211\u8981\u8BFB\u53D6\u7F51\u9875\u5185\u5BB9\u3002";
  if (toolName === "listskills" || toolName === "searchskills" || toolName === "findskills" || toolName === "matchskills") {
    return "\u6211\u8981\u67E5\u4E00\u4E0B\u6709\u6CA1\u6709\u9002\u7528\u7684\u6280\u80FD\u89C4\u8303\u3002";
  }
  if (toolName === "readskill" || toolName === "loadskill" || toolName === "useskill" || toolName === "getskill" || toolName === "applyskill") {
    return "\u6211\u8981\u8BFB\u53D6\u8FD9\u4E2A\u6280\u80FD\u89C4\u8303\u3002";
  }
  if (toolName === "respond") return "\u6211\u5DF2\u7ECF\u6574\u7406\u597D\u7ED3\u679C\uFF0C\u5F00\u59CB\u56DE\u590D\u4F60\u3002";
  return "\u6211\u8981\u5148\u8865\u5145\u4E00\u70B9\u4E0A\u4E0B\u6587\u3002";
}

function toolOutcomeMessage(call: ParsedToolCall, action: SakiAgentAction): string {
  const toolName = call.name.toLowerCase();
  const pathArg = toolTargetPath(call);
  if (action.status === "pending_approval") return "\u8FD9\u4E00\u6B65\u98CE\u9669\u8F83\u9AD8\uFF0C\u6211\u5148\u7B49\u4F60\u786E\u8BA4\u3002";
  if (!action.ok) return "\u8FD9\u6B21\u8C03\u7528\u5931\u8D25\u4E86\uFF0C\u6211\u4F1A\u6839\u636E\u9519\u8BEF\u4FE1\u606F\u8C03\u6574\u3002";
  if (toolName === "instancelogs") return "\u65E5\u5FD7\u8BFB\u5230\u4E86\u3002";
  if (toolName === "listfiles") return "\u76EE\u5F55\u770B\u5230\u4E86\u3002";
  if (toolName === "readfile") return pathArg ? `${pathArg} \u8BFB\u5B8C\u4E86\u3002` : "\u6587\u4EF6\u8BFB\u5B8C\u4E86\u3002";
  if (isFileEditToolCall(call)) {
    const label = fileEditActionLabel(call);
    return pathArg ? `\u6211\u5DF2\u7ECF${label}\u597D ${pathArg}\u3002` : `\u6211\u5DF2\u7ECF${label}\u597D\u6587\u4EF6\u3002`;
  }
  if (toolName === "mkdir") return pathArg ? `\u76EE\u5F55 ${pathArg} \u5DF2\u7ECF\u5EFA\u597D\u3002` : "\u76EE\u5F55\u5DF2\u7ECF\u5EFA\u597D\u3002";
  if (toolName === "renamepath") return "\u79FB\u52A8\u6216\u91CD\u547D\u540D\u5DF2\u7ECF\u5B8C\u6210\u3002";
  if (toolName === "deletepath") return pathArg ? `${pathArg} \u5DF2\u7ECF\u5904\u7406\u597D\u3002` : "\u8DEF\u5F84\u5DF2\u7ECF\u5904\u7406\u597D\u3002";
  if (toolName === "runcommand") return "\u547D\u4EE4\u6267\u884C\u5B8C\u4E86\u3002";
  if (toolName === "sendinput" || toolName === "sendcommand") return "\u63A7\u5236\u53F0\u8F93\u5165\u5DF2\u7ECF\u53D1\u9001\u3002";
  if (toolName === "searchweb" || toolName === "browse" || toolName === "crawl" || toolName === "researchweb") return "\u7F51\u9875\u4FE1\u606F\u62FF\u5230\u4E86\u3002";
  if (
    toolName === "listskills" ||
    toolName === "searchskills" ||
    toolName === "findskills" ||
    toolName === "matchskills" ||
    toolName === "readskill" ||
    toolName === "loadskill" ||
    toolName === "useskill" ||
    toolName === "getskill" ||
    toolName === "applyskill"
  ) {
    return "\u6280\u80FD\u89C4\u8303\u770B\u5B8C\u4E86\u3002";
  }
  return "\u8FD9\u4E00\u6B65\u5B8C\u6210\u4E86\u3002";
}

export async function emitAgentFinalText(events: SakiAgentRunEvents | undefined, text: string, alreadyForwarded?: string): Promise<void> {
  if (!events?.delta || !text) return;
  let emitText = text;
  if (alreadyForwarded) {
    const af = alreadyForwarded.trim();
    if (af && emitText.trimStart().startsWith(af)) {
      emitText = emitText.trimStart().slice(af.length).trimStart();
    } else if (af && emitText.includes(af)) {
      const idx = emitText.indexOf(af);
      if (idx !== -1 && idx < emitText.length * 0.5) {
        emitText = emitText.slice(idx + af.length).trimStart();
      }
    }
    if (!emitText) return;
  }
  events.delta(emitText);
}

const sakiToolNameAlternation = sakiToolSchemas
  .flatMap((schema) => [schema.name, ...(schema.aliases ?? [])])
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

function looksLikeToolCallPayload(text: string): boolean {
  if (/<tool_call\b/i.test(text)) return true;
  if (/"?tool_calls"?\s*:/i.test(text) || /"?toolCalls"?\s*:/i.test(text)) return true;
  if (new RegExp(`"(?:${sakiToolNameAlternation})"\\s*:`, "i").test(text)) return true;
  return new RegExp(`"name"\\s*:\\s*"(?:${sakiToolNameAlternation})"`, "i").test(text);
}

function looksLikeProgressOnlyToolIntent(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;
  if (new RegExp(`\\b(?:${sakiToolNameAlternation})\\b`, "i").test(normalized)) {
    return true;
  }
  const actionVerb = /(?:read|inspect|search|run|execute|call|list|check|open|edit|modify|fix|write|create|delete|verify|test|look at)/i;
  const futureIntent = /(?:\bi(?:'ll| will| am going to| need to| should)\b|\bnext\b|\bthen\b|\babout to\b|\bgoing to\b)/i;
  const toolWords = /(?:tool|function|operation|call|arguments)/i;
  return actionVerb.test(normalized) && (futureIntent.test(normalized) || toolWords.test(normalized));
}

function safeAgentFinalText(text: string): string {
  const cleaned = stripThinking(text).trim();
  if (!cleaned) return "Saki \u6682\u65F6\u6CA1\u6709\u5F62\u6210\u53EF\u7528\u56DE\u590D\u3002";
  if (looksLikeToolCallPayload(cleaned)) {
    return "\u6211\u521A\u624D\u751F\u6210\u4E86\u5DE5\u5177\u8C03\u7528\u8349\u7A3F\uFF0C\u4F46\u683C\u5F0F\u6CA1\u6709\u901A\u8FC7\u6821\u9A8C\uFF0C\u6240\u4EE5\u6CA1\u6709\u628A\u5B83\u5F53\u4F5C\u56DE\u590D\u5C55\u793A\u3002\u8BF7\u518D\u8BD5\u4E00\u6B21\uFF0C\u6211\u4F1A\u7EE7\u7EED\u7528\u5DE5\u5177\u5904\u7406\u3002";
  }
  const jsonStart = cleaned.indexOf("{");
  if (jsonStart > 0) {
    const textPart = cleaned.slice(0, jsonStart).trim();
    if (textPart) return textPart;
  }
  return cleaned;
}

function emitAgentNarration(events: SakiAgentRunEvents | undefined, text: string): void {
  const cleaned = stripThinking(text).trim();
  if (!cleaned || looksLikeToolCallPayload(cleaned)) return;
  const snippet = cleaned.slice(0, 500);
  if (events?.delta) {
    events.delta(snippet.endsWith("\n") ? snippet : `${snippet}\n\n`);
    return;
  }
  emitSakiWorkflow(events, {
    id: randomUUID(),
    stage: "narration",
    message: snippet,
    status: "completed"
  });
}

function promptObservationLimit(action: SakiAgentAction, modelId?: string): number {
  if (!action.ok) return modelId ? Math.max(maxAgentPromptObservationTokens, 1200) : Math.max(maxAgentPromptObservationChars, 3800);
  const toolName = normalizedAgentToolName(action.tool);
  if (modelId) {
    if (toolName === "readfile") return 1200;
    if (toolName === "runcommand") return 1200;
    if (toolName === "listfiles" || toolName === "instancelogs") return 800;
    if (toolName === "browse" || toolName === "crawl" || toolName === "researchweb" || toolName === "searchweb") return 900;
    if (toolName === "searchfiles") return 1200;
    if (toolName === "findfiles") return 600;
    return maxAgentPromptObservationTokens;
  }
  if (toolName === "readfile") return 3600;
  if (toolName === "runcommand") return 3600;
  if (toolName === "listfiles" || toolName === "instancelogs") return 2400;
  if (toolName === "browse" || toolName === "crawl" || toolName === "researchweb" || toolName === "searchweb") return 2600;
  if (toolName === "searchfiles") return 3600;
  if (toolName === "findfiles") return 1800;
  return maxAgentPromptObservationChars;
}

export function observationForAgentPrompt(action: SakiAgentAction): string {
  const limit = promptObservationLimit(action);
  const observation = truncateText(redactSensitiveText(action.observation), limit);
  const status = action.status ?? (action.ok ? "completed" : "failed");
  return [`status=${status}`, `ok=${action.ok}`, observation].join("\n");
}

export const cacheableReadOnlyAgentToolNames = new Set([
  "listinstances",
  "describeinstance",
  "listfiles",
  "readfile",
  "listtasks",
  "findfiles",
  "searchfiles",
  "outlinefile",
  "readsymbol",
  "findsymbols",
  "statfile",
  "searchweb",
  "browse",
  "crawl",
  "researchweb",
  "listskills",
  "searchskills",
  "findskills",
  "matchskills",
  "readskill",
  "loadskill",
  "useskill",
  "getskill",
  "applyskill",
  "readmemory",
  "getenvironmentinfo",
  "diagnosecode",
  "gitstatus",
  "gitdiff"
]);

function stableCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCacheValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined && typeof item !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableCacheValue(item)])
    );
  }
  return value;
}

function normalizedAgentToolCacheArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const normalized = Object.fromEntries(Object.entries(args).filter(([key]) => key !== "note"));
  if (toolName === "readfile" && normalized.lineCount === undefined) {
    normalized.lineCount = defaultAgentReadFileLineCount;
  }
  if (toolName === "listfiles" && normalized.limit === undefined) normalized.limit = 200;
  if (toolName === "listinstances" && normalized.limit === undefined) normalized.limit = 50;
  return normalized;
}

export function agentReadOnlyToolCacheKey(runtime: SakiAgentRuntime, call: ParsedToolCall): string | null {
  if (Array.isArray(call.args)) return null;
  const toolName = normalizedAgentToolName(call.name);
  if (!cacheableReadOnlyAgentToolNames.has(toolName)) return null;
  return JSON.stringify(
    stableCacheValue({
      tool: toolName,
      args: normalizedAgentToolCacheArgs(toolName, call.args),
      activeInstanceId: runtime.context.instance?.id ?? null,
      activeWorkingDirectory: runtime.context.instance?.workingDirectory ?? null,
      userId: runtime.userId
    })
  );
}

function cloneCachedAgentAction(call: ParsedToolCall, cached: SakiAgentAction): SakiAgentAction {
  const args = Array.isArray(call.args) ? { legacyArgs: call.args } : call.args;
  return {
    id: actionId(),
    tool: call.name,
    args,
    observation: `${cached.observation}\n\n[cache hit: reused result from earlier ${cached.tool} action ${cached.id} in this Agent run.]`,
    ok: cached.ok,
    status: cached.status ?? (cached.ok ? "completed" : "failed"),
    createdAt: new Date().toISOString()
  };
}

function shouldCacheAgentToolResult(call: ParsedToolCall, action: SakiAgentAction): boolean {
  if (!action.ok || action.status !== "completed") return false;
  return !Array.isArray(call.args) && cacheableReadOnlyAgentToolNames.has(normalizedAgentToolName(call.name));
}

function shouldInvalidateAgentToolCache(call: ParsedToolCall): boolean {
  const toolName = normalizedAgentToolName(call.name);
  if (toolName === "respond" || toolName === "reportprogress") return false;
  return !isSakiReadOnlyAgentTool(toolName);
}

export function compactAgentScratchpadEntry(entry: string, index: number): string {
  const cleaned = redactSensitiveText(entry).trim();
  let label = `step ${index + 1}`;

  const xmlMatch = cleaned.match(/Assistant:\s*<tool_call(?:\s+name=["']([^"']+)["'])?>([\s\S]*?)<\/tool_call>/i);
  if (xmlMatch) {
    let name = xmlMatch[1] || "";
    const inner = xmlMatch[2] || "";
    if (!name) {
      const nameMatch = inner.match(/<name>([^<]+)<\/name>/i);
      if (nameMatch) name = nameMatch[1]!.trim();
    }
    const pathMatch = inner.match(/<(?:path|fromPath|toPath|command|query|url|taskId|skillId)>([^<]+)<\//i);
    const keyVal = pathMatch ? pathMatch[1]!.trim().slice(0, 60) : "";
    label = name ? (keyVal ? `${name}(${keyVal})` : name) : `tool`;
  } else {
    const toolMatch = cleaned.match(/Assistant:\s*({[^}]+})/);
    if (toolMatch?.[1]) {
      try {
        const parsed = JSON.parse(toolMatch[1]) as { name?: string; arguments?: Record<string, unknown> };
        const name = trimString(parsed.name) || "tool";
        const argsObj = parsed.arguments || {};
        const importantKeys = ["path", "fromPath", "toPath", "query", "url", "skillId", "taskId", "command", "startLine", "lineCount"];
        const args = importantKeys
          .map(key => {
            const val = argsObj[key];
            if (val === undefined || val === null) return null;
            const str = String(val).replace(/\s+/g, " ").slice(0, 60);
            return `${key}=${str}`;
          })
          .filter(Boolean)
          .join(", ");
        label = args ? `${name}(${args})` : name;
      } catch {
        label = "tool";
      }
    }
  }

  const obsIndex = cleaned.indexOf("Observation:");
  const observation = obsIndex >= 0 ? cleaned.slice(obsIndex + 12).trim() : cleaned;
  const statusMatch = observation.match(/^status=([^\n]+)/m);
  const okMatch = observation.match(/^ok=([^\n]+)/m);
  const status = statusMatch ? statusMatch[1] : "";
  const ok = okMatch ? okMatch[1] : "";

  let snippet = "";
  if (label.toLowerCase().startsWith("readfile")) {
    const fileMatch = observation.match(/^File:\s*([^\n]+)/m);
    const linesMatch = observation.match(/^Showing lines:\s*([^\n]+)/m);
    const totalLinesMatch = observation.match(/^Total lines:\s*([^\n]+)/m);
    const file = fileMatch ? fileMatch[1]!.trim() : "";
    const lines = linesMatch ? linesMatch[1]!.trim() : "";
    const total = totalLinesMatch ? totalLinesMatch[1]!.trim() : "";
    snippet = `[Read ${file || "file"} (lines ${lines || "all"} / total ${total || "?"} lines) - inspect completed]`;
  } else if (label.toLowerCase().startsWith("listfiles")) {
    const fileCount = (observation.match(/\[(?:FILE|DIR)\]/g) || []).length;
    snippet = `[Listed directory: ${fileCount} entries inspected]`;
  } else if (label.toLowerCase().startsWith("outlinefile") || label.toLowerCase().startsWith("fileoutline")) {
    const symbolCount = (observation.match(/^L\d+:/gm) || []).length;
    snippet = `[File outline: ${symbolCount} definitions extracted]`;
  } else if (label.toLowerCase().startsWith("findsymbols") || label.toLowerCase().startsWith("finddefinition")) {
    const matchCount = (observation.match(/^\S+:\d+:/gm) || []).length;
    snippet = `[Symbol search: ${matchCount} definitions located]`;
  } else if (label.toLowerCase().startsWith("diagnosecode") || label.toLowerCase().startsWith("diagnostics") || label.toLowerCase().startsWith("typecheck")) {
    const isClean = observation.includes("clean");
    snippet = isClean ? "[Diagnostics: clean (0 errors)]" : `[Diagnostics: ${truncateText(observation.replace(/\n+/g, " "), 150)}]`;
  } else if (label.toLowerCase().startsWith("managetodos") || label.toLowerCase().startsWith("todos")) {
    snippet = `[TODOs: updated task list]`;
  } else if (label.toLowerCase().startsWith("spawntask") || label.toLowerCase().startsWith("subagent")) {
    snippet = `[Sub-agent task completed: ${truncateText(observation.replace(/\n+/g, " "), 180)}]`;
  } else {
    const body = observation
      .replace(/^status=[^\n]+\n?/m, "")
      .replace(/^ok=[^\n]+\n?/m, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    snippet = truncateText(body, 320);
  }

  const parts = [`[older ${index + 1}] ${label}`];
  if (status || ok) parts.push(`status=${status || "unknown"} ok=${ok || "unknown"}`);
  if (snippet) parts.push(snippet);
  return parts.join("\n");
}

export function renderAgentScratchpad(entries: string[], modelId?: string): string {
  if (entries.length === 0) return "";
  const full = entries.join("");
  const maxChars = maxAgentScratchpadChars;
  const maxTokens = maxAgentScratchpadTokens;
  if (modelId) {
    if (countTokens(full, modelId) <= maxTokens) return full;
  } else if (full.length <= maxChars) {
    return full;
  }

  const spaceLimit = modelId ? maxTokens * 0.65 : maxChars * 0.65;
  const compactedLimit = modelId ? maxAgentCompactedScratchpadTokens : maxAgentCompactedScratchpadChars;

  const recent: string[] = [];
  let recentLength = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] ?? "";
    if (recent.length >= maxAgentRecentScratchpadEntries || recentLength + entry.length > spaceLimit) break;
    recent.unshift(entry);
    recentLength += entry.length;
  }

  const olderCount = entries.length - recent.length;
  const older = entries.slice(0, olderCount);
  const compacted = truncateText(
    older.map((entry, index) => compactAgentScratchpadEntry(entry, index)).join("\n\n---\n\n"),
    Math.min(compactedLimit, Math.max(2000, maxChars - recentLength - 1200)),
    modelId
  );
  const rendered = `... [${olderCount} older observations compacted deterministically to keep the agent fast]\n${compacted}\n\nRecent full observations:\n${recent.join("")}`;
  if (modelId) {
    if (countTokens(rendered, modelId) <= maxTokens) return rendered;
    return truncateText(rendered, maxChars, modelId);
  }
  return rendered.length <= maxChars ? rendered : truncateText(rendered, maxChars);
}

function isParallelizableReadOnlyCall(call: ParsedToolCall): boolean {
  if (Array.isArray(call.args)) return false;
  const toolName = normalizedAgentToolName(call.name);
  return toolName !== "reportprogress" && toolName !== "respond" && isSakiReadOnlyAgentTool(toolName);
}

function billedAgentTurnTokens(modelId: string, prompt: string, turn: SakiModelToolTurn): number {
  if (turn.usageTokens && turn.usageTokens > 0) return turn.usageTokens;
  return estimateModelCallTokens(
    prompt,
    turn.content,
    turn.toolCalls,
    modelId,
    JSON.stringify(advertisedSakiToolSchemas())
  );
}

export type ExecuteToolFn = (runtime: SakiAgentRuntime, call: ParsedToolCall, options: { approved?: boolean; actionId?: string; pendingResume?: SakiAgentResumeState }) => Promise<SakiAgentAction>;

export async function runSakiAgent(
  runtime: SakiAgentRuntime,
  events?: SakiAgentRunEvents,
  resume?: SakiAgentResumeState,
  executeTool?: ExecuteToolFn
): Promise<SakiChatResponse> {
  const executeToolFn = executeTool ?? (async () => {
    throw new RouteError("executeSakiAgentTool not provided; pass executeTool to runSakiAgent.", 500);
  });
  const actions: SakiAgentAction[] = [...(resume?.actions ?? [])];
  const basePrompt = buildAgentPrompt(runtime);
  const resumeGoal = resume?.input?.message;
  const continuationPrompt = buildAgentContinuationPrompt(runtime, resumeGoal || runtime.input.message);
  const agentScratchpadEntries: string[] = [...(resume?.scratchpadEntries ?? [])];
  const readOnlyToolCache = new Map<string, SakiAgentAction>();
  let currentPrompt = basePrompt;
  const modelProfile = sakiModelProfile(runtime.config.provider, runtime.config.model);
  let invalidReplies = 0;
  let progressOnlyReplies = 0;
  let degenerateRetries = 0;
  let identicalOutputStreak = 0;
  let noProgressStreak = 0;
  let consecutiveFailedTools = 0;
  let lastTurnFingerprint = "";
  let turnMadeProgress = false;
  const toolExecutionCounts = new Map<string, number>();
  const agentPermissionMode = effectiveSakiAgentPermissionMode(runtime.input);
  const runStartedAt = Date.now();
  let loopsUsed = 0;
  let toolExecutions = resume?.toolExecutions ?? 0;
  let toolCacheHits = 0;
  let toolCacheMisses = 0;
  let toolCacheInvalidations = 0;
  let totalTokensUsed = 0;

  const rebuildCurrentPrompt = (): void => {
    const agentScratchpad = renderAgentScratchpad(agentScratchpadEntries);
    const promptBase = toolExecutions > 0 || actions.length > 0 ? continuationPrompt : basePrompt;
    currentPrompt = agentScratchpad
      ? `${promptBase}\n\nAgent working notes and observations:\n${agentScratchpad}`
      : promptBase;
  };

  const appendAgentScratchpad = (entry: string): void => {
    if (!entry.trim()) return;
    agentScratchpadEntries.push(entry);
    rebuildCurrentPrompt();
  };

  const createResumeState = (): SakiAgentResumeState => ({
    input: runtime.input,
    skills: runtime.skills,
    actions: [...actions],
    scratchpadEntries: [...agentScratchpadEntries],
    toolExecutions
  });

  rebuildCurrentPrompt();

  if (!resume) {
    const skillBootstrap = await bootstrapAgentSkills(
      runtime.input.message,
      runtime.input.selectedSkillIds ?? [],
      combinedSakiContextText(runtime.input)
    );
    for (const entry of skillBootstrap.scratchpad) {
      appendAgentScratchpad(entry);
    }
    if (skillBootstrap.autoLoadedCount > 0 || skillBootstrap.suggestedCount > 0) {
      logSakiModelEvent("agent.skills.bootstrap", {
        autoLoadedCount: skillBootstrap.autoLoadedCount,
        suggestedCount: skillBootstrap.suggestedCount
      });
    }
  }

  logSakiModelEvent("agent.start", {
    userId: runtime.userId,
    mode: runtime.input.mode ?? "agent",
    permissionMode: agentPermissionMode,
    model: runtime.config.model,
    provider: runtime.config.provider,
    resuming: Boolean(resume),
    skillCount: runtime.skills.length
  });

  const loopLimit = Math.max(1, Math.min(runtime.maxLoops ?? maxAgentLoops, maxAgentLoops));
  logSakiModelEvent("agent.run.start", {
    mode: runtime.input.mode ?? "agent",
    permissionMode: agentPermissionMode,
    maxLoops: loopLimit,
    kind: runtime.kind ?? "chat",
    resumed: Boolean(resume),
    messageChars: runtime.input.message.length,
    historyCount: runtime.input.history?.length ?? 0,
    skillCount: runtime.skills.length
  });

  let lastForwardedDeltaContent: string | undefined;

  const finishAgentResponse = async (reason: string, message: string): Promise<SakiChatResponse> => {
    try {
      const currentResumeState = createResumeState();
      const workingFiles = getRecentWorkingFiles(runtime.userId, runtime.context.workspace?.instanceId ?? null);
      const todos = extractTodosFromScratchpad(agentScratchpadEntries);
      saveSessionAgentMemory({
        userId: runtime.userId,
        instanceId: runtime.context.workspace?.instanceId ?? null,
        resumeState: currentResumeState,
        workingFiles,
        lastGoal: resumeGoal || runtime.input.message,
        lastSummary: message,
        todos,
        updatedAt: Date.now()
      });
    } catch {}

    let usageResult: { tokensUsed: number; pointsUsed: number; isUnlimited: boolean; remainingPoints: number } | undefined;
    try {
      if (runtime.userId && totalTokensUsed > 0) {
        usageResult = await recordAgentTokenUsage(
          runtime.userId,
          totalTokensUsed,
          `Agent: ${String(runtime.input.message || "任务执行").slice(0, 50)}`
        );
      }
    } catch {}

    await emitAgentFinalText(events, message, lastForwardedDeltaContent);
    return {
      source: "direct-model",
      message,
      workspace: runtime.context.workspace,
      agentPermissionMode,
      skills: runtime.skills,
      actions,
      usage: usageResult
    };
  };

  const runToolWithWorkflow = async (
    call: ParsedToolCall,
    toolStepId: string
  ): Promise<{ call: ParsedToolCall; toolStepId: string; action: SakiAgentAction; durationMs: number; cacheHit?: boolean }> => {
    const toolStartedAt = Date.now();
    const cacheKey = agentReadOnlyToolCacheKey(runtime, call);
    if (cacheKey) {
      const cached = readOnlyToolCache.get(cacheKey);
      if (cached) {
        toolCacheHits += 1;
        return {
          call,
          toolStepId,
          action: cloneCachedAgentAction(call, cached),
          durationMs: Date.now() - toolStartedAt,
          cacheHit: true
        };
      }
      toolCacheMisses += 1;
    }

    runtime.usedToolNames ??= [];
    runtime.usedToolNames.push(normalizedAgentToolName(call.name));
    const signature = agentReadOnlyToolCacheKey(runtime, call) ?? `${normalizedAgentToolName(call.name)}::${JSON.stringify(toolCallArgsForDisplay(call))}`;
    const previousCount = toolExecutionCounts.get(signature) ?? 0;
    if (previousCount >= maxIdenticalToolExecutions) {
      return {
        call,
        toolStepId,
        action: {
          id: actionId(),
          tool: call.name,
          args: toolCallArgsForDisplay(call),
          observation: `Skipped duplicate '${call.name}' — already ran ${previousCount} times with the same arguments. Do not repeat. Edit, diagnoseCode, or respond.`,
          ok: true,
          status: "completed",
          createdAt: new Date().toISOString()
        },
        durationMs: Date.now() - toolStartedAt,
        cacheHit: true
      };
    }
    toolExecutionCounts.set(signature, previousCount + 1);
    const action = await executeToolFn(runtime, call, { pendingResume: createResumeState() });
    if (cacheKey && shouldCacheAgentToolResult(call, action)) {
      readOnlyToolCache.set(cacheKey, action);
    }
    if (shouldInvalidateAgentToolCache(call) && readOnlyToolCache.size > 0) {
      readOnlyToolCache.clear();
      toolCacheInvalidations += 1;
    }
    return { call, toolStepId, action, durationMs: Date.now() - toolStartedAt };
  };

  const recentToolSignatures: Array<{ name: string; argsStr: string; ok: boolean }> = [];
  const failedAttemptsByTarget = new Map<string, number>();
  const sequentialReadPages = new Map<string, { start: number; count: number }>();
  const fileEditTools = new Set(["writefile", "replaceinfile", "editlines", "batchedit"]);
  const verifyTools = new Set(["diagnosecode", "gitdiff", "gitstatus"]);

  const handleToolResult = async (result: {
    call: ParsedToolCall;
    toolStepId: string;
    action: SakiAgentAction;
    durationMs: number;
    cacheHit?: boolean;
  }): Promise<SakiChatResponse | null> => {
    const { call, toolStepId, action, cacheHit } = result;
    toolExecutions += 1;
    if (call.name.toLowerCase() === "respond") {
      const edited = actions.some((item) => item.ok && fileEditTools.has(normalizedAgentToolName(item.tool)));
      const verified = actions.some((item) => item.ok && verifyTools.has(normalizedAgentToolName(item.tool)));
      if (edited && !verified && runtime.kind !== "watch") {
        appendAgentScratchpad(
          "\n[Blocked respond]: You edited files but did not verify. Call diagnoseCode now. Do not respond until diagnostics are clean.\n"
        );
        emitSakiWorkflow(events, {
          id: toolStepId,
          stage: "retry",
          message: "改完代码后需要先跑诊断，再给出结论。",
          status: "running"
        });
        return null;
      }
      emitSakiWorkflow(events, {
        id: toolStepId,
        stage: "tool",
        message: "Finalizing response.",
        status: actionStatusLabel(action),
        tool: call.name,
        call: toolDisplayArgs(call),
        actionId: action.id
      });
      const finalMessage = safeAgentFinalText(action.observation || stringArg(toolArgs(call), "text") || "");
      return finishAgentResponse("respond_tool", finalMessage);
    }
    actions.push(action);
    events?.action?.(action);
    emitSakiWorkflow(events, {
      id: toolStepId,
      stage: "tool",
      message: cacheHit ? "Reused a cached tool result from this Agent run." : action.ok && action.status !== "pending_approval" ? toolIntentMessage(call) : toolOutcomeMessage(call, action),
      status: actionStatusLabel(action),
      tool: call.name,
      call: toolDisplayArgs(call),
      actionId: action.id,
      detail: action.ok && action.status !== "pending_approval" ? "" : action.observation.slice(0, 240)
    });
    if (action.status === "pending_approval") {
      const finalMessage = "Saki has prepared an action that needs your approval. Please review it in the action preview first.";
      return finishAgentResponse("pending_approval", finalMessage);
    }
    appendAgentScratchpad(`\nAssistant: ${renderToolCall(call)}\nObservation:\n${observationForAgentPrompt(action)}\n`);

    // Deadlock / repetition detection and error self-healing
    const toolName = normalizedAgentToolName(call.name);
    const args = toolArgs(call);
    const argsStr = JSON.stringify(args);
    const targetFile = String(args.path || args.filePath || "");

    // Check for duplicate consecutive tool calls
    const isDuplicate = recentToolSignatures.length > 0 &&
      recentToolSignatures[recentToolSignatures.length - 1]?.name === toolName &&
      recentToolSignatures[recentToolSignatures.length - 1]?.argsStr === argsStr;

    recentToolSignatures.push({ name: toolName, argsStr, ok: action.ok });
    if (recentToolSignatures.length > 10) recentToolSignatures.shift();

    if (isDuplicate && isSakiReadOnlyAgentTool(toolName)) {
      appendAgentScratchpad(`\n[Self-Correction & Loop Breaker]: You called '${call.name}' with identical parameters twice in a row. The observation is already above in your memory. DO NOT re-read or re-search the same query. Proceed to editing with editLines/replaceInFile, or formulate your final response.\n`);
    }

    if (toolName === "readfile") {
      const readPath = String(args.path || "");
      const start = Math.max(1, Number(args.startLine) || 1);
      const count = Math.max(1, Number(args.lineCount) || defaultAgentReadFileLineCount);
      const prev = sequentialReadPages.get(readPath);
      if (prev && start > prev.start && start <= prev.start + prev.count + 8) {
        appendAgentScratchpad(
          `\n[Paging blocked]: '${readPath}' was already read at lines ${prev.start}-${prev.start + prev.count - 1}. Do not sequential-page. Use searchFiles or readSymbol to jump, then edit.\n`
        );
      }
      sequentialReadPages.set(readPath, { start, count });
    } else if (fileEditTools.has(toolName) || verifyTools.has(toolName)) {
      sequentialReadPages.clear();
    }

    if (!action.ok) {
      if (targetFile) {
        const currentFailures = (failedAttemptsByTarget.get(targetFile) ?? 0) + 1;
        failedAttemptsByTarget.set(targetFile, currentFailures);
        if (currentFailures >= 2) {
          appendAgentScratchpad(`\n[Self-Healing Alert]: Editing '${targetFile}' failed ${currentFailures} times consecutively. Do not repeat the same failing call. Inspect the surrounding lines with outlineFile({ path: "${targetFile}" }) or readFile({ path: "${targetFile}", startLine: ... }) to verify exact line numbers, then use editLines.\n`);
        }
      }
      const obsLower = action.observation.toLowerCase();
      if (obsLower.includes("oldtext was not found") || obsLower.includes("oldtext matched")) {
        appendAgentScratchpad(`\n[Self-Healing Guidance]: The text was not matched in the file. Tip: Use editLines with exact line numbers from outlineFile/readFile to make the change deterministically.\n`);
      } else if (obsLower.includes("enoent") || obsLower.includes("not found")) {
        appendAgentScratchpad(`\n[Self-Healing Guidance]: File not found. Use findFiles to locate the exact path before attempting further operations.\n`);
      } else if (obsLower.includes("permission") || obsLower.includes("safety") || obsLower.includes("instance not found")) {
        appendAgentScratchpad("If the error is caused by missing permission, blocked safety policy, or missing active instance, stop and respond with a concise explanation. Otherwise adjust your plan and continue.\n");
      }
    } else if (targetFile && (toolName === "editlines" || toolName === "replaceinfile" || toolName === "writefile" || toolName === "batchedit")) {
      failedAttemptsByTarget.delete(targetFile);
    }

    if (!action.ok) {
      consecutiveFailedTools += 1;
      if (consecutiveFailedTools >= maxConsecutiveFailedTools) {
        return finishAgentResponse("stuck_failures", stuckFailuresMessage());
      }
    } else if (action.ok && !cacheHit) {
      consecutiveFailedTools = 0;
      turnMadeProgress = true;
    }

    return null;
  };

  for (let loop = 0; loop < loopLimit; loop += 1) {
    if (runtime.abortController?.signal.aborted) {
      return finishAgentResponse("aborted", "Watch diagnosis was cancelled.");
    }
    loopsUsed = loop + 1;
    turnMadeProgress = false;
    let turn: SakiModelToolTurn;
    try {
      turn = await callConfiguredAgentTurn(runtime, currentPrompt, events?.delta, events?.thinking);
      totalTokensUsed += billedAgentTurnTokens(runtime.config.model, currentPrompt, turn);
    } catch (error) {
      if (toolExecutions > 0 || actions.length > 0) {
        const reason = error instanceof Error ? error.message : String(error);
        return finishAgentResponse(
          "model_error_after_tools",
          `\u6A21\u578B\u63A5\u53E3\u5728\u7EE7\u7EED\u89C4\u5212\u4E0B\u4E00\u6B65\u65F6\u4E2D\u65AD\uFF1A${reason}\n\n\u524D\u9762\u5DF2\u7ECF\u5B8C\u6210\u7684\u52A8\u4F5C\u5DF2\u4FDD\u7559\u3002\u4F60\u53EF\u4EE5\u76F4\u63A5\u53D1\u9001\u201C\u7EE7\u7EED\u201D\uFF0CSaki \u4F1A\u57FA\u4E8E\u5F53\u524D\u5DE5\u4F5C\u533A\u63A5\u7740\u5904\u7406\u3002`
        );
      }
      throw error;
    }
    const cleanedTurn = stripThinking(turn.content).trim();
    if (isDegenerateRepetition(cleanedTurn)) {
      if (degenerateRetries < maxDegenerateRetries) {
        degenerateRetries += 1;
        emitSakiWorkflow(events, {
          id: randomUUID(),
          stage: "retry",
          message: "检测到模型循环重复输出，正在打断并重试。",
          status: "running"
        });
        appendAgentScratchpad(`\n[Loop breaker]: Your previous output repeated the same text. Stop generating filler. ${xmlToolFormatReminder()}\n`);
        continue;
      }
      return finishAgentResponse("stuck_degenerate", stuckOutputMessage());
    }
    const turnFingerprint = fingerprintAgentText(cleanedTurn);
    if (turnFingerprint.length > 40 && turnFingerprint === lastTurnFingerprint) {
      identicalOutputStreak += 1;
      if (identicalOutputStreak >= maxIdenticalOutputTurns) {
        if (toolExecutions > 0 || actions.length > 0) {
          return finishAgentResponse("stuck_repeat_output", stuckOutputMessage());
        }
      }
    } else {
      identicalOutputStreak = 0;
    }
    lastTurnFingerprint = turnFingerprint;

    const toolCalls = turn.toolCalls;
    if (toolCalls.length === 0) {
      if (sakiVerboseModelLogsEnabled()) {
        console.info(`[Saki debug] NO tool calls parsed. looksLikeToolCallPayload: ${looksLikeToolCallPayload(stripThinking(turn.content).trim())}`);
        console.info(`[Saki debug] Full content for debugging:\n${turn.content}`);
      }
      const cleaned = stripThinking(turn.content).trim();
      const progressOnlyToolIntent = looksLikeProgressOnlyToolIntent(cleaned);
      if (progressOnlyToolIntent && progressOnlyReplies < maxAgentProgressOnlyRetries) {
        progressOnlyReplies += 1;
        emitAgentNarration(events, cleaned);
        emitSakiWorkflow(events, {
          id: randomUUID(),
          stage: "retry",
          message: "\u521A\u624D\u7684\u56DE\u590D\u8FD8\u662F\u8FDB\u5EA6\u8BF4\u660E\uFF0C\u6211\u4F1A\u7EE7\u7EED\u8BA9 Saki \u6267\u884C\u540E\u7EED\u5DE5\u5177\u3002",
          status: "running"
        });
        appendAgentScratchpad(`\nAssistant visible note: ${redactSensitiveText(cleaned).slice(0, 1200)}\n\nSystem correction: Your previous output was only a progress note. Continue the user task now. If more tool work is needed, output clean XML tool calls like this:
<tool_call name="readFile">
<path>relative/path</path>
<note>short visible note</note>
</tool_call>
If the task is complete, use:
<tool_call name="respond">
<text>final answer</text>
</tool_call>
Do NOT use JSON inside XML. Put raw text/code directly inside parameter tags. Never use Markdown fences.\nIMPORTANT: For editing files, use editLines or replaceInFile — NOT writeFile. writeFile is for new files only with <content> parameter.\nPrevious output:\n${turn.content.slice(0, 1200)}\n`);
        continue;
      }
      const shouldRetry = !cleaned || looksLikeToolCallPayload(cleaned);
      if (shouldRetry && invalidReplies < modelProfile.invalidReplyRetries) {
        invalidReplies += 1;
        emitSakiWorkflow(events, {
          id: randomUUID(),
          stage: "retry",
          message: cleaned ? "\u521A\u624D\u7684\u5DE5\u5177\u8C03\u7528\u683C\u5F0F\u6CA1\u6709\u901A\u8FC7\u6821\u9A8C\uFF0C\u6211\u4F1A\u7528\u66F4\u660E\u786E\u7684\u683C\u5F0F\u91CD\u8BD5\u3002" : "\u6A21\u578B\u8FD9\u8F6E\u6CA1\u6709\u7ED9\u51FA\u6709\u6548\u5185\u5BB9\uFF0C\u6211\u4F1A\u518D\u8BA9\u5B83\u5224\u65AD\u4E00\u6B21\u3002",
          status: "running"
        });
        appendAgentScratchpad(`\n\nSystem correction: Your previous output did not produce valid tool calls. ${xmlToolFormatReminder()}
Do NOT wrap parameters in JSON. Write raw code directly inside parameter tags. If no tool is needed, answer naturally in the user's language.
IMPORTANT: editLines or replaceInFile for existing files; writeFile only for NEW files.\nPrevious output:\n${turn.content.slice(0, 1200)}\n`);
        continue;
      }

      const finalMessage = safeAgentFinalText(turn.content);
      return finishAgentResponse("natural", finalMessage);
    }

    invalidReplies = 0;
    progressOnlyReplies = 0;
    if (turn.forwardedDeltaContent) lastForwardedDeltaContent = turn.forwardedDeltaContent;
    const visibleAssistantText = stripThinking(turn.content).trim();
    if (visibleAssistantText && !looksLikeToolCallPayload(visibleAssistantText) && !turn.forwardedDeltaText) {
      emitAgentNarration(events, visibleAssistantText);
      appendAgentScratchpad(`\nAssistant visible note: ${redactSensitiveText(visibleAssistantText).slice(0, 1200)}\n`);
    }

    for (let callIndex = 0; callIndex < toolCalls.length;) {
      const call = toolCalls[callIndex];
      if (!call) break;

      if (call.name.toLowerCase() === "reportprogress") {
        const text = rawStringArg(toolArgs(call), "text");
        emitAgentNarration(events, text);
        appendAgentScratchpad(`\nAssistant: ${renderToolCall(call)}\nObservation: ${redactSensitiveText(text).slice(0, 1200)}\n`);
        callIndex += 1;
        continue;
      }

      if (isParallelizableReadOnlyCall(call)) {
        const batch: Array<{ call: ParsedToolCall; toolStepId: string }> = [];
        while (callIndex < toolCalls.length && batch.length < maxParallelReadOnlyTools) {
          const candidate = toolCalls[callIndex];
          if (!candidate || !isParallelizableReadOnlyCall(candidate)) break;
          const toolStepId = randomUUID();
          emitSakiWorkflow(events, {
            id: toolStepId,
            stage: "tool",
            message: toolIntentMessage(candidate),
            status: "running",
            tool: candidate.name,
            call: toolDisplayArgs(candidate)
          });
          batch.push({ call: candidate, toolStepId });
          callIndex += 1;
        }

        const results = await Promise.all(batch.map((item) => runToolWithWorkflow(item.call, item.toolStepId)));
        for (const result of results) {
          const finalResponse = await handleToolResult(result);
          if (finalResponse) return finalResponse;
        }
        continue;
      }

      const toolStepId = randomUUID();
      emitSakiWorkflow(events, {
        id: toolStepId,
        stage: "tool",
        message: toolIntentMessage(call),
        status: "running",
        tool: call.name,
        call: toolDisplayArgs(call)
      });
      const finalResponse = await handleToolResult(await runToolWithWorkflow(call, toolStepId));
      if (finalResponse) return finalResponse;
      callIndex += 1;
    }

    if (turnMadeProgress) {
      noProgressStreak = 0;
    } else {
      noProgressStreak += 1;
      if (noProgressStreak >= maxNoProgressTurns) {
        return finishAgentResponse("stuck_no_progress", stuckNoProgressMessage());
      }
      appendAgentScratchpad(
        `\n[No progress]: The last ${noProgressStreak} turn(s) repeated work or did not change the workspace. Do something new: edit, diagnoseCode, or respond.\n`
      );
    }
  }

  const alreadyEdited = actions.some((item) => item.ok && fileEditTools.has(normalizedAgentToolName(item.tool)));
  if (!alreadyEdited && loopsUsed < 8) {
    try {
      const finalWrapPrompt = `${currentPrompt}\n\n[TASK RESOLUTION]: Provide a concise final summary of what was found. Do not re-read files. Output natural text, no tool calls.`;
      const finalTurn = await callConfiguredAgentTurn(runtime, finalWrapPrompt, events?.delta, events?.thinking);
      totalTokensUsed += billedAgentTurnTokens(runtime.config.model, finalWrapPrompt, finalTurn);
      const cleaned = stripThinking(finalTurn.content).trim();
      if (cleaned && !looksLikeToolCallPayload(cleaned)) {
        return finishAgentResponse("natural_wrapup", cleaned);
      }
    } catch {}
  }

  // Synthesize a structured engineering outcome if the model did not emit text:
  const edits = actions.filter((a) => a.ok && fileEditTools.has(normalizedAgentToolName(a.tool)));
  const searches = actions.filter((a) => a.ok && (a.tool === "searchfiles" || a.tool === "outlinefile" || a.tool === "findsymbols" || a.tool === "readfile"));
  let finalSummary = "";
  if (edits.length > 0) {
    finalSummary = `已完成代码定位与修改。\n\n**修改记录**：\n${edits.map((e) => `- \`${e.tool}\`: ${e.observation.slice(0, 120)}`).join("\n")}\n\n请检查上述修改是否满足预期。`;
  } else if (searches.length > 0) {
    finalSummary = `已完成工作区代码排查与分析。\n\n**排查结果**：\n${searches.slice(-5).map((s) => `- \`${s.tool}\`: ${s.observation.slice(0, 120)}`).join("\n")}`;
  } else {
    finalSummary = "已完成当前任务的操作与排查。";
  }

  return finishAgentResponse("completed_summary", finalSummary);
}
