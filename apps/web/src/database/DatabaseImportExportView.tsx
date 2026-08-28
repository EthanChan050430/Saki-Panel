import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  HardDrive,
  Info,
  Loader2,
  Play,
  Upload
} from "lucide-react";
import type {
  DatabaseExportRequest,
  DatabaseImportRequest,
  DatabaseTableSummary,
  DatabaseVisualizerInstance
} from "@webops/shared";
import { api, ApiError } from "../api.js";

export function DatabaseImportExportView({
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
