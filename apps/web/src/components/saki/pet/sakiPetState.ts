import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  clampSakiLauncherPosition,
  snapSakiLauncherPositionToEdge,
  writeSakiLauncherPosition,
  type SakiLauncherPosition
} from "../SakiComponents.js";
import { newClientId } from "../../../utils/id.js";
import { useSakiPetMusic } from "./sakiPetMusic.js";
import { panelT } from "../../../i18n/translations.js";

export function isSakiPetTouchUi(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none)").matches || window.matchMedia("(pointer: coarse)").matches;
}

export type SakiPetSkinId = "saki";
export type SakiPetBehavior =
  | "idle"
  | "idle_sway"
  | "idle_twirl"
  | "idle_look"
  | "idle_ribbon"
  | "idle_stretch"
  | "idle_shy"
  | "hover_wave"
  | "walk"
  | "sit"
  | "lie"
  | "sleep"
  | "roll"
  | "look"
  | "climb"
  | "hang"
  | "fall"
  | "chase"
  | "happy"
  | "happy_cheer"
  | "eat"
  | "doctor"
  | "toilet"
  | "pickup"
  | "bath"
  | "poke"
  | "yawn"
  | "shy"
  | "pout"
  | "drink"
  | "blink"
  | "play_phone"
  | "read_book"
  | "hungry"
  | "dizzy"
  | "edge_idle"
  | "edge_wave"
  | "edge_peek"
  | "edge_sleepy"
  | "edge_look"
  | "edge_snack"
  | "edge_poke"
  | "edge_climb"
  | "edge_feed"
  | "edge_bath"
  | "edge_pet"
  | "edge_sleep"
  | "edge_doctor"
  | "edge_toilet";

export const SAKI_STANDING_IDLE_BEHAVIORS: readonly SakiPetBehavior[] = [
  "idle",
  "idle_sway",
  "idle_twirl",
  "idle_look",
  "idle_ribbon",
  "idle_stretch",
  "idle_shy"
];

export const SAKI_EDGE_BEHAVIORS: readonly SakiPetBehavior[] = [
  "edge_idle",
  "edge_wave",
  "edge_peek",
  "edge_sleepy",
  "edge_look",
  "edge_snack",
  "edge_climb"
];

export function isSakiEdgeBehavior(behavior: SakiPetBehavior): boolean {
  return behavior.startsWith("edge_");
}

function pickWeightedBehavior(
  candidates: readonly { behavior: SakiPetBehavior; weight: number; minMs: number; maxMs: number }[],
  avoid?: SakiPetBehavior
): { behavior: SakiPetBehavior; durationMs: number } {
  const pool = candidates.filter((item) => item.behavior !== avoid);
  const active = pool.length > 0 ? pool : candidates;
  const total = active.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of active) {
    roll -= item.weight;
    if (roll <= 0) {
      return {
        behavior: item.behavior,
        durationMs: Math.round(item.minMs + Math.random() * (item.maxMs - item.minMs))
      };
    }
  }
  const fallback = active[0]!;
  return { behavior: fallback.behavior, durationMs: fallback.minMs };
}

function pickAutonomousEdgeBehavior(
  current: SakiPetBehavior,
  hunger: number
): { behavior: SakiPetBehavior; durationMs: number } {
  const hour = new Date().getHours();
  const isLate = hour >= 22 || hour < 6;
  return pickWeightedBehavior(
    [
      { behavior: "edge_idle", weight: 22, minMs: 5000, maxMs: 9000 },
      { behavior: "edge_wave", weight: 14, minMs: 4200, maxMs: 6500 },
      { behavior: "edge_peek", weight: 18, minMs: 4800, maxMs: 7500 },
      { behavior: "edge_look", weight: 15, minMs: 4500, maxMs: 7000 },
      { behavior: "edge_snack", weight: hunger < 45 ? 24 : 14, minMs: 5200, maxMs: 8000 },
      { behavior: "edge_sleepy", weight: isLate ? 28 : 12, minMs: 6500, maxMs: 11000 },
      { behavior: "edge_climb", weight: 11, minMs: 3600, maxMs: 5400 }
    ],
    current
  );
}

function pickAutonomousStandingBehavior(
  current: SakiPetBehavior,
  stats: SakiPetStats,
  pomodoro: SakiPetPomodoro
): { behavior: SakiPetBehavior; durationMs: number } {
  const hour = new Date().getHours();
  const isLate = hour >= 23 || hour < 6;
  if (stats.health < 28 && Math.random() < 0.45) {
    return { behavior: "dizzy", durationMs: 5200 };
  }
  if (stats.hunger < 22 && Math.random() < 0.5) {
    return { behavior: Math.random() < 0.6 ? "hungry" : "sit", durationMs: 6400 };
  }
  if (pomodoro.running && pomodoro.mode === "focus") {
    return pickWeightedBehavior(
      [
        { behavior: "read_book", weight: 38, minMs: 8000, maxMs: 14000 },
        { behavior: "sit", weight: 24, minMs: 9000, maxMs: 14000 },
        { behavior: "idle_twirl", weight: 14, minMs: 6000, maxMs: 9000 },
        { behavior: "idle_ribbon", weight: 12, minMs: 6000, maxMs: 9000 },
        { behavior: "drink", weight: 12, minMs: 5500, maxMs: 8000 }
      ],
      current
    );
  }
  return pickWeightedBehavior(
    [
      { behavior: "idle", weight: 14, minMs: 7000, maxMs: 12000 },
      { behavior: "idle_sway", weight: 14, minMs: 5500, maxMs: 9000 },
      { behavior: "idle_twirl", weight: 13, minMs: 5500, maxMs: 9000 },
      { behavior: "idle_look", weight: 10, minMs: 5000, maxMs: 8000 },
      { behavior: "idle_ribbon", weight: 11, minMs: 5000, maxMs: 8000 },
      { behavior: "idle_stretch", weight: isLate ? 16 : 10, minMs: 4800, maxMs: 7200 },
      { behavior: "idle_shy", weight: 10, minMs: 5200, maxMs: 8000 },
      { behavior: "drink", weight: 11, minMs: 5500, maxMs: 8500 },
      { behavior: "play_phone", weight: 12, minMs: 6500, maxMs: 11000 },
      { behavior: "read_book", weight: 11, minMs: 6500, maxMs: 11000 },
      { behavior: "happy_cheer", weight: stats.mood >= 70 ? 12 : 6, minMs: 4200, maxMs: 6200 },
      { behavior: "walk", weight: 11, minMs: 3600, maxMs: 6200 },
      { behavior: "sit", weight: 15, minMs: 8000, maxMs: 13000 },
      { behavior: "lie", weight: 10, minMs: 8000, maxMs: 13000 },
      { behavior: "sleep", weight: isLate ? 26 : 8, minMs: 11000, maxMs: 17000 }
    ],
    current
  );
}
export type SakiPetGroup = "none" | "companion" | "tools";
export type SakiPetWidget =
  | null
  | "feed"
  | "todo"
  | "schedule"
  | "pomodoro"
  | "notes"
  | "sticker"
  | "calendar"
  | "skins"
  | "music";
export type SakiPetFx = "none" | "hearts" | "zzz" | "soap" | "sparkle";
export type SakiPetFacing = "left" | "right";

export interface SakiPetStats {
  hunger: number;
  mood: number;
  health: number;
  lastTick: number;
}

export interface SakiPetTodo {
  id: string;
  text: string;
  done: boolean;
}

export interface SakiPetEvent {
  id: string;
  title: string;
  at: string;
}

export interface SakiPetNote {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
}

export interface SakiPetSticker {
  id: string;
  src: string;
  x: number;
  y: number;
  scale: number;
}

export interface SakiPetPomodoro {
  running: boolean;
  mode: "focus" | "break";
  remainingMs: number;
  startedAt: number | null;
}

export interface SakiPetWeather {
  temp: number;
  code: number;
}

const STORAGE_KEY = "webops.saki.desktopPet.v1";
export const DEFAULT_SAKI_PET_SCALE = 1;
export const MIN_SAKI_PET_SCALE = 0.7;
export const MAX_SAKI_PET_SCALE = 1.6;
const MIN_SCALE = MIN_SAKI_PET_SCALE;
const MAX_SCALE = MAX_SAKI_PET_SCALE;

export function readSakiPetScale(): number {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SAKI_PET_SCALE;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.scale === "number" && Number.isFinite(parsed.scale)) {
      return Math.min(MAX_SAKI_PET_SCALE, Math.max(MIN_SAKI_PET_SCALE, parsed.scale));
    }
  } catch {}
  return DEFAULT_SAKI_PET_SCALE;
}

export function writeSakiPetScale(scale: number): number {
  const clamped = Number.isFinite(scale)
    ? Math.min(MAX_SAKI_PET_SCALE, Math.max(MIN_SAKI_PET_SCALE, Math.round(scale * 100) / 100))
    : DEFAULT_SAKI_PET_SCALE;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    let parsed: Record<string, unknown> = {};
    try {
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === "object" && !Array.isArray(saved)) parsed = saved;
    } catch {}
    parsed.scale = clamped;
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
  window.dispatchEvent(new CustomEvent("saki:set_pet_scale", { detail: clamped }));
  return clamped;
}

export function clampPetStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function defaultStats(): SakiPetStats {
  return { hunger: 72, mood: 80, health: 88, lastTick: Date.now() };
}

function defaultPomodoro(): SakiPetPomodoro {
  return { running: false, mode: "focus", remainingMs: 25 * 60 * 1000, startedAt: null };
}

interface PersistShape {
  stats?: SakiPetStats;
  skin?: SakiPetSkinId;
  scale?: number;
  chaseMouse?: boolean;
  todos?: SakiPetTodo[];
  events?: SakiPetEvent[];
  notes?: SakiPetNote[];
  stickers?: SakiPetSticker[];
  pomodoro?: SakiPetPomodoro;
}

function readPersist(): PersistShape {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePersist(partial: PersistShape) {
  try {
    const next = { ...readPersist(), ...partial };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
}

export function weatherLabel(code: number, language?: string): string {
  const lang = language || "zh-CN";
  if (code === 0) return panelT(lang, "weather.clear");
  if (code <= 3) return panelT(lang, "weather.cloudy");
  if (code <= 48) return panelT(lang, "weather.fog");
  if (code <= 67) return panelT(lang, "weather.rain");
  if (code <= 77) return panelT(lang, "weather.snow");
  if (code <= 82) return panelT(lang, "weather.showers");
  return panelT(lang, "weather.storm");
}

export function weatherGlyph(code: number): string {
  if (code === 0) return "☀";
  if (code <= 3) return "☁";
  if (code <= 48) return "🌫";
  if (code <= 67) return "🌧";
  if (code <= 77) return "❄";
  if (code <= 82) return "🌦";
  return "⛈";
}

function decayStats(stats: SakiPetStats): SakiPetStats {
  const now = Date.now();
  const minutes = Math.min(180, (now - (stats.lastTick || now)) / 60000);
  if (minutes < 0.2) return { ...stats, lastTick: now };
  const hunger = clampPetStat(stats.hunger - minutes * 0.35);
  const mood = clampPetStat(stats.mood - minutes * 0.18 - (hunger < 25 ? minutes * 0.12 : 0));
  const health = clampPetStat(stats.health - (hunger < 20 ? minutes * 0.2 : minutes * 0.04) - (mood < 20 ? minutes * 0.08 : 0));
  return { hunger, mood, health, lastTick: now };
}

export function useSakiPet({
  enabled,
  dragging,
  chatOpen,
  edgeAttached,
  position,
  setPosition,
  intimacyLevel: _intimacyLevel,
  stageRef
}: {
  enabled: boolean;
  dragging: boolean;
  chatOpen: boolean;
  edgeAttached: boolean;
  position: SakiLauncherPosition | null;
  setPosition: (next: SakiLauncherPosition | ((current: SakiLauncherPosition | null) => SakiLauncherPosition | null)) => void;
  intimacyLevel: number;
  stageRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const saved = useRef(readPersist()).current;
  const [stats, setStats] = useState<SakiPetStats>(() => decayStats(saved.stats ?? defaultStats()));
  const [skin, setSkinState] = useState<SakiPetSkinId>("saki");
  const [scale, setScaleState] = useState(readSakiPetScale);
  const [chaseMouse, setChaseMouseState] = useState(false);
  const [todos, setTodos] = useState<SakiPetTodo[]>(() => saved.todos ?? []);
  const [events, setEvents] = useState<SakiPetEvent[]>(() => saved.events ?? []);
  const [notes, setNotes] = useState<SakiPetNote[]>(() => saved.notes ?? []);
  const [stickers, setStickers] = useState<SakiPetSticker[]>(() => saved.stickers ?? []);
  const [pomodoro, setPomodoro] = useState<SakiPetPomodoro>(() => saved.pomodoro ?? defaultPomodoro());
  const [behavior, setBehavior] = useState<SakiPetBehavior>("idle");
  const [facing, setFacing] = useState<SakiPetFacing>("right");
  const [lookDeg, setLookDeg] = useState(0);
  const [fx, setFx] = useState<SakiPetFx>("none");
  const [hovered, setHovered] = useState(false);
  const [group, setGroup] = useState<SakiPetGroup>("none");
  const [widget, setWidget] = useState<SakiPetWidget>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [weather, setWeather] = useState<SakiPetWeather | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const music = useSakiPetMusic();

  const mouseRef = useRef({ x: 0, y: 0 });
  const behaviorUntilRef = useRef(Date.now() + 8000);
  const walkTargetRef = useRef<SakiLauncherPosition | null>(null);
  const velocityRef = useRef(0);
  const bubbleTimerRef = useRef<number | null>(null);
  const fxTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const lastPersistRef = useRef(0);
  const persistTimerRef = useRef<number | null>(null);
  const pendingPersistRef = useRef<PersistShape>({});

  const paused = !enabled || dragging || chatOpen || hovered || widget !== null || music.playing;

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const pending = pendingPersistRef.current;
    pendingPersistRef.current = {};
    if (Object.keys(pending).length > 0) writePersist(pending);
  }, []);

  // Trailing-debounced so high-frequency callers (e.g. drags) do not hit
  // localStorage on every pointermove; the trailing call persists the final state.
  const persist = useCallback((partial: PersistShape) => {
    pendingPersistRef.current = { ...pendingPersistRef.current, ...partial };
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(flushPersist, 250);
  }, [flushPersist]);

  useEffect(() => () => flushPersist(), [flushPersist]);

  const showBubble = useCallback((text: string, ms = 2800) => {
    setBubble(text);
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubble(null);
      bubbleTimerRef.current = null;
    }, ms);
  }, []);

  const playFx = useCallback((next: SakiPetFx, ms = 2200) => {
    setFx(next);
    if (fxTimerRef.current) window.clearTimeout(fxTimerRef.current);
    fxTimerRef.current = window.setTimeout(() => {
      setFx("none");
      fxTimerRef.current = null;
    }, ms);
  }, []);

  const patchStats = useCallback((patch: Partial<SakiPetStats>) => {
    setStats((prev) => {
      const next = {
        hunger: clampPetStat(patch.hunger ?? prev.hunger),
        mood: clampPetStat(patch.mood ?? prev.mood),
        health: clampPetStat(patch.health ?? prev.health),
        lastTick: Date.now()
      };
      persist({ stats: next });
      return next;
    });
  }, [persist]);

  const setSkin = useCallback((id: SakiPetSkinId) => {
    setSkinState(id);
    persist({ skin: id });
  }, [persist]);

  const setScale = useCallback((value: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
    setScaleState(next);
    persist({ scale: next });
  }, [persist]);

  useEffect(() => {
    const handlePetScaleEvent = (e: Event) => {
      const custom = e as CustomEvent<number>;
      if (typeof custom.detail === "number" && Number.isFinite(custom.detail)) {
        setScaleState(Math.min(MAX_SAKI_PET_SCALE, Math.max(MIN_SAKI_PET_SCALE, custom.detail)));
        if (pendingPersistRef.current.scale !== undefined) pendingPersistRef.current.scale = custom.detail;
      }
    };
    window.addEventListener("saki:set_pet_scale", handlePetScaleEvent);
    return () => window.removeEventListener("saki:set_pet_scale", handlePetScaleEvent);
  }, []);

  const setChaseMouse = useCallback((value: boolean) => {
    setChaseMouseState(value);
    persist({ chaseMouse: value });
    setBehavior(value ? "chase" : "idle");
    behaviorUntilRef.current = Date.now() + (value ? 8000 : 4000);
  }, [persist]);

  const setHover = useCallback((value: boolean) => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (value) {
      setHovered(true);
      return;
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setHovered(false);
      setGroup("none");
      hoverTimerRef.current = null;
    }, 220);
  }, []);

  const openMenu = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(true);
  }, []);

  const dismissMenu = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHovered(false);
    setGroup("none");
    setWidget(null);
  }, []);

  const toggleMenu = useCallback(() => {
    setHovered((open) => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (open) {
        setGroup("none");
        setWidget(null);
        return false;
      }
      return true;
    });
  }, []);

  const openWidget = useCallback((next: SakiPetWidget) => {
    setWidget(next);
    if (next === "feed" || next === "skins") setGroup("companion");
    else if (next) setGroup("tools");
  }, []);

  const closeWidget = useCallback(() => setWidget(null), []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      mouseRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // 1 s tick only while the clock is visible (hover chrome / open widget);
  // a 30 s idle tick keeps dueEvents (15-minute window) correct cheaply.
  const clockActive = hovered || widget !== null || group !== "none";
  useEffect(() => {
    if (clockActive) setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), clockActive ? 1000 : 30000);
    return () => window.clearInterval(id);
  }, [clockActive]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStats((prev) => {
        const next = decayStats(prev);
        if (Date.now() - lastPersistRef.current > 20000) {
          persist({ stats: next });
          lastPersistRef.current = Date.now();
        }
        return next;
      });
    }, 30000);
    return () => window.clearInterval(id);
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    const apply = (lat: number, lon: number) => {
      void fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`
      )
        .then((res) => res.json())
        .then((data: { current?: { temperature_2m?: number; weather_code?: number } }) => {
          if (cancelled) return;
          const temp = data.current?.temperature_2m;
          const code = data.current?.weather_code;
          if (typeof temp === "number" && typeof code === "number") {
            setWeather({ temp: Math.round(temp), code });
          }
        })
        .catch(() => undefined);
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => apply(pos.coords.latitude, pos.coords.longitude),
        () => apply(31.23, 121.47),
        { maximumAge: 30 * 60 * 1000, timeout: 4000 }
      );
    } else {
      apply(31.23, 121.47);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pomodoro.running || !pomodoro.startedAt) return;
    const id = window.setInterval(() => {
      setPomodoro((prev) => {
        if (!prev.running || !prev.startedAt) return prev;
        const remaining = Math.max(0, prev.remainingMs - 1000);
        if (remaining <= 0) {
          const nextMode = prev.mode === "focus" ? "break" : "focus";
          const next: SakiPetPomodoro = {
            running: true,
            mode: nextMode,
            remainingMs: (nextMode === "focus" ? 25 : 5) * 60 * 1000,
            startedAt: Date.now()
          };
          persist({ pomodoro: next });
          return next;
        }
        const next = { ...prev, remainingMs: remaining, startedAt: Date.now() };
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [pomodoro.running, pomodoro.startedAt, persist]);

  const currentPosition = useCallback((): SakiLauncherPosition => {
    if (livePosRef.current) return livePosRef.current;
    if (position) return position;
    const vw = globalThis.innerWidth || 1200;
    const vh = globalThis.innerHeight || 800;
    return { x: vw - 110, y: vh - 150 };
  }, [position]);

  const livePosRef = useRef<SakiLauncherPosition | null>(position);
  useEffect(() => {
    livePosRef.current = position;
  }, [position]);

  const applyStageStyle = useCallback(
    (next: SakiLauncherPosition, extras?: { face?: SakiPetFacing; look?: number }) => {
      const stage = stageRef?.current;
      if (!stage) return;
      stage.style.left = "0px";
      stage.style.top = "0px";
      stage.style.right = "auto";
      stage.style.bottom = "auto";
      stage.style.setProperty("--saki-x", `${next.x}px`);
      stage.style.setProperty("--saki-y", `${next.y}px`);
      stage.style.transform = `translate(${next.x}px, ${next.y}px)`;
      if (extras?.face) stage.style.setProperty("--saki-face", extras.face === "left" ? "-1" : "1");
      if (typeof extras?.look === "number") stage.style.setProperty("--saki-look", `${extras.look}deg`);
    },
    [stageRef]
  );

  const commitPosition = useCallback(
    (next: SakiLauncherPosition, persistPos = false) => {
      const mode = next.edge === "left" || next.edge === "right" ? "attached" : "expanded";
      const clamped = clampSakiLauncherPosition(next, null, mode, scale);
      livePosRef.current = clamped;
      applyStageStyle(clamped);
      if (persistPos) {
        setPosition(clamped);
        writeSakiLauncherPosition(clamped);
      }
    },
    [applyStageStyle, setPosition, scale]
  );

  const pickTarget = useCallback((): SakiLauncherPosition => {
    const vw = globalThis.innerWidth || 1200;
    const vh = globalThis.innerHeight || 800;
    const maxW = Math.round(86 * scale) + 32;
    const maxH = Math.round(118 * scale) + 48;
    return {
      x: 24 + Math.random() * Math.max(40, vw - maxW),
      y: 72 + Math.random() * Math.max(40, vh - maxH)
    };
  }, [scale]);

  const startBehavior = useCallback(
    (next: SakiPetBehavior, durationMs?: number) => {
      setBehavior(next);
      const now = Date.now();
      if (next === "walk") {
        const cur = currentPosition();
        const vw = globalThis.innerWidth || 1200;
        const delta = (Math.random() < 0.5 ? -1 : 1) * (64 + Math.random() * 92);
        const targetX = Math.max(12, Math.min(vw - Math.round(86 * scale) - 16, cur.x + delta));
        walkTargetRef.current = { x: targetX, y: cur.y };
        setFacing(targetX < cur.x ? "left" : "right");
      } else if (next === "edge_climb") {
        const cur = currentPosition();
        const vh = globalThis.innerHeight || 800;
        const deltaY = (Math.random() < 0.5 ? -1 : 1) * (48 + Math.random() * 68);
        const targetY = Math.max(24, Math.min(vh - Math.round(92 * scale) - 24, cur.y + deltaY));
        walkTargetRef.current = { x: cur.x, y: targetY };
      } else {
        walkTargetRef.current = null;
      }

      if (next === "roll") {
        behaviorUntilRef.current = now + 2200;
      } else if (next === "climb" || next === "edge_climb") {
        behaviorUntilRef.current = now + (durationMs ?? 3600);
      } else if (next === "fall") {
        behaviorUntilRef.current = now + (durationMs ?? 1100);
      } else {
        behaviorUntilRef.current = now + (durationMs ?? (next === "sleep" ? 16000 : next === "sit" ? 10000 : 7000));
      }
    },
    [currentPosition]
  );

  const wakeUp = useCallback(() => {
    if (behavior === "sleep") {
      startBehavior("idle", 12000);
    } else if (behavior === "edge_sleep") {
      startBehavior("edge_idle", 8000);
    }
  }, [behavior, startBehavior]);

  const finishToilet = useCallback(() => {
    if (behavior === "toilet") {
      startBehavior("idle", 12000);
    } else if (behavior === "edge_toilet") {
      startBehavior("edge_idle", 8000);
    }
  }, [behavior, startBehavior]);

  // Immediately align behavior when snapping to or detaching from screen edges
  useEffect(() => {
    if (dragging) return;
    if (edgeAttached && !isSakiEdgeBehavior(behavior)) {
      startBehavior("edge_idle", 6500);
    } else if (!edgeAttached && isSakiEdgeBehavior(behavior)) {
      startBehavior("idle", 9000);
    }
  }, [behavior, dragging, edgeAttached, startBehavior]);

  // Smooth drag-release top-edge hang -> fall physics
  const prevDraggingRef = useRef(dragging);
  useEffect(() => {
    const wasDragging = prevDraggingRef.current;
    prevDraggingRef.current = dragging;
    if (wasDragging && !dragging && enabled && !edgeAttached) {
      const pos = currentPosition();
      if (pos.y <= 82) {
        startBehavior("hang", 3200);
      }
    }
  }, [currentPosition, dragging, edgeAttached, enabled, startBehavior]);

  // Smooth horizontal walk & vertical edge-climb stepper
  useEffect(() => {
    if (!enabled || dragging || paused) return;
    if (behavior !== "walk" && behavior !== "edge_climb") return;
    const target = walkTargetRef.current;
    if (!target) return;

    let rafId = 0;
    let lastTs = performance.now();
    const speedPxPerSec = behavior === "walk" ? 48 : 34;

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      const cur = currentPosition();
      const dx = target.x - cur.x;
      const dy = target.y - cur.y;
      const dist = Math.hypot(dx, dy);
      const edgePatch = cur.edge !== undefined ? { edge: cur.edge } : {};
      if (dist <= 2) {
        commitPosition({ x: target.x, y: target.y, ...edgePatch }, true);
        return;
      }
      const stepDist = Math.min(dist, speedPxPerSec * dt);
      const nextPos: SakiLauncherPosition = {
        x: cur.x + (dx / dist) * stepDist,
        y: cur.y + (dy / dist) * stepDist,
        ...edgePatch
      };
      commitPosition(nextPos, false);
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
      const latest = livePosRef.current;
      if (latest) commitPosition(latest, true);
    };
  }, [behavior, commitPosition, currentPosition, dragging, enabled, paused]);

  useEffect(() => {
    if (!enabled || chatOpen) return;
    let timer: number | null = null;
    const fire = () => {
      timer = null;
      if (dragging || paused) {
        // Keep waiting while behavior is suspended; re-check shortly.
        timer = window.setTimeout(fire, 500);
        return;
      }
      if (Date.now() >= behaviorUntilRef.current) {
        if (edgeAttached) {
          const picked = pickAutonomousEdgeBehavior(behavior, stats.hunger);
          startBehavior(picked.behavior, picked.durationMs);
        } else if (behavior === "hang") {
          const cur = currentPosition();
          commitPosition({ ...cur, y: cur.y + 52 }, true);
          startBehavior("fall", 1050);
        } else if (behavior === "toilet" || behavior === "fall") {
          startBehavior("idle", 10000);
        } else {
          const picked = pickAutonomousStandingBehavior(behavior, stats, pomodoro);
          startBehavior(picked.behavior, picked.durationMs);
        }
      }
      timer = window.setTimeout(fire, Math.max(400, behaviorUntilRef.current - Date.now()));
    };
    timer = window.setTimeout(fire, Math.max(400, behaviorUntilRef.current - Date.now()));
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    behavior,
    chatOpen,
    commitPosition,
    currentPosition,
    dragging,
    edgeAttached,
    enabled,
    paused,
    pomodoro,
    startBehavior,
    stats
  ]);

  const applyCare = useCallback(
    (kind: "feed" | "pet" | "sleep" | "bath" | "doctor" | "toilet" | "play", amount = 0) => {
      if (kind === "feed") {
        patchStats({ hunger: stats.hunger + Math.max(12, amount), mood: stats.mood + 8, health: stats.health + 2 });
        startBehavior(edgeAttached ? "edge_feed" : Math.random() < 0.35 ? "drink" : "eat", 5800);
        playFx("sparkle");
      } else if (kind === "pet") {
        patchStats({ mood: stats.mood + 10, health: stats.health + 1 });
        playFx("hearts");
        if (edgeAttached) {
          startBehavior(Math.random() < 0.72 ? "edge_pet" : "edge_poke", 3600);
        } else {
          const roll = Math.random();
          startBehavior(roll < 0.55 ? "poke" : roll < 0.8 ? "happy_cheer" : "idle_shy", 3400);
        }
      } else if (kind === "sleep") {
        patchStats({ mood: stats.mood + 18, hunger: stats.hunger - 4, health: stats.health + 6 });
        startBehavior(edgeAttached ? "edge_sleep" : "sleep", edgeAttached ? 14000 : 18000);
        playFx("zzz", 4000);
      } else if (kind === "bath") {
        patchStats({ health: stats.health + 22, mood: stats.mood + 10 });
        playFx("soap", 3200);
        startBehavior(edgeAttached ? "edge_bath" : "bath", 6400);
      } else if (kind === "doctor") {
        patchStats({ health: 100, mood: stats.mood + 6 });
        playFx("sparkle");
        startBehavior(edgeAttached ? "edge_doctor" : "doctor", 5600);
      } else if (kind === "toilet") {
        patchStats({ mood: stats.mood + 4, health: stats.health + 2 });
        startBehavior(edgeAttached ? "edge_toilet" : "toilet", edgeAttached ? 6400 : 30000);
      } else {
        patchStats({ mood: stats.mood + 12 });
        startBehavior(edgeAttached ? "edge_wave" : Math.random() < 0.5 ? "happy_cheer" : "roll", 3600);
        playFx("hearts");
      }
    },
    [edgeAttached, patchStats, playFx, startBehavior, stats.health, stats.hunger, stats.mood]
  );

  const addTodo = useCallback((text: string) => {
    setTodos((prev) => {
      const next = [{ id: newClientId(), text, done: false }, ...prev].slice(0, 40);
      persist({ todos: next });
      return next;
    });
  }, [persist]);

  const toggleTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
      persist({ todos: next });
      return next;
    });
  }, [persist]);

  const removeTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.filter((item) => item.id !== id);
      persist({ todos: next });
      return next;
    });
  }, [persist]);

  const addEvent = useCallback((title: string, at: string) => {
    setEvents((prev) => {
      const next = [{ id: newClientId(), title, at }, ...prev].slice(0, 40);
      persist({ events: next });
      return next;
    });
  }, [persist]);

  const removeEvent = useCallback((id: string) => {
    setEvents((prev) => {
      const next = prev.filter((item) => item.id !== id);
      persist({ events: next });
      return next;
    });
  }, [persist]);

  const addNote = useCallback((text: string, color: string, x: number, y: number) => {
    setNotes((prev) => {
      const next = [{ id: newClientId(), text, color, x, y }, ...prev].slice(0, 12);
      persist({ notes: next });
      return next;
    });
  }, [persist]);

  const updateNote = useCallback((id: string, patch: Partial<SakiPetNote>) => {
    setNotes((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persist({ notes: next });
      return next;
    });
  }, [persist]);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.filter((item) => item.id !== id);
      persist({ notes: next });
      return next;
    });
  }, [persist]);

  const addSticker = useCallback((src: string, x: number, y: number) => {
    setStickers((prev) => {
      const next = [{ id: newClientId(), src, x, y, scale: 1 }, ...prev].slice(0, 4);
      persist({ stickers: next });
      return next;
    });
  }, [persist]);

  const updateSticker = useCallback((id: string, patch: Partial<SakiPetSticker>) => {
    setStickers((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persist({ stickers: next });
      return next;
    });
  }, [persist]);

  const removeSticker = useCallback((id: string) => {
    setStickers((prev) => {
      const next = prev.filter((item) => item.id !== id);
      persist({ stickers: next });
      return next;
    });
  }, [persist]);

  const togglePomodoro = useCallback(() => {
    setPomodoro((prev) => {
      const next: SakiPetPomodoro = prev.running
        ? { ...prev, running: false, startedAt: null }
        : { ...prev, running: true, startedAt: Date.now() };
      persist({ pomodoro: next });
      return next;
    });
  }, [persist]);

  const resetPomodoro = useCallback((mode: "focus" | "break" = "focus") => {
    const next: SakiPetPomodoro = {
      running: false,
      mode,
      remainingMs: (mode === "focus" ? 25 : 5) * 60 * 1000,
      startedAt: null
    };
    setPomodoro(next);
    persist({ pomodoro: next });
  }, [persist]);

  const onWheelScale = useCallback(
    (delta: number) => {
      setScale(scale + (delta > 0 ? -0.08 : 0.08));
    },
    [scale, setScale]
  );

  const unlockedSkins: SakiPetSkinId[] = ["saki"];
  const dueEvents = events.filter((item) => {
    const t = new Date(item.at).getTime();
    return t > nowMs - 60_000 && t < nowMs + 15 * 60_000;
  });

  return {
    stats,
    skin,
    setSkin,
    scale,
    setScale,
    onWheelScale,
    chaseMouse,
    setChaseMouse,
    behavior,
    startBehavior,
    wakeUp,
    finishToilet,
    facing,
    lookDeg,
    fx,
    hovered,
    setHover,
    openMenu,
    dismissMenu,
    toggleMenu,
    group,
    setGroup,
    widget,
    openWidget,
    closeWidget,
    bubble,
    showBubble,
    weather,
    nowMs,
    todos,
    addTodo,
    toggleTodo,
    removeTodo,
    events,
    addEvent,
    removeEvent,
    dueEvents,
    notes,
    addNote,
    updateNote,
    removeNote,
    stickers,
    addSticker,
    updateSticker,
    removeSticker,
    pomodoro,
    togglePomodoro,
    resetPomodoro,
    applyCare,
    unlockedSkins,
    music
  };
}

export type SakiPetController = ReturnType<typeof useSakiPet>;
