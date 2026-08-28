const perfLiteClass = "perf-lite";
const perfFullClass = "perf-full";

type PerfListener = (lite: boolean) => void;
const listeners = new Set<PerfListener>();
let fpsWatchStarted = false;

function connectionSaveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

function setPerfClass(lite: boolean): void {
  const root = document.documentElement;
  root.classList.toggle(perfLiteClass, lite);
  root.classList.toggle(perfFullClass, !lite);
  for (const listener of listeners) listener(lite);
}

export function onPerformanceModeChange(listener: PerfListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPerfLite(): boolean {
  return document.documentElement.classList.contains(perfLiteClass);
}

/** Only treat a device as weak when the signal is unambiguous. Phones are not weak by default. */
export function shouldUseLitePerformance(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    if (connectionSaveData()) return true;
    const cores = navigator.hardwareConcurrency;
    if (typeof cores === "number" && cores > 0 && cores <= 2) return true;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (typeof memory === "number" && memory > 0 && memory <= 2) return true;
    return false;
  } catch {
    return false;
  }
}

export function applyPerformanceMode(): boolean {
  const lite = shouldUseLitePerformance();
  setPerfClass(lite);
  if (!lite) startMainThreadFpsWatch();
  return lite;
}

function startMainThreadFpsWatch(): void {
  if (fpsWatchStarted || typeof window === "undefined") return;
  fpsWatchStarted = true;

  let frames = 0;
  let windowStart = 0;
  let visibleElapsed = 0;
  const samples: number[] = [];
  const sampleEveryMs = 500;
  const measureForMs = 4000;
  const minSamples = 4;
  const dropBelowFps = 45;

  const tick = (now: number) => {
    if (isPerfLite()) return;
    if (document.hidden) {
      frames = 0;
      windowStart = 0;
      requestAnimationFrame(tick);
      return;
    }
    if (!windowStart) {
      windowStart = now;
      frames = 0;
      requestAnimationFrame(tick);
      return;
    }
    frames += 1;
    const dt = now - windowStart;
    if (dt >= sampleEveryMs) {
      samples.push((frames * 1000) / dt);
      visibleElapsed += dt;
      frames = 0;
      windowStart = now;
    }
    if (visibleElapsed < measureForMs || samples.length < minSamples) {
      requestAnimationFrame(tick);
      return;
    }
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    if (average > 0 && average < dropBelowFps) {
      setPerfClass(true);
    }
  };

  requestAnimationFrame(tick);
}
