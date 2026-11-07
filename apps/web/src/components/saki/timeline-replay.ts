import type { SakiAgentAction, SakiTimelineEvent } from "@webops/shared";
import type { LocalSakiTimelineItem } from "../../types/app.js";

type NarrationRepair = { offset: number; text: string };
type NarrationRepairs = { skippedLength: number; entries: NarrationRepair[] };
const cache = new WeakMap<SakiTimelineEvent[], { items: LocalSakiTimelineItem[]; repairs: Map<string, NarrationRepairs> }>();

function couldBeLegacyNarration(events: SakiTimelineEvent[], index: number): boolean {
  const event = events[index]!;
  const previous = events[index - 1];
  const text = event.payload.text;
  return event.type === "delta" && typeof text === "string" && text.length <= 502 && text.endsWith("\n\n")
    && previous?.type === "workflow" && previous.payload.stage === "thinking"
    && previous.payload.status === "completed" && events[index - 2]?.type === "delta";
}

/** Replay in one pass; never scan/copy the complete timeline for every event. */
export function replaySakiTimeline(events: SakiTimelineEvent[] | undefined): LocalSakiTimelineItem[] {
  if (!events) return [];
  const cached = cache.get(events);
  if (cached) return cached.items;
  const result: LocalSakiTimelineItem[] = [];
  const positions = new Map<string, number>();
  const settledWorkflows = new Set<string>();
  const pendingByTool = new Map<string, { positions: number[]; cursor: number }>();
  const repairs = new Map<string, NarrationRepairs>();
  const seal = () => {
    const last = result.at(-1);
    if (last?.kind === "text" && last.source === "delta") last.source = "final";
  };
  const put = (item: LocalSakiTimelineItem) => {
    const index = positions.get(item.id);
    if (index === undefined) { positions.set(item.id, result.length); result.push(item); }
    else result[index] = item;
  };
  for (const [index, event] of events.entries()) {
    const payload = event.payload;
    const timestamp = Number.isFinite(event.ts) && Math.abs(event.ts) <= 8.64e15 ? event.ts : 0;
    const createdAt = new Date(timestamp).toISOString();
    if ((event.type === "delta" || event.type === "thinking") && typeof payload.text === "string" && payload.text) {
      const lastText = result.at(-1);
      // Legacy Agent runs streamed a draft, then immediately republished
      // its first 500 characters as narration after the model turn ended.
      if (lastText?.kind === "text" && couldBeLegacyNarration(events, index)) {
        const chunks: string[] = [];
        for (let cursor = index - 2; cursor >= 0; cursor--) {
          const item = events[cursor]!;
          if (item.type !== "delta" || typeof item.payload.text !== "string") break;
          chunks.push(item.payload.text);
        }
        const draft = chunks.reverse().join("").trim();
        if (draft && payload.text === `${draft.slice(0, 500)}\n\n`) {
          const repair = repairs.get(lastText.id) ?? { skippedLength: 0, entries: [] };
          repair.entries.push({ offset: lastText.content.length + repair.skippedLength, text: payload.text });
          repair.skippedLength += payload.text.length;
          repairs.set(lastText.id, repair);
          continue;
        }
      }
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
  cache.set(events, { items: result, repairs });
  return result;
}

/** Older clients also saved a rendered copy alongside the source events. */
export function repairCachedSakiNarration(timeline: LocalSakiTimelineItem[], events: SakiTimelineEvent[] | undefined): LocalSakiTimelineItem[] {
  if (!events?.length) return timeline;
  if (!cache.has(events) && !events.some((_, index) => couldBeLegacyNarration(events, index))) return timeline;
  const recorded = replaySakiTimeline(events);
  const repairs = cache.get(events)?.repairs;
  if (!repairs?.size) return timeline;
  const corrected = new Map(recorded.flatMap(item => item.kind === "text" && repairs.has(item.id) ? [[item.id, item.content] as const] : []));
  return timeline.map(item => {
    const changes = repairs.get(item.id);
    if (item.kind !== "text" || !changes) return item;
    const chunks: string[] = [];
    let start = 0;
    for (const { offset, text } of changes.entries) {
      if (!item.content.startsWith(text, offset)) return item;
      chunks.push(item.content.slice(start, offset));
      start = offset + text.length;
    }
    chunks.push(item.content.slice(start));
    const content = chunks.join("");
    return content === corrected.get(item.id) ? { ...item, content } : item;
  });
}
