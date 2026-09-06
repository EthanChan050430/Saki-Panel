import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  Cpu,
  HardDrive,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  MemoryStick,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  SlidersHorizontal,
  Terminal as TerminalIcon,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
  X
} from "lucide-react";
import type {
  CreateEnrollmentTokenResponse,
  CreateNodeRequest,
  CreateUserAccessKeyResponse,
  DaemonNodeKeyPayload,
  ManagedNode,
  NodeJoinCommandResponse,
  RotateNodeTokenResponse,
  UpdateNodeRequest,
  UserAccessKeyInfo
} from "@webops/shared";
import { api, ApiError } from "../api.js";
import { usePanelT } from "../i18n/index.js";
import { MetricTile, NodeStatusPill, PageErrorToast } from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { formatBytes, formatDate, formatNumber } from "../utils/path.js";

function isPrivateOrLocalIp(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().trim();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("127.")) return true;
  if (h.startsWith("10.") || h.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}

export function NodesView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<{ nodeId: string; nodeName: string; nodeToken: string } | null>(null);  const [addMode, setAddMode] = useState<"connect_key" | "daemon_install" | "manual">("connect_key");
  const [keyInput, setKeyInput] = useState("");
  const [keyNodeName, setKeyNodeName] = useState("");
  const [keyGroupName, setKeyGroupName] = useState("");
  const [keyHostOverride, setKeyHostOverride] = useState("");
  const [connectingByKey, setConnectingByKey] = useState(false);

  const parsedKeyPayload = useMemo(() => {
    try {
      let raw = keyInput.trim();
      if (!raw) return null;
      if (raw.startsWith("saki_node_")) raw = raw.slice("saki_node_".length);
      let base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";
      const jsonStr = decodeURIComponent(escape(atob(base64)));
      const parsed = JSON.parse(jsonStr) as Partial<DaemonNodeKeyPayload>;
      if (parsed.host && parsed.port) {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }, [keyInput]);
  const [installOs, setInstallOs] = useState<"linux" | "windows" | "docker">("linux");
  const [installCopied, setInstallCopied] = useState(false);
  const [joinTokenResult, setJoinTokenResult] = useState<CreateEnrollmentTokenResponse | null>(null);  const [userKeys, setUserKeys] = useState<UserAccessKeyInfo[]>([]);
  const [creatingUserKey, setCreatingUserKey] = useState(false);
  const [createdRawUserKey, setCreatedRawUserKey] = useState<string | null>(null);
  const [showUserKeyModal, setShowUserKeyModal] = useState(false);  const [keyModalNode, setKeyModalNode] = useState<ManagedNode | null>(null);
  const [rotatingSecret, setRotatingSecret] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState<RotateNodeTokenResponse | null>(null);
  const [joinCommands, setJoinCommands] = useState<NodeJoinCommandResponse | null>(null);
  const [loadingJoinCommands, setLoadingJoinCommands] = useState(false);
  const [activeCommandTab, setActiveCommandTab] = useState<"linux" | "windows" | "docker">("linux");
  const [commandCopied, setCommandCopied] = useState(false);  const [form, setForm] = useState({
    name: "Local Daemon",
    host: "127.0.0.1",
    port: "5480",
    protocol: "http" as CreateNodeRequest["protocol"],
    remarks: "",
    groupName: "",
    tags: ""
  });

  const refresh = useCallback(async () => {
    setError("");
    try {
      setNodes(await api.nodes(token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "节点刷新失败");
    }
  }, [onLogout, token]);

  const refreshUserKeys = useCallback(async () => {
    try {
      const keys = await api.userKeys(token);
      setUserKeys(keys);
    } catch {
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    void refreshUserKeys();
  }, [refresh, refreshUserKeys, refreshTick]);
  useEffect(() => {
    if (!joinTokenResult && token) {
      void api.createEnrollmentToken(token, {
        namePrefix: "新节点",
        expiresInMinutes: 1440,
        maxUsage: 5
      }).then((res) => setJoinTokenResult(res)).catch(() => {});
    }
  }, [token, joinTokenResult]);

  function resetForm() {
    setEditingNodeId(null);
    setCreatedSecret(null);
    setKeyInput("");
    setKeyNodeName("");
    setKeyGroupName("");
    setKeyHostOverride("");
    setForm({
      name: "Local Daemon",
      host: "127.0.0.1",
      port: "5480",
      protocol: "http",
      remarks: "",
      groupName: "",
      tags: ""
    });
  }

  function editNode(node: ManagedNode) {
    setAddMode("manual");
    setEditingNodeId(node.id);
    setCreatedSecret(null);
    setMessage("");
    setForm({
      name: node.name,
      host: node.host,
      port: String(node.port),
      protocol: node.protocol as CreateNodeRequest["protocol"],
      remarks: node.remarks ?? "",
      groupName: node.groupName ?? "",
      tags: node.tags ?? ""
    });
  }
  async function handleConnectByKey(event: React.FormEvent) {
    event.preventDefault();
    if (!keyInput.trim()) {
      setError("请粘贴目标机器生成的 Node Key");
      return;
    }
    setConnectingByKey(true);
    setError("");
    setMessage("");
    try {
      const res = await api.connectNodeByKey(token, {
        key: keyInput.trim(),
        name: keyNodeName.trim() || undefined,
        groupName: keyGroupName.trim() || undefined,
        hostOverride: keyHostOverride.trim() || undefined
      });
      if (res.ok && res.node) {
        setMessage(`节点 "${res.node.name}" 已成功接入并在线 (${res.node.host}:${res.node.port})`);
        setKeyInput("");
        setKeyNodeName("");
        setKeyGroupName("");
        setKeyHostOverride("");
        await refresh();
      } else {
        setError(res.error || "连接节点失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接节点失败，请检查密钥及机器 Daemon 状态");
    } finally {
      setConnectingByKey(false);
    }
  }
  async function handleCreateUserKey() {
    setCreatingUserKey(true);
    setError("");
    try {
      const res = await api.createUserKey(token, "专属访问密钥");
      setCreatedRawUserKey(res.rawKey);
      setUserKeys((cur) => [res.keyInfo, ...cur]);
      setMessage("已生成专属访问密钥，此密钥仅可控制归属于当前账号的实例");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成用户访问密钥失败");
    } finally {
      setCreatingUserKey(false);
    }
  }
  async function handleDeleteUserKey(id: string) {
    if (!window.confirm("确定撤销此专属密钥吗？撤销后相关自动化调用将立即失效。")) return;
    try {
      await api.deleteUserKey(token, id);
      setUserKeys((cur) => cur.filter((k) => k.id !== id));
      setMessage("密钥已成功撤销");
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤销密钥失败");
    }
  }

  async function saveNode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const port = Number(form.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setError("端口必须是 1-65535 之间的整数");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload: CreateNodeRequest = {
        name: form.name.trim(),
        host: form.host.trim(),
        port,
        protocol: form.protocol
      };
      if (form.remarks.trim()) payload.remarks = form.remarks.trim();
      if (form.groupName.trim()) payload.groupName = form.groupName.trim();
      if (form.tags.trim()) payload.tags = form.tags.trim();

      if (editingNodeId) {
        const updatePayload: UpdateNodeRequest = {
          ...payload,
          remarks: payload.remarks ?? null,
          groupName: payload.groupName ?? null,
          tags: payload.tags ?? null
        };
        const updated = await api.updateNode(token, editingNodeId, updatePayload);
        setNodes((current) => current.map((node) => (node.id === updated.id ? updated : node)));
        setMessage("节点已保存");
      } else {
        const response = await api.createNode(token, payload);
        setNodes((current) => [response.node, ...current.filter((node) => node.id !== response.node.id)]);
        setCreatedSecret({
          nodeId: response.node.id,
          nodeName: response.node.name,
          nodeToken: response.nodeToken
        });
        setMessage("节点已创建");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function testNode(id: string) {
    setTestingNodeId(id);
    setError("");
    setMessage("");
    try {
      const result = await api.testNode(token, id);
      await refresh();
      setMessage(result.ok ? "节点连接正常" : `节点测试失败：${result.error ?? result.statusCode ?? "未知错误"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点测试失败");
    } finally {
      setTestingNodeId(null);
    }
  }

  async function deleteNode(node: ManagedNode) {
    if (!window.confirm(`确定删除节点 "${node.name}" 吗？该节点下的所有实例也将被一并移除。`)) return;
    setBusyNodeId(node.id);
    setError("");
    setMessage("");
    try {
      await api.deleteNode(token, node.id);
      setNodes((current) => current.filter((item) => item.id !== node.id));
      if (editingNodeId === node.id) resetForm();
      setMessage("节点已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点删除失败");
    } finally {
      setBusyNodeId(null);
    }
  }
  async function openKeyModal(node: ManagedNode) {
    setKeyModalNode(node);
    setRotatedSecret(null);
    setJoinCommands(null);
    setLoadingJoinCommands(true);
    try {
      const commands = await api.nodeJoinCommand(token, node.id);
      setJoinCommands(commands);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取节点连接命令失败");
    } finally {
      setLoadingJoinCommands(false);
    }
  }
  async function handleRotateSecret(node: ManagedNode) {
    if (!window.confirm(`确定要为节点 "${node.name}" 重新生成密钥吗？\n\n重新生成后旧密钥将立即作废。`)) {
      return;
    }
    setRotatingSecret(true);
    setError("");
    try {
      const res = await api.rotateNodeToken(token, node.id);
      setRotatedSecret(res);
      await refresh();
      setMessage(`节点 "${node.name}" 密钥已更新`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "密钥轮换失败");
    } finally {
      setRotatingSecret(false);
    }
  }

  function copyText(text: string, onCopied: () => void) {
    navigator.clipboard.writeText(text).then(() => {
      onCopied();
    }).catch(() => {});
  }

  function getInstallCommandText(): string {
    const origin = window.location.origin;
    const tok = joinTokenResult?.token ? encodeURIComponent(joinTokenResult.token) : "YOUR_TOKEN";
    if (installOs === "linux") {
      return `curl -fsSL "${origin}/api/nodes/join.sh?token=${tok}&port=5480" | bash`;
    }
    if (installOs === "windows") {
      return `irm "${origin}/api/nodes/join.ps1?token=${tok}&port=5480" | iex`;
    }
    return `docker run -d --name saki-daemon --restart always --net=host -e DAEMON_PANEL_URL="${origin}" -e DAEMON_REGISTRATION_TOKEN="${joinTokenResult?.token || 'YOUR_TOKEN'}" ghcr.io/saki-panel/daemon:latest`;
  }

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      {message ? <div className="page-notice">{message}</div> : null}

      <section className="node-layout">
        {/* Add Node Panel */}
        <div className="panel-block node-form-panel">
          <div className="section-heading">
            <div>
              <h2>{editingNodeId ? "编辑节点" : "连接节点"}</h2>
              <span>{editingNodeId ? "修改节点网络与配置信息" : "仅连接运行了 Saki-Daemon 的机器"}</span>
            </div>
            {editingNodeId ? (
              <button className="icon-button mini" type="button" title="取消编辑" aria-label="取消编辑" onClick={resetForm}>
                <X size={15} />
              </button>
            ) : null}
          </div>

          {!editingNodeId ? (
            <div style={{ padding: "14px 18px 0" }}>
              <div className="segmented-nav">
                <button
                  type="button"
                  className={`segmented-nav-btn ${addMode === "connect_key" ? "active" : ""}`}
                  onClick={() => { setAddMode("connect_key"); resetForm(); }}
                >
                  <KeyRound size={13} />
                  <span>密钥直连</span>
                </button>
                <button
                  type="button"
                  className={`segmented-nav-btn ${addMode === "daemon_install" ? "active" : ""}`}
                  onClick={() => { setAddMode("daemon_install"); resetForm(); }}
                >
                  <TerminalIcon size={13} />
                  <span>部署向导</span>
                </button>
                <button
                  type="button"
                  className={`segmented-nav-btn ${addMode === "manual" ? "active" : ""}`}
                  onClick={() => setAddMode("manual")}
                >
                  <SlidersHorizontal size={13} />
                  <span>手动配置</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* MODE 1: Connect by Node Key */}
          {addMode === "connect_key" && !editingNodeId ? (
            <form className="node-form" onSubmit={handleConnectByKey}>
              <label className="wide-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span>机器专属密钥 (Node Key)</span>
                  <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted, #86868b)" }}>
                    在目标机器终端执行 npm run daemon:key
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="粘贴目标机器生成的以 saki_node_ 开头的整串密钥..."
                  required
                />
              </label>

              {parsedKeyPayload ? (
                <div className="wide-field" style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  background: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.22)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: "#059669"
                }}>
                  <Check size={14} style={{ flexShrink: 0 }} />
                  <span>
                    已解析机器: <strong>{parsedKeyPayload.name}</strong> · 预设地址: <code>{parsedKeyPayload.protocol || "http"}://{parsedKeyPayload.host}:{parsedKeyPayload.port}</code>
                  </span>
                </div>
              ) : null}

              {parsedKeyPayload && isPrivateOrLocalIp(parsedKeyPayload.host) && !keyHostOverride.trim() ? (
                <div className="wide-field" style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  padding: "8px 12px",
                  background: "rgba(245, 158, 11, 0.08)",
                  border: "1px solid rgba(245, 158, 11, 0.28)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: "#d97706"
                }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: "2px" }} />
                  <span>
                    提示：检测到密钥预设地址为内网/局域网 IP (<code>{parsedKeyPayload.host}</code>)。如果本面板与目标机器不在同一局域网，请在下方“连接 IP / 域名”中填写该机器的<strong>公网 IP</strong> 或域名。
                  </span>
                </div>
              ) : null}

              <label>
                <span>连接 IP / 域名 (跨网段可选覆盖)</span>
                <input
                  value={keyHostOverride}
                  onChange={(e) => setKeyHostOverride(e.target.value)}
                  placeholder={parsedKeyPayload?.host ? `默认: ${parsedKeyPayload.host}` : "若不同网段，在此填写公网 IP 或域名"}
                />
              </label>

              <label>
                <span>节点名称</span>
                <input
                  value={keyNodeName}
                  onChange={(e) => setKeyNodeName(e.target.value)}
                  placeholder={parsedKeyPayload?.name || "可选，默认采用机器自带名称"}
                />
              </label>

              <label className="wide-field">
                <span>分组 (可选)</span>
                <input
                  value={keyGroupName}
                  onChange={(e) => setKeyGroupName(e.target.value)}
                  placeholder="可选，如: 生产集群、外网服务器"
                />
              </label>

              <button className="primary-button form-submit" type="submit" disabled={connectingByKey}>
                <Link2 size={16} />
                {connectingByKey ? "正在握手验证..." : "连接节点"}
              </button>
            </form>
          ) : null}

          {/* MODE 2: Daemon Install Helper */}
          {addMode === "daemon_install" && !editingNodeId ? (
            <div style={{ padding: "16px 18px", display: "grid", gap: "12px" }}>
              <div className="segmented-nav" style={{ maxWidth: "260px" }}>
                <button
                  type="button"
                  className={`segmented-nav-btn ${installOs === "linux" ? "active" : ""}`}
                  onClick={() => { setInstallOs("linux"); setInstallCopied(false); }}
                >
                  Linux
                </button>
                <button
                  type="button"
                  className={`segmented-nav-btn ${installOs === "windows" ? "active" : ""}`}
                  onClick={() => { setInstallOs("windows"); setInstallCopied(false); }}
                >
                  Windows
                </button>
                <button
                  type="button"
                  className={`segmented-nav-btn ${installOs === "docker" ? "active" : ""}`}
                  onClick={() => { setInstallOs("docker"); setInstallCopied(false); }}
                >
                  Docker
                </button>
              </div>

              <div className="code-preview-frame">
                <pre>
                  <code>{getInstallCommandText()}</code>
                </pre>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyText(getInstallCommandText(), () => {
                    setInstallCopied(true);
                    setTimeout(() => setInstallCopied(false), 2000);
                  })}
                >
                  {installCopied ? <Check size={12} style={{ marginRight: 4, color: "#10b981" }} /> : <Copy size={12} style={{ marginRight: 4 }} />}
                  {installCopied ? "已复制" : "复制命令"}
                </button>
              </div>

              <span style={{ fontSize: "12px", color: "var(--text-muted, #86868b)", lineHeight: "1.5" }}>
                目标机器安装完成后，终端将自动打印该机器的 Node Key，切换回【密钥直连】粘贴即可上线。
              </span>
            </div>
          ) : null}

          {/* MODE 3: Manual Direct / Edit Form */}
          {(addMode === "manual" || editingNodeId) ? (
            <form className="node-form" onSubmit={saveNode}>
              <label>
                名称
                <input
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                地址 (IP 或 域名)
                <input
                  value={form.host}
                  onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
                  required
                />
              </label>
              <label>
                端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
                  required
                />
              </label>
              <label>
                协议
                <select
                  value={form.protocol}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, protocol: event.target.value as CreateNodeRequest["protocol"] }))
                  }
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                </select>
              </label>
              <label>
                分组
                <input
                  value={form.groupName}
                  onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))}
                />
              </label>
              <label>
                标签
                <input
                  value={form.tags}
                  onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
                />
              </label>
              <label className="wide-field">
                备注
                <input
                  value={form.remarks}
                  onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
                />
              </label>
              <button className="primary-button form-submit" type="submit" disabled={saving}>
                <Server size={18} />
                {saving ? "保存中" : editingNodeId ? "保存节点" : "添加节点"}
              </button>
            </form>
          ) : null}

          {createdSecret ? (
            <div className="node-token-box">
              <strong>{createdSecret.nodeName}</strong>
              <span>节点 ID</span>
              <code>{createdSecret.nodeId}</code>
              <span>节点令牌</span>
              <code>{createdSecret.nodeToken}</code>
            </div>
          ) : null}
        </div>

        {/* Nodes List Block */}
        <div className="panel-block nodes-block">
          <div className="section-heading">
            <div>
              <h2>已连接节点</h2>
              <span>共 {nodes.length} 台受控机器</span>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                className="secondary-button mini"
                onClick={() => setShowUserKeyModal(true)}
                title="管理我的专属实例访问密钥"
              >
                <KeyRound size={13} />
                <span>专属访问密钥</span>
                {userKeys.length > 0 ? <span className="badge-count">{userKeys.length}</span> : null}
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="nodes-table">
              <thead>
                <tr>
                  <th>机器名称</th>
                  <th>连接地址</th>
                  <th>在线状态</th>
                  <th>系统环境</th>
                  <th>资源占用 (CPU/内存)</th>
                  <th>分组</th>
                  <th>最近心跳</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => {
                  const busy = busyNodeId === node.id || testingNodeId === node.id;
                  return (
                    <tr key={node.id}>
                      <td>
                        <strong>{node.name}</strong>
                        {node.createdBy ? (
                          <div style={{ fontSize: "11px", color: "var(--text-muted, #86868b)", marginTop: "2px" }}>
                            归属: {node.createdBy.displayName || node.createdBy.username}
                          </div>
                        ) : null}
                      </td>
                      <td>{`${node.protocol}://${node.host}:${node.port}`}</td>
                      <td>
                        <NodeStatusPill status={node.status} />
                      </td>
                      <td>{[node.os, node.arch].filter(Boolean).join(" / ") || "-"}</td>
                      <td>
                        {node.latestMetric
                          ? `${formatNumber(node.latestMetric.cpuUsage)} / ${formatNumber(node.latestMetric.memoryUsage)}`
                          : "-"}
                      </td>
                      <td>{node.groupName || "-"}</td>
                      <td>{formatDate(node.lastSeenAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button mini"
                            disabled={busy}
                            title="测试与这台机器的连接"
                            aria-label="测试与这台机器的连接"
                            type="button"
                            onClick={() => void testNode(node.id)}
                          >
                            <Wifi size={14} />
                          </button>
                          <button
                            className="icon-button mini"
                            disabled={busy}
                            title="查看连接凭据与重连命令"
                            aria-label="查看连接凭据与重连命令"
                            type="button"
                            onClick={() => void openKeyModal(node)}
                          >
                            <KeyRound size={14} />
                          </button>
                          <button
                            className="icon-button mini"
                            disabled={busy}
                            title="修改节点配置"
                            aria-label="修改节点配置"
                            type="button"
                            onClick={() => editNode(node)}
                          >
                            <Wrench size={14} />
                          </button>
                          <button
                            className="icon-button mini danger-action"
                            disabled={busy}
                            title="移除此节点"
                            aria-label="移除此节点"
                            type="button"
                            onClick={() => void deleteNode(node)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {nodes.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <SakiEmptyState
                        illustration="offline"
                        title="暂无已连接的节点"
                        description="请在左侧通过机器专属密钥连接你的第一台 Daemon 节点，Saki 将自动建立心跳与遥测连接。"
                      />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* User Access Keys Modal */}
      {showUserKeyModal ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: "560px", width: "92%" }} role="dialog" aria-modal="true">
            <div className="section-heading modal-heading" style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <KeyRound size={18} style={{ color: "#ff75ac" }} />
                <h3 style={{ margin: 0, fontSize: "16px" }}>我的专属实例访问密钥</h3>
              </div>
              <button
                className="icon-button mini"
                type="button"
                onClick={() => { setShowUserKeyModal(false); setCreatedRawUserKey(null); }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: "0 4px", display: "grid", gap: "14px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted, #86868b)", lineHeight: "1.6" }}>
                每个账号的密钥完全独立。使用此密钥仅能访问与控制归属于你自己的实例，跨用户严格隔离。
              </div>

              {/* Newly Created Key Card */}
              {createdRawUserKey ? (
                <div className="key-reveal-card">
                  <div className="key-reveal-header">
                    <Check size={14} />
                    <span>专属访问密钥已生成（仅显示一次，请妥善保存）</span>
                  </div>
                  <div className="key-reveal-field">
                    <code>{createdRawUserKey}</code>
                    <button
                      type="button"
                      className="secondary-button mini"
                      onClick={() => copyText(createdRawUserKey, () => setMessage("已复制专属访问密钥"))}
                    >
                      <Copy size={12} style={{ marginRight: 4 }} />
                      复制
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Action row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>已生效密钥 ({userKeys.length})</span>
                <button
                  type="button"
                  className="primary-button mini"
                  disabled={creatingUserKey}
                  onClick={() => void handleCreateUserKey()}
                >
                  <Plus size={13} style={{ marginRight: 4 }} />
                  {creatingUserKey ? "正在生成..." : "生成新密钥"}
                </button>
              </div>

              {/* Keys list */}
              <div style={{ display: "grid", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
                {userKeys.map((k) => (
                  <div key={k.id} className="key-list-item">
                    <div>
                      <strong style={{ fontSize: "13px" }}>{k.name}</strong>
                      <div style={{ fontSize: "11px", color: "var(--text-muted, #86868b)", marginTop: "2px" }}>
                        末尾指纹: <code>...{k.keyLast4}</code> · 创建于 {formatDate(k.createdAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-button mini danger-action"
                      title="撤销此密钥"
                      aria-label="撤销此密钥"
                      onClick={() => void handleDeleteUserKey(k.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {userKeys.length === 0 ? (
                  <div className="empty-state" style={{ padding: "20px 0" }}>
                    尚未生成任何访问密钥，点击上方“生成新密钥”创建
                  </div>
                ) : null}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "10px", borderTop: "1px solid rgba(0, 0, 0, 0.06)" }}>
                <button
                  type="button"
                  className="primary-button mini"
                  style={{ height: "34px", padding: "0 18px", fontSize: "13px" }}
                  onClick={() => { setShowUserKeyModal(false); setCreatedRawUserKey(null); }}
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Node Key & Reconnect Commands Modal */}
      {keyModalNode ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: "580px", width: "92%" }} role="dialog" aria-modal="true">
            <div className="section-heading modal-heading" style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <KeyRound size={18} style={{ color: "#3b82f6" }} />
                <h3 style={{ margin: 0, fontSize: "16px" }}>节点连接凭证与命令 - {keyModalNode.name}</h3>
              </div>
              <button
                className="icon-button mini"
                type="button"
                onClick={() => { setKeyModalNode(null); setRotatedSecret(null); setJoinCommands(null); }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "grid", gap: "12px", fontSize: "13px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted, #64748b)", lineHeight: "1.5" }}>
                这是该机器的专属凭据。如果你的这台服务器重启后掉线，或者重装了系统，只需复制下方的重连命令再次运行即可：
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(0,0,0,0.03)", borderRadius: "6px" }}>
                <span style={{ color: "var(--text-muted, #64748b)" }}>节点唯一编号 (ID)</span>
                <code style={{ fontSize: "12px" }}>{keyModalNode.id}</code>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(0,0,0,0.03)", borderRadius: "6px" }}>
                <span style={{ color: "var(--text-muted, #64748b)" }}>当前秘钥末四位指纹</span>
                <code style={{ fontSize: "12px" }}>...{keyModalNode.tokenLast4 || "****"}</code>
              </div>

              {/* Rotated Secret Box if newly rotated */}
              {rotatedSecret ? (
                <div style={{ padding: "12px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "8px" }}>
                  <div style={{ color: "#059669", fontWeight: "bold", marginBottom: "6px" }}>✓ 新密码已生成成功（请点击右侧复制）：</div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <code style={{ flex: 1, padding: "6px 8px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "12px", wordBreak: "break-all" }}>
                      {rotatedSecret.nodeToken}
                    </code>
                    <button
                      className="button secondary-button mini"
                      type="button"
                      onClick={() => copyText(rotatedSecret.nodeToken, () => setMessage("已复制新秘钥"))}
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Join Commands for this node */}
              <div style={{ marginTop: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontWeight: 600, fontSize: "13px" }}>专属一键重新连接命令：</span>
                  <div className="segmented-nav" style={{ maxWidth: "240px" }}>
                    <button
                      type="button"
                      className={`segmented-nav-btn ${activeCommandTab === "linux" ? "active" : ""}`}
                      onClick={() => { setActiveCommandTab("linux"); setCommandCopied(false); }}
                    >
                      Linux
                    </button>
                    <button
                      type="button"
                      className={`segmented-nav-btn ${activeCommandTab === "windows" ? "active" : ""}`}
                      onClick={() => { setActiveCommandTab("windows"); setCommandCopied(false); }}
                    >
                      Windows
                    </button>
                    <button
                      type="button"
                      className={`segmented-nav-btn ${activeCommandTab === "docker" ? "active" : ""}`}
                      onClick={() => { setActiveCommandTab("docker"); setCommandCopied(false); }}
                    >
                      Docker
                    </button>
                  </div>
                </div>

                {loadingJoinCommands ? (
                  <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted, #64748b)" }}>
                    <Loader2 size={16} className="spin" style={{ marginRight: 6 }} />
                    正在生成专属重连命令...
                  </div>
                ) : joinCommands ? (
                  <div className="code-preview-frame">
                    <pre>
                      <code>
                        {activeCommandTab === "linux"
                          ? joinCommands.linuxCommand
                          : activeCommandTab === "windows"
                            ? joinCommands.windowsCommand
                            : joinCommands.dockerCommand}
                      </code>
                    </pre>
                    <button
                      className="copy-btn"
                      type="button"
                      onClick={() => {
                        const cmd = activeCommandTab === "linux"
                          ? joinCommands.linuxCommand
                          : activeCommandTab === "windows"
                            ? joinCommands.windowsCommand
                            : joinCommands.dockerCommand;
                        copyText(cmd, () => {
                          setCommandCopied(true);
                          setTimeout(() => setCommandCopied(false), 2000);
                        });
                      }}
                    >
                      {commandCopied ? <Check size={11} style={{ marginRight: 3, color: "#10b981" }} /> : <Copy size={11} style={{ marginRight: 3 }} />}
                      {commandCopied ? "已复制" : "复制命令"}
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", paddingTop: "12px", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                <button
                  type="button"
                  className="secondary-button mini"
                  style={{ color: "#ef4444" }}
                  disabled={rotatingSecret}
                  onClick={() => void handleRotateSecret(keyModalNode)}
                >
                  <RotateCw size={12} style={{ marginRight: 4 }} className={rotatingSecret ? "spin" : ""} />
                  {rotatingSecret ? "正在重新生成..." : "重置密钥"}
                </button>
                <button
                  type="button"
                  className="secondary-button mini"
                  onClick={() => { setKeyModalNode(null); setRotatedSecret(null); setJoinCommands(null); }}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

