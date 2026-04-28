import fs from "node:fs/promises";
import path from "node:path";
import { daemonPaths } from "./config.js";

export interface PersistedInstance {
  instanceId: string;
  status: string;
  exitCode: number | null;
  cwd?: string | undefined;
  restartAttempts: number;
  lastPid?: number | undefined;
}

interface PersistedState {
  version: 1;
  instances: PersistedInstance[];
  savedAt: string;
}

const STATE_FILE = path.resolve(daemonPaths.dataDir, "runtime-state.json");

export async function saveRuntimeState(instances: PersistedInstance[]): Promise<void> {
  const state: PersistedState = {
    version: 1,
    instances,
    savedAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state), "utf8");
}

export async function loadRuntimeState(): Promise<PersistedInstance[]> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const state = JSON.parse(raw) as PersistedState;
    if (state.version !== 1 || !Array.isArray(state.instances)) {
      return [];
    }
    return state.instances;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    console.error("Failed to load persisted runtime state:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function clearRuntimeState(): Promise<void> {
  try {
    await fs.unlink(STATE_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
