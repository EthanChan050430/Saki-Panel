import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Code2,
  FileCode,
  FileJson,
  FileText,
  Loader2,
  Redo2,
  Search,
  Undo2,
  X,
  Check,
  Copy,
  ChevronRight,
  RotateCcw,
  GitCommitHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
  FileDiff,
  ChevronLeft
} from "lucide-react";
import type { InstanceGitChangesSummary, InstanceGitFileChange, SakiAgentAction } from "@webops/shared";
import { api } from "../../../api.js";
import { SakiGitDiffView } from "../SakiComponents.js";

export function isSakiActionCodeChange(action: SakiAgentAction): boolean {
  const tool = (action.tool || "").toLowerCase().replace(/[_-]/g, "");
  if (/^(writefile|replaceinfile|editlines|batchedit|multifileedit|batchpatch|applypatch|applypatches|applydiff|patchfiles|patch|uploadbase64|deletepath|renamepath|mkdir|archivepaths|extractarchive)$/.test(tool)) {
    return true;
  }
  if (tool === "generateimage") {
    const p = action.args?.path;
    return (typeof p === "string" && Boolean(p.trim())) || Boolean(action.approval?.rollbackAvailable);
  }
  if (/^(runcommand|runinshell|sendshellinput)$/.test(tool)) {
    return Boolean(action.approval?.rollbackAvailable);
  }
  return false;
}

export function isSakiActionExecutedCodeChange(action: SakiAgentAction): boolean {
  if (!isSakiActionCodeChange(action)) return false;
  if (action.status === "rejected" || action.status === "pending_approval" || action.status === "pending_input") {
    return false;
  }
  if (typeof action.observation === "string" && /no (?:write|change) was needed/i.test(action.observation)) {
    return false;
  }
  if (action.ok === false && !action.approval?.rollbackAvailable) {
    return false;
  }
  return true;
}

export function extractActionTouchedPaths(action: SakiAgentAction): string[] {
  const tool = (action.tool || "").toLowerCase().replace(/[_-]/g, "");
  const paths: string[] = [];

  const addPath = (val: unknown) => {
    if (typeof val === "string" && val.trim()) {
      paths.push(val.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase().trim());
    }
  };

  if (/^(writefile|replaceinfile|editlines|uploadbase64|mkdir|deletepath|generateimage)$/.test(tool)) {
    addPath(action.args?.path);
    addPath(action.args?.filePath);
    addPath(action.args?.targetPath);
  } else if (tool === "renamepath") {
    addPath(action.args?.fromPath ?? action.args?.from);
    addPath(action.args?.toPath ?? action.args?.to);
  } else if (tool === "batchedit" || tool === "multifileedit") {
    const edits = action.args?.edits;
    if (Array.isArray(edits)) {
      for (const edit of edits) {
        if (edit && typeof edit === "object") {
          addPath((edit as any).path ?? (edit as any).filePath);
        }
      }
    }
  } else if (/^(applypatch|applypatches|applydiff|patchfiles|patch)$/.test(tool)) {
    addPath(action.args?.path);
    const patch = typeof action.args?.patch === "string" ? action.args.patch : "";
    if (patch) {
      const lines = patch.split("\n");
      for (const line of lines) {
        const match = line.match(/^(?:---|\+\+\+)\s+[ab]?\/?([^\s\t\r\n]+)/);
        if (match && match[1] && match[1] !== "/dev/null") {
          addPath(match[1]);
        }
      }
    }
  }

  if (action.approval?.diff && typeof action.approval.diff === "string") {
    const lines = action.approval.diff.split("\n");
    for (const line of lines) {
      const match = line.match(/^(?:---|\+\+\+)\s+[ab]?\/?([^\s\t\r\n]+)/);
      if (match && match[1] && match[1] !== "/dev/null") {
        addPath(match[1]);
      }
    }
  }

  return paths;
}

export type SakiSessionMessageWithActions = {
  actions?: SakiAgentAction[] | undefined;
  timeline?: Array<{ kind?: string | undefined; action?: SakiAgentAction | undefined }> | undefined;
};

export function filterGitChangesForSession(
  summary: InstanceGitChangesSummary | null | undefined,
  messages: Array<SakiSessionMessageWithActions> | undefined
): InstanceGitChangesSummary | null {
  if (!summary) return null;

  const allActions = (messages ?? []).flatMap((msg) => {
    const list: SakiAgentAction[] = [];
    if (Array.isArray(msg.actions)) list.push(...msg.actions);
    if (Array.isArray(msg.timeline)) {
      for (const item of msg.timeline) {
        if (item.kind === "action" && item.action) list.push(item.action);
      }
    }
    return list;
  });

  const codeChangeActions = allActions.filter(isSakiActionExecutedCodeChange);

  if (codeChangeActions.length === 0) {
    return null;
  }

  const hasArbitraryShellChanges = codeChangeActions.some((action) => {
    const tool = (action.tool || "").toLowerCase().replace(/[_-]/g, "");
    return /^(runcommand|runinshell|sendshellinput)$/.test(tool) && Boolean(action.approval?.rollbackAvailable);
  });
  if (hasArbitraryShellChanges) {
    return summary;
  }

  const touchedPaths = new Set<string>();
  for (const action of codeChangeActions) {
    for (const p of extractActionTouchedPaths(action)) {
      touchedPaths.add(p);
    }
  }

  if (touchedPaths.size === 0) {
    return null;
  }

  const matchesTouchedPath = (gitPath: string): boolean => {
    const norm = gitPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase().trim();
    if (touchedPaths.has(norm)) return true;
    for (const tp of touchedPaths) {
      if (norm.endsWith("/" + tp) || tp.endsWith("/" + norm) || norm === tp) {
        return true;
      }
    }
    return false;
  };

  const filteredChanges = (summary.changes || []).filter((change) => matchesTouchedPath(change.path));

  if (filteredChanges.length === 0) {
    if (summary.canRestore || summary.isReverted) {
      return {
        ...summary,
        filesCount: 0,
        additions: 0,
        deletions: 0,
        changes: [],
        canRestore: true,
        isReverted: true
      };
    }
    return null;
  }

  const additions = filteredChanges.reduce((sum, c) => sum + (c.additions || 0), 0);
  const deletions = filteredChanges.reduce((sum, c) => sum + (c.deletions || 0), 0);

  let filteredDiff = summary.diff || "";
  if (summary.diff && filteredChanges.length < (summary.changes || []).length) {
    const parts = summary.diff.split(/(?=^diff --git )/m);
    const retainedParts = parts.filter((part) => {
      return filteredChanges.some((c) =>
        part.includes(`a/${c.path}`) || part.includes(`b/${c.path}`) || part.includes(c.path)
      );
    });
    if (retainedParts.length > 0) {
      filteredDiff = retainedParts.join("");
    }
  }

  return {
    ...summary,
    filesCount: filteredChanges.length,
    additions,
    deletions,
    changes: filteredChanges,
    diff: filteredDiff
  };
}

export function getFileCategoryIcon(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return <Code2 size={14} className="saki-file-icon is-react" style={{ color: "#38bdf8" }} />;
  }
  if (lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return <FileCode size={14} className="saki-file-icon is-ts" style={{ color: "#60a5fa" }} />;
  }
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) {
    return <FileCode size={14} className="saki-file-icon is-css" style={{ color: "#c084fc" }} />;
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
    return <FileText size={14} className="saki-file-icon is-doc" style={{ color: "#4ade80" }} />;
  }
  if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return <FileJson size={14} className="saki-file-icon is-json" style={{ color: "#fb923c" }} />;
  }
  return <FileCode size={14} className="saki-file-icon" style={{ color: "#94a3b8" }} />;
}

export function statusLabel(status: InstanceGitFileChange["status"]): { label: string; className: string } {
  switch (status) {
    case "added":
      return { label: "新增", className: "is-added" };
    case "deleted":
      return { label: "删除", className: "is-deleted" };
    case "renamed":
      return { label: "重命名", className: "is-renamed" };
    default:
      return { label: "修改", className: "is-modified" };
  }
}

/**
 * Capsule pill shown in the chat area (matches Figure 1 with Liquid Glass aesthetic).
 */
export function SakiChangedFilesPill({
  summary,
  onClick,
  className = ""
}: {
  summary: InstanceGitChangesSummary | null;
  onClick: () => void;
  className?: string | undefined;
}) {
  if (!summary || (summary.filesCount === 0 && !summary.canRestore)) {
    return null;
  }

  const isRestorable = Boolean(summary.isReverted ?? (summary.canRestore && summary.filesCount === 0));

  return (
    <button
      type="button"
      className={`saki-changed-files-pill ${className}${isRestorable ? " is-restorable" : ""}`}
      onClick={onClick}
      title={isRestorable ? "代码更改已撤回，点击查看或恢复" : "点击查看代码更改详情及一键撤回"}
    >
      <div className="saki-pill-icon-glow">
        {isRestorable ? (
          <RotateCcw size={12} className="saki-pill-icon" />
        ) : (
          <GitCommitHorizontal size={13} className="saki-pill-icon" />
        )}
      </div>
      <span className="saki-pill-label">
        {isRestorable
          ? summary.filesCount > 0
            ? `已撤回 ${summary.filesCount} 个文件更改`
            : "更改已撤回"
          : `${summary.filesCount} 个文件已更改`}
      </span>
      {!isRestorable ? (
        <div className="saki-pill-stats">
          {summary.additions > 0 ? (
            <span className="saki-pill-badge is-add">+{summary.additions}</span>
          ) : null}
          {summary.deletions > 0 ? (
            <span className="saki-pill-badge is-del">-{summary.deletions}</span>
          ) : null}
          {summary.additions === 0 && summary.deletions === 0 ? (
            <span className="saki-pill-badge is-zero">±0</span>
          ) : null}
        </div>
      ) : (
        <span className="saki-pill-badge is-restore-hint">可恢复</span>
      )}
      <ChevronRight size={12} className="saki-pill-arrow" />
    </button>
  );
}

/**
 * Details view for all file changes:
 * - Can view diffs
 * - Collapsible sidebar for wide code views
 * - One-click revert all changes
 * - One-click restore all reverted changes
 */
export function SakiCodeChangesDetails({
  summary,
  loading = false,
  reverting = false,
  onRevertAll,
  onRestoreAll,
  onClose,
  onOpenPath,
  variant = "inline",
  className = ""
}: {
  summary: InstanceGitChangesSummary | null;
  loading?: boolean | undefined;
  reverting?: boolean | undefined;
  onRevertAll: () => Promise<void>;
  onRestoreAll: () => Promise<void>;
  onClose?: (() => void) | undefined;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  variant?: ("inline" | "drawer") | undefined;
  className?: string | undefined;
}) {
  const [filterText, setFilterText] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [mobileTab, setMobileTab] = useState<"files" | "diff">("files");

  const changes = summary?.changes ?? [];
  const canRestore = Boolean(summary?.isReverted ?? summary?.canRestore);

  const filteredChanges = useMemo(() => {
    if (!filterText.trim()) return changes;
    const lower = filterText.trim().toLowerCase();
    return changes.filter(
      (c) =>
        c.path.toLowerCase().includes(lower) ||
        (c.originalPath && c.originalPath.toLowerCase().includes(lower))
    );
  }, [changes, filterText]);

  // Ensure selectedPath is valid or defaults to first file
  useEffect(() => {
    if (changes.length > 0 && (!selectedPath || !changes.some((c) => c.path === selectedPath))) {
      setSelectedPath(changes[0]?.path ?? null);
    }
  }, [changes, selectedPath]);

  // Filter diff for the currently selected file if selected
  const activeDiff = useMemo(() => {
    if (!summary?.diff) return "";
    if (!selectedPath) return summary.diff;
    // Extract diff block for selectedPath
    const blocks = summary.diff.split(/(?=diff --git )/);
    const matched = blocks.find((b) => {
      const match = b.match(/diff --git\s+[ab]\/(.+)\s+[ab]\/(.+)/);
      return match && (match[1] === selectedPath || match[2] === selectedPath);
    });
    return matched || summary.diff;
  }, [summary?.diff, selectedPath]);

  const selectedChange = useMemo(() => {
    return changes.find((c) => c.path === selectedPath) ?? null;
  }, [changes, selectedPath]);

  const handleCopyPath = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedPath) return;
    void navigator.clipboard.writeText(selectedPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1500);
  }, [selectedPath]);

  return (
    <div className={`saki-code-changes-details ${variant} ${className}`}>
      {/* Top Toolbar */}
      <div className="saki-code-changes-header">
        <div className="saki-code-changes-toolbar-left">
          <button
            type="button"
            className={`saki-btn-icon-toggle${sidebarCollapsed ? " is-active" : ""}`}
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "展开文件列表" : "收起文件列表 (获得更宽代码视图)"}
            aria-label={sidebarCollapsed ? "展开文件列表" : "收起文件列表"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>

          <div className="saki-code-changes-title-group">
            {variant === "inline" ? (
              <span className="saki-code-changes-title">
                {canRestore
                  ? `已撤回所有更改 (${summary?.filesCount ?? 0} 个文件)`
                  : `${summary?.filesCount ?? 0} 个文件已更改`}
              </span>
            ) : (
              canRestore ? (
                <span className="saki-code-changes-title is-reverted-note">已撤回更改</span>
              ) : null
            )}
            {summary && summary.filesCount > 0 ? (
              <div className="saki-code-changes-stats">
                {summary.additions > 0 && (
                  <span className="saki-pill-badge is-add">+{summary.additions}</span>
                )}
                {summary.deletions > 0 && (
                  <span className="saki-pill-badge is-del">-{summary.deletions}</span>
                )}
              </div>
            ) : null}
            {loading ? <Loader2 size={13} className="saki-spin" /> : null}
          </div>
        </div>

        {/* Mobile Segmented Switcher */}
        <div className="saki-code-changes-mobile-nav" role="tablist">
          <button
            type="button"
            className={`saki-mobile-tab-btn ${mobileTab === "files" ? "is-active" : ""}`}
            onClick={() => setMobileTab("files")}
          >
            <FileCode size={12} />
            <span>文件清单 ({changes.length})</span>
          </button>
          <button
            type="button"
            className={`saki-mobile-tab-btn ${mobileTab === "diff" ? "is-active" : ""}`}
            onClick={() => setMobileTab("diff")}
            disabled={!selectedPath}
          >
            <FileDiff size={12} />
            <span>代码差异</span>
          </button>
        </div>

        <div className="saki-code-changes-toolbar-right">
          {canRestore ? (
            <button
              type="button"
              className="saki-btn-action saki-btn-restore"
              disabled={reverting || loading}
              onClick={() => void onRestoreAll()}
              title="一键恢复所有已撤回的代码与文件更改"
            >
              {reverting ? <Loader2 size={13} className="saki-spin" /> : <Redo2 size={13} />}
              <span>恢复撤回的更改</span>
            </button>
          ) : (
            <button
              type="button"
              className="saki-btn-action saki-btn-revert"
              disabled={reverting || loading || (summary?.filesCount ?? 0) === 0}
              onClick={() => void onRevertAll()}
              title="一键撤回所有修改的代码与文件更改"
            >
              {reverting ? <Loader2 size={13} className="saki-spin" /> : <Undo2 size={13} />}
              <span>撤回全部更改</span>
            </button>
          )}

          {onClose && variant !== "drawer" ? (
            <button
              type="button"
              className="saki-code-changes-close-btn"
              onClick={onClose}
              title="关闭详情"
              aria-label="关闭详情"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </div>

      <div className={`saki-code-changes-body${sidebarCollapsed ? " is-sidebar-collapsed" : ""} mobile-view-${mobileTab}`}>
        {/* File tree / list side */}
        <div className="saki-code-changes-sidebar">
          <div className="saki-file-filter-wrapper">
            <Search size={13} className="saki-filter-icon" />
            <input
              type="text"
              className="saki-file-filter-input"
              placeholder="搜索文件..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            {filterText ? (
              <button
                type="button"
                className="saki-filter-clear-btn"
                onClick={() => setFilterText("")}
                title="清空搜索"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          <div className="saki-file-list" role="listbox">
            {filteredChanges.length === 0 ? (
              <div className="saki-file-list-empty">
                {filterText ? "未找到匹配的文件" : canRestore ? "更改已全部撤回，点击恢复按钮即可复原" : "暂无更改的文件"}
              </div>
            ) : (
              filteredChanges.map((file) => {
                const isSelected = selectedPath === file.path;
                const statusInfo = statusLabel(file.status);
                const slashIdx = file.path.lastIndexOf("/");
                const fileName = slashIdx >= 0 ? file.path.slice(slashIdx + 1) : file.path;
                const fileDir = slashIdx >= 0 ? file.path.slice(0, slashIdx) : "";

                return (
                  <button
                    type="button"
                    key={file.path}
                    className={`saki-file-item${isSelected ? " is-selected" : ""}`}
                    onClick={() => {
                      setSelectedPath(file.path);
                      setMobileTab("diff");
                    }}
                    title={file.path}
                  >
                    <div className="saki-file-item-icon">{getFileCategoryIcon(file.path)}</div>
                    <div className="saki-file-item-names">
                      <span className="saki-file-item-name">{fileName}</span>
                      {fileDir ? <span className="saki-file-item-dir">{fileDir}</span> : null}
                    </div>
                    <div className="saki-file-item-meta">
                      <span className={`saki-file-status-badge ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      {file.additions > 0 && (
                        <span className="saki-pill-badge is-add">+{file.additions}</span>
                      )}
                      {file.deletions > 0 && (
                        <span className="saki-pill-badge is-del">-{file.deletions}</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Diff preview side */}
        <div className="saki-code-changes-diff-pane">
          {selectedPath ? (
            <div className="saki-diff-header-bar">
              <div className="saki-diff-header-left">
                <button
                  type="button"
                  className="saki-diff-mobile-back-btn"
                  onClick={() => setMobileTab("files")}
                  title="返回文件列表"
                >
                  <ChevronLeft size={14} />
                  <span>文件列表</span>
                </button>
                {sidebarCollapsed && (
                  <button
                    type="button"
                    className="saki-diff-expand-sidebar-pill"
                    onClick={() => setSidebarCollapsed(false)}
                    title="展开文件列表"
                  >
                    <PanelLeftOpen size={12} />
                    <span>文件 ({changes.length})</span>
                  </button>
                )}
                <div className="saki-diff-file-path-group" title={selectedPath}>
                  {getFileCategoryIcon(selectedPath)}
                  <span className="saki-diff-file-path">{selectedPath}</span>
                </div>
              </div>

              <div className="saki-diff-header-actions">
                {selectedChange && (selectedChange.additions > 0 || selectedChange.deletions > 0) && (
                  <div className="saki-diff-file-stats">
                    {selectedChange.additions > 0 && (
                      <span className="saki-pill-badge is-add">+{selectedChange.additions}</span>
                    )}
                    {selectedChange.deletions > 0 && (
                      <span className="saki-pill-badge is-del">-{selectedChange.deletions}</span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="saki-diff-action-btn"
                  onClick={handleCopyPath}
                  title={copiedPath ? "已复制文件路径" : "复制文件路径"}
                >
                  {copiedPath ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedPath ? "已复制" : "路径"}</span>
                </button>
                {onOpenPath ? (
                  <button
                    type="button"
                    className="saki-diff-action-btn is-open"
                    onClick={() => onOpenPath(selectedPath)}
                    title="在工作区编辑器中打开此文件"
                  >
                    <ExternalLink size={12} />
                    <span>打开文件</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="saki-diff-viewer-wrap">
            {activeDiff ? (
              <SakiGitDiffView
                diff={activeDiff}
                target={selectedPath ?? undefined}
                onOpenPath={onOpenPath}
              />
            ) : (
              <div className="saki-diff-empty">
                <FileDiff size={32} className="saki-diff-empty-icon" />
                <p>
                  {canRestore
                    ? "所有修改已撤回。点击右上角「恢复撤回的更改」即可复原。"
                    : "暂无更改或请选择左侧文件查看代码差异。"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage Git changes fetching, polling during agent run, and revert/restore actions.
 */
export function useCodeChanges({
  token,
  instanceId,
  isRunning = false,
  pollIntervalMs = 2500,
  watchKey
}: {
  token: string;
  instanceId?: string | null;
  isRunning?: boolean;
  pollIntervalMs?: number;
  watchKey?: unknown;
}) {
  const [summary, setSummary] = useState<InstanceGitChangesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.instanceGitChangesSummary(token, instanceId);
      setSummary(res);
      setError(null);
    } catch (err) {
      // If git is not available or instance is unreachable, silently maintain state
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token, instanceId]);

  // Initial fetch and fetch when instanceId changes
  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // Fetch when watchKey changes
  useEffect(() => {
    if (watchKey !== undefined) {
      void fetchSummary();
    }
  }, [watchKey, fetchSummary]);

  // Polling while Agent is running
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      void fetchSummary();
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [isRunning, pollIntervalMs, fetchSummary]);

  // Final fetch when Agent finishes running
  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      void fetchSummary();
    }
    prevRunningRef.current = isRunning;
  }, [isRunning, fetchSummary]);

  const revertAll = useCallback(async () => {
    if (!token) return;
    setReverting(true);
    try {
      await api.instanceGitRevertAll(token, instanceId);
      await fetchSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回更改失败");
      throw err;
    } finally {
      setReverting(false);
    }
  }, [token, instanceId, fetchSummary]);

  const restoreAll = useCallback(async () => {
    if (!token) return;
    setReverting(true);
    try {
      await api.instanceGitRestoreAll(token, instanceId);
      await fetchSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复更改失败");
      throw err;
    } finally {
      setReverting(false);
    }
  }, [token, instanceId, fetchSummary]);

  return {
    summary,
    loading,
    reverting,
    error,
    refresh: fetchSummary,
    revertAll,
    restoreAll
  };
}
