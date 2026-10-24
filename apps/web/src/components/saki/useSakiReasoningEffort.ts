import { useCallback, useSyncExternalStore } from "react";
import { normalizeSakiReasoningEffort, parseSakiModelSelection, type SakiReasoningEffort } from "@webops/shared";

const eventName = "saki:reasoning-effort-changed";
const fallback = new Map<string, SakiReasoningEffort>();
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(eventName, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(eventName, listener); };
}

export function useSakiReasoningEffort(modelKey: string) {
  const { model, provider } = parseSakiModelSelection(modelKey);
  const key = `saki.reasoning-effort.${provider}:${model}`;
  const getSnapshot = useCallback((): SakiReasoningEffort => {
    // Quota-exceeded storage is still readable. A failed write must take
    // precedence over the stale persisted value or the controlled slider snaps back.
    const sessionValue = fallback.get(key);
    if (sessionValue !== undefined) return sessionValue;
    try { return normalizeSakiReasoningEffort(localStorage.getItem(key), model, provider); }
    catch { return fallback.get(key) ?? "auto"; }
  }, [key, model, provider]);
  const effort = useSyncExternalStore(subscribe, getSnapshot, () => "auto" as const);
  const setEffort = useCallback((value: SakiReasoningEffort) => {
    const normalized = normalizeSakiReasoningEffort(value, model, provider);
    try { localStorage.setItem(key, normalized); fallback.delete(key); } catch { fallback.set(key, normalized); }
    window.dispatchEvent(new Event(eventName));
  }, [key, model, provider]);
  return [effort, setEffort] as const;
}
