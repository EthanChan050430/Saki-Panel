import { isIP } from "node:net";
import type { GitHubMirrorOption } from "@webops/shared";

export const BUILTIN_GITHUB_MIRRORS: GitHubMirrorOption[] = [
  {
    id: "ghfast",
    name: "GHFast 镜像 (国内首选推荐)",
    description: "高速、低延迟，支持 Releases 与 Raw 资源直接代理",
    prefix: "https://ghfast.top/",
    rawPrefix: "https://ghfast.top/",
    isDefault: true
  },
  {
    id: "ghproxy",
    name: "GHProxy Net (备用加速)",
    description: "经典免费开源 GitHub 代理加速节点",
    prefix: "https://ghproxy.net/",
    rawPrefix: "https://ghproxy.net/"
  },
  {
    id: "kkgithub",
    name: "KKGitHub (域名直换)",
    description: "国内可直连的 GitHub Web 镜像与 Raw 镜像",
    domainReplace: { from: "github.com", to: "kkgithub.com" },
    rawPrefix: "https://raw.kkgithub.com/"
  },
  {
    id: "gitclone",
    name: "GitClone 加速",
    description: "专注于 Git 仓库克隆加速服务",
    prefix: "https://gitclone.com/github.com/"
  },
  {
    id: "direct",
    name: "GitHub 官方直连",
    description: "直接连接 GitHub 官方服务器 (海外或已开梯子环境使用)"
  },
  {
    id: "custom",
    name: "自定义加速镜像 / 反代",
    description: "自行配置的反代地址或前缀 (例如: https://my-gh-proxy.com/)"
  }
];

function assertSafeCustomMirror(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid custom mirror URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Custom mirror URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Custom mirror URL must not contain credentials.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Custom mirror URL must not point to a local host.");
  }
  const version = isIP(host);
  if (version === 4 && /^(0|10|127)\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) {
    throw new Error("Custom mirror URL must not point to a private address.");
  }
  if (version === 6 && (host === "::1" || host === "::" || /^(fc|fd|fe80)/.test(host) || host.startsWith("::ffff:"))) {
    throw new Error("Custom mirror URL must not point to a private address.");
  }
  return url.toString();
}

export function resolveMirrorUrl(
  originalUrl: string,
  mirrorId: string = "ghfast",
  customMirrorUrl?: string
): string {
  const trimmed = originalUrl.trim();
  if (!trimmed) return "";

  if (mirrorId === "direct") {
    return trimmed;
  }

  if (mirrorId === "custom" && customMirrorUrl) {
    let base = assertSafeCustomMirror(customMirrorUrl.trim());
    if (!base.endsWith("/")) base += "/";
    return `${base}${trimmed}`;
  }

  const mirror = BUILTIN_GITHUB_MIRRORS.find((m) => m.id === mirrorId) ?? BUILTIN_GITHUB_MIRRORS[0];
  if (!mirror) return trimmed;

  const isRaw = trimmed.includes("raw.githubusercontent.com");

  if (isRaw && mirror.rawPrefix) {
    if (mirror.id === "kkgithub") {
      return trimmed.replace("https://raw.githubusercontent.com/", "https://raw.kkgithub.com/");
    }
    // Prefix style like https://ghfast.top/https://raw.githubusercontent.com/...
    return `${mirror.rawPrefix}${trimmed}`;
  }

  if (mirror.domainReplace && !isRaw) {
    return trimmed.replace(mirror.domainReplace.from, mirror.domainReplace.to);
  }

  if (mirror.prefix) {
    if (mirror.id === "gitclone") {
      return trimmed.replace("https://github.com/", "https://gitclone.com/github.com/");
    }
    return `${mirror.prefix}${trimmed}`;
  }

  return trimmed;
}

export async function testMirrorSpeed(
  mirrorId: string,
  customMirrorUrl?: string
): Promise<{ mirrorId: string; pingMs: number; ok: boolean; error?: string }> {
  const testTarget = "https://raw.githubusercontent.com/EthanChan050430/Saki-Panel/main/README.md";
  let targetUrl: string;
  try {
    targetUrl = resolveMirrorUrl(testTarget, mirrorId, customMirrorUrl);
  } catch (err) {
    return { mirrorId, pingMs: 0, ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(targetUrl, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "Saki-Panel-Mirror-Tester/1.0" }
    });
    clearTimeout(timer);
    const pingMs = Date.now() - start;
    if (res.ok || res.status === 302 || res.status === 301 || res.status === 404) {
      // 404 still means connection succeeded to the mirror server
      return { mirrorId, pingMs, ok: true };
    }
    return { mirrorId, pingMs, ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timer);
    const pingMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { mirrorId, pingMs, ok: false, error: msg.includes("aborted") ? "连接超时 (>6s)" : msg };
  }
}

export async function testAllMirrors(customMirrorUrl?: string) {
  const tasks = BUILTIN_GITHUB_MIRRORS.map(async (mirror) => {
    if (mirror.id === "custom" && !customMirrorUrl) {
      return {
        mirrorId: mirror.id,
        name: mirror.name,
        pingMs: 0,
        ok: false,
        error: "未配置自定义镜像地址"
      };
    }
    const result = await testMirrorSpeed(mirror.id, customMirrorUrl);
    return {
      name: mirror.name,
      ...result
    };
  });

  return Promise.all(tasks);
}
