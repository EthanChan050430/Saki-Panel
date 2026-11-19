import { randomUUID } from "node:crypto";
import type { SakiAgentAction } from "@webops/shared";
import { bindSakiWorkspace } from "./workspace-binding.js";
import { RouteError, type ParsedToolCall, type SakiAgentRuntime } from "./types.js";

interface AgentJob {
  id: string;
  userId: string;
  conversationId: string;
  scope: string;
  taskId: string;
  call: ParsedToolCall;
  controller: AbortController;
  startedAt: number;
  updatedAt: number;
  status: "running" | "stopping" | "completed" | "failed" | "cancelled";
  result?: SakiAgentAction;
  failure?: string;
  reportedTasks: Set<string>;
}

const jobs = new Map<string, AgentJob>();
const maxJobsPerUser = 8;
const completedJobTtlMs = 60 * 60_000;

function active(job: AgentJob): boolean {
  return job.status === "running" || job.status === "stopping";
}

function session(runtime: SakiAgentRuntime): { userId: string; conversationId: string; scope: string; taskId: string } {
  if (!runtime.taskId) throw new RouteError("Background jobs need an active Agent task.", 400);
  const instances = runtime.context.instances ?? (runtime.context.instance ? [runtime.context.instance] : []);
  return { userId: runtime.userId, conversationId: runtime.input.conversationId ?? `task-${runtime.taskId}`, taskId: runtime.taskId,
    scope: JSON.stringify([runtime.context.instance?.id, instances.map(bindSakiWorkspace).sort((a, b) => a.instanceId.localeCompare(b.instanceId))]) };
}

function pruneJobs(): void {
  for (const [id, job] of jobs) if (!active(job) && Date.now() - job.updatedAt > completedJobTtlMs) jobs.delete(id);
}

export function hasRunningAgentJobs(userId: string, conversationId?: string): boolean {
  pruneJobs();
  return [...jobs.values()].some(job => job.userId === userId && (!conversationId || job.conversationId === conversationId) && active(job));
}

export function beginAgentJob(runtime: SakiAgentRuntime, call: ParsedToolCall,
  execute: (controller: AbortController) => Promise<SakiAgentAction>): string {
  const owner = session(runtime);
  const signal = runtime.abortController?.signal;
  signal?.throwIfAborted();
  pruneJobs();
  const owned = [...jobs.values()].filter(job => job.userId === owner.userId);
  if (owned.filter(active).length >= maxJobsPerUser) throw new RouteError("后台作业已达到并发上限。", 409);
  for (const job of owned.filter(job => !active(job)).slice(0, Math.max(0, owned.length - 39))) jobs.delete(job.id);
  const controller = new AbortController();
  const now = Date.now();
  const job: AgentJob = { ...owner, id: randomUUID(), call, controller, startedAt: now, updatedAt: now, status: "running", reportedTasks: new Set() };
  jobs.set(job.id, job);
  const cancel = () => stopAgentJob(job);
  signal?.addEventListener("abort", cancel, { once: true });
  void Promise.resolve().then(() => execute(controller)).then(result => {
    job.result = result;
    job.status = controller.signal.aborted ? "cancelled" : result.ok ? "completed" : "failed";
  }, error => {
    job.failure = error instanceof Error ? error.message : String(error);
    job.status = controller.signal.aborted ? "cancelled" : "failed";
  }).finally(() => {
    job.updatedAt = Date.now();
    signal?.removeEventListener("abort", cancel);
  });
  return job.id;
}

export function listAgentJobs(runtime: SakiAgentRuntime): AgentJob[] {
  const owner = session(runtime);
  pruneJobs();
  return [...jobs.values()].filter(job => job.userId === owner.userId
    && job.conversationId === owner.conversationId && job.scope === owner.scope);
}

export function getAgentJob(runtime: SakiAgentRuntime, id: string): AgentJob {
  const job = listAgentJobs(runtime).find(item => item.id === id);
  if (!job) throw new RouteError("该作业不在当前对话和工作区内，或已过期。", 404);
  return job;
}

export function cancelAgentJobsForTask(userId: string, taskId?: string): number {
  let stopped = 0;
  for (const job of jobs.values()) {
    if (job.userId !== userId || (taskId && job.taskId !== taskId) || job.status !== "running") continue;
    stopAgentJob(job);
    stopped += 1;
  }
  return stopped;
}

export function stopAgentJob(job: AgentJob): void {
  if (!active(job)) return;
  job.status = "stopping";
  job.controller.abort();
}
