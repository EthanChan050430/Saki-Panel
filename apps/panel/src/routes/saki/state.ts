import fs from "node:fs/promises";
import path from "node:path";
import type { SakiAgentAction, SakiChatRequest, SakiChatResponse } from "@webops/shared";
import { panelPaths } from "../../config.js";
import type {
  PendingSakiAction,
  SakiActiveTask,
  SakiActiveTaskEvent,
  SakiActiveTaskSummary,
  SakiCheckpoint,
  SakiSessionAgentMemory
} from "./types.js";
import { trimString } from "./types.js";

export const pendingSakiActions = new Map<string, PendingSakiAction>();
export const completedSakiActions = new Map<string, SakiAgentAction>();
export const sakiCheckpoints = new Map<string, SakiCheckpoint>();
export const sessionAgentMemories = new Map<string, SakiSessionAgentMemory>();
const sessionMemoryTtlMs = 30 * 60 * 1000; // 30 minutes session memory

const checkpointsDir = path.join(panelPaths.dataDir, "saki-checkpoints");
const pendingActionsDir = path.join(panelPaths.dataDir, "saki-pending-actions");
const completedActionsDir = path.join(panelPaths.dataDir, "saki-completed-actions");
const pendingActionTtlMs = 24 * 60 * 60 * 1000;
const completedActionTtlMs = 7 * 24 * 60 * 60 * 1000;

export async function saveCompletedSakiAction(action: SakiAgentAction): Promise<void> {
  completedSakiActions.set(action.id, action);
  try {
    await fs.mkdir(completedActionsDir, { recursive: true });
    await fs.writeFile(path.join(completedActionsDir, `${action.id}.json`), JSON.stringify(action, null, 2), "utf8");
  } catch {}
}

async function loadCompletedSakiActionsFromDisk(): Promise<void> {
  try {
    await fs.mkdir(completedActionsDir, { recursive: true });
    const files = await fs.readdir(completedActionsDir);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(completedActionsDir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const action = JSON.parse(content) as SakiAgentAction;
        if (!action?.id) {
          await fs.rm(filePath, { force: true });
          continue;
        }
        const createdAt = Date.parse(action.createdAt);
        if (Number.isFinite(createdAt) && now - createdAt > completedActionTtlMs) {
          await fs.rm(filePath, { force: true });
          continue;
        }
        completedSakiActions.set(action.id, action);
      } catch {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
      }
    }
  } catch {}
}

export async function savePendingSakiAction(pending: PendingSakiAction): Promise<void> {
  pendingSakiActions.set(pending.id, pending);
  try {
    await fs.mkdir(pendingActionsDir, { recursive: true });
    await fs.writeFile(path.join(pendingActionsDir, `${pending.id}.json`), JSON.stringify(pending, null, 2), "utf8");
  } catch {}
}

export async function removePendingSakiAction(id: string): Promise<void> {
  pendingSakiActions.delete(id);
  try {
    await fs.rm(path.join(pendingActionsDir, `${id}.json`), { force: true });
  } catch {}
}

async function loadPendingSakiActionsFromDisk(): Promise<void> {
  try {
    await fs.mkdir(pendingActionsDir, { recursive: true });
    const files = await fs.readdir(pendingActionsDir);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(pendingActionsDir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const pending = JSON.parse(content) as PendingSakiAction;
        if (!pending?.id || !pending.call || !pending.userId) {
          await fs.rm(filePath, { force: true });
          continue;
        }
        const createdAt = Date.parse(pending.createdAt);
        if (!Number.isFinite(createdAt) || now - createdAt > pendingActionTtlMs) {
          await fs.rm(filePath, { force: true });
          continue;
        }
        pendingSakiActions.set(pending.id, pending);
      } catch {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
      }
    }
  } catch {}
}

export async function saveCheckpoint(checkpoint: SakiCheckpoint): Promise<void> {
  sakiCheckpoints.set(checkpoint.id, checkpoint);
  try {
    await fs.mkdir(checkpointsDir, { recursive: true });
    await fs.writeFile(path.join(checkpointsDir, `${checkpoint.id}.json`), JSON.stringify(checkpoint, null, 2), "utf8");
  } catch {}
}

export async function removeCheckpoint(id: string): Promise<void> {
  sakiCheckpoints.delete(id);
  try {
    await fs.rm(path.join(checkpointsDir, `${id}.json`), { force: true });
  } catch {}
}

async function loadCheckpointsFromDisk(): Promise<void> {
  try {
    await fs.mkdir(checkpointsDir, { recursive: true });
    const files = await fs.readdir(checkpointsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(checkpointsDir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const checkpoint = JSON.parse(content) as SakiCheckpoint;
        sakiCheckpoints.set(checkpoint.id, checkpoint);
      } catch {}
    }
  } catch {}
}

export interface CachedFileEntry {
  content: string;
  size: number;
  modifiedAt: string;
  totalLines: number;
  cachedAt: number;
}

export const instanceFileCache = new Map<string, CachedFileEntry>();
const sessionWorkingFiles = new Map<string, Set<string>>();
const fileCacheTtlMs = 10 * 60 * 1000; // 10 minutes cache per file

function fileCacheKey(instanceId: string, filePath: string): string {
  return `${instanceId}:${filePath.replace(/\\/g, "/").toLowerCase()}`;
}

export function recordInstanceFileRead(
  instanceId: string,
  filePath: string,
  file: { content: string; size: number; modifiedAt: string; totalLines?: number }
): void {
  if (!instanceId || !filePath) return;
  const lines = file.totalLines ?? (file.content.length === 0 ? 0 : file.content.split(/\r?\n/).length);
  instanceFileCache.set(fileCacheKey(instanceId, filePath), {
    content: file.content,
    size: file.size,
    modifiedAt: file.modifiedAt,
    totalLines: lines,
    cachedAt: Date.now()
  });
}

export function getCachedInstanceFile(instanceId: string, filePath: string): CachedFileEntry | null {
  if (!instanceId || !filePath) return null;
  const entry = instanceFileCache.get(fileCacheKey(instanceId, filePath));
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > fileCacheTtlMs) {
    instanceFileCache.delete(fileCacheKey(instanceId, filePath));
    return null;
  }
  return entry;
}

export function invalidateInstanceFileCache(instanceId: string, filePath?: string): void {
  if (!instanceId) return;
  if (filePath) {
    instanceFileCache.delete(fileCacheKey(instanceId, filePath));
  } else {
    const prefix = `${instanceId}:`;
    for (const key of instanceFileCache.keys()) {
      if (key.startsWith(prefix)) {
        instanceFileCache.delete(key);
      }
    }
  }
}

function sessionWorkingFilesKey(userId: string, instanceId: string | null): string {
  return `${userId}:${instanceId || "default"}`;
}

export function recordWorkingFileAccess(userId: string, instanceId: string | null, filePath: string): void {
  if (!filePath) return;
  const key = sessionWorkingFilesKey(userId, instanceId);
  const existing = sessionWorkingFiles.get(key) ?? new Set<string>();
  existing.add(filePath.replace(/\\/g, "/"));
  // Limit to most recent 10 files
  if (existing.size > 10) {
    const first = existing.values().next().value;
    if (first) existing.delete(first);
  }
  sessionWorkingFiles.set(key, existing);
}

export function getRecentWorkingFiles(userId: string, instanceId: string | null): string[] {
  const key = sessionWorkingFilesKey(userId, instanceId);
  const set = sessionWorkingFiles.get(key);
  return set ? [...set] : [];
}

export function saveSessionAgentMemory(memory: SakiSessionAgentMemory): void {
  const key = sessionWorkingFilesKey(memory.userId, memory.instanceId);
  sessionAgentMemories.set(key, {
    ...memory,
    updatedAt: Date.now()
  });
}

export function formatSessionFollowUpContext(memory: SakiSessionAgentMemory): string {
  const lines = [
    "[Prior Agent session — reuse paths and line numbers, do not re-scan unless needed]",
    `Last goal: ${memory.lastGoal}`,
    memory.lastSummary ? `Last summary: ${memory.lastSummary.slice(0, 1200)}` : null,
    memory.todos?.length ? `Todos:\n${memory.todos.join("\n")}` : null,
    memory.workingFiles.length ? `Working files:\n${memory.workingFiles.map((file) => `- ${file}`).join("\n")}` : null
  ].filter(Boolean);
  return lines.join("\n");
}

export function getSessionAgentMemory(userId: string, instanceId: string | null): SakiSessionAgentMemory | null {
  const key = sessionWorkingFilesKey(userId, instanceId);
  const memory = sessionAgentMemories.get(key);
  if (!memory) return null;
  if (Date.now() - memory.updatedAt > sessionMemoryTtlMs) {
    sessionAgentMemories.delete(key);
    return null;
  }
  return memory;
}

export function clearSessionAgentMemory(userId: string, instanceId: string | null): void {
  const key = sessionWorkingFilesKey(userId, instanceId);
  sessionAgentMemories.delete(key);
}

export function extractTodosFromScratchpad(entries: string[]): string[] {
  const todos: string[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] ?? "";
    const todoMatch = entry.match(/<todos>([\s\S]*?)<\/todos>/i) || entry.match(/"todos"\s*:\s*"([^"]+)"/i);
    if (todoMatch?.[1]) {
      const lines = todoMatch[1]
        .split(/\r?\n|\\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- [ ]") || l.startsWith("- [x]"));
      if (lines.length > 0) {
        return lines;
      }
    }
  }
  return todos;
}

export const activeSakiTasks = new Map<string, SakiActiveTask>();
export const activeSakiTasksByContext = new Map<string, string>(); // `${userId}:${instanceId}` -> taskId
const activeTaskTtlMs = 60 * 60 * 1000; // Keep completed task record for 1 hour

export function createActiveSakiTask(
  taskId: string,
  userId: string,
  instanceId: string | null,
  input: SakiChatRequest,
  abortController?: AbortController
): SakiActiveTask {
  const task: SakiActiveTask = {
    id: taskId,
    userId,
    instanceId,
    input,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    eventsBuffer: [],
    ...(abortController ? { abortController } : {}),
    subscribers: new Set()
  };
  activeSakiTasks.set(taskId, task);
  activeSakiTasksByContext.set(sessionWorkingFilesKey(userId, instanceId), taskId);
  return task;
}

export function getActiveSakiTask(userId: string, instanceId?: string | null): SakiActiveTask | null {
  if (instanceId) {
    const contextKey = sessionWorkingFilesKey(userId, instanceId);
    const taskId = activeSakiTasksByContext.get(contextKey);
    if (taskId) {
      const task = activeSakiTasks.get(taskId);
      if (task) {
        const startedAt = Date.parse(task.startedAt);
        if (!Number.isFinite(startedAt) || Date.now() - startedAt <= activeTaskTtlMs) {
          if (task.status === "running") {
            return task;
          }
        }
      }
    }
  }

  // Find any active running task for this user:
  for (const task of activeSakiTasks.values()) {
    if (task.userId === userId && task.status === "running") {
      const startedAt = Date.parse(task.startedAt);
      if (!Number.isFinite(startedAt) || Date.now() - startedAt <= activeTaskTtlMs) {
        return task;
      }
    }
  }

  return null;
}

export function getActiveSakiTaskById(taskId: string): SakiActiveTask | null {
  return activeSakiTasks.get(taskId) ?? null;
}

export function emitActiveSakiTaskEvent(
  taskId: string,
  type: SakiActiveTaskEvent["type"],
  payload: Record<string, unknown>
): void {
  const task = activeSakiTasks.get(taskId);
  if (!task) return;
  task.updatedAt = new Date().toISOString();
  // Coalesce consecutive text-stream events in the replay buffer. A long answer
  // produces hundreds of delta/thinking frames; without merging they would push
  // earlier frames past the cap and a reconnecting client would lose content.
  if ((type === "delta" || type === "thinking") && typeof payload.text === "string") {
    const last = task.eventsBuffer[task.eventsBuffer.length - 1];
    if (last && last.type === type && typeof last.payload.text === "string") {
      last.payload = { ...last.payload, text: `${last.payload.text}${payload.text}` };
      last.ts = Date.now();
      for (const subscriber of task.subscribers) {
        try {
          subscriber({ type, payload, ts: last.ts });
        } catch {}
      }
      return;
    }
  }
  const event: SakiActiveTaskEvent = {
    type,
    payload,
    ts: Date.now()
  };
  task.eventsBuffer.push(event);
  if (task.eventsBuffer.length > 500) {
    task.eventsBuffer.shift();
  }
  for (const subscriber of task.subscribers) {
    try {
      subscriber(event);
    } catch {}
  }
}

export function finishActiveSakiTask(
  taskId: string,
  status: SakiActiveTask["status"],
  response?: SakiChatResponse,
  error?: string
): void {
  const task = activeSakiTasks.get(taskId);
  if (!task) return;
  // A cancelled task is terminal: do not let the still-unwinding agent run
  // overwrite it back to completed/failed or emit a second terminal event.
  if (task.status === "cancelled") return;
  task.status = status;
  task.updatedAt = new Date().toISOString();
  if (response) task.response = response;
  if (error) task.error = error;
  emitActiveSakiTaskEvent(taskId, status === "completed" ? "done" : "error", {
    ...(response ? { response } : {}),
    ...(error ? { message: error } : {})
  });
}

export function cancelActiveSakiTask(taskId: string): boolean {
  const task = activeSakiTasks.get(taskId);
  if (!task || task.status !== "running") return false;
  task.status = "cancelled";
  task.updatedAt = new Date().toISOString();
  task.abortController?.abort();
  emitActiveSakiTaskEvent(taskId, "error", { message: "Task was cancelled by user." });
  return true;
}

export function enqueueSakiTaskSteer(taskId: string, message: string): boolean {
  const task = activeSakiTasks.get(taskId);
  if (!task || task.status !== "running") return false;
  const text = message.trim();
  if (!text) return false;
  task.pendingSteers = [...(task.pendingSteers ?? []), text.slice(0, 8000)];
  task.updatedAt = new Date().toISOString();
  emitActiveSakiTaskEvent(taskId, "workflow", {
    id: `steer:${Date.now()}`,
    stage: "steer",
    message: `收到新指示：${text.slice(0, 160)}`,
    status: "running"
  });
  return true;
}

export function takeSakiTaskSteers(taskId: string): string[] {
  const task = activeSakiTasks.get(taskId);
  if (!task?.pendingSteers?.length) return [];
  const steers = task.pendingSteers;
  task.pendingSteers = [];
  task.updatedAt = new Date().toISOString();
  return steers;
}

export function cancelRunningSakiTasksForContext(
  userId: string,
  instanceId: string | null,
  exceptTaskId?: string
): number {
  let cancelled = 0;
  const contextKey = sessionWorkingFilesKey(userId, instanceId);
  const mappedId = activeSakiTasksByContext.get(contextKey);
  for (const task of activeSakiTasks.values()) {
    if (task.userId !== userId || task.status !== "running") continue;
    if (exceptTaskId && task.id === exceptTaskId) continue;
    const sameContext = task.instanceId === instanceId || task.id === mappedId;
    if (!sameContext) continue;
    if (cancelActiveSakiTask(task.id)) cancelled += 1;
  }
  return cancelled;
}

export function cancelAllRunningSakiTasks(userId: string): number {
  let cancelled = 0;
  for (const task of activeSakiTasks.values()) {
    if (task.userId === userId && task.status === "running") {
      if (cancelActiveSakiTask(task.id)) {
        cancelled += 1;
      }
    }
  }
  return cancelled;
}

export function clearFinishedSakiTasks(userId: string): number {
  let cleared = 0;
  for (const [taskId, task] of [...activeSakiTasks.entries()]) {
    if (task.userId === userId && task.status !== "running") {
      activeSakiTasks.delete(taskId);
      cleared += 1;
      for (const [key, id] of activeSakiTasksByContext.entries()) {
        if (id === taskId) {
          activeSakiTasksByContext.delete(key);
        }
      }
    }
  }
  return cleared;
}

export function deleteSakiTask(taskId: string, userId: string): boolean {
  const task = activeSakiTasks.get(taskId);
  if (!task || task.userId !== userId) return false;
  if (task.status === "running") {
    cancelActiveSakiTask(taskId);
  }
  activeSakiTasks.delete(taskId);
  for (const [key, id] of activeSakiTasksByContext.entries()) {
    if (id === taskId) {
      activeSakiTasksByContext.delete(key);
    }
  }
  return true;
}

export function toSakiActiveTaskSummary(task: SakiActiveTask): SakiActiveTaskSummary {
  const actionCount = task.eventsBuffer.filter((e) => e.type === "action").length;
  const lastWorkflow = [...task.eventsBuffer].reverse().find((e) => e.type === "workflow");
  const progressMessage = trimString(lastWorkflow?.payload?.message);
  const progressStatus = trimString(lastWorkflow?.payload?.status);
  const progressTool = trimString(lastWorkflow?.payload?.tool);

  let hasRollback = false;
  const actionIds = new Set<string>();
  for (const ev of task.eventsBuffer) {
    if (ev.type === "action") {
      const act = ev.payload?.action as { id?: string } | undefined;
      if (act?.id) actionIds.add(act.id);
    }
  }
  for (const cp of sakiCheckpoints.values()) {
    if (
      ("taskId" in cp && cp.taskId === task.id) ||
      ("taskOriginId" in cp && cp.taskOriginId === task.id) ||
      (cp.actionId && actionIds.has(cp.actionId))
    ) {
      hasRollback = true;
      break;
    }
  }

  return {
    id: task.id,
    userId: task.userId,
    instanceId: task.instanceId,
    status: task.status,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    message: task.input.message,
    ...(task.input.mode ? { mode: task.input.mode } : {}),
    actionCount,
    hasRollback,
    ...(progressMessage
      ? {
          progress: {
            message: progressMessage,
            ...(progressStatus ? { status: progressStatus } : {}),
            ...(progressTool ? { tool: progressTool } : {})
          }
        }
      : {}),
    ...(task.response ? { response: task.response } : {}),
    ...(task.error ? { error: task.error } : {})
  };
}

export function listSakiActiveTasks(userId: string, limit = 20): SakiActiveTask[] {
  const now = Date.now();
  const tasks = [...activeSakiTasks.values()].filter((task) => {
    if (task.userId !== userId) return false;
    const reference = Date.parse(task.updatedAt || task.startedAt);
    return Number.isFinite(reference) && now - reference <= activeTaskTtlMs;
  });
  tasks.sort((a, b) => {
    const aRunning = a.status === "running" ? 0 : 1;
    const bRunning = b.status === "running" ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });
  return tasks.slice(0, Math.max(1, Math.min(limit, 50)));
}

void loadCheckpointsFromDisk();
void loadPendingSakiActionsFromDisk();
void loadCompletedSakiActionsFromDisk();