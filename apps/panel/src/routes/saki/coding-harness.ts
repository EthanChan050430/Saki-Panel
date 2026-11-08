import type { SakiCodingPlan } from "./types.js";
import { parseWorkspacePatch } from "./patch.js";

export type SakiSlashIntent = "default" | "review" | "compact" | "diff";
export type SubagentRole = "explore" | "implement" | "review";

const codingPattern = /\b(?:fix|bug|implement|refactor|patch|edit|type error|compile error|lint)\b|修复|实现|重构|改代码|类型错误|编译错误|补丁|函数|接口|组件/;
const opsPattern = /\b(?:restart|start|stop|kill|crash|logs)\b|重启|启动|停止|崩溃|日志/;
const writeTools = new Set(["applypatch", "writefile", "editlines", "replaceinfile", "batchedit"]);
const pathWriteTools = new Set([
  ...writeTools, "deletepath", "renamepath", "mkdir", "uploadbase64", "archivepaths", "extractarchive", "generateimage"
]);
const implementDeniedTools = new Set([
  "runcommand", "runinshell", "createshell", "sendshellinput", "runservercommand",
  "sendinput", "sendcommand", "runtask", "instanceaction", "spawntask", "diagnosecode", "callmcptool",
  "updateinstancesettings", "createscheduledtask", "updatescheduledtask", "deletescheduledtask", "writememory",
  "archivepaths", "extractarchive"
]);
const normalizeToolId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const codingTools = new Set([
  "requestExternalAccess",
  "listFiles", "readFile", "searchFiles", "findFiles", "outlineFile", "readSymbol", "findSymbols", "statFile",
  "applyPatch", "writeFile", "runCommand",
  "gitStatus", "gitDiff",
  "searchSkills", "readSkill",
  "manageTodos", "askUser", "spawnTask", "reportProgress", "respond"
]);
const reviewTools = new Set([
  "requestExternalAccess",
  "listFiles", "readFile", "searchFiles", "findFiles", "outlineFile", "readSymbol", "findSymbols", "statFile",
  "gitStatus", "gitDiff", "searchSkills", "readSkill", "askUser", "reportProgress", "respond"
]);
const reviewAllowedIds = new Set([...reviewTools].map(normalizeToolId));
const instanceTools = new Set(["describeInstance", "instanceAction", "instanceLogs"]);
const webTools = new Set(["searchWeb", "browse"]);

export function isCodingTask(text: string): boolean {
  return codingPattern.test(text);
}

/** Only apply the edit handoff to concrete workspace change requests. */
export function workspaceEditRequest(text: string): boolean | undefined {
  if (/不要(?:修改|改动|写入|动代码)|不(?:修改|改动)文件|只(?:查看|检查|分析|审查)|仅(?:查看|检查|分析|审查)|\b(?:read.only|do not (?:edit|modify)|review only|analysis only)\b/i.test(text)) return false;
  if (/修复|重构|改代码|修改(?:代码|文件|配置|插件|脚本)|新增(?:代码|文件|插件|脚本|功能)|\b(?:fix|implement|refactor|patch|edit)\b/i.test(text)) return true;
  if (/(?:插件|脚本|代码|模块)[\s\S]{0,260}(?:应该|需要|要求|改成)[\s\S]{0,80}(?:监测|检测|支持|实现|新增|接入)/.test(text)) return true;
  return undefined;
}

export function needsInstanceOpsTools(text: string): boolean {
  return opsPattern.test(text);
}

export function normalizeAgentIntent(value: unknown): SakiSlashIntent {
  return value === "review" || value === "diff" || value === "compact" ? value : "default";
}

export function narrowCodingAdvertisedNames(
  names: Set<string>,
  hint: string,
  runtime: { kind?: string; input?: { message?: string; agentIntent?: string }; usedToolNames?: string[] }
): Set<string> {
  if (runtime.kind === "watch") return new Set(names);
  const used = new Set((runtime.usedToolNames ?? []).map(name => name.toLowerCase()));
  const intent = normalizeAgentIntent(runtime.input?.agentIntent);
  if (intent === "review" || intent === "diff") {
    const next = new Set<string>();
    for (const name of names) {
      if (reviewTools.has(name)) next.add(name);
    }
    return next;
  }
  const message = `${runtime.input?.message ?? ""}\n${hint}`;
  if (!isCodingTask(message)) return new Set(names);
  const allowInstance = needsInstanceOpsTools(message);
  const allowWeb = /searchweb|browse|联网|查一下网上|search the web/i.test(hint);
  const next = new Set<string>();
  for (const name of names) {
    if (used.has(name.toLowerCase()) || codingTools.has(name) || (allowInstance && instanceTools.has(name)) || (allowWeb && webTools.has(name))) next.add(name);
  }
  return next;
}

export function parseSakiSlashCommand(message: string): { intent: SakiSlashIntent; rest: string } | null {
  const match = message.trim().match(/^\/(diff|compact|review)\b\s*([\s\S]*)$/i);
  const command = match?.[1]?.toLowerCase();
  const rest = match?.[2]?.trim();
  if (!command || rest === undefined) return null;
  const intent: SakiSlashIntent = command === "diff" ? "diff" : command === "compact" ? "compact" : "review";
  return { intent, rest };
}

export function applySakiSlashCommand(message: string): { message: string; intent: SakiSlashIntent } {
  const parsed = parseSakiSlashCommand(message);
  if (!parsed) return { message, intent: "default" };
  if (parsed.intent === "diff") {
    return { intent: "diff", message: `Review the current git diff and summarize it. Do not edit files.${parsed.rest ? `\nFocus: ${parsed.rest}` : ""}` };
  }
  if (parsed.intent === "compact") {
    return { intent: "compact", message: parsed.rest ? `Compact the current task context, then continue: ${parsed.rest}` : "Compact the current task context and continue the unfinished step." };
  }
  return { intent: "review", message: `Review the selected code and report findings with file paths. Do not edit files.${parsed.rest ? `\nFocus: ${parsed.rest}` : ""}` };
}

export interface SakiHarnessEditorContext {
  activeFile?: string;
  openFiles?: string[];
  selection?: string;
  diagnostics?: string[];
}

function cleanEditorPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/\\/g, "/");
  if (!text || text.length > 240 || text.split("/").includes("..") || text.startsWith("/") || /^[a-z]:/i.test(text)) return "";
  return text;
}

export function sanitizeEditorContext(value: unknown): SakiHarnessEditorContext | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const activeFile = cleanEditorPath(raw.activeFile);
  const openFiles = Array.isArray(raw.openFiles) ? raw.openFiles.map(cleanEditorPath).filter(Boolean).slice(0, 12) : [];
  const selection = typeof raw.selection === "string" ? raw.selection.trim().slice(0, 4000) : "";
  const diagnostics = Array.isArray(raw.diagnostics)
    ? raw.diagnostics.filter((item): item is string => typeof item === "string").map(item => item.trim().slice(0, 500)).filter(Boolean).slice(0, 20)
    : [];
  if (!activeFile && !openFiles.length && !selection && !diagnostics.length) return null;
  return {
    ...(activeFile ? { activeFile } : {}),
    ...(openFiles.length ? { openFiles } : {}),
    ...(selection ? { selection } : {}),
    ...(diagnostics.length ? { diagnostics } : {})
  };
}

export function formatEditorContext(context: SakiHarnessEditorContext | null): string {
  if (!context) return "";
  const lines = ["Editor context:"];
  if (context.activeFile) lines.push(`Active file: ${context.activeFile}`);
  if (context.openFiles?.length) lines.push(`Open files: ${context.openFiles.join(", ")}`);
  if (context.selection) lines.push(`Selection:\n${context.selection}`);
  if (context.diagnostics?.length) lines.push(`Diagnostics:\n${context.diagnostics.join("\n")}`);
  return lines.join("\n");
}

export function filesFromPlanText(text: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:^|[\s`'"(])([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)(?=$|[\s`'",:;)\]])/g;
  for (const match of text.matchAll(pattern)) {
    const file = match[1]?.replace(/\\/g, "/").replace(/^\.\//, "") ?? "";
    if (!file || file.includes("..") || file.startsWith("/") || /^https?:/i.test(file)) continue;
    found.add(file);
  }
  return [...found];
}

export function codingPlanFromMessage(message: string, now = Date.now()): SakiCodingPlan {
  return { text: message.slice(0, 8000), files: filesFromPlanText(message), updatedAt: now };
}

export function formatPlanArtifact(plan: SakiCodingPlan | null | undefined): string {
  if (!plan?.text) return "";
  const files = plan.files.length ? `\nPlanned files: ${plan.files.join(", ")}` : "";
  return `Approved plan:\n${plan.text}${files}`;
}

export function editedPathsFromTool(toolName: string, args: Record<string, unknown>, observation = ""): string[] {
  const tool = normalizeToolId(toolName);
  if (!pathWriteTools.has(tool)) return [];
  const found = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const path = value.trim().replace(/\\/g, "/");
    if (path && !path.split("/").includes("..")) found.add(path);
  };
  add(args.path);
  add(args.filePath);
  add(args.fromPath);
  add(args.toPath);
  add(args.oldPath);
  add(args.newPath);
  add(args.outputPath);
  if (Array.isArray(args.paths)) args.paths.forEach(add);
  if (Array.isArray(args.edits)) {
    for (const edit of args.edits) {
      if (edit && typeof edit === "object") add((edit as { path?: unknown }).path);
    }
  }
  const patch = typeof args.patch === "string" ? args.patch : "";
  if (tool === "applypatch" && patch) {
    for (const file of parseWorkspacePatch(patch)) add(file.path);
  }
  for (const source of [patch, observation]) {
    for (const match of source.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g)) add(match[1]?.trim());
  }
  return [...found];
}

export function assertImplementWritePaths(toolName: string, allowed: string[], paths: string[]): void {
  const tool = normalizeToolId(toolName);
  if (implementDeniedTools.has(tool)) throw new Error(`Implement sub-agent cannot use ${toolName}; it may only edit files named in the parent plan.`);
  if (!pathWriteTools.has(tool)) return;
  if (!allowed.length) throw new Error("Implement sub-agent cannot write because the parent plan names no files.");
  if (!paths.length) throw new Error("Implement sub-agent cannot write because the patch did not name a file in the parent plan.");
  for (const file of paths) {
    if (!allowed.some(planned => samePlannedFile(planned, file))) {
      throw new Error(`Implement sub-agent cannot write ${file}; it is not named in the parent plan.`);
    }
  }
}

function samePlannedFile(planned: string, actual: string): boolean {
  const clean = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const left = clean(planned);
  const right = clean(actual);
  if (left === right) return true;
  const isAbsolute = (value: string) => value.startsWith("/") || /^[a-z]:\//.test(value);
  return (isAbsolute(left) && !isAbsolute(right) && left.endsWith(`/${right}`))
    || (isAbsolute(right) && !isAbsolute(left) && right.endsWith(`/${left}`));
}

export function reviewIntentBlocksTool(runtime: { kind?: string; input?: { agentIntent?: string } }, toolName: string): boolean {
  if (runtime.kind === "watch") return false;
  const intent = runtime.input?.agentIntent;
  if (intent !== "review" && intent !== "diff") return false;
  return !reviewAllowedIds.has(normalizeToolId(toolName));
}

export function formatDiagnosticObservation(command: string, exitCode: number | null, output: string): string {
  const body = output.trim().slice(0, 4000) || "(no output)";
  if (exitCode === 0) return `Automatic diagnostics passed: ${command}\n${body}`;
  return `Automatic diagnostics failed: ${command} (exit ${exitCode ?? "unknown"}). This blocks completion until a later verification succeeds.\n${body}`;
}

export interface ChangeGroup {
  path: string;
  kind: "edit" | "create" | "delete";
}

export function groupChangeset(actions: Array<{ tool?: string; args?: Record<string, unknown>; observation?: string; ok?: boolean }>): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const action of actions) {
    if (action.ok === false) continue;
    const tool = String(action.tool ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!writeTools.has(tool)) continue;
    const kind: ChangeGroup["kind"] = /deleted/i.test(action.observation ?? "") ? "delete" : /created|added/i.test(action.observation ?? "") || tool === "writefile" ? "create" : "edit";
    for (const path of editedPathsFromTool(tool, action.args ?? {}, action.observation ?? "")) {
      groups.set(path, { path, kind });
    }
  }
  return [...groups.values()];
}

export function suggestedCommitMessage(groups: ChangeGroup[]): string {
  if (!groups.length) return "";
  const files = groups.slice(0, 3).map(group => group.path).join(", ");
  return `Update ${files}${groups.length > 3 ? ` and ${groups.length - 3} more` : ""}`;
}

export function buildProgressSummary(input: { goal?: string; actions?: Array<{ tool?: string; args?: Record<string, unknown>; observation?: string; ok?: boolean }>; constraints?: string[] }): string {
  const groups = groupChangeset(input.actions ?? []);
  const lines = ["[Progress]"];
  if (input.goal) lines.push(`Goal: ${input.goal.slice(0, 500)}`);
  if (input.constraints?.length) lines.push(`Constraints: ${input.constraints.slice(0, 6).join("; ").slice(0, 500)}`);
  if (groups.length) {
    lines.push(`Changes: ${groups.map(group => `${group.kind} ${group.path}`).join("; ").slice(0, 1200)}`);
    const message = suggestedCommitMessage(groups);
    if (message) lines.push(`Suggested commit message (do not commit unless asked): ${message}`);
  } else {
    lines.push("Changes: none recorded.");
  }
  const failed = (input.actions ?? []).filter(action => action.ok === false).slice(-3);
  if (failed.length) lines.push(`Recent failures: ${failed.map(action => action.tool).join(", ")}`);
  return lines.join("\n");
}

export function progressPrefaceFromMessages(messages: Array<{ role?: string; content?: string }>, goal = ""): string {
  const constraints = messages
    .filter(message => message.role === "user")
    .map(message => message.content ?? "")
    .filter(content => /do not|don't|不要|禁止|only /i.test(content))
    .slice(0, 4);
  const files = new Set<string>();
  for (const message of messages) {
    for (const match of (message.content ?? "").matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g)) {
      const file = match[1]?.trim();
      if (file) files.add(file);
    }
  }
  const preface = buildProgressSummary({ goal, constraints, actions: [...files].map(path => ({ tool: "applyPatch", ok: true, observation: `*** Update File: ${path}` })) });
  return preface;
}

export function subagentRole(value: unknown): SubagentRole {
  return value === "implement" || value === "review" ? value : "explore";
}

export function subagentRolePrompt(role: SubagentRole, task: string, maxSteps: number): string {
  if (role === "implement") {
    return `You are an implement sub-agent. You may edit only files named in the parent plan, using applyPatch for existing files and writeFile for new files. Do not spawn sub-agents. Stop after ${maxSteps} steps.\n\nTask: ${task}`;
  }
  if (role === "review") {
    return `You are a review sub-agent. Inspect and report findings with file paths. Do not edit, run commands, diagnose, or spawn sub-agents. Stop after ${maxSteps} steps.\n\nTask: ${task}`;
  }
  return `You are an explore sub-agent. Inspect and report file paths. Do not edit, diagnose, or spawn sub-agents. Stop after ${maxSteps} steps.\n\nTask: ${task}`;
}

export interface SandboxCapability {
  enabled: boolean;
  binary: string;
  note: string;
}

export function sandboxCapability(nodeOs?: string | null): SandboxCapability {
  const binary = (process.env.SAKI_OS_SANDBOX_BIN || "bwrap").trim() || "bwrap";
  const enabled = process.env.SAKI_OS_SANDBOX === "1" && Boolean(nodeOs) && !/windows/i.test(nodeOs ?? "");
  const note = enabled
    ? `OS sandbox is enabled for runCommand via ${binary}. It is not a permission bypass.`
    : "Path checks and bypassPermissions are not an OS sandbox. OS sandboxing is off unless the node is non-Windows and SAKI_OS_SANDBOX=1.";
  return { enabled, binary, note };
}

export function wrapCommandForSandbox(command: string, workspaceDir: string, nodeOs?: string | null): { command: string; wrapped: boolean } {
  const capability = sandboxCapability(nodeOs);
  const trimmed = command.trim();
  if (!capability.enabled || !trimmed) return { command, wrapped: false };
  const quote = (value: string) => value.replace(/'/g, `'\\''`);
  return {
    wrapped: true,
    command: `${capability.binary} --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --unshare-pid --unshare-ipc --die-with-parent --bind '${quote(workspaceDir)}' '${quote(workspaceDir)}' --chdir '${quote(workspaceDir)}' -- sh -c '${quote(trimmed)}'`
  };
}

export function assertLoopbackHealthUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Health URL is not a valid URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Health URL must be http(s).");
  if (url.username || url.password) throw new Error("Health URL must not contain credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") throw new Error("Health URL must stay on loopback.");
  return url;
}

export async function fetchLoopbackHealth(url: string | null | undefined, timeoutMs = 3000): Promise<{ checked: boolean; ok: boolean; status?: number; note: string }> {
  if (!url) return { checked: false, ok: false, note: "No loopback health URL is configured." };
  let parsed: URL;
  try { parsed = assertLoopbackHealthUrl(url); }
  catch (error) { return { checked: false, ok: false, note: error instanceof Error ? error.message : String(error) }; }
  const timeout = Math.min(10_000, Math.max(500, timeoutMs || 3000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: "error" });
    return { checked: true, ok: response.ok, status: response.status, note: response.ok ? "ok" : `HTTP ${response.status}` };
  } catch (error) {
    return { checked: true, ok: false, note: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
