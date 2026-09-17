import type { FastifyBaseLogger } from "fastify";
import type { DaemonInstanceSnapshot } from "@webops/shared";
import { prisma } from "./db.js";
import { panelConfig } from "./config.js";
import {
  applyDaemonRestartLeases,
  fetchDaemonStatus,
  readDaemonInstanceStatus,
  testDaemonHealth,
  type DaemonNodeCredentials,
  type FetchDaemonStatusResult
} from "./daemon-client.js";
import { globalEventBus } from "./global-events.js";
import { hasRecentDaemonHeartbeat, ingestHeartbeatSnapshots } from "./watch/events.js";

export interface NodeProbeResult {
  nodeId: string;
  ok: boolean;
  status: "ONLINE" | "OFFLINE";
  error?: string;
  effectiveProtocol?: "http" | "https";
}

const watchIngestInFlight = new Set<string>();

function probeCredentials(
  node: DaemonNodeCredentials,
  status: FetchDaemonStatusResult
): DaemonNodeCredentials {
  return {
    ...node,
    protocol: status.effectiveProtocol || node.protocol,
    host: status.effectiveHost || node.host
  };
}

async function pullInstanceSnapshots(node: DaemonNodeCredentials): Promise<DaemonInstanceSnapshot[]> {
  const rows = await prisma.instance.findMany({ where: { nodeId: node.id }, select: { id: true } });
  if (rows.length === 0) return [];
  const snapshots: DaemonInstanceSnapshot[] = [];
  const concurrency = 6;
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((row) => readDaemonInstanceStatus(node, row.id, 1500))
    );
    for (let j = 0; j < results.length; j += 1) {
      const result = results[j];
      const row = batch[j];
      if (!row || result?.status !== "fulfilled") continue;
      snapshots.push({
        instanceId: row.id,
        status: result.value.status,
        exitCode: result.value.exitCode ?? null
      });
    }
  }
  return snapshots;
}

async function ingestPulledWatchState(
  node: DaemonNodeCredentials,
  status: FetchDaemonStatusResult
): Promise<void> {
  const heartbeatFreshMs = Math.max(30_000, panelConfig.daemonHeartbeatSeconds * 3000);
  if (hasRecentDaemonHeartbeat(node.id, heartbeatFreshMs)) return;

  const creds = probeCredentials(node, status);
  const snapshots = status.instances ?? (await pullInstanceSnapshots(creds));
  const metrics = status.metrics;

  if (metrics) {
    await prisma.nodeMetric.create({
      data: {
        nodeId: node.id,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        diskUsage: metrics.diskUsage,
        totalMemoryMb: metrics.totalMemoryMb ?? null,
        usedMemoryMb: metrics.usedMemoryMb ?? null,
        totalDiskGb: metrics.totalDiskGb ?? null,
        usedDiskGb: metrics.usedDiskGb ?? null,
        uptimeSeconds: metrics.uptimeSeconds ?? null,
        loadAverage1m: metrics.loadAverage1m ?? null
      }
    }).catch(() => undefined);
  }

  const leases = await ingestHeartbeatSnapshots(
    node.id,
    snapshots,
    metrics ? { diskUsage: metrics.diskUsage, memoryUsage: metrics.memoryUsage } : undefined
  );
  if (leases.length > 0) {
    await applyDaemonRestartLeases(creds, leases).catch(() => undefined);
  }
}

function scheduleWatchIngest(nodeId: string, task: () => Promise<void>): void {
  if (watchIngestInFlight.has(nodeId)) return;
  watchIngestInFlight.add(nodeId);
  void task()
    .catch((error) => {
      console.warn(
        "pulled watch ingest failed:",
        error instanceof Error ? error.message : error
      );
    })
    .finally(() => {
      watchIngestInFlight.delete(nodeId);
    });
}

/**
 * Probe a single node's health and update its status / lastSeenAt in the database.
 */
export async function probeAndSyncNode(
  node: {
    id: string;
    name: string;
    host: string;
    port: number;
    protocol: string;
    tokenHash: string;
    status: "UNKNOWN" | "ONLINE" | "OFFLINE";
    lastSeenAt: Date | null;
    os?: string | null;
    arch?: string | null;
    version?: string | null;
  },
  timeoutMs = 3000
): Promise<NodeProbeResult> {
  const creds: DaemonNodeCredentials = {
    id: node.id,
    protocol: node.protocol,
    host: node.host,
    port: node.port,
    tokenHash: node.tokenHash,
    os: node.os
  };

  try {
    const statusResult = await fetchDaemonStatus(creds, timeoutMs);
    if (statusResult.ok) {
      const now = new Date();
      const updatedData: Record<string, unknown> = {
        status: "ONLINE",
        lastSeenAt: now
      };

      if (statusResult.effectiveProtocol && statusResult.effectiveProtocol !== node.protocol) {
        updatedData.protocol = statusResult.effectiveProtocol;
      }
      if (statusResult.statusData) {
        if (statusResult.statusData.os && !node.os) updatedData.os = statusResult.statusData.os;
        if (statusResult.statusData.arch && !node.arch) updatedData.arch = statusResult.statusData.arch;
        if (statusResult.statusData.version && !node.version) updatedData.version = statusResult.statusData.version;
      }

      await prisma.node.update({
        where: { id: node.id },
        data: updatedData
      });

      // Broadcast if node status changed to ONLINE
      if (node.status !== "ONLINE") {
        globalEventBus.broadcast("node.status_changed", {
          nodeId: node.id,
          status: "ONLINE",
          lastSeenAt: now.toISOString()
        });
      }

      scheduleWatchIngest(node.id, () => ingestPulledWatchState(creds, statusResult));

      return {
        nodeId: node.id,
        ok: true,
        status: "ONLINE",
        effectiveProtocol: statusResult.effectiveProtocol
      };
    }

    // Fallback to testDaemonHealth (/health endpoint)
    const healthResult = await testDaemonHealth(creds, timeoutMs);
    if (healthResult.ok) {
      const now = new Date();
      await prisma.node.update({
        where: { id: node.id },
        data: {
          status: "ONLINE",
          lastSeenAt: now
        }
      });

      if (node.status !== "ONLINE") {
        globalEventBus.broadcast("node.status_changed", {
          nodeId: node.id,
          status: "ONLINE",
          lastSeenAt: now.toISOString()
        });
      }

      return {
        nodeId: node.id,
        ok: true,
        status: "ONLINE"
      };
    }

    // Health check failed
    const ageSeconds = node.lastSeenAt ? (Date.now() - node.lastSeenAt.getTime()) / 1000 : Infinity;
    const shouldMarkOffline = ageSeconds > panelConfig.heartbeatOfflineSeconds;

    if (shouldMarkOffline && node.status !== "OFFLINE") {
      await prisma.node.update({
        where: { id: node.id },
        data: { status: "OFFLINE" }
      });

      globalEventBus.broadcast("node.status_changed", {
        nodeId: node.id,
        status: "OFFLINE",
        lastSeenAt: node.lastSeenAt?.toISOString() ?? null
      });
    }

    return {
      nodeId: node.id,
      ok: false,
      status: shouldMarkOffline ? "OFFLINE" : (node.status === "ONLINE" ? "ONLINE" : "OFFLINE"),
      error: healthResult.error || statusResult.error || "Connection failed"
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const ageSeconds = node.lastSeenAt ? (Date.now() - node.lastSeenAt.getTime()) / 1000 : Infinity;
    const shouldMarkOffline = ageSeconds > panelConfig.heartbeatOfflineSeconds;

    if (shouldMarkOffline && node.status !== "OFFLINE") {
      await prisma.node.update({
        where: { id: node.id },
        data: { status: "OFFLINE" }
      }).catch(() => {});

      globalEventBus.broadcast("node.status_changed", {
        nodeId: node.id,
        status: "OFFLINE",
        lastSeenAt: node.lastSeenAt?.toISOString() ?? null
      });
    }

    return {
      nodeId: node.id,
      ok: false,
      status: shouldMarkOffline ? "OFFLINE" : (node.status === "ONLINE" ? "ONLINE" : "OFFLINE"),
      error: errorMsg
    };
  }
}

/**
 * Probes all nodes currently registered in the database.
 */
export async function syncAllNodesHealth(logger?: FastifyBaseLogger): Promise<void> {
  try {
    const nodes = await prisma.node.findMany({
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        protocol: true,
        tokenHash: true,
        status: true,
        lastSeenAt: true,
        os: true,
        arch: true,
        version: true
      }
    });

    if (nodes.length === 0) return;

    await Promise.allSettled(nodes.map((node) => probeAndSyncNode(node, 2500)));
  } catch (error) {
    logger?.warn({ err: error }, "Failed to run syncAllNodesHealth loop");
  }
}

/**
 * On-demand check for nodes that appear offline or haven't been seen in over 15s.
 * Used by GET /api/nodes and GET /api/dashboard/overview.
 */
export async function ensureNodesFresh<T extends {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  tokenHash: string;
  status: "UNKNOWN" | "ONLINE" | "OFFLINE";
  lastSeenAt: Date | null;
  os?: string | null;
  arch?: string | null;
  version?: string | null;
}>(nodes: T[]): Promise<void> {
  const now = Date.now();
  const staleThresholdMs = 15_000;

  const staleNodes = nodes.filter((node) => {
    if (!node.lastSeenAt) return true;
    if (node.status === "OFFLINE" || node.status === "UNKNOWN") return true;
    return now - node.lastSeenAt.getTime() > staleThresholdMs;
  });

  if (staleNodes.length === 0) return;

  // Run quick parallel probe (timeout 1800ms) so users don't wait long
  await Promise.allSettled(staleNodes.map((node) => probeAndSyncNode(node, 1800)));
}

/**
 * Starts background node health monitoring timer.
 */
export function startNodeHealthMonitor(logger: FastifyBaseLogger): () => void {
  const intervalSeconds = 15;
  let active = true;

  // Initial immediate probe shortly after startup
  const startupTimer = setTimeout(() => {
    if (!active) return;
    void syncAllNodesHealth(logger);
  }, 1500);

  const loopInterval = setInterval(() => {
    if (!active) return;
    void syncAllNodesHealth(logger);
  }, intervalSeconds * 1000);

  return () => {
    active = false;
    clearTimeout(startupTimer);
    clearInterval(loopInterval);
  };
}
