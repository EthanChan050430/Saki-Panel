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
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Globe,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
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
  SakiModelOption,
  SakiProviderConfig
} from "@webops/shared";
import type { PanelTextKey } from "../../i18n/index.js";
import {
  antigravityModeOf,
  isLocalProvider,
  modelProviderOptions,
  needsCloudApiFields,
  providerBaseUrlDefaults,
  type AntigravityMode
} from "./settingsHelpers.js";

export interface SettingsModelTabProps {
  isActive: boolean;
  form: SakiConfigResponse;
  changeProvider: (provider: string) => void;
  updateActiveProviderConfig: (patch: Partial<SakiProviderConfig>) => void;
  modelOptions: SakiModelOption[];
  detectingModels: boolean;
  loading: boolean;
  detectModels: (force?: boolean) => Promise<void>;
  showApiKey: boolean;
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>;
  customModelMode: boolean;
  setCustomModelMode: React.Dispatch<React.SetStateAction<boolean>>;
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
  modelOptions,
  detectingModels,
  loading,
  detectModels,
  showApiKey,
  setShowApiKey,
  customModelMode,
  setCustomModelMode,
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
  const MULTIPLIERS_PER_PAGE = 8;

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

  return (
    <div
      className={`settings-group ${isActive ? "active" : "settings-section-hidden"}`}
      id="settings-model"
    >
      <div className="settings-group-title">
        <div className="settings-group-icon">
          <Cpu size={20} />
        </div>
        <div>
          <h3>{t("settings.model.title")}</h3>
          <span>{t("settings.model.detail")}</span>
        </div>
      </div>
      <div className="settings-group-content">
        <div className="settings-form-row">
          <label className="settings-field">
            <span className="settings-field-label">服务商 (Provider)</span>
            <select
              className="settings-select"
              value={form.provider}
              onChange={(event) => changeProvider(event.target.value)}
            >
              {modelProviderOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4
              }}
            >
              <span className="settings-field-label" style={{ marginBottom: 0 }}>
                模型名称 (Model)
              </span>
              {modelOptions.length > 0 ? (
                <button
                  type="button"
                  className="settings-text-btn"
                  style={{
                    fontSize: 12,
                    background: "none",
                    border: "none",
                    color: "var(--accent-color, #3b82f6)",
                    cursor: "pointer",
                    padding: "0 2px"
                  }}
                  onClick={() => setCustomModelMode((prev) => !prev)}
                >
                  {customModelMode ? "从可用列表选择" : "手动输入自定义 ID"}
                </button>
              ) : null}
            </div>
            {modelOptions.length > 0 && !customModelMode ? (
              <div className="settings-input-with-action">
                <select
                  className="settings-select"
                  value={form.model}
                  onChange={(event) => updateActiveProviderConfig({ model: event.target.value })}
                  required
                >
                  {modelOptions.map((model) => (
                    <option value={model.id} key={`${model.provider}:${model.id}`}>
                      {model.label}
                    </option>
                  ))}
                  {form.model && !modelOptions.some((m) => m.id === form.model) ? (
                    <option value={form.model}>{form.model} (当前/自定义)</option>
                  ) : null}
                </select>
                <button
                  type="button"
                  className="settings-inline-action-btn"
                  disabled={detectingModels || loading}
                  onClick={() => void detectModels(false)}
                  title="直接从当前服务同步实时可用模型列表"
                >
                  <RefreshCw size={14} className={detectingModels ? "animate-spin" : ""} />
                  <span>{detectingModels ? "同步中" : "同步模型"}</span>
                </button>
              </div>
            ) : (
              <div className="settings-input-with-action">
                <input
                  className="settings-input"
                  value={form.model}
                  onChange={(event) => updateActiveProviderConfig({ model: event.target.value })}
                  placeholder={
                    form.provider === "ollama" ? "llama3" : "例如 gemini-3.8-flash、gemini-2.5-pro 等"
                  }
                  required
                />
                <button
                  type="button"
                  className="settings-inline-action-btn"
                  disabled={detectingModels || loading}
                  onClick={() => void detectModels(false)}
                  title="检测当前服务商可用模型"
                >
                  <RefreshCw size={14} className={detectingModels ? "animate-spin" : ""} />
                  <span>{detectingModels ? "检测中" : "检测"}</span>
                </button>
              </div>
            )}
          </label>
        </div>

        {isLocalProvider(form.provider) ? (
          <label className="settings-field">
            <span className="settings-field-label">
              {form.provider === "lmstudio" ? "LM Studio URL" : "Ollama 服务地址"}
            </span>
            <input
              className="settings-input"
              value={form.ollamaUrl}
              onChange={(event) => {
                updateActiveProviderConfig({ ollamaUrl: event.target.value });
              }}
              placeholder={form.provider === "lmstudio" ? "http://localhost:1234" : "http://localhost:11434"}
            />
            <span className="settings-field-hint">本地运行的模型服务 HTTP 监听地址</span>
          </label>
        ) : null}

        {needsCloudApiFields(form.provider) ? (
          <div className="settings-form-row">
            <label className="settings-field">
              <span className="settings-field-label">API Base URL</span>
              <input
                className="settings-input"
                value={form.baseUrl}
                onChange={(event) => {
                  updateActiveProviderConfig({ baseUrl: event.target.value });
                }}
                placeholder={providerBaseUrlDefaults[form.provider] || "https://api.example.com/v1"}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">API Key</span>
              <div className="settings-input-with-action">
                <input
                  className="settings-input"
                  type={showApiKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(event) => {
                    updateActiveProviderConfig({ apiKey: event.target.value });
                  }}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  className="settings-inline-action-btn icon-only"
                  onClick={() => setShowApiKey((s) => !s)}
                  title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
          </div>
        ) : null}

        {form.provider === "copilot" ? (
          <div className="copilot-auth-panel wide-field">
            <div className="copilot-auth-status">
              <div className={`copilot-auth-badge ${copilotAuthStatus?.authenticated ? "authenticated" : "pending"}`}>
                {copilotAuthStatus?.authenticated ? <CheckCircle2 size={18} /> : <Github size={18} />}
                <span>{copilotAuthStatus?.authenticated ? "已授权连接" : "未授权"}</span>
              </div>
              <div className="copilot-auth-copy">
                <strong>GitHub Copilot 认证状态</strong>
                <span>
                  {copilotAuthStatus?.authenticated
                    ? `当前绑定账号：${copilotAuthStatus.login || "已登录"}${copilotAuthStatus.authType ? ` (${copilotAuthStatus.authType})` : ""}`
                    : copilotAuthStatus?.message || "点击下方登录获取授权码以绑定 GitHub 账号。"}
                </span>
              </div>
            </div>
            <div className="copilot-auth-actions">
              <button
                className="ghost-button"
                disabled={copilotBusy === "status" || loading}
                type="button"
                onClick={() => void refreshCopilotAuthStatus(false)}
              >
                <RefreshCw size={15} />
                <span>{copilotBusy === "status" ? "检查中" : "检查状态"}</span>
              </button>
              <button
                className="primary-button"
                disabled={copilotBusy === "login" || loading}
                type="button"
                onClick={() => void startCopilotLoginFromSettings()}
              >
                <LogIn size={15} />
                <span>{copilotBusy === "login" ? "连接中..." : "登录 GitHub"}</span>
              </button>
            </div>
            {copilotLoginState?.message ? (
              <div className="copilot-login-progress">
                <div>
                  <KeyRound size={16} />
                  <span>{copilotLoginState.message}</span>
                </div>
                {copilotLoginState.userCode || copilotLoginState.verificationUri ? (
                  <div className="copilot-device-row">
                    {copilotLoginState.userCode ? <code>{copilotLoginState.userCode}</code> : null}
                    {copilotLoginState.verificationUri ? (
                      <a href={copilotLoginState.verificationUri} target="_blank" rel="noopener noreferrer">
                        前往 GitHub 设备验证页 <ArrowRight size={14} />
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {form.provider === "antigravity" ? (() => {
          const antigravityMode = antigravityModeOf(form.providerConfigs?.antigravity);
          const isDirectMode = antigravityMode === "direct";
          const isAntigravityReady = isDirectMode
            ? Boolean(form.apiKey.trim() || (antigravityStatus?.available && antigravityStatus?.authenticated))
            : Boolean(
                antigravityStatus?.isEndpointReachable ||
                (antigravityStatus?.available && antigravityStatus?.authenticated)
              );
          const isPendingProxy = Boolean(
            !isDirectMode && antigravityStatus?.authenticated && !isAntigravityReady
          );

          return (
            <div className="antigravity-dashboard-card wide-field">
              {/* Header: Brand Identity & Status Badge */}
              <div className="antigravity-hero-header">
                <div className="antigravity-brand-info">
                  <div className="antigravity-brand-icon">
                    <Zap size={20} />
                  </div>
                  <div>
                    <div className="antigravity-brand-title">
                      <strong>Google Antigravity CLI</strong>
                      <span className="antigravity-version-pill">Official OAuth 2.0</span>
                    </div>
                    <span className="antigravity-brand-subtitle">
                      基于 Google 官方 OAuth 授权直连 Gemini 3.8 / 2.5 系列模型或接入本地代理网关
                    </span>
                  </div>
                </div>

                <div className={`antigravity-status-pill ${isAntigravityReady ? "online" : (isPendingProxy ? "warning" : "offline")}`}>
                  <span className="status-dot" />
                  <span>
                    {isAntigravityReady
                      ? (isDirectMode ? "官方直连已就绪" : "反代服务已就绪")
                      : (isPendingProxy ? "已登录 · 待启动反代" : "尚未连接")}
                  </span>
                </div>
              </div>

              {/* Hero Account Bar */}
              <div className="antigravity-account-hero">
                <div className="antigravity-account-visual">
                  <div className={`antigravity-avatar-circle ${antigravityStatus?.authenticated ? "active" : ""}`}>
                    {antigravityStatus?.authenticated ? (
                      <UserCheck size={22} className="avatar-icon-success" />
                    ) : (
                      <UserX size={22} className="avatar-icon-muted" />
                    )}
                  </div>
                  <div className="antigravity-account-details">
                    <div className="antigravity-account-row">
                      <span className="antigravity-account-caption">
                        {antigravityStatus?.authenticated ? "当前登录 Google 账号" : "账号登录状态"}
                      </span>
                      {antigravityStatus?.authenticated ? (
                        <span className="antigravity-badge-verified">
                          <ShieldCheck size={12} />
                          已验证
                        </span>
                      ) : null}
                    </div>

                    <div className="antigravity-account-primary">
                      {antigravityStatus?.authenticated ? (
                        <span className="account-email-text">
                          {antigravityStatus.accountEmail || "已连接官方 / 本地凭据"}
                        </span>
                      ) : (
                        <span className="account-email-text unauthenticated">未登录 Google 账号</span>
                      )}
                    </div>

                    <p className="antigravity-account-desc">
                      {antigravityStatus?.message || (
                        antigravityStatus?.authenticated
                          ? "OAuth 2.0 凭据已持久化就绪，所有对话与智能体任务将通过此账号认证调用。"
                          : "未检测到已授权的 Google 账号。请点击右侧“登录 Google 账号”进行官方授权。"
                      )}
                    </p>
                  </div>
                </div>

                {/* Main Action Buttons */}
                <div className="antigravity-hero-actions">
                  <button
                    className="ghost-button antigravity-btn"
                    disabled={detectingModels || loading}
                    type="button"
                    onClick={() => void detectModels(false)}
                    title="直接从反代服务或 Google API 实时拉取同步最新模型列表"
                  >
                    <RefreshCw size={14} className={detectingModels ? "animate-spin" : ""} />
                    <span>{detectingModels ? "正在同步..." : "同步最新模型"}</span>
                  </button>

                  <button
                    className="ghost-button antigravity-btn"
                    disabled={antigravityBusy || Boolean(antigravityActionBusy) || loading}
                    type="button"
                    onClick={() => void refreshAntigravityStatus(false)}
                    title="刷新当前连接状态与用量信息"
                  >
                    <RefreshCw size={14} className={antigravityBusy ? "animate-spin" : ""} />
                    <span>{antigravityBusy ? "检测中..." : "检查状态"}</span>
                  </button>

                  {antigravityStatus?.authenticated || antigravityStatus?.accountEmail ? (
                    <button
                      className="danger-button antigravity-btn"
                      disabled={loading || Boolean(antigravityActionBusy)}
                      type="button"
                      onClick={() => {
                        if (window.confirm(`确定要退出当前 Google 账号 (${antigravityStatus?.accountEmail || "当前账号"}) 吗？`)) {
                          void handleAntigravityLogout();
                        }
                      }}
                      title="退出当前登录的 Google 账号"
                    >
                      {antigravityActionBusy === "logout" ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>正在退出...</span>
                        </>
                      ) : (
                        <>
                          <LogOut size={14} />
                          <span>退出账号</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      className="primary-button antigravity-btn antigravity-login-cta"
                      disabled={loading || Boolean(antigravityActionBusy)}
                      type="button"
                      onClick={() => void startAntigravityOAuthFlow()}
                      title="前往 Google 官方授权页登录 Antigravity"
                    >
                      {antigravityActionBusy === "oauth-init" ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>正在连接...</span>
                        </>
                      ) : (
                        <>
                          <LogIn size={14} />
                          <span>登录 Google 账号</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Multi-Account Bar */}
              {antigravityStatus?.accounts && antigravityStatus.accounts.length > 1 ? (
                <div className="antigravity-multi-accounts-card">
                  <div className="multi-accounts-head">
                    <div className="multi-accounts-title">
                      <UserRound size={14} />
                      <span>已关联的多账号 ({antigravityStatus.accounts.length})</span>
                    </div>
                    <button
                      type="button"
                      className="ghost-button compact add-account-ghost"
                      onClick={() => void startAntigravityOAuthFlow()}
                      title="登录并绑定另一个 Google 账号"
                    >
                      <Plus size={13} />
                      <span>添加新账号</span>
                    </button>
                  </div>
                  <div className="accounts-pill-list">
                    {antigravityStatus.accounts.map((acc) => {
                      const isCurrent = acc.isActive || acc.email === antigravityStatus.accountEmail;
                      return (
                        <div
                          key={acc.email}
                          className={`account-item-pill ${isCurrent ? "active" : ""}`}
                          onClick={() => {
                            if (!isCurrent && !antigravityActionBusy) {
                              void handleAntigravitySwitchAccount(acc.email);
                            }
                          }}
                        >
                          <span className="account-pill-email">{acc.email}</span>
                          {isCurrent ? (
                            <span className="account-pill-badge active">活动中</span>
                          ) : (
                            <span className="account-pill-badge switch">点击切换</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (antigravityStatus?.authenticated || antigravityStatus?.accountEmail) ? (
                <div className="antigravity-single-account-tools">
                  <span className="tools-caption">
                    <Info size={13} /> 支持绑定多个 Google 账号以供随时切换
                  </span>
                  <button
                    type="button"
                    className="antigravity-link-button"
                    onClick={() => void startAntigravityOAuthFlow()}
                  >
                    <Plus size={13} />
                    <span>绑定其他 Google 账号</span>
                  </button>
                </div>
              ) : null}

              {/* Notice banner when user is logged in with Google OAuth but proxy endpoint is not listening */}
              {isPendingProxy ? (
                <div className="antigravity-notice-banner warning">
                  <div className="banner-icon-area">
                    <AlertTriangle size={20} className="banner-icon-warning" />
                  </div>
                  <div className="banner-content">
                    <div className="banner-title">
                      Google 账号已成功授权，但反向代理服务尚未运行（端点 <code>{antigravityStatus?.endpoint || "http://localhost:8080/v1"}</code> 离线）
                    </div>
                    <div className="banner-desc">
                      已成功保存 <strong>{antigravityStatus?.accountEmail}</strong> 的 Google 授权。因 Antigravity 需通过本地代理中转模型请求，请选择以下任一方式启用：
                    </div>
                    <div className="banner-solutions-grid">
                      <div className="solution-card">
                        <div className="solution-header">
                          <span className="solution-badge primary">推荐方案 1</span>
                          <strong>免反代直连官方服务（最简便）</strong>
                        </div>
                        <p>
                          展开下方【连接方式与凭据配置】，切换到 <strong>官方直连 (Gemini API Key)</strong>，填入在 Google AI Studio 免费申请的 Key（以 <code>AIzaSy</code> 开头）并保存设置，即可直连官方 API，无需在服务器运行任何反代进程！
                        </p>
                      </div>
                      <div className="solution-card">
                        <div className="solution-header">
                          <span className="solution-badge secondary">方案 2</span>
                          <strong>在服务器启动本地反代进程</strong>
                        </div>
                        <p>
                          若您使用的是 <code>anti-api</code> 或 <code>antigravity-proxy</code>，请在服务器终端启动反代服务并监听 8080 端口（若监听其他端口，请在下方「连接方式与凭据配置」中修改 Base URL）。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 2-Step OAuth Wizard Box */}
              {antigravityOAuthActive ? (
                <div className="antigravity-oauth-wizard">
                  <div className="wizard-header">
                    <div className="wizard-title-group">
                      <div className="wizard-icon-chip">
                        <KeyRound size={16} />
                      </div>
                      <div>
                        <strong>Google 官方授权向导</strong>
                        <span className="wizard-sub">使用 Antigravity CLI 官方安全通道认证，零泄露风险</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="wizard-close-btn"
                      onClick={() => {
                        setAntigravityOAuthActive(false);
                        setAntigravityAuthCodeInput("");
                      }}
                      title="关闭向导"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  <div className="wizard-steps-container">
                    {/* Step 1 */}
                    <div className="wizard-step-card">
                      <div className="wizard-step-badge">1</div>
                      <div className="wizard-step-body">
                        <div className="step-body-header">
                          <strong>第一步：打开官方授权页登录并同意权限</strong>
                          <span className="step-body-hint">
                            新标签页若未自动打开，请点击下方快捷按钮直达：
                          </span>
                        </div>
                        <a
                          href={antigravityLoginState?.url || antigravityLoginState?.verificationUri || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="wizard-google-link-btn"
                          onClick={(e) => {
                            if (!antigravityLoginState?.url && !antigravityLoginState?.verificationUri) {
                              e.preventDefault();
                              void startAntigravityOAuthFlow();
                            }
                          }}
                        >
                          <span>前往 Google 官方授权页 (accounts.google.com)</span>
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="wizard-step-card">
                      <div className="wizard-step-badge">2</div>
                      <div className="wizard-step-body">
                        <div className="step-body-header">
                          <strong>第二步：粘贴 Authorization Code 并连接</strong>
                          <span className="step-body-hint">
                            授权完成后页面将展示授权码。复制后粘贴在下方（亦可直接粘贴地址栏完整 URL）：
                          </span>
                        </div>
                        <div className="wizard-input-group">
                          <input
                            type="text"
                            className="wizard-code-input"
                            placeholder="在此粘贴授权码 (如 4/0AY0e...) 或回调 URL"
                            value={antigravityAuthCodeInput}
                            onChange={(e) => setAntigravityAuthCodeInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                void handleAntigravityOAuthExchange();
                              }
                            }}
                            disabled={antigravityActionBusy === "exchange"}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="primary-button wizard-submit-btn"
                            disabled={!antigravityAuthCodeInput.trim() || antigravityActionBusy === "exchange"}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleAntigravityOAuthExchange();
                            }}
                          >
                            {antigravityActionBusy === "exchange" ? (
                              <>
                                <Loader2 size={15} className="animate-spin" />
                                <span>正在校验...</span>
                              </>
                            ) : (
                              <>
                                <Check size={15} />
                                <span>完成授权并连接</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Usage & Quota Cards */}
              {antigravityStatus?.usage ? (
                <div className="antigravity-stats-deck">
                  <div className="antigravity-stat-card card-today">
                    <div className="stat-card-icon">
                      <Activity size={18} />
                    </div>
                    <div className="stat-card-content">
                      <span className="stat-card-label">今日 Tokens 消耗</span>
                      <div className="stat-card-number highlight">
                        {(antigravityStatus.usage.todayTokensUsed ?? 0).toLocaleString()}
                      </div>
                      <span className="stat-card-footer">今日通过 Saki 对话与智能体产生的消耗</span>
                    </div>
                  </div>

                  <div className="antigravity-stat-card card-total">
                    <div className="stat-card-icon">
                      <Coins size={18} />
                    </div>
                    <div className="stat-card-content">
                      <span className="stat-card-label">累计 Tokens 消耗</span>
                      <div className="stat-card-number">
                        {(antigravityStatus.usage.totalTokensUsed ?? 0).toLocaleString()}
                      </div>
                      <span className="stat-card-footer">历史总计调用 {antigravityStatus.usage.totalRequests ?? 0} 次请求</span>
                    </div>
                  </div>

                  <div className="antigravity-stat-card card-quota">
                    <div className="stat-card-icon">
                      <ShieldCheck size={18} />
                    </div>
                    <div className="stat-card-content">
                      <div className="stat-card-header-row">
                        <span className="stat-card-label">反代配额与连通性</span>
                        {antigravityStatus.usage.tier ? (
                          <span className="stat-tier-badge">{antigravityStatus.usage.tier}</span>
                        ) : null}
                      </div>
                      <div className={`stat-card-number ${isAntigravityReady ? "accent" : (isPendingProxy ? "warning-text" : "")}`}>
                        {antigravityStatus.usage.proxyQuotaRemaining !== undefined
                          ? (typeof antigravityStatus.usage.proxyQuotaRemaining === "number"
                              ? antigravityStatus.usage.proxyQuotaRemaining.toLocaleString()
                              : antigravityStatus.usage.proxyQuotaRemaining)
                          : (isAntigravityReady
                              ? (isDirectMode ? "官方直连" : "正常在线")
                              : (isPendingProxy ? "反代离线 (8080)" : "未就绪"))}
                      </div>
                      <span className="stat-card-footer">
                        {antigravityStatus.usage.proxyQuotaLimit !== undefined
                          ? `配额上限: ${antigravityStatus.usage.proxyQuotaLimit.toLocaleString()}`
                          : (isAntigravityReady
                              ? (isDirectMode ? "端点: Google 官方 API" : `端点: ${antigravityStatus.endpoint || "http://localhost:8080/v1"}`)
                              : `未检测到端口 8080 监听服务`)}
                        {antigravityStatus.usage.expiresAt ? ` · 至 ${antigravityStatus.usage.expiresAt}` : ""}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Collapsible Connection Mode & Credentials Settings */}
              <div className="antigravity-advanced-section">
                <button
                  type="button"
                  className="advanced-toggle-button"
                  onClick={() => setAntigravityLoginModalOpen((prev) => !prev)}
                >
                  <div className="toggle-label-wrap">
                    <SlidersHorizontal size={14} />
                    <span>连接方式与凭据配置</span>
                    <span className="toggle-sublabel">本地反代网关 与 官方直连 (Gemini API Key) 二选一，两种方案的凭据互不混用</span>
                  </div>
                  <ChevronDown
                    size={15}
                    className="toggle-chevron"
                    style={{ transform: antigravityLoginModalOpen ? "rotate(180deg)" : "none" }}
                  />
                </button>

                {antigravityLoginModalOpen ? (
                  <div className="advanced-drawer-content">
                    {/* Mutually exclusive connection scheme selector */}
                    <div className="proxy-mode-tabs">
                      <button
                        type="button"
                        className={`proxy-mode-tab ${!isDirectMode ? "active" : ""}`}
                        onClick={() => switchAntigravityMode("proxy")}
                      >
                        本地反代网关
                      </button>
                      <button
                        type="button"
                        className={`proxy-mode-tab ${isDirectMode ? "active" : ""}`}
                        onClick={() => switchAntigravityMode("direct")}
                      >
                        官方直连 (Gemini API Key)
                      </button>
                    </div>

                    {!isDirectMode ? (
                      <>
                        <div className="settings-form-row">
                          <label className="settings-field">
                            <span className="settings-field-label">反代网关 Base URL</span>
                            <input
                              className="settings-input"
                              value={form.baseUrl}
                              onChange={(event) => {
                                updateActiveProviderConfig({ baseUrl: event.target.value });
                              }}
                              placeholder="http://localhost:8080/v1"
                            />
                            <span className="settings-field-hint">OpenAI 协议反向代理服务地址（默认 http://localhost:8080/v1）</span>
                          </label>

                          <label className="settings-field">
                            <span className="settings-field-label">反代 Bearer Token (可选)</span>
                            <div className="settings-input-with-action">
                              <input
                                className="settings-input"
                                type={showApiKey ? "text" : "password"}
                                value={form.apiKey}
                                onChange={(event) => {
                                  handleAntigravityApiKeyInput(event.target.value);
                                }}
                                placeholder="留空则优先使用已登录的 Google OAuth 凭据"
                              />
                              <button
                                type="button"
                                className="settings-inline-action-btn icon-only"
                                onClick={() => setShowApiKey((s) => !s)}
                                title={showApiKey ? "隐藏 Token" : "显示 Token"}
                              >
                                {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                            </div>
                            <span className="settings-field-hint">仅当反代网关要求鉴权时填写自定义 Bearer 令牌；填入 AIzaSy 开头的 Gemini Key 将自动切换为「官方直连」模式</span>
                          </label>
                        </div>

                        <div className="manual-token-card">
                          <div className="manual-token-header">
                            <KeyRound size={14} />
                            <strong>导入 Google OAuth 凭据（仅反代模式使用）</strong>
                          </div>
                          <div className="settings-field">
                            <textarea
                              id="antigravity-token-input"
                              className="settings-input antigravity-token-textarea"
                              rows={2}
                              placeholder="粘贴 Google OAuth 访问令牌 (ya29...) 或完整凭据 JSON"
                              value={antigravityTokenInput}
                              onChange={(e) => setAntigravityTokenInput(e.target.value)}
                              disabled={Boolean(antigravityActionBusy)}
                            />
                          </div>
                          <div className="manual-token-actions-row">
                            <input
                              type="text"
                              className="settings-input manual-email-input"
                              placeholder="账号邮箱备注（可选，OAuth 令牌将自动解析邮箱）"
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
                                e.stopPropagation();
                                void handleAntigravityLoginSubmit();
                              }}
                            >
                              {antigravityActionBusy === "login" ? (
                                <>
                                  <Loader2 size={13} className="animate-spin" />
                                  <span>验证中...</span>
                                </>
                              ) : (
                                <>
                                  <Check size={13} />
                                  <span>导入凭据并保存</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="settings-form-row">
                        <label className="settings-field">
                          <span className="settings-field-label">Gemini API Key</span>
                          <div className="settings-input-with-action">
                            <input
                              className="settings-input"
                              type={showApiKey ? "text" : "password"}
                              value={form.apiKey}
                              onChange={(event) => {
                                handleAntigravityApiKeyInput(event.target.value);
                              }}
                              placeholder="AIzaSy..."
                            />
                            <button
                              type="button"
                              className="settings-inline-action-btn icon-only"
                              onClick={() => setShowApiKey((s) => !s)}
                              title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                            >
                              {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                          <span className="settings-field-hint">
                            在 Google AI Studio 免费申请（AIzaSy 开头）；保存后 Saki 将直连官方端点 generativelanguage.googleapis.com，无需任何反代进程
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Integrated 3-Way Architectural Guide Cards */}
              <div className="antigravity-guides-deck">
                <div className={`guide-card ${!isDirectMode ? "recommended" : ""}`}>
                  <div className="guide-card-tag">本地反代网关 · OAuth 授权</div>
                  <div className="guide-card-title">
                    <Zap size={14} />
                    <span>Google 官方 OAuth 登录</span>
                  </div>
                  <p className="guide-card-text">
                    选择「本地反代网关」后，点击上方“登录 Google 账号”一键授权，OAuth 凭据将作为反代请求的认证令牌使用。
                  </p>
                </div>

                <div className={`guide-card ${isDirectMode ? "recommended" : ""}`}>
                  <div className="guide-card-tag">官方直连 · 免费</div>
                  <div className="guide-card-title">
                    <Globe size={14} />
                    <span>Google AI Studio API Key</span>
                  </div>
                  <p className="guide-card-text">
                    选择「官方直连 (Gemini API Key)」，填入在 <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer">Google AI Studio</a> 申请的 <code>AIzaSy</code> 开头 Key，即可免代理直连 Google 官方 API。
                  </p>
                </div>

                <div className="guide-card">
                  <div className="guide-card-tag">本地反代网关 · 自建代理</div>
                  <div className="guide-card-title">
                    <Server size={14} />
                    <span>本地反代网关服务</span>
                  </div>
                  <p className="guide-card-text">
                    在服务器本地启动 OpenAI 兼容反向代理服务（默认监听 <code>http://localhost:8080/v1</code>），在「本地反代网关」中配置 Base URL 与可选 Bearer Token。
                  </p>
                </div>
              </div>
            </div>
          );
        })() : null}

        {/* 模型消耗积分乘区设置 */}
        <div className="model-multipliers-card wide-field">
          <div className="model-multipliers-header">
            <div className="model-multipliers-title">
              <Coins size={18} className="settings-switch-icon" />
              <div>
                <strong>模型积分消耗乘区</strong>
                <span className="model-multipliers-subtitle">
                  配置每个 AI 模型的积分扣除倍率（换算规则：1000 Tokens = 1 积分 × 模型乘区倍率，向上取整）。
                </span>
              </div>
            </div>
            <div className="model-multipliers-header-right">
              <div className="model-multipliers-hint">
                <span>设为 <strong>0x</strong> 则该模型完全免费；未单独配置乘区的模型默认按 <strong>1.0x</strong> 计费。</span>
              </div>
              {combinedModelKeys.length > MULTIPLIERS_PER_PAGE ? (
                <div className="model-multipliers-search-box">
                  <Search size={14} className="multipliers-search-icon" />
                  <input
                    type="text"
                    className="settings-input mini multipliers-search-input"
                    placeholder="搜索乘区模型..."
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
              ) : null}
            </div>
          </div>

          <div className="model-multipliers-list">
            {paginatedMultipliers.length === 0 ? (
              <div className="model-multipliers-empty">
                <span>未找到与「{multipliersFilter}」匹配的模型</span>
              </div>
            ) : (
              paginatedMultipliers.map((modelKey) => {
                const currentMultiplier = form.modelPointsMultipliers?.[modelKey] ?? 1.0;
                const isCustom = form.modelPointsMultipliers?.[modelKey] !== undefined;
                const isCurrentActive = form.model === modelKey;

                return (
                  <div
                    key={modelKey}
                    className={`model-multiplier-item ${isCurrentActive ? "active-model" : ""}`}
                  >
                    <div className="model-multiplier-info">
                      <div className="model-name-row">
                        <span className="model-identifier">{modelKey}</span>
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

          {totalMultipliersPages > 1 ? (
            <div className="model-multipliers-pagination">
              <div className="multipliers-pagination-info">
                第 <strong>{safeMultipliersPage}</strong> / {totalMultipliersPages} 页 · 共 {filteredMultipliers.length} 个模型
              </div>
              <div className="multipliers-pagination-controls">
                <button
                  type="button"
                  className="multipliers-page-btn"
                  disabled={safeMultipliersPage <= 1}
                  onClick={() => setMultipliersPage((p) => Math.max(1, p - 1))}
                  title="上一页"
                >
                  <ChevronLeft size={15} />
                  <span>上一页</span>
                </button>

                <div className="multipliers-page-numbers">
                  {Array.from({ length: totalMultipliersPages }, (_, i) => i + 1)
                    .filter((p) => {
                      return p === 1 || p === totalMultipliersPages || Math.abs(p - safeMultipliersPage) <= 1;
                    })
                    .reduce<(number | string)[]>((acc, p, idx, arr) => {
                      if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) {
                        acc.push(`ellipsis-${p}`);
                      }
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item) => {
                      if (typeof item === "string") {
                        return <span key={item} className="multipliers-page-ellipsis">…</span>;
                      }
                      return (
                        <button
                          key={item}
                          type="button"
                          className={`multipliers-page-num ${safeMultipliersPage === item ? "active" : ""}`}
                          onClick={() => setMultipliersPage(item)}
                        >
                          {item}
                        </button>
                      );
                    })}
                </div>

                <button
                  type="button"
                  className="multipliers-page-btn"
                  disabled={safeMultipliersPage >= totalMultipliersPages}
                  onClick={() => setMultipliersPage((p) => Math.min(totalMultipliersPages, p + 1))}
                  title="下一页"
                >
                  <span>下一页</span>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          ) : null}

          {/* 添加自定义模型乘区 */}
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
              <Plus size={15} />
              <span>添加乘区</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
