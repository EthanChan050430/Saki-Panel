import http from "node:http";
import tls from "node:tls";
import type { ClashSubscriptionProxy } from "@webops/shared";

interface ClashProxyRecord {
  name: string;
  type: string;
  [key: string]: unknown;
}

const subscriptionCache = new Map<string, { fetchedAt: number; proxies: ClashProxyRecord[] }>();
const cacheTtlMs = 10 * 60 * 1000;

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
  const start = yaml.search(/^proxies:\s*(?:#.*)?\r?$/m);
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
    // Not JSON — try URI list / YAML / base64.
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
    // Ignore malformed base64 and treat as empty.
  }
  return [];
}

const subscriptionUserAgents = [
  "clash.meta",
  "Clash",
  "FlClash/v0.8.96",
  "clash-verge/v2.2.3",
  "ClashMetaForAndroid/2.11.0"
];

const localProxyPorts = [7890, 7891, 7897, 10809, 20171, 33210, 1080];

function isPlaceholderSubscriptionBody(body: string): boolean {
  const text = body.trim();
  if (!text) return true;
  if (/proxies\s*:|(vmess|ss|trojan|vless|hysteria2|hy2):\/\//i.test(text)) return false;
  return text.length < 64 && /^(network is good|hello world|ok|success|pong|good)$/i.test(text);
}

function fetchTextDirect(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { headers, signal: controller.signal, redirect: "follow" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    })
    .finally(() => clearTimeout(timer));
}

function fetchTextViaHttpProxy(url: string, headers: Record<string, string>, proxyPort: number, timeoutMs: number): Promise<string> {
  const target = new URL(url);
  const isHttps = target.protocol === "https:";
  const connectPath = `${target.hostname}:${target.port || (isHttps ? 443 : 80)}`;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: proxyPort,
      method: isHttps ? "CONNECT" : "GET",
      path: isHttps ? connectPath : url,
      timeout: timeoutMs,
      headers: isHttps ? { Host: connectPath } : { ...headers, Host: target.host }
    });
    const finish = (error: Error) => {
      req.destroy();
      reject(error);
    };
    req.on("timeout", () => finish(new Error(`代理 ${proxyPort} 超时`)));
    req.on("error", reject);
    if (!isHttps) {
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      });
      req.end();
      return;
    }
    req.on("connect", (res, socket) => {
      if ((res.statusCode ?? 0) !== 200) {
        socket.destroy();
        finish(new Error(`CONNECT ${res.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname, ALPNProtocols: ["http/1.1"] }, () => {
        const headerLines = Object.entries({
          Host: target.host,
          Connection: "close",
          ...headers
        })
          .map(([key, value]) => `${key}: ${value}`)
          .join("\r\n");
        tlsSocket.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
      });
      const chunks: Buffer[] = [];
      tlsSocket.on("data", (chunk) => chunks.push(chunk));
      tlsSocket.on("error", reject);
      tlsSocket.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const split = raw.indexOf("\r\n\r\n");
        const head = split >= 0 ? raw.slice(0, split) : "";
        const body = split >= 0 ? raw.slice(split + 4) : raw;
        const status = Number(head.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] ?? 0);
        if (status >= 400) {
          reject(new Error(`HTTP ${status}`));
          return;
        }
        resolve(body);
      });
    });
    req.end();
  });
}

async function fetchSubscriptionBodies(url: string): Promise<string[]> {
  const headerSets = subscriptionUserAgents.map((userAgent) => ({
    "User-Agent": userAgent,
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  }));
  const attempts: Array<() => Promise<string>> = [];
  for (const headers of headerSets) {
    attempts.push(() => fetchTextDirect(url, headers, 20000));
  }
  for (const port of localProxyPorts) {
    attempts.push(() => fetchTextViaHttpProxy(url, headerSets[0]!, port, 2500));
  }
  const bodies: string[] = [];
  for (const attempt of attempts) {
    try {
      const body = await attempt();
      if (!body?.trim()) continue;
      bodies.push(body);
      if (!isPlaceholderSubscriptionBody(body)) return bodies;
    } catch {
      // Try the next UA / local Clash mixed-port.
    }
  }
  return bodies;
}

export function parseClashSubscriptionProxies(raw: string): ClashSubscriptionProxy[] {
  return parseSubscriptionBody(raw).map(summarizeProxy);
}

export async function fetchClashSubscriptionProxies(url: string): Promise<ClashSubscriptionProxy[]> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("订阅地址必须是 http 或 https 链接");
  }
  const cached = subscriptionCache.get(trimmed);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.proxies.map(summarizeProxy);
  }

  const urls = [trimmed];
  if (!/[?&](flag|clash|target)=/i.test(trimmed)) {
    urls.push(`${trimmed}${trimmed.includes("?") ? "&" : "?"}flag=clash`);
  }

  let lastBody = "";
  for (const candidate of urls) {
    const bodies = await fetchSubscriptionBodies(candidate);
    for (const body of bodies) {
      lastBody = body;
      if (isPlaceholderSubscriptionBody(body)) continue;
      const proxies = parseSubscriptionBody(body);
      if (proxies.length > 0) {
        subscriptionCache.set(trimmed, { fetchedAt: Date.now(), proxies });
        return proxies.map(summarizeProxy);
      }
    }
  }

  if (isPlaceholderSubscriptionBody(lastBody)) {
    throw new Error(
      "机场没有下发节点，只返回了探测页。Clash 能更新通常是因为走了已连接的代理。请先让本机 Clash / FlClash 连上节点，再点获取节点。"
    );
  }
  throw new Error("订阅内容里没有可用节点。请确认是 Clash / Clash Meta 订阅，或机场支持该格式。");
}
