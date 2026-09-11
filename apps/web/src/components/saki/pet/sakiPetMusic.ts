import { useCallback, useEffect, useRef, useState } from "react";
import { newClientId } from "../../../utils/id.js";

export type SakiMusicLoop = "off" | "one" | "all";

export interface SakiMusicTrack {
  id: string;
  name: string;
  mime: string;
  duration: number;
}

interface StoredTrack {
  name: string;
  mime: string;
  blob: Blob;
}

const DB_NAME = "webops.saki.music";
const STORE = "tracks";
const META_KEY = "webops.saki.musicMeta.v1";
const MAX_BYTES = 40 * 1024 * 1024;

export const sakiMusicAccept =
  "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/flac,audio/aac,audio/webm,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.flac,.aac,.m4a,.webm";

interface MusicMeta {
  order: string[];
  currentId: string | null;
  loop: SakiMusicLoop;
  volume: number;
}

function readMeta(): MusicMeta {
  try {
    const raw = globalThis.localStorage?.getItem(META_KEY);
    if (!raw) return { order: [], currentId: null, loop: "all", volume: 0.8 };
    const parsed = JSON.parse(raw) as Partial<MusicMeta>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((id): id is string => typeof id === "string") : [],
      currentId: typeof parsed.currentId === "string" ? parsed.currentId : null,
      loop: parsed.loop === "off" || parsed.loop === "one" || parsed.loop === "all" ? parsed.loop : "all",
      volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : 0.8
    };
  } catch {
    return { order: [], currentId: null, loop: "all", volume: 0.8 };
  }
}

function writeMeta(meta: MusicMeta) {
  try {
    globalThis.localStorage?.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // ignore quota
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("music db"));
  });
}

async function idbPut(id: string, record: StoredTrack) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet(id: string): Promise<StoredTrack | null> {
  const db = await openDb();
  const record = await new Promise<StoredTrack | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredTrack | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return record && record.blob instanceof Blob ? record : null;
}

async function idbDel(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function readDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

export function formatTrackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function useSakiPetMusic() {
  const [tracks, setTracks] = useState<SakiMusicTrack[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<SakiMusicLoop>("all");
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tracksRef = useRef<SakiMusicTrack[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const loopRef = useRef<SakiMusicLoop>("all");
  const playNextRef = useRef<(dir: 1 | -1, fromEnded: boolean) => void>(() => undefined);
  const loadTrackRef = useRef<(id: string, autoplay: boolean) => Promise<boolean>>(async () => false);

  tracksRef.current = tracks;
  currentIdRef.current = currentId;
  loopRef.current = loop;

  const persistMeta = useCallback(() => {
    writeMeta({
      order: tracksRef.current.map((item) => item.id),
      currentId: currentIdRef.current,
      loop: loopRef.current,
      volume
    });
  }, [volume]);

  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const loadTrack = useCallback(
    async (id: string, autoplay: boolean) => {
      const record = await idbGet(id);
      if (!record) return false;
      const audio = getAudio();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(record.blob);
      urlRef.current = url;
      audio.src = url;
      audio.volume = volume;
      setCurrentId(id);
      currentIdRef.current = id;
      setCurrentTime(0);
      try {
        if (autoplay) {
          await audio.play();
          setPlaying(true);
        } else {
          audio.pause();
          setPlaying(false);
        }
      } catch {
        setPlaying(false);
      }
      persistMeta();
      return true;
    },
    [getAudio, persistMeta, volume]
  );
  loadTrackRef.current = loadTrack;

  const playNext = useCallback(
    (dir: 1 | -1, fromEnded: boolean) => {
      const list = tracksRef.current;
      if (list.length === 0) return;
      const loopMode = loopRef.current;
      const index = Math.max(0, list.findIndex((item) => item.id === currentIdRef.current));
      if (fromEnded && loopMode === "one" && currentIdRef.current) {
        const audio = getAudio();
        audio.currentTime = 0;
        void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        return;
      }
      let nextIndex = index + dir;
      if (nextIndex >= list.length) {
        if (loopMode === "all") nextIndex = 0;
        else {
          setPlaying(false);
          getAudio().pause();
          return;
        }
      }
      if (nextIndex < 0) nextIndex = loopMode === "all" ? list.length - 1 : 0;
      const next = list[nextIndex];
      if (next) void loadTrack(next.id, true);
    },
    [getAudio, loadTrack]
  );
  playNextRef.current = playNext;

  useEffect(() => {
    const audio = getAudio();
    const onTime = () => {
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => playNextRef.current(1, true);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.volume = volume;
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [getAudio, volume]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = readMeta();
      const next: SakiMusicTrack[] = [];
      for (const id of saved.order) {
        const record = await idbGet(id);
        if (!record) continue;
        const durationSec = await readDuration(record.blob);
        next.push({ id, name: record.name, mime: record.mime, duration: durationSec });
      }
      if (cancelled) return;
      setTracks(next);
      tracksRef.current = next;
      setLoop(saved.loop);
      loopRef.current = saved.loop;
      setVolume(saved.volume);
      if (saved.currentId && next.some((item) => item.id === saved.currentId)) {
        await loadTrackRef.current(saved.currentId, false);
      }
    })();
    return () => {
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      audioRef.current?.pause();
    };
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files).filter((file) => file.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(file.name));
      if (incoming.length === 0) return 0;
      const added: SakiMusicTrack[] = [];
      for (const file of incoming) {
        if (file.size > MAX_BYTES) continue;
        const id = newClientId();
        await idbPut(id, { name: file.name.replace(/\.[^.]+$/, "") || file.name, mime: file.type || "audio/mpeg", blob: file });
        const durationSec = await readDuration(file);
        added.push({
          id,
          name: file.name.replace(/\.[^.]+$/, "") || file.name,
          mime: file.type || "audio/mpeg",
          duration: durationSec
        });
      }
      if (added.length === 0) return 0;
      setTracks((prev) => {
        const next = [...prev, ...added];
        tracksRef.current = next;
        return next;
      });
      persistMeta();
      if (!currentIdRef.current && added[0]) await loadTrack(added[0].id, true);
      return added.length;
    },
    [loadTrack, persistMeta]
  );

  const removeTrack = useCallback(
    async (id: string) => {
      await idbDel(id);
      const remaining = tracksRef.current.filter((item) => item.id !== id);
      setTracks(remaining);
      tracksRef.current = remaining;
      if (currentIdRef.current === id) {
        if (remaining[0]) await loadTrack(remaining[0].id, playing);
        else {
          getAudio().pause();
          setPlaying(false);
          setCurrentId(null);
          currentIdRef.current = null;
          setCurrentTime(0);
          setDuration(0);
        }
      }
      persistMeta();
    },
    [getAudio, loadTrack, persistMeta, playing]
  );

  const togglePlay = useCallback(async () => {
    const audio = getAudio();
    if (!currentIdRef.current) {
      const first = tracksRef.current[0];
      if (first) await loadTrack(first.id, true);
      return;
    }
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [getAudio, loadTrack]);

  const seek = useCallback(
    (time: number) => {
      const audio = getAudio();
      audio.currentTime = Math.max(0, Math.min(audio.duration || 0, time));
      setCurrentTime(audio.currentTime);
    },
    [getAudio]
  );

  const setVolumeSafe = useCallback(
    (value: number) => {
      const next = Math.min(1, Math.max(0, value));
      setVolume(next);
      getAudio().volume = next;
      persistMeta();
    },
    [getAudio, persistMeta]
  );

  const setLoopSafe = useCallback(
    (value: SakiMusicLoop) => {
      setLoop(value);
      loopRef.current = value;
      persistMeta();
    },
    [persistMeta]
  );

  const playTrack = useCallback(
    (id: string) => {
      void loadTrack(id, true);
    },
    [loadTrack]
  );

  const current = tracks.find((item) => item.id === currentId) ?? null;

  return {
    tracks,
    current,
    currentId,
    playing,
    loop,
    volume,
    currentTime,
    duration: duration || current?.duration || 0,
    addFiles,
    removeTrack,
    togglePlay,
    playTrack,
    playNext: () => playNext(1, false),
    playPrev: () => playNext(-1, false),
    seek,
    setVolume: setVolumeSafe,
    setLoop: setLoopSafe
  };
}

export type SakiPetMusic = ReturnType<typeof useSakiPetMusic>;
