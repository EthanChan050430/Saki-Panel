import { useCallback, useEffect, useRef, useState } from "react";
import type { SakiChatRequest, SakiFollowUpQueueState } from "@webops/shared";
import { api } from "../../api.js";

export function useSakiFollowUps(token: string, conversationId: string | null) {
  const [state, setState] = useState<SakiFollowUpQueueState>({ revision: -1, items: [] });
  const stateRef = useRef(state); stateRef.current = state;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const uncertainAdd = useRef<{ fingerprint: string; id: string } | null>(null);
  const accept = useCallback((next: SakiFollowUpQueueState) => {
    if (!Array.isArray(next.items)) return;
    if (next.revision <= stateRef.current.revision) return;
    stateRef.current = next; setState(next); setError("");
    window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
  }, []);
  const refresh = useCallback(async () => {
    const scope = generation.current;
    try { const next = await api.sakiFollowUps(token); if (scope === generation.current) accept(next); }
    catch { /* A disconnected queue stays visible; no local automatic replay. */ }
  }, [token, accept]);
  useEffect(() => {
    generation.current++;
    stateRef.current = { revision: -1, items: [] }; setState(stateRef.current);
    let inFlight = false;
    const poll = async () => { if (inFlight) return; inFlight = true; try { await refresh(); } finally { inFlight = false; } };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1500);
    window.addEventListener("saki:follow-ups-updated", poll);
    return () => { generation.current++; clearInterval(timer); window.removeEventListener("saki:follow-ups-updated", poll); };
  }, [refresh]);
  const perform = useCallback(async <T,>(work: (isCurrent: () => boolean) => Promise<T>): Promise<T> => {
    if (mutation.current) throw new Error("队列正在更新，请稍候。");
    mutation.current = true; setBusy(true);
    const scope = generation.current;
    try {
      const value = await work(() => scope === generation.current);
      if (scope === generation.current) { setError(""); window.dispatchEvent(new Event("saki:follow-ups-updated")); }
      return value;
    } catch (error) {
      if (scope === generation.current) { setError(error instanceof Error ? error.message : "队列更新失败，消息已保留。"); void refresh(); }
      throw error;
    } finally { mutation.current = false; if (scope === generation.current) setBusy(false); }
  }, [refresh]);
  const add = useCallback((input: SakiChatRequest, anchor: { afterTaskId?: string; afterRequestId?: string } = {}) => perform(async isCurrent => {
    const { clientRequestId: _request, userMessageId: _user, assistantMessageId: _assistant, history: _history, ...stable } = input;
    const fingerprint = JSON.stringify({ input: stable });
    const id = uncertainAdd.current?.fingerprint === fingerprint ? uncertainAdd.current.id : crypto.randomUUID();
    uncertainAdd.current = { fingerprint, id };
    const next = await api.sakiAddFollowUp(token, { id, input, intent: "queue", ...anchor });
    if (isCurrent()) { accept(next); uncertainAdd.current = null; }
  }), [token, perform, accept]);
  const change = useCallback((action: string, id?: string, message?: string, ids?: string[]) => perform(async isCurrent => {
    if (!conversationId) throw new Error("请先打开对话。");
    const next = await api.sakiChangeFollowUps(token, conversationId, { revision: stateRef.current.revision, action,
      ...(id ? { id } : {}), ...(message !== undefined ? { message } : {}), ...(ids ? { ids } : {}) });
    if (isCurrent()) accept(next);
  }), [token, conversationId, perform, accept]);
  const withdraw = useCallback((id?: string) => perform(async isCurrent => {
    if (!conversationId) throw new Error("请先打开对话。");
    const full = await api.sakiFollowUps(token, true);
    const items = full.items.filter(item => item.conversationId === conversationId && (!id || item.id === id));
    if (!items.length) throw new Error("排队消息已发送或取消，请刷新后重试。");
    const next = await api.sakiChangeFollowUps(token, conversationId, { revision: full.revision, action: id ? "remove" : "clear", ...(id ? { id } : {}) });
    if (isCurrent()) accept(next); return items;
  }), [token, conversationId, perform, accept]);
  return { items: state.items.filter(item => item.conversationId === conversationId), busy, error, add, change, withdraw, refresh };
}
