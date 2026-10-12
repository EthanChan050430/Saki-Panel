import { RouteError } from "./types.js";

const decidingActions = new Set<string>();

// Approve, reject and answer share a lock: ownership checks and all asynchronous
// preparation/execution happen inside it, so a double click cannot run twice.
export async function withPendingSakiActionDecision<T>(id: string, decide: () => Promise<T>): Promise<T> {
  if (decidingActions.has(id)) throw new RouteError("This action is already being handled.", 409);
  decidingActions.add(id);
  try { return await decide(); }
  finally { decidingActions.delete(id); }
}
