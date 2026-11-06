import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EnvHttpProxyAgent, type Dispatcher } from "undici";

const execFileAsync = promisify(execFile);
interface ProxySettings { httpProxy: string; httpsProxy: string; noProxy: string; bypassPatterns?: string[] }
const localHosts = "localhost,127.0.0.1,[::1]";

function proxyUrl(value: string): string {
  if (!value) return "";
  const normalized = value.includes("://") ? value : `http://${value}`;
  try {
    return /^https?:$/.test(new URL(normalized).protocol) ? normalized : "";
  } catch { return ""; }
}

/** Windows stores either one HTTP proxy or a semicolon-separated protocol map. */
export function windowsProxySettings(output: string): ProxySettings | undefined {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.*?)\s*$/i);
    if (match) values.set(match[1]!.toLowerCase(), match[2]!);
  }
  if (Number(values.get("proxyenable")) !== 1) return undefined;
  const server = values.get("proxyserver") ?? "";
  const protocols = new Map(server.split(";").map(part => {
    const index = part.indexOf("=");
    return index < 0 ? ["all", part.trim()] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
  }));
  const httpProxy = proxyUrl(protocols.get("http") ?? protocols.get("all") ?? "");
  const httpsProxy = proxyUrl(protocols.get("https") ?? protocols.get("all") ?? "");
  if (!httpProxy && !httpsProxy) return undefined;
  const bypass = (values.get("proxyoverride") ?? "").split(";").map(item => item.trim()).filter(Boolean);
  return { httpProxy, httpsProxy, noProxy: localHosts, bypassPatterns: bypass };
}

let windowsCache: { expires: number; value: Promise<ProxySettings | undefined> } | undefined;
async function readProxySettings(): Promise<ProxySettings | undefined> {
  const env = process.env;
  const http = env.http_proxy ?? env.HTTP_PROXY;
  const https = env.https_proxy ?? env.HTTPS_PROXY;
  const all = env.all_proxy ?? env.ALL_PROXY;
  if (http !== undefined || https !== undefined || all !== undefined) {
    return { httpProxy: proxyUrl(http ?? all ?? ""), httpsProxy: proxyUrl(https ?? http ?? all ?? ""),
      noProxy: env.no_proxy ?? env.NO_PROXY ?? localHosts };
  }
  if (process.platform !== "win32") return undefined;
  if (!windowsCache || windowsCache.expires <= Date.now()) {
    windowsCache = { expires: Date.now() + 30_000, value: execFileAsync("reg.exe", ["query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
    { windowsHide: true, timeout: 2000, maxBuffer: 64 * 1024 }).then(({ stdout }) => {
      const settings = windowsProxySettings(stdout);
      if (settings && (env.no_proxy ?? env.NO_PROXY) !== undefined) {
        settings.noProxy = env.no_proxy ?? env.NO_PROXY ?? "";
        settings.bypassPatterns = [];
      }
      return settings;
    }).catch(() => undefined) };
  }
  return windowsCache.value;
}

let cachedAgent: { key: string; agent: EnvHttpProxyAgent } | undefined;

/** Keep proxy handling local to Saki; daemon and LAN connections stay independent. */
export async function sakiFetch(url: string | URL, options: RequestInit = {}): Promise<Response> {
  const settings = await readProxySettings();
  options.signal?.throwIfAborted();
  if (!settings || !settings.httpProxy && !settings.httpsProxy) return fetch(url, options);
  const target = new URL(url);
  if (target.protocol === "https:" ? !settings.httpsProxy : !settings.httpProxy) return fetch(url, options);
  const hostname = target.hostname;
  const bypass = settings.bypassPatterns?.some(pattern => {
    if (pattern.toLowerCase() === "<local>") return !hostname.includes(".") && !hostname.includes(":");
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    const match = new RegExp(`^${escaped}$`, "i");
    return match.test(hostname) || match.test(target.host);
  });
  if (bypass) return fetch(url, options);
  const key = JSON.stringify(settings);
  if (cachedAgent?.key !== key) {
    const previous = cachedAgent;
    cachedAgent = { key, agent: new EnvHttpProxyAgent(settings) };
    if (previous) void previous.agent.close().catch(() => undefined);
  }
  const init: RequestInit & { dispatcher: Dispatcher } = { ...options, dispatcher: cachedAgent.agent };
  return fetch(url, init);
}
