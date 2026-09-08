import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Cpu,
  Image as ImageIcon,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Save,
  Settings,
  TextQuote,
  Wrench
} from "lucide-react";
import type {
  CurrentUser,
  PanelAppearanceSettings,
  RegistrationIdentity,
  SakiAntigravityAuthStatusResponse,
  SakiAntigravityLoginUrlResponse,
  SakiConfigResponse,
  SakiCopilotAuthStatusResponse,
  SakiCopilotLoginResponse,
  SakiModelOption,
  SakiProviderConfig,
  SakiSkillSummary,
  UpdateSakiConfigRequest
} from "@webops/shared";
import type { SakiSettingsSection } from "../types/app.js";
import { api, ApiError } from "../api.js";
import { parseHashRoute, updateHashRoute } from "../utils/route.js";
import { panelT, type PanelLanguage, type PanelTextKey } from "../i18n/index.js";
import { defaultSakiRequestTimeoutMs } from "../constants.js";
import { normalizePanelAppearance } from "../utils/appearance.js";
import { appearanceMediaFileToDataUrl } from "../components/common/AccountAvatar.js";
import {
  checkWebGPUSupport,
  getSakiVoiceEchoEngine,
  setSakiVoiceEchoEngine,
  type SakiVoiceEchoEngineType,
  type WebGPUDetectionResult
} from "../components/saki/sakiVoiceEngine.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import {
  antigravityModeOf,
  emptySakiConfig,
  formatSessionTimeoutMinutes,
  localProviderUrlDefaults,
  needsCloudApiFields,
  parseSessionTimeoutMinutesDraft,
  providerBaseUrlDefaults,
  providerConfigFromForm,
  registrationIdentityOptions,
  type AntigravityMode,
  SettingsAppearanceTab,
  SettingsFeaturesTab,
  SettingsModelTab,
  SettingsPromptTab,
  SettingsSkillsTab,
  SettingsSystemTab,
  WatchNotifyPanel
} from "./settings/index.js";

export function SettingsView({
  token,
  onLogout,
  onSessionRefresh,
  refreshTick,
  onAppearanceChange,
  language,
  onLanguageChange
}: {
  token: string;
  onLogout: () => void;
  onSessionRefresh: (token: string, user: CurrentUser) => void;
  refreshTick: number;
  onAppearanceChange: (appearance: PanelAppearanceSettings) => void;
  language: PanelLanguage;
  onLanguageChange: (language: PanelLanguage) => void;
}) {
  const [form, setForm] = useState<SakiConfigResponse>(emptySakiConfig);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState("120");
  const [registrationIdentity, setRegistrationIdentity] = useState<RegistrationIdentity>("none");
  const [skillList, setSkillList] = useState<SakiSkillSummary[]>([]);
  const [activeSettingsSection, setActiveSettingsSectionState] = useState<SakiSettingsSection>(() => {
    return parseHashRoute().settingsSection ?? "system";
  });

  const setActiveSettingsSection = useCallback((sec: SakiSettingsSection) => {
    setActiveSettingsSectionState(sec);
    updateHashRoute({ view: "settings", settingsSection: sec });
  }, []);

  const [settingsMenuCollapsed, setSettingsMenuCollapsed] = useState(false);
  const [modelOptions, setModelOptions] = useState<SakiModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [detectingModels, setDetectingModels] = useState(false);
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<SakiCopilotAuthStatusResponse | null>(null);
  const [copilotLoginState, setCopilotLoginState] = useState<SakiCopilotLoginResponse | null>(null);
  const [copilotBusy, setCopilotBusy] = useState<"status" | "login" | null>(null);
  const [antigravityStatus, setAntigravityStatus] = useState<SakiAntigravityAuthStatusResponse | null>(null);
  const [antigravityLoginState, setAntigravityLoginState] = useState<SakiAntigravityLoginUrlResponse | null>(() => {
    try {
      const saved = sessionStorage.getItem("saki_antigravity_login_state");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [antigravityOAuthActive, setAntigravityOAuthActive] = useState(() => {
    try {
      return Boolean(sessionStorage.getItem("saki_antigravity_oauth_active"));
    } catch {
      return false;
    }
  });
  const [antigravityAuthCodeInput, setAntigravityAuthCodeInput] = useState("");
  const [antigravityBusy, setAntigravityBusy] = useState(false);
  const [antigravityLoginModalOpen, setAntigravityLoginModalOpen] = useState(false);
  const [antigravityTokenInput, setAntigravityTokenInput] = useState("");
  const [antigravityEmailInput, setAntigravityEmailInput] = useState("");
  const [antigravityActionBusy, setAntigravityActionBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const t = useCallback((key: PanelTextKey) => panelT(language, key), [language]);
  const localizedRegistrationIdentityOptions = useMemo<Array<{ value: RegistrationIdentity; label: string }>>(
    () => registrationIdentityOptions.map((option) => ({ ...option, label: t(`registration.${option.value}` as PanelTextKey) })),
    [t]
  );

  const [newMultiplierModel, setNewMultiplierModel] = useState("");
  const [newMultiplierValue, setNewMultiplierValue] = useState("1.0");
  const [customModelMode, setCustomModelMode] = useState(false);
  const [voiceEchoEngine, setVoiceEchoEngineState] = useState<SakiVoiceEchoEngineType>(() => getSakiVoiceEchoEngine());
  const [webGpuInfo, setWebGpuInfo] = useState<WebGPUDetectionResult | null>(null);

  useEffect(() => {
    void checkWebGPUSupport().then(setWebGpuInfo);
  }, []);

  const handleVoiceEchoEngineChange = (next: SakiVoiceEchoEngineType) => {
    setVoiceEchoEngineState(next);
    setSakiVoiceEchoEngine(next);
  };

  const defaultKnownModels = useMemo(
    () => [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (最新推荐/快速)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet (反代支持)" },
      { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet (反代支持)" }
    ],
    []
  );

  const combinedModelKeys = useMemo(() => {
    const keys = new Set<string>();
    if (form.model?.trim()) keys.add(form.model.trim());
    for (const m of defaultKnownModels) keys.add(m.id);
    for (const m of modelOptions) {
      if (m.id?.trim()) keys.add(m.id.trim());
    }
    if (form.modelPointsMultipliers) {
      for (const k of Object.keys(form.modelPointsMultipliers)) {
        if (k.trim()) keys.add(k.trim());
      }
    }
    return Array.from(keys);
  }, [defaultKnownModels, form.model, form.modelPointsMultipliers, modelOptions]);

  const handleSetModelMultiplier = useCallback((modelKey: string, value: number) => {
    const safeRate = Math.max(0, Math.round(value * 100) / 100);
    setForm((current) => ({
      ...current,
      modelPointsMultipliers: {
        ...(current.modelPointsMultipliers || {}),
        [modelKey]: safeRate
      }
    }));
  }, []);

  const handleResetModelMultiplier = useCallback((modelKey: string) => {
    setForm((current) => {
      const next = { ...(current.modelPointsMultipliers || {}) };
      delete next[modelKey];
      return {
        ...current,
        modelPointsMultipliers: next
      };
    });
  }, []);

  const handleAddCustomMultiplier = useCallback(() => {
    const key = newMultiplierModel.trim();
    if (!key) return;
    const parsed = parseFloat(newMultiplierValue);
    const rate = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 1.0;
    handleSetModelMultiplier(key, rate);
    setNewMultiplierModel("");
    setNewMultiplierValue("1.0");
  }, [handleSetModelMultiplier, newMultiplierModel, newMultiplierValue]);

  const refresh = useCallback(async () => {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const [nextConfig, nextSkills, nextSessionSettings] = await Promise.all([
        api.sakiConfig(token),
        api.sakiAllSkills(token),
        api.sessionSettings(token)
      ]);
      const migratedConfig =
        nextConfig.provider === "antigravity" && nextConfig.model === "gemini-3-flash"
          ? { ...nextConfig, model: "gemini-3.8-flash" }
          : nextConfig;
      setForm(migratedConfig);
      setSessionTimeoutMinutes(formatSessionTimeoutMinutes(nextSessionSettings.sessionTimeoutMinutes));
      setRegistrationIdentity(nextSessionSettings.registrationIdentity);
      onAppearanceChange(nextConfig.appearance);
      setSkillList(nextSkills);
      setModelOptions([]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : t("settings.readFailed"));
    } finally {
      setLoading(false);
    }
  }, [onAppearanceChange, onLogout, t, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  function withActiveProviderConfig(current: SakiConfigResponse, patch: Partial<SakiProviderConfig>): SakiConfigResponse {
    const provider = current.provider;
    const nextConfig: SakiProviderConfig = providerConfigFromForm(current, provider);
    if (patch.model !== undefined) nextConfig.model = patch.model;
    if (patch.ollamaUrl !== undefined) nextConfig.ollamaUrl = patch.ollamaUrl;
    if (patch.baseUrl !== undefined) nextConfig.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) nextConfig.apiKey = patch.apiKey;
    if (patch.mode !== undefined) nextConfig.mode = patch.mode;

    const next: SakiConfigResponse = {
      ...current,
      providerConfigs: {
        ...current.providerConfigs,
        [provider]: nextConfig
      }
    };
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.ollamaUrl !== undefined) next.ollamaUrl = patch.ollamaUrl;
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) next.apiKey = patch.apiKey;
    return next;
  }

  function updateActiveProviderConfig(patch: Partial<SakiProviderConfig>) {
    setModelOptions([]);
    setForm((current) => withActiveProviderConfig(current, patch));
  }

  function currentSakiConfigPayload(): UpdateSakiConfigRequest {
    const activeConfig = providerConfigFromForm(form, form.provider);
    const providerConfigs = {
      ...form.providerConfigs,
      [form.provider]: {
        ...activeConfig,
        model: form.model,
        ollamaUrl: form.ollamaUrl,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey
      }
    };
    const antigravityConfig = providerConfigs.antigravity ? { ...providerConfigs.antigravity } : undefined;
    if (antigravityConfig) {
      let mode = antigravityModeOf(antigravityConfig);
      if (mode === "proxy" && (antigravityConfig.apiKey ?? "").trim().startsWith("AIzaSy")) {
        mode = "direct";
      }
      antigravityConfig.mode = mode;
      if (mode === "direct") {
        antigravityConfig.baseUrl = "";
      } else {
        if (!(antigravityConfig.baseUrl ?? "").trim()) {
          antigravityConfig.baseUrl = providerBaseUrlDefaults.antigravity ?? "http://localhost:8080/v1";
        }
      }
      providerConfigs.antigravity = antigravityConfig;
    }
    const topLevelBaseUrl = form.provider === "antigravity" && antigravityConfig ? (antigravityConfig.baseUrl ?? "") : form.baseUrl;
    const topLevelApiKey = form.provider === "antigravity" && antigravityConfig ? (antigravityConfig.apiKey ?? "") : form.apiKey;
    return {
      requestTimeoutMs: Number(form.requestTimeoutMs) || defaultSakiRequestTimeoutMs,
      provider: form.provider,
      model: form.model,
      ollamaUrl: form.ollamaUrl,
      baseUrl: topLevelBaseUrl,
      apiKey: topLevelApiKey,
      providerConfigs,
      modelPointsMultipliers: form.modelPointsMultipliers || {},
      searchEnabled: form.searchEnabled,
      mcpEnabled: form.mcpEnabled,
      systemPrompt: form.systemPrompt ?? "",
      appearance: form.appearance
    };
  }

  function handleAntigravityApiKeyInput(value: string) {
    const currentMode = antigravityModeOf(providerConfigFromForm(form, "antigravity"));
    if (value.trim().startsWith("AIzaSy") && currentMode !== "direct") {
      setModelOptions([]);
      setNotice("检测到 Gemini API Key（AIzaSy...），已自动切换为「官方直连」模式，该 Key 只会发往 Google 官方端点。");
      setForm((current) => {
        const existing = providerConfigFromForm(current, "antigravity");
        return {
          ...current,
          apiKey: value,
          baseUrl: "",
          providerConfigs: {
            ...current.providerConfigs,
            antigravity: { ...existing, mode: "direct", apiKey: value, baseUrl: "" }
          }
        };
      });
      return;
    }
    updateActiveProviderConfig({ apiKey: value });
  }

  function switchAntigravityMode(mode: AntigravityMode) {
    setModelOptions([]);
    setForm((current) => {
      const existing = providerConfigFromForm(current, "antigravity");
      const nextConfig: SakiProviderConfig = {
        ...existing,
        mode,
        apiKey: ""
      };
      if (mode === "proxy" && !(nextConfig.baseUrl ?? "").trim()) {
        nextConfig.baseUrl = providerBaseUrlDefaults.antigravity ?? "http://localhost:8080/v1";
      }
      return {
        ...current,
        providerConfigs: {
          ...current.providerConfigs,
          antigravity: nextConfig
        },
        baseUrl: nextConfig.baseUrl ?? "",
        apiKey: ""
      };
    });
  }

  function changeProvider(provider: string) {
    setModelOptions([]);
    if (provider === "copilot") {
      void refreshCopilotAuthStatus(true);
    } else if (provider === "antigravity") {
      void refreshAntigravityStatus(true);
    }
    setForm((current) => {
      const nextConfig = providerConfigFromForm(current, provider);
      return {
        ...current,
        provider,
        model: nextConfig.model ?? (provider === "antigravity" ? "gemini-3.8-flash" : ""),
        ollamaUrl: nextConfig.ollamaUrl ?? localProviderUrlDefaults[provider as keyof typeof localProviderUrlDefaults] ?? "",
        baseUrl: nextConfig.baseUrl ?? providerBaseUrlDefaults[provider] ?? "",
        apiKey: nextConfig.apiKey ?? ""
      };
    });
  }

  function updateAppearance(patch: Partial<PanelAppearanceSettings>) {
    setForm((current) => ({
      ...current,
      appearance: normalizePanelAppearance({
        ...current.appearance,
        ...patch
      })
    }));
  }

  async function chooseAppearanceMedia(
    field: "appLogoSrc" | "sidebarLogoSrc" | "loginCoverSrc" | "backgroundSrc" | "mobileBackgroundSrc" | "darkBackgroundSrc" | "mobileDarkBackgroundSrc",
    event: React.ChangeEvent<HTMLInputElement>,
    allowVideo = false
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const dataUrl = await appearanceMediaFileToDataUrl(file, allowVideo);
      updateAppearance({ [field]: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : (allowVideo ? "文件读取失败" : "图片读取失败"));
    }
  }

  function chooseAppearanceImage(
    field: "appLogoSrc" | "sidebarLogoSrc" | "loginCoverSrc",
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    return chooseAppearanceMedia(field, event, false);
  }

  const refreshCopilotAuthStatus = useCallback(async (silent = false) => {
    if (!silent) {
      setError("");
      setNotice("");
      setCopilotBusy("status");
    }
    try {
      const status = await api.sakiCopilotStatus(token);
      setCopilotAuthStatus(status);
      if (!silent) {
        setNotice(
          status.authenticated
            ? `GitHub Copilot 已登录${status.login ? `：${status.login}` : ""}。`
            : status.message || "GitHub Copilot 尚未登录。"
        );
      }
      return status;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return null;
      }
      if (!silent) {
        setError(err instanceof Error ? err.message : "GitHub Copilot 状态检查失败");
      }
      return null;
    } finally {
      if (!silent) setCopilotBusy(null);
    }
  }, [onLogout, token]);

  async function startCopilotLoginFromSettings() {
    setError("");
    setNotice("");
    setCopilotBusy("login");
    try {
      const loginState = await api.sakiCopilotLogin(token);
      setCopilotLoginState(loginState);
      if (loginState.verificationUri) {
        window.open(loginState.verificationUri, "_blank", "noopener,noreferrer");
      }
      const status = await refreshCopilotAuthStatus(true);
      if (status?.authenticated) {
        setNotice(`GitHub Copilot 已登录${status.login ? `：${status.login}` : ""}。`);
      } else {
        setNotice(loginState.message || "GitHub 登录已启动。");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "GitHub 登录启动失败");
    } finally {
      setCopilotBusy(null);
    }
  }

  const refreshAntigravityStatus = useCallback(async (silent = false) => {
    if (!silent) {
      setError("");
      setNotice("");
      setAntigravityBusy(true);
    }
    try {
      const status = await api.sakiAntigravityStatus(token);
      setAntigravityStatus(status);
      if (!silent) {
        setNotice(status.message || "Antigravity 状态检测完成。");
      }
      return status;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return null;
      }
      if (!silent) {
        setError(err instanceof Error ? err.message : "Antigravity 状态检测失败");
      }
      return null;
    } finally {
      if (!silent) setAntigravityBusy(false);
    }
  }, [onLogout, token]);

  async function startAntigravityOAuthFlow() {
    setError("");
    setNotice("");
    setAntigravityActionBusy("oauth-init");
    try {
      const urlInfo = await api.sakiAntigravityLoginUrl(token);
      setAntigravityLoginState(urlInfo);
      setAntigravityOAuthActive(true);
      setAntigravityAuthCodeInput("");
      try {
        sessionStorage.setItem("saki_antigravity_login_state", JSON.stringify(urlInfo));
        sessionStorage.setItem("saki_antigravity_oauth_active", "1");
      } catch {}
      const jumpUrl = urlInfo.url || urlInfo.verificationUri;
      if (jumpUrl) {
        window.open(jumpUrl, "_blank", "noopener,noreferrer");
      }
      setNotice(urlInfo.message || "已在浏览器打开 Google 官方授权页。请在完成授权后，将页面展示的 Authorization Code 粘贴回此处。");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "获取 Google 官方授权链接失败");
    } finally {
      setAntigravityActionBusy(null);
    }
  }

  async function handleAntigravityOAuthExchange(e?: React.SyntheticEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const code = antigravityAuthCodeInput.trim();
    if (!code) {
      setError("请输入 Google 授权后显示的 Authorization Code（或完整回调 URL）。");
      return;
    }
    setError("");
    setNotice("");
    setAntigravityActionBusy("exchange");
    try {
      let activeSessionId = antigravityLoginState?.sessionId;
      if (!activeSessionId) {
        try {
          const saved = sessionStorage.getItem("saki_antigravity_login_state");
          if (saved) {
            const parsed = JSON.parse(saved);
            activeSessionId = parsed.sessionId;
          }
        } catch {}
      }
      const updatedStatus = await api.sakiAntigravityExchange(
        {
          code,
          ...(activeSessionId ? { sessionId: activeSessionId } : {})
        },
        token
      );
      setAntigravityStatus(updatedStatus);
      setAntigravityOAuthActive(false);
      setAntigravityAuthCodeInput("");
      try {
        sessionStorage.removeItem("saki_antigravity_login_state");
        sessionStorage.removeItem("saki_antigravity_oauth_active");
      } catch {}
      setNotice(
        updatedStatus.accountEmail
          ? `Google 账号 (${updatedStatus.accountEmail}) 授权成功，已连接 Antigravity CLI！`
          : "Google 账号授权成功，已连接 Antigravity CLI！"
      );
      void detectModels(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "Google 授权码验证失败，请确认授权码未过期且未被重复使用");
    } finally {
      setAntigravityActionBusy(null);
    }
  }

  async function handleAntigravityLoginSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!antigravityTokenInput.trim()) {
      setError("请输入 Google OAuth 访问令牌或凭据 JSON。");
      return;
    }
    if (antigravityTokenInput.trim().startsWith("AIzaSy")) {
      setError("检测到 Gemini API Key（AIzaSy 开头）。API Key 不属于 OAuth 凭据，请切换到「官方直连 (Gemini API Key)」连接方式，在其专属输入框中填写并保存设置。");
      return;
    }
    setError("");
    setNotice("");
    setAntigravityActionBusy("login");
    try {
      const updatedStatus = await api.sakiAntigravityLogin(
        {
          tokenOrKey: antigravityTokenInput.trim(),
          ...(antigravityEmailInput.trim() ? { accountEmail: antigravityEmailInput.trim() } : {})
        },
        token
      );
      setAntigravityStatus(updatedStatus);
      setAntigravityLoginModalOpen(false);
      setAntigravityTokenInput("");
      setAntigravityEmailInput("");
      setNotice(
        updatedStatus.accountEmail
          ? `Google / Antigravity 账号 (${updatedStatus.accountEmail}) 绑定成功！`
          : "Google / Antigravity 凭据已成功保存！"
      );
      void detectModels(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "Antigravity 登录绑定失败");
    } finally {
      setAntigravityActionBusy(null);
    }
  }

  async function handleAntigravitySwitchAccount(targetEmail: string) {
    if (!targetEmail || targetEmail === antigravityStatus?.accountEmail) return;
    setError("");
    setNotice("");
    setAntigravityActionBusy(`switch-${targetEmail}`);
    try {
      const updatedStatus = await api.sakiAntigravitySwitchAccount(
        { accountEmail: targetEmail },
        token
      );
      setAntigravityStatus(updatedStatus);
      setNotice(`已成功切换至账号：${targetEmail}`);
      void detectModels(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "切换账号失败");
    } finally {
      setAntigravityActionBusy(null);
    }
  }

  async function handleAntigravityLogout(emailToRemove?: string) {
    setError("");
    setNotice("");
    setAntigravityActionBusy("logout");
    try {
      const updatedStatus = await api.sakiAntigravityLogout(
        { ...(emailToRemove ? { accountEmail: emailToRemove } : {}) },
        token
      );
      setAntigravityStatus(updatedStatus);
      setAntigravityOAuthActive(false);
      setAntigravityLoginModalOpen(false);
      try {
        sessionStorage.removeItem("saki_antigravity_login_state");
        sessionStorage.removeItem("saki_antigravity_oauth_active");
      } catch {}
      setNotice(emailToRemove ? `账号 ${emailToRemove} 已移除。` : "当前 Antigravity 账号已退出登录。");
      void detectModels(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "退出登录失败");
    } finally {
      setAntigravityActionBusy(null);
    }
  }

  async function detectModels(silent = false) {
    const provider = form.provider;
    if (needsCloudApiFields(provider) && (!form.baseUrl.trim() || !form.apiKey.trim())) {
      if (!silent) {
        setNotice("");
        setError("请先填写模型 API Base URL 和 API Key。");
      }
      return;
    }
    if (provider === "ollama" && !form.ollamaUrl.trim()) {
      if (!silent) {
        setNotice("");
        setError("请先填写 Ollama URL。");
      }
      return;
    }

    setDetectingModels(true);
    if (!silent) {
      setError("");
      setNotice("");
    }
    try {
      const result = await api.sakiModels(token, currentSakiConfigPayload());
      setModelOptions(result.models);
      if (result.models.length > 0) {
        setForm((current) => {
          const currentInSynced = result.models.some((model) => model.id === current.model);
          const nextModel = currentInSynced ? current.model : (result.models[0]?.id ?? current.model);
          return withActiveProviderConfig(current, { model: nextModel });
        });
      }
      if (!silent) {
        const hasWarnings = Boolean(result.warnings && result.warnings.length > 0);
        if (hasWarnings) {
          setError(result.warnings.join("\n\n"));
        }
        setNotice(
          hasWarnings
            ? "未能连接实时模型服务，当前展示的是内置备用列表（可能不是该服务实际支持的模型，请以实时同步结果为准）。"
            : result.models.length > 0
              ? `已成功同步 ${result.models.length} 个最新模型（${result.models.slice(0, 3).map((m) => m.id).join(", ")}${result.models.length > 3 ? " 等" : ""}）！`
              : "未能从服务同步到模型列表。"
        );
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "模型 API 检测失败");
      }
    } finally {
      setDetectingModels(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    const provider = form.provider;
    if (needsCloudApiFields(provider) && (!form.baseUrl.trim() || !form.apiKey.trim())) return;
    if (provider === "ollama" && !form.ollamaUrl.trim()) return;
    const timer = window.setTimeout(() => {
      void detectModels(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [form.apiKey, form.baseUrl, form.ollamaUrl, form.provider, loading]);

  useEffect(() => {
    if (loading || form.provider !== "copilot") return;
    void refreshCopilotAuthStatus(true);
  }, [form.provider, loading, refreshCopilotAuthStatus]);

  useEffect(() => {
    if (loading || form.provider !== "antigravity") return;
    void refreshAntigravityStatus(true);
  }, [form.provider, loading, refreshAntigravityStatus]);

  useEffect(() => {
    if (form.provider !== "copilot" || copilotLoginState?.status !== "running") return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const [loginState, status] = await Promise.all([
            api.sakiCopilotLoginState(token),
            api.sakiCopilotStatus(token)
          ]);
          setCopilotLoginState(loginState);
          setCopilotAuthStatus(status);
          if (status.authenticated) {
            setNotice(`GitHub Copilot 已登录${status.login ? `：${status.login}` : ""}。`);
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            onLogout();
          }
        }
      })();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [copilotLoginState?.status, form.provider, onLogout, token]);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextSessionTimeoutMinutes = parseSessionTimeoutMinutesDraft(sessionTimeoutMinutes);
      const [saved, savedSessionSettings] = await Promise.all([
        api.updateSakiConfig(token, currentSakiConfigPayload()),
        api.updateSessionSettings(token, {
          sessionTimeoutMinutes: nextSessionTimeoutMinutes,
          registrationIdentity
        })
      ]);
      setForm(saved);
      setSessionTimeoutMinutes(formatSessionTimeoutMinutes(savedSessionSettings.sessionTimeoutMinutes));
      setRegistrationIdentity(savedSessionSettings.registrationIdentity);
      onAppearanceChange(saved.appearance);
      const refreshed = await api.refreshSession(token);
      onSessionRefresh(refreshed.token, refreshed.user);
      setNotice(t("settings.saved"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const settingsNavItems: Array<{ id: SakiSettingsSection; label: string; detail: string; icon: React.ReactNode }> = [
    { id: "system", label: t("settings.system"), detail: t("settings.system.detail"), icon: <Settings size={17} /> },
    { id: "model", label: t("settings.model"), detail: t("settings.model.detail"), icon: <Cpu size={17} /> },
    { id: "features", label: t("settings.features"), detail: t("settings.features.detail"), icon: <Wrench size={17} /> },
    { id: "appearance", label: t("settings.appearance"), detail: t("settings.appearance.detail"), icon: <ImageIcon size={17} /> },
    { id: "prompt", label: t("settings.prompt"), detail: t("settings.prompt.detail"), icon: <TextQuote size={17} /> },
    { id: "skills", label: "Skills", detail: `${skillList.length} ${t("settings.skills.detail")}`, icon: <Layers size={17} /> },
    { id: "watch", label: t("settings.watch"), detail: t("settings.watch.detail"), icon: <Bell size={17} /> }
  ];

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      {notice ? <div className="page-notice">{notice}</div> : null}
      <section className="panel-block settings-panel">
        <div className="section-heading">
          <h2>{t("settings.title")}</h2>
          <span>{loading ? t("settings.loading") : t("settings.runtime")}</span>
        </div>
        <div className={`settings-grid settings-wiki ${settingsMenuCollapsed ? "toc-collapsed" : ""}`}>
          <nav className="settings-toc" aria-label={t("settings.toc")}>
            <button
              className="settings-toc-toggle"
              type="button"
              title={settingsMenuCollapsed ? t("settings.toc.expand") : t("settings.toc.collapse")}
              onClick={() => setSettingsMenuCollapsed((current) => !current)}
            >
              {settingsMenuCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              <span>{t("settings.toc")}</span>
            </button>
            <div className="settings-toc-list">
              {settingsNavItems.map((item) => (
                <button
                  className={activeSettingsSection === item.id ? "active" : ""}
                  key={item.id}
                  type="button"
                  title={`${item.label} - ${item.detail}`}
                  onClick={() => setActiveSettingsSection(item.id)}
                >
                  <span className="settings-toc-icon">{item.icon}</span>
                  <span className="settings-toc-copy">
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </nav>
          <div className="settings-wiki-content">
            {activeSettingsSection === "watch" ? (
              <WatchNotifyPanel token={token} onLogout={onLogout} refreshTick={refreshTick} />
            ) : activeSettingsSection === "skills" ? (
              <SettingsSkillsTab
                token={token}
                onLogout={onLogout}
                skillList={skillList}
                onSkillListChange={setSkillList}
                onError={setError}
                onNotice={setNotice}
              />
            ) : (
              <form className="settings-config-form" onSubmit={(event) => void saveSettings(event)}>
                <SettingsSystemTab
                  isActive={activeSettingsSection === "system"}
                  language={language}
                  onLanguageChange={onLanguageChange}
                  registrationIdentity={registrationIdentity}
                  onRegistrationIdentityChange={setRegistrationIdentity}
                  sessionTimeoutMinutes={sessionTimeoutMinutes}
                  onSessionTimeoutMinutesChange={setSessionTimeoutMinutes}
                  requestTimeoutMs={Number(form.requestTimeoutMs) || defaultSakiRequestTimeoutMs}
                  onRequestTimeoutMsChange={(timeoutMs) =>
                    setForm((current) => ({ ...current, requestTimeoutMs: timeoutMs }))
                  }
                  localizedRegistrationIdentityOptions={localizedRegistrationIdentityOptions}
                  t={t}
                />

                <SettingsModelTab
                  isActive={activeSettingsSection === "model"}
                  form={form}
                  changeProvider={changeProvider}
                  updateActiveProviderConfig={updateActiveProviderConfig}
                  modelOptions={modelOptions}
                  detectingModels={detectingModels}
                  loading={loading}
                  detectModels={detectModels}
                  showApiKey={showApiKey}
                  setShowApiKey={setShowApiKey}
                  customModelMode={customModelMode}
                  setCustomModelMode={setCustomModelMode}
                  copilotAuthStatus={copilotAuthStatus}
                  copilotLoginState={copilotLoginState}
                  copilotBusy={copilotBusy}
                  refreshCopilotAuthStatus={refreshCopilotAuthStatus}
                  startCopilotLoginFromSettings={startCopilotLoginFromSettings}
                  antigravityStatus={antigravityStatus}
                  antigravityLoginState={antigravityLoginState}
                  antigravityOAuthActive={antigravityOAuthActive}
                  setAntigravityOAuthActive={setAntigravityOAuthActive}
                  antigravityAuthCodeInput={antigravityAuthCodeInput}
                  setAntigravityAuthCodeInput={setAntigravityAuthCodeInput}
                  antigravityBusy={antigravityBusy}
                  antigravityActionBusy={antigravityActionBusy}
                  antigravityLoginModalOpen={antigravityLoginModalOpen}
                  setAntigravityLoginModalOpen={setAntigravityLoginModalOpen}
                  antigravityTokenInput={antigravityTokenInput}
                  setAntigravityTokenInput={setAntigravityTokenInput}
                  antigravityEmailInput={antigravityEmailInput}
                  setAntigravityEmailInput={setAntigravityEmailInput}
                  refreshAntigravityStatus={refreshAntigravityStatus}
                  startAntigravityOAuthFlow={startAntigravityOAuthFlow}
                  handleAntigravityOAuthExchange={handleAntigravityOAuthExchange}
                  handleAntigravityLoginSubmit={handleAntigravityLoginSubmit}
                  handleAntigravitySwitchAccount={handleAntigravitySwitchAccount}
                  handleAntigravityLogout={handleAntigravityLogout}
                  switchAntigravityMode={switchAntigravityMode}
                  handleAntigravityApiKeyInput={handleAntigravityApiKeyInput}
                  combinedModelKeys={combinedModelKeys}
                  handleSetModelMultiplier={handleSetModelMultiplier}
                  handleResetModelMultiplier={handleResetModelMultiplier}
                  newMultiplierModel={newMultiplierModel}
                  setNewMultiplierModel={setNewMultiplierModel}
                  newMultiplierValue={newMultiplierValue}
                  setNewMultiplierValue={setNewMultiplierValue}
                  handleAddCustomMultiplier={handleAddCustomMultiplier}
                  t={t}
                />

                <SettingsFeaturesTab
                  isActive={activeSettingsSection === "features"}
                  searchEnabled={form.searchEnabled ?? false}
                  onSearchEnabledChange={(enabled) =>
                    setForm((current) => ({ ...current, searchEnabled: enabled }))
                  }
                  mcpEnabled={form.mcpEnabled ?? false}
                  onMcpEnabledChange={(enabled) =>
                    setForm((current) => ({ ...current, mcpEnabled: enabled }))
                  }
                  voiceEchoEngine={voiceEchoEngine}
                  onVoiceEchoEngineChange={handleVoiceEchoEngineChange}
                  webGpuInfo={webGpuInfo}
                  t={t}
                />

                <SettingsAppearanceTab
                  isActive={activeSettingsSection === "appearance"}
                  appearance={form.appearance}
                  onUpdateAppearance={updateAppearance}
                  onChooseAppearanceImage={chooseAppearanceImage}
                  onChooseAppearanceMedia={chooseAppearanceMedia}
                  t={t}
                />

                <SettingsPromptTab
                  isActive={activeSettingsSection === "prompt"}
                  systemPrompt={form.systemPrompt ?? ""}
                  onSystemPromptChange={(value) =>
                    setForm((current) => ({ ...current, systemPrompt: value }))
                  }
                  t={t}
                />

                {/* Floating Footer Action Bar */}
                <div className="settings-sticky-footer">
                  <div className="settings-footer-info">
                    <span className="settings-footer-dot" />
                    <span>修改配置后请点击右侧保存生效</span>
                  </div>
                  <div className="settings-footer-actions">
                    <button
                      className="ghost-button"
                      disabled={detectingModels || loading}
                      type="button"
                      onClick={() => void detectModels(false)}
                    >
                      <RefreshCw size={16} className={detectingModels ? "animate-spin" : ""} />
                      <span>{detectingModels ? t("settings.detecting") : t("settings.detectModels")}</span>
                    </button>
                    <button className="primary-button settings-save" disabled={saving || loading} type="submit">
                      <Save size={16} />
                      <span>{saving ? t("common.saving") : t("settings.save")}</span>
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
