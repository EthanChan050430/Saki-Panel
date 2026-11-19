import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { panelPaths } from "../../config.js";
import type { SakiSessionAgentMemory } from "./types.js";
import type { SakiWorkspaceFileObservation } from "./workspace-file-recall.js";

const fingerprints = new Map<string, string>();
let database: Promise<PrismaClient> | undefined;
let writeTail = Promise.resolve();

async function db(): Promise<PrismaClient> {
  if (!database) database = (async () => {
    await fs.mkdir(panelPaths.dataDir, { recursive: true });
    const filename = path.join(panelPaths.dataDir, "saki-workspace-recall.db").replace(/\\/g, "/");
    const file = await fs.open(filename, "a", 0o600);
    await file.close();
    const client = new PrismaClient({ datasourceUrl: `file:${filename}` });
    try {
      await client.$executeRaw`CREATE VIRTUAL TABLE IF NOT EXISTS workspace_reads USING fts5(
        owner UNINDEXED, conversation UNINDEXED, workspace UNINDEXED, window_key UNINDEXED,
        file_path, body, touched UNINDEXED, tokenize='unicode61'
      )`;
      await client.$executeRaw`DELETE FROM workspace_reads WHERE CAST(touched AS INTEGER) < ${Date.now() - 7 * 24 * 60 * 60 * 1000}`;
      return client;
    } catch (error) {
      await client.$disconnect();
      throw error;
    }
  })();
  return database;
}

export function sakiWorkspaceSearchTerms(text: string): Set<string> {
  const words = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  const terms = new Set(words.match(/[a-z][a-z0-9]{2,}/g) ?? []);
  for (const match of words.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    for (let index = 0; index < match[0].length - 1; index++) terms.add(match[0].slice(index, index + 2));
  }
  return terms;
}

export function indexedWorkspaceFileKey(saved: SakiWorkspaceFileObservation): string {
  return JSON.stringify([saved.binding.instanceId, saved.path, saved.startLine, saved.lineCount]);
}

function serializedIndexWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = writeTail.then(work);
  writeTail = result.then(() => {}, () => {});
  return result;
}

export async function indexSakiWorkspaceReads(memory: SakiSessionAgentMemory, conversation: string): Promise<void> {
  const files = memory.resumeState.workspaceFileReads ?? [];
  if (!files.length) return;
  const owner = memory.userId;
  const cacheKey = JSON.stringify([owner, conversation]);
  const fingerprint = createHash("sha256").update(JSON.stringify([memory.lastGoal, files])).digest("hex");
  if (fingerprints.get(cacheKey) === fingerprint) return;
  await serializedIndexWrite(async () => {
    if (fingerprints.get(cacheKey) === fingerprint) return;
    const client = await db();
    const values = files.map(saved => Prisma.sql`(
      ${owner}, ${conversation}, ${saved.binding.instanceId}, ${indexedWorkspaceFileKey(saved)},
      ${[...sakiWorkspaceSearchTerms(saved.path)].join(" ")}, ${[...sakiWorkspaceSearchTerms(`${memory.lastGoal.slice(0, 1000)}\n${saved.observation}`)].join(" ")}, ${memory.updatedAt}
    )`);
    await client.$transaction([
      client.$executeRaw`DELETE FROM workspace_reads WHERE owner = ${owner} AND conversation = ${conversation}`,
      client.$executeRaw(Prisma.sql`INSERT INTO workspace_reads(owner, conversation, workspace, window_key, file_path, body, touched)
        VALUES ${Prisma.join(values)}`)
    ]);
    fingerprints.set(cacheKey, fingerprint);
    if (fingerprints.size > 600) fingerprints.delete(fingerprints.keys().next().value!);
  });
}

export async function removeSakiWorkspaceReadIndex(owner: string, conversation?: string): Promise<void> {
  await serializedIndexWrite(async () => {
    const client = await db();
    if (conversation) {
      await client.$executeRaw`DELETE FROM workspace_reads WHERE owner = ${owner} AND conversation = ${conversation}`;
      fingerprints.delete(JSON.stringify([owner, conversation]));
    } else {
      await client.$executeRaw`DELETE FROM workspace_reads WHERE owner = ${owner}`;
      for (const key of fingerprints.keys()) if ((JSON.parse(key) as string[])[0] === owner) fingerprints.delete(key);
    }
  });
}

export async function searchSakiWorkspaceReads(owner: string, workspaceIds: string[], conversations: string[], terms: Set<string>): Promise<Map<string, number>> {
  if (!terms.size || !workspaceIds.length || !conversations.length) return new Map();
  const expression = [...terms].slice(0, 48).map(term => `"${term}"`).join(" OR ");
  const client = await db();
  const hits = await client.$queryRaw<Array<{ conversation: string; window_key: string }>>(Prisma.sql`
    SELECT conversation, window_key FROM workspace_reads
    WHERE workspace_reads MATCH ${expression} AND owner = ${owner}
      AND workspace IN (${Prisma.join(workspaceIds)}) AND conversation IN (${Prisma.join(conversations)})
    ORDER BY bm25(workspace_reads, 0, 0, 0, 0, 5, 1, 0), CAST(touched AS INTEGER) DESC LIMIT 60`);
  return new Map(hits.map((hit, index) => [JSON.stringify([hit.conversation, hit.window_key]), 1 / (1 + index / 12)]));
}
