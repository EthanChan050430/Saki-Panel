import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  Save,
  Settings,
  Sparkles,
  Terminal,
  X
} from "lucide-react";
import type {
  AutoApproveRiskLevel,
  ManagedInstance,
  ManagedNode,
  ManagedNotificationChannel,
  RestartPolicy,
  WatchPolicyMode
} from "@webops/shared";
import { api } from "../../api.js";

export interface InstanceSettingsModalProps {
  open: boolean;
  instance: ManagedInstance | null;
  nodes: ManagedNode[];
  token: string;
  onClose: () => void;
  onUpdated: (instance: ManagedInstance) => void;
  suggestingStartCommand: string | null;
  onSuggestStartCommand: (workingDirectory: string, nodeId: string, onApply: (cmd: string) => void) => Promise<void>;
}

export function InstanceSettingsModal({
  open,
  instance,
  nodes,
  token,
  onClose,
  onUpdated,
  suggestingStartCommand,
  onSuggestStartCommand
}: InstanceSettingsModalProps) {
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [watchPolicyState, setWatchPolicyState] = useState<"loading" | "ready" | "error">("loading");
  const [watchNotifyChannels, setWatchNotifyChannels] = useState<ManagedNotificationChannel[]>([]);
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    workingDirectory: "",
    startCommand: "",
    stopCommand: "",
    description: "",
    nodeId: "",
    autoStart: false,
    restartPolicy: "never" as RestartPolicy,
    restartMaxRetries: 3,
    watchMode: "diagnose_and_patch" as WatchPolicyMode | "off",
    watchCooldownSeconds: 900,
    watchMaxRunsPerHour: 3,
    watchVerifyWaitSeconds: 20,
    watchHealthCheckUrl: "",
    watchHealthCheckTimeoutSeconds: 5,
    watchAutoApproveRisk: "none" as AutoApproveRiskLevel,
    watchAutoApproveMinConfidence: 0.85,
    watchEscalationMinutes: 30,
    watchNotifyChannelIds: [] as string[]
  });

  // Only re-initialize the form when the modal opens or a *different* instance
  // is targeted. Depending on the whole `instance` object would reset unsaved
  // edits whenever a status push creates a new object for the same instance.
  const instanceId = instance?.id ?? null;
  useEffect(() => {
    if (!open || !instanceId) return;
    const instanceSnapshot = instance;
    if (!instanceSnapshot) return;
    let cancelled = false;
    setSettingsForm({
      name: instanceSnapshot.name,
      workingDirectory: instanceSnapshot.workingDirectory,
      startCommand: instanceSnapshot.startCommand,
      stopCommand: instanceSnapshot.stopCommand || "",
      description: instanceSnapshot.description || "",
      nodeId: instanceSnapshot.nodeId,
      autoStart: instanceSnapshot.autoStart,
      restartPolicy: instanceSnapshot.restartPolicy,
      restartMaxRetries: instanceSnapshot.restartMaxRetries,
      watchMode: "diagnose_and_patch",
      watchCooldownSeconds: 900,
      watchMaxRunsPerHour: 3,
      watchVerifyWaitSeconds: 20,
      watchHealthCheckUrl: "",
      watchHealthCheckTimeoutSeconds: 5,
      watchAutoApproveRisk: "none",
      watchAutoApproveMinConfidence: 0.85,
      watchEscalationMinutes: 30,
      watchNotifyChannelIds: []
    });
    setSettingsError(null);
    setWatchPolicyState("loading");
    setWatchNotifyChannels([]);

    void api
      .notificationChannels(token)
      .then(({ channels }) => {
        if (cancelled) return;
        setWatchNotifyChannels(channels);
      })
      .catch(() => {
        // 通知渠道列表加载失败时降级为空列表，不阻塞值班策略编辑
      });

    void api
      .watchPolicy(token, instanceId)
      .then((policy) => {
        if (cancelled) return;
        setSettingsForm((current) => ({
          ...current,
          watchMode: policy.enabled ? policy.mode : "off",
          watchCooldownSeconds: policy.cooldownSeconds ?? 900,
          watchMaxRunsPerHour: policy.maxRunsPerHour ?? 3,
          watchVerifyWaitSeconds: policy.verifyWaitSeconds ?? 20,
          watchHealthCheckUrl: policy.healthCheckUrl ?? "",
          watchHealthCheckTimeoutSeconds: policy.healthCheckTimeoutSeconds ?? 5,
          watchAutoApproveRisk: policy.autoApproveRisk ?? "none",
          watchAutoApproveMinConfidence: policy.autoApproveMinConfidence ?? 0.85,
          watchEscalationMinutes: policy.escalationMinutes ?? 30,
          watchNotifyChannelIds: Array.isArray(policy.notifyChannelIds) ? policy.notifyChannelIds : []
        }));
        setWatchPolicyState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setWatchPolicyState("error");
        setSettingsError(
          `值班策略加载失败：${err instanceof Error ? err.message : "未知错误"}，请关闭后重试`
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, open, token]);

  if (!open || !instance) return null;

  async function handleSave() {
    if (!instance) return;
    if (watchPolicyState !== "ready") {
      setSettingsError(
        watchPolicyState === "error"
          ? "值班策略加载失败，为避免写入错误配置，本次不能保存。请关闭后重试"
          : "值班策略加载中，请稍候再保存"
      );
      return;
    }
    const name = settingsForm.name.trim();
    const workingDirectory = settingsForm.workingDirectory.trim();
    const startCommand = settingsForm.startCommand.trim();
    if (!name || !workingDirectory || !startCommand) {
      setSettingsError("请填写完整必填项（名称、工作目录、启动命令）");
      return;
    }
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const stopCommand = settingsForm.stopCommand.trim();
      const description = settingsForm.description.trim();
      let updated: ManagedInstance;
      try {
        updated = await api.updateInstance(token, instance.id, {
          name,
          workingDirectory,
          startCommand,
          stopCommand: stopCommand || null,
          description: description || null,
          nodeId: settingsForm.nodeId || instance.nodeId,
          autoStart: settingsForm.autoStart,
          restartPolicy: settingsForm.restartPolicy,
          restartMaxRetries: settingsForm.restartMaxRetries
        });
      } catch (err) {
        setSettingsError(err instanceof Error ? err.message : "保存设置失败");
        return;
      }

      // Instance fields are already persisted at this point; if the watch
      // policy save fails, say exactly which part succeeded and which failed.
      onUpdated(updated);
      const watchMode = settingsForm.watchMode;
      const clampInt = (value: number, min: number, max: number, fallback: number) => {
        if (!Number.isFinite(value)) return fallback;
        return Math.max(min, Math.min(max, Math.round(value)));
      };
      const clampConfidence = (value: number) => {
        if (!Number.isFinite(value)) return 0.85;
        return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
      };
      try {
        const healthCheckUrl = settingsForm.watchHealthCheckUrl.trim();
        await api.updateWatchPolicy(token, updated.id, {
          enabled: watchMode !== "off",
          mode: watchMode === "off" ? "diagnose_and_patch" : watchMode,
          cooldownSeconds: clampInt(settingsForm.watchCooldownSeconds, 30, 86400, 900),
          maxRunsPerHour: clampInt(settingsForm.watchMaxRunsPerHour, 1, 60, 3),
          verifyWaitSeconds: clampInt(settingsForm.watchVerifyWaitSeconds, 1, 600, 20),
          healthCheckUrl: healthCheckUrl || null,
          healthCheckTimeoutSeconds: clampInt(settingsForm.watchHealthCheckTimeoutSeconds, 1, 120, 5),
          autoApproveRisk: settingsForm.watchAutoApproveRisk,
          autoApproveMinConfidence: clampConfidence(settingsForm.watchAutoApproveMinConfidence),
          escalationMinutes: clampInt(settingsForm.watchEscalationMinutes, 1, 1440, 30),
          notifyChannelIds: settingsForm.watchNotifyChannelIds
        });
      } catch (err) {
        setSettingsError(
          `实例信息已保存，值班策略保存失败：${err instanceof Error ? err.message : "未知错误"}`
        );
        return;
      }

      onClose();
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container instance-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge settings">
              <Settings size={20} />
            </div>
            <div>
              <h3 className="modal-title">实例设置</h3>
              <span className="modal-subtitle">{instance.name} · 调整启动命令与运行策略</span>
            </div>
          </div>
          <button className="icon-button mini modal-close-btn" type="button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="glass-modal-body">
          {settingsError ? (
            <div className="proxy-sub-error-badge" style={{ marginBottom: "1rem" }}>
              <AlertTriangle size={14} />
              <span>{settingsError}</span>
            </div>
          ) : null}

          <div className="modal-settings-grid">
            <label className="wide-field">
              <span>实例名称</span>
              <input
                value={settingsForm.name}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例如：主世界服务器"
              />
            </label>

            <label className="wide-field">
              <span>
                <FolderOpen size={14} /> 工作目录 (绝对路径)
              </span>
              <input
                value={settingsForm.workingDirectory}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, workingDirectory: e.target.value }))}
                placeholder="例如：/opt/minecraft/server 或 D:\\Servers\\mc"
              />
            </label>

            <label className="wide-field">
              <span>
                <Terminal size={14} /> 启动命令
              </span>
              <div className="start-command-control">
                <textarea
                  rows={2}
                  value={settingsForm.startCommand}
                  onChange={(e) => setSettingsForm((prev) => ({ ...prev, startCommand: e.target.value }))}
                  placeholder="例如：java -Xmx4G -jar server.jar nogui"
                />
                <button
                  type="button"
                  className="ai-suggest-button"
                  title={settingsForm.workingDirectory.trim() ? "AI 分析并填写启动命令" : "请先填写工作目录"}
                  disabled={!settingsForm.workingDirectory.trim() || !settingsForm.nodeId || suggestingStartCommand !== null}
                  onClick={() =>
                    void onSuggestStartCommand(
                      settingsForm.workingDirectory.trim(),
                      settingsForm.nodeId,
                      (cmd) => setSettingsForm((prev) => ({ ...prev, startCommand: cmd }))
                    )
                  }
                >
                  {suggestingStartCommand === "settings" ? (
                    <Loader2 size={14} className="spinner" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                </button>
              </div>
            </label>

            <label className="wide-field">
              <span>停止命令 (可选)</span>
              <input
                value={settingsForm.stopCommand}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, stopCommand: e.target.value }))}
                placeholder="例如：stop (向控制台发送或执行)"
              />
            </label>

            <label className="wide-field">
              <span>实例描述 (可选)</span>
              <textarea
                rows={2}
                value={settingsForm.description}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="备注此实例的用途、版本等信息"
              />
            </label>

            <label>
              <span>运行节点</span>
              <select
                value={settingsForm.nodeId}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, nodeId: e.target.value }))}
              >
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>崩溃重启策略</span>
              <select
                value={settingsForm.restartPolicy}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, restartPolicy: e.target.value as RestartPolicy }))}
              >
                <option value="never">不自动重启</option>
                <option value="on_failure">异常退出重启</option>
                <option value="always">总是重启</option>
              </select>
            </label>

            <label>
              <span>Saki 自愈监控策略</span>
              <select
                value={settingsForm.watchMode}
                disabled={watchPolicyState !== "ready"}
                onChange={(e) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    watchMode: e.target.value as WatchPolicyMode | "off"
                  }))
                }
              >
                <option value="diagnose_and_patch">崩溃后诊断并给出补丁</option>
                <option value="diagnose_only">只诊断，不改文件</option>
                <option value="off">关闭该实例的值班监控</option>
              </select>
              {watchPolicyState === "loading" ? (
                <small className="watch-policy-loading-hint">值班策略加载中…</small>
              ) : null}
            </label>

            {settingsForm.watchMode !== "off" ? (
              <>
                <label>
                  <span>冷却时间 (秒)</span>
                  <input
                    type="number"
                    min={30}
                    max={86400}
                    step={30}
                    value={settingsForm.watchCooldownSeconds}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, watchCooldownSeconds: Number(e.target.value) }))
                    }
                  />
                </label>

                <label>
                  <span>每小时诊断上限</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settingsForm.watchMaxRunsPerHour}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, watchMaxRunsPerHour: Number(e.target.value) }))
                    }
                  />
                </label>

                <label>
                  <span>验证等待 (秒)</span>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={settingsForm.watchVerifyWaitSeconds}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, watchVerifyWaitSeconds: Number(e.target.value) }))
                    }
                  />
                </label>

                <label>
                  <span>健康检查超时 (秒)</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={settingsForm.watchHealthCheckTimeoutSeconds}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, watchHealthCheckTimeoutSeconds: Number(e.target.value) }))
                    }
                  />
                </label>

                <label className="wide-field">
                  <span>健康检查地址 (可选)</span>
                  <input
                    value={settingsForm.watchHealthCheckUrl}
                    onChange={(e) => setSettingsForm((prev) => ({ ...prev, watchHealthCheckUrl: e.target.value }))}
                    placeholder="https://…"
                  />
                  <small className="watch-policy-field-hint">
                    修复验证阶段将探测该地址，非 2xx/3xx 视为未恢复并自动回滚
                  </small>
                </label>

                <label>
                  <span>自治级别</span>
                  <select
                    value={settingsForm.watchAutoApproveRisk}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({
                        ...prev,
                        watchAutoApproveRisk: e.target.value as AutoApproveRiskLevel
                      }))
                    }
                  >
                    <option value="none">全部人工批准</option>
                    <option value="low">低风险自动执行</option>
                    <option value="medium">中低风险自动执行</option>
                  </select>
                </label>

                <label>
                  <span>自治最低置信度</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={settingsForm.watchAutoApproveRisk === "none"}
                    title={settingsForm.watchAutoApproveRisk === "none" ? "仅在选择自治级别后生效" : undefined}
                    value={settingsForm.watchAutoApproveMinConfidence}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, watchAutoApproveMinConfidence: Number(e.target.value) }))
                    }
                  />
                </label>

                <label>
                  <span>升级超时 (分钟)</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={settingsForm.watchEscalationMinutes}
                    onChange={(e) =>
                      setSettingsForm((prev) => ({ ...prev, watchEscalationMinutes: Number(e.target.value) }))
                    }
                  />
                </label>

                <div className="wide-field watch-policy-channels-field">
                  <span className="watch-policy-channels-label">通知渠道</span>
                  {watchNotifyChannels.length > 0 ? (
                    <div className="watch-policy-channels">
                      {watchNotifyChannels.map((channel) => (
                        <label className="watch-policy-channel-option" key={channel.id}>
                          <input
                            type="checkbox"
                            checked={settingsForm.watchNotifyChannelIds.includes(channel.id)}
                            onChange={(e) =>
                              setSettingsForm((prev) => ({
                                ...prev,
                                watchNotifyChannelIds: e.target.checked
                                  ? [...prev.watchNotifyChannelIds, channel.id]
                                  : prev.watchNotifyChannelIds.filter((id) => id !== channel.id)
                              }))
                            }
                          />
                          <span className="watch-policy-channel-name">{channel.name}</span>
                          <span className="watch-policy-channel-type">{channel.type}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <small className="watch-policy-field-hint">
                      暂无通知渠道，请先到「设置 → 值班通知」添加
                    </small>
                  )}
                </div>
              </>
            ) : null}

            {settingsForm.restartPolicy !== "never" ? (
              <label>
                <span>最大重试次数</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settingsForm.restartMaxRetries}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      restartMaxRetries: Math.max(1, Math.min(20, parseInt(e.target.value) || 3))
                    }))
                  }
                />
              </label>
            ) : null}

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={settingsForm.autoStart}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, autoStart: e.target.checked }))}
              />
              <span>系统启动时自启此实例 (Auto-start on Boot)</span>
            </label>
          </div>
        </div>

        <div className="glass-modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button settings-save"
            type="button"
            disabled={settingsSaving || watchPolicyState !== "ready"}
            title={watchPolicyState !== "ready" ? "值班策略加载完成后才能保存" : undefined}
            onClick={() => void handleSave()}
          >
            {settingsSaving ? <Loader2 size={16} className="spinner" /> : <Save size={16} />}
            <span>{settingsSaving ? "保存中..." : "保存设置"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
