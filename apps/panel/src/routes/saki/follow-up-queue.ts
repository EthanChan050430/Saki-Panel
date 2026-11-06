import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { SakiChatRequest, SakiFollowUpQueueState, SakiQueuedFollowUp } from "@webops/shared";
import { RouteError } from "./types.js";

type RecordState = SakiFollowUpQueueState & { userId: string; admittedIds?: string[] };
export type FollowUpReadiness = { state: "wait" | "ready" | "pause"; reason?: string };
export interface FollowUpQueueWorker {
  inspect(userId: string, item: SakiQueuedFollowUp): Promise<FollowUpReadiness>;
  dispatch(userId: string, item: SakiQueuedFollowUp): Promise<string>;
}

/** Persistent, account-scoped admission queue. A claim is committed before any model/tool work. */
export class SakiFollowUpQueue {
  private records = new Map<string, RecordState>();
  private locks = new Map<string, Promise<unknown>>();
  private processing = false;
  readonly ready: Promise<void>;
  constructor(private directory: string, private worker: FollowUpQueueWorker) { this.ready = this.restore(); }
  private filename(userId: string) { return path.join(this.directory, `${createHash("sha256").update(userId).digest("hex")}.json`); }
  private async restore() {
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of await fs.readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const record = JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8")) as RecordState;
        if (!record.userId || !Array.isArray(record.items) || path.basename(this.filename(record.userId)) !== name) continue;
        let recovered = false;
        for (const item of record.items) if (item.status === "sending") {
          item.status = "paused";
          item.reason = "上次发送时服务中断，提交结果待确认。请检查对话后再继续，避免重复执行。";
          recovered = true;
        }
        this.records.set(record.userId, record);
        if (recovered) await this.persist(record);
      } catch { /* An unreadable file never becomes runnable work. */ }
    }
  }
  private async locked<T>(userId: string, work: (record: RecordState) => Promise<T>): Promise<T> {
    await this.ready;
    const operation = (this.locks.get(userId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const record = this.records.get(userId) ?? { userId, revision: 0, items: [] };
      this.records.set(userId, record);
      return work(record);
    });
    this.locks.set(userId, operation);
    try { return await operation; } finally { if (this.locks.get(userId) === operation) this.locks.delete(userId); }
  }
  private async persist(record: RecordState) {
    const next = { ...record, revision: record.revision + 1 };
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 48 * 1024 * 1024) throw new RouteError("排队消息及附件超过保存上限，请减少附件。", 413);
    const temporary = `${this.filename(record.userId)}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, serialized, { mode: 0o600 });
      await fs.rename(temporary, this.filename(record.userId));
      record.revision = next.revision;
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private snapshot(record: RecordState): SakiFollowUpQueueState { return structuredClone({ revision: record.revision, items: record.items }); }
  async list(userId: string, includeAttachments = true) {
    return this.locked(userId, async record => {
      if (includeAttachments) return this.snapshot(record);
      return this.snapshot({ ...record, items: record.items.map(item => {
        const input: SakiChatRequest = { ...item.input };
        if (item.input.attachments) input.attachments = item.input.attachments.map(attachment => {
          const { dataUrl: _data, text: _text, ...metadata } = attachment;
          return metadata;
        });
        delete input.history;
        return { ...item, input };
      }) });
    });
  }
  async add(userId: string, item: SakiQueuedFollowUp) {
    return this.locked(userId, async record => {
      if (record.admittedIds?.includes(item.id) || record.items.some(previous => previous.id === item.id)) return this.snapshot(record);
      if (record.items.length >= 32) throw new RouteError("最多保留 32 条排队消息。", 400);
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(item.id) || !/^[a-zA-Z0-9_-]{1,200}$/.test(item.conversationId)
        || item.input.conversationId !== item.conversationId || !item.input.message?.trim()) throw new RouteError("排队消息无效。", 400);
      const cleanInput: SakiChatRequest = { ...structuredClone(item.input), mode: "agent", clientRequestId: `queue-${item.id}`,
        userMessageId: `qu-${item.id}`, assistantMessageId: `qa-${item.id}` };
      delete cleanInput.resumeTaskId;
      delete cleanInput.history;
      const admitted: SakiQueuedFollowUp = { ...structuredClone(item), status: "pending", createdAt: new Date().toISOString(), input: cleanInput };
      if (admitted.intent === "steer") admitted.steerSequence = Math.max(0, ...record.items.map(item => item.steerSequence ?? 0)) + 1;
      const next = { ...record, admittedIds: [...(record.admittedIds ?? []), item.id].slice(-4096), items: [...record.items, admitted] };
      await this.persist(next);
      this.records.set(userId, next);
      return this.snapshot(next);
    });
  }
  async change(userId: string, conversationId: string, revision: number, input: { id?: string; action: string; message?: string; ids?: string[] }) {
    return this.locked(userId, async stored => {
      if (stored.revision !== revision) throw new RouteError("队列已更新，请重试。消息仍已保留。", 409);
      const record = structuredClone(stored);
      const items = record.items.filter(item => item.conversationId === conversationId);
      const item = items.find(item => item.id === input.id);
      if (input.action === "reorder") {
        if (!input.ids || input.ids.length !== items.length || new Set(input.ids).size !== items.length
          || input.ids.some(id => !items.some(item => item.id === id)) || items.some(item => item.status === "sending")) throw new RouteError("队列排序已变化，请重试。", 409);
        const ordered = input.ids.map(id => items.find(item => item.id === id)!);
        let index = 0;
        record.items = record.items.map(item => item.conversationId === conversationId ? ordered[index++]! : item);
      } else if (input.action === "resume_all") {
        if (items.some(item => item.status === "sending" || item.editing)) throw new RouteError("请先完成正在提交或编辑的消息。", 409);
        for (const item of items) {
          item.status = "pending"; item.intent = "queue";
          delete item.reason; delete item.afterTaskId; delete item.afterRequestId;
        }
      } else if (input.action === "clear") {
        if (items.some(item => item.status === "sending")) throw new RouteError("有消息正在提交，请稍后取消。", 409);
        record.items = record.items.filter(item => item.conversationId !== conversationId);
      } else {
        if (!item) throw new RouteError("这条排队消息已发送或取消，请刷新队列。", 404);
        if (item.status === "sending") throw new RouteError("消息正在提交，暂时不能修改。", 409);
        if (input.action === "remove") record.items = record.items.filter(previous => previous.id !== item.id);
        else if (input.action === "edit") {
          if (!input.message?.trim() || input.message.length > 32000) throw new RouteError("消息不能为空或超过长度限制。", 400);
          item.input.message = input.message.trim();
          if (item.editing) {
            item.status = item.editing.status;
            if (item.editing.reason) item.reason = item.editing.reason; else delete item.reason;
            delete item.editing;
          }
        } else if (input.action === "hold") {
          if (!item.editing) item.editing = { status: item.status, ...(item.reason ? { reason: item.reason } : {}) };
          item.status = "paused";
          item.reason = "正在编辑，保存修改后继续排队。";
        } else if (input.action === "release") {
          if (item.editing) {
            item.status = item.editing.status;
            if (item.editing.reason) item.reason = item.editing.reason; else delete item.reason;
            delete item.editing;
          }
        } else if (input.action === "steer" || input.action === "resume") {
          item.intent = input.action === "steer" ? "steer" : "queue";
          if (input.action === "steer") item.steerSequence = Math.max(0, ...record.items.map(item => item.steerSequence ?? 0)) + 1;
          item.status = "pending";
          delete item.reason;
          delete item.editing;
          delete item.afterTaskId;
          delete item.afterRequestId;
          if (input.action === "resume") {
            const first = record.items.findIndex(previous => previous.conversationId === conversationId);
            record.items = record.items.filter(previous => previous.id !== item.id);
            record.items.splice(first, 0, item);
          }
        } else throw new RouteError("未知队列操作。", 400);
      }
      await this.persist(record);
      this.records.set(userId, record);
      return this.snapshot(record);
    });
  }
  async pause(userId: string, conversationId?: string) {
    return this.locked(userId, async record => {
      for (const item of record.items) if (!conversationId || item.conversationId === conversationId) {
        item.status = "paused";
        item.reason = "当前任务已停止，队列已暂停。可继续发送、编辑或取消排队。";
        if (item.editing) item.editing = { status: "paused", reason: item.reason };
      }
      await this.persist(record);
    });
  }
  async isClaimed(userId: string, id: string) { return this.locked(userId, async record => record.items.some(item => item.id === id && item.status === "sending")); }
  async tick() {
    await this.ready;
    if (this.processing) return;
    this.processing = true;
    try {
      for (const userId of this.records.keys()) {
        const snapshot = await this.locked(userId, async record => ({ revision: record.revision, items: record.items.map(item => ({ ...item })) }));
        const heads = new Map<string, SakiQueuedFollowUp>();
        for (const item of snapshot.items) if (!heads.has(item.conversationId)) heads.set(item.conversationId, item);
        // A selected queued item can steer the current run without reordering the rest.
        const steers = new Set<string>();
        for (const item of [...snapshot.items].sort((a, b) => (a.steerSequence ?? 0) - (b.steerSequence ?? 0))) if (item.intent === "steer" && item.status === "pending" && !steers.has(item.conversationId)) {
          heads.set(item.conversationId, item); steers.add(item.conversationId);
        }
        for (const item of heads.values()) {
          if (item.status !== "pending") continue;
          let readiness: FollowUpReadiness;
          try { readiness = await this.worker.inspect(userId, item); }
          catch (error) { readiness = { state: "pause", reason: error instanceof Error ? error.message : "无法确认任务状态。" }; }
          if (readiness.state === "wait") continue;
          const claimed = await this.locked(userId, async record => {
            if (record.revision !== snapshot.revision) return false;
            const live = record.items.find(live => live.id === item.id);
            if (!live || live.status !== "pending") return false;
            live.status = readiness.state === "ready" ? "sending" : "paused";
            if (readiness.reason) live.reason = readiness.reason;
            await this.persist(record);
            return readiness.state === "ready";
          });
          if (!claimed) continue;
          try {
            const taskId = await this.worker.dispatch(userId, item);
            await this.locked(userId, async record => {
              record.items = record.items.filter(live => live.id !== item.id);
              for (const next of record.items) if (next.conversationId === item.conversationId) {
                next.afterTaskId = taskId;
                delete next.afterRequestId;
              }
              await this.persist(record);
            });
          } catch (error) {
            await this.locked(userId, async record => {
              const live = record.items.find(live => live.id === item.id);
              if (live) { live.status = "paused"; live.reason = error instanceof Error ? error.message : "提交未确认，请检查对话后重试。"; }
              await this.persist(record);
            });
          }
          break; // refresh revisions before admitting another message from this account
        }
      }
    } finally { this.processing = false; }
  }
}
