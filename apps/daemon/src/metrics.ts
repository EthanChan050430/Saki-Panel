import os from "node:os";
import si from "systeminformation";
import type { HeartbeatRequest } from "@webops/shared";

function toMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

function toGb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export async function collectMetrics(): Promise<HeartbeatRequest["metrics"]> {
  const [load, memory, disks] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
  const primaryDisk = disks[0];
  // 排除 Linux page cache，用 total-available 计算内存压力
  const available = Number.isFinite(memory.available) ? memory.available : Number.NaN;
  const pressureBytes =
    Number.isFinite(available) && available >= 0 && memory.total > 0
      ? Math.max(0, memory.total - available)
      : memory.used;
  const totalMemoryMb = toMb(memory.total);
  const usedMemoryMb = toMb(pressureBytes);

  return {
    cpuUsage: clampPercent(load.currentLoad),
    memoryUsage: clampPercent(memory.total > 0 ? (pressureBytes / memory.total) * 100 : 0),
    diskUsage: clampPercent(primaryDisk?.use ?? 0),
    totalMemoryMb,
    usedMemoryMb,
    totalDiskGb: primaryDisk ? toGb(primaryDisk.size) : undefined,
    usedDiskGb: primaryDisk ? toGb(primaryDisk.used) : undefined,
    uptimeSeconds: Math.round(os.uptime()),
    loadAverage1m: Math.round((os.loadavg()[0] ?? 0) * 100) / 100
  };
}

