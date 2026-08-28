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

export async function fetchClashSubscriptionProxies(url: string): Promise<ClashSubscriptionProxy[]> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("订阅地址必须是 http 或 https 链接");
  }
  const cached = subscriptionCache.get(trimmed);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.proxies.map(summarizeProxy);
  }

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
  return proxies.map(summarizeProxy);
}
