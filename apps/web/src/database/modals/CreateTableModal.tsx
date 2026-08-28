import React, { useState } from "react";
import { AlertCircle, Key, Loader2, Plus, Table as TableIcon, Trash2, X } from "lucide-react";
import type {
  DatabaseColumnInfo,
  DatabaseCreateTableRequest,
  DatabaseVisualizerInstance
} from "@webops/shared";
import { api, ApiError } from "../../api.js";

export function CreateTableModal({
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
