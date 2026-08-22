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
  Loader2
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

  useEffect(() => {
    if (selectedDatabaseId !== undefined) {
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
    () => databases.find((d) => d.id === activeDbId) ?? null,
    [databases, activeDbId]
  );

  const handleDeleteDatabase = async (id: string, name: string) => {
    if (!window.confirm(`确定要移除数据库可视化实例「${name}」吗？（不会删除物理数据库文件）`)) return;
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

  return (
    <div className="database-visualizer-container">
      {/* Top Main Toolbar */}
      <div className="db-master-topbar">
        <div className="db-topbar-left">
          <div className="db-brand-icon">
            <Database size={20} className="db-icon-spin" />
          </div>
          <div className="db-brand-text">
            <h2>数据库可视化工作区</h2>
            <span className="db-brand-subtitle">
              直观操作数据表与字段 · 交互式SQL终端 · 智能节点发现
            </span>
          </div>
        </div>

        <div className="db-topbar-right">
          {/* Database Selector Dropdown */}
          <div className="db-selector-wrapper">
            <Database size={15} className="db-selector-icon" />
            <select
              value={activeDbId ?? ""}
              onChange={(e) => {
                const newId = e.target.value || null;
                setActiveDbId(newId);
                onSelectDatabase?.(newId);
              }}
              className="db-select-dropdown"
            >
              {databases.length === 0 ? (
                <option value="">暂无数据库实例</option>
              ) : (
                databases.map((db) => (
                  <option value={db.id} key={db.id}>
                    {db.name} ({db.engine.toUpperCase()} · {db.nodeName || "本地节点"})
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            className="primary-button create-db-button"
            type="button"
            onClick={() => setShowAddModal(true)}
            title="添加数据库可视化实例"
          >
            <Plus size={16} />
            <span>添加数据库</span>
          </button>

          <button
            className="icon-button mini refresh-db-button"
            type="button"
            onClick={() => void loadDatabases()}
            title="刷新实例列表"
          >
            <RotateCw size={15} />
          </button>

          {onClose && (
            <button
              className="icon-button mini close-db-button"
              type="button"
              onClick={onClose}
              title="关闭数据库可视化"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="page-error db-error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button className="small-button" type="button" onClick={() => void loadDatabases()}>
            重试
          </button>
        </div>
      )}

      {/* Main Workspace Body */}
      {loading && databases.length === 0 ? (
        <div className="db-loading-state">
          <Loader2 size={32} className="status-spinner" />
          <p>正在载入数据库可视化工作区...</p>
        </div>
      ) : databases.length === 0 ? (
        <div className="db-empty-welcome">
          <div className="db-empty-icon-wrap">
            <Database size={48} />
          </div>
          <h3>尚未添加任何数据库可视化实例</h3>
          <p>
            系统支持自动扫描节点中已存在的 SQLite 数据库文件（如工作区/面板数据）以及运行中的 MySQL / PostgreSQL / Redis 数据库服务。
          </p>
          <div className="db-empty-actions">
            <button
              className="primary-button primary-cta"
              type="button"
              onClick={() => setShowAddModal(true)}
            >
              <Sparkles size={16} />
              <span>自动扫描并添加数据库</span>
            </button>
          </div>
        </div>
      ) : activeDatabase ? (
        <DatabaseActiveWorkspace
          token={token}
          database={activeDatabase}
          nodes={nodes}
          onDelete={() => handleDeleteDatabase(activeDatabase.id, activeDatabase.name)}
          onUpdate={loadDatabases}
          darkMode={darkMode}
        />
      ) : (
        <div className="db-empty-welcome">
          <p>请选择一个数据库实例查看详情</p>
        </div>
      )}

      {/* Add / Discover Database Modal */}
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

// -------------------------------------------------------------
// Active Database Workspace (Tabs: Table, Schema, Terminal, IO)
// -------------------------------------------------------------
function DatabaseActiveWorkspace({
  token,
  database,
  nodes,
  onDelete,
  onUpdate,
  darkMode
}: {
  token: string;
  database: DatabaseVisualizerInstance;
  nodes: ManagedNode[];
  onDelete: () => void | Promise<void>;
  onUpdate: () => void | Promise<void>;
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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

  const filteredTables = useMemo(() => {
    if (!tableSearch.trim()) return tables;
    const q = tableSearch.toLowerCase().trim();
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, tableSearch]);

  const activeTableSummary = useMemo(
    () => tables.find((t) => t.name === selectedTable) ?? null,
    [tables, selectedTable]
  );

  return (
    <div className="db-workspace-body">
      {/* Left Sidebar: Table list */}
      {mobileSidebarOpen && (
        <div
          className="db-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <aside className={`db-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`}>
        <div className="db-sidebar-header">
          <div className="db-sidebar-title-row">
            <div className="db-meta-badge">
              <span className={`db-engine-pill ${database.engine}`}>
                {database.engine.toUpperCase()}
              </span>
              <span className="db-node-tag" title={database.nodeName || database.nodeId}>
                {database.nodeName || database.nodeId}
              </span>
            </div>
            <button
              className="icon-button mini new-table-btn"
              type="button"
              onClick={() => setShowCreateTableModal(true)}
              title="新建数据表"
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="db-table-search-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="检索数据表..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="db-search-input"
            />
            {tableSearch && (
              <button
                className="clear-search-btn"
                type="button"
                onClick={() => setTableSearch("")}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="db-table-list">
          {loadingTables && tables.length === 0 ? (
            <div className="db-sidebar-loading">
              <Loader2 size={16} className="status-spinner" />
              <span>载入表中...</span>
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="db-sidebar-empty">
              {tables.length === 0 ? "暂无数据表" : "无匹配结果"}
            </div>
          ) : (
            filteredTables.map((t) => {
              const isSelected = t.name === selectedTable;
              return (
                <button
                  key={t.name}
                  type="button"
                  className={`db-table-item ${isSelected ? "active" : ""}`}
                  onClick={() => {
                    setSelectedTable(t.name);
                    setMobileSidebarOpen(false);
                  }}
                  title={`${t.name} (${t.type === "view" ? "视图" : "表"} · ${t.rowCount ?? 0} 行)`}
                >
                  <div className="table-item-icon">
                    {t.type === "view" ? <Eye size={15} /> : <TableIcon size={15} />}
                  </div>
                  <span className="table-item-name">{t.name}</span>
                  {t.rowCount !== undefined && (
                    <span className="table-item-count">{t.rowCount}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Sidebar Footer Info */}
        <div className="db-sidebar-footer">
          <div className="db-footer-row" title={database.config.path || database.config.host || "-"}>
            <HardDrive size={13} />
            <span className="db-footer-path">
              {database.config.path
                ? database.config.path.split(/[\\/]/).pop() || database.config.path
                : `${database.config.host || "127.0.0.1"}:${database.config.port || ""}`}
            </span>
          </div>
          <div className="db-footer-actions">
            <button
              className="icon-button mini"
              type="button"
              onClick={() => void loadTables()}
              title="刷新表列表"
            >
              <RefreshCw size={13} />
            </button>
            <button
              className="icon-button mini danger-action"
              type="button"
              onClick={onDelete}
              title="移除可视化实例"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* Right Content Area */}
      <main className="db-main-content">
        {/* Workspace Top Tabs */}
        <div className="db-content-header">
          <div className="db-table-identity">
            <button
              className="icon-button mini db-mobile-table-toggle-btn"
              type="button"
              onClick={() => setMobileSidebarOpen((prev) => !prev)}
              title="切换数据表列表"
            >
              <TableIcon size={16} />
            </button>
            <div className="db-identity-icon">
              {activeTableSummary?.type === "view" ? <Eye size={18} /> : <TableIcon size={18} />}
            </div>
            <div className="db-identity-text">
              <h3>{selectedTable || "未选择数据表"}</h3>
              {activeTableSummary && (
                <span className="db-identity-stats">
                  {activeTableSummary.rowCount ?? 0} 条记录 · {activeTableSummary.columnCount ?? 0} 个字段
                </span>
              )}
            </div>
          </div>

          <div className="db-nav-tabs" role="tablist">
            <button
              className={`db-nav-tab ${activeTab === "table" ? "active" : ""}`}
              onClick={() => setActiveTab("table")}
              type="button"
              role="tab"
              aria-selected={activeTab === "table"}
            >
              <FileSpreadsheet size={15} />
              <span>数据表格 (Grid)</span>
            </button>
            <button
              className={`db-nav-tab ${activeTab === "schema" ? "active" : ""}`}
              onClick={() => setActiveTab("schema")}
              type="button"
              role="tab"
              aria-selected={activeTab === "schema"}
            >
              <Columns size={15} />
              <span>表结构 (Schema)</span>
            </button>
            <button
              className={`db-nav-tab ${activeTab === "terminal" ? "active" : ""}`}
              onClick={() => setActiveTab("terminal")}
              type="button"
              role="tab"
              aria-selected={activeTab === "terminal"}
            >
              <Terminal size={15} />
              <span>SQL 终端控制台</span>
            </button>
            <button
              className={`db-nav-tab ${activeTab === "io" ? "active" : ""}`}
              onClick={() => setActiveTab("io")}
              type="button"
              role="tab"
              aria-selected={activeTab === "io"}
            >
              <Upload size={15} />
              <span>导入与导出</span>
            </button>
          </div>
        </div>

        {/* Tab View Container */}
        <div className="db-tab-viewport">
          {tableError ? (
            <div className="page-error">
              <span>{tableError}</span>
              <button className="small-button" type="button" onClick={() => void loadTables()}>
                重试
              </button>
            </div>
          ) : activeTab === "table" ? (
            <TableDataGrid
              token={token}
              databaseId={database.id}
              tableName={selectedTable}
              isReadOnly={database.config.isReadOnly}
              onTableModified={loadTables}
            />
          ) : activeTab === "schema" ? (
            <TableSchemaView
              token={token}
              databaseId={database.id}
              tableName={selectedTable}
              isReadOnly={database.config.isReadOnly}
              onTableDrop={() => {
                setSelectedTable("");
                void loadTables();
              }}
              onTableModified={loadTables}
            />
          ) : activeTab === "terminal" ? (
            <DatabaseTerminalConsole
              token={token}
              databaseId={database.id}
              currentTable={selectedTable}
              isReadOnly={database.config.isReadOnly}
              onTableChanged={loadTables}
            />
          ) : (
            <DatabaseImportExportView
              token={token}
              databaseId={database.id}
              tableName={selectedTable}
              isReadOnly={database.config.isReadOnly}
              onImportComplete={loadTables}
            />
          )}
        </div>
      </main>

      {/* Create Table Modal */}
      {showCreateTableModal && (
        <CreateTableModal
          token={token}
          databaseId={database.id}
          onClose={() => setShowCreateTableModal(false)}
          onCreated={(newTableName) => {
            setShowCreateTableModal(false);
            void loadTables().then(() => setSelectedTable(newTableName));
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Tab 1: Table Data Grid (Spreadsheet-like Visual Operations)
// -------------------------------------------------------------
function TableDataGrid({
  token,
  databaseId,
  tableName,
  isReadOnly,
  onTableModified
}: {
  token: string;
  databaseId: string;
  tableName: string;
  isReadOnly?: boolean | undefined;
  onTableModified: () => void | Promise<void>;
}) {
  const [data, setData] = useState<DatabaseRowsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterVal, setFilterVal] = useState<string>("");

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colName: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [savingRow, setSavingRow] = useState(false);

  // Insert Row Modal
  const [showInsertModal, setShowInsertModal] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!tableName) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.getDatabaseTableRows(token, databaseId, {
        tableName,
        page,
        pageSize,
        search: search.trim() || undefined,
        sortBy,
        sortOrder,
        filterColumn: filterCol || undefined,
        filterValue: filterVal.trim() || undefined
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取数据表记录失败");
    } finally {
      setLoading(false);
    }
  }, [token, databaseId, tableName, page, pageSize, search, sortBy, sortOrder, filterCol, filterVal]);

  useEffect(() => {
    setPage(1);
  }, [tableName, search, filterCol, filterVal, sortBy, sortOrder]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const handleSort = (colName: string) => {
    if (sortBy === colName) {
      if (sortOrder === "asc") setSortOrder("desc");
      else {
        setSortBy(undefined);
        setSortOrder("asc");
      }
    } else {
      setSortBy(colName);
      setSortOrder("asc");
    }
  };

  const handleStartEdit = (rowIndex: number, colName: string, val: unknown) => {
    if (isReadOnly) return;
    setEditingCell({ rowIndex, colName });
    setEditValue(val === null || val === undefined ? "" : String(val));
  };

  const handleSaveEdit = async (row: Record<string, unknown>) => {
    if (!editingCell || !data) return;
    const { colName } = editingCell;
    const pkCols = data.columns.filter((c) => c.primaryKey).map((c) => c.name);
    if (pkCols.length === 0) {
      alert("当前表无主键字段，无法直接行内更新。请使用SQL控制台进行操作。");
      setEditingCell(null);
      return;
    }

    const primaryKeys: Record<string, unknown> = {};
    for (const pk of pkCols) {
      primaryKeys[pk] = row[pk];
    }

    const colMeta = data.columns.find((c) => c.name === colName);
    let convertedVal: unknown = editValue;
    if (editValue === "") {
      convertedVal = colMeta?.notNull ? "" : null;
    } else if (colMeta?.type?.toUpperCase().includes("INT")) {
      const parsed = parseInt(editValue, 10);
      convertedVal = isNaN(parsed) ? editValue : parsed;
    } else if (colMeta?.type?.toUpperCase().includes("REAL") || colMeta?.type?.toUpperCase().includes("FLOAT") || colMeta?.type?.toUpperCase().includes("DOUBLE")) {
      const parsed = parseFloat(editValue);
      convertedVal = isNaN(parsed) ? editValue : parsed;
    }

    setSavingRow(true);
    try {
      await api.updateDatabaseTableRow(token, databaseId, {
        tableName,
        primaryKeys,
        values: { [colName]: convertedVal }
      });
      setEditingCell(null);
      await fetchRows();
      onTableModified();
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新单元格失败");
    } finally {
      setSavingRow(false);
    }
  };

  const handleDeleteRow = async (row: Record<string, unknown>) => {
    if (isReadOnly) return;
    if (!data) return;
    const pkCols = data.columns.filter((c) => c.primaryKey).map((c) => c.name);
    const primaryKeys: Record<string, unknown> = {};
    if (pkCols.length > 0) {
      for (const pk of pkCols) {
        primaryKeys[pk] = row[pk];
      }
    } else {
      // Use all columns if no PK
      for (const col of data.columns) {
        primaryKeys[col.name] = row[col.name];
      }
    }

    if (!window.confirm("确定要删除此行数据吗？")) return;

    try {
      await api.deleteDatabaseTableRow(token, databaseId, {
        tableName,
        primaryKeys
      });
      await fetchRows();
      onTableModified();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除记录失败");
    }
  };

  if (!tableName) {
    return (
      <div className="db-empty-pane">
        <TableIcon size={36} />
        <p>请在左侧选择一张数据表进行浏览与编辑</p>
      </div>
    );
  }

  return (
    <div className="db-grid-pane">
      {/* Grid Action Toolbar */}
      <div className="db-grid-toolbar">
        <div className="db-grid-toolbar-left">
          {/* Global Search */}
          <div className="db-filter-input-wrap">
            <Search size={14} className="filter-icon" />
            <input
              type="text"
              placeholder="模糊搜索当前表..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="db-filter-input"
            />
            {search && (
              <button className="clear-btn" type="button" onClick={() => setSearch("")}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Column Filter */}
          {data && data.columns.length > 0 && (
            <div className="db-col-filter-group">
              <Filter size={14} className="filter-group-icon" />
              <select
                value={filterCol}
                onChange={(e) => setFilterCol(e.target.value)}
                className="db-col-select"
              >
                <option value="">全部列过滤</option>
                {data.columns.map((c) => (
                  <option value={c.name} key={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              {filterCol && (
                <input
                  type="text"
                  placeholder={`按 ${filterCol} 匹配...`}
                  value={filterVal}
                  onChange={(e) => setFilterVal(e.target.value)}
                  className="db-col-val-input"
                />
              )}
            </div>
          )}
        </div>

        <div className="db-grid-toolbar-right">
          {!isReadOnly && (
            <button
              className="primary-button mini insert-row-btn"
              type="button"
              onClick={() => setShowInsertModal(true)}
              title="向当前表插入新行"
            >
              <Plus size={15} />
              <span>添加行</span>
            </button>
          )}

          <button
            className="icon-button mini"
            type="button"
            onClick={() => void fetchRows()}
            title="刷新数据记录"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {error && (
        <div className="page-error grid-error-banner">
          <span>{error}</span>
          <button className="small-button" type="button" onClick={() => void fetchRows()}>
            重试
          </button>
        </div>
      )}

      {/* Table Grid View */}
      <div className="db-grid-scroll-area">
        {loading && !data ? (
          <div className="db-grid-loading">
            <Loader2 size={24} className="status-spinner" />
            <span>加载数据行中...</span>
          </div>
        ) : !data || data.columns.length === 0 ? (
          <div className="db-grid-empty">表中暂无列字段</div>
        ) : (
          <table className="db-glass-table">
            <thead>
              <tr>
                <th className="th-row-num">#</th>
                {data.columns.map((col) => {
                  const isSorted = sortBy === col.name;
                  return (
                    <th
                      key={col.name}
                      onClick={() => handleSort(col.name)}
                      className={`th-column ${isSorted ? "sorted" : ""}`}
                      title={`点击按 ${col.name} 排序`}
                    >
                      <div className="th-content">
                        {col.primaryKey && (
                          <span title="主键 Primary Key">
                            <Key size={13} className="pk-indicator-icon" />
                          </span>
                        )}
                        <span className="col-header-name">{col.name}</span>
                        <span className="col-type-tag">{col.type}</span>
                        <span className="sort-icon-box">
                          {isSorted ? (
                            sortOrder === "asc" ? (
                              <ArrowUp size={13} />
                            ) : (
                              <ArrowDown size={13} />
                            )
                          ) : (
                            <ArrowUpDown size={12} className="sort-idle" />
                          )}
                        </span>
                      </div>
                    </th>
                  );
                })}
                {!isReadOnly && <th className="th-actions">操作</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={data.columns.length + (isReadOnly ? 1 : 2)} className="td-empty-row">
                    暂无匹配的数据记录
                  </td>
                </tr>
              ) : (
                data.rows.map((row, rIdx) => {
                  const rowNum = (page - 1) * pageSize + rIdx + 1;
                  return (
                    <tr key={rIdx} className="db-data-row">
                      <td className="td-row-num">{rowNum}</td>
                      {data.columns.map((col) => {
                        const val = row[col.name];
                        const isEditing =
                          editingCell?.rowIndex === rIdx && editingCell?.colName === col.name;
                        const isNull = val === null || val === undefined;

                        return (
                          <td
                            key={col.name}
                            className={`td-cell ${isNull ? "null-cell" : ""}`}
                            onDoubleClick={() => handleStartEdit(rIdx, col.name, val)}
                          >
                            {isEditing ? (
                              <div className="inline-edit-wrapper">
                                <input
                                  type="text"
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleSaveEdit(row);
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                  className="inline-edit-input"
                                />
                                <button
                                  className="icon-button mini inline-save-btn"
                                  type="button"
                                  disabled={savingRow}
                                  onClick={() => void handleSaveEdit(row)}
                                  title="保存 (Enter)"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  className="icon-button mini inline-cancel-btn"
                                  type="button"
                                  onClick={() => setEditingCell(null)}
                                  title="取消 (Esc)"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <div className="cell-view-wrapper">
                                <span className="cell-text">
                                  {isNull ? <em className="null-label">NULL</em> : String(val)}
                                </span>
                                {!isReadOnly && (
                                  <button
                                    className="cell-hover-edit-btn"
                                    type="button"
                                    onClick={() => handleStartEdit(rIdx, col.name, val)}
                                    title="双击或点击编辑单元格"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {!isReadOnly && (
                        <td className="td-actions">
                          <div className="row-action-btns">
                            <button
                              className="icon-button mini copy-row-btn"
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(row, null, 2));
                                alert("已将行数据复制为 JSON 文本");
                              }}
                              title="复制此行 JSON"
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              className="icon-button mini delete-row-btn danger-action"
                              type="button"
                              onClick={() => void handleDeleteRow(row)}
                              title="删除此行数据"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Grid Pagination Footer */}
      {data && (
        <div className="db-pagination-bar">
          <div className="pagination-info">
            <span>
              共 <strong>{data.total}</strong> 条记录 · 当前第 <strong>{data.page}</strong> /{" "}
              <strong>{data.totalPages}</strong> 页
            </span>
          </div>

          <div className="pagination-controls">
            <div className="page-size-selector">
              <span>每页</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="page-size-select"
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
              <span>条</span>
            </div>

            <div className="page-buttons">
              <button
                className="icon-button mini page-btn"
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(1)}
                title="首页"
              >
                <ChevronsLeft size={16} />
              </button>
              <button
                className="icon-button mini page-btn"
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                title="上一页"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="page-current-badge">{page}</span>
              <button
                className="icon-button mini page-btn"
                type="button"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                title="下一页"
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="icon-button mini page-btn"
                type="button"
                disabled={page >= data.totalPages}
                onClick={() => setPage(data.totalPages)}
                title="末页"
              >
                <ChevronsRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insert Row Modal */}
      {showInsertModal && data && (
        <InsertRowModal
          token={token}
          databaseId={databaseId}
          tableName={tableName}
          columns={data.columns}
          onClose={() => setShowInsertModal(false)}
          onInserted={() => {
            setShowInsertModal(false);
            void fetchRows();
            onTableModified();
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Insert Row Modal
// -------------------------------------------------------------
function InsertRowModal({
  token,
  databaseId,
  tableName,
  columns,
  onClose,
  onInserted
}: {
  token: string;
  databaseId: string;
  tableName: string;
  columns: DatabaseColumnInfo[];
  onClose: () => void;
  onInserted: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [nullFields, setNullFields] = useState<Record<string, boolean>>({});
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInserting(true);
    setError("");

    const rowObj: Record<string, unknown> = {};
    for (const col of columns) {
      if (nullFields[col.name]) {
        rowObj[col.name] = null;
      } else if (form[col.name] !== undefined) {
        const valStr = form[col.name]!;
        if (valStr === "" && !col.notNull) {
          rowObj[col.name] = null;
        } else if (col.type.toUpperCase().includes("INT")) {
          const num = parseInt(valStr, 10);
          rowObj[col.name] = isNaN(num) ? valStr : num;
        } else if (
          col.type.toUpperCase().includes("REAL") ||
          col.type.toUpperCase().includes("FLOAT") ||
          col.type.toUpperCase().includes("DOUBLE")
        ) {
          const flt = parseFloat(valStr);
          rowObj[col.name] = isNaN(flt) ? valStr : flt;
        } else {
          rowObj[col.name] = valStr;
        }
      }
    }

    try {
      await api.insertDatabaseTableRow(token, databaseId, {
        tableName,
        row: rowObj
      });
      onInserted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "插入记录失败");
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container db-insert-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Plus size={18} />
            </div>
            <div>
              <h3 className="modal-title">插入新记录</h3>
              <span className="modal-subtitle">向表「{tableName}」添加一行新数据</span>
            </div>
          </div>
          <button className="icon-button mini" type="button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="db-insert-form">
          <div className="glass-modal-body db-insert-body">
            {error && <div className="page-error modal-error">{error}</div>}

            <div className="db-fields-grid">
              {columns.map((col) => {
                const isAutoInc = col.autoIncrement;
                const isNull = Boolean(nullFields[col.name]);
                return (
                  <div key={col.name} className="db-form-field-card">
                    <div className="field-header">
                      <label htmlFor={`field-${col.name}`} className="field-label">
                        {col.primaryKey && (
                          <span title="主键 Primary Key">
                            <Key size={13} className="pk-icon" />
                          </span>
                        )}
                        <span className="field-name">{col.name}</span>
                        <span className="field-type-pill">{col.type}</span>
                        {col.notNull ? (
                          <span className="not-null-pill">NOT NULL</span>
                        ) : (
                          <span className="nullable-pill">NULLABLE</span>
                        )}
                      </label>

                      {!col.notNull && (
                        <label className="null-checkbox-wrap">
                          <input
                            type="checkbox"
                            checked={isNull}
                            onChange={(e) =>
                              setNullFields((prev) => ({ ...prev, [col.name]: e.target.checked }))
                            }
                          />
                          <span>设为 NULL</span>
                        </label>
                      )}
                    </div>

                    <input
                      id={`field-${col.name}`}
                      type="text"
                      disabled={isNull}
                      placeholder={
                        isAutoInc
                          ? "自增主键（留空自动生成）"
                          : col.defaultValue !== null && col.defaultValue !== undefined
                            ? `默认值: ${col.defaultValue}`
                            : isNull
                              ? "NULL"
                              : "输入字段值..."
                      }
                      value={form[col.name] ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, [col.name]: e.target.value }))
                      }
                      className="db-field-text-input"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-modal-footer">
            <button className="ghost-button" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" type="submit" disabled={inserting}>
              {inserting ? <Loader2 size={16} className="status-spinner" /> : <Check size={16} />}
              <span>{inserting ? "插入中..." : "确认插入"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Tab 2: Table Schema View (Columns, Indexes, DDL, Drop/Truncate)
// -------------------------------------------------------------
function TableSchemaView({
  token,
  databaseId,
  tableName,
  isReadOnly,
  onTableDrop,
  onTableModified
}: {
  token: string;
  databaseId: string;
  tableName: string;
  isReadOnly?: boolean | undefined;
  onTableDrop: () => void | Promise<void>;
  onTableModified: () => void | Promise<void>;
}) {
  const [schema, setSchema] = useState<DatabaseTableSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchSchema = useCallback(async () => {
    if (!tableName) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.getDatabaseTableSchema(token, databaseId, tableName);
      setSchema(res.schema);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取表结构失败");
    } finally {
      setLoading(false);
    }
  }, [token, databaseId, tableName]);

  useEffect(() => {
    void fetchSchema();
  }, [fetchSchema]);

  const handleTruncateTable = async () => {
    if (isReadOnly) return;
    if (!window.confirm(`确定要清空数据表「${tableName}」的所有记录吗？此操作不可逆！`)) return;
    try {
      await api.truncateDatabaseTable(token, databaseId, tableName);
      alert("数据表已成功清空");
      onTableModified();
    } catch (err) {
      alert(err instanceof Error ? err.message : "清空数据表失败");
    }
  };

  const handleDropTable = async () => {
    if (isReadOnly) return;
    if (!window.confirm(`⚠️ 危险操作：确定要彻底删除数据表「${tableName}」吗？所有数据和结构都将被销毁！`)) return;
    try {
      await api.dropDatabaseTable(token, databaseId, tableName);
      alert(`数据表「${tableName}」已删除`);
      onTableDrop();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除数据表失败");
    }
  };

  if (!tableName) {
    return (
      <div className="db-empty-pane">
        <Columns size={36} />
        <p>请选择一个数据表查看其字段结构与DDL定义</p>
      </div>
    );
  }

  return (
    <div className="db-schema-pane">
      <div className="db-schema-header-bar">
        <div className="schema-title-wrap">
          <h4>表结构定义与元数据</h4>
          <span>{tableName}</span>
        </div>

        {!isReadOnly && (
          <div className="schema-actions">
            <button
              className="ghost-button mini danger-action"
              type="button"
              onClick={() => void handleTruncateTable()}
              title="清空表内全部数据行"
            >
              <RotateCw size={14} />
              <span>清空表 (Truncate)</span>
            </button>

            <button
              className="ghost-button mini danger-action"
              type="button"
              onClick={() => void handleDropTable()}
              title="删除整张数据表"
            >
              <Trash2 size={14} />
              <span>删除表 (Drop Table)</span>
            </button>
          </div>
        )}
      </div>

      {error && <div className="page-error">{error}</div>}

      {loading && !schema ? (
        <div className="db-grid-loading">
          <Loader2 size={24} className="status-spinner" />
          <span>正在读取字段与索引定义...</span>
        </div>
      ) : schema ? (
        <div className="db-schema-content-scroll">
          {/* Columns Table */}
          <section className="schema-section">
            <h5 className="section-title">
              <Columns size={16} />
              <span>字段列表 ({schema.columns.length})</span>
            </h5>
            <table className="db-glass-table schema-cols-table">
              <thead>
                <tr>
                  <th>字段名称</th>
                  <th>数据类型</th>
                  <th>主键 (PK)</th>
                  <th>非空 (NOT NULL)</th>
                  <th>默认值</th>
                </tr>
              </thead>
              <tbody>
                {schema.columns.map((col) => (
                  <tr key={col.name}>
                    <td className="td-col-name">
                      <span className="col-name-bold">{col.name}</span>
                    </td>
                    <td>
                      <span className="col-type-tag">{col.type}</span>
                    </td>
                    <td>
                      {col.primaryKey ? (
                        <span className="status-pill green">
                          <Key size={12} /> PRIMARY KEY {col.autoIncrement ? "(AUTO)" : ""}
                        </span>
                      ) : (
                        <span className="status-pill gray">-</span>
                      )}
                    </td>
                    <td>
                      {col.notNull ? (
                        <span className="status-pill orange">YES</span>
                      ) : (
                        <span className="status-pill gray">NULL</span>
                      )}
                    </td>
                    <td>
                      <span className="dflt-val-text">{col.defaultValue ?? "-"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Indexes */}
          {schema.indexes && schema.indexes.length > 0 && (
            <section className="schema-section">
              <h5 className="section-title">
                <Layers size={16} />
                <span>索引信息 ({schema.indexes.length})</span>
              </h5>
              <div className="indexes-list">
                {schema.indexes.map((idx) => (
                  <div key={idx.name} className="index-card">
                    <div className="index-header">
                      <span className="index-name">{idx.name}</span>
                      {idx.unique && <span className="status-pill blue">UNIQUE</span>}
                    </div>
                    <div className="index-cols">
                      <span>包含字段：</span>
                      <strong>{idx.columns.join(", ") || "-"}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* DDL SQL Block */}
          {schema.ddl && (
            <section className="schema-section">
              <div className="ddl-header">
                <h5 className="section-title">
                  <FileCode size={16} />
                  <span>DDL 建表语句</span>
                </h5>
                <button
                  className="icon-button mini"
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(schema.ddl || "");
                    alert("已复制 DDL 语句到剪贴板");
                  }}
                  title="复制 DDL"
                >
                  <Copy size={14} />
                </button>
              </div>
              <pre className="db-ddl-code-block">{schema.ddl}</pre>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------
// Tab 3: Database Terminal & SQL Console
// -------------------------------------------------------------
function DatabaseTerminalConsole({
  token,
  databaseId,
  currentTable,
  isReadOnly,
  onTableChanged
}: {
  token: string;
  databaseId: string;
  currentTable?: string | undefined;
  isReadOnly?: boolean | undefined;
  onTableChanged: () => void | Promise<void>;
}) {
  const [sql, setSql] = useState<string>(
    currentTable ? `SELECT * FROM "${currentTable}" LIMIT 50;` : "SELECT sqlite_version();"
  );
  const [executing, setExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<DatabaseQueryResult | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [resultViewMode, setResultViewMode] = useState<"table" | "json" | "raw">("table");

  useEffect(() => {
    if (currentTable) {
      setSql(`SELECT * FROM "${currentTable}" LIMIT 50;`);
    }
  }, [currentTable]);

  const handleExecute = async () => {
    if (!sql.trim() || executing) return;
    setExecuting(true);
    try {
      const res = await api.executeDatabaseQuery(token, databaseId, { sql });
      setQueryResult(res.result);
      setHistory((prev) => [sql, ...prev.filter((h) => h !== sql)].slice(0, 30));
      if (!/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)) {
        onTableChanged();
      }
    } catch (err) {
      setQueryResult({
        columns: [],
        rows: [],
        totalRows: 0,
        executionTimeMs: 0,
        error: err instanceof Error ? err.message : "SQL 执行遇到异常"
      });
    } finally {
      setExecuting(false);
    }
  };

  const quickSnippets = [
    { label: "查询前50条", template: currentTable ? `SELECT * FROM "${currentTable}" LIMIT 50;` : "SELECT * FROM tableName LIMIT 50;" },
    { label: "统计行数", template: currentTable ? `SELECT count(*) as total_rows FROM "${currentTable}";` : "SELECT count(*) FROM tableName;" },
    { label: "查看表结构", template: currentTable ? `PRAGMA table_info("${currentTable}");` : "PRAGMA table_info(tableName);" },
    { label: "列出全部表", template: "SELECT name, type FROM sqlite_master WHERE type='table' OR type='view';" },
    { label: "数据库碎片整理", template: "VACUUM;" }
  ];

  return (
    <div className="db-terminal-pane">
      {/* Query Editor Box */}
      <div className="db-sql-editor-card">
        <div className="sql-editor-toolbar">
          <div className="quick-snippets">
            <span className="snippet-hint">常用指令：</span>
            {quickSnippets.map((snip, idx) => (
              <button
                key={idx}
                type="button"
                className="snippet-pill"
                onClick={() => setSql(snip.template)}
                title={snip.template}
              >
                {snip.label}
              </button>
            ))}
          </div>

          <button
            className="primary-button run-sql-button"
            type="button"
            disabled={executing || !sql.trim()}
            onClick={() => void handleExecute()}
            title="执行 SQL 查询 (Ctrl+Enter)"
          >
            {executing ? <Loader2 size={15} className="status-spinner" /> : <Play size={15} />}
            <span>{executing ? "执行中..." : "运行 SQL"}</span>
            <kbd className="shortcut-kbd">Ctrl+↵</kbd>
          </button>
        </div>

        <textarea
          rows={5}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void handleExecute();
            }
          }}
          placeholder="输入任意 SQL 语句，例如 SELECT * FROM ...，支持多语句执行"
          className="db-sql-textarea"
          spellCheck={false}
        />
      </div>

      {/* Query Result Pane */}
      <div className="db-sql-result-card">
        <div className="result-card-header">
          <div className="result-stats">
            <Terminal size={16} />
            <span>执行结果</span>
            {queryResult && (
              <div className="result-metric-badges">
                <span className="metric-badge time">
                  <Clock size={12} /> {queryResult.executionTimeMs} ms
                </span>
                {queryResult.totalRows !== undefined && (
                  <span className="metric-badge rows">
                    返回 {queryResult.rows.length} / {queryResult.totalRows} 行
                  </span>
                )}
                {queryResult.affectedRows !== undefined && queryResult.affectedRows > 0 && (
                  <span className="metric-badge affected">
                    受影响 {queryResult.affectedRows} 行
                  </span>
                )}
              </div>
            )}
          </div>

          {queryResult && !queryResult.error && queryResult.columns.length > 0 && (
            <div className="result-view-switchers">
              <button
                type="button"
                className={`switch-btn ${resultViewMode === "table" ? "active" : ""}`}
                onClick={() => setResultViewMode("table")}
              >
                表格
              </button>
              <button
                type="button"
                className={`switch-btn ${resultViewMode === "json" ? "active" : ""}`}
                onClick={() => setResultViewMode("json")}
              >
                JSON
              </button>
            </div>
          )}
        </div>

        <div className="result-scroll-container">
          {!queryResult ? (
            <div className="result-idle-state">
              <Code2 size={32} />
              <p>在上方编写 SQL 语句并点击「运行 SQL」或按 Ctrl+Enter 查看执行结果</p>
            </div>
          ) : queryResult.error ? (
            <div className="result-error-box">
              <AlertCircle size={20} />
              <div className="error-details">
                <strong>执行出错：</strong>
                <p>{queryResult.error}</p>
              </div>
            </div>
          ) : queryResult.columns.length === 0 ? (
            <div className="result-success-empty">
              <CheckCircle2 size={24} className="success-icon" />
              <p>SQL 语句执行成功！耗时 {queryResult.executionTimeMs} ms</p>
            </div>
          ) : resultViewMode === "json" ? (
            <pre className="result-json-block">{JSON.stringify(queryResult.rows, null, 2)}</pre>
          ) : (
            <table className="db-glass-table result-table">
              <thead>
                <tr>
                  <th>#</th>
                  {queryResult.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queryResult.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    <td className="td-row-num">{rIdx + 1}</td>
                    {queryResult.columns.map((col) => {
                      const val = row[col];
                      const isNull = val === null || val === undefined;
                      return (
                        <td key={col} className={isNull ? "null-cell" : ""}>
                          {isNull ? <em className="null-label">NULL</em> : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Tab 4: Database Import & Export View
// -------------------------------------------------------------
function DatabaseImportExportView({
  token,
  databaseId,
  tableName,
  isReadOnly,
  onImportComplete
}: {
  token: string;
  databaseId: string;
  tableName: string;
  isReadOnly?: boolean | undefined;
  onImportComplete: () => void | Promise<void>;
}) {
  const [exportFormat, setExportFormat] = useState<"csv" | "json" | "sql">("csv");
  const [exportScope, setExportScope] = useState<"table" | "all">("table");
  const [exporting, setExporting] = useState(false);

  const [importFormat, setImportFormat] = useState<"csv" | "json" | "sql">("csv");
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.exportDatabaseData(token, databaseId, {
        tableName: exportScope === "table" ? tableName : undefined,
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
    if (!importText.trim() || isReadOnly) return;
    setImporting(true);
    setImportMsg("");
    try {
      const res = await api.importDatabaseData(token, databaseId, {
        tableName: importFormat === "sql" ? undefined : tableName,
        format: importFormat,
        mode: importMode,
        content: importText
      });
      setImportMsg(res.message || "导入成功");
      onImportComplete();
    } catch (err) {
      setImportMsg(err instanceof Error ? `导入失败：${err.message}` : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "json") setImportFormat("json");
    else if (ext === "sql") setImportFormat("sql");
    else if (ext === "csv") setImportFormat("csv");

    const reader = new FileReader();
    reader.onload = (evt) => {
      setImportText(String(evt.target?.result || ""));
    };
    reader.readAsText(file);
  };

  return (
    <div className="db-io-pane">
      <div className="db-io-cards-grid">
        {/* Export Card */}
        <div className="db-io-card export-card">
          <div className="io-card-header">
            <Download size={20} />
            <div>
              <h4>数据导出 (Export)</h4>
              <span>将数据表或整库转储为标准文件格式下载</span>
            </div>
          </div>

          <div className="io-card-body">
            <label className="io-field-label">
              导出范围
              <select
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value as "table" | "all")}
                className="io-select"
              >
                <option value="table">当前表: {tableName || "未选择"}</option>
                <option value="all">整库结构与全表数据</option>
              </select>
            </label>

            <label className="io-field-label">
              导出文件格式
              <div className="format-pills">
                <button
                  type="button"
                  className={`format-pill ${exportFormat === "csv" ? "active" : ""}`}
                  onClick={() => setExportFormat("csv")}
                >
                  CSV 表格 (.csv)
                </button>
                <button
                  type="button"
                  className={`format-pill ${exportFormat === "json" ? "active" : ""}`}
                  onClick={() => setExportFormat("json")}
                >
                  JSON 数据 (.json)
                </button>
                <button
                  type="button"
                  className={`format-pill ${exportFormat === "sql" ? "active" : ""}`}
                  onClick={() => setExportFormat("sql")}
                >
                  SQL 转储 (.sql)
                </button>
              </div>
            </label>

            <button
              className="primary-button io-submit-btn"
              type="button"
              disabled={exporting || (exportScope === "table" && !tableName)}
              onClick={() => void handleExport()}
            >
              {exporting ? <Loader2 size={16} className="status-spinner" /> : <Download size={16} />}
              <span>{exporting ? "正在导出..." : "立即导出并下载"}</span>
            </button>
          </div>
        </div>

        {/* Import Card */}
        <div className="db-io-card import-card">
          <div className="io-card-header">
            <Upload size={20} />
            <div>
              <h4>数据导入 (Import)</h4>
              <span>上传或粘贴 CSV / JSON / SQL 批量写入数据</span>
            </div>
          </div>

          <div className="io-card-body">
            <div className="import-config-row">
              <label className="io-field-label">
                导入格式
                <select
                  value={importFormat}
                  onChange={(e) => setImportFormat(e.target.value as "csv" | "json" | "sql")}
                  className="io-select"
                >
                  <option value="csv">CSV 文件</option>
                  <option value="json">JSON 数组</option>
                  <option value="sql">SQL 脚本文件</option>
                </select>
              </label>

              {importFormat !== "sql" && (
                <label className="io-field-label">
                  导入策略
                  <select
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as "append" | "replace")}
                    className="io-select"
                  >
                    <option value="append">追加记录 (Append)</option>
                    <option value="replace">清空后替换 (Replace)</option>
                  </select>
                </label>
              )}
            </div>

            <div className="file-drop-zone">
              <input
                type="file"
                accept=".csv,.json,.sql,.txt"
                onChange={handleFileSelect}
                className="file-input-hidden"
                id="db-import-file-input"
              />
              <label htmlFor="db-import-file-input" className="file-drop-label">
                <Upload size={18} />
                <span>选择本地文件上传或在下方粘贴内容</span>
              </label>
            </div>

            <textarea
              rows={4}
              placeholder="在此粘贴 CSV / JSON 或 SQL 文本内容..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="import-textarea"
              disabled={isReadOnly}
            />

            {importMsg && (
              <div className={`io-status-message ${importMsg.includes("失败") ? "error" : "success"}`}>
                {importMsg}
              </div>
            )}

            <button
              className="primary-button io-submit-btn"
              type="button"
              disabled={importing || !importText.trim() || isReadOnly}
              onClick={() => void handleImport()}
            >
              {importing ? <Loader2 size={16} className="status-spinner" /> : <Check size={16} />}
              <span>{importing ? "正在导入中..." : "确认导入数据库"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Visual Create Table Modal (Dynamic Schema Builder)
// -------------------------------------------------------------
function CreateTableModal({
  token,
  databaseId,
  onClose,
  onCreated
}: {
  token: string;
  databaseId: string;
  onClose: () => void;
  onCreated: (tableName: string) => void;
}) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<DatabaseColumnInfo[]>([
    { name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true, notNull: true, defaultValue: null },
    { name: "name", type: "TEXT", primaryKey: false, autoIncrement: false, notNull: false, defaultValue: null }
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handleAddColumn = () => {
    setColumns((prev) => [
      ...prev,
      {
        name: `column_${prev.length + 1}`,
        type: "TEXT",
        primaryKey: false,
        autoIncrement: false,
        notNull: false,
        defaultValue: null
      }
    ]);
  };

  const handleRemoveColumn = (idx: number) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleColumnChange = (idx: number, field: keyof DatabaseColumnInfo, value: unknown) => {
    setColumns((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx]!, [field]: value };
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableName.trim()) {
      setError("表名称不能为空");
      return;
    }
    setCreating(true);
    setError("");
    try {
      await api.createDatabaseTable(token, databaseId, {
        tableName: tableName.trim(),
        columns
      });
      onCreated(tableName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建数据表失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container db-create-table-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <TableIcon size={18} />
            </div>
            <div>
              <h3 className="modal-title">可视化新建数据表</h3>
              <span className="modal-subtitle">自定义表名与字段定义，自动生成 DDL</span>
            </div>
          </div>
          <button className="icon-button mini" type="button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="db-create-table-form">
          <div className="glass-modal-body">
            {error && <div className="page-error modal-error">{error}</div>}

            <label className="create-tbl-name-label">
              数据表名称
              <input
                type="text"
                placeholder="例如: users, products, logs..."
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                required
                className="table-name-input"
              />
            </label>

            <div className="schema-builder-header">
              <h5>字段设计器 ({columns.length})</h5>
              <button
                className="small-button mini add-col-btn"
                type="button"
                onClick={handleAddColumn}
              >
                <Plus size={14} />
                <span>添加字段</span>
              </button>
            </div>

            <div className="builder-columns-list">
              {columns.map((col, idx) => (
                <div key={idx} className="builder-col-row">
                  <input
                    type="text"
                    placeholder="字段名"
                    value={col.name}
                    onChange={(e) => handleColumnChange(idx, "name", e.target.value)}
                    required
                    className="builder-col-name"
                  />

                  <select
                    value={col.type}
                    onChange={(e) => handleColumnChange(idx, "type", e.target.value)}
                    className="builder-col-type"
                  >
                    <option value="INTEGER">INTEGER (整型)</option>
                    <option value="TEXT">TEXT (文本)</option>
                    <option value="REAL">REAL (浮点数)</option>
                    <option value="BLOB">BLOB (二进制)</option>
                    <option value="VARCHAR(255)">VARCHAR(255)</option>
                    <option value="BOOLEAN">BOOLEAN (布尔)</option>
                    <option value="DATETIME">DATETIME (时间)</option>
                  </select>

                  <label className="builder-checkbox" title="主键">
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      onChange={(e) => handleColumnChange(idx, "primaryKey", e.target.checked)}
                    />
                    <span>PK</span>
                  </label>

                  <label className="builder-checkbox" title="自增">
                    <input
                      type="checkbox"
                      checked={col.autoIncrement}
                      onChange={(e) => handleColumnChange(idx, "autoIncrement", e.target.checked)}
                    />
                    <span>AUTO</span>
                  </label>

                  <label className="builder-checkbox" title="非空">
                    <input
                      type="checkbox"
                      checked={col.notNull}
                      onChange={(e) => handleColumnChange(idx, "notNull", e.target.checked)}
                    />
                    <span>NOT NULL</span>
                  </label>

                  <button
                    className="icon-button mini danger-action remove-col-btn"
                    type="button"
                    disabled={columns.length <= 1}
                    onClick={() => handleRemoveColumn(idx)}
                    title="删除此字段"
                  >
                    <Trash2 size={13} />
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
              <span>{creating ? "创建中..." : "创建数据表"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Add / Auto-Discover Database Modal
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
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodes[0]?.id || "local");
  const [discovering, setDiscovering] = useState(false);
  const [discoveredList, setDiscoveredList] = useState<Array<DiscoveredDatabase & { nodeId: string; nodeName: string }>>([]);
  const [hasScanned, setHasScanned] = useState(false);

  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<DatabaseEngine>("sqlite");
  const [pathValue, setPathValue] = useState("");
  const [hostValue, setHostValue] = useState("127.0.0.1");
  const [portValue, setPortValue] = useState<number | "">("");
  const [userValue, setUserValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [databaseValue, setDatabaseValue] = useState("");
  const [description, setDescription] = useState("");
  const [isReadOnly, setIsReadOnly] = useState(false);

  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleDiscover = async () => {
    setDiscovering(true);
    setError("");
    try {
      const res = await api.discoverDatabases(token, selectedNodeId === "all" ? undefined : selectedNodeId);
      setDiscoveredList(res.databases || []);
      setHasScanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "扫描节点数据库失败");
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    void handleDiscover();
  }, [selectedNodeId]);

  const handleSelectDiscovered = (item: DiscoveredDatabase & { nodeId: string; nodeName: string }) => {
    setSelectedNodeId(item.nodeId);
    setEngine(item.engine);
    setName(item.name.replace(/\s*\(.*\)/, ""));
    setPathValue(item.path || "");
    setHostValue(item.host || "127.0.0.1");
    setPortValue(item.port ?? (item.engine === "mysql" ? 3306 : item.engine === "postgres" ? 5432 : item.engine === "redis" ? 6379 : ""));
    setDatabaseValue("");
    setDescription(`来源：${item.source} · 自动扫描发现`);
    setTestResult(null);
    setMode("manual");
  };

  const handleTestConnection = async () => {
    if (!userValue.trim()) {
      setError("测试连接需要先填写用户名");
      return;
    }
    if (!databaseValue.trim()) {
      setError("测试连接需要先填写数据库名");
      return;
    }
    setTestingConnection(true);
    setError("");
    setTestResult(null);
    try {
      const res = await api.testDatabaseConnection(token, {
        host: hostValue.trim() || "127.0.0.1",
        port: portValue ? Number(portValue) : 3306,
        user: userValue.trim(),
        password: passwordValue,
        database: databaseValue.trim()
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "连接测试失败" });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("请输入可视化实例名称");
      return;
    }
    if (engine === "sqlite" && !pathValue.trim()) {
      setError("SQLite 数据库文件路径不能为空");
      return;
    }
    if ((engine === "mysql" || engine === "mariadb") && !userValue.trim()) {
      setError("MySQL 连接需要填写用户名");
      return;
    }
    if ((engine === "mysql" || engine === "mariadb") && !databaseValue.trim()) {
      setError("MySQL 连接需要指定数据库名 (Database Name)");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await api.createDatabase(token, {
        nodeId: selectedNodeId,
        name: name.trim(),
        engine,
        description: description.trim() || undefined,
        config: {
          path: engine === "sqlite" ? (pathValue.trim() || undefined) : undefined,
          host: engine !== "sqlite" ? (hostValue.trim() || "127.0.0.1") : undefined,
          port: engine !== "sqlite" ? (portValue ? Number(portValue) : 3306) : undefined,
          user: engine !== "sqlite" ? (userValue.trim() || undefined) : undefined,
          password: engine !== "sqlite" ? (passwordValue || undefined) : undefined,
          database: engine !== "sqlite" ? (databaseValue.trim() || undefined) : undefined,
          isReadOnly
        }
      });
      onCreated(res.database);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建数据库可视化实例失败");
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <div className="db-add-modal-content-wrap">
      <div className="db-add-modal-tabs">
        <button
          type="button"
          className={`add-modal-tab ${mode === "auto" ? "active" : ""}`}
          onClick={() => setMode("auto")}
        >
          <Sparkles size={15} />
          <span>自动扫描发现</span>
        </button>
        <button
          type="button"
          className={`add-modal-tab ${mode === "manual" ? "active" : ""}`}
          onClick={() => setMode("manual")}
        >
          <Settings size={15} />
          <span>自定义配置连接</span>
        </button>
      </div>

        {mode === "auto" ? (
          <div className="glass-modal-body db-auto-discover-body">
            {error && <div className="page-error modal-error">{error}</div>}

            <div className="discover-control-bar">
              <label className="discover-node-label">
                <span className="discover-node-label-text">目标节点:</span>
                <select
                  value={selectedNodeId}
                  onChange={(e) => setSelectedNodeId(e.target.value)}
                  className="discover-node-select"
                >
                  <option value="all">全部节点</option>
                  {nodes.map((n) => (
                    <option value={n.id} key={n.id}>
                      {n.name} ({n.host}:{n.port})
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="primary-button mini rescan-btn"
                type="button"
                disabled={discovering}
                onClick={() => void handleDiscover()}
              >
                {discovering ? <Loader2 size={14} className="status-spinner" /> : <RefreshCw size={14} />}
                <span>{discovering ? "扫描中..." : "重新扫描"}</span>
              </button>
            </div>

            <div className="discovered-databases-list">
              {discovering && discoveredList.length === 0 ? (
                <div className="discovering-loader">
                  <Loader2 size={28} className="status-spinner" />
                  <p>正在深入扫描节点实例工作区与监听端口...</p>
                </div>
              ) : discoveredList.length === 0 ? (
                <div className="discovered-empty">
                  <Database size={32} />
                  <p>未在该节点扫描到已存在的数据库文件或开放服务</p>
                  <button
                    className="small-button"
                    type="button"
                    onClick={() => setMode("manual")}
                  >
                    切换至手动填写配置
                  </button>
                </div>
              ) : (
                discoveredList.map((db, idx) => (
                  <div key={idx} className="discovered-db-card">
                    <div className="card-left">
                      <div className={`db-card-icon ${db.engine}`}>
                        <Database size={20} />
                      </div>
                      <div className="db-card-meta">
                        <div className="card-name-row">
                          <strong>{db.name}</strong>
                          <span className={`engine-badge ${db.engine}`}>{db.engine.toUpperCase()}</span>
                          <span className="node-badge">{db.nodeName}</span>
                        </div>
                        <div className="card-detail-row">
                          <span className="db-src-tag">{db.source}</span>
                          {db.sizeBytes !== undefined && (
                            <span className="db-size-tag">
                              {(db.sizeBytes / 1024).toFixed(1)} KB
                            </span>
                          )}
                          {db.tableCount !== undefined && (
                            <span className="db-tables-tag">{db.tableCount} 张表</span>
                          )}
                          {db.path && <span className="db-path-tag" title={db.path}>{db.path}</span>}
                        </div>
                      </div>
                    </div>

                    <button
                      className="primary-button mini select-db-btn"
                      type="button"
                      onClick={() => handleSelectDiscovered(db)}
                    >
                      <Plus size={14} />
                      <span>选择此数据库</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="manual-config-form">
            <div className="glass-modal-body db-manual-body">
              {error && <div className="page-error modal-error">{error}</div>}

              <div className="manual-grid">
                <label>
                  实例名称
                  <input
                    type="text"
                    required
                    placeholder="例如: App MySQL 数据库"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>

                <label>
                  运行节点
                  <select
                    value={selectedNodeId}
                    onChange={(e) => setSelectedNodeId(e.target.value)}
                  >
                    {nodes.map((n) => (
                      <option value={n.id} key={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  数据库类型
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value as DatabaseEngine)}
                  >
                    <option value="sqlite">SQLite (嵌入式文件)</option>
                    <option value="mysql">MySQL / MariaDB</option>
                    <option value="postgres">PostgreSQL</option>
                    <option value="redis">Redis 键值库</option>
                  </select>
                </label>

                {engine === "sqlite" ? (
                  <label className="wide-field">
                    SQLite 文件路径
                    <input
                      type="text"
                      required
                      placeholder="例如: data/panel/dev.db 或 /workspace/app.sqlite"
                      value={pathValue}
                      onChange={(e) => setPathValue(e.target.value)}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      主机地址 (Host)
                      <input
                        type="text"
                        value={hostValue}
                        onChange={(e) => setHostValue(e.target.value)}
                        placeholder="127.0.0.1"
                      />
                    </label>
                    <label>
                      端口 (Port)
                      <input
                        type="number"
                        placeholder="3306 / 5432"
                        value={portValue}
                        onChange={(e) => setPortValue(e.target.value ? Number(e.target.value) : "")}
                      />
                    </label>
                    <label>
                      数据库名 (Database)
                      <input
                        type="text"
                        required
                        placeholder="例如: test, app, sys..."
                        value={databaseValue}
                        onChange={(e) => setDatabaseValue(e.target.value)}
                      />
                    </label>
                    <label>
                      用户名 (User)
                      <input
                        type="text"
                        required
                        placeholder="root"
                        value={userValue}
                        onChange={(e) => setUserValue(e.target.value)}
                      />
                    </label>
                    <label className="wide-field">
                      密码 (Password)
                      <input
                        type="password"
                        placeholder="数据库密码"
                        value={passwordValue}
                        onChange={(e) => setPasswordValue(e.target.value)}
                      />
                    </label>
                    <div className="wide-field db-test-conn-container">
                      <button
                        type="button"
                        className="small-button db-test-conn-btn"
                        disabled={testingConnection}
                        onClick={() => void handleTestConnection()}
                      >
                        {testingConnection ? <Loader2 size={13} className="status-spinner" /> : <Sparkles size={13} />}
                        <span>{testingConnection ? "测试连接中..." : "测试连接"}</span>
                      </button>
                      {testResult && (
                        <div className={`db-test-result-indicator ${testResult.ok ? "success" : "error"}`}>
                          {testResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          <span>{testResult.ok ? "连接成功！配置正确" : `连接失败: ${testResult.message || "未能连接"}`}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <label className="wide-field">
                  描述备注
                  <input
                    type="text"
                    placeholder="可选备注说明"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>

                <label className="checkbox-field wide-field">
                  <input
                    type="checkbox"
                    checked={isReadOnly}
                    onChange={(e) => setIsReadOnly(e.target.checked)}
                  />
                  <span>只读模式 (禁止写操作和表结构变动)</span>
                </label>
              </div>
            </div>

            <div className="glass-modal-footer">
              <button className="ghost-button" type="button" onClick={() => setMode("auto")}>
                返回自动扫描
              </button>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <Loader2 size={16} className="status-spinner" /> : <Plus size={16} />}
                <span>{submitting ? "正在创建..." : "创建可视化实例"}</span>
              </button>
            </div>
          </form>
        )}
    </div>
  );

  if (embed) {
    return content;
  }

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-container db-add-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="modal-title">添加数据库可视化</h3>
              <span className="modal-subtitle">自动扫描节点数据库或手动配置直连</span>
            </div>
          </div>
          <button className="icon-button mini" type="button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}
