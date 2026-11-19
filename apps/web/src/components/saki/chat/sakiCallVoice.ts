import { sakiCallVoiceDownloadPath, sakiCallVoiceModel } from "@webops/shared";
import { panelApiUrl } from "../../../api.js";

type CallModelProgress = {
  phase: "selecting" | "connecting" | "downloading" | "verifying" | "initializing" | "ready" | "error";
  source?: "github" | "mirror";
  percent?: number;
};

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

export function isMobileCallDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return window.matchMedia?.("(pointer: coarse) and (hover: none)").matches ?? false;
}

export function shouldDeferLocalVoiceModel(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isMobileCallDevice()) return true;
  const device = navigator as Navigator & { deviceMemory?: number; connection?: NetworkInfo };
  if (device.connection?.saveData) return true;
  if (typeof device.deviceMemory === "number" && device.deviceMemory > 0 && device.deviceMemory <= 4) return true;
  return typeof document !== "undefined" && document.documentElement.classList.contains("perf-lite");
}
type CallAudio = { samples: Float32Array; sampleRate: number };
type AvatarPlayback =
  | { kind: "pcm"; text: string; analyser: AnalyserNode; waveform: Float32Array<ArrayBuffer> }
  | { kind: "browser"; text: string; start: number; boundary: number };

export class SakiCallModel {
  private worker: Worker | null = null;
  private jobId = 0;
  private jobs = new Map<number, { resolve: (audio: CallAudio) => void; reject: (error: Error) => void }>();

  constructor(token: string, onProgress: (progress: CallModelProgress) => void) {
    const fail = () => {
      this.close();
      onProgress({ phase: "error" });
    };
    try {
      this.worker = new Worker(import.meta.env.BASE_URL + "saki-call-voice/worker.js?v=1");
      this.worker.onerror = fail;
      this.worker.onmessageerror = fail;
      this.worker.onmessage = ({ data }) => {
        if (data.type === "progress") onProgress(data);
        if (data.type === "ready") onProgress({ phase: "ready" });
        if (data.type === "error") fail();
        if (data.type !== "audio") return;
        const job = this.jobs.get(data.id);
        this.jobs.delete(data.id);
        if (data.error) job?.reject(new Error(data.error));
        else job?.resolve(data);
      };
      this.worker.postMessage({
        type: "init", model: sakiCallVoiceModel, proxyUrl: panelApiUrl(sakiCallVoiceDownloadPath), token
      });
    } catch {
      fail();
    }
  }

  generate(text: string): Promise<CallAudio> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("The voice model is unavailable"));
    const id = ++this.jobId;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      try {
        worker.postMessage({ type: "generate", id, text });
      } catch (error) {
        this.jobs.delete(id);
        reject(error);
      }
    });
  }

  close() {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values()) job.reject(new Error("Voice model closed"));
    this.jobs.clear();
  }
}

export class SakiCallAudio {
  private context: AudioContext | null = null;
  private stopPlaying: (() => void) | undefined;
  private avatarPlayback: AvatarPlayback | null = null;
  private speechPrimed = false;

  unlock() {
    const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    try {
      if (Audio) {
        this.context ??= new Audio();
        void this.context.resume().catch(() => {});
      }
    } catch {}
    // Prime Web Speech inside a user gesture so iOS Safari allows later async replies.
    if (!this.speechPrimed && typeof window !== "undefined" && window.speechSynthesis) {
      try {
        if (!window.speechSynthesis.speaking) {
          const primer = new SpeechSynthesisUtterance("");
          primer.volume = 0;
          window.speechSynthesis.speak(primer);
        }
        this.speechPrimed = true;
      } catch {}
    }
  }

  async play({ samples, sampleRate }: CallAudio, text: string): Promise<void> {
    const context = this.context;
    if (!context) throw new Error("Audio playback is blocked");
    if (context.state !== "running") {
      try { await context.resume(); } catch {}
    }
    if (context.state !== "running") throw new Error("Audio playback is blocked");
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const node = context.createBufferSource();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    node.buffer = buffer;
    node.connect(analyser);
    analyser.connect(context.destination);
    return new Promise((resolve, reject) => {
      const finish = () => {
        this.stopPlaying = undefined;
        this.avatarPlayback = null;
        node.onended = null;
        node.disconnect();
        analyser.disconnect();
        resolve();
      };
      this.stopPlaying = () => {
        try { node.stop(); } catch {}
        finish();
      };
      node.onended = finish;
      try {
        node.start();
        this.avatarPlayback = { kind: "pcm", text, analyser, waveform: new Float32Array(analyser.fftSize) };
      }
      catch (error) { reject(error); finish(); }
    });
  }

  speak(text: string, language: string): Promise<void> {
    if (!window.speechSynthesis) return Promise.reject(new Error("Browser speech synthesis is unavailable"));
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        this.stopPlaying = undefined;
        this.avatarPlayback = null;
        utterance.onstart = null;
        utterance.onboundary = null;
        utterance.onend = null;
        utterance.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const timeout = window.setTimeout(() => {
        finish(new Error("Browser speech synthesis timed out"));
        window.speechSynthesis.cancel();
      }, 25_000);
      this.stopPlaying = () => {
        finish();
        window.speechSynthesis.cancel();
      };
      utterance.onstart = () => {
        this.avatarPlayback = { kind: "browser", text, start: performance.now(), boundary: -Infinity };
      };
      utterance.onboundary = () => {
        if (this.avatarPlayback?.kind === "browser") this.avatarPlayback.boundary = performance.now();
      };
      utterance.onend = () => finish();
      utterance.onerror = () => finish(new Error("Browser speech synthesis failed"));
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      }
      catch (error) { finish(new Error(String(error))); }
    });
  }

  getAvatarSpeech(now: number) {
    const playback = this.avatarPlayback;
    if (!playback) return { active: false, text: "", voice: 0, articulation: 0 };
    if (playback.kind === "pcm") {
      playback.analyser.getFloatTimeDomainData(playback.waveform);
      let power = 0;
      for (const sample of playback.waveform) power += sample * sample;
      const voice = Math.min(1, Math.sqrt(power / playback.waveform.length) * 6.2);
      return { active: true, text: playback.text, voice, articulation: 0 };
    }
    // Web Speech does not expose PCM. Use utterance start and word boundaries as in Saki-AI.
    const beat = now - playback.boundary < 130;
    const syllable = Math.max(0, Math.sin((now - playback.start) / 67) * .68 + Math.sin(now / 102) * .16);
    return { active: true, text: playback.text, voice: Math.min(.83, syllable + (beat ? .25 : 0)), articulation: beat ? .6 : .16 };
  }

  stop() { this.stopPlaying?.(); }

  close() {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}

export function sakiCallSpeechParts(markdown: string, complete: boolean): string[] {
  const text = markdown
    .replace(/(?:^|\n)[ \t]*(?:\x60{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:\x60{3,}|~{3,})[ \t]*(?=\n|$)|$)/g, "\n")
    .replace(/\x60[^\x60\n]*(?:\x60|$)/g, "")
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*(?:\)|$)/g, "$1")
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, "")
    .replace(/[*_~\p{Extended_Pictographic}]/gu, "");
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const endOfSentence = /[。！？!?；;\n]/.test(char) || (char === "." && /\s/.test(text[index + 1] ?? ""));
    const longClause = index - start >= 100 && /[，,、：:\s]/.test(char);
    if (!endOfSentence && !longClause && index - start < 180) continue;
    const segment = text.slice(start, index + 1).trim();
    start = index + 1;
    if (/[\p{L}\p{N}]/u.test(segment)) parts.push(segment);
  }
  const tail = text.slice(start).trim();
  if (complete && /[\p{L}\p{N}]/u.test(tail)) parts.push(tail);
  return parts;
}
