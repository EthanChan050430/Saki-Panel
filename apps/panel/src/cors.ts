import type { FastifyRequest } from "fastify";
import { panelConfig } from "./config.js";

export const panelCorsMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  if (value === "*") return "*";
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hostNameFromHeader(value: string | string[] | undefined): string | null {
  const host = firstHeaderValue(value).split(",")[0]?.trim();
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

const configuredOrigins = new Set<string>();
let allowAnyOrigin = false;

for (const value of panelConfig.corsOrigins) {
  const origin = normalizeOrigin(value);
  if (!origin) continue;
  if (origin === "*") {
    allowAnyOrigin = true;
  } else {
    configuredOrigins.add(origin);
  }
}

function hasSameHostnameAsApi(origin: string, request: FastifyRequest): boolean {
  let originHost = "";
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return false;
  }

  const forwardedHost = hostNameFromHeader(request.headers["x-forwarded-host"]);
  const requestHost = hostNameFromHeader(request.headers.host);
  return originHost === forwardedHost || originHost === requestHost;
}

export function resolvePanelCorsOrigin(request: FastifyRequest): string | false {
  const origin = normalizeOrigin(firstHeaderValue(request.headers.origin));
  if (!origin || origin === "*") return false;
  if (allowAnyOrigin || configuredOrigins.has(origin) || hasSameHostnameAsApi(origin, request)) return origin;
  return false;
}
