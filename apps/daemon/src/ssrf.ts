// SSRF guard — validates that a URL does not resolve to internal / reserved
// network ranges before fetching. Throws a descriptive error if it does.

import dns from "node:dns";
import { promisify } from "node:util";

const resolve = promisify(dns.lookup);

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".test", ".example", ".invalid", ".localhost"];

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost") return true;
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }
  return false;
}

function ipv4IsInternal(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const a = parts[0]!;
  const b = parts[1]!;
  // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.2.0/24 used for documentation
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 113) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  return false;
}

function ipv6IsInternal(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith("::")) return true; // ::1, ::ffff:, etc. (simplified — covers localhost & v4-mapped)
  if (lower.startsWith("fe80:") || lower.startsWith("fec0:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff00:") || lower.startsWith("ff")) return true; // multicast
  if (lower === "::1") return true;
  return false;
}

export async function assertUrlIsPublic(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed. Rejected protocol: ${url.protocol}`);
  }

  const hostname = url.hostname;
  if (!hostname) throw new Error("URL is missing a hostname.");

  if (isBlockedHostname(hostname)) {
    throw new Error(`Hostname "${hostname}" resolves to a reserved/internal suffix and is blocked.`);
  }

  // Try to detect if hostname is already an IP literal.
  const isIpLiteral = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    /^\[[0-9a-f:]+\]$/i.test(hostname) ||
    /^[0-9a-f:]+$/i.test(hostname); // plain IPv6

  if (isIpLiteral) {
    const ip = hostname.replace(/^\[|\]$/g, "");
    if (ip.includes(":")) {
      if (ipv6IsInternal(ip)) throw new Error(`Reserved IPv6 address blocked: ${ip}`);
    } else {
      if (ipv4IsInternal(ip)) throw new Error(`Reserved IPv4 address blocked: ${ip}`);
    }
    return url;
  }

  const { address, family } = await resolve(hostname, { all: false } as any) as unknown as { address: string; family: number };

  if (family === 4 && ipv4IsInternal(address)) {
    throw new Error(`Hostname "${hostname}" resolves to reserved IPv4 ${address} — SSRF blocked.`);
  }
  if (family === 6 && ipv6IsInternal(address)) {
    throw new Error(`Hostname "${hostname}" resolves to reserved IPv6 ${address} — SSRF blocked.`);
  }

  return url;
}

export async function fetchWithSsrFGuard(url: string, init?: RequestInit & { maxRedirects?: number }): Promise<Response> {
  const checked = await assertUrlIsPublic(url);
  const maxRedirects = init?.maxRedirects ?? 3;

  // Node's fetch follows redirects by default. We re-check each hop by
  // disabling auto-follow and handling redirects manually so every resolved
  // URL passes the SSRF guard.
  let currentUrl: URL = checked;
  let response: Response | undefined;
  const headers = new Headers(init?.headers);
  // Always set a tight default timeout and a realistic User-Agent.
  if (!headers.has("user-agent")) headers.set("user-agent", "DreamStarry-Daemon/1.0 (+ssrf-guard)");

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const signal = init?.signal;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    // Chain any external signal
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

    response = await fetch(currentUrl.toString(), {
      ...init,
      headers,
      redirect: "manual",
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    const loc = response.headers.get("location");
    if (!loc) break;

    if (hop === maxRedirects) {
      throw new Error(`Subscription redirected too many times (>${maxRedirects}); aborted for safety.`);
    }

    const nextUrl = new URL(loc, currentUrl);
    currentUrl = await assertUrlIsPublic(nextUrl.toString());
  }

  if (!response) throw new Error("fetchWithSsrFGuard failed without a response");
  return response;
}
