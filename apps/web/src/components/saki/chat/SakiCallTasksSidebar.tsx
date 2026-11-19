import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { api, type SakiActiveTaskSummary } from "../../../api.js";
import { dashboardTaskIsPending } from "../../dashboard/task-runtime.js";
import { SakiMessagesList, type SakiMessagesListProps } from "./SakiMessagesList.js";

interface SakiCallTasksSidebarProps {
  id: string;
  token: string;
  language: string;
  conversation: SakiMessagesListProps;
  progress: ReactNode;
  notice: string | null;
  onClose: () => void;
  onOpenConversation: () => void;
}

export function SakiCallTasksSidebar({ id, token, language, conversation, progress, notice, onClose, onOpenConversation }: SakiCallTasksSidebarProps) {
  const [tasks, setTasks] = useState<SakiActiveTaskSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const followMessages = useRef(true);
  const { conversationId, messagesRef, messages } = conversation;
  const copy = (cn: string, en: string) => language.startsWith("zh") ? cn : en;

  useLayoutEffect(() => {
    followMessages.current = true;
  }, [conversationId]);

  useLayoutEffect(() => {
    const element = messagesRef.current;
    if (element && followMessages.current) element.scrollTop = element.scrollHeight;
  }, [conversationId, messages, messagesRef]);

  useEffect(() => {
    let disposed = false;
    let request: AbortController | undefined;
    let refreshQueued = false;
    async function refresh() {
      if (request) {
        refreshQueued = true;
        return;
      }
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const result = await api.sakiGetActiveTasks(token, { excludeResponse: true, signal: controller.signal });
        if (!disposed) {
          setTasks(result.tasks.filter(dashboardTaskIsPending));
          setFailed(false);
        }
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        window.clearTimeout(timeout);
        request = undefined;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          void refresh();
        }
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    window.addEventListener("saki:active_task_updated", refresh);
    return () => {
      disposed = true;
      request?.abort();
      window.clearInterval(timer);
      window.removeEventListener("saki:active_task_updated", refresh);
    };
  }, [token]);

  return (
    <aside id={id} aria-labelledby={`${id}-title`} className="saki-task-call-task-sidebar">
      <div className="saki-task-call-task-heading" data-i18n-skip>
        <h2 id={`${id}-title`}>{copy("对话与工具调用", "Conversation and tool calls")}</h2>
        <button type="button" className="saki-task-call-task-close" aria-label={copy("关闭任务侧栏", "Close task sidebar")}
          autoFocus onClick={onClose}><X size={16} /></button>
      </div>
      <details className="saki-task-call-task-summary" data-i18n-skip>
        <summary>{copy("进行中的任务", "Active tasks")}{tasks ? ` (${tasks.length})` : ""}</summary>
        <div className="saki-task-call-task-scroll">
          {failed ? (
            <p className="saki-task-call-task-note" role="status">{copy("暂时无法刷新任务。", "Could not refresh tasks.")}</p>
          ) : tasks?.length ? null : (
            <p className="saki-task-call-task-note" role="status">{tasks
              ? copy("暂无进行中的任务", "No active tasks")
              : copy("正在加载任务…", "Loading tasks…")}</p>
          )}
          {tasks?.length ? (
            <ul className="saki-task-call-task-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <div className="saki-task-call-task-meta">
                    <span data-status={task.status}>{task.status === "running" ? copy("执行中", "Running")
                      : task.status === "pending_approval" ? copy("等待确认", "Awaiting approval")
                      : copy("等待回复", "Awaiting input")}</span>
                    {task.conversationId === conversationId ? <small>{copy("当前对话", "Current conversation")}</small> : null}
                  </div>
                  <p className="saki-task-call-task-message">{task.message}</p>
                  {task.progress?.message && task.progress.message !== task.message
                    ? <small className="saki-task-call-task-progress">{task.progress.message}</small> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
      <SakiMessagesList {...conversation} mode="agent" onScroll={(event) => {
        const element = event.currentTarget;
        followMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
        conversation.onScroll(event);
      }} />
      {progress}
      {notice ? <p className="saki-task-call-task-note" role="status">{notice}</p> : null}
      <button type="button" className="saki-task-call-task-conversation" data-i18n-skip onClick={onOpenConversation}>
        {copy("打开主聊天", "Open main chat")} <ArrowUpRight size={14} />
      </button>
    </aside>
  );
}
