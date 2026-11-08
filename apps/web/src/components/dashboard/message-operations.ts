import type { SakiAgentAction } from "@webops/shared";
import type { DashboardChatMessage } from "./DashboardAgentConversation.js";

export type DashboardMessageOperation = "copy" | "delete" | "undo" | "undo_conversation" | "undo_available_files" | "rollback_files" | "rollback_saved_files" | { edit: string; keepFiles?: boolean };

export function dashboardIsCodeChange(action: SakiAgentAction): boolean {
  const tool = action.tool.toLowerCase().replace(/[_-]/g, "");
  if (tool === "generateimage") {
    const p = action.args?.path;
    return (typeof p === "string" && Boolean(p.trim())) || Boolean(action.approval?.rollbackAvailable);
  }
  return /^(writefile|replaceinfile|editlines|batchedit|multifileedit|batchpatch|applypatch|applypatches|applydiff|patchfiles|patch|uploadbase64|deletepath|renamepath|mkdir|archivepaths|extractarchive)$/.test(tool)
    || (/^(runcommand|runinshell|sendshellinput)$/.test(tool) && Boolean(action.approval?.rollbackAvailable));
}

export function dashboardStoredActions(message: { actions?: SakiAgentAction[] | undefined; timeline?: { kind: string; action?: SakiAgentAction }[] | undefined }): SakiAgentAction[] {
  return [...new Map([...(message.timeline ?? []).flatMap((item) => item.kind === "action" && item.action ? [item.action] : []),
    ...(message.actions ?? [])].map((action) => [action.id, action])).values()];
}

function dashboardIsUntrackedTerminalAction(action: SakiAgentAction): boolean {
  return /^(runcommand|runinshell|sendshellinput|sendinput|sendcommand)$/.test(action.tool.toLowerCase().replace(/[_-]/g, ""))
    && (action.ok || action.status === "failed" || Boolean(action.terminal)) && action.status !== "rolled_back" && action.status !== "rejected"
    && !action.approval?.rollbackAvailable && action.approval?.reason !== "Terminal command made no workspace file changes.";
}

export function dashboardHasUntrackedTerminalChanges(messages: DashboardChatMessage[]): boolean {
  return dashboardLatestUntrackedTerminalIndex(messages) >= 0;
}

/** A turn starting at or before this message cannot roll back the whole suffix. */
export function dashboardLatestUntrackedTerminalIndex(messages: DashboardChatMessage[]): number {
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index--) {
    for (const action of dashboardStoredActions(messages[index]!)) {
      if (seen.has(action.id)) continue;
      seen.add(action.id);
      if (dashboardIsUntrackedTerminalAction(action)) return index;
    }
  }
  return -1;
}

/** Deleting either message in a turn removes its question and replies. */
export function dashboardTurnRange(messages: DashboardChatMessage[], messageId: string) {
  let start = messages.findIndex((message) => message.id === messageId);
  if (start < 0) return null;
  while (start > 0 && messages[start]?.role !== "user") start--;
  let end = start + 1;
  while (end < messages.length && messages[end]?.role !== "user") end++;
  return { start, end };
}

/** Latest action state wins; restore changes in reverse execution order. */
export function dashboardRollbackActions(messages: DashboardChatMessage[]): SakiAgentAction[] {
  return [...new Map(messages.flatMap(dashboardStoredActions).map((action) => [action.id, action])).values()]
    .filter(dashboardActionCanRollback)
    .reverse();
}

function dashboardActionCanRollback(action: SakiAgentAction): boolean {
  return Boolean((action.approval?.rollbackAvailable || (action.approval?.rollbackAvailable !== false && action.ok
    && dashboardIsCodeChange(action) && !/no (?:write|change) was needed/.test(action.observation))) && action.status !== "rolled_back"
    && action.status !== "rejected" && action.status !== "pending_approval" && action.status !== "pending_input");
}

export function dashboardRollbackCodeMessageIds(messages: DashboardChatMessage[]): Set<string> {
  const seen = new Set<string>();
  const suffix: boolean[] = new Array(messages.length);
  let hasCodeChange = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    for (const action of dashboardStoredActions(messages[index]!).reverse()) {
      if (seen.has(action.id)) continue;
      seen.add(action.id);
      if (dashboardActionCanRollback(action) && dashboardIsCodeChange(action)) hasCodeChange = true;
    }
    suffix[index] = hasCodeChange;
  }
  const result = new Set<string>();
  let turnStart = 0;
  messages.forEach((message, index) => {
    if (message.role === "user") turnStart = index;
    if (!message.rollbackJournal && suffix[turnStart]) result.add(message.id);
  });
  return result;
}

function rollbackReference(action: SakiAgentAction): SakiAgentAction {
  return { id: action.id, tool: action.tool, args: {}, observation: "", ok: action.ok, createdAt: action.createdAt,
    ...(action.status ? { status: action.status } : {}),
    approval: { required: false, reason: "Deleted turn rollback reference", risk: "low", rollbackAvailable: action.status !== "rolled_back"
      && (Boolean(action.approval?.rollbackAvailable) || !/^(runcommand|runinshell|sendshellinput|sendinput|sendcommand)$/.test(action.tool.toLowerCase().replace(/[_-]/g, ""))) } };
}

export function dashboardRecordAction(messages: DashboardChatMessage[], action: SakiAgentAction): DashboardChatMessage[] {
  return messages.map((message) => {
    const actions = dashboardStoredActions(message);
    return actions.some((item) => item.id === action.id)
      ? { ...message, actions: [...new Map([...actions, message.rollbackJournal ? rollbackReference(action) : action].map((item) => [item.id, item])).values()] } : message;
  });
}

/** Keep only rollback references at their original chronological position. */
export function dashboardDeleteTurn(messages: DashboardChatMessage[], range: { start: number; end: number }): DashboardChatMessage[] {
  const removed = messages.slice(range.start, range.end);
  const latest = new Map(removed.flatMap(dashboardStoredActions).map(action => [action.id, action]));
  const actions = [...latest.values()].filter(action => dashboardActionCanRollback(action) || dashboardIsUntrackedTerminalAction(action)).map(rollbackReference);
  const journal: DashboardChatMessage[] = actions.length ? [{
    id: `undo-${removed[0]!.id}`, role: "assistant", content: "", time: "", rollbackJournal: true, actions,
    createdAt: removed[0]?.createdAt
  }] : [];
  return [...messages.slice(0, range.start), ...journal, ...messages.slice(range.end)];
}

type ComparableMessage = { id: string; role: string; content: string; rollbackJournal?: boolean | undefined };
export function dashboardHistoryMatches(left: ComparableMessage[], right: ComparableMessage[]) {
  return left.length === right.length && left.every((message, index) => {
    const other = right[index];
    return other?.id === message.id && other.role === message.role && other.content === message.content && Boolean(other.rollbackJournal) === Boolean(message.rollbackJournal);
  });
}
