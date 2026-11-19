import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SakiAgentAction } from "@webops/shared";
import { panelPaths } from "../../config.js";
import type { SakiAgentResumeState, SakiSessionAgentMemory } from "./types.js";

interface ToolStarted {
  type: "started";
  time: number;
  actionId: string;
  toolCallId: string;
  tool: string;
  signature: string;
  readOnly: boolean;
  approved?: boolean;
  resume: SakiAgentResumeState;
}

interface ToolSettled {
  type: "settled";
  time: number;
  actionId: string;
  action: SakiAgentAction;
  uncertain?: boolean;
}

type ToolEvent = ToolStarted | ToolSettled;
const writes = new Map<string, Promise<void>>();
const maxRecoveryAgeMs = 7 * 24 * 60 * 60 * 1000;

function key(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function journalDirectory(userId: string, conversationId: string): string {
  return path.join(panelPaths.dataDir, "saki-tool-journals", key(JSON.stringify([userId, conversationId])));
}

export function appendSakiToolEvent(userId: string, conversationId: string, taskId: string, event: ToolEvent): Promise<void> {
  const directory = journalDirectory(userId, conversationId);
  const file = path.join(directory, `${key(taskId)}.jsonl`);
  // A leading newline isolates a torn final record left by an interrupted write.
  const line = `\n${JSON.stringify(event)}\n`;
  const write = (writes.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await fs.open(file, "a", 0o600);
    try {
      await handle.writeFile(line);
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
  writes.set(file, write);
  void write.finally(() => { if (writes.get(file) === write) writes.delete(file); }).catch(() => {});
  return write;
}

export async function removeSakiToolJournals(userId: string, conversationId: string): Promise<void> {
  const directory = journalDirectory(userId, conversationId);
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  await Promise.all(names.filter(name => /^[a-f0-9]{64}\.jsonl$/.test(name)).map(async name => {
    const file = path.join(directory, name);
    await writes.get(file)?.catch(() => {});
    await fs.rm(file, { force: true });
  }));
}

export async function readApprovedSakiToolOutcome(userId: string, conversationId: string, taskId: string,
  actionId: string): Promise<{ interrupted: boolean; action?: SakiAgentAction }> {
  const file = path.join(journalDirectory(userId, conversationId), `${key(taskId)}.jsonl`);
  const text = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  let approved = false;
  let result: SakiAgentAction | undefined;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let event: ToolEvent;
    try { event = JSON.parse(line) as ToolEvent; } catch { continue; }
    if (event?.actionId !== actionId) continue;
    if (event.type === "started") {
      approved = event.approved === true;
      result = undefined;
    } else if (approved && event.type === "settled" && !event.uncertain) {
      result = event.action;
    }
  }
  return result ? { interrupted: false, action: result } : { interrupted: approved };
}

export async function recoverSakiToolJournal(userId: string, conversationId: string, completed: ReadonlyMap<string, SakiAgentAction>,
  taskId?: string): Promise<SakiSessionAgentMemory | null> {
  const directory = journalDirectory(userId, conversationId);
  let file: string | undefined;
  if (taskId) file = path.join(directory, `${key(taskId)}.jsonl`);
  else {
    const names = await fs.readdir(directory).catch(() => [] as string[]);
    const entries = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.jsonl$/.test(name)).map(async name => {
      const file = path.join(directory, name);
      return { file, updatedAt: await fs.stat(file).then(stat => stat.mtimeMs).catch(() => 0) };
    }));
    file = entries.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.file;
  }
  if (!file) return null;
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || Date.now() - stat.mtimeMs > maxRecoveryAgeMs) return null;
  const text = await fs.readFile(file, "utf8").catch(() => "");
  const calls = new Map<string, ToolStarted>();
  const outcomes = new Map<string, ToolSettled>();
  let latest: ToolStarted | undefined;
  let time = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let event: ToolEvent;
    try { event = JSON.parse(line) as ToolEvent; } catch { continue; }
    if (!event || !Number.isFinite(event.time) || typeof event.actionId !== "string") continue;
    if (event.type === "started" && event.resume?.input) {
      calls.set(event.actionId, event);
      outcomes.delete(event.actionId);
      latest = event;
      time = event.time;
    } else if (event.type === "settled" && event.action && calls.has(event.actionId)) {
      outcomes.set(event.actionId, event);
      time = event.time;
    }
  }
  if (!latest?.resume.taskId || (latest.resume.input.conversationId ?? `task-${latest.resume.taskId}`) !== conversationId) return null;
  const resume = latest.resume;
  const actions = new Map(resume.actions.map(action => [action.id, action]));
  const uncertain = new Set(resume.uncertainToolSignatures ?? []);
  const observations = new Map<string, { name: string; content: string }>();
  for (const [id, call] of calls) {
    const outcome = outcomes.get(id);
    const action = outcome && !outcome.uncertain ? outcome.action : completed.get(id);
    if (action && action.status !== "pending_approval" && action.status !== "pending_input") {
      actions.set(action.id, action);
      observations.set(call.toolCallId, { name: call.tool, content: action.observation });
    } else if (!call.readOnly && (!outcome || outcome.uncertain)) {
      uncertain.add(call.signature);
      observations.set(call.toolCallId, { name: call.tool, content: "Tool outcome was not confirmed before interruption. Inspect its target before doing further work. This exact call will not be automatically replayed." });
    }
  }
  const turnMessages = resume.turnMessages?.flatMap(message => {
    if (message.role !== "assistant" || !message.toolCalls?.length) return [message];
    const missing = message.toolCalls.flatMap(call => {
      const known = call.id && observations.get(call.id);
      if (!known || resume.turnMessages?.some(item => item.role === "tool" && item.toolCallId === call.id)) return [];
      return [{ role: "tool" as const, toolCallId: call.id!, ...known }];
    });
    return [message, ...missing];
  });
  return {
    userId, instanceId: resume.workspaceBinding?.instanceId ?? null,
    workingFiles: [...new Set((resume.workspaceFileReads ?? []).map(file => file.path))].slice(-10),
    lastGoal: resume.input.message,
    updatedAt: time,
    resumeState: { ...resume, actions: [...actions.values()], ...(turnMessages ? { turnMessages } : {}),
      uncertainToolSignatures: [...uncertain], toolExecutions: Math.max(resume.toolExecutions, actions.size) }
  };
}
