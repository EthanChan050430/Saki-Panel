import path from "node:path";
import { createPatch } from "diff";
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
  saveCheckpoint,
  savePendingSakiAction
} from "./state.js";
import type { InstanceWithNode, ParsedToolCall, PendingSakiAction, SakiAgentResumeState, SakiAgentRuntime, SakiCheckpoint, SakiSkillDocument, SakiSkillSummary } from "./types.js";
import {
  actionId,
  agentReadFileLineCountInput,
  checkpointId,
  checkpointPathSegment,
  defaultAgentReadFileLineCount,
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
  optionalCommandInputArg,
  parseLineNumber,
  rawStringArg,
  redactSensitiveText,
  replaceLineRange,
  requireUserPermission,
  RouteError,
  safeRelativePath,
  sanitizeAgentTextContent,
  stringArg,
  truncateDiff,
  truncateText,
  trimString,
  userFacingError
} from "./types.js";
import {
  assertSakiPermissionModeAllowsTool,
  buildInstanceSettingsPatch,
  instanceSettingsSnapshot,
  shouldRequestSakiApproval,
  toolArgs
} from "./tools.js";

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

function buildCompletedFileEditApproval(
  checkpoint: SakiCheckpoint,
  afterContent: string,
  preview?: string
): NonNullable<SakiAgentAction["approval"]> {
  const pathLabel = checkpoint.type === "file" ? checkpoint.path : checkpoint.type === "softDelete" ? checkpoint.path : "change";
  const beforeContent = checkpoint.type === "file" ? checkpoint.content : checkpoint.type === "softDelete" ? "(file removed)" : "";
  return {
    required: false,
    reason: "已保存检查点，可随时从操作面板回滚此次改动。",
    risk: "medium",
    preview: preview ?? pathLabel,
    diff: unifiedDiff(pathLabel, beforeContent, afterContent),
    checkpointId: checkpoint.id,
    rollbackAvailable: true
  };
}

function buildCheckpointApproval(checkpoint: SakiCheckpoint, preview?: string): NonNullable<SakiAgentAction["approval"]> {
  return {
    required: false,
    reason: "已保存检查点，可随时从操作面板回滚此次改动。",
    risk: checkpoint.type === "softDelete" ? "high" : "medium",
    ...(preview ? { preview } : {}),
    checkpointId: checkpoint.id,
    rollbackAvailable: true
  };
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

async function createFileCheckpoint(actionIdValue: string, instance: InstanceWithNode, relativePath: string): Promise<SakiCheckpoint> {
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
  await saveCheckpoint(checkpoint);
  return checkpoint;
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
    ...(resume ? { resume } : {})
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
    request: runtime.request,
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

  if (!Array.isArray(call.args)) {
    const args = toolArgs(call);
    const currentActionId = options.actionId || call.id || actionId();
    let checkpoint: SakiCheckpoint | null = null;
    let fileEditAfterContent: string | null = null;
    let fileEditBeforeContent: string | null = null;
    let fileEditPreview: string | undefined;

    try {
      assertSakiPermissionModeAllowsTool(runtime, toolName, args);
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
        const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
        const numbered = formatLineNumberedContent(
          file.content,
          stringArg(args, "startLine") || undefined,
          agentReadFileLineCountInput(args.lineCount)
        );
        observation = [
          `File: ${file.path}`,
          `Size: ${file.size} bytes`,
          `Modified: ${file.modifiedAt}`,
          `Total lines: ${numbered.totalLines}`,
          numbered.totalLines > 0 ? `Showing lines: ${numbered.startLine}-${numbered.endLine}` : "Showing lines: none",
          numbered.endLine < numbered.totalLines ? `More lines available. Call readFile with startLine=${numbered.endLine + 1} and lineCount=${defaultAgentReadFileLineCount} if needed.` : null,
          "",
          truncateText(numbered.text, 7000)
        ].filter(Boolean).join("\n");
      } else if (toolName === "writefile") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        if (!relativePath) throw new RouteError("writeFile requires a file path.", 400);
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
        fileEditPreview = `${instance.name}:${relativePath}`;
        const sanitized = sanitizeAgentTextContent(rawStringArg(args, "content"));
        fileEditAfterContent = sanitized.content;
        const file = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: relativePath, content: sanitized.content });
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
        const count = file.content.split(oldText).length - 1;
        if (count === 0) throw new RouteError("oldText was not found in the file.", 400);
        if (count > 1) throw new RouteError(`oldText matched ${count} times. Use editLines with exact line numbers.`, 400);
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
        fileEditPreview = `${instance.name}:${relativePath}`;
        fileEditAfterContent = file.content.replace(oldText, () => sanitized.content);
        const updated = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
          path: relativePath,
          content: fileEditAfterContent
        });
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
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
        fileEditPreview = `${instance.name}:${relativePath}`;
        fileEditAfterContent = edit.content;
        const updated = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: relativePath, content: edit.content });
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
        checkpoint = { id: checkpointId(), type: "softDelete", instanceId: instance.id, path: relativePath, backupPath, actionId: currentActionId, createdAt: new Date().toISOString() };
        await saveCheckpoint(checkpoint);
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
        observation = `Success: renamed to ${entry.path}.`;
      } else if (toolName === "uploadbase64") {
        requireUserPermission(runtime.permissions, "file.write");
        const instance = await resolveAgentInstance(runtime, args);
        const relativePath = safeRelativePath(args.path);
        const contentBase64 = stringArg(args, "contentBase64");
        if (!relativePath || !contentBase64) throw new RouteError("uploadBase64 requires path and base64 content.", 400);
        checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
        fileEditPreview = `${instance.name}:${relativePath}`;
        const entry = await uploadDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: relativePath, contentBase64, overwrite: true });
        try {
          const uploaded = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
          fileEditAfterContent = uploaded.content;
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
        const input = optionalCommandInputArg(args);
        const { daemonWorkingDirectory } = commandWorkingDirectoryForAgent(instance, args);
        const result = await runDaemonInstanceCommand(instance.node, instance.id, {
          command,
          workingDirectory: daemonWorkingDirectory,
          timeoutMs,
          ...(input !== undefined ? { input } : {})
        });
        if (result.exitCode !== 0) ok = false;
        observation = formatRunCommandObservation({ ...result, signal: result.signal ?? null }, input !== undefined);
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
          await saveCheckpoint(checkpoint);
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
        await saveCheckpoint(checkpoint);
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
        await saveCheckpoint(checkpoint);
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
        await saveCheckpoint(checkpoint);
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
        const run = await executeScheduledTask(taskId, { trigger: "manual", request: runtime.request, userId: runtime.userId });
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
        const maxResults = numericArg(args.maxResults, 100, 1, 500);
        const result = await grepDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, {
          workingDirectory: instance.workingDirectory,
          pattern,
          ...(searchPath ? { path: searchPath } : {}),
          ...(include ? { include } : {}),
          maxResults
        });
        observation = [
          result.matches.length > 0
            ? result.matches.map((match) => `${match.file}:${match.line}${match.column ? `:${match.column}` : ""}: ${match.text}`).join("\n")
            : "No matches found.",
          result.truncated ? `\nResults truncated. ${result.totalMatches} total matches found. Narrow your pattern or reduce maxResults.` : null,
          `\nSearched ${result.filesSearched} files, found ${result.totalMatches} matches.`
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
      } else if (toolName === "spawntask" || toolName === "subagent" || toolName === "delegate" || toolName === "runsubtask") {
        if (runtime.input.message?.startsWith("You are a sub-agent")) {
          throw new RouteError("Sub-agents cannot spawn further sub-agents.", 400);
        }
        const taskDescription = rawStringArg(args, "task");
        if (!taskDescription) throw new RouteError("spawnTask requires a task description.", 400);
        const maxSteps = numericArg(args.maxSteps, 8, 1, 15);
        const subPrompt = `You are a sub-agent of Saki, handling a specific sub-task independently.\n\nSub-task: ${taskDescription}\n\nComplete this sub-task efficiently. Use the available tools as needed. When done, call respond with your findings or result. Keep your answer focused on the sub-task.`;
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
          input: subInput
        };
        try {
          const { runSakiAgent } = await import("./loop.js");
          const subResult = await runSakiAgent(subRuntime, undefined, undefined, executeSakiAgentTool);
          observation = `Sub-agent result: ${subResult.message}`;
        } catch (error) {
          ok = false;
          observation = `Sub-agent failed: ${userFacingError(error)}`;
        }
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
            fileEditPreview
          )
        : buildCheckpointApproval(checkpoint, fileEditPreview)
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

  const currentActionId = options.actionId || call.id || actionId();
  let checkpoint: SakiCheckpoint | null = null;
  let fileEditAfterContent: string | null = null;
  let fileEditBeforeContent: string | null = null;
  let fileEditPreview: string | undefined;

  try {
    if (toolName === "listinstances") {
      requireUserPermission(runtime.permissions, "instance.view");
      const instances = await listVisibleInstances(runtime.userId, 30);
      observation = instances.map(formatInstanceSummary).join("\n\n") || "No instances found.";
    } else if (toolName === "describeinstance") {
      requireUserPermission(runtime.permissions, "instance.view");
      const lookup = trimString(call.args[0]);
      const instance =
        lookup
          ? await findInstanceByLookup(runtime.userId, lookup)
          : runtime.context.instance;
      if (!instance) throw new RouteError("Instance not found.", 404);
      observation = formatInstanceSummary(instance);
    } else if (toolName === "instancelogs") {
      requireUserPermission(runtime.permissions, "instance.logs");
      const instance = activeInstance(runtime);
      const lines = numericArg(call.args[0], 120, 1, 500);
      const logs = await readDaemonInstanceLogs(instance.node, instance.id, lines);
      await updateInstanceFromDaemonState(instance, logs);
      observation = logs.lines.map((line) => `[${line.stream}] ${line.text}`).join("\n") || "No logs available.";
    } else if (toolName === "listfiles") {
      requireUserPermission(runtime.permissions, "file.view");
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      const limit = numericArg(call.args[1], 200, 1, 1000);
      const files = await listDaemonInstanceFiles(instance.node, instance.id, instance.workingDirectory, relativePath, { limit });
      observation = [
        files.entries.map((entry) => `${entry.type === "directory" ? "[DIR]" : "[FILE]"} ${entry.path || entry.name} ${entry.size ? `(${entry.size} bytes)` : ""}`).join("\n") || "Directory is empty.",
        files.truncated
          ? `\nShowing ${files.entries.length} of ${files.totalEntries ?? "many"} entries. Narrow path or call listFiles with a higher limit if needed.`
          : null
      ].filter(Boolean).join("\n");
    } else if (toolName === "readfile") {
      requireUserPermission(runtime.permissions, "file.read");
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      if (!relativePath) throw new RouteError("readFile requires a file path.", 400);
      const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
      const numbered = formatLineNumberedContent(file.content, call.args[1], agentReadFileLineCountInput(call.args[2]));
      observation = [
        `File: ${file.path}`,
        `Size: ${file.size} bytes`,
        `Modified: ${file.modifiedAt}`,
        `Total lines: ${numbered.totalLines}`,
        numbered.totalLines > 0 ? `Showing lines: ${numbered.startLine}-${numbered.endLine}` : "Showing lines: none",
        numbered.endLine < numbered.totalLines ? `More lines available. Call readFile with startLine=${numbered.endLine + 1} and lineCount=${defaultAgentReadFileLineCount} if needed.` : null,
        "",
        truncateText(numbered.text, 7000)
      ].filter(Boolean).join("\n");
    } else if (toolName === "writefile") {
      requireUserPermission(runtime.permissions, "file.write");
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      const sanitized = sanitizeAgentTextContent(call.args[1] ?? "");
      if (!relativePath) throw new RouteError("writeFile requires a file path.", 400);
      checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
      fileEditPreview = `${instance.name}:${relativePath}`;
      fileEditAfterContent = sanitized.content;
      const file = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
        path: relativePath,
        content: sanitized.content
      });
      observation = `Success: wrote ${file.path} (${file.size} bytes).${formatSanitizedWriteNote(sanitized.removed)}`;
    } else if (toolName === "replaceinfile") {
      requireUserPermission(runtime.permissions, "file.write");
      requireUserPermission(runtime.permissions, "file.read");
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      const oldText = call.args[1] ?? "";
      const sanitized = sanitizeAgentTextContent(call.args[2] ?? "");
      if (!relativePath || !oldText) throw new RouteError("replaceInFile requires path and oldText.", 400);
      const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
      const count = file.content.split(oldText).length - 1;
      if (count === 0) throw new RouteError("oldText was not found in the file.", 400);
      if (count > 1) throw new RouteError(`oldText matched ${count} times. Use writeFile with the full intended content or a more specific oldText.`, 400);
      checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
      fileEditPreview = `${instance.name}:${relativePath}`;
      fileEditAfterContent = file.content.replace(oldText, () => sanitized.content);
      const updated = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
        path: relativePath,
        content: fileEditAfterContent
      });
      observation = `Success: replaced text in ${updated.path} (${updated.size} bytes).${formatSanitizedWriteNote(sanitized.removed)}`;
    } else if (toolName === "editlines" || toolName === "editfilelines" || toolName === "replacelines") {
      requireUserPermission(runtime.permissions, "file.write");
      requireUserPermission(runtime.permissions, "file.read");
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      const startLine = parseLineNumber(call.args[1], "startLine");
      const endLine = parseLineNumber(call.args[2], "endLine", 0);
      const sanitized = sanitizeAgentTextContent(call.args[3] ?? "");
      if (!relativePath) throw new RouteError("editLines requires a file path.", 400);
      const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
      const edit = replaceLineRange(file.content, startLine, endLine, sanitized.content);
      checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
      fileEditPreview = `${instance.name}:${relativePath}`;
      fileEditAfterContent = edit.content;
      const updated = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
        path: relativePath,
        content: edit.content
      });
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
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      if (!relativePath) throw new RouteError("mkdir requires a path.", 400);
      const entry = await makeDaemonInstanceDirectory(instance.node, instance.id, instance.workingDirectory, { path: relativePath });
      observation = `Success: directory ready at ${entry.path}.`;
    } else if (toolName === "deletepath") {
      requireUserPermission(runtime.permissions, "file.delete");
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      if (!relativePath) throw new RouteError("Refusing to delete the instance working directory root.", 400);
      const beforeDelete = await readFileForCheckpoint(instance, relativePath);
      const trashSegment = checkpointPathSegment(currentActionId);
      const backupPath = `.webops-saki-trash/${trashSegment}/${path.basename(relativePath)}`;
      await makeDaemonInstanceDirectory(instance.node, instance.id, instance.workingDirectory, { path: `.webops-saki-trash/${trashSegment}` });
      await renameDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, { fromPath: relativePath, toPath: backupPath });
      checkpoint = { id: checkpointId(), type: "softDelete", instanceId: instance.id, path: relativePath, backupPath, actionId: currentActionId, createdAt: new Date().toISOString() };
      await saveCheckpoint(checkpoint);
      if (beforeDelete.existed) {
        fileEditPreview = `${instance.name}:${relativePath}`;
        fileEditBeforeContent = beforeDelete.content;
        fileEditAfterContent = "";
      }
      observation = `Success: moved ${relativePath} to a rollback checkpoint.`;
    } else if (toolName === "renamepath") {
      requireUserPermission(runtime.permissions, "file.write");
      const instance = activeInstance(runtime);
      const fromPath = safeRelativePath(call.args[0]);
      const toPath = safeRelativePath(call.args[1]);
      if (!fromPath || !toPath) throw new RouteError("renamePath requires fromPath and toPath.", 400);
      const entry = await renameDaemonInstancePath(instance.node, instance.id, instance.workingDirectory, { fromPath, toPath });
      observation = `Success: renamed to ${entry.path}.`;
    } else if (toolName === "uploadbase64") {
      requireUserPermission(runtime.permissions, "file.write");
      const instance = activeInstance(runtime);
      const relativePath = safeRelativePath(call.args[0]);
      const contentBase64 = trimString(call.args[1]);
      if (!relativePath || !contentBase64) throw new RouteError("uploadBase64 requires path and base64 content.", 400);
      checkpoint = await createFileCheckpoint(currentActionId, instance, relativePath);
      fileEditPreview = `${instance.name}:${relativePath}`;
      const entry = await uploadDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, {
        path: relativePath,
        contentBase64,
        overwrite: true
      });
      try {
        const uploaded = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, relativePath);
        fileEditAfterContent = uploaded.content;
      } catch {
        fileEditAfterContent = "(binary upload)";
      }
      observation = `Success: uploaded ${entry.path} (${entry.size} bytes).`;
    } else if (toolName === "runcommand" || toolName === "executecommand" || toolName === "terminal" || toolName === "shell") {
      requireUserPermission(runtime.permissions, "terminal.input");
      const instance = activeInstance(runtime);
      const command = trimString(call.args[0]);
      if (!command) throw new RouteError("runCommand requires a command.", 400);
      const blocked = findDangerousCommandReason(command);
      if (blocked) throw new RouteError(blocked, 400);
      const timeoutMs = numericArg(call.args[1], 30000, 1000, 120000);
      const input = typeof call.args[2] === "string" ? call.args[2] : undefined;
      const { daemonWorkingDirectory } = commandWorkingDirectoryForAgent(instance, {
        ...(typeof call.args[3] === "string" ? { cwd: call.args[3] } : {})
      });
      const result = await runDaemonInstanceCommand(instance.node, instance.id, {
        command,
        workingDirectory: daemonWorkingDirectory,
        timeoutMs,
        ...(input !== undefined ? { input } : {})
      });
      if (result.exitCode !== 0) ok = false;
      observation = formatRunCommandObservation({ ...result, signal: result.signal ?? null }, input !== undefined);
    } else if (toolName === "sendinput") {
      requireUserPermission(runtime.permissions, "terminal.input");
      const instance = activeInstance(runtime);
      const input = consoleInputFromArgs({
        text: call.args[0] ?? "",
        pressEnter: call.args[1] === undefined ? true : trimString(call.args[1]) !== "false",
        echo: call.args[2] === undefined ? true : trimString(call.args[2]) !== "false"
      });
      const state = await sendDaemonInstanceInput(instance.node, instance.id, input.data, { echo: input.echo });
      await updateInstanceFromDaemonState(instance, state);
      observation = formatConsoleInputObservation("Console input", input, state);
    } else if (toolName === "sendcommand") {
      requireUserPermission(runtime.permissions, "terminal.input");
      const instance = activeInstance(runtime);
      const input = commandLineInputFromArgs({ command: call.args[0] ?? "" });
      const state = await sendDaemonInstanceInput(instance.node, instance.id, input.data, { echo: input.echo });
      await updateInstanceFromDaemonState(instance, state);
      observation = `${formatConsoleInputObservation("Command line", input, state)} For normal terminal commands, use runCommand(command).`;
    } else if (toolName === "listshells") {
      requireUserPermission(runtime.permissions, "terminal.view");
      const instance = activeInstance(runtime);
      const shells = await listDaemonInstanceShells(instance.node, instance.id);
      observation = shells.sessions.length ? `Open shells: ${shells.sessions.join(", ")}` : "No persistent shells open. Use createShell to open one.";
    } else if (toolName === "createshell") {
      requireUserPermission(runtime.permissions, "terminal.input");
      const instance = activeInstance(runtime);
      const { daemonWorkingDirectory } = commandWorkingDirectoryForAgent(instance, { ...(typeof call.args[0] === "string" ? { cwd: call.args[0] } : {}) });
      // Note: create uses working dir from spec or body
      const result = await createDaemonInstanceShell(instance.node, instance.id, daemonWorkingDirectory);
      observation = `Created persistent shell ${result.sessionId}. Use runInShell or sendShellInput with this shellId.`;
    } else if (toolName === "sendshellinput") {
      requireUserPermission(runtime.permissions, "terminal.input");
      const instance = activeInstance(runtime);
      const shellId = trimString(call.args[0]);
      const text = trimString(call.args[1]);
      if (!shellId || !text) throw new RouteError("sendShellInput requires shellId and text.", 400);
      const pressEnter = call.args[2] === undefined ? true : trimString(call.args[2]) !== "false";
      const data = pressEnter ? (text.endsWith("\n") ? text : text + "\n") : text;
      await sendDaemonShellInput(instance.node, instance.id, shellId, data);
      observation = `Sent to shell ${shellId}: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`;
    } else if (toolName === "runinshell") {
      requireUserPermission(runtime.permissions, "terminal.input");
      const instance = activeInstance(runtime);
      const shellId = trimString(call.args[0]);
      const command = trimString(call.args[1]);
      if (!shellId || !command) throw new RouteError("runInShell requires shellId and command.", 400);
      const timeoutMs = numericArg(call.args[2], 30000, 1000, 120000);
      const data = command.endsWith("\n") ? command : command + "\n";
      await sendDaemonShellInput(instance.node, instance.id, shellId, data);
      observation = `Executed in persistent shell ${shellId} (cwd may differ): ${command}\n\nNote: Full output streams to the corresponding UI shell tab (shell${shellId} or similar). Use listShells to see tabs. For agent-visible output, prefer runCommand for one-shots.`;
    } else if (toolName === "instanceaction") {
      const instance = activeInstance(runtime);
      const action = trimString(call.args[0]).toLowerCase();
      if (action !== "start" && action !== "stop" && action !== "restart" && action !== "kill") {
        throw new RouteError("instanceAction supports start, stop, restart, or kill.", 400);
      }
      requireUserPermission(runtime.permissions, `instance.${action}` as PermissionCode);
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
    } else if (toolName === "searchaudit") {
      requireUserPermission(runtime.permissions, "audit.view");
      observation = await requireExecutorHost().buildAuditSearchContext(call.args[0] ?? runtime.input.message, true);
    } else if (toolName === "listtasks") {
      requireUserPermission(runtime.permissions, "task.view");
      const tasks = await listScheduledTasks();
      observation = tasks.map((task) => `${task.id} | ${task.name} | ${task.type} | cron=${task.cron} | enabled=${task.enabled} | instance=${task.instanceName ?? task.instanceId ?? "-"}`).join("\n") || "No scheduled tasks found.";
    } else if (toolName === "runtask") {
      requireUserPermission(runtime.permissions, "task.run");
      const taskId = trimString(call.args[0]);
      if (!taskId) throw new RouteError("runTask requires a task id.", 400);
      const run = await executeScheduledTask(taskId, { trigger: "manual", request: runtime.request, userId: runtime.userId });
      observation = `Task run ${run.id}: ${run.status}\nOutput: ${run.output ?? "-"}\nError: ${run.error ?? "-"}`;
    } else if (toolName === "taskruns") {
      requireUserPermission(runtime.permissions, "task.view");
      const taskId = trimString(call.args[0]);
      if (!taskId) throw new RouteError("taskRuns requires a task id.", 400);
      const runs = await listTaskRuns(taskId);
      observation = runs.map((run) => `${run.id} | ${run.status} | ${run.startedAt} | ${run.output ?? run.error ?? "-"}`).join("\n") || "No task runs found.";
    } else if (toolName === "searchweb" || toolName === "websearch") {
      if (!runtime.config.searchEnabled) throw new RouteError("Web search is disabled in Saki settings.", 403);
      observation = await requireExecutorHost().simpleWebSearch(call.args[0] ?? runtime.input.message, call.args[1]);
    } else if (toolName === "browse" || toolName === "browseurl" || toolName === "readurl" || toolName === "fetchpage") {
      if (!runtime.config.searchEnabled) throw new RouteError("Web browsing is disabled in Saki settings.", 403);
      observation = await requireExecutorHost().browsePublicUrl(call.args[0] ?? "");
    } else if (toolName === "crawl" || toolName === "crawlweb" || toolName === "crawlsite") {
      if (!runtime.config.searchEnabled) throw new RouteError("Web crawling is disabled in Saki settings.", 403);
      observation = await requireExecutorHost().crawlPublicSite(call.args[0] ?? "", call.args[1], call.args[2]);
  } else if (toolName === "researchweb" || toolName === "webresearch") {
    if (!runtime.config.searchEnabled) throw new RouteError("Web research is disabled in Saki settings.", 403);
    observation = await requireExecutorHost().researchWeb(call.args[0] ?? runtime.input.message, call.args[1]);
  } else if (toolName === "listskills") {
    observation =
      runtime.skills
        .map((skill) => `${skill.id}: ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`)
        .join("\n") || "No skills available.";
    if (observation !== "No skills available.") {
      observation += "\n\nThese are summaries only. Call searchSkills(query) for task-specific matches, then readSkill(skillId) before applying a skill.";
    }
  } else if (toolName === "searchskills" || toolName === "findskills" || toolName === "matchskills") {
    const { rankSkillsForQuery, formatSkillSearchLine, toSkillSummary } = await import("./skills.js");
    const query = call.args[0] ?? runtime.input.message;
    const ranked = await rankSkillsForQuery(query, { limit: 12 });
    observation =
      ranked.map((item) => formatSkillSearchLine(toSkillSummary(item.skill), item.score)).join("\n") ||
      "No matching skills found.";
    if (observation !== "No matching skills found.") {
      observation += "\n\nCall readSkill(skillId) for any high/medium relevance skill before making changes.";
    }
  } else if (toolName === "readskill" || toolName === "loadskill" || toolName === "useskill" || toolName === "getskill" || toolName === "applyskill") {
    observation = requireExecutorHost().formatSkillForAgent(await requireExecutorHost().readSakiSkill(call.args[0] ?? "", false));
  } else if (toolName === "readmemory" || toolName === "getmemory" || toolName === "loadmemory") {
    requireUserPermission(runtime.permissions, "file.read");
    const instance = activeInstance(runtime);
    try {
      const file = await readDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, "SAKI.md");
      observation = `Project memory (SAKI.md):\n\n${file.content}`;
    } catch {
      observation = "No project memory file (SAKI.md) found. You can create one with writeMemory to save project conventions and preferences.";
    }
  } else if (toolName === "writememory" || toolName === "updatememory" || toolName === "savememory") {
    requireUserPermission(runtime.permissions, "file.write");
    const instance = activeInstance(runtime);
    const content = trimString(call.args[0]);
    if (!content) throw new RouteError("writeMemory requires content.", 400);
    const sanitized = sanitizeAgentTextContent(content);
    const file = await writeDaemonInstanceFile(instance.node, instance.id, instance.workingDirectory, { path: "SAKI.md", content: sanitized.content });
    observation = `Success: wrote project memory to SAKI.md (${file.size} bytes).${formatSanitizedWriteNote(sanitized.removed)}`;
  } else if (toolName === "reportprogress" || toolName === "progress" || toolName === "statusupdate") {
    observation = call.args[0] ?? "";
  } else if (toolName === "respond") {
    observation = call.args[0] ?? "";
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
          fileEditPreview
        )
      : buildCheckpointApproval(checkpoint, fileEditPreview)
    : undefined;
  const action: SakiAgentAction = {
    id: currentActionId,
    tool,
    args: Array.isArray(call.args) ? { legacyArgs: call.args } : call.args,
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
