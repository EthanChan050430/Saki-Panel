import { useEffect, useRef, useState } from "react";
import { sakiPetIdleFrames } from "../../constants.js";
import { useSpritePlayhead } from "./SakiSpriteCycle.js";

type FrameBounds = {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const measuredFrames = new Map<string, FrameBounds[]>();
const pendingFrames = new Map<string, Promise<FrameBounds[]>>();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

function measureFrame(src: string): Promise<FrameBounds> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || 720;
      const height = image.naturalHeight || 1280;
      const fallback = { width, height, left: 0, top: 0, right: width, bottom: height };
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          resolve(fallback);
          return;
        }
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, width, height).data;
        let left = width;
        let top = height;
        let right = 0;
        let bottom = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (pixels[(y * width + x) * 4 + 3]! < 24) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + 1);
            bottom = Math.max(bottom, y + 1);
          }
        }
        resolve(right > left && bottom > top ? { width, height, left, top, right, bottom } : fallback);
      } catch {
        resolve(fallback);
      }
    };
    image.onerror = () => resolve({ width: 720, height: 1280, left: 0, top: 0, right: 720, bottom: 1280 });
    image.src = src;
  });
}

function loadBounds(key: string, frames: readonly string[]): Promise<FrameBounds[]> {
  const existing = pendingFrames.get(key);
  if (existing) return existing;
  const pending = Promise.all(frames.map(measureFrame)).then((bounds) => {
    measuredFrames.set(key, bounds);
    pendingFrames.delete(key);
    return bounds;
  });
  pendingFrames.set(key, pending);
  return pending;
}

export function SakiMeasuredSpriteCycle({
  frames,
  intervalMs,
  onFinished
}: {
  frames: readonly string[];
  intervalMs: number;
  onFinished?: (() => void) | undefined;
}) {
  const idleFrame = sakiPetIdleFrames[0] ?? "";
  const key = `${frames.join("|")}|${idleFrame}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const [bounds, setBounds] = useState<FrameBounds[] | null>(() => measuredFrames.get(key) ?? null);
  const [idleBounds, setIdleBounds] = useState<FrameBounds | null>(() => measuredFrames.get(idleFrame)?.[0] ?? null);
  const [stage, setStage] = useState({ width: 86, height: 118 });

  useEffect(() => {
    let active = true;
    setBounds(measuredFrames.get(key) ?? null);
    setIdleBounds(measuredFrames.get(idleFrame)?.[0] ?? null);
    Promise.all([loadBounds(key, frames), loadBounds(idleFrame, [idleFrame])]).then(([next, idle]) => {
      if (!active) return;
      setBounds(next);
      setIdleBounds(idle[0] ?? null);
    });
    return () => { active = false; };
  }, [key, frames, idleFrame]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => setStage({ width: root.clientWidth || 86, height: root.clientHeight || 118 });
    const observer = new ResizeObserver(update);
    observer.observe(root);
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, [key]);

  const ready = Boolean(bounds?.length === frames.length && idleBounds);
  const index = useSpritePlayhead(ready ? frames.length : 1, "once", intervalMs, `${key}:${ready}`, () => {
    if (!ready || holdTimerRef.current !== null) return;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      onFinishedRef.current?.();
    }, 1500);
  });
  const currentIndex = ready ? index : 0;
  const current = frames[currentIndex];
  if (!current) return null;

  let style: React.CSSProperties | undefined;
  if (ready && bounds && idleBounds) {
    const heights = bounds.map((frame) => Math.max(1, frame.bottom - frame.top));
    const standingHeights = heights.length >= 41 ? heights.slice(37, 41) : heights;
    const referenceHeight = Math.max(...standingHeights);
    const idleScale = Math.min(stage.width / idleBounds.width, stage.height / idleBounds.height);
    const targetHeight = Math.min(stage.height * 0.92, (idleBounds.bottom - idleBounds.top) * idleScale * 1.13);
    const frame = bounds[currentIndex]!;
    const nearbyHeight = median(heights.slice(Math.max(0, currentIndex - 2), Math.min(heights.length, currentIndex + 3)));
    const topAnchored = currentIndex === 11 || currentIndex === 12;
    const growsUp = currentIndex >= 27 && currentIndex <= 30;
    const correction = topAnchored || growsUp || currentIndex >= 37
      ? 1
      : Math.max(0.7, Math.min(1.5, nearbyHeight / heights[currentIndex]!));
    const baseScale = targetHeight / referenceHeight;
    const scale = baseScale * correction;
    const centerX = (frame.left + frame.right) / 2;
    const frame12 = bounds[11];
    const topAnchor = frame12 ? stage.height - (frame12.bottom - frame12.top) * baseScale : 0;
    style = {
      left: stage.width / 2 - centerX * scale,
      top: topAnchored ? topAnchor - frame.top * scale : stage.height - frame.bottom * scale,
      right: "auto",
      bottom: "auto",
      width: frame.width * scale,
      height: frame.height * scale,
      objectFit: "fill"
    };
  }

  return (
    <div ref={rootRef} className="saki-character-art compact is-toilet-cycle" aria-hidden="true">
      <img className="saki-character-image saki-toilet-frame" src={current} style={style} alt="" draggable={false} />
    </div>
  );
}
