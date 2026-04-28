import os from "node:os";
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

export const daemonConfig = {
  name: process.env.DAEMON_NAME ?? "Local Daemon",
  host: process.env.DAEMON_HOST ?? "127.0.0.1",
  port: numberFromEnv(process.env.DAEMON_PORT, 24444),
  protocol: process.env.DAEMON_PROTOCOL ?? "http",
  panelUrl: process.env.DAEMON_PANEL_URL ?? "http://localhost:23333",
  registrationToken: process.env.DAEMON_REGISTRATION_TOKEN ?? "dev-registration-token",
  heartbeatSeconds: numberFromEnv(process.env.DAEMON_HEARTBEAT_SECONDS, 10),
  version: process.env.DAEMON_VERSION ?? "0.1.0",
  osName: `${os.type()} ${os.release()}`,
  arch: os.arch()
};

const daemonDataDir = path.resolve(process.env.DAEMON_DATA_DIR ?? path.resolve(rootDir, "data", "daemon"));

export const daemonPaths = {
  dataDir: daemonDataDir,
  identityFile: path.resolve(process.env.DAEMON_IDENTITY_FILE ?? path.resolve(daemonDataDir, "identity.json")),
  workspaceDir: path.resolve(process.env.DAEMON_WORKSPACE_ROOT ?? path.resolve(rootDir, "data", "daemon", "workspace"))
};
