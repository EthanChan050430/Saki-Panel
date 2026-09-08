import React, { memo, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  History,
  KeyRound,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Send,
  Trash2
} from "lucide-react";
import type {
  ManagedIngestToken,
  ManagedInstance,
  ManagedNotificationChannel,
  ManagedNotificationDelivery,
  NotificationChannelType,
  NotificationEventKind
} from "@webops/shared";
import { api, ApiError } from "../../api.js";
import { formatDate } from "../../utils/path.js";

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

export interface WatchNotifyPanelProps {
  token: string;
  onLogout: () => void;
  refreshTick: number;
}

export const WatchNotifyPanel = memo(function WatchNotifyPanel({
  token,
  onLogout,
  refreshTick
}: WatchNotifyPanelProps) {
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
});
