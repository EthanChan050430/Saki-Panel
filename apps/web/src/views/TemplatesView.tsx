import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Check,
  ChevronLeft,
  Code2,
  Copy,
  Cpu,
  Edit3,
  FileJson,
  Info,
  Layers,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  User,
  X
} from "lucide-react";
import type { CreateCustomTemplateRequest, InstanceTemplate, InstanceType, ManagedInstance, ManagedNode, RestartPolicy, UpdateTemplateRequest } from "@webops/shared";
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

const INSTANCE_TYPES: Array<{ value: InstanceType; label: string }> = [
  { value: "generic_command", label: "通用命令" },
  { value: "nodejs", label: "Node.js" },
  { value: "python", label: "Python" },
  { value: "java_jar", label: "Java Jar" },
  { value: "shell_script", label: "Shell 脚本" },
  { value: "docker_container", label: "Docker" },
  { value: "docker_compose", label: "Docker Compose" },
  { value: "minecraft", label: "Minecraft" },
  { value: "steam_game_server", label: "Steam 游戏服务" }
];

function getInstanceTypeIcon(type: InstanceType) {
  switch (type) {
    case "nodejs":
    case "python":
    case "shell_script":
      return <Terminal size={15} />;
    case "docker_container":
    case "docker_compose":
      return <Box size={15} />;
    case "minecraft":
    case "steam_game_server":
    case "java_jar":
      return <Server size={15} />;
    default:
      return <Code2 size={15} />;
  }
}

export function TemplatesView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [suggestingStartCommand, setSuggestingStartCommand] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "builtin" | "user">("all");

  // Mobile navigation: "list" or "detail"
  const [mobileTab, setMobileTab] = useState<"list" | "detail">("list");

  // "Save from instance" dialog state
  const [showSaveFromInstance, setShowSaveFromInstance] = useState(false);
  const [instancesForSave, setInstancesForSave] = useState<ManagedInstance[]>([]);
  const [saveForm, setSaveForm] = useState({ instanceId: "", name: "", description: "", startCommand: "", stopCommand: "", workingDirectoryPrefix: "" });
  const [savingTemplate, setSavingTemplate] = useState(false);

  // "Create custom template" dialog state
  const [showCreateCustomTemplate, setShowCreateCustomTemplate] = useState(false);
  const [customForm, setCustomForm] = useState({
    name: "",
    type: "generic_command" as InstanceType,
    description: "",
    defaultStartCommand: "",
    defaultStopCommand: "",
    defaultWorkingDirectoryPrefix: "instances",
    autoStart: false,
    restartPolicy: "never" as RestartPolicy,
    restartMaxRetries: 3
  });
  const [savingCustomTemplate, setSavingCustomTemplate] = useState(false);
  const [saveModalFullscreen, setSaveModalFullscreen] = useState(false);
  const [customModalFullscreen, setCustomModalFullscreen] = useState(false);

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

  // Filtered templates based on category & search query
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (categoryFilter === "builtin" && !t.isBuiltin) return false;
      if (categoryFilter === "user" && t.isBuiltin) return false;
      if (!searchQuery.trim()) return true;
      const query = searchQuery.trim().toLowerCase();
      return (
        t.name.toLowerCase().includes(query) ||
        (t.description && t.description.toLowerCase().includes(query)) ||
        t.defaultStartCommand.toLowerCase().includes(query) ||
        t.type.toLowerCase().includes(query) ||
        (t.createdByUsername && t.createdByUsername.toLowerCase().includes(query))
      );
    });
  }, [templates, categoryFilter, searchQuery]);

  const filteredBuiltinTemplates = useMemo(() => filteredTemplates.filter((t) => t.isBuiltin), [filteredTemplates]);
  const filteredUserTemplates = useMemo(() => filteredTemplates.filter((t) => !t.isBuiltin), [filteredTemplates]);

  const refresh = useCallback(async () => {
    setError("");
    setRefreshing(true);
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
    } finally {
      setRefreshing(false);
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

  // Keyboard shortcut: Escape to close modal
  useEffect(() => {
    if (!showSaveFromInstance && !showCreateCustomTemplate) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSaveFromInstance(false);
        setShowCreateCustomTemplate(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSaveFromInstance, showCreateCustomTemplate]);

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
      setMobileTab("detail");
      await refresh();
      pushNotification("success", `模板 "${created.name}" 已保存`, { durationMs: 4000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板保存失败");
    } finally {
      setSavingTemplate(false);
    }
  }

  // --------------------------------------------------------------
  // Custom template creation
  // --------------------------------------------------------------

  function openCreateCustomTemplateModal() {
    setCustomForm({
      name: "",
      type: "generic_command",
      description: "",
      defaultStartCommand: "",
      defaultStopCommand: "",
      defaultWorkingDirectoryPrefix: "instances",
      autoStart: false,
      restartPolicy: "never",
      restartMaxRetries: 3
    });
    setShowCreateCustomTemplate(true);
  }

  async function saveCustomTemplate() {
    if (!customForm.name.trim() || !customForm.defaultStartCommand.trim()) return;
    setSavingCustomTemplate(true);
    setError("");
    try {
      const created = await api.createCustomTemplate(token, {
        name: customForm.name.trim(),
        type: customForm.type,
        ...(customForm.description.trim() ? { description: customForm.description.trim() } : {}),
        ...(customForm.defaultStartCommand.trim() ? { defaultStartCommand: customForm.defaultStartCommand.trim() } : {}),
        ...(customForm.defaultStopCommand.trim() ? { defaultStopCommand: customForm.defaultStopCommand.trim() } : {}),
        ...(customForm.defaultWorkingDirectoryPrefix.trim() ? { defaultWorkingDirectoryPrefix: customForm.defaultWorkingDirectoryPrefix.trim() } : {}),
        autoStart: customForm.autoStart,
        restartPolicy: customForm.restartPolicy,
        restartMaxRetries: customForm.restartMaxRetries
      });
      setShowCreateCustomTemplate(false);
      setSelectedTemplateId(created.id);
      setMobileTab("detail");
      await refresh();
      pushNotification("success", `自定义模板 "${created.name}" 已创建`, { durationMs: 4000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "自定义模板创建失败");
    } finally {
      setSavingCustomTemplate(false);
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
      setMobileTab("list");
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

      {/* Mobile Tab Switcher */}
      <div className="template-mobile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === "list"}
          className={`template-mobile-tab-btn ${mobileTab === "list" ? "active" : ""}`}
          onClick={() => setMobileTab("list")}
        >
          <LayoutTemplate size={16} />
          <span>模板库 ({filteredTemplates.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === "detail"}
          className={`template-mobile-tab-btn ${mobileTab === "detail" ? "active" : ""}`}
          onClick={() => setMobileTab("detail")}
        >
          <Plus size={16} />
          <span>{selectedTemplate ? selectedTemplate.name : "创建实例"}</span>
        </button>
      </div>

      <section className="template-layout">
        {/* ---------- LEFT: template list ---------- */}
        <div className={`panel-block templates-panel ${mobileTab === "detail" ? "mobile-hidden" : ""}`}>
          <div className="section-heading templates-panel-heading">
            <div className="templates-heading-left">
              <div className="templates-heading-icon">
                <LayoutTemplate size={20} />
              </div>
              <div className="templates-heading-text">
                <h2>实例模板</h2>
                <span className="templates-count-badge">{templates.length} 个模板</span>
              </div>
            </div>
            <div className="templates-heading-actions">
              <button
                className="icon-button mini"
                type="button"
                title="刷新模板列表"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              </button>
            </div>
          </div>

          {/* Search and Category Filter Bar */}
          <div className="template-filter-bar">
            <div className="template-search-input-wrap">
              <Search size={14} className="template-search-icon" />
              <input
                type="text"
                className="template-search-input"
                placeholder="搜索模板名称、命令或描述..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="template-search-clear"
                  onClick={() => setSearchQuery("")}
                  title="清除搜索"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
            <div className="template-category-pills">
              <button
                type="button"
                className={`template-category-pill ${categoryFilter === "all" ? "active" : ""}`}
                onClick={() => setCategoryFilter("all")}
              >
                全部 <span>{templates.length}</span>
              </button>
              <button
                type="button"
                className={`template-category-pill ${categoryFilter === "builtin" ? "active" : ""}`}
                onClick={() => setCategoryFilter("builtin")}
              >
                内置 <span>{builtinTemplates.length}</span>
              </button>
              <button
                type="button"
                className={`template-category-pill ${categoryFilter === "user" ? "active" : ""}`}
                onClick={() => setCategoryFilter("user")}
              >
                我的 <span>{userTemplates.length}</span>
              </button>
            </div>
          </div>

          <div className="template-list">
            {/* Actions row: Save from instance & Custom template */}
            <div className="template-actions-row">
              <button
                className="template-action-btn"
                type="button"
                onClick={() => void openSaveFromInstanceDialog()}
                title="从运行中的实例配置一键存为模板"
              >
                <div className="template-action-btn-icon">
                  <Upload size={14} />
                </div>
                <span className="template-action-btn-text">从实例存为模板</span>
              </button>
              <button
                className="template-action-btn template-action-btn--create"
                type="button"
                onClick={() => openCreateCustomTemplateModal()}
                title="自行输入配置创建新模板"
              >
                <div className="template-action-btn-icon">
                  <Plus size={14} />
                </div>
                <span className="template-action-btn-text">自定义模板</span>
              </button>
            </div>

            {/* Built-in templates group */}
            {filteredBuiltinTemplates.length > 0 ? (
              <div className="template-group-label">
                <div className="template-group-label-left">
                  <Sparkles size={13} />
                  <span>内置系统模板</span>
                </div>
                <span className="template-group-count">{filteredBuiltinTemplates.length}</span>
              </div>
            ) : null}
            {filteredBuiltinTemplates.map((template) => {
              const isSelected = selectedTemplateId === template.id;
              return (
                <button
                  className={`template-item ${isSelected ? "active" : ""}`}
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    setMobileTab("detail");
                  }}
                >
                  <div className="template-item-header">
                    <div className="template-item-title-wrap">
                      <span className="template-item-type-icon">{getInstanceTypeIcon(template.type)}</span>
                      <strong className="template-item-name">{template.name}</strong>
                    </div>
                    <span className="template-badge template-badge--builtin">内置</span>
                  </div>
                  <span className="template-item-desc">
                    {template.description || <em className="template-empty">无描述信息</em>}
                  </span>
                  <div className="template-item-cmd">
                    <Terminal size={12} className="template-item-cmd-icon" />
                    <code>{template.defaultStartCommand || <em className="template-empty">未设命令</em>}</code>
                  </div>
                </button>
              );
            })}

            {/* Custom user templates group */}
            {filteredUserTemplates.length > 0 ? (
              <div className="template-group-label">
                <div className="template-group-label-left">
                  <User size={13} />
                  <span>我的自定义模板</span>
                </div>
                <span className="template-group-count">{filteredUserTemplates.length}</span>
              </div>
            ) : null}
            {filteredUserTemplates.map((template) => {
              const isSelected = selectedTemplateId === template.id;
              return (
                <button
                  className={`template-item ${isSelected ? "active" : ""}`}
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    setMobileTab("detail");
                  }}
                >
                  <div className="template-item-header">
                    <div className="template-item-title-wrap">
                      <span className="template-item-type-icon">{getInstanceTypeIcon(template.type)}</span>
                      <strong className="template-item-name">{template.name}</strong>
                    </div>
                    {template.createdByUsername ? (
                      <span className="template-badge template-badge--user">@{template.createdByUsername}</span>
                    ) : (
                      <span className="template-badge template-badge--user">自定义</span>
                    )}
                  </div>
                  <span className="template-item-desc">
                    {template.description || <em className="template-empty">无描述信息</em>}
                  </span>
                  <div className="template-item-cmd">
                    <Terminal size={12} className="template-item-cmd-icon" />
                    <code>{template.defaultStartCommand || <em className="template-empty">未设命令</em>}</code>
                  </div>
                </button>
              );
            })}

            {filteredTemplates.length === 0 ? (
              <div className="empty-state template-empty-state">
                <Info size={24} className="template-empty-icon" />
                <div className="template-empty-title">未找到匹配的模板</div>
                <p className="template-empty-sub">可以尝试调整搜索关键字，或者从现有运行实例存一个新模板</p>
                {searchQuery ? (
                  <button
                    type="button"
                    className="secondary-button mini"
                    style={{ marginTop: 8 }}
                    onClick={() => { setSearchQuery(""); setCategoryFilter("all"); }}
                  >
                    重置筛选条件
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* ---------- RIGHT: detail + create ---------- */}
        <div className={`panel-block template-create-panel ${mobileTab === "list" ? "mobile-hidden" : ""}`}>
          <div className="section-heading template-detail-heading">
            <div className="template-heading-main">
              <button
                type="button"
                className="template-mobile-back-btn"
                onClick={() => setMobileTab("list")}
                title="返回模板列表"
              >
                <ChevronLeft size={16} />
                <span>返回列表</span>
              </button>
              <h2>
                {selectedTemplate
                  ? editing
                    ? `编辑 ${selectedTemplate.name}`
                    : `用 ${selectedTemplate.name} 创建实例`
                  : "创建实例"}
              </h2>
            </div>
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
              {/* Header Hero Banner */}
              <div className="template-hero-card">
                <div className="template-hero-icon-box">
                  {getInstanceTypeIcon(selectedTemplate.type)}
                </div>
                <div className="template-hero-info">
                  <div className="template-hero-title-row">
                    <h3 className="template-hero-title">{selectedTemplate.name}</h3>
                    <div className="template-hero-tags">
                      <span className="template-pill-tag">
                        {instanceTypeLabel(selectedTemplate.type)}
                      </span>
                      {selectedTemplate.isBuiltin ? (
                        <span className="template-badge template-badge--builtin">系统内置</span>
                      ) : selectedTemplate.createdByUsername ? (
                        <span className="template-badge template-badge--user">@{selectedTemplate.createdByUsername}</span>
                      ) : null}
                      {selectedTemplate.fromInstanceId ? (
                        <span className="template-detail-chip">
                          <Copy size={11} /> 来源于实例
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {selectedTemplate.description ? (
                    <p className="template-hero-desc">{selectedTemplate.description}</p>
                  ) : null}
                </div>
              </div>

              {/* Detail Specifications Grid */}
              <div className="template-detail-grid">
                <div className="template-detail-row">
                  <span className="template-detail-label">实例类型</span>
                  <span className="template-detail-value">{instanceTypeLabel(selectedTemplate.type)}</span>
                </div>
                <div className="template-detail-row">
                  <span className="template-detail-label">工作目录前缀</span>
                  <code className="template-detail-code">{selectedTemplate.defaultWorkingDirectoryPrefix || "未指定"}</code>
                </div>
                <div className="template-detail-row">
                  <span className="template-detail-label">自启动</span>
                  <span className="template-detail-value">{selectedTemplate.autoStart ? "是" : "否"}</span>
                </div>
                <div className="template-detail-row">
                  <span className="template-detail-label">重启策略</span>
                  <span className="template-detail-value">{restartPolicyLabel(selectedTemplate.restartPolicy)}</span>
                </div>

                {selectedTemplate.ports.length > 0 ? (
                  <div className="template-detail-row template-detail-row--wide">
                    <span className="template-detail-label">预置网络端口</span>
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
                    <span className="template-detail-label">预置环境变量</span>
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
              <div className="template-form-section-title">编辑模板配置</div>
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
                  className="font-mono"
                  value={editForm.defaultStartCommand ?? ""}
                  onChange={(e) => setEditForm((c) => ({ ...c, defaultStartCommand: e.target.value }))}
                />
              </label>
              <label>
                停止命令
                <input
                  className="font-mono"
                  value={editForm.defaultStopCommand ?? ""}
                  onChange={(e) => setEditForm((c) => ({ ...c, defaultStopCommand: e.target.value || null }))}
                />
              </label>
              <label>
                工作目录前缀
                <input
                  className="font-mono"
                  value={editForm.defaultWorkingDirectoryPrefix ?? ""}
                  onChange={(e) => setEditForm((c) => ({ ...c, defaultWorkingDirectoryPrefix: e.target.value }))}
                />
              </label>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 16, flexWrap: "wrap", padding: "4px 0" }}>
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
            <form className="task-form template-creation-form" onSubmit={createFromTemplate}>
              <div className="template-form-section-title">
                <Layers size={14} />
                <span>基于此模板创建新实例</span>
              </div>
              <label>
                目标节点 <span className="required-star">*</span>
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
                实例名称 <span className="required-star">*</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  required
                  placeholder="例如：my-app-01"
                />
              </label>
              <label className="wide-field">
                工作目录
                <input
                  className="font-mono"
                  value={form.workingDirectory}
                  onChange={(e) => setForm((c) => ({ ...c, workingDirectory: e.target.value }))}
                  placeholder={`留空按模板规则生成（前缀: ${selectedTemplate.defaultWorkingDirectoryPrefix || "默认"}）`}
                />
              </label>
              <label className="wide-field">
                启动命令 <span className="required-star">*</span>
                <div className="start-command-control">
                  <input
                    className="font-mono"
                    value={form.startCommand}
                    onChange={(e) => setForm((c) => ({ ...c, startCommand: e.target.value }))}
                    placeholder="填写工作目录后可用 AI 分析"
                    required
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
              <div className="template-form-runtime-options">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={form.autoStart}
                    onChange={(e) => setForm((c) => ({ ...c, autoStart: e.target.checked }))}
                  />
                  <span>自启动</span>
                </label>
              </div>
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
                最大重试次数
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={form.restartMaxRetries}
                  onChange={(e) => setForm((c) => ({ ...c, restartMaxRetries: Number(e.target.value) || 0 }))}
                />
              </label>
              <button
                className="primary-button form-submit template-create-submit-btn"
                type="submit"
                disabled={creating || !selectedTemplate || nodes.length === 0 || !form.startCommand.trim()}
              >
                <LayoutTemplate size={17} />
                <span>{creating ? "正在创建实例..." : "立即用模板创建实例"}</span>
              </button>
            </form>
          ) : null}

          {!selectedTemplate ? (
            <div className="empty-state template-detail-empty">
              <div className="template-empty-hero-icon">
                <LayoutTemplate size={36} />
              </div>
              <h3>选择左侧模板开始创建</h3>
              <p>从左侧模板库中挑选一个心仪的模板开始配置，或者点击“从现有实例存为模板”沉淀新规范</p>
              {mobileTab === "detail" ? (
                <button
                  type="button"
                  className="primary-button mini"
                  style={{ marginTop: 12 }}
                  onClick={() => setMobileTab("list")}
                >
                  <ChevronLeft size={14} /> 前往模板库
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Save-from-instance dialog */}
      {typeof document !== "undefined" && showSaveFromInstance
        ? createPortal(
            <div
              className="modal-backdrop template-modal-backdrop"
              onClick={() => setShowSaveFromInstance(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className={`modal-panel template-modal-panel ${saveModalFullscreen ? "template-modal-panel--fullscreen" : ""}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header template-modal-header">
                  <div className="template-modal-title-wrap">
                    <div className="template-modal-title-icon">
                      <Upload size={18} />
                    </div>
                    <div>
                      <h3 className="template-modal-title">从实例存为模板</h3>
                      <p className="template-modal-subtitle">选择已配置运行中的实例，一键沉淀为可复用的标准模板</p>
                    </div>
                  </div>
                  <div className="template-modal-header-actions">
                    <button
                      className="icon-button modal-fullscreen-btn"
                      type="button"
                      title={saveModalFullscreen ? "还原窗口" : "最大化 / 全屏"}
                      onClick={() => setSaveModalFullscreen((v) => !v)}
                    >
                      {saveModalFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>
                    <button
                      className="icon-button modal-close-btn"
                      type="button"
                      title="关闭"
                      onClick={() => setShowSaveFromInstance(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
            <form
              className="modal-form template-save-form"
              onSubmit={(e) => { e.preventDefault(); void saveTemplateFromInstance(); }}
            >
              <div className="template-save-form-fields">
                <label className="template-field-label">
                  <span className="template-field-name">
                    选择实例原型 <span className="required-star">*</span>
                  </span>
                  <select
                    className="template-field-control"
                    value={saveForm.instanceId}
                    onChange={(e) => setSaveForm((c) => ({ ...c, instanceId: e.target.value }))}
                    required
                  >
                    <option value="" disabled>
                      选择一个实例作为模板原型
                    </option>
                    {instancesForSave.map((i) => (
                      <option value={i.id} key={i.id}>
                        {i.name} — {i.status}（{i.nodeName}）
                      </option>
                    ))}
                  </select>
                </label>

                <label className="template-field-label">
                  <span className="template-field-name">
                    模板名称 <span className="required-star">*</span>
                  </span>
                  <input
                    className="template-field-control"
                    value={saveForm.name}
                    onChange={(e) => setSaveForm((c) => ({ ...c, name: e.target.value }))}
                    required
                    placeholder="例如：生产环境 Node.js API"
                  />
                </label>

                <label className="template-field-label template-field-wide">
                  <span className="template-field-name">模板描述（可选）</span>
                  <input
                    className="template-field-control"
                    value={saveForm.description}
                    onChange={(e) => setSaveForm((c) => ({ ...c, description: e.target.value }))}
                    placeholder="简短说明模板的适用业务场景或运行环境"
                  />
                </label>

                <label className="template-field-label template-field-wide">
                  <span className="template-field-name">启动命令（留空则继承实例）</span>
                  <input
                    className="template-field-control font-mono"
                    value={saveForm.startCommand}
                    onChange={(e) => setSaveForm((c) => ({ ...c, startCommand: e.target.value }))}
                    placeholder="例如：node index.js"
                  />
                </label>

                <div className="template-field-row">
                  <label className="template-field-label">
                    <span className="template-field-name">停止命令（可选）</span>
                    <input
                      className="template-field-control font-mono"
                      value={saveForm.stopCommand}
                      onChange={(e) => setSaveForm((c) => ({ ...c, stopCommand: e.target.value }))}
                      placeholder="留空沿用实例"
                    />
                  </label>

                  <label className="template-field-label">
                    <span className="template-field-name">工作目录前缀（可选）</span>
                    <input
                      className="template-field-control font-mono"
                      value={saveForm.workingDirectoryPrefix}
                      onChange={(e) => setSaveForm((c) => ({ ...c, workingDirectoryPrefix: e.target.value }))}
                      placeholder="例如 nodejs / python / instances"
                    />
                  </label>
                </div>
              </div>

              <div className="template-modal-actions">
                <button
                  className="secondary-button template-modal-cancel-btn"
                  type="button"
                  onClick={() => setShowSaveFromInstance(false)}
                  disabled={savingTemplate}
                >
                  取消
                </button>
                <button
                  className="primary-button template-modal-save-btn"
                  type="submit"
                  disabled={savingTemplate || !saveForm.instanceId || !saveForm.name.trim()}
                >
                  {savingTemplate ? <Loader2 size={15} className="status-spinner" /> : <Save size={15} />}
                  <span>保存模板</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      ) : null}

      {/* Create Custom Template Modal */}
      {typeof document !== "undefined" && showCreateCustomTemplate
        ? createPortal(
            <div
              className="modal-backdrop template-modal-backdrop"
              onClick={() => setShowCreateCustomTemplate(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className={`modal-panel template-modal-panel ${customModalFullscreen ? "template-modal-panel--fullscreen" : ""}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header template-modal-header">
                  <div className="template-modal-title-wrap">
                    <div className="template-modal-title-icon">
                      <Plus size={18} />
                    </div>
                    <div>
                      <h3 className="template-modal-title">新建自定义模板</h3>
                      <p className="template-modal-subtitle">自定义运行配置，保存后可随时快速部署实例</p>
                    </div>
                  </div>
                  <div className="template-modal-header-actions">
                    <button
                      className="icon-button modal-fullscreen-btn"
                      type="button"
                      title={customModalFullscreen ? "还原窗口" : "最大化 / 全屏"}
                      onClick={() => setCustomModalFullscreen((v) => !v)}
                    >
                      {customModalFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>
                    <button
                      className="icon-button modal-close-btn"
                      type="button"
                      title="关闭"
                      onClick={() => setShowCreateCustomTemplate(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
            <form
              className="modal-form template-save-form"
              onSubmit={(e) => { e.preventDefault(); void saveCustomTemplate(); }}
            >
              <div className="template-save-form-fields">
                <div className="template-field-row">
                  <label className="template-field-label">
                    <span className="template-field-name">
                      模板名称 <span className="required-star">*</span>
                    </span>
                    <input
                      className="template-field-control"
                      value={customForm.name}
                      onChange={(e) => setCustomForm((c) => ({ ...c, name: e.target.value }))}
                      required
                      placeholder="例如：生产环境 Node.js API"
                    />
                  </label>

                  <label className="template-field-label">
                    <span className="template-field-name">实例类型</span>
                    <select
                      className="template-field-control"
                      value={customForm.type}
                      onChange={(e) => setCustomForm((c) => ({ ...c, type: e.target.value as InstanceType }))}
                    >
                      {INSTANCE_TYPES.map((t) => (
                        <option value={t.value} key={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="template-field-label template-field-wide">
                  <span className="template-field-name">
                    默认启动命令 <span className="required-star">*</span>
                  </span>
                  <input
                    className="template-field-control font-mono"
                    value={customForm.defaultStartCommand}
                    onChange={(e) => setCustomForm((c) => ({ ...c, defaultStartCommand: e.target.value }))}
                    placeholder="例如：node index.js 或 python app.py"
                    required
                  />
                </label>

                <div className="template-field-row">
                  <label className="template-field-label">
                    <span className="template-field-name">默认停止命令（可选）</span>
                    <input
                      className="template-field-control font-mono"
                      value={customForm.defaultStopCommand}
                      onChange={(e) => setCustomForm((c) => ({ ...c, defaultStopCommand: e.target.value }))}
                      placeholder="例如：npm stop 或 docker stop"
                    />
                  </label>

                  <label className="template-field-label">
                    <span className="template-field-name">默认工作目录前缀</span>
                    <input
                      className="template-field-control font-mono"
                      value={customForm.defaultWorkingDirectoryPrefix}
                      onChange={(e) => setCustomForm((c) => ({ ...c, defaultWorkingDirectoryPrefix: e.target.value }))}
                      placeholder="例如：instances 或 nodejs"
                    />
                  </label>
                </div>

                <label className="template-field-label template-field-wide">
                  <span className="template-field-name">模板描述（可选）</span>
                  <input
                    className="template-field-control"
                    value={customForm.description}
                    onChange={(e) => setCustomForm((c) => ({ ...c, description: e.target.value }))}
                    placeholder="简短说明模板的适用场景或运行环境"
                  />
                </label>

                <div className="template-field-row">
                  <label className="template-field-label">
                    <span className="template-field-name">重启策略</span>
                    <select
                      className="template-field-control"
                      value={customForm.restartPolicy}
                      onChange={(e) => setCustomForm((c) => ({ ...c, restartPolicy: e.target.value as RestartPolicy }))}
                    >
                      <option value="never">不自动重启</option>
                      <option value="on_failure">异常退出重启</option>
                      <option value="always">总是重启</option>
                    </select>
                  </label>

                  <label className="template-field-label">
                    <span className="template-field-name">最大重试次数</span>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      className="template-field-control"
                      value={customForm.restartMaxRetries}
                      onChange={(e) => setCustomForm((c) => ({ ...c, restartMaxRetries: Number(e.target.value) || 0 }))}
                    />
                  </label>
                </div>

                <div className="template-form-runtime-options">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={customForm.autoStart}
                      onChange={(e) => setCustomForm((c) => ({ ...c, autoStart: e.target.checked }))}
                    />
                    <span>默认开机自启动</span>
                  </label>
                </div>
              </div>

              <div className="template-modal-actions">
                <button
                  className="secondary-button template-modal-cancel-btn"
                  type="button"
                  onClick={() => setShowCreateCustomTemplate(false)}
                  disabled={savingCustomTemplate}
                >
                  取消
                </button>
                <button
                  className="primary-button template-modal-save-btn"
                  type="submit"
                  disabled={savingCustomTemplate || !customForm.name.trim() || !customForm.defaultStartCommand.trim()}
                >
                  {savingCustomTemplate ? <Loader2 size={15} className="status-spinner" /> : <Save size={15} />}
                  <span>保存自定义模板</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
