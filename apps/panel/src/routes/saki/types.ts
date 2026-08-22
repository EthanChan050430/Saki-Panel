import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  InstanceLogLine,
  PanelAppearanceSettings,
  PermissionCode,
  SakiAgentAction,
  SakiAgentPermissionMode,
  SakiChatMode,
  SakiChatRequest,
  SakiConfigResponse,
  SakiInputAttachment,
  SakiModelOption,
  SakiProviderConfig,
  SakiWorkspaceContext,
  UpdateScheduledTaskRequest
} from "@webops/shared";
export type { SakiSkillSummary } from "@webops/shared";
import type { SakiSkillSummary } from "@webops/shared";
import type { FastifyRequest } from "fastify";
import type { InstanceWithAccess } from "../../instance-access.js";
import { countTokens, truncateToTokenLimit } from "../../tokenizer.js";

export type InstanceWithNode = InstanceWithAccess;

export interface PanelSakiSettings {
  requestTimeoutMs?: number;
  provider?: string;
  model?: string;
  ollamaUrl?: string;
  baseUrl?: string;
  apiKey?: string;
  providerConfigs?: Record<string, SakiProviderConfig>;
  searchEnabled?: boolean;
  mcpEnabled?: boolean;
  systemPrompt?: string | null;
  appearance?: Partial<PanelAppearanceSettings>;
}

export interface ResolvedSakiContext {
  instance: InstanceWithNode | null;
  workspace: SakiWorkspaceContext | null;
  logs: InstanceLogLine[];
}

export type OperationLogWithUser = Prisma.OperationLogGetPayload<{ include: { user: true } }>;

export class RouteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`request timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
}

export class BrowseHttpError extends RouteError {
  constructor(
    public readonly url: string,
    public readonly httpStatus: number,
    public readonly statusText: string
  ) {
    super(`Browse failed with ${httpStatus}: ${statusText}`, 502);
  }
}

export const maxAgentLoops = 20;
export const maxAgentProgressOnlyRetries = 2;
export const maxAgentVerificationRetries = 2;
export const maxAgentObservationTokens = 1200;
export const maxAgentPromptObservationTokens = 600;
export const maxAgentScratchpadTokens = 3500;
export const maxAgentContinuationContextTokens = 3000;
export const maxAgentRecentScratchpadEntries = 6;
export const maxAgentCompactedScratchpadTokens = 800;
export const maxParallelReadOnlyTools = 6;
export const defaultAgentReadFileLineCount = 60;
export const minAgentModelRequestTimeoutMs = 120000;
export const maxAgentObservationChars = 14000;
export const maxAgentPromptObservationChars = 6000;
export const maxAgentScratchpadChars = 32000;
export const maxAgentContinuationContextChars = 28000;
export const maxAgentCompactedScratchpadChars = 8000;
export const maxHistoryMessages = 12;
export const sakiUsePermissions = ["saki.chat", "saki.agent"] as const satisfies readonly PermissionCode[];

export function hasPermission(userPermissions: readonly PermissionCode[] | undefined, permission: PermissionCode): boolean {
  return Array.isArray(userPermissions) && userPermissions.includes(permission);
}

export function requireUserPermission(userPermissions: readonly PermissionCode[] | undefined, permission: PermissionCode): void {
  if (!hasPermission(userPermissions, permission)) {
    throw new RouteError(`Saki needs ${permission} permission for this action.`, 403);
  }
}

export function sakiModePermission(mode: SakiChatMode): PermissionCode {
  return mode === "agent" ? "saki.agent" : "saki.chat";
}

export function requireSakiModePermission(userPermissions: readonly PermissionCode[] | undefined, mode: SakiChatMode): void {
  requireUserPermission(userPermissions, sakiModePermission(mode));
}

export const defaultSakiAgentPermissionMode: SakiAgentPermissionMode = "acceptEdits";

export function normalizeSakiAgentPermissionMode(value: unknown): SakiAgentPermissionMode {
  if (value === "ask" || value === "acceptEdits" || value === "plan" || value === "bypassPermissions") {
    return value;
  }
  return defaultSakiAgentPermissionMode;
}

export function effectiveSakiAgentPermissionMode(input: Pick<SakiChatRequest, "mode" | "agentPermissionMode">): SakiAgentPermissionMode {
  return input.mode === "agent" ? normalizeSakiAgentPermissionMode(input.agentPermissionMode) : defaultSakiAgentPermissionMode;
}

export function truncateText(value: unknown, limit = maxAgentObservationChars, modelId?: string): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (value == null) {
    return "";
  } else {
    text = JSON.stringify(value, null, 2);
  }
  if (modelId) {
    const tokenLimit = limit === maxAgentObservationChars ? maxAgentObservationTokens : Math.floor(limit / 4);
    const tokenCount = countTokens(text, modelId);
    if (tokenCount <= tokenLimit) return text;
    const truncated = truncateToTokenLimit(text, tokenLimit, modelId);
    return `${truncated}\n... [truncated, ${tokenCount} total tokens] ...`;
  }
  const len = text.length;
  if (len <= limit) return text;
  const head = Math.floor(limit * 0.65);
  const tail = Math.max(0, limit - head - 80);
  return `${text.slice(0, head)}\n... [truncated ${len - limit} chars] ...\n${text.slice(-tail)}`;
}

export function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function numericArg(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

export function stringArg(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function rawStringArg(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

export function optionalCommandInputArg(args: Record<string, unknown>): string | undefined {
  if (typeof args.input === "string") return args.input;
  if (typeof args.stdin === "string") return args.stdin;
  return undefined;
}

export function nullableStringArg(args: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in args)) return undefined;
  const value = args[key];
  if (value === null) return null;
  return typeof value === "string" ? value : String(value ?? "");
}

export function booleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*)["']?[^"'\s,;}]+/gi, "$1[redacted]")
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,})\b/g, "[redacted-api-key]");
}

export function isSensitiveRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  return [
    /(^|\/)\.env(?:\.|$)/,
    /(^|\/)\.git(\/|$)/,
    /(^|\/)\.ssh(\/|$)/,
    /(^|\/)node_modules(\/|$)/,
    /(^|\/)dist(\/|$)/,
    /(^|\/)build(\/|$)/,
    /token/,
    /secret/,
    /credential/,
    /private[_-]?key/,
    /\.pem$/,
    /\.key$/,
    /\.pfx$/
  ].some((pattern) => pattern.test(normalized));
}

export function safeRelativePath(value: unknown): string {
  const raw = trimString(value).replace(/\\/g, "/");
  if (!raw || raw === ".") return "";
  if (path.isAbsolute(raw) || raw.split("/").some((part) => part === "..")) {
    throw new RouteError("Agent file tools only accept paths inside the active instance working directory.", 400);
  }
  if (isSensitiveRelativePath(raw)) {
    throw new RouteError("Saki blocked access to a sensitive path.", 403);
  }
  return raw;
}

export function sanitizeAgentTextContent(value: string): { content: string; removed: string[] } {
  const removed = new Set<string>();
  let content = value.normalize("NFC");
  const strip = (pattern: RegExp, label: string) => {
    if (!pattern.test(content)) return;
    removed.add(label);
    content = content.replace(pattern, "");
  };

  strip(/\uFFFC/g, "U+FFFC object replacement characters");
  strip(/\uFFFD/g, "U+FFFD replacement characters");
  strip(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "zero-width or invisible characters");
  strip(/[\u202A-\u202E\u2066-\u2069]/g, "bidirectional control characters");
  strip(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "non-printing control characters");

  return { content, removed: [...removed] };
}

export function formatSanitizedWriteNote(removed: string[]): string {
  return removed.length ? ` Sanitized source text: removed ${removed.join(", ")}.` : "";
}

export function splitEditableLines(content: string): { lines: string[]; newline: string; hasFinalNewline: boolean } {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hasFinalNewline = normalized.endsWith("\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (hasFinalNewline) lines.pop();
  return { lines, newline, hasFinalNewline };
}

export function replacementToLines(content: string): string[] {
  if (!content) return [];
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

export function parseLineNumber(value: string | undefined, label: string, min = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new RouteError(`${label} must be an integer greater than or equal to ${min}.`, 400);
  }
  return parsed;
}

export function formatLineNumberedContent(content: string, startLineInput?: string, lineCountInput?: string): {
  text: string;
  totalLines: number;
  startLine: number;
  endLine: number;
} {
  const { lines } = splitEditableLines(content);
  const totalLines = lines.length;
  const startLine = startLineInput ? parseLineNumber(startLineInput, "startLine") : 1;
  if (totalLines === 0) {
    return { text: "(empty file)", totalLines: 0, startLine: 0, endLine: 0 };
  }
  if (startLine > totalLines) {
    throw new RouteError(`startLine ${startLine} is outside the file; file has ${totalLines} line(s).`, 400);
  }
  const defaultCount = totalLines - startLine + 1;
  const lineCount = lineCountInput ? numericArg(lineCountInput, defaultCount, 1, 800) : defaultCount;
  const endLine = Math.min(totalLines, startLine + lineCount - 1);
  const width = String(totalLines).length;
  const text = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${String(startLine + index).padStart(width, " ")} | ${line}`)
    .join("\n");
  return { text, totalLines, startLine, endLine };
}

export function agentReadFileLineCountInput(value: unknown): string {
  const explicit = stringArg({ lineCount: value }, "lineCount");
  return explicit || String(defaultAgentReadFileLineCount);
}

export function replaceLineRange(content: string, startLine: number, endLine: number, replacement: string): {
  content: string;
  removedLineCount: number;
  insertedLineCount: number;
} {
  const { lines, newline, hasFinalNewline } = splitEditableLines(content);
  if (startLine > lines.length + 1) {
    throw new RouteError(`startLine ${startLine} is outside the file; file has ${lines.length} line(s).`, 400);
  }
  if (endLine < startLine - 1) {
    throw new RouteError("endLine must be greater than or equal to startLine - 1.", 400);
  }
  if (endLine > lines.length) {
    throw new RouteError(`endLine ${endLine} is outside the file; file has ${lines.length} line(s).`, 400);
  }

  const replacementLines = replacementToLines(replacement);
  const deleteCount = Math.max(0, endLine - startLine + 1);
  const nextLines = [...lines];
  nextLines.splice(startLine - 1, deleteCount, ...replacementLines);
  const nextContent = nextLines.join(newline) + (hasFinalNewline && nextLines.length > 0 ? newline : "");
  return {
    content: nextContent,
    removedLineCount: deleteCount,
    insertedLineCount: replacementLines.length
  };
}

export function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Saki agent action failed";
  const enoentMatch = message.match(/ENOENT:\s+no such file or directory,\s+(?:open|stat|lstat)\s+'([^']+)'/i);
  if (enoentMatch) {
    return `文件不存在：${path.basename(enoentMatch[1] ?? "")}。请先用 listFiles 确认当前实例目录里的实际文件名；如果用户要求创建这个文件，请改用 writeFile。`;
  }
  if (/Instance is not accepting terminal input/i.test(message)) {
    return "当前实例进程不接受交互式 stdin。Agent 执行的终端命令会自动在新建的独立 shell 中运行（和点击 + 按钮完全一样），返回 shellId。不要直接用 sendInput/sendCommand 跑普通命令。";
  }
  return message;
}

export function formatRunCommandObservation(result: { workingDirectory: string; exitCode: number | null; signal: string | null; durationMs: number; stdout: string; stderr: string }, inputProvided: boolean): string {
  const timedOut = result.signal === "TIMEOUT";
  return [
    "terminal=independent-shell",
    `cwd=${result.workingDirectory}`,
    `exitCode=${result.exitCode ?? "null"}`,
    result.signal ? `signal=${result.signal}` : null,
    `durationMs=${result.durationMs}`,
    inputProvided ? "stdin=provided" : null,
    result.stdout.trim() ? `stdout:\n${truncateText(result.stdout.trim(), 7000)}` : "stdout: (empty)",
    result.stderr.trim() ? `stderr:\n${truncateText(result.stderr.trim(), 5000)}` : "stderr: (empty)",
    timedOut
      ? "hint: The command timed out. If this program prompts for input, rerun runCommand with input containing newline-separated answers, for example input: \"answer1\\nanswer2\\n\". For reliable tests, prefer adding CLI arguments or a non-interactive test mode."
      : null
  ].filter(Boolean).join("\n");
}

export function specFromInstance(instance: InstanceWithNode): { id: string; name: string; type: string; workingDirectory: string; startCommand: string; stopCommand: string | null; restartPolicy: string; restartMaxRetries: number; restartPolicyCustom?: unknown } {
  return {
    id: instance.id,
    name: instance.name,
    type: instance.type,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    stopCommand: instance.stopCommand,
    restartPolicy: instance.restartPolicy,
    restartMaxRetries: instance.restartMaxRetries
  };
}

export function formatInstanceSummary(instance: InstanceWithNode): string {
  return [
    `id=${instance.id}`,
    `name=${instance.name}`,
    `node=${instance.node.name}`,
    instance.node.os ? `nodeOs=${instance.node.os}` : null,
    instance.node.arch ? `nodeArch=${instance.node.arch}` : null,
    `status=${instance.status}`,
    `workingDirectory=${instance.workingDirectory}`,
    `startCommand=${instance.startCommand}`,
    instance.stopCommand ? `stopCommand=${instance.stopCommand}` : null,
    `restartPolicy=${instance.restartPolicy}`,
    `lastExitCode=${instance.lastExitCode ?? "none"}`
  ]
    .filter(Boolean)
    .join("\n");
}

export function inferCommandEnvironment(instance: InstanceWithNode | null): {
  os: string;
  arch: string;
  daemonVersion: string;
  pathStyle: "windows" | "posix" | "unknown";
  shell: string;
  commandGuidance: string;
} {
  if (!instance) {
    return {
      os: "unknown",
      arch: "unknown",
      daemonVersion: "unknown",
      pathStyle: "unknown",
      shell: "unknown until an instance is selected",
      commandGuidance: "Select an instance before choosing OS-specific terminal commands."
    };
  }

  const os = trimString(instance.node.os) || "unknown";
  const arch = trimString(instance.node.arch) || "unknown";
  const daemonVersion = trimString(instance.node.version) || "unknown";
  const workingDirectory = instance.workingDirectory;
  const osProbe = `${os} ${workingDirectory}`.toLowerCase();
  const windowsPath = /^[a-z]:[\\/]/i.test(workingDirectory) || workingDirectory.includes("\\");
  const posixPath = workingDirectory.startsWith("/");
  const isWindows = windowsPath || /\bwindows|win32|windows_nt\b/i.test(osProbe);
  const isPosix = !isWindows && (posixPath || /\blinux|darwin|macos|unix|freebsd|ubuntu|debian|centos|alpine\b/i.test(osProbe));

  if (isWindows) {
    return {
      os,
      arch,
      daemonVersion,
      pathStyle: "windows",
      shell: "cmd.exe /d /s /c",
      commandGuidance:
        "Use Windows command syntax for runCommand: dir, type, copy, move, del, rmdir, where, and backslash-aware paths. Use PowerShell explicitly only when needed, e.g. powershell -NoProfile -Command \"...\"."
    };
  }

  if (isPosix) {
    return {
      os,
      arch,
      daemonVersion,
      pathStyle: "posix",
      shell: "$SHELL -lc or /bin/sh -lc",
      commandGuidance:
        "Use POSIX shell syntax for runCommand: ls, cat, cp, mv, rm, mkdir -p, grep, find, test, and forward-slash paths."
    };
  }

  return {
    os,
    arch,
    daemonVersion,
    pathStyle: "unknown",
    shell: "unknown",
    commandGuidance:
      "OS is unknown. Prefer cross-platform commands such as node -e or python scripts when available, or inspect the environment with a low-risk command before using OS-specific syntax."
  };
}

export function renderCommandEnvironment(instance: InstanceWithNode | null): string {
  const environment = inferCommandEnvironment(instance);
  return [
    `- Node OS: ${environment.os}`,
    `- Node architecture: ${environment.arch}`,
    `- Daemon version: ${environment.daemonVersion}`,
    `- Path style: ${environment.pathStyle}`,
    `- runCommand shell launcher: ${environment.shell}`,
    `- Command guidance: ${environment.commandGuidance}`
  ].join("\n");
}

export function stripThinking(text: string): string {
  const thinkTag = "think";
  const openRe = new RegExp(`<${thinkTag}>[\\s\\S]*?<\\/${thinkTag}>`, "gi");
  return text.replace(openRe, "").trim();
}

export type JsonSchema = Record<string, unknown>;

export interface SakiToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
  aliases?: string[];
}

export interface SakiModelToolTurn {
  content: string;
  toolCalls: ParsedToolCall[];
  forwardedDeltaText?: boolean;
  forwardedDeltaContent?: string;
}

export interface ParsedToolCall {
  id?: string;
  name: string;
  rawArgs?: string;
  args: any;
}

export interface SakiAgentRuntime {
  request: FastifyRequest;
  input: SakiChatRequest;
  context: ResolvedSakiContext;
  skills: SakiSkillSummary[];
  userId: string;
  permissions: PermissionCode[];
  config: SakiConfigResponse;
}

export interface SakiAgentResumeState {
  input: SakiChatRequest;
  skills: SakiAgentRuntime["skills"];
  actions: SakiAgentAction[];
  scratchpadEntries: string[];
  toolExecutions: number;
}

export type SakiWorkflowStatus = "running" | "completed" | "failed" | "pending";

export interface SakiWorkflowUpdate {
  id: string;
  stage: string;
  message: string;
  status: SakiWorkflowStatus;
  tool?: string;
  call?: string;
  actionId?: string;
  detail?: string;
}

export interface SakiAgentRunEvents {
  workflow?: (event: SakiWorkflowUpdate) => void;
  action?: (action: SakiAgentAction) => void;
  delta?: (text: string) => void;
  thinking?: (text: string) => void;
}

export type SakiCheckpoint =
  | {
      id: string;
      type: "file";
      instanceId: string;
      path: string;
      existed: boolean;
      content: string;
      actionId: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "softDelete";
      instanceId: string;
      path: string;
      backupPath: string;
      actionId: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "instanceSettings";
      instanceId: string;
      data: Prisma.InstanceUpdateInput;
      actionId: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "createdTask";
      taskId: string;
      actionId: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "updatedTask";
      taskId: string;
      data: UpdateScheduledTaskRequest;
      actionId: string;
      createdAt: string;
    }
  | {
      id: string;
      type: "instanceAction";
      instanceId: string;
      previousStatus: string;
      actionId: string;
      createdAt: string;
    };

export interface PendingSakiAction {
  id: string;
  call: ParsedToolCall;
  userId: string;
  contextInstanceId: string | null;
  createdAt: string;
  approval: NonNullable<SakiAgentAction["approval"]>;
  resume?: SakiAgentResumeState;
}

export type DirectChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DirectProviderMessage = {
  role: DirectChatMessage["role"];
  content: unknown;
  images?: string[];
};

export interface StreamingTextState {
  raw: string;
  emittedLength: number;
  thinkingEmittedLength: number;
  inThinkingBlock?: boolean;
}

export function createStreamingTextState(): StreamingTextState {
  return { raw: "", emittedLength: 0, thinkingEmittedLength: 0, inThinkingBlock: false };
}

export function streamingThinkingText(raw: string): string {
  const thinkTag = "think";
  const parts: string[] = [];
  const closedRe = new RegExp(`<${thinkTag}>([\\s\\S]*?)<\\/${thinkTag}>`, "gi");
  for (const match of raw.matchAll(closedRe)) {
    const body = (match[1] ?? "").trim();
    if (body) parts.push(body);
  }
  const remainder = raw.replace(closedRe, "");
  const openMatch = remainder.match(new RegExp(`<${thinkTag}>([\\s\\S]*)$`, "i"));
  if (openMatch) {
    const body = (openMatch[1] ?? "").trim();
    if (body) parts.push(body);
  }
  return parts.join("\n\n");
}

function emitStreamingThinkingDelta(state: StreamingTextState, raw: string, onThinking?: (text: string) => void): void {
  if (!onThinking) return;
  const thinking = streamingThinkingText(raw);
  if (thinking.length > state.thinkingEmittedLength) {
    onThinking(thinking.slice(state.thinkingEmittedLength));
    state.thinkingEmittedLength = thinking.length;
  }
}

export function stripUnstableThinkingSuffix(text: string): string {
  const tag = "think";
  const prefix = `<${tag}>`;
  const lower = text.toLowerCase();
  for (let length = Math.min(prefix.length - 1, text.length); length > 0; length -= 1) {
    if (prefix.toLowerCase().startsWith(lower.slice(-length))) {
      return text.slice(0, -length);
    }
  }
  return text;
}

export function visibleStreamingText(raw: string): string {
  const thinkTag = "think";
  const closedRe = new RegExp(`<${thinkTag}>[\\s\\S]*?<\\/${thinkTag}>`, "gi");
  const withoutClosedThinking = raw.replace(closedRe, "");
  const openRe = new RegExp(`<${thinkTag}>`, "i");
  const openThinking = withoutClosedThinking.search(openRe);
  const visible = openThinking >= 0 ? withoutClosedThinking.slice(0, openThinking) : withoutClosedThinking;
  return stripUnstableThinkingSuffix(visible);
}

export function pushStreamingTextDelta(
  state: StreamingTextState,
  chunk: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void,
  thinkingChunk?: string
): void {
  if (thinkingChunk) {
    if (!state.inThinkingBlock) {
      state.raw += "<think>";
      state.inThinkingBlock = true;
    }
    state.raw += thinkingChunk;
  }
  if (chunk) {
    if (state.inThinkingBlock) {
      state.raw += "</think>";
      state.inThinkingBlock = false;
    }
    state.raw += chunk;
  }
  emitStreamingThinkingDelta(state, state.raw, onThinking);
  const visible = visibleStreamingText(state.raw);
  if (visible.length > state.emittedLength) {
    onDelta(visible.slice(state.emittedLength));
  }
  state.emittedLength = Math.max(state.emittedLength, visible.length);
}

export function flushStreamingTextState(
  state: StreamingTextState,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): void {
  if (state.inThinkingBlock) {
    state.raw += "</think>";
    state.inThinkingBlock = false;
  }
  emitStreamingThinkingDelta(state, state.raw, onThinking);
  const visible = visibleStreamingText(state.raw);
  if (visible.length > state.emittedLength) {
    onDelta(visible.slice(state.emittedLength));
    state.emittedLength = visible.length;
  }
}

export interface SakiSkillDocument {
  id: string;
  name: string;
  description?: string;
  content: string;
  enabled?: boolean;
  sourceType?: string;
  sourceUrl?: string | null;
  tags?: string[];
  updatedAt?: string | null;
  tokenEstimate?: number;
  builtin?: boolean;
  filePath: string;
}

export interface SakiSkillDetail {
  id: string;
  name: string;
  description?: string;
  content: string;
  enabled?: boolean;
  sourceType?: string;
  sourceUrl?: string | null;
  tags?: string[];
  updatedAt?: string | null;
  tokenEstimate?: number;
  builtin?: boolean;
}

export interface BuiltinSakiSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
}

export interface WebPageSnapshot {
  url: string;
  title: string;
  content: string;
  links: string[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface PreparedSakiChatInvocation {
  input: SakiChatRequest;
  modelInput: SakiChatRequest;
  context: ResolvedSakiContext;
  skills: SakiSkillSummary[];
}

export interface SakiStreamWriter {
  send: (type: string, payload?: Record<string, unknown>) => void;
  end: () => void;
}

export interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

export interface GitHubAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

export interface CopilotDeviceLoginSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  polling?: Promise<void>;
}

export const providerDefaults: Record<string, { label: string; baseUrl: string }> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  zhipu: { label: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  minimax: { label: "MiniMax", baseUrl: "https://api.minimaxi.com/v1" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  moonshot: { label: "Moonshot AI", baseUrl: "https://api.moonshot.cn/v1" },
  tongyi: { label: "Alibaba Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  doubao: { label: "Doubao Ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  custom: { label: "Custom API", baseUrl: "" }
};

export const localProviderUrls = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234"
};

export const knownProviderIds = ["ollama", "lmstudio", "copilot", ...Object.keys(providerDefaults)];

export const defaultPanelAppearance: PanelAppearanceSettings = {
  appTitle: "Saki Panel",
  sidebarTitle: "Saki Panel",
  appSubtitle: "System Administration",
  appLogoSrc: "/assets/saki-panel-icon.png",
  sidebarLogoSrc: "/assets/saki-panel-icon.png",
  loginCoverSrc: "/assets/cover.png",
  backgroundSrc: "/assets/background.png",
  mobileBackgroundSrc: "/assets/background_mobile.png"
};

export const maxAppearanceTextChars = 120;
export const maxAppearanceImageSrcChars = 15_000_000;
export const maxSakiInputAttachments = 6;
export const maxSakiAttachmentTextChars = 18000;
export const maxSakiAttachmentDataUrlChars = 4_000_000;
export const maxAgentConsoleInputChars = 16000;
export const sakiSkillFileName = "SKILL.md";
export const maxSakiSkillContentChars = 60000;
export const maxAgentSkillContentChars = 14000;
export const maxAutoAppliedSakiSkills = 3;
export const maxAutoAppliedSkillContextChars = 24000;
export const maxAgentSkillSearchResults = 20;
export const autoApplySkillScoreThreshold = 5;
export const suggestSkillScoreThreshold = 3;
export const webUserAgent = "Saki-Panel-Agent/0.2 (+https://saki-panel.local/saki)";

export const copilotMissingTokenMessage = "\u8BF7\u5148\u70B9\u51FB\u767B\u5F55 GitHub \u5B8C\u6210\u6388\u6743\u3002";
export const copilotClassicTokenMessage =
  "\u5F53\u524D\u4FDD\u5B58\u7684\u662F Personal access tokens (classic)\u3002GitHub Copilot SDK \u9700\u8981 Fine-grained personal access token\uFF0C\u5E76\u5728 Permissions \u4E2D\u6DFB\u52A0 Copilot Requests\uFF1Bclassic PAT \u65E0\u6CD5\u8BA4\u8BC1\u3002";
export const githubDeviceCodeUrl = "https://github.com/login/device/code";
export const githubAccessTokenUrl = "https://github.com/login/oauth/access_token";
export const githubDeviceGrantType = "urn:ietf:params:oauth:grant-type:device_code";

export function normalizeProviderId(value: unknown): string {
  const normalized = trimString(value).toLowerCase();
  if (!normalized) return "ollama";
  return normalized === "github" ? "copilot" : normalized;
}

export function isLocalProviderId(provider: string): boolean {
  return provider === "ollama" || provider === "lmstudio";
}

export function needsCloudApiConfig(provider: string): boolean {
  return !isLocalProviderId(provider) && provider !== "copilot";
}

export function defaultLocalProviderUrl(provider: string): string {
  return isLocalProviderId(provider) ? localProviderUrls[provider as keyof typeof localProviderUrls] : "";
}

export function normalizeHttpBaseUrl(value: string, fallback: string): string {
  const raw = trimString(value) || fallback;
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProtocol
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/messages$/i, "")
    .replace(/\/models$/i, "");
}

export function openAiBaseUrl(value: string, fallback: string): string {
  const baseUrl = normalizeHttpBaseUrl(value, fallback);
  if (!baseUrl) return "";
  return /\/v\d+(?:beta)?(?:\/openai)?$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
}

export function providerBaseUrl(provider: string, config: { baseUrl: string; ollamaUrl: string }): string {
  if (provider === "lmstudio") {
    return openAiBaseUrl(config.ollamaUrl, localProviderUrls.lmstudio);
  }
  if (provider === "anthropic") {
    return normalizeHttpBaseUrl(config.baseUrl, providerDefaults.anthropic?.baseUrl ?? "https://api.anthropic.com/v1");
  }
  return openAiBaseUrl(config.baseUrl, providerDefaults[provider]?.baseUrl ?? "");
}

export function errorMessageFromJson(payload: unknown): string {
  const item = objectValue(payload);
  if (!item) return "";
  const error = objectValue(item.error);
  return (
    trimString(error?.message) ||
    trimString(error?.error) ||
    trimString(item.message) ||
    trimString(item.error) ||
    trimString(item.detail)
  );
}

export function compactDebugText(value: string, maxLength = 220): string {
  const normalized = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function sakiVerboseModelLogsEnabled(): boolean {
  const value = (process.env.SAKI_DEBUG ?? process.env.SAKI_MODEL_DEBUG ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "verbose"].includes(value) || ["debug", "trace"].includes((process.env.LOG_LEVEL ?? "").toLowerCase());
}

export function safeModelLogUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|password/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return value.replace(/([?&](?:key|token|secret|password)=)[^&]+/gi, "$1[redacted]");
  }
}

export function logSakiModelEvent(event: string, details: Record<string, unknown>): void {
  const cleaned = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
  console.info(`[Saki model] ${event} ${JSON.stringify(cleaned)}`);
}

export function chatTextFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        const item = objectValue(part);
        return trimString(item?.text) || trimString(item?.content);
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

export function actionId(): string {
  return `saki_action_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function checkpointId(): string {
  return `saki_checkpoint_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function checkpointPathSegment(value: string): string {
  const safe = value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 96);
  return safe || randomUUID().slice(0, 8);
}

export function formatToolArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2);
}

export function truncateDiff(value: string): string {
  return value.length > 12000 ? `${value.slice(0, 12000)}\n... [diff truncated]` : value;
}

export function trimContextText(value: unknown): string {
  const text = trimString(value);
  return text.length > 12000 ? `${text.slice(0, 12000)}\n...(context truncated)` : text;
}

export function normalizeTimeout(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(5000, Math.min(Math.floor(value), 600000));
}

export function agentModelConfig(config: any): any {
  return {
    ...config,
    requestTimeoutMs: Math.max(config.requestTimeoutMs, minAgentModelRequestTimeoutMs)
  };
}

export function sakiPermissionModeLabel(mode: SakiAgentPermissionMode): string {
  if (mode === "ask") return "Ask permissions";
  if (mode === "plan") return "Plan mode";
  if (mode === "bypassPermissions") return "Bypass permissions";
  return "Auto accept edits";
}

export function sakiPermissionModeBehavior(mode: SakiAgentPermissionMode): string {
  if (mode === "ask") {
    return "Ask before file edits, terminal input, commands, task changes, instance state changes, and settings changes. Read-only inspection can run immediately.";
  }
  if (mode === "plan") {
    return "Explore with read-only tools and low-risk inspection commands, then propose a concrete plan. Do not edit files or change state.";
  }
  if (mode === "bypassPermissions") {
    return "Run allowed tools without approval prompts. Still obey user permissions and hard safety blocks for critical commands or sensitive paths.";
  }
  return "Automatically accept file edits and common file operations. Ask before terminal commands, raw console input, instance state changes, deletes, task changes, and settings changes.";
}

export function consoleInputPreview(data: string, limit = 200): string {
  if (data === "\u0003") return "^C";
  return data.replace(/\r/g, "").replace(/\n$/, "").slice(0, limit);
}

export function isProbablyAbsoluteRemotePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value);
}

export function normalizeCommandRelativeCwd(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized || normalized === ".") return "";
  if (isProbablyAbsoluteRemotePath(normalized)) {
    throw new RouteError("runCommand cwd must be relative to the selected instance working directory.", 400);
  }
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new RouteError("runCommand cwd cannot contain '..'.", 400);
  }
  return parts.join("/");
}

export function joinRemoteWorkingDirectory(root: string, relativeCwd: string): string {
  const base = root.trim();
  if (!relativeCwd) return base;
  const separator = /^[A-Za-z]:[\\/]/.test(base) || base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${relativeCwd.split("/").join(separator)}`;
}

export function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

export function stripHtml(value: string): string {
  return htmlDecode(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function sanitizeAppearanceText(value: unknown, fallback: string, maxChars = maxAppearanceTextChars): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxChars);
}

export function sanitizeAppearanceImageSrc(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  const source = trimString(value);
  if (!source) return fallback;
  if (source.length > maxAppearanceImageSrcChars) {
    throw new RouteError("Appearance image is too large.", 400);
  }
  if (
    /^https?:\/\//i.test(source) ||
    (source.startsWith("/") && !source.startsWith("//")) ||
    /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(source)
  ) {
    return source;
  }
  throw new RouteError("Appearance images must be a relative path, http(s) URL, or image data URL.", 400);
}

export function sanitizePanelAppearance(
  value: unknown,
  fallback: PanelAppearanceSettings = defaultPanelAppearance
): PanelAppearanceSettings {
  const item = objectValue(value) ?? {};
  return {
    appTitle: sanitizeAppearanceText(item.appTitle, fallback.appTitle, 80) || defaultPanelAppearance.appTitle,
    sidebarTitle: sanitizeAppearanceText(item.sidebarTitle, fallback.sidebarTitle, 80) || defaultPanelAppearance.sidebarTitle,
    appSubtitle: sanitizeAppearanceText(item.appSubtitle, fallback.appSubtitle),
    appLogoSrc: sanitizeAppearanceImageSrc(item.appLogoSrc, fallback.appLogoSrc),
    sidebarLogoSrc: sanitizeAppearanceImageSrc(item.sidebarLogoSrc, fallback.sidebarLogoSrc),
    loginCoverSrc: sanitizeAppearanceImageSrc(item.loginCoverSrc, fallback.loginCoverSrc),
    backgroundSrc: sanitizeAppearanceImageSrc(item.backgroundSrc, fallback.backgroundSrc),
    mobileBackgroundSrc: sanitizeAppearanceImageSrc(item.mobileBackgroundSrc, fallback.mobileBackgroundSrc)
  };
}

export function positiveNumber(value: unknown, max: number): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.round(number), max) : undefined;
}

export function sanitizeSakiAttachmentKind(value: unknown): SakiInputAttachment["kind"] {
  return value === "image" || value === "screenshot" ? value : "file";
}

export function sanitizeSakiInputAttachments(value: unknown): SakiInputAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxSakiInputAttachments)
    .map((raw): SakiInputAttachment | null => {
      const item = objectValue(raw);
      if (!item) return null;
      const name = trimString(item.name).slice(0, 180) || "attachment";
      const kind = sanitizeSakiAttachmentKind(item.kind);
      const attachment: SakiInputAttachment = { kind, name };
      const id = trimString(item.id).slice(0, 120);
      const mimeType = trimString(item.mimeType).slice(0, 120);
      const text = typeof item.text === "string" ? item.text : null;
      const dataUrl = trimString(item.dataUrl);
      const capturedAt = trimString(item.capturedAt).slice(0, 80);
      const size = positiveNumber(item.size, 32 * 1024 * 1024);
      const width = positiveNumber(item.width, 20000);
      const height = positiveNumber(item.height, 20000);

      if (id) attachment.id = id;
      if (mimeType) attachment.mimeType = mimeType;
      if (size) attachment.size = size;
      if (width) attachment.width = width;
      if (height) attachment.height = height;
      if (capturedAt) attachment.capturedAt = capturedAt;
      if (text !== null) attachment.text = text.length > maxSakiAttachmentTextChars ? `${text.slice(0, maxSakiAttachmentTextChars)}\n...(attachment text truncated)` : text;
      if (dataUrl.startsWith("data:image/") && dataUrl.length <= maxSakiAttachmentDataUrlChars) attachment.dataUrl = dataUrl;
      return attachment;
    })
    .filter((attachment): attachment is SakiInputAttachment => Boolean(attachment));
}

export function sakiAttachmentKindLabel(kind: SakiInputAttachment["kind"]): string {
  if (kind === "screenshot") return "screenshot";
  if (kind === "image") return "image";
  return "file";
}

export function renderSakiAttachmentContext(attachments: readonly SakiInputAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .map((attachment, index) => {
      const metadata = [
        `#${index + 1} ${attachment.name}`,
        `kind=${sakiAttachmentKindLabel(attachment.kind)}`,
        `mime=${attachment.mimeType ?? "unknown"}`,
        `size=${attachment.size ?? "unknown"}`,
        attachment.width && attachment.height ? `dimensions=${attachment.width}x${attachment.height}` : "",
        attachment.capturedAt ? `capturedAt=${attachment.capturedAt}` : ""
      ].filter(Boolean);
      const text = typeof attachment.text === "string"
        ? `\nContent:\n\`\`\`text\n${attachment.text.trimEnd()}\n\`\`\``
        : attachment.dataUrl
          ? "\nImage data is attached as a vision input when the configured model/provider supports images."
          : "\nBinary or non-text content was attached, but no text preview is available.";
      return `${metadata.join("\n")}${text}`;
    })
    .join("\n\n");
}

export function combinedSakiContextText(input: SakiChatRequest): string {
  return [input.contextText?.trim(), renderSakiAttachmentContext(input.attachments)].filter(Boolean).join("\n\n");
}

export function imageDataFromAttachment(attachment: SakiInputAttachment): { dataUrl: string; mimeType: string; base64: string } | null {
  const dataUrl = trimString(attachment.dataUrl);
  if (!dataUrl.startsWith("data:image/")) return null;
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    dataUrl,
    mimeType: match[1] || attachment.mimeType || "image/webp",
    base64: match[2] || ""
  };
}

export function imageAttachments(input: SakiChatRequest): Array<{ dataUrl: string; mimeType: string; base64: string }> {
  return (input.attachments ?? [])
    .map(imageDataFromAttachment)
    .filter((attachment): attachment is { dataUrl: string; mimeType: string; base64: string } => Boolean(attachment));
}

export function isLikelyChatModel(modelId: string): boolean {
  return !/\b(embed(ding)?|whisper|tts|speech|transcription|translation|moderation|rerank)\b|dall-e|gpt-image|glm-image|cogview|stable-diffusion|sdxl/i.test(modelId);
}

export function modelOptionFromItem(provider: string, raw: unknown): SakiModelOption | null {
  const item = objectValue(raw);
  const id =
    typeof raw === "string"
      ? raw.trim()
      : trimString(item?.id) || trimString(item?.name) || trimString(item?.model) || trimString(item?.model_id);
  if (!id || !isLikelyChatModel(id)) return null;
  return {
    provider,
    id,
    name: id,
    label: typeof raw === "string" ? id : trimString(item?.label) || trimString(item?.name) || id,
    vendor: typeof raw === "string" ? "" : trimString(item?.owned_by) || trimString(item?.vendor)
  };
}

export function uniqueModels(models: SakiModelOption[]): SakiModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = `${model.provider}:${model.id}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function collectModelItems(payload: unknown): unknown[] {
  const item = objectValue(payload);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(item?.data)) return item.data;
  if (Array.isArray(item?.models)) return item.models;
  if (Array.isArray(item?.result)) return item.result;
  return [];
}

export function defaultProviderConfig(provider: string): SakiProviderConfig {
  const providerId = normalizeProviderId(provider);
  if (providerId === "ollama") {
    return {
      model: "llama3",
      ollamaUrl: localProviderUrls.ollama
    };
  }
  if (providerId === "lmstudio") {
    return {
      model: "",
      ollamaUrl: localProviderUrls.lmstudio
    };
  }
  return {
    model: "",
    baseUrl: providerDefaults[providerId]?.baseUrl ?? "",
    apiKey: ""
  };
}

export function sanitizeProviderConfig(provider: string, value: unknown): SakiProviderConfig {
  const providerId = normalizeProviderId(provider);
  const item = objectValue(value) ?? {};
  const defaults = defaultProviderConfig(providerId);
  const next: SakiProviderConfig = { ...defaults };

  if ("model" in item) {
    next.model = trimString(item.model);
  }
  if (isLocalProviderId(providerId)) {
    if ("ollamaUrl" in item || "baseUrl" in item) {
      next.ollamaUrl = trimString(item.ollamaUrl) || trimString(item.baseUrl) || trimString(defaults.ollamaUrl) || defaultLocalProviderUrl(providerId);
    }
    delete next.baseUrl;
    delete next.apiKey;
    return next;
  }

  if ("baseUrl" in item) {
    next.baseUrl = trimString(item.baseUrl);
  }
  if ("apiKey" in item) {
    next.apiKey = trimString(item.apiKey);
  }
  return next;
}

export function providerConfigFor(configs: Record<string, SakiProviderConfig>, provider: string): SakiProviderConfig {
  const providerId = normalizeProviderId(provider);
  return configs[providerId] ?? defaultProviderConfig(providerId);
}

export function uniqueSkills(skills: SakiSkillSummary[]): SakiSkillSummary[] {
  const seen = new Set<string>();
  const result: SakiSkillSummary[] = [];
  for (const skill of skills) {
    const key = skill.id || skill.name;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(skill);
  }
  return result;
}

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) {
      throw new RequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await (await import("node:fs/promises")).readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  const fs = await import("node:fs/promises");
  const pathModule = await import("node:path");
  await fs.mkdir(pathModule.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}