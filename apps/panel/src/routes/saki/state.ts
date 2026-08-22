import fs from "node:fs/promises";
import path from "node:path";
import type { SakiAgentAction } from "@webops/shared";
import { panelPaths } from "../../config.js";
import type { PendingSakiAction, SakiCheckpoint } from "./types.js";

export const pendingSakiActions = new Map<string, PendingSakiAction>();
export const completedSakiActions = new Map<string, SakiAgentAction>();
export const sakiCheckpoints = new Map<string, SakiCheckpoint>();

const checkpointsDir = path.join(panelPaths.dataDir, "saki-checkpoints");
const pendingActionsDir = path.join(panelPaths.dataDir, "saki-pending-actions");
const pendingActionTtlMs = 24 * 60 * 60 * 1000;

export async function savePendingSakiAction(pending: PendingSakiAction): Promise<void> {
  pendingSakiActions.set(pending.id, pending);
  try {
    await fs.mkdir(pendingActionsDir, { recursive: true });
    await fs.writeFile(path.join(pendingActionsDir, `${pending.id}.json`), JSON.stringify(pending, null, 2), "utf8");
  } catch {
    // ignore
  }
}

export async function removePendingSakiAction(id: string): Promise<void> {
  pendingSakiActions.delete(id);
  try {
    await fs.rm(path.join(pendingActionsDir, `${id}.json`), { force: true });
  } catch {
    // ignore
  }
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
  } catch {
    // ignore
  }
}

export async function saveCheckpoint(checkpoint: SakiCheckpoint): Promise<void> {
  sakiCheckpoints.set(checkpoint.id, checkpoint);
  try {
    await fs.mkdir(checkpointsDir, { recursive: true });
    await fs.writeFile(path.join(checkpointsDir, `${checkpoint.id}.json`), JSON.stringify(checkpoint, null, 2), "utf8");
  } catch {
    // ignore
  }
}

export async function removeCheckpoint(id: string): Promise<void> {
  sakiCheckpoints.delete(id);
  try {
    await fs.rm(path.join(checkpointsDir, `${id}.json`), { force: true });
  } catch {
    // ignore
  }
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
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
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

void loadCheckpointsFromDisk();
void loadPendingSakiActionsFromDisk();