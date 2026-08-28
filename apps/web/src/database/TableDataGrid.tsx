import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Edit3,
  Filter,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Table as TableIcon,
  Trash2,
  X
} from "lucide-react";
import type {
  DatabaseColumnInfo,
  DatabaseDeleteRowRequest,
  DatabaseInsertRowRequest,
  DatabaseRowsResponse,
  DatabaseTableSummary,
  DatabaseUpdateRowRequest,
  DatabaseVisualizerInstance
} from "@webops/shared";
import { api, ApiError } from "../api.js";
import { InsertRowModal } from "./modals/InsertRowModal.js";
import { EditRowModal } from "./modals/EditRowModal.js";

export function TableDataGrid({
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
