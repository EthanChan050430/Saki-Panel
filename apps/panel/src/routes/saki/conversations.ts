import { prisma } from "../../db.js";
import { RouteError, type SakiActiveTask } from "./types.js";
import type { SakiChatResponse, SakiTimelineEvent } from "@webops/shared";
import { sakiWorkspaceContextKey } from "@webops/shared";
import { conversationMetadata, importConversationHistory, readMessageAt, storedMessage } from "./conversation-store.js";
import { activeSakiTasks, clearSessionAgentMemory, getSessionAgentMemory, isSakiTaskUnfinished, pendingSakiActions, removeActiveSakiTask, sakiActionsReady, sessionAgentMemoriesReady } from "./state.js";
import type { SakiSessionAgentMemory } from "./types.js";

const writes = new Map<string, Promise<unknown>>();

export function sakiMemoryConversationId(memory: SakiSessionAgentMemory): string | undefined {
  const { input, taskId } = memory.resumeState;
  return input.conversationId ?? (taskId ? `task-${taskId}` : undefined);
}

export async function sakiMemoryTurnExists(memory: SakiSessionAgentMemory): Promise<boolean> {
  const conversationId = sakiMemoryConversationId(memory);
  const taskId = memory.resumeState.taskId;
  if (!conversationId || !taskId) return false;
  const { userMessageId, assistantMessageId } = memory.resumeState.input;
  const row = await prisma.sakiConversationMessage.findFirst({
    where: { conversationId, role: "assistant", taskId, conversation: { userId: memory.userId },
      ...(assistantMessageId ? { messageId: assistantMessageId } : {}) },
    select: { position: true }
  });
  if (!row) return false;
  const user = await prisma.sakiConversationMessage.findFirst({
    where: { conversationId, role: "user", messageId: userMessageId ?? `${taskId}-user`, position: { lt: row.position } },
    select: { position: true }
  });
  return Boolean(user);
}

function hasUnsettledSakiConversation(userId: string, id: string): boolean {
  for (const task of activeSakiTasks.values()) {
    if (task.userId === userId && (task.input.conversationId ?? `task-${task.id}`) === id
      && (isSakiTaskUnfinished(task) || task.execution || task.decisionInFlight || task.pendingHistorySync)) return true;
  }
  for (const pending of pendingSakiActions.values()) {
    if (pending.userId === userId && pending.resume
      && (pending.resume.input.conversationId ?? `task-${pending.resume.taskId}`) === id) return true;
  }
  return false;
}
export async function withSakiConversationLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const operation = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
  writes.set(id, operation);
  try { return await operation; }
  finally { if (writes.get(id) === operation) writes.delete(id); }
}

export async function saveClientSakiConversation(userId: string, id: string, body: Record<string, unknown>) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !Array.isArray(body.messages)) throw new RouteError("Invalid conversation data.", 400);
  if (body.messagesLoaded === false) throw new RouteError("Load conversation messages before saving.", 400);
  if (body.historyBeforeId != null && typeof body.historyBeforeId !== "string") throw new RouteError("Invalid history cursor.", 400);
  const messages = body.messages as unknown[];
  return withSakiConversationLock(id, async () => {
    const existing = await prisma.sakiConversation.findUnique({ where: { id }, select: conversationMetadata });
    if (existing && existing.userId !== userId) throw new RouteError("Forbidden", 403);
    if (existing && body.baseUpdatedAt !== existing.updatedAt.toISOString()) throw new RouteError("Conversation changed on another device. Refresh before saving.", 409);
    if (!existing && body.baseUpdatedAt) throw new RouteError("Conversation was deleted. Refresh before saving.", 409);
    if (body.rewriteHistory === true) {
      await sakiActionsReady;
      if (hasUnsettledSakiConversation(userId, id)) throw new RouteError("请等待该对话的任务停止并完成保存，再撤回或编辑消息。", 409);
    }
    const data = {
      contextKey: typeof body.contextKey === "string" ? body.contextKey : existing?.contextKey ?? "global",
      title: typeof body.title === "string" ? body.title : existing?.title ?? "新对话",
      label: typeof body.label === "string" ? body.label : existing?.label ?? "Saki",
      detail: typeof body.detail === "string" ? body.detail : existing?.detail ?? "",
      instanceId: typeof body.instanceId === "string" ? body.instanceId : body.instanceId === null ? null : existing?.instanceId ?? null,
    };
    if (body.workspaceInstanceIds !== undefined) {
      try { data.contextKey = sakiWorkspaceContextKey(data.instanceId, body.workspaceInstanceIds as string[]); }
      catch (error) { throw new RouteError((error as Error).message, 400); }
    }
    if (existing) await importConversationHistory(id);
    const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
    await prisma.$transaction(async tx => {
      let start = 0;
      if (existing) {
        const result = await tx.sakiConversation.updateMany({ where: { id, userId, updatedAt: existing.updatedAt }, data: { ...data, updatedAt } });
        if (result.count !== 1) throw new RouteError("Conversation changed on another device. Refresh before saving.", 409);
      } else {
        await tx.sakiConversation.create({ data: { id, userId, ...data, messages: "[]", updatedAt }, select: { id: true } });
      }
      if (typeof body.historyBeforeId === "string" && body.historyBeforeId) {
        const anchor = await tx.sakiConversationMessage.findFirst({
          where: { conversationId: id, messageId: body.historyBeforeId }, orderBy: { position: "asc" }, select: { position: true }
        });
        if (!anchor) throw new RouteError("History changed. Reload the conversation before saving.", 409);
        start = anchor.position;
      }
      const previousTaskIds = new Map<string, string>();
      for (const task of activeSakiTasks.values()) {
        if (task.userId === userId && (task.input.conversationId ?? `task-${task.id}`) === id) {
          previousTaskIds.set(task.input.assistantMessageId ?? `${task.id}-assistant`, task.id);
        }
      }
      if (body.append === true) {
        const last = await tx.sakiConversationMessage.findFirst({
          where: { conversationId: id }, orderBy: { position: "desc" }, select: { position: true }
        });
        start = (last?.position ?? -1) + 1;
      } else {
        const existingTasks = await tx.sakiConversationMessage.findMany({
          where: { conversationId: id, position: { gte: start }, messageId: { not: null }, taskId: { not: null } },
          select: { messageId: true, taskId: true }
        });
        for (const row of existingTasks) if (row.messageId && row.taskId) previousTaskIds.set(row.messageId, row.taskId);
        await tx.sakiConversationMessage.deleteMany({ where: { conversationId: id, position: { gte: start } } });
      }
      // A loaded page can include a message that was also present in the prefix.
      for (const [index, message] of messages.entries()) {
        const row = storedMessage(id, start + index, message, previousTaskIds);
        if (start > 0 && row.messageId) await tx.sakiConversationMessage.deleteMany({
          where: { conversationId: id, messageId: row.messageId, position: { lt: start } }
        });
        await tx.sakiConversationMessage.create({ data: row, select: { position: true } });
      }
    }, { timeout: 60_000 }).catch(error => {
      if ((error as { code?: string }).code === "P2002") throw new RouteError("Conversation changed on another device. Refresh before saving.", 409);
      throw error;
    });
    if (existing && body.append !== true) {
      const finished = [...activeSakiTasks.values()].filter(task => task.userId === userId
        && (task.input.conversationId ?? `task-${task.id}`) === id
        && !isSakiTaskUnfinished(task) && !task.execution && !task.decisionInFlight && !task.pendingHistorySync);
      if (finished.length) {
        try {
          const retained = await prisma.sakiConversationMessage.findMany({
            where: { conversationId: id, role: "assistant", taskId: { in: finished.map(task => task.id) } },
            select: { taskId: true }
          });
          const retainedIds = new Set(retained.map(row => row.taskId));
          for (const task of finished) {
            if (!retainedIds.has(task.id) && activeSakiTasks.get(task.id) === task) removeActiveSakiTask(task.id);
          }
        } catch (error) {
          console.warn("[Saki] Could not discard withdrawn task results:", error instanceof Error ? error.message : String(error));
        }
      }
      await sessionAgentMemoriesReady;
      const memory = getSessionAgentMemory(userId, existing.instanceId);
      if (memory && sakiMemoryConversationId(memory) === id) {
        try {
          if (!await sakiMemoryTurnExists(memory) && getSessionAgentMemory(userId, existing.instanceId) === memory) {
            clearSessionAgentMemory(userId, existing.instanceId);
          }
        } catch (error) {
          console.warn("[Saki] Could not discard a stale conversation resume record:", error instanceof Error ? error.message : String(error));
        }
      }
    }
    return { ok: true, id, updatedAt: updatedAt.toISOString() };
  });
}

export async function persistSakiTaskConversation(task: SakiActiveTask, response?: SakiChatResponse): Promise<void> {
  const id = task.input.conversationId ?? `task-${task.id}`;
  await withSakiConversationLock(id, async () => {
    const existing = await prisma.sakiConversation.findUnique({ where: { id }, select: { userId: true, updatedAt: true } });
    if (existing && existing.userId !== task.userId) throw new RouteError("Forbidden", 403);
    if (existing) await importConversationHistory(id);
    const userId = task.input.userMessageId ?? `${task.id}-user`;
    const assistantId = task.input.assistantMessageId ?? `${task.id}-assistant`;
    const current = await prisma.sakiConversationMessage.findMany({
      where: { conversationId: id, messageId: { in: [userId, assistantId] } },
      orderBy: { position: "asc" }, select: { messageId: true, position: true }
    });
    const userPosition = current.find(row => row.messageId === userId)?.position;
    const assistantPosition = current.find(row => row.messageId === assistantId)?.position;
    const previousAssistant = assistantPosition === undefined ? null : await readMessageAt(id, assistantPosition) as Record<string, unknown> | null;
    const timelineEvents = new Map<string, SakiTimelineEvent>((Array.isArray(previousAssistant?.timelineEvents) ? previousAssistant.timelineEvents as SakiTimelineEvent[] : []).map(event => [event.id, event]));
    for (const [index, event] of [...(task.historyEvents ?? []), ...task.eventsBuffer].entries()) {
      if (event.type === "done" || event.type === "error") continue;
      const id = event.id ?? `${task.id}:${task.runVersion ?? 1}:${index}:${event.ts}`;
      timelineEvents.set(id, { id, type: event.type, payload: event.payload, ts: event.ts });
    }
    const recordedEvents = [...timelineEvents.values()];
    if (response) response.timelineEvents = recordedEvents;
    const userMessage = { id: userId, role: "user", content: task.input.message, createdAt: task.startedAt, attachments: task.input.attachments ?? [] };
    const assistantMessage = { ...previousAssistant, id: assistantId, role: "assistant", content: response?.message ?? "", createdAt: task.startedAt,
      source: response?.source ?? "direct-model", streaming: !response, taskId: task.id, timelineEvents: recordedEvents,
      ...(recordedEvents.length ? { timeline: undefined, timelineBase: undefined } : {}),
      ...(response ? { actions: response.actions ?? [], thinking: response.thinking, usage: response.usage, retry: response.retry, attachments: response.attachments ?? [] } : {}) };
    const data = { contextKey: sakiWorkspaceContextKey(task.instanceId, task.input.workspaceInstanceIds), instanceId: task.instanceId, updatedAt: new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1)) };
    const assistant = storedMessage(id, assistantPosition ?? 0, assistantMessage);
    await prisma.$transaction(async tx => {
      if (existing) {
        const result = await tx.sakiConversation.updateMany({ where: { id, userId: task.userId, updatedAt: existing.updatedAt }, data });
        if (result.count !== 1) throw new RouteError("Conversation changed on another device. Refresh before saving.", 409);
      } else {
        await tx.sakiConversation.create({ data: { id, userId: task.userId, title: task.input.message.slice(0, 80), label: "Saki", detail: "", messages: "[]", ...data }, select: { id: true } });
      }
      const last = await tx.sakiConversationMessage.findFirst({ where: { conversationId: id }, orderBy: { position: "desc" }, select: { position: true } });
      let next = (last?.position ?? -1) + 1;
      if (userPosition === undefined) await tx.sakiConversationMessage.create({ data: storedMessage(id, next++, userMessage), select: { position: true } });
      if (assistantPosition === undefined) await tx.sakiConversationMessage.create({ data: { ...assistant, position: next }, select: { position: true } });
      else await tx.sakiConversationMessage.update({ where: { conversationId_position: { conversationId: id, position: assistantPosition } }, data: assistant, select: { position: true } });
    }, { timeout: 60_000 });
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
