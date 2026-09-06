import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadSslConfig } from "./ssl.js";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function listFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.resolve(rootDir, ".env") });

const ssl = loadSslConfig(rootDir);
const transportProtocol = ssl ? "https" : "http";
const panelPort = numberFromEnv(process.env.PANEL_PORT, 5479);
const webPort = numberFromEnv(process.env.VITE_PORT ?? process.env.WEB_PORT, 5478);
const defaultPublicHost = ssl?.hostname ?? "localhost";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function normalizeServiceUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  if (!ssl) return raw;

  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "https:";
    if (ssl.hostname && isLoopbackHostname(url.hostname)) {
      url.hostname = ssl.hostname;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/^http:\/\//i, "https://");
  }
}

const publicUrl = normalizeServiceUrl(
  process.env.PANEL_PUBLIC_URL,
  `${transportProtocol}://${defaultPublicHost}:${panelPort}`
);
const webOrigin = normalizeServiceUrl(process.env.WEB_ORIGIN, `${transportProtocol}://${defaultPublicHost}:${webPort}`);
const configuredCorsOrigins = listFromEnv(process.env.PANEL_CORS_ORIGINS);
const corsOrigins = Array.from(
  new Set([...configuredCorsOrigins, ...configuredCorsOrigins.map((origin) => normalizeServiceUrl(origin, origin)), webOrigin, publicUrl])
);

export const panelConfig = {
  host: process.env.PANEL_HOST ?? "0.0.0.0",
  port: panelPort,
  protocol: transportProtocol,
  https: ssl?.https,
  ssl,
  publicUrl,
  webOrigin,
  corsOrigins,
  hasExplicitCorsOrigins: configuredCorsOrigins.length > 0,
  databaseUrl: process.env.DATABASE_URL ?? "file:../data/panel/dev.db",
  jwtSecret: process.env.JWT_SECRET ?? "dev-panel-secret-change-me",
  disableAuth: booleanFromEnv(process.env.DISABLE_AUTH),
  sessionTimeoutMinutes: numberFromEnv(process.env.SESSION_TIMEOUT_MINUTES, 120),
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin123456",
  daemonRegistrationToken: process.env.DAEMON_REGISTRATION_TOKEN ?? "dev-registration-token",
  heartbeatOfflineSeconds: numberFromEnv(process.env.HEARTBEAT_OFFLINE_SECONDS, 45),
  daemonHeartbeatSeconds: numberFromEnv(process.env.DAEMON_HEARTBEAT_SECONDS, 10),
  maxTransferBytes: numberFromEnv(process.env.MAX_TRANSFER_LIMIT_MB || process.env.MAX_TRANSFER_MB, 2048) * 1024 * 1024,
  maxExtractedBytes: numberFromEnv(process.env.MAX_EXTRACTED_LIMIT_MB || process.env.MAX_EXTRACT_MB, 51200) * 1024 * 1024,
  maxArchiveEntries: numberFromEnv(process.env.MAX_ARCHIVE_ENTRIES, 200000),
  sakiProvider: process.env.SAKI_PROVIDER,
  sakiModel: process.env.SAKI_MODEL,
  sakiOllamaUrl: process.env.SAKI_OLLAMA_URL,
  sakiRequestTimeoutMs: numberFromEnv(process.env.SAKI_REQUEST_TIMEOUT_MS, 180000),
  githubOAuthClientId: process.env.GITHUB_OAUTH_CLIENT_ID,
  githubOAuthScope: process.env.GITHUB_OAUTH_SCOPE ?? "read:user"
};

export const isProduction = process.env.NODE_ENV?.toLowerCase() === "production";

export const panelPaths = {
  dataDir: path.resolve(rootDir, "data", "panel"),
  sessionSettingsFile: path.resolve(rootDir, "data", "panel", "session-settings.json"),
  sakiConfigFile: path.resolve(rootDir, "data", "panel", "saki-settings.json"),
  sakiSkillsDir: path.resolve(rootDir, "data", "panel", "saki-skills")
};
