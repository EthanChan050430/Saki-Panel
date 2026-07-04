import fs from "node:fs";
import type { ServerOptions } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hostListFromEnv(value: string | undefined): string[] | true {
  if (!value) return true;
  const entries = value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (entries.some((item) => ["*", "true", "1"].includes(item.toLowerCase()))) return true;

  const hosts = entries
    .map((item) => {
      if (item.startsWith(".")) return item;
      try {
        return new URL(item.includes("://") ? item : `http://${item}`).hostname;
      } catch {
        return item.replace(/:\d+$/, "");
      }
    })
    .filter(Boolean);

  return hosts.length > 0 ? hosts : true;
}

interface SslFile {
  path: string;
  name: string;
  content: string;
}

const certificateExtensions = new Set([".pem", ".crt", ".cer"]);
const tlsFileExtensions = new Set([...certificateExtensions, ".key"]);

function hasCertificate(content: string): boolean {
  return /-----BEGIN CERTIFICATE-----/.test(content);
}

function hasPrivateKey(content: string): boolean {
  return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(content);
}

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolveSslDir(rootDir: string): string {
  const configured = process.env.SSL_DIR?.trim();
  if (!configured) return path.resolve(rootDir, "ssl");
  return path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured);
}

function resolveConfiguredFile(rootDir: string, sslDir: string, value: string | undefined): string | null {
  const configured = value?.trim();
  if (!configured) return null;
  if (path.isAbsolute(configured)) return configured;
  const hasDirectory = configured.includes("/") || configured.includes("\\");
  return path.resolve(hasDirectory ? rootDir : sslDir, configured);
}

function readSslFiles(sslDir: string): SslFile[] {
  try {
    return fs
      .readdirSync(sslDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && tlsFileExtensions.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => {
        const filePath = path.resolve(sslDir, entry.name);
        return {
          path: filePath,
          name: entry.name,
          content: readTextFile(filePath) ?? ""
        };
      })
      .filter((file) => hasCertificate(file.content) || hasPrivateKey(file.content))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function isCaBundle(file: SslFile): boolean {
  const name = file.name.toLowerCase();
  if (name.includes("fullchain")) return false;
  return /(^|[-_.])(ca|chain|bundle|intermediate)([-_.]|$)/.test(name);
}

function pickKeyFile(files: SslFile[]): SslFile | null {
  const keyFiles = files.filter((file) => hasPrivateKey(file.content));
  return (
    keyFiles.find((file) => /(^|[-_.])(privkey|private|key)([-_.]|$)/i.test(file.name)) ??
    keyFiles[0] ??
    null
  );
}

function pickCertFile(files: SslFile[]): SslFile | null {
  const certFiles = files.filter((file) => hasCertificate(file.content) && !hasPrivateKey(file.content));
  const nonCaFiles = certFiles.filter((file) => !isCaBundle(file));
  const candidates = nonCaFiles.length > 0 ? nonCaFiles : certFiles;
  return (
    candidates.find((file) => /(^|[-_.])(fullchain|cert|certificate|server)([-_.]|$)/i.test(file.name)) ??
    candidates[0] ??
    null
  );
}

function pickCaFile(files: SslFile[], certPath: string): SslFile | null {
  return files.find((file) => file.path !== certPath && hasCertificate(file.content) && isCaBundle(file)) ?? null;
}

function appendCaBundle(cert: string, ca: string | null): string {
  if (!ca) return cert;
  const trimmedCa = ca.trim();
  if (!trimmedCa || cert.includes(trimmedCa)) return cert;
  return `${cert.trimEnd()}\n${trimmedCa}\n`;
}

function loadHttpsOptions(rootDir: string): ServerOptions | undefined {
  const sslDir = resolveSslDir(rootDir);
  const configuredCertPath = resolveConfiguredFile(rootDir, sslDir, process.env.SSL_CERT_FILE);
  const configuredKeyPath = resolveConfiguredFile(rootDir, sslDir, process.env.SSL_KEY_FILE);
  const configuredCaPath = resolveConfiguredFile(rootDir, sslDir, process.env.SSL_CA_FILE);
  const files = readSslFiles(sslDir);
  const certPath = configuredCertPath ?? pickCertFile(files)?.path;
  const keyPath = configuredKeyPath ?? pickKeyFile(files)?.path;
  const caPath = configuredCaPath ?? (certPath ? pickCaFile(files, certPath)?.path : null);
  if (!certPath || !keyPath) return undefined;

  const cert = readTextFile(certPath);
  const key = readTextFile(keyPath);
  if (!cert || !key || !hasCertificate(cert) || !hasPrivateKey(key)) return undefined;

  const ca = caPath ? readTextFile(caPath) : null;
  const passphrase = process.env.SSL_PASSPHRASE?.trim();
  return {
    key,
    cert: appendCaBundle(cert, ca),
    ...(passphrase ? { passphrase } : {})
  };
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const host = process.env.VITE_HOST ?? "0.0.0.0";
const allowedHosts = hostListFromEnv(process.env.VITE_ALLOWED_HOSTS);
const port = numberFromEnv(process.env.VITE_PORT ?? process.env.PORT, 5478);
const panelPort = numberFromEnv(process.env.PANEL_PORT, 5479);
const https = loadHttpsOptions(rootDir);
const panelTarget = `${https ? "https" : "http"}://127.0.0.1:${panelPort}`;
const devProxy = {
  "/api": { target: panelTarget, changeOrigin: true },
  "/ws": { target: panelTarget, ws: true, changeOrigin: true },
  "/health": { target: panelTarget, changeOrigin: true }
} as const;

function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");
  if (!normalizedId.includes("node_modules")) return undefined;
  if (
    normalizedId.includes("/react/") ||
    normalizedId.includes("/react-dom/") ||
    normalizedId.includes("/scheduler/")
  ) return "vendor-react";
  if (normalizedId.includes("/@codemirror/lang-")) return "vendor-editor-languages";
  if (
    normalizedId.includes("/@codemirror/") ||
    normalizedId.includes("/codemirror/") ||
    normalizedId.includes("/@lezer/")
  ) return "vendor-editor";
  if (normalizedId.includes("/@xterm/")) return "vendor-terminal";
  if (normalizedId.includes("/recharts/") || normalizedId.includes("/d3-") || normalizedId.includes("/victory-vendor/")) {
    return "vendor-charts";
  }
  if (normalizedId.includes("/lucide-react/")) return "vendor-icons";
  return "vendor";
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  },
  server: {
    host,
    allowedHosts,
    port,
    strictPort: true,
    proxy: devProxy,
    ...(https ? { https } : {})
  },
  preview: {
    host,
    allowedHosts,
    port,
    strictPort: true,
    proxy: devProxy,
    ...(https ? { https } : {})
  }
});
