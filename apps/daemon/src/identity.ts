import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import os from "node:os";
import type { DaemonNodeKeyPayload } from "@webops/shared";
import { daemonConfig, daemonPaths } from "./config.js";

export interface DaemonIdentity {
  nodeId: string;
  nodeToken: string;
}

export async function readIdentity(): Promise<DaemonIdentity | null> {
  const candidatePaths = Array.from(
    new Set([
      daemonPaths.identityFile,
      path.resolve(daemonPaths.dataDir, `identity-${daemonConfig.port}.json`),
      path.resolve(daemonPaths.dataDir, "identity.json")
    ])
  );

  for (const filePath of candidatePaths) {
    const identity = await readIdentityFile(filePath);
    if (identity) {
      return identity;
    }
  }

  return null;
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
  const addIdentity = (identity: DaemonIdentity | null) => {
    if (identity?.nodeId && identity?.nodeToken) {
      identities.set(`${identity.nodeId}:${identity.nodeToken}`, identity);
    }
  };

  const currentIdentity = await readIdentity();
  addIdentity(currentIdentity);

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
    addIdentity(identity);
  }

  return Array.from(identities.values());
}

export async function writeIdentity(identity: DaemonIdentity): Promise<void> {
  await fs.mkdir(daemonPaths.dataDir, { recursive: true });
  await fs.writeFile(daemonPaths.identityFile, JSON.stringify(identity, null, 2), "utf8");
}

export async function clearIdentity(): Promise<void> {
  const candidatePaths = Array.from(
    new Set([
      daemonPaths.identityFile,
      path.resolve(daemonPaths.dataDir, `identity-${daemonConfig.port}.json`),
      path.resolve(daemonPaths.dataDir, "identity.json")
    ])
  );

  for (const filePath of candidatePaths) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
}

function getReachableIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

export async function getOrCreateDaemonNodeKey(overrideHost?: string, overridePort?: number): Promise<{ key: string; payload: DaemonNodeKeyPayload }> {
  let identity = await readIdentity();
  if (!identity) {
    const randomHex = randomBytes(6).toString("hex");
    identity = {
      nodeId: `node_${randomHex}`,
      nodeToken: randomBytes(24).toString("hex")
    };
    await writeIdentity(identity);
  }

  let host = overrideHost?.trim() || daemonConfig.publicHost;
  if (!overrideHost && (host === "127.0.0.1" || host === "0.0.0.0" || host === "localhost")) {
    const detected = getReachableIp();
    if (detected !== "127.0.0.1") {
      host = detected;
    }
  }

  const port = overridePort || daemonConfig.port;

  const payload: DaemonNodeKeyPayload = {
    version: 1,
    host,
    port,
    protocol: daemonConfig.protocol === "https" ? "https" : "http",
    token: identity.nodeToken,
    nodeId: identity.nodeId,
    name: daemonConfig.name || os.hostname()
  };

  const jsonStr = JSON.stringify(payload);
  const key = `saki_node_${Buffer.from(jsonStr, "utf8").toString("base64url")}`;
  return { key, payload };
}

