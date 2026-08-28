import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Bot,
  Bug,
  Camera,
  ChartNetwork,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  Code2,
  Coins,
  Copy,
  CornerDownLeft,
  CornerUpLeft,
  Cpu,
  Database,
  Download,
  DownloadCloud,
  Edit3,
  Eye,
  EyeOff,
  FileArchive,
  FilePlus,
  FileSearch,
  FileText,
  FileUp,
  Folder,
  FolderArchive,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Gamepad2,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  Hash,
  Heart,
  History,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  Info,
  KeyRound,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  List,
  ListChecks,
  Loader2,
  LogIn,
  LogOut,
  Maximize2,
  MemoryStick,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Move,
  Paintbrush,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PhoneOff,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Terminal as TerminalIcon,
  TextQuote,
  Trash2,
  TrendingUp,
  Trophy,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  UserRound,
  UtensilsCrossed,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Wrench,
  X,
  XOctagon,
  Zap
} from "lucide-react";
import type {
  ClashSubscriptionProxy,
  CreateInstanceRequest,
  CurrentUser,
  DatabaseVisualizerInstance,
  InstanceAssignee,
  InstanceLogLine,
  InstanceProxyConfig,
  InstanceStatus,
  InstanceTemplate,
  ManagedInstance,
  ManagedNode,
  ManagedUser,
  RestartPolicy,
  WatchPolicyMode
} from "@webops/shared";
import type {
  InstanceDirectoryView,
  SakiInstanceFileDragPayload,
  SakiInstanceFileDropRequest,
  SakiPromptSeed
} from "../../types/app.js";
import { api, ApiError } from "../../api.js";
import { usePanelT } from "../../i18n/index.js";
import {
  AccessEmptyView,
  InstanceStatusBadge,
  InstanceStatusIcon,
  PageErrorToast,
  compactCommand,
  compactPathLabel,
  instanceAssigneeLabel,
  instanceAssigneeTitle,
  instanceAssignedUsers,
  instanceCreatorLabel,
  instanceStatusMeta,
  instanceTypeLabel,
  isInstanceAssignedTo,
  managedUserAssignee,
  managedUserOwnerRole,
  nodeEndpointLabel,
  ownerRoleLabel,
  primaryAssigneeFields,
  restartPolicyLabel,
  userDisplayLabel
} from "../../components/common/CommonUI.js";
import { SakiEmptyState } from "../../components/saki/SakiEmptyState.js";
import {
  TerminalAutocompleteState,
  TerminalConnectionState,
  WebTerminal,
  nextTerminalAutocompleteValue
} from "../../components/terminal/WebTerminal.js";
import { FileManager } from "../../components/file-manager/FileManager.js";
import { InstanceLogs } from "./InstanceLogs.js";
import { InstanceProxyModal } from "./InstanceProxyModal.js";
import { InstanceSettingsModal } from "./InstanceSettingsModal.js";
import { InstanceTasksPanel } from "./InstanceTasksPanel.js";
import { InstanceProcessProbeCard } from "./InstanceProcessProbeCard.js";
import { formatBytes, formatDate } from "../../utils/path.js";
import { parseHashRoute, updateHashRoute } from "../../utils/route.js";
import { defaultStartCommand, sakiArtAssets } from "../../constants.js";
import { DatabaseVisualizer, AddDatabaseModal } from "../../DatabaseVisualizer.js";
import { IncidentBanner } from "../../IncidentInbox.js";

export function InstancesView({
  token,
  onLogout,
  refreshTick,
  onOpenTemplates,
  onInstanceFocus,
  onAskSaki,
  onSakiFileDragChange,
  onSakiInstanceFileDrop,
  darkMode,
  initialInstanceId,
  onSelectInstance
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  onOpenTemplates: () => void;
  onInstanceFocus: (instance: ManagedInstance | null) => void;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  onSakiFileDragChange: (active: boolean) => void;
  onSakiInstanceFileDrop?: ((payload: SakiInstanceFileDragPayload) => void) | undefined;
  darkMode: boolean;
  initialInstanceId?: string | null;
  onSelectInstance?: (id: string | null) => void;
}) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    return initialInstanceId ?? parseHashRoute().instanceId ?? null;
  });

  const prevInitialIdRef = useRef(initialInstanceId);
  useEffect(() => {
    if (initialInstanceId !== prevInitialIdRef.current) {
      prevInitialIdRef.current = initialInstanceId;
      setSelectedIdState(initialInstanceId ?? null);
    }
  }, [initialInstanceId]);

  const setSelectedId = useCallback(
    (idOrUpdater: string | null | ((prev: string | null) => string | null)) => {
      setSelectedIdState((prev) => {
        const nextId = typeof idOrUpdater === "function" ? idOrUpdater(prev) : idOrUpdater;
        prevInitialIdRef.current = nextId;
        queueMicrotask(() => {
          onSelectInstance?.(nextId);
        });
        updateHashRoute({ view: "instances", instanceId: nextId });
        return nextId;
      });
    },
    [onSelectInstance]
  );
  const [terminalTabs, setTerminalTabs] = useState<Array<{ key: string; label: string; shellSessionId?: string }>>([
    { key: "main", label: "终端" }
  ]);
  const [activeTerminalKey, setActiveTerminalKey] = useState<string>("main");
  const [terminalActions, setTerminalActions] = useState<{
    clear: () => void;
    reconnect: () => void;
    toggleImmersive: () => void;
    isImmersive: boolean;
    connectionState: TerminalConnectionState;
    sendCommand: (cmd: string) => void;
    getHistory: () => string[];
    extractOrCopyLogs?: () => void;
  } | null>(null);
  const [terminalCmd, setTerminalCmd] = useState("");
  const [terminalHistoryIndex, setTerminalHistoryIndex] = useState<number | null>(null);
  const [terminalHistoryDraft, setTerminalHistoryDraft] = useState("");
  const [terminalAutocompleteState, setTerminalAutocompleteState] = useState<TerminalAutocompleteState | null>(null);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);

  useEffect(() => {
    if (!showHistoryMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".terminal-history-wrap")) return;
      setShowHistoryMenu(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showHistoryMenu]);

  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestingStartCommand, setSuggestingStartCommand] = useState<"create" | "settings" | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createModalType, setCreateModalType] = useState<"instance" | "database">("instance");
  const [databases, setDatabases] = useState<DatabaseVisualizerInstance[]>([]);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showFileManagerModal, setShowFileManagerModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showProxyModal, setShowProxyModal] = useState(false);
  const [showDatabaseVisualizer, setShowDatabaseVisualizer] = useState(false);
  const [showTitlebarMore, setShowTitlebarMore] = useState(false);
  const titlebarMoreRef = useRef<HTMLButtonElement>(null);
  const [titlebarMorePos, setTitlebarMorePos] = useState<{ top: number; right: number } | null>(null);

  const isAnyModalOpen = Boolean(
    showCreateForm ||
    showTaskModal ||
    showFileManagerModal ||
    showSettingsModal ||
    showProxyModal ||
    showDatabaseVisualizer
  );

  useEffect(() => {
    if (!isAnyModalOpen) return;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [isAnyModalOpen]);

  useEffect(() => {
    if (!showTitlebarMore) {
      setTitlebarMorePos(null);
      return;
    }
    const btn = titlebarMoreRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setTitlebarMorePos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".titlebar-more-wrap")) return;
      if (event.target instanceof Element && event.target.closest(".titlebar-more-menu")) return;
      setShowTitlebarMore(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showTitlebarMore]);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [directoryView, setDirectoryView] = useState<InstanceDirectoryView>(() => {
    const savedView =
      typeof window !== "undefined" ? window.localStorage.getItem("webops.instanceDirectoryView") : null;
    return savedView === "list" || savedView === "graph" || savedView === "cards" ? savedView : "cards";
  });
  const [form, setForm] = useState({
    nodeId: "",
    name: "demo-command",
    workingDirectory: "",
    startCommand: defaultStartCommand,
    stopCommand: "",
    description: "",
    autoStart: false,
    restartPolicy: "never" as RestartPolicy,
    restartMaxRetries: 3
  });
  

  const selectedInstance = instances.find((instance) => instance.id === selectedId) ?? null;
  const selectedNode = selectedInstance ? nodes.find((node) => node.id === selectedInstance.nodeId) ?? null : null;

  // Reset terminal tabs when switching instances
  useEffect(() => {
    if (selectedId) {
      setTerminalTabs([{ key: "main", label: "终端" }]);
      setActiveTerminalKey("main");
    }
  }, [selectedId]);

  function getNextShellLabel(currentTabs: typeof terminalTabs): string {
    const used = new Set<number>();
    currentTabs.forEach((tab) => {
      const match = /^shell(\d+)$/i.exec(tab.label);
      if (match?.[1]) {
        used.add(parseInt(match[1], 10));
      }
    });
    let n = 1;
    while (used.has(n)) n++;
    return `shell${n}`;
  }

  const instanceStats = useMemo(() => {
    const counts = instances.reduce(
      (current, instance) => ({
        ...current,
        [instance.status]: current[instance.status] + 1
      }),
      {
        CREATED: 0,
        STARTING: 0,
        RUNNING: 0,
        STOPPING: 0,
        STOPPED: 0,
        CRASHED: 0,
        UNKNOWN: 0
      } satisfies Record<InstanceStatus, number>
    );
    const visibleStatuses = (Object.keys(counts) as InstanceStatus[])
      .filter((status) => counts[status] > 0 && status !== "CREATED")
      .sort((first, second) => instanceStatusMeta(first).rank - instanceStatusMeta(second).rank);

    return {
      counts,
      visibleStatuses
    };
  }, [instances]);
  const sortedInstances = useMemo(
    () =>
      [...instances].sort((first, second) => {
        const statusRank = instanceStatusMeta(first.status).rank - instanceStatusMeta(second.status).rank;
        if (statusRank !== 0) return statusRank;
        return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
      }),
    [instances]
  );
  const graphLayout = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groups = new Map<
      string,
      {
        id: string;
        label: string;
        detail: string;
        instances: ManagedInstance[];
      }
    >();
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    for (const instance of sortedInstances) {
      const instanceNode = nodeById.get(instance.nodeId) ?? null;
      let group = groups.get(instance.nodeId);
      if (!group) {
        group = {
          id: instance.nodeId,
          label: instanceNode?.name ?? instance.nodeName ?? instance.nodeId,
          detail: nodeEndpointLabel(instanceNode) || (instance.nodeName ?? instance.nodeId),
          instances: []
        };
        groups.set(instance.nodeId, group);
      }
      group.instances.push(instance);
    }

    const groupEntries = Array.from(groups.values());
    const hubCount = Math.max(groupEntries.length, 1);
    const hubs = groupEntries.map((group, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / hubCount;
      const radiusX = groupEntries.length === 1 ? 0 : 27;
      const radiusY = groupEntries.length === 1 ? 0 : 19;
      return {
        id: group.id,
        label: group.label,
        detail: group.detail,
        count: group.instances.length,
        x: clamp(50 + Math.cos(angle) * radiusX, 18, 82),
        y: clamp(50 + Math.sin(angle) * radiusY, 18, 82)
      };
    });
    const instancePoints: Array<{
      instance: ManagedInstance;
      nodeLabel: string;
      nodeDetail: string;
      meta: ReturnType<typeof instanceStatusMeta>;
      x: number;
      y: number;
      hubX: number;
      hubY: number;
    }> = [];

    groupEntries.forEach((group, groupIndex) => {
      const hub = hubs[groupIndex];
      if (!hub) return;
      const ringCapacity = group.instances.length > 12 ? 10 : 8;
      group.instances.forEach((instance, index) => {
        const ring = Math.floor(index / ringCapacity);
        const ringIndex = index % ringCapacity;
        const itemsInRing = Math.min(ringCapacity, group.instances.length - ring * ringCapacity);
        const angleOffset = groupEntries.length > 1 ? groupIndex * 0.42 : 0;
        const angle = -Math.PI / 2 + angleOffset + (2 * Math.PI * ringIndex) / Math.max(itemsInRing, 1);
        const baseRadiusX = groupEntries.length > 2 ? 15 : 21;
        const baseRadiusY = groupEntries.length > 2 ? 11 : 15;
        const x = clamp(hub.x + Math.cos(angle) * (baseRadiusX + ring * 8), 8, 92);
        const y = clamp(hub.y + Math.sin(angle) * (baseRadiusY + ring * 6), 10, 90);
        instancePoints.push({
          instance,
          nodeLabel: group.label,
          nodeDetail: group.detail,
          meta: instanceStatusMeta(instance.status),
          x,
          y,
          hubX: hub.x,
          hubY: hub.y
        });
      });
    });

    return {
      hubs,
      instances: instancePoints,
      edges: instancePoints.map((point) => ({
        id: point.instance.id,
        className: point.meta.className,
        x1: point.hubX,
        y1: point.hubY,
        x2: point.x,
        y2: point.y
      }))
    };
  }, [nodes, sortedInstances]);
  const updateInstanceStatus = useCallback((id: string, status: InstanceStatus, exitCode?: number | null) => {
    setInstances((current) =>
      current.map((instance) =>
        instance.id === id ? { ...instance, status, lastExitCode: exitCode ?? instance.lastExitCode } : instance
      )
    );
  }, []);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextNodes, nextInstances, nextDatabases] = await Promise.all([
        api.nodes(token),
        api.instances(token),
        api.listDatabases(token).then((res) => res.databases || []).catch(() => [])
      ]);
      setNodes(nextNodes);
      setInstances(nextInstances);
      setDatabases(nextDatabases);
      setSelectedIdState((current) => {
        if (!current) return null;
        const validId = nextInstances.some((instance) => instance.id === current) ? current : null;
        if (validId !== current) {
          prevInitialIdRef.current = validId;
          queueMicrotask(() => {
            onSelectInstance?.(validId);
          });
          updateHashRoute({ view: "instances", instanceId: validId });
        }
        return validId;
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
      setError(err instanceof Error ? err.message : "刷新失败");
    }
  }, [initialInstanceId, onLogout, onSelectInstance, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("webops.instanceDirectoryView", directoryView);
  }, [directoryView]);

  const lastLoadedInstanceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedInstance) {
      lastLoadedInstanceIdRef.current = null;
      return;
    }
    }, [selectedInstance, token]);

  useEffect(() => {
    onInstanceFocus(selectedInstance);
  }, [onInstanceFocus, selectedInstance]);

  const handleSakiInstanceFileDrop = useCallback(
    (payload: SakiInstanceFileDragPayload) => {
      if (selectedInstance) {
        onInstanceFocus(selectedInstance);
      }
      onSakiInstanceFileDrop?.(payload);
    },
    [onInstanceFocus, onSakiInstanceFileDrop, selectedInstance]
  );

  useEffect(() => {
    setToolsCollapsed(false);
    setShowTaskModal(false);
  }, [selectedId]);

  async function suggestStartCommand() {
    const nodeId = form.nodeId.trim();
    const workingDirectory = form.workingDirectory.trim();
    if (!nodeId || !workingDirectory) return;

    setSuggestingStartCommand("create");
    setError("");
    try {
      const suggestion = await api.suggestInstanceStartCommand(token, {
        nodeId,
        workingDirectory
      });
      if (!suggestion.startCommand) {
        setError(`AI 未能识别启动命令：${suggestion.reason}`);
        return;
      }
      setForm((current) => ({ ...current, startCommand: suggestion.startCommand }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 分析启动命令失败");
    } finally {
      setSuggestingStartCommand(null);
    }
  }

  async function createInstance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const payload: CreateInstanceRequest = {
        nodeId: form.nodeId,
        name: form.name,
        startCommand: form.startCommand
      };
      if (form.workingDirectory) payload.workingDirectory = form.workingDirectory;
      const stopCommand = form.stopCommand.trim();
      const description = form.description.trim();
      if (stopCommand) payload.stopCommand = stopCommand;
      if (description) payload.description = description;
      payload.autoStart = form.autoStart;
      payload.restartPolicy = form.restartPolicy;
      payload.restartMaxRetries = form.restartMaxRetries;

      const instance = await api.createInstance(token, payload);
      setInstances((current) => [instance, ...current]);
      setSelectedId(instance.id);
      setShowCreateForm(false);
      setForm((current) => ({
        ...current,
        name: "demo-command",
        workingDirectory: "",
        startCommand: defaultStartCommand,
        stopCommand: "",
        description: "",
        autoStart: false,
        restartPolicy: "never",
        restartMaxRetries: 3
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  

  

  async function runAction(instance: ManagedInstance, action: "start" | "stop" | "restart" | "kill") {
    setBusyId(instance.id);
    setError("");
    try {
      const response =
        action === "start"
          ? await api.startInstance(token, instance.id)
          : action === "stop"
            ? await api.stopInstance(token, instance.id)
            : action === "restart"
              ? await api.restartInstance(token, instance.id)
              : await api.killInstance(token, instance.id);

      setInstances((current) => current.map((item) => (item.id === instance.id ? response.instance : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteInstance(instance: ManagedInstance) {
    if (!window.confirm(`删除实例 ${instance.name}？`)) return;
    setBusyId(instance.id);
    setError("");
    try {
      await api.deleteInstance(token, instance.id);
      setInstances((current) => current.filter((item) => item.id !== instance.id));
      setSelectedId((current) => (current === instance.id ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  const createDialog = showCreateForm ? (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setShowCreateForm(false);
        }
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="create-instance-title">
        <div className="modal-header">
          <div className="modal-title-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="modal-title-icon-badge">
                {createModalType === "instance" ? <Plus size={18} /> : <Database size={18} />}
              </div>
              <div>
                <h2 id="create-instance-title" style={{ margin: 0, fontSize: 16 }}>
                  {createModalType === "instance" ? "创建标准实例" : "添加数据库可视化"}
                </h2>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
                  {createModalType === "instance"
                    ? "在指定节点上运行后台命令或服务进程"
                    : "自动扫描节点数据库或手动配置直连可视化"}
                </p>
              </div>
            </div>
            <button className="icon-button mini" title="关闭" type="button" onClick={() => setShowCreateForm(false)}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="unified-create-tabs">
          <button
            type="button"
            className={`create-type-tab ${createModalType === "instance" ? "active" : ""}`}
            onClick={() => setCreateModalType("instance")}
          >
            <TerminalIcon size={15} />
            <span>标准命令/进程实例</span>
          </button>
          <button
            type="button"
            className={`create-type-tab ${createModalType === "database" ? "active" : ""}`}
            onClick={() => setCreateModalType("database")}
          >
            <Database size={15} />
            <span>数据库可视化实例</span>
          </button>
        </div>

        {createModalType === "instance" ? (
          <>
            <div className="modal-body">
              <form id="create-instance-form" className="instance-form modal-form" onSubmit={createInstance}>
                <label>
                  节点
                  <select
                    value={form.nodeId}
                    onChange={(event) => setForm((current) => ({ ...current, nodeId: event.target.value }))}
                    required
                  >
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
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  工作目录
                  <input
                    value={form.workingDirectory}
                    onChange={(event) => setForm((current) => ({ ...current, workingDirectory: event.target.value }))}
                    placeholder="留空自动创建"
                  />
                </label>
                <label className="wide-field">
                  启动命令
                  <div className="start-command-control">
                    <input
                      value={form.startCommand}
                      onChange={(event) => setForm((current) => ({ ...current, startCommand: event.target.value }))}
                      placeholder="填写工作目录后可用 AI 分析"
                      required
                    />
                    <button
                      className="icon-button mini ai-suggest-button"
                      type="button"
                      title={form.workingDirectory.trim() ? "AI 分析并填写启动命令" : "请先填写工作目录"}
                      disabled={!form.workingDirectory.trim() || !form.nodeId || suggestingStartCommand !== null}
                      onClick={() => void suggestStartCommand()}
                    >
                      {suggestingStartCommand === "create" ? <Loader2 size={14} className="status-spinner" /> : <Sparkles size={14} />}
                    </button>
                  </div>
                </label>
                <label className="wide-field">
                  停止命令
                  <input
                    value={form.stopCommand}
                    onChange={(event) => setForm((current) => ({ ...current, stopCommand: event.target.value }))}
                    placeholder="可选"
                  />
                </label>
                <label className="wide-field">
                  描述
                  <input
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="可选"
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={form.autoStart}
                    onChange={(event) => setForm((current) => ({ ...current, autoStart: event.target.checked }))}
                  />
                  自启动
                </label>
                <label>
                  重启策略
                  <select
                    value={form.restartPolicy}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, restartPolicy: event.target.value as RestartPolicy }))
                    }
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
                    onChange={(event) =>
                      setForm((current) => ({ ...current, restartMaxRetries: Number(event.target.value) || 0 }))
                    }
                  />
                </label>
              </form>
            </div>
            <div className="modal-footer">
              <button className="ghost-button" type="button" onClick={() => setShowCreateForm(false)}>
                取消
              </button>
              <button className="primary-button" type="submit" form="create-instance-form" disabled={creating || nodes.length === 0 || !form.startCommand.trim()}>
                <Plus size={18} />
                {creating ? "创建中" : "创建"}
              </button>
            </div>
          </>
        ) : (
          <div className="unified-create-database-wrapper">
            <AddDatabaseModal
              token={token}
              nodes={nodes}
              embed={true}
              onClose={() => setShowCreateForm(false)}
              onCreated={async (newDb) => {
                setShowCreateForm(false);
                await refresh();
                setSelectedDatabaseId(newDb.id);
              }}
            />
          </div>
        )}
      </div>
    </div>
  ) : null;

  const databaseVisualizerDialog = showDatabaseVisualizer ? (
    <div className="glass-modal-overlay" onClick={() => setShowDatabaseVisualizer(false)}>
      <div
        className="glass-modal-container database-visualizer-fullscreen-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <DatabaseVisualizer
          token={token}
          nodes={nodes}
          onClose={() => setShowDatabaseVisualizer(false)}
          darkMode={darkMode}
        />
      </div>
    </div>
  ) : null;

  const instanceViewOptions: Array<{
    view: InstanceDirectoryView;
    label: string;
    title: string;
    icon: React.ReactNode;
  }> = [
    { view: "cards", label: "卡片", title: "卡片视图", icon: <LayoutGrid size={15} /> },
    { view: "list", label: "列表", title: "列表视图", icon: <List size={15} /> },
    { view: "graph", label: "图谱", title: "图谱视图", icon: <ChartNetwork size={15} /> }
  ];
  function renderInstanceRowActions(instance: ManagedInstance) {
    const running = instance.status === "RUNNING" || instance.status === "STARTING";
    const busy = busyId === instance.id;
    const actionTitle = running ? "停止" : "启动";

    return (
      <div className="row-actions instance-row-actions">
        <button
          className="icon-button mini"
          title={actionTitle}
          disabled={busy || instance.status === "STOPPING"}
          onClick={() => void runAction(instance, running ? "stop" : "start")}
        >
          {running ? <Square size={15} /> : <Play size={15} />}
        </button>
        <button
          className="icon-button mini"
          title="重启"
          disabled={busy}
          onClick={() => void runAction(instance, "restart")}
        >
          <RotateCw size={15} />
        </button>
        <button
          className="icon-button mini danger-action"
          title="删除"
          disabled={busy}
          onClick={() => void deleteInstance(instance)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  const selectedDatabase = databases.find((db) => db.id === selectedDatabaseId) ?? null;
  if (selectedDatabase) {
    return (
      <div className="database-view-layout">
        <DatabaseVisualizer
          token={token}
          nodes={nodes}
          selectedDatabaseId={selectedDatabase.id}
          onClose={() => setSelectedDatabaseId(null)}
          onSelectDatabase={(id) => setSelectedDatabaseId(id)}
          darkMode={darkMode}
        />
      </div>
    );
  }

  if (selectedInstance) {
    const running = selectedInstance.status === "RUNNING" || selectedInstance.status === "STARTING";
    const busy = busyId === selectedInstance.id;
    const selectedStatusMeta = instanceStatusMeta(selectedInstance.status);
    const selectedNodeName = selectedNode?.name ?? selectedInstance.nodeName ?? selectedInstance.nodeId;
    const activeTab = terminalTabs.find((t) => t.key === activeTerminalKey);
    const isShellTab = Boolean(activeTab?.shellSessionId || (activeTab && activeTab.key !== "main"));
    const canCommandInput = Boolean(selectedInstance && (running || isShellTab));

    return (
      <>
        <PageErrorToast
          error={error}
          onDismiss={() => setError("")}
          action={
            onAskSaki ? (
              <button
                className="small-button"
                type="button"
                onClick={() =>
                  onAskSaki({
                    message: `请解释并修复当前实例面板报错：\n${error}`,
                    panelError: error,
                    mode: "agent"
                  })
                }
              >
                <Sparkles size={14} />
                问 Saki
              </button>
            ) : null
          }
        />
        {typeof document !== "undefined" && createDialog ? createPortal(createDialog, document.body) : null}
        {typeof document !== "undefined" && databaseVisualizerDialog ? createPortal(databaseVisualizerDialog, document.body) : null}
        {typeof document !== "undefined" && showTaskModal && selectedInstance ? createPortal(
          <InstanceTasksPanel
            token={token}
            onLogout={onLogout}
            refreshTick={refreshTick}
            instance={selectedInstance}
            onClose={() => setShowTaskModal(false)}
          />,
          document.body
        ) : null}

        {typeof document !== "undefined" && showFileManagerModal && selectedInstance ? createPortal(
          <div className="glass-modal-overlay" onClick={() => setShowFileManagerModal(false)}>
            <div className="glass-modal-container file-manager-fullscreen-modal" onClick={(e) => e.stopPropagation()}>
              <div className="glass-modal-header">
                <div className="modal-title-wrap">
                  <div className="modal-title-icon-badge">
                    <FolderOpen size={20} />
                  </div>
                  <div>
                    <h3 className="modal-title">文件管理</h3>
                    <span className="modal-subtitle">{selectedInstance.name} · {selectedInstance.workingDirectory || "未设置工作目录"}</span>
                  </div>
                </div>
                <button
                  className="icon-button mini modal-close-btn"
                  type="button"
                  onClick={() => setShowFileManagerModal(false)}
                  title="关闭"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="glass-modal-body file-manager-fullscreen-body">
                <FileManager
                  token={token}
                  instance={selectedInstance}
                  onSakiFileDragChange={onSakiFileDragChange}
                  onSakiInstanceFileDrop={handleSakiInstanceFileDrop}
                  darkMode={darkMode}
                  onClose={() => setShowFileManagerModal(false)}
                />
              </div>
            </div>
          </div>,
          document.body
        ) : null}

        {typeof document !== "undefined" && showSettingsModal && selectedInstance ? createPortal(
          <InstanceSettingsModal
            open={showSettingsModal}
            instance={selectedInstance}
            nodes={nodes}
            token={token}
            onClose={() => setShowSettingsModal(false)}
            onUpdated={(updated) => {
              setInstances((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            }}
            suggestingStartCommand={suggestingStartCommand}
            onSuggestStartCommand={async (workingDirectory, nodeId, onApply) => {
              setSuggestingStartCommand("settings");
              try {
                const res = await api.suggestInstanceStartCommand(token, { workingDirectory, nodeId });
                if (res.startCommand) {
                  onApply(res.startCommand);
                }
              } finally {
                setSuggestingStartCommand(null);
              }
            }}
          />,
          document.body
        ) : null}

        {typeof document !== "undefined" && showProxyModal && selectedInstance ? createPortal(
          <InstanceProxyModal
            open={showProxyModal}
            instance={selectedInstance}
            token={token}
            onClose={() => setShowProxyModal(false)}
            onUpdated={(updated) => {
              setInstances((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            }}
            onRestartInstance={(inst) => runAction(inst, "restart")}
          />,
          document.body
        ) : null}

        <div className="instance-master-layout">
          {/* LEFT: Immersive Terminal Column */}
          <section className="instance-terminal-col">
            <div className="glass-panel instance-terminal-box">
              <div className="instance-terminal-topbar">
                <div className="terminal-topbar-left">
                  <button className="glass-back-button" type="button" onClick={() => setSelectedId(null)} title="返回实例列表" aria-label="返回实例列表">
                    <ChevronLeft size={16} />
                    <span className="back-btn-label">实例列表</span>
                  </button>
                  <InstanceStatusBadge status={selectedInstance.status} />
                </div>
                <div className="terminal-topbar-right">
                  <div className="terminal-topbar-actions">
                    <button
                      className="icon-button mini"
                      title="清空"
                      type="button"
                      onClick={() => terminalActions?.clear()}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      className="icon-button mini"
                      title="重连"
                      type="button"
                      onClick={() => terminalActions?.reconnect()}
                      disabled={!selectedInstance}
                    >
                      <RefreshCw size={15} />
                    </button>
                    <button
                      className="icon-button mini"
                      title="复制终端文本 / 查看日志"
                      type="button"
                      onClick={() => terminalActions?.extractOrCopyLogs?.()}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button mini"
                      title={terminalActions?.isImmersive ? "退出沉浸终端" : "沉浸终端"}
                      type="button"
                      onClick={() => terminalActions?.toggleImmersive()}
                    >
                      {terminalActions?.isImmersive ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>
                    <button
                      type="button"
                      className="icon-button mini new-shell-btn"
                      title="新建终端 (Shell)"
                      onClick={async () => {
                        if (!selectedId || !token) return;
                        try {
                          const wd = selectedInstance?.workingDirectory;
                          const res = await api.createInstanceShell(token, selectedId, wd || undefined);
                          const newKey = `shell-${res.sessionId}`;

                          let updatedTabs = [...terminalTabs];
                          const mainIdx = updatedTabs.findIndex((t) => t.key === "main");
                          if (mainIdx !== -1 && updatedTabs[mainIdx]?.label === "终端") {
                            const mainTab = updatedTabs[mainIdx]!;
                            updatedTabs[mainIdx] = { ...mainTab, key: mainTab.key, label: "shell1" };
                          }

                          const label = getNextShellLabel(updatedTabs);
                          updatedTabs = [...updatedTabs, { key: newKey, label, shellSessionId: res.sessionId }];

                          setTerminalTabs(updatedTabs);
                          setActiveTerminalKey(newKey);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "无法创建新终端");
                        }
                      }}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="mac-dots">
                    <span className="dot red" />
                    <span className="dot yellow" />
                    <span className="dot green" />
                  </div>
                </div>
              </div>

              {terminalTabs.length > 1 && (
                <div className="terminal-tabstrip" role="tablist">
                  {terminalTabs.map((tab) => {
                    const isActive = tab.key === activeTerminalKey;
                    return (
                      <div
                        key={tab.key}
                        role="tab"
                        aria-selected={isActive}
                        className={`terminal-tab ${isActive ? "active" : ""}`}
                        onClick={() => setActiveTerminalKey(tab.key)}
                      >
                        <span className="tab-label">{tab.label}</span>
                        {tab.key !== "main" && (
                          <button
                            type="button"
                            className="tab-close"
                            title="关闭终端"
                            onClick={(e) => {
                              e.stopPropagation();
                              const remaining = terminalTabs.filter((t) => t.key !== tab.key);
                              if (remaining.length === 0) {
                                setTerminalTabs([{ key: "main", label: "终端" }]);
                                setActiveTerminalKey("main");
                                return;
                              }
                              setTerminalTabs(remaining);
                              if (activeTerminalKey === tab.key) {
                                setActiveTerminalKey(remaining[remaining.length - 1]!.key);
                              }
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="terminal-container">
                {terminalTabs.map((tab) => {
                  const isActive = tab.key === activeTerminalKey;
                  return (
                    <div
                      key={tab.key}
                      className={`terminal-wrapper ${isActive ? "active" : ""}`}
                      style={{ display: isActive ? "block" : "none" }}
                    >
                      <WebTerminal
                        token={token}
                        instance={selectedInstance}
                        onStatus={updateInstanceStatus}
                        onAskSaki={onAskSaki}
                        {...(tab.shellSessionId !== undefined ? { shellSessionId: tab.shellSessionId } : {})}
                        isActive={isActive}
                        onMountTerminalActions={setTerminalActions}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Standalone separated Command Row (Integrated History Button inside Input + Circular Right Arrow Button) */}
            <form
              className="terminal-command-row"
              onSubmit={(e) => {
                e.preventDefault();
                const cmd = terminalCmd.trim();
                if (!cmd) return;
                terminalActions?.sendCommand(cmd);
                setTerminalCmd("");
                setTerminalHistoryIndex(null);
                setTerminalHistoryDraft("");
                setTerminalAutocompleteState(null);
                setShowHistoryMenu(false);
              }}
            >
              <div className="terminal-input-wrap">
                <div className="terminal-history-wrap">
                  <button
                    className="terminal-history-btn"
                    type="button"
                    title="历史命令"
                    style={{ background: "transparent", border: "none", boxShadow: "none", outline: "none" }}
                    onClick={() => setShowHistoryMenu((v) => !v)}
                  >
                    <History size={17} />
                  </button>

                  {showHistoryMenu && (
                    <div className="glass-panel terminal-history-popover">
                      <div className="terminal-history-header">
                        <span>历史命令</span>
                        <span className="terminal-history-count">
                          {terminalActions?.getHistory?.().length || 0} 条
                        </span>
                      </div>
                      <div className="terminal-history-list">
                        {(terminalActions?.getHistory?.() || []).length === 0 ? (
                          <div className="terminal-history-empty">暂无历史命令</div>
                        ) : (
                          (terminalActions?.getHistory?.() || []).slice().reverse().map((hCmd, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className="terminal-history-item"
                              title={hCmd}
                              onClick={() => {
                                setTerminalCmd(hCmd);
                                setShowHistoryMenu(false);
                              }}
                            >
                              <span className="history-cmd-text">{hCmd}</span>
                              <span
                                className="history-send-tag"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  terminalActions?.sendCommand(hCmd);
                                  setShowHistoryMenu(false);
                                }}
                                title="直接执行"
                              >
                                执行 ↵
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <input
                  className="terminal-cmd-input"
                  style={{
                    background: "transparent",
                    backgroundColor: "transparent",
                    backdropFilter: "none",
                    WebkitBackdropFilter: "none",
                    border: "none",
                    boxShadow: "none",
                    outline: "none",
                  }}
                  value={terminalCmd}
                  onChange={(e) => {
                    setTerminalCmd(e.target.value);
                    setTerminalHistoryIndex(null);
                    setTerminalAutocompleteState(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                      return;
                    }
                    const history = terminalActions?.getHistory?.() || [];

                    if (e.key === "Tab") {
                      e.preventDefault();
                      const next = nextTerminalAutocompleteValue(terminalCmd, history, terminalAutocompleteState);
                      if (next) {
                        setTerminalCmd(next.value);
                        setTerminalAutocompleteState(next.state);
                      }
                      return;
                    }

                    setTerminalAutocompleteState(null);

                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (history.length === 0) return;
                      if (terminalHistoryIndex === null) {
                        setTerminalHistoryDraft(terminalCmd);
                        const nextIdx = history.length - 1;
                        setTerminalHistoryIndex(nextIdx);
                        setTerminalCmd(history[nextIdx] ?? "");
                      } else if (terminalHistoryIndex > 0) {
                        const nextIdx = terminalHistoryIndex - 1;
                        setTerminalHistoryIndex(nextIdx);
                        setTerminalCmd(history[nextIdx] ?? "");
                      }
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (terminalHistoryIndex === null) return;
                      if (terminalHistoryIndex < history.length - 1) {
                        const nextIdx = terminalHistoryIndex + 1;
                        setTerminalHistoryIndex(nextIdx);
                        setTerminalCmd(history[nextIdx] ?? "");
                      } else {
                        setTerminalHistoryIndex(null);
                        setTerminalCmd(terminalHistoryDraft);
                      }
                    }
                  }}
                  disabled={!canCommandInput}
                  placeholder={
                    !selectedInstance
                      ? "请选择实例"
                      : canCommandInput
                      ? `输入命令按回车发送到 ${activeTab?.label || "终端"}，按 Tab 键自动补全，上下键切换历史`
                      : "实例未运行"
                  }
                />
              </div>

              <button
                className="terminal-send-btn"
                type="submit"
                title="发送命令 (Enter)"
                disabled={!canCommandInput || !terminalCmd.trim()}
              >
                <ArrowRight size={18} strokeWidth={2.4} />
              </button>
            </form>
          </section>

          {/* RIGHT: Master Sidebar Cards Column */}
          <aside className="instance-sidebar-col">
            <IncidentBanner
              token={token}
              instanceId={selectedInstance.id}
              onLogout={onLogout}
              variant="panel"
              onAskSaki={
                onAskSaki
                  ? () =>
                      onAskSaki({
                        message: "",
                        contextTitle: `值班：${selectedInstance.name}`,
                        mode: "agent"
                      })
                  : undefined
              }
            />
            {/* Card 1: 实例信息 */}
            <div className="glass-panel instance-side-card instance-summary-card">
              <div className="instance-summary-header">
                <div className="summary-title-row">
                  <h3 title={selectedInstance.name}>{selectedInstance.name}</h3>
                </div>
                <div className="summary-status-row">
                  <InstanceStatusBadge status={selectedInstance.status} />
                  <span className="instance-program-badge">通用控制台程序</span>
                </div>
              </div>
              <div className="instance-summary-table">
                <div className="summary-row">
                  <span className="summary-label">节点</span>
                  <span className="summary-value" title={selectedNodeName}>{selectedNodeName}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">工作目录</span>
                  <span className="summary-value" title={selectedInstance.workingDirectory || "-"}>
                    {selectedInstance.workingDirectory || "-"}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">重启策略</span>
                  <span className="summary-value">{restartPolicyLabel(selectedInstance.restartPolicy)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">开机自启</span>
                  <span className="summary-value">{selectedInstance.autoStart ? "已开启" : "关闭"}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">创建者</span>
                  <span className="summary-value">{instanceCreatorLabel(selectedInstance)}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">更新时间</span>
                  <span className="summary-value">{formatDate(selectedInstance.updatedAt)}</span>
                </div>
                {selectedInstance.lastExitCode !== null && selectedInstance.lastExitCode !== undefined ? (
                  <div className="summary-row">
                    <span className="summary-label">退出码</span>
                    <span className="summary-value">{selectedInstance.lastExitCode}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Card 2: 快捷操作 */}
            <div className="glass-panel instance-side-card instance-actions-panel-card">
              <div className="quick-actions-square-grid">
                <button
                  className={`quick-action-square-btn ${running ? "disabled" : "action-start"}`}
                  type="button"
                  disabled={busy || running}
                  onClick={() => void runAction(selectedInstance, "start")}
                >
                  <div className="action-icon-circle start">
                    <Play size={18} />
                  </div>
                  <span className="action-text">启动</span>
                </button>

                <button
                  className="quick-action-square-btn action-restart"
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction(selectedInstance, "restart")}
                >
                  <div className="action-icon-circle restart">
                    <RotateCw size={18} />
                  </div>
                  <span className="action-text">重启</span>
                </button>

                <button
                  className={`quick-action-square-btn ${!running ? "disabled" : "action-stop"}`}
                  type="button"
                  disabled={busy || !running}
                  onClick={() => void runAction(selectedInstance, "stop")}
                >
                  <div className="action-icon-circle stop">
                    <Square size={18} />
                  </div>
                  <span className="action-text">停止</span>
                </button>

                <button
                  className="quick-action-square-btn action-kill"
                  type="button"
                  disabled={busy || !running}
                  onClick={() => void runAction(selectedInstance, "kill")}
                >
                  <div className="action-icon-circle kill">
                    <XOctagon size={18} />
                  </div>
                  <span className="action-text">强杀</span>
                </button>

                <button
                  className="quick-action-square-btn action-files"
                  type="button"
                  onClick={() => setShowFileManagerModal(true)}
                >
                  <div className="action-icon-circle files">
                    <FolderOpen size={18} />
                  </div>
                  <span className="action-text">文件管理</span>
                </button>

                <button
                  className="quick-action-square-btn action-settings"
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                >
                  <div className="action-icon-circle settings">
                    <Settings size={18} />
                  </div>
                  <span className="action-text">实例设置</span>
                </button>

                <button
                  className="quick-action-square-btn action-tasks"
                  type="button"
                  onClick={() => setShowTaskModal(true)}
                >
                  <div className="action-icon-circle tasks">
                    <Clock size={18} />
                  </div>
                  <span className="action-text">计划任务</span>
                </button>

                <button
                  className={`quick-action-square-btn action-proxy ${selectedInstance.proxyConfig?.enabled ? "proxy-active" : ""}`}
                  type="button"
                  title={selectedInstance.proxyConfig?.enabled ? `网络代理已生效: ${selectedInstance.proxyConfig.type}://${selectedInstance.proxyConfig.server}:${selectedInstance.proxyConfig.port}` : "网络代理设置 (支持 Clash 等主流代理软件)"}
                  onClick={() => setShowProxyModal(true)}
                >
                  <div className="action-icon-circle proxy">
                    <Globe size={18} />
                    {selectedInstance.proxyConfig?.enabled ? (
                      <span className="proxy-active-badge-dot" aria-label="代理已生效" />
                    ) : null}
                  </div>
                  <span className="action-text">网络代理</span>
                </button>
              </div>
            </div>

            {/* Card 3: 实时性能与进程探针 */}
            <InstanceProcessProbeCard
              instance={selectedInstance}
              running={running}
              nodeName={selectedNodeName}
            />
          </aside>
        </div>
      </>
    );
  }

  return (
    <>
      <PageErrorToast
        error={error}
        onDismiss={() => setError("")}
        action={
          onAskSaki ? (
            <button
              className="small-button"
              type="button"
              onClick={() =>
                onAskSaki({
                  message: `请解释并修复实例管理面板报错：\n${error}`,
                  panelError: error,
                  mode: "agent"
                })
              }
            >
              <Sparkles size={14} />
              问 Saki
            </button>
          ) : null
        }
      />
      {typeof document !== "undefined" && createDialog ? createPortal(createDialog, document.body) : null}
      {typeof document !== "undefined" && databaseVisualizerDialog ? createPortal(databaseVisualizerDialog, document.body) : null}

      <section className="instance-directory">
        <div className="instance-command-center">
          <div className="instance-command-main">
            <div className="instance-command-icon">
              <TerminalIcon size={22} />
            </div>
            <div className="instance-command-count">
              <span>实例与数据库</span>
              <strong>{instances.length + databases.length}</strong>
            </div>
          </div>

          <div className="instance-command-actions">
            <div className="instance-view-switcher" role="group" aria-label="实例视图">
              {instanceViewOptions.map((option) => (
                <button
                  className={`instance-view-button icon-only ${directoryView === option.view ? "active" : ""}`}
                  type="button"
                  title={option.title}
                  aria-label={option.label}
                  aria-pressed={directoryView === option.view}
                  onClick={() => setDirectoryView(option.view)}
                  key={option.view}
                >
                  {option.icon}
                </button>
              ))}
            </div>
            <button className="icon-button instance-action-btn" title="模板管理" type="button" onClick={onOpenTemplates}>
              <LayoutTemplate size={17} />
            </button>
            <button className="primary-button create-instance-button icon-only" title="新建实例与数据库" type="button" onClick={() => setShowCreateForm(true)}>
              <Plus size={18} />
            </button>
          </div>
        </div>

        {directoryView === "cards" ? (
          <div className="instance-card-grid">
            {sortedInstances.map((instance) => {
              const instanceNode = nodes.find((node) => node.id === instance.nodeId) ?? null;
              const meta = instanceStatusMeta(instance.status);
              const nodeName = instanceNode?.name ?? instance.nodeName ?? instance.nodeId;
              const nodeDetail = nodeEndpointLabel(instanceNode) || (instance.nodeName ?? instance.nodeId);
              return (
                <div className={`instance-card ${meta.className}`} key={instance.id}>
                  <span className="instance-card-signal" aria-hidden="true" />
                  <div className="instance-card-header">
                    <div className="instance-card-title">
                      <div className="instance-card-icon">
                        <InstanceStatusIcon status={instance.status} size={20} />
                      </div>
                      <div className="instance-title-copy">
                        <button
                          className="link-button instance-name"
                          type="button"
                          onClick={() => setSelectedId(instance.id)}
                        >
                          {instance.name}
                        </button>
                        <span>{instanceTypeLabel(instance.type)}</span>
                      </div>
                    </div>
                    <InstanceStatusBadge status={instance.status} compact />
                  </div>

                  <button
                    className="instance-card-command"
                    type="button"
                    title={instance.startCommand}
                    onClick={() => setSelectedId(instance.id)}
                  >
                    <TerminalIcon size={14} />
                    <span>{compactCommand(instance.startCommand)}</span>
                  </button>

                  <div className="instance-glance">
                    <span className="instance-glance-item" data-tooltip={`节点: ${nodeName} (${nodeDetail})`}>
                      <Server size={13} />
                      <span className="glance-label">{nodeName}</span>
                    </span>
                    <span className="instance-glance-item" data-tooltip={`工作目录: ${compactPathLabel(instance.workingDirectory) || "未设置工作目录"}`}>
                      <HardDrive size={13} />
                      <span className="glance-label">{compactPathLabel(instance.workingDirectory) || "未设置工作目录"}</span>
                    </span>
                    <span className="instance-glance-item" data-tooltip={`更新时间: ${formatDate(instance.updatedAt)}`}>
                      <Clock size={13} />
                      <span className="glance-label">{formatDate(instance.updatedAt)}</span>
                    </span>
                    {instance.lastExitCode !== null && instance.lastExitCode !== undefined ? (
                      <span className="instance-glance-item error" data-tooltip={`退出码: ${instance.lastExitCode}`}>
                        <Bug size={13} />
                        <span className="glance-label">退出码 {instance.lastExitCode}</span>
                      </span>
                    ) : null}
                    {instance.autoStart ? (
                      <span className="instance-glance-item" data-tooltip="开机自启">
                        <Play size={13} />
                        <span className="glance-label">自启</span>
                      </span>
                    ) : null}
                    {instance.restartPolicy !== "never" ? (
                      <span className="instance-glance-item" data-tooltip={`重启策略: ${restartPolicyLabel(instance.restartPolicy)}`}>
                        <RefreshCw size={13} />
                        <span className="glance-label">{restartPolicyLabel(instance.restartPolicy)}</span>
                      </span>
                    ) : null}
                  </div>

                  <div className="instance-card-footer">
                    <button
                      className="instance-card-console-btn"
                      title="进入控制台"
                      type="button"
                      onClick={() => setSelectedId(instance.id)}
                    >
                      <TerminalIcon size={14} />
                      <span>控制台</span>
                    </button>
                    {renderInstanceRowActions(instance)}
                  </div>
                </div>
              );
            })}

            {databases.map((db) => {
              const dbNode = nodes.find((node) => node.id === db.nodeId) ?? null;
              const nodeName = dbNode?.name ?? db.nodeName ?? db.nodeId;
              const endpointLabel = db.config.path
                ? compactPathLabel(db.config.path)
                : `${db.config.host || "127.0.0.1"}:${db.config.port || 3306}`;

              return (
                <div className="instance-card database-instance-card" key={`db-${db.id}`}>
                  <span className="instance-card-signal db-card-signal" aria-hidden="true" />
                  <div className="instance-card-header">
                    <div className="instance-card-title">
                      <div className={`instance-card-icon db-icon-badge ${db.engine}`}>
                        <Database size={18} />
                      </div>
                      <div className="instance-title-copy">
                        <button
                          className="link-button instance-name"
                          type="button"
                          onClick={() => setSelectedDatabaseId(db.id)}
                        >
                          {db.name}
                        </button>
                        <span className="db-engine-chip">{db.engine.toUpperCase()} 数据库可视化</span>
                      </div>
                    </div>
                    <span className="status-pill blue db-card-status">
                      <CheckCircle2 size={12} /> 可视化就绪
                    </span>
                  </div>

                  <button
                    className="instance-card-command db-card-endpoint"
                    type="button"
                    title={db.config.path || `${db.config.host || "127.0.0.1"}:${db.config.port || ""}`}
                    onClick={() => setSelectedDatabaseId(db.id)}
                  >
                    <HardDrive size={14} />
                    <span>{endpointLabel}</span>
                  </button>

                  <div className="instance-glance">
                    <span className="instance-glance-item" data-tooltip={`节点: ${nodeName}`}>
                      <Server size={13} />
                      <span className="glance-label">{nodeName}</span>
                    </span>
                    {db.description ? (
                      <span className="instance-glance-item" data-tooltip={`描述: ${db.description}`}>
                        <Info size={13} />
                        <span className="glance-label">{db.description}</span>
                      </span>
                    ) : null}
                    <span className="instance-glance-item" data-tooltip={`更新时间: ${formatDate(db.updatedAt)}`}>
                      <Clock size={13} />
                      <span className="glance-label">{formatDate(db.updatedAt)}</span>
                    </span>
                  </div>

                  <div className="instance-card-footer">
                    <button
                      className="instance-card-console-btn db-visualize-btn"
                      title="进入数据库可视化"
                      type="button"
                      onClick={() => setSelectedDatabaseId(db.id)}
                    >
                      <Database size={14} />
                      <span>进入可视化</span>
                    </button>
                    <div className="row-actions instance-row-actions">
                      <button
                        className="icon-button mini danger-action"
                        title="删除数据库可视化实例"
                        type="button"
                        onClick={async () => {
                          if (window.confirm(`确定要移除数据库可视化实例「${db.name}」吗？`)) {
                            await api.deleteDatabase(token, db.id);
                            await refresh();
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {instances.length === 0 && databases.length === 0 ? (
              <div style={{ gridColumn: "1 / -1", padding: "20px 0" }}>
                <SakiEmptyState
                  illustration="instances"
                  title="暂无实例或数据库"
                  description="准备好搭建你的第一个服务了吗？你可以手动创建实例，或前往应用模板中心一键快速部署！"
                  action={{
                    label: "前往应用模板中心",
                    onClick: onOpenTemplates,
                    icon: <Sparkles size={14} />
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : directoryView === "list" ? (
          <div className="instance-list-view" role="table" aria-label="实例列表">
            <div className="instance-list-header" role="row">
              <span>实例</span>
              <span>状态</span>
              <span>节点</span>
              <span>工作目录 / 路径</span>
              <span>类型</span>
              <span>更新</span>
              <span>操作</span>
            </div>
            {sortedInstances.map((instance) => {
              const instanceNode = nodes.find((node) => node.id === instance.nodeId) ?? null;
              const meta = instanceStatusMeta(instance.status);
              const nodeName = instanceNode?.name ?? instance.nodeName ?? instance.nodeId;
              const nodeDetail = nodeEndpointLabel(instanceNode) || (instance.nodeName ?? instance.nodeId);
              return (
                <div className={`instance-list-row ${meta.className}`} role="row" key={instance.id}>
                  <div className="instance-list-primary" role="cell">
                    <span className="instance-list-icon">
                      <InstanceStatusIcon status={instance.status} size={18} />
                    </span>
                    <div className="instance-list-copy">
                      <button
                        className="link-button instance-list-name"
                        type="button"
                        onClick={() => setSelectedId(instance.id)}
                      >
                        {instance.name}
                      </button>
                      <span title={instance.startCommand}>{compactCommand(instance.startCommand, 86)}</span>
                    </div>
                  </div>
                  <div className="instance-list-status" role="cell">
                    <InstanceStatusBadge status={instance.status} compact />
                  </div>
                  <div className="instance-list-meta" role="cell" title={nodeDetail}>
                    <Server size={14} />
                    <span>{nodeName}</span>
                  </div>
                  <div
                    className="instance-list-meta"
                    role="cell"
                    title={instance.workingDirectory || "未设置工作目录"}
                  >
                    <HardDrive size={14} />
                    <span>{compactPathLabel(instance.workingDirectory)}</span>
                  </div>
                  <div
                    className="instance-list-meta instance-owner-meta"
                    role="cell"
                    title={`创建者 ${instanceCreatorLabel(instance)} · 负责人 ${instanceAssigneeLabel(instance)}`}
                  >
                    <UserCheck size={14} />
                    <span>{instanceAssigneeLabel(instance)}</span>
                  </div>
                  <div className="instance-list-meta" role="cell" title="更新">
                    <Clock size={14} />
                    <span>{formatDate(instance.updatedAt)}</span>
                  </div>
                  <div className="instance-list-actions" role="cell">
                    <button
                      className="icon-button mini"
                      title="控制台"
                      type="button"
                      onClick={() => setSelectedId(instance.id)}
                    >
                      <TerminalIcon size={15} />
                    </button>
                    {renderInstanceRowActions(instance)}
                  </div>
                </div>
              );
            })}

            {databases.map((db) => {
              const dbNode = nodes.find((node) => node.id === db.nodeId) ?? null;
              const nodeName = dbNode?.name ?? db.nodeName ?? db.nodeId;
              const endpointLabel = db.config.path
                ? compactPathLabel(db.config.path)
                : `${db.config.host || "127.0.0.1"}:${db.config.port || 3306}`;

              return (
                <div className="instance-list-row database-list-row" role="row" key={`db-${db.id}`}>
                  <div className="instance-list-primary" role="cell">
                    <span className="instance-list-icon db-icon-badge">
                      <Database size={17} />
                    </span>
                    <div className="instance-list-copy">
                      <button
                        className="link-button instance-list-name"
                        type="button"
                        onClick={() => setSelectedDatabaseId(db.id)}
                      >
                        {db.name}
                      </button>
                      <span title={endpointLabel}>
                        [{db.engine.toUpperCase()}] {endpointLabel}
                      </span>
                    </div>
                  </div>
                  <div className="instance-list-status" role="cell">
                    <span className="status-pill blue compact">就绪</span>
                  </div>
                  <div className="instance-list-meta" role="cell" title={nodeName}>
                    <Server size={14} />
                    <span>{nodeName}</span>
                  </div>
                  <div className="instance-list-meta" role="cell" title={endpointLabel}>
                    <HardDrive size={14} />
                    <span>{endpointLabel}</span>
                  </div>
                  <div className="instance-list-meta instance-owner-meta" role="cell">
                    <Database size={13} />
                    <span>数据库</span>
                  </div>
                  <div className="instance-list-meta" role="cell" title="更新">
                    <Clock size={14} />
                    <span>{formatDate(db.updatedAt)}</span>
                  </div>
                  <div className="instance-list-actions" role="cell">
                    <button
                      className="icon-button mini"
                      title="进入可视化"
                      type="button"
                      onClick={() => setSelectedDatabaseId(db.id)}
                    >
                      <Database size={15} />
                    </button>
                    <div className="row-actions instance-row-actions">
                      <button
                        className="icon-button mini danger-action"
                        title="删除"
                        type="button"
                        onClick={async () => {
                          if (window.confirm(`确定要移除数据库可视化实例「${db.name}」吗？`)) {
                            await api.deleteDatabase(token, db.id);
                            await refresh();
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {instances.length === 0 && databases.length === 0 ? (
              <SakiEmptyState
                illustration="instances"
                title="暂无实例或数据库"
                description="开启你的第一个服务器实例吧"
                action={{
                  label: "前往应用模板中心",
                  onClick: onOpenTemplates,
                  icon: <Sparkles size={14} />
                }}
              />
            ) : null}
          </div>
        ) : (
          <div className="instance-graph-view">
            <div className="instance-graph-panel">
              <svg className="instance-graph-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {graphLayout.edges.map((edge) => (
                  <line
                    className={`instance-graph-link ${edge.className}`}
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    vectorEffect="non-scaling-stroke"
                    key={edge.id}
                  />
                ))}
              </svg>
              {graphLayout.hubs.map((hub) => (
                <div
                  className="instance-graph-hub"
                  style={{ left: `${hub.x}%`, top: `${hub.y}%` }}
                  title={hub.detail}
                  key={hub.id}
                >
                  <Server size={17} />
                  <span>{hub.label}</span>
                  <strong>{hub.count}</strong>
                </div>
              ))}
              {graphLayout.instances.map((point) => (
                <button
                  className={`instance-graph-node ${point.meta.className}`}
                  style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  title={`${point.instance.name} · ${point.nodeDetail}`}
                  type="button"
                  onClick={() => setSelectedId(point.instance.id)}
                  key={point.instance.id}
                >
                  <span className="instance-graph-pulse" aria-hidden="true" />
                  <span className="instance-graph-icon">
                    <InstanceStatusIcon status={point.instance.status} size={17} />
                  </span>
                  <span className="instance-graph-label">{point.instance.name}</span>
                  <small>
                    {instanceTypeLabel(point.instance.type)} · {point.meta.shortLabel}
                  </small>
                </button>
              ))}
              {instances.length === 0 ? (
                <SakiEmptyState
                  illustration="instances"
                  title="暂无实例拓扑"
                  description="创建实例后，系统将自动生成节点与服务拓扑图谱"
                />
              ) : null}
            </div>
            <aside className="instance-graph-sidebar" aria-label="图谱概览">
              <div className="instance-graph-stats">
                <span>
                  <Server size={14} />
                  节点
                  <strong>{graphLayout.hubs.length}</strong>
                </span>
                <span>
                  <TerminalIcon size={14} />
                  实例
                  <strong>{instances.length}</strong>
                </span>
              </div>
              <div className="instance-graph-node-list">
                {graphLayout.hubs.map((hub) => (
                  <span title={hub.detail} key={hub.id}>
                    <Server size={13} />
                    <span>{hub.label}</span>
                    <strong>{hub.count}</strong>
                  </span>
                ))}
              </div>
            </aside>
          </div>
        )}
      </section>
    </>
  );
}

