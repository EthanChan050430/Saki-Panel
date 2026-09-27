import type { FastifyRequest } from "fastify";
import type { OperationResult } from "@prisma/client";
import { prisma } from "./db.js";

interface AuditInput {
  request?: FastifyRequest | undefined;
  userId?: string | null | undefined;
  action: string;
  resourceType: string;
  resourceId?: string | null | undefined;
  payload?: unknown | undefined;
  result?: OperationResult | undefined;
}

export async function writeAuditLog(input: AuditInput) {
  const ip = input.request?.ip ?? null;
  const userAgent = input.request?.headers["user-agent"];
  const normalizedUserAgent = Array.isArray(userAgent) ? userAgent.join(",") : (userAgent ?? null);

  return prisma.operationLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      ip,
      userAgent: normalizedUserAgent,
      payload: input.payload === undefined ? null : JSON.stringify(input.payload),
      result: input.result ?? "SUCCESS"
    }
  });
}
