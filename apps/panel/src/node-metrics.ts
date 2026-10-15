import type { NodeMetric } from "@prisma/client";
import { prisma } from "./db.js";

export async function withLatestNodeMetrics<T extends { id: string }>(nodes: T[]): Promise<Array<T & { metrics: NodeMetric[] }>> {
  const latest = new Map<string, NodeMetric>();
  const ids = [...new Set(nodes.map(node => node.id))];
  // Prisma's nested relation take can load all matching SQLite rows before
  // trimming per parent. Separate findFirst queries use the existing
  // (nodeId, createdAt) index and a database LIMIT 1 even with years of history.
  for (let offset = 0; offset < ids.length; offset += 6) {
    await Promise.all(ids.slice(offset, offset + 6).map(async nodeId => {
      const metric = await prisma.nodeMetric.findFirst({
        where: { nodeId },
        orderBy: { createdAt: "desc" }
      });
      if (metric) latest.set(nodeId, metric);
    }));
  }
  return nodes.map(node => ({ ...node, metrics: latest.has(node.id) ? [latest.get(node.id)!] : [] }));
}
