import React, { useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  HardDrive,
  Loader2,
  RotateCw,
  Save,
  Server,
  Settings,
  X,
  Zap
} from "lucide-react";
import type {
  DatabaseEngine,
  DatabaseVisualizerConfig,
  DatabaseVisualizerInstance,
  ManagedNode
} from "@webops/shared";
import { api, ApiError } from "../../api.js";

export function EditDatabaseModal({
  token,
  database,
  nodes,
  onClose,
  onUpdated
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  nodes: ManagedNode[];
  onClose: () => void;
  onUpdated: (updated: DatabaseVisualizerInstance) => void;
}) {
  const [name, setName] = useState(database.name);
  const [description, setDescription] = useState(database.description || "");
  const [nodeId, setNodeId] = useState(database.nodeId);
  const [host, setHost] = useState(database.config.host || "");
  const [port, setPort] = useState<number | "">(database.config.port ?? "");
  const [user, setUser] = useState(database.config.user || "");
  const [password, setPassword] = useState(database.config.password || "");
  const [databaseName, setDatabaseName] = useState(database.config.database || "");
  const [pathValue, setPathValue] = useState(database.config.path || "");
  const [isReadOnly, setIsReadOnly] = useState(Boolean(database.config.isReadOnly));

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testDatabaseConnection(token, {
        nodeId,
        engine: database.engine,
        host: host.trim() || undefined,
        port: port ? Number(port) : undefined,
        user: user.trim() || undefined,
        password: password || undefined,
        database: databaseName.trim() || undefined,
        path: database.engine === "sqlite" ? pathValue.trim() : undefined
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "连接测试失败" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("实例名称不能为空");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await api.updateDatabase(token, database.id, {
        nodeId,
        name: name.trim(),
        description: description.trim() || undefined,
        config: {
          host: database.engine !== "sqlite" ? (host.trim() || undefined) : undefined,
          port: database.engine !== "sqlite" ? (port ? Number(port) : undefined) : undefined,
          user: database.engine !== "sqlite" ? (user.trim() || undefined) : undefined,
          password: database.engine !== "sqlite" ? (password || undefined) : undefined,
          database: database.engine !== "sqlite" ? (databaseName.trim() || undefined) : undefined,
          path: database.engine === "sqlite" ? pathValue.trim() : undefined,
          isReadOnly
        }
      });
      onUpdated(res.database);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存配置失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container edit-db-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Settings size={20} />
            </div>
            <div>
              <h3 className="modal-title">数据库实例设置</h3>
              <span className="modal-subtitle">{database.name} · {database.engine.toUpperCase()}</span>
            </div>
          </div>
          <button className="icon-button mini modal-close-btn" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="glass-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {error && (
              <div className="connection-test-alert error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {testResult && (
              <div className={`connection-test-alert ${testResult.ok ? "success" : "error"}`}>
                {testResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{testResult.message || (testResult.ok ? "连接测试通过！" : "连接失败")}</span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                实例名称 *
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                运行节点 *
                <select
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)" }}
                >
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {database.engine === "sqlite" ? (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                SQLite 数据库文件路径
                <input
                  required
                  value={pathValue}
                  onChange={(e) => setPathValue(e.target.value)}
                />
              </label>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 12 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                    服务地址 (Host)
                    <input
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                    端口
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value ? Number(e.target.value) : "")}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                    数据库名
                    <input
                      value={databaseName}
                      onChange={(e) => setDatabaseName(e.target.value)}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                    用户名
                    <input
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                    />
                  </label>
                </div>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  密码
                  <input
                    type="password"
                    placeholder="如需更新密码请在此填入"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
              实例描述
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isReadOnly}
                onChange={(e) => setIsReadOnly(e.target.checked)}
              />
              启用只读保护模式
            </label>
          </div>

          <div className="glass-modal-footer" style={{ justifyContent: "space-between" }}>
            <button
              className="ghost-button"
              type="button"
              disabled={testing}
              onClick={() => void handleTest()}
            >
              {testing ? <Loader2 size={15} className="status-spinner" /> : <Activity size={15} />}
              <span>测试连接</span>
            </button>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="ghost-button" type="button" onClick={onClose}>
                取消
              </button>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <Loader2 size={16} className="status-spinner" /> : <Save size={16} />}
                <span>保存设置</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

