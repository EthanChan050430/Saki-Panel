import React, { useEffect, useRef, useState } from "react";

export type SpritePlayMode = "once" | "pingpong";

export function useSpritePlayhead(
  count: number,
  mode: SpritePlayMode,
  intervalMs: number,
  resetKey: string,
  onComplete?: () => void
) {
  const [index, setIndex] = useState(0);
  const dirRef = useRef(1);
  const intervalRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const finishedRef = useRef(false);

  useEffect(() => {
    setIndex(0);
    dirRef.current = 1;
    finishedRef.current = false;
    if (count <= 1) {
      const timer = window.setTimeout(() => onCompleteRef.current?.(), intervalMs);
      return () => window.clearTimeout(timer);
    }
    const id = window.setInterval(() => {
      setIndex((current) => {
        if (mode === "once") {
          if (current >= count - 1) return current;
          return current + 1;
        }
        const next = current + dirRef.current;
        if (next >= count - 1) {
          dirRef.current = -1;
          return count - 1;
        }
        if (next <= 0) {
          dirRef.current = 1;
          return 0;
        }
        return next;
      });
    }, intervalMs);
    intervalRef.current = id;
    return () => {
      window.clearInterval(id);
      if (intervalRef.current === id) intervalRef.current = null;
    };
  }, [count, mode, intervalMs, resetKey]);

  useEffect(() => {
    if (mode !== "once" || finishedRef.current) return;
    if (count <= 1 || index < count - 1) return;
    finishedRef.current = true;
    // once 模式到达末帧后停止主 interval，避免空转
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const timer = window.setTimeout(() => onCompleteRef.current?.(), intervalMs);
    return () => window.clearTimeout(timer);
  }, [mode, index, count, intervalMs]);

  return index;
}

export function SakiSpriteCycle({
  frames,
  mode,
  intervalMs,
  compact = false,
  onComplete
}: {
  frames: readonly string[];
  mode: SpritePlayMode;
  intervalMs: number;
  compact?: boolean | undefined;
  onComplete?: (() => void) | undefined;
}) {
  const index = useSpritePlayhead(frames.length, mode, intervalMs, frames.join("|"), onComplete);
  const [shown, setShown] = useState(0);
  const [outgoing, setOutgoing] = useState<string | null>(null);

  useEffect(() => {
    setShown(0);
    setOutgoing(null);
  }, [frames]);

  useEffect(() => {
    if (index === shown) return;
    const previous = frames[shown];
    setOutgoing(previous ?? null);
    setShown(index);
    const timer = window.setTimeout(() => setOutgoing(null), 340);
    return () => window.clearTimeout(timer);
  }, [index, frames, shown]);

  const current = frames[shown] ?? frames[0];
  if (!current) return null;

  return (
    <span className={`saki-sprite-cycle ${compact ? "is-compact" : ""}`}>
      <img className="saki-sprite-layer is-current saki-character-image" src={current} alt="" draggable={false} />
      {outgoing ? (
        <img className="saki-sprite-layer is-outgoing saki-character-image" src={outgoing} alt="" draggable={false} />
      ) : null}
    </span>
  );
}
