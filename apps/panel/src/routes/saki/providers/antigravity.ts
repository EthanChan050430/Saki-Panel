import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SakiAntigravityAccountItem,
  SakiAntigravityAuthStatusResponse,
  SakiAntigravityExchangeRequest,
  SakiAntigravityLoginRequest,
  SakiAntigravityLoginUrlResponse,
  SakiAntigravityLogoutRequest,
  SakiAntigravitySwitchAccountRequest,
  SakiAntigravityUsageInfo,
  SakiChatRequest,
  SakiConfigResponse,
  SakiModelOption,
  SakiProviderConfig
} from "@webops/shared";
import { sakiListedModelSupportsVision } from "@webops/shared";
import { prisma } from "../../../db.js";
import type { SakiModelToolTurn } from "../types.js";
import {
  fetchWithTimeout,
  modelOptionFromItem,
  openAiBaseUrl,
  providerConfigFor,
  providerDefaults,
  RouteError,
  trimString,
  uniqueModels
} from "../types.js";
import {
  callOpenAiCompatibleAgentTurnStreamWithFallback,
  callOpenAiCompatibleAgentTurnWithFallback,
  callOpenAiCompatibleModel,
  callOpenAiCompatibleModelStream
} from "./openai.js";
import { collectModelItems, fetchOpenAiModelCatalog } from "./catalog.js";

/**
 * Offline fallback list, shown only when live sync from the proxy/Google fails.
 * Keep this small and current — stale entries here cause 404s at chat time.
 * (gemini-3-flash was retired upstream; gemini-3.8-flash is the current flash model.)
 */
export const defaultAntigravityModels: SakiModelOption[] = [
  {
    provider: "antigravity",
    id: "gemini-3.8-flash",
    name: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash (快速/推荐)",
    vendor: "Google Antigravity",
    supportsVision: true
  },
  {
    provider: "antigravity",
    id: "gemini-2.5-flash",
    name: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    vendor: "Google Antigravity",
    supportsVision: true
  },
  {
    provider: "antigravity",
    id: "gemini-2.5-pro",
    name: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro (深度推理)",
    vendor: "Google Antigravity",
    supportsVision: true
  },
  {
    provider: "antigravity",
    id: "claude-3-7-sonnet",
    name: "claude-3-7-sonnet",
    label: "Claude 3.7 Sonnet (Antigravity)",
    vendor: "Anthropic / Antigravity",
    supportsVision: true
  },
  {
    provider: "antigravity",
    id: "claude-3-5-sonnet",
    name: "claude-3-5-sonnet",
    label: "Claude 3.5 Sonnet (Antigravity)",
    vendor: "Anthropic / Antigravity",
    supportsVision: true
  }
];

export interface LocalAntigravityCredentials {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  expiryDate?: number | undefined;
  activeAccount?: string | undefined;
  accounts: SakiAntigravityAccountItem[];
  hasCredentials: boolean;
}

interface SakiSavedAccountRecord {
  email: string;
  name?: string | undefined;
  picture?: string | undefined;
  token?: string | undefined;
  refreshToken?: string | undefined;
  expiryDate?: number | undefined;
  addedAt?: string | undefined;
}

interface SakiAccountsVault {
  active?: string | undefined;
  accounts?: Record<string, SakiSavedAccountRecord> | undefined;
}

export function getAntigravityPrimaryDir(): string {
  const candidateBases: string[] = [];
  try {
    const home = homedir();
    if (home) candidateBases.push(home);
  } catch {}
  if (process.env.HOME) candidateBases.push(process.env.HOME);
  if (process.env.USERPROFILE) candidateBases.push(process.env.USERPROFILE);
  candidateBases.push("/root");
  candidateBases.push("/var/apps/panel");
  try {
    candidateBases.push(process.cwd());
  } catch {}

  for (const base of candidateBases) {
    if (existsSync(base)) {
      const geminiDir = join(base, ".gemini");
      if (existsSync(geminiDir)) {
        return geminiDir;
      }
    }
  }

  for (const base of candidateBases) {
    if (existsSync(base)) {
      const geminiDir = join(base, ".gemini");
      try {
        mkdirSync(geminiDir, { recursive: true });
        return geminiDir;
      } catch {}
    }
  }

  const fallback = join(homedir() || process.cwd(), ".gemini");
  try {
    mkdirSync(fallback, { recursive: true });
  } catch {}
  return fallback;
}

export function getAntigravityCandidateDirs(): Set<string> {
  const candidateDirs = new Set<string>();
  try {
    const home = homedir();
    if (home) candidateDirs.add(home);
  } catch {}
  if (process.env.HOME) candidateDirs.add(process.env.HOME);
  if (process.env.USERPROFILE) candidateDirs.add(process.env.USERPROFILE);
  candidateDirs.add("/root");
  candidateDirs.add("/var/apps/panel");
  try {
    candidateDirs.add(process.cwd());
    candidateDirs.add(join(process.cwd(), ".."));
  } catch {}
  return candidateDirs;
}

export function readLocalAntigravityCredentials(): LocalAntigravityCredentials {
  try {
    const candidateDirs = getAntigravityCandidateDirs();

    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    let expiryDate: number | undefined;
    let activeAccount: string | undefined;
    const accountsMap = new Map<string, SakiAntigravityAccountItem>();

    const envKey =
      trimString(process.env.ANTIGRAVITY_API_KEY) ||
      trimString(process.env.ANTIGRAVITY_TOKEN) ||
      trimString(process.env.GEMINI_API_KEY) ||
      trimString(process.env.GOOGLE_API_KEY);
    if (envKey) {
      accessToken = envKey;
    }

    for (const baseDir of candidateDirs) {
      const geminiDir = join(baseDir, ".gemini");
      const configDir = join(baseDir, ".config", "antigravity");
      const configCliDir = join(baseDir, ".config", "antigravity-cli");

      // Check saki_antigravity_accounts.json first
      const vaultPath = join(geminiDir, "saki_antigravity_accounts.json");
      if (existsSync(vaultPath)) {
        try {
          const vault = JSON.parse(readFileSync(vaultPath, "utf8")) as SakiAccountsVault;
          if (vault.active && !activeAccount) {
            activeAccount = trimString(vault.active) || undefined;
          }
          if (vault.accounts && typeof vault.accounts === "object") {
            for (const [emailKey, record] of Object.entries(vault.accounts)) {
              const email = trimString(record.email) || trimString(emailKey);
              if (email && !accountsMap.has(email)) {
                accountsMap.set(email, {
                  email,
                  ...(record.name ? { name: record.name } : {}),
                  ...(record.picture ? { picture: record.picture } : {}),
                  hasToken: Boolean(record.token),
                  ...(record.addedAt ? { addedAt: record.addedAt } : {})
                });
                if (!accessToken && record.token && (!activeAccount || activeAccount === email)) {
                  accessToken = record.token;
                  if (record.refreshToken) refreshToken = record.refreshToken;
                  if (record.expiryDate) expiryDate = record.expiryDate;
                }
              }
            }
          }
        } catch {}
      }

      const tokenFiles = [
        join(geminiDir, "antigravity-cli", "antigravity-oauth-token"),
        join(geminiDir, "oauth_creds.json"),
        join(geminiDir, "antigravity", "session.json"),
        join(geminiDir, "antigravity-cli", "session.json"),
        join(configDir, "antigravity-oauth-token"),
        join(configDir, "session.json"),
        join(configCliDir, "antigravity-oauth-token")
      ];

      for (const tokenFile of tokenFiles) {
        if (!accessToken && existsSync(tokenFile)) {
          try {
            const raw = readFileSync(tokenFile, "utf8").trim();
            if (raw.startsWith("{")) {
              const data = JSON.parse(raw);
              accessToken =
                trimString(data.access_token) ||
                trimString(data.token) ||
                trimString(data.accessToken) ||
                undefined;
              if (!refreshToken && data.refresh_token) {
                refreshToken = trimString(data.refresh_token) || undefined;
              }
              if (!expiryDate && typeof data.expiry_date === "number") {
                expiryDate = data.expiry_date;
              }
              if (!activeAccount) {
                activeAccount =
                  trimString(data.active) ||
                  trimString(data.email) ||
                  trimString(data.account) ||
                  undefined;
              }
            } else if (raw.length > 15) {
              accessToken = raw;
            }
          } catch {}
        }
      }

      const accountFiles = [
        join(geminiDir, "google_accounts.json"),
        join(geminiDir, "antigravity-cli", "settings.json"),
        join(geminiDir, "state.json"),
        join(geminiDir, "settings.json"),
        join(configDir, "settings.json")
      ];

      for (const accountFile of accountFiles) {
        if (existsSync(accountFile)) {
          try {
            const data = JSON.parse(readFileSync(accountFile, "utf8"));
            if (!activeAccount) {
              activeAccount =
                trimString(data.active) ||
                trimString(data.email) ||
                trimString(data.userEmail) ||
                trimString(data.account) ||
                undefined;
            }
            if (data.active && typeof data.active === "string") {
              const email = trimString(data.active);
              if (email && !accountsMap.has(email)) {
                accountsMap.set(email, { email, hasToken: Boolean(accessToken) });
              }
            }
            if (Array.isArray(data.old)) {
              for (const oldEmail of data.old) {
                if (typeof oldEmail === "string" && oldEmail && !accountsMap.has(oldEmail)) {
                  accountsMap.set(oldEmail, { email: oldEmail, hasToken: false });
                }
              }
            }
            if (Array.isArray(data.accounts)) {
              for (const item of data.accounts) {
                const email = typeof item === "string" ? item : item?.email;
                if (email && !accountsMap.has(email)) {
                  accountsMap.set(email, {
                    email,
                    ...(item?.name ? { name: item.name } : {}),
                    ...(item?.picture ? { picture: item.picture } : {}),
                    hasToken: Boolean(item?.token || item?.access_token)
                  });
                }
              }
            }
          } catch {}
        }
      }

      if (accessToken && activeAccount && accountsMap.size > 0) break;
    }

    if (activeAccount && !accountsMap.has(activeAccount)) {
      accountsMap.set(activeAccount, {
        email: activeAccount,
        hasToken: Boolean(accessToken)
      });
    }

    const accounts: SakiAntigravityAccountItem[] = Array.from(accountsMap.values()).map((acc) => ({
      ...acc,
      isActive: Boolean(activeAccount && acc.email === activeAccount)
    }));

    return {
      accessToken,
      refreshToken,
      expiryDate,
      activeAccount,
      accounts,
      hasCredentials: Boolean(accessToken || refreshToken || activeAccount || accounts.length > 0)
    };
  } catch {
    return { hasCredentials: false, accounts: [] };
  }
}

/** Official Google Gemini OpenAI-compatible endpoint used in "direct" (API Key) mode. */
export const ANTIGRAVITY_DIRECT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
/** Default local reverse proxy gateway used in "proxy" mode. */
export const ANTIGRAVITY_DEFAULT_PROXY_BASE_URL = "http://localhost:8080/v1";
/** Fallback model when nothing is configured. gemini-3-flash was retired upstream; 3.8-flash is the current flash model. */
export const ANTIGRAVITY_DEFAULT_MODEL = "gemini-3.8-flash";

export type AntigravityMode = "proxy" | "direct";

/**
 * Host bridge registered by config.ts so this module can persist a Gemini
 * API key into settings (providerConfigs.antigravity) without a circular import.
 */
export interface AntigravityConfigHost {
  readEffectiveConfig(): Promise<SakiConfigResponse>;
  persistAntigravityDirectKey(apiKey: string): Promise<void>;
}

let antigravityConfigHost: AntigravityConfigHost | null = null;

export function registerAntigravityConfigHost(host: AntigravityConfigHost): void {
  antigravityConfigHost = host;
}

/**
 * Persist a Google AI Studio key (AIzaSy...) as the direct-mode API key in
 * settings. The key is NEVER written into the OAuth token file or account vault.
 */
async function saveAntigravityDirectApiKey(apiKey: string): Promise<SakiAntigravityAuthStatusResponse> {
  try {
    const testRes = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: "GET" },
      6000
    );
    if (!testRes.ok && testRes.status === 400) {
      throw new RouteError("Gemini API Key 校验失败。请在 Google AI Studio 检查 Key 是否正确。", 400);
    }
  } catch (err) {
    if (err instanceof RouteError) throw err;
  }

  if (!antigravityConfigHost) {
    throw new RouteError(
      "Gemini API Key 应保存在「官方直连」配置中，而非 OAuth 凭据。当前配置服务不可用，请在设置页的「官方直连 (Gemini API Key)」输入框中填写该 Key 并保存设置。",
      500
    );
  }
  await antigravityConfigHost.persistAntigravityDirectKey(apiKey);
  const fresh = await antigravityConfigHost.readEffectiveConfig();
  const status = await checkAntigravityAuthStatus(fresh);
  return {
    ...status,
    message: `已将 Gemini API Key (${apiKey.slice(0, 6)}...${apiKey.slice(-4)}) 保存为「官方直连 (Gemini API Key)」配置，不会再写入 OAuth 凭据。`
  };
}

/**
 * Single source of truth for the antigravity connection scheme.
 * Explicit `providerConfig.mode` always wins; for legacy configs without a mode,
 * an API key starting with "AIzaSy" implies "direct", anything else implies "proxy".
 * This is the ONLY place where the AIzaSy prefix is sniffed.
 */
export function resolveAntigravityMode(providerConfig: SakiProviderConfig): AntigravityMode {
  if (providerConfig.mode === "proxy" || providerConfig.mode === "direct") {
    return providerConfig.mode;
  }
  return trimString(providerConfig.apiKey).startsWith("AIzaSy") ? "direct" : "proxy";
}

export function resolveAntigravityConfig(config: SakiConfigResponse): SakiConfigResponse {
  const providerConfig = providerConfigFor(config.providerConfigs, "antigravity");
  // Legacy configs stored the antigravity values at the top level; only trust
  // those when antigravity is the active provider, so other providers' keys/URLs
  // never leak into antigravity resolution.
  const legacyTopLevel = config.provider === "antigravity";
  const manualBaseUrl = trimString(providerConfig.baseUrl) || (legacyTopLevel ? trimString(config.baseUrl) : "");
  let apiKey = trimString(providerConfig.apiKey) || (legacyTopLevel ? trimString(config.apiKey) : "");
  const mode = resolveAntigravityMode({ ...providerConfig, apiKey });

  let baseUrl: string;
  if (mode === "direct") {
    // Direct mode ALWAYS targets the official Google endpoint; any proxy-ish
    // baseUrl is ignored. No OAuth token refill, no dummy key: a missing
    // manual key is reported to the caller as "missing API key".
    baseUrl = ANTIGRAVITY_DIRECT_BASE_URL;
  } else {
    baseUrl = manualBaseUrl || providerDefaults.antigravity?.baseUrl || ANTIGRAVITY_DEFAULT_PROXY_BASE_URL;
    if (apiKey.startsWith("AIzaSy")) {
      // Credential-leak protection: never send a Google AI Studio key to a
      // non-Google proxy endpoint. Drop it and let the caller fall back to
      // OAuth credentials or no auth.
      console.warn(
        "[saki/antigravity] Gemini API Key (AIzaSy...) detected in proxy mode; the key was ignored to avoid leaking it to a non-Google endpoint. Switch to direct mode to use it."
      );
      apiKey = "";
    }
    if (!apiKey) {
      // Proxy mode only: refill from the locally stored Google OAuth credential.
      const creds = readLocalAntigravityCredentials();
      if (creds.accessToken) {
        apiKey = creds.accessToken;
      }
    }
  }

  // Never rewrite the user-selected model id: the catalog is synced live from the
  // proxy/Google, and hardcoded name aliases go stale.
  // Exception: gemini-3-flash was retired upstream — transparently upgrade stale
  // saved values to the current flash model instead of failing with a 404.
  let model = trimString(config.model) || trimString(providerConfig.model) || ANTIGRAVITY_DEFAULT_MODEL;
  if (model === "gemini-3-flash") {
    model = ANTIGRAVITY_DEFAULT_MODEL;
  }

  return {
    ...config,
    provider: "antigravity",
    baseUrl,
    apiKey,
    model,
    providerConfigs: {
      ...config.providerConfigs,
      antigravity: { ...providerConfig, mode }
    }
  };
}

export async function fetchProxyQuota(
  baseUrl: string,
  apiKey?: string
): Promise<{
  limit?: number | undefined;
  remaining?: number | undefined;
  used?: number | undefined;
  expiresAt?: string | undefined;
  tier?: string | undefined;
} | null> {
  const trimmedUrl = trimString(baseUrl);
  if (!trimmedUrl) return null;

  let rootUrl = trimmedUrl.replace(/\/v1\/?$/, "");
  if (!rootUrl.startsWith("http://") && !rootUrl.startsWith("https://")) {
    rootUrl = `http://${rootUrl}`;
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
  };

  const today = new Date();
  const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const endDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

  const candidateUrls = [
    `${rootUrl}/dashboard/billing/subscription`,
    `${rootUrl}/v1/dashboard/billing/subscription`,
    `${trimmedUrl}/dashboard/billing/subscription`,
    `${rootUrl}/api/usage`,
    `${rootUrl}/usage`
  ];

  let subData: Record<string, unknown> | null = null;
  for (const url of candidateUrls) {
    try {
      const res = await fetchWithTimeout(url, { method: "GET", headers }, 2500);
      if (res.ok) {
        const parsed = (await res.json()) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          subData = parsed;
          break;
        }
      }
    } catch {
      // try next candidate
    }
  }

  let usageData: Record<string, unknown> | null = null;
  const usageUrls = [
    `${rootUrl}/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
    `${rootUrl}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
    `${trimmedUrl}/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`
  ];
  for (const url of usageUrls) {
    try {
      const res = await fetchWithTimeout(url, { method: "GET", headers }, 2500);
      if (res.ok) {
        const parsed = (await res.json()) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          usageData = parsed;
          break;
        }
      }
    } catch {
      // try next
    }
  }

  if (!subData && !usageData) {
    return null;
  }

  let limit: number | undefined;
  let used: number | undefined;
  let remaining: number | undefined;
  let expiresAt: string | undefined;
  let tier: string | undefined;

  if (subData) {
    if (typeof subData.hard_limit_usd === "number") {
      limit = subData.hard_limit_usd;
    } else if (typeof subData.quota === "number") {
      limit = subData.quota;
    } else if (typeof subData.total_quota === "number") {
      limit = subData.total_quota;
    }

    if (typeof subData.remaining_quota === "number") {
      remaining = subData.remaining_quota;
    }

    const accessUntil =
      typeof subData.access_until === "number"
        ? subData.access_until
        : typeof subData.expire_time === "number"
          ? subData.expire_time
          : 0;
    if (accessUntil > 0) {
      const d = new Date(accessUntil * 1000);
      expiresAt = d.toISOString().split("T")[0];
    }

    const plan = subData.plan as Record<string, unknown> | undefined;
    if (plan && (plan.title || plan.name)) {
      tier = String(plan.title || plan.name);
    }
  }

  if (usageData && typeof usageData.total_usage === "number") {
    const rawUsage = usageData.total_usage;
    if (limit !== undefined && limit > 0 && rawUsage > limit && limit < 10000) {
      used = Math.round((rawUsage / 100) * 1000) / 1000;
    } else {
      used = Math.round(rawUsage * 1000) / 1000;
    }
  }

  if (subData && typeof subData.used_quota === "number") {
    used = subData.used_quota;
  }

  if (limit !== undefined && used !== undefined && remaining === undefined) {
    remaining = Math.max(0, Math.round((limit - used) * 1000) / 1000);
  }

  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(tier !== undefined ? { tier } : {})
  };
}

export async function getAntigravityLocalTokenStats(isCurrentProviderAntigravity = false): Promise<{
  totalTokens: number;
  todayTokens: number;
  totalRequests: number;
}> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const filter = {
    type: "agent_consume",
    OR: [
      { description: { contains: "antigravity" } },
      { description: { contains: "gemini" } }
    ]
  };

  let count = await prisma.pointRecord.count({ where: filter });
  let aggWhere: any = filter;

  if (count === 0 && isCurrentProviderAntigravity) {
    aggWhere = { type: "agent_consume" };
    count = await prisma.pointRecord.count({ where: aggWhere });
  }

  const [totalAgg, todayAgg] = await Promise.all([
    prisma.pointRecord.aggregate({
      _sum: { tokensUsed: true },
      where: aggWhere
    }),
    prisma.pointRecord.aggregate({
      _sum: { tokensUsed: true },
      where: {
        ...aggWhere,
        createdAt: { gte: startOfToday }
      }
    })
  ]);

  return {
    totalTokens: totalAgg._sum.tokensUsed ?? 0,
    todayTokens: todayAgg._sum.tokensUsed ?? 0,
    totalRequests: count
  };
}

export async function checkAntigravityAuthStatus(config: SakiConfigResponse): Promise<SakiAntigravityAuthStatusResponse> {
  const creds = readLocalAntigravityCredentials();
  const resolved = resolveAntigravityConfig(config);
  const mode = resolveAntigravityMode(providerConfigFor(resolved.providerConfigs, "antigravity"));
  const endpoint = resolved.baseUrl;
  const hasOAuthAccount = Boolean(creds.hasCredentials && (creds.accessToken || creds.activeAccount));

  let isEndpointReachable = false;
  let keyInvalid = false;
  if (mode === "direct") {
    // Direct mode: probe the official Google endpoint with the manual AIzaSy key.
    // 400/401/403 means the key itself is rejected -> report it as invalid.
    if (resolved.apiKey) {
      try {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(resolved.apiKey)}`,
          { method: "GET", headers: { accept: "application/json" } },
          4000
        );
        isEndpointReachable = response.ok;
        keyInvalid = response.status === 400 || response.status === 401 || response.status === 403;
      } catch {
        isEndpointReachable = false;
      }
    }
  } else {
    // Proxy mode: probe the reverse proxy /models endpoint (token optional).
    try {
      const testUrl = `${openAiBaseUrl(endpoint, endpoint)}/models`;
      const response = await fetchWithTimeout(
        testUrl,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {})
          }
        },
        3000
      );
      isEndpointReachable = response.ok || response.status === 401 || response.status === 403;
    } catch {
      isEndpointReachable = false;
    }
  }

  const available = mode === "direct" ? Boolean(resolved.apiKey) : isEndpointReachable;
  const authenticated =
    mode === "direct"
      ? Boolean(resolved.apiKey) && !keyInvalid
      : Boolean(isEndpointReachable || hasOAuthAccount);

  let message: string;
  if (mode === "direct") {
    if (!resolved.apiKey) {
      message = "官方直连模式尚未配置 Gemini API Key。请在连接方式中选择「官方直连 (Gemini API Key)」并填入 Google AI Studio 的 Key（AIzaSy 开头）。";
    } else if (keyInvalid) {
      message = "Gemini API Key 无效或已被拒绝 (HTTP 400/401/403)。请在 Google AI Studio 检查 Key 是否正确、是否已启用 Generative Language API。";
    } else if (isEndpointReachable) {
      message = "已配置 Gemini API Key，Google 官方服务直连就绪。";
    } else {
      message = "已配置 Gemini API Key，但暂时无法连接 Google 官方服务，请检查服务器网络或稍后重试。";
    }
  } else if (creds.activeAccount && creds.accessToken) {
    if (isEndpointReachable) {
      message = `已登录 Google 账号 (${creds.activeAccount})，反向代理服务连接正常。`;
    } else {
      message = `已登录 Google 账号 (${creds.activeAccount})。本地反代端点 (${endpoint}) 离线未响应，请在服务器启动 anti-api / antigravity-proxy 反代服务，或将连接方式切换为「官方直连 (Gemini API Key)」。`;
    }
  } else if (creds.activeAccount) {
    message = `已保存账号 (${creds.activeAccount})，但访问令牌已失效，请重新授权。`;
  } else if (isEndpointReachable) {
    message = `反向代理端点 (${endpoint}) 运行中，尚未登录 Google 账号。`;
  } else if (resolved.apiKey) {
    message = "已配置自定义反代 Bearer 令牌，但反代端点暂未响应。";
  } else {
    message = "当前未登录 Google 账号。可点击上方按钮完成 Google 官方授权。";
  }

  let usage: SakiAntigravityUsageInfo | undefined;
  try {
    // Proxy quota endpoints only exist on reverse proxies; never queried in direct mode.
    const [proxyQuota, localStats] = await Promise.all([
      mode === "proxy" && isEndpointReachable ? fetchProxyQuota(resolved.baseUrl, resolved.apiKey) : Promise.resolve(null),
      getAntigravityLocalTokenStats(config.provider === "antigravity")
    ]);

    usage = {
      totalTokensUsed: localStats.totalTokens,
      todayTokensUsed: localStats.todayTokens,
      totalRequests: localStats.totalRequests,
      ...(proxyQuota?.limit !== undefined ? { proxyQuotaLimit: proxyQuota.limit } : {}),
      ...(proxyQuota?.used !== undefined ? { proxyQuotaUsed: proxyQuota.used } : {}),
      ...(proxyQuota?.remaining !== undefined ? { proxyQuotaRemaining: proxyQuota.remaining } : {}),
      ...(proxyQuota?.expiresAt !== undefined ? { expiresAt: proxyQuota.expiresAt } : {}),
      ...(proxyQuota?.tier !== undefined ? { tier: proxyQuota.tier } : {})
    };
  } catch {
    // Keep usage undefined if querying fails
  }

  return {
    available,
    authenticated,
    mode,
    isEndpointReachable,
    hasLocalCredentials: creds.hasCredentials,
    ...(creds.activeAccount ? { accountEmail: creds.activeAccount } : {}),
    ...(creds.accounts.length > 0 ? { accounts: creds.accounts } : {}),
    endpoint,
    message,
    ...(usage ? { usage } : {})
  };
}

export const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || "";
export const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || "";
export const ANTIGRAVITY_REDIRECT_URI = "https://antigravity.google/oauth-callback";
export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "https://www.googleapis.com/auth/aicode",
  "openid"
].join(" ");

interface AntigravityOAuthSession {
  sessionId: string;
  codeVerifier: string;
  state: string;
  authUrl: string;
  createdAt: number;
}

const activeOAuthSessions = new Map<string, AntigravityOAuthSession>();

function getOAuthSessionsFile(): string {
  const dir = getAntigravityPrimaryDir();
  return join(dir, "saki_oauth_sessions.json");
}

function loadPersistedOAuthSessions(): void {
  try {
    const p = getOAuthSessionsFile();
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(data)) {
        const now = Date.now();
        for (const item of data) {
          if (item && item.sessionId && item.codeVerifier && item.createdAt && now - item.createdAt < 30 * 60 * 1000) {
            activeOAuthSessions.set(item.sessionId, item);
          }
        }
      }
    }
  } catch {}
}

function savePersistedOAuthSessions(): void {
  try {
    const p = getOAuthSessionsFile();
    const arr = Array.from(activeOAuthSessions.values());
    writeFileSync(p, JSON.stringify(arr, null, 2), "utf8");
  } catch {}
}

function pruneExpiredOAuthSessions() {
  loadPersistedOAuthSessions();
  const now = Date.now();
  for (const [key, sess] of activeOAuthSessions.entries()) {
    if (now - sess.createdAt > 30 * 60 * 1000) {
      activeOAuthSessions.delete(key);
    }
  }
  savePersistedOAuthSessions();
}

export function getAntigravityLoginUrl(): SakiAntigravityLoginUrlResponse {
  pruneExpiredOAuthSessions();
  const sessionId = randomBytes(16).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const queryParams = new URLSearchParams({
    access_type: "offline",
    client_id: ANTIGRAVITY_CLIENT_ID,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: ANTIGRAVITY_REDIRECT_URI,
    response_type: "code",
    scope: ANTIGRAVITY_SCOPES,
    state
  });

  const authUrl = `https://accounts.google.com/o/oauth2/auth?${queryParams.toString()}`;

  activeOAuthSessions.set(sessionId, {
    sessionId,
    codeVerifier,
    state,
    authUrl,
    createdAt: Date.now()
  });
  savePersistedOAuthSessions();

  return {
    url: authUrl,
    sessionId,
    verificationUri: authUrl,
    expiresIn: 1800,
    message: "已生成 Antigravity 官方 Google 登录授权链接。请在浏览器中登录授权，并在跳转页面复制 Authorization Code 粘贴回此处。"
  };
}

export async function exchangeAntigravityOAuthCode(
  payload: SakiAntigravityExchangeRequest,
  config: SakiConfigResponse
): Promise<SakiAntigravityAuthStatusResponse> {
  pruneExpiredOAuthSessions();
  loadPersistedOAuthSessions();
  const rawInput = trimString(payload.code);
  if (!rawInput) {
    throw new RouteError("请输入 Google 授权码 (Authorization Code)。", 400);
  }

  // A Gemini API key is NOT an OAuth credential: persist it as the direct-mode
  // API key in settings instead of the OAuth vault.
  if (rawInput.startsWith("AIzaSy")) {
    return saveAntigravityDirectApiKey(rawInput);
  }

  // If user pasted an OAuth access token or a full credential JSON directly
  if (rawInput.startsWith("ya29.") || (rawInput.startsWith("{") && rawInput.endsWith("}"))) {
    return loginAntigravityAccount({ tokenOrKey: rawInput, accountEmail: payload.accountEmail }, config);
  }

  let extractedCode = rawInput;
  if (rawInput.includes("code=")) {
    try {
      const parsedUrl = new URL(rawInput.startsWith("http") ? rawInput : `https://antigravity.google/${rawInput}`);
      const codeFromParam = parsedUrl.searchParams.get("code");
      if (codeFromParam) {
        extractedCode = codeFromParam;
      }
    } catch {
      const match = rawInput.match(/[?&]code=([^&#]+)/);
      if (match && match[1]) {
        extractedCode = decodeURIComponent(match[1]);
      }
    }
  }

  if (extractedCode.includes("%2F") || extractedCode.includes("%20")) {
    try {
      extractedCode = decodeURIComponent(extractedCode);
    } catch {}
  }
  extractedCode = extractedCode.trim();

  let session: AntigravityOAuthSession | undefined;
  if (payload.sessionId) {
    session = activeOAuthSessions.get(payload.sessionId);
  }
  if (!session) {
    let latestTime = 0;
    for (const sess of activeOAuthSessions.values()) {
      if (sess.createdAt > latestTime) {
        latestTime = sess.createdAt;
        session = sess;
      }
    }
  }

  if (!session) {
    throw new RouteError("未找到本次授权的会话，请先点击上方的【前往 Google 官方授权登录页】重新发起授权登录。", 400);
  }

  const bodyParams = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    code: extractedCode,
    code_verifier: session.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: ANTIGRAVITY_REDIRECT_URI
  });

  let tokenJson: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  } = {};

  try {
    const tokenRes = await fetchWithTimeout(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: bodyParams.toString()
      },
      15000
    );

    tokenJson = (await tokenRes.json()) as typeof tokenJson;

    if (!tokenRes.ok || !tokenJson.access_token) {
      const errMsg = tokenJson.error_description || tokenJson.error || `HTTP ${tokenRes.status}`;
      throw new RouteError(`Google 授权码兑换令牌失败: ${errMsg}。请确认授权码未过期且未被重复使用。`, 400);
    }
  } catch (err) {
    if (err instanceof RouteError) throw err;
    throw new RouteError(`无法连接 Google OAuth 服务: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  activeOAuthSessions.delete(session.sessionId);

  let email = payload.accountEmail ? trimString(payload.accountEmail) : undefined;
  let name: string | undefined;
  let picture: string | undefined;

  try {
    const userinfoRes = await fetchWithTimeout(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: "application/json"
        }
      },
      6000
    );
    if (userinfoRes.ok) {
      const profile = (await userinfoRes.json()) as {
        email?: string;
        name?: string;
        picture?: string;
      };
      if (profile.email) email = profile.email;
      if (profile.name) name = profile.name;
      if (profile.picture) picture = profile.picture;
    }
  } catch {}

  if (!email && tokenJson.id_token) {
    try {
      const parts = tokenJson.id_token.split(".");
      if (parts[1]) {
        const payloadDecoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        if (payloadDecoded.email) email = String(payloadDecoded.email);
        if (payloadDecoded.name && !name) name = String(payloadDecoded.name);
        if (payloadDecoded.picture && !picture) picture = String(payloadDecoded.picture);
      }
    } catch {}
  }

  if (!email) {
    email = "google-user@antigravity";
  }

  const primaryDir = getAntigravityPrimaryDir();
  const oauthCredsPath = join(primaryDir, "oauth_creds.json");
  const cliDir = join(primaryDir, "antigravity-cli");
  const cliTokenPath = join(cliDir, "antigravity-oauth-token");
  const googleAccountsPath = join(primaryDir, "google_accounts.json");
  const vaultPath = join(primaryDir, "saki_antigravity_accounts.json");

  try {
    mkdirSync(primaryDir, { recursive: true });
    mkdirSync(cliDir, { recursive: true });
  } catch {}

  const expiryDate = Date.now() + (tokenJson.expires_in ?? 3600) * 1000;

  // 1. Write oauth_creds.json
  const oauthCredsContent = {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    id_token: tokenJson.id_token,
    token_type: tokenJson.token_type || "Bearer",
    scope: tokenJson.scope || ANTIGRAVITY_SCOPES,
    expiry_date: expiryDate
  };
  try {
    writeFileSync(oauthCredsPath, JSON.stringify(oauthCredsContent, null, 2), "utf8");
  } catch {}

  // 2. Write cliTokenPath
  try {
    writeFileSync(cliTokenPath, tokenJson.access_token, "utf8");
  } catch {}

  // 3. Update google_accounts.json
  try {
    let existingGoogleAccounts: { active?: string; old?: string[] } = {};
    if (existsSync(googleAccountsPath)) {
      try {
        existingGoogleAccounts = JSON.parse(readFileSync(googleAccountsPath, "utf8"));
      } catch {}
    }
    const oldAccounts = new Set<string>(Array.isArray(existingGoogleAccounts.old) ? existingGoogleAccounts.old : []);
    if (existingGoogleAccounts.active && existingGoogleAccounts.active !== email) {
      oldAccounts.add(existingGoogleAccounts.active);
    }
    oldAccounts.delete(email);
    writeFileSync(
      googleAccountsPath,
      JSON.stringify(
        {
          active: email,
          old: Array.from(oldAccounts)
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {}

  // 4. Update Saki account vault
  try {
    let sakiVault: SakiAccountsVault = {};
    if (existsSync(vaultPath)) {
      try {
        sakiVault = JSON.parse(readFileSync(vaultPath, "utf8")) as SakiAccountsVault;
      } catch {}
    }
    if (!sakiVault.accounts) sakiVault.accounts = {};
    sakiVault.active = email;
    sakiVault.accounts[email] = {
      email,
      ...(name ? { name } : {}),
      ...(picture ? { picture } : {}),
      token: tokenJson.access_token,
      ...(tokenJson.refresh_token ? { refreshToken: tokenJson.refresh_token } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      addedAt: new Date().toISOString()
    };
    writeFileSync(vaultPath, JSON.stringify(sakiVault, null, 2), "utf8");
  } catch {}

  return checkAntigravityAuthStatus(config);
}

export async function loginAntigravityAccount(
  payload: SakiAntigravityLoginRequest,
  config: SakiConfigResponse
): Promise<SakiAntigravityAuthStatusResponse> {
  const tokenOrKey = trimString(payload.tokenOrKey);
  if (!tokenOrKey) {
    throw new RouteError("凭据不能为空。请输入 Google OAuth 访问令牌或凭据 JSON（Gemini API Key 请使用「官方直连 (Gemini API Key)」输入框）。", 400);
  }

  // A Gemini API key is NOT an OAuth credential: persist it as the direct-mode
  // API key in settings instead of the OAuth token file / account vault.
  if (tokenOrKey.startsWith("AIzaSy")) {
    return saveAntigravityDirectApiKey(tokenOrKey);
  }

  // Automatic detection: if user pasted an Authorization code or redirect URL
  if (tokenOrKey.startsWith("4/") || tokenOrKey.includes("code=")) {
    return exchangeAntigravityOAuthCode({ code: tokenOrKey, accountEmail: payload.accountEmail }, config);
  }

  let email: string | undefined = trimString(payload.accountEmail) || undefined;
  let name: string | undefined;
  let picture: string | undefined;
  let accessToken = tokenOrKey;
  let refreshToken: string | undefined;
  let expiryDate: number | undefined;

  if (tokenOrKey.startsWith("{") && tokenOrKey.endsWith("}")) {
    try {
      const parsed = JSON.parse(tokenOrKey);
      accessToken =
        trimString(parsed.access_token) ||
        trimString(parsed.token) ||
        trimString(parsed.accessToken) ||
        trimString(parsed.apiKey) ||
        tokenOrKey;
      if (parsed.refresh_token) refreshToken = trimString(parsed.refresh_token) || undefined;
      if (typeof parsed.expiry_date === "number") expiryDate = parsed.expiry_date;
      if (!email) email = trimString(parsed.email) || trimString(parsed.active) || undefined;
    } catch {}
  }

  // A credential JSON may wrap a Gemini API key; treat it as a direct-mode key too.
  if (accessToken.startsWith("AIzaSy")) {
    return saveAntigravityDirectApiKey(accessToken);
  }

  // Google OAuth Access Token verification
  if (accessToken.startsWith("ya29.")) {
    try {
      const userinfoRes = await fetchWithTimeout(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        },
        6000
      );
      if (userinfoRes.ok) {
        const profile = (await userinfoRes.json()) as {
          email?: string;
          name?: string;
          picture?: string;
        };
        if (profile.email) email = profile.email;
        if (profile.name) name = profile.name;
        if (profile.picture) picture = profile.picture;
      } else if (userinfoRes.status === 401) {
        throw new RouteError("Google OAuth 访问令牌已失效或过期 (401 Unauthorized)。请重新在终端或 Google OAuth 获取有效令牌。", 401);
      }
    } catch (err) {
      if (err instanceof RouteError) throw err;
    }
  }

  if (!email) {
    email = `Google-${Date.now().toString().slice(-4)}`;
  }

  const geminiDir = getAntigravityPrimaryDir();
  const cliDir = join(geminiDir, "antigravity-cli");
  mkdirSync(cliDir, { recursive: true });

  // 1. Write antigravity-oauth-token
  try {
    writeFileSync(join(cliDir, "antigravity-oauth-token"), accessToken, "utf8");
  } catch {}

  // 2. Write oauth_creds.json
  try {
    const credsData = {
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      expiry_date: expiryDate ?? Date.now() + 3600 * 1000
    };
    writeFileSync(join(geminiDir, "oauth_creds.json"), JSON.stringify(credsData, null, 2), "utf8");
  } catch {}

  // 3. Update google_accounts.json
  const googleAccountsPath = join(geminiDir, "google_accounts.json");
  let googleAccounts: { active?: string; old?: string[] } = {};
  try {
    if (existsSync(googleAccountsPath)) {
      googleAccounts = JSON.parse(readFileSync(googleAccountsPath, "utf8"));
    }
  } catch {}
  const oldList = (Array.isArray(googleAccounts.old) ? googleAccounts.old : []).filter((e) => e !== email);
  if (googleAccounts.active && googleAccounts.active !== email) {
    oldList.unshift(googleAccounts.active);
  }
  googleAccounts.active = email;
  googleAccounts.old = Array.from(new Set(oldList));
  try {
    writeFileSync(googleAccountsPath, JSON.stringify(googleAccounts, null, 2), "utf8");
  } catch {}

  // 4. Update saki_antigravity_accounts.json
  const sakiVaultPath = join(geminiDir, "saki_antigravity_accounts.json");
  let sakiVault: { active?: string; accounts?: Record<string, SakiSavedAccountRecord> } = {};
  try {
    if (existsSync(sakiVaultPath)) {
      sakiVault = JSON.parse(readFileSync(sakiVaultPath, "utf8"));
    }
  } catch {}
  if (!sakiVault.accounts) sakiVault.accounts = {};
  sakiVault.active = email;
  sakiVault.accounts[email] = {
    email,
    ...(name ? { name } : {}),
    ...(picture ? { picture } : {}),
    token: accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiryDate ? { expiryDate } : {}),
    addedAt: new Date().toISOString()
  };
  try {
    writeFileSync(sakiVaultPath, JSON.stringify(sakiVault, null, 2), "utf8");
  } catch {}

  return checkAntigravityAuthStatus(config);
}

export async function switchAntigravityAccount(
  payload: SakiAntigravitySwitchAccountRequest,
  config: SakiConfigResponse
): Promise<SakiAntigravityAuthStatusResponse> {
  const targetEmail = trimString(payload.accountEmail);
  if (!targetEmail) {
    throw new RouteError("切换的目标账号不能为空。", 400);
  }

  const geminiDir = getAntigravityPrimaryDir();
  const sakiVaultPath = join(geminiDir, "saki_antigravity_accounts.json");
  const googleAccountsPath = join(geminiDir, "google_accounts.json");
  const cliDir = join(geminiDir, "antigravity-cli");

  let sakiVault: { active?: string; accounts?: Record<string, SakiSavedAccountRecord> } = {};
  try {
    if (existsSync(sakiVaultPath)) {
      sakiVault = JSON.parse(readFileSync(sakiVaultPath, "utf8"));
    }
  } catch {}

  let googleAccounts: { active?: string; old?: string[] } = {};
  try {
    if (existsSync(googleAccountsPath)) {
      googleAccounts = JSON.parse(readFileSync(googleAccountsPath, "utf8"));
    }
  } catch {}

  const targetRecord = sakiVault.accounts?.[targetEmail];
  if (targetRecord?.token) {
    mkdirSync(cliDir, { recursive: true });
    try {
      writeFileSync(join(cliDir, "antigravity-oauth-token"), targetRecord.token, "utf8");
    } catch {}
    try {
      const credsData = {
        access_token: targetRecord.token,
        ...(targetRecord.refreshToken ? { refresh_token: targetRecord.refreshToken } : {}),
        expiry_date: targetRecord.expiryDate ?? Date.now() + 3600 * 1000
      };
      writeFileSync(join(geminiDir, "oauth_creds.json"), JSON.stringify(credsData, null, 2), "utf8");
    } catch {}
  }

  // Update google_accounts.json
  const oldList = (Array.isArray(googleAccounts.old) ? googleAccounts.old : []).filter((e) => e !== targetEmail);
  if (googleAccounts.active && googleAccounts.active !== targetEmail) {
    oldList.unshift(googleAccounts.active);
  }
  googleAccounts.active = targetEmail;
  googleAccounts.old = Array.from(new Set(oldList));
  try {
    writeFileSync(googleAccountsPath, JSON.stringify(googleAccounts, null, 2), "utf8");
  } catch {}

  // Update sakiVault
  sakiVault.active = targetEmail;
  try {
    writeFileSync(sakiVaultPath, JSON.stringify(sakiVault, null, 2), "utf8");
  } catch {}

  return checkAntigravityAuthStatus(config);
}

export async function logoutAntigravityAccount(
  payload: SakiAntigravityLogoutRequest,
  config: SakiConfigResponse
): Promise<SakiAntigravityAuthStatusResponse> {
  const geminiDir = getAntigravityPrimaryDir();
  const sakiVaultPath = join(geminiDir, "saki_antigravity_accounts.json");
  const googleAccountsPath = join(geminiDir, "google_accounts.json");
  const cliTokenPath = join(geminiDir, "antigravity-cli", "antigravity-oauth-token");
  const credsPath = join(geminiDir, "oauth_creds.json");

  let sakiVault: { active?: string; accounts?: Record<string, SakiSavedAccountRecord> } = {};
  try {
    if (existsSync(sakiVaultPath)) {
      sakiVault = JSON.parse(readFileSync(sakiVaultPath, "utf8"));
    }
  } catch {}

  let googleAccounts: { active?: string; old?: string[] } = {};
  try {
    if (existsSync(googleAccountsPath)) {
      googleAccounts = JSON.parse(readFileSync(googleAccountsPath, "utf8"));
    }
  } catch {}

  const emailToRemove = trimString(payload.accountEmail) || sakiVault.active || googleAccounts.active;
  const isRemovingActive = Boolean(
    emailToRemove && (emailToRemove === sakiVault.active || emailToRemove === googleAccounts.active)
  );

  if (emailToRemove) {
    if (sakiVault.accounts && sakiVault.accounts[emailToRemove]) {
      delete sakiVault.accounts[emailToRemove];
    }
    if (googleAccounts.old) {
      googleAccounts.old = googleAccounts.old.filter((e) => e !== emailToRemove);
    }
  }

  if (isRemovingActive || !emailToRemove) {
    const remainingVaultAccounts = Object.keys(sakiVault.accounts || {});
    const nextAccount = remainingVaultAccounts[0] || (googleAccounts.old && googleAccounts.old[0]) || undefined;

    if (nextAccount) {
      return switchAntigravityAccount({ accountEmail: nextAccount }, config);
    } else {
      delete sakiVault.active;
      delete googleAccounts.active;
      googleAccounts.old = [];
      const candidateDirs = getAntigravityCandidateDirs();
      for (const baseDir of candidateDirs) {
        const tokenFiles = [
          join(baseDir, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
          join(baseDir, ".gemini", "oauth_creds.json"),
          join(baseDir, ".gemini", "antigravity", "session.json"),
          join(baseDir, ".gemini", "antigravity-cli", "session.json"),
          join(baseDir, ".config", "antigravity", "antigravity-oauth-token"),
          join(baseDir, ".config", "antigravity", "session.json"),
          join(baseDir, ".config", "antigravity-cli", "antigravity-oauth-token")
        ];
        for (const tf of tokenFiles) {
          try {
            if (existsSync(tf)) unlinkSync(tf);
          } catch {}
        }
      }
    }
  }

  try {
    writeFileSync(googleAccountsPath, JSON.stringify(googleAccounts, null, 2), "utf8");
  } catch {}
  try {
    writeFileSync(sakiVaultPath, JSON.stringify(sakiVault, null, 2), "utf8");
  } catch {}

  return checkAntigravityAuthStatus(config);
}

export async function fetchAntigravityModelCatalog(
  config: SakiConfigResponse,
  warnings?: Array<{ provider: string; message: string }>
): Promise<SakiModelOption[]> {
  const resolved = resolveAntigravityConfig(config);
  const mode = resolveAntigravityMode(providerConfigFor(resolved.providerConfigs, "antigravity"));
  const creds = readLocalAntigravityCredentials();
  const rawBase = trimString(resolved.baseUrl) || ANTIGRAVITY_DEFAULT_PROXY_BASE_URL;
  const rootUrl = rawBase.replace(/\/v1\/?$/, "");

  if (mode === "direct") {
    // Direct mode: query ONLY the official Google API with the manual AIzaSy key.
    // OAuth tokens are never sent to Google official endpoints.
    const effectiveKey = trimString(resolved.apiKey);
    if (!effectiveKey) {
      warnings?.push({
        provider: "antigravity",
        message: "官方直连模式尚未配置 Gemini API Key，无法从 Google 官方 API 同步模型列表。已展示备用预设列表；请在「官方直连 (Gemini API Key)」输入框中填入 AIzaSy 开头的 Key 后重试。"
      });
      return defaultAntigravityModels;
    }

    let directErrorReason = "";
    try {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(effectiveKey)}`,
        { method: "GET", headers: { accept: "application/json" } },
        6000
      );
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> };
        const rawModels = Array.isArray(data?.models) ? data.models : [];
        const liveGoogleModels: SakiModelOption[] = [];
        for (const m of rawModels) {
          const rawName = String(m.name || "");
          const cleanId = rawName.replace(/^models\//, "");
          const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
          // Filter to models that can generate content (chat/text/vision)
          if (cleanId && (methods.length === 0 || methods.includes("generateContent"))) {
            liveGoogleModels.push({
              provider: "antigravity",
              id: cleanId,
              name: cleanId,
              label: m.displayName ? `${m.displayName} (${cleanId})` : cleanId,
              vendor: "Google",
              supportsVision: true
            });
          }
        }
        if (liveGoogleModels.length > 0) {
          // Direct sync from Google succeeded: return ONLY live official models! Zero guesswork!
          return uniqueModels(liveGoogleModels);
        }
        directErrorReason = "Google 官方 API 返回了空的模型列表";
      } else {
        directErrorReason = `HTTP ${res.status}: ${res.statusText}`;
      }
    } catch (err) {
      directErrorReason = err instanceof Error ? err.message : String(err);
    }

    warnings?.push({
      provider: "antigravity",
      message: `未能通过 Gemini API Key 从 Google 官方 API 同步模型列表（原因：${directErrorReason || "服务未响应"}）。已展示备用预设列表；请检查 Key 是否有效以及服务器能否访问 Google 服务。`
    });
    return defaultAntigravityModels;
  }

  // Proxy mode: query ONLY the reverse proxy gateway (e.g. anti-api or antigravity-proxy).
  const proxyCandidateUrls = [
    `${rawBase.replace(/\/+$/, "")}/models`,
    `${rootUrl}/v1/models`,
    `${rootUrl}/models`
  ];

  const headerCandidates: Record<string, string>[] = [];
  // Standard proxy: try without Authorization header first (most local proxies like anti-api don't require or validate tokens)
  headerCandidates.push({ accept: "application/json" });
  if (resolved.apiKey) {
    headerCandidates.push({
      accept: "application/json",
      authorization: `Bearer ${resolved.apiKey}`
    });
  }
  if (creds.accessToken && creds.accessToken !== resolved.apiKey) {
    headerCandidates.push({
      accept: "application/json",
      authorization: `Bearer ${creds.accessToken}`
    });
  }

  let proxyErrorReason = "";
  for (const url of Array.from(new Set(proxyCandidateUrls))) {
    for (const headers of headerCandidates) {
      try {
        const res = await fetchWithTimeout(url, { method: "GET", headers }, 4000);
        if (res.ok) {
          const payload = await res.json();
          const items = collectModelItems(payload);
          if (items.length > 0) {
            const parsed = items
              .map((item) => modelOptionFromItem("antigravity", item))
              .filter((m): m is SakiModelOption => Boolean(m?.id));
            if (parsed.length > 0) {
              // Direct sync succeeded: return ONLY the live models from the proxy! Zero guesswork!
              return uniqueModels(
                parsed.map((m) => ({
                  ...m,
                  provider: "antigravity",
                  vendor: m.vendor || "Antigravity Proxy",
                  supportsVision: sakiListedModelSupportsVision({
                    id: m.id,
                    provider: "antigravity",
                    name: m.name,
                    label: m.label,
                    ...(m.supportsVision !== undefined ? { supportsVision: m.supportsVision } : {})
                  })
                }))
              );
            }
          }
        } else {
          proxyErrorReason = `HTTP ${res.status}: ${res.statusText}`;
        }
      } catch (err) {
        proxyErrorReason = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Fallback: If live sync failed, record why and return default models
  warnings?.push({
    provider: "antigravity",
    message: `未能从实时反代服务 (${rawBase}) 同步到最新模型列表（原因：${proxyErrorReason || "服务未响应"}）。已展示备用预设列表。若您在本地运行了 anti-api，请确保代理服务已启动并监听对应端口；或将连接方式切换为「官方直连 (Gemini API Key)」。`
  });

  return defaultAntigravityModels;
}

function handleAntigravityCallError(error: unknown, resolved: SakiConfigResponse): never {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const mode = resolveAntigravityMode(providerConfigFor(resolved.providerConfigs, "antigravity"));
  const isConnRefused =
    message.includes("ECONNREFUSED") ||
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ETIMEDOUT");

  if (isConnRefused) {
    if (mode === "direct") {
      throw new RouteError(
        `无法连接至 Google 官方服务 (${resolved.baseUrl})。\n\n• 当前为「官方直连 (Gemini API Key)」模式，请检查服务器网络能否访问 Google 服务；\n• 若服务器无法直连 Google，请在【系统设置 -> Antigravity】将连接方式切换为「本地反代网关」，并确保反代服务已启动。`,
        502
      );
    }
    throw new RouteError(
      `无法连接至 Antigravity 反代服务 (${resolved.baseUrl})。\n\n• 当前为「本地反代网关」模式，反向代理服务尚未启动或端口不可达；\n• 快速解决指引：\n  1.【本地反代】若使用本地反向代理（如 anti-api 或 antigravity-proxy），请在服务器终端启动代理进程并监听对应端口；\n  2.【修改端点】若代理运行在其他端口或外部主机，请在连接方式设置中将 Base URL 调整为实际可访问的地址；\n  3.【免代理直连】或将连接方式切换为「官方直连 (Gemini API Key)」，填入 Google AI Studio 免费获取的 Key 即可直连官方 API。`,
      502
    );
  }

  if (message.includes("401") || message.includes("Unauthorized") || message.includes("API key not valid")) {
    throw new RouteError(
      `Antigravity 认证失败 (401 Unauthorized)。请检查 API Key / OAuth Token 是否有效，或在 Google AI Studio 获取有效 API Key。`,
      401
    );
  }

  if (
    message.includes("402") ||
    message.includes("Insufficient Balance") ||
    message.includes("insufficient_quota") ||
    message.includes("quota_exceeded")
  ) {
    throw new RouteError(
      `Antigravity / 反向代理服务额度不足 (402 Insufficient Balance)。\n\n• 当前反代端点 (${resolved.baseUrl}) 或所关联的代理账户额度已耗尽；\n• 建议排查方法：\n  1. 若有其他已绑定的 Google 账号，请在【系统设置 -> Saki 设置】点击切换账号；\n  2. 或将连接方式切换为「官方直连 (Gemini API Key)」并填入从 Google AI Studio 免费获取的 Key，直连官方接口避免代理额度限制；\n  3. 若使用第三方反代服务，请前往对应代理后台充值余额或刷新配额。`,
      402
    );
  }

  if (message.includes("429") || message.includes("rate limit") || message.includes("Resource has been exhausted")) {
    throw new RouteError(
      `Antigravity / 模型服务调用频率受限 (429 Rate Limit Exceeded)。请稍候重试，或在设置中切换为其他 Google 账号或备用模型。`,
      429
    );
  }

  if (message.includes("No flow routing") || message.includes("routing entries")) {
    throw new RouteError(
      `反代服务未配置该模型的路由条目 (${message})。\n\n• 当前本地反向代理（anti-api）未配置模型 "${resolved.model}" 的路由；\n• 建议解决方法：请在页面顶部的【模型名称 (Model)】下拉菜单中，选择反代支持的标准模型（如 Gemini 2.5 Flash 或 Gemini 2.5 Pro），保存设置后重试。`,
      400
    );
  }

  if (error instanceof RouteError) throw error;
  throw new RouteError(message, 500);
}

export async function callAntigravityModel(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<string> {
  const resolved = resolveAntigravityConfig(config);
  try {
    return await callOpenAiCompatibleModel("antigravity", resolved, input, prompt);
  } catch (error) {
    return handleAntigravityCallError(error, resolved);
  }
}

export async function callAntigravityModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<string> {
  const resolved = resolveAntigravityConfig(config);
  try {
    return await callOpenAiCompatibleModelStream("antigravity", resolved, input, prompt, onDelta, onThinking);
  } catch (error) {
    return handleAntigravityCallError(error, resolved);
  }
}

export async function callAntigravityAgentTurn(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<SakiModelToolTurn> {
  const resolved = resolveAntigravityConfig(config);
  try {
    return await callOpenAiCompatibleAgentTurnWithFallback("antigravity", resolved, input, prompt);
  } catch (error) {
    return handleAntigravityCallError(error, resolved);
  }
}

export async function callAntigravityAgentTurnStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const resolved = resolveAntigravityConfig(config);
  try {
    return await callOpenAiCompatibleAgentTurnStreamWithFallback("antigravity", resolved, input, prompt, onDelta, onThinking);
  } catch (error) {
    return handleAntigravityCallError(error, resolved);
  }
}
