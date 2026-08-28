import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Info,
  Link2,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Wifi,
  X,
  Zap
} from "lucide-react";
import type { InstanceProxyConfig, ManagedInstance } from "@webops/shared";
import { api } from "../../api.js";

export interface InstanceProxyModalProps {
  open: boolean;
  instance: ManagedInstance | null;
  token: string;
  onClose: () => void;
  onUpdated: (instance: ManagedInstance) => void;
  onRestartInstance?: (instance: ManagedInstance) => Promise<void>;
}

function clashNodeRegion(name: string): string {
  const n = name.toLowerCase();
  if (/香港|hong\s*kong|\bhk\b/.test(n)) return "香港";
  if (/台湾|taiwan|\btw\b/.test(n)) return "台湾";
  if (/日本|japan|\bjp\b|tokyo|osaka/.test(n)) return "日本";
  if (/新加坡|singapore|\bsg\b/.test(n)) return "新加坡";
  if (/美国|united\s*states|\busa\b|\bus\b|los\s*angeles|sanjose|seattle/.test(n)) return "美国";
  if (/韩国|korea|\bkr\b/.test(n)) return "韩国";
  if (/英国|united\s*kingdom|\buk\b|london/.test(n)) return "英国";
  if (/德国|germany|\bde\b|frankfurt/.test(n)) return "德国";
  if (/法国|france|\bfr\b|paris/.test(n)) return "法国";
  if (/加拿大|canada|\bca\b/.test(n)) return "加拿大";
  if (/澳大利亚|澳洲|australia|\bau\b|sydney/.test(n)) return "澳大利亚";
  if (/马来|malaysia|\bmy\b/.test(n)) return "马来西亚";
  if (/泰国|thailand|\bth\b/.test(n)) return "泰国";
  if (/菲律宾|philippines|\bph\b/.test(n)) return "菲律宾";
  if (/印度|india|\bin\b/.test(n)) return "印度";
  if (/直连|direct/.test(n)) return "直连";
  return "其他";
}

export function InstanceProxyModal({
  open,
  instance,
  token,
  onClose,
  onUpdated,
  onRestartInstance
}: InstanceProxyModalProps) {
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [proxyForm, setProxyForm] = useState<InstanceProxyConfig>({
    enabled: false,
    type: "http",
    server: "127.0.0.1",
    port: 7890,
    username: "",
    password: "",
    bypass: "localhost,127.0.0.1,::1",
    mode: "subscription",
    subscriptionUrl: "",
    selectedProxy: "",
    proxies: []
  });
  const [proxySubLoading, setProxySubLoading] = useState(false);
  const [proxySubApplying, setProxySubApplying] = useState(false);
  const [proxySubError, setProxySubError] = useState<string | null>(null);
  const [proxyNodeQuery, setProxyNodeQuery] = useState("");

  useEffect(() => {
    if (instance?.proxyConfig) {
      setProxyForm({
        enabled: Boolean(instance.proxyConfig.enabled),
        type: instance.proxyConfig.type || "http",
        server: instance.proxyConfig.server || "127.0.0.1",
        port: instance.proxyConfig.port || 7890,
        username: instance.proxyConfig.username || "",
        password: instance.proxyConfig.password || "",
        bypass: instance.proxyConfig.bypass ?? "localhost,127.0.0.1,::1",
        mode: instance.proxyConfig.mode === "manual" ? "manual" : "subscription",
        subscriptionUrl: instance.proxyConfig.subscriptionUrl || "",
        selectedProxy: instance.proxyConfig.selectedProxy || "",
        proxies: instance.proxyConfig.proxies || []
      });
    } else {
      setProxyForm({
        enabled: false,
        type: "http",
        server: "127.0.0.1",
        port: 7890,
        username: "",
        password: "",
        bypass: "localhost,127.0.0.1,::1",
        mode: "subscription",
        subscriptionUrl: "",
        selectedProxy: "",
        proxies: []
      });
    }
    setProxyTestResult(null);
    setProxySubError(null);
    setProxyNodeQuery("");
  }, [instance?.id, instance?.proxyConfig, open]);

  if (!open || !instance) return null;

  async function fetchClashSubscriptionNodes() {
    if (!instance) return;
    const url = (proxyForm.subscriptionUrl || "").trim();
    if (!url) {
      setProxySubError("请先粘贴机场订阅地址");
      return;
    }
    setProxySubLoading(true);
    setProxySubError(null);
    try {
      const result = await api.fetchInstanceClashSubscription(token, instance.id, url);
      setProxyForm((prev) => ({
        ...prev,
        mode: "subscription",
        proxies: result.proxies,
        selectedProxy:
          prev.selectedProxy && result.proxies.some((item) => item.name === prev.selectedProxy)
            ? prev.selectedProxy
            : result.proxies[0]?.name || ""
      }));
    } catch (err) {
      setProxySubError(err instanceof Error ? err.message : "拉取订阅失败");
    } finally {
      setProxySubLoading(false);
    }
  }

  async function testProxyConnectivity() {
    if (!instance) return;
    setProxyTesting(true);
    setProxyTestResult(null);
    try {
      const res = await api.testInstanceProxy(token, instance.id, {
        server: proxyForm.server.trim() || "127.0.0.1",
        port: Number(proxyForm.port) || 7890,
        type: proxyForm.type
      });
      setProxyTestResult({
        success: true,
        message: res.message || "代理端口连通正常"
      });
    } catch (err) {
      setProxyTestResult({
        success: false,
        message: err instanceof Error ? err.message : "连接失败，请确认代理软件已启动"
      });
    } finally {
      setProxyTesting(false);
    }
  }

  async function saveProxySettings(restartAfter = false) {
    if (!instance) return;
    setProxySaving(true);
    setProxySubError(null);
    try {
      let updated: ManagedInstance;
      if (proxyForm.enabled && (proxyForm.mode ?? "subscription") === "subscription") {
        const url = (proxyForm.subscriptionUrl || "").trim();
        const selectedProxy = (proxyForm.selectedProxy || "").trim();
        if (!url || !selectedProxy) {
          setProxySubError("请先拉取订阅并选择一个节点");
          setProxySaving(false);
          return;
        }
        setProxySubApplying(true);
        const applied = await api.applyInstanceClashSubscription(token, instance.id, {
          url,
          selectedProxy,
          bypass: proxyForm.bypass?.trim() || "localhost,127.0.0.1,::1"
        });
        updated = applied.instance;
      } else {
        const payload: InstanceProxyConfig = {
          enabled: proxyForm.enabled,
          mode: "manual",
          type: proxyForm.type,
          server: proxyForm.server.trim(),
          port: Number(proxyForm.port) || 7890,
          username: proxyForm.username?.trim() || null,
          password: proxyForm.password || null,
          bypass: proxyForm.bypass?.trim() || "localhost,127.0.0.1,::1",
          subscriptionUrl: proxyForm.subscriptionUrl || null,
          selectedProxy: null,
          proxies: proxyForm.proxies || null
        };
        updated = await api.updateInstanceProxy(token, instance.id, payload);
      }
      onUpdated(updated);
      onClose();

      const isRunning = instance.status === "RUNNING" || instance.status === "STARTING";
      if (restartAfter && isRunning && onRestartInstance) {
        await onRestartInstance(updated);
      }
    } catch (err) {
      setProxySubError(err instanceof Error ? err.message : "保存代理配置失败");
    } finally {
      setProxySaving(false);
      setProxySubApplying(false);
    }
  }

  const filteredProxies = (proxyForm.proxies || []).filter((node) => {
    if (!proxyNodeQuery.trim()) return true;
    const q = proxyNodeQuery.toLowerCase();
    return node.name.toLowerCase().includes(q) || clashNodeRegion(node.name).includes(q);
  });

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container instance-proxy-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge proxy">
              <Globe size={20} />
            </div>
            <div>
              <h3 className="modal-title">网络代理设置</h3>
              <span className="modal-subtitle">
                {instance.name} · 粘贴机场订阅或对接本机 Clash / v2rayN
              </span>
            </div>
          </div>
          <button
            className="icon-button mini modal-close-btn"
            type="button"
            onClick={onClose}
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="glass-modal-body">
          <div className={`proxy-main-toggle-card ${proxyForm.enabled ? "enabled" : ""}`}>
            <div className="proxy-toggle-info">
              <h4>启用独立网络代理</h4>
              <p>开启后可使用 Clash 订阅选节点，或对接本机已启动的代理软件</p>
            </div>
            <label className="toggle-switch-label">
              <input
                type="checkbox"
                checked={proxyForm.enabled}
                onChange={(e) => setProxyForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              <span className="toggle-switch-slider" />
            </label>
          </div>

          {proxyForm.enabled ? (
            <>
              <div className="proxy-mode-tabs" role="tablist" aria-label="代理配置方式">
                <button
                  type="button"
                  className={`proxy-mode-tab ${(proxyForm.mode ?? "subscription") === "subscription" ? "active" : ""}`}
                  onClick={() => setProxyForm((prev) => ({ ...prev, mode: "subscription" }))}
                >
                  Clash 订阅
                </button>
                <button
                  type="button"
                  className={`proxy-mode-tab ${proxyForm.mode === "manual" ? "active" : ""}`}
                  onClick={() => setProxyForm((prev) => ({ ...prev, mode: "manual" }))}
                >
                  软件端口
                </button>
              </div>

              {(proxyForm.mode ?? "subscription") === "subscription" ? (
                <div className="proxy-subscription-section">
                  <div className="proxy-section-title">
                    <Link2 size={13} />
                    <span>机场订阅地址</span>
                  </div>
                  <div className="proxy-sub-url-row">
                    <input
                      type="url"
                      className="text-input proxy-sub-input"
                      placeholder="粘贴 Clash / Clash.Meta 订阅链接 (https://...)"
                      value={proxyForm.subscriptionUrl || ""}
                      onChange={(e) =>
                        setProxyForm((prev) => ({ ...prev, subscriptionUrl: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void fetchClashSubscriptionNodes();
                        }
                      }}
                    />
                    <button
                      className="primary-button proxy-sub-fetch-btn"
                      type="button"
                      disabled={proxySubLoading || !(proxyForm.subscriptionUrl || "").trim()}
                      onClick={() => void fetchClashSubscriptionNodes()}
                    >
                      {proxySubLoading ? (
                        <>
                          <RotateCw size={14} className="spinning" />
                          <span>解析中...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw size={14} />
                          <span>获取节点</span>
                        </>
                      )}
                    </button>
                  </div>

                  {proxySubError ? (
                    <div className="proxy-sub-error-badge">
                      <AlertTriangle size={13} />
                      <span>{proxySubError}</span>
                    </div>
                  ) : null}

                  {(proxyForm.proxies || []).length > 0 ? (
                    <div className="proxy-nodes-browser">
                      <div className="proxy-nodes-header">
                        <div className="proxy-nodes-count">
                          <span>共发现 <strong>{proxyForm.proxies?.length}</strong> 个节点</span>
                          {proxyForm.selectedProxy ? (
                            <span className="selected-tag">
                              已选: <strong>{proxyForm.selectedProxy}</strong>
                            </span>
                          ) : (
                            <span className="unselected-tag">未选择节点</span>
                          )}
                        </div>
                        <div className="proxy-nodes-search-wrap">
                          <Search size={12} />
                          <input
                            type="text"
                            placeholder="筛选节点名称或地区..."
                            value={proxyNodeQuery}
                            onChange={(e) => setProxyNodeQuery(e.target.value)}
                            className="proxy-nodes-search-input"
                          />
                          {proxyNodeQuery ? (
                            <button
                              type="button"
                              className="clear-query-btn"
                              onClick={() => setProxyNodeQuery("")}
                            >
                              <X size={11} />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="proxy-nodes-grid" role="listbox" aria-label="Clash 节点列表">
                        {filteredProxies.length > 0 ? (
                          filteredProxies.map((node) => {
                            const isSelected = proxyForm.selectedProxy === node.name;
                            const region = clashNodeRegion(node.name);
                            return (
                              <div
                                key={node.name}
                                className={`proxy-node-card ${isSelected ? "selected" : ""}`}
                                onClick={() =>
                                  setProxyForm((prev) => ({ ...prev, selectedProxy: node.name }))
                                }
                                role="option"
                                aria-selected={isSelected}
                              >
                                <div className="proxy-node-top">
                                  <span className="proxy-node-region">{region}</span>
                                  <span className="proxy-node-type">{node.type}</span>
                                </div>
                                <div className="proxy-node-name" title={node.name}>
                                  {node.name}
                                </div>
                                <div className="proxy-node-footer">
                                  <span className="proxy-node-dest">
                                    {node.server}:{node.port}
                                  </span>
                                  {isSelected ? (
                                    <span className="proxy-node-badge active">
                                      <Zap size={10} /> 使用中
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="proxy-nodes-empty">未匹配到符合条件的节点</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="proxy-sub-hint-card">
                      <Zap size={15} />
                      <p>
                        粘贴订阅地址后点击「获取节点」，Saki 将自动解析节点列表并由后台 Clash 核心接管流量。
                      </p>
                    </div>
                  )}

                  <div className="proxy-bypass-row">
                    <label>
                      <span>绕过代理列表（逗号分隔）</span>
                      <input
                        type="text"
                        className="text-input bypass-input"
                        placeholder="localhost,127.0.0.1,::1"
                        value={proxyForm.bypass ?? "localhost,127.0.0.1,::1"}
                        onChange={(e) =>
                          setProxyForm((prev) => ({ ...prev, bypass: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="proxy-manual-section">
                  <div className="proxy-grid-2col">
                    <label>
                      <span>代理协议</span>
                      <select
                        className="text-input"
                        value={proxyForm.type}
                        onChange={(e) =>
                          setProxyForm((prev) => ({
                            ...prev,
                            type: e.target.value as "http" | "socks5"
                          }))
                        }
                      >
                        <option value="http">HTTP / HTTPS</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </label>

                    <label>
                      <span>服务器地址</span>
                      <input
                        type="text"
                        className="text-input"
                        placeholder="127.0.0.1"
                        value={proxyForm.server}
                        onChange={(e) =>
                          setProxyForm((prev) => ({ ...prev, server: e.target.value }))
                        }
                      />
                    </label>

                    <label>
                      <span>代理端口</span>
                      <input
                        type="number"
                        className="text-input"
                        placeholder="7890"
                        value={proxyForm.port || ""}
                        onChange={(e) =>
                          setProxyForm((prev) => ({
                            ...prev,
                            port: Number(e.target.value) || 0
                          }))
                        }
                      />
                    </label>

                    <label>
                      <span>绕过代理列表</span>
                      <input
                        type="text"
                        className="text-input"
                        placeholder="localhost,127.0.0.1,::1"
                        value={proxyForm.bypass ?? ""}
                        onChange={(e) =>
                          setProxyForm((prev) => ({ ...prev, bypass: e.target.value }))
                        }
                      />
                    </label>

                    <label>
                      <span>用户名（可选）</span>
                      <input
                        type="text"
                        className="text-input"
                        placeholder="无须认证留空"
                        value={proxyForm.username ?? ""}
                        onChange={(e) =>
                          setProxyForm((prev) => ({ ...prev, username: e.target.value }))
                        }
                      />
                    </label>

                    <label>
                      <span>密码（可选）</span>
                      <input
                        type="password"
                        className="text-input"
                        placeholder="无须认证留空"
                        value={proxyForm.password ?? ""}
                        onChange={(e) =>
                          setProxyForm((prev) => ({ ...prev, password: e.target.value }))
                        }
                      />
                    </label>
                  </div>

                  <div className="proxy-test-bar">
                    <button
                      className="ghost-button proxy-test-btn"
                      type="button"
                      disabled={proxyTesting || !proxyForm.server.trim() || !proxyForm.port}
                      onClick={() => void testProxyConnectivity()}
                    >
                      <Wifi size={14} />
                      <span>{proxyTesting ? "正在测试连通性..." : "测试连接"}</span>
                    </button>
                    {proxyTestResult ? (
                      <span
                        className={`proxy-test-feedback ${proxyTestResult.success ? "success" : "failure"}`}
                      >
                        {proxyTestResult.success ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <AlertTriangle size={14} />
                        )}
                        <span>{proxyTestResult.message}</span>
                      </span>
                    ) : null}
                  </div>

                  <div className="proxy-info-hint">
                    <Info size={13} />
                    <span>
                      常用默认端口：Clash 混合端口 7890 · v2rayN SOCKS5 10808 / HTTP 10809 · 外部局域网代理请填真实 IP
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="proxy-disabled-empty">
              <p>当前实例使用系统直连网络，未经过任何网络代理。</p>
            </div>
          )}
        </div>

        <div className="glass-modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            取消
          </button>
          {(instance.status === "RUNNING" || instance.status === "STARTING") ? (
            <button
              className="ghost-button restart-save-btn"
              type="button"
              disabled={proxySaving}
              onClick={() => void saveProxySettings(true)}
              title="保存配置并立即重启实例"
            >
              <RotateCw size={15} />
              <span>保存并重启生效</span>
            </button>
          ) : null}
          <button
            className="primary-button settings-save"
            type="button"
            disabled={proxySaving || proxySubApplying}
            onClick={() => void saveProxySettings(false)}
          >
            <Save size={16} />
            <span>{proxySaving || proxySubApplying ? "保存中..." : "保存设置"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
