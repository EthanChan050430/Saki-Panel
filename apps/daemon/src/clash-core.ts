import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import net from "node:net";
import { execFile } from "node:child_process";
import type { ClashSubscriptionProxy, InstanceProxyConfig } from "@webops/shared";
import { daemonPaths } from "./config.js";

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const require = createRequire(import.meta.url);
const { path7za } = require("7zip-bin") as { path7za: string };

export interface ClashProxyRecord {
  name: string;
  type: string;
  [key: string]: unknown;
}

interface ClashRuntime {
  process: ChildProcess;
  port: number;
  selected: string;
  url: string;
}

const runtimes = new Map<string, ClashRuntime>();
const subscriptionCache = new Map<string, { fetchedAt: number; proxies: ClashProxyRecord[] }>();
const cacheTtlMs = 10 * 60 * 1000;

function clashDir(instanceId: string): string {
  return path.join(daemonPaths.dataDir, "clash", instanceId);
}

function binDir(): string {
  return path.join(daemonPaths.dataDir, "bin");
}

function mihomoBinaryName(): string {
  return process.platform === "win32" ? "mihomo.exe" : "mihomo";
}

function summarizeProxy(proxy: ClashProxyRecord): ClashSubscriptionProxy {
  const summary: ClashSubscriptionProxy = {
    name: proxy.name,
    type: proxy.type
  };
  if (typeof proxy.server === "string" && proxy.server) summary.server = proxy.server;
  const port = typeof proxy.port === "number" ? proxy.port : Number(proxy.port);
  if (port) summary.port = port;
  return summary;
}

function yamlQuote(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (text === "" || /[:#{}[\],&*?|<>=!%@`'"\\]/.test(text) || /^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function dumpYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
          if (entries.length === 0) return `${pad}- {}`;
          const [first, ...rest] = entries;
          const [fk, fv] = first!;
          const head = `${pad}- ${fk}: ${typeof fv === "object" ? dumpYaml(fv, indent + 4).trimStart() : yamlQuote(fv)}`;
          const tail = rest
            .map(([k, v]) => {
              if (v && typeof v === "object") {
                const nested = dumpYaml(v, indent + 4);
                return `${pad}  ${k}:\n${nested}`;
              }
              return `${pad}  ${k}: ${yamlQuote(v)}`;
            })
            .join("\n");
          return tail ? `${head}\n${tail}` : head;
        }
        return `${pad}- ${yamlQuote(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (v && typeof v === "object") {
          const nested = dumpYaml(v, indent + 2);
          return `${pad}${k}:\n${nested}`;
        }
        return `${pad}${k}: ${yamlQuote(v)}`;
      })
      .join("\n");
  }
  return `${pad}${yamlQuote(value)}`;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (!value || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value.replace(/^'/, "\"").replace(/'$/, "\""));
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseFlowMap(text: string): Record<string, unknown> {
  const inner = text.trim().replace(/^\{/, "").replace(/\}$/, "");
  const obj: Record<string, unknown> = {};
  let buf = "";
  let depth = 0;
  const parts: string[] = [];
  for (const ch of inner) {
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    obj[key] = parseScalar(part.slice(idx + 1));
  }
  return obj;
}

function parseYamlProxyList(yaml: string): ClashProxyRecord[] {
  const start = yaml.search(/^proxies:\s*$/m);
  const sliced = start >= 0 ? yaml.slice(yaml.indexOf("\n", start) + 1) : yaml;
  const lines: string[] = [];
  for (const line of sliced.split(/\r?\n/)) {
    if (/^[A-Za-z][\w-]*:\s*$/.test(line) && !line.startsWith(" ") && !line.startsWith("-")) break;
    lines.push(line);
  }
  const body = lines.join("\n");
  const chunks = body.split(/^\s*-\s+/m).map((chunk) => chunk.trim()).filter(Boolean);
  const proxies: ClashProxyRecord[] = [];
  for (const chunk of chunks) {
    let record: Record<string, unknown>;
    if (chunk.startsWith("{")) {
      record = parseFlowMap(chunk.split(/\n/)[0] ?? chunk);
    } else {
      record = {};
      const nested: Record<string, Record<string, unknown>> = {};
      let currentNested: string | null = null;
      for (const line of chunk.split(/\n/)) {
        if (!line.trim()) continue;
        const nestedHeader = line.match(/^\s{2,4}([\w-]+):\s*$/);
        if (nestedHeader) {
          currentNested = nestedHeader[1] ?? null;
          if (currentNested) nested[currentNested] = {};
          continue;
        }
        const nestedKv = line.match(/^\s{4,8}([\w-]+):\s*(.*)$/);
        if (nestedKv && currentNested) {
          nested[currentNested]![nestedKv[1] ?? ""] = parseScalar(nestedKv[2] ?? "");
          continue;
        }
        const kv = line.match(/^([\w-]+):\s*(.*)$/);
        if (kv) {
          currentNested = null;
          record[kv[1] ?? ""] = parseScalar(kv[2] ?? "");
        }
      }
      Object.assign(record, nested);
    }
    const name = String(record.name || "").trim();
    const type = String(record.type || "").trim();
    if (name && type) proxies.push({ ...record, name, type });
  }
  return proxies;
}

function decodeShareName(url: URL, fallback: string): string {
  const hash = url.hash.replace(/^#/, "");
  if (!hash) return fallback;
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function parseShareUri(line: string): ClashProxyRecord | null {
  const text = line.trim();
  if (!text || text.startsWith("#")) return null;
  try {
    if (text.startsWith("ss://")) {
      const raw = text.slice("ss://".length);
      const hashIdx = raw.indexOf("#");
      const main = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
      const nameHint = hashIdx >= 0 ? decodeURIComponent(raw.slice(hashIdx + 1)) : "";
      let method = "";
      let password = "";
      let host = "";
      let port = 0;
      if (main.includes("@")) {
        const [userPart, hostPart] = main.split("@");
        const decoded = userPart!.includes(":") ? userPart! : Buffer.from(userPart!, "base64").toString("utf8");
        const [m, p] = decoded.split(":");
        method = m ?? "";
        password = p ?? "";
        const hp = hostPart!.split(":");
        host = hp[0] ?? "";
        port = Number(hp[1]) || 0;
      } else {
        const decoded = Buffer.from(main, "base64").toString("utf8");
        const at = decoded.lastIndexOf("@");
        const [mp, hostPart] = [decoded.slice(0, at), decoded.slice(at + 1)];
        const [m, p] = mp.split(":");
        method = m ?? "";
        password = p ?? "";
        const hp = hostPart.split(":");
        host = hp[0] ?? "";
        port = Number(hp[1]) || 0;
      }
      if (!host || !port) return null;
      return {
        name: nameHint || `ss-${host}-${port}`,
        type: "ss",
        server: host,
        port,
        cipher: method,
        password
      };
    }
    if (text.startsWith("vmess://")) {
      const json = JSON.parse(Buffer.from(text.slice("vmess://".length), "base64").toString("utf8")) as Record<string, unknown>;
      const host = String(json.add || json.host || "");
      const port = Number(json.port) || 0;
      if (!host || !port) return null;
      const network = String(json.net || "tcp");
      const record: ClashProxyRecord = {
        name: String(json.ps || `vmess-${host}-${port}`),
        type: "vmess",
        server: host,
        port,
        uuid: String(json.id || ""),
        alterId: Number(json.aid) || 0,
        cipher: String(json.scy || "auto"),
        network,
        tls: json.tls === "tls" || json.tls === true,
        udp: true
      };
      if (json.sni) record.servername = String(json.sni);
      if (network === "ws") {
        record["ws-opts"] = {
          path: String(json.path || "/"),
          headers: json.host ? { Host: String(json.host) } : undefined
        };
      }
      return record;
    }
    if (text.startsWith("trojan://") || text.startsWith("vless://") || text.startsWith("hysteria2://") || text.startsWith("hy2://")) {
      const normalized = text.replace(/^hy2:/, "hysteria2:");
      const url = new URL(normalized);
      const host = url.hostname;
      const port = Number(url.port) || 443;
      if (!host) return null;
      if (normalized.startsWith("trojan://")) {
        return {
          name: decodeShareName(url, `trojan-${host}-${port}`),
          type: "trojan",
          server: host,
          port,
          password: decodeURIComponent(url.username),
          sni: url.searchParams.get("sni") || url.searchParams.get("peer") || host,
          "skip-cert-verify": url.searchParams.get("allowInsecure") === "1"
        };
      }
      if (normalized.startsWith("vless://")) {
        const security = url.searchParams.get("security") || "none";
        const network = url.searchParams.get("type") || "tcp";
        const record: ClashProxyRecord = {
          name: decodeShareName(url, `vless-${host}-${port}`),
          type: "vless",
          server: host,
          port,
          uuid: url.username,
          network,
          tls: security === "tls" || security === "reality",
          udp: true,
          flow: url.searchParams.get("flow") || undefined,
          servername: url.searchParams.get("sni") || undefined
        };
        if (network === "ws") {
          record["ws-opts"] = {
            path: url.searchParams.get("path") || "/",
            headers: url.searchParams.get("host") ? { Host: url.searchParams.get("host") } : undefined
          };
        }
        return record;
      }
      return {
        name: decodeShareName(url, `hysteria2-${host}-${port}`),
        type: "hysteria2",
        server: host,
        port,
        password: decodeURIComponent(url.username || url.searchParams.get("auth") || ""),
        sni: url.searchParams.get("sni") || host,
        "skip-cert-verify": url.searchParams.get("insecure") === "1"
      };
    }
  } catch {
    return null;
  }
  return null;
}

function parseSubscriptionBody(raw: string): ClashProxyRecord[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const json = JSON.parse(trimmed) as { proxies?: ClashProxyRecord[] } | ClashProxyRecord[];
    if (Array.isArray(json)) return json.filter((item) => item?.name && item?.type);
    if (Array.isArray(json.proxies)) return json.proxies.filter((item) => item?.name && item?.type);
  } catch {
    /* not json */
  }

  if (/^(vmess|ss|trojan|vless|hysteria2|hy2):\/\//m.test(trimmed)) {
    return trimmed
      .split(/\r?\n/)
      .map(parseShareUri)
      .filter((item): item is ClashProxyRecord => Boolean(item));
  }

  const fromYaml = parseYamlProxyList(trimmed);
  if (fromYaml.length > 0) return fromYaml;

  try {
    const decoded = Buffer.from(trimmed.replace(/\s/g, ""), "base64").toString("utf8").trim();
    if (decoded && decoded !== trimmed && /[\x20-\x7e\n\r]/.test(decoded)) {
      return parseSubscriptionBody(decoded);
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function fetchText(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchClashSubscription(url: string): Promise<ClashProxyRecord[]> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("订阅地址必须是 http 或 https 链接");
  }
  const cached = subscriptionCache.get(trimmed);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) return cached.proxies;

  const headers = {
    "User-Agent": "clash.meta/v1.19.0 clash-verge/1.7.7 ClashMetaForAndroid/2.11.0",
    Accept: "*/*"
  };
  let body = "";
  try {
    body = await fetchText(trimmed, headers, 25000);
  } catch (error) {
    throw new Error(`拉取订阅失败: ${error instanceof Error ? error.message : "网络错误"}`);
  }
  const proxies = parseSubscriptionBody(body);
  if (proxies.length === 0) {
    throw new Error("订阅内容里没有可用节点。请确认是 Clash / Clash Meta 订阅，或机场支持该格式。");
  }
  subscriptionCache.set(trimmed, { fetchedAt: Date.now(), proxies });
  return proxies;
}

function mihomoAssetPrefix(): string {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === "win32" && arch === "arm64") return "mihomo-windows-arm64";
  if (plat === "win32") return "mihomo-windows-amd64";
  if (plat === "linux" && arch === "arm64") return "mihomo-linux-arm64";
  if (plat === "linux") return "mihomo-linux-amd64";
  if (plat === "darwin" && arch === "arm64") return "mihomo-darwin-arm64";
  if (plat === "darwin") return "mihomo-darwin-amd64";
  throw new Error(`当前系统暂不支持内置 Clash 核心 (${plat}/${arch})`);
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Saki-Panel-Daemon", Accept: "application/octet-stream" },
    redirect: "follow"
  });
  if (!response.ok || !response.body) throw new Error(`下载失败 HTTP ${response.status}`);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

async function ensureMihomoBinary(): Promise<string> {
  const dest = path.join(binDir(), mihomoBinaryName());
  try {
    await fs.access(dest);
    return dest;
  } catch {
    /* need download */
  }

  await fs.mkdir(binDir(), { recursive: true });
  const prefix = mihomoAssetPrefix();
  let assets: Array<{ name: string; browser_download_url: string }> = [];
  try {
    const response = await fetch("https://api.github.com/repos/MetaCubeX/mihomo/releases/latest", {
      headers: { "User-Agent": "Saki-Panel-Daemon", Accept: "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    const release = (await response.json()) as { assets?: Array<{ name: string; browser_download_url: string }> };
    assets = release.assets ?? [];
  } catch (error) {
    throw new Error(`无法获取 Clash Meta 核心版本: ${error instanceof Error ? error.message : "GitHub 不可达"}`);
  }

  const ranked = assets
    .filter((asset) => asset.name.startsWith(prefix) && !asset.name.includes("cgo") && !asset.name.includes("compatible"))
    .sort((a, b) => {
      const score = (name: string) => (name.includes("-v2") ? 0 : name.includes("go120") ? 2 : 1);
      return score(a.name) - score(b.name);
    });
  const asset = ranked[0];
  if (!asset) throw new Error(`未找到适用于 ${prefix} 的 Clash Meta 核心`);

  const tmp = path.join(binDir(), asset.name);
  await downloadFile(asset.browser_download_url, tmp);
  try {
    if (asset.name.endsWith(".gz")) {
      const zipped = await fs.readFile(tmp);
      await fs.writeFile(dest, await gunzipAsync(zipped), { mode: 0o755 });
    } else {
      const extractDir = path.join(binDir(), `extract-${Date.now()}`);
      await fs.mkdir(extractDir, { recursive: true });
      await execFileAsync(path7za, ["x", "-y", "-bso0", "-bsp0", `-o${extractDir}`, tmp], { windowsHide: true });
      const files = await fs.readdir(extractDir, { recursive: true });
      const found = files.find((file) => /mihomo/i.test(String(file)) && !String(file).endsWith(".gz"));
      if (!found) throw new Error("压缩包内未找到 mihomo 可执行文件");
      await fs.copyFile(path.join(extractDir, String(found)), dest);
      await fs.chmod(dest, 0o755).catch(() => {});
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
  return dest;
}

function mixedPortForInstance(instanceId: string): number {
  let hash = 0;
  for (const ch of instanceId) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return 17890 + (hash % 700);
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function pickPort(instanceId: string): Promise<number> {
  const current = runtimes.get(instanceId);
  if (current && !current.process.killed) return current.port;
  let port = mixedPortForInstance(instanceId);
  for (let i = 0; i < 40; i += 1) {
    if (await portFree(port)) return port;
    port += 1;
  }
  throw new Error("找不到可用的本地代理端口");
}

function buildClashConfig(proxy: ClashProxyRecord, port: number): string {
  return [
    `mixed-port: ${port}`,
    "bind-address: 127.0.0.1",
    "allow-lan: false",
    "mode: global",
    "log-level: warning",
    "ipv6: true",
    "unified-delay: true",
    "external-controller: ''",
    "proxies:",
    dumpYaml([proxy], 2)
  ].join("\n");
}

async function stopRuntime(instanceId: string): Promise<void> {
  const runtime = runtimes.get(instanceId);
  if (!runtime) return;
  runtimes.delete(instanceId);
  try {
    runtime.process.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (runtime.process.exitCode === null && runtime.process.killed === false) {
    try {
      runtime.process.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

export async function stopInstanceClash(instanceId: string): Promise<void> {
  await stopRuntime(instanceId);
}

export async function applyInstanceClash(input: {
  instanceId: string;
  subscriptionUrl: string;
  selectedProxy: string;
}): Promise<{ port: number; selectedProxy: string; proxies: ClashSubscriptionProxy[] }> {
  const proxies = await fetchClashSubscription(input.subscriptionUrl);
  const selected = proxies.find((item) => item.name === input.selectedProxy);
  if (!selected) throw new Error(`订阅里找不到节点「${input.selectedProxy}」`);

  const binary = await ensureMihomoBinary();
  const dir = clashDir(input.instanceId);
  await fs.mkdir(dir, { recursive: true });
  const port = await pickPort(input.instanceId);
  const configPath = path.join(dir, "config.yaml");
  await fs.writeFile(configPath, buildClashConfig(selected, port), "utf8");

  await stopRuntime(input.instanceId);
  const child = spawn(binary, ["-d", dir, "-f", configPath], {
    cwd: dir,
    windowsHide: true,
    stdio: "ignore"
  });
  if (!child.pid) throw new Error("Clash Meta 核心启动失败");
  child.on("exit", () => {
    const current = runtimes.get(input.instanceId);
    if (current?.process === child) runtimes.delete(input.instanceId);
  });
  runtimes.set(input.instanceId, {
    process: child,
    port,
    selected: selected.name,
    url: input.subscriptionUrl
  });

  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (child.exitCode !== null) throw new Error("Clash Meta 核心异常退出，请检查节点配置");
    if (!(await portFree(port))) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    port,
    selectedProxy: selected.name,
    proxies: proxies.map(summarizeProxy)
  };
}

export async function ensureInstanceClashProxy(proxy: InstanceProxyConfig, instanceId: string): Promise<{ port: number }> {
  const url = proxy.subscriptionUrl?.trim();
  const selected = proxy.selectedProxy?.trim();
  if (!url || !selected) throw new Error("未选择 Clash 订阅节点");
  const running = runtimes.get(instanceId);
  if (running && running.url === url && running.selected === selected && running.process.exitCode === null) {
    return { port: running.port };
  }
  const applied = await applyInstanceClash({ instanceId, subscriptionUrl: url, selectedProxy: selected });
  return { port: applied.port };
}

export function summarizeClashProxies(proxies: ClashProxyRecord[]): ClashSubscriptionProxy[] {
  return proxies.map(summarizeProxy);
}
