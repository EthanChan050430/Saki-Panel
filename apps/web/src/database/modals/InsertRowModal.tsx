import React, { useState } from "react";
import { AlertCircle, Key, Loader2, Plus, X } from "lucide-react";
import type { DatabaseColumnInfo, DatabaseVisualizerInstance } from "@webops/shared";
import { api, ApiError } from "../../api.js";

export function InsertRowModal({
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
