/** Stable message-ID cursors survive appends while a task is running. */
export function pageConversationMessages<T extends { id?: unknown; role?: unknown }>(messages: T[], limit: number, beforeId?: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid page size.");
  const end = beforeId ? messages.findIndex(message => message.id === beforeId) : messages.length;
  if (end < 0) throw new Error("History cursor no longer exists. Reload the conversation.");
  let start = Math.max(0, end - limit);
  // Keep a turn's question with its answers so edit/rollback has its anchor.
  while (start > 0 && messages[start]?.role === "assistant") start--;
  return {
    messages: messages.slice(start, end),
    historyBeforeId: start > 0 ? String(messages[start]!.id) : null,
    messagesLoaded: true as const
  };
}

/** A client editing a loaded suffix must never replace the unseen prefix. */
export function mergeConversationMessages<T extends { id?: unknown }>(previous: T[], incoming: T[], beforeId?: string | null): T[] {
  if (!beforeId) return incoming;
  const index = previous.findIndex(message => message.id === beforeId);
  if (index < 0) throw new Error("History cursor no longer exists. Reload the conversation before saving.");
  const ids = new Set(incoming.map(message => message.id));
  return [...previous.slice(0, index).filter(message => !ids.has(message.id)), ...incoming];
}
