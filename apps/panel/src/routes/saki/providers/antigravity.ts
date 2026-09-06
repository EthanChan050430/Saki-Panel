import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SakiAntigravityAuthStatusResponse,
  SakiChatRequest,
  SakiConfigResponse,
  SakiModelOption
} from "@webops/shared";
import { sakiListedModelSupportsVision } from "@webops/shared";
import type { SakiModelToolTurn } from "../types.js";
import {
  openAiBaseUrl,
  providerConfigFor,
  providerDefaults,
  trimString,
  uniqueModels
} from "../types.js";
import {
  callOpenAiCompatibleAgentTurnStreamWithFallback,
  callOpenAiCompatibleAgentTurnWithFallback,
  callOpenAiCompatibleModel,
  callOpenAiCompatibleModelStream
} from "./openai.js";
import { fetchOpenAiModelCatalog } from "./catalog.js";
import { fetchWithTimeout } from "../types.js";

export const defaultAntigravityModels: SakiModelOption[] = [
  {
    provider: "antigravity",
    id: "gemini-3.8-flash",
    name: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash (High)",
    vendor: "Google Antigravity",
    supportsVision: true
  },
  {
    provider: "antigravity",
    id: "gemini-3.7-flash",
    name: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    vendor: "Google Antigravity",
    supportsVision: true
  },
  {
    provider: "antigravity",
    id: "gemini-2.5-pro",
    name: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
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
  }
];

export interface LocalAntigravityCredentials {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  expiryDate?: number | undefined;
  activeAccount?: string | undefined;
  hasCredentials: boolean;
}

export function readLocalAntigravityCredentials(): LocalAntigravityCredentials {
  try {
    const geminiDir = join(homedir(), ".gemini");
    const credsPath = join(geminiDir, "oauth_creds.json");
    const accountsPath = join(geminiDir, "google_accounts.json");

    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    let expiryDate: number | undefined;
    let activeAccount: string | undefined;

    if (existsSync(credsPath)) {
      const data = JSON.parse(readFileSync(credsPath, "utf8"));
      accessToken = trimString(data.access_token) || undefined;
      refreshToken = trimString(data.refresh_token) || undefined;
      expiryDate = typeof data.expiry_date === "number" ? data.expiry_date : undefined;
    }

    if (existsSync(accountsPath)) {
      const data = JSON.parse(readFileSync(accountsPath, "utf8"));
      activeAccount = trimString(data.active) || undefined;
    }

    return {
      accessToken,
      refreshToken,
      expiryDate,
      activeAccount,
      hasCredentials: Boolean(accessToken || refreshToken)
    };
  } catch {
    return { hasCredentials: false };
  }
}

export function resolveAntigravityConfig(config: SakiConfigResponse): SakiConfigResponse {
  const providerConfig = providerConfigFor(config.providerConfigs, "antigravity");
  const fallbackBaseUrl = providerDefaults.antigravity?.baseUrl || "http://localhost:8080/v1";
  const baseUrl = trimString(providerConfig.baseUrl) || trimString(config.baseUrl) || fallbackBaseUrl;
  let apiKey = trimString(providerConfig.apiKey) || trimString(config.apiKey);

  if (!apiKey) {
    const creds = readLocalAntigravityCredentials();
    if (creds.accessToken) {
      apiKey = creds.accessToken;
    }
  }

  const model = trimString(providerConfig.model) || trimString(config.model) || "gemini-3.8-flash";

  return {
    ...config,
    provider: "antigravity",
    baseUrl,
    apiKey,
    model
  };
}

export async function checkAntigravityAuthStatus(config: SakiConfigResponse): Promise<SakiAntigravityAuthStatusResponse> {
  const creds = readLocalAntigravityCredentials();
  const resolved = resolveAntigravityConfig(config);
  const endpoint = resolved.baseUrl;

  let isEndpointReachable = false;
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

  const authenticated = Boolean(creds.hasCredentials || resolved.apiKey || isEndpointReachable);

  let message = "未检测到 Antigravity CLI 本地配置或代理服务。";
  if (creds.hasCredentials) {
    message = `已发现本地 Antigravity 登录凭据${creds.activeAccount ? ` (${creds.activeAccount})` : ""}。`;
  } else if (isEndpointReachable) {
    message = `已连接至 Antigravity 代理端点 (${endpoint})。`;
  } else if (resolved.apiKey) {
    message = "已配置 API Key。";
  }

  return {
    available: creds.hasCredentials || isEndpointReachable,
    authenticated,
    hasLocalCredentials: creds.hasCredentials,
    ...(creds.activeAccount ? { accountEmail: creds.activeAccount } : {}),
    endpoint,
    message
  };
}

export async function fetchAntigravityModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  const resolved = resolveAntigravityConfig(config);
  try {
    const fetched = await fetchOpenAiModelCatalog("antigravity", resolved);
    if (fetched.length > 0) {
      return uniqueModels([
        ...fetched.map((m) => ({
          ...m,
          provider: "antigravity",
          vendor: m.vendor || "Google Antigravity",
          supportsVision: sakiListedModelSupportsVision({
            id: m.id,
            provider: "antigravity",
            name: m.name,
            label: m.label,
            ...(m.supportsVision !== undefined ? { supportsVision: m.supportsVision } : {})
          })
        })),
        ...defaultAntigravityModels
      ]);
    }
  } catch {
    // Return curated fallback list if remote model catalog fetch fails
  }

  return defaultAntigravityModels;
}

export async function callAntigravityModel(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<string> {
  const resolved = resolveAntigravityConfig(config);
  return callOpenAiCompatibleModel("antigravity", resolved, input, prompt);
}

export async function callAntigravityModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<string> {
  const resolved = resolveAntigravityConfig(config);
  return callOpenAiCompatibleModelStream("antigravity", resolved, input, prompt, onDelta, onThinking);
}

export async function callAntigravityAgentTurn(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string
): Promise<SakiModelToolTurn> {
  const resolved = resolveAntigravityConfig(config);
  return callOpenAiCompatibleAgentTurnWithFallback("antigravity", resolved, input, prompt);
}

export async function callAntigravityAgentTurnStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const resolved = resolveAntigravityConfig(config);
  return callOpenAiCompatibleAgentTurnStreamWithFallback("antigravity", resolved, input, prompt, onDelta, onThinking);
}
