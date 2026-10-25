import { useCallback, useEffect, useRef, useState } from "react";
import type { SakiActiveTaskSummary } from "../api.js";
import { useNotificationCenter } from "../NotificationCenter.js";
import { translateDomText, usePanelLanguage } from "../i18n/index.js";
import { AgentNotificationTracker, defaultAgentNotificationPreferences, normalizeAgentNotificationPreferences, type AgentNotificationKind, type AgentNotificationPreferences } from "../utils/agent-notification-policy.js";

const preferenceEvent = "saki:agent-notification-preferences";
const preferenceKey = (userId: string) => `saki:agent-notifications:${userId}`;

function readPreferences(userId: string): AgentNotificationPreferences {
  try { return normalizeAgentNotificationPreferences(JSON.parse(localStorage.getItem(preferenceKey(userId)) ?? "null")); }
  catch { return { ...defaultAgentNotificationPreferences }; }
}

export function useAgentNotificationPreferences(userId: string) {
  const [preferences, setPreferences] = useState(() => readPreferences(userId));
  const current = useRef(preferences);
  current.current = preferences;
  useEffect(() => {
    const sync = (event?: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== preferenceKey(userId)) return;
      const detail = event instanceof CustomEvent ? event.detail as { userId?: string; preferences?: AgentNotificationPreferences } : undefined;
      if (detail && detail.userId !== userId) return;
      const next = detail?.preferences ?? readPreferences(userId);
      current.current = next;
      setPreferences(next);
    };
    sync();
    window.addEventListener(preferenceEvent, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(preferenceEvent, sync); window.removeEventListener("storage", sync); };
  }, [userId]);
  const update = useCallback((patch: Partial<AgentNotificationPreferences>) => {
    const next = normalizeAgentNotificationPreferences({ ...current.current, ...patch });
    try { localStorage.setItem(preferenceKey(userId), JSON.stringify(next)); } catch { /* In-memory preferences remain usable. */ }
    setPreferences(next);
    current.current = next;
    window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: { userId, preferences: next } }));
  }, [userId]);
  return { preferences, update };
}

export function desktopNotificationPermission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && window.isSecureContext && "Notification" in window ? window.Notification.permission : "unsupported";
}

export async function requestDesktopNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  const permission = desktopNotificationPermission();
  if (permission !== "default") return permission;
  try { return await window.Notification.requestPermission(); } catch { return desktopNotificationPermission(); }
}

let audioContext: AudioContext | undefined;
export async function playAgentNotificationSound(): Promise<void> {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
    const time = audioContext.currentTime;
    const tone = audioContext.createOscillator();
    const gain = audioContext.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(740, time);
    tone.frequency.setValueAtTime(988, time + 0.12);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.075, time + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    tone.connect(gain); gain.connect(audioContext.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start(time); tone.stop(time + 0.34);
  } catch { /* Browser audio restrictions must never interrupt the task. */ }
}

export const agentNotificationTitles: Record<AgentNotificationKind, string> = {
  approval: "Agent 需要审批", question: "Agent 等待你的回答", completed: "Agent 工作已完成"
};

function claimAlert(userId: string, key: string): boolean {
  const storageKey = `${preferenceKey(userId)}:seen`;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    const seen = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    if (seen.includes(key)) return false;
    localStorage.setItem(storageKey, JSON.stringify([...seen, key].slice(-256)));
  } catch { /* The per-mount tracker still deduplicates if storage is unavailable. */ }
  return true;
}

export function useAgentTaskNotifications(userId: string, tasks: readonly SakiActiveTaskSummary[], loaded: boolean, onOpen: () => void) {
  const { preferences } = useAgentNotificationPreferences(userId);
  const { language } = usePanelLanguage();
  const { pushNotification, dismissNotification } = useNotificationCenter();
  const tracker = useRef(new AgentNotificationTracker());
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const desktopAlerts = useRef(new Set<Notification>());
  const live = useRef(true);
  const latestPreferences = useRef(preferences);
  latestPreferences.current = preferences;
  const inPageAlerts = useRef(new Set<string>());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const alert of desktopAlerts.current) alert.close();
      desktopAlerts.current.clear();
      for (const id of inPageAlerts.current) dismissNotification(id);
      inPageAlerts.current.clear();
    };
  }, [dismissNotification]);

  useEffect(() => {
    if (!loaded) return;
    for (const { task, kind, key } of tracker.current.observe(tasks)) {
      if (!preferences.enabled || !preferences[kind]) continue;
      const deliver = () => {
        const preferences = latestPreferences.current;
        if (!live.current || !preferences.enabled || !preferences[kind] || !claimAlert(userId, key)) return;
        const title = translateDomText(agentNotificationTitles[kind], language);
        const message = task.message.trim().slice(0, 100) || "打开任务查看详情";
        const open = () => { window.focus(); openRef.current(); };
        const id = pushNotification(kind === "completed" ? "success" : "info", message, {
          title, durationMs: kind === "completed" ? 8000 : 15000,
          action: { label: translateDomText("查看任务", language), onClick: open }, metadata: { agentNotification: true, taskId: task.id }
        });
        inPageAlerts.current.add(id);
        if (inPageAlerts.current.size > 256) inPageAlerts.current.delete(inPageAlerts.current.values().next().value!);
        if (preferences.sound) void playAgentNotificationSound();
        if (preferences.desktop && desktopNotificationPermission() === "granted" && (document.hidden || !document.hasFocus())) {
          try {
            const alert = new window.Notification(title, { body: message, icon: "/assets/saki-panel-icon.webp", tag: key, silent: true });
            desktopAlerts.current.add(alert);
            alert.onclick = () => { open(); alert.close(); };
            alert.onclose = () => desktopAlerts.current.delete(alert);
          } catch { /* Mobile/unsupported browsers retain the in-page reminder. */ }
        }
      };
      // Coordinate simultaneous tabs before claiming the same task event.
      if (navigator.locks) void navigator.locks.request(`saki-agent-alerts:${userId}`, deliver).catch(() => deliver());
      else deliver();
    }
  }, [tasks, loaded, preferences, pushNotification, userId, language]);
}
