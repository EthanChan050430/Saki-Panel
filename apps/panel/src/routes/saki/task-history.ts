import type { SakiAgentAction, SakiChatResponse, SakiTimelineEvent } from "@webops/shared";
import type { SakiActiveTaskEvent } from "./types.js";

export function sakiTaskHistorySnapshot(events: SakiActiveTaskEvent[]): SakiChatResponse {
  const timelineEvents: SakiTimelineEvent[] = [];
  const actions = new Map<string, SakiAgentAction>();
  const text: string[] = [];
  const thinking: string[] = [];
  for (const [index, event] of events.entries()) {
    if (event.type === "done" || event.type === "error") continue;
    timelineEvents.push({ id: event.id ?? `replay:${index}:${event.ts}`, type: event.type, payload: event.payload, ts: event.ts });
    if (event.type === "delta" && typeof event.payload.text === "string") text.push(event.payload.text);
    if (event.type === "thinking" && typeof event.payload.text === "string") thinking.push(event.payload.text);
    if (event.type === "action" && event.payload.action) {
      const action = event.payload.action as SakiAgentAction;
      actions.set(action.id, action);
    }
  }
  return { source: "direct-model", message: text.join(""), thinking: thinking.join(""), actions: [...actions.values()], timelineEvents };
}
