import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Edit3,
  ExternalLink,
  FileCode2,
  FileJson,
  Gamepad2,
  Info,
  Layers,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Minimize2,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  User,
  Workflow,
  X
} from "lucide-react";
import type {
  CreateCustomTemplateRequest,
  InstanceTemplate,
  InstanceType,
  ManagedInstance,
  ManagedNode,
  RestartPolicy,
  UpdateTemplateRequest
} from "@webops/shared";
import { api, ApiError } from "../api.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { OperationPacksPanel } from "../components/operations-packs/OperationPacksPanel.js";
import { useNotificationCenter } from "../NotificationCenter.js";

function restartPolicyLabel(policy: RestartPolicy): string {
  const labels: Record<RestartPolicy, string> = {
    never: "不自动重启",
    on_failure: "异常退出重启",
    always: "总是重启",
    fixed_interval: "固定间隔重启"
  };
  return labels[policy] ?? policy;
}

function instanceTypeLabel(type: InstanceType): string {
  const labels: Record<InstanceType, string> = {
    generic_command: "通用命令",
    nodejs: "Node.js",
    python: "Python",
    java_jar: "Java Jar",
    shell_script: "Shell 脚本",
    docker_container: "Docker 容器",
    docker_compose: "Docker Compose",
    minecraft: "Minecraft",
    steam_game_server: "Steam 游戏服"
  };
  return labels[type] ?? type;
}

const INSTANCE_TYPES: Array<{ value: InstanceType; label: string }> = [
  { value: "generic_command", label: "通用命令" },
  { value: "nodejs", label: "Node.js" },
  { value: "python", label: "Python" },
  { value: "java_jar", label: "Java Jar" },
  { value: "shell_script", label: "Shell 脚本" },
  { value: "docker_container", label: "Docker 容器" },
  { value: "docker_compose", label: "Docker Compose" },
  { value: "minecraft", label: "Minecraft" },
  { value: "steam_game_server", label: "Steam 游戏服" }
];

function getInstanceTypeBadgeMeta(type: InstanceType): { icon: React.ReactNode; className: string } {
  switch (type) {
    case "nodejs":
      return { icon: <Terminal size={14} aria-hidden="true" />, className: "is-type-nodejs" };
    case "python":
      return { icon: <FileCode2 size={14} aria-hidden="true" />, className: "is-type-python" };
    case "docker_container":
    case "docker_compose":
      return { icon: <Box size={14} aria-hidden="true" />, className: "is-type-docker" };
    case "minecraft":
    case "steam_game_server":
      return { icon: <Gamepad2 size={14} aria-hidden="true" />, className: "is-type-game" };
    case "java_jar":
      return { icon: <Server size={14} aria-hidden="true" />, className: "is-type-java" };
    case "shell_script":
      return { icon: <Terminal size={14} aria-hidden="true" />, className: "is-type-shell" };
    default:
      return { icon: <Code2 size={14} aria-hidden="true" />, className: "is-type-generic" };
  }
}

export function TemplatesView({
  token,
  onLogout,
  refreshTick
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
}) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [suggestingStartCommand, setSuggestingStartCommand] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  // Top Section Switcher: "templates" (default) or "packs" (Operation Packs marketplace)
  const [activeViewSection, setActiveViewSection] = useState<"templates" | "packs">("templates");

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "builtin" | "user">("all");
  const [runtimeFilter, setRuntimeFilter] = useState<string>("all");

  // Mobile navigation: "list" or "detail"
  const [mobileTab, setMobileTab] = useState<"list" | "detail">("list");

  // "Save from instance" dialog state
  const [showSaveFromInstance, setShowSaveFromInstance] = useState(false);
  const [instancesForSave, setInstancesForSave] = useState<ManagedInstance[]>([]);
  const [saveForm, setSaveForm] = useState({
    instanceId: "",
    name: "",
    description: "",
    startCommand: "",
    stopCommand: "",
    workingDirectoryPrefix: ""
  });
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

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) ?? null;
  }, [templates, selectedTemplateId]);

  const builtinTemplates = useMemo(() => templates.filter((t) => t.isBuiltin), [templates]);
  const userTemplates = useMemo(() => templates.filter((t) => !t.isBuiltin), [templates]);

  // Distinct runtime types present in the loaded templates
  const availableRuntimeTypes = useMemo(() => {
    const set = new Set<InstanceType>();
    for (const t of templates) {
      if (t.type) set.add(t.type);
    }
    return Array.from(set);
  }, [templates]);

  // Filtered templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (categoryFilter === "builtin" && !t.isBuiltin) return false;
      if (categoryFilter === "user" && t.isBuiltin) return false;
      if (runtimeFilter !== "all" && t.type !== runtimeFilter) return false;
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
  }, [templates, categoryFilter, runtimeFilter, searchQuery]);

  const filteredBuiltinTemplates = useMemo(() => filteredTemplates.filter((t) => t.isBuiltin), [filteredTemplates]);
  const filteredUserTemplates = useMemo(() => filteredTemplates.filter((t) => !t.isBuiltin), [filteredTemplates]);

  const refresh = useCallback(async () => {
    setError("");
    setRefreshing(true);
    try {
      const [nextNodes, nextTemplates] = await Promise.all([api.nodes(token), api.templates(token)]);
      setNodes(nextNodes);
      setTemplates(nextTemplates);
      setSelectedTemplateId((current) => {
        if (current && nextTemplates.some((t) => t.id === current)) return current;
        return nextTemplates[0]?.id || "";
      });
      setForm((current) => ({
        ...current,
        nodeId: current.nodeId || nextNodes[0]?.id || ""
      }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "模板数据读取失败");
    } finally {
      setRefreshing(false);
    }
  }, [onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  // Sync form when template selection changes
  useEffect(() => {
    if (!selectedTemplate) return;
    setForm((current) => ({
      ...current,
      name: current.name || selectedTemplate.name,
      startCommand: selectedTemplate.defaultStartCommand,
      autoStart: selectedTemplate.autoStart ?? false,
      restartPolicy: selectedTemplate.restartPolicy ?? "never",
      restartMaxRetries: selectedTemplate.restartMaxRetries ?? 3
    }));
    setEditing(false);
    setEditForm({});
  }, [selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close modals
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
  // Save from instance
  // --------------------------------------------------------------
  async function openSaveFromInstanceDialog() {
    try {
      const instances = await api.instances(token);
      setInstancesForSave(instances);
      setSaveForm({
        instanceId: instances[0]?.id || "",
        name: "",
        description: "",
        startCommand: "",
        stopCommand: "",
        workingDirectoryPrefix: ""
      });
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
      setActiveViewSection("templates");
      setMobileTab("detail");
      await refresh();
      pushNotification("success", `模板「${created.name}」已成功保存`, { durationMs: 4000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板保存失败");
    } finally {
      setSavingTemplate(false);
    }
  }

  // --------------------------------------------------------------
  // Create / Duplicate custom template
  // --------------------------------------------------------------
  function openCreateCustomTemplateModal(sourceTemplate?: InstanceTemplate | null) {
    if (sourceTemplate) {
      setCustomForm({
        name: `${sourceTemplate.name} (副本)`,
        type: sourceTemplate.type,
        description: sourceTemplate.description || "",
        defaultStartCommand: sourceTemplate.defaultStartCommand || "",
        defaultStopCommand: sourceTemplate.defaultStopCommand || "",
        defaultWorkingDirectoryPrefix: sourceTemplate.defaultWorkingDirectoryPrefix || "instances",
        autoStart: sourceTemplate.autoStart ?? false,
        restartPolicy: sourceTemplate.restartPolicy ?? "never",
        restartMaxRetries: sourceTemplate.restartMaxRetries ?? 3
      });
    } else {
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
    }
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
        ...(customForm.defaultWorkingDirectoryPrefix.trim()
          ? { defaultWorkingDirectoryPrefix: customForm.defaultWorkingDirectoryPrefix.trim() }
          : {}),
        autoStart: customForm.autoStart,
        restartPolicy: customForm.restartPolicy,
        restartMaxRetries: customForm.restartMaxRetries
      });
      setShowCreateCustomTemplate(false);
      setSelectedTemplateId(created.id);
      setActiveViewSection("templates");
      setMobileTab("detail");
      await refresh();
      pushNotification("success", `自定义模板「${created.name}」已创建`, { durationMs: 4000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "自定义模板创建失败");
    } finally {
      setSavingCustomTemplate(false);
    }
  }

  // --------------------------------------------------------------
  // Edit / Delete user template
  // --------------------------------------------------------------
  function startEditing() {
    if (!selectedTemplate || selectedTemplate.isBuiltin) return;
    const formState: UpdateTemplateRequest = {
      name: selectedTemplate.name,
      defaultStartCommand: selectedTemplate.defaultStartCommand,
      defaultWorkingDirectoryPrefix: selectedTemplate.defaultWorkingDirectoryPrefix,
      autoStart: selectedTemplate.autoStart,
      restartPolicy: selectedTemplate.restartPolicy,
      restartMaxRetries: selectedTemplate.restartMaxRetries
    };
    if (selectedTemplate.description !== null) formState.description = selectedTemplate.description;
    if (selectedTemplate.defaultStopCommand !== null) formState.defaultStopCommand = selectedTemplate.defaultStopCommand;
    if (selectedTemplate.runAsUser !== null) formState.runAsUser = selectedTemplate.runAsUser;
    if (selectedTemplate.memoryLimit !== null) formState.memoryLimit = selectedTemplate.memoryLimit;
    if (selectedTemplate.cpuLimit !== null) formState.cpuLimit = selectedTemplate.cpuLimit;
    setEditForm(formState);
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
      pushNotification("success", `模板「${updated.name}」已更新`, { durationMs: 3000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板更新失败");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteTemplate() {
    if (!selectedTemplate || selectedTemplate.isBuiltin) return;
    if (!confirm(`确定删除自定义模板「${selectedTemplate.name}」？此操作不可恢复。`)) return;
    setError("");
    try {
      await api.deleteTemplate(token, selectedTemplate.id);
      setTemplates((prev) => prev.filter((t) => t.id !== selectedTemplate.id));
      setSelectedTemplateId("");
      setMobileTab("list");
      pushNotification("info", `模板「${selectedTemplate.name}」已删除`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板删除失败");
    }
  }

  // --------------------------------------------------------------
  // Copy Command Helper
  // --------------------------------------------------------------
  function copyStartCommand() {
    if (!selectedTemplate?.defaultStartCommand) return;
    navigator.clipboard.writeText(selectedTemplate.defaultStartCommand).then(() => {
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    }).catch(() => undefined);
  }

  function resetFormToDefaults() {
    if (!selectedTemplate) return;
    setForm((c) => ({
      ...c,
      name: selectedTemplate.name,
      startCommand: selectedTemplate.defaultStartCommand,
      workingDirectory: "",
      autoStart: selectedTemplate.autoStart ?? false,
      restartPolicy: selectedTemplate.restartPolicy ?? "never",
      restartMaxRetries: selectedTemplate.restartMaxRetries ?? 3
    }));
    pushNotification("info", "已重置为模板预设参数", { durationMs: 2000 });
  }

  // --------------------------------------------------------------
  // Deploy instance from template
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
      pushNotification("success", "已根据目录特征自动推断启动命令", { durationMs: 3000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动命令分析失败");
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
        name: form.name.trim(),
        autoStart: form.autoStart,
        restartPolicy: form.restartPolicy,
        restartMaxRetries: form.restartMaxRetries,
        ...(form.workingDirectory.trim() ? { workingDirectory: form.workingDirectory.trim() } : {}),
        ...(form.startCommand.trim() ? { startCommand: form.startCommand.trim() } : {})
      });
      pushNotification("success", `实例「${form.name}」已提交创建并准备就绪`);
      setForm((current) => ({ ...current, name: "", workingDirectory: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "实例创建失败");
    } finally {
      setCreating(false);
    }
  }

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  return (
    <div className="tpl-studio">
      <PageErrorToast error={error} onDismiss={() => setError("")} />

      {/* Top Studio Command Bar */}
      <header className="tpl-command-bar">
        <div className="tpl-command-bar-left">
          <div className="tpl-nav-switcher" role="tablist" aria-label="模板工作区切换">
            <button
              type="button"
              role="tab"
              aria-selected={activeViewSection === "templates"}
              className={`tpl-nav-btn ${activeViewSection === "templates" ? "active" : ""}`}
              onClick={() => setActiveViewSection("templates")}
            >
              <LayoutTemplate size={15} />
              <span>实例模板库</span>
              <span className="tpl-nav-count">{templates.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeViewSection === "packs"}
              className={`tpl-nav-btn ${activeViewSection === "packs" ? "active" : ""}`}
              onClick={() => setActiveViewSection("packs")}
            >
              <Package size={15} />
              <span>在线运维预设包</span>
            </button>
          </div>
        </div>

        <div className="tpl-command-bar-right">
          <button
            className="secondary-button mini tpl-top-action-btn"
            type="button"
            onClick={() => void openSaveFromInstanceDialog()}
            title="将已配置的运行实例另存为模板"
          >
            <Upload size={13} />
            <span>从实例提取</span>
          </button>
          <button
            className="primary-button mini tpl-top-action-btn"
            type="button"
            onClick={() => openCreateCustomTemplateModal(null)}
            title="新建自定义模板"
          >
            <Plus size={13} />
            <span>新建模板</span>
          </button>
          <button
            className="icon-button mini tpl-top-refresh-btn"
            type="button"
            title="刷新模板与节点列表"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} className={refreshing ? "spin" : ""} />
          </button>
        </div>
      </header>

      {/* View Section 1: Online Operation Packs */}
      {activeViewSection === "packs" ? (
        <div className="tpl-packs-view-container">
          <OperationPacksPanel
            token={token}
            onLogout={onLogout}
            refreshTick={refreshTick}
            onImported={async () => {
              await refresh();
            }}
          />
        </div>
      ) : null}

      {/* View Section 2: Main Template Studio Workbench */}
      {activeViewSection === "templates" ? (
        <>
          {/* Mobile Tab Switcher */}
          <div className="template-mobile-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "list"}
              className={`template-mobile-tab-btn ${mobileTab === "list" ? "active" : ""}`}
              onClick={() => setMobileTab("list")}
            >
              <LayoutTemplate size={15} />
              <span>模板库 ({filteredTemplates.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "detail"}
              className={`template-mobile-tab-btn ${mobileTab === "detail" ? "active" : ""}`}
              onClick={() => setMobileTab("detail")}
            >
              <ArrowRight size={15} />
              <span>{selectedTemplate ? selectedTemplate.name : "配置部署"}</span>
            </button>
          </div>

          <main className="tpl-workbench-layout">
            {/* ══════════ LEFT PANE: Directory ══════════ */}
            <aside className={`panel-block tpl-sidebar ${mobileTab === "detail" ? "mobile-hidden" : ""}`}>
              {/* Search & Category Header */}
              <div className="tpl-sidebar-controls">
                <div className="tpl-search-box">
                  <Search size={13} className="tpl-search-icon" aria-hidden="true" />
                  <input
                    type="text"
                    className="tpl-search-input"
                    placeholder="搜索模板名称、启动命令或环境..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="tpl-search-clear-btn"
                      onClick={() => setSearchQuery("")}
                      title="清除搜索"
                    >
                      <X size={11} />
                    </button>
                  ) : null}
                </div>

                <div className="tpl-filter-pills" role="radiogroup" aria-label="模板归属筛选">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={categoryFilter === "all"}
                    className={`tpl-filter-pill ${categoryFilter === "all" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("all")}
                  >
                    全部 <span>{templates.length}</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={categoryFilter === "builtin"}
                    className={`tpl-filter-pill ${categoryFilter === "builtin" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("builtin")}
                  >
                    系统内置 <span>{builtinTemplates.length}</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={categoryFilter === "user"}
                    className={`tpl-filter-pill ${categoryFilter === "user" ? "active" : ""}`}
                    onClick={() => setCategoryFilter("user")}
                  >
                    自定义 <span>{userTemplates.length}</span>
                  </button>
                </div>

                {/* Optional Runtime Tags Filter */}
                {availableRuntimeTypes.length > 1 ? (
                  <div className="tpl-runtime-tags-bar">
                    <button
                      type="button"
                      className={`tpl-runtime-tag ${runtimeFilter === "all" ? "active" : ""}`}
                      onClick={() => setRuntimeFilter("all")}
                    >
                      全部运行时
                    </button>
                    {availableRuntimeTypes.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`tpl-runtime-tag ${runtimeFilter === type ? "active" : ""}`}
                        onClick={() => setRuntimeFilter(type)}
                      >
                        {instanceTypeLabel(type)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Template List Items */}
              <div className="tpl-list-scroll">
                {filteredTemplates.map((template) => {
                  const isSelected = selectedTemplateId === template.id;
                  const badgeMeta = getInstanceTypeBadgeMeta(template.type);
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`tpl-list-item ${isSelected ? "is-selected" : ""}`}
                      onClick={() => {
                        setSelectedTemplateId(template.id);
                        setMobileTab("detail");
                      }}
                    >
                      <div className={`tpl-item-icon-box ${badgeMeta.className}`}>
                        {badgeMeta.icon}
                      </div>

                      <div className="tpl-item-main">
                        <div className="tpl-item-topline">
                          <strong className="tpl-item-name">{template.name}</strong>
                          <span className={`tpl-item-badge ${template.isBuiltin ? "is-builtin" : "is-user"}`}>
                            {template.isBuiltin ? "内置" : template.createdByUsername ? `@${template.createdByUsername}` : "自定义"}
                          </span>
                        </div>

                        <div className="tpl-item-subline">
                          <span className="tpl-item-type-label">{instanceTypeLabel(template.type)}</span>
                          <span className="tpl-item-dot">·</span>
                          <code className="tpl-item-command-snippet" title={template.defaultStartCommand}>
                            {template.defaultStartCommand || "未设默认命令"}
                          </code>
                        </div>
                      </div>

                      <ChevronRight size={14} className="tpl-item-arrow" aria-hidden="true" />
                    </button>
                  );
                })}

                {filteredTemplates.length === 0 ? (
                  <div className="tpl-list-empty">
                    <Info size={20} className="tpl-empty-icon" />
                    <strong>未找到匹配模板</strong>
                    <p>尝试调整搜索关键字，或新建自定义模板</p>
                    {searchQuery || categoryFilter !== "all" || runtimeFilter !== "all" ? (
                      <button
                        type="button"
                        className="secondary-button mini"
                        onClick={() => {
                          setSearchQuery("");
                          setCategoryFilter("all");
                          setRuntimeFilter("all");
                        }}
                      >
                        重置所有筛选
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </aside>

            {/* ══════════ RIGHT PANE: Inspector & Deployer ══════════ */}
            <section className={`panel-block tpl-inspector ${mobileTab === "list" ? "mobile-hidden" : ""}`}>
              {selectedTemplate ? (
                <>
                  {/* Inspector Header */}
                  <div className="tpl-inspector-head">
                    <div className="tpl-inspector-head-left">
                      <button
                        type="button"
                        className="template-mobile-back-btn"
                        onClick={() => setMobileTab("list")}
                        title="返回模板目录"
                      >
                        <ChevronLeft size={16} />
                        <span>目录</span>
                      </button>

                      <div className={`tpl-inspector-avatar ${getInstanceTypeBadgeMeta(selectedTemplate.type).className}`}>
                        {getInstanceTypeBadgeMeta(selectedTemplate.type).icon}
                      </div>

                      <div className="tpl-inspector-title-group">
                        <div className="tpl-inspector-title-row">
                          <h2 className="tpl-inspector-title">{selectedTemplate.name}</h2>
                          <span className="tpl-tag-chip">{instanceTypeLabel(selectedTemplate.type)}</span>
                          <span className={`tpl-tag-chip ${selectedTemplate.isBuiltin ? "is-builtin" : "is-user"}`}>
                            {selectedTemplate.isBuiltin ? "官方内置" : selectedTemplate.createdByUsername ? `@${selectedTemplate.createdByUsername}` : "自定义"}
                          </span>
                        </div>
                        {selectedTemplate.description ? (
                          <p className="tpl-inspector-desc">{selectedTemplate.description}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="tpl-inspector-head-actions">
                      <button
                        className="secondary-button mini"
                        type="button"
                        title="以此模板为底稿创建自定义模板"
                        onClick={() => openCreateCustomTemplateModal(selectedTemplate)}
                      >
                        <Copy size={13} />
                        <span>复制配置</span>
                      </button>

                      {!selectedTemplate.isBuiltin ? (
                        <>
                          <button
                            className={`secondary-button mini ${editing ? "active" : ""}`}
                            type="button"
                            title={editing ? "退出编辑" : "编辑此模板"}
                            onClick={() => (editing ? setEditing(false) : startEditing())}
                          >
                            <Edit3 size={13} />
                            <span>{editing ? "取消编辑" : "编辑模板"}</span>
                          </button>
                          <button
                            className="secondary-button mini danger"
                            type="button"
                            title="删除此模板"
                            onClick={() => void deleteTemplate()}
                          >
                            <Trash2 size={13} />
                            <span>删除</span>
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Technical Blueprint Strip */}
                  <div className="tpl-blueprint-strip">
                    <div className="tpl-blueprint-item tpl-blueprint-cmd-box">
                      <span className="tpl-blueprint-label">预设启动命令</span>
                      <div className="tpl-blueprint-cmd-wrap">
                        <Terminal size={12} className="tpl-blueprint-terminal-icon" />
                        <code className="tpl-blueprint-code">{selectedTemplate.defaultStartCommand || "—"}</code>
                        {selectedTemplate.defaultStartCommand ? (
                          <button
                            type="button"
                            className="tpl-copy-cmd-btn"
                            title="复制启动命令"
                            onClick={copyStartCommand}
                          >
                            {copiedCommand ? <Check size={12} className="is-success" /> : <Copy size={12} />}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="tpl-blueprint-item">
                      <span className="tpl-blueprint-label">工作目录前缀</span>
                      <code className="tpl-blueprint-val-code">{selectedTemplate.defaultWorkingDirectoryPrefix || "instances"}</code>
                    </div>

                    <div className="tpl-blueprint-item">
                      <span className="tpl-blueprint-label">重启策略</span>
                      <span className="tpl-blueprint-val">{restartPolicyLabel(selectedTemplate.restartPolicy)}</span>
                    </div>

                    <div className="tpl-blueprint-item">
                      <span className="tpl-blueprint-label">开机自启</span>
                      <span className="tpl-blueprint-val">{selectedTemplate.autoStart ? "是" : "否"}</span>
                    </div>

                    {selectedTemplate.ports.length > 0 ? (
                      <div className="tpl-blueprint-item tpl-blueprint-wide">
                        <span className="tpl-blueprint-label">预置端口</span>
                        <div className="tpl-chips-flow">
                          {selectedTemplate.ports.map((p, i) => (
                            <span key={i} className="tpl-port-chip">
                              {p.port}
                              {p.description ? ` (${p.description})` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selectedTemplate.envs.length > 0 ? (
                      <div className="tpl-blueprint-item tpl-blueprint-wide">
                        <span className="tpl-blueprint-label">预置环境变量</span>
                        <div className="tpl-chips-flow">
                          {selectedTemplate.envs.map((e, i) => (
                            <code key={i} className="tpl-env-chip">
                              {e.key}={e.value}
                            </code>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Inline Template Editor (when editing) */}
                  {editing ? (
                    <form
                      className="tpl-editor-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit();
                      }}
                    >
                      <div className="tpl-section-subhead">
                        <Edit3 size={14} />
                        <span>编辑模板预设配置</span>
                      </div>

                      <div className="tpl-form-grid">
                        <label className="tpl-field-group">
                          <span className="tpl-field-title">
                            模板名称 <span className="tpl-required">*</span>
                          </span>
                          <input
                            className="tpl-field-input"
                            value={editForm.name ?? ""}
                            onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))}
                            required
                          />
                        </label>

                        <label className="tpl-field-group">
                          <span className="tpl-field-title">工作目录前缀</span>
                          <input
                            className="tpl-field-input font-mono"
                            value={editForm.defaultWorkingDirectoryPrefix ?? ""}
                            onChange={(e) => setEditForm((c) => ({ ...c, defaultWorkingDirectoryPrefix: e.target.value }))}
                            placeholder="例如 instances 或 apps"
                          />
                        </label>

                        <label className="tpl-field-group tpl-col-wide">
                          <span className="tpl-field-title">模板描述</span>
                          <input
                            className="tpl-field-input"
                            value={editForm.description ?? ""}
                            onChange={(e) => {
                              const v = e.target.value.trim();
                              setEditForm((c) => {
                                const next = { ...c };
                                if (v) next.description = v;
                                else delete next.description;
                                return next;
                              });
                            }}
                            placeholder="简短说明模板的运行场景或配置要求"
                          />
                        </label>

                        <label className="tpl-field-group tpl-col-wide">
                          <span className="tpl-field-title">
                            默认启动命令 <span className="tpl-required">*</span>
                          </span>
                          <input
                            className="tpl-field-input font-mono"
                            value={editForm.defaultStartCommand ?? ""}
                            onChange={(e) => setEditForm((c) => ({ ...c, defaultStartCommand: e.target.value }))}
                            required
                          />
                        </label>

                        <label className="tpl-field-group tpl-col-wide">
                          <span className="tpl-field-title">默认停止命令（可选）</span>
                          <input
                            className="tpl-field-input font-mono"
                            value={editForm.defaultStopCommand ?? ""}
                            onChange={(e) => setEditForm((c) => ({ ...c, defaultStopCommand: e.target.value || null }))}
                            placeholder="留空则使用默认终止信号"
                          />
                        </label>

                        <div className="tpl-toggles-row tpl-col-wide">
                          <label className="tpl-toggle-card">
                            <input
                              type="checkbox"
                              checked={!!editForm.autoStart}
                              onChange={(e) => setEditForm((c) => ({ ...c, autoStart: e.target.checked }))}
                            />
                            <span>默认开机自启动</span>
                          </label>

                          <label className="tpl-toggle-card">
                            <input
                              type="checkbox"
                              checked={!!editForm.runAsUser}
                              onChange={(e) =>
                                setEditForm((c) => ({ ...c, runAsUser: e.target.checked ? "root" : null }))
                              }
                            />
                            <span>指定以 root 权限运行</span>
                          </label>
                        </div>
                      </div>

                      <div className="tpl-editor-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={savingEdit}
                          onClick={() => setEditing(false)}
                        >
                          取消
                        </button>
                        <button type="submit" className="primary-button" disabled={savingEdit}>
                          {savingEdit ? <Loader2 size={14} className="status-spinner" /> : <Save size={14} />}
                          <span>保存模板修改</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    /* Instance Deployment Sheet */
                    <form className="tpl-deploy-sheet" onSubmit={createFromTemplate}>
                      <div className="tpl-section-subhead">
                        <div className="tpl-subhead-left">
                          <Layers size={14} />
                          <span>配置并部署实例</span>
                        </div>
                        <button
                          type="button"
                          className="tpl-reset-link-btn"
                          onClick={resetFormToDefaults}
                          title="恢复为当前模板初始预设参数"
                        >
                          <RotateCcw size={12} />
                          <span>重置默认参数</span>
                        </button>
                      </div>

                      <div className="tpl-form-grid">
                        <label className="tpl-field-group">
                          <span className="tpl-field-title">
                            目标节点 <span className="tpl-required">*</span>
                          </span>
                          <select
                            className="tpl-field-input"
                            value={form.nodeId}
                            onChange={(e) => setForm((c) => ({ ...c, nodeId: e.target.value }))}
                            required
                          >
                            <option value="" disabled>
                              请选择运行节点
                            </option>
                            {nodes.map((node) => (
                              <option value={node.id} key={node.id}>
                                {node.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="tpl-field-group">
                          <span className="tpl-field-title">
                            实例名称 <span className="tpl-required">*</span>
                          </span>
                          <input
                            className="tpl-field-input"
                            value={form.name}
                            onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                            required
                            placeholder="例如：web-service-01"
                          />
                        </label>

                        <label className="tpl-field-group tpl-col-wide">
                          <div className="tpl-field-title-line">
                            <span className="tpl-field-title">
                              启动命令 <span className="tpl-required">*</span>
                            </span>
                          </div>
                          <div className="tpl-cmd-input-container">
                            <input
                              className="tpl-field-input font-mono tpl-cmd-input"
                              value={form.startCommand}
                              onChange={(e) => setForm((c) => ({ ...c, startCommand: e.target.value }))}
                              placeholder="输入实例启动命令..."
                              required
                            />
                            <button
                              type="button"
                              className="tpl-ai-detect-btn"
                              title={
                                form.workingDirectory.trim()
                                  ? "分析工作目录特征并自动推断启动命令"
                                  : "请先填写工作目录以供分析"
                              }
                              disabled={!form.workingDirectory.trim() || !form.nodeId || suggestingStartCommand}
                              onClick={() => void suggestTemplateStartCommand()}
                            >
                              {suggestingStartCommand ? (
                                <Loader2 size={12} className="status-spinner" />
                              ) : (
                                <Sparkles size={12} />
                              )}
                              <span>智能推断</span>
                            </button>
                          </div>
                        </label>

                        <label className="tpl-field-group tpl-col-wide">
                          <span className="tpl-field-title">工作目录（可选）</span>
                          <input
                            className="tpl-field-input font-mono"
                            value={form.workingDirectory}
                            onChange={(e) => setForm((c) => ({ ...c, workingDirectory: e.target.value }))}
                            placeholder={`留空按前缀规则生成 (${selectedTemplate.defaultWorkingDirectoryPrefix || "instances"}/${form.name || "<实例名>"})`}
                          />
                          <span className="tpl-field-hint">
                            默认生成路径:{" "}
                            <code>
                              {selectedTemplate.defaultWorkingDirectoryPrefix || "instances"}/
                              {form.name ? form.name.trim() : "my-instance"}
                            </code>
                          </span>
                        </label>

                        <label className="tpl-field-group">
                          <span className="tpl-field-title">重启策略</span>
                          <select
                            className="tpl-field-input"
                            value={form.restartPolicy}
                            onChange={(e) => setForm((c) => ({ ...c, restartPolicy: e.target.value as RestartPolicy }))}
                          >
                            <option value="never">不自动重启</option>
                            <option value="on_failure">异常退出重启</option>
                            <option value="always">总是重启</option>
                          </select>
                        </label>

                        <label className="tpl-field-group">
                          <span className="tpl-field-title">最大重试次数</span>
                          <input
                            type="number"
                            min={0}
                            max={99}
                            className="tpl-field-input"
                            value={form.restartMaxRetries}
                            onChange={(e) => setForm((c) => ({ ...c, restartMaxRetries: Number(e.target.value) || 0 }))}
                          />
                        </label>

                        <div className="tpl-col-wide">
                          <label className="tpl-toggle-card">
                            <input
                              type="checkbox"
                              checked={form.autoStart}
                              onChange={(e) => setForm((c) => ({ ...c, autoStart: e.target.checked }))}
                            />
                            <span>创建后开机自启动</span>
                          </label>
                        </div>
                      </div>

                      {/* Deployment CTA Footer */}
                      <div className="tpl-deploy-footer">
                        <div className="tpl-deploy-summary">
                          <span>
                            将在节点 <strong>{nodes.find((n) => n.id === form.nodeId)?.name || "—"}</strong> 部署{" "}
                            <strong>{instanceTypeLabel(selectedTemplate.type)}</strong> 实例
                          </span>
                        </div>

                        <button
                          type="submit"
                          className="primary-button tpl-deploy-btn"
                          disabled={creating || !selectedTemplate || nodes.length === 0 || !form.startCommand.trim() || !form.name.trim()}
                        >
                          {creating ? (
                            <>
                              <Loader2 size={15} className="status-spinner" />
                              <span>正在创建实例…</span>
                            </>
                          ) : (
                            <>
                              <ArrowRight size={15} />
                              <span>立即创建并部署实例</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : (
                <div className="tpl-inspector-empty">
                  <LayoutTemplate size={36} className="tpl-empty-icon" />
                  <h3>选择一个模板开始部署</h3>
                  <p>从左侧目录选择预设模板快速创建实例，或点击顶部“从实例提取”与“新建模板”沉淀新规范。</p>
                </div>
              )}
            </section>
          </main>
        </>
      ) : null}

      {/* ══════════ MODAL 1: Save from instance ══════════ */}
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
                      <Upload size={16} />
                    </div>
                    <div>
                      <h3 className="template-modal-title">从实例提取为模板</h3>
                      <p className="template-modal-subtitle">复用已有实例的启动参数与目录规则，快速固化为标准化模板</p>
                    </div>
                  </div>
                  <div className="template-modal-header-actions">
                    <button
                      className="icon-button modal-fullscreen-btn"
                      type="button"
                      title={saveModalFullscreen ? "还原窗口" : "最大化 / 全屏"}
                      onClick={() => setSaveModalFullscreen((v) => !v)}
                    >
                      {saveModalFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                    <button
                      className="icon-button modal-close-btn"
                      type="button"
                      title="关闭"
                      onClick={() => setShowSaveFromInstance(false)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                <form
                  className="modal-form template-save-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTemplateFromInstance();
                  }}
                >
                  <div className="template-save-form-fields">
                    <label className="tpl-field-group">
                      <span className="tpl-field-title">
                        选择实例原型 <span className="tpl-required">*</span>
                      </span>
                      <select
                        className="tpl-field-input"
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

                    <label className="tpl-field-group">
                      <span className="tpl-field-title">
                        模板名称 <span className="tpl-required">*</span>
                      </span>
                      <input
                        className="tpl-field-input"
                        value={saveForm.name}
                        onChange={(e) => setSaveForm((c) => ({ ...c, name: e.target.value }))}
                        required
                        placeholder="例如：生产环境 Node.js API"
                      />
                    </label>

                    <label className="tpl-field-group">
                      <span className="tpl-field-title">模板描述（可选）</span>
                      <input
                        className="tpl-field-input"
                        value={saveForm.description}
                        onChange={(e) => setSaveForm((c) => ({ ...c, description: e.target.value }))}
                        placeholder="简短说明模板的适用场景或环境依赖"
                      />
                    </label>

                    <label className="tpl-field-group">
                      <span className="tpl-field-title">启动命令（留空则继承实例）</span>
                      <input
                        className="tpl-field-input font-mono"
                        value={saveForm.startCommand}
                        onChange={(e) => setSaveForm((c) => ({ ...c, startCommand: e.target.value }))}
                        placeholder="例如：node server.js"
                      />
                    </label>

                    <div className="tpl-form-row-2">
                      <label className="tpl-field-group">
                        <span className="tpl-field-title">停止命令（可选）</span>
                        <input
                          className="tpl-field-input font-mono"
                          value={saveForm.stopCommand}
                          onChange={(e) => setSaveForm((c) => ({ ...c, stopCommand: e.target.value }))}
                          placeholder="留空沿用默认信号"
                        />
                      </label>

                      <label className="tpl-field-group">
                        <span className="tpl-field-title">工作目录前缀</span>
                        <input
                          className="tpl-field-input font-mono"
                          value={saveForm.workingDirectoryPrefix}
                          onChange={(e) => setSaveForm((c) => ({ ...c, workingDirectoryPrefix: e.target.value }))}
                          placeholder="例如 instances 或 nodejs"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="template-modal-actions">
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
                      disabled={savingTemplate || !saveForm.instanceId || !saveForm.name.trim()}
                    >
                      {savingTemplate ? <Loader2 size={14} className="status-spinner" /> : <Save size={14} />}
                      <span>保存为模板</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* ══════════ MODAL 2: Create Custom Template ══════════ */}
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
                      <Plus size={16} />
                    </div>
                    <div>
                      <h3 className="template-modal-title">新建自定义模板</h3>
                      <p className="template-modal-subtitle">设定通用运行配置，以便后续在任意节点秒级拉起实例</p>
                    </div>
                  </div>
                  <div className="template-modal-header-actions">
                    <button
                      className="icon-button modal-fullscreen-btn"
                      type="button"
                      title={customModalFullscreen ? "还原窗口" : "最大化 / 全屏"}
                      onClick={() => setCustomModalFullscreen((v) => !v)}
                    >
                      {customModalFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                    <button
                      className="icon-button modal-close-btn"
                      type="button"
                      title="关闭"
                      onClick={() => setShowCreateCustomTemplate(false)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                <form
                  className="modal-form template-save-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveCustomTemplate();
                  }}
                >
                  <div className="template-save-form-fields">
                    <div className="tpl-form-row-2">
                      <label className="tpl-field-group">
                        <span className="tpl-field-title">
                          模板名称 <span className="tpl-required">*</span>
                        </span>
                        <input
                          className="tpl-field-input"
                          value={customForm.name}
                          onChange={(e) => setCustomForm((c) => ({ ...c, name: e.target.value }))}
                          required
                          placeholder="例如：生产环境 Node.js API"
                        />
                      </label>

                      <label className="tpl-field-group">
                        <span className="tpl-field-title">实例类型</span>
                        <select
                          className="tpl-field-input"
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

                    <label className="tpl-field-group">
                      <span className="tpl-field-title">
                        默认启动命令 <span className="tpl-required">*</span>
                      </span>
                      <input
                        className="tpl-field-input font-mono"
                        value={customForm.defaultStartCommand}
                        onChange={(e) => setCustomForm((c) => ({ ...c, defaultStartCommand: e.target.value }))}
                        placeholder="例如：node index.js 或 python app.py"
                        required
                      />
                    </label>

                    <div className="tpl-form-row-2">
                      <label className="tpl-field-group">
                        <span className="tpl-field-title">默认停止命令（可选）</span>
                        <input
                          className="tpl-field-input font-mono"
                          value={customForm.defaultStopCommand}
                          onChange={(e) => setCustomForm((c) => ({ ...c, defaultStopCommand: e.target.value }))}
                          placeholder="例如：npm stop 或 docker stop"
                        />
                      </label>

                      <label className="tpl-field-group">
                        <span className="tpl-field-title">工作目录前缀</span>
                        <input
                          className="tpl-field-input font-mono"
                          value={customForm.defaultWorkingDirectoryPrefix}
                          onChange={(e) => setCustomForm((c) => ({ ...c, defaultWorkingDirectoryPrefix: e.target.value }))}
                          placeholder="例如：instances 或 nodejs"
                        />
                      </label>
                    </div>

                    <label className="tpl-field-group">
                      <span className="tpl-field-title">模板描述（可选）</span>
                      <input
                        className="tpl-field-input"
                        value={customForm.description}
                        onChange={(e) => setCustomForm((c) => ({ ...c, description: e.target.value }))}
                        placeholder="简短说明模板的适用场景或环境依赖"
                      />
                    </label>

                    <div className="tpl-form-row-2">
                      <label className="tpl-field-group">
                        <span className="tpl-field-title">重启策略</span>
                        <select
                          className="tpl-field-input"
                          value={customForm.restartPolicy}
                          onChange={(e) => setCustomForm((c) => ({ ...c, restartPolicy: e.target.value as RestartPolicy }))}
                        >
                          <option value="never">不自动重启</option>
                          <option value="on_failure">异常退出重启</option>
                          <option value="always">总是重启</option>
                        </select>
                      </label>

                      <label className="tpl-field-group">
                        <span className="tpl-field-title">最大重试次数</span>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          className="tpl-field-input"
                          value={customForm.restartMaxRetries}
                          onChange={(e) => setCustomForm((c) => ({ ...c, restartMaxRetries: Number(e.target.value) || 0 }))}
                        />
                      </label>
                    </div>

                    <div>
                      <label className="tpl-toggle-card">
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
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowCreateCustomTemplate(false)}
                      disabled={savingCustomTemplate}
                    >
                      取消
                    </button>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={savingCustomTemplate || !customForm.name.trim() || !customForm.defaultStartCommand.trim()}
                    >
                      {savingCustomTemplate ? <Loader2 size={14} className="status-spinner" /> : <Save size={14} />}
                      <span>保存自定义模板</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
