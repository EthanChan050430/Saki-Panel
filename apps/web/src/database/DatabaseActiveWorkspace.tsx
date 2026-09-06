import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Code2,
  Columns,
  Database,
  Download,
  Layers,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Table as TableIcon,
  Terminal,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type {
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseVisualizerInstance,
  ManagedNode
} from "@webops/shared";
import { api, ApiError } from "../api.js";
import { DatabaseProbeCard } from "./DatabaseProbeCard.js";
import { TableDataGrid } from "./TableDataGrid.js";
import { TableSchemaView } from "./TableSchemaView.js";
import { DatabaseTerminalConsole } from "./DatabaseTerminalConsole.js";
import { DatabaseImportExportView } from "./DatabaseImportExportView.js";
import { CreateTableModal } from "./modals/CreateTableModal.js";
import { InsertRowModal } from "./modals/InsertRowModal.js";
import { EditRowModal } from "./modals/EditRowModal.js";
import { EditDatabaseModal } from "./modals/EditDatabaseModal.js";

export function DatabaseActiveWorkspace({
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
                <button
                  className="small-button primary"
                  type="button"
                  onClick={onEditDatabase}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Settings size={13} />
                  修改连接配置
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
