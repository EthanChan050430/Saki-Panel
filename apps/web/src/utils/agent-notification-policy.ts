import type { SakiActiveTaskSummary } from "../api.js";

export type AgentNotificationKind = "approval" | "question" | "completed";
export interface AgentNotificationPreferences {
  enabled: boolean;
  approval: boolean;
  question: boolean;
  completed: boolean;
  desktop: boolean;
  sound: boolean;
}
export const defaultAgentNotificationPreferences: AgentNotificationPreferences = {
  enabled: false, approval: true, question: true, completed: true, desktop: true, sound: false
};

export function normalizeAgentNotificationPreferences(value: unknown): AgentNotificationPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(defaultAgentNotificationPreferences).map(([key, fallback]) =>
    [key, typeof input[key] === "boolean" ? input[key] : fallback])) as unknown as AgentNotificationPreferences;
}

export function agentNotificationKind(task: SakiActiveTaskSummary): AgentNotificationKind | null {
  if (task.mode === "chat") return null;
  if (task.status === "pending_approval") return "approval";
  if (task.status === "pending_input") return "question";
  if (task.status === "completed" && !task.response?.retry && task.response?.source !== "local-fallback") return "completed";
  return null;
}

export function agentNotificationKey(task: SakiActiveTaskSummary, kind: AgentNotificationKind): string {
  const pending = (task.response?.actions ?? []).filter(action => action.status === task.status).map(action => action.id).sort();
  return JSON.stringify([task.id, task.runVersion ?? 1, kind, kind === "completed" ? [] : pending]);
}

/** Polls, SSE replays and ordinary task updates must not repeat an alert. */
export class AgentNotificationTracker {
  private observed = new Map<string, string>();
  constructor(private readonly mountedAt = Date.now()) {}

  observe(tasks: readonly SakiActiveTaskSummary[]): Array<{ task: SakiActiveTaskSummary; kind: AgentNotificationKind; key: string }> {
    const alerts: Array<{ task: SakiActiveTaskSummary; kind: AgentNotificationKind; key: string }> = [];
    for (const task of tasks) {
      const kind = agentNotificationKind(task);
      if (!kind) continue;
      const key = agentNotificationKey(task, kind);
      const previous = this.observed.get(task.id);
      this.observed.set(task.id, key);
      if (previous === key) continue;
      // Loading the task list should not announce historical completed work.
      if (!previous && kind === "completed" && Date.parse(task.updatedAt) < this.mountedAt) continue;
      alerts.push({ task, kind, key });
    }
    const active = new Set(tasks.map(task => task.id));
    for (const id of this.observed.keys()) if (!active.has(id)) this.observed.delete(id);
    return alerts;
  }
}
