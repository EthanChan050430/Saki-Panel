import { prisma } from "../../db.js";
import { RouteError, type SakiActiveTask } from "./types.js";
import type { SakiChatResponse, SakiTimelineEvent } from "@webops/shared";
import { sakiWorkspaceContextKey } from "@webops/shared";

const writes = new Map<string, Promise<unknown>>();
export async function withSakiConversationLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const operation = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
  writes.set(id, operation);
  try { return await operation; }
  finally { if (writes.get(id) === operation) writes.delete(id); }
}

export async function saveClientSakiConversation(userId: string, id: string, body: Record<string, unknown>) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !Array.isArray(body.messages)) throw new RouteError("Invalid conversation data.", 400);
  return withSakiConversationLock(id, async () => {
    const existing = await prisma.sakiConversation.findUnique({ where: { id } });
    if (existing && existing.userId !== userId) throw new RouteError("Forbidden", 403);
    const data = {
      contextKey: typeof body.contextKey === "string" ? body.contextKey : existing?.contextKey ?? "global",
      title: typeof body.title === "string" ? body.title : existing?.title ?? "新对话",
      label: typeof body.label === "string" ? body.label : existing?.label ?? "Saki",
      detail: typeof body.detail === "string" ? body.detail : existing?.detail ?? "",
      instanceId: typeof body.instanceId === "string" ? body.instanceId : body.instanceId === null ? null : existing?.instanceId ?? null,
      messages: JSON.stringify(body.messages)
    };
    if (body.workspaceInstanceIds !== undefined) {
      try { data.contextKey = sakiWorkspaceContextKey(data.instanceId, body.workspaceInstanceIds as string[]); }
      catch (error) { throw new RouteError((error as Error).message, 400); }
    }
    if (!existing) {
      if (body.baseUpdatedAt) throw new RouteError("Conversation was deleted. Refresh before saving.", 409);
      try {
        const record = await prisma.sakiConversation.create({ data: { id, userId, ...data } });
        return { ok: true, id, updatedAt: record.updatedAt.toISOString() };
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") throw new RouteError("Conversation changed on another device. Refresh before saving.", 409);
        throw error;
      }
    }
    if (body.baseUpdatedAt !== existing.updatedAt.toISOString()) throw new RouteError("Conversation changed on another device. Refresh before saving.", 409);
    const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1));
    const result = await prisma.sakiConversation.updateMany({ where: { id, userId, updatedAt: existing.updatedAt }, data: { ...data, updatedAt } });
    if (result.count !== 1) throw new RouteError("Conversation changed on another device. Refresh before saving.", 409);
    return { ok: true, id, updatedAt: updatedAt.toISOString() };
  });
}

export async function persistSakiTaskConversation(task: SakiActiveTask, response?: SakiChatResponse): Promise<void> {
  const id = task.input.conversationId ?? `task-${task.id}`;
  await withSakiConversationLock(id, async () => {
    const existing = await prisma.sakiConversation.findUnique({ where: { id } });
    if (existing && existing.userId !== task.userId) throw new RouteError("Forbidden", 403);
    let messages: Record<string, unknown>[] = [];
    try { const parsed: unknown = JSON.parse(existing?.messages ?? "[]"); if (Array.isArray(parsed)) messages = parsed; } catch {}
    const userId = task.input.userMessageId ?? `${task.id}-user`;
    const assistantId = task.input.assistantMessageId ?? `${task.id}-assistant`;
    const previousAssistant = messages.find(message => message.id === assistantId);
    const timelineEvents = new Map<string, SakiTimelineEvent>((Array.isArray(previousAssistant?.timelineEvents) ? previousAssistant.timelineEvents as SakiTimelineEvent[] : []).map(event => [event.id, event]));
    for (const [index, event] of [...(task.historyEvents ?? []), ...task.eventsBuffer].entries()) {
      if (event.type === "done" || event.type === "error") continue;
      const id = event.id ?? `${task.id}:${task.runVersion ?? 1}:${index}:${event.ts}`;
      timelineEvents.set(id, { id, type: event.type, payload: event.payload, ts: event.ts });
    }
    const recordedEvents = [...timelineEvents.values()];
    if (response) response.timelineEvents = recordedEvents;
    const upsert = (message: Record<string, unknown>) => {
      const index = messages.findIndex((item) => item?.id === message.id);
      if (index < 0) messages.push(message); else messages[index] = { ...messages[index], ...message };
    };
    upsert({ id: userId, role: "user", content: task.input.message, createdAt: task.startedAt, attachments: task.input.attachments ?? [] });
    upsert({ id: assistantId, role: "assistant", content: response?.message ?? "", createdAt: task.startedAt,
      source: response?.source ?? "direct-model", streaming: !response, taskId: task.id, timelineEvents: recordedEvents,
      ...(recordedEvents.length ? { timeline: undefined, timelineBase: undefined } : {}),
      ...(response ? { actions: response.actions ?? [], thinking: response.thinking, usage: response.usage, retry: response.retry, attachments: response.attachments ?? [] } : {}) });
    const data = { messages: JSON.stringify(messages), contextKey: sakiWorkspaceContextKey(task.instanceId, task.input.workspaceInstanceIds), instanceId: task.instanceId, updatedAt: new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1)) };
    await prisma.sakiConversation.upsert({ where: { id },
      create: { id, userId: task.userId, title: task.input.message.slice(0, 80), label: "Saki", detail: "", ...data }, update: data });
  });
}

export async function syncSakiTaskResult(task: SakiActiveTask, response: SakiChatResponse): Promise<void> {
  task.pendingHistorySync = response;
  try {
    await persistSakiTaskConversation(task, response);
    if (task.pendingHistorySync === response) delete task.pendingHistorySync;
  } catch (error) {
    console.warn("[Saki] Task history sync failed; background retry scheduled:", error instanceof Error ? error.message : String(error));
  }
}
