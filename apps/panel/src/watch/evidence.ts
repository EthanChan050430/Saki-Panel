import type { ManagedIncident, WatchEvidence } from "@webops/shared";
import { prisma } from "../db.js";
import { readDaemonInstanceLogs } from "../daemon-client.js";
import { truncateLogTail } from "./incidents.js";

export async function collectWatchEvidence(incident: ManagedIncident): Promise<WatchEvidence> {
  const notes: string[] = [];
  const evidence: WatchEvidence = {
    collectedAt: new Date().toISOString()
  };

    try {
    const instance = await prisma.instance.findUnique({
      where: { id: incident.instanceId },
      include: { node: true }
    });
    if (!instance) {
      evidence.logTail = incident.logTail;
      notes.push("实例已不存在，使用事件上保存的日志。");
    } else {
      const logs = await readDaemonInstanceLogs(instance.node, instance.id, 200);
      evidence.logTail = truncateLogTail(logs.lines.map((line) => `[${line.stream}] ${line.text}`).join("\n"));
    }
  } catch (error) {
    evidence.logTail = incident.logTail;
    notes.push(`实时日志拉取失败（${error instanceof Error ? error.message : String(error)}），使用事件上保存的日志。`);
  }

    try {
    const history = await prisma.incident.findMany({
      where: { instanceId: incident.instanceId },
      orderBy: { lastOccurredAt: "desc" },
      take: 10,
      select: { lastOccurredAt: true, exitCode: true, status: true }
    });
    evidence.crashHistory = history.map((row) => ({
      at: row.lastOccurredAt.toISOString(),
      exitCode: row.exitCode,
      status: row.status
    }));
  } catch (error) {
    notes.push(`崩溃历史查询失败：${error instanceof Error ? error.message : String(error)}`);
  }

    try {
    const metric = await prisma.nodeMetric.findFirst({
      where: { nodeId: incident.nodeId },
      orderBy: { createdAt: "desc" }
    });
    if (metric) {
      evidence.nodeMetrics = {
        cpuPercent: metric.cpuUsage,
        memoryPercent: metric.memoryUsage,
        diskPercent: metric.diskUsage
      };
    } else {
      notes.push("节点暂无资源指标上报。");
    }
  } catch (error) {
    notes.push(`节点资源指标查询失败：${error instanceof Error ? error.message : String(error)}`);
  }

    try {
    const logs = await prisma.operationLog.findMany({
      where: { resourceType: "instance", resourceId: incident.instanceId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { createdAt: true, action: true, result: true, userId: true }
    });
    evidence.recentChanges = logs.map(
      (row) => `${row.createdAt.toISOString()} ${row.action} (${row.result}) by ${row.userId ?? "system"}`
    );
  } catch (error) {
    notes.push(`最近变更查询失败：${error instanceof Error ? error.message : String(error)}`);
  }

  if (notes.length > 0) evidence.notes = notes;

  try {
    await prisma.incident.update({
      where: { id: incident.id },
      data: { evidenceJson: JSON.stringify(evidence) }
    });
  } catch (error) {
    console.error("watch evidence persist failed:", error instanceof Error ? error.stack ?? error.message : error);
  }

  return evidence;
}

export function formatWatchEvidenceSection(evidence: WatchEvidence, recurrenceCount: number): string {
  const lines: string[] = ["[EVIDENCE]"];
  if (evidence.crashHistory && evidence.crashHistory.length > 0) {
    lines.push(`崩溃历史（最近 ${evidence.crashHistory.length} 次）:`);
    for (const item of evidence.crashHistory) {
      lines.push(`- ${item.at} exitCode=${item.exitCode ?? "unknown"} status=${item.status}`);
    }
  }
  if (evidence.nodeMetrics) {
    const metrics = evidence.nodeMetrics;
    lines.push(
      `节点资源: cpu ${metrics.cpuPercent ?? "?"}% / 内存 ${metrics.memoryPercent ?? "?"}% / 磁盘 ${metrics.diskPercent ?? "?"}%`
    );
  }
  if (evidence.recentChanges && evidence.recentChanges.length > 0) {
    lines.push("最近变更:");
    for (const change of evidence.recentChanges) {
      lines.push(`- ${change}`);
    }
  }
  if (evidence.notes && evidence.notes.length > 0) {
    lines.push(`证据采集备注: ${evidence.notes.join("；")}`);
  }
  if (recurrenceCount > 0) {
    lines.push(
      `此指纹历史上已出现 ${recurrenceCount} 次。复发问题通常意味着此前的修复只治标不治本，请优先排查根因而不是重复表面修复。`
    );
  }
  return lines.join("\n");
}
