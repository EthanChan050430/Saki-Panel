import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Edit3,
  FileJson,
  Info,
  LayoutTemplate,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { InstanceTemplate, InstanceType, ManagedInstance, ManagedNode, RestartPolicy, UpdateTemplateRequest } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { useNotificationCenter } from "../NotificationCenter.js";

function restartPolicyLabel(policy: RestartPolicy): string {
  const labels: Record<RestartPolicy, string> = {
    never: "不自动重启",
    on_failure: "异常退出重启",
    always: "总是重启",
    fixed_interval: "固定间隔重启"
  };
  return labels[policy];
}

function instanceTypeLabel(type: InstanceType): string {
  const labels: Record<InstanceType, string> = {
    generic_command: "通用命令",
    nodejs: "Node.js",
    python: "Python",
    java_jar: "Java Jar",
    shell_script: "Shell 脚本",
    docker_container: "Docker",
    docker_compose: "Docker Compose",
    minecraft: "Minecraft",
    steam_game_server: "Steam 游戏服务"
  };
  return labels[type] ?? type;
}

export function TemplatesView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [suggestingStartCommand, setSuggestingStartCommand] = useState(false);

  // "Save from instance" dialog state
  const [showSaveFromInstance, setShowSaveFromInstance] = useState(false);
  const [instancesForSave, setInstancesForSave] = useState<ManagedInstance[]>([]);
  const [saveForm, setSaveForm] = useState({ instanceId: "", name: "", description: "", startCommand: "", stopCommand: "", workingDirectoryPrefix: "" });
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Inline editor state (for user templates)
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateTemplateRequest>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Instance-creation form (right pane)
  const [form, setForm] = useState({
    nodeId: "",
    name: "",
    workingDirectory: "",
    startCommand: "",
    autoStart: false,
    restartPolicy: "never" as RestartPolicy,
    restartMaxRetries: 3
  });

  const { pushNotification } = useNotificationCenter();

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const builtinTemplates = useMemo(() => templates.filter((t) => t.isBuiltin), [templates]);
  const userTemplates = useMemo(() => templates.filter((t) => !t.isBuiltin), [templates]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextNodes, nextTemplates] = await Promise.all([api.nodes(token), api.templates(token)]);
      setNodes(nextNodes);
      setTemplates(nextTemplates);
      setSelectedTemplateId((current) => current || nextTemplates[0]?.id || "");
      setForm((current) => ({
        ...current,
        nodeId: current.nodeId || nextNodes[0]?.id || ""
      }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "模板读取失败");
    }
  }, [onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  useEffect(() => {
    if (!selectedTemplate) return;
    setForm((current) => ({
      ...current,
      name: current.name || selectedTemplate.name,
      startCommand: selectedTemplate.defaultStartCommand
    }));
    setEditing(false);
    setEditForm({});
  }, [selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------------------
  // Instance → template
  // --------------------------------------------------------------

  async function openSaveFromInstanceDialog() {
    try {
      const instances = await api.instances(token);
      setInstancesForSave(instances);
      setSaveForm({ instanceId: "", name: "", description: "", startCommand: "", stopCommand: "", workingDirectoryPrefix: "" });
      setShowSaveFromInstance(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "实例列表读取失败");
    }
  }

  useEffect(() => {
    if (!showSaveFromInstance) return;
    const inst = instancesForSave.find((i) => i.id === saveForm.instanceId);
    if (!inst) return;
    setSaveForm((current) => ({
      ...current,
      name: current.name || `${inst.name} 模板`,
      description: current.description || (inst.description ?? ""),
      startCommand: current.startCommand || inst.startCommand,
      stopCommand: current.stopCommand ?? inst.stopCommand ?? "",
      workingDirectoryPrefix: current.workingDirectoryPrefix || inst.workingDirectory.split(/[\\/]/).slice(0, 2).join("/")
    }));
  }, [saveForm.instanceId, instancesForSave, showSaveFromInstance]);

  async function saveTemplateFromInstance() {
    if (!saveForm.instanceId || !saveForm.name.trim()) return;
    setSavingTemplate(true);
    setError("");
    try {
      const created = await api.saveTemplateFromInstance(token, saveForm.instanceId, {
        name: saveForm.name.trim(),
        ...(saveForm.description.trim() ? { description: saveForm.description.trim() } : {}),
        ...(saveForm.startCommand.trim() ? { startCommand: saveForm.startCommand.trim() } : {}),
        ...(saveForm.stopCommand !== "" ? { stopCommand: saveForm.stopCommand } : {}),
        ...(saveForm.workingDirectoryPrefix.trim() ? { workingDirectoryPrefix: saveForm.workingDirectoryPrefix.trim() } : {})
      });
      setShowSaveFromInstance(false);
      setSelectedTemplateId(created.id);
      await refresh();
      pushNotification("success", `模板 "${created.name}" 已保存`, { durationMs: 4000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板保存失败");
    } finally {
      setSavingTemplate(false);
    }
  }

  // --------------------------------------------------------------
  // Edit / delete user templates
  // --------------------------------------------------------------

  function startEditing() {
    if (!selectedTemplate || selectedTemplate.isBuiltin) return;
    const form: UpdateTemplateRequest = {
      name: selectedTemplate.name,
      defaultStartCommand: selectedTemplate.defaultStartCommand,
      defaultWorkingDirectoryPrefix: selectedTemplate.defaultWorkingDirectoryPrefix,
      autoStart: selectedTemplate.autoStart,
      restartPolicy: selectedTemplate.restartPolicy,
      restartMaxRetries: selectedTemplate.restartMaxRetries
    };
    if (selectedTemplate.description !== null) form.description = selectedTemplate.description;
    if (selectedTemplate.defaultStopCommand !== null) form.defaultStopCommand = selectedTemplate.defaultStopCommand;
    if (selectedTemplate.runAsUser !== null) form.runAsUser = selectedTemplate.runAsUser;
    if (selectedTemplate.memoryLimit !== null) form.memoryLimit = selectedTemplate.memoryLimit;
    if (selectedTemplate.cpuLimit !== null) form.cpuLimit = selectedTemplate.cpuLimit;
    setEditForm(form);
    setEditing(true);
  }

  async function saveEdit() {
    if (!selectedTemplate) return;
    setSavingEdit(true);
    setError("");
    try {
      const updated = await api.updateTemplate(token, selectedTemplate.id, editForm);
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditing(false);
      pushNotification("success", `模板 "${updated.name}" 已更新`, { durationMs: 3000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板更新失败");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteTemplate() {
    if (!selectedTemplate || selectedTemplate.isBuiltin) return;
    if (!confirm(`确定删除模板 "${selectedTemplate.name}"？此操作不可撤销。`)) return;
    setError("");
    try {
      await api.deleteTemplate(token, selectedTemplate.id);
      setTemplates((prev) => prev.filter((t) => t.id !== selectedTemplate.id));
      setSelectedTemplateId("");
      pushNotification("info", `模板 "${selectedTemplate.name}" 已删除`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板删除失败");
    }
  }

  // --------------------------------------------------------------
  // Create instance from template
  // --------------------------------------------------------------

  async function suggestTemplateStartCommand() {
    const nodeId = form.nodeId.trim();
    const workingDirectory = form.workingDirectory.trim();
    if (!nodeId || !workingDirectory) return;

    setSuggestingStartCommand(true);
    setError("");
    try {
      const suggestion = await api.suggestInstanceStartCommand(token, { nodeId, workingDirectory });
      if (!suggestion.startCommand) {
        setError(`AI 未能识别启动命令：${suggestion.reason}`);
        return;
      }
      setForm((current) => ({ ...current, startCommand: suggestion.startCommand }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 分析启动命令失败");
    } finally {
      setSuggestingStartCommand(false);
    }
  }

  async function createFromTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) return;
    setCreating(true);
    setError("");
    try {
      await api.createInstanceFromTemplate(token, selectedTemplate.id, {
        nodeId: form.nodeId,
        name: form.name,
        autoStart: form.autoStart,
        restartPolicy: form.restartPolicy,
        restartMaxRetries: form.restartMaxRetries,
        ...(form.workingDirectory ? { workingDirectory: form.workingDirectory } : {}),
        ...(form.startCommand ? { startCommand: form.startCommand } : {})
      });
      pushNotification("success", `实例 "${form.name}" 创建中`);
      setForm((current) => ({ ...current, name: "", workingDirectory: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板创建失败");
    } finally {
      setCreating(false);
    }
  }

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      <section className="template-layout">
        {/* ---------- LEFT: template list ---------- */}
        <div className="panel-block templates-panel">
          <div className="section-heading">
            <h2>实例模板</h2>
            <span>{templates.length} 个</span>
          </div>
          <div className="template-list">
            {/* "Save from instance" action card */}
            <button
              className="template-item template-item--create"
              type="button"
              onClick={() => void openSaveFromInstanceDialog()}
            >
              <div className="template-item-create-icon">
                <Upload size={18} />
              </div>
              <div className="template-item-create-text">
                <strong>从现有实例存为模板</strong>
                <span>把一个运行中的实例沉淀为可复用模板</span>
              </div>
            </button>

            {builtinTemplates.length > 0 ? (
              <div className="template-group-label">内置模板</div>
            ) : null}
            {builtinTemplates.map((template) => (
              <button
                className={`template-item ${selectedTemplateId === template.id ? "active" : ""}`}
                key={template.id}
                onClick={() => {
                  setSelectedTemplateId(template.id);
                }}
              >
                <div className="template-item-header">
                  <strong>{template.name}</strong>
                  <span className="template-badge template-badge--builtin">内置</span>
                </div>
                <span>{template.description}</span>
                <code>{template.defaultStartCommand || <em className="template-empty">未设命令</em>}</code>
              </button>
            ))}

            {userTemplates.length > 0 ? (
              <div className="template-group-label">我的模板</div>
            ) : null}
            {userTemplates.length === 0 && builtinTemplates.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 0", textAlign: "center" }}>
                <Info size={20} style={{ marginBottom: 8, opacity: 0.6 }} />
                <div>还没有模板，先从现有实例存一个吧</div>
              </div>
            ) : null}
            {userTemplates.map((template) => (
              <button
                className={`template-item ${selectedTemplateId === template.id ? "active" : ""}`}
                key={template.id}
                onClick={() => {
                  setSelectedTemplateId(template.id);
                }}
              >
                <div className="template-item-header">
                  <strong>{template.name}</strong>
                  {template.createdByUsername ? (
                    <span className="template-badge template-badge--user">@{template.createdByUsername}</span>
                  ) : null}
                </div>
                <span>{template.description || <em className="template-empty">无描述</em>}</span>
                <code>{template.defaultStartCommand || <em className="template-empty">未设命令</em>}</code>
              </button>
            ))}
          </div>
        </div>

        {/* ---------- RIGHT: detail + create ---------- */}
        <div className="panel-block template-create-panel">
          <div className="section-heading">
            <h2>
              {selectedTemplate
                ? editing
                  ? `编辑 ${selectedTemplate.name}`
                  : `用 ${selectedTemplate.name} 创建实例`
                : "创建实例"}
            </h2>
            {selectedTemplate && !selectedTemplate.isBuiltin ? (
              <div className="section-heading-actions">
                {editing ? (
                  <>
                    <button
                      className="icon-button"
                      type="button"
                      title="取消编辑"
                      disabled={savingEdit}
                      onClick={() => setEditing(false)}
                    >
                      <X size={15} />
                    </button>
                    <button
                      className="primary-button icon-only form-submit"
                      type="button"
                      title="保存修改"
                      disabled={savingEdit}
                      onClick={() => void saveEdit()}
                    >
                      {savingEdit ? <Loader2 size={14} className="status-spinner" /> : <Save size={15} />}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="icon-button"
                      type="button"
                      title="编辑模板"
                      onClick={() => startEditing()}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      title="删除模板"
                      onClick={() => void deleteTemplate()}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {/* Detail panel */}
          {selectedTemplate ? (
            <div className="template-detail">
              {selectedTemplate.fromInstanceId ? (
                <div className="template-detail-chip">
                  <Copy size={13} /> 来源于实例
                </div>
              ) : null}
              <div className="template-detail-grid">
                <div className="template-detail-row">
                  <span className="template-detail-label">类型</span>
                  <span>{instanceTypeLabel(selectedTemplate.type)}</span>
                </div>
                <div className="template-detail-row">
                  <span className="template-detail-label">工作目录前缀</span>
                  <code>{selectedTemplate.defaultWorkingDirectoryPrefix}</code>
                </div>
                <div className="template-detail-row">
                  <span className="template-detail-label">自启动</span>
                  <span>{selectedTemplate.autoStart ? "是" : "否"}</span>
                </div>
                <div className="template-detail-row">
                  <span className="template-detail-label">重启策略</span>
                  <span>{restartPolicyLabel(selectedTemplate.restartPolicy)}</span>
                </div>
                {selectedTemplate.ports.length > 0 ? (
                  <div className="template-detail-row template-detail-row--wide">
                    <span className="template-detail-label">端口</span>
                    <div className="template-port-list">
                      {selectedTemplate.ports.map((p, i) => (
                        <span key={i} className="template-port-chip">
                          {p.port}
                          {p.description ? ` · ${p.description}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selectedTemplate.envs.length > 0 ? (
                  <div className="template-detail-row template-detail-row--wide">
                    <span className="template-detail-label">环境变量</span>
                    <div className="template-env-list">
                      {selectedTemplate.envs.map((e, i) => (
                        <code key={i} className="template-env-chip">
                          {e.key}={e.value}
                        </code>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Edit form (inline) */}
          {editing && selectedTemplate ? (
            <form className="task-form template-edit-form" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
              <label>
                名称
                <input
                  value={editForm.name ?? ""}
                  onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))}
                  required
                />
              </label>
              <label className="wide-field">
                描述
                <input
                  value={editForm.description ?? ""}
                  onChange={(e) => setEditForm((c) => { const v = e.target.value.trim(); return { ...c, ...(v ? { description: v } : {}) }; })}
                />
              </label>
              <label className="wide-field">
                启动命令
                <input
                  value={editForm.defaultStartCommand ?? ""}
                  onChange={(e) => setEditForm((c) => ({ ...c, defaultStartCommand: e.target.value }))}
                />
              </label>
              <label>
                停止命令
                <input
                  value={editForm.defaultStopCommand ?? ""}
                  onChange={(e) => setEditForm((c) => ({ ...c, defaultStopCommand: e.target.value || null }))}
                />
              </label>
              <label>
                工作目录前缀
                <input
                  value={editForm.defaultWorkingDirectoryPrefix ?? ""}
                  onChange={(e) => setEditForm((c) => ({ ...c, defaultWorkingDirectoryPrefix: e.target.value }))}
                />
              </label>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10 }}>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={!!editForm.autoStart}
                    onChange={(e) => setEditForm((c) => ({ ...c, autoStart: e.target.checked }))}
                  />
                  <span>自启动</span>
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={!!editForm.runAsUser}
                    onChange={(e) => setEditForm((c) => ({ ...c, ...(e.target.checked ? { runAsUser: "root" } : {}) }))}
                  />
                  <span>指定运行用户</span>
                </label>
              </div>
              <button
                className="primary-button form-submit"
                type="submit"
                disabled={savingEdit}
              >
                {savingEdit ? <Loader2 size={16} className="status-spinner" /> : <Save size={16} />}
                保存修改
              </button>
            </form>
          ) : null}

          {/* Create-from-template form */}
          {selectedTemplate && !editing ? (
            <form className="task-form" onSubmit={createFromTemplate}>
              <label>
                节点
                <select value={form.nodeId} onChange={(e) => setForm((c) => ({ ...c, nodeId: e.target.value }))} required>
                  <option value="" disabled>
                    选择节点
                  </option>
                  {nodes.map((node) => (
                    <option value={node.id} key={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                名称
                <input
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  required
                />
              </label>
              <label className="wide-field">
                工作目录
                <input
                  value={form.workingDirectory}
                  onChange={(e) => setForm((c) => ({ ...c, workingDirectory: e.target.value }))}
                  placeholder="留空按模板生成"
                />
              </label>
              <label className="wide-field">
                启动命令
                <div className="start-command-control">
                  <input
                    value={form.startCommand}
                    onChange={(e) => setForm((c) => ({ ...c, startCommand: e.target.value }))}
                    placeholder="填写工作目录后可用 AI 分析"
                  />
                  <button
                    className="icon-button mini ai-suggest-button"
                    type="button"
                    title={form.workingDirectory.trim() ? "AI 分析并填写启动命令" : "请先填写工作目录"}
                    disabled={!form.workingDirectory.trim() || !form.nodeId || suggestingStartCommand}
                    onClick={() => void suggestTemplateStartCommand()}
                  >
                    {suggestingStartCommand ? <Loader2 size={14} className="status-spinner" /> : <Sparkles size={14} />}
                  </button>
                </div>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.autoStart}
                  onChange={(e) => setForm((c) => ({ ...c, autoStart: e.target.checked }))}
                />
                <span>自启动</span>
              </label>
              <label>
                重启策略
                <select
                  value={form.restartPolicy}
                  onChange={(e) => setForm((c) => ({ ...c, restartPolicy: e.target.value as RestartPolicy }))}
                >
                  <option value="never">不自动重启</option>
                  <option value="on_failure">异常退出重启</option>
                  <option value="always">总是重启</option>
                </select>
              </label>
              <label>
                最大重试
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={form.restartMaxRetries}
                  onChange={(e) => setForm((c) => ({ ...c, restartMaxRetries: Number(e.target.value) || 0 }))}
                />
              </label>
              <button
                className="primary-button form-submit"
                type="submit"
                disabled={creating || !selectedTemplate || nodes.length === 0 || !form.startCommand.trim()}
              >
                <LayoutTemplate size={18} />
                {creating ? "创建中" : "用模板创建"}
              </button>
            </form>
          ) : null}

          {!selectedTemplate ? (
            <div className="empty-state" style={{ padding: "40px 20px", textAlign: "center" }}>
              <LayoutTemplate size={32} style={{ marginBottom: 10, opacity: 0.5 }} />
              <div>选择左侧模板开始创建实例，或从现有实例存一个新模板</div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Save-from-instance dialog */}
      {showSaveFromInstance ? (
        <div className="modal-backdrop" onClick={() => setShowSaveFromInstance(false)} role="dialog" aria-modal="true">
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 480 }}
          >
            <div className="modal-header">
              <h3>从实例存为模板</h3>
              <button
                className="icon-button"
                type="button"
                title="关闭"
                onClick={() => setShowSaveFromInstance(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form
              className="task-form"
              onSubmit={(e) => { e.preventDefault(); void saveTemplateFromInstance(); }}
              style={{ padding: "16px 20px" }}
            >
              <label>
                选择实例
                <select
                  value={saveForm.instanceId}
                  onChange={(e) => setSaveForm((c) => ({ ...c, instanceId: e.target.value }))}
                  required
                >
                  <option value="" disabled>
                    选择一个实例
                  </option>
                  {instancesForSave.map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.name} — {i.status}（{i.nodeName}）
                    </option>
                  ))}
                </select>
              </label>
              <label>
                模板名称
                <input
                  value={saveForm.name}
                  onChange={(e) => setSaveForm((c) => ({ ...c, name: e.target.value }))}
                  required
                  placeholder="例如：我的 Node.js API"
                />
              </label>
              <label className="wide-field">
                描述（可选）
                <input
                  value={saveForm.description}
                  onChange={(e) => setSaveForm((c) => ({ ...c, description: e.target.value }))}
                  placeholder="简短说明模板用途"
                />
              </label>
              <label className="wide-field">
                启动命令（留空则沿用实例）
                <input
                  value={saveForm.startCommand}
                  onChange={(e) => setSaveForm((c) => ({ ...c, startCommand: e.target.value }))}
                />
              </label>
              <label>
                停止命令
                <input
                  value={saveForm.stopCommand}
                  onChange={(e) => setSaveForm((c) => ({ ...c, stopCommand: e.target.value }))}
                />
              </label>
              <label>
                工作目录前缀
                <input
                  value={saveForm.workingDirectoryPrefix}
                  onChange={(e) => setSaveForm((c) => ({ ...c, workingDirectoryPrefix: e.target.value }))}
                  placeholder="例如 nodejs / python / instances"
                />
              </label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowSaveFromInstance(false)}
                  disabled={savingTemplate}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={savingTemplate}
                >
                  {savingTemplate ? <Loader2 size={14} className="status-spinner" /> : <Save size={14} />}
                  保存模板
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
