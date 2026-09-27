import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import type {
  AuditFocusCategory,
  AuditLogEntry,
  AuditLogListResponse,
  AuditLogQueryParams,
  AuditRangeSummary,
  AuditRetentionPolicy,
  AuditSortBy,
  AuditSortOrder,
  DeleteAuditLogsRequest,
  DeleteAuditLogsResponse,
  SakiAuditConversationItem,
  SakiAuditConversationListResponse,
  UpdateAuditRetentionPolicyRequest
} from "@webops/shared";
import { prisma } from "../db.js";
import { requirePermission, requireSuperAdmin } from "../auth.js";
import { panelPaths } from "../config.js";
import { writeAuditLog } from "../audit.js";

const defaultRetentionPolicy: AuditRetentionPolicy = {
  retentionDays: 90,
  autoCleanupEnabled: true,
  protectFailureLogs: false,
  protectAuditTrailLogs: true,
  allowManualDelete: true,
  lastCleanupAt: null,
  lastCleanupDeleted: 0
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), max) : fallback;
}

async function readAuditRetentionPolicy(): Promise<AuditRetentionPolicy> {
  try {
    const raw = await fs.readFile(panelPaths.auditRetentionFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuditRetentionPolicy>;
    return {
      retentionDays: typeof parsed.retentionDays === "number" ? Math.max(0, Math.min(parsed.retentionDays, 3650)) : defaultRetentionPolicy.retentionDays,
      autoCleanupEnabled: parsed.autoCleanupEnabled !== undefined ? Boolean(parsed.autoCleanupEnabled) : defaultRetentionPolicy.autoCleanupEnabled,
      protectFailureLogs: parsed.protectFailureLogs !== undefined ? Boolean(parsed.protectFailureLogs) : defaultRetentionPolicy.protectFailureLogs,
      protectAuditTrailLogs: parsed.protectAuditTrailLogs !== undefined ? Boolean(parsed.protectAuditTrailLogs) : defaultRetentionPolicy.protectAuditTrailLogs,
      allowManualDelete: parsed.allowManualDelete !== undefined ? Boolean(parsed.allowManualDelete) : defaultRetentionPolicy.allowManualDelete,
      lastCleanupAt: parsed.lastCleanupAt ?? null,
      lastCleanupDeleted: typeof parsed.lastCleanupDeleted === "number" ? parsed.lastCleanupDeleted : 0
    };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return defaultRetentionPolicy;
    return defaultRetentionPolicy;
  }
}

async function saveAuditRetentionPolicy(policy: AuditRetentionPolicy): Promise<void> {
  await fs.mkdir(path.dirname(panelPaths.auditRetentionFile), { recursive: true });
  await fs.writeFile(panelPaths.auditRetentionFile, JSON.stringify(policy, null, 2), "utf8");
}

function buildCategoryFilter(category?: AuditFocusCategory): Prisma.OperationLogWhereInput | null {
  if (!category || category === "all") return null;
  if (category === "failed_login") {
    return {
      OR: [
        { action: "auth.login", result: "FAILURE" },
        { action: "auth.login.rate_limited" },
        { action: { startsWith: "auth.login" }, result: "FAILURE" }
      ]
    };
  }
  if (category === "permission_change") {
    return {
      OR: [
        { action: { startsWith: "role." } },
        { action: { contains: "permission" } },
        { action: { in: ["user.create", "user.update", "user.delete", "user.switch", "auth.register", "audit.retention.update"] } },
        { resourceType: { in: ["role", "permission"] } }
      ]
    };
  }
  if (category === "delete_operation") {
    return {
      OR: [
        { action: { endsWith: ".delete" } },
        { action: { endsWith: ".clear" } },
        { action: { endsWith: ".cleanup" } },
        { action: { contains: "delete" } },
        { action: "instance.kill" }
      ]
    };
  }
  if (category === "saki_chat") {
    return {
      OR: [
        { action: "saki.chat" },
        { action: "saki.agent.tool" },
        { action: { startsWith: "saki." } },
        { resourceType: "saki" }
      ]
    };
  }
  if (category === "file_change") {
    return {
      OR: [
        { action: { startsWith: "file." } },
        { resourceType: "instance_file" },
        { payload: { contains: '"tool":"writefile"' } },
        { payload: { contains: '"tool":"editlines"' } },
        { payload: { contains: '"tool":"replaceinfile"' } },
        { payload: { contains: '"tool":"deletepath"' } },
        { payload: { contains: '"tool":"renamepath"' } },
        { payload: { contains: '"tool":"mkdir"' } },
        { payload: { contains: '"tool":"uploadbase64"' } }
      ]
    };
  }
  return null;
}

function buildAuditWhere(query: AuditLogQueryParams): {
  tableWhere: Prisma.OperationLogWhereInput;
  rangeWhere: Prisma.OperationLogWhereInput;
} {
  const andConditions: Prisma.OperationLogWhereInput[] = [];
  const rangeAndConditions: Prisma.OperationLogWhereInput[] = [];

  if (query.from || query.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) {
      const fromDate = new Date(query.from);
      if (!Number.isNaN(fromDate.getTime())) {
        createdAt.gte = fromDate;
      }
    }
    if (query.to) {
      const toDate = new Date(query.to);
      if (!Number.isNaN(toDate.getTime())) {
        createdAt.lte = toDate;
      }
    }
    if (createdAt.gte || createdAt.lte) {
      andConditions.push({ createdAt });
      rangeAndConditions.push({ createdAt });
    }
  }

  if (query.actor?.trim()) {
    const actorTrim = query.actor.trim();
    if (actorTrim.toLowerCase() === "system" || actorTrim === "系统") {
      const cond = { userId: null };
      andConditions.push(cond);
      rangeAndConditions.push(cond);
    } else {
      const cond: Prisma.OperationLogWhereInput = {
        OR: [
          { userId: { contains: actorTrim } },
          { user: { username: { contains: actorTrim } } },
          { user: { displayName: { contains: actorTrim } } }
        ]
      };
      andConditions.push(cond);
      rangeAndConditions.push(cond);
    }
  }

  if (query.ip?.trim()) {
    const cond = { ip: { contains: query.ip.trim() } };
    andConditions.push(cond);
    rangeAndConditions.push(cond);
  }

  if (query.resourceType?.trim()) {
    const cond = { resourceType: query.resourceType.trim() };
    andConditions.push(cond);
    rangeAndConditions.push(cond);
  }

  if (query.resourceId?.trim()) {
    const cond = { resourceId: { contains: query.resourceId.trim() } };
    andConditions.push(cond);
    rangeAndConditions.push(cond);
  }

  if (query.resource?.trim()) {
    const resTrim = query.resource.trim();
    const cond: Prisma.OperationLogWhereInput = {
      OR: [
        { resourceType: { contains: resTrim } },
        { resourceId: { contains: resTrim } }
      ]
    };
    andConditions.push(cond);
    rangeAndConditions.push(cond);
  }

  if (query.action?.trim()) {
    const cond = { action: { contains: query.action.trim() } };
    andConditions.push(cond);
    rangeAndConditions.push(cond);
  }

  if (query.keyword?.trim()) {
    const kw = query.keyword.trim();
    const cond: Prisma.OperationLogWhereInput = {
      OR: [
        { action: { contains: kw } },
        { resourceType: { contains: kw } },
        { resourceId: { contains: kw } },
        { ip: { contains: kw } },
        { payload: { contains: kw } },
        { user: { username: { contains: kw } } },
        { user: { displayName: { contains: kw } } }
      ]
    };
    andConditions.push(cond);
    rangeAndConditions.push(cond);
  }

  if (query.result === "SUCCESS" || query.result === "FAILURE") {
    andConditions.push({ result: query.result });
  }

  const categoryFilter = buildCategoryFilter(query.category);
  if (categoryFilter) {
    andConditions.push(categoryFilter);
  }

  const tableWhere: Prisma.OperationLogWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};
  const rangeWhere: Prisma.OperationLogWhereInput = rangeAndConditions.length > 0 ? { AND: rangeAndConditions } : {};

  return { tableWhere, rangeWhere };
}

function buildOrderBy(sortBy?: AuditSortBy, sortOrder?: AuditSortOrder): Prisma.OperationLogOrderByWithRelationInput {
  const order = sortOrder === "asc" ? "asc" : "desc";
  if (sortBy === "action") return { action: order };
  if (sortBy === "resourceType") return { resourceType: order };
  if (sortBy === "result") return { result: order };
  if (sortBy === "ip") return { ip: order };
  if (sortBy === "actor") return { userId: order };
  return { createdAt: order };
}

function mapLogEntry(log: any): AuditLogEntry {
  return {
    id: log.id,
    userId: log.userId,
    username: log.user?.username ?? null,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    ip: log.ip,
    userAgent: log.userAgent,
    payload: log.payload,
    result: log.result,
    createdAt: log.createdAt.toISOString ? log.createdAt.toISOString() : new Date(log.createdAt).toISOString()
  };
}

async function computeAuditSummary(rangeWhere: Prisma.OperationLogWhereInput): Promise<AuditRangeSummary> {
  const [
    total,
    success,
    failure,
    failedLogins,
    permissionChanges,
    deleteOperations,
    sakiChats,
    fileChanges,
    actorGroups,
    resourceGroups,
    latestLog
  ] = await Promise.all([
    prisma.operationLog.count({ where: rangeWhere }),
    prisma.operationLog.count({ where: { AND: [rangeWhere, { result: "SUCCESS" }] } }),
    prisma.operationLog.count({ where: { AND: [rangeWhere, { result: "FAILURE" }] } }),
    prisma.operationLog.count({
      where: {
        AND: [
          rangeWhere,
          {
            OR: [
              { action: "auth.login", result: "FAILURE" },
              { action: "auth.login.rate_limited" },
              { action: { startsWith: "auth.login" }, result: "FAILURE" }
            ]
          }
        ]
      }
    }),
    prisma.operationLog.count({
      where: {
        AND: [
          rangeWhere,
          {
            OR: [
              { action: { startsWith: "role." } },
              { action: { contains: "permission" } },
              { action: { in: ["user.create", "user.update", "user.delete", "user.switch", "auth.register", "audit.retention.update"] } },
              { resourceType: { in: ["role", "permission"] } }
            ]
          }
        ]
      }
    }),
    prisma.operationLog.count({
      where: {
        AND: [
          rangeWhere,
          {
            OR: [
              { action: { endsWith: ".delete" } },
              { action: { endsWith: ".clear" } },
              { action: { endsWith: ".cleanup" } },
              { action: { contains: "delete" } },
              { action: "instance.kill" }
            ]
          }
        ]
      }
    }),
    prisma.operationLog.count({
      where: {
        AND: [
          rangeWhere,
          {
            OR: [
              { action: "saki.chat" },
              { action: "saki.agent.tool" },
              { action: { startsWith: "saki." } },
              { resourceType: "saki" }
            ]
          }
        ]
      }
    }),
    prisma.operationLog.count({
      where: {
        AND: [
          rangeWhere,
          {
            OR: [
              { action: { startsWith: "file." } },
              { resourceType: "instance_file" },
              { payload: { contains: '"tool":"writefile"' } },
              { payload: { contains: '"tool":"editlines"' } },
              { payload: { contains: '"tool":"replaceinfile"' } },
              { payload: { contains: '"tool":"deletepath"' } },
              { payload: { contains: '"tool":"renamepath"' } },
              { payload: { contains: '"tool":"mkdir"' } },
              { payload: { contains: '"tool":"uploadbase64"' } }
            ]
          }
        ]
      }
    }),
    prisma.operationLog.groupBy({
      by: ["userId"],
      where: rangeWhere
    }),
    prisma.operationLog.groupBy({
      by: ["resourceType"],
      where: rangeWhere
    }),
    prisma.operationLog.findFirst({
      where: rangeWhere,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    })
  ]);

  const successRate = total > 0 ? Math.round((success / total) * 100) : 100;

  return {
    total,
    success,
    failure,
    successRate,
    actors: actorGroups.length,
    resourceTypes: resourceGroups.length,
    failedLogins,
    permissionChanges,
    deleteOperations,
    sakiChats,
    fileChanges,
    latestLogAt: latestLog ? latestLog.createdAt.toISOString() : null
  };
}

export async function pruneExpiredAuditLogs(triggerType: "manual" | "scheduled", operatorUserId?: string | null, request?: FastifyRequest): Promise<{ deleted: number }> {
  const policy = await readAuditRetentionPolicy();
  if (policy.retentionDays <= 0) {
    return { deleted: 0 };
  }

  const cutoffDate = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
  const protections: Prisma.OperationLogWhereInput[] = [];
  if (policy.protectAuditTrailLogs) {
    protections.push({ NOT: { OR: [{ resourceType: "audit" }, { action: { startsWith: "audit." } }] } });
  }
  if (policy.protectFailureLogs) {
    protections.push({ NOT: { result: "FAILURE" } });
  }
  const where: Prisma.OperationLogWhereInput = {
    createdAt: { lt: cutoffDate },
    ...(protections.length ? { AND: protections } : {})
  };

  const toDelete = await prisma.operationLog.findMany({
    where,
    take: 100,
    select: { id: true, action: true, createdAt: true }
  });

  const result = await prisma.operationLog.deleteMany({ where });

  policy.lastCleanupAt = new Date().toISOString();
  policy.lastCleanupDeleted = result.count;
  await saveAuditRetentionPolicy(policy);

  if (result.count > 0 || triggerType === "manual") {
    await writeAuditLog({
      request,
      userId: operatorUserId ?? null,
      action: "audit.retention.cleanup",
      resourceType: "audit",
      resourceId: "retention",
      payload: {
        trigger: triggerType,
        retentionDays: policy.retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        deletedCount: result.count,
        sampleDeleted: toDelete.slice(0, 5).map((l) => ({ id: l.id, action: l.action, at: l.createdAt }))
      },
      result: "SUCCESS"
    });
  }

  return { deleted: result.count };
}

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  setInterval(() => {
    void (async () => {
      try {
        const policy = await readAuditRetentionPolicy();
        if (policy.autoCleanupEnabled && policy.retentionDays > 0) {
          await pruneExpiredAuditLogs("scheduled");
        }
      } catch (err) {
        app.log.error({ err }, "Failed to run scheduled audit retention cleanup");
      }
    })();
  }, 12 * 60 * 60 * 1000);

  app.get("/api/audit/logs", { preHandler: requirePermission("audit.view") }, async (request): Promise<AuditLogListResponse> => {
    const query = request.query as AuditLogQueryParams;
    const page = positiveInt(query.page, 1, 1_000_000);
    const limit = positiveInt(query.limit, 20, 100);
    const skip = (page - 1) * limit;

    const { tableWhere, rangeWhere } = buildAuditWhere(query);
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder);

    const [total, logs, summary, retention, sampleResourceTypes, sampleActions, allUsers] = await Promise.all([
      prisma.operationLog.count({ where: tableWhere }),
      prisma.operationLog.findMany({
        where: tableWhere,
        orderBy,
        take: limit,
        skip,
        include: { user: true }
      }),
      computeAuditSummary(rangeWhere),
      readAuditRetentionPolicy(),
      prisma.operationLog.groupBy({ by: ["resourceType"], _count: { _all: true }, orderBy: { _count: { resourceType: "desc" } }, take: 30 }),
      prisma.operationLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 50 }),
      prisma.user.findMany({
        select: { id: true, username: true, displayName: true, avatarDataUrl: true },
        orderBy: { username: "asc" }
      })
    ]);

    const data = logs.map(mapLogEntry);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      summary,
      facets: {
        resourceTypes: sampleResourceTypes.map((r) => r.resourceType).filter(Boolean),
        actions: sampleActions.map((a) => a.action).filter(Boolean),
        users: allUsers
      },
      retention
    };
  });

  app.get("/api/audit/export", { preHandler: requirePermission("audit.view") }, async (request, reply) => {
    const query = request.query as AuditLogQueryParams & { format?: "csv" | "json" };
    const format = query.format === "json" ? "json" : "csv";
    const { tableWhere } = buildAuditWhere(query);
    const orderBy = buildOrderBy(query.sortBy, query.sortOrder);

    const logs = await prisma.operationLog.findMany({
      where: tableWhere,
      orderBy,
      take: 10000,
      include: { user: true }
    });

    const data = logs.map(mapLogEntry);

    await writeAuditLog({
      request,
      userId: request.user?.sub ?? null,
      action: "audit.logs.export",
      resourceType: "audit",
      resourceId: format,
      payload: {
        format,
        exportedCount: data.length,
        filter: {
          from: query.from,
          to: query.to,
          actor: query.actor,
          ip: query.ip,
          resourceType: query.resourceType,
          resourceId: query.resourceId,
          action: query.action,
          result: query.result,
          category: query.category,
          keyword: query.keyword
        }
      },
      result: "SUCCESS"
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    if (format === "json") {
      reply.header("Content-Disposition", `attachment; filename="audit-logs-${timestamp}.json"`);
      reply.header("Content-Type", "application/json; charset=utf-8");
      return data;
    }

    const header = ["ID", "Time", "Result", "Action", "Operator_Username", "Operator_UserID", "Resource_Type", "Resource_ID", "IP", "User_Agent", "Payload"];
    const rows = data.map((item) => [
      item.id,
      item.createdAt,
      item.result,
      item.action,
      item.username ?? "system",
      item.userId ?? "",
      item.resourceType,
      item.resourceId ?? "",
      item.ip ?? "",
      (item.userAgent ?? "").replace(/[\r\n]+/g, " "),
      (item.payload ?? "").replace(/[\r\n]+/g, " ")
    ]);

    const csvContent = "\uFEFF" + [
      header.map((col) => `"${col.replace(/"/g, '""')}"`).join(","),
      ...rows.map((row) => row.map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`).join(","))
    ].join("\r\n");

    reply.header("Content-Disposition", `attachment; filename="audit-logs-${timestamp}.csv"`);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    return reply.send(csvContent);
  });

  app.get("/api/audit/retention", { preHandler: requirePermission("audit.view") }, async () => {
    return readAuditRetentionPolicy();
  });

  app.put("/api/audit/retention", { preHandler: requireSuperAdmin() }, async (request) => {
    const body = request.body as UpdateAuditRetentionPolicyRequest;
    const current = await readAuditRetentionPolicy();

    const next: AuditRetentionPolicy = {
      ...current,
      retentionDays: body.retentionDays !== undefined ? Math.max(0, Math.min(Number(body.retentionDays) || 0, 3650)) : current.retentionDays,
      autoCleanupEnabled: body.autoCleanupEnabled !== undefined ? Boolean(body.autoCleanupEnabled) : current.autoCleanupEnabled,
      protectFailureLogs: body.protectFailureLogs !== undefined ? Boolean(body.protectFailureLogs) : current.protectFailureLogs,
      protectAuditTrailLogs: body.protectAuditTrailLogs !== undefined ? Boolean(body.protectAuditTrailLogs) : current.protectAuditTrailLogs,
      allowManualDelete: body.allowManualDelete !== undefined ? Boolean(body.allowManualDelete) : current.allowManualDelete
    };

    await saveAuditRetentionPolicy(next);

    await writeAuditLog({
      request,
      userId: request.user?.sub ?? null,
      action: "audit.retention.update",
      resourceType: "audit",
      resourceId: "retention",
      payload: {
        previous: current,
        updated: next
      },
      result: "SUCCESS"
    });

    return next;
  });

  app.post("/api/audit/retention/cleanup", { preHandler: requireSuperAdmin() }, async (request) => {
    const result = await pruneExpiredAuditLogs("manual", request.user?.sub ?? null, request);
    return { ok: true, deleted: result.deleted };
  });

  app.delete(
    "/api/audit/logs/:id",
    { preHandler: requireSuperAdmin() },
    async (request, reply): Promise<DeleteAuditLogsResponse | void> => {
      const { id } = request.params as { id: string };
      const query = request.query as { reason?: string };
      const reason = query.reason?.trim() || "管理员单条删除";

      const target = await prisma.operationLog.findUnique({ where: { id } });
      if (!target) {
        reply.code(404).send({ message: "目标审计日志不存在" });
        return;
      }

      const policy = await readAuditRetentionPolicy();
      if (!policy.allowManualDelete) {
        reply.code(403).send({ message: "当前保留策略已关闭手动删除审计日志入口，请先在保留策略设置中开启。" });
        return;
      }

      if (policy.protectAuditTrailLogs && (target.resourceType === "audit" || target.action.startsWith("audit."))) {
        reply.code(403).send({ message: "受保护的审计治理日志不允许删除。" });
        return;
      }

      await prisma.operationLog.delete({ where: { id } });

      const auditRecord = await writeAuditLog({
        request,
        userId: request.user?.sub ?? null,
        action: "audit.logs.delete",
        resourceType: "audit",
        resourceId: id,
        payload: {
          mode: "single",
          deletedCount: 1,
          reason,
          deletedAction: target.action,
          deletedResourceType: target.resourceType,
          deletedResourceId: target.resourceId,
          deletedCreatedAt: target.createdAt.toISOString()
        },
        result: "SUCCESS"
      });

      return { ok: true, deleted: 1, auditRecordId: auditRecord.id };
    }
  );

  app.post(
    "/api/audit/logs/delete",
    { preHandler: requireSuperAdmin() },
    async (request, reply): Promise<DeleteAuditLogsResponse | void> => {
      const body = request.body as Partial<DeleteAuditLogsRequest>;
      const ids = Array.isArray(body.ids)
        ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))]
        : [];
      if (ids.length === 0) {
        reply.code(400).send({ message: "ids are required" });
        return;
      }

      const policy = await readAuditRetentionPolicy();
      if (!policy.allowManualDelete) {
        reply.code(403).send({ message: "当前保留策略已关闭手动删除审计日志入口，请先在保留策略设置中开启。" });
        return;
      }

      const reason = body.reason?.trim() || "管理员批量删除";

      let deletableIds = ids;
      let skippedProtected = 0;

      if (policy.protectAuditTrailLogs) {
        const protectedLogs = await prisma.operationLog.findMany({
          where: {
            id: { in: ids },
            OR: [{ resourceType: "audit" }, { action: { startsWith: "audit." } }]
          },
          select: { id: true }
        });
        const protectedIdSet = new Set(protectedLogs.map((l) => l.id));
        skippedProtected = protectedIdSet.size;
        deletableIds = ids.filter((id) => !protectedIdSet.has(id));
      }

      if (deletableIds.length === 0) {
        reply.code(400).send({ message: "所选日志均为受保护的审计治理日志，无法删除。" });
        return;
      }

      const sampleLogs = await prisma.operationLog.findMany({
        where: { id: { in: deletableIds } },
        take: 10,
        select: { id: true, action: true, resourceType: true, createdAt: true }
      });

      const result = await prisma.operationLog.deleteMany({
        where: { id: { in: deletableIds } }
      });

      const auditRecord = await writeAuditLog({
        request,
        userId: request.user?.sub ?? null,
        action: "audit.logs.delete",
        resourceType: "audit",
        resourceId: "batch",
        payload: {
          mode: "batch",
          requestedCount: ids.length,
          deletedCount: result.count,
          skippedProtected,
          reason,
          sampleDeleted: sampleLogs.map((l) => ({ id: l.id, action: l.action, type: l.resourceType, at: l.createdAt.toISOString() }))
        },
        result: "SUCCESS"
      });

      return { ok: true, deleted: result.count, skippedProtected, auditRecordId: auditRecord.id };
    }
  );

  app.delete(
    "/api/audit/logs",
    { preHandler: requireSuperAdmin() },
    async (request, reply): Promise<DeleteAuditLogsResponse | void> => {
      const query = request.query as { reason?: string };
      const reason = query.reason?.trim() || "管理员清空全部日志";

      const policy = await readAuditRetentionPolicy();
      if (!policy.allowManualDelete) {
        reply.code(403).send({ message: "当前保留策略已关闭手动清空日志入口，请先在保留策略设置中开启。" });
        return;
      }

      const where: Prisma.OperationLogWhereInput = policy.protectAuditTrailLogs
        ? { NOT: { OR: [{ resourceType: "audit" }, { action: { startsWith: "audit." } }] } }
        : {};

      const totalTarget = await prisma.operationLog.count({ where });
      const result = await prisma.operationLog.deleteMany({ where });

      const auditRecord = await writeAuditLog({
        request,
        userId: request.user?.sub ?? null,
        action: "audit.logs.clear",
        resourceType: "audit",
        resourceId: "all",
        payload: {
          mode: "clear_all",
          deletedCount: result.count,
          preservedProtected: policy.protectAuditTrailLogs,
          reason
        },
        result: "SUCCESS"
      });

      return { ok: true, deleted: result.count, auditRecordId: auditRecord.id };
    }
  );

  app.get("/api/audit/saki/conversations", { preHandler: requireSuperAdmin() }, async (request): Promise<SakiAuditConversationListResponse> => {
    const query = request.query as {
      page?: string;
      limit?: string;
      userId?: string;
      instanceId?: string;
      keyword?: string;
      from?: string;
      to?: string;
    };
    const page = positiveInt(query.page, 1, 1_000_000);
    const limit = positiveInt(query.limit, 20, 100);
    const skip = (page - 1) * limit;

    const andConditions: Prisma.SakiConversationWhereInput[] = [];

    if (query.userId?.trim()) {
      andConditions.push({ userId: query.userId.trim() });
    }

    if (query.instanceId?.trim()) {
      andConditions.push({ instanceId: query.instanceId.trim() });
    }

    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      andConditions.push({
        OR: [
          { title: { contains: kw } },
          { label: { contains: kw } },
          { detail: { contains: kw } },
          { messages: { contains: kw } },
          { user: { username: { contains: kw } } },
          { user: { displayName: { contains: kw } } }
        ]
      });
    }

    if (query.from || query.to) {
      const updatedAt: Prisma.DateTimeFilter = {};
      if (query.from) {
        const fromDate = new Date(query.from);
        if (!Number.isNaN(fromDate.getTime())) updatedAt.gte = fromDate;
      }
      if (query.to) {
        const toDate = new Date(query.to);
        if (!Number.isNaN(toDate.getTime())) updatedAt.lte = toDate;
      }
      if (updatedAt.gte || updatedAt.lte) {
        andConditions.push({ updatedAt });
      }
    }

    const where: Prisma.SakiConversationWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

    const [total, rows] = await Promise.all([
      prisma.sakiConversation.count({ where }),
      prisma.sakiConversation.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarDataUrl: true
            }
          }
        }
      })
    ]);

    const instanceIds = [...new Set(rows.map((r) => r.instanceId).filter((id): id is string => Boolean(id)))];
    const instances = instanceIds.length > 0
      ? await prisma.instance.findMany({
          where: { id: { in: instanceIds } },
          select: { id: true, name: true }
        })
      : [];
    const instanceMap = new Map(instances.map((i) => [i.id, i.name]));

    const data: SakiAuditConversationItem[] = rows.map((r) => {
      let parsedMessages: any[] = [];
      try {
        parsedMessages = JSON.parse(r.messages);
      } catch {}
      if (!Array.isArray(parsedMessages)) parsedMessages = [];

      let lastMessagePreview = "";
      if (parsedMessages.length > 0) {
        const last = parsedMessages[parsedMessages.length - 1];
        lastMessagePreview = typeof last?.content === "string" ? last.content.slice(0, 150) : "";
      }

      return {
        id: r.id,
        userId: r.userId,
        username: r.user.username,
        displayName: r.user.displayName,
        avatarDataUrl: r.user.avatarDataUrl,
        contextKey: r.contextKey,
        label: r.label,
        detail: r.detail,
        instanceId: r.instanceId,
        instanceName: r.instanceId ? (instanceMap.get(r.instanceId) ?? null) : null,
        title: r.title,
        messageCount: parsedMessages.length,
        lastMessagePreview,
        messages: parsedMessages,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString()
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  });

  app.get("/api/audit/saki/conversations/:id", { preHandler: requireSuperAdmin() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.sakiConversation.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarDataUrl: true
          }
        }
      }
    });

    if (!row) {
      reply.code(404).send({ message: "Saki conversation not found" });
      return;
    }

    let instanceName: string | null = null;
    if (row.instanceId) {
      const inst = await prisma.instance.findUnique({ where: { id: row.instanceId }, select: { name: true } });
      instanceName = inst?.name ?? null;
    }

    let parsedMessages: any[] = [];
    try {
      parsedMessages = JSON.parse(row.messages);
    } catch {}
    if (!Array.isArray(parsedMessages)) parsedMessages = [];

    const item: SakiAuditConversationItem = {
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      displayName: row.user.displayName,
      avatarDataUrl: row.user.avatarDataUrl,
      contextKey: row.contextKey,
      label: row.label,
      detail: row.detail,
      instanceId: row.instanceId,
      instanceName,
      title: row.title,
      messageCount: parsedMessages.length,
      lastMessagePreview: parsedMessages[parsedMessages.length - 1]?.content?.slice(0, 150) ?? "",
      messages: parsedMessages,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };

    return item;
  });
}
