import path from "node:path";
import { createPatch } from "diff";
import { applyPatchToContent, parseWorkspacePatch, patchHunkStartLine } from "./patch.js";
import type { CreateScheduledTaskRequest, PermissionCode, SakiAgentAction, SakiAgentRiskLevel, SakiChatRequest, UpdateScheduledTaskRequest } from "@webops/shared";
import { prisma } from "../../db.js";
import { writeAuditLog } from "../../audit.js";
import { classifyCommandRisk, findDangerousCommandReason } from "../../security.js";
import { instanceAccessInclude, listVisibleInstances, loadVisibleInstance } from "../../instance-access.js";
import type { DaemonInstanceSpec } from "../../daemon-client.js";
import {
  archiveDaemonInstancePaths,
  createDaemonInstanceShell,
  deleteDaemonInstancePath,
  extractDaemonInstanceArchive,
  globDaemonInstanceFiles,
  grepDaemonInstanceFiles,
  killDaemonInstance,
  listDaemonInstanceFiles,
  listDaemonInstanceShells,
  makeDaemonInstanceDirectory,
  readDaemonInstanceFile,
  readDaemonInstanceLogs,
  statDaemonInstancePath,
  renameDaemonInstancePath,
  restartDaemonInstance,
  runDaemonInstanceCommand,
  sendDaemonInstanceInput,
  sendDaemonShellInput,
  startDaemonInstance,
  stopDaemonInstance,
  uploadDaemonInstanceFile,
  writeDaemonInstanceFile
} from "../../daemon-client.js";
import {
  createScheduledTask,
  deleteScheduledTask,
  executeScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  listTaskRuns,
  updateScheduledTask
} from "../../tasks.js";
import {
  completedSakiActions,
  getCachedInstanceFile,
  invalidateInstanceFileCache,
  recordInstanceFileRead,
  recordWorkingFileAccess,
  saveCheckpoint,
  savePendingSakiAction
} from "./state.js";
import type { InstanceWithNode, ParsedToolCall, PendingSakiAction, SakiAgentResumeState, SakiAgentRuntime, SakiCheckpoint, SakiSkillDocument, SakiSkillSummary } from "./types.js";
import { currentAgentAbortSignal } from "./types.js";
import {
  actionId,
  agentReadFileLineCountInput,
  checkpointId,
  checkpointPathSegment,
  defaultAgentReadFileLineCount,
  largeFileLineThreshold,
  maxAgentReadFileLineCount,
  formatInstanceSummary,
  formatLineNumberedContent,
  formatRunCommandObservation,
  formatSanitizedWriteNote,
  booleanArg,
  consoleInputPreview,
  formatToolArgs,
  joinRemoteWorkingDirectory,
  maxAgentConsoleInputChars,
  normalizeCommandRelativeCwd,
  nullableStringArg,
  numericArg,
  objectValue,
  optionalCommandInputArg,
  parseLineNumber,
  rawStringArg,
  redactSensitiveText,
  replaceLineRange,
  replacementToLines,
  requireUserPermission,
  RouteError,
  safeRelativePath,
  sanitizeAgentTextContent,
  splitEditableLines,
  stringArg,
  truncateDiff,
  truncateText,
  trimString,
  userFacingError
} from "./types.js";
import {
  assertSakiPermissionModeAllowsTool,
  assertToolProfileAllowsTool,
  assertWatchToolAllowed,
  buildInstanceSettingsPatch,
  instanceSettingsSnapshot,
  shouldRequestSakiApproval,
  toolArgs
} from "./tools.js";
import { attachIncidentCheckpoint } from "../../watch/incidents.js";

export interface SakiExecutorHost {
  buildAuditSearchContext(query: string, canViewAudit: boolean): Promise<string>;
  simpleWebSearch(query: string, maxResultsInput?: string): Promise<string>;
  browsePublicUrl(rawUrl: string): Promise<string>;
  crawlPublicSite(rawUrl: string, maxPagesInput?: string, maxDepthInput?: string): Promise<string>;
  researchWeb(query: string, maxPagesInput?: string): Promise<string>;
  loadSakiSkills(query?: string, includeDisabled?: boolean): Promise<{ skills: SakiSkillSummary[]; online: boolean }>;
  readSakiSkill(skillId: string, includeDisabled?: boolean): Promise<SakiSkillDocument>;
  formatSkillForAgent(skill: SakiSkillDocument): string;
}

let executorHost: SakiExecutorHost | null = null;

export function registerSakiExecutorHost(host: SakiExecutorHost): void {
  executorHost = host;
}

function requireExecutorHost(): SakiExecutorHost {
  if (!executorHost) {
    throw new RouteError("Saki executor host is not registered.", 500);
  }
  return executorHost;
}

function assertConsoleInputAllowed(data: string): string {
  if (!data) {
    throw new RouteError("sendInput requires text or pressEnter=true.", 400);
  }
  if (data.length > maxAgentConsoleInputChars) {
    throw new RouteError(`Console input is too long. Limit is ${maxAgentConsoleInputChars} characters.`, 400);
  }
  if (data !== "\u0003" && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(data)) {
    throw new RouteError("Console input contains unsupported control characters.", 400);
  }

  const preview = consoleInputPreview(data);
  const safetyText = data.replace(/\r/g, "").replace(/\n/g, " ").trim();
  const blocked = findDangerousCommandReason(safetyText);
  if (blocked) {
    throw new RouteError(blocked, 400);
  }
  return preview;
}

function consoleInputFromArgs(args: Record<string, unknown>): { data: string; preview: string; echo: boolean } {
  const text = rawStringArg(args, "text");
  const pressEnter = booleanArg(args, "pressEnter", true);
  const data = `${text}${pressEnter ? "\n" : ""}`;
  const preview = assertConsoleInputAllowed(data);
  return {
    data,
    preview,
    echo: booleanArg(args, "echo", true)
  };
}

function commandLineInputFromArgs(args: Record<string, unknown>): { data: string; preview: string; echo: boolean } {
  const command = stringArg(args, "command");
  if (!command) throw new RouteError("sendCommand requires a command.", 400);
  const data = `${command}\n`;
  const preview = assertConsoleInputAllowed(data);
  return {
    data,
    preview,
    echo: booleanArg(args, "echo", true)
  };
}

function formatConsoleInputObservation(
  label: string,
  input: { data: string; preview: string; echo: boolean },
  state: { status: string; exitCode?: number | null | undefined }
): string {
  const preview = input.echo ? JSON.stringify(input.preview) : "[hidden]";
  return `${label} sent to the running instance process stdin (${input.data.length} chars, preview=${preview}). Status=${state.status}, exitCode=${state.exitCode ?? "none"}.`;
}

function commandCwdArg(args: Record<string, unknown>): string {
  return stringArg(args, "cwd") || stringArg(args, "workingDirectory");
}

function daemonSpecFromInstance(instance: InstanceWithNode): DaemonInstanceSpec {
  const spec: DaemonInstanceSpec = {
    id: instance.id,
    name: instance.name,
    type: instance.type,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    stopCommand: instance.stopCommand,
    restartMaxRetries: instance.restartMaxRetries
  };
  if (instance.restartPolicy) {
    spec.restartPolicy = instance.restartPolicy as NonNullable<DaemonInstanceSpec["restartPolicy"]>;
  }
  return spec;
}

function commandWorkingDirectoryForAgent(
  instance: InstanceWithNode,
  args: Record<string, unknown>
): { daemonWorkingDirectory: string } {
  const relativeCwd = normalizeCommandRelativeCwd(commandCwdArg(args));
  return {
    daemonWorkingDirectory: joinRemoteWorkingDirectory(instance.workingDirectory, relativeCwd)
  };
}

function activeInstance(runtime: SakiAgentRuntime): InstanceWithNode {
  if (!runtime.context.instance) {
    throw new RouteError("Agent mode needs an active instance for this tool. Select an instance first.", 400);
  }
  return runtime.context.instance;
}

const workspaceRootNamesCache = new Map<string, { names: Set<string>; at: number }>();
const environmentInfoCache = new Map<string, { text: string; at: number }>();
const workspaceCacheTtlMs = 60_000;
const environmentInfoCacheTtlMs = 10 * 60_000;

async function workspaceRootNames(instance: InstanceWithNode): Promise<Set<string>> {
  const cached = workspaceRootNamesCache.get(instance.id);
  if (cached && Date.now() - cached.at < workspaceCacheTtlMs) return cached.names;
  const files = await listDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, "", { limit: 80 });
  const names = new Set(files.entries.map((entry) => entry.name));
  workspaceRootNamesCache.set(instance.id, { names, at: Date.now() });
  return names;
}

function diagnoseCommandForPath(targetPath: string): string | null {
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === ".py") return `python -m py_compile "${targetPath}"`;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return `node --check "${targetPath}"`;
  if (ext === ".json") return `node -e "JSON.parse(require('fs').readFileSync(${JSON.stringify(targetPath)}, 'utf8'))"`;
  return null;
}

async function detectDiagnoseCommand(instance: InstanceWithNode, targetPath: string): Promise<string> {
  const pathCommand = targetPath ? diagnoseCommandForPath(targetPath) : null;
  if (pathCommand && ![".ts", ".tsx", ".mts", ".cts"].includes(path.extname(targetPath).toLowerCase())) {
    return pathCommand;
  }
  try {
    const names = await workspaceRootNames(instance);
    if (names.has("tsconfig.json") || names.has("jsconfig.json")) return "npx tsc --noEmit --pretty false --incremental false";
    if (names.has("pyproject.toml") || names.has("requirements.txt") || names.has("setup.py")) {
      return targetPath ? `python -m py_compile "${targetPath}"` : "python -m compileall -q .";
    }
    if (names.has("Cargo.toml")) return "cargo check --quiet";
    if (names.has("go.mod")) return "go vet ./...";
  } catch {
    // Fall through to a cheap single-file check.
  }
  return pathCommand || "";
}

function replaceUniqueOccurrence(content: string, oldText: string, newText: string, relativePath: string): string {
  let matched = oldText;
  let count = content.split(matched).length - 1;
  if (count === 0 && content.includes("\r\n") && !oldText.includes("\r\n")) {
    const crlfCandidate = oldText.replace(/\n/g, "\r\n");
    if (content.includes(crlfCandidate)) {
      matched = crlfCandidate;
      count = content.split(matched).length - 1;
    }
  } else if (count === 0 && !content.includes("\r\n") && oldText.includes("\r\n")) {
    const lfCandidate = oldText.replace(/\r\n/g, "\n");
    if (content.includes(lfCandidate)) {
      matched = lfCandidate;
      count = content.split(matched).length - 1;
    }
  }
  if (count === 0) throw new RouteError(`${relativePath}: oldText was not found in file.`, 400);
  if (count > 1) throw new RouteError(`${relativePath}: oldText matched ${count} times. Use editLines with exact line numbers.`, 400);
  return content.replace(matched, () => newText);
}

function coerceEditsArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nodeLooksWindows(instance: InstanceWithNode): boolean {
  return /win/i.test(instance.node.os ?? "");
}

async function updateInstanceFromDaemonState(instance: InstanceWithNode, state: { status: string; exitCode?: number | null | undefined }) {
  const now = new Date();
  return prisma.instance.update({
    where: { id: instance.id },
    data: {
      status: state.status as never,
      lastExitCode: state.exitCode ?? null,
      ...(state.status === "RUNNING" ? { lastStartedAt: now } : {}),
      ...(state.status === "STOPPED" || state.status === "CRASHED" ? { lastStoppedAt: now } : {})
    },
    include: instanceAccessInclude
  });
}
function redactToolArgs(args: Record<string, unknown>, toolName = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const isConsoleInput = toolName.toLowerCase() === "sendinput";
  for (const [key, value] of Object.entries(args)) {
    if (isConsoleInput && key === "text") {
      result[key] = typeof value === "string" ? `[redacted ${value.length} chars]` : "[redacted]";
    } else if (/api[_-]?key|token|secret|password|private[_-]?key|stdin|input/i.test(key)) {
      result[key] = "[redacted]";
    } else if (typeof value === "string") {
      result[key] = redactSensitiveText(truncateText(value, 240));
    } else {
      result[key] = value;
    }
  }
  return result;
}

function unifiedDiff(label: string, before: string, after: string): string {
  if (before === after) return `No changes for ${label}.`;

  const patch = createPatch(label, before || "", after || "");
  const allLines = patch.split("\n");
  const filteredLines = allLines.filter(
    (line) => !line.startsWith("Index: ") && !line.startsWith("===================================================================")
  );

  const maxDiffLines = 300;
  if (filteredLines.length > maxDiffLines) {
    const truncated = filteredLines.slice(0, maxDiffLines);
    truncated.push("... [diff truncated, too many changes]");
    return truncateDiff(truncated.join("\n"));
  }
  return truncateDiff(filteredLines.join("\n"));
}

function withRelatedCheckpointIds(
  approval: NonNullable<SakiAgentAction["approval"]>,
  relatedCheckpointIds?: string[]
): NonNullable<SakiAgentAction["approval"]> {
  if (!relatedCheckpointIds?.length) return approval;
  return { ...approval, relatedCheckpointIds };
}

function buildCompletedFileEditApproval(
  checkpoint: SakiCheckpoint,
  afterContent: string,
  preview?: string,
  relatedCheckpointIds?: string[]
): NonNullable<SakiAgentAction["approval"]> {
  const pathLabel = checkpoint.type === "file" ? checkpoint.path : checkpoint.type === "softDelete" ? checkpoint.path : "change";
  const beforeContent = checkpoint.type === "file" ? checkpoint.content : checkpoint.type === "softDelete" ? "(file removed)" : "";
  return withRelatedCheckpointIds(
    {
      required: false,
      reason: "已保存检查点，可随时从操作面板回滚此次改动。",
      risk: "medium",
      preview: preview ?? pathLabel,
      diff: unifiedDiff(pathLabel, beforeContent, afterContent),
      checkpointId: checkpoint.id,
      rollbackAvailable: true
    },
    relatedCheckpointIds
  );
}

function buildCheckpointApproval(
  checkpoint: SakiCheckpoint,
  preview?: string,
  relatedCheckpointIds?: string[]
): NonNullable<SakiAgentAction["approval"]> {
  return withRelatedCheckpointIds(
    {
      required: false,
      reason: "已保存检查点，可随时从操作面板回滚此次改动。",
      risk: checkpoint.type === "softDelete" ? "high" : "medium",
      ...(preview ? { preview } : {}),
      checkpointId: checkpoint.id,
      rollbackAvailable: true
    },
    relatedCheckpointIds
  );
}

function fileDiffSnapshotFromCheckpoint(checkpoint: SakiCheckpoint, beforeContent: string): Extract<SakiCheckpoint, { type: "file" }> {
  if (checkpoint.type === "file") return checkpoint;
  if (checkpoint.type !== "softDelete") {
    throw new RouteError("Cannot build a file diff snapshot for this checkpoint type.", 500);
  }
  return {
    id: checkpoint.id,
    type: "file",
    instanceId: checkpoint.instanceId,
    path: checkpoint.path,
    existed: true,
    content: beforeContent,
    actionId: checkpoint.actionId,
    createdAt: checkpoint.createdAt
  };
}

async function findInstanceByLookup(userId: string, lookup: string): Promise<InstanceWithNode | null> {
  const trimmed = lookup.trim();
  if (!trimmed) return null;
  const exact = await loadVisibleInstance(userId, trimmed);
  if (exact) return exact;
  const query = trimmed.toLowerCase();
  return (
    (await listVisibleInstances(userId)).find(
      (instance) => instance.name === trimmed || instance.name.toLowerCase().includes(query)
    ) ?? null
  );
}

async function resolveAgentInstance(runtime: SakiAgentRuntime, args: Record<string, unknown>): Promise<InstanceWithNode> {
  const lookup = stringArg(args, "instanceId") || stringArg(args, "id") || stringArg(args, "instance");
  if (lookup) {
    requireUserPermission(runtime.permissions, "instance.view");
    const instance = await findInstanceByLookup(runtime.userId, lookup);
    if (!instance) throw new RouteError("Instance not found.", 404);
    return instance;
  }
  return activeInstance(runtime);
}

async function readFileForCheckpoint(instance: InstanceWithNode, relativePath: string): Promise<{ existed: boolean; content: string }> {
  try {
    const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
    return { existed: true, content: file.content };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/not found|no such file|ENOENT/i.test(message)) {
      return { existed: false, content: "" };
    }
    throw error;
  }
}

async function createFileCheckpoint(
  actionIdValue: string,
  instance: InstanceWithNode,
  relativePath: string,
  runtime?: SakiAgentRuntime | null
): Promise<SakiCheckpoint> {
  const snapshot = await readFileForCheckpoint(instance, relativePath);
  const checkpoint: SakiCheckpoint = {
    id: checkpointId(),
    type: "file",
    instanceId: instance.id,
    path: relativePath,
    existed: snapshot.existed,
    content: snapshot.content,
    actionId: actionIdValue,
    createdAt: new Date().toISOString()
  };
  await persistCheckpoint(runtime ?? null, checkpoint);
  return checkpoint;
}

async function persistCheckpoint(runtime: SakiAgentRuntime | null, checkpoint: SakiCheckpoint): Promise<void> {
  await saveCheckpoint(checkpoint);
  if (runtime?.incidentId) {
    await attachIncidentCheckpoint(runtime.incidentId, checkpoint.id);
  }
}

export async function rollbackCheckpoint(userId: string, checkpoint: SakiCheckpoint): Promise<string> {
  if (checkpoint.type === "file") {
    const instance = await findInstanceByLookup(userId, checkpoint.instanceId);
    if (!instance) throw new RouteError("Checkpoint instance not found.", 404);
    if (checkpoint.existed) {
      await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
        path: checkpoint.path,
        content: checkpoint.content
      });
      return `Rolled back file ${checkpoint.path}.`;
    }
    await deleteDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, { path: checkpoint.path });
    return `Removed file ${checkpoint.path} created after checkpoint.`;
  }

  if (checkpoint.type === "softDelete") {
    const instance = await findInstanceByLookup(userId, checkpoint.instanceId);
    if (!instance) throw new RouteError("Checkpoint instance not found.", 404);
    await renameDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, {
      fromPath: checkpoint.backupPath,
      toPath: checkpoint.path
    });
    return `Restored ${checkpoint.path}.`;
  }

  if (checkpoint.type === "instanceSettings") {
    await prisma.instance.update({ where: { id: checkpoint.instanceId }, data: checkpoint.data });
    return "Restored previous instance settings.";
  }

  if (checkpoint.type === "createdTask") {
    await deleteScheduledTask(checkpoint.taskId);
    return `Deleted scheduled task ${checkpoint.taskId} created by the action.`;
  }

  if (checkpoint.type === "updatedTask") {
    await updateScheduledTask(checkpoint.taskId, checkpoint.data);
    return `Restored scheduled task ${checkpoint.taskId}.`;
  }

  const instance = await findInstanceByLookup(userId, checkpoint.instanceId);
  if (!instance) throw new RouteError("Checkpoint instance not found.", 404);
  if (checkpoint.previousStatus === "RUNNING") {
    const state = await startDaemonInstance(instance.node, daemonSpecFromInstance(instance));
    await updateInstanceFromDaemonState(instance, state);
    return `Restarted ${instance.name} to approximate the previous running state.`;
  }
  return "No runtime rollback was needed for this instance action.";
}
function taskRequestFromArgs(args: Record<string, unknown>): CreateScheduledTaskRequest {
  const command = stringArg(args, "command");
  return {
    name: stringArg(args, "name"),
    type: stringArg(args, "type") as CreateScheduledTaskRequest["type"],
    cron: stringArg(args, "cron"),
    instanceId: stringArg(args, "instanceId") || null,
    payload: command ? { command } : {},
    enabled: booleanArg(args, "enabled", true)
  };
}

function taskUpdateFromArgs(args: Record<string, unknown>): UpdateScheduledTaskRequest {
  const patch: UpdateScheduledTaskRequest = {};
  if ("name" in args) patch.name = stringArg(args, "name");
  if ("type" in args) {
    const type = stringArg(args, "type") as UpdateScheduledTaskRequest["type"];
    if (type) patch.type = type;
  }
  if ("cron" in args) patch.cron = stringArg(args, "cron");
  if ("instanceId" in args) patch.instanceId = stringArg(args, "instanceId") || null;
  if ("command" in args) patch.payload = { command: stringArg(args, "command") };
  if ("enabled" in args) patch.enabled = booleanArg(args, "enabled", true);
  return patch;
}

async function buildApproval(runtime: SakiAgentRuntime, call: ParsedToolCall): Promise<NonNullable<SakiAgentAction["approval"]>> {
  const args = toolArgs(call);
  const toolName = call.name.toLowerCase();
  let reason = "Review and approve this Saki action before it changes your environment.";
  let risk: SakiAgentRiskLevel = "medium";
  let preview = formatToolArgs(args);
  let diff: string | undefined;
  let rollbackAvailable = false;

  if (toolName === "applypatch" || toolName === "apply_patch" || toolName === "applydiff" || toolName === "patchfiles") {
    requireUserPermission(runtime.permissions, "file.write");
    const patch = rawStringArg(args, "patch");
    if (!patch.trim()) throw new RouteError("applyPatch requires patch.", 400);
    const files = parseWorkspacePatch(patch);
    return {
      required: true,
      reason: "File patch requires approval. Review the diff; Saki will checkpoint previous files before writing.",
      risk: "high",
      preview: files.map((file) => `${file.kind} ${file.path}`).join(", "),
      diff: patch.slice(0, 8000),
      rollbackAvailable: true
    };
  }
  if (toolName === "writefile" || toolName === "replaceinfile" || toolName === "editlines" || toolName === "uploadbase64") {
    requireUserPermission(runtime.permissions, "file.write");
    const instance = await resolveAgentInstance(runtime, args);
    const relativePath = safeRelativePath(args.path);
    if (!relativePath) throw new RouteError(`${call.name} requires a file path.`, 400);
    if (toolName === "uploadbase64") {
      const contentBase64 = stringArg(args, "contentBase64");
      reason = "File upload requires approval. Saki will checkpoint the previous file before uploading when possible.";
      risk = "high";
      preview = `${instance.name}:${relativePath}\nbase64Length=${contentBase64.length}`;
      rollbackAvailable = true;
      return { required: true, reason, risk, preview, rollbackAvailable };
    }
    requireUserPermission(runtime.permissions, "file.read");
    const before = await readFileForCheckpoint(instance, relativePath);
    let after = "";
    if (toolName === "writefile") {
      after = sanitizeAgentTextContent(rawStringArg(args, "content")).content;
    } else if (toolName === "replaceinfile") {
      const oldText = rawStringArg(args, "oldText");
      const newText = sanitizeAgentTextContent(rawStringArg(args, "newText")).content;
      const count = before.content.split(oldText).length - 1;
      if (!oldText || count === 0) throw new RouteError("oldText was not found in the file.", 400);
      if (count > 1) throw new RouteError(`oldText matched ${count} times. Use editLines or a more specific oldText.`, 400);
      after = before.content.replace(oldText, () => newText);
    } else {
      const startLine = parseLineNumber(String(args.startLine), "startLine");
      const endLine = parseLineNumber(String(args.endLine), "endLine", 0);
      const replacement = sanitizeAgentTextContent(rawStringArg(args, "replacement")).content;
      after = replaceLineRange(before.content, startLine, endLine, replacement).content;
    }
    reason = "File write requires approval. Review the diff; Saki will checkpoint the previous file before writing.";
    risk = "high";
    preview = `${instance.name}:${relativePath}`;
    diff = unifiedDiff(relativePath, before.content, after);
    rollbackAvailable = true;
  } else if (toolName === "mkdir") {
    requireUserPermission(runtime.permissions, "file.write");
    const instance = await resolveAgentInstance(runtime, args);
    const relativePath = safeRelativePath(args.path);
    if (!relativePath) throw new RouteError("mkdir requires a path.", 400);
    reason = "Directory creation requires approval in the current permission mode.";
    risk = "medium";
    preview = `${instance.name}:${relativePath}`;
  } else if (toolName === "renamepath") {
    requireUserPermission(runtime.permissions, "file.write");
    const instance = await resolveAgentInstance(runtime, args);
    const fromPath = safeRelativePath(args.fromPath);
    const toPath = safeRelativePath(args.toPath);
    if (!fromPath || !toPath) throw new RouteError("renamePath requires fromPath and toPath.", 400);
    reason = "Moving or renaming files requires approval in the current permission mode.";
    risk = "high";
    preview = `${instance.name}:${fromPath} -> ${toPath}`;
  } else if (toolName === "deletepath") {
    requireUserPermission(runtime.permissions, "file.delete");
    const instance = await resolveAgentInstance(runtime, args);
    const relativePath = safeRelativePath(args.path);
    if (!relativePath) throw new RouteError("Refusing to delete the instance working directory root.", 400);
    reason = "Delete requires approval. Saki will move the path to a hidden checkpoint folder so it can be restored.";
    risk = "critical";
    preview = `${instance.name}:${relativePath}`;
    rollbackAvailable = true;
  } else if (toolName === "runcommand") {
    requireUserPermission(runtime.permissions, "terminal.input");
    const commandRisk = classifyCommandRisk(stringArg(args, "command"));
    if (commandRisk.risk === "critical") throw new RouteError(commandRisk.reason, 400);
    const cwd = commandCwdArg(args);
    normalizeCommandRelativeCwd(cwd);
    reason = commandRisk.reason;
    risk = commandRisk.risk;
    preview = [cwd ? `cwd: ${cwd}` : null, `command: ${stringArg(args, "command")}`].filter(Boolean).join("\n");
  } else if (toolName === "sendinput" || toolName === "sendcommand") {
    requireUserPermission(runtime.permissions, "terminal.input");
    reason = "Sending input to the running console requires approval in the current permission mode.";
    risk = "medium";
    if (toolName === "sendinput") {
      preview = `chars=${rawStringArg(args, "text").length}\npressEnter=${booleanArg(args, "pressEnter", true)}\necho=${booleanArg(args, "echo", true)}`;
    } else {
      preview = `command: ${stringArg(args, "command")}`;
    }
  } else if (toolName === "instanceaction") {
    const instance = await resolveAgentInstance(runtime, args);
    const action = stringArg(args, "action").toLowerCase();
    reason = `${action} changes instance runtime state and requires approval.`;
    risk = action === "kill" ? "critical" : "high";
    preview = `${action} ${instance.name} (${instance.id})`;
    rollbackAvailable = action === "stop" || action === "kill";
  } else if (toolName === "updateinstancesettings") {
    requireUserPermission(runtime.permissions, "instance.update");
    const instance = await resolveAgentInstance(runtime, args);
    const { preview: nextPreview } = buildInstanceSettingsPatch(instance, args);
    reason = "Instance settings changes require approval.";
    risk = "high";
    preview = JSON.stringify({ instance: instance.name, changes: nextPreview }, null, 2);
    diff = unifiedDiff("instance-settings.json", JSON.stringify(instanceSettingsSnapshot(instance), null, 2), JSON.stringify({ ...instanceSettingsSnapshot(instance), ...nextPreview }, null, 2));
    rollbackAvailable = true;
  } else if (toolName === "createscheduledtask" || toolName === "updatescheduledtask" || toolName === "deletescheduledtask") {
    const permission = toolName === "createscheduledtask" ? "task.create" : toolName === "updatescheduledtask" ? "task.update" : "task.delete";
    requireUserPermission(runtime.permissions, permission as PermissionCode);
    reason = "Scheduled task changes require approval.";
    risk = "high";
    rollbackAvailable = toolName !== "deletescheduledtask";
  } else if (toolName === "runtask") {
    requireUserPermission(runtime.permissions, "task.run");
    reason = "Running a task can start, stop, restart, or send commands to an instance.";
    risk = "high";
  }

  return { required: true, reason, risk, preview, ...(diff ? { diff } : {}), rollbackAvailable };
}

async function createPendingApprovalAction(
  runtime: SakiAgentRuntime,
  call: ParsedToolCall,
  resume?: SakiAgentResumeState
): Promise<SakiAgentAction> {
  const id = call.id || actionId();
  const approval = await buildApproval(runtime, call);
  const pending: PendingSakiAction = {
    id,
    call,
    userId: runtime.userId,
    contextInstanceId: runtime.context.instance?.id ?? null,
    createdAt: new Date().toISOString(),
    approval,
    ...(resume ? { resume } : {}),
    ...(runtime.incidentId ? { incidentId: runtime.incidentId } : {}),
    ...(runtime.kind ? { kind: runtime.kind } : {}),
    ...(runtime.watchMode ? { watchMode: runtime.watchMode } : {}),
    ...(runtime.maxLoops ? { maxLoops: runtime.maxLoops } : {}),
    ...(runtime.systemPromptOverride ? { systemPromptOverride: runtime.systemPromptOverride } : {})
  };
  await savePendingSakiAction(pending);
  return {
    id,
    tool: call.name,
    args: toolArgs(call),
    observation: "Waiting for user approval.",
    ok: false,
    status: "pending_approval",
    approval,
    createdAt: pending.createdAt
  };
}

export async function auditAgentTool(runtime: SakiAgentRuntime, action: SakiAgentAction): Promise<void> {
  await writeAuditLog({
    ...(runtime.request ? { request: runtime.request } : {}),
    userId: runtime.userId,
    action: "saki.agent.tool",
    resourceType: "saki",
    resourceId: runtime.context.workspace?.instanceId ?? null,
    payload: {
      tool: action.tool,
      args: redactToolArgs(action.args, action.tool),
      ok: action.ok,
      status: action.status ?? (action.ok ? "completed" : "failed"),
      observation: redactSensitiveText(truncateText(action.observation, 700))
    },
    result: action.ok ? "SUCCESS" : "FAILURE"
  });
}

function normalizeToolArgs(toolName: string, call: ParsedToolCall): Record<string, unknown> {
  if (!Array.isArray(call.args)) {
    return toolArgs(call);
  }
  const callArgs = call.args;
  switch (toolName) {
    case "listinstances": return {};
    case "describeinstance": return { lookup: callArgs[0] };
    case "instancelogs": return { lookup: callArgs[0], lines: callArgs[1] };
    case "listfiles": return { lookup: callArgs[0], path: callArgs[1] };
    case "readfile": return { lookup: callArgs[0], path: callArgs[1] };
    case "writefile": return { lookup: callArgs[0], path: callArgs[1], content: callArgs[2] };
    case "replaceinfile": return { lookup: callArgs[0], path: callArgs[1], old_str: callArgs[2], new_str: callArgs[3] };
    case "editlines": return { lookup: callArgs[0], path: callArgs[1], edits: callArgs[2] };
    case "mkdir": return { lookup: callArgs[0], path: callArgs[1] };
    case "deletepath": return { lookup: callArgs[0], path: callArgs[1] };
    case "renamepath": return { lookup: callArgs[0], from: callArgs[1], to: callArgs[2] };
    case "uploadbase64": return { lookup: callArgs[0], path: callArgs[1], base64: callArgs[2] };
    case "runcommand": return { lookup: callArgs[0], command: callArgs[1], cwd: callArgs[2], timeout: callArgs[3] };
    case "sendinput": return { lookup: callArgs[0], input: callArgs[1] };
    case "sendcommand": return { lookup: callArgs[0], command: callArgs[1] };
    case "listshells": return { lookup: callArgs[0] };
    case "createshell": return { lookup: callArgs[0], workingDirectory: callArgs[1] };
    case "sendshellinput": return { lookup: callArgs[0], shellId: callArgs[1], data: callArgs[2] };
    case "runinshell": return { lookup: callArgs[0], command: callArgs[1] };
    case "instanceaction": return { lookup: callArgs[0], action: callArgs[1] };
    case "searchaudit": return { query: callArgs[0] };
    case "listtasks": return { instanceLookup: callArgs[0] };
    case "runtask": return { id: callArgs[0] };
    case "taskruns": return { id: callArgs[0] };
    case "searchweb": return { query: callArgs[0] };
    case "browse": return { url: callArgs[0] };
    case "crawl": return { url: callArgs[0] };
    case "researchweb": return { query: callArgs[0] };
    case "listskills": return { query: callArgs[0] };
    case "searchskills": return { query: callArgs[0] };
    case "readskill": return { skill: callArgs[0] };
    case "readmemory": return { key: callArgs[0] };
    case "writememory": return { key: callArgs[0], value: callArgs[1] };
    case "reportprogress": return { message: callArgs[0] };
    case "respond": return { message: callArgs[0] };
    default: return {};
  }
}

export async function executeSakiAgentTool(
  runtime: SakiAgentRuntime,
  call: ParsedToolCall,
  options: { approved?: boolean; actionId?: string; pendingResume?: SakiAgentResumeState } = {}
): Promise<SakiAgentAction> {
  const tool = call.name.trim();
  const toolName = tool.toLowerCase();
  const startedAt = new Date().toISOString();
  let ok = true;
  let observation = "";

  const args = normalizeToolArgs(toolName, call);
  {
    const currentActionId = options.actionId || call.id || actionId();
    let checkpoint: SakiCheckpoint | null = null;
    let relatedCheckpointIds: string[] | undefined;
    let fileEditAfterContent: string | null = null;
    let fileEditBeforeContent: string | null = null;
    let fileEditPreview: string | undefined;

    try {
      assertSakiPermissionModeAllowsTool(runtime, toolName, args);
      assertToolProfileAllowsTool(runtime, toolName);
      assertWatchToolAllowed(runtime, toolName, args);
      if (!options.approved && shouldRequestSakiApproval(runtime, toolName, args)) {
        const pending = await createPendingApprovalAction(runtime, { ...call, id: currentActionId }, options.pendingResume);
        await auditAgentTool(runtime, pending);
        return pending;
      }

      if (toolName === "listinstances") {
        requireUserPermission(runtime.permissions, "instance.view");
        const query = stringArg(args, "query").toLowerCase();
        const limit = numericArg(args.limit, 50, 1, 100);
        const instances = await listVisibleInstances(runtime.userId, limit);
        const filtered = query
          ? instances.filter((instance) => `${instance.id} ${instance.name} ${instance.status} ${instance.node.name} ${instance.workingDirectory}`.toLowerCase().includes(query))
          : instances;
        observation = filtered.map(formatInstanceSummary).join("\n\n") || "No instances found.";
      } else if (toolName === "describeinstance") {
        requireUserPermission(runtime.permissions, "instance.view");
        observation = formatInstanceSummary(await resolveAgentInstance(runtime, args));
      } else if (toolName === "instancelogs") {
        requireUserPermission(runtime.permissions, "instance.logs");
        const instance = await resolveAgentInstance(runtime, args);
        const lines = numericArg(args.lines, 120, 1, 500);
        const logs = await readDaemonInstanceLogs(instance.node, instance.id, lines);
        await updateInstanceFromDaemonState(instance, logs);
        observation = logs.lines.map((line) => `[${line.stream}] ${line.text}`).join("\n") || "No logs available.";
      } else if (toolName === "listfiles") {
        requireUserPermission(runtime.permissions, "file.view");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        const limit = numericArg(args.limit, 200, 1, 1000);
        const files = await listDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, relativePath, { limit });
        observation = [
          files.entries.map((entry) => `${entry.type === "directory" ? "[DIR]" : "[FILE]"} ${entry.path || entry.name} ${entry.size ? `(${entry.size} bytes)` : ""}`).join("\n") || "Directory is empty.",
          files.truncated
            ? `\nShowing ${files.entries.length} of ${files.totalEntries ?? "many"} entries. Narrow path or call listFiles with a higher limit if needed.`
            : null
        ].filter(Boolean).join("\n");
      } else if (toolName === "readfile") {
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("readFile requires a file path.", 400);
        const startLine = numericArg(args.startLine, 0, 0, 1_000_000);
        const lineCount = numericArg(args.lineCount, defaultAgentReadFileLineCount, 1, maxAgentReadFileLineCount);
        const isBlindRead = startLine < 1;
        recordWorkingFileAccess(runtime.userId, instance.id, relativePath);

        if (isBlindRead) {
          const outline = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath, {
            outline: true
          });
          const totalLines = outline.totalLines ?? 0;
          if (totalLines > largeFileLineThreshold) {
            observation = [
              `LARGE FILE BLOCKED from blind read: ${relativePath}`,
              `Size: ${outline.size} bytes | Total lines: ${totalLines}`,
              "",
              "Do NOT page through this file. Locate first, then read a window:",
              `- searchFiles({ pattern: "symbolOrError", path: "${relativePath}" })`,
              `- readSymbol({ path: "${relativePath}", symbol: "Name" })`,
              `- readFile({ path: "${relativePath}", startLine: N, lineCount: 40 })`,
              "",
              "Outline:",
              outline.content
            ].join("\n");
          }
        }

        if (!observation) {
          const windowStart = Math.max(1, startLine || 1);
          const cached = getCachedInstanceFile(instance.id, relativePath);
          let windowText: string;
          let fileSize: number;
          let totalLines: number;
          let endLine: number;
          let cacheHit = false;

          if (cached) {
            const numbered = formatLineNumberedContent(cached.content, String(windowStart), String(lineCount));
            windowText = numbered.text;
            fileSize = cached.size;
            totalLines = numbered.totalLines;
            endLine = numbered.endLine;
            cacheHit = true;
          } else {
            const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath, {
              startLine: windowStart,
              lineCount
            });
            const rawLines = file.content.length === 0 ? [] : file.content.split(/\r?\n/);
            const width = String(windowStart + rawLines.length).length;
            windowText = rawLines
              .map((line, index) => `${String(windowStart + index).padStart(width, " ")} | ${line}`)
              .join("\n");
            fileSize = file.size;
            totalLines = file.totalLines ?? rawLines.length;
            endLine = windowStart + Math.max(rawLines.length - 1, 0);
          }

          observation = [
            `File: ${relativePath}${cacheHit ? " [cache]" : ""}`,
            `Size: ${fileSize} bytes | Total lines: ${totalLines}`,
            `Showing lines: ${windowStart}-${endLine}`,
            "",
            truncateText(windowText, 4000),
            "",
            endLine < totalLines
              ? `Stopped at line ${endLine}/${totalLines}. Do not sequentially page the rest. Use searchFiles or readSymbol to jump.`
              : null
          ].filter(Boolean).join("\n");
        }
      } else if (toolName === "writefile") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("writeFile requires a file path.", 400);
        try {
          const existing = await statDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, relativePath);
          if (existing.isDirectory) {
            throw new RouteError(`writeFile cannot overwrite directory '${relativePath}'.`, 400);
          }
          throw new RouteError(
            `writeFile is for NEW files only. '${relativePath}' already exists. Use editLines, replaceInFile, or batchEdit.`,
            400
          );
        } catch (error) {
          if (error instanceof RouteError) throw error;
        }
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath, runtime);
        fileEditPreview = `${instance.name}:${relativePath}`;
        const sanitized = sanitizeAgentTextContent(rawStringArg(args, "content"));
        fileEditAfterContent = sanitized.content;
        const file = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: relativePath, content: sanitized.content });
        recordInstanceFileRead(instance.id, relativePath, { content: sanitized.content, size: file.size, modifiedAt: new Date().toISOString() });
        recordWorkingFileAccess(runtime.userId, instance.id, relativePath);
        observation = `Success: wrote ${file.path} (${file.size} bytes).${formatSanitizedWriteNote(sanitized.removed)}`;
      } else if (toolName === "replaceinfile") {
        requireUserPermission(runtime.permissions, "file.write");
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        const oldText = rawStringArg(args, "oldText");
        const sanitized = sanitizeAgentTextContent(rawStringArg(args, "newText"));
        if (!relativePath || !oldText) throw new RouteError("replaceInFile requires path and oldText.", 400);
        const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
        let matchedOldText = oldText;
        let count = file.content.split(matchedOldText).length - 1;
        if (count === 0 && file.content.includes("\r\n") && !oldText.includes("\r\n")) {
          const crlfCandidate = oldText.replace(/\n/g, "\r\n");
          if (file.content.includes(crlfCandidate)) {
            matchedOldText = crlfCandidate;
            count = file.content.split(matchedOldText).length - 1;
          }
        } else if (count === 0 && !file.content.includes("\r\n") && oldText.includes("\r\n")) {
          const lfCandidate = oldText.replace(/\r\n/g, "\n");
          if (file.content.includes(lfCandidate)) {
            matchedOldText = lfCandidate;
            count = file.content.split(matchedOldText).length - 1;
          }
        }
        if (count === 0) {
          throw new RouteError(
            `oldText was not found in ${relativePath}. Check for exact whitespace/indentation, inspect the file with readFile({ path: "${relativePath}", startLine: ... }), or use editLines({ path: "${relativePath}", startLine, endLine, replacement }) instead.`,
            400
          );
        }
        if (count > 1) throw new RouteError(`oldText matched ${count} times in ${relativePath}. Use editLines with exact line numbers for precise replacement.`, 400);
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath, runtime);
        fileEditPreview = `${instance.name}:${relativePath}`;
        fileEditAfterContent = file.content.replace(matchedOldText, () => sanitized.content);
        const updated = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
          path: relativePath,
          content: fileEditAfterContent
        });
        recordInstanceFileRead(instance.id, relativePath, { content: fileEditAfterContent, size: updated.size, modifiedAt: new Date().toISOString() });
        recordWorkingFileAccess(runtime.userId, instance.id, relativePath);
        observation = `Success: replaced text in ${updated.path} (${updated.size} bytes).${formatSanitizedWriteNote(sanitized.removed)}`;
      } else if (toolName === "editlines") {
        requireUserPermission(runtime.permissions, "file.write");
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        const startLine = parseLineNumber(String(args.startLine), "startLine");
        const endLine = parseLineNumber(String(args.endLine), "endLine", 0);
        const sanitized = sanitizeAgentTextContent(rawStringArg(args, "replacement"));
        if (!relativePath) throw new RouteError("editLines requires a file path.", 400);
        const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
        const edit = replaceLineRange(file.content, startLine, endLine, sanitized.content);
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath, runtime);
        fileEditPreview = `${instance.name}:${relativePath}`;
        fileEditAfterContent = edit.content;
        const updated = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: relativePath, content: edit.content });
        recordInstanceFileRead(instance.id, relativePath, { content: edit.content, size: updated.size, modifiedAt: new Date().toISOString() });
        recordWorkingFileAccess(runtime.userId, instance.id, relativePath);
        const previewStart = Math.max(1, startLine - 3);
        const previewCount = Math.max(8, edit.insertedLineCount + 6);
        const preview = formatLineNumberedContent(edit.content, String(previewStart), String(previewCount));
        observation = [
          `Success: edited ${updated.path} (${updated.size} bytes).${formatSanitizedWriteNote(sanitized.removed)}`,
          `Removed lines: ${edit.removedLineCount}`,
          `Inserted lines: ${edit.insertedLineCount}`,
          `Preview lines ${preview.startLine}-${preview.endLine}:`,
          preview.text
        ].join("\n");
      } else if (toolName === "mkdir") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("mkdir requires a path.", 400);
        const entry = await makeDaemonInstanceDirectory(instance.node, instance.id, instance.workingDirectory, { path: relativePath });
        observation = `Success: directory ready at ${entry.path}.`;
      } else if (toolName === "deletepath") {
        requireUserPermission(runtime.permissions, "file.delete");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("Refusing to delete the instance working directory root.", 400);
        const beforeDelete = await readFileForCheckpoint(instance, relativePath);
        const trashSegment = checkpointPathSegment(currentActionId);
        const backupPath = `.webops-saki-trash/${trashSegment}/${path.basename(relativePath)}`;
        await makeDaemonInstanceDirectory(instance.node, instance.id, instance.workingDirectory, { path: `.webops-saki-trash/${trashSegment}` });
        await renameDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, { fromPath: relativePath, toPath: backupPath });
        invalidateInstanceFileCache(instance.id, relativePath);
        checkpoint = { id: checkpointId(), type: "softDelete", instanceId: instance.id, path: relativePath, backupPath, actionId: currentActionId, createdAt: new Date().toISOString() };
        await persistCheckpoint(runtime, checkpoint);
        if (beforeDelete.existed) {
          fileEditPreview = `${instance.name}:${relativePath}`;
          fileEditBeforeContent = beforeDelete.content;
          fileEditAfterContent = "";
        }
        observation = `Success: moved ${relativePath} to a rollback checkpoint.`;
      } else if (toolName === "renamepath") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const fromPath = safeRelativePath(args.fromPath);
        const toPath = safeRelativePath(args.toPath);
        if (!fromPath || !toPath) throw new RouteError("renamePath requires fromPath and toPath.", 400);
        const entry = await renameDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, { fromPath, toPath });
        invalidateInstanceFileCache(instance.id, fromPath);
        invalidateInstanceFileCache(instance.id, toPath);
        recordWorkingFileAccess(runtime.userId, instance.id, toPath);
        observation = `Success: renamed to ${entry.path}.`;
      } else if (toolName === "uploadbase64") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        const contentBase64 = stringArg(args, "contentBase64");
        if (!relativePath || !contentBase64) throw new RouteError("uploadBase64 requires path and base64 content.", 400);
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath, runtime);
        fileEditPreview = `${instance.name}:${relativePath}`;
        const entry = await uploadDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: relativePath, contentBase64, overwrite: true });
        invalidateInstanceFileCache(instance.id, relativePath);
        recordWorkingFileAccess(runtime.userId, instance.id, relativePath);
        try {
          const uploaded = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
          fileEditAfterContent = uploaded.content;
          recordInstanceFileRead(instance.id, relativePath, { content: uploaded.content, size: uploaded.size, modifiedAt: uploaded.modifiedAt });
        } catch {
          fileEditAfterContent = "(binary upload)";
        }
        observation = `Success: uploaded ${entry.path} (${entry.size} bytes).`;
      } else if (toolName === "archivepaths" || toolName === "archive" || toolName === "compresspaths" || toolName === "zippaths") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const paths = Array.isArray(args.paths)
          ? args.paths.map((value) => trimString(value)).filter(Boolean)
          : [safeRelativePath(args.path)].filter(Boolean);
        if (paths.length === 0) throw new RouteError("archivePaths requires at least one path.", 400);
        const outputPath = safeRelativePath(args.outputPath) || undefined;
        const result = await archiveDaemonInstancePaths(instance.node, instance.id, instance.workingDirectory, {
          paths,
          ...(outputPath ? { outputPath } : {})
        });
        observation = `Success: archived ${result.archivedCount} path(s) to ${result.outputPath} (${result.size} bytes).`;
      } else if (toolName === "extractarchive" || toolName === "extract" || toolName === "unziparchive" || toolName === "decompressarchive") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("extractArchive requires an archive path.", 400);
        const outputPath = safeRelativePath(args.outputPath) || undefined;
        const conflictPolicy =
          args.conflictPolicy === "overwrite" || args.conflictPolicy === "skip"
            ? args.conflictPolicy
            : args.overwrite === true || args.overwrite === "true"
              ? "overwrite"
              : undefined;
        const result = await extractDaemonInstanceArchive(instance.node, instance.id, instance.workingDirectory, {
          path: relativePath,
          ...(outputPath ? { outputPath } : {}),
          ...(conflictPolicy ? { conflictPolicy } : {})
        });
        observation = `Success: extracted ${result.archivePath} to ${result.outputPath} (${result.extractedCount} files, skipped ${result.skippedCount}, overwrote ${result.overwrittenCount}, ${result.totalBytes} bytes).`;
      } else if (toolName === "runcommand") {
        requireUserPermission(runtime.permissions, "terminal.input");
        const instance = await resolveAgentInstance(runtime, args);
        const command = stringArg(args, "command");
        if (!command) throw new RouteError("runCommand requires a command.", 400);
        const commandRisk = classifyCommandRisk(command);
        if (commandRisk.risk === "critical") throw new RouteError(commandRisk.reason, 400);
        const timeoutMs = numericArg(args.timeoutMs, 30000, 1000, 120000);
        const { daemonWorkingDirectory } = commandWorkingDirectoryForAgent(instance, args);
        try {
          const runResult = await runDaemonInstanceCommand(instance.node, instance.id, {
            command,
            workingDirectory: daemonWorkingDirectory,
            timeoutMs
          }, currentAgentAbortSignal());
          if (runResult.signal === "ABORTED" || currentAgentAbortSignal()?.aborted) {
            ok = false;
            observation = "Command aborted because the task was cancelled.";
          } else {
            const outputParts: string[] = [];
            if (runResult.stdout) outputParts.push(`stdout:\n${truncateText(runResult.stdout.trim(), 6000)}`);
            if (runResult.stderr) outputParts.push(`stderr:\n${truncateText(runResult.stderr.trim(), 4000)}`);
            outputParts.push(`exit code: ${runResult.exitCode ?? 0} (${runResult.durationMs ?? 0}ms)`);
            observation = outputParts.join("\n\n") || "(Command completed with no output)";
            if ((runResult.exitCode ?? 0) !== 0) {
              ok = false;
            }
          }
        } catch (error) {
          if (currentAgentAbortSignal()?.aborted || /aborted/i.test(error instanceof Error ? error.message : String(error))) {
            ok = false;
            observation = "Command aborted because the task was cancelled.";
          } else {
            throw error;
          }
        }
      } else if (toolName === "sendinput") {
        requireUserPermission(runtime.permissions, "terminal.input");
        const instance = await resolveAgentInstance(runtime, args);
        const input = consoleInputFromArgs(args);
        const state = await sendDaemonInstanceInput(instance.node, instance.id, input.data, { echo: input.echo });
        await updateInstanceFromDaemonState(instance, state);
        observation = formatConsoleInputObservation("Console input", input, state);
      } else if (toolName === "sendcommand") {
        requireUserPermission(runtime.permissions, "terminal.input");
        const instance = await resolveAgentInstance(runtime, args);
        const input = commandLineInputFromArgs(args);
        const state = await sendDaemonInstanceInput(instance.node, instance.id, input.data, { echo: input.echo });
        await updateInstanceFromDaemonState(instance, state);
        observation = formatConsoleInputObservation("Command line", input, state);
      } else if (toolName === "instanceaction") {
        const instance = await resolveAgentInstance(runtime, args);
        const action = stringArg(args, "action").toLowerCase();
        if (action !== "start" && action !== "stop" && action !== "restart" && action !== "kill") throw new RouteError("instanceAction supports start, stop, restart, or kill.", 400);
        requireUserPermission(runtime.permissions, `instance.${action}` as PermissionCode);
        if (action === "stop" || action === "kill") {
          checkpoint = { id: checkpointId(), type: "instanceAction", instanceId: instance.id, previousStatus: instance.status, actionId: currentActionId, createdAt: new Date().toISOString() };
          await persistCheckpoint(runtime, checkpoint);
        }
        const state =
          action === "start"
            ? await startDaemonInstance(instance.node, daemonSpecFromInstance(instance))
            : action === "stop"
              ? await stopDaemonInstance(instance.node, { id: instance.id, stopCommand: instance.stopCommand })
              : action === "restart"
                ? await restartDaemonInstance(instance.node, daemonSpecFromInstance(instance))
                : await killDaemonInstance(instance.node, instance.id);
        await updateInstanceFromDaemonState(instance, state);
        observation = `Success: ${action} requested for ${instance.name}. Status=${state.status}, exitCode=${state.exitCode ?? "none"}.`;
      } else if (toolName === "updateinstancesettings") {
        requireUserPermission(runtime.permissions, "instance.update");
        const instance = await resolveAgentInstance(runtime, args);
        const { patch } = buildInstanceSettingsPatch(instance, args);
        checkpoint = { id: checkpointId(), type: "instanceSettings", instanceId: instance.id, data: instanceSettingsSnapshot(instance), actionId: currentActionId, createdAt: new Date().toISOString() };
        await persistCheckpoint(runtime, checkpoint);
        const updated = await prisma.instance.update({ where: { id: instance.id }, data: patch, include: instanceAccessInclude });
        observation = `Success: updated instance settings.\n${formatInstanceSummary(updated)}`;
      } else if (toolName === "searchaudit") {
        requireUserPermission(runtime.permissions, "audit.view");
        observation = await requireExecutorHost().buildAuditSearchContext(stringArg(args, "query") || runtime.input.message, true);
      } else if (toolName === "listtasks") {
        requireUserPermission(runtime.permissions, "task.view");
        const lookup = stringArg(args, "instanceId");
        const instance = lookup ? await findInstanceByLookup(runtime.userId, lookup) : null;
        if (lookup && !instance) throw new RouteError("Instance not found.", 404);
        const tasks = await listScheduledTasks(instance?.id);
        observation = tasks.map((task) => `${task.id} | ${task.name} | ${task.type} | cron=${task.cron} | enabled=${task.enabled} | instance=${task.instanceName ?? task.instanceId ?? "-"}`).join("\n") || "No scheduled tasks found.";
      } else if (toolName === "createscheduledtask") {
        requireUserPermission(runtime.permissions, "task.create");
        const taskInput = taskRequestFromArgs(args);
        if (!taskInput.instanceId && runtime.context.instance?.id) taskInput.instanceId = runtime.context.instance.id;
        const task = await createScheduledTask(taskInput, runtime.userId);
        checkpoint = { id: checkpointId(), type: "createdTask", taskId: task.id, actionId: currentActionId, createdAt: new Date().toISOString() };
        await persistCheckpoint(runtime, checkpoint);
        observation = `Success: created task ${task.id} (${task.name}).`;
      } else if (toolName === "updatescheduledtask") {
        requireUserPermission(runtime.permissions, "task.update");
        const taskId = stringArg(args, "taskId");
        const existing = taskId ? await getScheduledTask(taskId) : null;
        if (!existing) throw new RouteError("Task not found.", 404);
        checkpoint = {
          id: checkpointId(),
          type: "updatedTask",
          taskId,
          data: { name: existing.name, type: existing.type, cron: existing.cron, instanceId: existing.instanceId ?? null, payload: existing.payload, enabled: existing.enabled },
          actionId: currentActionId,
          createdAt: new Date().toISOString()
        };
        await persistCheckpoint(runtime, checkpoint);
        const task = await updateScheduledTask(taskId, taskUpdateFromArgs(args));
        observation = `Success: updated task ${task.id} (${task.name}).`;
      } else if (toolName === "deletescheduledtask") {
        requireUserPermission(runtime.permissions, "task.delete");
        const taskId = stringArg(args, "taskId");
        if (!taskId) throw new RouteError("deleteScheduledTask requires a task id.", 400);
        await deleteScheduledTask(taskId);
        observation = `Success: deleted task ${taskId}.`;
      } else if (toolName === "runtask") {
        requireUserPermission(runtime.permissions, "task.run");
        const taskId = stringArg(args, "taskId");
        if (!taskId) throw new RouteError("runTask requires a task id.", 400);
        const run = await executeScheduledTask(taskId, { trigger: "manual", ...(runtime.request ? { request: runtime.request } : {}), userId: runtime.userId });
        observation = `Task run ${run.id}: ${run.status}\nOutput: ${run.output ?? "-"}\nError: ${run.error ?? "-"}`;
      } else if (toolName === "taskruns") {
        requireUserPermission(runtime.permissions, "task.view");
        const taskId = stringArg(args, "taskId");
        if (!taskId) throw new RouteError("taskRuns requires a task id.", 400);
        const runs = await listTaskRuns(taskId);
        observation = runs.map((run) => `${run.id} | ${run.status} | ${run.startedAt} | ${run.output ?? run.error ?? "-"}`).join("\n") || "No task runs found.";
      } else if (toolName === "searchfiles" || toolName === "grep" || toolName === "grepfiles" || toolName === "searchcode" || toolName === "codesearch") {
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const pattern = stringArg(args, "pattern");
        if (!pattern) throw new RouteError("searchFiles requires a pattern.", 400);
        const searchPath = safeRelativePath(args.path);
        const include = stringArg(args, "include") || undefined;
        const maxResults = numericArg(args.maxResults, 40, 1, 80);
        const result = await grepDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, {
          workingDirectory: instance.workingDirectory,
          pattern,
          ...(searchPath ? { path: searchPath } : {}),
          ...(include ? { include } : {}),
          maxResults,
          contextLines: 2
        });
        let formattedMatches = "No matches found.";
        if (result.matches.length > 0) {
          const groups = new Map<string, typeof result.matches>();
          for (const match of result.matches) {
            const list = groups.get(match.file) ?? [];
            list.push(match);
            groups.set(match.file, list);
          }
          formattedMatches = [...groups.entries()]
            .map(([fileRelPath, fileMatches]) => {
              const parts = [`File: ${fileRelPath}`];
              for (const match of fileMatches) {
                parts.push(`  ── L${match.line} ──`);
                for (const line of match.before ?? []) parts.push(`    ${line}`);
                parts.push(`  > L${match.line}: ${match.text}`);
                for (const line of match.after ?? []) parts.push(`    ${line}`);
              }
              return parts.join("\n");
            })
            .join("\n\n");
        }
        observation = [
          formattedMatches,
          result.truncated ? `\nTruncated: ${result.totalMatches} total hits. Narrow the pattern instead of reading files.` : null,
          `\nSearched ${result.filesSearched} files, ${result.totalMatches} matches. Jump with readFile({ path, startLine }) or editLines using these line numbers. Do not read whole files.`
        ].filter(Boolean).join("\n");
      } else if (toolName === "findfiles" || toolName === "glob" || toolName === "globfiles" || toolName === "findbyname") {
        requireUserPermission(runtime.permissions, "file.view");
        const instance = await resolveAgentInstance(runtime, args);
        const pattern = stringArg(args, "pattern");
        if (!pattern) throw new RouteError("findFiles requires a pattern.", 400);
        const searchPath = safeRelativePath(args.path);
        const maxResults = numericArg(args.maxResults, 200, 1, 1000);
        const result = await globDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, {
          workingDirectory: instance.workingDirectory,
          pattern,
          ...(searchPath ? { path: searchPath } : {}),
          maxResults
        });
        observation = [
          result.paths.length > 0 ? result.paths.join("\n") : "No files matched the pattern.",
          result.truncated ? `\nResults truncated. ${result.totalMatches} total matches found.` : null,
          `\nFound ${result.totalMatches} matching files.`
        ].filter(Boolean).join("\n");
      } else if (toolName === "outlinefile" || toolName === "fileoutline" || toolName === "outline") {
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("outlineFile requires a file path.", 400);
        recordWorkingFileAccess(runtime.userId, instance.id, relativePath);
        const outline = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath, {
          outline: true
        });
        observation = [
          `File Outline: ${relativePath} (${outline.totalLines ?? "?"} lines)`,
          "Use these line numbers with readFile({ startLine, lineCount: 40 }) or editLines. Do not read the whole file.",
          "",
          outline.content
        ].join("\n");
      } else if (toolName === "findsymbols" || toolName === "finddefinition" || toolName === "findsymbol" || toolName === "gotodefinition" || toolName === "symbolsearch") {
        requireUserPermission(runtime.permissions, "file.view");
        const instance = await resolveAgentInstance(runtime, args);
        const rawQuery = stringArg(args, "query");
        if (!rawQuery) throw new RouteError("findSymbols requires a query (symbol name).", 400);
        const searchPath = safeRelativePath(args.path);
        const escaped = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = `\\b(function|class|interface|type|enum|def|struct|trait)\\s+${escaped}\\b|\\b${escaped}\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|function)`;
        const result = await grepDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, {
          workingDirectory: instance.workingDirectory,
          pattern,
          ...(searchPath ? { path: searchPath } : {}),
          maxResults: 50
        });

        if (result.matches.length > 0) {
          observation = [
            `Symbol definitions found for "${rawQuery}" (${result.matches.length} matches):`,
            ...result.matches.map((m) => `${m.file}:${m.line}: ${m.text.trim()}`),
            "",
            "Tip: You can use editLines on these line numbers directly or inspect with readFile(startLine)."
          ].join("\n");
        } else {
          observation = `No exact definition found for symbol "${rawQuery}". Try searchFiles({ pattern: "${rawQuery}" }) for general references.`;
        }
      } else if (toolName === "searchweb") {
        if (!runtime.config.searchEnabled) throw new RouteError("Web search is disabled in Saki settings.", 403);
        observation = await requireExecutorHost().simpleWebSearch(stringArg(args, "query") || runtime.input.message, stringArg(args, "maxResults") || undefined);
      } else if (toolName === "browse") {
        if (!runtime.config.searchEnabled) throw new RouteError("Web browsing is disabled in Saki settings.", 403);
        observation = await requireExecutorHost().browsePublicUrl(stringArg(args, "url"));
      } else if (toolName === "crawl") {
        if (!runtime.config.searchEnabled) throw new RouteError("Web crawling is disabled in Saki settings.", 403);
        observation = await requireExecutorHost().crawlPublicSite(stringArg(args, "url"), stringArg(args, "maxPages") || undefined, stringArg(args, "maxDepth") || undefined);
      } else if (toolName === "researchweb") {
        if (!runtime.config.searchEnabled) throw new RouteError("Web research is disabled in Saki settings.", 403);
        observation = await requireExecutorHost().researchWeb(stringArg(args, "query") || runtime.input.message, stringArg(args, "maxPages") || undefined);
      } else if (toolName === "listskills") {
        observation =
          runtime.skills
            .map((skill) => `${skill.id}: ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`)
            .join("\n") || "No skills available.";
        if (observation !== "No skills available.") {
          observation += "\n\nThese are summaries only. Call searchSkills({ query }) for task-specific matches, then readSkill({ skillId }) before applying a skill.";
        }
      } else if (toolName === "searchskills") {
        const { rankSkillsForQuery, formatSkillSearchLine, toSkillSummary } = await import("./skills.js");
        const query = stringArg(args, "query") || runtime.input.message;
        const ranked = await rankSkillsForQuery(query, { limit: 12 });
        observation =
          ranked.map((item) => formatSkillSearchLine(toSkillSummary(item.skill), item.score)).join("\n") ||
          "No matching skills found.";
        if (observation !== "No matching skills found.") {
          observation += "\n\nCall readSkill({ skillId }) for any high/medium relevance skill before making changes.";
        }
      } else if (toolName === "readskill") {
        observation = requireExecutorHost().formatSkillForAgent(await requireExecutorHost().readSakiSkill(stringArg(args, "skillId"), false));
      } else if (toolName === "readmemory" || toolName === "getmemory" || toolName === "loadmemory") {
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        try {
          const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, "SAKI.md");
          observation = `Project memory (SAKI.md):\n\n${file.content}`;
        } catch {
          observation = "No project memory file (SAKI.md) found. You can create one with writeMemory to save project conventions and preferences.";
        }
      } else if (toolName === "writememory" || toolName === "updatememory" || toolName === "savememory") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const content = rawStringArg(args, "content");
        if (!content) throw new RouteError("writeMemory requires content.", 400);
        const sanitized = sanitizeAgentTextContent(content);
        const file = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: "SAKI.md", content: sanitized.content });
        observation = `Success: wrote project memory to SAKI.md (${file.size} bytes).${formatSanitizedWriteNote(sanitized.removed)}`;
      } else if (toolName === "reportprogress") {
        observation = rawStringArg(args, "text");
      } else if (toolName === "diagnosecode" || toolName === "diagnostics" || toolName === "checktypes" || toolName === "typecheck" || toolName === "lintcode") {
        requireUserPermission(runtime.permissions, "terminal.input");
        const instance = await resolveAgentInstance(runtime, args);
        const customCmd = stringArg(args, "command");
        const targetPath = safeRelativePath(args.path);
        const checkCommand = customCmd || (await detectDiagnoseCommand(instance, targetPath));
        if (checkCommand && /\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test)\b/i.test(checkCommand)) {
          throw new RouteError("diagnoseCode is a fast syntax/typecheck. Do not pass test-suite commands.", 400);
        }
        if (!checkCommand) {
          observation = "No fast diagnostic command for this workspace (no tsconfig/pyproject/Cargo.toml/go.mod, and no JS/Python/JSON path). Treat diagnostics as clean and continue.";
        } else {
          try {
            const runResult = await runDaemonInstanceCommand(instance.node, instance.id, {
              command: checkCommand,
              workingDirectory: instance.workingDirectory,
              timeoutMs: 20000
            }, currentAgentAbortSignal());

            const outputText = [runResult.stdout, runResult.stderr].filter(Boolean).join("\n").trim();
            if (runResult.exitCode === 0) {
              observation = `Diagnostics clean: '${checkCommand}' passed with exit code 0. No syntax or type errors detected.`;
            } else {
              ok = false;
              observation = [
                `Diagnostics found errors (command: '${checkCommand}', exit code ${runResult.exitCode}):`,
                "",
                outputText || "(command failed with non-zero exit code without stdout/stderr)",
                "",
                "Tip: Use the file paths and line numbers above to fix errors with editLines or replaceInFile."
              ].join("\n");
            }
          } catch (err) {
            ok = false;
            observation = `Diagnostics command '${checkCommand}' could not complete: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      } else if (toolName === "managetodos" || toolName === "settodos" || toolName === "todos" || toolName === "updatetodos") {
        const todos = rawStringArg(args, "todos") || rawStringArg(args, "list");
        if (!todos) throw new RouteError("manageTodos requires a todos markdown list (e.g. '- [ ] Step 1\\n- [x] Step 2').", 400);
        observation = [
          "Current Task Status / TODO List:",
          "",
          todos.trim(),
          "",
          "Continue working through the remaining unchecked items."
        ].join("\n");
      } else if (toolName === "spawntask" || toolName === "subagent" || toolName === "delegate" || toolName === "runsubtask") {
        if (runtime.toolProfile === "research" || /You are a (?:research-only )?sub-agent/i.test(runtime.input.message ?? "")) {
          throw new RouteError("Sub-agents cannot spawn further sub-agents.", 400);
        }
        const taskDescription = rawStringArg(args, "task");
        if (!taskDescription) throw new RouteError("spawnTask requires a task description.", 400);
        const maxSteps = numericArg(args.maxSteps, 5, 1, 10);
        const subPrompt = `You are a research-only sub-agent. Inspect the workspace; do not edit files, run diagnoseCode, or spawn further agents.\n\nSub-task: ${taskDescription}\n\nUse searchFiles, findFiles, outlineFile, readSymbol, and small readFile windows. When done, respond with file paths, line numbers, and a short summary.`;
        const subInput: SakiChatRequest = {
          ...runtime.input,
          message: subPrompt,
          history: [],
          mode: "agent"
        };
        if (runtime.input.agentPermissionMode !== undefined) {
          subInput.agentPermissionMode = runtime.input.agentPermissionMode;
        }
        const subRuntime: SakiAgentRuntime = {
          ...runtime,
          input: subInput,
          toolProfile: "research",
          maxLoops: maxSteps,
          usedToolNames: []
        };
        try {
          const { runSakiAgent } = await import("./loop.js");
          const subResult = await runSakiAgent(subRuntime, undefined, undefined, executeSakiAgentTool);
          observation = `Sub-agent result: ${subResult.message}`;
        } catch (error) {
          ok = false;
          observation = `Sub-agent failed: ${userFacingError(error)}`;
        }
      } else if (toolName === "applypatch" || toolName === "apply_patch" || toolName === "applydiff" || toolName === "patchfiles") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const patch = rawStringArg(args, "patch");
        const files = parseWorkspacePatch(patch);
        const results: string[] = [];
        const batchCheckpoints: SakiCheckpoint[] = [];
        const afterByPath = new Map<string, string>();
        let failed = 0;
        for (const file of files) {
          batchCheckpoints.push(await createFileCheckpoint(currentActionId, instance, file.path, runtime));
          if (file.kind === "delete") {
            await deleteDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, { path: file.path });
            invalidateInstanceFileCache(instance.id, file.path);
            recordWorkingFileAccess(runtime.userId, instance.id, file.path);
            results.push(`✓ deleted ${file.path}`);
            continue;
          }
          let original = "";
          if (file.kind === "update") {
            original = (await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, file.path)).content;
          }
          try {
            const next = applyPatchToContent(original, file.unified, file.path);
            const sanitized = sanitizeAgentTextContent(next);
            const written = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
              path: file.path,
              content: sanitized.content
            });
            afterByPath.set(file.path, sanitized.content);
            recordInstanceFileRead(instance.id, file.path, {
              content: sanitized.content,
              size: written.size,
              modifiedAt: new Date().toISOString()
            });
            recordWorkingFileAccess(runtime.userId, instance.id, file.path);
            results.push(`✓ ${file.kind} ${file.path}${formatSanitizedWriteNote(sanitized.removed)}`);
          } catch (error) {
            failed += 1;
            const startLine = Math.max(1, patchHunkStartLine(file.unified) - 12);
            let snippet = original.slice(0, 1600);
            try {
              snippet = formatLineNumberedContent(original, String(startLine), "40").text;
            } catch {
              // Keep the raw head if line numbers are out of range.
            }
            results.push(
              [
                `✗ ${file.path}: patch did not apply (${error instanceof Error ? error.message : String(error)}).`,
                "Current file around the hunk. Do not re-search the workspace. Emit a fresh unified diff against this exact text:",
                snippet
              ].join("\n")
            );
          }
        }
        checkpoint = batchCheckpoints[0] ?? null;
        relatedCheckpointIds = batchCheckpoints.slice(1).map((item) => item.id);
        if (checkpoint?.type === "file") {
          fileEditAfterContent = afterByPath.get(checkpoint.path) ?? null;
        }
        fileEditPreview = files.map((file) => file.path).join(", ");
        if (failed > 0) {
          ok = false;
          observation = `Patch finished with ${files.length - failed} applied, ${failed} failed:\n${results.join("\n\n")}`;
        } else {
          observation = `Success: applied patch to ${files.length} file(s):\n${results.join("\n")}\n\n${patch.slice(0, 4000)}`;
        }
      } else if (toolName === "batchedit" || toolName === "applypatches" || toolName === "multifileedit" || toolName === "batch_patch") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const editsRaw = coerceEditsArray(args.edits);
        if (editsRaw.length === 0) throw new RouteError("batchEdit requires an array of edits.", 400);

        type BatchEditOp =
          | { path: string; kind: "lines"; startLine: number; endLine: number; replacement: string }
          | { path: string; kind: "text"; oldText: string; newText: string };
        const ops: BatchEditOp[] = [];
        for (const edit of editsRaw) {
          const editObj = objectValue(edit);
          if (!editObj) continue;
          const relativePath = safeRelativePath(editObj.path);
          if (!relativePath) continue;
          if (editObj.startLine !== undefined && editObj.endLine !== undefined) {
            ops.push({
              path: relativePath,
              kind: "lines",
              startLine: parseLineNumber(String(editObj.startLine), "startLine"),
              endLine: parseLineNumber(String(editObj.endLine), "endLine", 0),
              replacement: sanitizeAgentTextContent(rawStringArg(editObj, "replacement")).content
            });
          } else if (editObj.oldText !== undefined && editObj.newText !== undefined) {
            ops.push({
              path: relativePath,
              kind: "text",
              oldText: rawStringArg(editObj, "oldText"),
              newText: sanitizeAgentTextContent(rawStringArg(editObj, "newText")).content
            });
          }
        }
        if (ops.length === 0) throw new RouteError("batchEdit requires at least one valid line or text edit.", 400);

        const byPath = new Map<string, BatchEditOp[]>();
        for (const op of ops) {
          const list = byPath.get(op.path) ?? [];
          list.push(op);
          byPath.set(op.path, list);
        }

        const results: string[] = [];
        const batchCheckpoints: SakiCheckpoint[] = [];
        const afterByPath = new Map<string, string>();
        for (const [relativePath, fileOps] of byPath) {
          batchCheckpoints.push(await createFileCheckpoint(currentActionId, instance, relativePath, runtime));
          let current = (await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath)).content;
          const lineOps = fileOps
            .filter((op): op is Extract<BatchEditOp, { kind: "lines" }> => op.kind === "lines")
            .sort((left, right) => right.startLine - left.startLine);
          for (let i = 1; i < lineOps.length; i += 1) {
            const higher = lineOps[i - 1]!;
            const lower = lineOps[i]!;
            if (lower.endLine >= higher.startLine) {
              throw new RouteError(
                `${relativePath}: overlapping line edits ${lower.startLine}-${lower.endLine} and ${higher.startLine}-${higher.endLine}. Split the batch.`,
                400
              );
            }
          }
          for (const op of lineOps) {
            const edit = replaceLineRange(current, op.startLine, op.endLine, op.replacement);
            current = edit.content;
            results.push(`✓ ${relativePath}: replaced lines ${op.startLine}-${op.endLine} with ${edit.insertedLineCount} lines`);
          }
          for (const op of fileOps) {
            if (op.kind !== "text") continue;
            current = replaceUniqueOccurrence(current, op.oldText, op.newText, relativePath);
            results.push(`✓ ${relativePath}: replaced unique text occurrence`);
          }
          await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: relativePath, content: current });
          afterByPath.set(relativePath, current);
          invalidateInstanceFileCache(instance.id, relativePath);
          recordWorkingFileAccess(runtime.userId, instance.id, relativePath);
        }
        checkpoint = batchCheckpoints[0] ?? null;
        relatedCheckpointIds = batchCheckpoints.slice(1).map((item) => item.id);
        if (checkpoint?.type === "file") {
          fileEditAfterContent = afterByPath.get(checkpoint.path) ?? null;
        }
        fileEditPreview = [...byPath.keys()].join(", ");
        observation = `Success: batch edit applied across ${results.length} operation(s):\n${results.join("\n")}`;
      } else if (toolName === "statfile" || toolName === "fileinfo" || toolName === "inspectpath" || toolName === "stat") {
        requireUserPermission(runtime.permissions, "file.view");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("statFile requires a path.", 400);
        try {
          const stats = await statDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, relativePath);
          if (stats.isDirectory) {
            observation = `Directory: ${relativePath}\nExists: true\nisDirectory: true\nModified: ${stats.modifiedAt || "unknown"}`;
          } else {
            observation = [
              `File: ${relativePath}`,
              "Exists: true",
              `Size: ${stats.size} bytes`,
              `Total Lines: ${stats.totalLines ?? "unknown (file too large to count)"}`,
              `Modified: ${stats.modifiedAt || "unknown"}`,
              "isDirectory: false"
            ].join("\n");
          }
        } catch (err) {
          observation = `Path: ${relativePath}\nExists: false\nError: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else if (toolName === "gitstatus" || toolName === "git_status") {
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const runResult = await runDaemonInstanceCommand(instance.node, instance.id, {
          command: "git status -s -b",
          workingDirectory: instance.workingDirectory,
          timeoutMs: 15000
        });
        if (runResult.exitCode === 0) {
          observation = `Git Status:\n${runResult.stdout?.trim() || "Working tree clean"}`;
        } else {
          observation = `Git status could not be retrieved (${runResult.stderr || runResult.stdout || "Not a git repository"}).`;
        }
      } else if (toolName === "gitdiff" || toolName === "git_diff" || toolName === "diff") {
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const targetPath = safeRelativePath(args.path);
        const staged = booleanArg(args, "staged", false) ? " --staged" : "";
        const command = `git diff${staged}${targetPath ? ` -- "${targetPath}"` : ""}`;
        const runResult = await runDaemonInstanceCommand(instance.node, instance.id, {
          command,
          workingDirectory: instance.workingDirectory,
          timeoutMs: 20000
        });
        if (runResult.exitCode === 0) {
          const diffText = runResult.stdout?.trim();
          observation = diffText ? truncateText(diffText, 10000) : "No git diff (no changes detected).";
        } else {
          observation = `Git diff failed (${runResult.stderr || runResult.stdout || "error"}).`;
        }
      } else if (toolName === "getenvironmentinfo" || toolName === "envinfo" || toolName === "systeminfo") {
        const instance = await resolveAgentInstance(runtime, args);
        const cachedEnv = environmentInfoCache.get(instance.id);
        if (cachedEnv && Date.now() - cachedEnv.at < environmentInfoCacheTtlMs) {
          observation = `${cachedEnv.text}\n\n[cached environment probe]`;
        } else {
          const probeCmd = nodeLooksWindows(instance)
            ? "echo OS=%OS% ARCH=%PROCESSOR_ARCHITECTURE% & node -v & npm -v & git --version"
            : "uname -srm; node -v; npm -v; git --version";
          const runResult = await runDaemonInstanceCommand(instance.node, instance.id, {
            command: probeCmd,
            workingDirectory: instance.workingDirectory,
            timeoutMs: 8000
          });
          observation = [
            "Environment & Runtime Detection:",
            `Node OS: ${instance.node.os || "unknown"} (${instance.node.arch || "unknown"})`,
            `Detected Output:\n${(runResult.stdout || "").trim() || "(None)"}`
          ].join("\n\n");
          environmentInfoCache.set(instance.id, { text: observation, at: Date.now() });
        }
      } else if (toolName === "readsymbol" || toolName === "viewsymbol" || toolName === "getsymbol" || toolName === "inspectsymbol" || toolName === "viewfunction" || toolName === "read_symbol" || toolName === "extractsymbol") {
        requireUserPermission(runtime.permissions, "file.read");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        const targetSymbol = stringArg(args, "symbol");
        if (!relativePath || !targetSymbol) throw new RouteError("readSymbol requires path and symbol.", 400);
        recordWorkingFileAccess(runtime.userId, instance.id, relativePath);

        const escaped = targetSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const located = await grepDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, {
          workingDirectory: instance.workingDirectory,
          path: relativePath,
          pattern: `(function|class|interface|type|enum|def|fn|func|const|let|var)\\s+${escaped}\\b|${escaped}\\s*=\\s*(?:async\\s+)?(?:function|\\()`,
          maxResults: 8,
          contextLines: 0
        });
        const hit = located.matches[0];
        if (!hit) {
          throw new RouteError(`Symbol '${targetSymbol}' not found in ${relativePath}. Try searchFiles({ pattern: "${targetSymbol}", path: "${relativePath}" }).`, 404);
        }

        const windowStart = Math.max(1, hit.line);
        const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath, {
          startLine: windowStart,
          lineCount: 80
        });
        const lines = file.content.length === 0 ? [] : file.content.split(/\r?\n/);
        const startLineIdx = 0;

        let endLineIdx = startLineIdx;
        let braceCount = 0;
        let foundOpenBrace = false;

        for (let i = startLineIdx; i < lines.length; i++) {
          const line = lines[i]!;
          for (const char of line) {
            if (char === "{") {
              braceCount++;
              foundOpenBrace = true;
            } else if (char === "}") {
              braceCount--;
            }
          }
          if (foundOpenBrace && braceCount <= 0) {
            endLineIdx = i;
            break;
          }
          if (i - startLineIdx >= 300) {
            endLineIdx = i;
            break;
          }
        }

        if (!foundOpenBrace) {
          const initialIndent = lines[startLineIdx]!.match(/^\s*/)?.[0].length ?? 0;
          for (let i = startLineIdx + 1; i < lines.length; i++) {
            const line = lines[i]!;
            if (line.trim().length === 0) continue;
            const currentIndent = line.match(/^\s*/)?.[0].length ?? 0;
            if (currentIndent <= initialIndent && !line.trim().startsWith("#") && !line.trim().startsWith("//")) {
              endLineIdx = i - 1;
              break;
            }
            if (i - startLineIdx >= 150) {
              endLineIdx = i;
              break;
            }
          }
        }

        const startLineNum = windowStart;
        const endLineNum = windowStart + endLineIdx;
        const snippetLines = lines.slice(startLineIdx, endLineIdx + 1);
        const formattedSnippet = snippetLines
          .map((line, idx) => `${String(startLineNum + idx).padStart(5, " ")}: ${line}`)
          .join("\n");

        observation = [
          `Symbol: ${targetSymbol}`,
          `File: ${relativePath} (Lines ${startLineNum} - ${endLineNum}, ${snippetLines.length} lines)`,
          "",
          formattedSnippet,
          "",
          `Tip: Use editLines({ path: "${relativePath}", startLine: ${startLineNum}, endLine: ${endLineNum}, replacement: "..." }) to modify this symbol directly.`
        ].join("\n");
      } else if (toolName === "plan") {
        const steps = rawStringArg(args, "steps");
        const summary = rawStringArg(args, "summary");
        if (!steps) throw new RouteError("plan requires steps.", 400);
        observation = `Plan: ${summary || "Task plan"}\n\n${steps}\n\nAwaiting user confirmation to proceed.`;
      } else if (toolName === "respond") {
        observation = rawStringArg(args, "text");
      } else {
        throw new RouteError(`Unknown tool '${tool}'.`, 400);
      }
    } catch (error) {
      ok = false;
      observation = userFacingError(error);
    }

    const approval = checkpoint
      ? fileEditAfterContent !== null && (checkpoint.type === "file" || fileEditBeforeContent !== null)
        ? buildCompletedFileEditApproval(
            checkpoint.type === "file"
              ? checkpoint
              : fileDiffSnapshotFromCheckpoint(checkpoint, fileEditBeforeContent ?? ""),
            fileEditAfterContent,
            fileEditPreview,
            relatedCheckpointIds
          )
        : buildCheckpointApproval(checkpoint, fileEditPreview, relatedCheckpointIds)
      : undefined;
    const action: SakiAgentAction = {
      id: currentActionId,
      tool,
      args,
      observation: truncateText(redactSensitiveText(observation)),
      ok,
      status: ok ? "completed" : "failed",
      ...(approval ? { approval } : {}),
      createdAt: startedAt
    };
    completedSakiActions.set(action.id, action);
    await auditAgentTool(runtime, action);
    return action;
  }
}

export async function loadWorkspaceGitSummary(runtime: SakiAgentRuntime): Promise<string> {
  const instance = runtime.context.instance;
  if (!instance) return "";
  try {
    const runResult = await runDaemonInstanceCommand(instance.node, instance.id, {
      command: "git status -sb",
      workingDirectory: instance.workingDirectory,
      timeoutMs: 8000
    });
    const text = [runResult.stdout, runResult.stderr].filter(Boolean).join("\n").trim();
    if (!text || /not a git repository/i.test(text)) return "";
    return text.slice(0, 1200);
  } catch {
    return "";
  }
}
