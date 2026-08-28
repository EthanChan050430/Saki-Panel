import type { FastifyInstance } from "fastify";
import type { UpdateUserPointsRequest } from "@webops/shared";
import { loadCurrentUser, requirePermission } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import {
  adminUpdateUserPoints,
  getTargetUserPointRecords,
  getUserPointsSummary
} from "../points.js";

export async function registerPointsRoutes(app: FastifyInstance): Promise<void> {
  // 当前登录用户获取自己的积分与图表统计
  app.get("/api/points/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "未授权" });
      return;
    }
    const summary = await getUserPointsSummary(user.id);
    return summary;
  });

  // 管理员调整目标用户的积分 / 设置无限积分
  app.post<{ Params: { id: string }; Body: UpdateUserPointsRequest }>(
    "/api/users/:id/points",
    { preHandler: [app.authenticate, requirePermission("user.update")] },
    async (request, reply) => {
      const operator = await loadCurrentUser(request.user.sub);
      if (!operator || !operator.isAdmin) {
        reply.code(403).send({ message: "只有管理员可以管理用户积分" });
        return;
      }

      const targetUserId = request.params.id;
      const body = request.body || {};

      try {
        const result = await adminUpdateUserPoints(targetUserId, operator.displayName || operator.username, body);
        await writeAuditLog({
          request,
          userId: operator.id,
          action: "user.points.update",
          resourceType: "user",
          resourceId: targetUserId,
          payload: body
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "积分更新失败";
        reply.code(400).send({ message });
      }
    }
  );

  // 管理员获取指定用户的积分流水与消耗记录
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/users/:id/points/records",
    { preHandler: [app.authenticate, requirePermission("user.view")] },
    async (request, reply) => {
      const operator = await loadCurrentUser(request.user.sub);
      if (!operator || !operator.isAdmin) {
        reply.code(403).send({ message: "只有管理员可以查看用户积分记录" });
        return;
      }

      const targetUserId = request.params.id;
      const limit = Number(request.query.limit) || 50;

      try {
        const records = await getTargetUserPointRecords(targetUserId, limit);
        return records;
      } catch (err) {
        const message = err instanceof Error ? err.message : "获取积分记录失败";
        reply.code(400).send({ message });
      }
    }
  );
}
