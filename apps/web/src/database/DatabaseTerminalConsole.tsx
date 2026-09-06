import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  FileCode,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Sparkles,
  Terminal,
  Trash2
} from "lucide-react";
import type {
  DatabaseQueryResult,
  DatabaseTableSummary,
  DatabaseVisualizerInstance
} from "@webops/shared";
import { api, ApiError } from "../api.js";

export function DatabaseTerminalConsole({
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
        onSubmit={(e) => {
          e.preventDefault();
          void execute();
        }}
      >
        <div className="terminal-input-wrap">
          <div className="terminal-history-wrap">
            <button
              type="button"
              className="terminal-history-btn"
              title="历史命令"
              onClick={() => setShowHistory((v) => !v)}
            >
              <Clock size={16} />
            </button>

            {showHistory && (
              <div className="glass-panel terminal-history-popover">
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
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder={isRedis ? "输入 Redis 命令 (如 GET / SET / HGETALL / KEYS)..." : "输入 SQL 语句按回车执行..."}
          />
        </div>

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
