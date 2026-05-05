import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

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

const publicUrl = process.env.PANEL_PUBLIC_URL ?? "http://localhost:5479";
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5478";
const configuredCorsOrigins = listFromEnv(process.env.PANEL_CORS_ORIGINS);
const corsOrigins = Array.from(new Set([...configuredCorsOrigins, webOrigin, publicUrl]));

export const panelConfig = {
  host: process.env.PANEL_HOST ?? "0.0.0.0",
  port: numberFromEnv(process.env.PANEL_PORT, 5479),
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
  sakiProvider: process.env.SAKI_PROVIDER,
  sakiModel: process.env.SAKI_MODEL,
  sakiOllamaUrl: process.env.SAKI_OLLAMA_URL,
  sakiRequestTimeoutMs: numberFromEnv(process.env.SAKI_REQUEST_TIMEOUT_MS, 180000),
  githubOAuthClientId: process.env.GITHUB_OAUTH_CLIENT_ID,
  githubOAuthScope: process.env.GITHUB_OAUTH_SCOPE ?? "read:user"
};

export const panelPaths = {
  dataDir: path.resolve(rootDir, "data", "panel"),
  sessionSettingsFile: path.resolve(rootDir, "data", "panel", "session-settings.json"),
  sakiConfigFile: path.resolve(rootDir, "data", "panel", "saki-settings.json"),
  sakiSkillsDir: path.resolve(rootDir, "data", "panel", "saki-skills")
};
