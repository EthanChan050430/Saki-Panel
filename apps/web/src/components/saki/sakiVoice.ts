import type { SakiVoiceEchoState } from "./SakiComponents.js";
import { getSakiVoiceEchoEngine } from "./sakiVoiceEngine.js";

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function normalizeFloat32(samples: Float32Array, target = 0.55): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]!));
  if (peak < 0.008) return samples;
  const scale = Math.min(target / peak, 3.8);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i]! * scale;
  return out;
}

export function applyEdgeFade(samples: Float32Array, sampleRate: number, seconds: number) {
  const fade = Math.min(Math.floor(sampleRate * seconds), Math.floor(samples.length / 6));
  if (fade <= 1) return;
  for (let i = 0; i < fade; i += 1) {
    const g = i / fade;
    samples[i] = (samples[i] ?? 0) * g;
    samples[samples.length - 1 - i] = (samples[samples.length - 1 - i] ?? 0) * g;
  }
}

export function resampleByRatio(input: Float32Array, ratio: number): Float32Array {
  if (ratio <= 0 || Math.abs(ratio - 1) < 0.01) return input;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  for (let i = 0; i < outLen; i += 1) {
    const src = i * ratio;
    const i0 = Math.min(last, Math.floor(src));
    const i1 = Math.min(last, i0 + 1);
    const t = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - t) + (input[i1] ?? 0) * t;
  }
  return out;
}

export function semitoneRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  const denom = Math.max(1, size - 1);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
  }
  return window;
}

export function olaStretch(input: Float32Array, stretch: number): Float32Array {
  if (stretch <= 1.03 || input.length < 256) return input;
  const grainSize = 1024;
  const hopOut = 256;
  const hopIn = hopOut / stretch;
  const out = new Float32Array(Math.max(grainSize, Math.floor(input.length * stretch)));
  const window = hannWindow(grainSize);
  let inPos = 0;
  let outPos = 0;
  while (outPos + grainSize < out.length && inPos + grainSize < input.length) {
    const src = Math.floor(inPos);
    for (let i = 0; i < grainSize; i += 1) {
      out[outPos + i] = (out[outPos + i] ?? 0) + (input[src + i] ?? 0) * (window[i] ?? 0);
    }
    inPos += hopIn;
    outPos += hopOut;
  }
  const gain = hopOut / (grainSize * 0.5);
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * gain;
  return out;
}

export function psolaPitchShift(input: Float32Array, ratio: number, periodSamples: number): Float32Array {
  if (ratio <= 1.03 || input.length < 128) return input;
  const period = Math.max(18, Math.round(periodSamples));
  const grainLen = Math.min(input.length, Math.max(64, period * 2));
  const half = Math.floor(grainLen / 2);
  const window = hannWindow(grainLen);
  const out = new Float32Array(input.length);
  const newPeriod = Math.max(8, period / ratio);
  for (let i = 0; i < half && i < input.length; i += 1) {
    out[i] = (input[i] ?? 0) * (i / half);
  }
  let outPos = half;
  while (outPos + half < input.length) {
    const srcStart = Math.round(outPos) - half;
    const destStart = Math.round(outPos - half);
    for (let i = 0; i < grainLen; i += 1) {
      const srcIndex = srcStart + i;
      const dest = destStart + i;
      if (srcIndex >= 0 && srcIndex < input.length && dest >= 0 && dest < out.length) {
        out[dest] = (out[dest] ?? 0) + (input[srcIndex] ?? 0) * (window[i] ?? 0);
      }
    }
    outPos += newPeriod;
  }
  const scale = 1 / Math.max(1, (grainLen * 0.5) / newPeriod);
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * scale;
  return out;
}

export function loudestRegion(samples: Float32Array, sampleRate: number, seconds: number): Float32Array {
  const len = Math.min(samples.length, Math.max(1, Math.floor(sampleRate * seconds)));
  if (samples.length <= len) return samples;
  const hop = Math.max(1, Math.floor(sampleRate * 0.08));
  let best = 0;
  let bestEnergy = -1;
  for (let start = 0; start + len <= samples.length; start += hop) {
    let energy = 0;
    for (let i = start; i < start + len; i += 8) energy += Math.abs(samples[i] ?? 0);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = start;
    }
  }
  return samples.subarray(best, best + len);
}

export function yinF0(window: Float32Array, sampleRate: number): number | null {
  if (window.length < 64) return null;
  const tauMin = Math.max(2, Math.floor(sampleRate / 380));
  const tauMax = Math.min(Math.floor(sampleRate / 65), Math.floor(window.length / 2) - 2);
  if (tauMax <= tauMin + 2) return null;

  const diff = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau += 1) {
    let sum = 0;
    const limit = window.length - tau;
    for (let i = 0; i < limit; i += 1) {
      const delta = (window[i] ?? 0) - (window[i + tau] ?? 0);
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    running += diff[tau] ?? 0;
    cmnd[tau] = running > 0 ? ((diff[tau] ?? 0) * tau) / running : 1;
  }

  const threshold = 0.14;
  let tauEst = 0;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if ((cmnd[tau] ?? 1) < threshold) {
      while (tau + 1 <= tauMax && (cmnd[tau + 1] ?? 1) < (cmnd[tau] ?? 1)) tau += 1;
      tauEst = tau;
      break;
    }
  }
  if (!tauEst) {
    let minValue = 1;
    for (let tau = tauMin; tau <= tauMax; tau += 1) {
      const value = cmnd[tau] ?? 1;
      if (value < minValue) {
        minValue = value;
        tauEst = tau;
      }
    }
    if (minValue > 0.42) return null;
  }

  const s0 = cmnd[tauEst - 1] ?? cmnd[tauEst] ?? 0;
  const s1 = cmnd[tauEst] ?? 0;
  const s2 = cmnd[tauEst + 1] ?? cmnd[tauEst] ?? 0;
  const denom = 2 * s1 - s2 - s0;
  const tau = denom !== 0 ? tauEst + (s0 - s2) / (2 * denom) : tauEst;
  if (tau <= 0) return null;
  const f0 = sampleRate / tau;
  if (f0 < 65 || f0 > 380) return null;
  return f0;
}

export function estimateF0Hz(samples: Float32Array, sampleRate: number): number | null {
  const targetRate = 8000;
  const ratio = sampleRate / targetRate;
  let analysis = samples;
  let rate = sampleRate;
  if (ratio > 1.2 && samples.length > 400) {
    const downLen = Math.max(1, Math.floor(samples.length / ratio));
    const down = new Float32Array(downLen);
    for (let i = 0; i < downLen; i += 1) {
      down[i] = samples[Math.min(samples.length - 1, Math.floor(i * ratio))] ?? 0;
    }
    analysis = down;
    rate = targetRate;
  }

  const region = loudestRegion(analysis, rate, 1.15);
  const winSize = Math.floor(rate * 0.05);
  const hop = Math.floor(rate * 0.032);
  if (winSize < 64) return yinF0(region, rate);

  const votes: number[] = [];
  for (let start = 0; start + winSize <= region.length; start += hop) {
    const f0 = yinF0(region.subarray(start, start + winSize), rate);
    if (f0) votes.push(f0);
  }
  if (votes.length === 0) return yinF0(region, rate);
  votes.sort((a, b) => a - b);
  let f0 = votes[Math.floor(votes.length * 0.28)] ?? votes[0] ?? null;
  if (!f0) return null;
  const half = f0 / 2;
  if (f0 > 175 && half >= 70 && half <= 165) {
    const nearHalf = votes.filter((value) => Math.abs(value - half) < 20).length;
    if (nearHalf > 0 || f0 > 205) f0 = half;
  }
  return f0;
}

export function toSakiVoice(samples: Float32Array, sampleRate: number): { samples: Float32Array; male: boolean } {
  const normalized = normalizeFloat32(samples, 0.6);
  const f0 = estimateF0Hz(normalized, sampleRate);
  // 基础音高检测：成人男声约 80-160Hz，女声约 170-260Hz
  const assumedF0 = f0 && f0 >= 65 && f0 <= 380 ? f0 : 130;
  const male = assumedF0 < 175;

  // 目标基频绝对锚定：将基频死死锁定在 Saki 专属的元气二次元基础音高 392Hz (G4)
  const TARGET_SAKI_F0 = 392;
  const targetRatio = TARGET_SAKI_F0 / assumedF0;
  // 限制合理倍率区间，防止极端背景噪音引起尖锐杂音
  const pitchRatio = Math.min(3.4, Math.max(1.15, targetRatio));

  // 共振峰压缩（模拟少女更短的声道长度 VTLN）
  const formantRatio = male ? 1.32 : 1.18;
  const psolaRatio = Math.max(1.02, pitchRatio / formantRatio);

  const formed = resampleByRatio(normalized, formantRatio);
  const restored = olaStretch(formed, formantRatio);
  const period = sampleRate / Math.max(70, assumedF0 * formantRatio);
  const pitched = psolaPitchShift(restored, psolaRatio, period);
  applyEdgeFade(pitched, sampleRate, 0.012);
  return { samples: normalizeFloat32(pitched, 0.55), male };
}

export class SakiVoiceEcho {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private playbackSource: AudioBufferSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private recordedSamples = 0;
  private isRecording = false;
  private speechMs = 0;
  private running = false;
  private holdGeneration = 0;
  private state: SakiVoiceEchoState = "idle";
  private workletUrl: string | null = null;
  private onStateChange: ((state: SakiVoiceEchoState) => void) | undefined;

  constructor(options?: { onStateChange?: (state: SakiVoiceEchoState) => void }) {
    this.onStateChange = options?.onStateChange;
  }

  get holding(): boolean {
    return this.isRecording;
  }

  async beginHold(): Promise<boolean> {
    if (this.isRecording) return true;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;

    const generation = ++this.holdGeneration;
    this.stopPlayback();

    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return false;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
      if (generation !== this.holdGeneration) return false;

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });
      if (generation !== this.holdGeneration) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
        return false;
      }

      this.source = this.ctx.createMediaStreamSource(this.stream);
      if (!this.silentGain) {
        this.silentGain = this.ctx.createGain();
        this.silentGain.gain.value = 0;
        this.silentGain.connect(this.ctx.destination);
      }

      const hooked = await this.ensureCapture();
      if (!hooked || generation !== this.holdGeneration) {
        this.releaseMic();
        return false;
      }
      this.connectSourceToCapture();

      this.running = true;
      this.resetCapture();
      this.isRecording = true;
      this.emitState("hearing");
      return true;
    } catch {
      this.releaseMic();
      return false;
    }
  }

  endHold() {
    if (!this.isRecording) return;
    const samples = concatFloat32(this.chunks);
    const speechMs = this.speechMs;
    const recordedSamples = this.recordedSamples;
    const sampleRate = this.ctx?.sampleRate ?? 48000;
    this.isRecording = false;
    this.resetCapture();
    this.releaseMic();

    const longEnough = speechMs >= 180 && recordedSamples > sampleRate * 0.12;
    if (longEnough) void this.speakAsSaki(samples);
    else this.emitState("idle");
  }

  cancelHold() {
    this.holdGeneration += 1;
    this.isRecording = false;
    this.resetCapture();
    this.releaseMic();
    if (this.state === "hearing") this.emitState("idle");
  }

  stop() {
    this.holdGeneration += 1;
    this.running = false;
    this.isRecording = false;
    this.resetCapture();
    this.emitState("idle");
    this.stopPlayback();
    this.releaseMic();

    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {}
      this.processor = null;
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      try {
        this.workletNode.disconnect();
      } catch {}
      this.workletNode = null;
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    try {
      this.silentGain?.disconnect();
    } catch {}
    this.silentGain = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  private stopPlayback() {
    try {
      this.playbackSource?.stop();
    } catch {
      /* already stopped */
    }
    this.playbackSource = null;
  }

  private releaseMic() {
    try {
      this.source?.disconnect();
    } catch {}
    this.source = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private connectSourceToCapture() {
    if (!this.source) return;
    if (this.workletNode) this.source.connect(this.workletNode);
    else if (this.processor) this.source.connect(this.processor);
  }

  private async ensureCapture(): Promise<boolean> {
    if (this.workletNode || this.processor) return true;
    return this.attachCapture();
  }

  private async attachCapture(): Promise<boolean> {
    if (!this.ctx || !this.silentGain) return false;

    if (typeof this.ctx.audioWorklet?.addModule === "function") {
      try {
        const workletCode = `class SakiCaptureProcessor extends AudioWorkletProcessor{process(inputs){const ch=inputs[0]&&inputs[0][0];if(ch&&ch.length){this.port.postMessage(ch.slice())}return true}}registerProcessor("saki-capture",SakiCaptureProcessor);`;
        this.workletUrl = URL.createObjectURL(new Blob([workletCode], { type: "application/javascript" }));
        await this.ctx.audioWorklet.addModule(this.workletUrl);
        this.workletNode = new AudioWorkletNode(this.ctx, "saki-capture");
        this.workletNode.port.onmessage = (event) => {
          const data = event.data;
          if (data instanceof Float32Array) this.ingest(data);
        };
        this.workletNode.connect(this.silentGain);
        return true;
      } catch {
        if (this.workletUrl) {
          URL.revokeObjectURL(this.workletUrl);
          this.workletUrl = null;
        }
        this.workletNode = null;
      }
    }

    const ctxWithProcessor = this.ctx as AudioContext & {
      createScriptProcessor?: (bufferSize: number, numberOfInputChannels: number, numberOfOutputChannels: number) => ScriptProcessorNode;
    };
    const createProcessor = ctxWithProcessor.createScriptProcessor?.bind(this.ctx);
    if (!createProcessor) return false;
    this.processor = createProcessor(2048, 1, 1);
    this.processor.onaudioprocess = (event) => {
      this.ingest(event.inputBuffer.getChannelData(0));
    };
    this.processor.connect(this.silentGain);
    return true;
  }

  private ingest(input: Float32Array) {
    if (!this.isRecording || !this.ctx) return;
    const frame = new Float32Array(input.length);
    frame.set(input);
    this.chunks.push(frame);
    this.recordedSamples += frame.length;
    this.speechMs += (frame.length / this.ctx.sampleRate) * 1000;
    const maxSamples = this.ctx.sampleRate * 8;
    if (this.recordedSamples >= maxSamples) this.endHold();
  }

  private async speakAsSaki(samples: Float32Array) {
    if (!this.ctx || !this.running) {
      this.emitState("idle");
      return;
    }

    const engine = getSakiVoiceEchoEngine();
    let finalSamples: Float32Array;
    const f0 = estimateF0Hz(normalizeFloat32(samples, 0.6), this.ctx.sampleRate);
    const assumedF0 = f0 && f0 >= 65 && f0 <= 380 ? f0 : 130;
    let isMale = assumedF0 < 175;

    if (engine === "ai") {
      try {
        const { sakiVoiceAiManager } = await import("./sakiVoiceAi.js");
        const aiSamples = await sakiVoiceAiManager.convert(samples, this.ctx.sampleRate);
        if (aiSamples && aiSamples.length >= 64) {
          finalSamples = aiSamples;
        } else {
          const converted = toSakiVoice(samples, this.ctx.sampleRate);
          finalSamples = converted.samples;
          isMale = converted.male;
        }
      } catch (err) {
        console.warn("[SakiVoiceEcho] AI engine error, falling back to DSP:", err);
        const converted = toSakiVoice(samples, this.ctx.sampleRate);
        finalSamples = converted.samples;
        isMale = converted.male;
      }
    } else {
      const converted = toSakiVoice(samples, this.ctx.sampleRate);
      finalSamples = converted.samples;
      isMale = converted.male;
    }

    if (finalSamples.length < 64) {
      this.emitState("idle");
      return;
    }

    const buffer = this.ctx.createBuffer(1, finalSamples.length, this.ctx.sampleRate);
    buffer.getChannelData(0).set(finalSamples);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    // 1. 强力低切：切除 160Hz 以下成年胸腔共鸣与风噪
    const highpass = this.ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 160;
    highpass.Q.value = 0.8;

    // 2. 衰减箱体与鼻音浑浊共振（360Hz 陷波）
    const chestDip = this.ctx.createBiquadFilter();
    chestDip.type = "peaking";
    chestDip.frequency.value = 360;
    chestDip.Q.value = 1.2;
    chestDip.gain.value = isMale ? -4.5 : -2.5;

    // 3. Saki F1 第一共振峰增益（1100Hz 元气甜美共鸣）
    const formant1 = this.ctx.createBiquadFilter();
    formant1.type = "peaking";
    formant1.frequency.value = 1100;
    formant1.Q.value = 1.4;
    formant1.gain.value = 3.2;

    // 4. Saki F2 第二共振峰增益（2850Hz 咬字清晰度与清亮感）
    const formant2 = this.ctx.createBiquadFilter();
    formant2.type = "peaking";
    formant2.frequency.value = 2850;
    formant2.Q.value = 1.2;
    formant2.gain.value = 2.8;

    // 5. 空气感与甜美高频（7500Hz 高架滤波）
    const airShelf = this.ctx.createBiquadFilter();
    airShelf.type = "highshelf";
    airShelf.frequency.value = 7500;
    airShelf.gain.value = 1.8;

    // 6. 高频低通滤波：剔除 11500Hz 以上高频电子底噪
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 11500;
    lowpass.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = 1.15;

    src.connect(highpass);
    highpass.connect(chestDip);
    chestDip.connect(formant1);
    formant1.connect(formant2);
    formant2.connect(airShelf);
    airShelf.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(this.ctx.destination);

    this.playbackSource = src;
    this.emitState("speaking");
    src.onended = () => {
      if (this.playbackSource === src) this.playbackSource = null;
      if (this.running && !this.isRecording) this.emitState("idle");
    };
    try {
      src.start();
    } catch {
      this.playbackSource = null;
      this.emitState("idle");
    }
  }

  private resetCapture() {
    this.chunks = [];
    this.recordedSamples = 0;
    this.speechMs = 0;
  }

  private emitState(state: SakiVoiceEchoState) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }
}
