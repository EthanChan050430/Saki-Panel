import type { SakiActiveTaskSummary } from "../../api.js";
import type { DashboardChatMessage } from "./DashboardAgentConversation.js";

export interface DashboardSession {
  id: string;
  instanceId: string | null;
  updatedAt?: string;
  title: string;
  category: string;
  time: string;
  messages?: DashboardChatMessage[];
}

export interface DashboardStreamRun {
  controller: AbortController;
  mode: "agent" | "chat";
  taskId?: string;
  cancelRequested?: boolean;
  detached?: boolean;
}

export function dashboardTaskSessionId(task: SakiActiveTaskSummary): string {
  return task.conversationId ?? `task-${task.id}`;
}

export function dashboardTaskIsPending(task: SakiActiveTaskSummary): boolean {
  return task.status === "running" || task.status === "pending_approval" || task.status === "pending_input";
}

export function dashboardTaskNeedsSync(current: DashboardChatMessage[], task: SakiActiveTaskSummary): boolean {
  if (dashboardTaskIsPending(task)) return true;
  const id = task.assistantMessageId ?? `${task.id}-assistant`;
  return current.some((message) => message.id === id && (message.isStreaming || message.taskId !== task.id));
}

// A task snapshot updates only its own assistant row. Earlier turns and local
// history edits must survive subsequent task-list refreshes.
export function dashboardTaskMessages(current: DashboardChatMessage[], task: SakiActiveTaskSummary): DashboardChatMessage[] {
  const assistantId = task.assistantMessageId ?? `${task.id}-assistant`;
  const existing = current.find((message) => message.id === assistantId);
  if (existing && !dashboardTaskNeedsSync(current, task)) return current;
  const response = task.response;
  const assistant: DashboardChatMessage = {
    ...existing, id: assistantId, role: "assistant", taskId: task.id,
    content: response?.message ?? (task.error ? [existing?.content, task.error].filter(Boolean).join("\n\n") : existing?.content ?? ""),
    thinking: response?.thinking ?? existing?.thinking,
    actions: response?.actions ?? existing?.actions,
    createdAt: existing?.createdAt ?? task.startedAt, time: existing?.time ?? "刚刚",
    isStreaming: task.status === "running", isThinking: false,
    workflowMessage: task.status === "running" ? task.progress?.message : undefined
  };
  if (existing) return current.map((message) => message.id === assistantId ? assistant : message);
  const hasUser = current.some((message) => message.role === "user" && (task.userMessageId ? message.id === task.userMessageId : message.content === task.message));
  const user: DashboardChatMessage = { id: task.userMessageId ?? `${task.id}-user`, role: "user", content: task.message, createdAt: task.startedAt, time: "刚刚" };
  return hasUser ? [...current, assistant] : [...current, user, assistant];
}
