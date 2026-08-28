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
  Copy,
  CornerDownLeft,
  CornerUpLeft,
  Cpu,
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
  SakiPromptSeed,
  SakiSelectionCapture,
  SakiSubmitOverride
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
import { MarkdownContent } from "../common/MarkdownContent.js";
import {
  SakiAttachmentChip,
  SakiCharacterArt,
  SakiStreamStatus,
  SakiThinkingContent,
  SakiToolActionCard,
  appendSakiTimelineDelta,
  appendSakiTimelineThinking,
  clampSakiLauncherPosition,
  hasPersistableSakiSpeech,
  isReadOnlySakiTool,
  isSakiFileEditTool,
  isSakiFileRollbackAction,
  isSakiRollbackableFileEdit,
  latestSakiConversationForContext,
  mergeSakiActionList,
  mergeSakiFinalText,
  mergeSakiFinalTimeline,
  mergeSakiTimelineActions,
  persistableSakiMessages,
  readSakiConversations,
  readSakiLauncherPosition,
  renderableSakiTimeline,
  sakiAttachmentSummary,
  sakiConversationTitle,
  sakiFileEditActionLabel,
  sakiFoodMenu,
  getLocalizedFoodMenu,
  sakiLauncherAttachedEdgeForPosition,
  sakiLauncherAttachedSize,
  sakiLauncherEdgeForPosition,
  sakiLauncherSnapEdgeForPosition,
  sameSakiLauncherPosition,
  sealSakiTimelineDelta,
  snapSakiLauncherPositionToEdge,
  stripHeavySakiAttachmentData,
  upsertSakiTimelineAction,
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
import { SakiAttachmentModal } from "./SakiAttachmentModal.js";
import { SakiMentionMenu } from "./SakiMentionMenu.js";
import { ChatLauncher } from "./chat/ChatLauncher.js";
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
  pullDragRequest = null,
  onPullDragConsumed
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
  pullDragRequest?: SakiPullDragRequest | null;
  onPullDragConsumed?: () => void;
}) {
  const contextKey = instance ? `instance:${instance.id}` : `panel:${panelContext.label}:${panelContext.detail}`;
  const baseContextLabel = instance ? instance.name : panelContext.label;
  const baseContextPath = instance?.workingDirectory ?? panelContext.detail;
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
  const [sakiActivityMood, setSakiActivityMood] = useState<SakiActivityMood>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState<SakiLauncherPosition | null>(() => readSakiLauncherPosition());
  const [launcherDragging, setLauncherDragging] = useState(false);

  useEffect(() => {
    if (wakeCount > 0 && !pullDragRequest) {
      const viewportWidth = globalThis.innerWidth || 1200;
      const targetPos: SakiLauncherPosition = snapSakiLauncherPositionToEdge(
        { x: viewportWidth - sakiLauncherAttachedSize.width, y: 180 },
        "right"
      );
      setLauncherPosition(targetPos);
      writeSakiLauncherPosition(targetPos);
    }
  }, [wakeCount, pullDragRequest]);

  useEffect(() => {
    return () => {
      onLauncherDraggingChange?.(false);
    };
  }, [onLauncherDraggingChange]);
  const { language } = usePanelLanguage();
  const [draggingExpression, setDraggingExpression] = useState<string | null>(null);
  const [storedConversations, setStoredConversations] = useState<StoredSakiConversation[]>(() => readSakiConversations());
  const [activeConversationId, setActiveConversationId] = useState(() => newClientId());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<SakiInputAttachment[]>([]);
  const [previewingAttachment, setPreviewingAttachment] = useState<{ attachment: SakiInputAttachment; editable: boolean } | null>(null);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [composerBusy, setComposerBusy] = useState<"image" | "file" | "screenshot" | null>(null);
  const [sakiFileHoverActive, setSakiFileHoverActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [sakiEchoState, setSakiEchoState] = useState<SakiVoiceEchoState>("idle");
  const [annotationMode, setAnnotationMode] = useState(false);
  const [sakiPokeMood, setSakiPokeMood] = useState<SakiActivityMood>(null);
  const [sakiVideoBubble, setSakiVideoBubble] = useState<string | null>(null);
  const pokeTimerRef = useRef<number | null>(null);
  const [customRoomBg, setCustomRoomBg] = useState<string | null>(() => {
    try {
      return localStorage.getItem("saki_custom_room_bg");
    } catch {
      return null;
    }
  });
  const roomBgInputRef = useRef<HTMLInputElement | null>(null);
  const [sakiFavorabilityExp, setSakiFavorabilityExp] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("saki_favorability");
      return saved !== null ? Math.max(0, parseInt(saved, 10)) : 120;
    } catch {
      return 120;
    }
  });
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

  function getFavorabilityLevelInfo(totalExp: number) {
    const isEn = language === "en-US";
    const isTw = language === "zh-TW";
    const levelThresholds = [
      { level: 1, title: isEn ? "Acquaintance" : isTw ? "初識" : "初识", minExp: 0, maxExp: 100 },
      { level: 2, title: isEn ? "Rapport" : isTw ? "默契" : "默契", minExp: 100, maxExp: 250 },
      { level: 3, title: isEn ? "Intimate" : isTw ? "親密" : "亲密", minExp: 250, maxExp: 500 },
      { level: 4, title: isEn ? "Best Friends" : isTw ? "摯友" : "挚友", minExp: 500, maxExp: 900 },
      { level: 5, title: isEn ? "Kindred Spirits" : isTw ? "心有靈犀" : "心有灵犀", minExp: 900, maxExp: 1400 },
      { level: 6, title: isEn ? "Incomparable" : isTw ? "獨一無二" : "独一无二", minExp: 1400, maxExp: 2000 },
      { level: 7, title: isEn ? "Galaxy Vow" : isTw ? "星河誓約" : "星河誓约", minExp: 2000, maxExp: 3000 },
      { level: 8, title: isEn ? "Eternal Bond" : isTw ? "永恆羈絆" : "永恒羁绊", minExp: 3000, maxExp: 5000 }
    ];

    for (let i = 0; i < levelThresholds.length; i++) {
      const tier = levelThresholds[i]!;
      if (totalExp < tier.maxExp) {
        const range = tier.maxExp - tier.minExp;
        const gained = totalExp - tier.minExp;
        const progress = Math.min(100, Math.max(0, Math.round((gained / range) * 100)));
        return {
          level: tier.level,
          title: tier.title,
          currentExp: totalExp,
          minExpForLevel: tier.minExp,
          maxExpForLevel: tier.maxExp,
          levelProgress: progress,
          isMaxLevel: false
        };
      }
    }

    return {
      level: 8,
      title: isEn ? "Eternal Bond" : isTw ? "永恆羈絆" : "永恒羁绊",
      currentExp: totalExp,
      minExpForLevel: 3000,
      maxExpForLevel: 5000,
      levelProgress: 100,
      isMaxLevel: true
    };
  }

  function addFavorabilityExp(amount: number) {
    setSakiFavorabilityExp((prev) => {
      const oldLevel = getFavorabilityLevelInfo(prev).level;
      const next = prev + amount;
      const newLevel = getFavorabilityLevelInfo(next).level;
      try {
        localStorage.setItem("saki_favorability", String(next));
      } catch {}

      if (newLevel > oldLevel) {
        const isEn = language === "en-US";
        const isTw = language === "zh-TW";
        setSakiPokeMood("happy");
        setSakiVideoBubble(
          isEn
            ? `🎉 Wow! Affection leveled up! Reached Lv.${newLevel}～✨`
            : isTw
            ? `🎉 哇！好感度升級啦！達到 Lv.${newLevel}～✨`
            : `🎉 哇！好感度升级啦！达到 Lv.${newLevel}～✨`
        );
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
      setSakiVideoBubble(
        language === "en-US"
          ? "Not enough Saki points to buy this～ Chat more with me to earn points! ✨"
          : language === "zh-TW"
          ? "目前 Saki 積分不夠買這個呢～可以多和我聊天賺取積分哦！✨"
          : "当前 Saki 积分不够买这个呢～可以多和我聊天赚取积分哦！✨"
      );
      if (pokeTimerRef.current) window.clearTimeout(pokeTimerRef.current);
      pokeTimerRef.current = window.setTimeout(() => {
        setSakiVideoBubble(null);
        pokeTimerRef.current = null;
      }, 3000);
      return;
    }

    if (!isUnlimitedPoints) {
      const nextPts = Math.max(0, numericSakiPoints - food.cost);
      onPointsBalanceChange?.({ points: nextPts, unlimitedPoints: false });
      addUserPoints(-food.cost);
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
    const isEn = language === "en-US";
    const isTw = language === "zh-TW";
    addFavorabilityExp(expReward);
    setSakiPokeMood("gaming");
    setSakiVideoBubble(
      isEn
        ? `Awesome! Scored ${score} pts, earned ${expReward} Affection EXP～✨`
        : isTw
        ? `太棒啦！得了 ${score} 分，獲得了 ${expReward} 點好感度經驗～✨`
        : `太棒啦！得了 ${score} 分，获得了 ${expReward} 点好感度经验～✨`
    );
    if (pokeTimerRef.current) window.clearTimeout(pokeTimerRef.current);
    pokeTimerRef.current = window.setTimeout(() => {
      setSakiPokeMood(null);
      setSakiVideoBubble(null);
      pokeTimerRef.current = null;
    }, 4500);
  }
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
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
  } | null>(null);
  const suppressLauncherClickRef = useRef(false);
  const conversationsRef = useRef<Record<string, LocalSakiMessage[]>>({});
  const previousContextKeyRef = useRef(contextKey);
  const restoringContextRef = useRef(false);
  const initialConversationLoadedRef = useRef(false);
  const annotationModeRef = useRef(false);
  const launcherAttachedEdge = launcherPosition ? sakiLauncherAttachedEdgeForPosition(launcherPosition) : null;
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

  useEffect(() => {
    void (async () => {
      let currentModel = "";
      try {
        const config = await api.sakiConfig(token);
        currentModel = config.model;
        onCurrentModelIdChange(currentModel);
      } catch {}
      try {
        const config = await api.sakiConfig(token);
        currentModel = config.model;
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
          const modelName = current.label || current.name || current.id;
          onCurrentModelNameChange(modelName);
        } else if (currentModel) {
          onCurrentModelNameChange(currentModel);
        }
      } catch {
        if (currentModel) {
          onCurrentModelNameChange(currentModel);
        }
      }
    })();
  }, [token, onCurrentModelIdChange, onCurrentModelNameChange, onAvailableModelsChange]);

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

  useEffect(() => {
    if (!token || loading) return;
    let cancelled = false;
    const checkActiveTask = async () => {
      try {
        const result = await api.sakiGetActiveTask(token, instance?.id);
        if (cancelled || !result.hasActiveTask || !result.task) return;
        const task = result.task;
        if (task.status === "running") {
          activeTaskIdRef.current = task.id;

          let assistantId = "";
          setMessages((current) => {
            const lastMsg = current.at(-1);
            if (lastMsg && lastMsg.role === "assistant") {
              assistantId = lastMsg.id;
              return current.map((msg) =>
                msg.id === assistantId ? { ...msg, streaming: true } : msg
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
                        timeline: appendSakiTimelineThinking(message.timeline, streamEvent.text)
                      }
                    : message
                )
              );
              return;
            }
            if (streamEvent.type === "delta") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        timeline: appendSakiTimelineDelta(message.timeline, streamEvent.text)
                      }
                    : message
                )
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
                  return {
                    ...message,
                    ...(chatText
                      ? {
                          timeline: upsertSakiTimelineText(message.timeline, {
                            id: `workflow:${streamEvent.id}`,
                            content: chatText,
                            source: "workflow",
                            createdAt: nextStep.createdAt
                          })
                        }
                      : {}),
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
                    timeline: upsertSakiTimelineAction(sealSakiTimelineDelta(message.timeline), streamEvent.action)
                  };
                })
              );
              return;
            }
            if (streamEvent.type === "done") {
              const response = streamEvent.response;
              activeTaskIdRef.current = null;
              setMessages((current) =>
                current.map((message) => {
                  if (message.id !== assistantId) return message;
                  const nextActions = response.actions?.length ? response.actions : message.actions;
                  const sealedTimeline = sealSakiTimelineDelta(message.timeline);
                  const finalTimeline = mergeSakiTimelineActions(mergeSakiFinalTimeline(sealedTimeline, response.message), nextActions);
                  const nextMessage: LocalSakiMessage = {
                    ...message,
                    content: response.message,
                    thinking: response.thinking ?? message.thinking,
                    timeline: finalTimeline,
                    source: response.source,
                    workflowExpanded: false,
                    streaming: false,
                    usage: response.usage
                  };
                  if (nextActions?.length) return { ...nextMessage, actions: nextActions };
                  return nextMessage;
                })
              );
            }
            if (streamEvent.type === "error") {
              activeTaskIdRef.current = null;
              setMessages((current) =>
                current.map((message) =>
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
                )
              );
            }
          };

          try {
            const finalResp = await api.sakiStreamTaskReconnect(token, task.id, applyStreamEvent, abortController.signal);
            activeTaskIdRef.current = null;
            if (finalResp.usage?.isUnlimited) {
              onPointsBalanceChange?.({ points: 0, unlimitedPoints: true });
            } else if (typeof finalResp.usage?.remainingPoints === "number") {
              onPointsBalanceChange?.({ points: finalResp.usage.remainingPoints, unlimitedPoints: false });
            }
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) return message;
                const nextActions = finalResp.actions?.length ? finalResp.actions : message.actions;
                const sealedTimeline = sealSakiTimelineDelta(message.timeline);
                const finalTimeline = mergeSakiTimelineActions(mergeSakiFinalTimeline(sealedTimeline, finalResp.message), nextActions);
                const nextMessage: LocalSakiMessage = {
                  ...message,
                  content: finalResp.message,
                  thinking: finalResp.thinking ?? message.thinking,
                  timeline: finalTimeline,
                  source: finalResp.source,
                  workflowExpanded: false,
                  streaming: false,
                  usage: finalResp.usage
                };
                if (nextActions?.length) return { ...nextMessage, actions: nextActions };
                return nextMessage;
              })
            );
          } catch {
          } finally {
            setLoading(false);
            setSakiActivityMood(null);
            activeTaskIdRef.current = null;
          }
        }
      } catch {
      }
    };
    void checkActiveTask();
    return () => {
      cancelled = true;
    };
  }, [token, instance?.id]);

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
        void submitSakiSelectionCapture(capture);
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

  useEffect(() => {
    if (initialConversationLoadedRef.current) return;
    initialConversationLoadedRef.current = true;
    const storedConversation = latestSakiConversationForContext(readSakiConversations(), contextKey);
    if (!storedConversation) return;
    restoringContextRef.current = true;
    setActiveConversationId(storedConversation.id);
    setMessages(storedConversation.messages);
  }, [contextKey]);

  useEffect(() => {
    const previousContextKey = previousContextKeyRef.current;
    if (previousContextKey === contextKey) return;

    conversationsRef.current[previousContextKey] = messages;
    previousContextKeyRef.current = contextKey;

    // If an agent task is actively executing or streaming, do not drop or reset the active chat:
    if (loading || activeTaskIdRef.current) {
      return;
    }

    restoringContextRef.current = true;
    const storedConversation = latestSakiConversationForContext(readSakiConversations(), contextKey);
    setActiveConversationId(storedConversation?.id ?? newClientId());
    setMessages(
      storedConversation?.messages ?? conversationsRef.current[contextKey] ?? [
        createSakiWelcomeMessage(getSakiWelcomeMessageText(instance, panelContext.label))
      ]
    );
    setDraft("");
    setPanelError(null);
    setContextTitle(null);
    setContextText(null);
    setSelectedSkillIds([]);
    setAttachments([]);
    setComposerNotice(null);
    setMode(coerceSakiMode("agent", canUseChat, canUseAgent));
    setPermissionMode(defaultSakiAgentPermissionMode);
  }, [canUseAgent, canUseChat, contextKey, instance, loading, messages, panelContext.label]);

  useEffect(() => {
    if (restoringContextRef.current) {
      restoringContextRef.current = false;
      return;
    }
    conversationsRef.current[contextKey] = messages;
    if (!hasPersistableSakiSpeech(messages)) {
      setStoredConversations((current) => {
        const next = current.filter((conversation) => conversation.id !== activeConversationId);
        if (next.length !== current.length) {
          writeSakiConversations(next);
        }
        return next;
      });
      return;
    }
    const now = new Date().toISOString();
    setStoredConversations((current) => {
      const existing = current.find((conversation) => conversation.id === activeConversationId);
      const storedMessages = persistableSakiMessages(messages);
      const nextConversation: StoredSakiConversation = {
        id: activeConversationId,
        contextKey,
        label: baseContextLabel,
        detail: baseContextPath,
        instanceId: (existing?.instanceId ?? instance?.id) || null,
        title: sakiConversationTitle(storedMessages),
        messages: storedMessages,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      const next = [nextConversation, ...current.filter((conversation) => conversation.id !== activeConversationId)]
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, 80);
      writeSakiConversations(next);
      return next;
    });
  }, [activeConversationId, baseContextLabel, baseContextPath, contextKey, instance?.id, messages]);

  useEffect(() => {
    if (!seed) return;
    setOpen(true);
    setDraft(seed.message);
    setPanelError(seed.panelError ?? null);
    setContextTitle(seed.contextTitle ?? null);
    setContextText(seed.contextText ?? null);
    setMode(coerceSakiMode(seed.mode, canUseChat, canUseAgent));
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
            nextSkills = await api.sakiSkills(token, instance ? `${instance.name} ${instance.workingDirectory} coding agent` : "coding agent");
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
  }, [canUseSkills, instance, open, token]);

  useEffect(() => {
    function clampCurrentLauncherPosition() {
      setLauncherPosition((current) => {
        if (!current) return current;
        const attachedEdge = sakiLauncherAttachedEdgeForPosition(current);
        const nextPosition = attachedEdge
          ? snapSakiLauncherPositionToEdge(current, attachedEdge)
          : clampSakiLauncherPosition(current, launcherRef.current, "expanded");
        if (current && sameSakiLauncherPosition(current, nextPosition)) return current;
        writeSakiLauncherPosition(nextPosition);
        return nextPosition;
      });
    }

    clampCurrentLauncherPosition();
    globalThis.addEventListener?.("resize", clampCurrentLauncherPosition);
    return () => {
      globalThis.removeEventListener?.("resize", clampCurrentLauncherPosition);
    };
  }, []);

  function highlightLieDropTarget(clientX: number, clientY: number) {
    const lieSlot = document.querySelector(".topbar-lie-slot") as HTMLElement | null;
    const companionPanel = document.querySelector(".topbar-companion-panel") as HTMLElement | null;
    if (!companionPanel) return;
    const rect = (lieSlot ?? companionPanel).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.hypot(clientX - centerX, clientY - centerY);
    const isNear =
      dist < 140 ||
      (clientX >= rect.left - 60 && clientX <= rect.right + 60 && clientY >= rect.top - 60 && clientY <= rect.bottom + 80);
    companionPanel.classList.toggle("is-drag-near", isNear);
  }

  function isOverLieDropTarget(clientX: number, clientY: number): boolean {
    const companionPanel = document.querySelector(".topbar-companion-panel") as HTMLElement | null;
    const lieSlot = document.querySelector(".topbar-lie-slot") as HTMLElement | null;
    if (companionPanel) {
      const rect = (lieSlot ?? companionPanel).getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - centerX, clientY - centerY);
      return (
        dist < 140 ||
        (clientX >= rect.left - 60 && clientX <= rect.right + 60 && clientY >= rect.top - 60 && clientY <= rect.bottom + 80)
      );
    }
    const viewportWidth = globalThis.innerWidth || 1200;
    return clientX >= viewportWidth - 260 && clientY <= 130;
  }

  function updateLauncherDrag(pointerId: number, clientX: number, clientY: number, sizeElement?: HTMLElement | null) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    if (distance > 4) drag.moved = true;
    if (!drag.moved) return;
    highlightLieDropTarget(clientX, clientY);
    setLauncherPosition(
      clampSakiLauncherPosition(
        { x: clientX - drag.offsetX, y: clientY - drag.offsetY },
        sizeElement ?? launcherRef.current,
        "expanded"
      )
    );
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
        // Pointer capture may already be released after a topbar pull-out.
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
      const dragPosition = clampSakiLauncherPosition(
        { x: clientX - drag.offsetX, y: clientY - drag.offsetY },
        target,
        "expanded"
      );
      const snapEdge = sakiLauncherSnapEdgeForPosition(dragPosition);
      const nextPosition = snapEdge ? snapSakiLauncherPositionToEdge(dragPosition, snapEdge) : dragPosition;
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
    const rect = event.currentTarget.getBoundingClientRect();
    const dragOrigin = launcherEdgeAttached
      ? clampSakiLauncherPosition({ x: rect.left, y: rect.top }, event.currentTarget, "expanded")
      : { x: rect.left, y: rect.top };
    launcherDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - dragOrigin.x,
      offsetY: event.clientY - dragOrigin.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    setDraggingExpression(Math.random() > 0.5 ? sakiArtAssets.pickup1 : sakiArtAssets.pickup2);
    setLauncherDragging(true);
    onLauncherDraggingChange?.(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleLauncherPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
      event.preventDefault();
    }
    updateLauncherDrag(event.pointerId, event.clientX, event.clientY, event.currentTarget);
  }

  function finishLauncherDrag(event: React.PointerEvent<HTMLButtonElement>) {
    completeLauncherDrag(event.pointerId, event.clientX, event.clientY, event.currentTarget);
  }

  useLayoutEffect(() => {
    if (!pullDragRequest || sakiLieMode) return;
    const request = pullDragRequest;
    const startPosition = clampSakiLauncherPosition(
      { x: request.clientX - request.offsetX, y: request.clientY - request.offsetY },
      launcherRef.current,
      "expanded"
    );
    setLauncherPosition(startPosition);
    launcherDragRef.current = {
      pointerId: request.pointerId,
      offsetX: request.offsetX,
      offsetY: request.offsetY,
      startX: request.clientX,
      startY: request.clientY,
      moved: true
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
  }, [pullDragRequest, sakiLieMode]);

  function handleLauncherClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (suppressLauncherClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressLauncherClickRef.current = false;
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
    setHistoryOpen((current) => !current);
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
    const id = newClientId();
    restoringContextRef.current = true;
    setActiveConversationId(id);
    setMessages([
      createSakiWelcomeMessage(getSakiWelcomeMessageText(instance, panelContext.label))
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
    restoringContextRef.current = true;
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
    if (conversationId === activeConversationId) {
      startNewConversation();
    }
  }

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
        const nextMessage: LocalSakiMessage = {
          ...message,
          content: mergeSakiFinalText(message.content, response.message),
          timeline: mergeSakiTimelineActions(mergeSakiFinalTimeline(message.timeline, response.message), nextActions),
          source: response.source,
          workflowExpanded: false,
          streaming: false
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
    if (decision === "approve") setLoading(true);
    try {
      const response = await api.sakiAction(token, action.id, decision);
      replaceAction(response.action);
      if (decision === "approve") appendActionCompletionThought(response.action);
      if (response.response) {
        applyActionContinuationResponse(action.id, response.response);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Saki action failed";
      replaceAction({
        ...action,
        ok: false,
        status: "failed",
        observation: message
      });
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
    }, 3600);
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
      stopSelectionAnnotation("已取消注释选择。");
      return;
    }

    clearRememberedSakiTerminalSelection();
    window.getSelection()?.removeAllRanges();
    annotationModeRef.current = true;
    setAnnotationMode(true);
    setOpen(true);
    showComposerNotice("请选择页面文本，松开鼠标后 Saki 会开始分析。按 Esc 取消。");
  }

  async function submitSakiSelectionCapture(capture: SakiSelectionCapture) {
    if (loading) return;
    const selectedText = compactContextText(capture.text, sakiSelectionContextLimit);
    if (!selectedText) return;

    stopSelectionAnnotation();
    if (capture.source === "terminal") {
      clearRememberedSakiTerminalSelection();
    } else {
      window.getSelection()?.removeAllRanges();
    }

    const title = capture.title;
    const message = draft.trim() || "请分析这段选中的文本。";
    setOpen(true);
    setMessagesExpanded(true);
    setContextTitle(title);
    setContextText(selectedText);
    await submit(undefined, {
      message,
      contextTitle: title,
      contextText: selectedText
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
    if (!hasSakiInstanceFileDragData(event.dataTransfer)) return;
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
    if (!hasSakiInstanceFileDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleSakiFileDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!hasSakiInstanceFileDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    sakiFileDragDepthRef.current = Math.max(0, sakiFileDragDepthRef.current - 1);
    if (sakiFileDragDepthRef.current === 0) {
      setSakiFileHoverActive(false);
    }
  }

  function handleSakiFileDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasSakiInstanceFileDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    sakiFileDragDepthRef.current = 0;
    setSakiFileHoverActive(false);
    const payload = parseSakiInstanceFileDragPayload(event.dataTransfer);
    if (!payload) {
      showComposerNotice("无法识别拖入的实例文件。");
      return;
    }
    void addInstanceFileToComposer(payload);
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

  function stopSakiGeneration() {
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

  async function submit(event?: React.FormEvent<HTMLFormElement>, override?: SakiSubmitOverride) {
    event?.preventDefault();
    const submittedAttachments = override?.attachments ?? attachments;
    const value = (override?.message ?? draft).trim() || (submittedAttachments.length ? "请分析附件内容。" : "");
    if ((!value && submittedAttachments.length === 0) || loading) return;
    const requestMode = coerceSakiMode(override?.mode ?? mode, canUseChat, canUseAgent);
    if (!isSakiModeAllowed(requestMode, canUseChat, canUseAgent)) {
      setComposerNotice("当前账号没有可用的 Saki 权限。");
      return;
    }
    if (requestMode !== mode) {
      setMode(requestMode);
    }

    setMessagesExpanded(true);
    sakiAutoScrollRef.current = true;
    const requestPanelError = override?.panelError ?? panelError;
    const requestContextTitle = override?.contextTitle ?? contextTitle;
    const requestContextText = override?.contextText ?? contextText;

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
    const nextMessages = [...messages, userMessage, assistantMessage];
    setMessages(nextMessages);
    setDraft("");
    setAttachments([]);
    setComposerNotice(null);
    setSakiActivityMood("working");
    setLoading(true);
    const abortController = new AbortController();
    sakiStreamAbortRef.current = abortController;
    const history = messages.filter((message) => message.id !== "saki-welcome").slice(-12).map(toSakiHistoryMessage);
    const request = {
      message: value,
      history,
      instanceId: (storedConversations.find((conversation) => conversation.id === activeConversationId)?.instanceId ?? instance?.id) || null,
      panelError: requestPanelError,
      contextTitle: requestContextTitle,
      contextText: requestContextText,
      auditSearch: !instance && panelContext.auditSearch ? value : null,
      mode: requestMode,
      ...(requestMode === "agent" ? { agentPermissionMode: permissionMode } : {}),
      selectedSkillIds,
      attachments: submittedAttachments
    };
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
        if (streamCompleted || abortController.signal.aborted) return;
        streamTimedOut = true;
        abortController.abort();
      }, sakiStreamIdleFallbackMs);
    };
    const applyFinalResponse = (response: SakiChatResponse) => {
      streamCompleted = true;
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
      setSakiActivityMood(Math.random() > 0.5 ? "happy" : "OK");
      setMessages((current) =>
        current.map((message) =>
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
                const nextMessage: LocalSakiMessage = {
                  ...message,
                  content: finalContent,
                  thinking: response.thinking ?? message.thinking,
                  timeline: finalTimeline,
                  source: response.source,
                  workflowExpanded: false,
                  streaming: false,
                  usage: response.usage
                };
                if (nextActions?.length) return { ...nextMessage, actions: nextActions };
                return nextMessage;
              })()
            : message
        )
      );
    };
    armStreamIdleTimer();

    try {
      const applyStreamEvent = (streamEvent: SakiChatStreamEvent) => {
        if (abortController.signal.aborted) return;
        armStreamIdleTimer();
        if (streamEvent.type === "meta") {
          setReachable(streamEvent.source === "direct-model");
          if (streamEvent.skills) setSkills(streamEvent.skills);
          if (streamEvent.agentPermissionMode) setPermissionMode(streamEvent.agentPermissionMode);
          if (streamEvent.taskId) activeTaskIdRef.current = streamEvent.taskId;
          return;
        }

        if (streamEvent.type === "heartbeat") {
          return;
        }

        if (streamEvent.type === "delta") {
          streamSawDelta = true;
          streamSawProgress = true;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    timeline: appendSakiTimelineDelta(message.timeline, streamEvent.text)
                  }
                : message
            )
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
            const toolLower = streamEvent.tool.toLowerCase();
            if (toolLower === "listfiles") {
              setSakiActivityMood("checkfiles");
            } else if (toolLower === "readfile") {
              setSakiActivityMood("reading");
            }
          }
          if (streamEvent.status === "failed") {
            setSakiActivityMood("upset");
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
              return {
                ...message,
                ...(chatText
                  ? {
                      timeline: upsertSakiTimelineText(message.timeline, {
                        id: `workflow:${streamEvent.id}`,
                        content: chatText,
                        source: "workflow",
                        createdAt: nextStep.createdAt
                      })
                    }
                  : {}),
                workflow: existing
                  ? workflow.map((step) => (step.id === streamEvent.id ? nextStep : step))
                  : [...workflow, nextStep]
              };
            })
          );
          return;
        }

        if (streamEvent.type === "action") {
          streamSawProgress = true;
          streamToolNames.add(streamEvent.action.tool);
          if (!isReadOnlySakiTool(streamEvent.action.tool)) {
            streamSawUnsafeAction = true;
          }
          const toolLower = streamEvent.action.tool.toLowerCase();
          if (toolLower === "listfiles") {
            setSakiActivityMood("checkfiles");
          } else if (toolLower === "readfile") {
            setSakiActivityMood("reading");
          }
          if (streamEvent.action.status === "failed" || streamEvent.action.ok === false) {
            setSakiActivityMood("upset");
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
                timeline: upsertSakiTimelineAction(sealSakiTimelineDelta(message.timeline), streamEvent.action)
              };
            })
          );
          return;
        }

        if (streamEvent.type === "done") {
          applyFinalResponse(streamEvent.response);
        }
      };
      const response = await api.sakiChatStream(token, request, applyStreamEvent, abortController.signal);
      applyFinalResponse(response);
      setPanelError(null);
    } catch (err) {
      if (abortController.signal.aborted && !streamTimedOut) {
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
      const friendlyMessage = /流式连接|network error|failed to fetch|stream/i.test(message)
        ? "连接刚刚中断了，当前回复可能不完整。你可以直接继续说，我会接着处理。"
        : message;
      setReachable(false);
      setSakiActivityMood("upset");
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: item.content ? `${item.content}\n\n${friendlyMessage}` : friendlyMessage,
                timeline: upsertSakiTimelineText(item.timeline, {
                  id: `error:${newClientId()}`,
                  content: friendlyMessage,
                  source: "error"
                }),
                source: "local-fallback",
                workflowExpanded: false,
                streaming: false
              }
            : item
        )
      );
    } finally {
      clearStreamIdleTimer();
      if (sakiStreamAbortRef.current === abortController) {
        sakiStreamAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  const auditSearchActive = !instance && panelContext.auditSearch;
  const activeConversation = storedConversations.find((conversation) => conversation.id === activeConversationId);
  const contextLabel = activeConversation?.label ?? baseContextLabel;
  const contextPath = activeConversation?.detail ?? baseContextPath;
  const artMood: SakiArtMood = loading ? "thinking" : panelError || reachable === false ? "worry" : "normal";
  const statusClass = reachable === false ? "fallback" : reachable ? "online" : "pending";
  const statusLabel = reachable === false ? "本地回退" : reachable ? "已接入" : "待连接";
  const agentModeStatusLabel = mode === "agent" ? `${statusLabel} · ${sakiPermissionModeLabel(permissionMode)}` : statusLabel;
  const contextPreview = contextText ? compactContextText(contextText.replace(/\s+/g, " "), 180) : "";
  const hasStreamingAssistant = messages.some((message) => message.role === "assistant" && message.streaming);
  const isAgentBusy = Boolean(loading || hasStreamingAssistant);

  useEffect(() => {
    if (prevBusyRef.current && !isAgentBusy) {
      if (mobileActiveTab === "video") {
        setChatPulseAlert(true);
      }
    }
    prevBusyRef.current = isAgentBusy;
  }, [isAgentBusy, mobileActiveTab]);

  useEffect(() => {
    if (mobileActiveTab === "chat") {
      setChatPulseAlert(false);
    }
  }, [mobileActiveTab]);
  const launcherEdge = launcherAttachedEdge ?? (launcherPosition ? sakiLauncherEdgeForPosition(launcherPosition) : "right");
  const launcherStyle = launcherPosition
    ? {
        left: `${launcherPosition.x}px`,
        top: `${launcherPosition.y}px`,
        right: "auto",
        bottom: "auto"
      }
    : undefined;

  const sakiGreetings = useMemo(() => {
    if (language === "en-US") {
      return [
        "I'm here! Ready to help anytime～ (*╹▽╹*)",
        "Let's do our best together today too! (ง •_•)ง",
        "Feel free to ask me anything～ (◕ᴗ◕✿)",
        "Standing by anytime! (๑•̀ㅂ•́)و✧",
        "Ehehe, you can call me anytime～ (≧∇≦)ﾉ"
      ];
    }
    if (language === "zh-TW") {
      return [
        "我在呢！隨時為你提供幫助～ (*╹▽╹*)",
        "今天也一起加油吧！(ง •_•)ง",
        "有什麼想問的儘管告訴我哦～ (◕ᴗ◕✿)",
        "隨時待命！(๑•̀ㅂ•́)و✧",
        "誒嘿，隨時都可以呼叫我～ (≧∇≦)ﾉ"
      ];
    }
    return [
      "我在呢！随时为你提供帮助～ (*╹▽╹*)",
      "今天也一起加油吧！(ง •_•)ง",
      "有什么想问的尽管告诉我哦～ (◕ᴗ◕✿)",
      "随时待命！(๑•̀ㅂ•́)و✧",
      "诶嘿，随时都可以呼叫我～ (≧∇≦)ﾉ"
    ];
  }, [language]);

  function handleSakiPoke() {
    if (pokeTimerRef.current !== null) {
      window.clearTimeout(pokeTimerRef.current);
    }
    const moods: NonNullable<SakiActivityMood>[] = ["happy", "OK", "reading"];
    const randomMood: SakiActivityMood = moods[Math.floor(Math.random() * moods.length)] ?? "happy";
    const defaultGreeting = language === "en-US"
      ? "I'm here! Ready to help anytime～ (*╹▽╹*)"
      : language === "zh-TW"
      ? "我在呢！隨時為你提供幫助～ (*╹▽╹*)"
      : "我在呢！随时为你提供帮助～ (*╹▽╹*)";
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
  const effectiveActivityMood = echoActivityMood ?? sakiPokeMood ?? sakiActivityMood;
  const videoBubbleText = sakiVideoBubble
    ? sakiVideoBubble
    : loading && !hasStreamingAssistant
    ? (language === "en-US" ? "Thinking carefully... (•̀ᴗ•́)و" : language === "zh-TW" ? "正在認真思考中... (•̀ᴗ•́)و" : "正在认真思考中... (•̀ᴗ•́)و")
    : hasStreamingAssistant
    ? (language === "en-US" ? "Replying... (*╹▽╹*)" : language === "zh-TW" ? "正在回覆中... (*╹▽╹*)" : "正在回复中... (*╹▽╹*)")
    : sakiActivityMood === "working"
    ? (language === "en-US" ? "Working on code tasks... (ง •_•)ง" : language === "zh-TW" ? "正在處理程式碼任務... (ง •_•)ง" : "正在处理代码任务... (ง •_•)ง")
    : sakiActivityMood === "reading"
    ? (language === "en-US" ? "Analyzing project... (๑•̀ㅂ•́)و" : language === "zh-TW" ? "正在分析專案中... (๑•̀ㅂ•́)و" : "正在分析项目中... (๑•̀ㅂ•́)و")
    : sakiActivityMood === "checkfiles"
    ? (language === "en-US" ? "Checking file changes... (oﾟ▽ﾟ)o" : language === "zh-TW" ? "正在檢查檔案變更... (oﾟ▽ﾟ)o" : "正在检查文件变动... (oﾟ▽ﾟ)o")
    : listening
    ? (language === "en-US" ? "Dictating what you say... (◕ᴗ◕✿)" : language === "zh-TW" ? "正在聽寫你說的話... (◕ᴗ◕✿)" : "正在听写你说的话... (◕ᴗ◕✿)")
    : sakiEchoState === "hearing"
    ? (language === "en-US" ? "Release and I'll mimic your voice～" : language === "zh-TW" ? "放開後我會學你說話～" : "松开后我会学你说话～")
    : sakiEchoState === "speaking"
    ? (language === "en-US" ? "♪ Mimicking your voice～" : language === "zh-TW" ? "♪ 學你說話～" : "♪ 学你说话～")
    : null;

  return (
    <>
      <ChatLauncher
        open={open}
        sakiLieMode={sakiLieMode}
        launcherRef={launcherRef}
        launcherDragging={launcherDragging}
        launcherEdgeAttached={launcherEdgeAttached}
        launcherEdge={launcherEdge}
        launcherStyle={launcherStyle}
        sakiFileHoverActive={sakiFileHoverActive}
        fileDragActive={fileDragActive}
        artMood={artMood}
        draggingExpression={draggingExpression}
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
        {sakiFileHoverActive ? (
          <div className="saki-drop-overlay" aria-hidden="true">
            <FileText size={18} />
            <span>松开交给 Saki</span>
          </div>
        ) : null}

        <div className="saki-messages-container">
          <div
            className={`saki-video-pane ${mobileActiveTab === "video" ? "mobile-show" : "mobile-hide"}`}
            style={customRoomBg ? { backgroundImage: `url("${customRoomBg}")` } : undefined}
          >
            <input
              ref={roomBgInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={handleCustomRoomBgUpload}
            />

            {/* Mini Game occupying the FULL saki-video-pane */}
            {miniGameActive ? (
              <SakiDessertDropGame
                onClose={() => {
                  setMiniGameActive(false);
                  setSakiPokeMood(null);
                }}
                onFinish={(score, expReward) => {
                  setMiniGameActive(false);
                  handleMiniGameFinish(score, expReward);
                }}
              />
            ) : null}

            <div className="saki-video-header">
              <div className="saki-video-header-left">
                <button
                  className="saki-video-settings-btn"
                  type="button"
                  title="装修房间 (自定义背景图)"
                  aria-label="装修房间"
                  onClick={() => roomBgInputRef.current?.click()}
                >
                  <Paintbrush size={15} />
                </button>
                {customRoomBg ? (
                  <button
                    className="saki-video-settings-btn mini"
                    type="button"
                    title="恢复默认房间装修"
                    aria-label="恢复默认装修"
                    onClick={() => {
                      setCustomRoomBg(null);
                      try {
                        localStorage.removeItem("saki_custom_room_bg");
                      } catch {}
                    }}
                  >
                    <RefreshCw size={12} />
                  </button>
                ) : null}
              </div>

              {/* Aesthetic Floating Island Switcher (Mobile Only) */}
              <div className="saki-mobile-island-switcher" role="tablist" aria-label="移动端视图切换">
                <button
                  type="button"
                  className={`saki-island-pill ${mobileActiveTab === "video" ? "active" : ""}`}
                  onClick={() => setMobileActiveTab("video")}
                  role="tab"
                  aria-selected={mobileActiveTab === "video"}
                >
                  <Sparkles size={12} />
                  <span>陪伴</span>
                </button>
                <button
                  type="button"
                  className={`saki-island-pill ${mobileActiveTab === "chat" ? "active" : ""} ${chatPulseAlert && mobileActiveTab === "video" ? "has-pulse-alert" : ""}`}
                  onClick={() => {
                    setMobileActiveTab("chat");
                    setChatPulseAlert(false);
                  }}
                  role="tab"
                  aria-selected={mobileActiveTab === "chat"}
                >
                  <MessageSquare size={12} />
                  <span>聊天</span>
                  {chatPulseAlert && mobileActiveTab === "video" ? (
                    <span className="saki-island-breathing-light" aria-label="输出完成" />
                  ) : null}
                </button>
              </div>

              <div className="saki-video-header-right">
                {(() => {
                  const favInfo = getFavorabilityLevelInfo(sakiFavorabilityExp);
                  const isEn = language === "en-US";
                  const isTw = language === "zh-TW";
                  const favBadgeTitle = isEn
                    ? `[Saki Affection Details]\nLevel: Lv.${favInfo.level} · ${favInfo.title}\nCurrent EXP: ${favInfo.currentExp} / ${favInfo.maxExpForLevel} EXP (${favInfo.levelProgress}%)\n${favInfo.isMaxLevel ? "Max affection level reached!" : `EXP needed for next level: ${favInfo.maxExpForLevel - favInfo.currentExp}`}`
                    : isTw
                    ? `【Saki 好感度詳情】\n等級: Lv.${favInfo.level} · ${favInfo.title}\n目前經驗: ${favInfo.currentExp} / ${favInfo.maxExpForLevel} EXP (${favInfo.levelProgress}%)\n${favInfo.isMaxLevel ? "已達最高好感度！" : `距離下一級還需 ${favInfo.maxExpForLevel - favInfo.currentExp} EXP`}`
                    : `【Saki 好感度详情】\n等级: Lv.${favInfo.level} · ${favInfo.title}\n当前经验: ${favInfo.currentExp} / ${favInfo.maxExpForLevel} EXP (${favInfo.levelProgress}%)\n${favInfo.isMaxLevel ? "已达最高好感度！" : `距离下一级还需 ${favInfo.maxExpForLevel - favInfo.currentExp} EXP`}`;
                  return (
                    <div
                      className="saki-video-favorability-badge"
                      title={favBadgeTitle}
                    >
                      <div className={`saki-favorability-heart-wrap ${favorabilityPop ? "pop" : ""}`}>
                        <Heart size={32} className="saki-favorability-heart fill-rose-500 text-rose-400" />
                        <span className="saki-favorability-heart-level">{favInfo.level}</span>
                      </div>

                      <div className="saki-favorability-tooltip" role="tooltip">
                        <div className="tooltip-title">{isEn ? "Affection " : isTw ? "好感度 " : "好感度 "}Lv.{favInfo.level} · {favInfo.title}</div>
                        <div className="tooltip-exp-bar">
                          <div className="tooltip-exp-fill" style={{ width: `${favInfo.levelProgress}%` }} />
                        </div>
                        <div className="tooltip-exp-nums">
                          <span>{favInfo.currentExp} / {favInfo.maxExpForLevel} EXP</span>
                          <span>{favInfo.levelProgress}%</span>
                        </div>
                      </div>

                      {favorabilityPop ? (
                        <span key={favorabilityPop.id} className="saki-favorability-gain-float">
                          +{favorabilityPop.amount} EXP
                        </span>
                      ) : null}
                    </div>
                  );
                })()}

                <button
                  className="saki-video-close-btn"
                  type="button"
                  title={language === "en-US" ? "Close Saki" : language === "zh-TW" ? "關閉 Saki" : "关闭 Saki"}
                  aria-label={language === "en-US" ? "Close Saki" : language === "zh-TW" ? "關閉 Saki" : "关闭 Saki"}
                  onClick={closeSakiPanel}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="saki-video-stage">
              <div
                ref={sakiCharacterRef}
                className={`saki-video-character-wrap mood-${artMood} ${effectiveActivityMood ?? ""} ${isDragOverSaki ? "saki-drag-hover" : ""} ${sakiEchoState === "speaking" ? "saki-speaking" : ""} ${isSakiListening ? "saki-hearing" : ""}`}
                onPointerDown={handleSakiCharacterPointerDown}
                onPointerUp={handleSakiCharacterPointerUp}
                onPointerCancel={handleSakiCharacterPointerCancel}
                onLostPointerCapture={handleSakiCharacterPointerCancel}
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSakiPoke();
                  }
                }}
                title={language === "en-US" ? "Tap to poke, hold to speak" : language === "zh-TW" ? "點按戳戳，長按說話" : "点按戳戳，长按说话"}
                role="button"
                tabIndex={0}
              >
                {/* Feeding Target Indicator when dragging food */}
                {draggingFood && draggingFood.isDragging ? (
                  <div className={`saki-feed-target-indicator ${isDragOverSaki ? "ready" : ""}`}>
                    <div className="target-pulse-ring">
                      <Heart size={22} className="fill-rose-400 text-rose-400" />
                    </div>
                  </div>
                ) : null}

                {videoBubbleText ? (
                  <div className="saki-video-bubble" aria-live="polite">
                    <span>{videoBubbleText}</span>
                  </div>
                ) : null}
                <SakiCharacterArt mood={artMood} activityMood={effectiveActivityMood} />
                <div className="saki-video-carpet-shadow" aria-hidden="true" />
              </div>
            </div>

            {feedMenuOpen ? (
              <div className="saki-feed-drawer">
                <div className="saki-feed-items">
                  {getLocalizedFoodMenu(language).map((food) => {
                    const canAfford = isUnlimitedPoints || numericSakiPoints >= food.cost;
                    const isCurrentDragging = draggingFood?.food.id === food.id && draggingFood.isDragging;
                    const isEn = language === "en-US";
                    const isTw = language === "zh-TW";
                    const costUnit = isEn ? " pt" : isTw ? " 點" : "分";
                    const costTooltip = canAfford
                      ? `${food.name} (${food.cost} ${isEn ? "pts" : isTw ? "積分" : "积分"})`
                      : `${isEn ? "Insufficient points" : isTw ? "積分不足" : "积分不足"} (${food.cost})`;
                    return (
                      <button
                        key={food.id}
                        className={`saki-feed-card ${!canAfford ? "disabled" : ""} ${isCurrentDragging ? "dragging" : ""}`}
                        type="button"
                        title={costTooltip}
                        onPointerDown={(e) => startFoodDrag(e, food)}
                      >
                        <div className="saki-feed-card-img-wrap">
                          <img src={food.image} alt={food.name} draggable={false} />
                        </div>
                        <div className="saki-feed-card-info">
                          <span className="food-name">{food.name}</span>
                          <div className="food-meta">
                            <span className="food-cost">{food.cost}{costUnit}</span>
                            <span className="food-fav">+{food.favorability}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Dragging Food Floating Ghost */}
            {draggingFood && draggingFood.isDragging ? (
              <div
                className={`saki-dragging-food-ghost ${isDragOverSaki ? "over-target" : ""}`}
                style={{
                  left: `${draggingFood.currentX}px`,
                  top: `${draggingFood.currentY}px`
                }}
              >
                <img src={draggingFood.food.image} alt={draggingFood.food.name} draggable={false} />
              </div>
            ) : null}

            <div className="saki-video-controls" role="toolbar" aria-label="视频通话控制">
              <button
                className={`saki-video-btn ${listening ? "active pulse" : ""}`}
                type="button"
                title={listening ? "关闭麦克风 (停止语音识别)" : "开启麦克风 (语音输入)"}
                aria-label="麦克风"
                onClick={toggleSpeechInput}
              >
                {listening ? <Mic size={17} /> : <MicOff size={17} />}
              </button>
              <button
                className={`saki-video-btn ${miniGameActive ? "active" : ""}`}
                type="button"
                title="星梦甜点接接乐 (小游戏赚取好感度与积分)"
                aria-label="小游戏"
                onClick={() => {
                  setFeedMenuOpen(false);
                  setMiniGameActive((prev) => {
                    const next = !prev;
                    setSakiPokeMood(next ? "gaming" : null);
                    return next;
                  });
                }}
              >
                <Gamepad2 size={17} />
              </button>
              <button
                className={`saki-video-btn ${feedMenuOpen ? "active" : ""}`}
                type="button"
                title="投喂 Saki (花费积分买食物提升好感度)"
                aria-label="投喂食物"
                onClick={() => {
                  setFeedMenuOpen((prev) => !prev);
                }}
              >
                <UtensilsCrossed size={17} />
              </button>
              <button
                className={`saki-video-btn mobile-switch-to-chat ${chatPulseAlert && mobileActiveTab === "video" ? "pulse-alert" : ""}`}
                type="button"
                title="切换到聊天对话"
                aria-label="切换到聊天"
                onClick={() => {
                  setMobileActiveTab("chat");
                  setChatPulseAlert(false);
                }}
              >
                <MessageSquare size={17} />
                {chatPulseAlert && mobileActiveTab === "video" ? (
                  <span className="saki-dock-breathing-dot" aria-hidden="true" />
                ) : null}
              </button>
              <button
                className="saki-video-btn hangup"
                type="button"
                title="挂断视频通话"
                aria-label="挂断"
                onClick={closeSakiPanel}
              >
                <PhoneOff size={17} />
              </button>
            </div>
          </div>

          <div className={`saki-messages-inner ${mobileActiveTab === "chat" ? "mobile-show" : "mobile-hide"}`}>
            <div className="saki-header">
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
                <span
                  className={`saki-agent-status ${statusClass}`}
                  title={
                    statusClass === "fallback"
                      ? `Saki 状态: ${statusLabel}${contextPath ? ` (上下文: ${contextPath})` : ""}`
                      : contextPath
                        ? `工作区上下文: ${contextPath}`
                        : `Saki 状态: ${statusLabel}`
                  }
                >
                  <span className="saki-agent-status-dot" aria-hidden="true" />
                  <span className="saki-agent-status-text">
                    {statusClass === "fallback" ? statusLabel : (formatSakiContextPath(contextPath) || statusLabel)}
                  </span>
                </span>
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

          {historyOpen && messagesExpanded ? (
            <aside className="saki-history-panel" aria-label="Saki history">
              <div className="saki-history-heading">
                <span>历史记录</span>
                <button className="icon-button mini" type="button" title="关闭" onClick={() => setHistoryOpen(false)}>
                  <X size={14} />
                </button>
              </div>
              <button className="small-button saki-history-new" type="button" onClick={startNewConversation}>
                <Plus size={14} />
                新对话
              </button>
              <div className="saki-history-list">
                {storedConversations.length === 0 ? (
                  <p>暂无历史对话</p>
                ) : (
                  storedConversations.map((conversation) => (
                    <div className={conversation.id === activeConversationId ? "saki-history-item active" : "saki-history-item"} key={conversation.id}>
                      <button type="button" onClick={() => loadConversation(conversation)}>
                        <strong>{conversation.title}</strong>
                        <span>{conversation.label} · {formatDate(conversation.updatedAt)}</span>
                      </button>
                      <button className="icon-button mini danger-action" type="button" title="删除" onClick={() => deleteConversation(conversation.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </aside>
          ) : null}

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

          <div className="saki-messages" ref={sakiMessagesRef} onScroll={handleSakiMessagesScroll}>
            {messages.map((message) => {
              const actionItems = visibleSakiActions(message.actions);
              const fileRollbackActions = actionItems.filter(isSakiFileRollbackAction);
              const rollbackableFileActions = fileRollbackActions.filter(isSakiRollbackableFileEdit);
              const timelineItems = message.role === "assistant" ? renderableSakiTimeline(message) : [];
              const showAssistantTimeline = message.role === "assistant" && timelineItems.some((item) => item.kind === "action");
              return (
                <div className={`saki-message saki-message-${message.role}`} key={message.id}>
                  <div className="saki-message-meta">
                    {message.role === "assistant" ? (
                      <img className="saki-message-avatar" src={sakiArtAssets.avatar} alt="" />
                    ) : null}
                    <span>{message.role === "assistant" ? "Saki" : "你"}</span>
                    {message.source === "local-fallback" ? <em>fallback</em> : null}
                  </div>
                  {message.role === "assistant" && timelineItems.length > 0 ? (
                    <div className="saki-message-timeline">
                      {timelineItems.map((item) =>
                        item.kind === "text" ? (
                          <div className={`saki-message-body saki-message-body-${item.source}`} key={item.id}>
                            <SakiThinkingContent
                              content={item.content}
                              thinking={item.thinking}
                              streaming={message.streaming && item.source === "delta"}
                            />
                          </div>
                        ) : (
                          <div className="saki-tool-timeline-item" key={item.id}>
                            <SakiToolActionCard action={item.action} actionBusyId={actionBusyId} onDecision={(targetAction, decision) => void decideAction(targetAction, decision)} />
                          </div>
                        )
                      )}
                      {fileRollbackActions.length > 1 ? (
                        <div className="saki-rollback-bulk">
                          <span>
                            {rollbackableFileActions.length} / {fileRollbackActions.length} 个文件改动可回滚
                          </span>
                          <button
                            className="small-button"
                            type="button"
                            disabled={Boolean(actionBusyId) || rollbackableFileActions.length === 0}
                            onClick={() => void rollbackAllFileActions(message.id, fileRollbackActions)}
                          >
                            {actionBusyId === `rollback_all:${message.id}` ? <Loader2 size={14} className="status-spinner" /> : <CornerUpLeft size={14} />}
                            全部回滚
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : message.role === "assistant" && message.streaming && !message.content && !message.thinking ? (
                    <div className="saki-message-body">
                      <p className="saki-stream-placeholder">等待模型响应...</p>
                    </div>
                  ) : message.content || message.thinking ? (
                    <div className="saki-message-body">
                      <SakiThinkingContent
                        content={message.content}
                        thinking={message.thinking}
                        streaming={message.streaming}
                      />
                    </div>
                  ) : null}
                  {message.role === "assistant" && message.usage ? (
                    <div className="saki-token-usage-text">
                      {message.usage.isUnlimited
                        ? `消耗 Token: ${message.usage.tokensUsed.toLocaleString()}`
                        : `消耗 Token: ${message.usage.tokensUsed.toLocaleString()} · 消耗积分: ${message.usage.pointsUsed.toLocaleString()}`}
                    </div>
                  ) : null}
                  {message.attachments?.length ? (
                    <div className="saki-message-attachments">
                      {message.attachments.map((attachment, index) => (
                        <SakiAttachmentChip attachment={attachment} key={attachment.id ?? `${attachment.name}-${index}`} onClick={() => setPreviewingAttachment({ attachment, editable: false })} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {loading && !hasStreamingAssistant ? (
              <div className="saki-message saki-message-assistant">
                <div className="saki-message-meta">
                  <img className="saki-message-avatar" src={sakiArtAssets.avatar} alt="" />
                  <span>Saki</span>
                </div>
                <p className="saki-thinking-bubble">
                  <img src={sakiArtAssets.thinkingGif} alt="" />
                  <span>思考中...</span>
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <form className="saki-composer" onSubmit={(event) => void submit(event)}>
        <input
          ref={imageInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.currentTarget.value = "";
            void addFilesToComposer(files, "image");
          }}
        />
        <input
          ref={attachmentInputRef}
          className="hidden-file-input"
          type="file"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.currentTarget.value = "";
            void addFilesToComposer(files, "file");
          }}
        />
        <div className="saki-composer-expand-hint">
          <button
            type="button"
            className="saki-composer-expand-btn"
            title={messagesExpanded ? "折叠对话" : "展开对话"}
            aria-label={messagesExpanded ? "折叠对话" : "展开对话"}
            aria-expanded={messagesExpanded}
            onClick={() => setMessagesExpanded((current) => !current)}
          >
            {messagesExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
        {!messagesExpanded && (
          <div className="saki-mini-chat-wrapper">
            {(messages.length > 1 || loading) && (
              <div className="saki-mini-chat">
                <div className="saki-mini-chat-inner">
                  {messages.filter(m => m.id !== "saki-welcome").map((message) => (
                    <div className={`saki-message saki-message-${message.role} mini-mode`} key={message.id}>
                      <div className="saki-message-body">
                        {message.content || message.thinking ? (
                          <SakiThinkingContent
                            content={message.content}
                            thinking={message.thinking}
                            streaming={message.streaming}
                          />
                        ) : null}
                        {!message.content && !message.thinking && message.streaming ? <p className="saki-stream-placeholder">等待模型响应...</p> : null}
                      </div>
                    </div>
                  ))}
                  {loading && !hasStreamingAssistant && (
                    <div className="saki-message saki-message-assistant mini-mode">
                      <p className="saki-thinking-bubble">
                        <img src={sakiArtAssets.thinkingGif} alt="" />
                        <span>思考中...</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="saki-input-container">
          {mentionMenuOpen ? (
            <SakiMentionMenu
              candidates={mentionCandidates}
              activeIndex={mentionIndex}
              onHover={setMentionIndex}
              onSelect={applyMention}
            />
          ) : null}
          {!messagesExpanded && (
            <div
              className={`saki-input-peep ${loading ? "is-loading" : ""} ${sakiFileHoverActive ? "is-dropping" : ""}`}
              onClick={() => setMessagesExpanded(true)}
              title="点击展开与 Saki 的完整对话"
              role="button"
              tabIndex={0}
            >
              <img
                src={sakiArtAssets.shuru}
                alt="Saki"
                className="saki-input-peep-img saki-peep-light"
                draggable={false}
              />
              <img
                src={sakiArtAssets.shuruBlack}
                alt="Saki"
                className="saki-input-peep-img saki-peep-dark"
                draggable={false}
              />
            </div>
          )}
          <div className="saki-input-main-row">
            <div className="saki-input-leading">
              <button
                className={`saki-add-btn ${sakiAddMenuOpen ? "active" : ""}`}
                type="button"
                title="添加图片 / 文件"
                onClick={() => setSakiAddMenuOpen(!sakiAddMenuOpen)}
                ref={sakiAddBtnRef}
              >
                <Plus size={16} />
              </button>
            </div>
            <textarea
              ref={composerTextareaRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setMentionDismissedStart(null);
                syncMentionCaret(event.currentTarget);
              }}
              onClick={(event) => syncMentionCaret(event.currentTarget)}
              onSelect={(event) => syncMentionCaret(event.currentTarget)}
              onKeyUp={(event) => syncMentionCaret(event.currentTarget)}
              onBlur={() => {
                const active = activeSakiMentionQuery(draft, mentionCaret);
                if (active) setMentionDismissedStart(active.start);
              }}
              onKeyDown={(event) => {
                if (mentionMenuOpen && mentionCandidates.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setMentionIndex((current) => (current + 1) % mentionCandidates.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length);
                    return;
                  }
                  if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) {
                    const selected = mentionCandidates[mentionIndex] ?? mentionCandidates[0];
                    if (selected) {
                      event.preventDefault();
                      applyMention(selected);
                      return;
                    }
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMentionDismissedStart(activeSakiMentionQuery(draft, mentionCaret)?.start ?? null);
                    return;
                  }
                }
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!loading && (draft.trim() || attachments.length > 0)) {
                    void submit();
                  }
                }
              }}
              onPaste={handleComposerPaste}
              placeholder={
                attachments.some(isSakiImageAttachment)
                  ? "输入 @ 引用已上传的参考图"
                  : mode === "agent" && permissionMode === "plan"
                  ? "让 Saki 先阅读项目并给出执行计划"
                  : contextText
                  ? "针对已附加的上下文继续追问"
                  : auditSearchActive
                    ? "让 Saki 查找审计日志"
                    : instance
                      ? "问 Saki 当前实例里的问题"
                      : "问 Saki"
              }
              rows={1}
            />
          </div>
          {attachments.length > 0 ? (
            <div className="saki-attachment-tray">
              {attachments.map((attachment, index) => (
                <SakiAttachmentChip
                  attachment={attachment}
                  key={attachment.id ?? `${attachment.name}-${index}`}
                  removable
                  onClick={() => setPreviewingAttachment({ attachment, editable: true })}
                  onRemove={() =>
                    setAttachments((current) => current.filter((item) => (item.id ?? item.name) !== (attachment.id ?? attachment.name)))
                  }
                />
              ))}
            </div>
          ) : null}
          {composerNotice ? <div className="saki-composer-notice">{composerNotice}</div> : null}
          <div className="saki-input-toolbar">
            <div className="saki-input-actions">
                <button
                  className={`icon-button mini ${listening ? "active" : ""}`}
                  type="button"
                  title={listening ? "停止语音输入" : "语音输入"}
                  onClick={toggleSpeechInput}
                >
                  <Mic size={15} />
                </button>
                <button
                  className={`icon-button mini ${annotationMode ? "active" : ""}`}
                  type="button"
                  title={annotationMode ? "取消注释选择" : "注释选中文本"}
                  aria-pressed={annotationMode}
                  disabled={loading}
                  onClick={toggleSelectionAnnotation}
                >
                  <TextQuote size={15} />
                </button>
                <button
                  className={`icon-button mini ${composerBusy === "image" ? "active" : ""}`}
                  type="button"
                  title="粘贴图片 / 选择图片"
                  disabled={composerBusy !== null}
                  onClick={() => void pasteImageFromClipboard()}
                >
                  <ImageIcon size={15} />
                </button>
                <button
                  className={`icon-button mini ${composerBusy === "file" ? "active" : ""}`}
                  type="button"
                  title="上传文件"
                  disabled={composerBusy !== null}
                  onClick={() => openComposerFilePicker(attachmentInputRef.current)}
                >
                  <Paperclip size={15} />
                </button>
                <button
                  className={`icon-button mini ${composerBusy === "screenshot" ? "active" : ""}`}
                  type="button"
                  title="网页截图"
                  disabled={composerBusy !== null}
                  onClick={() => void captureScreenAttachment()}
                >
                  <Camera size={15} />
                </button>
              </div>
              <div className="saki-toolbar-controls">
                {/* Mode Selector: Icon-only Chat vs Agent */}
                <div className="saki-mode-icon-group" role="group" aria-label="对话/智能体模式切换">
                  {canUseChat ? (
                    <button
                      className={`saki-mode-icon-btn ${mode === "chat" ? "active" : ""}`}
                      type="button"
                      title="对话模式"
                      onClick={() => selectSakiMode("chat")}
                    >
                      <MessageSquare size={14} />
                    </button>
                  ) : null}
                  {canUseAgent ? (
                    <button
                      className={`saki-mode-icon-btn ${mode === "agent" ? "active" : ""}`}
                      type="button"
                      title="智能体模式"
                      onClick={() => selectSakiMode("agent")}
                    >
                      <Wrench size={14} />
                    </button>
                  ) : null}
                </div>

                {/* Permission Dropdown Selector (Active when in Agent mode, Icon Only) */}
                {canUseAgent && mode === "agent" ? (
                  <div className="saki-permission-selector" ref={permissionSelectorRef}>
                    <button
                      className="saki-permission-btn icon-only"
                      type="button"
                      title={`权限模式: ${sakiPermissionModeLabel(permissionMode)} (${sakiPermissionModeTitle(permissionMode)})`}
                      onClick={() => setPermissionDropdownOpen(!permissionDropdownOpen)}
                    >
                      {permissionMode === "acceptEdits" ? (
                        <CheckCircle2 size={14} className="perm-icon accept" />
                      ) : permissionMode === "ask" ? (
                        <Shield size={14} className="perm-icon ask" />
                      ) : permissionMode === "plan" ? (
                        <Eye size={14} className="perm-icon plan" />
                      ) : (
                        <XOctagon size={14} className="perm-icon bypass" />
                      )}
                      <ChevronDown size={10} className="perm-arrow" />
                    </button>
                  </div>
                ) : null}

                {/* Model Selector */}
                <div className="saki-model-selector" ref={modelSelectorRef}>
                  <button className="saki-model-btn" type="button" onClick={() => setModelDropdownOpen(!modelDropdownOpen)}>
                    <Zap size={12} />
                    <span className="saki-model-full-name">{currentModelName || availableModels.find(m => m.id === currentModelId)?.label || currentModelId}</span>
                    <span className="saki-model-short-name">{(() => {
                      const raw = currentModelName || availableModels.find(m => m.id === currentModelId)?.label || currentModelId;
                      // Extract short name: take last segment after slash/colon, then first token before dash+version
                      const seg = raw.split(/[/:]/).pop() || raw;
                      return seg.split(/[-\s]/).slice(0, 2).join("-");
                    })()}</span>
                    <ChevronDown size={10} />
                  </button>
                </div>
                {/* Send button in toolbar */}
                <button
                  className={`primary-button send-btn ${loading ? "stop" : ""}`}
                  type={loading ? "button" : "submit"}
                  title={loading ? "停止生成" : "Ctrl+Enter 发送"}
                  aria-label={loading ? "停止生成" : "Ctrl+Enter 发送"}
                  disabled={!loading && !draft.trim() && attachments.length === 0}
                  onClick={loading ? stopSakiGeneration : undefined}
                >
                  {loading ? <Square size={13} /> : <ArrowRight size={15} />}
                </button>
              </div>
            </div>
        </div>
      </form>
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
    </section>
    {sakiAddMenuOpen && sakiAddBtnRef.current ? (
      createPortal(
        <div
          ref={sakiAddMenuRef}
          className="saki-add-menu"
          style={{
            position: "fixed",
            left: sakiAddBtnRef.current.getBoundingClientRect().left,
            bottom: window.innerHeight - sakiAddBtnRef.current.getBoundingClientRect().top + 6,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="saki-add-menu-item"
            type="button"
            disabled={composerBusy !== null}
            onClick={() => { setSakiAddMenuOpen(false); void pasteImageFromClipboard(); }}
          >
            <ImageIcon size={16} />
            <span>粘贴图片</span>
          </button>
          <button
            className="saki-add-menu-item"
            type="button"
            disabled={composerBusy !== null}
            onClick={() => { setSakiAddMenuOpen(false); openComposerFilePicker(attachmentInputRef.current); }}
          >
            <Paperclip size={16} />
            <span>上传文件</span>
          </button>
          <button
            className="saki-add-menu-item"
            type="button"
            disabled={composerBusy !== null}
            onClick={() => { setSakiAddMenuOpen(false); void captureScreenAttachment(); }}
          >
            <Camera size={16} />
            <span>网页截图</span>
          </button>
        </div>,
        document.body
      )
    ) : null}
    {permissionDropdownOpen && permissionSelectorRef.current ? (
      createPortal(
        <div
          ref={permissionDropdownRef}
          className="saki-model-dropdown saki-permission-dropdown glass-panel"
          style={{
            position: "fixed",
            left: permissionSelectorRef.current.getBoundingClientRect().left,
            bottom: window.innerHeight - permissionSelectorRef.current.getBoundingClientRect().top + 8,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="saki-dropdown-title">智能体权限模式</div>
          {(
            [
              { id: "acceptEdits", label: "自动接受", desc: "自动执行安全文件编辑", icon: CheckCircle2, colorClass: "accept" },
              { id: "ask", label: "询问确认", desc: "每次文件修改均需确认", icon: Shield, colorClass: "ask" },
              { id: "plan", label: "仅规划", desc: "只输出执行方案，不落盘修改", icon: Eye, colorClass: "plan" },
              { id: "bypassPermissions", label: "跳过审查", desc: "绕过所有确认全速自动执行", icon: XOctagon, colorClass: "bypass" },
            ] as const
          ).map((opt) => {
            const IconComponent = opt.icon;
            const isActive = permissionMode === opt.id;
            return (
              <button
                key={opt.id}
                className={`saki-perm-dropdown-option ${isActive ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setPermissionMode(opt.id);
                  setPermissionDropdownOpen(false);
                }}
              >
                <div className={`perm-opt-icon ${opt.colorClass}`}>
                  <IconComponent size={15} />
                </div>
                <div className="perm-opt-text">
                  <div className="perm-opt-label">{opt.label}</div>
                  <div className="perm-opt-desc">{opt.desc}</div>
                </div>
                {isActive ? <Check size={14} className="perm-opt-check" /> : null}
              </button>
            );
          })}
        </div>,
        document.body
      )
    ) : null}
    {modelDropdownOpen && modelSelectorRef.current ? (
      createPortal(
        <div
          ref={modelDropdownRef}
          className="saki-model-dropdown"
          style={{
            position: "fixed",
            left: modelSelectorRef.current.getBoundingClientRect().left,
            bottom: window.innerHeight - modelSelectorRef.current.getBoundingClientRect().top + 8,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {availableModels.map((model) => {
            const supportsVision = sakiListedModelSupportsVision(model);
            return (
            <button
              key={model.id}
              className={`saki-model-option ${model.id === currentModelId ? "active" : ""}`}
              type="button"
              onClick={() => {
                const modelName = model.label || model.name || model.id;
                onCurrentModelIdChange(model.id);
                onCurrentModelNameChange(modelName);
                setModelDropdownOpen(false);
                void api.updateSakiConfig(token, { model: model.id });
              }}
            >
              <span className="saki-model-option-name">{model.label || model.id}</span>
              {supportsVision ? (
                <span className="saki-model-vision-icon" title="支持视觉" aria-label="支持视觉">
                  <ScanEye size={14} />
                </span>
              ) : null}
            </button>
            );
          })}
        </div>,
        document.body
      )
    ) : null}
    </>
  );
}
