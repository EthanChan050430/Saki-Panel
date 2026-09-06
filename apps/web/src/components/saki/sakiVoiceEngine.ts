export type SakiVoiceEchoEngineType = "dsp" | "ai";

const STORAGE_KEY = "saki_voice_echo_engine";
const CHANGE_EVENT = "saki-voice-engine-changed";

export function getSakiVoiceEchoEngine(): SakiVoiceEchoEngineType {
  if (typeof window === "undefined" || !window.localStorage) return "dsp";
  const val = window.localStorage.getItem(STORAGE_KEY);
  return val === "ai" ? "ai" : "dsp";
}

export function setSakiVoiceEchoEngine(engine: SakiVoiceEchoEngineType): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_KEY, engine);
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: engine }));
  } catch {}
}

export function subscribeSakiVoiceEchoEngine(callback: (engine: SakiVoiceEchoEngineType) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<SakiVoiceEchoEngineType>).detail;
    if (detail === "dsp" || detail === "ai") {
      callback(detail);
    }
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
  };
}

export interface WebGPUDetectionResult {
  supported: boolean;
  adapterName?: string;
  reason?: string;
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter?: () => Promise<{
      requestAdapterInfo?: () => Promise<{ description?: string; device?: string }>;
      info?: { description?: string };
    } | null>;
  };
}

export async function checkWebGPUSupport(): Promise<WebGPUDetectionResult> {
  if (typeof navigator === "undefined") {
    return { supported: false, reason: "非浏览器环境" };
  }
  const nav = navigator as unknown as NavigatorWithGpu;
  if (!nav.gpu || typeof nav.gpu.requestAdapter !== "function") {
    return { supported: false, reason: "当前浏览器环境未启用或不支持 WebGPU (建议使用 Chrome/Edge/Firefox 最新版本)" };
  }
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: "未检测到可用的 GPU 硬件加速设备" };
    }
    const info = (await adapter.requestAdapterInfo?.()) ?? undefined;
    const adapterName = info?.description || info?.device || adapter.info?.description || "默认 WebGPU 适配器";
    return { supported: true, adapterName };
  } catch (err) {
    return { supported: false, reason: err instanceof Error ? err.message : "WebGPU 探测失败" };
  }
}
