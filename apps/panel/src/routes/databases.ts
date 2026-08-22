import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateDatabaseVisualizerRequest,
  DatabaseCreateTableRequest,
  DatabaseDeleteRowRequest,
  DatabaseEngine,
  DatabaseExportRequest,
  DatabaseImportRequest,
  DatabaseInsertRowRequest,
  DatabaseQueryResult,
  DatabaseRowsRequest,
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseTruncateTableRequest,
  DatabaseUpdateRowRequest,
  DatabaseVisualizerConfig,
  DatabaseVisualizerInstance,
  DiscoveredDatabase,
  UpdateDatabaseVisualizerRequest
} from "@webops/shared";
import { requirePermission } from "../auth.js";
import { prisma } from "../db.js";
import { writeAuditLog } from "../audit.js";
import { panelConfig } from "../config.js";
import {
  createDaemonDatabaseTable,
  deleteDaemonDatabaseTableRow,
  discoverDaemonDatabases,
  dropDaemonDatabaseTable,
  executeDaemonDatabaseQuery,
  exportDaemonDatabaseData,
  getDaemonDatabaseTableSchema,
  importDaemonDatabaseData,
  insertDaemonDatabaseTableRow,
  listDaemonDatabaseTables,
  queryDaemonDatabaseTableRows,
  requestDaemon,
  truncateDaemonDatabaseTable,
  updateDaemonDatabaseTableRow,
  type DaemonNodeCredentials
} from "../daemon-client.js";

const dbVisualizersFile = path.resolve(process.cwd(), "data", "panel", "database-visualizers.json");

async function ensureStore(): Promise<void> {
  const dir = path.dirname(dbVisualizersFile);
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  if (!fsSync.existsSync(dbVisualizersFile)) {
    const initial: DatabaseVisualizerInstance[] = [];
    const devDbPath = path.resolve(process.cwd(), "data", "panel", "dev.db");
    if (fsSync.existsSync(devDbPath)) {
      initial.push({
        id: randomUUID(),
        nodeId: "local",
        nodeName: "Local Panel Node",
        name: "WebOps 系统数据库 (dev.db)",
        engine: "sqlite",
        description: "Panel 核心 SQLite 数据库存储 (用户、权限、节点、审计日志与实例配置)",
        config: {
          path: devDbPath,
          isReadOnly: false
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    await fs.writeFile(dbVisualizersFile, JSON.stringify(initial, null, 2), "utf8");
  }
}

async function readVisualizers(): Promise<DatabaseVisualizerInstance[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(dbVisualizersFile, "utf8");
    return JSON.parse(raw) as DatabaseVisualizerInstance[];
  } catch {
    return [];
  }
}

async function writeVisualizers(items: DatabaseVisualizerInstance[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(dbVisualizersFile, JSON.stringify(items, null, 2), "utf8");
}

async function resolveNodeCredentials(nodeId: string): Promise<DaemonNodeCredentials | null> {
  if (nodeId === "local" || nodeId === "panel") {
    // Return first active online node, or local daemon default
    const online = await prisma.node.findFirst({
      where: { status: "ONLINE" },
      orderBy: { updatedAt: "desc" }
    });
    if (online) {
      return {
        id: online.id,
        protocol: online.protocol,
        host: online.host,
        port: online.port,
        tokenHash: online.tokenHash,
        os: online.os
      };
    }
    const anyNode = await prisma.node.findFirst({ orderBy: { createdAt: "asc" } });
    if (anyNode) {
      return {
        id: anyNode.id,
        protocol: anyNode.protocol,
        host: anyNode.host,
        port: anyNode.port,
        tokenHash: anyNode.tokenHash,
        os: anyNode.os
      };
    }
    return null;
  }

  const node = await prisma.node.findUnique({ where: { id: nodeId } });
  if (!node) return null;
  return {
    id: node.id,
    protocol: node.protocol,
    host: node.host,
    port: node.port,
    tokenHash: node.tokenHash,
    os: node.os
  };
}

export async function registerDatabaseRoutes(app: FastifyInstance): Promise<void> {
  // 1. List all database visualizer instances
  app.get("/api/databases", { preHandler: requirePermission("instance.view") }, async () => {
    const items = await readVisualizers();
    const nodes = await prisma.node.findMany({ select: { id: true, name: true } });
    const nodeMap = new Map(nodes.map((n) => [n.id, n.name]));

    const enriched = items.map((item) => ({
      ...item,
      nodeName: nodeMap.get(item.nodeId) ?? (item.nodeId === "local" ? "本地节点" : item.nodeName ?? item.nodeId)
    }));

    return { ok: true, databases: enriched };
  });

  // 2. Discover databases across nodes
  app.get("/api/databases/discover", { preHandler: requirePermission("instance.view") }, async (request) => {
    const query = request.query as { nodeId?: string };
    const allDiscovered: Array<DiscoveredDatabase & { nodeId: string; nodeName: string }> = [];

    const nodes = await prisma.node.findMany({
      where: query.nodeId ? { id: query.nodeId } : {}
    });

    for (const node of nodes) {
      const creds: DaemonNodeCredentials = {
        id: node.id,
        protocol: node.protocol,
        host: node.host,
        port: node.port,
        tokenHash: node.tokenHash,
        os: node.os
      };
      try {
        const res = await discoverDaemonDatabases(creds);
        if (res.databases) {
          for (const db of res.databases) {
            allDiscovered.push({
              ...db,
              nodeId: node.id,
              nodeName: node.name
            });
          }
        }
      } catch (err) {
        request.log.warn(`Failed to discover databases on node ${node.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Also check panel's dev.db
    const devDbPath = path.resolve(process.cwd(), "data", "panel", "dev.db");
    if (fsSync.existsSync(devDbPath)) {
      const stats = fsSync.statSync(devDbPath);
      const existsInList = allDiscovered.some((d) => d.path === devDbPath);
      if (!existsInList) {
        allDiscovered.unshift({
          engine: "sqlite",
          name: "dev.db (Panel 系统存储)",
          path: devDbPath,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          source: "Panel 核心数据库",
          status: "ready",
          isSystem: true,
          nodeId: nodes[0]?.id ?? "local",
          nodeName: nodes[0]?.name ?? "本地节点"
        });
      }
    }

    return { ok: true, databases: allDiscovered };
  });

  // 3. Create a new database visualizer instance
  app.post("/api/databases", { preHandler: requirePermission("instance.create") }, async (request, reply) => {
    const body = request.body as CreateDatabaseVisualizerRequest;
    if (!body.name?.trim() || !body.nodeId) {
      reply.code(400).send({ message: "名称和节点ID为必填项" });
      return;
    }

    const node = await prisma.node.findUnique({ where: { id: body.nodeId } });
    const nodeName = node?.name ?? (body.nodeId === "local" ? "本地节点" : body.nodeId);

    const newInstance: DatabaseVisualizerInstance = {
      id: randomUUID(),
      nodeId: body.nodeId,
      nodeName,
      name: body.name.trim(),
      engine: body.engine ?? "sqlite",
      description: body.description?.trim() || undefined,
      config: body.config || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const current = await readVisualizers();
    current.unshift(newInstance);
    await writeVisualizers(current);

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.create",
      resourceType: "database_visualizer",
      resourceId: newInstance.id,
      payload: { name: newInstance.name, engine: newInstance.engine, nodeId: newInstance.nodeId },
      result: "SUCCESS"
    });

    return { ok: true, database: newInstance };
  });

  // 4. Update database visualizer instance
  app.put("/api/databases/:id", { preHandler: requirePermission("instance.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as UpdateDatabaseVisualizerRequest;
    const current = await readVisualizers();
    const index = current.findIndex((item) => item.id === id);
    if (index === -1) {
      reply.code(404).send({ message: "未找到指定的数据库可视化实例" });
      return;
    }

    const target = current[index]!;
    let nodeName = target.nodeName;
    if (body.nodeId && body.nodeId !== target.nodeId) {
      const node = await prisma.node.findUnique({ where: { id: body.nodeId } });
      nodeName = node?.name ?? body.nodeId;
    }

    const updated: DatabaseVisualizerInstance = {
      ...target,
      name: body.name?.trim() || target.name,
      nodeId: body.nodeId || target.nodeId,
      nodeName,
      engine: body.engine || target.engine,
      description: body.description !== undefined ? (body.description ? body.description.trim() : null) : target.description,
      config: body.config ? { ...target.config, ...body.config } : target.config,
      updatedAt: new Date().toISOString()
    };

    current[index] = updated;
    await writeVisualizers(current);

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.update",
      resourceType: "database_visualizer",
      resourceId: id,
      payload: { name: updated.name, engine: updated.engine },
      result: "SUCCESS"
    });

    return { ok: true, database: updated };
  });

  // 5. Delete database visualizer instance
  app.delete("/api/databases/:id", { preHandler: requirePermission("instance.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await readVisualizers();
    const filtered = current.filter((item) => item.id !== id);
    if (filtered.length === current.length) {
      reply.code(404).send({ message: "未找到指定的数据库可视化实例" });
      return;
    }

    await writeVisualizers(filtered);

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.delete",
      resourceType: "database_visualizer",
      resourceId: id,
      result: "SUCCESS"
    });

    return { ok: true, deleted: true };
  });

  // Helper to load instance and resolve node credentials
  async function loadInstanceAndNode(id: string) {
    const current = await readVisualizers();
    const inst = current.find((item) => item.id === id);
    if (!inst) throw new Error("数据库可视化实例不存在");
    const creds = await resolveNodeCredentials(inst.nodeId);
    if (!creds) throw new Error(`未找到节点连接凭证 (nodeId: ${inst.nodeId})`);
    return { inst, creds };
  }

  // Helper to build full connection payload for daemon (works for both SQLite and MySQL)
  function buildConnectionPayload(inst: DatabaseVisualizerInstance) {
    return {
      path: inst.config.path,
      host: inst.config.host,
      port: inst.config.port,
      user: inst.config.user,
      password: inst.config.password,
      database: inst.config.database,
      engine: inst.engine
    };
  }

  // 6. List tables
  app.post("/api/databases/:id/tables", { preHandler: requirePermission("instance.view") }, async (request) => {
    const { id } = request.params as { id: string };
    const { inst, creds } = await loadInstanceAndNode(id);
    return listDaemonDatabaseTables(creds, buildConnectionPayload(inst));
  });

  // 7. Get table schema
  app.post("/api/databases/:id/tables/schema", { preHandler: requirePermission("instance.view") }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { tableName: string };
    const { inst, creds } = await loadInstanceAndNode(id);
    return getDaemonDatabaseTableSchema(creds, {
      ...buildConnectionPayload(inst),
      tableName: body.tableName
    });
  });

  // 8. Query table rows
  app.post("/api/databases/:id/tables/rows", { preHandler: requirePermission("instance.view") }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseRowsRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    return queryDaemonDatabaseTableRows(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
  });

  // 9. Insert row
  app.post("/api/databases/:id/tables/insert", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseInsertRowRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await insertDaemonDatabaseTableRow(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.insert_row",
      resourceType: "database_table",
      resourceId: `${id}/${body.tableName}`,
      payload: { row: body.row },
      result: "SUCCESS"
    });
    return result;
  });

  // 10. Update row
  app.post("/api/databases/:id/tables/update", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseUpdateRowRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await updateDaemonDatabaseTableRow(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.update_row",
      resourceType: "database_table",
      resourceId: `${id}/${body.tableName}`,
      payload: { primaryKeys: body.primaryKeys, values: body.values },
      result: "SUCCESS"
    });
    return result;
  });

  // 11. Delete row
  app.post("/api/databases/:id/tables/delete", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseDeleteRowRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await deleteDaemonDatabaseTableRow(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.delete_row",
      resourceType: "database_table",
      resourceId: `${id}/${body.tableName}`,
      payload: { primaryKeys: body.primaryKeys },
      result: "SUCCESS"
    });
    return result;
  });

  // 12. Create table (DDL)
  app.post("/api/databases/:id/tables/create", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseCreateTableRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await createDaemonDatabaseTable(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.create_table",
      resourceType: "database_table",
      resourceId: `${id}/${body.tableName}`,
      payload: { columns: body.columns },
      result: "SUCCESS"
    });
    return result;
  });

  // 13. Drop table
  app.post("/api/databases/:id/tables/drop", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { tableName: string };
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await dropDaemonDatabaseTable(creds, {
      ...buildConnectionPayload(inst),
      tableName: body.tableName
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.drop_table",
      resourceType: "database_table",
      resourceId: `${id}/${body.tableName}`,
      result: "SUCCESS"
    });
    return result;
  });

  // 14. Truncate table
  app.post("/api/databases/:id/tables/truncate", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseTruncateTableRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await truncateDaemonDatabaseTable(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.truncate_table",
      resourceType: "database_table",
      resourceId: `${id}/${body.tableName}`,
      result: "SUCCESS"
    });
    return result;
  });

  // 15. Execute query (SQL Console / Terminal)
  app.post("/api/databases/:id/query", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { sql: string; maxRows?: number };
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly && /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(body.sql)) {
      reply.code(403).send({ message: "只读模式下不允许执行写操作" });
      return;
    }
    const result = await executeDaemonDatabaseQuery(creds, {
      ...buildConnectionPayload(inst),
      sql: body.sql,
      maxRows: body.maxRows
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "database.query",
      resourceType: "database_visualizer",
      resourceId: id,
      payload: { sql: body.sql.length > 200 ? `${body.sql.slice(0, 200)}...` : body.sql },
      result: "SUCCESS"
    });
    return result;
  });

  // 16. Export data
  app.post("/api/databases/:id/export", { preHandler: requirePermission("instance.view") }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseExportRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    return exportDaemonDatabaseData(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
  });

  // 17. Import data
  app.post("/api/databases/:id/import", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseImportRequest;
    const { inst, creds } = await loadInstanceAndNode(id);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    return importDaemonDatabaseData(creds, {
      ...buildConnectionPayload(inst),
      ...body
    });
  });

  // 18. Test MySQL connection
  app.post("/api/databases/test-connection", { preHandler: requirePermission("instance.view") }, async (request) => {
    const body = request.body as { host?: string; port?: number; user?: string; password?: string; database?: string };
    // Use the local panel node's daemon to test the connection
    const localNode = await resolveNodeCredentials("local");
    if (!localNode) throw new Error("未找到本地节点");
    return requestDaemon<{ ok: boolean; message?: string }>(
      localNode,
      "/api/databases/test-connection",
      { method: "POST", body: JSON.stringify(body) }
    );
  });
}
