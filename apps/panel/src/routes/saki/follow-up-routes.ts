import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SakiChatRequest, SakiQueuedFollowUp } from "@webops/shared";
import { sakiWorkspaceContextKey } from "@webops/shared";
import { panelPaths } from "../../config.js";
import { prisma } from "../../db.js";
import { requireAnyPermission } from "../../auth.js";
import { assertUserHasSpendablePoints } from "../../points.js";
import { prepareSakiChatInvocation } from "./chat.js";
import { SakiFollowUpQueue, type FollowUpReadiness } from "./follow-up-queue.js";
import { assertSakiSessionAccess, assertSakiSelectedWorkspaces, assertSakiTaskAccess } from "./session-access.js";
import { activeSakiTasks, enqueueSakiTaskSteer, findSakiTaskByRequest } from "./state.js";
import { objectValue, RouteError, sanitizeSakiInputAttachments, sakiUsePermissions, trimString, type SakiActiveTask } from "./types.js";
import { hydrateSakiAttachmentsForModel } from "./ocr.js";
import { readEffectiveSakiConfig } from "./config.js";
import { withRequestedSakiModel } from "./types.js";

export async function registerSakiFollowUpRoutes(app: FastifyInstance,
  start: (request: FastifyRequest, prepared: Awaited<ReturnType<typeof prepareSakiChatInvocation>>, admission?: () => Promise<boolean>) => Promise<SakiActiveTask>) {
  const ownedConversation = async (userId: string, id: string) => {
    const conversation = await prisma.sakiConversation.findUnique({ where: { id } });
    if (conversation && conversation.userId !== userId) throw new RouteError("Conversation not found.", 404);
    return conversation;
  };
  const conversationTask = (userId: string, id: string) => [...activeSakiTasks.values()]
    .filter(task => task.userId === userId && task.input.conversationId === id)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const inspect = async (userId: string, item: SakiQueuedFollowUp): Promise<FollowUpReadiness> => {
    const current = conversationTask(userId, item.conversationId);
    if (current?.status === "running") return { state: item.intent === "steer" && current.acceptingSteers !== false ? "ready" : "wait" };
    if ([...activeSakiTasks.values()].some(task => task.userId === userId && task.instanceId === (item.input.instanceId ?? null)
      && (task.execution || task.decisionInFlight || ["running", "pending_input", "pending_approval"].includes(task.status)))) return { state: "wait" };
    const anchor = item.afterTaskId ? activeSakiTasks.get(item.afterTaskId) : findSakiTaskByRequest(userId, item.afterRequestId);
    if (anchor) {
      if (anchor.userId !== userId || anchor.input.conversationId !== item.conversationId) throw new RouteError("队列不属于当前任务。", 403);
      if (anchor.status === "cancelled" || anchor.status === "failed") return { state: "pause", reason: "上一条任务已停止或失败，队列已暂停。请确认结果后继续发送。" };
      if (anchor.status !== "completed" || anchor.execution) return { state: "wait" };
    } else if (item.afterTaskId || item.afterRequestId) {
      const conversation = await ownedConversation(userId, item.conversationId);
      const messages: any[] = JSON.parse(conversation?.messages ?? "[]");
      const previous = item.afterTaskId ? messages.find(message => message.taskId === item.afterTaskId && message.role === "assistant") : null;
      if (!previous && !item.afterTaskId && Date.now() - Date.parse(item.createdAt) < 60_000) return { state: "wait" };
      if (!previous || previous.streaming || previous.isStreaming || previous.retry || previous.actions?.some((action: any) => ["pending_input", "pending_approval"].includes(action.status))) {
        return { state: "pause", reason: "上一条任务的状态未确认，排队消息已保留。请检查对话后继续发送。" };
      }
    }
    return { state: "ready" };
  };
  const queue: SakiFollowUpQueue = new SakiFollowUpQueue(path.join(panelPaths.dataDir, "saki-follow-up-queues"), {
    inspect,
    async dispatch(userId, item): Promise<string> {
      const { user } = await assertSakiSessionAccess(userId, item.input.instanceId ?? null);
      await assertSakiSelectedWorkspaces(userId, item.input.instanceId, item.input.workspaceInstanceIds);
      const conversation = await ownedConversation(userId, item.conversationId);
      if (conversation && sakiWorkspaceContextKey(item.input.instanceId, item.input.workspaceInstanceIds) !== conversation.contextKey) {
        throw new RouteError("对话工作区已改变，请编辑或撤回排队消息后重发。", 409);
      }
      const current = conversationTask(userId, item.conversationId);
      if (item.intent === "steer" && current?.status === "running") {
        await assertSakiTaskAccess(userId, current);
        if (item.input.message.length > 8000) throw new RouteError("引导消息最多 8000 字符；较长内容请排队发送。", 400);
        const config = withRequestedSakiModel(await readEffectiveSakiConfig(), current.input);
        const attachments = await hydrateSakiAttachmentsForModel(sanitizeSakiInputAttachments(item.input.attachments), item.input.message, config);
        if (!await queue.isClaimed(userId, item.id)) throw new RouteError("队列已暂停，引导消息已保留。", 409);
        if (!enqueueSakiTaskSteer(current.id, item.input.message, attachments, item.id)) throw new RouteError("当前任务已结束或正在收尾，消息已保留，请选择继续发送。", 409);
        return current.id;
      }
      await assertUserHasSpendablePoints(userId);
      const request = { user: { sub: user.id, permissions: user.permissions }, ip: "127.0.0.1", headers: { "user-agent": "Saki queued follow-up" }, log: app.log } as unknown as FastifyRequest;
      const messages: any[] = JSON.parse(conversation?.messages ?? "[]");
      const history = messages.filter(message => !message.rollbackJournal && ["user", "assistant"].includes(message.role)).slice(-12)
        .map(message => ({ role: message.role, content: String(message.content ?? ""), ...(message.thinking ? { thinking: message.thinking } : {}) }));
      const prepared = await prepareSakiChatInvocation(request, { ...item.input, history });
      return (await start(request, prepared, () => queue.isClaimed(userId, item.id))).id;
    }
  });
  await queue.ready;
  const timer = setInterval(() => { void queue.tick().catch(error => app.log.error({ err: error }, "Follow-up queue worker failed")); }, 750);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
  const auth = { preHandler: requireAnyPermission(sakiUsePermissions) };
  const summary = (state: import("@webops/shared").SakiFollowUpQueueState) => ({ ...state, items: state.items.map(item => {
    const input = { ...item.input, attachments: item.input.attachments?.map(attachment => {
      const { dataUrl: _data, text: _text, ...metadata } = attachment;
      return metadata;
    }) };
    delete input.history;
    return { ...item, input };
  }) });
  app.get("/api/saki/follow-ups", auth, async request => {
    return queue.list(request.user.sub, (request.query as { includeAttachments?: string }).includeAttachments === "1");
  });
  app.post("/api/saki/follow-ups", auth, async request => {
    const body = objectValue(request.body) ?? {};
    const input = objectValue(body.input) as SakiChatRequest | null;
    if (!input || input.mode !== "agent" || !trimString(input.message) || input.message.length > 32000) throw new RouteError("Agent 排队消息无效。", 400);
    const conversationId = trimString(input.conversationId);
    await ownedConversation(request.user.sub, conversationId);
    await assertSakiSessionAccess(request.user.sub, input.instanceId ?? null);
    await assertSakiSelectedWorkspaces(request.user.sub, input.instanceId, input.workspaceInstanceIds);
    const item: SakiQueuedFollowUp = { id: trimString(body.id), conversationId, input: { ...input, attachments: sanitizeSakiInputAttachments(input.attachments) },
      status: "pending", intent: "queue", createdAt: new Date().toISOString(),
      ...(trimString(body.afterTaskId) ? { afterTaskId: trimString(body.afterTaskId) } : {}),
      ...(trimString(body.afterRequestId) ? { afterRequestId: trimString(body.afterRequestId) } : {}) };
    return summary(await queue.add(request.user.sub, item));
  });
  app.patch("/api/saki/follow-ups/:conversationId", auth, async request => {
    const conversationId = trimString((request.params as { conversationId: string }).conversationId);
    await ownedConversation(request.user.sub, conversationId);
    const body = objectValue(request.body) ?? {};
    if (typeof body.revision !== "number") throw new RouteError("缺少队列版本，请刷新。", 400);
    return summary(await queue.change(request.user.sub, conversationId, body.revision, {
      action: trimString(body.action), ...(trimString(body.id) ? { id: trimString(body.id) } : {}),
      ...(typeof body.message === "string" ? { message: body.message } : {}),
      ...(Array.isArray(body.ids) && body.ids.every(id => typeof id === "string") ? { ids: body.ids as string[] } : {})
    }));
  });
  return queue;
}
