import React, { useState, useEffect, useCallback } from "react";
import {
  Check,
  Columns,
  Copy,
  FileCode,
  Key,
  Loader2,
  RotateCw,
  Sparkles,
  Table as TableIcon
} from "lucide-react";
import type {
  DatabaseColumnInfo,
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseVisualizerInstance
} from "@webops/shared";
import { api, ApiError } from "../api.js";

export function TableSchemaView({
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
