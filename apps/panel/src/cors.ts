import type { FastifyReply, FastifyRequest } from "fastify";
import { panelConfig } from "./config.js";

export const panelCorsMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
const panelCorsHeaders = "authorization, content-type, x-api-key, x-user-key, x-requested-with";

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

function isAllowedOrigin(origin: string): boolean {
  if (panelConfig.corsOrigins.includes(origin)) return true;
  if (panelConfig.corsOrigins.includes("*")) return true;
  // Unconfigured installs are commonly opened via LAN IPs that are not
  // WEB_ORIGIN. Keep that working unless an explicit origin list is set.
  if (!panelConfig.hasExplicitCorsOrigins) return true;
  return false;
}

export function resolvePanelCorsOrigin(request: FastifyRequest): string | false {
  const origin = normalizeOrigin(firstHeaderValue(request.headers.origin));
  if (!origin || origin === "*") return false;
  return isAllowedOrigin(origin) ? origin : false;
}

export function applyPanelCorsHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const origin = resolvePanelCorsOrigin(request);
  if (origin) {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
  }
  reply.header("Access-Control-Allow-Credentials", "true");
  reply.header("Access-Control-Allow-Methods", panelCorsMethods.join(", "));
  reply.header("Access-Control-Allow-Headers", panelCorsHeaders);
  reply.header("Access-Control-Max-Age", "86400");
}
