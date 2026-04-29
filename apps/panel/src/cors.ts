import type { FastifyReply, FastifyRequest } from "fastify";

export const panelCorsMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  if (value === "*") return "*";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolvePanelCorsOrigin(request: FastifyRequest): string | false {
  const origin = normalizeOrigin(firstHeaderValue(request.headers.origin));
  if (!origin || origin === "*") return false;
  return origin;
}

export function applyPanelCorsHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const origin = resolvePanelCorsOrigin(request);
  if (origin) {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
  }
  reply.header("Access-Control-Allow-Credentials", "true");
  reply.header("Access-Control-Allow-Methods", panelCorsMethods.join(", "));
  reply.header(
    "Access-Control-Allow-Headers",
    firstHeaderValue(request.headers["access-control-request-headers"]) || "authorization, content-type"
  );
  reply.header("Access-Control-Max-Age", "86400");
}
