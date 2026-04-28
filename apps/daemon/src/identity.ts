import fs from "node:fs/promises";
import { daemonPaths } from "./config.js";

export interface DaemonIdentity {
  nodeId: string;
  nodeToken: string;
}

export async function readIdentity(): Promise<DaemonIdentity | null> {
  try {
    const raw = await fs.readFile(daemonPaths.identityFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<DaemonIdentity>;
    if (parsed.nodeId && parsed.nodeToken) {
      return {
        nodeId: parsed.nodeId,
        nodeToken: parsed.nodeToken
      };
    }
    return null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeIdentity(identity: DaemonIdentity): Promise<void> {
  await fs.mkdir(daemonPaths.dataDir, { recursive: true });
  await fs.writeFile(daemonPaths.identityFile, JSON.stringify(identity, null, 2), "utf8");
}

export async function clearIdentity(): Promise<void> {
  try {
    await fs.unlink(daemonPaths.identityFile);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

