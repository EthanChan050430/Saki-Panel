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
import type { ManagedInstance, ManagedScheduledTask, ManagedTaskRun, ScheduledTaskType } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { usePanelT } from "../i18n/index.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { sakiArtAssets } from "../constants.js";
import { formatDate } from "../utils/path.js";

function taskTypeLabel(type: ScheduledTaskType): string {
  const labels: Record<ScheduledTaskType, string> = {
    run_command: "执行命令",
    restart_instance: "重启实例",
    stop_instance: "停止实例",
    start_instance: "启动实例"
  };
  return labels[type];
}

export function TasksView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [tasks, setTasks] = useState<ManagedScheduledTask[]>([]);
  const [runs, setRuns] = useState<ManagedTaskRun[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "daily-restart",
    type: "restart_instance" as ScheduledTaskType,
    instanceId: "",
    cron: "@every 30m",
    command: "",
    enabled: true
  });

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextInstances, nextTasks] = await Promise.all([api.instances(token), api.tasks(token)]);
      setInstances(nextInstances);
      setTasks(nextTasks);
      setForm((current) => ({
        ...current,
        instanceId: current.instanceId || nextInstances[0]?.id || ""
      }));
      if (!selectedTaskId && nextTasks[0]) {
        setSelectedTaskId(nextTasks[0].id);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "任务刷新失败");
    }
  }, [onLogout, selectedTaskId, token]);

  const refreshRuns = useCallback(
    async (taskId: string) => {
      try {
        setRuns(await api.taskRuns(token, taskId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "任务记录读取失败");
      }
    },
    [token]
  );

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
        instanceId: form.instanceId,
        enabled: form.enabled,
        payload: form.type === "run_command" ? { command: form.command } : {}
      });
      setTasks((current) => [task, ...current]);
      setSelectedTaskId(task.id);
      setForm((current) => ({
        ...current,
        name: "daily-restart",
        type: "restart_instance",
        cron: "@every 30m",
        command: "",
        enabled: true
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务创建失败");
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
      setError(err instanceof Error ? err.message : "任务执行失败");
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
      setError(err instanceof Error ? err.message : "任务状态更新失败");
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
      setError(err instanceof Error ? err.message : "任务删除失败");
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />

      <section className="task-layout">
        <div className="panel-block task-form-panel">
          <div className="section-heading">
            <h2>创建任务</h2>
          </div>
          <form className="task-form" onSubmit={createTask}>
            <label>
              名称
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label>
              类型
              <select
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as ScheduledTaskType }))}
              >
                <option value="restart_instance">重启实例</option>
                <option value="start_instance">启动实例</option>
                <option value="stop_instance">停止实例</option>
                <option value="run_command">执行命令</option>
              </select>
            </label>
            <label>
              实例
              <select
                value={form.instanceId}
                onChange={(event) => setForm((current) => ({ ...current, instanceId: event.target.value }))}
                required
              >
                <option value="" disabled>
                  选择实例
                </option>
                {instances.map((instance) => (
                  <option value={instance.id} key={instance.id}>
                    {instance.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              计划
              <input
                value={form.cron}
                onChange={(event) => setForm((current) => ({ ...current, cron: event.target.value }))}
                placeholder="@every 30m 或 */5 * * * *"
                required
              />
            </label>
            {form.type === "run_command" ? (
              <label className="wide-field">
                命令
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
              <span>启用任务</span>
            </label>
            <button className="primary-button form-submit" disabled={creating || instances.length === 0} type="submit">
              <Clock size={18} />
              {creating ? "创建中" : "创建任务"}
            </button>
          </form>
        </div>

        <div className="panel-block tasks-panel">
          <div className="section-heading">
            <h2>计划任务</h2>
            <span>{tasks.length} 个</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
                  <th>实例</th>
                  <th>计划</th>
                  <th>下次运行</th>
                  <th>状态</th>
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
                      <td>{task.instanceName ?? task.instanceId ?? "-"}</td>
                      <td>{task.cron}</td>
                      <td>{formatDate(task.nextRunAt)}</td>
                      <td>{task.enabled ? "启用" : "停用"}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button mini"
                            disabled={busy}
                            title="运行任务"
                            aria-label="运行任务"
                            type="button"
                            onClick={() => void runTask(task)}
                          >
                            <Play size={14} />
                          </button>
                          <button
                            className={`icon-button mini ${task.enabled ? "active" : ""}`}
                            disabled={busy}
                            title={task.enabled ? "停用任务" : "启用任务"}
                            aria-label={task.enabled ? "停用任务" : "启用任务"}
                            type="button"
                            onClick={() => void toggleTask(task)}
                          >
                            <Power size={14} />
                          </button>
                          <button
                            className="icon-button mini danger-action"
                            disabled={busy}
                            title="删除任务"
                            aria-label="删除任务"
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
                    <td colSpan={7}>
                      <div className="empty-state">暂无计划任务</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel-block task-runs-panel">
        <div className="section-heading">
          <h2>{selectedTask ? `${selectedTask.name} 运行记录` : "运行记录"}</h2>
          <span>{selectedTask ? formatDate(selectedTask.lastRunAt) : "-"}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>开始时间</th>
                <th>结束时间</th>
                <th>状态</th>
                <th>输出</th>
                <th>错误</th>
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
                    <div className="empty-state">暂无运行记录</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

