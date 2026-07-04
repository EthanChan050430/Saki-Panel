import type { FastifyInstance } from "fastify";
import type { DashboardOverview } from "@webops/shared";
import { PANEL_VERSION } from "@webops/shared";
import { panelConfig } from "../config.js";
import { prisma } from "../db.js";
import { requirePermission } from "../auth.js";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function lastSeenIsOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false;
  return (Date.now() - lastSeenAt.getTime()) / 1000 <= panelConfig.heartbeatOfflineSeconds;
}

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dashboard/overview", { preHandler: requirePermission("dashboard.view") }, async () => {
    const [nodes, historyMetrics, recentOperations, recentLogins] = await Promise.all([
      prisma.node.findMany({
        include: {
          metrics: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }),
      prisma.nodeMetric.findMany({
        orderBy: { createdAt: "desc" },
        take: 48
      }),
      prisma.operationLog.findMany({
        where: {
          action: {
            not: "auth.login"
          }
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { user: true }
      }),
      prisma.operationLog.findMany({
        where: { action: "auth.login" },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { user: true }
      })
    ]);

    const onlineNodes = nodes.filter((node) => lastSeenIsOnline(node.lastSeenAt));
    const latestMetrics = onlineNodes
      .map((node) => node.metrics[0])
      .filter((metric): metric is NonNullable<typeof metric> => Boolean(metric));

    const overview: DashboardOverview = {
      version: PANEL_VERSION,
      generatedAt: new Date().toISOString(),
      nodes: {
        online: onlineNodes.length,
        offline: Math.max(nodes.length - onlineNodes.length, 0),
        total: nodes.length
      },
      resources: {
        cpuUsage: average(latestMetrics.map((metric) => metric.cpuUsage)),
        memoryUsage: average(latestMetrics.map((metric) => metric.memoryUsage)),
        diskUsage: average(latestMetrics.map((metric) => metric.diskUsage))
      },
      history: historyMetrics
        .slice()
        .reverse()
        .map((metric) => ({
          time: metric.createdAt.toISOString(),
          cpuUsage: metric.cpuUsage,
          memoryUsage: metric.memoryUsage,
          diskUsage: metric.diskUsage
        })),
      recentOperations: recentOperations.map((log) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        result: log.result,
        createdAt: log.createdAt.toISOString(),
        username: log.user?.username ?? null
      })),
      recentLogins: recentLogins.map((log) => ({
        id: log.id,
        username: log.user?.username ?? null,
        result: log.result,
        createdAt: log.createdAt.toISOString(),
        ip: log.ip
      }))
    };

    return overview;
  });
}
