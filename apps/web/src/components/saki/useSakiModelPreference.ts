import { useCallback, useSyncExternalStore } from "react";
import { parseSakiModelSelection } from "@webops/shared";
import { api } from "../../api.js";

const eventName = "saki:model-preference-changed";
const memory = new Map<string, string>();
const saves = new Map<string, Promise<unknown>>();
const keyFor = (userId: string) => `saki.last-model.${userId}`;

export function cachedSakiModelPreference(userId: string): string {
  if (memory.has(userId)) return memory.get(userId)!;
  try { return localStorage.getItem(keyFor(userId)) ?? ""; } catch { return ""; }
}
export function cacheSakiModelPreference(userId: string, value: string): void {
  try { localStorage.setItem(keyFor(userId), value); memory.delete(userId); }
  catch { memory.set(userId, value); }
  window.dispatchEvent(new Event(eventName));
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(eventName, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(eventName, listener); };
}
export function useSakiModelPreference(userId: string) {
  const get = useCallback(() => cachedSakiModelPreference(userId), [userId]);
  const selection = useSyncExternalStore(subscribe, get, () => "");
  const set = useCallback((value: string) => cacheSakiModelPreference(userId, value), [userId]);
  return [selection, set] as const;
}

export function persistSakiModelPreference(token: string, userId: string, selection: string): Promise<unknown> {
  const operation = (saves.get(userId) ?? Promise.resolve()).catch(() => undefined)
    .then(() => api.saveSakiModelPreference(token, parseSakiModelSelection(selection)));
  saves.set(userId, operation);
  const cleanup = () => { if (saves.get(userId) === operation) saves.delete(userId); };
  void operation.then(cleanup, cleanup);
  return operation;
}
export async function waitForSakiModelPreference(userId: string): Promise<void> {
  await saves.get(userId)?.catch(() => undefined);
}
