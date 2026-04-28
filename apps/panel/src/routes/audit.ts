import type { FastifyInstance } from "fastify";
import type { AuditLogEntry, DeleteAuditLogsRequest, DeleteAuditLogsResponse } from "@webops/shared";
import { prisma } from "../db.js";
import { requirePermission, requireSuperAdmin } from "../auth.js";

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audit/logs", { preHandler: requirePermission("audit.view") }, async (request) => {
    const query = request.query as {
      action?: string;
      resourceType?: string;
      result?: "SUCCESS" | "FAILURE";
      page?: string;
      limit?: string;
    };
    
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.max(1, Math.min(Number(query.limit ?? 20) || 20, 100));
    const skip = (page - 1) * limit;

    const whereParams = {
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.result ? { result: query.result } : {})
    };

    const [total, logs] = await Promise.all([
      prisma.operationLog.count({ where: whereParams }),
      prisma.operationLog.findMany({
        where: whereParams,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: skip,
        include: { user: true }
      })
    ]);

    const data = logs.map(
      (log): AuditLogEntry => ({
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
        createdAt: log.createdAt.toISOString()
      })
    );
    
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  app.delete(
    "/api/audit/logs/:id",
    { preHandler: requireSuperAdmin() },
    async (request): Promise<DeleteAuditLogsResponse> => {
      const { id } = request.params as { id: string };
      const result = await prisma.operationLog.deleteMany({
        where: { id }
      });
      return { ok: true, deleted: result.count };
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

      const result = await prisma.operationLog.deleteMany({
        where: { id: { in: ids } }
      });
      return { ok: true, deleted: result.count };
    }
  );

  app.delete(
    "/api/audit/logs",
    { preHandler: requireSuperAdmin() },
    async (): Promise<DeleteAuditLogsResponse> => {
      const result = await prisma.operationLog.deleteMany();
      return { ok: true, deleted: result.count };
    }
  );
}
