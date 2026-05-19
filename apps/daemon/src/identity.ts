import fs from "node:fs/promises";
import path from "node:path";
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

async function readIdentityFile(filePath: string): Promise<DaemonIdentity | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DaemonIdentity>;
    if (parsed.nodeId && parsed.nodeToken) {
      return {
        nodeId: parsed.nodeId,
        nodeToken: parsed.nodeToken
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function readKnownIdentities(): Promise<DaemonIdentity[]> {
  const identities = new Map<string, DaemonIdentity>();
  const currentIdentity = await readIdentity();
  if (currentIdentity) {
    identities.set(currentIdentity.nodeId, currentIdentity);
  }

  let entries: string[];
  try {
    entries = await fs.readdir(daemonPaths.dataDir);
  } catch {
    return Array.from(identities.values());
  }

  const identityFiles = entries
    .filter((entry) => /^identity(?:-.+)?\.json$/i.test(entry))
    .map((entry) => path.resolve(daemonPaths.dataDir, entry));

  for (const filePath of identityFiles) {
    const identity = await readIdentityFile(filePath);
    if (identity) {
      identities.set(identity.nodeId, identity);
    }
  }

  return Array.from(identities.values());
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
