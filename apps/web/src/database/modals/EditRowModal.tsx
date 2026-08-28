import React, { useState } from "react";
import { AlertCircle, Edit3, Key, Loader2, Save, X } from "lucide-react";
import type { DatabaseColumnInfo, DatabaseVisualizerInstance } from "@webops/shared";
import { api, ApiError } from "../../api.js";

export function EditRowModal({
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
