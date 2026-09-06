import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Bot, CheckCircle2, Loader2, Square, Trash2, Undo2, X, XCircle } from "lucide-react";
import type { ManagedInstance } from "@webops/shared";
import { api, ApiError, type SakiActiveTaskSummary } from "./api.js";

function taskStatusLabel(status: SakiActiveTaskSummary["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "pending_approval":
      return "等待批准";
    default:
      return status;
  }
}

function formatElapsed(startedAt: string, updatedAt: string, running: boolean): string {
  const start = Date.parse(startedAt);
  const end = running ? Date.now() : Date.parse(updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function TaskStatusIcon({ status }: { status: SakiActiveTaskSummary["status"] }) {
  if (status === "running") return <Loader2 size={13} className="status-spinner" />;
  if (status === "completed") return <CheckCircle2 size={13} />;
  if (status === "failed") return <XCircle size={13} />;
  if (status === "cancelled") return <XCircle size={13} />;
  return <Activity size={13} />;
}

export function AgentMonitorBell({
  token,
  onLogout,
  onOpenTask
}: {
  token: string;
  onLogout: () => void;
  onOpenTask: (task: SakiActiveTaskSummary, instance: ManagedInstance | null) => void;
}) {
  const [tasks, setTasks] = useState<SakiActiveTaskSummary[]>([]);
  const [runningCount, setRunningCount] = useState(0);
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const [operatingTaskId, setOperatingTaskId] = useState<string | null>(null);
  const [globalOperating, setGlobalOperating] = useState<"stop_all" | "clear_finished" | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.sakiGetActiveTasks(token);
      setTasks(result.tasks);
      setRunningCount(result.runningCount);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onLogout();
    }
  }, [onLogout, token]);

  const refreshInstances = useCallback(async () => {
    try {
      setInstances(await api.instances(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onLogout();
    }
  }, [onLogout, token]);

  useEffect(() => {
    void refresh();
    void refreshInstances();
  }, [refresh, refreshInstances]);

  useEffect(() => {
    const handleTaskUpdated = () => {
      void refresh();
      if (open) void refreshInstances();
    };
    window.addEventListener("saki:active_task_updated", handleTaskUpdated);
    return () => window.removeEventListener("saki:active_task_updated", handleTaskUpdated);
  }, [open, refresh, refreshInstances]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
      if (open) void refreshInstances();
    }, open ? 2000 : 8000);
    return () => window.clearInterval(timer);
  }, [open, refresh, refreshInstances]);

  // Auto-dismiss feedback message after 3.5s
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Tick once per second while running tasks exist so elapsed times stay live.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (runningCount === 0) return;
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runningCount]);

  const finishedTasksCount = tasks.filter((t) => t.status !== "running").length;

  const handleStopAll = async () => {
    if (runningCount === 0 || globalOperating) return;
    if (!window.confirm("确定要停止所有正在运行的 Agent 任务吗？")) return;
    setGlobalOperating("stop_all");
    try {
      const result = await api.sakiCancelAllTasks(token);
      setFeedback({
        type: "success",
        message: `已停止 ${result.cancelledCount} 个运行中任务`
      });
      await refresh();
      window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
    } catch (err) {
      setFeedback({
        type: "error",
        message: `停止失败: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setGlobalOperating(null);
    }
  };

  const handleClearFinished = async () => {
    if (finishedTasksCount === 0 || globalOperating) return;
    setGlobalOperating("clear_finished");
    try {
      const result = await api.sakiClearFinishedTasks(token);
      setFeedback({
        type: "success",
        message: `已清理 ${result.deletedCount} 个已结束任务`
      });
      await refresh();
      window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
    } catch (err) {
      setFeedback({
        type: "error",
        message: `清理失败: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setGlobalOperating(null);
    }
  };

  const handleStopTask = async (taskId: string) => {
    if (operatingTaskId) return;
    setOperatingTaskId(taskId);
    try {
      await api.sakiCancelTask(token, taskId);
      setFeedback({
        type: "success",
        message: "已发送停止指令"
      });
      await refresh();
      window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
    } catch (err) {
      setFeedback({
        type: "error",
        message: `停止任务失败: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setOperatingTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (operatingTaskId) return;
    setOperatingTaskId(taskId);
    try {
      await api.sakiDeleteTask(token, taskId);
      setFeedback({
        type: "success",
        message: "任务已删除"
      });
      await refresh();
      window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
    } catch (err) {
      setFeedback({
        type: "error",
        message: `删除任务失败: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setOperatingTaskId(null);
    }
  };

  const handleRollbackTask = async (taskId: string) => {
    if (operatingTaskId) return;
    if (!window.confirm("确定要撤销并回溯此任务产生的所有代码与配置修改吗？此操作将还原相关文件。")) return;
    setOperatingTaskId(taskId);
    try {
      const result = await api.sakiRollbackTask(token, taskId);
      setFeedback({
        type: "success",
        message: result.message || `已成功回溯 ${result.rolledBackCount} 处修改`
      });
      window.dispatchEvent(new CustomEvent("saki:files_modified"));
      window.dispatchEvent(new CustomEvent("workspace:refresh"));
      window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
      await refresh();
    } catch (err) {
      setFeedback({
        type: "error",
        message: `回溯失败: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setOperatingTaskId(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    function placePopover() {
      const button = containerRef.current?.querySelector("button");
      if (!button) return;
      if (window.matchMedia("(max-width: 720px)").matches) {
        setPopoverPos(null);
        return;
      }
      const rect = button.getBoundingClientRect();
      const width = popoverRef.current?.offsetWidth || 380;
      const idealRight = window.innerWidth - rect.right;
      const maxRight = Math.max(12, window.innerWidth - width - 12);
      setPopoverPos({
        top: Math.round(rect.bottom + 10),
        right: Math.round(Math.min(Math.max(12, idealRight), maxRight))
      });
    }
    placePopover();
    const settleFrame = window.requestAnimationFrame(() => placePopover());
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    return () => {
      window.cancelAnimationFrame(settleFrame);
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));

  const popover = open
    ? createPortal(
        <>
          <div className="incident-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={popoverRef}
            className="incident-popover agent-monitor-popover"
            role="dialog"
            aria-label="Agent 任务监控"
            style={popoverPos ? { top: popoverPos.top, right: popoverPos.right } : undefined}
          >
            <div className="incident-popover-header">
              <div className="incident-popover-title-wrap">
                <strong>Agent 任务</strong>
                <span className={`incident-popover-pill ${runningCount === 0 ? "is-clean" : ""}`}>
                  {runningCount > 0 ? `${runningCount} 个运行中` : "暂无运行中"}
                </span>
              </div>
              <button
                type="button"
                className="incident-popover-close"
                onClick={() => setOpen(false)}
                title="关闭"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>

            {/* Quick action toolbar */}
            <div className="agent-monitor-toolbar">
              <button
                type="button"
                className="agent-monitor-quick-btn danger"
                disabled={runningCount === 0 || Boolean(globalOperating)}
                onClick={() => void handleStopAll()}
                title="停止所有正在运行的任务"
              >
                {globalOperating === "stop_all" ? (
                  <Loader2 size={12} className="status-spinner" />
                ) : (
                  <Square size={12} />
                )}
                <span>全部停止</span>
                {runningCount > 0 ? <span className="quick-btn-badge">{runningCount}</span> : null}
              </button>

              <button
                type="button"
                className="agent-monitor-quick-btn"
                disabled={finishedTasksCount === 0 || Boolean(globalOperating)}
                onClick={() => void handleClearFinished()}
                title="删除所有已完成、已取消或失败的任务记录"
              >
                {globalOperating === "clear_finished" ? (
                  <Loader2 size={12} className="status-spinner" />
                ) : (
                  <Trash2 size={12} />
                )}
                <span>删除已完成任务</span>
                {finishedTasksCount > 0 ? <span className="quick-btn-badge">{finishedTasksCount}</span> : null}
              </button>
            </div>

            {feedback ? (
              <div className={`agent-monitor-feedback ${feedback.type}`} role="status">
                <span>{feedback.message}</span>
              </div>
            ) : null}

            {tasks.length === 0 ? (
              <div className="incident-empty">
                <Bot size={28} aria-hidden="true" />
                <strong style={{ fontSize: "14px", color: "var(--text-main, #1e293b)" }}>暂无 Agent 任务</strong>
                <span>发起 Agent 对话后，可以在这里随时查看进度</span>
              </div>
            ) : (
              <ul className="incident-list">
                {tasks.map((task) => {
                  const running = task.status === "running";
                  const instance = task.instanceId ? instanceById.get(task.instanceId) ?? null : null;
                  const isOperatingThis = operatingTaskId === task.id;
                  return (
                    <li key={task.id} className={`incident-item agent-task-item status-${task.status}`}>
                      <button
                        className="incident-item-main"
                        type="button"
                        onClick={() => {
                          onOpenTask(task, instance);
                          setOpen(false);
                        }}
                      >
                        <div className="incident-item-header-row">
                          <span className={`agent-task-status status-${task.status}`}>
                            <TaskStatusIcon status={task.status} />
                            {taskStatusLabel(task.status)}
                          </span>
                          <span className="incident-badge-meta">
                            <span>{instance?.name ?? (task.instanceId ? "未知实例" : "全局会话")}</span>
                            {" · "}
                            {formatElapsed(task.startedAt, task.updatedAt, running)}
                          </span>
                        </div>
                        <span className="agent-task-message">{task.message || "（空任务）"}</span>
                        {running ? (
                          <span className="agent-task-progress">
                            {task.progress?.message ? (
                              <>
                                <Activity size={11} aria-hidden="true" />
                                {task.progress.message}
                              </>
                            ) : (
                              <>
                                <Loader2 size={11} className="status-spinner" aria-hidden="true" />
                                正在处理任务...
                              </>
                            )}
                          </span>
                        ) : null}
                        <span className="agent-task-meta">
                          <span>{task.actionCount > 0 ? `${task.actionCount} 个动作` : "等待模型输出"}</span>
                          {task.hasRollback ? " · 可回溯代码" : ""}
                          {task.error ? ` · ${task.error}` : ""}
                        </span>
                      </button>
                      <div className="agent-task-item-actions">
                        {running ? (
                          <button
                            type="button"
                            className="agent-task-action-btn btn-stop"
                            disabled={isOperatingThis}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleStopTask(task.id);
                            }}
                            title="停止此任务"
                          >
                            {isOperatingThis ? (
                              <Loader2 size={11} className="status-spinner" />
                            ) : (
                              <Square size={11} />
                            )}
                            <span>停止</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="agent-task-action-btn btn-rollback"
                          disabled={isOperatingThis}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleRollbackTask(task.id);
                          }}
                          title="撤销并回溯此任务生成的所有代码与配置修改"
                        >
                          {isOperatingThis ? (
                            <Loader2 size={11} className="status-spinner" />
                          ) : (
                            <Undo2 size={11} />
                          )}
                          <span>撤销（回溯全部代码）</span>
                        </button>
                        <button
                          type="button"
                          className="agent-task-action-btn btn-delete"
                          disabled={isOperatingThis}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteTask(task.id);
                          }}
                          title="删除此任务记录"
                        >
                          <Trash2 size={11} />
                          <span>删除</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div className={`incident-bell agent-monitor-bell ${open ? "is-open" : ""}`} ref={containerRef}>
      <button
        className={`topbar-refresh-btn agent-monitor-button ${runningCount ? "has-open" : ""} ${open ? "is-active" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={runningCount ? `${runningCount} 个 Agent 任务运行中` : "Agent 任务监控"}
        onClick={() => {
          setOpen((value) => {
            const next = !value;
            if (next) {
              void refresh();
              void refreshInstances();
            }
            return next;
          });
        }}
      >
        <Bot size={14} />
        {runningCount > 0 ? (
          <span className="incident-bell-count">{runningCount > 9 ? "9+" : runningCount}</span>
        ) : null}
      </button>
      {popover}
    </div>
  );
}
