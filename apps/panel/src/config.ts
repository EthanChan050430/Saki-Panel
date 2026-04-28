import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.resolve(rootDir, ".env") });

export const panelConfig = {
  host: process.env.PANEL_HOST ?? "0.0.0.0",
  port: numberFromEnv(process.env.PANEL_PORT, 23333),
  publicUrl: process.env.PANEL_PUBLIC_URL ?? "http://localhost:23333",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "file:../data/panel/dev.db",
  jwtSecret: process.env.JWT_SECRET ?? "dev-panel-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin123456",
  daemonRegistrationToken: process.env.DAEMON_REGISTRATION_TOKEN ?? "dev-registration-token",
  heartbeatOfflineSeconds: numberFromEnv(process.env.HEARTBEAT_OFFLINE_SECONDS, 45),
  daemonHeartbeatSeconds: numberFromEnv(process.env.DAEMON_HEARTBEAT_SECONDS, 10),
  sakiProvider: process.env.SAKI_PROVIDER,
  sakiModel: process.env.SAKI_MODEL,
  sakiOllamaUrl: process.env.SAKI_OLLAMA_URL,
  sakiRequestTimeoutMs: numberFromEnv(process.env.SAKI_REQUEST_TIMEOUT_MS, 120000)
};

export const panelPaths = {
  dataDir: path.resolve(rootDir, "data", "panel"),
  sakiConfigFile: path.resolve(rootDir, "data", "panel", "saki-settings.json"),
  sakiSkillsDir: path.resolve(rootDir, "data", "panel", "saki-skills")
};
