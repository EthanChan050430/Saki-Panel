import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Database,
  Table as TableIcon,
  Columns,
  Key,
  Plus,
  Trash2,
  Edit3,
  Search,
  Terminal,
  Download,
  Upload,
  Play,
  RotateCw,
  RefreshCw,
  X,
  Check,
  AlertCircle,
  Copy,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  FileCode,
  Sparkles,
  Info,
  Server,
  HardDrive,
  Clock,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  Settings,
  Code2,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Cpu,
  Activity,
  Maximize2,
  Minimize2,
  Shield,
  Zap,
  Save
} from "lucide-react";
import type {
  CreateDatabaseVisualizerRequest,
  DatabaseColumnInfo,
  DatabaseCreateTableRequest,
  DatabaseDeleteRowRequest,
  DatabaseEngine,
  DatabaseExportRequest,
  DatabaseImportRequest,
  DatabaseInsertRowRequest,
  DatabaseQueryResult,
  DatabaseRowsRequest,
  DatabaseRowsResponse,
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseUpdateRowRequest,
  DatabaseVisualizerConfig,
  DatabaseVisualizerInstance,
  DiscoveredDatabase,
  ManagedNode
} from "@webops/shared";
import { api, ApiError } from "./api.js";
import "./db_visualizer.css";

interface DatabaseVisualizerProps {
  token: string;
  nodes: ManagedNode[];
  selectedDatabaseId?: string | null;
  onClose?: () => void;
  onSelectDatabase?: (id: string | null) => void;
  darkMode?: boolean;
}

export function DatabaseVisualizer({
  token,
  nodes,
  selectedDatabaseId,
  onClose,
  onSelectDatabase,
  darkMode
}: DatabaseVisualizerProps) {
  const [databases, setDatabases] = useState<DatabaseVisualizerInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeDbId, setActiveDbId] = useState<string | null>(selectedDatabaseId ?? null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    if (selectedDatabaseId !== undefined && selectedDatabaseId !== null) {
      setActiveDbId(selectedDatabaseId);
    }
  }, [selectedDatabaseId]);

  const loadDatabases = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.listDatabases(token);
      setDatabases(res.databases || []);
      if (!activeDbId && res.databases && res.databases.length > 0) {
        const first = res.databases[0]!.id;
        setActiveDbId(first);
        onSelectDatabase?.(first);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取数据库实例失败");
    } finally {
      setLoading(false);
    }
  }, [token, activeDbId, onSelectDatabase]);

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  const activeDatabase = useMemo(
    () => databases.find((d) => d.id === activeDbId) ?? databases[0] ?? null,
    [databases, activeDbId]
  );

  const handleDeleteDatabase = async (id: string, name: string) => {
    if (!window.confirm(`确定要移除数据库可视化实例「${name}」吗？（不会删除物理数据库文件或服务）`)) return;
    try {
      await api.deleteDatabase(token, id);
      const remaining = databases.filter((d) => d.id !== id);
      setDatabases(remaining);
      if (activeDbId === id) {
        const nextId = remaining[0]?.id ?? null;
        setActiveDbId(nextId);
        onSelectDatabase?.(nextId);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  if (loading && databases.length === 0) {
    return (
      <div className="database-master-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#86868b" }}>
          <Loader2 size={36} className="status-spinner" style={{ margin: "0 auto 12px" }} />
          <p>正在载入数据库可视化环境...</p>
        </div>
      </div>
    );
  }

  if (databases.length === 0) {
    return (
      <div className="database-master-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="glass-panel" style={{ padding: 40, borderRadius: 24, textAlign: "center", maxWidth: 520 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(99, 102, 241, 0.12)", color: "#6366f1", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <Database size={32} />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>尚未配置任何数据库实例</h3>
          <p style={{ color: "#86868b", fontSize: 14, margin: "0 0 24px", lineHeight: 1.5 }}>
            Saki-Panel 支持直连与管理 SQLite 本地文件、MySQL / MariaDB、PostgreSQL 关系库以及 Redis 键值缓存服务。
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            {onClose && (
              <button className="ghost-button" type="button" onClick={onClose}>
                返回实例列表
              </button>
            )}
            <button className="primary-button" type="button" onClick={() => setShowAddModal(true)}>
              <Plus size={16} />
              <span>添加数据库</span>
            </button>
          </div>
        </div>

        {showAddModal && (
          <AddDatabaseModal
            token={token}
            nodes={nodes}
            onClose={() => setShowAddModal(false)}
            onCreated={(newDb) => {
              setShowAddModal(false);
              setDatabases((prev) => [newDb, ...prev]);
              setActiveDbId(newDb.id);
              onSelectDatabase?.(newDb.id);
            }}
          />
        )}
      </div>
    );
  }

  if (!activeDatabase) return null;

  return (
    <>
      <DatabaseActiveWorkspace
        token={token}
        database={activeDatabase}
        databases={databases}
        activeDbId={activeDbId}
        onSelectDatabase={(id) => {
          setActiveDbId(id);
          onSelectDatabase?.(id);
        }}
        onAddDatabase={() => setShowAddModal(true)}
        onEditDatabase={() => setShowEditModal(true)}
        onDelete={() => handleDeleteDatabase(activeDatabase.id, activeDatabase.name)}
        onRefresh={loadDatabases}
        onClose={onClose}
        darkMode={darkMode}
      />

      {showAddModal && (
        <AddDatabaseModal
          token={token}
          nodes={nodes}
          onClose={() => setShowAddModal(false)}
          onCreated={(newDb) => {
            setShowAddModal(false);
            setDatabases((prev) => [newDb, ...prev]);
            setActiveDbId(newDb.id);
            onSelectDatabase?.(newDb.id);
          }}
        />
      )}

      {showEditModal && (
        <EditDatabaseModal
          token={token}
          database={activeDatabase}
          nodes={nodes}
          onClose={() => setShowEditModal(false)}
          onUpdated={(updated) => {
            setShowEditModal(false);
            setDatabases((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          }}
        />
      )}
    </>
  );
}

// -------------------------------------------------------------
// Database Active Workspace (Master Two-Column Layout)
// -------------------------------------------------------------
function DatabaseActiveWorkspace({
  token,
  database,
  databases,
  activeDbId,
  onSelectDatabase,
  onAddDatabase,
  onEditDatabase,
  onDelete,
  onRefresh,
  onClose,
  darkMode
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  databases: DatabaseVisualizerInstance[];
  activeDbId: string | null;
  onSelectDatabase: (id: string) => void;
  onAddDatabase: () => void;
  onEditDatabase: () => void;
  onDelete: () => void;
  onRefresh: () => Promise<void> | void;
  onClose?: (() => void) | undefined;
  darkMode?: boolean | undefined;
}) {
  type Tab = "table" | "schema" | "terminal" | "io";
  const [activeTab, setActiveTab] = useState<Tab>("table");
  const [tables, setTables] = useState<DatabaseTableSummary[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [tableSearch, setTableSearch] = useState("");
  const [loadingTables, setLoadingTables] = useState(false);
  const [tableError, setTableError] = useState("");
  const [showCreateTableModal, setShowCreateTableModal] = useState(false);

  // Terminal actions trigger ref
  const terminalExecRef = useRef<((cmd: string) => void) | null>(null);

  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    setTableError("");
    try {
      const res = await api.getDatabaseTables(token, database.id);
      const list = res.tables || [];
      setTables(list);
      if (list.length > 0) {
        if (!selectedTable || !list.some((t) => t.name === selectedTable)) {
          setSelectedTable(list[0]!.name);
        }
      } else {
        setSelectedTable("");
      }
    } catch (err) {
      setTableError(err instanceof Error ? err.message : "获取数据表列表失败");
    } finally {
      setLoadingTables(false);
    }
  }, [token, database.id, selectedTable]);

  useEffect(() => {
    void loadTables();
  }, [database.id]);

  const activeTableSummary = useMemo(
    () => tables.find((t) => t.name === selectedTable) ?? null,
    [tables, selectedTable]
  );

  const endpointLabel = database.config.path
    ? database.config.path.split(/[\\/]/).pop() || database.config.path
    : `${database.config.host || "127.0.0.1"}:${database.config.port || (database.engine === "postgres" ? 5432 : database.engine === "redis" ? 6379 : 3306)}`;

  return (
    <div className="instance-master-layout database-master-layout">
      {/* LEFT: Main Workspace Column */}
      <section className="instance-terminal-col database-main-col">
        <div className="glass-panel instance-terminal-box database-main-box">
          {/* Topbar: Visual Parity with Regular Instance */}
          <div className="instance-terminal-topbar">
            <div className="terminal-topbar-left">
              {onClose && (
                <button
                  className="glass-back-button"
                  type="button"
                  onClick={onClose}
                  title="返回实例列表"
                  aria-label="返回实例列表"
                >
                  <ChevronLeft size={16} />
                  <span className="back-btn-label">实例列表</span>
                </button>
              )}
              <span className={`db-engine-chip ${database.engine}`}>
                {database.engine.toUpperCase()}
              </span>
              <span className="database-title-label" title={database.name}>
                {database.name}
              </span>
              <span className="status-pill green db-ready-pill">
                <CheckCircle2 size={12} />
                <span>就绪</span>
              </span>
            </div>

            <div className="terminal-topbar-right">
              <div className="terminal-topbar-actions">
                {databases.length > 1 && (
                  <select
                    className="database-header-switcher"
                    value={activeDbId || ""}
                    onChange={(e) => onSelectDatabase(e.target.value)}
                    title="切换当前数据库实例"
                  >
                    {databases.map((db) => (
                      <option key={db.id} value={db.id}>
                        {db.name} ({db.engine.toUpperCase()})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="icon-button mini"
                  type="button"
                  title="刷新数据表"
                  onClick={() => void loadTables()}
                >
                  <RotateCw size={15} />
                </button>
                <button
                  className="icon-button mini"
                  type="button"
                  title="添加数据库实例"
                  onClick={onAddDatabase}
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="mac-dots">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>
            </div>
          </div>

          {/* Tabstrip: Identical to Instance Terminal Tabstrip */}
          <div className="terminal-tabstrip" role="tablist">
            <div
              role="tab"
              aria-selected={activeTab === "table"}
              className={`terminal-tab ${activeTab === "table" ? "active" : ""}`}
              onClick={() => setActiveTab("table")}
            >
              <TableIcon size={14} />
              <span className="tab-label">
                {database.engine === "redis" ? "键值浏览 (Keys)" : "数据浏览 (Data)"}
              </span>
              {activeTableSummary?.rowCount !== undefined && (
                <span className="tab-count-tag">{activeTableSummary.rowCount}</span>
              )}
            </div>

            {database.engine !== "redis" && (
              <div
                role="tab"
                aria-selected={activeTab === "schema"}
                className={`terminal-tab ${activeTab === "schema" ? "active" : ""}`}
                onClick={() => setActiveTab("schema")}
              >
                <Columns size={14} />
                <span className="tab-label">表结构 (Schema)</span>
              </div>
            )}

            <div
              role="tab"
              aria-selected={activeTab === "terminal"}
              className={`terminal-tab ${activeTab === "terminal" ? "active" : ""}`}
              onClick={() => setActiveTab("terminal")}
            >
              <Terminal size={14} />
              <span className="tab-label">
                {database.engine === "redis" ? "Redis CLI" : "SQL 控制台"}
              </span>
            </div>

            <div
              role="tab"
              aria-selected={activeTab === "io"}
              className={`terminal-tab ${activeTab === "io" ? "active" : ""}`}
              onClick={() => setActiveTab("io")}
            >
              <Download size={14} />
              <span className="tab-label">导入与导出</span>
            </div>
          </div>

          {/* Tab Content Body */}
          <div className="db-tab-content-container">
            {tableError && (
              <div className="page-error db-error-banner">
                <div className="page-error-icon" aria-hidden="true">
                  <AlertCircle size={15} />
                </div>
                <span className="page-error-text">{tableError}</span>
                <button className="small-button" type="button" onClick={() => void loadTables()}>
                  重试
                </button>
                <button className="page-error-close" type="button" onClick={() => setTableError("")} title="关闭提示">
                  <X size={14} />
                </button>
              </div>
            )}

            {activeTab === "table" && (
              <TableDataGrid
                token={token}
                database={database}
                tables={tables}
                selectedTable={selectedTable}
                onSelectTable={setSelectedTable}
                onCreateTable={() => setShowCreateTableModal(true)}
                onRefreshTables={loadTables}
              />
            )}

            {activeTab === "schema" && database.engine !== "redis" && (
              <TableSchemaView
                token={token}
                database={database}
                tables={tables}
                selectedTable={selectedTable}
                onSelectTable={setSelectedTable}
              />
            )}

            {activeTab === "terminal" && (
              <DatabaseTerminalConsole
                token={token}
                database={database}
                tables={tables}
                selectedTable={selectedTable}
                onExecRef={(fn) => {
                  terminalExecRef.current = fn;
                }}
              />
            )}

            {activeTab === "io" && (
              <DatabaseImportExportView
                token={token}
                database={database}
                tables={tables}
                selectedTable={selectedTable}
                onRefreshTables={loadTables}
              />
            )}
          </div>
        </div>
      </section>

      {/* RIGHT: Master Sidebar Cards Column */}
      <aside className="instance-sidebar-col database-sidebar-col">
        {/* Card 1: 数据库概览 */}
        <div className="glass-panel instance-side-card instance-summary-card">
          <div className="instance-summary-header">
            <div className="summary-title-row">
              <h3 title={database.name}>{database.name}</h3>
            </div>
            <div className="summary-status-row">
              <span className={`db-engine-chip ${database.engine}`}>
                {database.engine.toUpperCase()}
              </span>
              <span className="instance-program-badge">
                {database.config.isReadOnly ? "只读保护" : "读写就绪"}
              </span>
            </div>
          </div>

          <div className="instance-summary-table">
            <div className="summary-row">
              <span className="summary-label">运行节点</span>
              <span className="summary-value" title={database.nodeName || database.nodeId}>
                {database.nodeName || "本地节点"}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">
                {database.engine === "sqlite" ? "文件路径" : "服务端口"}
              </span>
              <span className="summary-value" title={database.config.path || `${database.config.host || "127.0.0.1"}:${database.config.port}`}>
                {endpointLabel}
              </span>
            </div>
            {database.config.database ? (
              <div className="summary-row">
                <span className="summary-label">数据库名</span>
                <span className="summary-value" title={database.config.database}>
                  {database.config.database}
                </span>
              </div>
            ) : null}
            <div className="summary-row">
              <span className="summary-label">
                {database.engine === "redis" ? "包含键数" : "数据表数"}
              </span>
              <span className="summary-value">
                {database.engine === "redis"
                  ? (tables[0]?.rowCount ?? 0)
                  : `${tables.length} 张表`}
              </span>
            </div>
            {database.description ? (
              <div className="summary-row">
                <span className="summary-label">实例描述</span>
                <span className="summary-value" title={database.description}>
                  {database.description}
                </span>
              </div>
            ) : null}
            <div className="summary-row">
              <span className="summary-label">更新时间</span>
              <span className="summary-value">
                {new Date(database.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: 快捷操作九宫格 */}
        <div className="glass-panel instance-side-card instance-actions-panel-card">
          <div className="quick-actions-square-grid">
            <button
              className="quick-action-square-btn action-restart"
              type="button"
              onClick={() => void loadTables()}
              title="刷新数据表与行数据"
            >
              <div className="action-icon-circle restart">
                <RefreshCw size={18} />
              </div>
              <span className="action-text">刷新</span>
            </button>

            {database.engine !== "redis" ? (
              <button
                className="quick-action-square-btn action-start"
                type="button"
                onClick={() => setShowCreateTableModal(true)}
                title="新建数据表"
              >
                <div className="action-icon-circle start">
                  <Plus size={18} />
                </div>
                <span className="action-text">新建表</span>
              </button>
            ) : (
              <button
                className="quick-action-square-btn action-start"
                type="button"
                onClick={() => {
                  setActiveTab("table");
                }}
                title="添加新键"
              >
                <div className="action-icon-circle start">
                  <Plus size={18} />
                </div>
                <span className="action-text">新建键</span>
              </button>
            )}

            <button
              className="quick-action-square-btn action-console"
              type="button"
              onClick={() => setActiveTab("terminal")}
              title="进入控制台终端"
            >
              <div className="action-icon-circle" style={{ background: "rgba(14, 165, 233, 0.15)", color: "#0284c7" }}>
                <Terminal size={18} />
              </div>
              <span className="action-text">{database.engine === "redis" ? "CLI" : "SQL"}</span>
            </button>

            <button
              className="quick-action-square-btn action-files"
              type="button"
              onClick={() => setActiveTab("io")}
              title="导出与备份"
            >
              <div className="action-icon-circle files">
                <Download size={18} />
              </div>
              <span className="action-text">导出</span>
            </button>

            <button
              className="quick-action-square-btn action-tasks"
              type="button"
              onClick={() => setActiveTab("io")}
              title="导入数据"
            >
              <div className="action-icon-circle tasks">
                <Upload size={18} />
              </div>
              <span className="action-text">导入</span>
            </button>

            <button
              className="quick-action-square-btn action-settings"
              type="button"
              onClick={onEditDatabase}
              title="调整连接配置与权限"
            >
              <div className="action-icon-circle settings">
                <Settings size={18} />
              </div>
              <span className="action-text">配置</span>
            </button>

            <button
              className="quick-action-square-btn action-templates"
              type="button"
              onClick={onAddDatabase}
              title="添加更多数据库"
            >
              <div className="action-icon-circle templates">
                <Database size={18} />
              </div>
              <span className="action-text">添加库</span>
            </button>

            <button
              className="quick-action-square-btn action-kill"
              type="button"
              onClick={onDelete}
              title="移除可视化实例"
            >
              <div className="action-icon-circle kill">
                <Trash2 size={18} />
              </div>
              <span className="action-text">移除</span>
            </button>
          </div>
        </div>

        {/* Card 3: 实时探针与健康监控 */}
        <DatabaseProbeCard token={token} database={database} />
      </aside>

      {showCreateTableModal && (
        <CreateTableModal
          token={token}
          database={database}
          onClose={() => setShowCreateTableModal(false)}
          onCreated={(tableName) => {
            setShowCreateTableModal(false);
            void loadTables();
            setSelectedTable(tableName);
            setActiveTab("table");
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Card 3: Database Real-time Health Probe Card
// -------------------------------------------------------------
function DatabaseProbeCard({
  token,
  database
}: {
  token: string;
  database: DatabaseVisualizerInstance;
}) {
  const [latency, setLatency] = useState<number | null>(null);
  const [version, setVersion] = useState<string>("");
  const [totalKeys, setTotalKeys] = useState<number | undefined>(undefined);
  const [memory, setMemory] = useState<string>("");
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: 12 }, () => Math.floor(Math.random() * 3 + 1)));

  const probe = useCallback(async () => {
    try {
      const res = await api.getDatabaseStats(token, database.id);
      if (res.ok) {
        const ms = res.latencyMs ?? 1;
        setLatency(ms);
        if (res.version) setVersion(res.version);
        if (res.totalKeys !== undefined) setTotalKeys(res.totalKeys);
        if (res.memory) setMemory(res.memory);

        setHistory((prev) => [...prev.slice(1), ms]);
      }
    } catch {
      setLatency(null);
    }
  }, [token, database.id]);

  useEffect(() => {
    void probe();
    const interval = window.setInterval(probe, 4000);
    return () => window.clearInterval(interval);
  }, [probe]);

  const maxVal = Math.max(10, ...history);
  const svgWidth = 260;
  const svgHeight = 40;
  const points = history.map((val, idx) => {
    const x = (idx / (history.length - 1)) * svgWidth;
    const y = svgHeight - (val / maxVal) * (svgHeight - 8) - 4;
    return `${x},${y}`;
  });
  const path = `M ${points.join(" L ")}`;

  return (
    <div className="glass-panel instance-side-card instance-probe-card">
      <div className="side-card-header" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} style={{ color: "#10b981" }} />
          <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>实时健康与连通探针</h4>
        </div>
        <span className={`status-tag ${latency !== null ? "online" : "offline"}`}>
          {latency !== null ? "连接正常" : "检测中"}
        </span>
      </div>

      <div className="probe-card-body">
        <div className="probe-kpi-grid">
          <div className="probe-kpi-tile">
            <div className="kpi-label">
              <Clock size={12} />
              <span>往返延迟</span>
            </div>
            <div className="kpi-value-row">
              <strong className="kpi-number">{latency !== null ? `${latency}ms` : "-"}</strong>
              <span className={`kpi-badge ${latency !== null && latency < 20 ? "good" : "warn"}`}>
                {latency !== null && latency < 20 ? "极优" : "正常"}
              </span>
            </div>
          </div>

          <div className="probe-kpi-tile">
            <div className="kpi-label">
              <Shield size={12} />
              <span>引擎版本</span>
            </div>
            <div className="kpi-value-row">
              <strong className="kpi-number" style={{ fontSize: 12 }} title={version || database.engine}>
                {version ? version.slice(0, 14) : database.engine.toUpperCase()}
              </strong>
            </div>
          </div>
        </div>

        {/* Live Sparkline */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#86868b", marginBottom: 4 }}>
            <span>响应延迟波形</span>
            <span>{latency ?? 0} ms</span>
          </div>
          <div style={{ width: "100%", height: 40, background: "rgba(0, 0, 0, 0.03)", borderRadius: 8, overflow: "hidden" }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
              <path d={path} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Table Data Grid View
// -------------------------------------------------------------
function TableDataGrid({
  token,
  database,
  tables,
  selectedTable,
  onSelectTable,
  onCreateTable,
  onRefreshTables
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  tables: DatabaseTableSummary[];
  selectedTable: string;
  onSelectTable: (t: string) => void;
  onCreateTable: () => void;
  onRefreshTables: () => Promise<void> | void;
}) {
  const [dataResponse, setDataResponse] = useState<DatabaseRowsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [showInsertModal, setShowInsertModal] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);

  const fetchRows = useCallback(async () => {
    if (!selectedTable) {
      setDataResponse(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.getDatabaseTableRows(token, database.id, {
        tableName: selectedTable,
        page,
        pageSize,
        search: search.trim() || undefined,
        sortBy,
        sortOrder
      });
      setDataResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取行数据失败");
    } finally {
      setLoading(false);
    }
  }, [token, database.id, selectedTable, page, pageSize, search, sortBy, sortOrder]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const handleSort = (colName: string) => {
    if (sortBy === colName) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(colName);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const handleDeleteRow = async (row: Record<string, unknown>) => {
    if (!dataResponse) return;
    const pkCols = dataResponse.columns.filter((c) => c.primaryKey).map((c) => c.name);
    const pks: Record<string, unknown> = {};
    if (pkCols.length > 0) {
      pkCols.forEach((k) => (pks[k] = row[k]));
    } else {
      // Fallback first column
      const first = dataResponse.columns[0]?.name;
      if (first) pks[first] = row[first];
    }

    if (!window.confirm("确定要删除这条数据吗？此操作无法撤销。")) return;
    try {
      await api.deleteDatabaseTableRow(token, database.id, {
        tableName: selectedTable,
        primaryKeys: pks
      });
      await fetchRows();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除数据失败");
    }
  };

  const handleTruncateTable = async () => {
    if (!window.confirm(`确定要清空表「${selectedTable}」吗？所有记录将被清除！`)) return;
    try {
      await api.truncateDatabaseTable(token, database.id, selectedTable);
      await fetchRows();
      await onRefreshTables();
    } catch (err) {
      alert(err instanceof Error ? err.message : "清空失败");
    }
  };

  const handleDropTable = async () => {
    if (!window.confirm(`⚠️ 高危操作：确定要彻底删除表「${selectedTable}」吗？`)) return;
    try {
      await api.dropDatabaseTable(token, database.id, selectedTable);
      await onRefreshTables();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除表失败");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Sub-action bar */}
      <div className="db-sub-action-bar">
        <div className="db-sub-left">
          {/* Table select dropdown */}
          <div className="db-table-select-wrapper">
            <TableIcon size={14} style={{ color: "#6366f1" }} />
            <select
              className="db-table-dropdown"
              value={selectedTable}
              onChange={(e) => {
                onSelectTable(e.target.value);
                setPage(1);
              }}
            >
              {tables.length === 0 ? (
                <option value="">暂无数据表</option>
              ) : (
                tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} {t.rowCount !== undefined ? `(${t.rowCount})` : ""}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Search field */}
          <div className="db-search-field">
            <Search size={13} style={{ color: "#86868b" }} />
            <input
              placeholder={database.engine === "redis" ? "搜索键名 (如 user:*)..." : "全局搜索行内容..."}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="db-sub-right">
          <button
            className="small-button"
            type="button"
            onClick={() => setShowInsertModal(true)}
            disabled={!selectedTable}
            title={database.engine === "redis" ? "新增键值" : "插入新记录"}
          >
            <Plus size={14} />
            <span>{database.engine === "redis" ? "新增键" : "插入数据"}</span>
          </button>

          {database.engine !== "redis" && selectedTable && (
            <>
              <button
                className="icon-button mini"
                type="button"
                onClick={handleTruncateTable}
                title="清空当前数据表内容"
              >
                <RefreshCw size={14} />
              </button>
              <button
                className="icon-button mini danger-action"
                type="button"
                onClick={handleDropTable}
                title="彻底删除数据表 (DROP TABLE)"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}

          <button
            className="icon-button mini"
            type="button"
            onClick={() => void fetchRows()}
            title="刷新当前表格"
          >
            <RotateCw size={14} />
          </button>
        </div>
      </div>

      {/* Table Data Area */}
      <div className="db-grid-scroll-area">
        {loading ? (
          <div style={{ display: "grid", placeItems: "center", height: 260, color: "#86868b" }}>
            <Loader2 size={28} className="status-spinner" />
          </div>
        ) : error ? (
          <div style={{ padding: 30, textAlign: "center", color: "#dc2626" }}>
            <AlertCircle size={28} style={{ margin: "0 auto 8px" }} />
            <p>{error}</p>
          </div>
        ) : !dataResponse || dataResponse.rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#86868b" }}>
            <TableIcon size={32} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
            <p>该数据表当前无任何记录</p>
            <button
              className="small-button"
              type="button"
              onClick={() => setShowInsertModal(true)}
              style={{ margin: "12px auto 0" }}
            >
              <Plus size={14} /> 立即插入第一条数据
            </button>
          </div>
        ) : (
          <table className="db-glass-table">
            <thead>
              <tr>
                <th style={{ width: 44, textAlign: "center" }}>#</th>
                {dataResponse.columns.map((col) => (
                  <th key={col.name} onClick={() => handleSort(col.name)}>
                    <div className="th-content">
                      {col.primaryKey && <span title="主键 Primary Key"><Key size={12} className="pk-icon" /></span>}
                      <span>{col.name}</span>
                      <span className="col-type-tag">{col.type}</span>
                      {sortBy === col.name && (
                        sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      )}
                    </div>
                  </th>
                ))}
                <th style={{ width: 80, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {dataResponse.rows.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ textAlign: "center", color: "#86868b", fontSize: 11 }}>
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  {dataResponse.columns.map((col) => {
                    const val = row[col.name];
                    const isNull = val === null || val === undefined;
                    return (
                      <td key={col.name} title={String(val ?? "NULL")}>
                        {isNull ? (
                          <span style={{ color: "#94a3b8", fontStyle: "italic", fontSize: 11 }}>NULL</span>
                        ) : typeof val === "object" ? (
                          JSON.stringify(val)
                        ) : (
                          String(val)
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <div className="table-row-actions">
                      <button
                        className="icon-button mini"
                        type="button"
                        onClick={() => setEditingRow(row)}
                        title="编辑此行"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        className="icon-button mini danger-action"
                        type="button"
                        onClick={() => void handleDeleteRow(row)}
                        title="删除此行"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      {dataResponse && dataResponse.total > 0 && (
        <div className="db-pagination-bar">
          <div>
            共 <strong>{dataResponse.total}</strong> 条记录 · 当前第 {dataResponse.page} / {dataResponse.totalPages} 页
          </div>
          <div className="db-page-controls">
            <button
              className="icon-button mini"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(1)}
              title="第一页"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              className="icon-button mini"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              title="上一页"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="page-chip">{page}</span>
            <button
              className="icon-button mini"
              type="button"
              disabled={page >= dataResponse.totalPages}
              onClick={() => setPage((p) => Math.min(dataResponse.totalPages, p + 1))}
              title="下一页"
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="icon-button mini"
              type="button"
              disabled={page >= dataResponse.totalPages}
              onClick={() => setPage(dataResponse.totalPages)}
              title="最后一页"
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>
      )}

      {showInsertModal && dataResponse && (
        <InsertRowModal
          token={token}
          database={database}
          tableName={selectedTable}
          columns={dataResponse.columns}
          onClose={() => setShowInsertModal(false)}
          onInserted={() => {
            setShowInsertModal(false);
            void fetchRows();
            void onRefreshTables();
          }}
        />
      )}

      {editingRow && dataResponse && (
        <EditRowModal
          token={token}
          database={database}
          tableName={selectedTable}
          columns={dataResponse.columns}
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onUpdated={() => {
            setEditingRow(null);
            void fetchRows();
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Table Schema View
// -------------------------------------------------------------
function TableSchemaView({
  token,
  database,
  tables,
  selectedTable,
  onSelectTable
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  tables: DatabaseTableSummary[];
  selectedTable: string;
  onSelectTable: (t: string) => void;
}) {
  const [schema, setSchema] = useState<DatabaseTableSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchSchema = useCallback(async () => {
    if (!selectedTable) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.getDatabaseTableSchema(token, database.id, selectedTable);
      setSchema(res.schema);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取表结构失败");
    } finally {
      setLoading(false);
    }
  }, [token, database.id, selectedTable]);

  useEffect(() => {
    void fetchSchema();
  }, [fetchSchema]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="db-sub-action-bar">
        <div className="db-sub-left">
          <div className="db-table-select-wrapper">
            <Columns size={14} style={{ color: "#6366f1" }} />
            <select
              className="db-table-dropdown"
              value={selectedTable}
              onChange={(e) => onSelectTable(e.target.value)}
            >
              {tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="db-sub-right">
          <button className="icon-button mini" type="button" onClick={() => void fetchSchema()} title="刷新结构">
            <RotateCw size={14} />
          </button>
        </div>
      </div>

      <div className="db-schema-scroll-area">
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}><Loader2 size={24} className="status-spinner" /></div>
        ) : error ? (
          <div style={{ color: "#dc2626", padding: 20 }}>{error}</div>
        ) : schema ? (
          <>
            <div className="schema-section-card">
              <div className="schema-section-title">
                <Columns size={16} />
                <span>字段定义与约束 ({schema.columns.length})</span>
              </div>
              <table className="db-glass-table">
                <thead>
                  <tr>
                    <th>字段名称</th>
                    <th>类型</th>
                    <th>主键</th>
                    <th>非空 (NOT NULL)</th>
                    <th>自增</th>
                    <th>默认值</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.columns.map((c) => (
                    <tr key={c.name}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td><span className="col-type-tag">{c.type}</span></td>
                      <td>{c.primaryKey ? <Key size={14} className="pk-icon" /> : "-"}</td>
                      <td>{c.notNull ? <Check size={14} style={{ color: "#10b981" }} /> : "-"}</td>
                      <td>{c.autoIncrement ? <Check size={14} style={{ color: "#6366f1" }} /> : "-"}</td>
                      <td style={{ color: "#86868b" }}>{c.defaultValue ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {schema.indexes && schema.indexes.length > 0 && (
              <div className="schema-section-card">
                <div className="schema-section-title">
                  <Key size={16} />
                  <span>索引定义 ({schema.indexes.length})</span>
                </div>
                <table className="db-glass-table">
                  <thead>
                    <tr>
                      <th>索引名称</th>
                      <th>唯一索引</th>
                      <th>覆盖字段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schema.indexes.map((idx) => (
                      <tr key={idx.name}>
                        <td style={{ fontWeight: 600 }}>{idx.name}</td>
                        <td>{idx.unique ? "UNIQUE" : "NORMAL"}</td>
                        <td>{idx.columns.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {schema.ddl && (
              <div className="schema-section-card">
                <div className="schema-section-title">
                  <FileCode size={16} />
                  <span>DDL 建表语句</span>
                </div>
                <pre className="ddl-code-box">{schema.ddl}</pre>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Interactive SQL / CLI Console View
// -------------------------------------------------------------
function DatabaseTerminalConsole({
  token,
  database,
  tables,
  selectedTable,
  onExecRef
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  tables: DatabaseTableSummary[];
  selectedTable: string;
  onExecRef?: (fn: (cmd: string) => void) => void;
}) {
  const isRedis = database.engine === "redis";
  const [sql, setSql] = useState(
    isRedis
      ? "PING"
      : selectedTable
      ? `SELECT * FROM "${selectedTable}" LIMIT 50;`
      : "SELECT 1;"
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DatabaseQueryResult | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const execute = useCallback(async (queryToRun?: string) => {
    const q = (queryToRun || sql).trim();
    if (!q) return;

    setRunning(true);
    try {
      const res = await api.executeDatabaseQuery(token, database.id, { sql: q });
      setResult(res.result);
      setHistory((prev) => [q, ...prev.filter((item) => item !== q)].slice(0, 20));
    } catch (err) {
      setResult({
        columns: [],
        rows: [],
        totalRows: 0,
        executionTimeMs: 0,
        error: err instanceof Error ? err.message : "执行失败"
      });
    } finally {
      setRunning(false);
    }
  }, [token, database.id, sql]);

  useEffect(() => {
    if (onExecRef) {
      onExecRef((cmd) => {
        setSql(cmd);
        void execute(cmd);
      });
    }
  }, [onExecRef, execute]);

  const snippets = isRedis
    ? ["PING", "INFO server", "DBSIZE", "KEYS *", 'SET test:demo "hello"', "GET test:demo", "TTL test:demo"]
    : [
        selectedTable ? `SELECT * FROM "${selectedTable}" LIMIT 20;` : "SELECT 1;",
        selectedTable ? `SELECT count(*) FROM "${selectedTable}";` : "SHOW TABLES;",
        "EXPLAIN SELECT 1;"
      ];

  return (
    <div className="db-console-wrapper">
      {/* Meta Bar */}
      <div className="console-meta-bar">
        <span>
          {isRedis ? "Redis 命令行交互环境" : "交互式 SQL 终端 (支持 SELECT, DDL, DML 等)"}
        </span>
        {result && (
          <span>
            耗时: <strong>{result.executionTimeMs}ms</strong>
            {result.totalRows !== undefined && ` · ${result.totalRows} 行数据`}
            {result.affectedRows !== undefined && ` · 影响 ${result.affectedRows} 行`}
          </span>
        )}
      </div>

      {/* Results View */}
      <div className="db-console-results-area">
        {result?.error ? (
          <div style={{ color: "#f87171", background: "rgba(239, 68, 68, 0.12)", padding: 14, borderRadius: 10, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
            <strong>执行错误:</strong>
            <p style={{ margin: "6px 0 0", fontFamily: "monospace" }}>{result.error}</p>
          </div>
        ) : result?.rows && result.rows.length > 0 ? (
          <table className="db-glass-table" style={{ background: "transparent" }}>
            <thead>
              <tr>
                {result.columns.map((c) => (
                  <th key={c} style={{ background: "rgba(15, 23, 42, 0.7)", color: "#94a3b8" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, idx) => (
                <tr key={idx}>
                  {result.columns.map((c) => (
                    <td key={c} style={{ color: "#e2e8f0" }}>
                      {typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c] ?? "NULL")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : result ? (
          <div style={{ color: "#34d399", padding: 20, textAlign: "center" }}>
            ✓ 命令执行成功 (影响 {result.affectedRows ?? 0} 行)
          </div>
        ) : (
          <div style={{ color: "#64748b", textAlign: "center", padding: 40 }}>
            在下方输入命令并按回车或点击执行按钮
          </div>
        )}
      </div>

      {/* Quick Snippets Bar */}
      <div className="console-snippets-bar">
        <span style={{ fontSize: 11, color: "#64748b" }}>常用快捷指令:</span>
        {snippets.map((snip) => (
          <button
            key={snip}
            type="button"
            className="snippet-chip"
            onClick={() => {
              setSql(snip);
              void execute(snip);
            }}
          >
            {snip}
          </button>
        ))}
      </div>

      {/* Bottom Command Row matching Ordinary Instance */}
      <form
        className="terminal-command-row"
        style={{ margin: "10px 14px 14px", borderRadius: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void execute();
        }}
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <button
            type="button"
            className="icon-button mini"
            title="历史命令"
            onClick={() => setShowHistory((v) => !v)}
            style={{ marginLeft: 6 }}
          >
            <Clock size={15} />
          </button>

          {showHistory && (
            <div className="glass-panel terminal-history-popover" style={{ bottom: "calc(100% + 12px)" }}>
              <div className="terminal-history-header">
                <span>历史记录</span>
                <span className="terminal-history-count">{history.length} 条</span>
              </div>
              <div className="terminal-history-list">
                {history.length === 0 ? (
                  <div className="terminal-history-empty">暂无历史命令</div>
                ) : (
                  history.map((cmd, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="terminal-history-item"
                      onClick={() => {
                        setSql(cmd);
                        setShowHistory(false);
                      }}
                    >
                      <span className="history-cmd-text">{cmd}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <input
          className="terminal-cmd-input"
          style={{
            background: "transparent",
            backgroundColor: "transparent",
            border: "none",
            boxShadow: "none",
            outline: "none"
          }}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder={isRedis ? "输入 Redis 命令 (如 GET / SET / HGETALL / KEYS)..." : "输入 SQL 语句按回车执行..."}
        />

        <button
          className="terminal-send-btn"
          type="submit"
          disabled={running || !sql.trim()}
          title="执行命令"
        >
          {running ? <Loader2 size={16} className="status-spinner" /> : <ArrowRight size={18} />}
        </button>
      </form>
    </div>
  );
}

// -------------------------------------------------------------
// Database Import & Export View
// -------------------------------------------------------------
function DatabaseImportExportView({
  token,
  database,
  tables,
  selectedTable,
  onRefreshTables
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  tables: DatabaseTableSummary[];
  selectedTable: string;
  onRefreshTables: () => Promise<void> | void;
}) {
  const [exportFormat, setExportFormat] = useState<"csv" | "json" | "sql">("csv");
  const [exportTableTarget, setExportTableTarget] = useState(selectedTable || "");
  const [exporting, setExporting] = useState(false);

  const [importFormat, setImportFormat] = useState<"csv" | "json" | "sql">("csv");
  const [importTableTarget, setImportTableTarget] = useState(selectedTable || "");
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importContent, setImportContent] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>("");

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.exportDatabaseData(token, database.id, {
        tableName: exportTableTarget || undefined,
        format: exportFormat
      });
      const blob = new Blob([res.content], { type: res.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importContent.trim()) {
      alert("请填入导入数据文本或选择文件");
      return;
    }
    setImporting(true);
    setImportResult("");
    try {
      const res = await api.importDatabaseData(token, database.id, {
        tableName: importTableTarget || undefined,
        format: importFormat,
        content: importContent,
        mode: importMode
      });
      setImportResult(res.message || `成功导入 ${res.importedRows} 条记录`);
      setImportContent("");
      await onRefreshTables();
    } catch (err) {
      alert(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="db-transfer-container">
      {/* Export Card */}
      <div className="transfer-card">
        <div className="transfer-header">
          <div className="transfer-icon-badge">
            <Download size={20} />
          </div>
          <div>
            <h3>数据导出 (Export)</h3>
            <span style={{ fontSize: 12, color: "#86868b" }}>
              下载表数据为 CSV、JSON 结构或 SQL 备份脚本
            </span>
          </div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
          选择导出目标
          <select
            value={exportTableTarget}
            onChange={(e) => setExportTableTarget(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)" }}
          >
            <option value="">整个数据库 (全部数据表)</option>
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                数据表: {t.name} ({t.rowCount ?? 0} 行)
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>导出文件格式</span>
          <div className="transfer-format-selector">
            <button
              type="button"
              className={`format-pill ${exportFormat === "csv" ? "active" : ""}`}
              onClick={() => setExportFormat("csv")}
            >
              CSV 表格
            </button>
            <button
              type="button"
              className={`format-pill ${exportFormat === "json" ? "active" : ""}`}
              onClick={() => setExportFormat("json")}
            >
              JSON 数组
            </button>
            <button
              type="button"
              className={`format-pill ${exportFormat === "sql" ? "active" : ""}`}
              onClick={() => setExportFormat("sql")}
            >
              SQL 转储
            </button>
          </div>
        </div>

        <button
          className="primary-button"
          type="button"
          disabled={exporting}
          onClick={() => void handleExport()}
          style={{ marginTop: "auto" }}
        >
          {exporting ? <Loader2 size={16} className="status-spinner" /> : <Download size={16} />}
          <span>{exporting ? "导出中..." : "立即导出并下载"}</span>
        </button>
      </div>

      {/* Import Card */}
      <div className="transfer-card">
        <div className="transfer-header">
          <div className="transfer-icon-badge" style={{ background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}>
            <Upload size={20} />
          </div>
          <div>
            <h3>数据导入 (Import)</h3>
            <span style={{ fontSize: 12, color: "#86868b" }}>
              通过 CSV、JSON 或 SQL 脚本批量填充数据
            </span>
          </div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
          导入目标表
          <select
            value={importTableTarget}
            onChange={(e) => setImportTableTarget(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)" }}
          >
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                数据表: {t.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>数据格式</span>
            <div className="transfer-format-selector">
              <button
                type="button"
                className={`format-pill ${importFormat === "csv" ? "active" : ""}`}
                onClick={() => setImportFormat("csv")}
              >
                CSV
              </button>
              <button
                type="button"
                className={`format-pill ${importFormat === "json" ? "active" : ""}`}
                onClick={() => setImportFormat("json")}
              >
                JSON
              </button>
              <button
                type="button"
                className={`format-pill ${importFormat === "sql" ? "active" : ""}`}
                onClick={() => setImportFormat("sql")}
              >
                SQL
              </button>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>导入模式</span>
            <div className="transfer-format-selector">
              <button
                type="button"
                className={`format-pill ${importMode === "append" ? "active" : ""}`}
                onClick={() => setImportMode("append")}
              >
                追加 (Append)
              </button>
              <button
                type="button"
                className={`format-pill ${importMode === "replace" ? "active" : ""}`}
                onClick={() => setImportMode("replace")}
              >
                覆盖 (Replace)
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>数据内容</span>
            <input
              type="file"
              accept=".csv,.json,.sql,.txt"
              style={{ fontSize: 11 }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const r = new FileReader();
                  r.onload = () => setImportContent(String(r.result || ""));
                  r.readAsText(f);
                }
              }}
            />
          </div>
          <textarea
            rows={5}
            placeholder="粘贴 CSV 文本、JSON 数组或 SQL 脚本，或使用上方按钮选择本地文件..."
            value={importContent}
            onChange={(e) => setImportContent(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.1)",
              fontFamily: "monospace",
              fontSize: 12
            }}
          />
        </div>

        {importResult && (
          <div style={{ padding: 10, borderRadius: 8, background: "rgba(16,185,129,0.12)", color: "#059669", fontSize: 12, fontWeight: 600 }}>
            {importResult}
          </div>
        )}

        <button
          className="primary-button"
          type="button"
          disabled={importing || !importContent.trim()}
          onClick={() => void handleImport()}
        >
          {importing ? <Loader2 size={16} className="status-spinner" /> : <Upload size={16} />}
          <span>{importing ? "导入处理中..." : "开始导入"}</span>
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Insert Row Modal (Supports SQL and Redis Key creation)
// -------------------------------------------------------------
function InsertRowModal({
  token,
  database,
  tableName,
  columns,
  onClose,
  onInserted
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  tableName: string;
  columns: DatabaseColumnInfo[];
  onClose: () => void;
  onInserted: () => void;
}) {
  const isRedis = database.engine === "redis";
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(formData)) {
        if (v !== "") {
          payload[k] = v;
        }
      }

      await api.insertDatabaseTableRow(token, database.id, {
        tableName,
        row: payload
      });
      onInserted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "插入记录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Plus size={20} />
            </div>
            <div>
              <h3 className="modal-title">{isRedis ? "新增 Redis 键值" : `插入数据行 (${tableName})`}</h3>
              <span className="modal-subtitle">填写字段信息并提交到数据库</span>
            </div>
          </div>
          <button className="icon-button mini modal-close-btn" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="glass-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {error && (
              <div className="connection-test-alert error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {isRedis ? (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  键名 (Key Name) *
                  <input
                    required
                    placeholder="user:profile:1001"
                    value={formData.key || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, key: e.target.value }))}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  类型 (Type)
                  <select
                    value={formData.type || "string"}
                    onChange={(e) => setFormData((p) => ({ ...p, type: e.target.value }))}
                  >
                    <option value="string">String (字符串)</option>
                    <option value="hash">Hash (哈希映射)</option>
                    <option value="list">List (列表)</option>
                    <option value="set">Set (集合)</option>
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  键值 (Value)
                  <textarea
                    rows={4}
                    placeholder='例如: "Hello Redis" 或 JSON 字符串'
                    value={formData.value || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, value: e.target.value }))}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  过期时间 TTL (秒，留空或 -1 为永久不过期)
                  <input
                    type="number"
                    placeholder="-1"
                    value={formData.ttl || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, ttl: e.target.value }))}
                  />
                </label>
              </>
            ) : (
              columns.map((col) => (
                <label key={col.name} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{col.name} {col.primaryKey && <Key size={12} className="pk-icon" />}</span>
                    <span className="col-type-tag">{col.type}</span>
                  </div>
                  <input
                    placeholder={col.autoIncrement ? "留空以自动生成 (自增)" : col.defaultValue ? `默认值: ${col.defaultValue}` : "留空则设为 NULL"}
                    value={formData[col.name] || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, [col.name]: e.target.value }))}
                  />
                </label>
              ))
            )}
          </div>

          <div className="glass-modal-footer">
            <button className="ghost-button" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? <Loader2 size={16} className="status-spinner" /> : <Plus size={16} />}
              <span>{submitting ? "提交中..." : "保存数据"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Edit Row Modal
// -------------------------------------------------------------
function EditRowModal({
  token,
  database,
  tableName,
  columns,
  row,
  onClose,
  onUpdated
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  tableName: string;
  columns: DatabaseColumnInfo[];
  row: Record<string, unknown>;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const isRedis = database.engine === "redis";
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of columns) {
      init[c.name] = row[c.name] !== null && row[c.name] !== undefined ? String(row[c.name]) : "";
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const pks: Record<string, unknown> = {};
      const vals: Record<string, unknown> = {};

      const pkCols = columns.filter((c) => c.primaryKey);
      if (pkCols.length > 0) {
        pkCols.forEach((c) => (pks[c.name] = row[c.name]));
      } else {
        const first = columns[0]?.name;
        if (first) pks[first] = row[first];
      }

      for (const [k, v] of Object.entries(formData)) {
        vals[k] = v;
      }

      await api.updateDatabaseTableRow(token, database.id, {
        tableName,
        primaryKeys: pks,
        values: vals
      });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新记录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Edit3 size={20} />
            </div>
            <div>
              <h3 className="modal-title">{isRedis ? "编辑 Redis 键值" : `编辑行数据 (${tableName})`}</h3>
              <span className="modal-subtitle">修改值并保存变更</span>
            </div>
          </div>
          <button className="icon-button mini modal-close-btn" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="glass-modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {error && (
              <div className="connection-test-alert error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {columns.map((col) => (
              <label key={col.name} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{col.name} {col.primaryKey && <Key size={12} className="pk-icon" />}</span>
                  <span className="col-type-tag">{col.type}</span>
                </div>
                <input
                  disabled={col.primaryKey}
                  value={formData[col.name] ?? ""}
                  onChange={(e) => setFormData((p) => ({ ...p, [col.name]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <div className="glass-modal-footer">
            <button className="ghost-button" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? <Loader2 size={16} className="status-spinner" /> : <Save size={16} />}
              <span>{submitting ? "保存中..." : "保存修改"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Create Table Modal
// -------------------------------------------------------------
function CreateTableModal({
  token,
  database,
  onClose,
  onCreated
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  onClose: () => void;
  onCreated: (tableName: string) => void;
}) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<DatabaseColumnInfo[]>([
    { name: "id", type: "INTEGER", primaryKey: true, notNull: true, autoIncrement: true },
    { name: "created_at", type: "DATETIME", primaryKey: false, notNull: true },
    { name: "title", type: "VARCHAR(255)", primaryKey: false, notNull: false }
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      { name: `col_${prev.length + 1}`, type: "TEXT", primaryKey: false, notNull: false }
    ]);
  };

  const removeColumn = (index: number) => {
    setColumns((prev) => prev.filter((_, idx) => idx !== index));
  };

  const updateColumn = (index: number, patch: Partial<DatabaseColumnInfo>) => {
    setColumns((prev) => prev.map((col, idx) => (idx === index ? { ...col, ...patch } : col)));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableName.trim()) {
      setError("表名不能为空");
      return;
    }
    if (columns.length === 0) {
      setError("至少需要定义一个字段");
      return;
    }

    setCreating(true);
    setError("");
    try {
      await api.createDatabaseTable(token, database.id, {
        tableName: tableName.trim(),
        columns
      });
      onCreated(tableName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建表失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <TableIcon size={20} />
            </div>
            <div>
              <h3 className="modal-title">新建数据表</h3>
              <span className="modal-subtitle">{database.name} · 自定义字段类型与主键</span>
            </div>
          </div>
          <button className="icon-button mini modal-close-btn" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <div className="glass-modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {error && (
              <div className="connection-test-alert error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>
              数据表名称 (Table Name) *
              <input
                required
                placeholder="例如: users, orders, logs..."
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>表字段列表 ({columns.length})</span>
              <button className="small-button" type="button" onClick={addColumn}>
                <Plus size={14} /> 添加字段
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 300, overflowY: "auto" }}>
              {columns.map((col, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    style={{ flex: 2 }}
                    placeholder="字段名"
                    value={col.name}
                    onChange={(e) => updateColumn(idx, { name: e.target.value })}
                  />
                  <select
                    style={{ flex: 2, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)" }}
                    value={col.type}
                    onChange={(e) => updateColumn(idx, { type: e.target.value })}
                  >
                    <option value="INTEGER">INTEGER</option>
                    <option value="BIGINT">BIGINT</option>
                    <option value="VARCHAR(255)">VARCHAR(255)</option>
                    <option value="TEXT">TEXT</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="FLOAT">FLOAT</option>
                    <option value="DOUBLE">DOUBLE</option>
                    <option value="DATETIME">DATETIME</option>
                    <option value="TIMESTAMP">TIMESTAMP</option>
                    <option value="JSON">JSON</option>
                  </select>

                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      onChange={(e) => updateColumn(idx, { primaryKey: e.target.checked })}
                    />
                    PK
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={col.notNull}
                      onChange={(e) => updateColumn(idx, { notNull: e.target.checked })}
                    />
                    NotNull
                  </label>

                  <button
                    className="icon-button mini danger-action"
                    type="button"
                    onClick={() => removeColumn(idx)}
                    title="移除字段"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-modal-footer">
            <button className="ghost-button" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? <Loader2 size={16} className="status-spinner" /> : <Plus size={16} />}
              <span>{creating ? "创建中..." : "立即创建表"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Add Database Modal (Multi-Engine & Auto-Discover)
// -------------------------------------------------------------
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

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleScan = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await api.discoverDatabases(token, selectedNodeId === "all" ? undefined : selectedNodeId);
      setDiscoveredList(res.databases || []);
    } catch {
      // ignore scan error
    } finally {
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

  // ---------------- 内部共享渲染片段 ----------------
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

        <label>
          <input
            type="checkbox"
            checked={isReadOnly}
            onChange={(e) => setIsReadOnly(e.target.checked)}
          />
          启用只读保护模式 (禁止任何 INSERT / UPDATE / DELETE / DROP 等写操作)
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

  // -------- Embed 模式（创建标准实例弹窗内嵌入）：不再渲染自己的 overlay/container/header --------
  if (embed) {
    return (
      <div className="add-db-modal add-db-modal-embed">
        {innerContent}
      </div>
    );
  }

  // -------- 独立弹窗模式：完整外壳 --------
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

// -------------------------------------------------------------
// Edit Database Modal
// -------------------------------------------------------------
function EditDatabaseModal({
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
