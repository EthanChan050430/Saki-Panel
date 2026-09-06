import { panelConfig, panelPaths } from "../../config.js";
import type { SakiConfigResponse, SakiProviderConfig, UpdateSakiConfigRequest } from "@webops/shared";
import { publishAppearanceUpdate } from "./appearance-events.js";
import { registerCopilotConfigHost } from "./providers.js";
import {
  defaultLocalProviderUrl,
  defaultProviderConfig,
  knownProviderIds,
  localProviderUrls,
  minAgentModelRequestTimeoutMs,
  normalizeProviderId,
  normalizeTimeout,
  objectValue,
  providerConfigFor,
  providerDefaults,
  readJsonFile,
  sanitizePanelAppearance,
  sanitizeProviderConfig,
  trimString,
  writeJsonFile,
  type PanelSakiSettings
} from "./types.js";

function buildProviderConfigs(settings: PanelSakiSettings): Record<string, SakiProviderConfig> {
  const providerConfigs: Record<string, SakiProviderConfig> = {};
  for (const providerId of knownProviderIds) {
    providerConfigs[providerId] = defaultProviderConfig(providerId);
  }

  const savedConfigs = objectValue(settings.providerConfigs);
  if (savedConfigs) {
    for (const [rawProvider, rawConfig] of Object.entries(savedConfigs)) {
      const providerId = normalizeProviderId(rawProvider);
      providerConfigs[providerId] = sanitizeProviderConfig(providerId, rawConfig);
    }
  }

  const activeProvider = normalizeProviderId(settings.provider ?? panelConfig.sakiProvider ?? "ollama");
  const activeConfig = {
    ...(providerConfigs[activeProvider] ?? defaultProviderConfig(activeProvider))
  };
  if (settings.model !== undefined) activeConfig.model = trimString(settings.model);
  if (settings.ollamaUrl !== undefined) activeConfig.ollamaUrl = trimString(settings.ollamaUrl);
  if (settings.baseUrl !== undefined) activeConfig.baseUrl = trimString(settings.baseUrl);
  if (settings.apiKey !== undefined) activeConfig.apiKey = trimString(settings.apiKey);
  if (panelConfig.sakiModel && !trimString(activeConfig.model)) activeConfig.model = panelConfig.sakiModel;
  if (panelConfig.sakiOllamaUrl && activeProvider === "ollama" && !trimString(activeConfig.ollamaUrl)) {
    activeConfig.ollamaUrl = panelConfig.sakiOllamaUrl;
  }
  providerConfigs[activeProvider] = sanitizeProviderConfig(activeProvider, activeConfig);

  return providerConfigs;
}

export async function readPanelSakiSettings(): Promise<PanelSakiSettings> {
  return readJsonFile<PanelSakiSettings>(panelPaths.sakiConfigFile, {});
}

export async function readEffectiveSakiConfig(): Promise<SakiConfigResponse> {
  const settings = await readPanelSakiSettings();
  const provider = normalizeProviderId(settings.provider ?? panelConfig.sakiProvider ?? "ollama");
  const providerConfigs = buildProviderConfigs(settings);
  const providerConfig = providerConfigFor(providerConfigs, provider);
  const systemPrompt = settings.systemPrompt !== undefined ? settings.systemPrompt : null;
  return {
    requestTimeoutMs: settings.requestTimeoutMs ?? panelConfig.sakiRequestTimeoutMs,
    provider,
    model: trimString(providerConfig.model) || (provider === "ollama" ? "llama3" : ""),
    ollamaUrl: trimString(providerConfig.ollamaUrl) || defaultLocalProviderUrl(provider) || localProviderUrls.ollama,
    baseUrl: trimString(providerConfig.baseUrl) || providerDefaults[provider]?.baseUrl || "",
    apiKey: trimString(providerConfig.apiKey),
    providerConfigs,
    searchEnabled: settings.searchEnabled !== false,
    mcpEnabled: Boolean(settings.mcpEnabled),
    systemPrompt,
    appearance: sanitizePanelAppearance(settings.appearance),
    configPath: panelPaths.sakiConfigFile,
    globalConfigPath: ""
  };
}

export async function saveSakiConfig(input: UpdateSakiConfigRequest): Promise<SakiConfigResponse> {
  const current = await readEffectiveSakiConfig();
  const nextProvider = input.provider !== undefined ? normalizeProviderId(input.provider) : current.provider;
  const providerConfigs: Record<string, SakiProviderConfig> = {};
  for (const [providerId, config] of Object.entries(current.providerConfigs)) {
    providerConfigs[providerId] = sanitizeProviderConfig(providerId, config);
  }
  if (input.providerConfigs && typeof input.providerConfigs === "object") {
    for (const [rawProvider, rawConfig] of Object.entries(input.providerConfigs)) {
      const providerId = normalizeProviderId(rawProvider);
      providerConfigs[providerId] = sanitizeProviderConfig(providerId, rawConfig);
    }
  }

  const activeConfig = {
    ...(providerConfigs[nextProvider] ?? defaultProviderConfig(nextProvider))
  };
  if (input.model !== undefined) activeConfig.model = trimString(input.model);
  if (input.ollamaUrl !== undefined) activeConfig.ollamaUrl = trimString(input.ollamaUrl);
  if (input.baseUrl !== undefined) activeConfig.baseUrl = trimString(input.baseUrl);
  if (input.apiKey !== undefined) activeConfig.apiKey = trimString(input.apiKey);
  providerConfigs[nextProvider] = sanitizeProviderConfig(nextProvider, activeConfig);

  const next: PanelSakiSettings = {
    requestTimeoutMs: normalizeTimeout(input.requestTimeoutMs, current.requestTimeoutMs),
    provider: nextProvider,
    model: trimString(providerConfigs[nextProvider]?.model) || (nextProvider === "ollama" ? "llama3" : ""),
    ollamaUrl: trimString(providerConfigs[nextProvider]?.ollamaUrl) || defaultLocalProviderUrl(nextProvider) || localProviderUrls.ollama,
    baseUrl: trimString(providerConfigs[nextProvider]?.baseUrl) || providerDefaults[nextProvider]?.baseUrl || "",
    apiKey: trimString(providerConfigs[nextProvider]?.apiKey),
    providerConfigs,
    searchEnabled: input.searchEnabled !== undefined ? Boolean(input.searchEnabled) : current.searchEnabled,
    mcpEnabled: input.mcpEnabled !== undefined ? Boolean(input.mcpEnabled) : current.mcpEnabled,
    appearance: input.appearance !== undefined ? sanitizePanelAppearance(input.appearance, current.appearance) : current.appearance
  };
  const nextSystemPrompt = input.systemPrompt !== undefined ? input.systemPrompt : current.systemPrompt;
  if (nextSystemPrompt !== undefined) {
    next.systemPrompt = nextSystemPrompt;
  }

  const appearanceChanged = JSON.stringify(current.appearance) !== JSON.stringify(next.appearance);
  await writeJsonFile(panelPaths.sakiConfigFile, next);
  const saved = await readEffectiveSakiConfig();
  if (appearanceChanged) {
    publishAppearanceUpdate(saved.appearance);
  }
  return saved;
}

async function persistCopilotTokenForPanel(gitHubToken: string): Promise<void> {
  const current = await readEffectiveSakiConfig();
  const providerConfigs = {
    ...current.providerConfigs,
    copilot: sanitizeProviderConfig("copilot", {
      ...providerConfigFor(current.providerConfigs, "copilot"),
      apiKey: gitHubToken
    })
  };
  await saveSakiConfig({ providerConfigs });
}

export function initSakiConfigHost(): void {
  registerCopilotConfigHost({
    readEffectiveConfig: readEffectiveSakiConfig,
    persistCopilotToken: persistCopilotTokenForPanel
  });
}