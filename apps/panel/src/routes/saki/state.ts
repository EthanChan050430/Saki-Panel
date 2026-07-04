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

void loadCheckpointsFromDisk();
void loadPendingSakiActionsFromDisk();