import { useState, useEffect, type FormEvent } from "react";
import { Loader2, Server, Settings, Trash2, X, Check, AlertTriangle, ShieldCheck } from "lucide-react";
import type { ManagedNode, ConnectSshNodeRequest, TestSshNodeResponse } from "@webops/shared";
import { api } from "../../api.js";

export interface SshServerSettingsModalProps {
  open: boolean;
  node: ManagedNode | null;
  token: string;
  onClose: () => void;
  onUpdated: (node: ManagedNode) => void;
  onDeleted?: (nodeId: string) => void;
}

export function SshServerSettingsModal({
  open,
  node,
  token,
  onClose,
  onUpdated,
  onDeleted,
}: SshServerSettingsModalProps) {
  if (!open || !node) return null;

  const [form, setForm] = useState({
    name: node.name,
    host: node.host,
    port: node.port || 22,
    username: "",
    authType: "password" as "password" | "privateKey",
    password: "",
    privateKey: "",
    passphrase: ""
  });

  const [tested, setTested] = useState<TestSshNodeResponse | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setForm({
      name: node.name,
      host: node.host,
      port: node.port || 22,
      username: "",
      authType: "password",
      password: "",
      privateKey: "",
      passphrase: ""
    });
    setTested(null);
    setError(null);
    setSuccess(null);
    setConfirmDelete(false);
  }, [node.id, open]);

  const update = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setTested(null);
    setError(null);
    setSuccess(null);
  };

  const handleTest = async () => {
    setError(null);
    setSuccess(null);
    setBusy("test");
    try {
      const credentials: ConnectSshNodeRequest = {
        name: form.name,
        host: form.host,
        port: form.port,
        username: form.username || "root",
        authType: form.authType,
        ...(form.authType === "password"
          ? { password: form.password || undefined }
          : { privateKey: form.privateKey || undefined, passphrase: form.passphrase || undefined })
      };
      const result = await api.testSshNode(token, credentials);
      setTested(result);
      setSuccess(`连接测试通过！响应系统：${result.runtime}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接测试失败");
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy("save");
    try {
      const updates: any = {
        name: form.name.trim(),
        host: form.host.trim(),
        port: form.port,
      };
      if (form.username.trim()) updates.username = form.username.trim();
      if (form.password.trim()) {
        updates.authType = "password";
        updates.password = form.password;
      } else if (form.privateKey.trim()) {
        updates.authType = "privateKey";
        updates.privateKey = form.privateKey;
        if (form.passphrase) updates.passphrase = form.passphrase;
      }
      if (tested?.hostFingerprint) {
        updates.hostFingerprint = tested.hostFingerprint;
      }

      const updatedNode = await api.updateNode(token, node.id, updates);
      onUpdated(updatedNode);
      setSuccess("服务器配置已成功保存！");
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存服务器配置失败");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      await api.deleteNode(token, node.id);
      onDeleted?.(node.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "断开服务器失败");
      setBusy(null);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="ssh-settings-title" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Settings size={18} />
            <h2 id="ssh-settings-title">远程服务器设置 · {node.name}</h2>
          </div>
          <button
            className="icon-button mini"
            type="button"
            title="关闭"
            disabled={busy !== null}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="modal-body">
            <div className="status-overview-banner" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>状态：</strong>
                  <span className={`status-badge ${node.status === "ONLINE" ? "online" : "offline"}`}>
                    {node.status === "ONLINE" ? "在线探针就绪" : "离线 / 未连接"}
                  </span>
                </span>
                <span className="muted" style={{ fontSize: "0.85em" }}>
                  系统架构：{node.os || "Linux"} · {node.arch || "x64"}
                </span>
              </div>
            </div>

            <fieldset disabled={busy !== null} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="instance-form modal-form">
                <label className="wide-field">
                  服务器名称
                  <input
                    required
                    value={form.name}
                    placeholder="生产服务器"
                    onChange={(e) => update({ name: e.target.value })}
                    maxLength={128}
                  />
                </label>
                <label>
                  主机地址 / IP
                  <input
                    required
                    value={form.host}
                    placeholder="例如：192.168.1.100 或 server.domain.com"
                    onChange={(e) => update({ host: e.target.value })}
                  />
                </label>
                <label>
                  SSH 端口
                  <input
                    required
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => update({ port: Number(e.target.value) })}
                  />
                </label>
                <label className="wide-field">
                  登录用户名 (留空则保留原凭据)
                  <input
                    autoComplete="off"
                    value={form.username}
                    placeholder="例如：root 或 ubuntu"
                    onChange={(e) => update({ username: e.target.value })}
                  />
                </label>

                <label className="wide-field">
                  更新凭据认证方式
                  <select
                    value={form.authType}
                    onChange={(e) => update({ authType: e.target.value as "password" | "privateKey" })}
                  >
                    <option value="password">密码认证</option>
                    <option value="privateKey">SSH 私钥认证</option>
                  </select>
                </label>

                {form.authType === "password" ? (
                  <label className="wide-field">
                    密码 (留空则保留已保存的密码)
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      placeholder="••••••••"
                      onChange={(e) => update({ password: e.target.value })}
                    />
                  </label>
                ) : (
                  <>
                    <label className="wide-field">
                      私钥文本 (留空则保留原私钥)
                      <textarea
                        rows={4}
                        value={form.privateKey}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY----- (留空保持不变)"
                        onChange={(e) => update({ privateKey: e.target.value })}
                      />
                    </label>
                    <label className="wide-field">
                      私钥口令 (可选)
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={form.passphrase}
                        onChange={(e) => update({ passphrase: e.target.value })}
                      />
                    </label>
                  </>
                )}
              </div>
            </fieldset>

            {tested && (
              <div role="status" style={{ marginTop: 12, padding: "8px 12px", background: "rgba(56, 189, 248, 0.1)", borderRadius: 6, border: "1px solid rgba(56, 189, 248, 0.3)" }}>
                <p style={{ margin: 0, fontSize: "0.85em", color: "#38bdf8", display: "flex", alignItems: "center", gap: 6 }}>
                  <ShieldCheck size={14} /> 连接测试通过：{tested.runtime}
                </p>
              </div>
            )}

            {error && (
              <p role="alert" className="error-text" style={{ marginTop: 12 }}>
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="success-text" style={{ marginTop: 12, color: "#10b981", display: "flex", alignItems: "center", gap: 6 }}>
                <Check size={14} /> {success}
              </p>
            )}

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border-color, rgba(148, 163, 184, 0.15))", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: "0.85em", color: "var(--muted, #94a3b8)" }}>断开与删除该远程服务器</span>
              </div>
              <button
                type="button"
                className="danger-button mini"
                disabled={busy !== null}
                onClick={handleDelete}
              >
                <Trash2 size={13} />
                {confirmDelete ? "确认断开并移除？" : "断开连接"}
              </button>
            </div>
          </div>

          <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="ghost-button"
              disabled={busy !== null}
              onClick={handleTest}
            >
              {busy === "test" ? <Loader2 size={14} className="spin" /> : <Server size={14} />}
              测试连接
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy !== null}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy !== null}
            >
              {busy === "save" ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              保存设置
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
