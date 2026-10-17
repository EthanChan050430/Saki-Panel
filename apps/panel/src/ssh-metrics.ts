import type { NodeMetricSnapshot } from "@webops/shared";
import { connect, readSettings, execSsh } from "./ssh-nodes.js";

const prevCpuSamples = new Map<string, { total: number; idle: number; timestamp: number }>();

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function parseSshProbeOutput(
  nodeId: string,
  raw: string
): {
  metrics: NodeMetricSnapshot;
  os?: string;
  arch?: string;
} {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let cpuUsage = 0;
  let totalMemoryMb: number | undefined;
  let usedMemoryMb: number | undefined;
  let memoryUsage = 0;
  let diskUsage = 0;
  let totalDiskGb: number | undefined;
  let usedDiskGb: number | undefined;
  let uptimeSeconds: number | undefined;
  let loadAverage1m: number | undefined;
  let os: string | undefined;
  let arch: string | undefined;

  let memTotalKb = 0;
  let memAvailableKb = 0;
  let memFreeKb = 0;
  let buffersKb = 0;
  let cachedKb = 0;

  let section = "PROC";

  for (const line of lines) {
    if (line === "---DF---") { section = "DF"; continue; }
    if (line === "---UNAME---") { section = "UNAME"; continue; }

    if (section === "PROC") {
      if (line.startsWith("cpu ")) {
        const parts = line.split(/\s+/).slice(1).map(Number);
        if (parts.length >= 4) {
          const user = parts[0] || 0;
          const nice = parts[1] || 0;
          const system = parts[2] || 0;
          const idle = parts[3] || 0;
          const iowait = parts[4] || 0;
          const irq = parts[5] || 0;
          const softirq = parts[6] || 0;
          const steal = parts[7] || 0;

          const idleTicks = idle + iowait;
          const totalTicks = user + nice + system + idle + iowait + irq + softirq + steal;

          const prev = prevCpuSamples.get(nodeId);
          const now = Date.now();
          if (prev && now - prev.timestamp < 120000 && totalTicks > prev.total) {
            const totalDiff = totalTicks - prev.total;
            const idleDiff = idleTicks - prev.idle;
            cpuUsage = clampPercent((1 - idleDiff / totalDiff) * 100);
          } else if (totalTicks > 0) {
            cpuUsage = clampPercent(((totalTicks - idleTicks) / totalTicks) * 100);
          }
          prevCpuSamples.set(nodeId, { total: totalTicks, idle: idleTicks, timestamp: now });
        }
      } else if (line.startsWith("MemTotal:")) {
        memTotalKb = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
      } else if (line.startsWith("MemAvailable:")) {
        memAvailableKb = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
      } else if (line.startsWith("MemFree:")) {
        memFreeKb = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
      } else if (line.startsWith("Buffers:")) {
        buffersKb = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
      } else if (line.startsWith("Cached:")) {
        cachedKb = parseInt(line.replace(/[^0-9]/g, ""), 10) || 0;
      } else if (/^[0-9]+\.[0-9]+\s+[0-9]+\.[0-9]+/.test(line)) {
        // Uptime output: "12345.67 9876.54"
        const [up] = line.split(/\s+/);
        if (up && !uptimeSeconds) {
          uptimeSeconds = Math.round(parseFloat(up));
        }
      } else if (/^[0-9]+\.[0-9]{2}\s+[0-9]+\.[0-9]{2}/.test(line)) {
        // Load average: "0.25 0.15 0.10 ..."
        const [load1] = line.split(/\s+/);
        if (load1 && loadAverage1m === undefined) {
          loadAverage1m = Math.round(parseFloat(load1) * 100) / 100;
        }
      }
    } else if (section === "DF") {
      // Matches rows like "/dev/sda1 50123 12345 37778 25% /"
      const parts = line.split(/\s+/);
      if (parts.length >= 5 && (parts[parts.length - 1] === "/" || line.includes(" /"))) {
        const totalMb = parseInt(parts[1] || "", 10);
        const usedMb = parseInt(parts[2] || "", 10);
        const pctStr = parts[4]?.replace("%", "");
        if (totalMb > 0) totalDiskGb = Math.round((totalMb / 1024) * 10) / 10;
        if (usedMb >= 0) usedDiskGb = Math.round((usedMb / 1024) * 10) / 10;
        if (pctStr) diskUsage = clampPercent(parseFloat(pctStr));
      }
    } else if (section === "UNAME") {
      if (!os) {
        os = line;
      } else if (!arch) {
        arch = line;
      }
    }
  }

  if (memTotalKb > 0) {
    totalMemoryMb = Math.round(memTotalKb / 1024);
    const availableKb = memAvailableKb > 0 ? memAvailableKb : (memFreeKb + buffersKb + cachedKb);
    const usedKb = Math.max(0, memTotalKb - availableKb);
    usedMemoryMb = Math.round(usedKb / 1024);
    memoryUsage = clampPercent((usedKb / memTotalKb) * 100);
  }

  return {
    metrics: {
      cpuUsage,
      memoryUsage,
      diskUsage,
      totalMemoryMb,
      usedMemoryMb,
      totalDiskGb,
      usedDiskGb,
      uptimeSeconds,
      loadAverage1m,
      createdAt: new Date().toISOString()
    },
    ...(os ? { os } : {}),
    ...(arch ? { arch } : {})
  };
}

export async function probeSshMetrics(id: string): Promise<{
  metrics: NodeMetricSnapshot;
  os?: string;
  arch?: string;
}> {
  const settings = await readSettings(id);
  const { client } = await connect(settings);
  try {
    const probeScript = `sh -c '
cat /proc/stat /proc/meminfo /proc/uptime /proc/loadavg 2>/dev/null
echo "---DF---"
df -m / 2>/dev/null
echo "---UNAME---"
uname -s 2>/dev/null
uname -m 2>/dev/null
'`;
    const raw = await execSsh(client, probeScript, 8000);
    return parseSshProbeOutput(id, raw);
  } finally {
    client.end();
  }
}
