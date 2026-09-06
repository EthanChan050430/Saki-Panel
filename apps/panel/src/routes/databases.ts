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
import type { Prisma } from "@prisma/client";
import { loadCurrentUser, requirePermission } from "../auth.js";
import { canAccessNode, nodeVisibilityWhere } from "../node-access.js";
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
  getDaemonDatabaseStats,
  type DaemonNodeCredentials
} from "../daemon-client.js";
import {
  loadInstanceAccessProfile,
  resolveAssignableUserIds,
  resolveAssignableUserId,
  classifyInstanceUser,
  instanceUserInclude,
  type InstanceAccessProfile
} from "../instance-access.js";
import type { InstanceAssignedUser } from "@webops/shared";

function canAccessDatabaseInstance(
  profile: InstanceAccessProfile | null,
  inst: DatabaseVisualizerInstance
): boolean {
  if (!profile) return false;

  const isSystemDb =
    Boolean(inst.config.path?.includes("dev.db")) ||
    inst.name.includes("WebOps 系统数据库") ||
    inst.name.includes("WebOps 核心数据库");

  // Explicit assignment always takes highest precedence
  if (inst.assignees?.some((a) => a.userId === profile.userId)) return true;
  if (inst.assignedToUserId === profile.userId) return true;
  if (inst.createdByUserId === profile.userId) return true;

  // Super admin can access all instances
  if (profile.role === "super_admin") {
    return true;
  }

  // System internal database (dev.db) is never shown to regular users or admins without explicit assignment
  if (isSystemDb) {
    return false;
  }

  if (profile.role === "admin") {
    if (!inst.createdByRole || inst.createdByRole === "user") return true;
    if (inst.assignees?.some((a) => a.role === "admin")) return true;
    if (!inst.createdByUserId && (!inst.assignees || inst.assignees.length === 0)) {
      return true;
    }
  }

  return false;
}

async function safeDaemonCall<T>(
  reply: FastifyReply,
  fn: () => Promise<T>
): Promise<T | void> {
  try {
    return await fn();
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    let message = raw;
    if (raw.includes("Access denied for user")) {
      message = `数据库认证失败：用户名或密码错误，或该用户未被授予从当前主机访问此数据库的权限。(${raw.replace(/^Daemon request failed \(\d+\):\s*/, "")})`;
    } else if (raw.includes("ECONNREFUSED")) {
      message = "无法连接到数据库服务：连接被拒绝，请确认服务已启动且端口开放。";
    } else if (raw.includes("Daemon request failed")) {
      message = raw.replace(/^Daemon request failed \(\d+\):\s*/, "");
    }
    reply.code(400).send({ ok: false, statusCode: 400, message, error: message });
    return;
  }
}

const dbVisualizersFile = path.resolve(process.cwd(), "data", "panel", "database-visualizers.json");

async function ensureStore(): Promise<void> {
  const dir = path.dirname(dbVisualizersFile);
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  if (!fsSync.existsSync(dbVisualizersFile)) {
    const initial: DatabaseVisualizerInstance[] = [];
    await fs.writeFile(dbVisualizersFile, JSON.stringify(initial, null, 2), "utf8");
  }
}

async function readVisualizers(): Promise<DatabaseVisualizerInstance[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(dbVisualizersFile, "utf8");
    const list = JSON.parse(raw) as DatabaseVisualizerInstance[];
    // Filter out unassigned auto-seeded WebOps system database by default
    return list.filter((item) => {
      const isLegacyAutoSeeded =
        (item.name.includes("WebOps 系统数据库") || item.name.includes("WebOps 核心数据库")) &&
        !item.createdByUserId &&
        (!item.assignees || item.assignees.length === 0) &&
        !item.assignedToUserId;
      return !isLegacyAutoSeeded;
    });
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
  app.get("/api/databases", { preHandler: requirePermission("instance.view") }, async (request) => {
    const profile = await loadInstanceAccessProfile(request.user.sub);
    const items = await readVisualizers();
    const nodes = await prisma.node.findMany({ select: { id: true, name: true } });
    const nodeMap = new Map(nodes.map((n) => [n.id, n.name]));

    const enriched = items.map((item) => ({
      ...item,
      nodeName: nodeMap.get(item.nodeId) ?? (item.nodeId === "local" ? "本地节点" : item.nodeName ?? item.nodeId)
    }));

    const visible = enriched.filter((item) => canAccessDatabaseInstance(profile, item));

    return { ok: true, databases: visible };
  });
  app.get("/api/databases/discover", { preHandler: requirePermission("instance.view") }, async (request) => {
    const user = await loadCurrentUser(request.user.sub);
    const query = request.query as { nodeId?: string };
    const allDiscovered: Array<DiscoveredDatabase & { nodeId: string; nodeName: string }> = [];

    const where: Prisma.NodeWhereInput = user ? nodeVisibilityWhere(user) : {};
    if (query.nodeId) {
      where.id = query.nodeId;
    }

    const nodes = await prisma.node.findMany({ where });

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

    // Only super_admin can discover panel's internal dev.db
    const profile = await loadInstanceAccessProfile(request.user.sub);
    if (profile?.role === "super_admin") {
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
    }

    return { ok: true, databases: allDiscovered };
  });
  app.post("/api/databases", { preHandler: requirePermission("instance.create") }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    const body = request.body as CreateDatabaseVisualizerRequest;
    if (!body.name?.trim() || !body.nodeId) {
      reply.code(400).send({ message: "名称和节点ID为必填项" });
      return;
    }

    let nodeName = body.nodeId === "local" ? "本地节点" : body.nodeId;
    if (body.nodeId !== "local" && body.nodeId !== "panel") {
      const node = await prisma.node.findUnique({ where: { id: body.nodeId } });
      if (!node || !user || !canAccessNode(user, node)) {
        reply.code(404).send({ message: "Node not found" });
        return;
      }
      nodeName = node.name;
    }

    let assignedUserIds: string[] | undefined;
    try {
      if (body.assignedToUserIds !== undefined) {
        assignedUserIds = await resolveAssignableUserIds(request.user.sub, body.assignedToUserIds);
      } else if (body.assignedToUserId !== undefined) {
        const assignedToId = await resolveAssignableUserId(request.user.sub, body.assignedToUserId);
        assignedUserIds = assignedToId === undefined ? undefined : assignedToId ? [assignedToId] : [];
      }
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : 400;
      reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Invalid assignee" });
      return;
    }

    let assignees: InstanceAssignedUser[] = [];
    if (assignedUserIds && assignedUserIds.length > 0) {
      const assignedUsers = await prisma.user.findMany({
        where: { id: { in: assignedUserIds } },
        include: instanceUserInclude
      });
      assignees = assignedUsers.map((u) => ({
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        role: classifyInstanceUser(u)
      }));
    }

    const creator = await prisma.user.findUnique({
      where: { id: request.user.sub },
      include: instanceUserInclude
    });

    const newInstance: DatabaseVisualizerInstance = {
      id: randomUUID(),
      nodeId: body.nodeId,
      nodeName,
      name: body.name.trim(),
      engine: body.engine ?? "sqlite",
      description: body.description?.trim() || undefined,
      config: body.config || {},
      createdByUserId: creator?.id ?? request.user.sub,
      createdByUsername: creator?.username,
      createdByDisplayName: creator?.displayName,
      createdByRole: creator ? classifyInstanceUser(creator) : undefined,
      assignedToUserId: assignees[0]?.userId ?? null,
      assignedToUsername: assignees[0]?.username ?? null,
      assignedToDisplayName: assignees[0]?.displayName ?? null,
      assignedToRole: assignees[0]?.role ?? null,
      assignees,
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

    let nextAssignees = target.assignees;
    let nextAssignedToUserId = target.assignedToUserId;
    let nextAssignedToUsername = target.assignedToUsername;
    let nextAssignedToDisplayName = target.assignedToDisplayName;
    let nextAssignedToRole = target.assignedToRole;

    if (body.assignedToUserIds !== undefined || body.assignedToUserId !== undefined) {
      let assignedUserIds: string[] | undefined;
      try {
        if (body.assignedToUserIds !== undefined) {
          assignedUserIds = await resolveAssignableUserIds(request.user.sub, body.assignedToUserIds);
        } else if (body.assignedToUserId !== undefined) {
          const assignedToId = await resolveAssignableUserId(request.user.sub, body.assignedToUserId);
          assignedUserIds = assignedToId === undefined ? undefined : assignedToId ? [assignedToId] : [];
        }
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
            ? error.statusCode
            : 400;
        reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Invalid assignee" });
        return;
      }

      if (assignedUserIds !== undefined) {
        const assignedUsers = await prisma.user.findMany({
          where: { id: { in: assignedUserIds } },
          include: instanceUserInclude
        });
        nextAssignees = assignedUsers.map((u) => ({
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          role: classifyInstanceUser(u)
        }));
        nextAssignedToUserId = nextAssignees[0]?.userId ?? null;
        nextAssignedToUsername = nextAssignees[0]?.username ?? null;
        nextAssignedToDisplayName = nextAssignees[0]?.displayName ?? null;
        nextAssignedToRole = nextAssignees[0]?.role ?? null;
      }
    }

    const updated: DatabaseVisualizerInstance = {
      ...target,
      name: body.name?.trim() || target.name,
      nodeId: body.nodeId || target.nodeId,
      nodeName,
      engine: body.engine || target.engine,
      description: body.description !== undefined ? (body.description ? body.description.trim() : null) : target.description,
      config: body.config ? { ...target.config, ...body.config } : target.config,
      assignedToUserId: nextAssignedToUserId,
      assignedToUsername: nextAssignedToUsername,
      assignedToDisplayName: nextAssignedToDisplayName,
      assignedToRole: nextAssignedToRole,
      assignees: nextAssignees,
      updatedAt: new Date().toISOString()
    };

    current[index] = updated;
    await writeVisualizers(current);

    if (body.config) {
      try {
        const creds = await resolveNodeCredentials(updated.nodeId);
        if (creds) {
          await requestDaemon(creds, "/api/databases/clear-cache", {
            method: "POST",
            body: JSON.stringify({
              host: updated.config.host,
              port: updated.config.port,
              user: updated.config.user,
              password: updated.config.password,
              database: updated.config.database,
              engine: updated.engine
            })
          }).catch(() => {});
        }
      } catch {}
    }

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
  async function loadInstanceAndNode(id: string, userId?: string) {
    const current = await readVisualizers();
    const inst = current.find((item) => item.id === id);
    if (!inst) {
      const err: any = new Error("数据库可视化实例不存在");
      err.statusCode = 404;
      throw err;
    }
    if (userId) {
      const profile = await loadInstanceAccessProfile(userId);
      if (!canAccessDatabaseInstance(profile, inst)) {
        const err: any = new Error("无权访问该数据库可视化实例");
        err.statusCode = 403;
        throw err;
      }
    }
    const creds = await resolveNodeCredentials(inst.nodeId);
    if (!creds) {
      const err: any = new Error(`未找到节点连接凭证 (nodeId: ${inst.nodeId})`);
      err.statusCode = 400;
      throw err;
    }
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
  app.post("/api/databases/:id/tables", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    return safeDaemonCall(reply, () => listDaemonDatabaseTables(creds, buildConnectionPayload(inst)));
  });
  app.post("/api/databases/:id/tables/schema", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { tableName: string };
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    return safeDaemonCall(reply, () => getDaemonDatabaseTableSchema(creds, {
      ...buildConnectionPayload(inst),
      tableName: body.tableName
    }));
  });
  app.post("/api/databases/:id/tables/rows", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseRowsRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    return safeDaemonCall(reply, () => queryDaemonDatabaseTableRows(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
  });
  app.post("/api/databases/:id/tables/insert", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseInsertRowRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await safeDaemonCall(reply, () => insertDaemonDatabaseTableRow(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
    if (result) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "database.insert_row",
        resourceType: "database_table",
        resourceId: `${id}/${body.tableName}`,
        payload: { row: body.row },
        result: "SUCCESS"
      });
    }
    return result;
  });
  app.post("/api/databases/:id/tables/update", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseUpdateRowRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await safeDaemonCall(reply, () => updateDaemonDatabaseTableRow(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
    if (result) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "database.update_row",
        resourceType: "database_table",
        resourceId: `${id}/${body.tableName}`,
        payload: { primaryKeys: body.primaryKeys, values: body.values },
        result: "SUCCESS"
      });
    }
    return result;
  });
  app.post("/api/databases/:id/tables/delete", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseDeleteRowRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await safeDaemonCall(reply, () => deleteDaemonDatabaseTableRow(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
    if (result) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "database.delete_row",
        resourceType: "database_table",
        resourceId: `${id}/${body.tableName}`,
        payload: { primaryKeys: body.primaryKeys },
        result: "SUCCESS"
      });
    }
    return result;
  });
  app.post("/api/databases/:id/tables/create", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseCreateTableRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await safeDaemonCall(reply, () => createDaemonDatabaseTable(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
    if (result) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "database.create_table",
        resourceType: "database_table",
        resourceId: `${id}/${body.tableName}`,
        payload: { columns: body.columns },
        result: "SUCCESS"
      });
    }
    return result;
  });
  app.post("/api/databases/:id/tables/drop", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { tableName: string };
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await safeDaemonCall(reply, () => dropDaemonDatabaseTable(creds, {
      ...buildConnectionPayload(inst),
      tableName: body.tableName
    }));
    if (result) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "database.drop_table",
        resourceType: "database_table",
        resourceId: `${id}/${body.tableName}`,
        result: "SUCCESS"
      });
    }
    return result;
  });
  app.post("/api/databases/:id/tables/truncate", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseTruncateTableRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    const result = await safeDaemonCall(reply, () => truncateDaemonDatabaseTable(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
    if (result) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "database.truncate_table",
        resourceType: "database_table",
        resourceId: `${id}/${body.tableName}`,
        result: "SUCCESS"
      });
    }
    return result;
  });
  app.post("/api/databases/:id/query", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { sql: string; maxRows?: number };
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly && /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(body.sql)) {
      reply.code(403).send({ message: "只读模式下不允许执行写操作" });
      return;
    }
    const result = await safeDaemonCall(reply, () => executeDaemonDatabaseQuery(creds, {
      ...buildConnectionPayload(inst),
      sql: body.sql,
      maxRows: body.maxRows
    }));
    if (result) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "database.query",
        resourceType: "database_visualizer",
        resourceId: id,
        payload: { sql: body.sql.length > 200 ? `${body.sql.slice(0, 200)}...` : body.sql },
        result: "SUCCESS"
      });
    }
    return result;
  });
  app.post("/api/databases/:id/export", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseExportRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    return safeDaemonCall(reply, () => exportDaemonDatabaseData(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
  });
  app.post("/api/databases/:id/import", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DatabaseImportRequest;
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    if (inst.config.isReadOnly) {
      reply.code(403).send({ message: "该数据库已被设为只读模式" });
      return;
    }
    return safeDaemonCall(reply, () => importDaemonDatabaseData(creds, {
      ...buildConnectionPayload(inst),
      ...body
    }));
  });
  app.post("/api/databases/test-connection", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const body = request.body as { host?: string; port?: number; user?: string; password?: string; database?: string; engine?: DatabaseEngine; path?: string; nodeId?: string };
    const targetNodeId = body.nodeId || "local";
    const targetNode = await resolveNodeCredentials(targetNodeId);
    if (!targetNode) {
      reply.code(400).send({ ok: false, message: `未找到目标节点 (${targetNodeId})` });
      return;
    }
    return safeDaemonCall(reply, () => requestDaemon<{ ok: boolean; message?: string }>(
      targetNode,
      "/api/databases/test-connection",
      { method: "POST", body: JSON.stringify(body) }
    ));
  });
  app.get("/api/databases/:id/stats", { preHandler: requirePermission("instance.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { inst, creds } = await loadInstanceAndNode(id, request.user.sub);
    return safeDaemonCall(reply, () => getDaemonDatabaseStats(creds, buildConnectionPayload(inst)));
  });
}
