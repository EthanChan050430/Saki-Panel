import type { FastifyInstance } from "fastify";
import type { CreateUserAccessKeyResponse, UserAccessKeyInfo } from "@webops/shared";
import { prisma } from "../db.js";
import { authenticate } from "../auth.js";
import { generateSecretToken, hashToken, tokenLast4 } from "../security.js";
import { writeAuditLog } from "../audit.js";

export async function registerUserKeyRoutes(app: FastifyInstance): Promise<void> {
  // List current user's access keys
  app.get("/api/user/keys", { preHandler: authenticate }, async (request): Promise<UserAccessKeyInfo[]> => {
    const userId = request.user.sub;
    const keys = await prisma.userAccessKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyLast4: k.keyLast4,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null
    }));
  });

  // Create a new unique access key for current user
  app.post("/api/user/keys", { preHandler: authenticate }, async (request, reply): Promise<CreateUserAccessKeyResponse | void> => {
    const userId = request.user.sub;
    const body = request.body as { name?: string } | undefined;
    const keyName = body?.name?.trim() || "默认专属密钥";

    const rawHex = generateSecretToken();
    const rawKey = `saki_usr_${rawHex}`;
    const keyHashed = hashToken(rawKey);
    const last4 = rawKey.slice(-4);

    const created = await prisma.userAccessKey.create({
      data: {
        userId,
        name: keyName,
        keyHash: keyHashed,
        keyLast4: last4
      }
    });

    await writeAuditLog({
      request,
      userId,
      action: "user.access_key_create",
      resourceType: "user_access_key",
      resourceId: created.id,
      payload: { name: keyName }
    });

    const keyInfo: UserAccessKeyInfo = {
      id: created.id,
      name: created.name,
      keyLast4: created.keyLast4,
      createdAt: created.createdAt.toISOString(),
      lastUsedAt: null,
      expiresAt: null
    };

    return {
      keyInfo,
      rawKey
    };
  });

  // Revoke/delete a user access key
  app.delete("/api/user/keys/:id", { preHandler: authenticate }, async (request, reply): Promise<{ ok: boolean } | void> => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };

    const key = await prisma.userAccessKey.findFirst({
      where: { id, userId }
    });

    if (!key) {
      reply.code(404).send({ message: "密钥不存在或无权操作" });
      return;
    }

    await prisma.userAccessKey.delete({
      where: { id }
    });

    await writeAuditLog({
      request,
      userId,
      action: "user.access_key_delete",
      resourceType: "user_access_key",
      resourceId: id,
      payload: { name: key.name }
    });

    return { ok: true };
  });
}
