import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Plus,
  RotateCw,
  Search,
  Server,
  Shield,
  Sparkles,
  X,
  Zap
} from "lucide-react";
import type {
  CreateDatabaseVisualizerRequest,
  DatabaseEngine,
  DatabaseVisualizerConfig,
  DatabaseVisualizerInstance,
  DiscoveredDatabase,
  InstanceAssignee,
  ManagedNode
} from "@webops/shared";
import { api, ApiError } from "../../api.js";

export function AddDatabaseModal({
  token,
  nodes,
  onClose,
  onCreated,
  embed
}: {
  token: string;
  nodes: ManagedNode[];
  onClose: () => void;
  onCreated: (newDb: DatabaseVisualizerInstance) => void;
  embed?: boolean | undefined;
}) {
  type AddTab = "discover" | "sqlite" | "mysql" | "postgres" | "redis";
  const [tab, setTab] = useState<AddTab>("discover");
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodes[0]?.id || "local");

  // Auto-discover state
  const [discovering, setDiscovering] = useState(false);
  const [discoveredList, setDiscoveredList] = useState<Array<DiscoveredDatabase & { nodeId: string; nodeName: string }>>([]);

  // Form states
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pathValue, setPathValue] = useState("");
  const [hostValue, setHostValue] = useState("127.0.0.1");
  const [portValue, setPortValue] = useState<number | "">("");
  const [userValue, setUserValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [databaseValue, setDatabaseValue] = useState("");
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [assignees, setAssignees] = useState<InstanceAssignee[]>([]);
  const [assignedToUserId, setAssignedToUserId] = useState<string>("");

  useEffect(() => {
    api.instanceAssignees(token)
      .then((list) => setAssignees(list))
      .catch(() => {});
  }, [token]);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleScan = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await api.discoverDatabases(token, selectedNodeId === "all" ? undefined : selectedNodeId);
      setDiscoveredList(res.databases || []);
    } catch {} finally {
      setDiscovering(false);
    }
  }, [token, selectedNodeId]);

  useEffect(() => {
    if (tab === "discover") {
      void handleScan();
    }
  }, [tab, handleScan]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const targetEngine: DatabaseEngine =
        tab === "postgres" ? "postgres" : tab === "redis" ? "redis" : tab === "mysql" ? "mysql" : "sqlite";

      const res = await api.testDatabaseConnection(token, {
        nodeId: selectedNodeId,
        engine: targetEngine,
        host: hostValue.trim() || "127.0.0.1",
        port: portValue ? Number(portValue) : targetEngine === "postgres" ? 5432 : targetEngine === "redis" ? 6379 : 3306,
        user: userValue.trim() || undefined,
        password: passwordValue || undefined,
        database: databaseValue.trim() || undefined,
        path: targetEngine === "sqlite" ? pathValue.trim() : undefined
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("请输入数据库实例名称");
      return;
    }

    const currentEngine: DatabaseEngine =
      tab === "postgres" ? "postgres" : tab === "redis" ? "redis" : tab === "mysql" ? "mysql" : "sqlite";

    setSubmitting(true);
    setError("");
    try {
      const res = await api.createDatabase(token, {
        nodeId: selectedNodeId,
        name: name.trim(),
        engine: currentEngine,
        description: description.trim() || undefined,
        assignedToUserId: assignedToUserId || undefined,
        assignedToUserIds: assignedToUserId ? [assignedToUserId] : undefined,
        config: {
          path: currentEngine === "sqlite" ? pathValue.trim() : undefined,
          host: currentEngine !== "sqlite" ? (hostValue.trim() || "127.0.0.1") : undefined,
          port: currentEngine !== "sqlite" ? (portValue ? Number(portValue) : currentEngine === "postgres" ? 5432 : currentEngine === "redis" ? 6379 : 3306) : undefined,
          user: currentEngine !== "sqlite" ? (userValue.trim() || undefined) : undefined,
          password: currentEngine !== "sqlite" ? (passwordValue || undefined) : undefined,
          database: currentEngine !== "sqlite" ? (databaseValue.trim() || undefined) : undefined,
          isReadOnly
        }
      });
      onCreated(res.database);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建实例失败");
    } finally {
      setSubmitting(false);
    }
  };

  const engineSegmentedTabs = (
    <div className="db-engine-segmented-wrapper">
      <div className="db-engine-segmented">
        <button
          type="button"
          className={`engine-segment-btn ${tab === "discover" ? "active" : ""}`}
          onClick={() => setTab("discover")}
        >
          <Sparkles size={14} />
          <span>智能发现</span>
        </button>
        <button
          type="button"
          className={`engine-segment-btn ${tab === "sqlite" ? "active" : ""}`}
          onClick={() => {
            setTab("sqlite");
            setName(name || "SQLite 数据存储");
          }}
        >
          <Database size={14} />
          <span>SQLite</span>
        </button>
        <button
          type="button"
          className={`engine-segment-btn ${tab === "mysql" ? "active" : ""}`}
          onClick={() => {
            setTab("mysql");
            setName(name || "MySQL 数据库");
            setPortValue(3306);
          }}
        >
          <Server size={14} />
          <span>MySQL</span>
        </button>
        <button
          type="button"
          className={`engine-segment-btn ${tab === "postgres" ? "active" : ""}`}
          onClick={() => {
            setTab("postgres");
            setName(name || "PostgreSQL 数据库");
            setPortValue(5432);
            setUserValue(userValue || "postgres");
            setDatabaseValue(databaseValue || "postgres");
          }}
        >
          <Layers size={14} />
          <span>PostgreSQL</span>
        </button>
        <button
          type="button"
          className={`engine-segment-btn ${tab === "redis" ? "active" : ""}`}
          onClick={() => {
            setTab("redis");
            setName(name || "Redis 键值缓存");
            setPortValue(6379);
            setDatabaseValue("0");
          }}
        >
          <Zap size={14} />
          <span>Redis</span>
        </button>
      </div>
    </div>
  );

  const discoverBody = (
    <div className="glass-modal-body discover-tab-body" style={{ maxHeight: 520, overflowY: "auto" }}>
      <div className="discover-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="discover-header-title">节点发现的数据库与服务</span>
        <button className="small-button" type="button" onClick={() => void handleScan()}>
          <RotateCw size={13} className={discovering ? "status-spinner" : ""} /> 重新扫描
        </button>
      </div>

      {discovering ? (
        <div style={{ padding: 40, textAlign: "center", color: "#86868b" }}>
          <Loader2 size={24} className="status-spinner" style={{ margin: "0 auto 8px" }} />
          <span>正在扫描节点中的文件与监听端口...</span>
        </div>
      ) : discoveredList.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#86868b" }}>
          未发现监听中的默认服务或 SQLite 文件，可切换到对应标签页手动配置连接凭证。
        </div>
      ) : (
        <div className="discover-results-list" style={{ display: "flex", flexDirection: "column" }}>
          {discoveredList.map((item, idx) => (
            <div
              key={idx}
              className="instance-side-card discover-result-card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer"
              }}
              onClick={() => {
                setSelectedNodeId(item.nodeId);
                setName(item.name);
                setDescription(`自动扫描：${item.source}`);
                if (item.engine === "sqlite") {
                  setTab("sqlite");
                  setPathValue(item.path || "");
                } else if (item.engine === "postgres") {
                  setTab("postgres");
                  setHostValue(item.host || "127.0.0.1");
                  setPortValue(item.port || 5432);
                } else if (item.engine === "redis") {
                  setTab("redis");
                  setHostValue(item.host || "127.0.0.1");
                  setPortValue(item.port || 6379);
                } else {
                  setTab("mysql");
                  setHostValue(item.host || "127.0.0.1");
                  setPortValue(item.port || 3306);
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className={`db-engine-chip ${item.engine}`}>
                  {item.engine.toUpperCase()}
                </span>
                <div>
                  <strong style={{ fontSize: 13 }}>{item.name}</strong>
                  <div style={{ fontSize: 11, color: "#86868b" }}>
                    {item.nodeName} · {item.source}
                  </div>
                </div>
              </div>
              <button className="small-button" type="button">
                配置添加
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const manualBody = (
    <form
      onSubmit={handleCreate}
      style={{
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div className="glass-modal-body manual-tab-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <div className="connection-test-alert error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {testResult && (
          <div className={`connection-test-alert ${testResult.ok ? "success" : "error"}`}>
            {testResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>{testResult.message || (testResult.ok ? "连接正常！" : "连接测试失败")}</span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            可视化实例名称 *
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如: 用户核心库 / 订单缓存"
            />
          </label>
          <label>
            目标运行节点 *
            <select
              value={selectedNodeId}
              onChange={(e) => setSelectedNodeId(e.target.value)}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.host}:{n.port})
                </option>
              ))}
            </select>
          </label>
        </div>

        {tab === "sqlite" ? (
          <>
            <label>
              SQLite 数据库文件绝对路径 *
              <input
                required
                value={pathValue}
                onChange={(e) => setPathValue(e.target.value)}
                placeholder="如: D:\projects\data\app.db 或 data/panel/dev.db"
              />
            </label>
            <button
              type="button"
              className="small-button"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                setPathValue("data/panel/dev.db");
                setName("WebOps 核心数据库 (dev.db)");
              }}
            >
              快速填入面板系统数据库 (dev.db)
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 12 }}>
              <label>
                服务主机地址 (Host) *
                <input
                  required
                  value={hostValue}
                  onChange={(e) => setHostValue(e.target.value)}
                  placeholder="127.0.0.1 或内网 IP"
                />
              </label>
              <label>
                端口 (Port) *
                <input
                  type="number"
                  required
                  value={portValue}
                  onChange={(e) => setPortValue(e.target.value ? Number(e.target.value) : "")}
                />
              </label>
            </div>

            {tab !== "redis" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  数据库名 (Database) *
                  <input
                    required
                    value={databaseValue}
                    onChange={(e) => setDatabaseValue(e.target.value)}
                    placeholder="例如: test, app_prod"
                  />
                </label>
                <label>
                  用户名 (User) *
                  <input
                    required
                    value={userValue}
                    onChange={(e) => setUserValue(e.target.value)}
                    placeholder={tab === "postgres" ? "postgres" : "root"}
                  />
                </label>
              </div>
            ) : (
              <label>
                库索引 (DB Index, 默认为 0)
                <input
                  type="number"
                  value={databaseValue}
                  onChange={(e) => setDatabaseValue(e.target.value)}
                  placeholder="0"
                />
              </label>
            )}

            <label>
              连接密码 (Password)
              <input
                type="password"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                placeholder="密码（无密码请留空）"
              />
            </label>
          </>
        )}

        <label>
          描述说明
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选说明，方便快速识别"
          />
        </label>

        {assignees.length > 0 && (
          <label>
            分配负责人
            <select
              value={assignedToUserId}
              onChange={(e) => setAssignedToUserId(e.target.value)}
            >
              <option value="">未指定负责人 (默认仅管理员可见)</option>
              {assignees.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName || user.username} (@{user.username})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={isReadOnly}
            onChange={(e) => setIsReadOnly(e.target.checked)}
          />
          <span>启用只读保护模式 (禁止任何 INSERT / UPDATE / DELETE / DROP 等写操作)</span>
        </label>
      </div>

      <div className="glass-modal-footer manual-tab-footer" style={{ justifyContent: "space-between" }}>
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
            {submitting ? <Loader2 size={16} className="status-spinner" /> : <Plus size={16} />}
            <span>完成添加</span>
          </button>
        </div>
      </div>
    </form>
  );

  const innerContent = (
    <>
      {engineSegmentedTabs}
      {tab === "discover" ? discoverBody : manualBody}
    </>
  );

  if (embed) {
    return (
      <div className="add-db-modal add-db-modal-embed">
        {innerContent}
      </div>
    );
  }

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container add-db-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Database size={20} />
            </div>
            <div>
              <h3 className="modal-title">添加数据库可视化实例</h3>
              <span className="modal-subtitle">支持智能发现节点服务或手动配置连接凭证</span>
            </div>
          </div>
          <button className="icon-button mini modal-close-btn" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {innerContent}
      </div>
    </div>
  );
}
