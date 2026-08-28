import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Code2,
  Copy,
  Eye,
  FileText,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Terminal as TerminalIcon,
  Trash2,
  UserCog,
  X
} from "lucide-react";
import type { AuditLogEntry, CurrentUser, ManagedInstance } from "@webops/shared";
import type { SakiPromptSeed } from "../types/app.js";
import { api, ApiError } from "../api.js";
import { usePanelT } from "../i18n/index.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { FilePreviewModal } from "../components/common/FilePreviewModal.js";
import { formatBytes, formatDate } from "../utils/path.js";

const auditActionLabels: Record<string, string> = {
  "auth.login": "用户登录",
  "auth.login.rate_limited": "登录限流",
  "auth.logout": "退出登录",
  "auth.profile.update": "更新账户",
  "auth.register": "用户注册",
  "daemon.register": "节点注册",
  "file.archive": "压缩文件",
  "file.archive.download": "压缩下载",
  "file.delete": "删除文件",
  "file.download": "下载文件",
  "file.extract": "解压文件",
  "file.mkdir": "新建目录",
  "file.read": "读取文件",
  "file.rename": "重命名文件",
  "file.upload": "上传文件",
  "file.write": "写入文件",
  "instance.create": "创建实例",
  "instance.delete": "删除实例",
  "instance.kill": "强杀实例",
  "instance.logs": "查看日志",
  "instance.restart": "重启实例",
  "instance.start": "启动实例",
  "instance.stop": "停止实例",
  "instance.update": "更新实例",
  "node.create": "创建节点",
  "node.delete": "删除节点",
  "node.test": "测试节点",
  "node.update": "更新节点",
  "role.permissions.update": "更新权限",
  "saki.chat": "Saki 对话",
  "settings.saki.update": "更新 Saki 设置",
  "task.create": "创建任务",
  "task.delete": "删除任务",
  "task.run": "执行任务",
  "task.update": "更新任务",
  "template.create": "创建模板",
  "terminal.input": "终端输入",
  "user.create": "创建用户",
  "user.delete": "删除用户",
  "user.switch": "切换账号",
  "user.update": "更新用户"
};

function auditActionLabel(action: string): string {
  return auditActionLabels[action] ?? action.replace(/\./g, " / ").replace(/_/g, " ");
}

function auditActor(log: AuditLogEntry): string {
  return log.username ?? (log.userId ? `用户 ${log.userId.slice(0, 8)}` : "系统");
}

function auditResourceLabel(log: AuditLogEntry): string {
  const resourceId = log.resourceId ? `/${log.resourceId.slice(0, 8)}` : "";
  return `${log.resourceType || "system"}${resourceId}`;
}

function auditPayloadText(payload?: string | null): string {
  if (!payload) return "";
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
function auditResourceIcon(resourceType: string, action: string): React.ReactNode {
  const key = `${resourceType} ${action}`.toLowerCase();
  if (action.startsWith("auth.")) return <KeyRound size={18} />;
  if (key.includes("instance") || key.includes("terminal")) return <TerminalIcon size={18} />;
  if (key.includes("task")) return <Clock size={18} />;
  if (key.includes("template")) return <LayoutTemplate size={18} />;
  if (key.includes("user") || key.includes("role")) return <UserCog size={18} />;
  if (key.includes("node") || key.includes("daemon")) return <Server size={18} />;
  if (key.includes("file")) return <FileText size={18} />;
  if (key.includes("saki")) return <Sparkles size={18} />;
  return <ClipboardList size={18} />;
}

function renderAuditPayloadDetails(
  log: AuditLogEntry,
  token: string,
  onPreview: (instanceId: string, path: string, action: string) => void
) {
  if (!log.payload) {
    return <div className="audit-payload-empty">无载荷</div>;
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(log.payload);
  } catch {
    return <pre>{log.payload}</pre>;
  }
  if (log.action === "saki.chat") {
    const conversation = parsed.conversation;
    if (conversation) {
      return (
        <div className="audit-payload-chat">
          <div className="chat-message user">
            <span className="chat-bubble-label">用户提问</span>
            <div className="chat-bubble-content">{conversation.userMessage}</div>
          </div>
          {conversation.assistantMessage && (
            <div className="chat-message assistant">
              <span className="chat-bubble-label">Saki 回答</span>
              <div className="chat-bubble-content">{conversation.assistantMessage}</div>
            </div>
          )}
          {parsed.error && (
            <div className="chat-message error-msg">
              <span className="chat-bubble-label">错误信息</span>
              <div className="chat-bubble-content error">{parsed.error}</div>
            </div>
          )}
        </div>
      );
    }
  }
  if (log.action === "saki.agent.tool") {
    return (
      <div className="audit-payload-tool">
        <div className="tool-header">
          <strong>工具:</strong> <code>{parsed.tool}</code>
          <span className={`tool-status-badge ${parsed.ok ? "success" : "failure"}`}>
            {parsed.status || (parsed.ok ? "completed" : "failed")}
          </span>
        </div>
        {parsed.args && (
          <div className="tool-section">
            <span className="section-label">参数 (Arguments)</span>
            <pre className="args-pre">{JSON.stringify(parsed.args, null, 2)}</pre>
          </div>
        )}
        {parsed.observation && (
          <div className="tool-section">
            <span className="section-label">结果 (Observation)</span>
            <pre className="observation-pre">{parsed.observation}</pre>
          </div>
        )}
      </div>
    );
  }
  if (log.action.startsWith("file.")) {
    const isWriteOrUpload = log.action === "file.write" || log.action === "file.upload";
    const isDownloadOrRead = log.action === "file.download" || log.action === "file.read";
    const isRenameOrCopy = log.action === "file.rename" || log.action === "file.copy";
    const hasPreview = (isWriteOrUpload || isDownloadOrRead) && parsed.path && log.resourceId;

    return (
      <div className="audit-payload-file">
        <div className="file-details">
          {parsed.path && (
            <div>
              <span>文件路径</span>
              <strong>{parsed.path}</strong>
            </div>
          )}
          {isRenameOrCopy && (
            <>
              {parsed.fromPath && (
                <div>
                  <span>来源路径</span>
                  <strong>{parsed.fromPath}</strong>
                </div>
              )}
              {parsed.toPath && (
                <div>
                  <span>目标路径</span>
                  <strong>{parsed.toPath}</strong>
                </div>
              )}
            </>
          )}
          {parsed.size !== undefined && (
            <div>
              <span>大小</span>
              <strong>{formatBytes(parsed.size)}</strong>
            </div>
          )}
          {parsed.error && (
            <div className="file-error">
              <span>失败原因</span>
              <strong className="error-text">{parsed.error}</strong>
            </div>
          )}
        </div>
        {hasPreview && (
          <button
            className="small-button preview-file-button"
            type="button"
            onClick={() => onPreview(log.resourceId!, parsed.path, log.action)}
          >
            <Eye size={14} />
            快速预览当前文件
          </button>
        )}
      </div>
    );
  }

  return <pre>{JSON.stringify(parsed, null, 2)}</pre>;
}

export function AuditView({
  token,
  onLogout,
  refreshTick,
  onAskSaki,
  canDeleteLogs,
  darkMode
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  canDeleteLogs: boolean;
  darkMode: boolean;
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [previewFile, setPreviewFile] = useState<{
    instanceId: string;
    filePath: string;
    actionName: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [auditDetailOpen, setAuditDetailOpen] = useState(false);
  const pageSize = 20;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const result = await api.auditLogs(token, page, pageSize);
      setLogs(result.data);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "审计日志读取失败");
    }
  }, [onLogout, token, page]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick, page]);

  const summary = useMemo(() => {
    const success = logs.filter((log) => log.result === "SUCCESS").length;
    const failure = logs.length - success;
    const actors = new Set(logs.map((log) => auditActor(log))).size;
    const resourceTypes = new Set(logs.map((log) => log.resourceType || "system")).size;
    const successRate = logs.length > 0 ? `${Math.round((success / logs.length) * 100)}%` : "-";
    return { actors, failure, resourceTypes, success, successRate };
  }, [logs]);

  const visibleStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = Math.min(total, page * pageSize);
  const latestLogAt = logs[0]?.createdAt ? formatDate(logs[0].createdAt) : "-";

  useEffect(() => {
    setSelectedLogId((current) => {
      if (current && logs.some((log) => log.id === current)) return current;
      return logs[0]?.id ?? null;
    });
  }, [logs]);

  useEffect(() => {
    const visibleIds = new Set(logs.map((log) => log.id));
    setSelectedLogIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [logs]);

  const selectedLogIdSet = useMemo(() => new Set(selectedLogIds), [selectedLogIds]);
  const allVisibleSelected = logs.length > 0 && logs.every((log) => selectedLogIdSet.has(log.id));

  function toggleLogSelection(id: string) {
    setSelectedLogIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleVisibleSelection() {
    if (allVisibleSelected) {
      setSelectedLogIds([]);
      return;
    }
    setSelectedLogIds(logs.map((log) => log.id));
  }

  async function refreshAfterDelete(deletedIds: string[]) {
    const deletedOnPage = logs.filter((log) => deletedIds.includes(log.id)).length;
    setSelectedLogIds((current) => current.filter((id) => !deletedIds.includes(id)));
    setSelectedLogId((current) => (current && deletedIds.includes(current) ? null : current));
    if (page > 1 && logs.length <= deletedOnPage) {
      setPage((current) => Math.max(1, current - 1));
      return;
    }
    await refresh();
  }

  function handleDeleteError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.status === 401) {
      onLogout();
      return;
    }
    setError(err instanceof Error ? err.message : fallback);
  }

  async function deleteActiveLog() {
    if (!activeLog || deleting) return;
    if (!window.confirm("确定删除当前审计日志吗？")) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await api.deleteAuditLog(token, activeLog.id);
      setNotice(`已删除 ${result.deleted} 条审计日志。`);
      await refreshAfterDelete([activeLog.id]);
    } catch (err) {
      handleDeleteError(err, "审计日志删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function deleteSelectedLogs() {
    if (selectedLogIds.length === 0 || deleting) return;
    if (!window.confirm(`确定删除选中的 ${selectedLogIds.length} 条审计日志吗？`)) return;
    const ids = [...selectedLogIds];
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await api.deleteAuditLogs(token, ids);
      setNotice(`已批量删除 ${result.deleted} 条审计日志。`);
      await refreshAfterDelete(ids);
    } catch (err) {
      handleDeleteError(err, "审计日志批量删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function clearAllLogs() {
    if (total === 0 || deleting) return;
    if (!window.confirm("确定清空全部审计日志吗？该操作无法撤销。")) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await api.clearAuditLogs(token);
      setNotice(`已清空 ${result.deleted} 条审计日志。`);
      setSelectedLogIds([]);
      setSelectedLogId(null);
      if (page !== 1) {
        setPage(1);
      } else {
        await refresh();
      }
    } catch (err) {
      handleDeleteError(err, "审计日志清空失败");
    } finally {
      setDeleting(false);
    }
  }

  function askSakiAboutLog(log: AuditLogEntry) {
    if (!onAskSaki) return;
    const payloadText = auditPayloadText(log.payload);
    onAskSaki({
      message: `请分析这条审计日志的风险，并在需要时继续查找相关记录：\n${log.action}`,
      contextTitle: `审计日志：${log.action}`,
      contextText: [
        `Action: ${log.action}`,
        `Result: ${log.result}`,
        `Actor: ${auditActor(log)}`,
        `Resource: ${auditResourceLabel(log)}`,
        `IP: ${log.ip ?? "-"}`,
        `Time: ${log.createdAt}`,
        payloadText ? `Payload:\n${payloadText}` : "Payload: none"
      ].join("\n"),
      mode: "agent",
      clearInstance: true
    });
  }

  function openAuditSaki() {
    if (!onAskSaki) return;
    onAskSaki({
      message: "请查找最近失败或高风险的审计日志，说明风险并给出下一步处理建议。",
      mode: "agent",
      clearInstance: true
    });
  }

  const activeLog = useMemo(() => {
    if (selectedLogId) {
      const found = logs.find((log) => log.id === selectedLogId);
      if (found) return found;
    }
    return logs[0] ?? null;
  }, [selectedLogId, logs]);
  const selectedPayloadText = activeLog ? auditPayloadText(activeLog.payload) : "";

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      {notice ? <div className="page-notice">{notice}</div> : null}
      <section className="panel-block audit-panel">
        <div className="audit-summary-grid">
          <div className="audit-summary-card success">
            <span>本页成功</span>
            <strong>{summary.success}</strong>
            <small>{summary.successRate}</small>
          </div>
          <div className="audit-summary-card failure">
            <span>本页失败</span>
            <strong>{summary.failure}</strong>
            <small>需关注</small>
          </div>
          <div className="audit-summary-card">
            <span>涉及用户</span>
            <strong>{summary.actors}</strong>
            <small>当前页</small>
          </div>
          <div className="audit-summary-card">
            <span>最新记录</span>
            <strong>{latestLogAt}</strong>
            <small>{summary.resourceTypes} 类资源</small>
          </div>
        </div>

        <div className="audit-workbench">
          <div className="audit-board">
            <div className="audit-stream-heading">
              <h3>信号矩阵</h3>
              <span>
                {visibleStart}-{visibleEnd} / {total}
              </span>
              <div className="audit-toolbar-actions">
                {onAskSaki ? (
                  <button className="icon-button mini" title="问 Saki" aria-label="问 Saki" type="button" onClick={openAuditSaki}>
                    <Sparkles size={15} />
                  </button>
                ) : null}
                {canDeleteLogs ? (
                  <>
                    <button
                      className={`icon-button mini ${allVisibleSelected ? "active" : ""}`}
                      type="button"
                      title={allVisibleSelected ? "取消选择本页" : "选择本页"}
                      aria-label={allVisibleSelected ? "取消选择本页" : "选择本页"}
                      disabled={logs.length === 0 || deleting}
                      onClick={toggleVisibleSelection}
                    >
                      <ListChecks size={15} />
                    </button>
                    <button
                      className="icon-button mini danger-action"
                      type="button"
                      title="批量删除选中项"
                      aria-label="批量删除选中项"
                      disabled={selectedLogIds.length === 0 || deleting}
                      onClick={() => void deleteSelectedLogs()}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      className="icon-button mini danger-action"
                      type="button"
                      title="删除当前日志"
                      aria-label="删除当前日志"
                      disabled={!activeLog || deleting}
                      onClick={() => void deleteActiveLog()}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      className="icon-button mini danger-action"
                      type="button"
                      title="清空全部日志"
                      aria-label="清空全部日志"
                      disabled={total === 0 || deleting}
                      onClick={() => void clearAllLogs()}
                    >
                      <Archive size={15} />
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {logs.length === 0 ? (
              <div style={{ padding: "24px 0" }}>
                <SakiEmptyState
                  illustration="logs"
                  title="暂无审计日志"
                  description="系统运行环境整洁安全，暂无新的操作信号或审计记录产生"
                />
              </div>
            ) : (
              <div className="audit-signal-grid">
                {logs.map((log, index) => {
                  const success = log.result === "SUCCESS";
                  const selected = activeLog?.id === log.id;
                  const featured = index === 0 || !success;
                  return (
                    <article
                      className={`audit-signal-tile ${success ? "success" : "failure"} ${featured ? "featured" : ""} ${
                        selected ? "active" : ""
                      } ${canDeleteLogs ? "selectable" : ""}`}
                      key={log.id}
                    >
                      <span className="audit-signal-bar" />
                      <button
                        className="audit-signal-main"
                        type="button"
                        onClick={() => {
                          setSelectedLogId(log.id);
                          setAuditDetailOpen(true);
                        }}
                      >
                        <span className="audit-signal-top">
                          <span className="audit-action-icon" aria-hidden="true">
                            {auditResourceIcon(log.resourceType, log.action)}
                          </span>
                          <span className={`audit-result-badge ${success ? "success" : "failure"}`}>
                            {success ? "成功" : "失败"}
                          </span>
                        </span>
                        <strong>{auditActionLabel(log.action)}</strong>
                        <code>{log.action}</code>
                        <span className="audit-signal-meta">
                          <span>{auditActor(log)}</span>
                          <span>{formatDate(log.createdAt)}</span>
                        </span>
                        <span className="audit-signal-resource">{auditResourceLabel(log)}</span>
                      </button>
                      {canDeleteLogs ? (
                        <label className="audit-select-check">
                          <input
                            type="checkbox"
                            checked={selectedLogIdSet.has(log.id)}
                            onChange={() => toggleLogSelection(log.id)}
                          />
                          <span>选择</span>
                        </label>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {totalPages > 1 && (
          <div className="audit-pagination">
            <button className="small-button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={16} />
              上一页
            </button>
            <span>{page} / {totalPages}</span>
            <button className="small-button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>

      {auditDetailOpen && activeLog && (
        <div
          className="modal-backdrop audit-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setAuditDetailOpen(false);
            }
          }}
        >
          <div className="modal-panel audit-detail-modal" role="dialog" aria-modal="true">
            <div className="audit-detail-glass-header">
              <div className={`audit-detail-head ${activeLog.result === "SUCCESS" ? "success" : "failure"}`}>
                <span className="audit-action-icon" aria-hidden="true">
                  {auditResourceIcon(activeLog.resourceType, activeLog.action)}
                </span>
                <div>
                  <p>{activeLog.result === "SUCCESS" ? "Verified" : "Attention"}</p>
                  <h3>{auditActionLabel(activeLog.action)}</h3>
                  <code>{activeLog.action}</code>
                </div>
              </div>
              <button className="icon-button mini audit-detail-close" title="关闭" type="button" onClick={() => setAuditDetailOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <div className="modal-body audit-detail-body">
              <div className="audit-detail-info-grid">
                <div>
                  <span>结果</span>
                  <strong className={activeLog.result === "SUCCESS" ? "success" : "failure"}>
                    {activeLog.result === "SUCCESS" ? "成功" : "失败"}
                  </strong>
                </div>
                <div>
                  <span>时间</span>
                  <strong>{formatDate(activeLog.createdAt)}</strong>
                </div>
                <div>
                  <span>用户</span>
                  <strong>{auditActor(activeLog)}</strong>
                </div>
                <div>
                  <span>资源</span>
                  <strong>{auditResourceLabel(activeLog)}</strong>
                </div>
                <div>
                  <span>IP</span>
                  <strong>{activeLog.ip ?? "-"}</strong>
                </div>
                <div>
                  <span>载荷</span>
                  <strong>{activeLog.payload ? "有" : "无"}</strong>
                </div>
              </div>

              {activeLog.payload && (
                <div className="audit-detail-payload">
                  <div className="audit-detail-section-title">
                    <FileText size={15} />
                    <span>Payload</span>
                    {onAskSaki ? (
                      <button
                        className="small-button"
                        type="button"
                        onClick={() => {
                          setAuditDetailOpen(false);
                          askSakiAboutLog(activeLog);
                        }}
                      >
                        <Sparkles size={14} />
                        交给 Saki
                      </button>
                    ) : null}
                  </div>
                  {renderAuditPayloadDetails(activeLog, token, (instanceId, filePath, actionName) => {
                    setAuditDetailOpen(false);
                    setPreviewFile({ instanceId, filePath, actionName });
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <FilePreviewModal
          token={token}
          instanceId={previewFile.instanceId}
          filePath={previewFile.filePath}
          actionName={previewFile.actionName}
          onClose={() => setPreviewFile(null)}
          darkMode={darkMode}
        />
      )}
    </>
  );
}
