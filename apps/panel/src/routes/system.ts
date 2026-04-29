import type { FastifyInstance } from "fastify";
import type { UpdatePanelSessionSettingsRequest } from "@webops/shared";
import { loadCurrentUser } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { readPanelSessionSettings, savePanelSessionSettings } from "../session.js";

function errorStatus(error: unknown): number {
  return typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
}

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/system/session-settings", { preHandler: app.authenticate }, async () => {
    return readPanelSessionSettings();
  });

  app.put("/api/system/session-settings", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user || user.status !== "ACTIVE" || !user.isAdmin) {
      reply.code(403).send({ message: "Administrator privileges are required" });
      return;
    }

    try {
      const body = (request.body ?? {}) as UpdatePanelSessionSettingsRequest;
      const saved = await savePanelSessionSettings(body);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "system.session_settings.update",
        resourceType: "system",
        payload: {
          sessionTimeoutMinutes: saved.sessionTimeoutMinutes
        }
      });
      return saved;
    } catch (error) {
      reply.code(errorStatus(error)).send({
        message: error instanceof Error ? error.message : "Session settings update failed"
      });
    }
  });
}
