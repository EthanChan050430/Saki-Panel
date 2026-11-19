export function createVideoCallQuality(options: {
  compact: boolean;
  cores: number;
  memory: number;
  saveData: boolean;
  downlink: number;
  rtt: number;
}): {
  sample(time: number): "full" | "balanced" | "lite";
  reset(): void;
  readonly interval: number;
  readonly compactAssets: boolean;
};
