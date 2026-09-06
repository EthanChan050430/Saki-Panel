import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  Bell,
  BookMarked,
  BookOpen,
  Bot,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Code2,
  Coins,
  Copy,
  Cpu,
  Download,
  DownloadCloud,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileArchive,
  FilePlus,
  FileSearch,
  FileText,
  FileUp,
  Folder,
  FolderArchive,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  Heart,
  History,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  List,
  Loader2,
  LogIn,
  LogOut,
  MemoryStick,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Move,
  Paintbrush,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal as TerminalIcon,
  TextQuote,
  Trash2,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  UserRound,
  UserX,
  Video,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Zap
} from "lucide-react";
import type {
  CreateSakiSkillRequest,
  CurrentUser,
  ManagedIngestToken,
  ManagedInstance,
  ManagedNotificationChannel,
  ManagedNotificationDelivery,
  NotificationChannelType,
  NotificationEventKind,
  PanelAppearanceSettings,
  RegistrationIdentity,
  SakiAntigravityAuthStatusResponse,
  SakiAntigravityExchangeRequest,
  SakiAntigravityLoginRequest,
  SakiAntigravityLoginUrlResponse,
  SakiAntigravityLogoutRequest,
  SakiAntigravitySwitchAccountRequest,
  SakiConfigResponse,
  SakiCopilotAuthStatusResponse,
  SakiCopilotLoginResponse,
  SakiModelOption,
  SakiProviderConfig,
  SakiSkillDetail,
  SakiSkillSummary,
  UpdateSakiConfigRequest,
  UpdateSakiSkillRequest
} from "@webops/shared";
import type { SakiSettingsSection } from "../types/app.js";
import { api, ApiError } from "../api.js";
import { panelLanguageOptions, type PanelLanguage, panelT, type PanelTextKey, usePanelT } from "../i18n/index.js";
import { defaultPanelAppearance, defaultSakiRequestTimeoutMs, sakiArtAssets } from "../constants.js";
import { appearanceFileToDataUrl, appearanceMediaFileToDataUrl } from "../components/common/AccountAvatar.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { formatDate } from "../utils/path.js";
import { isVideoSource, normalizePanelAppearance } from "../utils/appearance.js";
import { parseHashRoute, updateHashRoute } from "../utils/route.js";
import { PointsUsageModal } from "../PointsUsageModal.js";
import { AdminUserPointsModal } from "../AdminUserPointsModal.js";
import {
  getSakiVoiceEchoEngine,
  setSakiVoiceEchoEngine,
  checkWebGPUSupport,
  type SakiVoiceEchoEngineType,
  type WebGPUDetectionResult
} from "../components/saki/sakiVoiceEngine.js";

const emptySakiConfig: SakiConfigResponse = {
  requestTimeoutMs: defaultSakiRequestTimeoutMs,
  provider: "ollama",
  model: "llama3",
  ollamaUrl: "http://localhost:11434",
  baseUrl: "",
  apiKey: "",
  providerConfigs: {
    ollama: {
      model: "llama3",
      ollamaUrl: "http://localhost:11434"
    }
  },
  modelPointsMultipliers: {},
  searchEnabled: true,
  mcpEnabled: false,
  systemPrompt: "",
  appearance: defaultPanelAppearance,
  configPath: "",
  globalConfigPath: ""
};

const providerBaseUrlDefaults: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  antigravity: "http://localhost:8080/v1",
  minimax: "https://api.minimaxi.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  tongyi: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  custom: ""
};

const localProviderUrlDefaults = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234"
};

const modelProviderOptions = [
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "antigravity", label: "Antigravity CLI" },
  { value: "openai", label: "OpenAI Compatible" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "zhipu", label: "Zhipu" },
  { value: "gemini", label: "Gemini" },
  { value: "minimax", label: "MiniMax" },
  { value: "anthropic", label: "Anthropic" },
  { value: "moonshot", label: "Moonshot" },
  { value: "tongyi", label: "通义千问" },
  { value: "doubao", label: "豆包" },
  { value: "custom", label: "Custom" }
];

function isLocalProvider(provider: string): boolean {
  return provider === "ollama" || provider === "lmstudio";
}

function needsCloudApiFields(provider: string): boolean {
  return !isLocalProvider(provider) && provider !== "copilot" && provider !== "antigravity";
}

type AntigravityMode = "proxy" | "direct";

/**
 * Effective antigravity connection scheme: explicit `mode` wins; for legacy
 * configs without a mode, an AIzaSy-prefixed key implies "direct".
 */
function antigravityModeOf(config?: SakiProviderConfig): AntigravityMode {
  if (config?.mode === "proxy" || config?.mode === "direct") return config.mode;
  return (config?.apiKey ?? "").trim().startsWith("AIzaSy") ? "direct" : "proxy";
}

function defaultProviderConfig(provider: string): SakiProviderConfig {
  if (provider === "ollama") {
    return {
      model: "llama3",
      ollamaUrl: localProviderUrlDefaults.ollama
    };
  }
  if (provider === "lmstudio") {
    return {
      model: "",
      ollamaUrl: localProviderUrlDefaults.lmstudio
    };
  }
  return {
    model: "",
    baseUrl: providerBaseUrlDefaults[provider] ?? "",
    apiKey: ""
  };
}

function providerConfigFromForm(form: SakiConfigResponse, provider: string): SakiProviderConfig {
  return {
    ...defaultProviderConfig(provider),
    ...(form.providerConfigs?.[provider] ?? {})
  };
}

interface SakiSkillDraft {
  name: string;
  description: string;
  tags: string;
  content: string;
  enabled: boolean;
}

const emptySakiSkillDraft: SakiSkillDraft = {
  name: "",
  description: "",
  tags: "",
  content: "",
  enabled: true
};

function parseSakiSkillTags(value: string): string[] {
  return value
    .split(/[,，;；\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function sakiSkillDraftFromDetail(skill: SakiSkillDetail): SakiSkillDraft {
  return {
    name: skill.name,
    description: skill.description ?? "",
    tags: skill.tags?.join(", ") ?? "",
    content: skill.content,
    enabled: skill.enabled !== false
  };
}

function formatSessionTimeoutMinutes(value: number): string {
  return Number.isFinite(value) ? String(value) : "120";
}

function parseSessionTimeoutMinutesDraft(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!trimmed || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error("登录超时时间必须是大于或等于 0 的数字。");
  }
  return Number(parsed.toFixed(3));
}
const registrationIdentityOptions: Array<{ value: RegistrationIdentity; label: string }> = [
  { value: "none", label: "无角色" },
  { value: "user", label: "用户" },
  { value: "admin", label: "管理员" },
  { value: "super_admin", label: "超级管理员" }
];

const watchChannelTypeLabels: Record<NotificationChannelType, string> = {
  webhook: "通用 Webhook",
  dingtalk: "钉钉",
  wecom: "企业微信",
  telegram: "Telegram"
};

const watchEventKindOptions: Array<{ value: NotificationEventKind; label: string }> = [
  { value: "opened", label: "新事件" },
  { value: "awaiting", label: "等待批准" },
  { value: "resolved", label: "已恢复" },
  { value: "failed", label: "失败/回滚" },
  { value: "escalation", label: "升级提醒" }
];

function watchEventKindLabel(kind: string): string {
  return watchEventKindOptions.find((option) => option.value === kind)?.label ?? kind;
}

function watchChannelSecretHint(type: NotificationChannelType): string {
  if (type === "dingtalk") return "钉钉机器人加签 Secret，未开启加签可留空";
  if (type === "telegram") return "Telegram Bot 的 chat_id";
  return "一般可留空";
}

function maskIngestToken(token: string): string {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 6)}••••${token.slice(-4)}`;
}

interface WatchChannelDraft {
  name: string;
  type: NotificationChannelType;
  url: string;
  secret: string;
  events: NotificationEventKind[];
}

const emptyWatchChannelDraft: WatchChannelDraft = {
  name: "",
  type: "webhook",
  url: "",
  secret: "",
  events: ["opened", "awaiting", "resolved", "failed", "escalation"]
};

function WatchNotifyPanel({
  token,
  onLogout,
  refreshTick
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
}) {
  const [channels, setChannels] = useState<ManagedNotificationChannel[]>([]);
  const [deliveries, setDeliveries] = useState<ManagedNotificationDelivery[]>([]);
  const [ingestTokenList, setIngestTokenList] = useState<ManagedIngestToken[]>([]);
  const [watchInstances, setWatchInstances] = useState<ManagedInstance[]>([]);
  const [watchLoading, setWatchLoading] = useState(true);
  const [watchError, setWatchError] = useState("");
  const [watchNotice, setWatchNotice] = useState("");
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
  const [channelDraft, setChannelDraft] = useState<WatchChannelDraft>(emptyWatchChannelDraft);
  const [ingestDraft, setIngestDraft] = useState({ instanceId: "", label: "" });
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const refreshWatch = useCallback(async () => {
    setWatchError("");
    setWatchLoading(true);
    try {
      const [channelResult, deliveryResult, ingestResult, instanceList] = await Promise.all([
        api.notificationChannels(token),
        api.notificationDeliveries(token, 20),
        api.ingestTokens(token),
        api.instances(token)
      ]);
      setChannels(channelResult.channels);
      setDeliveries(deliveryResult.deliveries);
      setIngestTokenList(ingestResult.tokens);
      setWatchInstances(instanceList);
      setIngestDraft((current) => ({
        ...current,
        instanceId: current.instanceId || instanceList[0]?.id || ""
      }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setWatchError(err instanceof Error ? err.message : "值班通知配置加载失败");
    } finally {
      setWatchLoading(false);
    }
  }, [onLogout, token]);

  useEffect(() => {
    void refreshWatch();
  }, [refreshWatch, refreshTick]);

  async function toggleChannelEnabled(channel: ManagedNotificationChannel) {
    setWatchError("");
    setWatchBusy(`toggle-${channel.id}`);
    try {
      const updated = await api.updateNotificationChannel(token, channel.id, { enabled: !channel.enabled });
      setChannels((current) => current.map((item) => (item.id === channel.id ? updated : item)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setWatchError(err instanceof Error ? err.message : "渠道状态更新失败");
    } finally {
      setWatchBusy(null);
    }
  }

  async function testChannel(channel: ManagedNotificationChannel) {
    setWatchError("");
    setWatchBusy(`test-${channel.id}`);
    try {
      const result = await api.testNotificationChannel(token, channel.id);
      setTestResults((current) => ({
        ...current,
        [channel.id]: result.error ? { ok: result.ok, error: result.error } : { ok: result.ok }
      }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setTestResults((current) => ({
        ...current,
        [channel.id]: { ok: false, error: err instanceof Error ? err.message : "测试发送失败" }
      }));
    } finally {
      setWatchBusy(null);
    }
  }

  async function deleteChannel(channel: ManagedNotificationChannel) {
    if (!window.confirm(`确定删除通知渠道「${channel.name}」吗？订阅了该渠道的实例将不再收到推送。`)) return;
    setWatchError("");
    setWatchBusy(`delete-${channel.id}`);
    try {
      await api.deleteNotificationChannel(token, channel.id);
      setChannels((current) => current.filter((item) => item.id !== channel.id));
      setWatchNotice(`通知渠道「${channel.name}」已删除`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setWatchError(err instanceof Error ? err.message : "删除通知渠道失败");
    } finally {
      setWatchBusy(null);
    }
  }

  async function createChannel() {
    const name = channelDraft.name.trim();
    const url = channelDraft.url.trim();
    if (!name || !url) {
      setWatchError("请填写渠道名称与 Webhook 地址");
      return;
    }
    if (channelDraft.events.length === 0) {
      setWatchError("请至少选择一个通知事件");
      return;
    }
    setWatchError("");
    setWatchNotice("");
    setWatchBusy("create-channel");
    try {
      const secret = channelDraft.secret.trim();
      const created = await api.createNotificationChannel(token, {
        name,
        type: channelDraft.type,
        url,
        secret: secret || null,
        enabled: true,
        events: channelDraft.events
      });
      setChannels((current) => [...current, created]);
      setChannelDraft(emptyWatchChannelDraft);
      setWatchNotice(`通知渠道「${created.name}」已创建`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setWatchError(err instanceof Error ? err.message : "创建通知渠道失败");
    } finally {
      setWatchBusy(null);
    }
  }

  async function createIngest() {
    if (!ingestDraft.instanceId) {
      setWatchError("请选择要接入告警的实例");
      return;
    }
    setWatchError("");
    setWatchNotice("");
    setWatchBusy("create-ingest");
    try {
      const label = ingestDraft.label.trim();
      const created = await api.createIngestToken(token, {
        instanceId: ingestDraft.instanceId,
        ...(label ? { label } : {})
      });
      setIngestTokenList((current) => [...current, created]);
      setIngestDraft((current) => ({ ...current, label: "" }));
      setWatchNotice(`接入口令「${created.label}」已创建`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setWatchError(err instanceof Error ? err.message : "创建接入口令失败");
    } finally {
      setWatchBusy(null);
    }
  }

  async function deleteIngest(item: ManagedIngestToken) {
    if (!window.confirm(`确定删除接入口令「${item.label}」吗？使用该口令的告警推送将立即失效。`)) return;
    setWatchError("");
    setWatchBusy(`delete-ingest-${item.id}`);
    try {
      await api.deleteIngestToken(token, item.id);
      setIngestTokenList((current) => current.filter((entry) => entry.id !== item.id));
      setWatchNotice(`接入口令「${item.label}」已删除`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setWatchError(err instanceof Error ? err.message : "删除接入口令失败");
    } finally {
      setWatchBusy(null);
    }
  }

  async function copyWatchText(text: string, okMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setWatchNotice(okMessage);
    } catch {
      setWatchError("复制失败，请手动选择复制");
    }
  }

  function truncateWatchUrl(url: string, maxLength = 48): string {
    return url.length > maxLength ? `${url.slice(0, maxLength)}…` : url;
  }

  return (
    <div className="settings-watch-page">
      {watchNotice ? <div className="page-notice">{watchNotice}</div> : null}
      {watchError ? (
        <div className="proxy-sub-error-badge" style={{ marginBottom: "1rem" }}>
          <AlertTriangle size={14} />
          <span>{watchError}</span>
        </div>
      ) : null}

      {/* 通知渠道 */}
      <div className="panel-block watch-notify-block">
        <div className="section-heading">
          <h2>通知渠道</h2>
          <span>{watchLoading ? "载入中" : `${channels.length} 个渠道`}</span>
        </div>

        <div className="watch-channel-list">
          {channels.map((channel) => {
            const testResult = testResults[channel.id];
            return (
              <div className={`watch-channel-row ${channel.enabled ? "" : "disabled"}`} key={channel.id}>
                <div className="watch-channel-main">
                  <div className="watch-channel-title">
                    <strong>{channel.name}</strong>
                    <span className="watch-channel-type-badge">{watchChannelTypeLabels[channel.type]}</span>
                    {!channel.enabled ? <span className="watch-channel-off-badge">已停用</span> : null}
                  </div>
                  <span className="watch-channel-url" title={channel.url}>
                    {truncateWatchUrl(channel.url)}
                  </span>
                  <div className="watch-channel-events">
                    {channel.events.map((eventKind) => (
                      <span className="watch-event-chip" key={eventKind}>
                        {watchEventKindLabel(eventKind)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="watch-channel-actions">
                  {testResult ? (
                    <span
                      className={`watch-test-result ${testResult.ok ? "ok" : "fail"}`}
                      title={testResult.error || undefined}
                    >
                      {testResult.ok ? "测试成功" : `测试失败${testResult.error ? `：${testResult.error}` : ""}`}
                    </span>
                  ) : null}
                  <button
                    className="ghost-button mini"
                    type="button"
                    disabled={watchBusy === `toggle-${channel.id}`}
                    title={channel.enabled ? "停用该渠道" : "启用该渠道"}
                    onClick={() => void toggleChannelEnabled(channel)}
                  >
                    {channel.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                    <span>{channel.enabled ? "停用" : "启用"}</span>
                  </button>
                  <button
                    className="ghost-button mini"
                    type="button"
                    disabled={watchBusy === `test-${channel.id}`}
                    title="发送一条测试通知"
                    onClick={() => void testChannel(channel)}
                  >
                    {watchBusy === `test-${channel.id}` ? <Loader2 size={14} className="spinner" /> : <Send size={14} />}
                    <span>测试</span>
                  </button>
                  <button
                    className="icon-button action-delete"
                    type="button"
                    disabled={watchBusy === `delete-${channel.id}`}
                    title="删除渠道"
                    onClick={() => void deleteChannel(channel)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {!watchLoading && channels.length === 0 ? (
            <div className="watch-empty-hint">暂无通知渠道，添加后可在实例值班策略中订阅事件推送</div>
          ) : null}
        </div>

        <div className="watch-channel-form">
          <div className="watch-form-title">
            <Plus size={15} />
            <span>添加通知渠道</span>
          </div>
          <div className="watch-form-grid">
            <label>
              <span>名称</span>
              <input
                value={channelDraft.name}
                onChange={(e) => setChannelDraft((current) => ({ ...current, name: e.target.value }))}
                placeholder="例如：运维群钉钉机器人"
              />
            </label>
            <label>
              <span>类型</span>
              <select
                value={channelDraft.type}
                onChange={(e) =>
                  setChannelDraft((current) => ({ ...current, type: e.target.value as NotificationChannelType }))
                }
              >
                <option value="webhook">通用 Webhook</option>
                <option value="dingtalk">钉钉</option>
                <option value="wecom">企业微信</option>
                <option value="telegram">Telegram</option>
              </select>
            </label>
            <label className="watch-form-wide">
              <span>Webhook 地址</span>
              <input
                value={channelDraft.url}
                onChange={(e) => setChannelDraft((current) => ({ ...current, url: e.target.value }))}
                placeholder="https://…"
              />
            </label>
            <label className="watch-form-wide">
              <span>Secret (可选)</span>
              <input
                type="password"
                value={channelDraft.secret}
                onChange={(e) => setChannelDraft((current) => ({ ...current, secret: e.target.value }))}
                placeholder={watchChannelSecretHint(channelDraft.type)}
              />
              <small className="watch-field-hint">{watchChannelSecretHint(channelDraft.type)}</small>
            </label>
            <div className="watch-form-wide">
              <span className="watch-events-label">订阅事件</span>
              <div className="watch-events-options">
                {watchEventKindOptions.map((option) => (
                  <label className="watch-event-option" key={option.value}>
                    <input
                      type="checkbox"
                      checked={channelDraft.events.includes(option.value)}
                      onChange={(e) =>
                        setChannelDraft((current) => ({
                          ...current,
                          events: e.target.checked
                            ? [...current.events, option.value]
                            : current.events.filter((kind) => kind !== option.value)
                        }))
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="watch-form-actions">
            <button
              className="primary-button"
              type="button"
              disabled={watchBusy === "create-channel"}
              onClick={() => void createChannel()}
            >
              {watchBusy === "create-channel" ? <Loader2 size={15} className="spinner" /> : <Plus size={15} />}
              <span>添加渠道</span>
            </button>
          </div>
        </div>

        <div className="watch-deliveries">
          <div className="watch-form-title">
            <History size={15} />
            <span>最近发送记录</span>
          </div>
          {deliveries.length > 0 ? (
            <div className="watch-delivery-list">
              {deliveries.map((delivery) => {
                const delivered = ["success", "delivered", "ok"].includes(delivery.status);
                return (
                  <div className="watch-delivery-row" key={delivery.id}>
                    <time>{formatDate(delivery.createdAt)}</time>
                    <span className="watch-delivery-channel">{delivery.channelName || delivery.channelId}</span>
                    <span className="watch-event-chip">{watchEventKindLabel(delivery.kind)}</span>
                    <span
                      className={`watch-delivery-status ${delivered ? "ok" : "fail"}`}
                      title={delivery.error || undefined}
                    >
                      {delivered ? "成功" : "失败"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="watch-empty-hint">暂无发送记录</div>
          )}
        </div>
      </div>

      {/* 告警接入口令 */}
      <div className="panel-block watch-ingest-block">
        <div className="section-heading">
          <h2>告警接入口令</h2>
          <span>{watchLoading ? "载入中" : `${ingestTokenList.length} 个口令`}</span>
        </div>
        <p className="watch-ingest-hint">
          支持通用 JSON 与 Prometheus Alertmanager 格式，将监控系统告警接入 Saki 值班。
        </p>

        <div className="watch-ingest-list">
          {ingestTokenList.map((item) => {
            const ingestUrl = `${window.location.origin}/api/ingest/incidents/${item.token}`;
            return (
              <div className="watch-ingest-row" key={item.id}>
                <div className="watch-ingest-main">
                  <div className="watch-ingest-title">
                    <strong>{item.label}</strong>
                    <span className="watch-ingest-instance">{item.instanceName || item.instanceId}</span>
                  </div>
                  <div className="watch-ingest-token-line">
                    <code title={item.token}>{maskIngestToken(item.token)}</code>
                    <button
                      className="ghost-button mini"
                      type="button"
                      title="复制完整口令"
                      onClick={() => void copyWatchText(item.token, "口令已复制到剪贴板")}
                    >
                      <Copy size={13} />
                      <span>复制</span>
                    </button>
                  </div>
                  <div className="watch-ingest-url-line">
                    <code title={ingestUrl}>{ingestUrl}</code>
                    <button
                      className="ghost-button mini"
                      type="button"
                      title="复制完整接入地址"
                      onClick={() => void copyWatchText(ingestUrl, "接入地址已复制到剪贴板")}
                    >
                      <Copy size={13} />
                      <span>复制地址</span>
                    </button>
                  </div>
                  <span className="watch-ingest-meta">
                    创建于 {formatDate(item.createdAt)} · 最近使用 {item.lastUsedAt ? formatDate(item.lastUsedAt) : "从未使用"}
                  </span>
                </div>
                <button
                  className="icon-button action-delete"
                  type="button"
                  disabled={watchBusy === `delete-ingest-${item.id}`}
                  title="删除口令"
                  onClick={() => void deleteIngest(item)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {!watchLoading && ingestTokenList.length === 0 ? (
            <div className="watch-empty-hint">暂无接入口令，创建后将外部监控系统的告警推送到对应实例</div>
          ) : null}
        </div>

        <div className="watch-channel-form">
          <div className="watch-form-title">
            <KeyRound size={15} />
            <span>创建接入口令</span>
          </div>
          <div className="watch-form-grid">
            <label>
              <span>目标实例</span>
              <select
                value={ingestDraft.instanceId}
                onChange={(e) => setIngestDraft((current) => ({ ...current, instanceId: e.target.value }))}
              >
                {watchInstances.length === 0 ? <option value="">暂无实例</option> : null}
                {watchInstances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>备注名称</span>
              <input
                value={ingestDraft.label}
                onChange={(e) => setIngestDraft((current) => ({ ...current, label: e.target.value }))}
                placeholder="例如：Prometheus 生产环境"
              />
            </label>
          </div>
          <div className="watch-form-actions">
            <button
              className="primary-button"
              type="button"
              disabled={watchBusy === "create-ingest" || watchInstances.length === 0}
              onClick={() => void createIngest()}
            >
              {watchBusy === "create-ingest" ? <Loader2 size={15} className="spinner" /> : <Plus size={15} />}
              <span>创建口令</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [skillCreatorOpen, setSkillCreatorOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SakiSkillDetail | null>(null);
  const [skillEditDraft, setSkillEditDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [skillDownloadUrl, setSkillDownloadUrl] = useState("");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "enabled" | "disabled">("all");
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
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const skillDetailRequestRef = useRef(0);
  const appLogoInputRef = useRef<HTMLInputElement>(null);
  const sidebarLogoInputRef = useRef<HTMLInputElement>(null);
  const loginCoverInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const mobileBackgroundInputRef = useRef<HTMLInputElement>(null);
  const darkBackgroundInputRef = useRef<HTMLInputElement>(null);
  const mobileDarkBackgroundInputRef = useRef<HTMLInputElement>(null);
  const [bgThemeTab, setBgThemeTab] = useState<"light" | "dark" | "all">(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
  );
  const skillImportInputRef = useRef<HTMLInputElement>(null);
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
      // 与后端 defaultAntigravityModels 保持一致：仅作为实时同步失败时的兜底，
      // gemini-3-flash 上游已下线，当前 flash 模型为 gemini-3.8-flash。
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
      // gemini-3-flash 上游已下线：加载时把存量的过期模型名升级为当前 flash 模型，
      // 避免设置页/聊天继续拿旧 id 请求导致 404。
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
  }, [onAppearanceChange, onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  function withActiveProviderConfig(current: SakiConfigResponse, patch: SakiProviderConfig): SakiConfigResponse {
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

  function updateActiveProviderConfig(patch: SakiProviderConfig) {
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
    // Antigravity: persist an explicit, unambiguous mode and never let the two
    // connection schemes' credentials coexist in the saved config.
    const antigravityConfig = providerConfigs.antigravity ? { ...providerConfigs.antigravity } : undefined;
    if (antigravityConfig) {
      let mode = antigravityModeOf(antigravityConfig);
      // 用户填入 AIzaSy 开头的 Gemini Key，意图就是官方直连：
      // 该 Key 绝不会发往反代端点，这里直接提升为直连模式（而不是静默清除）。
      if (mode === "proxy" && (antigravityConfig.apiKey ?? "").trim().startsWith("AIzaSy")) {
        mode = "direct";
      }
      antigravityConfig.mode = mode;
      if (mode === "direct") {
        // 官方直连：不保存反代 Base URL（后端始终使用 Google 官方端点）
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
      // 用户意图明显：Gemini Key = 官方直连。自动切换模式并保留 Key，
      // 而不是把它当反代 token 在保存时静默清掉。
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
        // 切换连接方式时清空 apiKey，两种方案的凭据绝不混用
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
        // antigravity 为当前激活服务商，保持顶层镜像字段同步
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

  async function refreshSkillList() {
    const nextSkills = await api.sakiAllSkills(token);
    setSkillList(nextSkills);
    if (selectedSkillId && !nextSkills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(null);
      setSelectedSkill(null);
      setSkillEditDraft(emptySakiSkillDraft);
    }
  }

  async function createSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = skillDraft.name.trim();
    let content = skillDraft.content.trim();
    if (!name) {
      setError("请输入 Skill 名称。");
      setNotice("");
      return;
    }
    if (!content) {
      content = `# ${name}\n\n${skillDraft.description.trim() || "Custom Saki Skill instructions"}`;
    }
    const payload: CreateSakiSkillRequest = {
      name,
      description: skillDraft.description.trim(),
      content,
      tags: parseSakiSkillTags(skillDraft.tags),
      enabled: skillDraft.enabled
    };
    setSkillBusy("create");
    setError("");
    setNotice("");
    try {
      const skill = await api.createSakiSkill(token, payload);
      skillDetailRequestRef.current += 1;
      setSkillDraft(emptySakiSkillDraft);
      setSkillCreatorOpen(false);
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      setNotice(`Skill ${skill.name} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill save failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function downloadSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = skillDownloadUrl.trim();
    if (!url) {
      setError("OpenClaw Skill URL is required.");
      setNotice("");
      return;
    }
    setSkillBusy("download");
    setError("");
    setNotice("");
    try {
      const skill = await api.downloadSakiSkill(token, { url, enabled: true });
      skillDetailRequestRef.current += 1;
      setSkillDownloadUrl("");
      setSkillCreatorOpen(false);
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      setNotice(`Downloaded ${skill.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill download failed");
    } finally {
      setSkillBusy(null);
    }
  }

  function extractSkillNameFromFile(fileName: string): string {
    const withoutExt = fileName.replace(/\.(md|markdown|txt)$/i, "");
    const cleaned = withoutExt.replace(/[_\s-]+/g, "-").trim();
    return cleaned || "imported-skill";
  }

  function extractSkillDescription(content: string): string {
    const lines = content.split(/\r?\n/);
    let description = "";
    let inBody = false;
    for (const line of lines) {
      if (!inBody) {
        if (/^---\s*$/.test(line)) {
          inBody = true;
          continue;
        }
        const m = line.match(/^description\s*:\s*(.+)$/i);
        if (m && m[1]) {
          description = m[1].trim().replace(/^["']|["']$/g, "");
        }
      } else {
        if (/^#\s+/.test(line)) continue;
        const trimmed = line.trim();
        if (trimmed && trimmed.length >= 8) {
          description = trimmed.slice(0, 160);
          break;
        }
      }
    }
    return description;
  }

  async function importSkillsFromFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setSkillBusy("import");
    setError("");
    setNotice("");
    const results: string[] = [];
    const errors: string[] = [];
    try {
      for (const file of Array.from(fileList)) {
        const name = file.name.toLowerCase();
        if (!/\.(md|markdown|txt)$/.test(name)) {
          errors.push(`${file.name}: 仅支持 .md / .txt 文件`);
          continue;
        }
        const content = await file.text();
        const trimmed = content.trim();
        if (!trimmed) {
          errors.push(`${file.name}: 文件为空`);
          continue;
        }
        const skillName = extractSkillNameFromFile(file.name);
        const description = extractSkillDescription(trimmed);
        const payload: CreateSakiSkillRequest = {
          name: skillName,
          description,
          content: trimmed,
          enabled: true,
          tags: ["imported"]
        };
        try {
          const created = await api.createSakiSkill(token, payload);
          results.push(created.name);
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : "保存失败"}`);
        }
      }
      skillDetailRequestRef.current += 1;
      await refreshSkillList();
      if (results.length > 0) {
        setNotice(`已导入 ${results.length} 个 Skill：${results.slice(0, 3).join(", ")}${results.length > 3 ? ` 等` : ""}`);
        const last = results[results.length - 1];
        const lastDetail = await api.sakiAllSkills(token);
        const match = lastDetail.find((s) => s.name === last);
        if (match) {
          setSkillDetailLoading(false);
          setSelectedSkillId(match.id);
          const detail = await api.sakiSkill(token, match.id);
          setSelectedSkill(detail);
          setSkillEditDraft(sakiSkillDraftFromDetail(detail));
        }
      }
      if (errors.length > 0) {
        setError(errors.join("；"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setSkillBusy(null);
      if (skillImportInputRef.current) {
        skillImportInputRef.current.value = "";
      }
    }
  }

  async function selectSkill(skill: SakiSkillSummary) {
    const requestId = skillDetailRequestRef.current + 1;
    skillDetailRequestRef.current = requestId;
    setSkillCreatorOpen(false);
    setSelectedSkillId(skill.id);
    setSelectedSkill(null);
    setSkillEditDraft(emptySakiSkillDraft);
    setSkillDetailLoading(true);
    setError("");
    setNotice("");
    try {
      const detail = await api.sakiSkill(token, skill.id);
      if (skillDetailRequestRef.current !== requestId) return;
      setSelectedSkill(detail);
      setSkillEditDraft(sakiSkillDraftFromDetail(detail));
    } catch (err) {
      if (skillDetailRequestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Skill load failed");
    } finally {
      if (skillDetailRequestRef.current === requestId) {
        setSkillDetailLoading(false);
      }
    }
  }

  async function saveSelectedSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSkill) return;
    const name = skillEditDraft.name.trim();
    const content = skillEditDraft.content.trim();
    if (!name || !content) {
      setError("Skill name and content are required.");
      setNotice("");
      return;
    }
    const payload: UpdateSakiSkillRequest = {
      name,
      description: skillEditDraft.description.trim(),
      content,
      tags: parseSakiSkillTags(skillEditDraft.tags),
      enabled: skillEditDraft.enabled
    };
    setSkillBusy(selectedSkill.id);
    setError("");
    setNotice("");
    try {
      const skill = await api.updateSakiSkill(token, selectedSkill.id, payload);
      skillDetailRequestRef.current += 1;
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      setNotice(`Skill ${skill.name} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill update failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function toggleSkillEnabled(skill: SakiSkillSummary) {
    const patch: UpdateSakiSkillRequest = { enabled: skill.enabled === false };
    setSkillBusy(skill.id);
    setError("");
    setNotice("");
    try {
      const updatedSkill = await api.updateSakiSkill(token, skill.id, patch);
      if (selectedSkill?.id === skill.id) {
        setSelectedSkill(updatedSkill);
        setSkillEditDraft(sakiSkillDraftFromDetail(updatedSkill));
      }
      await refreshSkillList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill update failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function deleteSkill(skill: SakiSkillSummary) {
    if (skill.builtin) {
      await toggleSkillEnabled(skill);
      return;
    }
    if (!window.confirm(`Delete Skill "${skill.name}"?`)) return;
    setSkillBusy(skill.id);
    setError("");
    setNotice("");
    try {
      await api.deleteSakiSkill(token, skill.id);
      if (selectedSkill?.id === skill.id) {
        skillDetailRequestRef.current += 1;
        setSkillDetailLoading(false);
        setSelectedSkillId(null);
        setSelectedSkill(null);
        setSkillEditDraft(emptySakiSkillDraft);
      }
      await refreshSkillList();
      setNotice(`Deleted ${skill.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill delete failed");
    } finally {
      setSkillBusy(null);
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
        {/* Hidden file inputs placed outside the grid to avoid becoming unintended grid items */}
        <input
          ref={appLogoInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => void chooseAppearanceImage("appLogoSrc", event)}
        />
        <input
          ref={sidebarLogoInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => void chooseAppearanceImage("sidebarLogoSrc", event)}
        />
        <input
          ref={loginCoverInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => void chooseAppearanceImage("loginCoverSrc", event)}
        />
        <input
          ref={backgroundInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/ogg"
          onChange={(event) => void chooseAppearanceMedia("backgroundSrc", event, true)}
        />
        <input
          ref={mobileBackgroundInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/ogg"
          onChange={(event) => void chooseAppearanceMedia("mobileBackgroundSrc", event, true)}
        />
        <input
          ref={darkBackgroundInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/ogg"
          onChange={(event) => void chooseAppearanceMedia("darkBackgroundSrc", event, true)}
        />
        <input
          ref={mobileDarkBackgroundInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/ogg"
          onChange={(event) => void chooseAppearanceMedia("mobileDarkBackgroundSrc", event, true)}
        />
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
          ) : activeSettingsSection !== "skills" ? (
          <form className="settings-config-form" onSubmit={(event) => void saveSettings(event)}>
            {/* System & Security */}
            <div className={`settings-group ${activeSettingsSection === "system" ? "active" : "settings-section-hidden"}`} id="settings-system">
              <div className="settings-group-title">
                <div className="settings-group-icon"><Settings size={20} /></div>
                <div>
                  <h3>{t("settings.system")}</h3>
                  <span>{t("settings.system.detail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <div className="settings-form-row">
                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.language")}</span>
                    <select
                      className="settings-select"
                      value={language}
                      onChange={(event) => onLanguageChange(event.target.value as PanelLanguage)}
                    >
                      {panelLanguageOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.registrationIdentity")}</span>
                    <select
                      className="settings-select"
                      value={registrationIdentity}
                      onChange={(event) => setRegistrationIdentity(event.target.value as RegistrationIdentity)}
                    >
                      {localizedRegistrationIdentityOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="settings-form-row">
                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.sessionTimeout")}</span>
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={0.1}
                      value={sessionTimeoutMinutes}
                      onChange={(event) => setSessionTimeoutMinutes(event.target.value)}
                      placeholder={t("settings.sessionTimeout.placeholder")}
                    />
                    <span className="settings-field-hint">单位：分钟。设为 0 表示不自动过期。</span>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.requestTimeout")}</span>
                    <input
                      className="settings-input"
                      type="number"
                      min={5000}
                      max={600000}
                      step={1000}
                      value={form.requestTimeoutMs}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, requestTimeoutMs: Number(event.target.value) || defaultSakiRequestTimeoutMs }))
                      }
                      placeholder="60000"
                    />
                    <span className="settings-field-hint">单位：毫秒（建议 30000 ~ 120000）。</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Model Engine */}
            <div className={`settings-group ${activeSettingsSection === "model" ? "active" : "settings-section-hidden"}`} id="settings-model">
              <div className="settings-group-title">
                <div className="settings-group-icon"><Cpu size={20} /></div>
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span className="settings-field-label" style={{ marginBottom: 0 }}>模型名称 (Model)</span>
                      {modelOptions.length > 0 ? (
                        <button
                          type="button"
                          className="settings-text-btn"
                          style={{ fontSize: 12, background: "none", border: "none", color: "var(--accent-color, #3b82f6)", cursor: "pointer", padding: "0 2px" }}
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
                          placeholder={form.provider === "ollama" ? "llama3" : "例如 gemini-3.8-flash、gemini-2.5-pro 等"}
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
                    <span className="settings-field-label">{form.provider === "lmstudio" ? "LM Studio URL" : "Ollama 服务地址"}</span>
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

                    {/* Notice banner when user is logged in with Google OAuth but proxy endpoint (e.g. 8080) is not listening */}
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
                ); })() : null}

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
                    <div className="model-multipliers-hint">
                      <span>设为 <strong>0x</strong> 则该模型完全免费；未单独配置乘区的模型默认按 <strong>1.0x</strong> 计费。</span>
                    </div>
                  </div>

                  <div className="model-multipliers-list">
                    {combinedModelKeys.map((modelKey) => {
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
                    })}
                  </div>

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

            {/* Smart Features */}
            <div className={`settings-group ${activeSettingsSection === "features" ? "active" : "settings-section-hidden"}`} id="settings-features">
              <div className="settings-group-title">
                <div className="settings-group-icon"><Wrench size={20} /></div>
                <div>
                  <h3>{t("settings.features")}</h3>
                  <span>{t("settings.features.detail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <div className="settings-switch-card">
                  <div className="settings-switch-info">
                    <div className="settings-switch-title">
                      <Globe size={18} className="settings-switch-icon" />
                      <strong>联网搜索与网页内容提取</strong>
                    </div>
                    <span>允许 Saki 在回答技术问题或排查故障时自主检索最新互联网资料与官方文档。</span>
                  </div>
                  <label className="settings-switch-toggle">
                    <input
                      type="checkbox"
                      checked={form.searchEnabled ?? false}
                      onChange={(event) => setForm((current) => ({ ...current, searchEnabled: event.target.checked }))}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                <div className="settings-switch-card">
                  <div className="settings-switch-info">
                    <div className="settings-switch-title">
                      <Zap size={18} className="settings-switch-icon" />
                      <strong>Model Context Protocol (MCP)</strong>
                    </div>
                    <span>启用标准化 MCP 扩展工具与外部上下文集成协议，为 Saki 提供深度工具交互。</span>
                  </div>
                  <label className="settings-switch-toggle">
                    <input
                      type="checkbox"
                      checked={form.mcpEnabled ?? false}
                      onChange={(event) => setForm((current) => ({ ...current, mcpEnabled: event.target.checked }))}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                <div className="settings-switch-card" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }}>
                  <div className="settings-switch-info" style={{ width: "100%" }}>
                    <div className="settings-switch-title">
                      <Sparkles size={18} className="settings-switch-icon" />
                      <strong>Saki 学说话 (Voice Echo) 变声引擎</strong>
                    </div>
                    <span>长按右下角悬浮 Saki 头像时复读语音的变声引擎。完全运行于客户端浏览器，无须占用服务器 GPU 资源。</span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                    {/* Mode 1: DSP */}
                    <div
                      onClick={() => handleVoiceEchoEngineChange("dsp")}
                      style={{
                        padding: "14px 16px",
                        borderRadius: "10px",
                        border: voiceEchoEngine === "dsp" ? "2px solid var(--primary, #3b82f6)" : "1px solid var(--border-color, rgba(140, 140, 140, 0.25))",
                        background: voiceEchoEngine === "dsp" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        transition: "all 0.15s ease"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: "0.95rem" }}>
                          <Zap size={16} style={{ color: "#3b82f6" }} />
                          <span>轻量 DSP 增强模式 (推荐/默认)</span>
                        </div>
                        {voiceEchoEngine === "dsp" && <CheckCircle2 size={16} style={{ color: "#3b82f6" }} />}
                      </div>
                      <span style={{ fontSize: "0.82rem", opacity: 0.8, lineHeight: 1.45 }}>
                        零额外体积占用（0 KB 下载）、&lt;30ms 极速响应。通过目标基频绝对锚定（392Hz）与 6 级共振峰滤波统一音色基准，告别男女声调不齐与破音。
                      </span>
                    </div>

                    {/* Mode 2: WebGPU AI */}
                    <div
                      onClick={() => handleVoiceEchoEngineChange("ai")}
                      style={{
                        padding: "14px 16px",
                        borderRadius: "10px",
                        border: voiceEchoEngine === "ai" ? "2px solid var(--primary, #3b82f6)" : "1px solid var(--border-color, rgba(140, 140, 140, 0.25))",
                        background: voiceEchoEngine === "ai" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        transition: "all 0.15s ease"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: "0.95rem" }}>
                          <Cpu size={16} style={{ color: "#8b5cf6" }} />
                          <span>端侧 WebGPU / WASM AI 引擎</span>
                        </div>
                        {voiceEchoEngine === "ai" && <CheckCircle2 size={16} style={{ color: "#8b5cf6" }} />}
                      </div>
                      <span style={{ fontSize: "0.82rem", opacity: 0.8, lineHeight: 1.45 }}>
                        利用客户端本地显卡/CPU 运行轻量模型转换 Saki 专属声线，服务器 0 负载。首次切换时按需加载并缓存，若设备不支持将自动降级回 DSP。
                      </span>
                    </div>
                  </div>

                  {/* WebGPU Status Bar */}
                  {webGpuInfo && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem", padding: "8px 12px", borderRadius: 8, background: webGpuInfo.supported ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)", color: webGpuInfo.supported ? "#059669" : "#d97706" }}>
                      {webGpuInfo.supported ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                      <span>
                        {webGpuInfo.supported
                          ? `客户端状态：已检测到本地 WebGPU 硬件加速 (${webGpuInfo.adapterName})`
                          : `客户端提示：${webGpuInfo.reason || "当前浏览器未开启 WebGPU，启用 AI 模式将自动降级为 DSP 模式"}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Appearance & Branding */}
            <div className={`settings-group ${activeSettingsSection === "appearance" ? "active" : "settings-section-hidden"}`} id="settings-appearance">
              <div className="settings-group-title">
                <div className="settings-group-icon"><ImageIcon size={20} /></div>
                <div>
                  <h3>{t("settings.appearance")}</h3>
                  <span>{t("settings.appearance.titleDetail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <div className="settings-form-row">
                  <label className="settings-field">
                    <span className="settings-field-label">侧边栏标题</span>
                    <input
                      className="settings-input"
                      value={form.appearance?.sidebarTitle ?? ""}
                      onChange={(event) => updateAppearance({ sidebarTitle: event.target.value })}
                      placeholder="Saki Panel"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">登录页主标题</span>
                    <input
                      className="settings-input"
                      value={form.appearance?.appTitle ?? ""}
                      onChange={(event) => updateAppearance({ appTitle: event.target.value })}
                      placeholder="Saki Panel"
                    />
                  </label>
                </div>

                <label className="settings-field">
                  <span className="settings-field-label">登录页副标题</span>
                  <input
                    className="settings-input"
                    value={form.appearance?.appSubtitle ?? ""}
                    onChange={(event) => updateAppearance({ appSubtitle: event.target.value })}
                    placeholder="System Administration"
                  />
                </label>

                <div className="settings-asset-grid">
                  {/* Login Cover */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box cover">
                      {form.appearance?.loginCoverSrc ? (
                        <img src={form.appearance.loginCoverSrc} alt="登录封面" />
                      ) : (
                        <div className="settings-asset-empty">
                          <ImageIcon size={28} />
                          <span>未设置封面</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>登录页封面大图</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.loginCoverSrc ?? ""}
                          onChange={(event) => updateAppearance({ loginCoverSrc: event.target.value })}
                          placeholder="/assets/cover.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => loginCoverInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* App Logo */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box square">
                      {form.appearance?.appLogoSrc ? (
                        <img src={form.appearance.appLogoSrc} alt="应用图标" />
                      ) : (
                        <div className="settings-asset-empty">
                          <ImageIcon size={24} />
                          <span>默认图标</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>应用图标 (Favicon/Logo)</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.appLogoSrc ?? ""}
                          onChange={(event) => updateAppearance({ appLogoSrc: event.target.value })}
                          placeholder="/assets/saki-panel-icon.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => appLogoInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar Logo */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box square">
                      {form.appearance?.sidebarLogoSrc ? (
                        <img src={form.appearance.sidebarLogoSrc} alt="侧边栏图标" />
                      ) : (
                        <div className="settings-asset-empty">
                          <ImageIcon size={24} />
                          <span>侧栏图标</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>侧边栏 Logo</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.sidebarLogoSrc ?? ""}
                          onChange={(event) => updateAppearance({ sidebarLogoSrc: event.target.value })}
                          placeholder="/assets/saki-panel-icon.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => sidebarLogoInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Custom Backgrounds & Live Wallpapers Section */}
                <div className="settings-bg-section">
                  <div className="settings-bg-section-header">
                    <div className="settings-bg-section-info">
                      <h4>自定义系统壁纸与动态背景</h4>
                      <span>分别自定义浅色与暗色模式下的桌面端与移动端背景，支持 PNG、JPG、WebP、GIF 图片及 MP4、WebM、OGG 视频动态壁纸（上限 50MB）。</span>
                    </div>
                    <div className="settings-bg-theme-switcher">
                      <button
                        type="button"
                        className={`settings-bg-tab-btn ${bgThemeTab === "light" ? "active" : ""}`}
                        onClick={() => setBgThemeTab("light")}
                      >
                        <Sun size={14} />
                        <span>浅色主题背景</span>
                      </button>
                      <button
                        type="button"
                        className={`settings-bg-tab-btn ${bgThemeTab === "dark" ? "active" : ""}`}
                        onClick={() => setBgThemeTab("dark")}
                      >
                        <Moon size={14} />
                        <span>暗色主题背景</span>
                      </button>
                      <button
                        type="button"
                        className={`settings-bg-tab-btn ${bgThemeTab === "all" ? "active" : ""}`}
                        onClick={() => setBgThemeTab("all")}
                      >
                        <span>全部显示</span>
                      </button>
                    </div>
                  </div>

                  <div className="settings-asset-grid">
                    {/* Light Theme Backgrounds */}
                    {(bgThemeTab === "light" || bgThemeTab === "all") && (
                      <>
                        {/* Light Desktop Background */}
                        <div className="settings-asset-card">
                          <div className="settings-asset-preview-box cover">
                            {form.appearance?.backgroundSrc ? (
                              isVideoSource(form.appearance.backgroundSrc) ? (
                                <video
                                  className="settings-asset-preview-video"
                                  src={form.appearance.backgroundSrc}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                />
                              ) : (
                                <img src={form.appearance.backgroundSrc} alt="桌面端浅色背景" />
                              )
                            ) : (
                              <div className="settings-asset-empty">
                                <Paintbrush size={24} />
                                <span>默认浅色壁纸</span>
                              </div>
                            )}
                            {form.appearance?.backgroundSrc ? (
                              <span className="settings-asset-type-badge">
                                {isVideoSource(form.appearance.backgroundSrc) ? (
                                  <><Video size={11} /> 动态视频</>
                                ) : (
                                  <><ImageIcon size={11} /> 静态图片</>
                                )}
                              </span>
                            ) : null}
                          </div>
                          <div className="settings-asset-meta">
                            <div className="settings-asset-title-row">
                              <strong>桌面端背景 (浅色模式)</strong>
                              <span className="settings-theme-tag light"><Sun size={12} /> 浅色</span>
                            </div>
                            <div className="settings-asset-input-wrap">
                              <input
                                className="settings-input mini"
                                value={form.appearance?.backgroundSrc ?? ""}
                                onChange={(event) => updateAppearance({ backgroundSrc: event.target.value })}
                                placeholder="/assets/background.png"
                              />
                              <button
                                className="ghost-button mini"
                                type="button"
                                onClick={() => backgroundInputRef.current?.click()}
                                title="选择本地图片或视频 (MP4/WebM/OGG)"
                              >
                                <Upload size={14} />
                                <span>上传</span>
                              </button>
                              {form.appearance?.backgroundSrc && form.appearance.backgroundSrc !== defaultPanelAppearance.backgroundSrc ? (
                                <button
                                  className="ghost-button mini reset-btn"
                                  type="button"
                                  onClick={() => updateAppearance({ backgroundSrc: defaultPanelAppearance.backgroundSrc })}
                                  title="恢复默认背景"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Light Mobile Background */}
                        <div className="settings-asset-card">
                          <div className="settings-asset-preview-box portrait">
                            {form.appearance?.mobileBackgroundSrc ? (
                              isVideoSource(form.appearance.mobileBackgroundSrc) ? (
                                <video
                                  className="settings-asset-preview-video"
                                  src={form.appearance.mobileBackgroundSrc}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                />
                              ) : (
                                <img src={form.appearance.mobileBackgroundSrc} alt="移动端竖屏浅色背景" />
                              )
                            ) : (
                              <div className="settings-asset-empty">
                                <Paintbrush size={24} />
                                <span>默认竖屏壁纸</span>
                              </div>
                            )}
                            {form.appearance?.mobileBackgroundSrc ? (
                              <span className="settings-asset-type-badge">
                                {isVideoSource(form.appearance.mobileBackgroundSrc) ? (
                                  <><Video size={11} /> 动态视频</>
                                ) : (
                                  <><ImageIcon size={11} /> 静态图片</>
                                )}
                              </span>
                            ) : null}
                          </div>
                          <div className="settings-asset-meta">
                            <div className="settings-asset-title-row">
                              <strong>移动端竖屏背景 (浅色模式)</strong>
                              <span className="settings-theme-tag light"><Sun size={12} /> 浅色</span>
                            </div>
                            <div className="settings-asset-input-wrap">
                              <input
                                className="settings-input mini"
                                value={form.appearance?.mobileBackgroundSrc ?? ""}
                                onChange={(event) => updateAppearance({ mobileBackgroundSrc: event.target.value })}
                                placeholder="/assets/background_mobile.png"
                              />
                              <button
                                className="ghost-button mini"
                                type="button"
                                onClick={() => mobileBackgroundInputRef.current?.click()}
                                title="选择本地图片或视频 (MP4/WebM/OGG)"
                              >
                                <Upload size={14} />
                                <span>上传</span>
                              </button>
                              {form.appearance?.mobileBackgroundSrc && form.appearance.mobileBackgroundSrc !== defaultPanelAppearance.mobileBackgroundSrc ? (
                                <button
                                  className="ghost-button mini reset-btn"
                                  type="button"
                                  onClick={() => updateAppearance({ mobileBackgroundSrc: defaultPanelAppearance.mobileBackgroundSrc })}
                                  title="恢复默认背景"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Dark Theme Backgrounds */}
                    {(bgThemeTab === "dark" || bgThemeTab === "all") && (
                      <>
                        {/* Dark Desktop Background */}
                        <div className="settings-asset-card">
                          <div className="settings-asset-preview-box cover">
                            {form.appearance?.darkBackgroundSrc ? (
                              isVideoSource(form.appearance.darkBackgroundSrc) ? (
                                <video
                                  className="settings-asset-preview-video"
                                  src={form.appearance.darkBackgroundSrc}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                />
                              ) : (
                                <img src={form.appearance.darkBackgroundSrc} alt="桌面端暗色背景" />
                              )
                            ) : (
                              <div className="settings-asset-empty">
                                <Paintbrush size={24} />
                                <span>默认暗色壁纸</span>
                              </div>
                            )}
                            {form.appearance?.darkBackgroundSrc ? (
                              <span className="settings-asset-type-badge">
                                {isVideoSource(form.appearance.darkBackgroundSrc) ? (
                                  <><Video size={11} /> 动态视频</>
                                ) : (
                                  <><ImageIcon size={11} /> 静态图片</>
                                )}
                              </span>
                            ) : null}
                          </div>
                          <div className="settings-asset-meta">
                            <div className="settings-asset-title-row">
                              <strong>桌面端背景 (暗色模式)</strong>
                              <span className="settings-theme-tag dark"><Moon size={12} /> 暗色</span>
                            </div>
                            <div className="settings-asset-input-wrap">
                              <input
                                className="settings-input mini"
                                value={form.appearance?.darkBackgroundSrc ?? ""}
                                onChange={(event) => updateAppearance({ darkBackgroundSrc: event.target.value })}
                                placeholder="/assets/background_dark.png"
                              />
                              <button
                                className="ghost-button mini"
                                type="button"
                                onClick={() => darkBackgroundInputRef.current?.click()}
                                title="选择本地图片或视频 (MP4/WebM/OGG)"
                              >
                                <Upload size={14} />
                                <span>上传</span>
                              </button>
                              {form.appearance?.darkBackgroundSrc && form.appearance.darkBackgroundSrc !== defaultPanelAppearance.darkBackgroundSrc ? (
                                <button
                                  className="ghost-button mini reset-btn"
                                  type="button"
                                  onClick={() => updateAppearance({ darkBackgroundSrc: defaultPanelAppearance.darkBackgroundSrc })}
                                  title="恢复默认背景"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* Dark Mobile Background */}
                        <div className="settings-asset-card">
                          <div className="settings-asset-preview-box portrait">
                            {form.appearance?.mobileDarkBackgroundSrc ? (
                              isVideoSource(form.appearance.mobileDarkBackgroundSrc) ? (
                                <video
                                  className="settings-asset-preview-video"
                                  src={form.appearance.mobileDarkBackgroundSrc}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                />
                              ) : (
                                <img src={form.appearance.mobileDarkBackgroundSrc} alt="移动端竖屏暗色背景" />
                              )
                            ) : (
                              <div className="settings-asset-empty">
                                <Paintbrush size={24} />
                                <span>默认竖屏壁纸</span>
                              </div>
                            )}
                            {form.appearance?.mobileDarkBackgroundSrc ? (
                              <span className="settings-asset-type-badge">
                                {isVideoSource(form.appearance.mobileDarkBackgroundSrc) ? (
                                  <><Video size={11} /> 动态视频</>
                                ) : (
                                  <><ImageIcon size={11} /> 静态图片</>
                                )}
                              </span>
                            ) : null}
                          </div>
                          <div className="settings-asset-meta">
                            <div className="settings-asset-title-row">
                              <strong>移动端竖屏背景 (暗色模式)</strong>
                              <span className="settings-theme-tag dark"><Moon size={12} /> 暗色</span>
                            </div>
                            <div className="settings-asset-input-wrap">
                              <input
                                className="settings-input mini"
                                value={form.appearance?.mobileDarkBackgroundSrc ?? ""}
                                onChange={(event) => updateAppearance({ mobileDarkBackgroundSrc: event.target.value })}
                                placeholder="/assets/background_mobile_dark.png"
                              />
                              <button
                                className="ghost-button mini"
                                type="button"
                                onClick={() => mobileDarkBackgroundInputRef.current?.click()}
                                title="选择本地图片或视频 (MP4/WebM/OGG)"
                              >
                                <Upload size={14} />
                                <span>上传</span>
                              </button>
                              {form.appearance?.mobileDarkBackgroundSrc && form.appearance.mobileDarkBackgroundSrc !== defaultPanelAppearance.mobileDarkBackgroundSrc ? (
                                <button
                                  className="ghost-button mini reset-btn"
                                  type="button"
                                  onClick={() => updateAppearance({ mobileDarkBackgroundSrc: defaultPanelAppearance.mobileDarkBackgroundSrc })}
                                  title="恢复默认背景"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Prompt & Personality */}
            <div className={`settings-group ${activeSettingsSection === "prompt" ? "active" : "settings-section-hidden"}`} id="settings-prompt">
              <div className="settings-group-title">
                <div className="settings-group-icon"><TextQuote size={20} /></div>
                <div>
                  <h3>{t("settings.prompt")}</h3>
                  <span>{t("settings.prompt.detail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <label className="settings-field">
                  <div className="settings-field-head">
                    <span className="settings-field-label">全局系统提示词 (System Prompt)</span>
                    <span className="settings-char-count">{(form.systemPrompt ?? "").length} 字符</span>
                  </div>
                  <textarea
                    className="settings-textarea prompt-editor"
                    value={form.systemPrompt ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                    rows={8}
                    placeholder="设定 Saki 的性格特点、回复语气、运维管理规范与操作约束..."
                  />
                  <span className="settings-field-hint">此提示词将作为 Saki 在所有会话与运维排查中的全局基准系统人设。</span>
                </label>
              </div>
            </div>

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
          ) : (
          <div className="settings-skills-page saki-skill-settings-panel">
        <div className="section-heading saki-skill-heading">
          <div className="saki-skill-title">
            <div>
              <h2>Saki Skills</h2>
              <span>{skillList.length} installed</span>
            </div>
          </div>
          <div className="saki-skill-header-actions">
            <button
              className="ghost-button saki-skill-header-import"
              type="button"
              disabled={skillBusy === "import"}
              onClick={() => skillImportInputRef.current?.click()}
              title="从 .md / .txt 文件导入 Skill"
            >
              <FileUp size={16} />
              <span>{skillBusy === "import" ? "导入中" : "导入文件"}</span>
            </button>
            <button className="ghost-button" type="button" onClick={() => setSkillCreatorOpen((current) => !current)}>
              {skillCreatorOpen ? <X size={17} /> : <Plus size={17} />}
              {skillCreatorOpen ? "收起添加" : "添加 Skill"}
            </button>
          </div>
        </div>

        {skillCreatorOpen ? (
          <div className="saki-skill-creator-section">
            <form className="saki-skill-editor saki-skill-editor-panel" onSubmit={(event) => void createSkill(event)}>
              <div className="saki-skill-editor-heading">
                <div>
                  <strong>添加 Skill</strong>
                  <span>Local SKILL.md</span>
                </div>
                <button type="button" className="icon-button" onClick={() => setSkillCreatorOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="saki-skill-form-grid">
                <label className="saki-skill-form-field">
                  <span className="saki-skill-form-label">Skill name</span>
                  <input
                    value={skillDraft.name}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="my-framework-helper"
                  />
                </label>
                <label className="saki-skill-form-field">
                  <span className="saki-skill-form-label">Tags</span>
                  <input
                    value={skillDraft.tags}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="python, plugin, review"
                  />
                </label>
                <label className="saki-skill-form-field saki-skill-form-wide">
                  <span className="saki-skill-form-label">Description</span>
                  <input
                    value={skillDraft.description}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="When this Skill should be used"
                  />
                </label>
                <label className="saki-skill-form-field saki-skill-form-wide">
                  <span className="saki-skill-form-label">SKILL.md</span>
                  <textarea
                    value={skillDraft.content}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, content: event.target.value }))}
                    rows={8}
                    placeholder="# Skill instructions"
                  />
                </label>
                <label className="saki-skill-form-field saki-skill-form-checkbox">
                  <input
                    type="checkbox"
                    checked={skillDraft.enabled}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  <span>Enabled</span>
                </label>
              </div>
              <div className="saki-skill-form-actions">
                <button className="primary-button" disabled={skillBusy === "create"} type="submit">
                  <Plus size={17} />
                  {skillBusy === "create" ? "Saving" : "Add Skill"}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        <div className={`saki-skill-workspace ${selectedSkillId ? "has-selected-skill" : "no-selected-skill"}`}>

          <div className="saki-skill-sidebar">
            <div className="saki-skill-sidebar-header">
              <div className="saki-skill-search">
                <Search size={15} />
                <input
                  type="text"
                  value={skillSearchQuery}
                  onChange={(event) => setSkillSearchQuery(event.target.value)}
                  placeholder="Search skills..."
                />
              </div>
              <div className="saki-skill-filter">
                {[
                  { value: "all", label: "All" },
                  { value: "enabled", label: "Enabled" },
                  { value: "disabled", label: "Disabled" }
                ].map((option) => (
                  <button
                    key={option.value}
                    className={skillFilter === option.value ? "active" : ""}
                    type="button"
                    onClick={() => setSkillFilter(option.value as typeof skillFilter)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <form className="saki-skill-download" onSubmit={(event) => void downloadSkill(event)}>
              <div className="saki-skill-download-header">
                <DownloadCloud size={15} />
                <span>Install from URL</span>
              </div>
              <input
                value={skillDownloadUrl}
                onChange={(event) => setSkillDownloadUrl(event.target.value)}
                placeholder="https://github.com/org/repo/SKILL.md"
              />
              <button className="ghost-button" disabled={skillBusy === "download"} type="submit">
                <Download size={15} />
                {skillBusy === "download" ? "Downloading" : "Install"}
              </button>
            </form>

            <div className="saki-skill-import">
              <div className="saki-skill-import-header">
                <FileUp size={15} />
                <span>Import from file</span>
              </div>
              <input
                ref={skillImportInputRef}
                className="hidden-file-input"
                type="file"
                multiple
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                onChange={(event) => void importSkillsFromFiles(event.target.files)}
              />
              <button
                className="saki-skill-import-drop"
                type="button"
                disabled={skillBusy === "import"}
                onClick={() => skillImportInputRef.current?.click()}
              >
                <BookOpen size={18} />
                <span>
                  <strong>{skillBusy === "import" ? "Importing..." : "选择 .md / .txt 文件"}</strong>
                  <em>支持批量导入，从文件名和内容自动提取信息</em>
                </span>
              </button>
            </div>

            <div className="saki-skill-list">
              {skillList
                .filter((skill) => {
                  const matchesSearch = skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                    skill.description?.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                    skill.tags?.some((tag) => tag.toLowerCase().includes(skillSearchQuery.toLowerCase()));
                  const matchesFilter = skillFilter === "all" ||
                    (skillFilter === "enabled" && skill.enabled) ||
                    (skillFilter === "disabled" && skill.enabled === false);
                  return matchesSearch && matchesFilter;
                })
                .map((skill) => {
                  const skillCardClassName = [
                    "saki-skill-card",
                    skill.enabled === false ? "disabled" : "",
                    selectedSkillId === skill.id ? "active" : ""
                  ].filter(Boolean).join(" ");
                  return (
                    <article className={skillCardClassName} key={skill.id}>
                      <button className="saki-skill-card-main" type="button" onClick={() => void selectSkill(skill)}>
                        <div className="saki-skill-card-status">
                          <span className={skill.enabled ? "status-active" : "status-inactive"}></span>
                        </div>
                        <div className="saki-skill-card-content">
                          <div className="saki-skill-card-header">
                            <strong>{skill.name}</strong>
                            {skill.builtin && <span className="saki-skill-builtin">Built-in</span>}
                          </div>
                          {skill.description ? <p>{skill.description}</p> : null}
                          {skill.tags?.length ? (
                            <div className="saki-skill-card-tags">
                              {skill.tags.slice(0, 4).map((tag) => (
                                <span key={`${skill.id}-${tag}`}>{tag}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="saki-skill-card-source">
                          <span>{skill.sourceType ?? "local"}</span>
                        </div>
                      </button>
                      <div className="saki-skill-card-actions">
                        <button
                          className={`icon-button ${skill.enabled ? "action-disable" : "action-enable"}`}
                          disabled={skillBusy === skill.id}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void toggleSkillEnabled(skill); }}
                          title={skill.enabled ? "Disable" : "Enable"}
                        >
                          {skill.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        {skill.builtin ? null : (
                          <button
                            className="icon-button action-delete"
                            disabled={skillBusy === skill.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void deleteSkill(skill); }}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
            </div>
          </div>

          <div className="saki-skill-detail">
            {skillDetailLoading ? (
              <div className="saki-skill-loading">
                <Loader2 size={28} className="spin" />
                <span>Loading Skill...</span>
              </div>
            ) : selectedSkill ? (
              <form className="saki-skill-detail-panel" onSubmit={(event) => void saveSelectedSkill(event)}>
                <button
                  type="button"
                  className="saki-skill-mobile-back-btn"
                  onClick={() => {
                    setSelectedSkillId(null);
                    setSelectedSkill(null);
                  }}
                >
                  <ChevronLeft size={16} />
                  <span>返回技能列表</span>
                </button>
                <div className="saki-skill-detail-header">
                  <div className="saki-skill-detail-title">
                    <h3>{selectedSkill.name}</h3>
                    <span className="saki-skill-detail-id">{selectedSkill.id}</span>
                  </div>
                  <div className="saki-skill-detail-meta">
                    <span className="saki-skill-detail-source">{selectedSkill.sourceType ?? "local"}</span>
                    {selectedSkill.builtin && <span className="saki-skill-detail-builtin">Built-in</span>}
                  </div>
                </div>

                <div className="saki-skill-detail-body">
                  <div className="saki-skill-detail-row">
                    <label className="saki-skill-detail-field">
                      <span className="saki-skill-detail-label">Skill name</span>
                      <input
                        value={skillEditDraft.name}
                        onChange={(event) => setSkillEditDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="my-framework-helper"
                      />
                    </label>
                    <label className="saki-skill-detail-field">
                      <span className="saki-skill-detail-label">Tags</span>
                      <input
                        value={skillEditDraft.tags}
                        onChange={(event) => setSkillEditDraft((current) => ({ ...current, tags: event.target.value }))}
                        placeholder="python, plugin, review"
                      />
                    </label>
                  </div>

                  <label className="saki-skill-detail-field saki-skill-detail-wide">
                    <span className="saki-skill-detail-label">Description</span>
                    <input
                      value={skillEditDraft.description}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, description: event.target.value }))}
                      placeholder="When this Skill should be used"
                    />
                  </label>

                  <label className="saki-skill-detail-field saki-skill-detail-wide saki-skill-detail-textarea">
                    <span className="saki-skill-detail-label">SKILL.md</span>
                    <textarea
                      value={skillEditDraft.content}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, content: event.target.value }))}
                      rows={12}
                      placeholder="# Skill instructions"
                    />
                  </label>

                  <label className="saki-skill-detail-field saki-skill-detail-checkbox">
                    <input
                      type="checkbox"
                      checked={skillEditDraft.enabled}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <span>Enabled</span>
                  </label>
                </div>

                <div className="saki-skill-detail-footer">
                  <div className="saki-skill-detail-info">
                    {selectedSkill.path && <span>Path: {selectedSkill.path}</span>}
                    {selectedSkill.sourceUrl && <span>Source: {selectedSkill.sourceUrl}</span>}
                  </div>
                  <div className="saki-skill-detail-actions">
                    <button className="primary-button" disabled={skillBusy === selectedSkill.id} type="submit">
                      <Save size={17} />
                      {skillBusy === selectedSkill.id ? "Saving" : "Save Skill"}
                    </button>
                    <button
                      className="ghost-button"
                      disabled={skillBusy === selectedSkill.id}
                      type="button"
                      onClick={() => void toggleSkillEnabled(selectedSkill)}
                    >
                      {selectedSkill.enabled === false ? "Enable" : "Disable"}
                    </button>
                    {selectedSkill.builtin ? null : (
                      <button
                        className="ghost-button danger-action"
                        disabled={skillBusy === selectedSkill.id}
                        type="button"
                        onClick={() => void deleteSkill(selectedSkill)}
                      >
                        <Trash2 size={16} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </form>
            ) : (
              <div className="saki-skill-detail-empty">
                <Layers size={48} />
                <h3>Select a Skill</h3>
                <p>Choose a skill from the list to view and edit its details</p>
              </div>
            )}
          </div>
        </div>
      </div>
          )}
          </div>
        </div>
      </section>
    </>
  );
}

