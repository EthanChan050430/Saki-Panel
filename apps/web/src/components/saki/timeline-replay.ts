import type { SakiAgentAction, SakiTimelineEvent } from "@webops/shared";
import type { LocalSakiTimelineItem } from "../../types/app.js";

const cache = new WeakMap<SakiTimelineEvent[], LocalSakiTimelineItem[]>();

/** Replay in one pass; never scan/copy the complete timeline for every event. */
export function replaySakiTimeline(events: SakiTimelineEvent[] | undefined): LocalSakiTimelineItem[] {
  if (!events) return [];
  const cached = cache.get(events);
  if (cached) return cached;
  const result: LocalSakiTimelineItem[] = [];
  const positions = new Map<string, number>();
  const settledWorkflows = new Set<string>();
  const pendingByTool = new Map<string, { positions: number[]; cursor: number }>();
  const seal = () => {
    const last = result.at(-1);
    if (last?.kind === "text" && last.source === "delta") last.source = "final";
  };
  const put = (item: LocalSakiTimelineItem) => {
    const index = positions.get(item.id);
    if (index === undefined) { positions.set(item.id, result.length); result.push(item); }
    else result[index] = item;
  };
  for (const event of events) {
    const payload = event.payload;
    const timestamp = Number.isFinite(event.ts) && Math.abs(event.ts) <= 8.64e15 ? event.ts : 0;
    const createdAt = new Date(timestamp).toISOString();
    if ((event.type === "delta" || event.type === "thinking") && typeof payload.text === "string" && payload.text) {
      let last = result.at(-1);
      if (last?.kind !== "text" || last.source !== "delta" || event.type === "thinking" && last.content.trim()) {
        last = { kind: "text", id: `recorded:${event.id}`, content: "", source: "delta", createdAt };
        put(last);
      }
      if (event.type === "delta") last.content += payload.text;
      else { last.thinking = (last.thinking ?? "") + payload.text; last.thinkingStartedAt ??= event.ts; }
    } else if (event.type === "action" && payload.action) {
      seal();
      const action = payload.action as SakiAgentAction;
      if (action.workflowId) settledWorkflows.add(action.workflowId);
      const id = `action:${action.id}`;
      let index = positions.get(id);
      if (index === undefined) {
        index = action.workflowId ? positions.get(`pending:${action.workflowId}`) : undefined;
        if (!action.workflowId) {
          const queue = pendingByTool.get(action.tool.toLowerCase());
          while (queue && queue.cursor < queue.positions.length) {
            const candidate = queue.positions[queue.cursor++]!;
            if (result[candidate]?.kind === "pending") { index = candidate; break; }
          }
        }
      }
      if (index !== undefined) {
        const previous = result[index]!;
        positions.delete(previous.id);
        positions.set(id, index);
        result[index] = { kind: "action", id, action, createdAt: previous.createdAt };
      } else put({ kind: "action", id, action, createdAt: action.createdAt ?? createdAt });
    } else if (event.type === "workflow") {
      const message = typeof payload.message === "string" ? payload.message.trim() : "";
      if (payload.stage === "narration" && message) {
        seal();
        put({ kind: "text", id: `workflow:${payload.id}`, content: message, source: "workflow", createdAt });
      } else if (payload.stage === "tool" && payload.status === "running" && typeof payload.tool === "string" && !settledWorkflows.has(String(payload.id))) {
        seal();
        const id = `pending:${payload.id}`;
        if (!positions.has(id)) {
          const key = payload.tool.toLowerCase();
          const queue = pendingByTool.get(key) ?? { positions: [], cursor: 0 };
          queue.positions.push(result.length);
          pendingByTool.set(key, queue);
        }
        put({ kind: "pending", id, tool: payload.tool, message, createdAt,
          ...(typeof payload.call === "string" ? { call: payload.call } : {}) });
      }
    }
  }
  seal();
  for (let index = 0; index < result.length; index++) {
    const item = result[index]!;
    if (item.kind === "text" && item.thinking && item.thinkingStartedAt) {
      const end = result[index + 1] ? Date.parse(result[index + 1]!.createdAt) : events.at(-1)?.ts ?? item.thinkingStartedAt;
      item.thinkingDurationSec = Math.max(1, Math.round((end - item.thinkingStartedAt) / 1000));
    }
  }
  cache.set(events, result);
  return result;
}
