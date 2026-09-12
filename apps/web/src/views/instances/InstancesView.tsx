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
  Minus,
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
  RemoteNodeUserSummary,
  RestartPolicy,
  WatchPolicyMode
} from "@webops/shared";
import type {
  InstanceDirectoryView,
  SakiInstanceFileDragPayload,
  SakiInstanceFileDropRequest,
  SakiOpenFileRequest,
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
import { DatabaseVisualizer, AddDatabaseModal, EditDatabaseModal } from "../../DatabaseVisualizer.js";
import { IncidentBanner, useIncidents } from "../../IncidentInbox.js";

export function InstancesView({
  token,
  onLogout,
  refreshTick,
  onOpenTemplates,
  onInstanceFocus,
  onInstancesLoaded,
  onAskSaki,
  onSakiFileDragChange,
  onSakiInstanceFileDrop,
  darkMode,
  initialInstanceId,
  onSelectInstance,
  openFileRequest = null,
  onOpenFileRequestConsumed,
  onFileManagerOpenChange
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  onOpenTemplates: () => void;
  onInstanceFocus: (instance: ManagedInstance | null) => void;
  onInstancesLoaded?: ((instances: ManagedInstance[]) => void) | undefined;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  onSakiFileDragChange: (active: boolean) => void;
  onSakiInstanceFileDrop?: ((payload: SakiInstanceFileDragPayload) => void) | undefined;
  darkMode: boolean;
  initialInstanceId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  openFileRequest?: SakiOpenFileRequest | null;
  onOpenFileRequestConsumed?: () => void;
  onFileManagerOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [watchEnabledMap, setWatchEnabledMap] = useState<Record<string, boolean>>({});
  const { active: watchActiveIncidents } = useIncidents(token, onLogout);
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

  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncNodeId, setSyncNodeId] = useState("");
  const [syncUserKey, setSyncUserKey] = useState("");
  const [syncRemoteUrl, setSyncRemoteUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [syncSuccess, setSyncSuccess] = useState("");
  const [nodeRemoteUsers, setNodeRemoteUsers] = useState<RemoteNodeUserSummary[]>([]);
  const [loadingRemoteUsers, setLoadingRemoteUsers] = useState(false);
  const [errorAvailableUsers, setErrorAvailableUsers] = useState<RemoteNodeUserSummary[]>([]);

  const loadNodeRemoteUsers = useCallback(async (nId: string) => {
    if (!nId) {
      setNodeRemoteUsers([]);
      return;
    }
    setLoadingRemoteUsers(true);
    try {
      const res = await api.nodeRemoteUsers(token, nId);
      if (res.ok && Array.isArray(res.users)) {
        setNodeRemoteUsers(res.users);
      } else {
        setNodeRemoteUsers([]);
      }
    } catch {
      setNodeRemoteUsers([]);
    } finally {
      setLoadingRemoteUsers(false);
    }
  }, [token]);

  const openSyncModal = () => {
    setShowSyncModal(true);
    setSyncError("");
    setSyncSuccess("");
    setErrorAvailableUsers([]);
    let targetNodeId = syncNodeId;
    if (!targetNodeId && nodes.length > 0) {
      const preferred = nodes.find((n) => n.status === "ONLINE") || nodes[0];
      if (preferred) {
        targetNodeId = preferred.id;
        setSyncNodeId(preferred.id);
        setSyncRemoteUrl(`https://${preferred.host}:5479`);
      }
    }
    if (targetNodeId) {
      void loadNodeRemoteUsers(targetNodeId);
    }
  };

  async function handleSyncForUser(targetUser: RemoteNodeUserSummary) {
    if (!syncNodeId) return;
    setSyncing(true);
    setSyncError("");
    setSyncSuccess("");
    try {
      const res = await api.syncInstancesByUserKey(token, {
        nodeId: syncNodeId,
        targetUserId: targetUser.id
      });
      if (res.ok) {
        setSyncSuccess(res.message || `成功导入 ${res.syncedCount} 个实例！`);
        await refresh();
        setTimeout(() => {
          setShowSyncModal(false);
          setSyncSuccess("");
          setSyncUserKey("");
          setErrorAvailableUsers([]);
        }, 1200);
      } else {
        setSyncError(res.message || res.error || "导入失败");
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "导入失败，请检查网络或节点状态");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncInstances(e: React.FormEvent) {
    e.preventDefault();
    if (!syncNodeId) {
      setSyncError("请先选择目标节点");
      return;
    }
    if (!syncUserKey.trim()) {
      setSyncError("请输入用户专属访问密钥 (saki_usr_...)，或直接点击上方用户一键导入");
      return;
    }
    if (!syncUserKey.trim().startsWith("saki_usr_")) {
      setSyncError("专属访问密钥格式不正确，必须以 saki_usr_ 开头");
      return;
    }
    setSyncing(true);
    setSyncError("");
    setSyncSuccess("");
    setErrorAvailableUsers([]);
    try {
      const res = await api.syncInstancesByUserKey(token, {
        nodeId: syncNodeId,
        userKey: syncUserKey.trim(),
        remotePanelUrl: syncRemoteUrl.trim() || undefined
      });
      if (res.ok) {
        setSyncSuccess(res.message || `成功同步 ${res.syncedCount} 个实例！`);
        await refresh();
        setTimeout(() => {
          setShowSyncModal(false);
          setSyncSuccess("");
          setSyncUserKey("");
          setErrorAvailableUsers([]);
        }, 1200);
      } else {
        setSyncError(res.message || res.error || "同步失败");
        if (Array.isArray(res.availableUsers) && res.availableUsers.length > 0) {
          setErrorAvailableUsers(res.availableUsers);
        }
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "同步失败，请检查网络或远程面板状态");
    } finally {
      setSyncing(false);
    }
  }

  const [createModalType, setCreateModalType] = useState<"instance" | "database">("instance");
  const [databases, setDatabases] = useState<DatabaseVisualizerInstance[]>([]);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [editingDatabase, setEditingDatabase] = useState<DatabaseVisualizerInstance | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showFileManagerModal, setShowFileManagerModal] = useState(false);
  useEffect(() => {
    onFileManagerOpenChange?.(showFileManagerModal);
  }, [showFileManagerModal, onFileManagerOpenChange]);
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
    showDatabaseVisualizer ||
    editingDatabase
  );

  useEffect(() => {
    if (!openFileRequest?.path) return;
    if (openFileRequest.instanceId && selectedId && openFileRequest.instanceId !== selectedId) return;
    setShowFileManagerModal(true);
  }, [openFileRequest?.nonce, openFileRequest?.path, openFileRequest?.instanceId, selectedId]);

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
  const [graphLayoutMode, setGraphLayoutMode] = useState<"orbit" | "cluster">("orbit");
  const [graphNodeMode, setGraphNodeMode] = useState<"card" | "compact">("card");
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphPan, setGraphPan] = useState({ x: 0, y: 0 });
  const [graphHoveredId, setGraphHoveredId] = useState<string | null>(null);
  const [graphStatusFilter, setGraphStatusFilter] = useState<string | null>(null);
  const [isGraphDragging, setIsGraphDragging] = useState(false);
  const isGraphDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const graphPanelRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ dist: number; panX: number; panY: number; x: number; y: number } | null>(null);
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

  const handleSelectTerminalTab = useCallback(
    (key: string) => {
      setActiveTerminalKey(key);
      if (selectedId && typeof window !== "undefined") {
        window.localStorage.setItem(`webops.instanceActiveTab.${selectedId}`, key);
      }
    },
    [selectedId]
  );

  const syncInstanceShells = useCallback(
    async (targetId: string) => {
      if (!token) return;
      try {
        const res = await api.listInstanceShells(token, targetId);
        const serverShells = res.shells ?? res.sessions.map((sid) => ({ id: sid, label: undefined, createdAt: 0 }));

        if (serverShells.length > 0) {
          const tabs: Array<{ key: string; label: string; shellSessionId?: string }> = [
            { key: "main", label: "shell1" }
          ];
          serverShells.forEach((shell, idx) => {
            tabs.push({
              key: `shell-${shell.id}`,
              label: shell.label || `shell${idx + 2}`,
              shellSessionId: shell.id
            });
          });
          setTerminalTabs(tabs);
          const savedKey =
            typeof window !== "undefined" ? window.localStorage.getItem(`webops.instanceActiveTab.${targetId}`) : null;
          if (savedKey && tabs.some((t) => t.key === savedKey)) {
            setActiveTerminalKey(savedKey);
          } else {
            setActiveTerminalKey(tabs[tabs.length - 1]!.key);
          }
        } else {
          setTerminalTabs([{ key: "main", label: "终端" }]);
          setActiveTerminalKey("main");
        }
      } catch (e) {
        console.warn("Failed to sync instance shells", e);
        setTerminalTabs([{ key: "main", label: "终端" }]);
        setActiveTerminalKey("main");
      }
    },
    [token]
  );

  // Sync terminal tabs with backend shells when switching instances or loading
  useEffect(() => {
    if (selectedId) {
      void syncInstanceShells(selectedId);
    } else {
      setTerminalTabs([{ key: "main", label: "终端" }]);
      setActiveTerminalKey("main");
    }
  }, [selectedId, syncInstanceShells]);

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
    const isCompact = graphNodeMode === "compact";
    const isCluster = graphLayoutMode === "cluster";
    const hubCount = Math.max(groupEntries.length, 1);

    // Calculate clearance radius needed for each hub based on its instance count
    const hubRadii = groupEntries.map((group) => {
      const n = group.instances.length;
      if (isCluster) {
        const cols = Math.min(Math.ceil(Math.sqrt(Math.max(n, 1) * 1.6)), 7);
        const rows = Math.ceil(Math.max(n, 1) / cols);
        const w = cols * (isCompact ? 125 : 155);
        const h = rows * (isCompact ? 50 : 80) + 120;
        return { group, width: w, height: h, radius: Math.max(w, h) / 2 };
      }
      // Orbit mode
      const ring0Cap = isCompact ? 8 : 6;
      const ring1Cap = isCompact ? 15 : 11;
      const ring2Cap = isCompact ? 22 : 16;
      let maxRx = isCompact ? 150 : 185;
      let maxRy = isCompact ? 105 : 130;
      if (n > ring0Cap) {
        maxRx += isCompact ? 115 : 135;
        maxRy += isCompact ? 80 : 95;
      }
      if (n > ring0Cap + ring1Cap) {
        maxRx += isCompact ? 115 : 135;
        maxRy += isCompact ? 80 : 95;
      }
      if (n > ring0Cap + ring1Cap + ring2Cap) {
        const extraRings = Math.ceil((n - ring0Cap - ring1Cap - ring2Cap) / (isCompact ? 26 : 20));
        maxRx += extraRings * (isCompact ? 115 : 135);
        maxRy += extraRings * (isCompact ? 80 : 95);
      }
      return { group, maxRx, maxRy, radius: Math.max(maxRx, maxRy) };
    });

    const maxHubRadius = Math.max(...hubRadii.map((h) => h.radius), 180);
    const canvasWidth = hubCount === 1 
      ? Math.max(maxHubRadius * 2 + 380, 1100) 
      : Math.max((maxHubRadius * 2 + 280) * Math.sqrt(hubCount) * 1.15, 1400);
    const canvasHeight = hubCount === 1 
      ? Math.max(maxHubRadius * 2 + 320, 850) 
      : Math.max((maxHubRadius * 2 + 240) * Math.sqrt(hubCount) * 0.95, 1000);

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    const hubs = groupEntries.map((group, index) => {
      if (hubCount === 1) {
        return {
          id: group.id,
          label: group.label,
          detail: group.detail,
          count: group.instances.length,
          x: centerX,
          y: isCluster ? centerY - 120 : centerY
        };
      }
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / hubCount;
      const hubDist = maxHubRadius + 180;
      return {
        id: group.id,
        label: group.label,
        detail: group.detail,
        count: group.instances.length,
        x: centerX + Math.cos(angle) * hubDist,
        y: centerY + Math.sin(angle) * (hubDist * 0.78)
      };
    });

    const hubsById = new Map(hubs.map((h) => [h.id, h]));
    const instancePoints: Array<{
      instance: ManagedInstance;
      nodeLabel: string;
      nodeDetail: string;
      meta: ReturnType<typeof instanceStatusMeta>;
      x: number;
      y: number;
      hubX: number;
      hubY: number;
      hubId: string;
    }> = [];

    groupEntries.forEach((group, groupIndex) => {
      const hub = hubs[groupIndex];
      if (!hub) return;
      const count = group.instances.length;
      if (count === 0) return;

      if (isCluster) {
        const cols = Math.min(Math.ceil(Math.sqrt(count * 1.6)), 7);
        const colSpacing = isCompact ? 125 : 155;
        const rowSpacing = isCompact ? 48 : 80;
        const startX = hub.x - ((cols - 1) * colSpacing) / 2;
        const startY = hub.y + 70;

        group.instances.forEach((instance, index) => {
          const col = index % cols;
          const row = Math.floor(index / cols);
          instancePoints.push({
            instance,
            nodeLabel: group.label,
            nodeDetail: group.detail,
            meta: instanceStatusMeta(instance.status),
            x: startX + col * colSpacing,
            y: startY + row * rowSpacing,
            hubX: hub.x,
            hubY: hub.y,
            hubId: hub.id
          });
        });
      } else {
        // Orbit mode: concentric staggered rings with increasing capacities
        const ring0Cap = isCompact ? 8 : 6;
        const ring1Cap = isCompact ? 15 : 11;
        const ring2Cap = isCompact ? 22 : 16;
        const ringCaps = [ring0Cap, ring1Cap, ring2Cap, 26, 32, 40];

        let assigned = 0;
        let ringIdx = 0;
        while (assigned < count) {
          const cap = ringCaps[ringIdx] || (ringIdx * 8 + 10);
          const inThisRing = Math.min(cap, count - assigned);
          const rx = (isCompact ? 150 : 185) + ringIdx * (isCompact ? 115 : 135);
          const ry = (isCompact ? 105 : 130) + ringIdx * (isCompact ? 80 : 95);
          // Honeycomb angular offset for alternating rings
          const stagger = (ringIdx % 2 === 1) ? (Math.PI / inThisRing) : 0;

          for (let j = 0; j < inThisRing; j++) {
            const instance = group.instances[assigned + j];
            if (!instance) continue;
            const angle = -Math.PI / 2 + stagger + (2 * Math.PI * j) / inThisRing;
            instancePoints.push({
              instance,
              nodeLabel: group.label,
              nodeDetail: group.detail,
              meta: instanceStatusMeta(instance.status),
              x: hub.x + Math.cos(angle) * rx,
              y: hub.y + Math.sin(angle) * ry,
              hubX: hub.x,
              hubY: hub.y,
              hubId: hub.id
            });
          }
          assigned += inThisRing;
          ringIdx++;
        }
      }
    });

    // Physics collision relaxation pass to guarantee zero overlap
    const nodeW = isCompact ? 118 : 148;
    const nodeH = isCompact ? 44 : 76;

    for (let iter = 0; iter < 28; iter++) {
      for (let i = 0; i < instancePoints.length; i++) {
        const p1 = instancePoints[i];
        if (!p1) continue;
        for (let j = i + 1; j < instancePoints.length; j++) {
          const p2 = instancePoints[j];
          if (!p2) continue;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const nx = dx / nodeW;
          const ny = dy / nodeH;
          const dSq = nx * nx + ny * ny;
          if (dSq < 1 && dSq > 0.0001) {
            const d = Math.sqrt(dSq);
            const overlap = (1 - d) * 0.52;
            const pushX = (nx / d) * overlap * nodeW;
            const pushY = (ny / d) * overlap * nodeH;
            p1.x -= pushX;
            p1.y -= pushY;
            p2.x += pushX;
            p2.y += pushY;
          }
        }

        const hub = hubsById.get(p1.hubId);
        if (hub) {
          const dx = p1.x - hub.x;
          const dy = p1.y - hub.y;
          const hw = isCompact ? 120 : 150;
          const hh = isCompact ? 50 : 65;
          const nx = dx / hw;
          const ny = dy / hh;
          const dSq = nx * nx + ny * ny;
          if (dSq < 1 && dSq > 0.0001) {
            const d = Math.sqrt(dSq);
            const push = (1 - d) * 0.75;
            p1.x += (nx / d) * push * hw;
            p1.y += (ny / d) * push * hh;
          }
        }
      }
    }

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
      })),
      width: canvasWidth,
      height: canvasHeight
    };
  }, [nodes, sortedInstances, graphLayoutMode, graphNodeMode]);

  const handleFitView = useCallback(() => {
    const panel = graphPanelRef.current;
    if (!panel || graphLayout.instances.length === 0) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const hub of graphLayout.hubs) {
      minX = Math.min(minX, hub.x - 90);
      maxX = Math.max(maxX, hub.x + 90);
      minY = Math.min(minY, hub.y - 35);
      maxY = Math.max(maxY, hub.y + 35);
    }

    const nodeHalfW = graphNodeMode === "compact" ? 65 : 85;
    const nodeHalfH = graphNodeMode === "compact" ? 25 : 45;

    for (const point of graphLayout.instances) {
      minX = Math.min(minX, point.x - nodeHalfW);
      maxX = Math.max(maxX, point.x + nodeHalfW);
      minY = Math.min(minY, point.y - nodeHalfH);
      maxY = Math.max(maxY, point.y + nodeHalfH);
    }

    if (!isFinite(minX)) {
      setGraphZoom(1);
      setGraphPan({ x: 0, y: 0 });
      return;
    }

    const margin = 48;
    const contentW = Math.max(maxX - minX, 200);
    const contentH = Math.max(maxY - minY, 160);

    const scaleX = (rect.width - margin * 2) / contentW;
    const scaleY = (rect.height - margin * 2) / contentH;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.35), 1.2);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const newPanX = rect.width / 2 - centerX * newZoom;
    const newPanY = rect.height / 2 - centerY * newZoom;

    setGraphZoom(newZoom);
    setGraphPan({ x: newPanX, y: newPanY });
  }, [graphLayout, graphNodeMode]);

  const handleZoomChange = useCallback((factor: number) => {
    const panel = graphPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setGraphZoom((currZoom) => {
      const nextZoom = Math.min(Math.max(currZoom * factor, 0.25), 2.5);
      setGraphPan((currPan) => ({
        x: cx - (cx - currPan.x) * (nextZoom / currZoom),
        y: cy - (cy - currPan.y) * (nextZoom / currZoom)
      }));
      return nextZoom;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    handleFitView();
  }, [handleFitView]);

  const handleFocusHub = useCallback((hub: { x: number; y: number }) => {
    const panel = graphPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const nextZoom = 0.95;
    const nextPanX = rect.width / 2 - hub.x * nextZoom;
    const nextPanY = rect.height / 2 - hub.y * nextZoom;
    setGraphZoom(nextZoom);
    setGraphPan({ x: nextPanX, y: nextPanY });
  }, []);

  useEffect(() => {
    if (directoryView === "graph") {
      const timer = setTimeout(() => {
        handleFitView();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [directoryView, graphLayoutMode, graphNodeMode, handleFitView]);

  const handleGraphMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(".instance-graph-toolbar") ||
      target.closest(".instance-graph-node") ||
      target.closest(".instance-graph-hub")
    ) {
      return;
    }
    isGraphDraggingRef.current = true;
    setIsGraphDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: graphPan.x,
      panY: graphPan.y
    };
  };

  const handleGraphMouseMove = (e: React.MouseEvent) => {
    if (!isGraphDraggingRef.current) return;
    setGraphPan({
      x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y)
    });
  };

  const handleGraphMouseUp = () => {
    isGraphDraggingRef.current = false;
    setIsGraphDragging(false);
  };

  const handleGraphWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const panel = graphPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setGraphZoom((currZoom) => {
      const nextZoom = Math.min(Math.max(currZoom * zoomFactor, 0.25), 2.5);
      setGraphPan((currPan) => ({
        x: mouseX - (mouseX - currPan.x) * (nextZoom / currZoom),
        y: mouseY - (mouseY - currPan.y) * (nextZoom / currZoom)
      }));
      return nextZoom;
    });
  };

  const handleGraphTouchStart = (e: React.TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 1 && t0) {
      touchStartRef.current = {
        dist: 0,
        panX: graphPan.x,
        panY: graphPan.y,
        x: t0.clientX,
        y: t0.clientY
      };
    } else if (e.touches.length >= 2 && t0 && t1) {
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      touchStartRef.current = {
        dist,
        panX: graphPan.x,
        panY: graphPan.y,
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2
      };
    }
  };

  const handleGraphTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 1 && t0) {
      const dx = t0.clientX - touchStartRef.current.x;
      const dy = t0.clientY - touchStartRef.current.y;
      setGraphPan({
        x: touchStartRef.current.panX + dx,
        y: touchStartRef.current.panY + dy
      });
    } else if (e.touches.length >= 2 && t0 && t1) {
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (touchStartRef.current.dist > 0) {
        const factor = dist / touchStartRef.current.dist;
        setGraphZoom((z) => Math.min(Math.max(z * factor, 0.25), 2.5));
        touchStartRef.current.dist = dist;
      }
    }
  };

  const handleGraphTouchEnd = () => {
    touchStartRef.current = null;
  };
  const updateInstanceStatus = useCallback((id: string, status: InstanceStatus, exitCode?: number | null) => {
    setInstances((current) => {
      let changed = false;
      const next = current.map((instance) => {
        if (instance.id !== id) return instance;
        const nextExitCode = exitCode ?? instance.lastExitCode;
        if (instance.status === status && instance.lastExitCode === nextExitCode) return instance;
        changed = true;
        return { ...instance, status, lastExitCode: nextExitCode };
      });
      // Keep object identity when nothing actually changed so open modals
      // keyed on the instance object are not reset by no-op status pushes.
      return changed ? next : current;
    });
  }, []);

  const refreshWatchPolicies = useCallback(
    async (list: ManagedInstance[]) => {
      const entries = await Promise.all(
        list.map(async (instance) => {
          try {
            const policy = await api.watchPolicy(token, instance.id);
            return [instance.id, policy.enabled] as const;
          } catch {
            return null;
          }
        })
      );
      const nextMap: Record<string, boolean> = {};
      for (const entry of entries) {
        if (entry) nextMap[entry[0]] = entry[1];
      }
      setWatchEnabledMap(nextMap);
    },
    [token]
  );

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
      void refreshWatchPolicies(nextInstances);
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
  }, [initialInstanceId, onLogout, onSelectInstance, refreshWatchPolicies, token]);

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

  useEffect(() => {
    onInstancesLoaded?.(instances);
  }, [instances, onInstancesLoaded]);

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


  const syncDialog = showSyncModal ? (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !syncing) {
          setShowSyncModal(false);
          setSyncError("");
          setSyncSuccess("");
          setErrorAvailableUsers([]);
        }
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="modal-title-icon-badge" style={{ background: "rgba(255, 117, 172, 0.12)", color: "#ff75ac" }}>
                <KeyRound size={18} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 16 }}>同步远程节点用户实例</h2>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
                  支持输入专属密钥或直接从节点导入实例
                </p>
              </div>
            </div>
            <button
              className="icon-button mini"
              type="button"
              disabled={syncing}
              onClick={() => {
                setShowSyncModal(false);
                setSyncError("");
                setSyncSuccess("");
                setErrorAvailableUsers([]);
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSyncInstances} style={{ display: "grid", gap: "14px", padding: "16px 20px 20px" }}>
          {syncError ? (
            <div style={{
              padding: "10px 14px",
              borderRadius: "10px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              color: "#ef4444",
              fontSize: "12px",
              lineHeight: 1.5
            }}>
              {syncError}
            </div>
          ) : null}

          {syncSuccess ? (
            <div style={{
              padding: "10px 14px",
              borderRadius: "10px",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              color: "#10b981",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <Check size={14} />
              <span>{syncSuccess}</span>
            </div>
          ) : null}

          <label>
            <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "6px" }}>
              选择所属目标节点机器 <strong style={{ color: "#ef4444" }}>*</strong>
            </span>
            <select
              value={syncNodeId}
              onChange={(e) => {
                const nid = e.target.value;
                setSyncNodeId(nid);
                setErrorAvailableUsers([]);
                void loadNodeRemoteUsers(nid);
                const chosen = nodes.find((n) => n.id === nid);
                if (chosen) {
                  setSyncRemoteUrl(`https://${chosen.host}:5479`);
                }
              }}
              required
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px" }}
            >
              <option value="">请选择节点机器...</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.host}:{n.port}) {n.status === "ONLINE" ? "🟢 在线" : "⚪ 离线"}
                </option>
              ))}
            </select>
          </label>

                    {loadingRemoteUsers ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-muted, #86868b)", padding: "4px 0" }}>
              <Loader2 size={13} className="spin" />
              <span>正在探测节点本地数据库与用户实例...</span>
            </div>
          ) : nodeRemoteUsers.length > 0 ? (
            <div style={{
              padding: "12px 14px",
              borderRadius: "10px",
              background: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              display: "grid",
              gap: "8px"
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#3b82f6", display: "flex", alignItems: "center", gap: "5px" }}>
                  <Database size={13} />
                  发现节点用户实例：
                </span>
              </div>
              <div style={{ display: "grid", gap: "6px" }}>
                {nodeRemoteUsers.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      background: "rgba(255, 255, 255, 0.06)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "6px"
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "13px" }}>{u.displayName || u.username}</strong>
                      <span style={{ fontSize: "11px", color: "var(--text-muted, #86868b)", marginLeft: "8px" }}>
                        @{u.username} · <strong>{u.instanceCount}</strong> 个实例
                        {u.activeKeyLast4 ? ` · 有效密钥指纹 ...${u.activeKeyLast4}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="primary-button mini"
                      disabled={syncing}
                      onClick={() => void handleSyncForUser(u)}
                      style={{ height: "28px", fontSize: "11px", padding: "0 12px" }}
                    >
                      一键导入全部
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

                    {errorAvailableUsers.length > 0 && nodeRemoteUsers.length === 0 ? (
            <div style={{
              padding: "10px 12px",
              borderRadius: "8px",
              background: "rgba(245, 158, 11, 0.1)",
              border: "1px solid rgba(245, 158, 11, 0.25)",
              display: "grid",
              gap: "6px"
            }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#f59e0b" }}>
                检测到该节点上有以下可用用户，可直接一键导入：
              </span>
              {errorAvailableUsers.map((u) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "12px" }}>{u.displayName || u.username} ({u.instanceCount} 个实例)</span>
                  <button
                    type="button"
                    className="primary-button mini"
                    disabled={syncing}
                    onClick={() => void handleSyncForUser(u)}
                  >
                    导入此用户
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ position: "relative", textAlign: "center", margin: "4px 0" }}>
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(255, 255, 255, 0.1)" }} />
            <span style={{ position: "relative", padding: "0 10px", background: "var(--card-bg, #1a1b26)", fontSize: "11px", color: "var(--text-muted, #86868b)" }}>
              或通过专属密钥导入
            </span>
          </div>

          <label>
            <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "6px" }}>
              用户专属访问密钥 (User Key)
            </span>
            <textarea
              rows={2}
              value={syncUserKey}
              onChange={(e) => setSyncUserKey(e.target.value)}
              placeholder="粘贴目标机器生成的以 saki_usr_ 开头的整串密钥..."
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "12px" }}
            />
            <span style={{ fontSize: "11px", color: "var(--text-muted, #86868b)", marginTop: "4px", display: "block" }}>
              输入目标机器生成的专属密钥拉取实例
            </span>
          </label>

          <label>
            <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "6px" }}>
              远程面板地址 (可选备用)
            </span>
            <input
              type="text"
              value={syncRemoteUrl}
              onChange={(e) => setSyncRemoteUrl(e.target.value)}
              placeholder="如 https://dreamstarry.top:5479（留空将自动推断）"
              style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", fontSize: "12px" }}
            />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              className="secondary-button"
              disabled={syncing}
              onClick={() => {
                setShowSyncModal(false);
                setSyncError("");
                setSyncSuccess("");
                setErrorAvailableUsers([]);
              }}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={syncing}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 18px" }}
            >
              {syncing ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
              {syncing ? "正在验证同步..." : "通过密钥同步实例"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

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
                  <span>自启动</span>
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

  const editDatabaseDialog = editingDatabase ? (
    <EditDatabaseModal
      token={token}
      database={editingDatabase}
      nodes={nodes}
      onClose={() => setEditingDatabase(null)}
      onUpdated={async () => {
        setEditingDatabase(null);
        await refresh();
      }}
    />
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
    const selectedIncident = watchActiveIncidents.find((item) => item.instanceId === selectedInstance.id) ?? null;
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
        {typeof document !== "undefined" && syncDialog ? createPortal(syncDialog, document.body) : null}
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
                  {...(openFileRequest ? { openFileRequest } : {})}
                  {...(onOpenFileRequestConsumed ? { onOpenFileRequestConsumed } : {})}
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
              void api
                .watchPolicy(token, updated.id)
                .then((policy) => setWatchEnabledMap((current) => ({ ...current, [updated.id]: policy.enabled })))
                .catch(() => undefined);
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
                          let updatedTabs = [...terminalTabs];
                          const mainIdx = updatedTabs.findIndex((t) => t.key === "main");
                          if (mainIdx !== -1 && updatedTabs[mainIdx]?.label === "终端") {
                            const mainTab = updatedTabs[mainIdx]!;
                            updatedTabs[mainIdx] = { ...mainTab, key: mainTab.key, label: "shell1" };
                          }

                          const label = getNextShellLabel(updatedTabs);
                          const res = await api.createInstanceShell(token, selectedId, wd || undefined, label);
                          const newKey = `shell-${res.sessionId}`;

                          updatedTabs = [...updatedTabs, { key: newKey, label: res.label || label, shellSessionId: res.sessionId }];

                          setTerminalTabs(updatedTabs);
                          handleSelectTerminalTab(newKey);
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
                        onClick={() => handleSelectTerminalTab(tab.key)}
                      >
                        <span className="tab-label">{tab.label}</span>
                        {tab.key !== "main" && (
                          <button
                            type="button"
                            className="tab-close"
                            title="关闭终端"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (tab.shellSessionId && selectedId && token) {
                                void api.deleteInstanceShell(token, selectedId, tab.shellSessionId).catch((err) => {
                                  console.warn("Failed to delete shell session", err);
                                });
                              }
                              const remaining = terminalTabs.filter((t) => t.key !== tab.key);
                              if (remaining.length <= 1) {
                                setTerminalTabs([{ key: "main", label: "终端" }]);
                                handleSelectTerminalTab("main");
                                return;
                              }
                              setTerminalTabs(remaining);
                              if (activeTerminalKey === tab.key) {
                                const nextActive = remaining[remaining.length - 1]!.key;
                                handleSelectTerminalTab(nextActive);
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
                        contextText: selectedIncident?.summary || selectedIncident?.rootCause || "",
                        mode: "agent"
                      })
                  : undefined
              }
            />
            {/* 实例信息 */}
            <div className="glass-panel instance-side-card instance-summary-card">
              <div className="instance-summary-header">
                <div className="summary-title-row">
                  <h3 title={selectedInstance.name}>{selectedInstance.name}</h3>
                </div>
                <div className="summary-status-row">
                  <InstanceStatusBadge status={selectedInstance.status} />
                  <span className="instance-program-badge">通用控制台程序</span>
                  {watchEnabledMap[selectedInstance.id] ? (
                    <span className="instance-program-badge watch-on" title="Saki 值班监控已开启">
                      值班中
                    </span>
                  ) : null}
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

            {/* 快捷操作 */}
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

            {/* 实时性能与进程探针 */}
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
      {typeof document !== "undefined" && syncDialog ? createPortal(syncDialog, document.body) : null}
      {typeof document !== "undefined" && databaseVisualizerDialog ? createPortal(databaseVisualizerDialog, document.body) : null}
      {typeof document !== "undefined" && editDatabaseDialog ? createPortal(editDatabaseDialog, document.body) : null}

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
            
            <button
              className="icon-button instance-action-btn"
              title="通过用户专属密钥同步远程实例"
              aria-label="通过用户专属密钥同步远程实例"
              type="button"
              onClick={openSyncModal}
            >
              <KeyRound size={17} />
            </button>
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
                    {watchEnabledMap[instance.id] ? (
                      <span className="instance-glance-item watch-on" data-tooltip="Saki 值班监控已开启">
                        <ShieldCheck size={13} />
                        <span className="glance-label">值班中</span>
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
                    <span
                      className="instance-glance-item"
                      data-tooltip={`创建者 ${instanceCreatorLabel(db)} · 负责人 ${instanceAssigneeLabel(db)}`}
                    >
                      <UserCheck size={13} />
                      <span className="glance-label">{instanceAssigneeLabel(db)}</span>
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
                        className="icon-button mini"
                        title="修改数据库配置"
                        type="button"
                        onClick={() => setEditingDatabase(db)}
                      >
                        <Wrench size={14} />
                      </button>
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
                <div style={{ display: "flex", justifyContent: "center", marginTop: "14px" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={openSyncModal}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "8px 18px" }}
                  >
                    <KeyRound size={14} style={{ color: "#ff75ac" }} />
                    <span>通过用户专属密钥同步远程实例</span>
                  </button>
                </div>
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
                  <div className="instance-list-top">
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
                  </div>
                  <div className="instance-list-metas">
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
                  <div className="instance-list-top">
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
                  </div>
                  <div className="instance-list-metas">
                    <div className="instance-list-meta" role="cell" title={nodeName}>
                      <Server size={14} />
                      <span>{nodeName}</span>
                    </div>
                    <div className="instance-list-meta" role="cell" title={endpointLabel}>
                      <HardDrive size={14} />
                      <span>{endpointLabel}</span>
                    </div>
                    <div
                      className="instance-list-meta instance-owner-meta"
                      role="cell"
                      title={`创建者 ${instanceCreatorLabel(db)} · 负责人 ${instanceAssigneeLabel(db)}`}
                    >
                      <UserCheck size={14} />
                      <span>{instanceAssigneeLabel(db)}</span>
                    </div>
                    <div className="instance-list-meta" role="cell" title="更新">
                      <Clock size={14} />
                      <span>{formatDate(db.updatedAt)}</span>
                    </div>
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
                    <button
                      className="icon-button mini"
                      title="修改数据库配置"
                      type="button"
                      onClick={() => setEditingDatabase(db)}
                    >
                      <Wrench size={14} />
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
            <div
              className={`instance-graph-panel ${isGraphDragging ? "dragging" : ""}`}
              ref={graphPanelRef}
              onMouseDown={handleGraphMouseDown}
              onMouseMove={handleGraphMouseMove}
              onMouseUp={handleGraphMouseUp}
              onMouseLeave={handleGraphMouseUp}
              onWheel={handleGraphWheel}
              onTouchStart={handleGraphTouchStart}
              onTouchMove={handleGraphTouchMove}
              onTouchEnd={handleGraphTouchEnd}
              onDoubleClick={handleFitView}
              role="region"
              aria-label="实例拓扑图谱画布"
            >
              {/* Floating Graph Controls */}
              <div className="instance-graph-toolbar" role="toolbar" aria-label="图谱画布控制器">
                <div className="graph-toolbar-group">
                  <button
                    className="graph-toolbar-btn"
                    type="button"
                    title="放大画布"
                    onClick={() => handleZoomChange(1.2)}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="graph-toolbar-btn"
                    type="button"
                    title="缩小画布"
                    onClick={() => handleZoomChange(0.83)}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    className="graph-toolbar-btn graph-zoom-label"
                    type="button"
                    title="双击或点击重置全景"
                    onClick={handleResetZoom}
                  >
                    {Math.round(graphZoom * 100)}%
                  </button>
                  <button
                    className="graph-toolbar-btn"
                    type="button"
                    title="全景自适应"
                    onClick={handleFitView}
                  >
                    <Maximize2 size={13} />
                  </button>
                </div>

                <div className="graph-toolbar-divider" />

                <div className="graph-toolbar-group">
                  <button
                    className={`graph-toolbar-toggle ${graphLayoutMode === "orbit" ? "active" : ""}`}
                    type="button"
                    title="星环轨道拓扑"
                    onClick={() => setGraphLayoutMode("orbit")}
                  >
                    <Layers size={13} />
                    <span>星环</span>
                  </button>
                  <button
                    className={`graph-toolbar-toggle ${graphLayoutMode === "cluster" ? "active" : ""}`}
                    type="button"
                    title="集群矩阵结构"
                    onClick={() => setGraphLayoutMode("cluster")}
                  >
                    <LayoutGrid size={13} />
                    <span>集群</span>
                  </button>
                </div>

                <div className="graph-toolbar-divider" />

                <div className="graph-toolbar-group">
                  <button
                    className={`graph-toolbar-toggle ${graphNodeMode === "compact" ? "active" : ""}`}
                    type="button"
                    title={graphNodeMode === "compact" ? "切换为卡片大视图" : "切换为紧凑微型节点"}
                    onClick={() => setGraphNodeMode((m) => (m === "compact" ? "card" : "compact"))}
                  >
                    <span>{graphNodeMode === "compact" ? "紧凑节点" : "卡片节点"}</span>
                  </button>
                </div>
              </div>

              {/* Transformable Canvas Stage */}
              <div
                className="instance-graph-stage"
                style={{
                  width: `${graphLayout.width}px`,
                  height: `${graphLayout.height}px`,
                  transform: `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphZoom})`,
                  transformOrigin: "0 0"
                }}
              >
                <svg
                  className="instance-graph-links"
                  width={graphLayout.width}
                  height={graphLayout.height}
                  viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
                  aria-hidden="true"
                >
                  {graphLayout.edges.map((edge) => {
                    const isHovered = graphHoveredId === edge.id;
                    const isDimmed = graphHoveredId && !isHovered;
                    return (
                      <line
                        className={`instance-graph-link ${edge.className} ${
                          isHovered ? "highlighted" : isDimmed ? "dimmed" : ""
                        }`}
                        x1={edge.x1}
                        y1={edge.y1}
                        x2={edge.x2}
                        y2={edge.y2}
                        key={edge.id}
                      />
                    );
                  })}
                </svg>

                {graphLayout.hubs.map((hub) => (
                  <div
                    className="instance-graph-hub"
                    style={{ left: `${hub.x}px`, top: `${hub.y}px` }}
                    title={hub.detail}
                    key={hub.id}
                  >
                    <Server size={17} />
                    <span>{hub.label}</span>
                    <strong>{hub.count}</strong>
                  </div>
                ))}

                {graphLayout.instances.map((point) => {
                  const isHovered = graphHoveredId === point.instance.id;
                  const isFilteredOut =
                    graphStatusFilter &&
                    (graphStatusFilter === "RUNNING"
                      ? point.instance.status !== "RUNNING"
                      : graphStatusFilter === "TRANSITION"
                      ? point.instance.status !== "STARTING" && point.instance.status !== "STOPPING"
                      : graphStatusFilter === "CRASHED"
                      ? point.instance.status !== "CRASHED"
                      : graphStatusFilter === "IDLE"
                      ? point.instance.status !== "STOPPED" && point.instance.status !== "CREATED"
                      : false);

                  return (
                    <button
                      className={`instance-graph-node ${
                        graphNodeMode === "compact" ? "compact-node" : ""
                      } ${point.meta.className} ${isHovered ? "hovered" : ""} ${
                        isFilteredOut ? "dimmed" : ""
                      }`}
                      style={{ left: `${point.x}px`, top: `${point.y}px` }}
                      title={`${point.instance.name} · ${point.nodeDetail} (${point.meta.label})`}
                      type="button"
                      onClick={() => setSelectedId(point.instance.id)}
                      onMouseEnter={() => setGraphHoveredId(point.instance.id)}
                      onMouseLeave={() => setGraphHoveredId(null)}
                      key={point.instance.id}
                    >
                      <span className="instance-graph-pulse" aria-hidden="true" />
                      <span
                        className={
                          graphNodeMode === "compact" ? "compact-node-icon" : "instance-graph-icon"
                        }
                      >
                        <InstanceStatusIcon
                          status={point.instance.status}
                          size={graphNodeMode === "compact" ? 14 : 17}
                        />
                      </span>
                      <span
                        className={`instance-graph-label ${
                          graphNodeMode === "compact" ? "compact-label" : ""
                        }`}
                      >
                        {point.instance.name}
                      </span>
                      {graphNodeMode !== "compact" ? (
                        <small>
                          {instanceTypeLabel(point.instance.type)} · {point.meta.shortLabel}
                        </small>
                      ) : null}
                    </button>
                  );
                })}
              </div>

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

              {/* Status Filter Chips */}
              <div className="instance-graph-status-section">
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", marginBottom: "4px" }}>
                  状态快速过滤
                </div>
                <div className="instance-graph-filter-list">
                  <button
                    className={`graph-filter-chip ${!graphStatusFilter ? "active" : ""}`}
                    type="button"
                    onClick={() => setGraphStatusFilter(null)}
                  >
                    全部 {sortedInstances.length}
                  </button>
                  {instanceStats.counts.RUNNING > 0 ? (
                    <button
                      className={`graph-filter-chip ${graphStatusFilter === "RUNNING" ? "active" : ""}`}
                      type="button"
                      onClick={() =>
                        setGraphStatusFilter((f) => (f === "RUNNING" ? null : "RUNNING"))
                      }
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#10b981"
                        }}
                      />
                      运行中 {instanceStats.counts.RUNNING}
                    </button>
                  ) : null}
                  {instanceStats.counts.STARTING + instanceStats.counts.STOPPING > 0 ? (
                    <button
                      className={`graph-filter-chip ${graphStatusFilter === "TRANSITION" ? "active" : ""}`}
                      type="button"
                      onClick={() =>
                        setGraphStatusFilter((f) => (f === "TRANSITION" ? null : "TRANSITION"))
                      }
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#0ea5e9"
                        }}
                      />
                      过渡中 {instanceStats.counts.STARTING + instanceStats.counts.STOPPING}
                    </button>
                  ) : null}
                  {instanceStats.counts.STOPPED + instanceStats.counts.CREATED > 0 ? (
                    <button
                      className={`graph-filter-chip ${graphStatusFilter === "IDLE" ? "active" : ""}`}
                      type="button"
                      onClick={() =>
                        setGraphStatusFilter((f) => (f === "IDLE" ? null : "IDLE"))
                      }
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#94a3b8"
                        }}
                      />
                      未运行 {instanceStats.counts.STOPPED + instanceStats.counts.CREATED}
                    </button>
                  ) : null}
                  {instanceStats.counts.CRASHED > 0 ? (
                    <button
                      className={`graph-filter-chip ${graphStatusFilter === "CRASHED" ? "active" : ""}`}
                      type="button"
                      onClick={() =>
                        setGraphStatusFilter((f) => (f === "CRASHED" ? null : "CRASHED"))
                      }
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#ef4444"
                        }}
                      />
                      异常 {instanceStats.counts.CRASHED}
                    </button>
                  ) : null}
                </div>
              </div>

              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", marginTop: "4px" }}>
                拓扑节点定位
              </div>
              <div className="instance-graph-node-list">
                {graphLayout.hubs.map((hub) => (
                  <button
                    className="instance-graph-hub-btn"
                    title={`点击聚焦定位 ${hub.label} (${hub.detail})`}
                    type="button"
                    key={hub.id}
                    onClick={() => handleFocusHub(hub)}
                  >
                    <Server size={13} />
                    <span>{hub.label}</span>
                    <strong>{hub.count}</strong>
                  </button>
                ))}
              </div>

              <div className="graph-canvas-hint">
                💡 滚轮缩放 · 拖动画布 · 双击自适应全景
              </div>
            </aside>
          </div>
        )}
      </section>
    </>
  );
}

