import type { SakiActiveTaskSummary } from "../../api.js";
import type { LocalSakiMessage } from "../../types/app.js";

type ReplayTask = Pick<SakiActiveTaskSummary, "id" | "message" | "startedAt" | "assistantMessageId" | "userMessageId">;

export function taskAssistantMessageId(task: ReplayTask): string {
  return task.assistantMessageId ?? `${task.id}-assistant`;
}

// Resolve IDs before queuing React state updates. Stream events may arrive
// before React evaluates an updater, and every replay must target the same row.
export function prepareSakiTaskReplay(current: LocalSakiMessage[], task: ReplayTask): LocalSakiMessage[] {
  const assistantId = taskAssistantMessageId(task);
  const existing = current.find((message) => message.id === assistantId && message.role === "assistant");
  const assistant: LocalSakiMessage = {
    ...existing,
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: existing?.createdAt ?? task.startedAt,
    source: "direct-model",
    thinking: undefined,
    timeline: [],
    actions: [],
    workflow: [],
    retry: undefined,
    usage: undefined,
    workflowExpanded: false,
    streaming: true
  };
  if (existing) return current.map((message) => message.id === assistantId ? assistant : message);
  const hasUser = current.some((message) => message.role === "user" && (task.userMessageId ? message.id === task.userMessageId : message.content === task.message));
  const user: LocalSakiMessage = { id: task.userMessageId ?? `${task.id}-user`, role: "user", content: task.message, createdAt: task.startedAt };
  return hasUser ? [...current, assistant] : [...current, user, assistant];
}
