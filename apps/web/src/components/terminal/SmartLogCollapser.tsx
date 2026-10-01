import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Check,
  FileText,
  Sparkles,
  Terminal as TerminalIcon
} from "lucide-react";
import type { SakiPromptSeed } from "../../types/app.js";

export interface LogBlock {
  id: string;
  type: "error_stack" | "npm_build" | "docker_log" | "general";
  title: string;
  lines: string[];
  isCollapsible: boolean;
  defaultCollapsed?: boolean;
}

export function parseSmartLogBlocks(rawLogs: string): LogBlock[] {
  if (!rawLogs) return [];
  const lines = rawLogs.split("\n");
  const blocks: LogBlock[] = [];
  let currentGroup: { type: LogBlock["type"]; title: string; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const isErrorStack =
      /^\s*at\s+.+/.test(line) ||
      /^(?:Error|[\w.$]+Error):/.test(line);
    const isBuildTable = /^\s*(\[vite\]|\[webpack\]|dist\/assets\/|✓ built in|transforming\.\.\.)/.test(line);

    if (isErrorStack) {
      if (currentGroup && currentGroup.type === "error_stack") {
        currentGroup.lines.push(line);
      } else {
        if (currentGroup) {
          blocks.push({
            id: `block-${blocks.length}`,
            ...currentGroup,
            isCollapsible: currentGroup.lines.length > 4,
            defaultCollapsed: currentGroup.lines.length > 6
          });
        }
        currentGroup = {
          type: "error_stack",
          title: line.slice(0, 80) || "运行时异常堆栈 (Stack Trace)",
          lines: [line]
        };
      }
    } else if (isBuildTable) {
      if (currentGroup && currentGroup.type === "npm_build") {
        currentGroup.lines.push(line);
      } else {
        if (currentGroup) {
          blocks.push({
            id: `block-${blocks.length}`,
            ...currentGroup,
            isCollapsible: currentGroup.lines.length > 4,
            defaultCollapsed: currentGroup.lines.length > 6
          });
        }
        currentGroup = {
          type: "npm_build",
          title: "打包与模块构建产物日志",
          lines: [line]
        };
      }
    } else {
      if (currentGroup && (currentGroup.type === "error_stack" || currentGroup.type === "npm_build")) {
        blocks.push({
          id: `block-${blocks.length}`,
          ...currentGroup,
          isCollapsible: currentGroup.lines.length > 4,
          defaultCollapsed: currentGroup.lines.length > 6
        });
        currentGroup = null;
      }

      if (!currentGroup) {
        currentGroup = {
          type: "general",
          title: "标准控制台输出",
          lines: [line]
        };
      } else {
        currentGroup.lines.push(line);
      }
    }
  }

  if (currentGroup) {
    blocks.push({
      id: `block-${blocks.length}`,
      ...currentGroup,
      isCollapsible: currentGroup.lines.length > 4,
      defaultCollapsed: currentGroup.lines.length > 6
    });
  }

  return blocks;
}

export interface SmartLogCollapserProps {
  logs: string;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  className?: string | undefined;
}

export function SmartLogCollapser({ logs, onAskSaki, className = "" }: SmartLogCollapserProps) {
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCollapsedMap({});
    setCopiedId(null);
    setCopyError("");
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, [logs]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const blocks = useMemo(() => parseSmartLogBlocks(logs), [logs]);

  const toggleCollapse = (id: string, defCollapsed: boolean) => {
    setCollapsedMap((prev) => ({
      ...prev,
      [id]: prev[id] !== undefined ? !prev[id] : !defCollapsed
    }));
  };

  const copyBlock = async (id: string, text: string) => {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setCopyError("复制失败，请切换到纯文本视图手动复制。");
    }
  };

  return (
    <div className={`smart-log-collapser ${className}`}>
      {copyError && <p role="alert">{copyError}</p>}
      {blocks.map((b) => {
        const isCollapsed =
          collapsedMap[b.id] !== undefined ? collapsedMap[b.id] : Boolean(b.defaultCollapsed);

        if (!b.isCollapsible) {
          return (
            <div key={b.id} className="smart-log-plain-block">
              {b.lines.join("\n")}
            </div>
          );
        }

        const isError = b.type === "error_stack";

        return (
          <div key={b.id} className={`smart-log-card ${b.type} ${isCollapsed ? "collapsed" : ""}`}>
            <div className="smart-log-card-header" onClick={() => toggleCollapse(b.id, Boolean(b.defaultCollapsed))}>
              <button type="button" className="smart-log-toggle-btn" aria-label={isCollapsed ? "展开日志" : "折叠日志"} aria-expanded={!isCollapsed}>
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>

              <div className="smart-log-header-info">
                {isError ? (
                  <AlertTriangle size={13} className="smart-log-icon error" />
                ) : (
                  <Code2 size={13} className="smart-log-icon build" />
                )}
                <span className="smart-log-title">{b.title}</span>
                <span className="smart-log-line-badge">{b.lines.length} 行</span>
              </div>

              <div className="smart-log-header-actions" onClick={(e) => e.stopPropagation()}>
                {isError && onAskSaki && (
                  <button
                    type="button"
                    className="smart-log-saki-btn"
                    onClick={() =>
                      onAskSaki({
                        message: `请针对此终端异常报错进行原因分析并给出排查建议：\n\n\`\`\`\n${b.lines.join("\n")}\n\`\`\``,
                        mode: "agent",
                        clearInstance: false
                      })
                    }
                  >
                    <Sparkles size={11} />
                    Saki 研判
                  </button>
                )}

                <button
                  type="button"
                  className="smart-log-copy-btn"
                  onClick={() => void copyBlock(b.id, b.lines.join("\n"))}
                  title="复制该日志块"
                >
                  {copiedId === b.id ? <Check size={11} className="copied" /> : <Copy size={11} />}
                </button>
              </div>
            </div>

            {!isCollapsed && (
              <pre className="smart-log-card-body">{b.lines.join("\n")}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
