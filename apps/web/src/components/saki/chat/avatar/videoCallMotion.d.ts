import type { SakiTouchRegion } from "./videoCallPointer.js";

export type SakiAvatarPhase = "idle" | "listening" | "thinking" | "speaking";
export type SakiPresentationTarget = -1 | 0 | 1 | "center";

export function createVideoCallMotion(): {
  command(text: string): string | null;
  touch(region: SakiTouchRegion, side: -1 | 1): void;
  pointerLook(x: number, y: number): void;
  releasePointer(cancelled?: boolean): void;
  react(text: string): void;
  present(target: SakiPresentationTarget): void;
  loadWalkProfiles(profiles: unknown): void;
  loadReactionClips(durations: unknown): void;
  tick(time: number, state: {
    phase: SakiAvatarPhase;
    turnId?: string | undefined;
    voice: number;
    articulation: number;
    heard: boolean;
  }): { presented: boolean };
};
