import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Edit3,
  History,
  Play,
  Plus,
  Power,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import type {
  ManagedInstance,
  ManagedScheduledTask,
  ManagedTaskRun,
  ScheduledTaskType
} from "@webops/shared";
import { api, ApiError } from "../../api.js";
import { usePanelT } from "../../i18n/index.js";
import { PageErrorToast, taskTypeLabel } from "../../components/common/CommonUI.js";
import { SakiEmptyState } from "../../components/saki/SakiEmptyState.js";
import { sakiArtAssets } from "../../constants.js";
import { formatDate } from "../../utils/path.js";

export function InstanceTasksPanel({
  token,
  onLogout,
  refreshTick,
  instance,
  onClose
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  instance: ManagedInstance;
  onClose: () => void;
}) {
  const t = usePanelT();
  const [tasks, setTasks] = useState<ManagedScheduledTask[]>([]);
  const [runs, setRuns] = useState<ManagedTaskRun[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: `${instance.name}-restart`,
    type: "restart_instance" as ScheduledTaskType,
    cron: "@every 30m",
    command: "",
    enabled: true
  });

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const nextTasks = await api.tasks(token, instance.id);
      setTasks(nextTasks);
      setSelectedTaskId((current) =>
        current && nextTasks.some((task) => task.id === current) ? current : nextTasks[0]?.id ?? null
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : t("tasks.errorRefresh"));
    }
  }, [instance.id, onLogout, t, token]);

  const refreshRuns = useCallback(
    async (taskId: string) => {
      try {
        setRuns(await api.taskRuns(token, taskId));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("tasks.errorRuns"));
      }
    },
    [t, token]
  );

  useEffect(() => {
    setRuns([]);
    setSelectedTaskId(null);
    setForm({
      name: `${instance.name}-restart`,
      type: "restart_instance",
      cron: "@every 30m",
      command: "",
      enabled: true
    });
  }, [instance.id, instance.name]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  useEffect(() => {
    if (!selectedTaskId) {
      setRuns([]);
      return;
    }
    void refreshRuns(selectedTaskId);
  }, [refreshRuns, selectedTaskId]);

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const task = await api.createTask(token, {
        name: form.name,
        type: form.type,
        cron: form.cron,
        instanceId: instance.id,
        enabled: form.enabled,
        payload: form.type === "run_command" ? { command: form.command } : {}
      });
      setTasks((current) => [task, ...current]);
      setSelectedTaskId(task.id);
      setForm((current) => ({
        ...current,
        name: `${instance.name}-restart`,
        type: "restart_instance",
        cron: "@every 30m",
        command: "",
        enabled: true
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tasks.errorCreate"));
    } finally {
      setCreating(false);
    }
  }

  async function runTask(task: ManagedScheduledTask) {
    setBusyTaskId(task.id);
    setError("");
    try {
      await api.runTask(token, task.id);
      await refresh();
      await refreshRuns(task.id);
      setSelectedTaskId(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tasks.errorRun"));
    } finally {
      setBusyTaskId(null);
    }
  }

  async function toggleTask(task: ManagedScheduledTask) {
    setBusyTaskId(task.id);
    setError("");
    try {
      const updated = await api.updateTask(token, task.id, { enabled: !task.enabled });
      setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tasks.errorUpdate"));
    } finally {
      setBusyTaskId(null);
    }
  }

  async function deleteTask(task: ManagedScheduledTask) {
    if (!window.confirm(`删除任务 ${task.name}？`)) return;
    setBusyTaskId(task.id);
    setError("");
    try {
      await api.deleteTask(token, task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      if (selectedTaskId === task.id) {
        setSelectedTaskId(null);
        setRuns([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tasks.errorDelete"));
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <div
      className="modal-backdrop task-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-panel task-modal-panel instance-task-panel" role="dialog" aria-modal="true" aria-labelledby="instance-task-title">
        <div className="glass-modal-header task-modal-header modal-heading">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Clock size={20} />
            </div>
            <div>
              <h2 className="modal-title" id="instance-task-title">{t("tasks.title")}</h2>
              <span className="modal-subtitle">{tasks.length} {t("tasks.countUnit")} · {instance.name}</span>
            </div>
          </div>
          <button className="icon-button mini modal-close-btn" title={t("common.close")} aria-label={t("common.close")} type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      {error ? <div className="inline-panel-error">{error}</div> : null}
      <div className="instance-task-layout">
        <form className="task-form instance-task-form" onSubmit={createTask}>
          <label>
            {t("tasks.name")}
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            {t("tasks.type")}
            <select
              value={form.type}
              onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as ScheduledTaskType }))}
            >
              <option value="restart_instance">{t("tasks.type.restart")}</option>
              <option value="start_instance">{t("tasks.type.start")}</option>
              <option value="stop_instance">{t("tasks.type.stop")}</option>
              <option value="run_command">{t("tasks.type.command")}</option>
            </select>
          </label>
          <label>
            {t("tasks.schedule")}
            <input
              value={form.cron}
              onChange={(event) => setForm((current) => ({ ...current, cron: event.target.value }))}
              placeholder="@every 30m 或 */5 * * * *"
              required
            />
          </label>
          {form.type === "run_command" ? (
            <label className="wide-field">
              {t("tasks.command")}
              <input
                value={form.command}
                onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                required
              />
            </label>
          ) : null}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span>{t("tasks.enabled")}</span>
          </label>
          <button className="primary-button form-submit" disabled={creating} type="submit">
            <Clock size={18} />
            {creating ? t("tasks.creating") : t("tasks.create")}
          </button>
        </form>

        <div className="instance-task-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("tasks.name")}</th>
                  <th>{t("tasks.type")}</th>
                  <th>{t("tasks.schedule")}</th>
                  <th>{t("tasks.nextRun")}</th>
                  <th>{t("tasks.status")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const busy = busyTaskId === task.id;
                  return (
                    <tr className={selectedTaskId === task.id ? "selected-row" : ""} key={task.id}>
                      <td>
                        <button className="link-button" onClick={() => setSelectedTaskId(task.id)}>
                          {task.name}
                        </button>
                      </td>
                      <td>{taskTypeLabel(task.type)}</td>
                      <td>{task.cron}</td>
                      <td>{formatDate(task.nextRunAt)}</td>
                      <td>{task.enabled ? t("tasks.enable") : t("tasks.disable")}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button mini"
                            disabled={busy}
                            title={t("tasks.run")}
                            aria-label={t("tasks.run")}
                            type="button"
                            onClick={() => void runTask(task)}
                          >
                            <Play size={14} />
                          </button>
                          <button
                            className={`icon-button mini ${task.enabled ? "active" : ""}`}
                            disabled={busy}
                            title={task.enabled ? t("tasks.disable") : t("tasks.enable")}
                            aria-label={task.enabled ? t("tasks.disable") : t("tasks.enable")}
                            type="button"
                            onClick={() => void toggleTask(task)}
                          >
                            <Power size={14} />
                          </button>
                          <button
                            className="icon-button mini danger-action"
                            disabled={busy}
                            title={t("common.remove")}
                            aria-label={t("common.remove")}
                            type="button"
                            onClick={() => void deleteTask(task)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <SakiEmptyState
                        illustration="tasks"
                        title={t("tasks.empty")}
                        description="Saki 正在待命休眠，你可以添加定时脚本、健康检查或自动备份任务"
                        compact
                      />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="instance-task-runs">
        <div className="section-heading subtle-heading">
          <h2>{selectedTask ? `${selectedTask.name} ${t("tasks.runRecords")}` : t("tasks.runRecords")}</h2>
          <span>{selectedTask ? formatDate(selectedTask.lastRunAt) : "-"}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("tasks.startTime")}</th>
                <th>{t("tasks.endTime")}</th>
                <th>{t("tasks.status")}</th>
                <th>{t("tasks.output")}</th>
                <th>{t("tasks.error")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatDate(run.startedAt)}</td>
                  <td>{formatDate(run.finishedAt)}</td>
                  <td>{run.status === "SUCCESS" ? "成功" : run.status === "FAILURE" ? "失败" : "执行中"}</td>
                  <td className="command-cell">{run.output ?? "-"}</td>
                  <td className="command-cell">{run.error ?? "-"}</td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <SakiEmptyState
                      illustration="logs"
                      title="暂无运行记录"
                      description="该计划任务尚未被触发执行"
                      compact
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}

