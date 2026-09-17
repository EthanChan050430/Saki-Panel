import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart2,
  BookOpen,
  Bot,
  Bug,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  Code2,
  Coins,
  Compass,
  Copy,
  CornerDownLeft,
  CornerUpLeft,
  Cpu,
  Download,
  DownloadCloud,
  Edit3,
  ExternalLink,
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
  Heart,
  History,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
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
  ScanEye,
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
  CurrentUser,
  ManagedInstance,
  SakiAgentAction,
  SakiAgentPermissionMode,
  SakiChatMessage,
  SakiChatMode,
  SakiChatResponse,
  SakiInputAttachment,
  SakiModelOption,
  SakiSkillSummary
} from "@webops/shared";
import {
  activeSakiMentionQuery,
  filterSakiMentionCandidates,
  insertSakiMention,
  isSakiImageAttachment,
  sakiListedModelSupportsVision,
  sakiModelSupportsVision
} from "@webops/shared";
import type {
  BrowserSpeechRecognition,
  LocalSakiMessage,
  LocalSakiTimelineItem,
  LocalSakiWorkflowStep,
  SakiInstanceFileDragPayload,
  SakiInstanceFileDropRequest,
  SakiPanelContext,
  SakiFollowUpJob,
  SakiPromptSeed,
  SakiSelectionCapture,
  SakiSubmitOverride,
  ViewMode
} from "../../types/app.js";
import {
  api,
  ApiError,
  type SakiActiveTaskSummary,
  type SakiChatStreamEvent
} from "../../api.js";
import { usePanelLanguage, usePanelT } from "../../i18n/index.js";
import {
  defaultSakiRequestTimeoutMs,
  sakiArtAssets,
  sakiStreamIdleFallbackMs
} from "../../constants.js";
import {
  base64ToBlob,
  compactContextText,
  formatBytes,
  formatDate,
  imageMimeTypeFromPath,
  isImageFile
} from "../../utils/path.js";
import { newClientId } from "../../utils/id.js";
import { MarkdownContent, SakiPathOpenContext } from "../common/MarkdownContent.js";
import { LiquidGlassContainer } from "../common/LiquidGlass.js";
import { isSakiPetTouchUi, useSakiPet } from "./pet/sakiPetState.js";
import {
  SakiAttachmentChip,
  SakiCharacterArt,
  SakiPendingToolCard,
  SakiStreamStatus,
  SakiThinkingActionCard,
  SakiThinkingContent,
  parseThinkingContent,
  SakiToolActionCard,
  appendSakiTimelineDelta,
  appendSakiTimelineThinking,
  clampSakiLauncherPosition,
  hasPersistableSakiSpeech,
  isReadOnlySakiTool,
  isSakiFileEditTool,
  isSakiFileRollbackAction,
  isSakiRollbackableFileEdit,
  isSakiWorkMood,
  mergeSakiActionList,
  mergeSakiFinalText,
  mergeSakiFinalTimeline,
  mergeSakiTimelineActions,
  persistableSakiMessages,
  readSakiConversations,
  sortSakiConversationsByTime,
  readSakiLauncherPosition,
  renderableSakiTimeline,
  sakiActivityMoodForTool,
  sakiAttachmentSummary,
  sakiConversationTitle,
  sakiFileEditActionLabel,
  sakiFoodMenu,
  getLocalizedFoodMenu,
  sakiLauncherAttachedEdgeForPosition,
  sakiLauncherAttachedSize,
  sakiLauncherEdgeForPosition,
  sakiLauncherExpandedSize,
  sakiLauncherSnapEdgeForPosition,
  sameSakiLauncherPosition,
  sealSakiTimelineDelta,
  settleSakiTimelinePending,
  snapSakiLauncherPositionToEdge,
  stripHeavySakiAttachmentData,
  upsertSakiTimelineAction,
  upsertSakiTimelinePending,
  upsertSakiTimelineText,
  visibleSakiActions,
  workflowEventChatText,
  writeSakiConversations,
  writeSakiLauncherPosition,
  type SakiActivityMood,
  type SakiArtMood,
  type SakiLauncherPosition,
  type SakiPullDragRequest,
  type SakiVoiceEchoState,
  type StoredSakiConversation
} from "./SakiComponents.js";
import { SakiDessertDropGame } from "./SakiDessertDropGame.js";
import { getFavorabilityLevelInfo as getFavorabilityLevelInfoHelper } from "./sakiChatHelpers.js";
import { SakiAttachmentModal } from "./SakiAttachmentModal.js";
import { SakiMentionMenu } from "./SakiMentionMenu.js";
import { ChatLauncher } from "./chat/ChatLauncher.js";
import { SakiVideoPane } from "./chat/SakiVideoPane.js";
import { SakiHistoryDrawer } from "./chat/SakiHistoryDrawer.js";
import { SakiMessagesList } from "./chat/SakiMessagesList.js";
import { mergeSakiMessageAttachments } from "./chat/SakiChatImages.js";
import { SakiComposer } from "./chat/SakiComposer.js";
import { SakiChatDropdowns } from "./chat/SakiChatDropdowns.js";
import { SakiVoiceEcho } from "./sakiVoice.js";
import {
  clearRememberedSakiTerminalSelection,
  readAllTerminalBufferText,
  readTerminalClipboardText
} from "../terminal/WebTerminal.js";
import {
  coerceSakiMode,
  countSelectionCharacters,
  createSakiWelcomeMessage,
  defaultSakiAgentPermissionMode,
  fileToSakiAttachment,
  formatSakiContextPath,
  getSakiWelcomeMessageText,
  getSpeechRecognitionConstructor,
  hasAnyFileDragData,
  hasSakiInstanceFileDragData,
  imageFileToSakiAttachment,
  isSakiModeAllowed,
  parseSakiInstanceFileDragPayload,
  readSakiSelectionCapture,
  sakiImageMaxDimension,
  sakiImageQuality,
  sakiMaxInputAttachments,
  sakiMimeTypeFromPath,
  sakiPermissionModeLabel,
  sakiPermissionModeTitle,
  sakiSelectionContextLimit,
  sakiTextAttachmentLimit,
  toSakiHistoryMessage
} from "./sakiChatHelpers.js";

function resolveSakiModelPointsMultiplier(
  multipliers: Record<string, number> | null | undefined,
  model: { id: string; provider?: string }
): number {
  if (!multipliers || typeof multipliers !== "object") return 1;
  const modelId = (model.id || "").trim();
  if (!modelId) return 1;
  const provider = (model.provider || "").trim();
  if (provider) {
    const scoped = multipliers[`${provider}:${modelId}`];
    if (scoped !== undefined && Number.isFinite(scoped)) return Math.max(0, scoped);
  }
  const direct = multipliers[modelId];
  if (direct !== undefined && Number.isFinite(direct)) return Math.max(0, direct);
  return 1;
}

function formatSakiModelMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(1) : rounded}x`;
}

export type SakiWorkspaceSelection =
  | { type: "current" }
  | { type: "page"; view: ViewMode }
  | { type: "instance"; instanceId: string };

function getPanelContextForView(view: ViewMode, t: (key: any) => string): SakiPanelContext {
  if (view === "audit") {
    return { label: t("context.audit.label") || "审计日志", detail: t("context.audit.detail") || "安全审计事件检索", auditSearch: true };
  }
  if (view === "instances") {
    return { label: t("context.instances.label") || "实例管理", detail: t("context.instances.detail") || "运行实例管理" };
  }
  if (view === "nodes") return { label: t("context.nodes.label") || "节点管理", detail: t("context.nodes.detail") || "节点连接与集群状态" };
  if (view === "templates") return { label: t("context.templates.label") || "模板市场", detail: t("context.templates.detail") || "实例模板配置" };
  if (view === "users") return { label: t("context.users.label") || "用户管理", detail: t("context.users.detail") || "用户权限管理" };
  if (view === "settings") return { label: t("context.settings.label") || "系统设置", detail: t("context.settings.detail") || "Saki 与系统配置" };
  if (view === "reliability") return { label: t("context.reliability.label") || "系统可靠性", detail: t("context.reliability.detail") || "服务可靠性监控" };
  if (view === "plugins") return { label: t("context.plugins.label") || "插件中心", detail: t("context.plugins.detail") || "主题与插件拓展" };
  if (view === "about") return { label: t("nav.about") || "关于", detail: "系统架构与帮助" };
  return { label: t("context.dashboard.label") || "控制台", detail: t("context.dashboard.detail") || "全局概览与状态" };
}

export function SakiFloatingChat({
  token,
  instance,
  seed,
  panelContext,
  fileDragActive,
  instanceFileDropRequest,
  canUseChat,
  canUseAgent,
  canUseSkills,
  currentModelId,
  currentModelName,
  availableModels,
  onCurrentModelIdChange,
  onCurrentModelNameChange,
  onAvailableModelsChange,
  sakiLieMode = false,
  onReturnToLie,
  wakeCount = 0,
  onOpenPointsUsage,
  onLauncherDraggingChange,
  onPointsBalanceChange,
  pointsSummary,
  currentUserFavorability = 0,
  onFavorabilityChange,
  pullDragRequest = null,
  onPullDragConsumed,
  onOpenWorkspaceFile,
  onClearFileDrag,
  availableViews,
  activeView,
  onNavigateView
}: {
  token: string;
  instance: ManagedInstance | null;
  seed: SakiPromptSeed | null;
  panelContext: SakiPanelContext;
  fileDragActive: boolean;
  instanceFileDropRequest: SakiInstanceFileDropRequest | null;
  canUseChat: boolean;
  canUseAgent: boolean;
  canUseSkills: boolean;
  currentModelId: string;
  currentModelName: string;
  availableModels: SakiModelOption[];
  onCurrentModelIdChange: (id: string) => void;
  onCurrentModelNameChange: (name: string) => void;
  onAvailableModelsChange: (models: SakiModelOption[]) => void;
  sakiLieMode?: boolean;
  onReturnToLie?: () => void;
  wakeCount?: number;
  onOpenPointsUsage?: () => void;
  onLauncherDraggingChange?: (dragging: boolean) => void;
  onPointsBalanceChange?: (balance: { points: number; unlimitedPoints: boolean }) => void;
  pointsSummary?: { points: number; unlimitedPoints: boolean };
  currentUserFavorability?: number;
  onFavorabilityChange?: (fav: number) => void;
  pullDragRequest?: SakiPullDragRequest | null;
  onPullDragConsumed?: () => void;
  onOpenWorkspaceFile?: (path: string, line?: number, targetInstanceId?: string) => void;
  onClearFileDrag?: () => void;
  availableViews?: ViewMode[];
  activeView?: ViewMode;
  onNavigateView?: (view: ViewMode, instanceId?: string) => void;
}) {
  const { t, tFormat, language } = usePanelLanguage();
  const [workspaceSelection, setWorkspaceSelection] = useState<SakiWorkspaceSelection>({ type: "current" });
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [availableInstances, setAvailableInstances] = useState<ManagedInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeInstance = useMemo<ManagedInstance | null>(() => {
    if (workspaceSelection.type === "current") {
      return instance;
    }
    if (workspaceSelection.type === "instance") {
      return (
        availableInstances.find((item) => item.id === workspaceSelection.instanceId) ??
        (instance?.id === workspaceSelection.instanceId ? instance : null)
      );
    }
    return null;
  }, [availableInstances, instance, workspaceSelection]);

  const activePanelContext = useMemo<SakiPanelContext>(() => {
    if (workspaceSelection.type === "current") {
      return panelContext;
    }
    if (workspaceSelection.type === "page") {
      return getPanelContextForView(workspaceSelection.view, t);
    }
    if (workspaceSelection.type === "instance" && activeInstance) {
      return {
        label: activeInstance.name,
        detail: activeInstance.workingDirectory || `实例 ${activeInstance.name}`
      };
    }
    return panelContext;
  }, [activeInstance, panelContext, t, workspaceSelection]);

  const contextKey = activeInstance
    ? `instance:${activeInstance.id}`
    : `panel:${activePanelContext.label}:${activePanelContext.detail}`;
  const baseContextLabel = activeInstance ? activeInstance.name : activePanelContext.label;
  const baseContextPath = activeInstance?.workingDirectory ?? activePanelContext.detail;
  const [open, setOpen] = useState(false);
  const [messagesExpanded, setMessagesExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<SakiChatMode>(() => coerceSakiMode("agent", canUseChat, canUseAgent));
  const [permissionMode, setPermissionMode] = useState<SakiAgentPermissionMode>(defaultSakiAgentPermissionMode);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [contextTitle, setContextTitle] = useState<string | null>(null);
  const [contextText, setContextText] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalSakiMessage[]>([
    createSakiWelcomeMessage(getSakiWelcomeMessageText(instance, panelContext.label))
  ]);
  const [skills, setSkills] = useState<SakiSkillSummary[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [followUpQueue, setFollowUpQueue] = useState<SakiFollowUpJob[]>([]);
  const followUpQueueRef = useRef<SakiFollowUpJob[]>([]);
  followUpQueueRef.current = followUpQueue;
  const submitRef = useRef<(event?: React.FormEvent<HTMLFormElement>, override?: SakiSubmitOverride) => Promise<void>>(
    async () => undefined
  );
  const lastRunCompletedRef = useRef(false);
  const [sakiActivityMood, setSakiActivityMood] = useState<SakiActivityMood>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState<SakiLauncherPosition>(() => {
    const raw = readSakiLauncherPosition();
    if (raw) return clampSakiLauncherPosition(raw, null, "expanded");
    const vw = globalThis.innerWidth || 1200;
    const vh = globalThis.innerHeight || 800;
    return {
      x: Math.max(12, vw - sakiLauncherExpandedSize.width - 24),
      y: Math.max(12, vh - sakiLauncherExpandedSize.height - 24)
    };
  });
  const [launcherDragging, setLauncherDragging] = useState(false);

  const launcherWindowListenersRef = useRef<{
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  } | null>(null);

  useEffect(() => {
    return () => {
      onLauncherDraggingChange?.(false);
      if (launcherWindowListenersRef.current) {
        window.removeEventListener("pointermove", launcherWindowListenersRef.current.onMove, true);
        window.removeEventListener("pointerup", launcherWindowListenersRef.current.onUp, true);
        window.removeEventListener("pointercancel", launcherWindowListenersRef.current.onUp, true);
        launcherWindowListenersRef.current = null;
      }
    };
  }, [onLauncherDraggingChange]);
  const [draggingExpression, setDraggingExpression] = useState<string | null>(null);
  const [storedConversations, setStoredConversations] = useState<StoredSakiConversation[]>(() => readSakiConversations());
  const [activeConversationId, setActiveConversationId] = useState(() => newClientId());
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const persistCloudTimerRef = useRef<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [copiedUserMessageId, setCopiedUserMessageId] = useState<string | null>(null);
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<SakiInputAttachment[]>([]);
  const [previewingAttachment, setPreviewingAttachment] = useState<{ attachment: SakiInputAttachment; editable: boolean } | null>(null);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [composerBusy, setComposerBusy] = useState<"image" | "file" | "screenshot" | null>(null);
  const [sakiFileHoverActive, setSakiFileHoverActive] = useState(false);

  const loadInstances = useCallback(async () => {
    if (!token) return;
    try {
      setInstancesLoading(true);
      const list = await api.instances(token);
      setAvailableInstances(list);
    } catch (err) {
      console.warn("[saki] failed to load instances for workspace selector:", err);
    } finally {
      setInstancesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (open && token && availableInstances.length === 0) {
      void loadInstances();
    }
  }, [availableInstances.length, loadInstances, open, token]);

  useEffect(() => {
    if (instance && !availableInstances.some((i) => i.id === instance.id)) {
      setAvailableInstances((prev) => [instance, ...prev]);
    }
  }, [availableInstances, instance]);

  useEffect(() => {
    if (!workspaceDropdownOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setWorkspaceDropdownOpen(false);
        setWorkspaceSearch("");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkspaceDropdownOpen(false);
        setWorkspaceSearch("");
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [workspaceDropdownOpen]);

  const [listening, setListening] = useState(false);
  const [sakiEchoState, setSakiEchoState] = useState<SakiVoiceEchoState>("idle");
  const [annotationMode, setAnnotationMode] = useState(false);
  const [sakiPokeMood, setSakiPokeMood] = useState<SakiActivityMood>(null);
  const [sakiSleepy, setSakiSleepy] = useState(false);
  const [sakiVideoBubble, setSakiVideoBubble] = useState<string | null>(null);
  const pokeTimerRef = useRef<number | null>(null);
  const pokeStreakRef = useRef({ count: 0, lastAt: 0 });
  const [customRoomBg, setCustomRoomBg] = useState<string | null>(() => {
    try {
      return localStorage.getItem("saki_custom_room_bg");
    } catch {
      return null;
    }
  });
  const roomBgInputRef = useRef<HTMLInputElement | null>(null);
  const [sakiFavorabilityExp, setSakiFavorabilityExp] = useState<number>(() => {
    if (typeof currentUserFavorability === "number") {
      return Math.max(0, currentUserFavorability);
    }
    try {
      const saved = localStorage.getItem("saki_favorability");
      return saved !== null ? Math.max(0, parseInt(saved, 10)) : 120;
    } catch {
      return 120;
    }
  });

  useEffect(() => {
    if (typeof currentUserFavorability === "number") {
      setSakiFavorabilityExp(Math.max(0, currentUserFavorability));
    }
  }, [currentUserFavorability]);
  const [favorabilityPop, setFavorabilityPop] = useState<{ id: number; amount: number } | null>(null);
  const favorabilityPopTimerRef = useRef<number | null>(null);

  const [userPoints, setUserPoints] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("saki_user_points");
      return saved !== null ? Math.max(0, parseInt(saved, 10)) : 200;
    } catch {
      return 200;
    }
  });

  const petStageRef = useRef<HTMLDivElement | null>(null);
  const pet = useSakiPet({
    enabled: !sakiLieMode,
    dragging: launcherDragging,
    chatOpen: open,
    edgeAttached: Boolean(launcherPosition?.edge),
    position: launcherPosition,
    setPosition: (next) => setLauncherPosition((curr) => (typeof next === "function" ? next(curr) ?? curr : next)),
    stageRef: petStageRef,
    intimacyLevel: getFavorabilityLevelInfoHelper(sakiFavorabilityExp, language).level
  });

  useEffect(() => {
    if (wakeCount > 0 && !pullDragRequest) {
      const viewportWidth = globalThis.innerWidth || 1200;
      const targetPos: SakiLauncherPosition = snapSakiLauncherPositionToEdge(
        { x: viewportWidth - sakiLauncherAttachedSize.width, y: 180 },
        "right",
        pet.scale
      );
      setLauncherPosition(targetPos);
      writeSakiLauncherPosition(targetPos);
      const stage = petStageRef.current;
      if (stage) {
        stage.style.left = "0px";
        stage.style.top = "0px";
        stage.style.right = "auto";
        stage.style.bottom = "auto";
        stage.style.setProperty("--saki-x", `${targetPos.x}px`);
        stage.style.setProperty("--saki-y", `${targetPos.y}px`);
        stage.style.transform = `translate(${targetPos.x}px, ${targetPos.y}px)`;
      }
    }
  }, [wakeCount, pullDragRequest, pet.scale]);

  const [feedMenuOpen, setFeedMenuOpen] = useState(false);
  const [miniGameActive, setMiniGameActive] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<"video" | "chat">("video");
  const [chatPulseAlert, setChatPulseAlert] = useState(false);
  const prevBusyRef = useRef<boolean>(false);

  interface DraggingFoodState {
    food: (typeof sakiFoodMenu)[number];
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isDragging: boolean;
  }

  const [draggingFood, setDraggingFood] = useState<DraggingFoodState | null>(null);
  const [isDragOverSaki, setIsDragOverSaki] = useState(false);
  const dragFoodRef = useRef<DraggingFoodState | null>(null);
  const sakiCharacterRef = useRef<HTMLDivElement | null>(null);
  const videoBubbleRef = useRef<HTMLDivElement | null>(null);

  function getFavorabilityLevelInfo(totalExp: number) {
    return getFavorabilityLevelInfoHelper(totalExp, language);
  }

  function addFavorabilityExp(amount: number) {
    if (token) {
      void api.addFavorability(token, amount).catch(() => {});
    }
    setSakiFavorabilityExp((prev) => {
      const oldLevel = getFavorabilityLevelInfo(prev).level;
      const next = prev + amount;
      const newLevel = getFavorabilityLevelInfo(next).level;
      onFavorabilityChange?.(next);
      try {
        localStorage.setItem("saki_favorability", String(next));
      } catch {}

      if (newLevel > oldLevel) {
        setSakiPokeMood("happy");
        setSakiVideoBubble(tFormat("saki.chat.levelUp", newLevel));
        if (pokeTimerRef.current) window.clearTimeout(pokeTimerRef.current);
        pokeTimerRef.current = window.setTimeout(() => {
          setSakiPokeMood(null);
          setSakiVideoBubble(null);
          pokeTimerRef.current = null;
        }, 4500);
      }
      return next;
    });

    if (favorabilityPopTimerRef.current !== null) {
      window.clearTimeout(favorabilityPopTimerRef.current);
    }
    setFavorabilityPop({ id: Date.now(), amount });
    favorabilityPopTimerRef.current = window.setTimeout(() => {
      setFavorabilityPop(null);
      favorabilityPopTimerRef.current = null;
    }, 1800);
  }

  function addUserPoints(amount: number) {
    setUserPoints((prev) => {
      const next = Math.max(0, prev + amount);
      try {
        localStorage.setItem("saki_user_points", String(next));
      } catch {}
      return next;
    });
  }

  const isUnlimitedPoints = pointsSummary?.unlimitedPoints ?? false;
  const currentSakiPointsDisplay = pointsSummary ? (pointsSummary.unlimitedPoints ? "∞" : pointsSummary.points) : userPoints;
  const numericSakiPoints = pointsSummary?.points ?? userPoints;

  function handleFeedSaki(food: (typeof sakiFoodMenu)[number]) {
    if (!isUnlimitedPoints && numericSakiPoints < food.cost) {
      setSakiPokeMood("pout");
      setSakiVideoBubble(t("saki.chat.notEnoughPoints"));
      if (pokeTimerRef.current) window.clearTimeout(pokeTimerRef.current);
      pokeTimerRef.current = window.setTimeout(() => {
        setSakiPokeMood(null);
        setSakiVideoBubble(null);
        pokeTimerRef.current = null;
      }, 3000);
      return;
    }

    if (!isUnlimitedPoints) {
      const nextPts = Math.max(0, numericSakiPoints - food.cost);
      onPointsBalanceChange?.({ points: nextPts, unlimitedPoints: false });
      addUserPoints(-food.cost);
      if (token) {
        void api.consumePoints(token, food.cost, `投喂 Saki: ${food.name}`).then((res) => {
          onPointsBalanceChange?.({ points: res.points, unlimitedPoints: res.unlimitedPoints });
          setUserPoints(res.points);
        }).catch((err) => {
          console.error("Failed to deduct points on feed:", err);
        });
      }
    }
    addFavorabilityExp(food.favorability);
    setSakiPokeMood(food.mood);
    setSakiVideoBubble(food.greeting);

    if (pokeTimerRef.current) window.clearTimeout(pokeTimerRef.current);
    pokeTimerRef.current = window.setTimeout(() => {
      setSakiPokeMood(null);
      setSakiVideoBubble(null);
      pokeTimerRef.current = null;
    }, 3800);
  }

  const startFoodDrag = (e: React.PointerEvent, food: (typeof sakiFoodMenu)[number]) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const canAfford = isUnlimitedPoints || numericSakiPoints >= food.cost;
    if (!canAfford) {
      handleFeedSaki(food);
      return;
    }

    const state: DraggingFoodState = {
      food,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      isDragging: false
    };
    dragFoodRef.current = state;
    setDraggingFood(state);

    const onMove = (ev: PointerEvent) => {
      if (!dragFoodRef.current) return;
      const dist = Math.hypot(ev.clientX - dragFoodRef.current.startX, ev.clientY - dragFoodRef.current.startY);
      const isDragging = dragFoodRef.current.isDragging || dist > 6;

      let over = false;
      if (sakiCharacterRef.current) {
        const rect = sakiCharacterRef.current.getBoundingClientRect();
        over =
          ev.clientX >= rect.left - 50 &&
          ev.clientX <= rect.right + 50 &&
          ev.clientY >= rect.top - 60 &&
          ev.clientY <= rect.bottom + 40;
      }

      dragFoodRef.current = {
        ...dragFoodRef.current,
        currentX: ev.clientX,
        currentY: ev.clientY,
        isDragging
      };
      setDraggingFood({ ...dragFoodRef.current });
      setIsDragOverSaki(over);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      const current = dragFoodRef.current;
      dragFoodRef.current = null;
      setDraggingFood(null);
      setIsDragOverSaki(false);

      if (!current) return;

      let over = false;
      if (sakiCharacterRef.current) {
        const rect = sakiCharacterRef.current.getBoundingClientRect();
        over =
          ev.clientX >= rect.left - 50 &&
          ev.clientX <= rect.right + 50 &&
          ev.clientY >= rect.top - 60 &&
          ev.clientY <= rect.bottom + 40;
      }

      if (over && current.isDragging) {
        handleFeedSaki(current.food);
      } else if (!current.isDragging) {
        handleFeedSaki(current.food);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  function handleMiniGameFinish(score: number, expReward: number) {
    addFavorabilityExp(expReward);
    setSakiPokeMood("gaming");
    setSakiVideoBubble(tFormat("saki.chat.miniGameFinish", score, expReward));
    if (pokeTimerRef.current) window.clearTimeout(pokeTimerRef.current);
    pokeTimerRef.current = window.setTimeout(() => {
      setSakiPokeMood(null);
      setSakiVideoBubble(null);
      pokeTimerRef.current = null;
    }, 4500);
  }
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelPointsMultipliers, setModelPointsMultipliers] = useState<Record<string, number>>({});
  const [permissionDropdownOpen, setPermissionDropdownOpen] = useState(false);
  const [sakiAddMenuOpen, setSakiAddMenuOpen] = useState(false);
  const [mentionCaret, setMentionCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissedStart, setMentionDismissedStart] = useState<number | null>(null);
  const modelSelectorRef = useRef<HTMLDivElement | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const permissionSelectorRef = useRef<HTMLDivElement | null>(null);
  const permissionDropdownRef = useRef<HTMLDivElement | null>(null);
  const sakiAddBtnRef = useRef<HTMLButtonElement | null>(null);
  const sakiAddMenuRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const suppressPanelDismissRef = useRef(false);
  const suppressPanelDismissTimerRef = useRef<number | null>(null);
  const nativeDialogFocusHandlerRef = useRef<(() => void) | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechBaseDraftRef = useRef("");
  const sakiVoiceEchoRef = useRef<SakiVoiceEcho | null>(null);
  const sakiEchoHintShownRef = useRef(false);
  const sakiHoldTimerRef = useRef<number | null>(null);
  const sakiHoldActiveRef = useRef(false);
  const sakiHoldPointerRef = useRef<number | null>(null);
  const composerNoticeTimerRef = useRef<number | null>(null);
  const sakiStreamAbortRef = useRef<AbortController | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const userStoppedRef = useRef(false);
  const sakiMessagesRef = useRef<HTMLDivElement | null>(null);
  const sakiAutoScrollRef = useRef(true);
  const sakiFileDragDepthRef = useRef(0);
  const launcherDragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
    slop: number;
  } | null>(null);
  const suppressLauncherClickRef = useRef(false);
  const conversationsRef = useRef<Record<string, LocalSakiMessage[]>>({});
  const previousContextKeyRef = useRef(contextKey);
  const restoringContextRef = useRef(false);
  const annotationModeRef = useRef(false);
  const launcherAttachedEdge = launcherPosition ? sakiLauncherAttachedEdgeForPosition(launcherPosition, pet.scale) : null;
  const launcherEdgeAttached = Boolean(launcherAttachedEdge) && !open && !launcherDragging && !sakiFileHoverActive && !fileDragActive;

  useEffect(() => {
    return () => {
      sakiStreamAbortRef.current?.abort();
      recognitionRef.current?.abort();
      sakiVoiceEchoRef.current?.stop();
      document.body.classList.remove("saki-selection-capture-active");
      if (composerNoticeTimerRef.current !== null) {
        window.clearTimeout(composerNoticeTimerRef.current);
      }
      if (pokeTimerRef.current !== null) {
        window.clearTimeout(pokeTimerRef.current);
      }
      if (sakiHoldTimerRef.current !== null) {
        window.clearTimeout(sakiHoldTimerRef.current);
      }
      if (suppressPanelDismissTimerRef.current !== null) {
        window.clearTimeout(suppressPanelDismissTimerRef.current);
      }
      if (nativeDialogFocusHandlerRef.current) {
        window.removeEventListener("focus", nativeDialogFocusHandlerRef.current);
        nativeDialogFocusHandlerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    annotationModeRef.current = annotationMode;
  }, [annotationMode]);

  useEffect(() => {
    if (open && !sakiLieMode && !sakiEchoHintShownRef.current) {
      sakiEchoHintShownRef.current = true;
      setSakiVideoBubble("点按戳戳我，长按说话我会学你～ ♪");
      if (pokeTimerRef.current !== null) window.clearTimeout(pokeTimerRef.current);
      pokeTimerRef.current = window.setTimeout(() => {
        setSakiVideoBubble(null);
        pokeTimerRef.current = null;
      }, 3800);
    }
  }, [open, sakiLieMode]);

  useEffect(() => {
    const keepEngine = open && !sakiLieMode;
    if (listening || miniGameActive || mobileActiveTab !== "video" || !keepEngine) {
      if (sakiHoldTimerRef.current !== null) {
        window.clearTimeout(sakiHoldTimerRef.current);
        sakiHoldTimerRef.current = null;
      }
      sakiHoldActiveRef.current = false;
      sakiHoldPointerRef.current = null;
      sakiVoiceEchoRef.current?.cancelHold();
    }
    if (keepEngine) return;
    sakiVoiceEchoRef.current?.stop();
    sakiVoiceEchoRef.current = null;
    setSakiEchoState("idle");
  }, [open, listening, miniGameActive, sakiLieMode, mobileActiveTab]);

  const refreshSakiModels = useCallback(async () => {
    let currentModel = "";
    try {
      const config = await api.sakiConfig(token);
      currentModel = config.model;
      setModelPointsMultipliers(config.modelPointsMultipliers || {});
      onCurrentModelIdChange(currentModel);
      const result = await api.sakiModels(token, {
        provider: config.provider,
        model: config.model,
        ollamaUrl: config.ollamaUrl,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        providerConfigs: config.providerConfigs
      });
      onAvailableModelsChange(result.models);
      const current = result.models.find((m) => m.id === currentModel);
      if (current) {
        onCurrentModelNameChange(current.label || current.name || current.id);
      } else if (currentModel) {
        onCurrentModelNameChange(currentModel);
      }
    } catch {
      if (currentModel) {
        onCurrentModelNameChange(currentModel);
      }
    }
  }, [token, onCurrentModelIdChange, onCurrentModelNameChange, onAvailableModelsChange]);

  useEffect(() => {
    void refreshSakiModels();
  }, [refreshSakiModels]);

  // 设置页可能刚改过服务商 / 连接方式 / API Key：每次打开模型下拉都实时同步一次，
  // 避免下拉里长期展示旧的（如反代模式下的）模型列表。
  useEffect(() => {
    if (modelDropdownOpen) void refreshSakiModels();
  }, [modelDropdownOpen, refreshSakiModels]);

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideSelector = modelSelectorRef.current?.contains(target);
      const isInsideDropdown = modelDropdownRef.current?.contains(target);
      if (!isInsideSelector && !isInsideDropdown) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelDropdownOpen]);

  useEffect(() => {
    if (!permissionDropdownOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideSelector = permissionSelectorRef.current?.contains(target);
      const isInsideDropdown = permissionDropdownRef.current?.contains(target);
      if (!isInsideSelector && !isInsideDropdown) {
        setPermissionDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [permissionDropdownOpen]);

  useEffect(() => {
    if (!sakiAddMenuOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideBtn = sakiAddBtnRef.current?.contains(target);
      const isInsideMenu = sakiAddMenuRef.current?.contains(target);
      if (!isInsideBtn && !isInsideMenu) {
        setSakiAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sakiAddMenuOpen]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 180);
    textarea.style.height = `${Math.max(nextHeight, 38)}px`;
  }, [draft]);

  const currentListedModel = availableModels.find((model) => model.id === currentModelId);
  const currentModelSupportsVision = currentListedModel
    ? sakiListedModelSupportsVision(currentListedModel)
    : sakiModelSupportsVision(currentModelId);
  const mentionCandidates = useMemo(() => {
    const active = activeSakiMentionQuery(draft, mentionCaret);
    if (!active || mentionDismissedStart === active.start) return [];
    return filterSakiMentionCandidates(attachments, active.query);
  }, [attachments, draft, mentionCaret, mentionDismissedStart]);
  const mentionMenuOpen =
    Boolean(activeSakiMentionQuery(draft, mentionCaret)) &&
    mentionDismissedStart !== activeSakiMentionQuery(draft, mentionCaret)?.start &&
    attachments.some(isSakiImageAttachment);

  useEffect(() => {
    setMentionIndex(0);
  }, [draft, mentionCaret, mentionDismissedStart]);

  function syncMentionCaret(target: HTMLTextAreaElement) {
    setMentionCaret(target.selectionStart);
  }

  function applyMention(attachment: SakiInputAttachment) {
    const textarea = composerTextareaRef.current;
    const caret = textarea?.selectionStart ?? mentionCaret;
    const next = insertSakiMention(draft, caret, attachment);
    setDraft(next.text);
    setMentionCaret(next.caret);
    setMentionDismissedStart(null);
    window.requestAnimationFrame(() => {
      const element = composerTextareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
      setMentionCaret(next.caret);
    });
  }

  useEffect(() => {
    const element = sakiMessagesRef.current;
    if (!element || !open) return;
    const latestMessage = messages.at(-1);
    const shouldFollow = sakiAutoScrollRef.current || Boolean(latestMessage?.streaming);
    if (!shouldFollow) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, open, messagesExpanded, fullscreen]);

  const reconnectSeqRef = useRef(0);

  // Reconnects to the running task stream for the current context. Runs on
  // mount/context change, and is also triggered by an empty-message seed
  // (Agent monitor bell jump) so revisiting the same instance still resumes.
  async function reconnectActiveTask() {
    if (!token || loading) return;
    userStoppedRef.current = false;
    const seq = ++reconnectSeqRef.current;
    const checkActiveTask = async () => {
      try {
        const result = await api.sakiGetActiveTask(token, activeInstance?.id);
        if (seq !== reconnectSeqRef.current) return;
        if (!result.hasActiveTask || !result.task || result.task.status !== "running") {
          activeTaskIdRef.current = null;
          setSakiActivityMood((prev) => (isSakiWorkMood(prev) ? null : prev));
          settleInterruptedSakiMessage();
          return;
        }
        const task = result.task;
        if (task.status === "running") {
          activeTaskIdRef.current = task.id;

          let assistantId = "";
          setMessages((current) => {
            const lastMsg = current.at(-1);
            if (lastMsg && lastMsg.role === "assistant") {
              assistantId = lastMsg.id;
              // The persisted copy may hold partial streamed content from before the
              // refresh; the replayed event buffer is the source of truth, so reset
              // all transient stream state before applying replayed events.
              return current.map((msg) =>
                msg.id === assistantId
                  ? {
                      ...msg,
                      content: "",
                      thinking: undefined,
                      timeline: [],
                      actions: [],
                      workflow: [],
                      streaming: true
                    }
                  : msg
              );
            }
            assistantId = newClientId();
            const hasMatchingUser = current.some(
              (msg) => msg.role === "user" && msg.content === task.message
            );
            const userMessage: LocalSakiMessage = {
              id: newClientId(),
              role: "user",
              content: task.message,
              createdAt: task.startedAt
            };
            const assistantMessage: LocalSakiMessage = {
              id: assistantId,
              role: "assistant",
              content: "",
              createdAt: task.startedAt,
              source: "direct-model",
              timeline: [],
              workflowExpanded: false,
              streaming: true
            };
            return hasMatchingUser
              ? [...current, assistantMessage]
              : [...current, userMessage, assistantMessage];
          });

          setSakiActivityMood("working");
          setLoading(true);

          const abortController = new AbortController();
          sakiStreamAbortRef.current = abortController;

          const applyStreamEvent = (streamEvent: SakiChatStreamEvent) => {
            if (abortController.signal.aborted) return;
            if (streamEvent.type === "meta") {
              setReachable(streamEvent.source === "direct-model");
              if (streamEvent.taskId) {
                activeTaskIdRef.current = streamEvent.taskId;
              }
              return;
            }
            if (streamEvent.type === "heartbeat") return;
            if (streamEvent.type === "thinking") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        thinking: `${message.thinking ?? ""}${streamEvent.text}`,
                        thinkingStartedAt: message.thinkingStartedAt ?? Date.now(),
                        timeline: appendSakiTimelineThinking(message.timeline, streamEvent.text)
                      }
                    : message
                )
              );
              return;
            }
            if (streamEvent.type === "delta") {
              setMessages((current) =>
                current.map((message) => {
                  if (message.id !== assistantId) return message;
                  const durationSec =
                    message.thinking && message.thinkingStartedAt && !message.thinkingDurationSec
                      ? Math.max(1, Math.round((Date.now() - message.thinkingStartedAt) / 1000))
                      : message.thinkingDurationSec;
                  return {
                    ...message,
                    ...(durationSec ? { thinkingDurationSec: durationSec } : {}),
                    timeline: appendSakiTimelineDelta(message.timeline, streamEvent.text)
                  };
                })
              );
              return;
            }
            if (streamEvent.type === "workflow") {
              const chatText = workflowEventChatText(streamEvent);
              setMessages((current) =>
                current.map((message) => {
                  if (message.id !== assistantId) return message;
                  const workflow = message.workflow ?? [];
                  const existing = workflow.find((step) => step.id === streamEvent.id);
                  const nextStep: LocalSakiWorkflowStep = {
                    id: streamEvent.id,
                    stage: streamEvent.stage,
                    message: streamEvent.message,
                    status: streamEvent.status,
                    ...(streamEvent.tool ? { tool: streamEvent.tool } : {}),
                    ...(streamEvent.call ? { call: streamEvent.call } : {}),
                    ...(streamEvent.actionId ? { actionId: streamEvent.actionId } : {}),
                    ...(streamEvent.detail ? { detail: streamEvent.detail } : {}),
                    createdAt: existing?.createdAt ?? new Date().toISOString()
                  };
                  let timeline = message.timeline;
                  if (chatText) {
                    timeline = upsertSakiTimelineText(timeline, {
                      id: `workflow:${streamEvent.id}`,
                      content: chatText,
                      source: "workflow",
                      createdAt: nextStep.createdAt
                    });
                  } else if (streamEvent.tool && streamEvent.stage === "tool" && streamEvent.status === "running") {
                    timeline = upsertSakiTimelinePending(timeline, {
                      id: streamEvent.id,
                      tool: streamEvent.tool,
                      ...(streamEvent.call ? { call: streamEvent.call } : {}),
                      message: streamEvent.message,
                      createdAt: nextStep.createdAt
                    });
                  }
                  return {
                    ...message,
                    ...(timeline !== message.timeline ? { timeline } : {}),
                    workflow: existing
                      ? workflow.map((step) => (step.id === streamEvent.id ? nextStep : step))
                      : [...workflow, nextStep]
                  };
                })
              );
              return;
            }
            if (streamEvent.type === "action") {
              setMessages((current) =>
                current.map((message) => {
                  if (message.id !== assistantId) return message;
                  const actions = message.actions ?? [];
                  const exists = actions.some((action) => action.id === streamEvent.action.id);
                  return {
                    ...message,
                    actions: exists
                      ? actions.map((action) => (action.id === streamEvent.action.id ? streamEvent.action : action))
                      : [...actions, streamEvent.action],
                    timeline: settleSakiTimelinePending(sealSakiTimelineDelta(message.timeline), streamEvent.action)
                  };
                })
              );
              return;
            }
            if (streamEvent.type === "done") {
              const response = streamEvent.response;
              activeTaskIdRef.current = null;
              const finishedActions = response.actions ?? [];
              if (finishedActions.some((action) => action.status === "pending_approval")) {
                setSakiActivityMood("waiting");
              } else if (finishedActions.some((action) => action.status === "failed" || action.ok === false)) {
                setSakiActivityMood("sorry");
              } else {
                const doneMoods: NonNullable<SakiActivityMood>[] = ["happy", "OK", "wink"];
                setSakiActivityMood(doneMoods[Math.floor(Math.random() * doneMoods.length)] ?? "happy");
              }
              setMessages((current) => {
                const next = current.map((message) => {
                  if (message.id !== assistantId) return message;
                  const nextActions = response.actions?.length ? response.actions : message.actions;
                  const sealedTimeline = sealSakiTimelineDelta(message.timeline);
                  const finalTimeline = mergeSakiTimelineActions(mergeSakiFinalTimeline(sealedTimeline, response.message), nextActions);
                  const durationSec =
                    message.thinkingStartedAt && !message.thinkingDurationSec
                      ? Math.max(1, Math.round((Date.now() - message.thinkingStartedAt) / 1000))
                      : message.thinkingDurationSec;
                  const mergedAttachments = mergeSakiMessageAttachments(
                    message.attachments,
                    response.attachments,
                    nextActions
                  );
                  const nextMessage: LocalSakiMessage = {
                    ...message,
                    content: response.message,
                    thinking: response.thinking ?? message.thinking,
                    ...(durationSec ? { thinkingDurationSec: durationSec } : {}),
                    timeline: finalTimeline,
                    source: response.source,
                    workflowExpanded: false,
                    streaming: false,
                    usage: response.usage,
                    ...(mergedAttachments.length ? { attachments: mergedAttachments } : {})
                  };
                  if (nextActions?.length) return { ...nextMessage, actions: nextActions };
                  return nextMessage;
                });
                queueMicrotask(() => {
                  saveConversationStateDirectly(next, activeConversationIdRef.current);
                });
                return next;
              });
            }
            if (streamEvent.type === "error") {
              activeTaskIdRef.current = null;
              setMessages((current) => {
                const next = current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        content: message.content ? `${message.content}\n\n${streamEvent.message}` : streamEvent.message,
                        timeline: upsertSakiTimelineText(sealSakiTimelineDelta(message.timeline), {
                          id: `error:${newClientId()}`,
                          content: streamEvent.message,
                          source: "error"
                        }),
                        streaming: false
                      }
                    : message
                );
                queueMicrotask(() => {
                  saveConversationStateDirectly(next, activeConversationIdRef.current);
                });
                return next;
              });
            }
          };

          try {
            const finalResp = await api.sakiStreamTaskReconnect(token, task.id, applyStreamEvent, abortController.signal);
            activeTaskIdRef.current = null;
            const finishedActions = finalResp.actions ?? [];
            if (finishedActions.some((action) => action.status === "pending_approval")) {
              setSakiActivityMood("waiting");
            } else if (finishedActions.some((action) => action.status === "failed" || action.ok === false)) {
              setSakiActivityMood("sorry");
            } else {
              const doneMoods: NonNullable<SakiActivityMood>[] = ["happy", "OK", "wink"];
              setSakiActivityMood(doneMoods[Math.floor(Math.random() * doneMoods.length)] ?? "happy");
            }
            if (finalResp.usage?.isUnlimited) {
              onPointsBalanceChange?.({ points: 0, unlimitedPoints: true });
            } else if (typeof finalResp.usage?.remainingPoints === "number") {
              onPointsBalanceChange?.({ points: finalResp.usage.remainingPoints, unlimitedPoints: false });
            }
            setMessages((current) => {
              const next = current.map((message) => {
                if (message.id !== assistantId) return message;
                const nextActions = finalResp.actions?.length ? finalResp.actions : message.actions;
                const sealedTimeline = sealSakiTimelineDelta(message.timeline);
                const finalTimeline = mergeSakiTimelineActions(mergeSakiFinalTimeline(sealedTimeline, finalResp.message), nextActions);
                const durationSec =
                  message.thinkingStartedAt && !message.thinkingDurationSec
                    ? Math.max(1, Math.round((Date.now() - message.thinkingStartedAt) / 1000))
                    : message.thinkingDurationSec;
                const nextMessage: LocalSakiMessage = {
                  ...message,
                  content: finalResp.message,
                  thinking: finalResp.thinking ?? message.thinking,
                  ...(durationSec ? { thinkingDurationSec: durationSec } : {}),
                  timeline: finalTimeline,
                  source: finalResp.source,
                  workflowExpanded: false,
                  streaming: false,
                  usage: finalResp.usage
                };
                if (nextActions?.length) return { ...nextMessage, actions: nextActions };
                return nextMessage;
              });
              queueMicrotask(() => {
                saveConversationStateDirectly(next, activeConversationIdRef.current);
              });
              return next;
            });
          } catch {
            settleInterruptedSakiMessage(assistantId);
          } finally {
            setLoading(false);
            setSakiActivityMood((prev) => (isSakiWorkMood(prev) ? null : prev));
            activeTaskIdRef.current = null;
          }
        }
      } catch {
      }
    };
    await checkActiveTask();
  }

  useEffect(() => {
    void reconnectActiveTask();
  }, [token, activeInstance?.id]);

  async function selectModel(modelId: string) {
    onCurrentModelIdChange(modelId);
    const found = availableModels.find((m) => m.id === modelId);
    if (found) {
      onCurrentModelNameChange(found.label || found.name || found.id);
    } else {
      onCurrentModelNameChange(modelId);
    }
    try {
      await api.updateSakiConfig(token, { model: modelId });
    } catch {}
  }

  function handleSakiMessagesScroll(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    sakiAutoScrollRef.current = distanceFromBottom < 96;
  }

  useEffect(() => {
    setMode((current) => coerceSakiMode(current, canUseChat, canUseAgent));
  }, [canUseAgent, canUseChat]);

  useEffect(() => {
    function handleGlobalPointerDown(event: PointerEvent) {
      if (annotationMode) return;
      if (suppressPanelDismissRef.current) return;
      if (previewingAttachment) return;
      const target = event.target as Node;
      if ((target as Element)?.closest?.(".saki-attachment-lightbox-overlay, .saki-attachment-modal, .glass-modal-overlay")) {
        return;
      }
      const isInsidePanel = panelRef.current?.contains(target);
      const isInsideModelDropdown = modelDropdownRef.current?.contains(target);
      const isInsideModelSelector = modelSelectorRef.current?.contains(target);
      const isInsideAddMenu = sakiAddMenuRef.current?.contains(target);
      const isInsidePermissionDropdown = permissionDropdownRef.current?.contains(target);
      if (
        open &&
        !isInsidePanel &&
        !isInsideModelDropdown &&
        !isInsideModelSelector &&
        !isInsideAddMenu &&
        !isInsidePermissionDropdown
      ) {
        setOpen(false);
        setMessagesExpanded(false);
      }
    }
    document.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleGlobalPointerDown);
    };
  }, [annotationMode, open, previewingAttachment]);

  useEffect(() => {
    function clearFileDragState() {
      sakiFileDragDepthRef.current = 0;
      setSakiFileHoverActive(false);
    }
    window.addEventListener("dragend", clearFileDragState);
    window.addEventListener("drop", clearFileDragState);
    return () => {
      window.removeEventListener("dragend", clearFileDragState);
      window.removeEventListener("drop", clearFileDragState);
    };
  }, []);

  useEffect(() => {
    if (!annotationMode) return;

    document.body.classList.add("saki-selection-capture-active");

    const finishSelection = (target: EventTarget | null) => {
      window.setTimeout(() => {
        if (!annotationModeRef.current) return;
        const capture = readSakiSelectionCapture(target);
        if (!capture) return;
        applySakiSelectionCapture(capture);
      }, 0);
    };

    const handlePointerFinished = (event: MouseEvent | TouchEvent) => {
      finishSelection(event.target);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopSelectionAnnotation("已取消注释选择。");
        return;
      }
      finishSelection(event.target);
    };

    document.addEventListener("mouseup", handlePointerFinished, true);
    document.addEventListener("touchend", handlePointerFinished, true);
    document.addEventListener("keyup", handleKeyUp, true);

    return () => {
      document.body.classList.remove("saki-selection-capture-active");
      document.removeEventListener("mouseup", handlePointerFinished, true);
      document.removeEventListener("touchend", handlePointerFinished, true);
      document.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [annotationMode]);

  // NOTE: Saki always starts a fresh conversation when the panel mounts —
  // past conversations stay available in the history panel but are never auto-restored.

  const syncConversationToCloud = useCallback((conv: StoredSakiConversation) => {
    if (!token || !hasPersistableSakiSpeech(conv.messages)) return;
    void api.sakiSaveConversation(token, {
      id: conv.id,
      contextKey: conv.contextKey,
      title: conv.title,
      label: conv.label,
      detail: conv.detail,
      instanceId: conv.instanceId ?? null,
      messages: conv.messages
    }).catch((err) => {
      console.warn("[saki] failed to save conversation to cloud:", err);
    });
  }, [token]);

  const saveConversationStateDirectly = useCallback(
    (targetMessages: LocalSakiMessage[], conversationId?: string) => {
      const targetId = conversationId || activeConversationIdRef.current;
      conversationsRef.current[contextKey] = targetMessages;
      if (!hasPersistableSakiSpeech(targetMessages)) {
        return;
      }
      const now = new Date().toISOString();
      const storedMessages = persistableSakiMessages(targetMessages);
      let nextToPersist: StoredSakiConversation | null = null;

      setStoredConversations((current) => {
        const existing = current.find((conversation) => conversation.id === targetId);
        const nextConversation: StoredSakiConversation = {
          id: targetId,
          contextKey: existing?.contextKey ?? contextKey,
          label: existing?.label ?? baseContextLabel,
          detail: existing?.detail ?? baseContextPath,
          instanceId: (existing?.instanceId ?? activeInstance?.id) || null,
          title: sakiConversationTitle(storedMessages),
          messages: storedMessages,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };
        nextToPersist = nextConversation;
        const next = sortSakiConversationsByTime([
          nextConversation,
          ...current.filter((conversation) => conversation.id !== targetId)
        ]).slice(0, 80);
        writeSakiConversations(next);
        return next;
      });

      if (token && nextToPersist) {
        const isCurrentlyStreaming = targetMessages.some((m) => m.streaming);
        if (!isCurrentlyStreaming) {
          syncConversationToCloud(nextToPersist);
        } else {
          if (persistCloudTimerRef.current) window.clearTimeout(persistCloudTimerRef.current);
          persistCloudTimerRef.current = window.setTimeout(() => {
            if (nextToPersist) syncConversationToCloud(nextToPersist);
            persistCloudTimerRef.current = null;
          }, 2000);
        }
      }
    },
    [baseContextLabel, baseContextPath, contextKey, activeInstance?.id, syncConversationToCloud, token]
  );

  useEffect(() => {
    const previousContextKey = previousContextKeyRef.current;
    if (previousContextKey === contextKey) return;

    if (hasPersistableSakiSpeech(messages)) {
      conversationsRef.current[previousContextKey] = messages;
      saveConversationStateDirectly(messages, activeConversationIdRef.current);
    }
    previousContextKeyRef.current = contextKey;

    // If an agent task is actively executing or streaming, or if the current chat has active conversation,
    // NEVER drop or wipe the active conversation when the user navigates between views or back to the instance list!
    if (loading || activeTaskIdRef.current || hasPersistableSakiSpeech(messages)) {
      return;
    }

    // Always start a fresh conversation when switching views/instances —
    // stored conversations remain in history but are not auto-restored.
    restoringContextRef.current = true;
    const newId = newClientId();
    activeConversationIdRef.current = newId;
    setActiveConversationId(newId);
    setMessages([
      createSakiWelcomeMessage(getSakiWelcomeMessageText(activeInstance, activePanelContext.label))
    ]);
    setDraft("");
    setPanelError(null);
    setContextTitle(null);
    setContextText(null);
    setSelectedSkillIds([]);
    setAttachments([]);
    setComposerNotice(null);
    setMode(coerceSakiMode("agent", canUseChat, canUseAgent));
    setPermissionMode(defaultSakiAgentPermissionMode);
  }, [canUseAgent, canUseChat, contextKey, activeInstance, loading, messages, activePanelContext.label, saveConversationStateDirectly]);

  useEffect(() => {
    if (restoringContextRef.current) {
      restoringContextRef.current = false;
      return;
    }
    saveConversationStateDirectly(messages);
  }, [messages, saveConversationStateDirectly]);

  useEffect(() => {
    if (!token) return;
    let disposed = false;
    async function syncCloudConversations() {
      try {
        const cloudRows = await api.sakiListConversations(token);
        if (disposed || !Array.isArray(cloudRows) || cloudRows.length === 0) return;
        setStoredConversations((currentLocal) => {
          const map = new Map<string, StoredSakiConversation>();
          for (const item of currentLocal) {
            map.set(item.id, item);
          }
          for (const row of cloudRows) {
            const local = map.get(row.id);
            if (!local || new Date(row.updatedAt).getTime() >= new Date(local.updatedAt).getTime()) {
              map.set(row.id, {
                id: row.id,
                contextKey: row.contextKey,
                label: row.label,
                detail: row.detail,
                instanceId: row.instanceId ?? null,
                title: row.title,
                messages: row.messages,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt
              });
            }
          }
          const merged = sortSakiConversationsByTime([...map.values()]).slice(0, 80);
          writeSakiConversations(merged);
          // Do not auto-restore the latest cloud conversation — the current
          // (fresh) conversation stays active; history remains listed.
          return merged;
        });
      } catch {
        // Fallback to local
      }
    }
    void syncCloudConversations();
    return () => {
      disposed = true;
    };
  }, [contextKey, token]);

  useEffect(() => {
    if (!seed) return;
    setOpen(true);
    setDraft(seed.message);
    setPanelError(seed.panelError ?? null);
    setContextTitle(seed.contextTitle ?? null);
    setContextText(seed.contextText ?? null);
    setMode(coerceSakiMode(seed.mode, canUseChat, canUseAgent));
    // An empty message means the panel was opened from the Agent monitor
    // bell: nothing to seed into the composer, just resume any running task
    // stream for this context.
    if (!seed.message.trim()) void reconnectActiveTask();
  }, [canUseAgent, canUseChat, seed]);

  useEffect(() => {
    if (!instanceFileDropRequest) return;
    void addInstanceFileToComposer(instanceFileDropRequest);
  }, [instanceFileDropRequest]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    async function refreshSkills() {
      setSkillsLoading(true);
      try {
        const status = await api.sakiStatus(token);
        let nextSkills = status.skills;
        if (canUseSkills) {
          try {
            nextSkills = await api.sakiSkills(token, activeInstance ? `${activeInstance.name} ${activeInstance.workingDirectory} coding agent` : "coding agent");
          } catch {
            nextSkills = status.skills;
          }
        }
        if (disposed) return;
        setReachable(status.reachable);
        setSkills(nextSkills.length > 0 ? nextSkills : status.skills);
      } catch {
        if (!disposed) {
          setReachable(false);
          setSkills([]);
        }
      } finally {
        if (!disposed) {
          setSkillsLoading(false);
        }
      }
    }
    void refreshSkills();
    return () => {
      disposed = true;
    };
  }, [canUseSkills, activeInstance, open, token]);

  useEffect(() => {
    function clampCurrentLauncherPosition() {
      setLauncherPosition((current) => {
        const attachedEdge = sakiLauncherAttachedEdgeForPosition(current, pet.scale);
        const nextPosition = attachedEdge
          ? snapSakiLauncherPositionToEdge(current, attachedEdge, pet.scale)
          : clampSakiLauncherPosition(current, launcherRef.current, "expanded", pet.scale);
        if (sameSakiLauncherPosition(current, nextPosition)) return current;
        writeSakiLauncherPosition(nextPosition);
        return nextPosition;
      });
    }

    clampCurrentLauncherPosition();
    globalThis.addEventListener?.("resize", clampCurrentLauncherPosition);
    return () => {
      globalThis.removeEventListener?.("resize", clampCurrentLauncherPosition);
    };
  }, [pet.scale]);

  function highlightLieDropTarget(clientX: number, clientY: number) {
    const lieSlot = document.querySelector(".topbar-lie-slot") as HTMLElement | null;
    const companionPanel = document.querySelector(".topbar-companion-panel") as HTMLElement | null;
    if (!companionPanel) return;
    const rect = (lieSlot ?? companionPanel).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.hypot(clientX - centerX, clientY - centerY);
    const isNear =
      dist < 60 ||
      (clientX >= rect.left - 20 && clientX <= rect.right + 20 && clientY >= rect.top - 20 && clientY <= rect.bottom + 30);
    companionPanel.classList.toggle("is-drag-near", isNear);
  }

  function isOverLieDropTarget(clientX: number, clientY: number): boolean {
    const companionPanel = document.querySelector(".topbar-companion-panel") as HTMLElement | null;
    const lieSlot = document.querySelector(".topbar-lie-slot") as HTMLElement | null;
    if (lieSlot || companionPanel) {
      const rect = (lieSlot ?? companionPanel)!.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - centerX, clientY - centerY);
      return (
        dist < 45 ||
        (clientX >= rect.left - 10 && clientX <= rect.right + 10 && clientY >= rect.top - 10 && clientY <= rect.bottom + 15)
      );
    }
    return false;
  }

  function updateLauncherDrag(pointerId: number, clientX: number, clientY: number, sizeElement?: HTMLElement | null) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    if (!drag.moved) {
      if (distance <= (drag.slop ?? 3)) return;
      drag.moved = true;
      pet.dismissMenu();
      setDraggingExpression(Math.random() > 0.5 ? sakiArtAssets.pickup1 : sakiArtAssets.pickup2);
      setLauncherDragging(true);
      onLauncherDraggingChange?.(true);
      const stage = petStageRef.current ?? (sizeElement as HTMLElement | null);
      if (stage) {
        stage.style.left = "0px";
        stage.style.top = "0px";
        stage.style.right = "auto";
        stage.style.bottom = "auto";
      }
    }

    highlightLieDropTarget(clientX, clientY);

    const stage = petStageRef.current ?? (sizeElement as HTMLElement | null);
    const desiredVisualLeft = clientX - drag.offsetX;
    const desiredVisualTop = clientY - drag.offsetY;
    const scale = pet.scale || 1;
    const baseWidth = sakiLauncherExpandedSize.width;
    const baseHeight = sakiLauncherExpandedSize.height;
    const rawX = desiredVisualLeft - (baseWidth / 2) * (1 - scale);
    const rawY = desiredVisualTop - baseHeight * (1 - scale);

    const livePosition = clampSakiLauncherPosition(
      { x: rawX, y: rawY },
      stage,
      "dragging",
      scale
    );

    if (stage) {
      stage.style.left = "0px";
      stage.style.top = "0px";
      stage.style.right = "auto";
      stage.style.bottom = "auto";
      stage.style.setProperty("--saki-x", `${livePosition.x}px`);
      stage.style.setProperty("--saki-y", `${livePosition.y}px`);
      stage.style.transform = `translate(${livePosition.x}px, ${livePosition.y}px)`;
    }
  }

  function completeLauncherDrag(pointerId: number, clientX: number, clientY: number, sizeElement?: HTMLElement | null) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    document.querySelector(".topbar-companion-panel")?.classList.remove("is-drag-near");
    const target = sizeElement ?? launcherRef.current;
    if (target?.hasPointerCapture(pointerId)) {
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already be released.
      }
    }

    if (drag.moved && isOverLieDropTarget(clientX, clientY)) {
      onReturnToLie?.();
      launcherDragRef.current = null;
      setLauncherDragging(false);
      onLauncherDraggingChange?.(false);
      setDraggingExpression(null);
      suppressLauncherClickRef.current = true;
      globalThis.setTimeout(() => {
        suppressLauncherClickRef.current = false;
      }, 150);
      return;
    }

    if (drag.moved) {
      const stage = petStageRef.current ?? (sizeElement as HTMLElement | null);
      const desiredVisualLeft = clientX - drag.offsetX;
      const desiredVisualTop = clientY - drag.offsetY;
      const scale = pet.scale || 1;
      const baseWidth = sakiLauncherExpandedSize.width;
      const baseHeight = sakiLauncherExpandedSize.height;
      const rawX = desiredVisualLeft - (baseWidth / 2) * (1 - scale);
      const rawY = desiredVisualTop - baseHeight * (1 - scale);
      const dragPosition = clampSakiLauncherPosition(
        { x: rawX, y: rawY },
        stage,
        "dragging",
        scale
      );
      const snapEdge = sakiLauncherSnapEdgeForPosition(dragPosition, scale);
      const nextPosition = snapEdge ? snapSakiLauncherPositionToEdge(dragPosition, snapEdge, scale) : dragPosition;

      if (stage) {
        stage.style.left = "0px";
        stage.style.top = "0px";
        stage.style.right = "auto";
        stage.style.bottom = "auto";
        stage.style.setProperty("--saki-x", `${nextPosition.x}px`);
        stage.style.setProperty("--saki-y", `${nextPosition.y}px`);
        stage.style.transform = `translate(${nextPosition.x}px, ${nextPosition.y}px)`;
      }
      setLauncherPosition(nextPosition);
      writeSakiLauncherPosition(nextPosition);
      suppressLauncherClickRef.current = true;
      globalThis.setTimeout(() => {
        suppressLauncherClickRef.current = false;
      }, 150);
    }

    launcherDragRef.current = null;
    setLauncherDragging(false);
    onLauncherDraggingChange?.(false);
    setDraggingExpression(null);
  }

  function handleLauncherPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const stage = petStageRef.current;
    const rect = (stage ?? event.currentTarget).getBoundingClientRect();
    const pointerId = event.pointerId;

    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    launcherDragRef.current = {
      pointerId,
      offsetX,
      offsetY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      slop: event.pointerType === "touch" || event.pointerType === "pen" ? 10 : 3
    };

    if (launcherWindowListenersRef.current) {
      window.removeEventListener("pointermove", launcherWindowListenersRef.current.onMove, true);
      window.removeEventListener("pointerup", launcherWindowListenersRef.current.onUp, true);
      window.removeEventListener("pointercancel", launcherWindowListenersRef.current.onUp, true);
      launcherWindowListenersRef.current = null;
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updateLauncherDrag(moveEvent.pointerId, moveEvent.clientX, moveEvent.clientY, stage);
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      launcherWindowListenersRef.current = null;
      completeLauncherDrag(upEvent.pointerId, upEvent.clientX, upEvent.clientY, stage);
    };

    launcherWindowListenersRef.current = { onMove, onUp };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }

  function handleLauncherPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = launcherDragRef.current;
    if (drag && drag.pointerId === event.pointerId && drag.moved) {
      event.preventDefault();
    }
  }

  function finishLauncherDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (launcherWindowListenersRef.current) {
      window.removeEventListener("pointermove", launcherWindowListenersRef.current.onMove, true);
      window.removeEventListener("pointerup", launcherWindowListenersRef.current.onUp, true);
      window.removeEventListener("pointercancel", launcherWindowListenersRef.current.onUp, true);
      launcherWindowListenersRef.current = null;
    }
    completeLauncherDrag(event.pointerId, event.clientX, event.clientY, petStageRef.current);
  }

  useLayoutEffect(() => {
    if (!pullDragRequest || sakiLieMode) return;
    const request = pullDragRequest;
    const scale = pet.scale || 1;
    const baseWidth = sakiLauncherExpandedSize.width;
    const baseHeight = sakiLauncherExpandedSize.height;
    const offsetX = (baseWidth * scale) / 2;
    const offsetY = Math.min(36, (baseHeight * scale) / 3);

    const desiredVisualLeft = request.clientX - offsetX;
    const desiredVisualTop = request.clientY - offsetY;
    const rawX = desiredVisualLeft - (baseWidth / 2) * (1 - scale);
    const rawY = desiredVisualTop - baseHeight * (1 - scale);

    const startPosition = clampSakiLauncherPosition(
      { x: rawX, y: rawY },
      launcherRef.current,
      "dragging",
      scale
    );
    setLauncherPosition(startPosition);
    const stage = petStageRef.current;
    if (stage) {
      stage.style.left = "0px";
      stage.style.top = "0px";
      stage.style.right = "auto";
      stage.style.bottom = "auto";
      stage.style.setProperty("--saki-x", `${startPosition.x}px`);
      stage.style.setProperty("--saki-y", `${startPosition.y}px`);
      stage.style.transform = `translate(${startPosition.x}px, ${startPosition.y}px)`;
    }
    launcherDragRef.current = {
      pointerId: request.pointerId,
      offsetX,
      offsetY,
      startX: request.clientX,
      startY: request.clientY,
      moved: true,
      slop: 12
    };
    setDraggingExpression(Math.random() > 0.5 ? sakiArtAssets.pickup1 : sakiArtAssets.pickup2);
    setLauncherDragging(true);
    onLauncherDraggingChange?.(true);

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== request.pointerId) return;
      event.preventDefault();
      updateLauncherDrag(event.pointerId, event.clientX, event.clientY, launcherRef.current);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== request.pointerId) return;
      completeLauncherDrag(event.pointerId, event.clientX, event.clientY, launcherRef.current);
      onPullDragConsumed?.();
    };
    window.addEventListener("pointermove", onMove, { capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
    return () => {
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onUp, { capture: true });
    };
  }, [pullDragRequest, sakiLieMode, pet.scale]);

  function handleLauncherClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (suppressLauncherClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressLauncherClickRef.current = false;
      return;
    }
    setSakiSleepy(false);
    if (isSakiPetTouchUi()) {
      event.preventDefault();
      pet.toggleMenu();
      return;
    }
    setOpen(true);
  }

  function closeSakiPanel() {
    setOpen(false);
    setMessagesExpanded(false);
    setHistoryOpen(false);
    setFullscreen(false);
  }

  function selectSakiMode(nextMode: SakiChatMode) {
    setMode(coerceSakiMode(nextMode, canUseChat, canUseAgent));
  }

  function toggleSakiHistory() {
    setMessagesExpanded(true);
    setHistoryOpen((current) => {
      const next = !current;
      if (next) {
        const local = readSakiConversations();
        if (local.length > 0) {
          setStoredConversations(local);
        }
        if (token) {
          void api.sakiListConversations(token).then((cloudRows) => {
            if (!Array.isArray(cloudRows) || cloudRows.length === 0) return;
            setStoredConversations((currentLocal) => {
              const map = new Map<string, StoredSakiConversation>();
              for (const item of currentLocal) map.set(item.id, item);
              for (const row of cloudRows) {
                const l = map.get(row.id);
                if (!l || new Date(row.updatedAt).getTime() >= new Date(l.updatedAt).getTime()) {
                  map.set(row.id, {
                    id: row.id,
                    contextKey: row.contextKey,
                    label: row.label,
                    detail: row.detail,
                    instanceId: row.instanceId ?? null,
                    title: row.title,
                    messages: row.messages,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt
                  });
                }
              }
              const merged = sortSakiConversationsByTime([...map.values()]).slice(0, 80);
              writeSakiConversations(merged);
              return merged;
            });
          }).catch(() => {});
        }
      }
      return next;
    });
  }

  function toggleSakiFullscreen() {
    setMessagesExpanded(true);
    setFullscreen((current) => !current);
  }

  function toggleSkill(skillId: string) {
    setSelectedSkillIds((current) =>
      current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId]
    );
  }

  function startNewConversation() {
    if (hasPersistableSakiSpeech(messages)) {
      saveConversationStateDirectly(messages, activeConversationIdRef.current);
    }
    const id = newClientId();
    activeConversationIdRef.current = id;
    restoringContextRef.current = true;
    setActiveConversationId(id);
    setMessages([
      createSakiWelcomeMessage(getSakiWelcomeMessageText(activeInstance, activePanelContext.label))
    ]);
    setDraft("");
    setPanelError(null);
    setContextTitle(null);
    setContextText(null);
    setAttachments([]);
    setComposerNotice(null);
    setHistoryOpen(false);
    setMessagesExpanded(true);
  }

  function loadConversation(conversation: StoredSakiConversation) {
    if (hasPersistableSakiSpeech(messages) && activeConversationIdRef.current !== conversation.id) {
      saveConversationStateDirectly(messages, activeConversationIdRef.current);
    }
    restoringContextRef.current = true;
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setAttachments([]);
    setComposerNotice(null);
    setHistoryOpen(false);
    setMessagesExpanded(true);
  }

  function deleteConversation(conversationId: string) {
    setStoredConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== conversationId);
      writeSakiConversations(next);
      return next;
    });
    if (token) {
      void api.sakiDeleteConversation(token, conversationId).catch((err) => {
        console.warn("[saki] failed to delete conversation on server:", err);
      });
    }
    if (conversationId === activeConversationIdRef.current) {
      startNewConversation();
    }
  }

  const getContextKeyForSelection = useCallback(
    (target: SakiWorkspaceSelection) => {
      if (target.type === "current") {
        return instance ? `instance:${instance.id}` : `panel:${panelContext.label}:${panelContext.detail}`;
      }
      if (target.type === "instance") {
        return `instance:${target.instanceId}`;
      }
      const pContext = getPanelContextForView(target.view, t);
      return `panel:${pContext.label}:${pContext.detail}`;
    },
    [instance, panelContext.detail, panelContext.label, t]
  );

  const handleSelectWorkspace = useCallback(
    (target: SakiWorkspaceSelection) => {
      if (hasPersistableSakiSpeech(messages)) {
        conversationsRef.current[contextKey] = messages;
        saveConversationStateDirectly(messages, activeConversationIdRef.current);
      }
      setWorkspaceSelection(target);
      setWorkspaceDropdownOpen(false);
      setWorkspaceSearch("");

      const nextKey = getContextKeyForSelection(target);
      const existingConv = storedConversations.find((c) => c.contextKey === nextKey);
      if (existingConv) {
        loadConversation(existingConv);
      } else {
        const nextInst =
          target.type === "current"
            ? instance
            : target.type === "instance"
              ? availableInstances.find((i) => i.id === target.instanceId) ?? null
              : null;
        const nextPContext =
          target.type === "current"
            ? panelContext
            : target.type === "page"
              ? getPanelContextForView(target.view, t)
              : nextInst
                ? { label: nextInst.name, detail: nextInst.workingDirectory || `实例 ${nextInst.name}` }
                : panelContext;

        const id = newClientId();
        activeConversationIdRef.current = id;
        restoringContextRef.current = true;
        setActiveConversationId(id);
        setMessages([
          createSakiWelcomeMessage(getSakiWelcomeMessageText(nextInst, nextPContext.label))
        ]);
        setDraft("");
        setPanelError(null);
        setContextTitle(null);
        setContextText(null);
        setAttachments([]);
        setComposerNotice(null);
        setHistoryOpen(false);
        setMessagesExpanded(true);
      }
    },
    [availableInstances, contextKey, getContextKeyForSelection, instance, messages, panelContext, saveConversationStateDirectly, storedConversations, t]
  );

  const handleJumpToWorkspace = useCallback(
    (event: React.MouseEvent, view: ViewMode, instanceId?: string) => {
      event.stopPropagation();
      setWorkspaceDropdownOpen(false);
      setWorkspaceSearch("");
      if (onNavigateView) {
        onNavigateView(view, instanceId);
      }
    },
    [onNavigateView]
  );

  const accessiblePages = useMemo(() => {
    const list: Array<{ view: ViewMode; label: string; detail: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
      { view: "dashboard", label: t("nav.dashboard") || "控制台", detail: t("context.dashboard.detail") || "全局概览与状态", icon: LayoutDashboard },
      { view: "instances", label: t("nav.instances") || "实例管理", detail: t("context.instances.detail") || "运行实例与容器", icon: Server },
      { view: "nodes", label: t("nav.nodes") || "节点管理", detail: t("context.nodes.detail") || "节点连接与集群状态", icon: HardDrive },
      { view: "templates", label: t("nav.templates") || "模板市场", detail: t("context.templates.detail") || "实例模板配置", icon: LayoutTemplate },
      { view: "users", label: t("nav.users") || "用户管理", detail: t("context.users.detail") || "用户权限管理", icon: UserCog },
      { view: "audit", label: t("nav.audit") || "审计日志", detail: t("context.audit.detail") || "安全审计事件追溯", icon: FileText },
      { view: "settings", label: t("nav.settings") || "系统设置", detail: t("context.settings.detail") || "Saki 与系统配置", icon: Settings },
      { view: "reliability", label: t("nav.reliability") || "系统可靠性", detail: t("context.reliability.detail") || "服务可靠性监控", icon: ShieldCheck },
      { view: "plugins", label: t("nav.plugins") || "插件中心", detail: t("context.plugins.detail") || "主题与拓展插件", icon: Sparkles },
      { view: "about", label: t("nav.about") || "关于", detail: "系统架构与帮助", icon: Info }
    ];
    if (availableViews && availableViews.length > 0) {
      return list.filter((item) => availableViews.includes(item.view));
    }
    return list;
  }, [availableViews, t]);

  const filteredInstances = useMemo(() => {
    if (!workspaceSearch.trim()) return availableInstances;
    const query = workspaceSearch.trim().toLowerCase();
    return availableInstances.filter(
      (inst) =>
        inst.name.toLowerCase().includes(query) ||
        inst.id.toLowerCase().includes(query) ||
        (inst.workingDirectory && inst.workingDirectory.toLowerCase().includes(query))
    );
  }, [availableInstances, workspaceSearch]);

  function replaceAction(action: SakiAgentAction) {
    setMessages((current) =>
      current.map((message) =>
        message.actions?.some((item) => item.id === action.id)
          ? {
              ...message,
              actions: message.actions.map((item) => (item.id === action.id ? action : item)),
              timeline: upsertSakiTimelineAction(message.timeline, action)
            }
          : message
      )
    );
  }

  function applyActionContinuationResponse(anchorActionId: string, response: SakiChatResponse) {
    setReachable(response.source === "direct-model");
    if (response.skills) setSkills(response.skills);
    if (response.agentPermissionMode) setPermissionMode(response.agentPermissionMode);
    setMessages((current) =>
      current.map((message) => {
        if (!message.actions?.some((item) => item.id === anchorActionId)) return message;
        const nextActions = mergeSakiActionList(message.actions, response.actions);
        const mergedAttachments = mergeSakiMessageAttachments(message.attachments, response.attachments, nextActions);
        const nextMessage: LocalSakiMessage = {
          ...message,
          content: mergeSakiFinalText(message.content, response.message),
          timeline: mergeSakiTimelineActions(mergeSakiFinalTimeline(message.timeline, response.message), nextActions),
          source: response.source,
          workflowExpanded: false,
          streaming: false,
          ...(mergedAttachments.length ? { attachments: mergedAttachments } : {})
        };
        if (nextActions?.length) return { ...nextMessage, actions: nextActions };
        return nextMessage;
      })
    );
  }

  function sakiActionPath(action: SakiAgentAction): string {
    const value = action.args.path ?? action.args.fromPath ?? action.args.toPath;
    return typeof value === "string" ? value : "";
  }

  function isSakiFileEditAction(action: SakiAgentAction): boolean {
    return isSakiFileEditTool(action.tool);
  }

  function appendActionCompletionThought(action: SakiAgentAction) {
    if (!action.ok || !isSakiFileEditAction(action)) return;
    const path = sakiActionPath(action);
    const label = sakiFileEditActionLabel(action.tool);
    const step: LocalSakiWorkflowStep = {
      id: newClientId(),
      stage: "tool",
      message: path ? `我已经${label}好 ${path}。` : `我已经${label}好文件。`,
      status: "completed",
      tool: action.tool,
      createdAt: new Date().toISOString()
    };
    setMessages((current) =>
      current.map((message) =>
        message.actions?.some((item) => item.id === action.id)
          ? {
            ...message,
              workflow: [...(message.workflow ?? []), step],
              timeline: upsertSakiTimelineText(message.timeline, {
                id: `workflow:${step.id}`,
                content: step.message,
                source: "workflow",
                createdAt: step.createdAt
              })
            }
          : message
      )
    );
  }

  async function decideAction(action: SakiAgentAction, decision: "approve" | "reject" | "rollback") {
    if (actionBusyId) return;
    setActionBusyId(action.id);
    if (decision === "approve") {
      setLoading(true);
      setSakiActivityMood("working");
    }
    try {
      const response = await api.sakiAction(token, action.id, decision);
      replaceAction(response.action);
      if (decision === "approve") {
        appendActionCompletionThought(response.action);
        if (response.response) {
          applyActionContinuationResponse(action.id, response.response);
          const contActions = response.response.actions ?? [];
          if (contActions.some((a) => a.status === "pending_approval")) {
            setSakiActivityMood("waiting");
          } else if (contActions.some((a) => a.status === "failed" || a.ok === false)) {
            setSakiActivityMood("sorry");
          } else {
            const doneMoods: NonNullable<SakiActivityMood>[] = ["happy", "OK", "wink"];
            setSakiActivityMood(doneMoods[Math.floor(Math.random() * doneMoods.length)] ?? "happy");
          }
        } else {
          if (response.action.ok) {
            const doneMoods: NonNullable<SakiActivityMood>[] = ["happy", "OK", "wink"];
            setSakiActivityMood(doneMoods[Math.floor(Math.random() * doneMoods.length)] ?? "happy");
          } else {
            setSakiActivityMood("sorry");
          }
        }
      } else if (decision === "reject") {
        setSakiActivityMood("pout");
      } else if (decision === "rollback") {
        setSakiActivityMood("rollback");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Saki action failed";
      replaceAction({
        ...action,
        ok: false,
        status: "failed",
        observation: message
      });
      setSakiActivityMood("sorry");
    } finally {
      setActionBusyId(null);
      if (decision === "approve") setLoading(false);
    }
  }

  function suppressPanelDismiss() {
    suppressPanelDismissRef.current = true;
    if (suppressPanelDismissTimerRef.current !== null) {
      window.clearTimeout(suppressPanelDismissTimerRef.current);
      suppressPanelDismissTimerRef.current = null;
    }
  }

  function releasePanelDismissSoon() {
    if (suppressPanelDismissTimerRef.current !== null) {
      window.clearTimeout(suppressPanelDismissTimerRef.current);
    }
    suppressPanelDismissTimerRef.current = window.setTimeout(() => {
      suppressPanelDismissRef.current = false;
      suppressPanelDismissTimerRef.current = null;
    }, 400);
  }

  function detachNativeDialogFocusHandler() {
    if (!nativeDialogFocusHandlerRef.current) return;
    window.removeEventListener("focus", nativeDialogFocusHandlerRef.current);
    nativeDialogFocusHandlerRef.current = null;
  }

  function keepComposerVisible(focusComposer = false) {
    setOpen(true);
    if (!focusComposer) return;
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
    });
  }

  function openComposerFilePicker(input: HTMLInputElement | null) {
    if (!input) return;
    keepComposerVisible();
    suppressPanelDismiss();
    detachNativeDialogFocusHandler();
    const onWindowFocus = () => {
      detachNativeDialogFocusHandler();
      releasePanelDismissSoon();
    };
    nativeDialogFocusHandlerRef.current = onWindowFocus;
    window.addEventListener("focus", onWindowFocus);
    input.click();
  }

  function showComposerNotice(message: string) {
    setComposerNotice(message);
    if (composerNoticeTimerRef.current !== null) {
      window.clearTimeout(composerNoticeTimerRef.current);
    }
    composerNoticeTimerRef.current = window.setTimeout(() => {
      setComposerNotice(null);
      composerNoticeTimerRef.current = null;
    }, 4000);
  }

  function handleNoticeMouseEnter() {
    if (composerNoticeTimerRef.current !== null) {
      window.clearTimeout(composerNoticeTimerRef.current);
      composerNoticeTimerRef.current = null;
    }
  }

  function handleNoticeMouseLeave() {
    if (composerNoticeTimerRef.current !== null) {
      window.clearTimeout(composerNoticeTimerRef.current);
    }
    composerNoticeTimerRef.current = window.setTimeout(() => {
      setComposerNotice(null);
      composerNoticeTimerRef.current = null;
    }, 2400);
  }

  function stopSelectionAnnotation(notice?: string) {
    annotationModeRef.current = false;
    setAnnotationMode(false);
    document.body.classList.remove("saki-selection-capture-active");
    if (notice) showComposerNotice(notice);
  }

  function toggleSelectionAnnotation() {
    if (loading) return;
    if (annotationModeRef.current) {
      stopSelectionAnnotation("已取消选中文本。");
      return;
    }

    clearRememberedSakiTerminalSelection();
    window.getSelection()?.removeAllRanges();
    annotationModeRef.current = true;
    setAnnotationMode(true);
    setOpen(true);
    showComposerNotice("请选择页面或终端文本，选中文本后将填入输入框。按 Esc 取消。");
  }

  function applySakiSelectionCapture(capture: SakiSelectionCapture) {
    if (loading) return;
    const selectedText = compactContextText(capture.text, sakiSelectionContextLimit);
    if (!selectedText) return;

    stopSelectionAnnotation();
    if (capture.source === "terminal") {
      clearRememberedSakiTerminalSelection();
    } else {
      window.getSelection()?.removeAllRanges();
    }

    setOpen(true);
    keepComposerVisible(true);
    setDraft((prev) => {
      if (!prev.trim()) return selectedText;
      return `${prev}\n${selectedText}`;
    });
    showComposerNotice("已将选中文本填入输入框。");

    window.requestAnimationFrame(() => {
      const textarea = composerTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    });
  }

  function appendAttachments(nextAttachments: SakiInputAttachment[]) {
    if (nextAttachments.length === 0) return;
    const available = Math.max(0, sakiMaxInputAttachments - attachments.length);
    if (available <= 0) {
      showComposerNotice(`最多只能附加 ${sakiMaxInputAttachments} 个项目。`);
      return;
    }
    const accepted = nextAttachments.slice(0, available);
    setAttachments((current) => [...current, ...accepted].slice(0, sakiMaxInputAttachments));
    showComposerNotice(
      accepted.length < nextAttachments.length
        ? `最多只能附加 ${sakiMaxInputAttachments} 个项目，已添加 ${accepted.length} 个。`
        : `已附加 ${accepted.length} 个项目。`
    );
  }

  async function addFilesToComposer(files: File[], preferredKind: "image" | "file") {
    if (files.length === 0 || composerBusy) return;
    const available = Math.max(0, sakiMaxInputAttachments - attachments.length);
    if (available <= 0) {
      showComposerNotice(`最多只能附加 ${sakiMaxInputAttachments} 个项目。`);
      return;
    }

    keepComposerVisible(true);
    setComposerBusy(preferredKind);
    try {
      const selected = files.slice(0, available);
      const nextAttachments: SakiInputAttachment[] = [];
      for (const file of selected) {
        nextAttachments.push(await fileToSakiAttachment(file, preferredKind));
      }
      appendAttachments(nextAttachments);
      if (files.length > selected.length) {
        showComposerNotice(`最多只能附加 ${sakiMaxInputAttachments} 个项目，剩余文件未添加。`);
      }
    } catch (err) {
      showComposerNotice(err instanceof Error ? err.message : "附件读取失败");
    } finally {
      setComposerBusy(null);
    }
  }

  async function addInstanceFileToComposer(payload: SakiInstanceFileDragPayload) {
    if (composerBusy) return;
    const available = Math.max(0, sakiMaxInputAttachments - attachments.length);
    if (available <= 0) {
      showComposerNotice(`最多只能附加 ${sakiMaxInputAttachments} 个项目。`);
      return;
    }

    setOpen(true);
    setMessagesExpanded(true);
    setComposerBusy("file");
    try {
      if (isImageFile(payload.path || payload.name)) {
        const response = await api.downloadInstanceFile(token, payload.instanceId, payload.path, { base64: true });
        const mimeType = imageMimeTypeFromPath(response.path || payload.name) ?? imageMimeTypeFromPath(payload.path) ?? "image/png";
        const file = new File([base64ToBlob(response.contentBase64, mimeType)], response.fileName || payload.name, {
          type: mimeType
        });
        appendAttachments([await imageFileToSakiAttachment(file, "image")]);
        return;
      }

      const response = await api.readInstanceFile(token, payload.instanceId, payload.path);
      appendAttachments([
        {
          id: newClientId(),
          kind: "file",
          name: response.path || payload.path,
          mimeType: sakiMimeTypeFromPath(response.path || payload.name),
          size: response.size,
          text: compactContextText(response.content, sakiTextAttachmentLimit)
        }
      ]);
    } catch (err) {
      showComposerNotice(err instanceof Error ? err.message : "实例文件读取失败");
    } finally {
      setComposerBusy(null);
    }
  }

  function handleSakiFileDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!hasAnyFileDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    sakiFileDragDepthRef.current += 1;
    if (event.currentTarget !== launcherRef.current) {
      setOpen(true);
      setMessagesExpanded(true);
    }
    setSakiFileHoverActive(true);
  }

  function handleSakiFileDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasAnyFileDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleSakiFileDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!hasAnyFileDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    sakiFileDragDepthRef.current = Math.max(0, sakiFileDragDepthRef.current - 1);
    if (sakiFileDragDepthRef.current === 0) {
      setSakiFileHoverActive(false);
    }
  }

  function handleSakiFileDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasAnyFileDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    sakiFileDragDepthRef.current = 0;
    setSakiFileHoverActive(false);
    onClearFileDrag?.();

    if (hasSakiInstanceFileDragData(event.dataTransfer)) {
      const payload = parseSakiInstanceFileDragPayload(event.dataTransfer);
      if (!payload) {
        showComposerNotice("无法识别拖入的实例文件。");
        return;
      }
      void addInstanceFileToComposer(payload);
      return;
    }

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      setOpen(true);
      setMessagesExpanded(true);
      const firstFile = files[0];
      const preferredKind = firstFile?.type.startsWith("image/") ? "image" : "file";
      void addFilesToComposer(files, preferredKind);
    }
  }

  async function pasteImageFromClipboard() {
    if (composerBusy) return;
    keepComposerVisible();
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard?.read) {
      openComposerFilePicker(imageInputRef.current);
      showComposerNotice("当前浏览器不支持直接读取剪贴板，已打开图片选择。");
      return;
    }

    suppressPanelDismiss();
    setComposerBusy("image");
    let handedOffToFilePicker = false;
    try {
      const items = await clipboard.read();
      const imageFiles: File[] = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const extension = imageType.split("/")[1]?.replace("jpeg", "jpg") || "png";
        imageFiles.push(new File([blob], `clipboard-image-${Date.now()}.${extension}`, { type: imageType }));
      }

      if (imageFiles.length > 0) {
        setComposerBusy(null);
        await addFilesToComposer(imageFiles, "image");
        return;
      }

      handedOffToFilePicker = true;
      openComposerFilePicker(imageInputRef.current);
      showComposerNotice("剪贴板里没有图片，已打开图片选择。");
    } catch {
      handedOffToFilePicker = true;
      openComposerFilePicker(imageInputRef.current);
      showComposerNotice("剪贴板读取被浏览器拦截，已打开图片选择。");
    } finally {
      setComposerBusy(null);
      if (!handedOffToFilePicker) {
        releasePanelDismissSoon();
      }
    }
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    void addFilesToComposer(files, "image");
  }

  async function capturePetSticker() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      pet.showBubble(t("saki.chat.screenCaptureNotSupported"));
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) throw new Error("截图画面读取失败");
      const scale = Math.min(1, 480 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法处理截图");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/webp", 0.72);
      pet.addSticker(dataUrl, Math.round((globalThis.innerWidth || 800) / 2 - 90), 96);
      pet.closeWidget();
      pet.showBubble(t("saki.chat.stickerPlaced"));
    } catch (err) {
      pet.showBubble(err instanceof Error ? err.message : "截图已取消");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function captureScreenAttachment() {
    if (composerBusy) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showComposerNotice("当前浏览器不支持网页/屏幕截图。");
      return;
    }

    keepComposerVisible();
    suppressPanelDismiss();
    setComposerBusy("screenshot");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) throw new Error("截图画面读取失败");

      const scale = Math.min(1, sakiImageMaxDimension / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法处理截图");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/webp", sakiImageQuality);
      appendAttachments([
        {
          id: newClientId(),
          kind: "screenshot",
          name: `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.webp`,
          mimeType: "image/webp",
          size: Math.round((dataUrl.length * 3) / 4),
          dataUrl,
          width: canvas.width,
          height: canvas.height,
          capturedAt: new Date().toISOString()
        }
      ]);
    } catch (err) {
      showComposerNotice(err instanceof Error ? err.message : "截图已取消");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setComposerBusy(null);
      releasePanelDismissSoon();
      keepComposerVisible(true);
    }
  }

  function toggleSpeechInput() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    if (sakiHoldTimerRef.current !== null) {
      window.clearTimeout(sakiHoldTimerRef.current);
      sakiHoldTimerRef.current = null;
    }
    sakiHoldActiveRef.current = false;
    sakiVoiceEchoRef.current?.cancelHold();

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      showComposerNotice("当前浏览器不支持语音输入。");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = navigator.language || "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    speechBaseDraftRef.current = draft.trimEnd();
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }
      const base = speechBaseDraftRef.current;
      setDraft(`${base}${base && transcript ? " " : ""}${transcript}`.trimStart());
    };
    recognition.onerror = (event) => {
      showComposerNotice(event.message || event.error || "语音输入失败");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      showComposerNotice("正在听写，点麦克风可停止。");
    } catch (err) {
      recognitionRef.current = null;
      setListening(false);
      showComposerNotice(err instanceof Error ? err.message : "语音输入启动失败");
    }
  }

  function settleInterruptedSakiMessage(assistantId?: string) {
    setSakiActivityMood((prev) => (isSakiWorkMood(prev) ? null : prev));
    setMessages((current) =>
      current.map((message) =>
        message.role === "assistant" && (assistantId ? message.id === assistantId : message.streaming)
          ? {
              ...message,
              content: message.content || "已停止生成。",
              streaming: false,
              workflowExpanded: false
            }
          : message
      )
    );
  }

  function openWorkspacePath(path: string, line?: number) {
    if (!onOpenWorkspaceFile) return;
    if (!activeInstance) {
      showComposerNotice("先选择一个实例，才能打开文件。");
      return;
    }
    onOpenWorkspaceFile(path, line, activeInstance.id);
  }

  function stopSakiGeneration() {
    userStoppedRef.current = true;
    lastRunCompletedRef.current = followUpQueueRef.current.length > 0;
    const currentTaskId = activeTaskIdRef.current;
    if (currentTaskId && token) {
      void api.sakiCancelTask(token, currentTaskId).catch(() => {});
      activeTaskIdRef.current = null;
    }
    const controller = sakiStreamAbortRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    setLoading(false);
    setSakiActivityMood(null);
    settleInterruptedSakiMessage();
    window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
  }

  function toggleSakiWorkflow(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              workflowExpanded: !message.workflowExpanded
            }
          : message
      )
    );
  }

  function toggleSakiRollbackGroup(messageId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              rollbackGroupExpanded: !message.rollbackGroupExpanded
            }
          : message
      )
    );
  }

  async function rollbackAllFileActions(messageId: string, actions: SakiAgentAction[]) {
    if (actionBusyId) return;
    const rollbackableActions = actions.filter(isSakiRollbackableFileEdit);
    if (rollbackableActions.length === 0) return;
    setActionBusyId(`rollback_all:${messageId}`);
    setSakiActivityMood("rollback");
    try {
      for (const action of rollbackableActions) {
        try {
          const response = await api.sakiAction(token, action.id, "rollback");
          replaceAction(response.action);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Saki action failed";
          replaceAction({
            ...action,
            ok: false,
            status: "failed",
            observation: message
          });
        }
      }
    } finally {
      setActionBusyId(null);
    }
  }

  async function copyUserMessage(messageId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedUserMessageId(messageId);
      showComposerNotice("已复制提问内容");
      window.setTimeout(() => {
        setCopiedUserMessageId((current) => (current === messageId ? null : current));
      }, 2000);
    } catch {
      showComposerNotice("复制失败，请手动选择复制");
    }
  }

  async function copyAssistantMessage(messageId: string, content: string) {
    const text = content.trim();
    if (!text) {
      showComposerNotice("这条回复没有可复制的文本");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAssistantMessageId(messageId);
      showComposerNotice("已复制回复");
      window.setTimeout(() => {
        setCopiedAssistantMessageId((current) => (current === messageId ? null : current));
      }, 2000);
    } catch {
      showComposerNotice("复制失败，请手动选择复制");
    }
  }

  function collectRollbackableActionsFromMessages(source: LocalSakiMessage[]): SakiAgentAction[] {
    const actions: SakiAgentAction[] = [];
    const seenActionIds = new Set<string>();
    for (const msg of source) {
      if (msg.role !== "assistant") continue;
      const candidates = [
        ...(Array.isArray(msg.actions) ? msg.actions : []),
        ...((msg.timeline ?? [])
          .filter((item): item is Extract<LocalSakiTimelineItem, { kind: "action" }> => item.kind === "action")
          .map((item) => item.action))
      ];
      for (const act of candidates) {
        if (!act?.id || seenActionIds.has(act.id)) continue;
        if (act.status === "rolled_back") continue;
        if (act.approval?.rollbackAvailable || isSakiFileEditTool(act.tool)) {
          seenActionIds.add(act.id);
          actions.push(act);
        }
      }
    }
    return actions;
  }

  async function rollbackCollectedActions(actionsToRollback: SakiAgentAction[]): Promise<number> {
    if (!token || actionsToRollback.length === 0) return 0;
    let rolledBackCount = 0;
    for (const action of [...actionsToRollback].reverse()) {
      try {
        await api.sakiAction(token, action.id, "rollback");
        rolledBackCount += 1;
      } catch (err) {
        console.warn("Rollback action error:", action.id, err);
      }
    }
    return rolledBackCount;
  }

  function findAssistantTurn(assistantMessageId: string) {
    const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
    if (assistantIndex < 0) return null;
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== "user") {
      userIndex -= 1;
    }
    if (userIndex < 0) return null;
    const user = messages[userIndex];
    const assistant = messages[assistantIndex];
    if (!user || !assistant) return null;
    return { userIndex, assistantIndex, user, assistant };
  }

  async function retryAssistantTurn(assistantMessageId: string) {
    if (actionBusyId || loading) return;
    const turn = findAssistantTurn(assistantMessageId);
    if (!turn) return;
    setActionBusyId(`retry:${assistantMessageId}`);
    try {
      if (activeTaskIdRef.current && token) {
        void api.sakiCancelTask(token, activeTaskIdRef.current).catch(() => {});
        activeTaskIdRef.current = null;
      }
      if (sakiStreamAbortRef.current && !sakiStreamAbortRef.current.signal.aborted) {
        sakiStreamAbortRef.current.abort();
        sakiStreamAbortRef.current = null;
      }
      const actionsToRollback = collectRollbackableActionsFromMessages(messages.slice(turn.userIndex));
      const rolledBackCount = await rollbackCollectedActions(actionsToRollback);
      const remaining = messages.slice(0, turn.userIndex);
      const nextMessages = remaining.length > 0
        ? remaining
        : [createSakiWelcomeMessage(getSakiWelcomeMessageText(activeInstance, activePanelContext.label))];
      setMessages(nextMessages);
      saveConversationStateDirectly(nextMessages);
      window.dispatchEvent(new CustomEvent("saki:files_modified"));
      window.dispatchEvent(new CustomEvent("workspace:refresh"));
      if (rolledBackCount > 0) {
        showComposerNotice(`已回滚 ${rolledBackCount} 处修改，正在重新生成…`);
      }
      setSakiActivityMood("working");
      await submitRef.current?.(undefined, {
        message: turn.user.content,
        attachments: turn.user.attachments ?? [],
        replaceHistory: nextMessages
      });
    } finally {
      setActionBusyId(null);
    }
  }

  async function deleteAssistantTurn(assistantMessageId: string) {
    if (actionBusyId || loading) return;
    const turn = findAssistantTurn(assistantMessageId);
    if (!turn) return;
    setActionBusyId(`delete:${assistantMessageId}`);
    try {
      const actionsToRollback = collectRollbackableActionsFromMessages([turn.assistant]);
      const rolledBackCount = await rollbackCollectedActions(actionsToRollback);
      const remaining = [...messages.slice(0, turn.userIndex), ...messages.slice(turn.assistantIndex + 1)];
      const nextMessages = remaining.length > 0
        ? remaining
        : [createSakiWelcomeMessage(getSakiWelcomeMessageText(activeInstance, activePanelContext.label))];
      setMessages(nextMessages);
      saveConversationStateDirectly(nextMessages);
      window.dispatchEvent(new CustomEvent("saki:files_modified"));
      window.dispatchEvent(new CustomEvent("workspace:refresh"));
      showComposerNotice(
        rolledBackCount > 0
          ? `已删除这轮对话，并还原了 ${rolledBackCount} 处修改。`
          : "已删除这轮对话。"
      );
    } finally {
      setActionBusyId(null);
    }
  }

  async function rollbackUserTurn(userMessageId: string) {
    if (actionBusyId) return;
    const targetIndex = messages.findIndex((m) => m.id === userMessageId);
    if (targetIndex === -1) return;

    const targetMessage = messages[targetIndex];
    if (!targetMessage) return;

    const affectedMessages = messages.slice(targetIndex);
    const actionsToRollback: SakiAgentAction[] = [];
    const seenActionIds = new Set<string>();

    for (const msg of affectedMessages) {
      if (msg.role === "assistant") {
        if (Array.isArray(msg.actions)) {
          for (const act of msg.actions) {
            if (!seenActionIds.has(act.id) && act.status !== "rolled_back" && (act.approval?.rollbackAvailable || isSakiFileEditTool(act.tool))) {
              seenActionIds.add(act.id);
              actionsToRollback.push(act);
            }
          }
        }
        if (Array.isArray(msg.timeline)) {
          for (const item of msg.timeline) {
            if (item.kind === "action" && item.action) {
              const act = item.action;
              if (!seenActionIds.has(act.id) && act.status !== "rolled_back" && (act.approval?.rollbackAvailable || isSakiFileEditTool(act.tool))) {
                seenActionIds.add(act.id);
                actionsToRollback.push(act);
              }
            }
          }
        }
      }
    }

    setActionBusyId(`rollback_user:${userMessageId}`);
    try {
      if (activeTaskIdRef.current && token) {
        void api.sakiCancelTask(token, activeTaskIdRef.current).catch(() => {});
        activeTaskIdRef.current = null;
      }
      if (sakiStreamAbortRef.current && !sakiStreamAbortRef.current.signal.aborted) {
        sakiStreamAbortRef.current.abort();
        sakiStreamAbortRef.current = null;
      }
      setLoading(false);

      let rolledBackCount = 0;
      if (token && actionsToRollback.length > 0) {
        for (const action of [...actionsToRollback].reverse()) {
          try {
            await api.sakiAction(token, action.id, "rollback");
            rolledBackCount += 1;
          } catch (err) {
            console.warn("Rollback action error:", action.id, err);
          }
        }
      }

      const remaining = messages.slice(0, targetIndex);
      const nextMessages = remaining.length > 0
        ? remaining
        : [createSakiWelcomeMessage(getSakiWelcomeMessageText(activeInstance, activePanelContext.label))];
      
      setMessages(nextMessages);

      if (targetMessage.content) {
        setDraft(targetMessage.content);
      }

      saveConversationStateDirectly(nextMessages);

      window.dispatchEvent(new CustomEvent("saki:files_modified"));
      window.dispatchEvent(new CustomEvent("workspace:refresh"));

      const notice = rolledBackCount > 0
        ? `已回退到该提问前，并还原了 ${rolledBackCount} 处修改。`
        : "已回退到上一个对话。";
      showComposerNotice(notice);
    } finally {
      setActionBusyId(null);
    }
  }

  async function submit(event?: React.FormEvent<HTMLFormElement>, override?: SakiSubmitOverride) {
    event?.preventDefault();
    const submittedAttachments = override?.attachments ?? attachments;
    const value = (override?.message ?? draft).trim() || (submittedAttachments.length ? "请分析附件内容。" : "");
    if (!value && submittedAttachments.length === 0) return;
    if (loading) {
      if (override?.steer && activeTaskIdRef.current && token && value) {
        const steerMessage: LocalSakiMessage = {
          id: newClientId(),
          role: "user",
          content: value,
          createdAt: new Date().toISOString()
        };
        setMessages((current) => [...current, steerMessage]);
        setDraft("");
        showComposerNotice("已插入指示，Saki 会在当前步骤后读到。");
        void api.sakiSteerTask(token, activeTaskIdRef.current, value).catch((err) => {
          showComposerNotice(err instanceof Error ? err.message : "插入指示失败");
        });
        return;
      }
      if (!value && submittedAttachments.length === 0) return;
      const job: SakiFollowUpJob = {
        id: newClientId(),
        message: value,
        ...(submittedAttachments.length ? { attachments: submittedAttachments } : {})
      };
      setFollowUpQueue((current) => [...current, job]);
      setDraft("");
      setAttachments([]);
      showComposerNotice("已加入队列，当前任务结束后自动开始。");
      return;
    }
    const requestMode = coerceSakiMode(override?.mode ?? mode, canUseChat, canUseAgent);
    if (!isSakiModeAllowed(requestMode, canUseChat, canUseAgent)) {
      setComposerNotice("当前账号没有可用的 Saki 权限。");
      return;
    }
    if (requestMode !== mode) {
      setMode(requestMode);
    }

    lastRunCompletedRef.current = false;
    setMessagesExpanded(true);
    sakiAutoScrollRef.current = true;
    const requestPanelError = override?.panelError ?? panelError;
    const requestContextTitle = override?.contextTitle ?? contextTitle;
    const requestContextText = override?.contextText ?? contextText;
    const historySource = override?.replaceHistory ?? messages;

    const userMessage: LocalSakiMessage = {
      id: newClientId(),
      role: "user",
      content: value,
      createdAt: new Date().toISOString(),
      ...(submittedAttachments.length ? { attachments: submittedAttachments } : {})
    };
    const assistantId = newClientId();
    const assistantMessage: LocalSakiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      source: "direct-model",
      timeline: [],
      workflowExpanded: false,
      streaming: true
    };
    const nextMessages = [...historySource, userMessage, assistantMessage];
    setMessages(nextMessages);
    saveConversationStateDirectly(nextMessages);
    setDraft("");
    setAttachments([]);
    setComposerNotice(null);
    setSakiActivityMood("working");
    setLoading(true);
    userStoppedRef.current = false;
    const previousTaskId = activeTaskIdRef.current;
    if (previousTaskId && token) {
      void api.sakiCancelTask(token, previousTaskId).catch(() => {});
      activeTaskIdRef.current = null;
    }
    const previousStream = sakiStreamAbortRef.current;
    if (previousStream && !previousStream.signal.aborted) {
      previousStream.abort();
    }
    const abortController = new AbortController();
    sakiStreamAbortRef.current = abortController;
    const history = historySource.filter((message) => message.id !== "saki-welcome").slice(-12).map(toSakiHistoryMessage);
    const request = {
      message: value,
      history,
      instanceId: (storedConversations.find((conversation) => conversation.id === activeConversationId)?.instanceId ?? activeInstance?.id) || null,
      panelError: requestPanelError,
      contextTitle: requestContextTitle,
      contextText: requestContextText,
      auditSearch: !activeInstance && activePanelContext.auditSearch ? value : null,
      mode: requestMode,
      ...(requestMode === "agent" ? { agentPermissionMode: permissionMode } : {}),
      selectedSkillIds,
      attachments: submittedAttachments,
      ...(currentModelId.trim() ? { model: currentModelId.trim() } : {})
    };
    if (requestMode === "agent") {
      window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
    }
    let streamSawDelta = false;
    let streamSawUnsafeAction = false;
    let streamSawProgress = false;
    let streamTimedOut = false;
    let streamCompleted = false;
    const streamToolNames = new Set<string>();
    let streamIdleTimer: number | null = null;
    const canRetryAsPlainRequest = () =>
      requestMode === "chat" || (!streamSawUnsafeAction && [...streamToolNames].every((tool) => isReadOnlySakiTool(tool)));
    const clearStreamIdleTimer = () => {
      if (!streamIdleTimer) return;
      window.clearTimeout(streamIdleTimer);
      streamIdleTimer = null;
    };
    const armStreamIdleTimer = () => {
      clearStreamIdleTimer();
      streamIdleTimer = window.setTimeout(() => {
        if (streamCompleted || userStoppedRef.current) return;
        const current = sakiStreamAbortRef.current;
        if (!current || current.signal.aborted) return;
        streamTimedOut = true;
        current.abort();
      }, sakiStreamIdleFallbackMs);
    };
    const applyFinalResponse = (response: SakiChatResponse) => {
      streamCompleted = true;
      lastRunCompletedRef.current = true;
      activeTaskIdRef.current = null;
      clearStreamIdleTimer();
      if (response.usage?.isUnlimited) {
        onPointsBalanceChange?.({ points: 0, unlimitedPoints: true });
      } else if (typeof response.usage?.remainingPoints === "number") {
        onPointsBalanceChange?.({ points: response.usage.remainingPoints, unlimitedPoints: false });
      }
      setReachable(response.source === "direct-model");
      if (response.skills) setSkills(response.skills);
      if (response.agentPermissionMode) setPermissionMode(response.agentPermissionMode);
      const finishedActions = response.actions ?? [];
      if (finishedActions.some((action) => action.status === "pending_approval")) {
        setSakiActivityMood("waiting");
      } else if (finishedActions.some((action) => action.status === "failed" || action.ok === false)) {
        setSakiActivityMood("sorry");
      } else {
        const doneMoods: NonNullable<SakiActivityMood>[] = ["happy", "OK", "wink"];
        setSakiActivityMood(doneMoods[Math.floor(Math.random() * doneMoods.length)] ?? "happy");
      }
      setMessages((current) => {
        const next = current.map((message) =>
          message.id === assistantId
            ? (() => {
                const nextActions = response.actions?.length ? response.actions : message.actions;
                const sealedTimeline = sealSakiTimelineDelta(message.timeline);
                const finalTimeline = mergeSakiTimelineActions(mergeSakiFinalTimeline(sealedTimeline, response.message), nextActions);
                const textParts = finalTimeline
                  .filter((item): item is Extract<LocalSakiTimelineItem, { kind: "text" }> => item.kind === "text")
                  .map((item) => item.content.trim())
                  .filter(Boolean);
                const finalContent = textParts.length ? textParts.join("\n\n") : response.message;
                const durationSec =
                  message.thinkingStartedAt && !message.thinkingDurationSec
                    ? Math.max(1, Math.round((Date.now() - message.thinkingStartedAt) / 1000))
                    : message.thinkingDurationSec;
                const mergedAttachments = mergeSakiMessageAttachments(
                  message.attachments,
                  response.attachments,
                  nextActions
                );
                const nextMessage: LocalSakiMessage = {
                  ...message,
                  content: finalContent,
                  thinking: response.thinking ?? message.thinking,
                  ...(durationSec ? { thinkingDurationSec: durationSec } : {}),
                  timeline: finalTimeline,
                  source: response.source,
                  workflowExpanded: false,
                  streaming: false,
                  usage: response.usage,
                  ...(mergedAttachments.length ? { attachments: mergedAttachments } : {})
                };
                if (nextActions?.length) return { ...nextMessage, actions: nextActions };
                return nextMessage;
              })()
            : message
        );
        queueMicrotask(() => {
          saveConversationStateDirectly(next, activeConversationIdRef.current);
        });
        return next;
      });
      if (requestMode === "agent") {
        window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
      }
    };
    armStreamIdleTimer();

    const applyStreamEvent = (streamEvent: SakiChatStreamEvent) => {
        if (sakiStreamAbortRef.current?.signal.aborted) return;
        armStreamIdleTimer();
        if (streamEvent.type === "meta") {
          setReachable(streamEvent.source === "direct-model");
          if (streamEvent.skills) setSkills(streamEvent.skills);
          if (streamEvent.agentPermissionMode) setPermissionMode(streamEvent.agentPermissionMode);
          if (streamEvent.taskId) {
            activeTaskIdRef.current = streamEvent.taskId;
            window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
          }
          return;
        }

        if (streamEvent.type === "heartbeat") {
          return;
        }

        if (streamEvent.type === "delta") {
          streamSawDelta = true;
          streamSawProgress = true;
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              const durationSec =
                message.thinking && message.thinkingStartedAt && !message.thinkingDurationSec
                  ? Math.max(1, Math.round((Date.now() - message.thinkingStartedAt) / 1000))
                  : message.thinkingDurationSec;
              return {
                ...message,
                ...(durationSec ? { thinkingDurationSec: durationSec } : {}),
                timeline: appendSakiTimelineDelta(message.timeline, streamEvent.text)
              };
            })
          );
          return;
        }

        if (streamEvent.type === "thinking") {
          streamSawProgress = true;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    thinking: `${message.thinking ?? ""}${streamEvent.text}`,
                    thinkingStartedAt: message.thinkingStartedAt ?? Date.now(),
                    timeline: appendSakiTimelineThinking(message.timeline, streamEvent.text)
                  }
                : message
            )
          );
          return;
        }

        if (streamEvent.type === "workflow") {
          streamSawProgress = true;
          if (streamEvent.tool) {
            streamToolNames.add(streamEvent.tool);
            setSakiActivityMood(sakiActivityMoodForTool(streamEvent.tool, streamEvent.status));
          }
          if (streamEvent.status === "failed") {
            setSakiActivityMood("sorry");
          }
          const chatText = workflowEventChatText(streamEvent);
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              const workflow = message.workflow ?? [];
              const existing = workflow.find((step) => step.id === streamEvent.id);
              const nextStep: LocalSakiWorkflowStep = {
                id: streamEvent.id,
                stage: streamEvent.stage,
                message: streamEvent.message,
                status: streamEvent.status,
                ...(streamEvent.tool ? { tool: streamEvent.tool } : {}),
                ...(streamEvent.call ? { call: streamEvent.call } : {}),
                ...(streamEvent.actionId ? { actionId: streamEvent.actionId } : {}),
                ...(streamEvent.detail ? { detail: streamEvent.detail } : {}),
                createdAt: existing?.createdAt ?? new Date().toISOString()
              };
              let timeline = message.timeline;
              if (chatText) {
                timeline = upsertSakiTimelineText(timeline, {
                  id: `workflow:${streamEvent.id}`,
                  content: chatText,
                  source: "workflow",
                  createdAt: nextStep.createdAt
                });
              } else if (streamEvent.tool && streamEvent.stage === "tool" && streamEvent.status === "running") {
                timeline = upsertSakiTimelinePending(timeline, {
                  id: streamEvent.id,
                  tool: streamEvent.tool,
                  ...(streamEvent.call ? { call: streamEvent.call } : {}),
                  message: streamEvent.message,
                  createdAt: nextStep.createdAt
                });
              }
              return {
                ...message,
                ...(timeline !== message.timeline ? { timeline } : {}),
                workflow: existing
                  ? workflow.map((step) => (step.id === streamEvent.id ? nextStep : step))
                  : [...workflow, nextStep]
              };
            })
          );
          if (requestMode === "agent") {
            window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
          }
          return;
        }

        if (streamEvent.type === "action") {
          streamSawProgress = true;
          streamToolNames.add(streamEvent.action.tool);
          if (!isReadOnlySakiTool(streamEvent.action.tool)) {
            streamSawUnsafeAction = true;
          }
          setSakiActivityMood(sakiActivityMoodForTool(streamEvent.action.tool, streamEvent.action.status));
          if (streamEvent.action.status === "failed" || streamEvent.action.ok === false) {
            setSakiActivityMood("sorry");
          }
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              const actions = message.actions ?? [];
              const exists = actions.some((action) => action.id === streamEvent.action.id);
              return {
                ...message,
                actions: exists
                  ? actions.map((action) => (action.id === streamEvent.action.id ? streamEvent.action : action))
                  : [...actions, streamEvent.action],
                timeline: settleSakiTimelinePending(sealSakiTimelineDelta(message.timeline), streamEvent.action)
              };
            })
          );
          if (requestMode === "agent") {
            window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
          }
          return;
        }

        if (streamEvent.type === "done") {
          applyFinalResponse(streamEvent.response);
        }
      };
    try {
      const response = await api.sakiChatStream(token, request, applyStreamEvent, abortController.signal);
      applyFinalResponse(response);
      setPanelError(null);
    } catch (err) {
      if (userStoppedRef.current) {
        settleInterruptedSakiMessage(assistantId);
        return;
      }
      const runningTaskId = activeTaskIdRef.current;
      if (runningTaskId && requestMode === "agent") {
        let recovered = false;
        for (let attempt = 0; attempt < 2 && !recovered && !userStoppedRef.current; attempt += 1) {
          const reconnectAbort = new AbortController();
          sakiStreamAbortRef.current = reconnectAbort;
          armStreamIdleTimer();
          try {
            if (attempt > 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 400 * attempt));
            }
            if (userStoppedRef.current || reconnectAbort.signal.aborted) break;
            const response = await api.sakiStreamTaskReconnect(
              token,
              runningTaskId,
              applyStreamEvent,
              reconnectAbort.signal
            );
            applyFinalResponse(response);
            setPanelError(null);
            recovered = true;
          } catch {
            if (userStoppedRef.current || reconnectAbort.signal.aborted) break;
          }
        }
        if (recovered) return;
        if (userStoppedRef.current) {
          settleInterruptedSakiMessage(assistantId);
          return;
        }
      } else if (abortController.signal.aborted && !streamTimedOut) {
        settleInterruptedSakiMessage(assistantId);
        return;
      }
      try {
        const fallbackAllowed = !streamSawProgress && (canRetryAsPlainRequest() || (!streamSawDelta && streamToolNames.size === 0));
        if (fallbackAllowed) {
          clearStreamIdleTimer();
          const response = await api.sakiChat(token, request);
          applyFinalResponse(response);
          setPanelError(null);
          return;
        }
      } catch {
        // Fall through to the compact interruption message below.
      }
      const message = err instanceof Error ? err.message : "Saki 暂时没有回应";
      const friendlyMessage = /流式连接|network error|failed to fetch|stream ended|aborted/i.test(message)
        ? "连接刚刚中断了，当前回复可能不完整。你可以直接继续说，我会接着处理。"
        : message;
      setReachable(false);
      setSakiActivityMood("cry");
      setMessages((current) => {
        const nextFailed: LocalSakiMessage[] = current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: item.content ? `${item.content}\n\n${friendlyMessage}` : friendlyMessage,
                timeline: upsertSakiTimelineText(item.timeline, {
                  id: `error:${newClientId()}`,
                  content: friendlyMessage,
                  source: "error"
                }),
                source: "local-fallback" as const,
                workflowExpanded: false,
                streaming: false
              }
            : item
        );
        saveConversationStateDirectly(nextFailed);
        return nextFailed;
      });
    } finally {
      clearStreamIdleTimer();
      const current = sakiStreamAbortRef.current;
      if (!current || current.signal.aborted || streamCompleted) {
        sakiStreamAbortRef.current = null;
      }
      setLoading(false);
      if (requestMode === "agent") {
        window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
      }
    }
  }
  submitRef.current = submit;

  const auditSearchActive = !activeInstance && activePanelContext.auditSearch;
  const activeConversation = storedConversations.find((conversation) => conversation.id === activeConversationId);
  const contextLabel = activeConversation?.label ?? baseContextLabel;
  const contextPath = activeConversation?.detail ?? baseContextPath;
  const artMood: SakiArtMood = loading ? "thinking" : panelError || reachable === false ? "worry" : "normal";
  const statusClass = reachable === false ? "fallback" : reachable ? "online" : "pending";
  const statusLabel = reachable === false ? "本地回退" : reachable ? "已接入" : "待连接";
  const agentModeStatusLabel = mode === "agent" ? `${statusLabel} · ${sakiPermissionModeLabel(permissionMode)}` : statusLabel;

  const workspaceDisplayText = useMemo(() => {
    if (statusClass === "fallback") {
      return statusLabel;
    }
    if (workspaceSelection.type === "current") {
      const currentName = activeInstance ? activeInstance.name : activePanelContext.label;
      return `当前界面 · ${currentName}`;
    }
    if (workspaceSelection.type === "page") {
      return `页面 · ${activePanelContext.label}`;
    }
    if (workspaceSelection.type === "instance") {
      return `实例 · ${activeInstance?.name ?? "未知实例"}`;
    }
    return formatSakiContextPath(contextPath) || statusLabel;
  }, [activeInstance, activePanelContext.label, contextPath, statusClass, statusLabel, workspaceSelection]);

  const workspaceTitle = useMemo(() => {
    if (statusClass === "fallback") {
      return `Saki 状态: ${statusLabel}${contextPath ? ` (上下文: ${contextPath})` : ""}`;
    }
    const modeDesc =
      workspaceSelection.type === "current"
        ? "当前界面（自动跟随）"
        : workspaceSelection.type === "page"
          ? "固定页面工作区"
          : "固定实例工作区";
    return `Saki 工作区 [${modeDesc}]: ${activeInstance ? `${activeInstance.name} (${activeInstance.workingDirectory || "无路径"})` : activePanelContext.label}\n点击切换工作区`;
  }, [activeInstance, activePanelContext.label, contextPath, statusClass, statusLabel, workspaceSelection.type]);

  const contextPreview = contextText ? compactContextText(contextText.replace(/\s+/g, " "), 180) : "";
  const hasStreamingAssistant = messages.some((message) => message.role === "assistant" && message.streaming);
  const isAgentBusy = Boolean(loading || hasStreamingAssistant);
  useEffect(() => {
    if (prevBusyRef.current && !isAgentBusy) {
      if (sakiActivityMood && isSakiWorkMood(sakiActivityMood)) {
        const doneMoods: NonNullable<SakiActivityMood>[] = ["happy", "OK", "wink"];
        setSakiActivityMood(doneMoods[Math.floor(Math.random() * doneMoods.length)] ?? "happy");
      }
      if (mobileActiveTab === "video") {
        setChatPulseAlert(true);
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content?.trim());
        if (lastAssistant && lastAssistant.content) {
          setSakiVideoBubble(lastAssistant.content.trim());
          if (pokeTimerRef.current) window.clearTimeout(pokeTimerRef.current);
          pokeTimerRef.current = window.setTimeout(() => {
            setSakiVideoBubble(null);
            pokeTimerRef.current = null;
          }, 15000);
        }
      }
      const nextJob = followUpQueueRef.current[0];
      if (nextJob && lastRunCompletedRef.current) {
        setFollowUpQueue((current) => current.filter((job) => job.id !== nextJob.id));
        window.setTimeout(() => {
          void submitRef.current(undefined, {
            message: nextJob.message,
            ...(nextJob.attachments ? { attachments: nextJob.attachments } : {})
          });
        }, 40);
      }
    }
    prevBusyRef.current = isAgentBusy;
  }, [isAgentBusy, mobileActiveTab, messages, sakiActivityMood]);

  useEffect(() => {
    const handleActiveTaskUpdated = () => {
      if (sakiStreamAbortRef.current && !sakiStreamAbortRef.current.signal.aborted) {
        return;
      }
      void reconnectActiveTask();
    };
    window.addEventListener("saki:active_task_updated", handleActiveTaskUpdated);
    return () => window.removeEventListener("saki:active_task_updated", handleActiveTaskUpdated);
  }, [token, activeInstance?.id]);

  useEffect(() => {
    if (mobileActiveTab === "chat") {
      setChatPulseAlert(false);
    }
  }, [mobileActiveTab]);
  const launcherEdge = launcherAttachedEdge ?? sakiLauncherEdgeForPosition(launcherPosition, pet.scale);
  const launcherStyle: React.CSSProperties = {
    left: 0,
    top: 0,
    right: "auto",
    bottom: "auto",
    ["--saki-x" as string]: `${launcherPosition.x}px`,
    ["--saki-y" as string]: `${launcherPosition.y}px`,
    ...(launcherDragging ? {} : { transform: `translate(${launcherPosition.x}px, ${launcherPosition.y}px)` })
  };

  const sakiGreetings = useMemo(() => [
    t("saki.chat.greeting.1"),
    t("saki.chat.greeting.2"),
    t("saki.chat.greeting.3"),
    t("saki.chat.greeting.4"),
    t("saki.chat.greeting.5")
  ], [t]);

  function handleSakiPoke() {
    if (pokeTimerRef.current !== null) {
      window.clearTimeout(pokeTimerRef.current);
    }
    const now = Date.now();
    const streak = pokeStreakRef.current;
    if (now - streak.lastAt > 1400) streak.count = 0;
    streak.count += 1;
    streak.lastAt = now;

    if (streak.count >= 6) {
      streak.count = 0;
      const eggLines = [
        t("saki.chat.egg.1"),
        t("saki.chat.egg.2"),
        t("saki.chat.egg.3"),
        t("saki.chat.egg.4")
      ];
      const line = eggLines[Math.floor(Math.random() * eggLines.length)] ?? t("saki.chat.egg.3");
      setSakiPokeMood("middlefinger");
      setSakiVideoBubble(line);
      pokeTimerRef.current = window.setTimeout(() => {
        setSakiPokeMood(null);
        setSakiVideoBubble(null);
        pokeTimerRef.current = null;
      }, 4800);
      return;
    }

    const moods: NonNullable<SakiActivityMood>[] = ["wink", "happy", "OK", "surprised"];
    const randomMood: SakiActivityMood = moods[Math.floor(Math.random() * moods.length)] ?? "happy";
    const defaultGreeting = t("saki.chat.greeting.1");
    const randomGreeting: string = sakiGreetings[Math.floor(Math.random() * sakiGreetings.length)] ?? defaultGreeting;
    setSakiPokeMood(randomMood);
    setSakiVideoBubble(randomGreeting);
    pokeTimerRef.current = window.setTimeout(() => {
      setSakiPokeMood(null);
      setSakiVideoBubble(null);
      pokeTimerRef.current = null;
    }, 3500);
  }

  function canHoldSakiToTalk() {
    return !listening && !miniGameActive && !draggingFood && mobileActiveTab === "video";
  }

  function ensureSakiVoiceEcho() {
    if (!sakiVoiceEchoRef.current) {
      sakiVoiceEchoRef.current = new SakiVoiceEcho({
        onStateChange: setSakiEchoState
      });
    }
    return sakiVoiceEchoRef.current;
  }

  function handleSakiCharacterPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (draggingFood || miniGameActive) return;
    event.preventDefault();
    sakiHoldPointerRef.current = event.pointerId;
    sakiHoldActiveRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    if (!canHoldSakiToTalk()) return;
    if (sakiHoldTimerRef.current !== null) window.clearTimeout(sakiHoldTimerRef.current);
    sakiHoldTimerRef.current = window.setTimeout(() => {
      sakiHoldTimerRef.current = null;
      void startSakiHoldRecord();
    }, 300);
  }

  async function startSakiHoldRecord() {
    if (!canHoldSakiToTalk() || sakiHoldPointerRef.current === null) return;
    sakiHoldActiveRef.current = true;
    if (pokeTimerRef.current !== null) {
      window.clearTimeout(pokeTimerRef.current);
      pokeTimerRef.current = null;
    }
    setSakiPokeMood(null);
    setSakiVideoBubble(null);
    setSakiEchoState("hearing");
    const echo = ensureSakiVoiceEcho();
    const ok = await echo.beginHold();
    if (!sakiHoldActiveRef.current) {
      echo.cancelHold();
      return;
    }
    if (!ok) {
      sakiHoldActiveRef.current = false;
      setSakiEchoState("idle");
      setSakiVideoBubble(null);
      showComposerNotice("无法使用麦克风，Saki 没法学你说话。");
    }
  }

  function handleSakiCharacterPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (sakiHoldPointerRef.current !== null && event.pointerId !== sakiHoldPointerRef.current) return;
    finishSakiCharacterPointer(true);
  }

  function handleSakiCharacterPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (sakiHoldPointerRef.current !== null && event.pointerId !== sakiHoldPointerRef.current) return;
    finishSakiCharacterPointer(false);
  }

  function finishSakiCharacterPointer(allowPoke: boolean) {
    if (sakiHoldTimerRef.current !== null) {
      window.clearTimeout(sakiHoldTimerRef.current);
      sakiHoldTimerRef.current = null;
    }
    const wasHold = sakiHoldActiveRef.current;
    sakiHoldActiveRef.current = false;
    sakiHoldPointerRef.current = null;
    if (wasHold) {
      sakiVoiceEchoRef.current?.endHold();
      return;
    }
    if (allowPoke && !miniGameActive && !draggingFood) handleSakiPoke();
  }

  function handleCustomRoomBgUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setCustomRoomBg(dataUrl);
        try {
          localStorage.setItem("saki_custom_room_bg", dataUrl);
        } catch {}
      }
    };
    reader.readAsDataURL(file);
    event.currentTarget.value = "";
  }

  const isSakiListening = listening || sakiEchoState === "hearing";
  const echoActivityMood: SakiActivityMood = isSakiListening
    ? "hearing"
    : sakiEchoState === "speaking"
      ? "speaking"
      : null;

  useEffect(() => {
    if (!isAgentBusy && isSakiWorkMood(sakiActivityMood)) {
      setSakiActivityMood(null);
      return;
    }
    const settledMoods: SakiActivityMood[] = ["happy", "OK", "wink", "sorry", "cry", "pout", "rollback", "surprised"];
    if (!sakiActivityMood || !settledMoods.includes(sakiActivityMood)) return;
    const timer = window.setTimeout(() => setSakiActivityMood(null), 8000);
    return () => window.clearTimeout(timer);
  }, [sakiActivityMood, isAgentBusy]);

  useEffect(() => {
    if (
      open ||
      launcherDragging ||
      pet.hovered ||
      pet.widget !== null ||
      loading ||
      sakiActivityMood ||
      sakiPokeMood ||
      listening ||
      sakiEchoState !== "idle" ||
      miniGameActive ||
      draggingFood
    ) {
      setSakiSleepy(false);
      return;
    }
    const timer = window.setTimeout(() => setSakiSleepy(true), 50000);
    return () => window.clearTimeout(timer);
  }, [
    open,
    launcherDragging,
    pet.hovered,
    pet.widget,
    loading,
    sakiActivityMood,
    sakiPokeMood,
    listening,
    sakiEchoState,
    miniGameActive,
    draggingFood
  ]);

  // Once sleepy nods off, gently settle back to normal idle after 20 seconds instead of looping forever
  useEffect(() => {
    if (!sakiSleepy) return;
    const timer = window.setTimeout(() => setSakiSleepy(false), 20000);
    return () => window.clearTimeout(timer);
  }, [sakiSleepy]);

  const effectiveWorkMood = isAgentBusy ? sakiActivityMood : (isSakiWorkMood(sakiActivityMood) ? null : sakiActivityMood);
  const effectiveActivityMood = pet.music.playing
    ? "singing"
    : echoActivityMood ?? sakiPokeMood ?? effectiveWorkMood ?? (sakiSleepy ? "sleepy" : null);

  const activeStreamingAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.streaming);
  const activeStreamingContent = activeStreamingAssistant?.content?.trim();
  const activeStreamingThinking = activeStreamingAssistant?.thinking?.trim();
  const isStreamingReply = Boolean(activeStreamingAssistant && activeStreamingContent);

  const videoBubbleText = sakiVideoBubble
    ? sakiVideoBubble
    : (activeStreamingAssistant && activeStreamingContent)
    ? activeStreamingContent
    : (activeStreamingAssistant && activeStreamingThinking)
    ? t("saki.chat.thinking")
    : loading && !hasStreamingAssistant
    ? t("saki.chat.thinking")
    : hasStreamingAssistant
    ? t("saki.chat.replying")
    : isAgentBusy && sakiActivityMood === "working"
    ? t("saki.chat.working")
    : isAgentBusy && sakiActivityMood === "reading"
    ? t("saki.chat.reading")
    : isAgentBusy && sakiActivityMood === "checkfiles"
    ? t("saki.chat.checkfiles")
    : listening
    ? t("saki.chat.dictating")
    : sakiEchoState === "hearing"
    ? t("saki.chat.echoRelease")
    : sakiEchoState === "speaking"
    ? t("saki.chat.echoSpeaking")
    : null;

  useEffect(() => {
    if (!videoBubbleRef.current) return;
    if (isStreamingReply) {
      videoBubbleRef.current.scrollTop = videoBubbleRef.current.scrollHeight;
    } else {
      videoBubbleRef.current.scrollTop = 0;
    }
  }, [videoBubbleText, isStreamingReply]);

  return (
    <>
      <ChatLauncher
        open={open}
        sakiLieMode={sakiLieMode}
        launcherRef={launcherRef}
        petStageRef={petStageRef}
        launcherDragging={launcherDragging}
        launcherEdgeAttached={launcherEdgeAttached}
        launcherEdge={launcherEdge}
        launcherStyle={launcherStyle}
        sakiFileHoverActive={sakiFileHoverActive}
        fileDragActive={fileDragActive}
        artMood={artMood}
        activityMood={effectiveActivityMood}
        draggingExpression={draggingExpression}
        pet={pet}
        language={language}
        intimacyLevel={getFavorabilityLevelInfo(sakiFavorabilityExp).level}
        intimacyTitle={getFavorabilityLevelInfo(sakiFavorabilityExp).title}
        foods={getLocalizedFoodMenu(language)}
        canAfford={(cost) => isUnlimitedPoints || numericSakiPoints >= cost}
        onFeed={(foodId) => {
          const food = getLocalizedFoodMenu(language).find((item) => item.id === foodId);
          if (!food) return;
          handleFeedSaki(food);
          pet.applyCare("feed", food.favorability);
          pet.showBubble(food.greeting, 3200);
        }}
        onCaptureSticker={() => {
          void capturePetSticker();
        }}
        onIntimacy={(amount) => addFavorabilityExp(amount)}
        onOpenChat={() => setOpen(true)}
        onClick={handleLauncherClick}
        onPointerDown={handleLauncherPointerDown}
        onPointerMove={handleLauncherPointerMove}
        onPointerUp={finishLauncherDrag}
        onPointerCancel={finishLauncherDrag}
        onDragEnter={handleSakiFileDragEnter}
        onDragOver={handleSakiFileDragOver}
        onDragLeave={handleSakiFileDragLeave}
        onDrop={handleSakiFileDrop}
      />

      <section
        ref={panelRef}
        className={`saki-panel ${messagesExpanded ? "expanded" : "collapsed"} ${fullscreen ? "fullscreen" : ""} ${sakiFileHoverActive ? "drop-ready" : ""} ${open ? "visible" : "hidden"} mobile-tab-${mobileActiveTab}`}
        aria-label="Saki Copilot"
        onDragEnter={handleSakiFileDragEnter}
        onDragOver={handleSakiFileDragOver}
        onDragLeave={handleSakiFileDragLeave}
        onDrop={handleSakiFileDrop}
      >
        <SakiPathOpenContext.Provider value={onOpenWorkspaceFile ? openWorkspacePath : undefined}>
        {sakiFileHoverActive ? (
          <div className="saki-drop-overlay" aria-hidden="true">
            <FileText size={18} />
            <span>松开交给 Saki</span>
          </div>
        ) : null}

        {composerNotice ? (
          <LiquidGlassContainer
            className="saki-composer-notice-toast"
            displacementScale={100}
            zoom={1.20}
            refractionIntensity={1.2}
            blurAmount={0}
            saturation={108}
            cornerRadius={999}
            mode="shader"
            role="status"
            onMouseEnter={handleNoticeMouseEnter}
            onMouseLeave={handleNoticeMouseLeave}
          >
            <div className="saki-composer-notice-icon" aria-hidden="true">
              <Sparkles size={14} />
            </div>
            <span className="saki-composer-notice-text">{composerNotice}</span>
            <button
              type="button"
              className="saki-composer-notice-close"
              onClick={() => {
                setComposerNotice(null);
                if (composerNoticeTimerRef.current !== null) {
                  window.clearTimeout(composerNoticeTimerRef.current);
                  composerNoticeTimerRef.current = null;
                }
              }}
              title="关闭提示"
              aria-label="关闭提示"
            >
              <X size={13} />
            </button>
          </LiquidGlassContainer>
        ) : null}

        <div className="saki-messages-container">

          <SakiVideoPane
            mobileActiveTab={mobileActiveTab}
            setMobileActiveTab={setMobileActiveTab}
            customRoomBg={customRoomBg}
            setCustomRoomBg={setCustomRoomBg}
            roomBgInputRef={roomBgInputRef}
            handleCustomRoomBgUpload={handleCustomRoomBgUpload}
            miniGameActive={miniGameActive}
            setMiniGameActive={setMiniGameActive}
            setSakiPokeMood={setSakiPokeMood}
            handleMiniGameFinish={handleMiniGameFinish}
            chatPulseAlert={chatPulseAlert}
            setChatPulseAlert={setChatPulseAlert}
            sakiFavorabilityExp={sakiFavorabilityExp}
            favorabilityPop={favorabilityPop}
            language={language}
            closeSakiPanel={closeSakiPanel}
            sakiCharacterRef={sakiCharacterRef}
            artMood={artMood}
            effectiveActivityMood={effectiveActivityMood}
            isDragOverSaki={isDragOverSaki}
            sakiEchoState={sakiEchoState}
            isSakiListening={isSakiListening}
            handleSakiCharacterPointerDown={handleSakiCharacterPointerDown}
            handleSakiCharacterPointerUp={handleSakiCharacterPointerUp}
            handleSakiCharacterPointerCancel={handleSakiCharacterPointerCancel}
            handleSakiPoke={handleSakiPoke}
            draggingFood={draggingFood}
            videoBubbleText={videoBubbleText}
            isStreamingReply={isStreamingReply}
            videoBubbleRef={videoBubbleRef}
            feedMenuOpen={feedMenuOpen}
            setFeedMenuOpen={setFeedMenuOpen}
            isUnlimitedPoints={isUnlimitedPoints}
            numericSakiPoints={numericSakiPoints}
            startFoodDrag={startFoodDrag}
            listening={listening}
            toggleSpeechInput={toggleSpeechInput}
          />

          <div className={`saki-messages-inner ${mobileActiveTab === "chat" ? "mobile-show" : "mobile-hide"}`}>
            <div className={`saki-header ${workspaceDropdownOpen ? "workspace-open" : ""}`}>
              <div className="saki-header-left">
                <button
                  type="button"
                  className="saki-mobile-back-video-btn"
                  title="前往 Saki 陪伴"
                  aria-label="前往陪伴"
                  onClick={() => setMobileActiveTab("video")}
                >
                  <ChevronLeft size={14} />
                  <span>陪伴</span>
                </button>
                <div className="saki-workspace-selector-container" ref={dropdownRef}>
                  <button
                    type="button"
                    className={`saki-agent-status ${statusClass} ${workspaceDropdownOpen ? "dropdown-open" : ""}`}
                    title={workspaceTitle}
                    onClick={() => {
                      setWorkspaceDropdownOpen((prev) => !prev);
                      if (!workspaceDropdownOpen) {
                        void loadInstances();
                      }
                    }}
                    aria-expanded={workspaceDropdownOpen}
                    aria-haspopup="listbox"
                  >
                    <span className="saki-agent-status-dot" aria-hidden="true" />
                    <span className="saki-agent-status-text">
                      {workspaceDisplayText}
                    </span>
                    <ChevronDown size={11} className={`saki-agent-status-chevron ${workspaceDropdownOpen ? "open" : ""}`} />
                  </button>

                  {workspaceDropdownOpen ? (
                    <div className="saki-workspace-dropdown" role="listbox" aria-label="选择 Saki 工作区">
                      <div className="saki-workspace-dropdown-header">
                        <span className="saki-workspace-dropdown-title">工作区选择</span>
                        <span className="saki-workspace-dropdown-hint">选择 Saki 智能体工作环境（默认自动跟随当前界面）</span>
                      </div>

                      {/* Default Workspace */}
                      <div className="saki-workspace-section">
                        <div className="saki-workspace-section-title">默认</div>
                        <button
                          type="button"
                          className={`saki-workspace-item ${workspaceSelection.type === "current" ? "active" : ""}`}
                          onClick={() => handleSelectWorkspace({ type: "current" })}
                          role="option"
                          aria-selected={workspaceSelection.type === "current"}
                        >
                          <div className="saki-workspace-item-icon current">
                            <Compass size={14} />
                          </div>
                          <div className="saki-workspace-item-content">
                            <div className="saki-workspace-item-title">
                              当前界面 (自动跟随)
                            </div>
                            <div className="saki-workspace-item-subtitle">
                              当前: {activeInstance ? activeInstance.name : activePanelContext.label}
                            </div>
                          </div>
                          {workspaceSelection.type === "current" ? (
                            <Check size={14} className="saki-workspace-item-check" />
                          ) : null}
                        </button>
                      </div>

                      {/* Pages Workspace */}
                      <div className="saki-workspace-section">
                        <div className="saki-workspace-section-title">页面 ({accessiblePages.length})</div>
                        <div className="saki-workspace-items-grid">
                          {accessiblePages.map((page) => {
                            const isSelected = workspaceSelection.type === "page" && workspaceSelection.view === page.view;
                            const PageIcon = page.icon;
                            return (
                              <div
                                key={page.view}
                                className={`saki-workspace-item ${isSelected ? "active" : ""}`}
                                onClick={() => handleSelectWorkspace({ type: "page", view: page.view })}
                                role="option"
                                aria-selected={isSelected}
                              >
                                <div className="saki-workspace-item-icon page">
                                  <PageIcon size={14} />
                                </div>
                                <div className="saki-workspace-item-content">
                                  <div className="saki-workspace-item-title">{page.label}</div>
                                  <div className="saki-workspace-item-subtitle">{page.detail}</div>
                                </div>
                                <div className="saki-workspace-item-actions">
                                  {onNavigateView ? (
                                    <button
                                      type="button"
                                      className="saki-workspace-item-jump-btn"
                                      title={`前往${page.label}页面`}
                                      onClick={(e) => handleJumpToWorkspace(e, page.view)}
                                    >
                                      <ExternalLink size={12} />
                                    </button>
                                  ) : null}
                                  {isSelected ? <Check size={14} className="saki-workspace-item-check" /> : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Instances Workspace */}
                      <div className="saki-workspace-section">
                        <div className="saki-workspace-section-header">
                          <span className="saki-workspace-section-title">实例 ({availableInstances.length})</span>
                          {instancesLoading ? <Loader2 size={11} className="saki-spin" /> : null}
                        </div>
                        {availableInstances.length > 5 ? (
                          <div className="saki-workspace-search-wrap">
                            <Search size={12} />
                            <input
                              type="text"
                              value={workspaceSearch}
                              onChange={(e) => setWorkspaceSearch(e.target.value)}
                              placeholder="搜索实例名称或目录..."
                              className="saki-workspace-search-input"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        ) : null}
                        <div className="saki-workspace-items-list">
                          {filteredInstances.length > 0 ? (
                            filteredInstances.map((inst) => {
                              const isSelected = workspaceSelection.type === "instance" && workspaceSelection.instanceId === inst.id;
                              const isRunning = inst.status === "RUNNING";
                              return (
                                <div
                                  key={inst.id}
                                  className={`saki-workspace-item ${isSelected ? "active" : ""}`}
                                  onClick={() => handleSelectWorkspace({ type: "instance", instanceId: inst.id })}
                                  role="option"
                                  aria-selected={isSelected}
                                >
                                  <div className="saki-workspace-item-icon instance">
                                    <Server size={14} />
                                  </div>
                                  <div className="saki-workspace-item-content">
                                    <div className="saki-workspace-item-title">
                                      <span
                                        className={`saki-workspace-instance-dot ${isRunning ? "running" : "stopped"}`}
                                        title={isRunning ? "运行中" : "已停止"}
                                      />
                                      <span>{inst.name}</span>
                                    </div>
                                    <div className="saki-workspace-item-subtitle" title={inst.workingDirectory || inst.id}>
                                      {inst.workingDirectory ? formatSakiContextPath(inst.workingDirectory, 20) : inst.id}
                                    </div>
                                  </div>
                                  <div className="saki-workspace-item-actions">
                                    {onNavigateView ? (
                                      <button
                                        type="button"
                                        className="saki-workspace-item-jump-btn"
                                        title={`在主界面打开「${inst.name}」`}
                                        onClick={(e) => handleJumpToWorkspace(e, "instances", inst.id)}
                                      >
                                        <ExternalLink size={12} />
                                      </button>
                                    ) : null}
                                    {isSelected ? <Check size={14} className="saki-workspace-item-check" /> : null}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="saki-workspace-empty">
                              {instancesLoading ? "正在获取实例..." : "暂无可用实例"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="saki-header-actions">
                <button
                  className={`icon-button mini ${historyOpen ? "active" : ""}`}
                  type="button"
                  title="历史记录"
                  aria-pressed={historyOpen}
                  onClick={toggleSakiHistory}
                >
                  <Clock size={15} />
                </button>
                {onOpenPointsUsage ? (
                  <button className="icon-button mini" type="button" title="积分与使用量" onClick={onOpenPointsUsage}>
                    <BarChart2 size={15} />
                  </button>
                ) : null}
                <button
                  className="icon-button mini saki-fullscreen-toggle"
                  type="button"
                  title={fullscreen ? "退出全屏" : "放大"}
                  aria-label={fullscreen ? "退出全屏" : "放大 Saki 聊天窗口"}
                  aria-pressed={fullscreen}
                  onClick={toggleSakiFullscreen}
                >
                  {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button className="icon-button mini" type="button" title="新对话" onClick={startNewConversation}>
                  <Plus size={15} />
                </button>
                <button className="icon-button mini" type="button" title="关闭输入框" onClick={closeSakiPanel}>
                  <X size={15} />
                </button>
              </div>
            </div>

          <SakiHistoryDrawer
            isOpen={historyOpen && messagesExpanded}
            activeConversationId={activeConversationId}
            storedConversations={storedConversations}
            onClose={() => setHistoryOpen(false)}
            onNewConversation={startNewConversation}
            onLoadConversation={loadConversation}
            onDeleteConversation={deleteConversation}
            formatDate={formatDate}
          />

          {panelError ? (
            <div className="saki-error-context">
              <Bug size={15} />
              <span>{panelError}</span>
              {canUseAgent ? (
                <button className="small-button" type="button" onClick={() => selectSakiMode("agent")}>
                  <Wrench size={14} />
                  智能体
                </button>
              ) : canUseChat ? (
                <button className="small-button" type="button" onClick={() => selectSakiMode("chat")}>
                  <Sparkles size={14} />
                  对话
                </button>
              ) : null}
            </div>
          ) : null}

          {contextText ? (
            <div className="saki-attached-context">
              <div>
                <span>{contextTitle ?? "已附加上下文"}</span>
                <p>{contextPreview}</p>
              </div>
              {canUseChat ? (
                <button className="small-button" type="button" onClick={() => selectSakiMode("chat")}>
                  <Sparkles size={14} />
                  对话
                </button>
              ) : canUseAgent ? (
                <button className="small-button" type="button" onClick={() => selectSakiMode("agent")}>
                  <Wrench size={14} />
                  智能体
                </button>
              ) : null}
              <button
                className="icon-button mini"
                type="button"
                title="清除上下文"
                onClick={() => {
                  setContextTitle(null);
                  setContextText(null);
                }}
              >
                <X size={15} />
              </button>
            </div>
          ) : null}

          <SakiMessagesList
            messagesRef={sakiMessagesRef}
            onScroll={handleSakiMessagesScroll}
            messages={messages}
            loading={loading}
            hasStreamingAssistant={hasStreamingAssistant}
            avatar={sakiArtAssets.avatar}
            thinkingGif={sakiArtAssets.thinkingGif}
            actionBusyId={actionBusyId}
            copiedUserMessageId={copiedUserMessageId}
            copiedAssistantMessageId={copiedAssistantMessageId}
            onRollbackUserTurn={rollbackUserTurn}
            onCopyUserMessage={copyUserMessage}
            onCopyAssistantMessage={copyAssistantMessage}
            onRetryAssistantTurn={retryAssistantTurn}
            onDeleteAssistantTurn={deleteAssistantTurn}
            onDecideAction={decideAction}
            onOpenPath={onOpenWorkspaceFile ? openWorkspacePath : undefined}
            onRollbackAllFileActions={rollbackAllFileActions}
            onPreviewAttachment={(preview) => setPreviewingAttachment(preview)}
            token={token}
          />
        </div>
      </div>

      <SakiComposer
        onSubmit={submit}
        imageInputRef={imageInputRef}
        attachmentInputRef={attachmentInputRef}
        onAddFiles={addFilesToComposer}
        messagesExpanded={messagesExpanded}
        onToggleMessagesExpanded={() => setMessagesExpanded((current) => !current)}
        messages={messages}
        loading={loading}
        hasStreamingAssistant={hasStreamingAssistant}
        artShuru={sakiArtAssets.shuru}
        artShuruBlack={sakiArtAssets.shuruBlack}
        thinkingGif={sakiArtAssets.thinkingGif}
        sakiFileHoverActive={sakiFileHoverActive}
        mentionMenuOpen={mentionMenuOpen}
        mentionCandidates={mentionCandidates}
        mentionIndex={mentionIndex}
        onMentionIndexChange={setMentionIndex}
        onApplyMention={applyMention}
        onSyncMentionCaret={syncMentionCaret}
        onMentionDismissedStart={setMentionDismissedStart}
        mentionCaret={mentionCaret}
        sakiAddMenuOpen={sakiAddMenuOpen}
        sakiAddBtnRef={sakiAddBtnRef}
        onToggleAddMenu={() => setSakiAddMenuOpen(!sakiAddMenuOpen)}
        composerTextareaRef={composerTextareaRef}
        draft={draft}
        onDraftChange={(val) => setDraft(val)}
        onComposerPaste={handleComposerPaste}
        attachments={attachments}
        onPreviewAttachment={(preview) => setPreviewingAttachment(preview)}
        onRemoveAttachment={(attachment) =>
          setAttachments((current) => current.filter((item) => (item.id ?? item.name) !== (attachment.id ?? attachment.name)))
        }
        followUpQueue={followUpQueue}
        onRemoveFollowUp={(id) => setFollowUpQueue((current) => current.filter((item) => item.id !== id))}
        composerNotice={composerNotice}
        listening={listening}
        onToggleSpeechInput={toggleSpeechInput}
        annotationMode={annotationMode}
        onToggleSelectionAnnotation={toggleSelectionAnnotation}
        composerBusy={composerBusy}
        onPasteImageFromClipboard={pasteImageFromClipboard}
        onOpenComposerFilePicker={(input) => openComposerFilePicker(input)}
        onCaptureScreenAttachment={captureScreenAttachment}
        canUseChat={canUseChat}
        canUseAgent={canUseAgent}
        mode={mode}
        onSelectMode={selectSakiMode}
        permissionSelectorRef={permissionSelectorRef}
        permissionDropdownOpen={permissionDropdownOpen}
        onTogglePermissionDropdown={() => setPermissionDropdownOpen(!permissionDropdownOpen)}
        permissionMode={permissionMode}
        modelSelectorRef={modelSelectorRef}
        modelDropdownOpen={modelDropdownOpen}
        onToggleModelDropdown={() => setModelDropdownOpen(!modelDropdownOpen)}
        currentModelName={currentModelName}
        currentModelId={currentModelId}
        availableModels={availableModels}
        onStopSakiGeneration={stopSakiGeneration}
        contextText={contextText}
        auditSearchActive={Boolean(auditSearchActive)}
        hasActiveInstance={Boolean(activeInstance)}
        token={token}
      />
    {previewingAttachment ? (
        <SakiAttachmentModal
          attachment={previewingAttachment.attachment}
          editable={previewingAttachment.editable}
          onClose={() => {
            setPreviewingAttachment(null);
            keepComposerVisible(true);
          }}
          onSave={(updated) => {
            setAttachments((current) =>
              current.map((item) =>
                (item.id ?? item.name) === (updated.id ?? updated.name) ? updated : item
              )
            );
            setPreviewingAttachment(null);
            keepComposerVisible(true);
          }}
          onRemove={() => {
            setAttachments((current) =>
              current.filter(
                (item) =>
                  (item.id ?? item.name) !==
                  (previewingAttachment.attachment.id ?? previewingAttachment.attachment.name)
              )
            );
            setPreviewingAttachment(null);
            keepComposerVisible(true);
          }}
        />
      ) : null}
        </SakiPathOpenContext.Provider>
    </section>
    <SakiChatDropdowns
      sakiAddMenuOpen={sakiAddMenuOpen}
      sakiAddBtnRef={sakiAddBtnRef}
      sakiAddMenuRef={sakiAddMenuRef}
      composerBusy={composerBusy}
      onCloseAddMenu={() => setSakiAddMenuOpen(false)}
      onPasteImage={() => void pasteImageFromClipboard()}
      onUploadFile={() => openComposerFilePicker(attachmentInputRef.current)}
      onCaptureScreen={() => void captureScreenAttachment()}
      permissionDropdownOpen={permissionDropdownOpen}
      permissionSelectorRef={permissionSelectorRef}
      permissionDropdownRef={permissionDropdownRef}
      permissionMode={permissionMode}
      onSelectPermissionMode={(nextMode) => {
        setPermissionMode(nextMode);
        setPermissionDropdownOpen(false);
      }}
      modelDropdownOpen={modelDropdownOpen}
      modelSelectorRef={modelSelectorRef}
      modelDropdownRef={modelDropdownRef}
      availableModels={availableModels}
      currentModelId={currentModelId}
      modelPointsMultipliers={modelPointsMultipliers}
      language={language}
      onSelectModel={(modelId) => {
        setModelDropdownOpen(false);
        void selectModel(modelId);
      }}
    />
    </>
  );
}
