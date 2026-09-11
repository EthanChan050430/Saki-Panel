import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  clampSakiLauncherPosition,
  snapSakiLauncherPositionToEdge,
  writeSakiLauncherPosition,
  type SakiLauncherPosition
} from "../SakiComponents.js";
import { newClientId } from "../../../utils/id.js";
import { useSakiPetMusic } from "./sakiPetMusic.js";

export function isSakiPetTouchUi(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none)").matches || window.matchMedia("(pointer: coarse)").matches;
}

export type SakiPetSkinId = "saki";
export type SakiPetBehavior =
  | "idle"
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
  | "eat"
  | "doctor"
  | "pickup"
  | "bath"
  | "poke"
  | "yawn"
  | "shy"
  | "pout"
  | "drink"
  | "blink";
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
const MIN_SCALE = 0.72;
const MAX_SCALE = 1.65;

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
  const isEn = language === "en-US";
  const isJa = language === "ja-JP";
  if (code === 0) return isEn ? "Clear" : isJa ? "晴れ" : "晴";
  if (code <= 3) return isEn ? "Cloudy" : isJa ? "曇り" : "多云";
  if (code <= 48) return isEn ? "Fog" : isJa ? "霧" : "雾";
  if (code <= 67) return isEn ? "Rain" : isJa ? "雨" : "雨";
  if (code <= 77) return isEn ? "Snow" : isJa ? "雪" : "雪";
  if (code <= 82) return isEn ? "Showers" : isJa ? "にわか雨" : "阵雨";
  return isEn ? "Storm" : isJa ? "雷雨" : "雷雨";
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
  const [scale, setScaleState] = useState(() => Math.min(MAX_SCALE, Math.max(MIN_SCALE, saved.scale ?? 1)));
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
      stage.style.transform = `translate(${next.x}px, ${next.y}px)`;
      if (extras?.face) stage.style.setProperty("--saki-face", extras.face === "left" ? "-1" : "1");
      if (typeof extras?.look === "number") stage.style.setProperty("--saki-look", `${extras.look}deg`);
    },
    [stageRef]
  );

  const commitPosition = useCallback(
    (next: SakiLauncherPosition, persistPos = false) => {
      const clamped = clampSakiLauncherPosition(next, null, "expanded");
      livePosRef.current = clamped;
      applyStageStyle(clamped);
      if (persistPos) {
        setPosition(clamped);
        writeSakiLauncherPosition(clamped);
      }
    },
    [applyStageStyle, setPosition]
  );

  const pickTarget = useCallback((): SakiLauncherPosition => {
    const vw = globalThis.innerWidth || 1200;
    const vh = globalThis.innerHeight || 800;
    return {
      x: 24 + Math.random() * Math.max(40, vw - 140),
      y: 72 + Math.random() * Math.max(40, vh - 220)
    };
  }, []);

  const startBehavior = useCallback(
    (next: SakiPetBehavior, durationMs?: number) => {
      setBehavior(next);
      const now = Date.now();
      if (next === "roll") {
        behaviorUntilRef.current = now + 2200;
      } else if (next === "climb") {
        behaviorUntilRef.current = now + (durationMs ?? 2400);
      } else {
        behaviorUntilRef.current = now + (durationMs ?? (next === "sleep" ? 16000 : next === "sit" ? 10000 : 7000));
      }
    },
    [commitPosition, currentPosition, pickTarget, setPosition]
  );

  useEffect(() => {
    if (!enabled || chatOpen) return;
    let timer: number | null = null;
    const fire = () => {
      timer = null;
      if (dragging || paused || edgeAttached) {
        // Keep waiting while behavior is suspended; re-check shortly.
        timer = window.setTimeout(fire, 500);
        return;
      }
      if (Date.now() >= behaviorUntilRef.current) {
        const hour = new Date().getHours();
        const roll = Math.random();
        if (stats.hunger < 22 && roll < 0.45) startBehavior(Math.random() < 0.5 ? "sit" : "sleep");
        else if ((hour >= 23 || hour < 6) && roll < 0.5) startBehavior("sleep");
        else if (roll < 0.28) startBehavior("sit");
        else if (roll < 0.4) startBehavior("lie");
        else if (roll < 0.52) startBehavior("sleep");
        else if (roll < 0.62) startBehavior("yawn", 2800);
        else startBehavior("idle", 14000);
      }
      timer = window.setTimeout(fire, Math.max(0, behaviorUntilRef.current - Date.now()));
    };
    timer = window.setTimeout(fire, Math.max(0, behaviorUntilRef.current - Date.now()));
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [chatOpen, dragging, edgeAttached, enabled, paused, startBehavior, stats.hunger]);

  const applyCare = useCallback(
    (kind: "feed" | "pet" | "sleep" | "bath" | "doctor" | "play", amount = 0) => {
      if (kind === "feed") {
        patchStats({ hunger: stats.hunger + Math.max(12, amount), mood: stats.mood + 8, health: stats.health + 2 });
        startBehavior("eat", 5600);
        playFx("sparkle");
      } else if (kind === "pet") {
        patchStats({ mood: stats.mood + 10, health: stats.health + 1 });
        playFx("hearts");
        startBehavior("poke", 2500);
      } else if (kind === "sleep") {
        patchStats({ mood: stats.mood + 18, hunger: stats.hunger - 4, health: stats.health + 6 });
        startBehavior("sleep", 18000);
        playFx("zzz", 4000);
      } else if (kind === "bath") {
        patchStats({ health: stats.health + 22, mood: stats.mood + 10 });
        playFx("soap", 3200);
        startBehavior("bath", 6400);
      } else if (kind === "doctor") {
        patchStats({ health: 100, mood: stats.mood + 6 });
        playFx("sparkle");
        startBehavior("doctor", 5600);
      } else {
        patchStats({ mood: stats.mood + 12 });
        startBehavior("roll", 2200);
        playFx("hearts");
      }
    },
    [patchStats, playFx, startBehavior, stats.health, stats.hunger, stats.mood]
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
