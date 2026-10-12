import type { LocalSakiTimelineItem } from "../../../types/app.js";

export type PresentedSakiTimelineItem = LocalSakiTimelineItem | { kind: "tool-group"; id: string; items: Extract<LocalSakiTimelineItem, { kind: "action" }>[] };
const routineTools = new Set(["readfile", "listfiles", "findfiles", "searchfiles", "outlinefile", "findsymbols", "readsymbol", "statfile", "runcommand", "runinshell", "diagnosecode"]);

export function compactSakiTimeline(items: LocalSakiTimelineItem[]): PresentedSakiTimelineItem[] {
  const result: PresentedSakiTimelineItem[] = [];
  let group: Extract<LocalSakiTimelineItem, { kind: "action" }>[] = [];
  const flush = () => {
    if (group.length > 1) result.push({ kind: "tool-group", id: `group:${group[0]!.id}`, items: group });
    else result.push(...group);
    group = [];
  };
  for (const item of items) {
    if (item.kind === "action" && item.action.ok && (!item.action.status || item.action.status === "completed") && !item.action.approval?.rollbackAvailable && routineTools.has(item.action.tool.toLowerCase())) group.push(item);
    else { flush(); result.push(item); }
  }
  flush();
  return result;
}
