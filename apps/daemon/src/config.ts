import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadSslConfig } from "./ssl.js";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.resolve(rootDir, ".env") });

const ssl = loadSslConfig(rootDir);
const transportProtocol = ssl ? "https" : "http";
const daemonPort = numberFromEnv(process.env.DAEMON_PORT, 5480);
const panelPort = numberFromEnv(process.env.PANEL_PORT, 5479);
const listenHost = process.env.DAEMON_HOST ?? "127.0.0.1";
const defaultReachableHost = listenHost;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function normalizeServiceUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  if (!ssl) return raw;

  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/^http:\/\//i, "https://");
  }
}

export const daemonConfig = {
  name: process.env.DAEMON_NAME ?? "Local Daemon",
  host: listenHost,
  publicHost: process.env.DAEMON_PUBLIC_HOST ?? defaultReachableHost,
  port: daemonPort,
  protocol: ssl ? "https" : process.env.DAEMON_PROTOCOL ?? "http",
  panelUrl: normalizeServiceUrl(
    process.env.DAEMON_PANEL_URL,
    `${transportProtocol}://127.0.0.1:${panelPort}`
  ),
  https: ssl?.https,
  ssl,
  registrationToken: process.env.DAEMON_REGISTRATION_TOKEN ?? "dev-registration-token",
  heartbeatSeconds: numberFromEnv(process.env.DAEMON_HEARTBEAT_SECONDS, 10),
  maxTransferBytes: numberFromEnv(process.env.MAX_TRANSFER_LIMIT_MB || process.env.MAX_TRANSFER_MB, 100) * 1024 * 1024,
  maxExtractedBytes: numberFromEnv(process.env.MAX_EXTRACTED_LIMIT_MB || process.env.MAX_EXTRACT_MB, 512) * 1024 * 1024,
  maxArchiveEntries: numberFromEnv(process.env.MAX_ARCHIVE_ENTRIES, 5000),
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
