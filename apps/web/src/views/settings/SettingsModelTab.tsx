import React, { memo, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  Cpu,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Globe,
  ImagePlus,
  Info,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  UserCheck,
  UserRound,
  UserX,
  X,
  Zap
} from "lucide-react";
import type {
  SakiAntigravityAuthStatusResponse,
  SakiAntigravityLoginUrlResponse,
  SakiConfigResponse,
  SakiCopilotAuthStatusResponse,
  SakiCopilotLoginResponse,
  SakiImageGenConfig,
  SakiModelOption,
  SakiProviderConfig
} from "@webops/shared";
import { sakiModelSelectionKey, sakiNvidiaDefaultModel } from "@webops/shared";
import type { PanelTextKey } from "../../i18n/index.js";
import {
  antigravityModeOf,
  applyImageGenProvider,
  getEnabledProviders,
  imageGenFromForm,
  imageGenNeedsApiKey,
  imageGenProtocolOptions,
  imageGenQualityOptions,
  imageGenAspectRatioOptions,
  isLocalProvider,
  isProviderEnabled,
  modelProviderOptions,
  needsCloudApiFields,
  providerBaseUrlDefaults,
  providerDescriptions,
  sakiImageGenProviderPresets,
  withImageGenSizeDefaults,
  type AntigravityMode
} from "./settingsHelpers.js";

export interface SettingsModelTabProps {
  isActive: boolean;
  form: SakiConfigResponse;
  changeProvider: (provider: string) => void;
  updateActiveProviderConfig: (patch: Partial<SakiProviderConfig>) => void;
  updateSpecificProviderConfig: (provider: string, patch: Partial<SakiProviderConfig>) => void;
  onToggleProviderEnabled: (provider: string, enabled: boolean) => void;
  onSetCustomModelName: (modelKey: string, customName: string) => void;
  onResetCustomModelName: (modelKey: string) => void;
  onSelectActiveModel: (modelId: string, providerId?: string) => void;
  modelOptions: SakiModelOption[];
  detectingModels: boolean;
  loading: boolean;
  detectModels: (force?: boolean) => Promise<void>;
  showApiKey: boolean;
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>;
  customModelMode: boolean;
  setCustomModelMode: React.Dispatch<React.SetStateAction<boolean>>;
  onImageGenChange: (patch: Partial<SakiImageGenConfig>) => void;
  // Copilot
  copilotAuthStatus: SakiCopilotAuthStatusResponse | null;
  copilotLoginState: SakiCopilotLoginResponse | null;
  copilotBusy: "status" | "login" | null;
  refreshCopilotAuthStatus: (silent?: boolean) => Promise<SakiCopilotAuthStatusResponse | null>;
  startCopilotLoginFromSettings: () => Promise<void>;
  // Antigravity
  antigravityStatus: SakiAntigravityAuthStatusResponse | null;
  antigravityLoginState: SakiAntigravityLoginUrlResponse | null;
  antigravityOAuthActive: boolean;
  setAntigravityOAuthActive: React.Dispatch<React.SetStateAction<boolean>>;
  antigravityAuthCodeInput: string;
  setAntigravityAuthCodeInput: React.Dispatch<React.SetStateAction<string>>;
  antigravityBusy: boolean;
  antigravityActionBusy: string | null;
  antigravityLoginModalOpen: boolean;
  setAntigravityLoginModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  antigravityTokenInput: string;
  setAntigravityTokenInput: React.Dispatch<React.SetStateAction<string>>;
  antigravityEmailInput: string;
  setAntigravityEmailInput: React.Dispatch<React.SetStateAction<string>>;
  refreshAntigravityStatus: (silent?: boolean) => Promise<SakiAntigravityAuthStatusResponse | null>;
  startAntigravityOAuthFlow: () => Promise<void>;
  handleAntigravityOAuthExchange: (e?: React.SyntheticEvent) => Promise<void>;
  handleAntigravityLoginSubmit: (e?: React.FormEvent) => Promise<void>;
  handleAntigravitySwitchAccount: (email: string) => Promise<void>;
  handleAntigravityLogout: (email?: string) => Promise<void>;
  switchAntigravityMode: (mode: AntigravityMode) => void;
  handleAntigravityApiKeyInput: (value: string) => void;
  // Multipliers
  combinedModelKeys: string[];
  handleSetModelMultiplier: (modelKey: string, value: number) => void;
  handleResetModelMultiplier: (modelKey: string) => void;
  newMultiplierModel: string;
  setNewMultiplierModel: React.Dispatch<React.SetStateAction<string>>;
  newMultiplierValue: string;
  setNewMultiplierValue: React.Dispatch<React.SetStateAction<string>>;
  handleAddCustomMultiplier: () => void;
  t: (key: PanelTextKey) => string;
}

export const SettingsModelTab = memo(function SettingsModelTab({
  isActive,
  form,
  changeProvider,
  updateActiveProviderConfig,
  updateSpecificProviderConfig,
  onToggleProviderEnabled,
  onSetCustomModelName,
  onResetCustomModelName,
  onSelectActiveModel,
  modelOptions,
  detectingModels,
  loading,
  detectModels,
  showApiKey,
  setShowApiKey,
  customModelMode,
  setCustomModelMode,
  onImageGenChange,
  copilotAuthStatus,
  copilotLoginState,
  copilotBusy,
  refreshCopilotAuthStatus,
  startCopilotLoginFromSettings,
  antigravityStatus,
  antigravityLoginState,
  antigravityOAuthActive,
  setAntigravityOAuthActive,
  antigravityAuthCodeInput,
  setAntigravityAuthCodeInput,
  antigravityBusy,
  antigravityActionBusy,
  antigravityLoginModalOpen,
  setAntigravityLoginModalOpen,
  antigravityTokenInput,
  setAntigravityTokenInput,
  antigravityEmailInput,
  setAntigravityEmailInput,
  refreshAntigravityStatus,
  startAntigravityOAuthFlow,
  handleAntigravityOAuthExchange,
  handleAntigravityLoginSubmit,
  handleAntigravitySwitchAccount,
  handleAntigravityLogout,
  switchAntigravityMode,
  handleAntigravityApiKeyInput,
  combinedModelKeys,
  handleSetModelMultiplier,
  handleResetModelMultiplier,
  newMultiplierModel,
  setNewMultiplierModel,
  newMultiplierValue,
  setNewMultiplierValue,
  handleAddCustomMultiplier,
  t
}: SettingsModelTabProps) {
  const [multipliersPage, setMultipliersPage] = useState(1);
  const [multipliersFilter, setMultipliersFilter] = useState("");
  const [showImageApiKey, setShowImageApiKey] = useState(false);
  const [customNamesOpen, setCustomNamesOpen] = useState(false);
  const [customNameInputs, setCustomNameInputs] = useState<Record<string, string>>({});
  const [copiedCode, setCopiedCode] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("copilot");
  const [providerSearch, setProviderSearch] = useState<string>("");
  const [showProviderKeys, setShowProviderKeys] = useState<Record<string, boolean>>({});
  const [customModelInputProviders, setCustomModelInputProviders] = useState<Record<string, boolean>>({});

  const toggleProviderCustomModel = (pid: string) => {
    setCustomModelInputProviders((prev) => ({
      ...prev,
      [pid]: !prev[pid]
    }));
  };

  const MULTIPLIERS_PER_PAGE = 8;
  const imageGen = imageGenFromForm(form);
  const imageGenPreset = sakiImageGenProviderPresets.find((preset) => preset.id === imageGen.provider);

  // Enabled providers list
  const enabledProviders = useMemo(() => getEnabledProviders(form), [form]);

  // Provider labels map
  const providerLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const opt of modelProviderOptions) {
      map[opt.value] = opt.label;
    }
    return map;
  }, []);

  // Filter model options by enabled providers
  const enabledModelOptions = useMemo(() => {
    return modelOptions.filter((m) => enabledProviders.includes(m.provider));
  }, [modelOptions, enabledProviders]);

  // Group models by provider for optgroup
  const modelsByProvider = useMemo(() => {
    const map = new Map<string, SakiModelOption[]>();
    for (const model of enabledModelOptions) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return map;
  }, [enabledModelOptions]);

  // Find currently selected model item
  const currentActiveModelItem = useMemo(() => {
    return enabledModelOptions.find((m) => m.id === form.model && m.provider === form.provider);
  }, [enabledModelOptions, form.model, form.provider]);

  // Multiplier filtering: ONLY SHOW MODELS OF ENABLED PROVIDERS
  const filteredMultipliers = useMemo(() => {
    if (!multipliersFilter.trim()) return combinedModelKeys;
    const q = multipliersFilter.trim().toLowerCase();
    return combinedModelKeys.filter((key) => key.toLowerCase().includes(q));
  }, [combinedModelKeys, multipliersFilter]);

  const totalMultipliersPages = Math.max(1, Math.ceil(filteredMultipliers.length / MULTIPLIERS_PER_PAGE));
  const safeMultipliersPage = Math.min(Math.max(1, multipliersPage), totalMultipliersPages);

  const paginatedMultipliers = useMemo(() => {
    const start = (safeMultipliersPage - 1) * MULTIPLIERS_PER_PAGE;
    return filteredMultipliers.slice(start, start + MULTIPLIERS_PER_PAGE);
  }, [filteredMultipliers, safeMultipliersPage]);

  // Copy code helper
  const handleCopyDeviceCode = (code: string) => {
    if (!code) return;
    void navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const toggleShowProviderKey = (providerId: string) => {
    setShowProviderKeys((prev) => ({
      ...prev,
      [providerId]: !prev[providerId]
    }));
  };

  // Antigravity mode calculation
  const antigravityMode = antigravityModeOf(form.providerConfigs?.antigravity);
  const isDirectMode = antigravityMode === "direct";
  const isAntigravityReady = isDirectMode
    ? Boolean(form.providerConfigs.antigravity?.apiKey?.trim() || (antigravityStatus?.available && antigravityStatus?.authenticated))
    : Boolean(
        antigravityStatus?.isEndpointReachable ||
        (antigravityStatus?.available && antigravityStatus?.authenticated)
      );
  const isPendingProxy = Boolean(!isDirectMode && antigravityStatus?.authenticated && !isAntigravityReady);

  // Resolved display name for any model key
  const resolveModelDisplayName = (key: string): { displayName: string; baseId: string; providerName: string; isConflict: boolean } => {
    let baseId = key;
    let providerId = "";
    const separator = key.indexOf(":");
    if (separator > 0 && Object.hasOwn(form.providerConfigs, key.slice(0, separator))) {
      providerId = key.slice(0, separator);
      baseId = key.slice(separator + (key[separator + 1] === ":" ? 2 : 1));
    } else {
      for (const p of Object.keys(form.providerConfigs || {})) {
        if (key.endsWith(`-${p}`)) {
          providerId = p;
          baseId = key.slice(0, -(p.length + 1));
          break;
        }
      }
    }

    const matched = enabledModelOptions.find((m) => (m.id === baseId || m.id === key) && (!providerId || m.provider === providerId));
    if (matched) {
      baseId = matched.id;
      providerId = matched.provider;
    }

    const providerName = providerLabelMap[providerId] || providerId || (enabledProviders[0] || form.provider);
    const isConflict = matched?.isConflict ?? false;
    const defaultName = isConflict ? `${baseId}-${providerId || form.provider}` : (matched?.name || baseId);
    const custom =
      form.customModelNames?.[`${providerId}:${baseId}`] ??
      form.customModelNames?.[defaultName] ??
      form.customModelNames?.[baseId];

    return {
      displayName: custom || defaultName,
      baseId,
      providerName,
      isConflict
    };
  };

  // Master-Detail Catalog Definition for model providers
  const allProvidersList = useMemo(() => [
    // 1. Official
    {
      id: "copilot",
      name: "GitHub Copilot",
      category: "official",
      tag: "官方 CLI / SDK",
      iconType: "github",
      iconBg: "#181717",
      iconColor: "#ffffff",
      desc: providerDescriptions.copilot
    },
    {
      id: "antigravity",
      name: "Google Antigravity CLI",
      category: "official",
      tag: "官方直连 / 反代网关",
      iconType: "antigravity",
      iconBg: "linear-gradient(135deg, #ff75ac, #a855f7)",
      iconColor: "#ffffff",
      desc: providerDescriptions.antigravity
    },
    // 2. Local
    {
      id: "ollama",
      name: "Ollama",
      category: "local",
      tag: "本地开源服务",
      iconType: "server",
      iconBg: "#334155",
      iconColor: "#f8fafc",
      desc: providerDescriptions.ollama
    },
    {
      id: "lmstudio",
      name: "LM Studio",
      category: "local",
      tag: "本地 API 实例",
      iconType: "cpu",
      iconBg: "#4f46e5",
      iconColor: "#ffffff",
      desc: providerDescriptions.lmstudio
    },
    // 3. Mainstream Cloud
    {
      id: "deepseek",
      name: "DeepSeek",
      category: "cloud",
      tag: "高性价比推理",
      iconType: "globe",
      iconBg: "#0284c7",
      iconColor: "#ffffff",
      desc: providerDescriptions.deepseek
    },
    {
      id: "openai",
      name: "OpenAI Compatible",
      category: "cloud",
      tag: "标准 API 规范",
      iconType: "sparkles",
      iconBg: "#10a37f",
      iconColor: "#ffffff",
      desc: providerDescriptions.openai
    },
    {
      id: "nvidia",
      name: "NVIDIA",
      category: "cloud",
      tag: "NVIDIA NIM / API Catalog",
      iconType: "cpu",
      iconBg: "#76b900",
      iconColor: "#ffffff",
      desc: providerDescriptions.nvidia
    },
    {
      id: "gemini",
      name: "Google Gemini",
      category: "cloud",
      tag: "Google AI Studio",
      iconType: "antigravity",
      iconBg: "#3b82f6",
      iconColor: "#ffffff",
      desc: providerDescriptions.gemini
    },
    {
      id: "anthropic",
      name: "Anthropic",
      category: "cloud",
      tag: "Claude 官方 API",
      iconType: "globe",
      iconBg: "#c2410c",
      iconColor: "#ffffff",
      desc: providerDescriptions.anthropic
    },
    {
      id: "moonshot",
      name: "Moonshot (Kimi)",
      category: "cloud",
      tag: "长上下文模型",
      iconType: "globe",
      iconBg: "#7c3aed",
      iconColor: "#ffffff",
      desc: providerDescriptions.moonshot
    },
    {
      id: "zhipu",
      name: "智谱 GLM",
      category: "cloud",
      tag: "GLM-4 开放平台",
      iconType: "cpu",
      iconBg: "#0891b2",
      iconColor: "#ffffff",
      desc: providerDescriptions.zhipu
    },
    {
      id: "tongyi",
      name: "通义千问",
      category: "cloud",
      tag: "阿里百炼平台",
      iconType: "globe",
      iconBg: "#ea580c",
      iconColor: "#ffffff",
      desc: providerDescriptions.tongyi
    },
    {
      id: "doubao",
      name: "字节豆包",
      category: "cloud",
      tag: "火山引擎 API",
      iconType: "globe",
      iconBg: "#0369a1",
      iconColor: "#ffffff",
      desc: providerDescriptions.doubao
    },
    {
      id: "minimax",
      name: "MiniMax",
      category: "cloud",
      tag: "开放平台大模型",
      iconType: "globe",
      iconBg: "#e11d48",
      iconColor: "#ffffff",
      desc: providerDescriptions.minimax
    },
    // 4. Custom
    {
      id: "custom",
      name: "自定义兼容服务商",
      category: "custom",
      tag: "OpenAI 规范协议",
      iconType: "sliders",
      iconBg: "#64748b",
      iconColor: "#ffffff",
      desc: providerDescriptions.custom
    }
  ], []);

  const providerCategories = useMemo(() => [
    { key: "official", label: "官方接入 / SDK" },
    { key: "local", label: "本地部署 / 推理" },
    { key: "cloud", label: "主流云端平台" },
    { key: "custom", label: "自定义扩展" }
  ], []);

  const filteredSidebarProviders = useMemo(() => {
    if (!providerSearch.trim()) return allProvidersList;
    const q = providerSearch.trim().toLowerCase();
    return allProvidersList.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.tag.toLowerCase().includes(q) ||
      Boolean(providerLabelMap[p.id]?.toLowerCase().includes(q))
    );
  }, [allProvidersList, providerSearch, providerLabelMap]);

  const renderProviderIcon = (iconType: string, size = 18) => {
    switch (iconType) {
      case "github":
        return <Github size={size} />;
      case "antigravity":
        return <Zap size={size} />;
      case "server":
        return <Server size={size} />;
      case "cpu":
        return <Cpu size={size} />;
      case "sparkles":
        return <Sparkles size={size} />;
      case "sliders":
        return <SlidersHorizontal size={size} />;
      case "globe":
      default:
        return <Globe size={size} />;
    }
  };

  const activeProviderMeta = useMemo(() => {
    const found = allProvidersList.find((p) => p.id === selectedProviderId);
    if (found) return found;
    return allProvidersList[0] ?? {
      id: "copilot",
      name: "GitHub Copilot",
      category: "official",
      tag: "官方 CLI / SDK",
      iconType: "github",
      iconBg: "#181717",
      iconColor: "#ffffff",
      desc: providerDescriptions.copilot
    };
  }, [allProvidersList, selectedProviderId]);

  const isCurrentSelectedEnabled = isProviderEnabled(form, activeProviderMeta.id);

  const renderCopilotDetail = () => {
    const isAuth = Boolean(copilotAuthStatus?.authenticated);
    const isGitHubAuth = Boolean(copilotAuthStatus?.githubAuthenticated || isAuth);
    const copilotModels = enabledModelOptions.filter((m) => m.provider === "copilot");
    const isCustomInput = Boolean(customModelInputProviders.copilot);
    const pConfig = form.providerConfigs?.copilot ?? {};

    return (
      <div className="copilot-clean-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Authentication Card */}
        <div className="providers-ios-group-card">
          <div className="providers-ios-group-title">
            <ShieldCheck size={14} style={{ color: "var(--primary, #ff75ac)" }} />
            <span>账号认证与授权状态</span>
          </div>

          <div className="copilot-account-row">
            <div className="copilot-account-info">
              <div className="copilot-avatar-box">
                {copilotAuthStatus?.login ? copilotAuthStatus.login.slice(0, 2).toUpperCase() : <Github size={16} />}
              </div>
              <div className="copilot-account-text">
                <span className="copilot-account-name">
                  {copilotAuthStatus?.login
                    ? `@${copilotAuthStatus.login}`
                    : isGitHubAuth ? "GitHub 已登录" : "尚未绑定 GitHub 账号"}
                </span>
                <span className="copilot-account-sub">
                  {isAuth
                    ? "GitHub 已登录 · Copilot 模型接口可用"
                    : copilotAuthStatus?.message || "点击右侧登录按钮以绑定账号"}
                </span>
              </div>
            </div>

            <div className="copilot-action-group">
              <button
                className="ghost-button"
                disabled={copilotBusy === "status" || loading}
                type="button"
                onClick={() => void refreshCopilotAuthStatus(false)}
              >
                <RefreshCw size={13} className={copilotBusy === "status" ? "animate-spin" : ""} />
                <span>{copilotBusy === "status" ? "检查中" : "检查状态"}</span>
              </button>

              <button
                className="primary-button"
                disabled={copilotBusy === "login" || loading}
                type="button"
                onClick={() => void startCopilotLoginFromSettings()}
              >
                <LogIn size={13} />
                <span>{copilotBusy === "login" ? "连接中..." : isGitHubAuth ? "重新登录" : "登录 GitHub"}</span>
              </button>
            </div>
          </div>

          {/* Clean Device Activation Box */}
          {copilotLoginState?.userCode || copilotLoginState?.verificationUri ? (
            <div className="copilot-device-card">
              <div className="copilot-device-header">
                <KeyRound size={15} />
                <span>GitHub 设备激活授权</span>
              </div>
              <span style={{ fontSize: 12.5, color: "var(--text-dark, #1d1d1f)" }}>
                {copilotLoginState.message || "请复制下方的设备授权码，前往 GitHub 验证页同意授权："}
              </span>
              <div className="copilot-code-row">
                {copilotLoginState.userCode ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="copilot-code-pill">{copilotLoginState.userCode}</span>
                    <button
                      type="button"
                      className="ghost-button"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => handleCopyDeviceCode(copilotLoginState.userCode!)}
                    >
                      {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedCode ? "已复制" : "复制"}</span>
                    </button>
                  </div>
                ) : null}

                {copilotLoginState.verificationUri ? (
                  <a
                    href={copilotLoginState.verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="primary-button"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, textDecoration: "none" }}
                  >
                    <span>前往 GitHub 设备验证页</span>
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Model Invocation Card */}
        <div className="providers-ios-group-card">
          <div className="providers-ios-group-title">
            <Cpu size={14} style={{ color: "var(--primary, #ff75ac)" }} />
            <span>模型调用与默认分配</span>
          </div>

          <div className="settings-form-row" style={{ margin: 0 }}>
            <label className="settings-field" style={{ flex: 1 }}>
              <span className="settings-field-label">默认调用模型 (可选)</span>
              {copilotModels.length > 0 && !isCustomInput ? (
                <div className="settings-input-with-action">
                  <select
                    className="settings-select"
                    value={pConfig.model || ""}
                    onChange={(e) => updateSpecificProviderConfig("copilot", { model: e.target.value })}
                  >
                    <option value="">跟随全局默认 / 自动推荐</option>
                    {copilotModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} {m.supportsVision ? "👁️" : ""}
                      </option>
                    ))}
                    {pConfig.model && !copilotModels.some((m) => m.id === pConfig.model) ? (
                      <option value={pConfig.model}>{pConfig.model} (自定义)</option>
                    ) : null}
                  </select>
                  <button
                    type="button"
                    className="settings-inline-action-btn"
                    onClick={() => toggleProviderCustomModel("copilot")}
                    title="手动输入未列出的模型 ID"
                    style={{ fontSize: 11, padding: "0 8px", whiteSpace: "nowrap" }}
                  >
                    手动输入
                  </button>
                </div>
              ) : (
                <div className="settings-input-with-action">
                  <input
                    className="settings-input"
                    value={pConfig.model ?? ""}
                    onChange={(e) => updateSpecificProviderConfig("copilot", { model: e.target.value })}
                    placeholder="例如 claude-3.5-sonnet, gpt-4o 等"
                  />
                  {copilotModels.length > 0 ? (
                    <button
                      type="button"
                      className="settings-inline-action-btn"
                      onClick={() => toggleProviderCustomModel("copilot")}
                      title="从已同步的模型列表中选择"
                      style={{ fontSize: 11, padding: "0 8px", whiteSpace: "nowrap" }}
                    >
                      下拉选择
                    </button>
                  ) : null}
                </div>
              )}
            </label>
          </div>

          {/* Synced Models Preview */}
          {copilotModels.length > 0 ? (
            <div className="providers-ios-models-preview">
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
                <Sparkles size={13} style={{ color: "var(--primary, #ff75ac)" }} />
                <span>已同步可用模型 ({copilotModels.length})：</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {copilotModels.map((m) => (
                  <span
                    key={m.id}
                    className="provider-tag"
                    style={{ cursor: "pointer" }}
                    title={`点击设为默认：${m.id}`}
                    onClick={() => updateSpecificProviderConfig("copilot", { model: m.id })}
                  >
                    {m.label} {m.supportsVision ? "👁️" : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : isCurrentSelectedEnabled ? (
            <div style={{ fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
              尚未同步 Copilot 模型。请在授权完成后点击顶部“同步全部模型”。
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderAntigravityDetail = () => {
    const antigravityModels = enabledModelOptions.filter((m) => m.provider === "antigravity");
    const isCustomInput = Boolean(customModelInputProviders.antigravity);
    const pConfig = form.providerConfigs?.antigravity ?? {};

    return (
      <div className="antigravity-clean-deck" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Connection Mode & Credentials Card */}
        <div className="providers-ios-group-card">
          <div className="providers-ios-group-title">
            <Zap size={14} style={{ color: "var(--primary, #ff75ac)" }} />
            <span>接入模式与认证凭据</span>
          </div>

          {/* Mode Segmented Controls */}
          <div className="segmented-control">
            <button
              type="button"
              className={`segmented-btn ${isDirectMode ? "active" : ""}`}
              onClick={() => switchAntigravityMode("direct")}
            >
              官方直连 (Gemini API Key · 免反代)
            </button>
            <button
              type="button"
              className={`segmented-btn ${!isDirectMode ? "active" : ""}`}
              onClick={() => switchAntigravityMode("proxy")}
            >
              本地反代网关 (Google OAuth / Proxy)
            </button>
          </div>

          {/* Direct Mode Configuration */}
          {isDirectMode ? (
            <div className="settings-form-row" style={{ margin: 0 }}>
              <label className="settings-field" style={{ flex: 1 }}>
                <span className="settings-field-label">Gemini API Key</span>
                <div className="settings-input-with-action">
                  <input
                    className="settings-input"
                    type={showApiKey ? "text" : "password"}
                    value={pConfig.apiKey ?? ""}
                    onChange={(event) => handleAntigravityApiKeyInput(event.target.value)}
                    placeholder="AIzaSy..."
                  />
                  <button
                    type="button"
                    className="settings-inline-action-btn icon-only"
                    onClick={() => setShowApiKey((s) => !s)}
                    title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <span className="settings-field-hint" style={{ marginTop: 4 }}>
                  直连 Google 官方端点，极速响应，无需服务器反代进程。可前往{" "}
                  <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer">
                    Google AI Studio
                  </a>{" "}
                  免费申请（以 <code>AIzaSy</code> 开头）。
                </span>
              </label>
            </div>
          ) : (
            /* Reverse Proxy & OAuth Mode */
            <>
              <div className="copilot-account-row">
                <div className="copilot-account-info">
                  <div className="copilot-avatar-box" style={{ background: "linear-gradient(135deg, var(--primary, #ff75ac), #a855f7)" }}>
                    {antigravityStatus?.authenticated ? <UserCheck size={16} /> : <UserX size={16} />}
                  </div>
                  <div className="copilot-account-text">
                    <span className="copilot-account-name">
                      {antigravityStatus?.authenticated
                        ? antigravityStatus.accountEmail || "已连接官方 OAuth 凭据"
                        : "未登录 Google 账号"}
                    </span>
                    <span className="copilot-account-sub">
                      {antigravityStatus?.authenticated
                        ? "OAuth 2.0 凭据已持久化就绪，反代请求将通过此账号认证调用。"
                        : "未检测到已授权的 Google 账号。请点击右侧“登录 Google 账号”进行授权。"}
                    </span>
                  </div>
                </div>

                <div className="copilot-action-group">
                  <button
                    className="ghost-button"
                    disabled={antigravityBusy || Boolean(antigravityActionBusy) || loading}
                    type="button"
                    onClick={() => void refreshAntigravityStatus(false)}
                  >
                    <RefreshCw size={13} className={antigravityBusy ? "animate-spin" : ""} />
                    <span>{antigravityBusy ? "检测中..." : "刷新状态"}</span>
                  </button>

                  {antigravityStatus?.authenticated || antigravityStatus?.accountEmail ? (
                    <button
                      className="danger-button"
                      disabled={loading || Boolean(antigravityActionBusy)}
                      type="button"
                      onClick={() => {
                        if (window.confirm(`确定要退出 Google 账号 (${antigravityStatus?.accountEmail || "当前账号"}) 吗？`)) {
                          void handleAntigravityLogout();
                        }
                      }}
                    >
                      {antigravityActionBusy === "logout" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <LogOut size={13} />
                      )}
                      <span>退出账号</span>
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      disabled={loading || Boolean(antigravityActionBusy)}
                      type="button"
                      onClick={() => void startAntigravityOAuthFlow()}
                    >
                      {antigravityActionBusy === "oauth-init" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <LogIn size={13} />
                      )}
                      <span>登录 Google 账号</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Multi-Accounts bar */}
              {antigravityStatus?.accounts && antigravityStatus.accounts.length > 1 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <span style={{ color: "var(--text-muted)" }}>关联账号 ({antigravityStatus.accounts.length}):</span>
                  {antigravityStatus.accounts.map((acc) => {
                    const isCurrent = acc.isActive || acc.email === antigravityStatus.accountEmail;
                    return (
                      <button
                        key={acc.email}
                        type="button"
                        className={`model-sync-btn ${isCurrent ? "active-model" : ""}`}
                        style={{
                          fontSize: 11.5,
                          padding: "3px 8px",
                          borderColor: isCurrent ? "var(--primary, #ff75ac)" : undefined,
                          background: isCurrent ? "rgba(255, 117, 172, 0.12)" : undefined
                        }}
                        onClick={() => {
                          if (!isCurrent && !antigravityActionBusy) {
                            void handleAntigravitySwitchAccount(acc.email);
                          }
                        }}
                      >
                        <span>{acc.email}</span>
                        {isCurrent ? <span style={{ color: "var(--primary, #ff75ac)", fontWeight: 700 }}>✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* Usage Metrics Strip */}
              {antigravityStatus?.usage ? (
                <div className="antigravity-metrics-row">
                  <div className="antigravity-metric-cell">
                    <span className="metric-label">今日 Tokens 消耗</span>
                    <span className="metric-value accent">
                      {(antigravityStatus.usage.todayTokensUsed ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="antigravity-metric-cell">
                    <span className="metric-label">历史总计消耗</span>
                    <span className="metric-value">
                      {(antigravityStatus.usage.totalTokensUsed ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="antigravity-metric-cell">
                    <span className="metric-label">反代配额与连通性</span>
                    <span className="metric-value">
                      {antigravityStatus.usage.proxyQuotaRemaining !== undefined
                        ? typeof antigravityStatus.usage.proxyQuotaRemaining === "number"
                          ? antigravityStatus.usage.proxyQuotaRemaining.toLocaleString()
                          : antigravityStatus.usage.proxyQuotaRemaining
                        : isAntigravityReady
                        ? "在线就绪"
                        : "离线 (8080)"}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Collapsible Advanced Reverse Proxy Configuration */}
              <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.55)", paddingTop: 10 }}>
                <button
                  type="button"
                  className="advanced-toggle-button"
                  style={{ padding: "4px 0", background: "none", border: "none" }}
                  onClick={() => setAntigravityLoginModalOpen((prev) => !prev)}
                >
                  <div className="toggle-label-wrap">
                    <SlidersHorizontal size={13} />
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>反代端点与高级凭据设置</span>
                  </div>
                  <ChevronDown
                    size={14}
                    style={{ transform: antigravityLoginModalOpen ? "rotate(180deg)" : "none" }}
                  />
                </button>

                {antigravityLoginModalOpen ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                    <div className="settings-form-row" style={{ margin: 0 }}>
                      <label className="settings-field">
                        <span className="settings-field-label">反代网关 Base URL</span>
                        <input
                          className="settings-input"
                          value={pConfig.baseUrl ?? ""}
                          onChange={(e) => updateSpecificProviderConfig("antigravity", { baseUrl: e.target.value })}
                          placeholder="http://localhost:8080/v1"
                        />
                      </label>

                      <label className="settings-field">
                        <span className="settings-field-label">反代 Bearer Token (可选)</span>
                        <input
                          className="settings-input"
                          type={showApiKey ? "text" : "password"}
                          value={pConfig.apiKey ?? ""}
                          onChange={(e) => handleAntigravityApiKeyInput(e.target.value)}
                          placeholder="留空则优先使用 Google OAuth 凭据"
                        />
                      </label>
                    </div>

                    <div className="manual-token-card">
                      <div className="manual-token-header">
                        <KeyRound size={13} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>导入 Google OAuth 访问令牌 (Ya29)</span>
                      </div>
                      <textarea
                        className="settings-input antigravity-token-textarea"
                        rows={2}
                        placeholder="粘贴 Google OAuth 访问令牌 (ya29...) 或凭据 JSON"
                        value={antigravityTokenInput}
                        onChange={(e) => setAntigravityTokenInput(e.target.value)}
                        disabled={Boolean(antigravityActionBusy)}
                      />
                      <div className="manual-token-actions-row">
                        <input
                          type="text"
                          className="settings-input manual-email-input"
                          placeholder="账号邮箱备注（可选）"
                          value={antigravityEmailInput}
                          onChange={(e) => setAntigravityEmailInput(e.target.value)}
                          disabled={Boolean(antigravityActionBusy)}
                        />
                        <button
                          type="button"
                          className="primary-button compact-btn"
                          disabled={!antigravityTokenInput.trim() || Boolean(antigravityActionBusy)}
                          onClick={(e) => {
                            e.preventDefault();
                            void handleAntigravityLoginSubmit();
                          }}
                        >
                          <Check size={12} />
                          <span>导入保存</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Model Invocation Card */}
        <div className="providers-ios-group-card">
          <div className="providers-ios-group-title">
            <Cpu size={14} style={{ color: "var(--primary, #ff75ac)" }} />
            <span>模型调用与默认分配</span>
          </div>

          <div className="settings-form-row" style={{ margin: 0 }}>
            <label className="settings-field" style={{ flex: 1 }}>
              <span className="settings-field-label">默认调用模型 (可选)</span>
              {antigravityModels.length > 0 && !isCustomInput ? (
                <div className="settings-input-with-action">
                  <select
                    className="settings-select"
                    value={pConfig.model || ""}
                    onChange={(e) => updateSpecificProviderConfig("antigravity", { model: e.target.value })}
                  >
                    <option value="">跟随全局默认 / 自动推荐</option>
                    {antigravityModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} {m.supportsVision ? "👁️" : ""}
                      </option>
                    ))}
                    {pConfig.model && !antigravityModels.some((m) => m.id === pConfig.model) ? (
                      <option value={pConfig.model}>{pConfig.model} (自定义)</option>
                    ) : null}
                  </select>
                  <button
                    type="button"
                    className="settings-inline-action-btn"
                    onClick={() => toggleProviderCustomModel("antigravity")}
                    title="手动输入未列出的模型 ID"
                    style={{ fontSize: 11, padding: "0 8px", whiteSpace: "nowrap" }}
                  >
                    手动输入
                  </button>
                </div>
              ) : (
                <div className="settings-input-with-action">
                  <input
                    className="settings-input"
                    value={pConfig.model ?? ""}
                    onChange={(e) => updateSpecificProviderConfig("antigravity", { model: e.target.value })}
                    placeholder="例如 gemini-3.8-flash, gemini-2.5-pro 等"
                  />
                  {antigravityModels.length > 0 ? (
                    <button
                      type="button"
                      className="settings-inline-action-btn"
                      onClick={() => toggleProviderCustomModel("antigravity")}
                      title="从已同步的模型列表中选择"
                      style={{ fontSize: 11, padding: "0 8px", whiteSpace: "nowrap" }}
                    >
                      下拉选择
                    </button>
                  ) : null}
                </div>
              )}
            </label>
          </div>

          {/* Synced Models Preview */}
          {antigravityModels.length > 0 ? (
            <div className="providers-ios-models-preview">
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
                <Sparkles size={13} style={{ color: "var(--primary, #ff75ac)" }} />
                <span>已同步可用模型 ({antigravityModels.length})：</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {antigravityModels.map((m) => (
                  <span
                    key={m.id}
                    className="provider-tag"
                    style={{ cursor: "pointer" }}
                    title={`点击设为默认：${m.id}`}
                    onClick={() => updateSpecificProviderConfig("antigravity", { model: m.id })}
                  >
                    {m.label} {m.supportsVision ? "👁️" : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : isCurrentSelectedEnabled ? (
            <div style={{ fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
              尚未同步 Antigravity 模型。请在授权完成后点击顶部“同步全部模型”。
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderGenericProviderDetail = (pid: string) => {
    const isLocal = isLocalProvider(pid);
    const pConfig = form.providerConfigs?.[pid] ?? {};
    const isKeyShown = Boolean(showProviderKeys[pid]);
    const providerModels = enabledModelOptions.filter((m) => m.provider === pid);
    const isCustomInput = Boolean(customModelInputProviders[pid]);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Connection & Credentials Card */}
        <div className="providers-ios-group-card">
          <div className="providers-ios-group-title">
            <Globe size={14} style={{ color: "var(--primary, #ff75ac)" }} />
            <span>连接地址与访问凭据</span>
          </div>

          <div className="settings-form-row" style={{ margin: 0 }}>
            {isLocal ? (
              <label className="settings-field" style={{ flex: 1 }}>
                <span className="settings-field-label">
                  {pid === "lmstudio" ? "LM Studio URL" : "Ollama 服务地址"}
                </span>
                <input
                  className="settings-input"
                  value={pConfig.ollamaUrl ?? (pid === "lmstudio" ? "http://localhost:1234" : "http://localhost:11434")}
                  onChange={(e) => updateSpecificProviderConfig(pid, { ollamaUrl: e.target.value })}
                  placeholder={pid === "lmstudio" ? "http://localhost:1234" : "http://localhost:11434"}
                />
              </label>
            ) : (
              <>
                <label className="settings-field" style={{ flex: 1 }}>
                  <span className="settings-field-label">API Base URL</span>
                  <input
                    className="settings-input"
                    value={pConfig.baseUrl ?? providerBaseUrlDefaults[pid] ?? ""}
                    onChange={(e) => updateSpecificProviderConfig(pid, { baseUrl: e.target.value })}
                    placeholder={providerBaseUrlDefaults[pid] || "https://api.example.com/v1"}
                  />
                </label>

                <label className="settings-field" style={{ flex: 1 }}>
                  <span className="settings-field-label">API Key</span>
                  <div className="settings-input-with-action">
                    <input
                      className="settings-input"
                      type={isKeyShown ? "text" : "password"}
                      value={pConfig.apiKey ?? ""}
                      onChange={(e) => updateSpecificProviderConfig(pid, { apiKey: e.target.value })}
                      placeholder={pid === "nvidia" ? "nvapi-..." : "sk-..."}
                    />
                    <button
                      type="button"
                      className="settings-inline-action-btn icon-only"
                      onClick={() => toggleShowProviderKey(pid)}
                      title={isKeyShown ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {isKeyShown ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </label>
              </>
            )}
          </div>
        </div>

        {/* Model Invocation Card */}
        <div className="providers-ios-group-card">
          <div className="providers-ios-group-title">
            <Cpu size={14} style={{ color: "var(--primary, #ff75ac)" }} />
            <span>模型调用与默认分配</span>
          </div>

          <div className="settings-form-row" style={{ margin: 0 }}>
            <label className="settings-field" style={{ flex: 1 }}>
              <span className="settings-field-label">默认调用模型 (可选)</span>
              {providerModels.length > 0 && !isCustomInput ? (
                <div className="settings-input-with-action">
                  <select
                    className="settings-select"
                    value={pConfig.model || ""}
                    onChange={(e) => updateSpecificProviderConfig(pid, { model: e.target.value })}
                  >
                    <option value="">跟随全局默认 / 自动推荐</option>
                    {providerModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} {m.supportsVision ? "👁️" : ""}
                      </option>
                    ))}
                    {pConfig.model && !providerModels.some((m) => m.id === pConfig.model) ? (
                      <option value={pConfig.model}>{pConfig.model} (自定义)</option>
                    ) : null}
                  </select>
                  <button
                    type="button"
                    className="settings-inline-action-btn"
                    onClick={() => toggleProviderCustomModel(pid)}
                    title="手动输入未列出的模型 ID"
                    style={{ fontSize: 11, padding: "0 8px", whiteSpace: "nowrap" }}
                  >
                    手动输入
                  </button>
                </div>
              ) : (
                <div className="settings-input-with-action">
                  <input
                    className="settings-input"
                    value={pConfig.model ?? ""}
                    onChange={(e) => updateSpecificProviderConfig(pid, { model: e.target.value })}
                    placeholder={pid === "ollama" ? "llama3" : pid === "nvidia" ? sakiNvidiaDefaultModel : "例如 deepseek-chat, gpt-4o 等"}
                  />
                  {providerModels.length > 0 ? (
                    <button
                      type="button"
                      className="settings-inline-action-btn"
                      onClick={() => toggleProviderCustomModel(pid)}
                      title="从已同步的模型列表中选择"
                      style={{ fontSize: 11, padding: "0 8px", whiteSpace: "nowrap" }}
                    >
                      下拉选择
                    </button>
                  ) : null}
                </div>
              )}
            </label>
          </div>

          {/* Synced Models Preview */}
          {providerModels.length > 0 ? (
            <div className="providers-ios-models-preview">
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
                <Sparkles size={13} style={{ color: "var(--primary, #ff75ac)" }} />
                <span>已同步可用模型 ({providerModels.length})：</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {providerModels.map((m) => (
                  <span
                    key={m.id}
                    className="provider-tag"
                    style={{ cursor: "pointer" }}
                    title={`点击设为默认：${m.id}`}
                    onClick={() => updateSpecificProviderConfig(pid, { model: m.id })}
                  >
                    {m.label} {m.supportsVision ? "👁️" : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : isCurrentSelectedEnabled ? (
            <div style={{ fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
              未发现或尚未同步此服务商的模型。点击上方“同步全部模型”重新拉取。
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`settings-group ${isActive ? "active" : "settings-section-hidden"}`}
      id="settings-model"
    >
      <div className="settings-group-title">
        <div className="settings-group-icon">
          <Cpu size={16} />
        </div>
        <div>
          <h3>{t("settings.model.title")}</h3>
          <span>{t("settings.model.detail")}</span>
        </div>
      </div>

      <div className="settings-group-content ai-models-container">
        {/* ==================================================================
            1. Active Model Overview & Global Routing Hero Card
            ================================================================== */}
        <div className="active-model-hero-card">
          <div className="active-model-hero-top">
            <div className="active-model-status-group">
              <div className="active-model-indicator" title="当前激活并生效的模型">
                <CheckCircle2 size={20} />
              </div>
              <div className="active-model-details">
                <div className="active-model-meta-row">
                  <span>当前默认模型</span>
                  <span>·</span>
                  <span>
                    已开启 <strong>{enabledProviders.length}</strong> 个服务商，共{" "}
                    <strong>{enabledModelOptions.length}</strong> 个可用模型
                  </span>
                </div>
                <div className="active-model-title-row">
                  <span className="active-model-title">
                    {enabledProviders.length === 0
                      ? "未开启任何服务商"
                      : (form.model ? resolveModelDisplayName(`${form.provider}:${form.model}`).displayName : "未选择模型")}
                  </span>
                  {enabledProviders.length > 0 ? (
                    <>
                      <span className="active-model-badge">
                        {providerLabelMap[currentActiveModelItem?.provider || form.provider] || form.provider}
                      </span>
                      {currentActiveModelItem?.supportsVision ? (
                        <span className="active-model-badge vision">支持视觉 / Vision</span>
                      ) : null}
                      <span className="multiplier-pill default">
                        {form.modelPointsMultipliers?.[form.model] !== undefined
                          ? `${form.modelPointsMultipliers[form.model]}x 乘区`
                          : "1.0x 标准"}
                      </span>
                    </>
                  ) : (
                    <span className="provider-status-pill offline">服务商未开启</span>
                  )}
                </div>
              </div>
            </div>

            <div className="active-model-actions-row">
              <button
                type="button"
                className="model-sync-btn"
                disabled={detectingModels || loading}
                onClick={() => void detectModels(false)}
                title="重新检测并同步所有开启服务商的模型列表"
              >
                <RefreshCw size={13} className={detectingModels ? "animate-spin" : ""} />
                <span>{detectingModels ? "正在同步..." : "同步全部模型"}</span>
              </button>

              <button
                type="button"
                className="model-sync-btn"
                onClick={() => setCustomNamesOpen((prev) => !prev)}
                title="自定义模型名称或别名"
              >
                <Tag size={13} />
                <span>{customNamesOpen ? "收起改名" : "自定义模型名"}</span>
              </button>

              <button
                type="button"
                className="settings-text-btn"
                style={{
                  fontSize: 12,
                  background: "none",
                  border: "none",
                  color: "var(--primary, #ff75ac)",
                  cursor: "pointer",
                  padding: "4px 8px"
                }}
                onClick={() => setCustomModelMode((prev) => !prev)}
              >
                {customModelMode ? "从聚合列表选择" : "手动输入未列出 ID"}
              </button>
            </div>
          </div>

          {/* Model Selector Dropdown */}
          <div className="model-selector-row">
            <label className="settings-field" style={{ margin: 0 }}>
              <span className="settings-field-label">切换默认调用模型</span>
              {enabledModelOptions.length > 0 && !customModelMode ? (
                <div className="settings-input-with-action">
                  <select
                    className="settings-select active-model-select"
                    value={sakiModelSelectionKey({ id: form.model, provider: form.provider })}
                    onChange={(event) => {
                      onSelectActiveModel(event.target.value);
                    }}
                    required
                  >
                    {Array.from(modelsByProvider.entries()).map(([providerKey, models]) => (
                      <optgroup
                        key={providerKey}
                        label={`${providerLabelMap[providerKey] || providerKey} (${models.length})`}
                      >
                        {models.map((model) => (
                          <option value={sakiModelSelectionKey(model)} key={sakiModelSelectionKey(model)}>
                            {model.label} {model.supportsVision ? "👁️" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {form.model && !currentActiveModelItem ? (
                      <option value={sakiModelSelectionKey({ id: form.model, provider: form.provider })}>{form.model} (当前/自定义)</option>
                    ) : null}
                  </select>
                </div>
              ) : (
                <div className="settings-input-with-action">
                  <input
                    className="settings-input"
                    value={form.model}
                    onChange={(event) => updateActiveProviderConfig({ model: event.target.value })}
                    placeholder="输入模型 ID（如 gemini-3.8-flash, gpt-4o 等）"
                    required
                  />
                </div>
              )}
            </label>
          </div>
        </div>

        {/* ==================================================================
            2. Custom Model Names & Aliases Drawer (用户可自己更改模型名)
            ================================================================== */}
        {customNamesOpen ? (
          <div className="custom-names-box wide-field">
            <div className="custom-names-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Edit3 size={15} style={{ color: "var(--primary, #ff75ac)" }} />
                <strong>自定义模型名称 / 别名</strong>
                <span style={{ fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
                  多个服务商同名模型系统已默认标为“模型名-提供商”，您可在此为任意模型指定个性化名称
                </span>
              </div>
              <button
                type="button"
                className="multipliers-search-clear"
                onClick={() => setCustomNamesOpen(false)}
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>

            <div className="custom-names-list">
              {enabledModelOptions.length === 0 ? (
                <div style={{ padding: "16px", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
                  暂无可改名的模型，请确保至少开启了一个服务商并完成模型同步。
                </div>
              ) : (
                enabledModelOptions.map((model) => {
                  const key = `${model.provider}:${model.id}`;
                  const currentCustom = form.customModelNames?.[key] ?? form.customModelNames?.[model.id] ?? "";
                  const inputVal = customNameInputs[key] !== undefined ? customNameInputs[key] : currentCustom;
                  const defaultLabel = model.isConflict ? `${model.id}-${model.provider}` : (model.name || model.id);

                  return (
                    <div key={key} className="custom-name-item">
                      <div className="custom-name-meta">
                        <span className="model-base-id">{model.id}</span>
                        <span className="provider-tag">{providerLabelMap[model.provider] || model.provider}</span>
                        {model.isConflict ? (
                          <span className="conflict-pill" title="与其他服务商存在同名冲突，默认命名为：模型名-提供商">
                            冲突模型 · 默认：{defaultLabel}
                          </span>
                        ) : null}
                      </div>

                      <div className="custom-name-input-group">
                        <input
                          type="text"
                          className="custom-name-input"
                          placeholder={defaultLabel}
                          value={inputVal}
                          onChange={(e) => {
                            setCustomNameInputs((prev) => ({
                              ...prev,
                              [key]: e.target.value
                            }));
                          }}
                        />
                        <button
                          type="button"
                          className="model-sync-btn"
                          style={{ padding: "4px 10px", fontSize: 11.5 }}
                          onClick={() => {
                            if (inputVal.trim()) {
                              onSetCustomModelName(key, inputVal.trim());
                            } else {
                              onResetCustomModelName(key);
                            }
                          }}
                        >
                          <Check size={12} />
                          <span>保存</span>
                        </button>
                        {currentCustom ? (
                          <button
                            type="button"
                            className="model-sync-btn"
                            style={{ padding: "4px 8px", fontSize: 11.5 }}
                            onClick={() => {
                              onResetCustomModelName(key);
                              setCustomNameInputs((prev) => ({ ...prev, [key]: "" }));
                            }}
                            title="恢复默认"
                          >
                            <RotateCcw size={12} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {/* ==================================================================
            3. Providers Hub & Independent Switches (iOS Master-Detail Deck)
            ================================================================== */}
        <div className="providers-section-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Layers size={16} />
            <strong style={{ fontSize: 14 }}>服务商接入与独立开关 (AI Providers)</strong>
          </div>
          <span style={{ fontSize: 12, color: "var(--text-secondary, #86868b)" }}>
            每个服务商均配备独立开关，只有开关开启才会加载并启动该服务商的模型资源。开启多个服务商时，全部可用模型将自动聚合。
          </span>
        </div>

        <div className="providers-ios-deck">
          {/* Left Master Sidebar */}
          <div className="providers-ios-sidebar">
            <div className="providers-ios-sidebar-header">
              <div className="providers-ios-sidebar-title-row">
                <span className="providers-ios-sidebar-title">已接入服务商</span>
                <span className="providers-ios-count-badge">
                  {enabledProviders.length} / {allProvidersList.length} 已开启
                </span>
              </div>
              <div className="providers-ios-search-wrap">
                <Search size={13} className="providers-ios-search-icon" />
                <input
                  type="text"
                  className="providers-ios-search-input"
                  placeholder="搜索服务商..."
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                />
                {providerSearch ? (
                  <button
                    type="button"
                    className="providers-ios-search-clear"
                    onClick={() => setProviderSearch("")}
                    title="清空"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="providers-ios-sidebar-list">
              {providerSearch.trim() ? (
                filteredSidebarProviders.length === 0 ? (
                  <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                    未找到匹配的服务商
                  </div>
                ) : (
                  filteredSidebarProviders.map((p) => {
                    const isEnabled = isProviderEnabled(form, p.id);
                    const count = enabledModelOptions.filter((m) => m.provider === p.id).length;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className={`providers-ios-item ${selectedProviderId === p.id ? "active" : ""}`}
                        onClick={() => setSelectedProviderId(p.id)}
                      >
                        <div className="providers-ios-item-icon" style={{ background: p.iconBg, color: p.iconColor }}>
                          {renderProviderIcon(p.iconType, 16)}
                        </div>
                        <div className="providers-ios-item-info">
                          <span className="providers-ios-item-name">{p.name}</span>
                          <span className={`providers-ios-item-sub ${isEnabled ? "enabled" : "disabled"}`}>
                            {isEnabled ? (count > 0 ? `已启用 · ${count} 个模型` : "已启用") : "已关闭"}
                          </span>
                        </div>
                        <div className="providers-ios-item-trailing">
                          {isEnabled ? <span className="providers-ios-status-dot" title="已启用" /> : null}
                          <ChevronRight size={13} className="providers-ios-chevron" />
                        </div>
                      </button>
                    );
                  })
                )
              ) : (
                providerCategories.map((cat) => {
                  const catProviders = allProvidersList.filter((p) => p.category === cat.key);
                  if (catProviders.length === 0) return null;
                  return (
                    <React.Fragment key={cat.key}>
                      <span className="providers-ios-category-label">{cat.label}</span>
                      {catProviders.map((p) => {
                        const isEnabled = isProviderEnabled(form, p.id);
                        const count = enabledModelOptions.filter((m) => m.provider === p.id).length;
                        return (
                          <button
                            type="button"
                            key={p.id}
                            className={`providers-ios-item ${selectedProviderId === p.id ? "active" : ""}`}
                            onClick={() => setSelectedProviderId(p.id)}
                          >
                            <div className="providers-ios-item-icon" style={{ background: p.iconBg, color: p.iconColor }}>
                              {renderProviderIcon(p.iconType, 16)}
                            </div>
                            <div className="providers-ios-item-info">
                              <span className="providers-ios-item-name">{p.name}</span>
                              <span className={`providers-ios-item-sub ${isEnabled ? "enabled" : "disabled"}`}>
                                {isEnabled ? (count > 0 ? `已启用 · ${count} 个模型` : "已启用") : "已关闭"}
                              </span>
                            </div>
                            <div className="providers-ios-item-trailing">
                              {isEnabled ? <span className="providers-ios-status-dot" title="已启用" /> : null}
                              <ChevronRight size={13} className="providers-ios-chevron" />
                            </div>
                          </button>
                        );
                      })}
                    </React.Fragment>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Detail Settings Panel */}
          <div className="providers-ios-detail">
            {/* Detail Header */}
            <div className="providers-detail-header">
              <div className="providers-detail-brand">
                <div
                  className="providers-detail-brand-icon"
                  style={{ background: activeProviderMeta.iconBg, color: activeProviderMeta.iconColor }}
                >
                  {renderProviderIcon(activeProviderMeta.iconType, 22)}
                </div>
                <div className="providers-detail-brand-text">
                  <div className="providers-detail-title-row">
                    <h4 className="providers-detail-title">{activeProviderMeta.name}</h4>
                    <span className="providers-detail-tag">{activeProviderMeta.tag}</span>
                    {selectedProviderId === "copilot" ? (
                      <span className={`provider-status-pill ${copilotAuthStatus?.authenticated ? "online" : "offline"}`}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: copilotAuthStatus?.authenticated ? "#10b981" : "#94a3b8"
                          }}
                        />
                        <span>{copilotAuthStatus?.authenticated
                          ? copilotAuthStatus.login ? `@${copilotAuthStatus.login}` : "Copilot 可用"
                          : copilotAuthStatus?.githubAuthenticated ? "Copilot 未就绪" : "未授权"}</span>
                      </span>
                    ) : selectedProviderId === "antigravity" ? (
                      <span
                        className={`provider-status-pill ${
                          isAntigravityReady ? "online" : isPendingProxy ? "warning" : "offline"
                        }`}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: isAntigravityReady ? "#10b981" : isPendingProxy ? "#f59e0b" : "#94a3b8"
                          }}
                        />
                        <span>
                          {isAntigravityReady
                            ? isDirectMode
                              ? "官方直连已就绪"
                              : "反代服务已就绪"
                            : isPendingProxy
                            ? "待启动反代 (8080)"
                            : "未就绪"}
                        </span>
                      </span>
                    ) : (
                      <span className={`provider-status-pill ${isCurrentSelectedEnabled ? "online" : "offline"}`}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: isCurrentSelectedEnabled ? "#10b981" : "#94a3b8"
                          }}
                        />
                        <span>{isCurrentSelectedEnabled ? "已启用" : "已关闭"}</span>
                      </span>
                    )}
                  </div>
                  <span className="providers-detail-desc">{activeProviderMeta.desc}</span>
                </div>
              </div>

              {/* Master Switch on Header */}
              <div className="providers-detail-master-switch">
                <span className={`provider-switch-label ${isCurrentSelectedEnabled ? "on" : "off"}`}>
                  {isCurrentSelectedEnabled ? "已启用" : "已关闭"}
                </span>
                <label className="settings-switch-toggle" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isCurrentSelectedEnabled}
                    onChange={(e) => onToggleProviderEnabled(selectedProviderId, e.target.checked)}
                  />
                  <span className="settings-switch-slider" />
                </label>
              </div>
            </div>

            {/* Detail Body */}
            <div className="providers-detail-body">
              {!isCurrentSelectedEnabled ? (
                <div className="providers-ios-notice">
                  <Info size={16} style={{ color: "var(--primary, #ff75ac)", flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {activeProviderMeta.name} 服务当前未开启。您可在下方提前配置参数，开启右上角开关即可加载并聚合此服务商的模型资源。
                  </span>
                </div>
              ) : null}

              {/* Render Provider Specific View */}
              {selectedProviderId === "copilot"
                ? renderCopilotDetail()
                : selectedProviderId === "antigravity"
                ? renderAntigravityDetail()
                : renderGenericProviderDetail(selectedProviderId)}
            </div>
          </div>
        </div>

        {/* ==================================================================
            4. Image Generation Section (允许 Agent 自主画图)
            ================================================================== */}
        <div className="provider-card enabled wide-field" style={{ marginTop: 10 }}>
          <div className="provider-card-header">
            <div className="provider-brand-info">
              <div className="provider-brand-icon" style={{ background: "rgba(255, 117, 172, 0.14)", color: "var(--primary, #ff75ac)" }}>
                <ImagePlus size={20} />
              </div>
              <div className="provider-title-wrap">
                <div className="provider-title-row">
                  <span className="provider-name">{t("settings.model.imageGen")}</span>
                  <span className="provider-tag">文生图 / 视觉生成</span>
                </div>
                <span className="provider-card-desc">{t("settings.model.imageGen.detail")}</span>
              </div>
            </div>

            <div className="provider-toggle-wrap">
              <span className={`provider-switch-label ${imageGen.enabled ? "on" : "off"}`}>
                {imageGen.enabled ? "已启用" : "已关闭"}
              </span>
              <label className="settings-switch-toggle" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={imageGen.enabled}
                  onChange={(e) => onImageGenChange({ enabled: e.target.checked })}
                />
                <span className="settings-switch-slider" />
              </label>
            </div>
          </div>

          <div className={`provider-card-body ${imageGen.enabled ? "" : "is-disabled"}`}>
            <div className="settings-form-row">
              <label className="settings-field">
                <span className="settings-field-label">生图服务商</span>
                <select
                  className="settings-select"
                  value={imageGen.provider}
                  onChange={(event) => onImageGenChange(applyImageGenProvider(imageGen, event.target.value))}
                >
                  {sakiImageGenProviderPresets.map((preset) => (
                    <option value={preset.id} key={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <span className="settings-field-hint">
                  {imageGenPreset?.hint || "本地 WebUI、厂商 API 或自定义 URL 均可"}
                </span>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">接口协议</span>
                <select
                  className="settings-select"
                  value={imageGen.protocol}
                  onChange={(event) =>
                    onImageGenChange({ protocol: event.target.value as SakiImageGenConfig["protocol"] })
                  }
                >
                  {imageGenProtocolOptions.map((opt) => (
                    <option value={opt.value} key={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settings-form-row">
              <label className="settings-field">
                <span className="settings-field-label">Base URL</span>
                <input
                  className="settings-input"
                  value={imageGen.baseUrl}
                  onChange={(event) => onImageGenChange({ baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </label>

              {imageGenNeedsApiKey(imageGen) ? (
                <label className="settings-field">
                  <span className="settings-field-label">API Key</span>
                  <div className="settings-input-with-action">
                    <input
                      className="settings-input"
                      type={showImageApiKey ? "text" : "password"}
                      value={imageGen.apiKey}
                      onChange={(event) => onImageGenChange({ apiKey: event.target.value })}
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      className="settings-inline-action-btn icon-only"
                      onClick={() => setShowImageApiKey((s) => !s)}
                      title={showImageApiKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {showImageApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </label>
              ) : null}
            </div>

            <div className="settings-form-row">
              <label className="settings-field">
                <span className="settings-field-label">默认画图模型</span>
                <input
                  className="settings-input"
                  value={imageGen.model}
                  onChange={(event) => onImageGenChange({ model: event.target.value })}
                  placeholder="例如 dall-e-3, sd-xl 等"
                />
              </label>

              <label className="settings-field">
                <span className="settings-field-label">默认画幅比例</span>
                <select
                  className="settings-select"
                  value={imageGen.defaultAspectRatio}
                  onChange={(event) =>
                    onImageGenChange(withImageGenSizeDefaults(imageGen, { defaultAspectRatio: event.target.value as SakiImageGenConfig["defaultAspectRatio"] }))
                  }
                >
                  {imageGenAspectRatioOptions.map((opt) => (
                    <option value={opt.value} key={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">默认质量</span>
                <select
                  className="settings-select"
                  value={imageGen.defaultQuality}
                  onChange={(event) =>
                    onImageGenChange(withImageGenSizeDefaults(imageGen, { defaultQuality: event.target.value as SakiImageGenConfig["defaultQuality"] }))
                  }
                >
                  {imageGenQualityOptions.map((opt) => (
                    <option value={opt.value} key={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        {/* ==================================================================
            5. Model Points Multipliers (模型积分消耗乘区 - 只显示开启的服务商)
            ================================================================== */}
        <div className="model-multipliers-card wide-field" style={{ marginTop: 10 }}>
          <div className="model-multipliers-header">
            <div className="model-multipliers-title">
              <Coins size={18} className="settings-switch-icon" />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>模型积分消耗乘区</strong>
                </div>
                <span className="model-multipliers-subtitle">
                  配置各个 AI 模型的积分扣除倍率（换算规则：1000 Tokens = 1 积分 × 模型乘区倍率，向上取整）。
                  设为 <strong>0x</strong> 则完全免费；未单独配置的模型默认按 <strong>1.0x</strong> 计费。
                </span>
              </div>
            </div>

            <div className="model-multipliers-header-right">
              <div className="model-multipliers-search-box">
                <Search size={14} className="multipliers-search-icon" />
                <input
                  type="text"
                  className="settings-input mini multipliers-search-input"
                  placeholder="搜索已开启的模型..."
                  value={multipliersFilter}
                  onChange={(e) => {
                    setMultipliersFilter(e.target.value);
                    setMultipliersPage(1);
                  }}
                />
                {multipliersFilter ? (
                  <button
                    type="button"
                    className="multipliers-search-clear"
                    onClick={() => {
                      setMultipliersFilter("");
                      setMultipliersPage(1);
                    }}
                    title="清空搜索"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="model-multipliers-list">
            {paginatedMultipliers.length === 0 ? (
              <div className="model-multipliers-empty">
                <span>
                  {multipliersFilter
                    ? `未找到与「${multipliersFilter}」匹配的模型`
                    : enabledProviders.length === 0
                      ? "尚未开启任何模型服务商。请在上方开启服务商开关，系统将自动加载并展示对应模型及其乘区。"
                      : "当前开启的服务商中暂无模型，请在上方点击“同步全部模型”。"}
                </span>
              </div>
            ) : (
              paginatedMultipliers.map((modelKey) => {
                const currentMultiplier = form.modelPointsMultipliers?.[modelKey] ?? 1.0;
                const isCustom = form.modelPointsMultipliers?.[modelKey] !== undefined;
                const isCurrentActive = form.model === modelKey;
                const { displayName, baseId, providerName, isConflict } = resolveModelDisplayName(modelKey);

                return (
                  <div
                    key={modelKey}
                    className={`model-multiplier-item ${isCurrentActive ? "active-model" : ""}`}
                  >
                    <div className="model-multiplier-info">
                      <div className="model-name-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="model-identifier">{displayName}</span>
                        {displayName !== baseId ? (
                          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                            ({baseId})
                          </span>
                        ) : null}
                        <span className="provider-tag">{providerName}</span>
                        {isConflict ? (
                          <span className="conflict-pill" style={{ fontSize: 10 }}>
                            冲突模型
                          </span>
                        ) : null}
                        {isCurrentActive ? (
                          <span className="model-active-badge">当前生效</span>
                        ) : null}
                      </div>

                      <div className="multiplier-status-row">
                        {currentMultiplier === 0 ? (
                          <span className="multiplier-pill free">0x 免费</span>
                        ) : currentMultiplier === 1 ? (
                          <span className="multiplier-pill default">1.0x 标准</span>
                        ) : currentMultiplier > 1 ? (
                          <span className="multiplier-pill premium">{currentMultiplier}x 乘区</span>
                        ) : (
                          <span className="multiplier-pill discount">{currentMultiplier}x 优惠</span>
                        )}
                      </div>
                    </div>

                    <div className="model-multiplier-controls">
                      <div className="multiplier-preset-buttons">
                        {[0, 0.5, 1.0, 2.0, 3.0].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className={`preset-btn ${currentMultiplier === preset ? "selected" : ""}`}
                            onClick={() => handleSetModelMultiplier(modelKey, preset)}
                          >
                            {preset === 0 ? "免费(0x)" : `${preset}x`}
                          </button>
                        ))}
                      </div>

                      <div className="multiplier-input-wrapper">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          className="multiplier-number-input"
                          value={currentMultiplier}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            handleSetModelMultiplier(modelKey, Number.isFinite(val) ? val : 1);
                          }}
                        />
                        <span className="multiplier-unit">x</span>
                      </div>

                      {isCustom ? (
                        <button
                          type="button"
                          className="multiplier-reset-btn"
                          onClick={() => handleResetModelMultiplier(modelKey)}
                          title="恢复为默认 1.0x"
                        >
                          重置
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalMultipliersPages > 1 ? (
            <div className="model-multipliers-pagination">
              <div className="multipliers-pagination-info">
                第 <strong>{safeMultipliersPage}</strong> / {totalMultipliersPages} 页 · 共 {filteredMultipliers.length} 个已开启模型
              </div>
              <div className="multipliers-pagination-controls">
                <button
                  type="button"
                  className="multipliers-page-btn"
                  disabled={safeMultipliersPage <= 1}
                  onClick={() => setMultipliersPage((p) => Math.max(1, p - 1))}
                  title="上一页"
                >
                  <ChevronLeft size={14} />
                  <span>上一页</span>
                </button>

                <div className="multipliers-page-numbers">
                  {Array.from({ length: totalMultipliersPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalMultipliersPages || Math.abs(p - safeMultipliersPage) <= 1)
                    .map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={`multipliers-page-num ${safeMultipliersPage === item ? "active" : ""}`}
                        onClick={() => setMultipliersPage(item)}
                      >
                        {item}
                      </button>
                    ))}
                </div>

                <button
                  type="button"
                  className="multipliers-page-btn"
                  disabled={safeMultipliersPage >= totalMultipliersPages}
                  onClick={() => setMultipliersPage((p) => Math.min(totalMultipliersPages, p + 1))}
                  title="下一页"
                >
                  <span>下一页</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : null}

          {/* Add custom model multiplier */}
          <div className="add-multiplier-row">
            <input
              className="settings-input add-model-input"
              placeholder="自定义模型名称（如 claude-3-7-sonnet、deepseek-chat 等）"
              value={newMultiplierModel}
              onChange={(e) => setNewMultiplierModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomMultiplier();
                }
              }}
            />
            <div className="multiplier-input-wrapper">
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                className="multiplier-number-input"
                value={newMultiplierValue}
                onChange={(e) => setNewMultiplierValue(e.target.value)}
                placeholder="倍率"
              />
              <span className="multiplier-unit">x</span>
            </div>
            <button
              type="button"
              className="ghost-button add-multiplier-btn"
              disabled={!newMultiplierModel.trim()}
              onClick={handleAddCustomMultiplier}
            >
              <Plus size={14} />
              <span>添加乘区</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
