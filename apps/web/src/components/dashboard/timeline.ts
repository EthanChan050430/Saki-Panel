import type { SakiChatStreamEvent } from "../../api.js";
import type { LocalSakiTimelineItem } from "../../types/app.js";
import {
  appendSakiTimelineDelta, appendSakiTimelineThinking, mergeSakiFinalTimeline,
  mergeSakiTimelineActions, sealSakiTimelineDelta,
  settleSakiTimelinePending, mergeSakiResponseTimeline,
  upsertSakiTimelinePending, upsertSakiTimelineText, workflowEventChatText
} from "../saki/SakiComponents.js";

/** Keep text and tools in arrival order, including narration between calls. */
export function dashboardStreamTimeline(timeline: LocalSakiTimelineItem[] | undefined, event: SakiChatStreamEvent): LocalSakiTimelineItem[] {
  const current = timeline ?? [];
  if (event.type === "snapshot") return mergeSakiResponseTimeline([], { ...event.response, message: "" });
  if (event.type === "meta") return []; // Reconnect replays the task from the start.
  if (event.type === "delta") return appendSakiTimelineDelta(current, event.text);
  if (event.type === "thinking") return appendSakiTimelineThinking(current, event.text);
  if (event.type === "action") {
    return settleSakiTimelinePending(sealSakiTimelineDelta(current), event.action);
  }
  if (event.type === "workflow") {
    const text = workflowEventChatText(event);
    if (text) return upsertSakiTimelineText(sealSakiTimelineDelta(current), { id: `workflow:${event.id}`, content: text, source: "workflow" });
    if (event.tool && event.stage === "tool" && event.status === "running") {
      return upsertSakiTimelinePending(current, { id: event.id, tool: event.tool, ...(event.call ? { call: event.call } : {}), message: event.message });
    }
  }
  if (event.type === "done") {
    if (event.response.timelineEvents?.length) return mergeSakiResponseTimeline(current, event.response);
    const sealed = mergeSakiTimelineActions(sealSakiTimelineDelta(current).filter((item) => item.kind !== "pending"), event.response.actions);
    return dashboardFinalTimeline(sealed, event.response.message);
  }
  if (event.type === "error") {
    return upsertSakiTimelineText(sealSakiTimelineDelta(current).filter((item) => item.kind !== "pending"), {
      id: `error:${current.length}`, content: event.message, source: "error"
    });
  }
  return current;
}

export function dashboardFinalTimeline(timeline: LocalSakiTimelineItem[] | undefined, content: string): LocalSakiTimelineItem[] {
  const current = timeline ?? [];
  const texts = current.flatMap((item) => item.kind === "text" && item.content.trim() ? [item.content] : []);
  // Some providers return the whole streamed answer, others only the last turn.
  if ([texts.join(""), texts.map((text) => text.trim()).join("\n\n")].some((text) => text.trim() === content.trim())) return current;
  return mergeSakiFinalTimeline(current, content);
}

/** Replay the current run after its previous runs, updating shared action IDs in place. */
export function dashboardMergeTimeline(base: LocalSakiTimelineItem[] | undefined, incoming: LocalSakiTimelineItem[]): LocalSakiTimelineItem[] {
  const baseActions = (base ?? []).flatMap(item => item.kind === "action" ? [item.action.id] : []);
  const incomingActions = new Set(incoming.flatMap(item => item.kind === "action" ? [item.action.id] : []));
  if (incoming.some(item => item.id.startsWith("recorded:")) && baseActions.length && baseActions.every(id => incomingActions.has(id))) return incoming;
  const result = [...(base ?? [])];
  const ids = new Map(result.map((item, index) => [item.id, index]));
  const actions = new Map(result.flatMap((item, index) => item.kind === "action" ? [[item.action.id, index] as const] : []));
  for (const item of incoming) {
    const index = ids.get(item.id) ?? (item.kind === "action" ? actions.get(item.action.id) : undefined);
    const position = index ?? result.length;
    if (index === undefined) result.push(item);
    else result[index] = item;
    ids.set(item.id, position);
    if (item.kind === "action") actions.set(item.action.id, position);
  }
  return result;
}
