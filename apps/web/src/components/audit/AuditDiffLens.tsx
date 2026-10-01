import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Eye, FileCode, Split, Square, Columns } from "lucide-react";
import { computeAuditDiff } from "./auditDiff.js";

export interface AuditDiffLensProps {
  originalText?: string | null | undefined;
  modifiedText?: string | null | undefined;
  title?: string | undefined;
  filePath?: string | undefined;
  action?: string | undefined;
  className?: string | undefined;
}

export function AuditDiffLens({
  originalText = "",
  modifiedText = "",
  title,
  filePath,
  action,
  className = ""
}: AuditDiffLensProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const diff = useMemo(() => {
    return computeAuditDiff(originalText ?? "", modifiedText ?? "");
  }, [originalText, modifiedText]);
  const diffLines = diff.lines;

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const l of diffLines) {
      if (l.type === "add") additions++;
      if (l.type === "del") deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  const handleCopy = async () => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(modifiedText ?? originalText ?? "");
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError("复制失败，请手动选择内容复制。");
    }
  };

  return (
    <div className={`audit-diff-lens-container ${className}`}>
      <div className="diff-lens-header">
        <div className="diff-lens-meta">
          <FileCode size={14} className="diff-lens-icon" />
          <span className="diff-lens-title">
            {filePath ? filePath : title ? title : "代码与变更比对透镜"}
          </span>
          <div className="diff-stat-badges">
            <span className="diff-stat-badge add">+{stats.additions}</span>
            <span className="diff-stat-badge del">-{stats.deletions}</span>
          </div>
        </div>

        <div className="diff-lens-actions">
          <div className="diff-mode-toggle">
            <button
              type="button"
              className={`mode-btn ${viewMode === "unified" ? "active" : ""}`}
              onClick={() => setViewMode("unified")}
              title="单栏合并视图"
            >
              <Square size={12} />
              行内
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === "split" ? "active" : ""}`}
              onClick={() => setViewMode("split")}
              title="双栏对比视图"
            >
              <Columns size={12} />
              双栏
            </button>
          </div>

          <button
            type="button"
            className="diff-copy-btn"
            onClick={() => void handleCopy()}
            title="复制当前最新内容"
          >
            {copied ? <Check size={12} className="copied" /> : <Copy size={12} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>
      {copyError && <p role="alert">{copyError}</p>}
      {(diff.truncated || diff.approximate) && <p role="status">{diff.truncated ? "内容较大，仅展示部分差异。" : "差异计算超时，当前展示两个版本的完整替换。"}</p>}

      <div className={`diff-lens-body ${viewMode}`}>
        {viewMode === "unified" ? (
          <div className="diff-unified-view">
            {diffLines.map((line, idx) => (
              <div key={idx} className={`diff-row type-${line.type}`}>
                <span className="diff-lineno old">{line.oldNum ?? ""}</span>
                <span className="diff-lineno new">{line.newNum ?? ""}</span>
                <span className="diff-prefix">
                  {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                </span>
                <span className="diff-code">{line.text || " "}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="diff-split-view">
            <div className="diff-split-pane left">
              <div className="diff-pane-tag">原版本</div>
              {diffLines.map((line, idx) => (
                  <div key={idx} className={`diff-row type-${line.type === "add" ? "same" : line.type}`}>
                    <span className="diff-lineno">{line.oldNum ?? ""}</span>
                    <span className="diff-code">{line.type === "add" ? " " : line.text || " "}</span>
                  </div>
                ))}
            </div>
            <div className="diff-split-pane right">
              <div className="diff-pane-tag">变更后版本</div>
              {diffLines.map((line, idx) => (
                  <div key={idx} className={`diff-row type-${line.type === "del" ? "same" : line.type}`}>
                    <span className="diff-lineno">{line.newNum ?? ""}</span>
                    <span className="diff-code">{line.type === "del" ? " " : line.text || " "}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
