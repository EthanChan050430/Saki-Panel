import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
import { RouteError, trimString } from "./types.js";
import { copyText } from "./text-memory.js";
import { syncSakiTaskResult } from "./conversations.js";

export const pendingSakiActions = new Map<string, PendingSakiAction>();
export const completedSakiActions = new Map<string, SakiAgentAction>();
export const sakiCheckpoints = new Map<string, SakiCheckpoint>();
export const sessionAgentMemories = new Map<string, SakiSessionAgentMemory>();
const sessionMemoryTtlMs = 24 * 60 * 60 * 1000;
const sessionsDir = path.join(panelPaths.dataDir, "saki-sessions");
const sessionWrites = new Map<string, Promise<void>>();

function sessionMemoryPath(key: string): string {
  return path.join(sessionsDir, `${createHash("sha256").update(key).digest("hex")}.json`);
}

export async function loadSessionAgentMemoriesFromDisk(): Promise<void> {
  await fs.mkdir(sessionsDir, { recursive: true });
  for (const name of await fs.readdir(sessionsDir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = path.join(sessionsDir, name);
    try {
      const memory = JSON.parse(await fs.readFile(file, "utf8")) as SakiSessionAgentMemory;
      if (!memory.userId || !memory.resumeState?.input || !Array.isArray(memory.resumeState.actions)
        || !Array.isArray(memory.resumeState.scratchpadEntries) || !Array.isArray(memory.workingFiles)
        || !Number.isFinite(memory.updatedAt) || Date.now() - memory.updatedAt > sessionMemoryTtlMs) {
        await fs.rm(file, { force: true });
        continue;
      }
      const key = sessionWorkingFilesKey(memory.userId, memory.instanceId);
      if ((sessionAgentMemories.get(key)?.updatedAt ?? 0) < memory.updatedAt) sessionAgentMemories.set(key, memory);
    } catch {
      // A damaged session must not prevent other sessions or the panel loading.
    }
  }
  const newest = [...sessionAgentMemories.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  for (const [key] of newest.slice(200)) sessionAgentMemories.delete(key);
}

export const sessionAgentMemoriesReady = loadSessionAgentMemoriesFromDisk().catch((error: unknown) => {
  console.warn("[Saki] Could not load saved sessions:", error instanceof Error ? error.message : String(error));
});

export async function persistSessionAgentMemory(memory: SakiSessionAgentMemory): Promise<void> {
  await sessionAgentMemoriesReady;
  saveSessionAgentMemory(memory);
  const key = sessionWorkingFilesKey(memory.userId, memory.instanceId);
  const destination = sessionMemoryPath(key);
  // Capture now: later turns can mutate their arrays while this write waits.
  const serialized = JSON.stringify({ ...memory, updatedAt: Date.now() });
  const operation = (sessionWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await fs.mkdir(sessionsDir, { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  sessionWrites.set(key, operation);
  try {
    await operation;
  } finally {
    if (sessionWrites.get(key) === operation) sessionWrites.delete(key);
  }
}

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
  return `${instanceId}:${filePath.replace(/\\/g, "/")}`;
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
  sessionAgentMemories.delete(key);
  sessionAgentMemories.set(key, {
    ...memory,
    updatedAt: Date.now()
  });
  for (const [sessionKey, session] of sessionAgentMemories) {
    if (Date.now() - session.updatedAt > sessionMemoryTtlMs) sessionAgentMemories.delete(sessionKey);
  }
  if (sessionAgentMemories.size > 200) sessionAgentMemories.delete(sessionAgentMemories.keys().next().value!);
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
  const operation = (sessionWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(() => fs.rm(sessionMemoryPath(key), { force: true }));
  sessionWrites.set(key, operation);
  void operation.catch(() => {}).finally(() => {
    if (sessionWrites.get(key) === operation) sessionWrites.delete(key);
  });
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
        .filter((l) => /^- \[[ xX-]\]/.test(l));
      if (lines.length > 0) {
        return lines;
      }
    }
  }
  return todos;
}

export function extractConfirmedTodos(actions: SakiAgentAction[], scratchpad: string[]): string[] {
  const latest = [...actions].reverse().find((action) => action.ok && /^(?:managetodos|settodos|todos|updatetodos)$/i.test(action.tool));
  if (latest?.todos) return latest.todos.map((todo) => `- [${todo.completed ? "x" : todo.inProgress ? "-" : " "}] ${todo.text}`);
  if (latest && typeof latest.args.todos === "string") return latest.args.todos.split(/\r?\n/).filter((line) => /^- \[[ xX-]\]/.test(line));
  return extractTodosFromScratchpad(scratchpad);
}

export const activeSakiTasks = new Map<string, SakiActiveTask>();
export const activeSakiTasksByContext = new Map<string, string>(); // `${userId}:${instanceId}` -> taskId
const activeTaskTtlMs = 60 * 60 * 1000; // Keep completed task record for 1 hour

export function isSakiTaskUnfinished(task: SakiActiveTask): boolean {
  return task.status === "running" || task.status === "pending_approval" || task.status === "pending_input";
}

function removeActiveSakiTask(taskId: string): void {
  activeSakiTasks.delete(taskId);
  for (const [key, id] of activeSakiTasksByContext) {
    if (id === taskId) activeSakiTasksByContext.delete(key);
  }
}

export function pruneExpiredSakiTasks(now = Date.now()): number {
  let removed = 0;
  for (const [taskId, task] of activeSakiTasks) {
    // An approval may still resume the task; never evict live work.
    if (isSakiTaskUnfinished(task) || task.execution || task.decisionInFlight || task.pendingHistorySync) continue;
    const reference = Date.parse(task.updatedAt || task.startedAt);
    if (Number.isFinite(reference) && now - reference <= activeTaskTtlMs) continue;
    removeActiveSakiTask(taskId);
    removed += 1;
  }
  return removed;
}

export function startSakiTaskMaintenance(): () => void {
  let flushing = false;
  const timer = setInterval(() => {
    pruneExpiredSakiTasks();
    if (flushing) return;
    flushing = true;
    void retrySakiTaskHistory().catch((error) => {
      console.warn("[Saki] History retry failed:", error instanceof Error ? error.message : String(error));
    }).finally(() => { flushing = false; pruneExpiredSakiTasks(); });
  }, 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

export async function retrySakiTaskHistory(): Promise<void> {
  for (const task of activeSakiTasks.values()) {
    if (task.pendingHistorySync && task.status !== "running" && !task.execution && !task.decisionInFlight) {
      await syncSakiTaskResult(task, task.pendingHistorySync);
    }
  }
}

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
    acceptingSteers: true,
    runVersion: 1,
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
  if (instanceId !== undefined) {
    const contextKey = sessionWorkingFilesKey(userId, instanceId);
    const taskId = activeSakiTasksByContext.get(contextKey);
    if (taskId) {
      const task = activeSakiTasks.get(taskId);
      if (task?.userId === userId && task.instanceId === instanceId && task.status === "running") return task;
    }
  }

  // Find any active running task for this user:
  for (const task of activeSakiTasks.values()) {
    if (task.userId === userId && task.status === "running" && (instanceId === undefined || task.instanceId === instanceId)) return task;
  }

  return null;
}

export function getActiveSakiTaskById(taskId: string): SakiActiveTask | null {
  return activeSakiTasks.get(taskId) ?? null;
}

export function findSakiTaskByRequest(userId: string, clientRequestId?: string): SakiActiveTask | null {
  if (!clientRequestId) return null;
  return [...activeSakiTasks.values()].find((task) => task.userId === userId && task.input.clientRequestId === clientRequestId) ?? null;
}

export function assertSakiTaskContextAvailable(userId: string, instanceId: string | null, exceptTaskId?: string): void {
  // An idle approval retains its action and resume record, but does not hold
  // the workspace. Approving it later still checks for an executing task.
  const conflict = [...activeSakiTasks.values()].find((task) => task.userId === userId && task.instanceId === instanceId && task.id !== exceptTaskId && (task.status === "running" || task.status === "pending_input" || task.execution || task.decisionInFlight));
  if (conflict) throw new RouteError("此工作区已有正在执行或等待回答的任务，请先连接、处理或停止该任务。", 409);
}

export function getLatestSakiTask(userId: string, instanceId: string | null): SakiActiveTask | null {
  return [...activeSakiTasks.values()].filter((task) => task.userId === userId && task.instanceId === instanceId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

export function restartActiveSakiTask(taskId: string, abortController: AbortController): boolean {
  const task = activeSakiTasks.get(taskId);
  if (!task || task.status === "cancelled" || task.status === "running") return false;
  assertSakiTaskContextAvailable(task.userId, task.instanceId, task.id);
  task.status = "running";
  task.runVersion = (task.runVersion ?? 1) + 1;
  task.acceptingSteers = true;
  task.abortController = abortController;
  task.updatedAt = new Date().toISOString();
  task.historyEvents = [...(task.historyEvents ?? []), ...task.eventsBuffer.filter(event => event.type !== "done" && event.type !== "error")];
  task.eventsBuffer = [];
  delete task.pendingHistorySync;
  delete task.response;
  delete task.error;
  return true;
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
    // Other event producers can also supply slices. Detach before the replay
    // buffer retains them, even when they bypass the provider streaming helpers.
    payload = { ...payload, text: copyText(payload.text) };
    const last = task.eventsBuffer[task.eventsBuffer.length - 1];
    if (last && last.type === type && typeof last.payload.text === "string") {
      last.payload = { ...last.payload, text: `${last.payload.text}${payload.text}` };
      for (const subscriber of task.subscribers) {
        try {
          subscriber({ type, payload, ts: last.ts });
        } catch {}
      }
      return;
    }
  }
  const event: SakiActiveTaskEvent = {
    id: randomUUID(),
    type,
    payload,
    ts: Date.now()
  };
  task.eventsBuffer.push(event);
  if (task.eventsBuffer.length > 500) {
    const evicted = task.eventsBuffer.shift()!;
    if (evicted.type !== "done" && evicted.type !== "error") (task.historyEvents ??= []).push(evicted);
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
  if (task.status === "cancelled") {
    if (response) task.response = response;
    return;
  }
  if (status === "completed" && response) {
    const latestActions = new Map((response.actions ?? []).map((action) => [action.id, action]));
    const waiting = [...latestActions.values()].find((action) => action.status === "pending_input" || action.status === "pending_approval");
    status = response.retry || response.source === "local-fallback" ? "failed"
      : waiting?.status === "pending_input" ? "pending_input"
      : waiting?.status === "pending_approval" ? "pending_approval" : "completed";
  }
  task.status = status;
  task.acceptingSteers = false;
  task.updatedAt = new Date().toISOString();
  if (response) task.response = response;
  if (error) task.error = error;
  emitActiveSakiTaskEvent(taskId, response ? "done" : "error", {
    ...(response ? { response } : {}),
    ...(error ? { message: error } : {})
  });
}

export function cancelActiveSakiTask(taskId: string): boolean {
  const task = activeSakiTasks.get(taskId);
  if (!task || !isSakiTaskUnfinished(task)) return false;
  task.status = "cancelled";
  task.updatedAt = new Date().toISOString();
  task.abortController?.abort();
  for (const [id, pending] of pendingSakiActions) {
    if (pending.resume?.taskId === taskId) void removePendingSakiAction(id);
  }
  emitActiveSakiTaskEvent(taskId, "error", { message: "Task was cancelled by user." });
  return true;
}

export function enqueueSakiTaskSteer(taskId: string, message: string): boolean {
  const task = activeSakiTasks.get(taskId);
  if (!task || task.status !== "running" || task.acceptingSteers === false) return false;
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

export function sealSakiTaskSteers(taskId: string): void {
  const task = activeSakiTasks.get(taskId);
  if (task) task.acceptingSteers = false;
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
    if (task.userId === userId && !isSakiTaskUnfinished(task) && !task.execution && !task.decisionInFlight && !task.pendingHistorySync) {
      removeActiveSakiTask(taskId);
      cleared += 1;
    }
  }
  return cleared;
}

export function deleteSakiTask(taskId: string, userId: string): boolean {
  const task = activeSakiTasks.get(taskId);
  if (!task || task.userId !== userId) return false;
  if (isSakiTaskUnfinished(task)) cancelActiveSakiTask(taskId);
  if (task.execution || task.decisionInFlight) throw new RouteError("任务正在停止，执行结束后可以删除。", 409);
  if (task.pendingHistorySync) throw new RouteError("任务结果正在同步，保存完成后可以删除。", 409);
  removeActiveSakiTask(taskId);
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
    ...(task.input.workspaceInstanceIds ? { workspaceInstanceIds: task.input.workspaceInstanceIds } : {}),
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    message: task.input.message,
    ...(task.input.conversationId ? { conversationId: task.input.conversationId } : {}),
    ...(task.input.assistantMessageId ? { assistantMessageId: task.input.assistantMessageId } : {}),
    ...(task.input.userMessageId ? { userMessageId: task.input.userMessageId } : {}),
    runVersion: task.runVersion ?? 1,
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
    if (isSakiTaskUnfinished(task)) return true;
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

export const sakiActionsReady = Promise.all([loadCheckpointsFromDisk(), loadPendingSakiActionsFromDisk(), loadCompletedSakiActionsFromDisk()]);
