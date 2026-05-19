import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import type { ServerOptions } from "node:https";
import path from "node:path";

export interface SslConfig {
  certPath: string;
  keyPath: string;
  caPath?: string;
  hostname?: string;
  https: ServerOptions;
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

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
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

function parseCertificateHostname(cert: string): string | undefined {
  try {
    const parsed = new X509Certificate(cert);
    const dnsName = parsed.subjectAltName
      ?.split(",")
      .map((item) => item.trim())
      .find((item) => item.startsWith("DNS:"))
      ?.slice(4)
      .trim();
    if (dnsName && !dnsName.startsWith("*.")) return dnsName;

    const commonName = /(?:^|\n|,\s*)CN\s*=\s*([^,\n]+)/.exec(parsed.subject)?.[1]?.trim();
    if (commonName && !commonName.startsWith("*.")) return commonName;
  } catch {
    return undefined;
  }
  return undefined;
}

function configFromFiles(certPath: string, keyPath: string, caPath: string | null): SslConfig | null {
  const cert = readTextFile(certPath);
  const key = readTextFile(keyPath);
  if (!cert || !key || !hasCertificate(cert) || !hasPrivateKey(key)) return null;

  const ca = caPath ? readTextFile(caPath) : null;
  const passphrase = process.env.SSL_PASSPHRASE?.trim();
  const httpsOptions: ServerOptions = {
    key,
    cert: appendCaBundle(cert, ca)
  };
  if (passphrase) {
    httpsOptions.passphrase = passphrase;
  }

  const config: SslConfig = {
    certPath,
    keyPath,
    https: httpsOptions
  };
  if (caPath) {
    config.caPath = caPath;
  }
  const hostname = parseCertificateHostname(cert);
  if (hostname) {
    config.hostname = hostname;
  }
  return config;
}

export function loadSslConfig(rootDir: string): SslConfig | null {
  const sslDir = resolveSslDir(rootDir);
  const configuredCertPath = resolveConfiguredFile(rootDir, sslDir, process.env.SSL_CERT_FILE);
  const configuredKeyPath = resolveConfiguredFile(rootDir, sslDir, process.env.SSL_KEY_FILE);
  const configuredCaPath = resolveConfiguredFile(rootDir, sslDir, process.env.SSL_CA_FILE);

  if (configuredCertPath && configuredKeyPath) {
    return configFromFiles(configuredCertPath, configuredKeyPath, configuredCaPath);
  }

  const files = readSslFiles(sslDir);
  const certFile = pickCertFile(files);
  const keyFile = pickKeyFile(files);
  if (!certFile || !keyFile) return null;

  return configFromFiles(certFile.path, keyFile.path, configuredCaPath ?? pickCaFile(files, certFile.path)?.path ?? null);
}
