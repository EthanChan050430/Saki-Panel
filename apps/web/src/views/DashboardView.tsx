import { SakiModelPicker } from "../components/saki/SakiModelReasoningPanel.js";
import { useSakiReasoningEffort } from "../components/saki/useSakiReasoningEffort.js";
import { sakiReasoningEffortLabel } from "@webops/shared";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUp,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Cpu,
  FileCode,
  Folder,
  GitBranch,
  HardDrive,
  HeartPulse,
  Image as ImageIcon,
  Lock,
  Loader2,
  MemoryStick,
  MessageSquare,
  Mic,
  Monitor,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Puzzle,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Terminal,
  Trash2,
  Upload,
  Users,
  Wifi,
  XOctagon,
  Zap
} from "lucide-react";
import type { ViewMode } from "../types/app.js";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  parseSakiModelSelection,
  maxSakiWorkspaces,
  normalizeSakiWorkspaceIds,
  sakiWorkspaceContextKey,
  sakiWorkspaceIdsFromContextKey,
  sakiModelMatchesSelection,
  sakiModelSelectionKey,
  activeSakiMentionQuery,
  filterSakiMentionCandidates,
  filterSakiSkillMentionCandidates,
  filterSakiWorkspaceFileCandidates,
  insertSakiMention,
  resolveSakiMentionedSkills,
  sakiAttachmentMentionToken,
  sakiSkillMentionToken,
  sakiWorkspaceFileMentionToken,
  type DashboardOverview,
  type ManagedInstance,
  type ManagedNode,
  type SakiAgentAction,
  type SakiAgentPermissionMode,
  type SakiActionDecisionResponse,
  type SakiChatMessage,
  type SakiChatRequest,
  type SakiInputAttachment,
  type SakiMentionCandidate,
  type SakiModelOption,
  type SakiSkillSummary,
  type SakiWorkspaceFileCandidate
} from "@webops/shared";
import { api, ApiError, type SakiActiveTaskSummary, type SakiChatStreamEvent, type SakiSavedConversation } from "../api.js";
import { usePanelLanguage } from "../i18n/index.js";
import type { PanelLanguage } from "../i18n/translations.js";
import {
  InstanceStatusBadge,
  InstanceStatusIcon,
  instanceStatusMeta,
  instanceTypeLabel,
  MetricTile,
  NodeStatusPill,
  PageErrorToast
} from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { MetricDetailModal, type MetricDetailKind } from "../components/dashboard/MetricDetailModal.js";
import { DashboardPopover } from "../components/dashboard/DashboardPopover.js";
import { DashboardToolDetails, dashboardActionTerminal, type DashboardChatMessage, type DashboardTerminalSession } from "../components/dashboard/DashboardAgentConversation.js";
import { SakiChangedFilesPill, useCodeChanges, filterGitChangesForSession } from "../components/saki/chat/SakiCodeChanges.js";
import { dashboardDeleteTurn, dashboardHasUntrackedTerminalChanges, dashboardHistoryMatches, dashboardIsCodeChange, dashboardRecordAction, dashboardRollbackActions, dashboardRollbackCodeMessageIds, dashboardStoredActions, dashboardTurnRange, type DashboardMessageOperation } from "../components/dashboard/message-operations.js";
import { dashboardTaskIsPending, dashboardTaskMessages, dashboardTaskNeedsSync, dashboardTaskSessionId, type DashboardSession, type DashboardStreamRun } from "../components/dashboard/task-runtime.js";
import { dashboardMergeTimeline, dashboardStreamTimeline } from "../components/dashboard/timeline.js";
import { DashboardChatStream } from "../components/dashboard/DashboardChatStream.js";
import { DashboardMessageList } from "../components/dashboard/DashboardMessageList.js";
import { formatDate, formatNumber, resourcesFromNodes, isImageFile, imageMimeTypeFromPath, base64ToBlob, compactContextText } from "../utils/path.js";
import { readRecentInstances } from "../utils/recentInstances.js";
import { newClientId } from "../utils/id.js";
import { readResourceSnapshot, writeResourceSnapshot } from "../utils/resourceSnapshot.js";
import { mergeInstanceStatuses } from "../utils/instanceDirectory.js";
import { useGlobalEvent } from "../GlobalEventContext.js";
import { LiquidGlassContainer } from "../components/common/LiquidGlass.js";
import {
  readSakiConversations,
  parseThinkingContent,
  SakiAttachmentChip,
  visibleSakiActions,
  writeSakiConversations
} from "../components/saki/SakiComponents.js";
import { SakiAttachmentModal } from "../components/saki/SakiAttachmentModal.js";
import { SakiMentionMenu } from "../components/saki/SakiMentionMenu.js";
import {
  fileToSakiAttachment,
  imageFileToSakiAttachment,
  sakiMimeTypeFromPath,
  sakiTextAttachmentLimit,
  parseSakiInstanceFileDragPayload,
  sakiMaxInputAttachments,
  hasAnyFileDragData
} from "../components/saki/sakiChatHelpers.js";
import type { SakiInstanceFileDragPayload } from "../types/app.js";
import { createNodeSyntheticInstance } from "./instances/SshServerWorkspace.js";

const RECENT_INSTANCE_LIMIT = 8;

const AGENT_PERMISSION_OPTIONS = [
  { id: "ask", label: "需确认", menuLabel: "需确认", description: "常规工作区编辑直接执行，风险操作需确认", icon: ShieldAlert, color: "ask" },
  { id: "acceptEdits", label: "自主执行", menuLabel: "自主执行（默认）", description: "自动批准规则允许的操作，风险操作仍需确认", icon: ShieldCheck, color: "auto" },
  { id: "bypassPermissions", label: "完全访问权限", menuLabel: "完全访问权限", description: "无需逐项批准，仍遵守账号与安全策略；外部文件仍需单次审批", icon: XOctagon, color: "full" },
  { id: "plan", label: "只读模式", menuLabel: "只读观察", description: "只读探索和规划，不修改文件", icon: Lock, color: "readonly" }
] as const satisfies ReadonlyArray<{ id: SakiAgentPermissionMode; label: string; menuLabel: string; description: string; icon: typeof ShieldAlert; color: string }>;

type ChatMessage = DashboardChatMessage;

type SessionItem = DashboardSession;

function formatRelativeTime(value: string | null | undefined, language: PanelLanguage): string {
  if (!value) return "-";
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "-";
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(language || "zh-CN", { numeric: "auto" });
  if (abs < 60_000) return rtf.format(0, "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

function formatStoredChatMessage(m: any, idx: number, updatedAt: string, language: PanelLanguage): ChatMessage {
  return {
    id: m.id || `m-${idx}`,
    role: m.role || "user",
    content: m.content || "",
    time: formatRelativeTime(m.createdAt || updatedAt, language),
    createdAt: m.createdAt,
    taskId: m.taskId,
    isStreaming: Boolean(m.streaming ?? m.isStreaming),
    rollbackJournal: m.rollbackJournal,
    thinking: m.thinking,
    actions: dashboardStoredActions(m),
    timeline: m.timeline,
    timelineEvents: m.timelineEvents,
    timelineBase: m.timelineBase,
    thinkingDurationSec: m.thinkingDurationSec,
    attachments: m.attachments
  };
}

function instanceActivityAt(instance: ManagedInstance, openedAt?: string): string {
  return openedAt || instance.lastStartedAt || instance.updatedAt;
}

const PAGE_OPTIONS: Array<{ view: ViewMode; label: string; desc: string; icon: React.ReactNode }> = [
  { view: "instances", label: "实例管理", desc: "查看与控制所有服务实例", icon: <Boxes size={13} className="dashboard-page-icon icon-amber" /> },
  { view: "nodes", label: "节点拓扑", desc: "Daemon 节点健康与网络", icon: <Network size={13} className="dashboard-page-icon icon-teal" /> },
  { view: "templates", label: "部署模板", desc: "快速部署应用与服务", icon: <FileCode size={13} className="dashboard-page-icon icon-purple" /> },
  { view: "reliability", label: "可靠性监控", desc: "SLO、自愈与熔断指标", icon: <HeartPulse size={13} className="dashboard-page-icon icon-rose" /> },
  { view: "users", label: "用户权限", desc: "用户与角色权限策略", icon: <Users size={13} className="dashboard-page-icon icon-blue" /> },
  { view: "audit", label: "审计日志", desc: "全站操作日志与追踪", icon: <ScrollText size={13} className="dashboard-page-icon icon-gray" /> },
  { view: "plugins", label: "插件中心", desc: "扩展插件与生态集成", icon: <Puzzle size={13} className="dashboard-page-icon icon-green" /> },
  { view: "settings", label: "系统设置", desc: "控制台配置与外观", icon: <Settings size={13} className="dashboard-page-icon icon-orange" /> }
];

function getGreetingSentence(): string {
  const hour = new Date().getHours();
  let timePrefix = "";
  if (hour >= 5 && hour < 12) {
    timePrefix = "早上好";
  } else if (hour >= 12 && hour < 14) {
    timePrefix = "中午好";
  } else if (hour >= 14 && hour < 18) {
    timePrefix = "下午好";
  } else if (hour >= 18 && hour < 22) {
    timePrefix = "晚上好";
  } else {
    timePrefix = "夜深了";
  }

  const variations = [
    `${timePrefix}，今天有什么我可以协助你的？`,
    `${timePrefix}，今天有什么想探索或排查的？`,
    `${timePrefix}，集群状态良好，随时听候指令。`,
    `${timePrefix}，今天想构建或优化什么？`,
    `${timePrefix}，有任何运维或代码需求随时吩咐。`,
    "今天有什么想探索或排查的？",
    "集群运行正常，随时听候您的指令。",
    "有什么我可以协助你的？",
    "准备好开始本次的集群维护与开发任务了吗？"
  ];
  return variations[Math.floor(Math.random() * variations.length)] ?? "今天有什么想探索或排查的？";
}

export function DashboardView({
  token,
  userId,
  isSuperAdmin = false,
  canUseTerminal = false,
  canUseAgent,
  canUseChat,
  canConfigureSaki = false,
  onLogout,
  refreshTick,
  canViewNodes,
  canTestNodes,
  canViewInstances,
  onOpenInstance,
  onNavigateView,
  availableViews
}: {
  token: string;
  userId: string;
  isSuperAdmin?: boolean;
  canUseTerminal?: boolean;
  canUseAgent: boolean;
  canUseChat: boolean;
  canConfigureSaki?: boolean;
  onLogout: () => void;
  refreshTick: number;
  canViewNodes: boolean;
  canTestNodes: boolean;
  canViewInstances: boolean;
  onOpenInstance: (instanceId: string | null) => void;
  onNavigateView?: (view: ViewMode, instanceId?: string | null) => void;
  availableViews?: ViewMode[];
}) {
  const { language } = usePanelLanguage();
  const [overview, setOverview] = useState<DashboardOverview | null>(() => readResourceSnapshot(token, "overview") ?? null);
  const [nodes, setNodes] = useState<ManagedNode[]>(() => canViewNodes ? readResourceSnapshot(token, "nodes") ?? [] : []);
  const [instances, setInstances] = useState<ManagedInstance[]>(() => canViewInstances ? readResourceSnapshot(token, "instances") ?? [] : []);
  const [loading, setLoading] = useState(() => !readResourceSnapshot(token, "overview"));
  const refreshGenerationRef = useRef(0);
  const [error, setError] = useState("");
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [metricDetail, setMetricDetail] = useState<MetricDetailKind | null>(null);

  // Dashboard Layout & Chat States
  const [viewMode, setViewMode] = useState<"workspace" | "metrics">("workspace");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    try { return window.sessionStorage.getItem(`dashboard:active-session:${userId}`); } catch { return null; }
  });
  const activeSessionIdRef = useRef(activeSessionId);
  const sessionRequestGenerationRef = useRef(0);
  const hydratedSessionIdsRef = useRef(new Set<string>());
  const sessionLoadingRef = useRef(false);
  const selectSession = (id: string | null) => {
    sessionRequestGenerationRef.current++;
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    setAttachments([]);
    setAddMenuOpen(false);
    try {
      if (id) window.sessionStorage.setItem(`dashboard:active-session:${userId}`, id);
      else window.sessionStorage.removeItem(`dashboard:active-session:${userId}`);
    } catch { /* Session restoration is optional when storage is unavailable. */ }
  };
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [workspaceInstanceIds, setWorkspaceInstanceIds] = useState<string[]>([]);
  const [workspaceSelectionBusy, setWorkspaceSelectionBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [promptText, setPromptText] = useState("");
  const [attachments, setAttachments] = useState<SakiInputAttachment[]>([]);
  const [previewingAttachment, setPreviewingAttachment] = useState<{ attachment: SakiInputAttachment; editable: boolean } | null>(null);
  const [composerBusy, setComposerBusy] = useState<"image" | "file" | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const activeAddAnchorRef = useRef<HTMLElement | null>(null);
  const heroAddBtnRef = useRef<HTMLButtonElement | null>(null);
  const sessionAddBtnRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [modelMode, setModelMode] = useState<"high" | "standard">("high");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const rollbackCodeMessageIds = useMemo(() => dashboardRollbackCodeMessageIds(messages), [messages]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [messageNotice, setMessageNotice] = useState("");
  const messageMutationRef = useRef(false);
  const localHistoryOnlyRef = useRef(false);
  const historyVersionsRef = useRef(new Map<string, string>());
  const [selectedTool, setSelectedTool] = useState<{ messageId: string; actionId: string } | null>(null);
  const selectedToolAction = selectedTool ? visibleSakiActions(messages.find((message) => message.id === selectedTool.messageId)?.actions).find((action) => action.id === selectedTool.actionId) : undefined;
  const [terminalPanelOpen, setTerminalPanelOpen] = useState(false);
  const [terminals, setTerminals] = useState<DashboardTerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const terminalInstanceRef = useRef(activeInstanceId);
  terminalInstanceRef.current = activeInstanceId;
  const [sessions, setSessions] = useState<SessionItem[]>(() => {
    const cached = readResourceSnapshot<SakiSavedConversation[]>(token, "conversations") ?? readSakiConversations(userId);
    return cached.map((conversation) => ({
      id: conversation.id, instanceId: conversation.instanceId ?? null,
      workspaceInstanceIds: conversation.workspaceInstanceIds ?? sakiWorkspaceIdsFromContextKey(conversation.contextKey, conversation.instanceId),
      updatedAt: conversation.updatedAt, title: conversation.title || "历史会话",
      category: conversation.label || "历史记录", time: formatRelativeTime(conversation.updatedAt, language)
    }));
  });
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [tasks, setTasks] = useState<SakiActiveTaskSummary[]>([]);
  const streamRunsRef = useRef(new Map<string, DashboardStreamRun>());
  const reconnectAfterRef = useRef(new Map<string, number>());
  const runtimeGenerationRef = useRef(0);
  const [streamingSessions, setStreamingSessions] = useState(new Set<string>());
  const latestTasks = useMemo(() => {
    const latest = new Map<string, SakiActiveTaskSummary>();
    for (const task of [...tasks].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))) {
      const id = dashboardTaskSessionId(task);
      if (!latest.has(id)) latest.set(id, task);
    }
    return latest;
  }, [tasks]);
  const isSessionRunning = (id: string) => streamingSessions.has(id) || latestTasks.get(id)?.status === "running";
  const isStreaming = Boolean(activeSessionId && isSessionRunning(activeSessionId));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dockedTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const heroInputWrapperRef = useRef<HTMLDivElement | null>(null);
  const dockedInputWrapperRef = useRef<HTMLDivElement | null>(null);

  const [skills, setSkills] = useState<SakiSkillSummary[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api.sakiAllSkills(token);
        if (active && Array.isArray(result)) {
          setSkills(result);
        }
      } catch {
        // Fall back gracefully if offline or permissions restricted
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const [workspaceFiles, setWorkspaceFiles] = useState<SakiWorkspaceFileCandidate[]>([]);
  const workspaceFilesCacheRef = useRef<Map<string, SakiWorkspaceFileCandidate[]>>(new Map());
  const workspaceFilesLoadingRef = useRef<Set<string>>(new Set());

  // Load shallow workspace file tree when activeInstanceId changes
  useEffect(() => {
    if (!activeInstanceId) {
      setWorkspaceFiles([]);
      return;
    }

    const cached = workspaceFilesCacheRef.current.get(activeInstanceId);
    if (cached) {
      setWorkspaceFiles(cached);
      return;
    }

    let active = true;
    const instanceId = activeInstanceId;
    if (workspaceFilesLoadingRef.current.has(instanceId)) return;
    workspaceFilesLoadingRef.current.add(instanceId);

    const JUNK_DIR_PATTERN = /^(node_modules|\.git|dist|build|\.next|out|target|bin|obj|__pycache__|\.venv|venv|\.cache|\.turbo|\.gradle|coverage|\.output|\.idea|\.vscode)$/i;

    void (async () => {
      try {
        const rootResp = await api.listInstanceFiles(token, instanceId, "");
        if (!active) return;
        const entries = rootResp.entries || [];
        const collected: SakiWorkspaceFileCandidate[] = [];
        const subdirsToFetch: string[] = [];

        for (const entry of entries) {
          const isDir = entry.type === "directory";
          if (isDir) {
            if (!JUNK_DIR_PATTERN.test(entry.name)) {
              collected.push({
                path: entry.path,
                name: entry.name,
                isDirectory: true,
                size: entry.size
              });
              subdirsToFetch.push(entry.path);
            }
          } else {
            collected.push({
              path: entry.path,
              name: entry.name,
              isDirectory: false,
              size: entry.size
            });
          }
        }

        // Fetch top subdirectories up to limit (shallow indexing to avoid huge repos freezing)
        const maxSubdirs = 6;
        for (const dirPath of subdirsToFetch.slice(0, maxSubdirs)) {
          if (!active || collected.length >= 250) break;
          try {
            const subResp = await api.listInstanceFiles(token, instanceId, dirPath);
            for (const sub of subResp.entries || []) {
              if (sub.type === "directory" && JUNK_DIR_PATTERN.test(sub.name)) continue;
              collected.push({
                path: sub.path,
                name: sub.name,
                isDirectory: sub.type === "directory",
                size: sub.size
              });
              if (collected.length >= 250) break;
            }
          } catch {
            // Silently ignore subfolder failures
          }
        }

        if (active) {
          workspaceFilesCacheRef.current.set(instanceId, collected);
          setWorkspaceFiles(collected);
        }
      } catch {
        // Fall back gracefully if instance is stopped or offline
      } finally {
        workspaceFilesLoadingRef.current.delete(instanceId);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeInstanceId, token]);

  const [mentionCaret, setMentionCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissedStart, setMentionDismissedStart] = useState<number | null>(null);

  const mentionCandidates = useMemo((): SakiMentionCandidate[] => {
    const active = activeSakiMentionQuery(promptText, mentionCaret);
    if (!active || mentionDismissedStart === active.start) return [];
    const query = active.query;

    const matchedAttachments = filterSakiMentionCandidates(attachments, query);
    const matchedSkills = filterSakiSkillMentionCandidates(skills, query);
    const matchedFiles = activeInstanceId
      ? filterSakiWorkspaceFileCandidates(workspaceFiles, query, 15)
      : [];

    const attachmentItems: SakiMentionCandidate[] = matchedAttachments.map((att) => ({
      kind: "attachment" as const,
      id: att.id ?? att.name,
      name: att.name,
      token: sakiAttachmentMentionToken(att),
      attachment: att
    }));

    const fileItems: SakiMentionCandidate[] = matchedFiles.map((file) => ({
      kind: "file" as const,
      id: `file-${file.path}`,
      name: file.name,
      token: sakiWorkspaceFileMentionToken(file.path),
      file
    }));

    const skillItems: SakiMentionCandidate[] = matchedSkills.map((skill) => ({
      kind: "skill" as const,
      id: skill.id,
      name: skill.name,
      token: sakiSkillMentionToken(skill),
      description: skill.description,
      tags: skill.tags,
      skill: skill
    }));

    return [...attachmentItems, ...fileItems, ...skillItems].slice(0, 25);
  }, [activeInstanceId, attachments, mentionCaret, mentionDismissedStart, promptText, skills, workspaceFiles]);

  const mentionMenuOpen =
    Boolean(activeSakiMentionQuery(promptText, mentionCaret)) &&
    mentionDismissedStart !== activeSakiMentionQuery(promptText, mentionCaret)?.start &&
    (attachments.length > 0 || skills.length > 0 || (activeInstanceId ? workspaceFiles.length > 0 : false));

  useEffect(() => {
    setMentionIndex(0);
  }, [promptText, mentionCaret, mentionDismissedStart]);

  const handleSyncMentionCaret = useCallback((target: HTMLTextAreaElement) => {
    activeTextareaRef.current = target;
    setMentionCaret(target.selectionStart);
  }, []);

  const handleApplyMention = useCallback((targetItem: SakiMentionCandidate | SakiInputAttachment) => {
    const target = activeTextareaRef.current ?? textareaRef.current ?? dockedTextareaRef.current;
    const caret = target?.selectionStart ?? mentionCaret;
    const token = "token" in targetItem
      ? targetItem.token
      : sakiAttachmentMentionToken(targetItem);
    const next = insertSakiMention(promptText, caret, token);
    setPromptText(next.text);
    setMentionCaret(next.caret);
    setMentionDismissedStart(null);

    // If a workspace file is selected, read it and add to attachments tray if not already attached
    if ("kind" in targetItem && targetItem.kind === "file" && "file" in targetItem && targetItem.file && !targetItem.file.isDirectory && activeInstanceId) {
      const fileCandidate = targetItem.file;
      const filePath = fileCandidate.path;
      const fileName = fileCandidate.name;
      if (!attachments.some((a) => a.name === fileName || a.name === filePath)) {
        void (async () => {
          try {
            if (isImageFile(filePath)) {
              const resp = await api.downloadInstanceFile(token, activeInstanceId, filePath, { base64: true });
              const mime = imageMimeTypeFromPath(resp.path || fileName) ?? "image/png";
              const fileObj = new File([base64ToBlob(resp.contentBase64, mime)], resp.fileName || fileName, { type: mime });
              const att = await imageFileToSakiAttachment(fileObj, "image");
              setAttachments((curr) => curr.some((a) => a.name === att.name) ? curr : [...curr, att]);
            } else {
              const resp = await api.readInstanceFile(token, activeInstanceId, filePath);
              const att: SakiInputAttachment = {
                id: newClientId(),
                kind: "file",
                name: resp.path || fileName,
                mimeType: sakiMimeTypeFromPath(resp.path || fileName),
                size: resp.size,
                text: compactContextText(resp.content, sakiTextAttachmentLimit)
              };
              setAttachments((curr) => curr.some((a) => a.name === att.name) ? curr : [...curr, att]);
            }
          } catch {
            // Silently allow token to remain if file reading fails
          }
        })();
      }
    }

    window.requestAnimationFrame(() => {
      const el = activeTextareaRef.current ?? textareaRef.current ?? dockedTextareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setMentionCaret(next.caret);
    });
  }, [activeInstanceId, attachments, mentionCaret, promptText, token]);

  // Listen for instance file attachment events from FileManager or Saki
  useEffect(() => {
    const handleAttachInstanceFile = (e: Event) => {
      const customEvent = e as CustomEvent<SakiInstanceFileDragPayload>;
      const payload = customEvent.detail;
      if (!payload || !payload.path) return;

      if (payload.instanceId && payload.instanceId !== activeInstanceId) {
        setActiveInstanceId(payload.instanceId);
      }

      // Add to attachments
      void (async () => {
        try {
          if (isImageFile(payload.path || payload.name)) {
            const resp = await api.downloadInstanceFile(token, payload.instanceId, payload.path, { base64: true });
            const mime = imageMimeTypeFromPath(resp.path || payload.name) ?? "image/png";
            const fileObj = new File([base64ToBlob(resp.contentBase64, mime)], resp.fileName || payload.name, { type: mime });
            const att = await imageFileToSakiAttachment(fileObj, "image");
            setAttachments((curr) => curr.some((a) => a.name === att.name) ? curr : [...curr, att]);
          } else {
            const resp = await api.readInstanceFile(token, payload.instanceId, payload.path);
            const att: SakiInputAttachment = {
              id: newClientId(),
              kind: "file",
              name: resp.path || payload.name,
              mimeType: sakiMimeTypeFromPath(resp.path || payload.name),
              size: resp.size,
              text: compactContextText(resp.content, sakiTextAttachmentLimit)
            };
            setAttachments((curr) => curr.some((a) => a.name === att.name) ? curr : [...curr, att]);
          }
        } catch {
          // fallback
        }
      })();

      // Insert mention token into promptText
      const fileMention = sakiWorkspaceFileMentionToken(payload.path);
      setPromptText((prev) => prev ? `${prev} ${fileMention} ` : `${fileMention} `);

      const target = textareaRef.current ?? dockedTextareaRef.current;
      if (target) {
        window.requestAnimationFrame(() => target.focus());
      }
    };

    window.addEventListener("saki:attach_instance_file", handleAttachInstanceFile);
    return () => window.removeEventListener("saki:attach_instance_file", handleAttachInstanceFile);
  }, [activeInstanceId, token]);
  const taskRefreshSeq = useRef(0);
  const refreshTasks = useCallback(async () => {
    const seq = ++taskRefreshSeq.current;
    try {
      const result = await api.sakiGetActiveTasks(token);
      if (seq === taskRefreshSeq.current && Array.isArray(result.tasks)) setTasks(result.tasks);
    } catch { /* Keep the last known state during temporary disconnects. */ }
  }, [token]);
  useEffect(() => {
    if (!canUseAgent) return;
    void refreshTasks();
    const timer = window.setInterval(() => { void refreshTasks(); }, 3000);
    window.addEventListener("saki:active_task_updated", refreshTasks);
    return () => {
      taskRefreshSeq.current++;
      window.clearInterval(timer);
      window.removeEventListener("saki:active_task_updated", refreshTasks);
    };
  }, [canUseAgent, refreshTasks]);
  useEffect(() => {
    setStreamingSessions(new Set());
    reconnectAfterRef.current.clear();
    return () => {
      runtimeGenerationRef.current++;
      for (const run of streamRunsRef.current.values()) {
        run.detached = true;
        // Let an initial Agent request obtain its task ID before detaching, so
        // navigating away immediately after sending cannot cancel submission.
        if (run.taskId || run.mode === "chat") run.controller.abort();
      }
      streamRunsRef.current.clear();
    };
  }, [token, userId]);
  const publishSessionMessages = useCallback((sessionId: string, update: (current: ChatMessage[]) => ChatMessage[]) => {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, messages: update(session.messages ?? []) } : session));
    if (activeSessionIdRef.current === sessionId) setMessages(update);
  }, []);
  const startStream = useCallback((sessionId: string, mode: "agent" | "chat", taskId?: string) => {
    const previous = streamRunsRef.current.get(sessionId);
    if (previous) { previous.detached = true; previous.controller.abort(); }
    const run: DashboardStreamRun = { controller: new AbortController(), mode, ...(taskId ? { taskId } : {}) };
    streamRunsRef.current.set(sessionId, run);
    setStreamingSessions((current) => new Set(current).add(sessionId));
    return run;
  }, []);
  const finishStream = useCallback((sessionId: string, run: DashboardStreamRun) => {
    if (run.detached || streamRunsRef.current.get(sessionId) !== run) return;
    streamRunsRef.current.delete(sessionId);
    setStreamingSessions((current) => { const next = new Set(current); next.delete(sessionId); return next; });
    window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
  }, []);
  const cancelConversationTask = useCallback(async (sessionId: string, taskId: string, run?: DashboardStreamRun) => {
    try {
      const result = await api.sakiCancelTask(token, taskId);
      if (!result.ok) {
        if (run) run.cancelRequested = false;
        if (!run?.detached) void refreshTasks();
        return;
      }
      run?.controller.abort();
      if (!run?.detached) {
        setTasks((current) => current.map((task) => task.id === taskId ? { ...task, status: "cancelled" } : task));
        const currentRun = streamRunsRef.current.get(sessionId);
        if (currentRun && currentRun !== run) return;
        publishSessionMessages(sessionId, (current) => current.map((message) => message.isStreaming ? { ...message, isStreaming: false, isThinking: false, workflowMessage: undefined } : message));
        if (run) finishStream(sessionId, run);
        else void refreshTasks();
      }
    } catch (err) {
      if (run) run.cancelRequested = false;
      if (!run?.detached && activeSessionIdRef.current === sessionId) setError(err instanceof Error ? err.message : "停止任务失败，请重试。");
    }
  }, [token, publishSessionMessages, finishStream, refreshTasks]);

  // Single Clean Greeting Sentence State
  const [greetingSentence, setGreetingSentence] = useState(() => getGreetingSentence());

  // Dropdowns & Shelves
  const topbarDropdownRef = useRef<HTMLDivElement | null>(null);
  const contextDropdownRef = useRef<HTMLDivElement | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const modeDropdownRef = useRef<HTMLDivElement | null>(null);
  const permissionDropdownRef = useRef<HTMLDivElement | null>(null);
  const worktreeShelfRef = useRef<HTMLDivElement | null>(null);

  const [topbarDropdownOpen, setTopbarDropdownOpen] = useState(false);
  const [contextDropdownOpen, setContextDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [permissionDropdownOpen, setPermissionDropdownOpen] = useState(false);
  const [worktreeShelfOpen, setWorktreeShelfOpen] = useState(false);
  const [activeEnvironment, setActiveEnvironment] = useState<"local" | "worktree">("local");
  const [availableModels, setAvailableModels] = useState<SakiModelOption[]>([]);
  const [activeModelKey, setActiveModelKey] = useState<string>("");
  const [reasoningEffort] = useSakiReasoningEffort(activeModelKey);
  const [interactionMode, setInteractionMode] = useState<"agent" | "chat">(canUseAgent ? "agent" : "chat");
  const authorizedProjects = useMemo(() => {
    const list = instances.filter((instance) =>
      isSuperAdmin || instance.createdByUserId === userId || instance.assignedToUserId === userId || instance.assignees?.some((assignee) => assignee.userId === userId));
    const sshNodes = nodes.filter(node => node.protocol === "ssh");
    const syntheticServers: ManagedInstance[] = sshNodes.map(node => createNodeSyntheticInstance(node));
    return [...list, ...syntheticServers];
  }, [instances, nodes, isSuperAdmin, userId]);
  const selectedWorkspaceIds = normalizeSakiWorkspaceIds(activeInstanceId, workspaceInstanceIds);
  const canUseProjectMode = (mode: "agent" | "chat") => selectedWorkspaceIds.every(id => {
    const project = authorizedProjects.find(instance => instance.id === id);
    return Boolean(project && (project.myPermissions == null || project.myPermissions.includes(mode === "agent" ? "saki.agent" : "saki.chat")));
  });
  const agentProjects = authorizedProjects.filter((instance) => instance.myPermissions == null || instance.myPermissions.includes(interactionMode === "agent" ? "saki.agent" : "saki.chat"));
  const selectedProject = agentProjects.find((instance) => instance.id === activeInstanceId);
  const workspaceLabel = selectedWorkspaceIds.length > 1 ? `${selectedWorkspaceIds.length} 个工作区` : selectedProject?.name ?? (activeInstanceId ? "工作区不可用" : "添加工作区");
  const workspaceNames = selectedWorkspaceIds.map(id => authorizedProjects.find(instance => instance.id === id)?.name ?? "工作区不可用").join("、");
  const workspaceSelectionLocked = sessionLoading || Boolean(sessionLoadError) || workspaceSelectionBusy || isStreaming || Boolean(actionBusyId) || messages.some(message => message.actions?.some(action => action.status === "pending_approval" || action.status === "pending_input"));
  const canCreateTerminal = Boolean(isSuperAdmin && canUseTerminal && canUseAgent && selectedProject);
  const projectPermissionHint = !activeInstanceId
    ? isSuperAdmin ? "未关联项目；项目操作仍按工具权限校验" : "仅可对话、规划和搜索；使用项目工具前请选择已授权项目"
    : !selectedProject || !canUseProjectMode(interactionMode) ? "已选工作区不可用或未授权，请重新选择工作区"
    : selectedWorkspaceIds.length > 1 ? `已添加 ${selectedWorkspaceIds.length} 个工作区：${workspaceNames}；按各工作区权限执行`
    : selectedProject.myPermissions
      ? `当前项目权限：${[
          selectedProject.myPermissions.includes("file.read") && "读取",
          selectedProject.myPermissions.includes("file.write") && "写入",
          selectedProject.myPermissions.includes("file.delete") && "删除",
          selectedProject.myPermissions.includes("instance.logs") && "日志",
          selectedProject.myPermissions.includes("task.view") && "查看任务"
        ].filter(Boolean).join("、") || "仅对话"}`
      : isSuperAdmin ? "按当前账号与项目权限执行" : "仅限当前项目，按账号权限执行；外部文件需单次审批";
  const [agentPermission, setAgentPermission] = useState<SakiAgentPermissionMode>("acceptEdits");
  const activePermission = AGENT_PERMISSION_OPTIONS.find((option) => option.id === agentPermission)!;
  const PermissionIcon = activePermission.icon;
  const [detailsTab, setDetailsTab] = useState<"action" | "terminal" | "changes">("action");
  const {
    summary: rawGitChangesSummary,
    reverting: revertingChanges,
    revertAll: handleRevertAllChanges,
    restoreAll: handleRestoreAllChanges
  } = useCodeChanges({
    token,
    instanceId: selectedProject?.id ?? null,
    isRunning: isStreaming,
    watchKey: messages.length
  });

  const gitChangesSummary = useMemo(() => {
    return filterGitChangesForSession(rawGitChangesSummary, messages);
  }, [rawGitChangesSummary, messages]);

  function handleOpenChangesDetails() {
    setDetailsTab("changes");
    setTerminalPanelOpen(true);
  }

  useEffect(() => {
    setTerminals([]); setActiveTerminalId(null); setTerminalPanelOpen(false); setSelectedTool(null);
  }, [activeInstanceId, userId]);

  useEffect(() => {
    if (!copiedMessageId) return;
    const timer = window.setTimeout(() => setCopiedMessageId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedMessageId]);
  useEffect(() => {
    if (!messageNotice) return;
    const timer = window.setTimeout(() => setMessageNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [messageNotice]);

  function selectTool(messageId: string, actionId: string) {
    const action = visibleSakiActions(messages.find((message) => message.id === messageId)?.actions).find((item) => item.id === actionId);
    setSelectedTool({ messageId, actionId });
    setTerminalPanelOpen(true);
    setDetailsTab("action");
    const targetId = action?.terminal?.instanceId ?? (typeof action?.args.instanceId === "string" ? action.args.instanceId : activeInstanceId);
    const terminal = isSuperAdmin && canUseTerminal && action && action.status !== "pending_approval" && targetId && selectedWorkspaceIds.includes(targetId) ? dashboardActionTerminal(action, targetId) : undefined;
    if (terminal) setTerminals((current) => [...current.filter((item) => item.shellId !== terminal.shellId || item.instanceId !== terminal.instanceId), terminal]);
    setActiveTerminalId(terminal ? `${terminal.instanceId}:${terminal.shellId}` : null);
  }

  async function createTerminal() {
    if (!canCreateTerminal || !activeInstanceId || terminalBusy) return;
    const instanceId = activeInstanceId;
    setTerminalBusy(true);
    try {
      const result = await api.sakiCreateTerminal(token, instanceId);
      if (terminalInstanceRef.current !== instanceId) return;
      const terminal = dashboardActionTerminal(result.action, instanceId);
      if (!result.action.ok || !terminal) throw new Error(result.action.observation || "终端创建失败。");
      setTerminals((current) => [...current.filter((item) => item.shellId !== terminal.shellId || item.instanceId !== terminal.instanceId), terminal]);
      setActiveTerminalId(`${terminal.instanceId}:${terminal.shellId}`); setTerminalPanelOpen(true);
      setDetailsTab("terminal");
    } catch (err) { setError(err instanceof Error ? err.message : "终端创建失败。"); }
    finally { setTerminalBusy(false); }
  }

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 768px)");
    const update = () => setSidebarCollapsed(narrow.matches);
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);

  function selectWorkspace(instanceId: string | null) {
    if (actionBusyId || workspaceSelectionBusy) return;
    if (instanceId && !agentProjects.some((instance) => instance.id === instanceId)) return;
    setActiveInstanceId(instanceId);
    setWorkspaceInstanceIds(instanceId ? [instanceId] : []);
    selectSession(null);
    setMessages([]);
    setSelectedTool(null);
    setViewMode("workspace");
    if (window.matchMedia("(max-width: 768px)").matches) setSidebarCollapsed(true);
  }

  async function updateWorkspaceSelection(ids: string[]) {
    if (workspaceSelectionLocked) return;
    if (ids.length > maxSakiWorkspaces) { setError(`最多可同时添加 ${maxSakiWorkspaces} 个工作区。`); return; }
    const primaryId = ids[0] ?? null;
    const nextIds = normalizeSakiWorkspaceIds(primaryId, ids);
    setWorkspaceSelectionBusy(true);
    try {
      if (activeSessionId) {
        const write = await prepareMessageHistoryWrite();
        const updatedAt = write.localOnly ? new Date().toISOString() : (await api.sakiSaveConversation(token, {
          id: activeSessionId, instanceId: primaryId, workspaceInstanceIds: nextIds,
          baseUpdatedAt: write.baseUpdatedAt, messages: messages.map(message => ({ ...message, streaming: false }))
        })).updatedAt;
        historyVersionsRef.current.set(activeSessionId, updatedAt);
        setSessions(current => current.map(session => session.id === activeSessionId ? { ...session, instanceId: primaryId, workspaceInstanceIds: nextIds, updatedAt } : session));
        const stored = readSakiConversations(userId);
        writeSakiConversations(stored.map(conversation => conversation.id === activeSessionId ? {
          ...conversation, instanceId: primaryId, workspaceInstanceIds: nextIds, contextKey: sakiWorkspaceContextKey(primaryId, nextIds), updatedAt
        } : conversation), userId);
      }
      setActiveInstanceId(primaryId);
      setWorkspaceInstanceIds(nextIds);
    } catch (err) { setError(err instanceof Error ? err.message : "保存工作区选择失败。"); }
    finally { setWorkspaceSelectionBusy(false); }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (target instanceof Element && target.closest("[data-dashboard-popover]")) return;
      if (topbarDropdownRef.current && !topbarDropdownRef.current.contains(target)) {
        setTopbarDropdownOpen(false);
      }
      if (contextDropdownRef.current && !contextDropdownRef.current.contains(target)) {
        setContextDropdownOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(target)) {
        setModelDropdownOpen(false);
      }
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(target)) {
        setModeDropdownOpen(false);
      }
      if (permissionDropdownRef.current && !permissionDropdownRef.current.contains(target)) {
        setPermissionDropdownOpen(false);
      }
      if (worktreeShelfRef.current && !worktreeShelfRef.current.contains(target)) {
        setWorktreeShelfOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const renderInstanceAndPagePopover = (onClose: () => void, anchorRef: React.RefObject<HTMLDivElement | null>) => {
    const regularInstances = agentProjects.filter((inst) => !inst.id.startsWith("node:"));
    const serverInstances = agentProjects.filter((inst) => inst.id.startsWith("node:"));

    return (
      <DashboardPopover anchorRef={anchorRef} onClose={onClose} className="dashboard-project-popover">
        <div className="dashboard-dropdown-section-title">工作区 · {selectedWorkspaceIds.length}/{maxSakiWorkspaces}</div>
        <p className="dashboard-workspace-hint">可添加多个工作区一起使用，默认工作区用于未指定目标的操作。</p>
        {workspaceSelectionLocked && <p className="dashboard-workspace-hint">任务执行或等待决定时暂时不能更改工作区。</p>}
        <button
          className={`dashboard-dropdown-item ${!activeInstanceId ? "is-selected" : ""}`}
          type="button"
          disabled={workspaceSelectionLocked}
          onClick={() => {
            void updateWorkspaceSelection([]);
            onClose();
          }}
        >
          <Folder size={13} className="dashboard-dropdown-icon-blue" />
          <div className="dashboard-dropdown-item-text">
            <span className="dashboard-dropdown-item-title">无工作区</span>
            <span className="dashboard-dropdown-item-desc">清空当前选择</span>
          </div>
          {!activeInstanceId && <Check size={13} className="dashboard-dropdown-check" />}
        </button>

        {serverInstances.length > 0 && (
          <>
            <div className="dashboard-dropdown-divider" />
            <div className="dashboard-dropdown-section-title">远程 SSH 服务器 ({serverInstances.length})</div>
            {serverInstances.map((inst) => {
              const node = nodes.find((n) => n.id === inst.nodeId);
              const isSelected = selectedWorkspaceIds.includes(inst.id);
              const isDefault = activeInstanceId === inst.id;
              const isOnline = node?.status === "ONLINE";
              return (
                <div className="dashboard-workspace-option" key={inst.id}>
                  <button
                    className={`dashboard-dropdown-item ${isSelected ? "is-selected" : ""}`}
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    disabled={workspaceSelectionLocked || (!isSelected && selectedWorkspaceIds.length >= maxSakiWorkspaces)}
                    onClick={() => {
                      void updateWorkspaceSelection(isSelected ? selectedWorkspaceIds.filter(id => id !== inst.id) : [...selectedWorkspaceIds, inst.id]);
                    }}
                  >
                    <Server size={13} style={{ color: "#38bdf8", flexShrink: 0 }} />
                    <div className="dashboard-dropdown-item-text">
                      <span className="dashboard-dropdown-item-title">{inst.name}</span>
                      <span className="dashboard-dropdown-item-desc">
                        {node ? `${node.host}:${node.port}` : "SSH 主机"} · {isOnline ? "在线" : "离线"}{isDefault ? " · 默认工作区" : ""}
                      </span>
                    </div>
                    {isSelected && <Check size={13} className="dashboard-dropdown-check" />}
                  </button>
                  {isSelected && !isDefault && (
                    <button
                      type="button"
                      className="dashboard-workspace-default-btn"
                      disabled={workspaceSelectionLocked}
                      onClick={() => void updateWorkspaceSelection([inst.id, ...selectedWorkspaceIds.filter(id => id !== inst.id)])}
                      title={`将 ${inst.name} 设为默认工作区`}
                    >
                      设为默认
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {regularInstances.length > 0 && (
          <>
            <div className="dashboard-dropdown-divider" />
            <div className="dashboard-dropdown-section-title">托管服务实例 ({regularInstances.length})</div>
            {regularInstances.map((inst) => {
              const isSelected = selectedWorkspaceIds.includes(inst.id);
              const isDefault = activeInstanceId === inst.id;
              return (
                <div className="dashboard-workspace-option" key={inst.id}>
                  <button
                    className={`dashboard-dropdown-item ${isSelected ? "is-selected" : ""}`}
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    disabled={workspaceSelectionLocked || (!isSelected && selectedWorkspaceIds.length >= maxSakiWorkspaces)}
                    onClick={() => {
                      void updateWorkspaceSelection(isSelected ? selectedWorkspaceIds.filter(id => id !== inst.id) : [...selectedWorkspaceIds, inst.id]);
                    }}
                  >
                    <Boxes size={13} className="dashboard-dropdown-icon-green" />
                    <div className="dashboard-dropdown-item-text">
                      <span className="dashboard-dropdown-item-title">{inst.name}</span>
                      <span className="dashboard-dropdown-item-desc">
                        {inst.nodeName || "独立运行实例"}{isDefault ? " · 默认工作区" : ""}
                      </span>
                    </div>
                    {isSelected && <Check size={13} className="dashboard-dropdown-check" />}
                  </button>
                  {isSelected && !isDefault && (
                    <button
                      type="button"
                      className="dashboard-workspace-default-btn"
                      disabled={workspaceSelectionLocked}
                      onClick={() => void updateWorkspaceSelection([inst.id, ...selectedWorkspaceIds.filter(id => id !== inst.id)])}
                      title={`将 ${inst.name} 设为默认工作区`}
                    >
                      设为默认
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

      {onNavigateView && (
        <>
          <div className="dashboard-dropdown-divider" />
          <div className="dashboard-dropdown-section-title">快捷跳转页面</div>
          {PAGE_OPTIONS.filter((p) => !availableViews || availableViews.includes(p.view)).map((page) => (
            <button
              key={page.view}
              className="dashboard-dropdown-item"
              type="button"
              onClick={() => {
                onClose();
                onNavigateView(page.view);
              }}
            >
              {page.icon}
              <div className="dashboard-dropdown-item-text">
                <span className="dashboard-dropdown-item-title">{page.label}</span>
                <span className="dashboard-dropdown-item-desc">{page.desc}</span>
              </div>
            </button>
          ))}
        </>
      )}
    </DashboardPopover>
    );
  };

  const renderEnvironmentPopover = (onClose: () => void) => (
    <DashboardPopover anchorRef={worktreeShelfRef} onClose={onClose} className="dashboard-project-popover dashboard-env-popover">
      <div className="dashboard-dropdown-section-title">运行环境与空间</div>
      <button
        className={`dashboard-dropdown-item ${activeEnvironment === "local" ? "is-selected" : ""}`}
        type="button"
        onClick={() => {
          setActiveEnvironment("local");
          onClose();
        }}
      >
        <Monitor size={13} className="dashboard-dropdown-icon-teal" />
        <div className="dashboard-dropdown-item-text">
          <span className="dashboard-dropdown-item-title">Local</span>
          <span className="dashboard-dropdown-item-desc">本地集群环境</span>
        </div>
        {activeEnvironment === "local" && <Check size={13} className="dashboard-dropdown-check" />}
      </button>
      <button
        className={`dashboard-dropdown-item ${activeEnvironment === "worktree" ? "is-selected" : ""}`}
        type="button"
        disabled
        onClick={() => {
          setActiveEnvironment("worktree");
          onClose();
        }}
      >
        <GitBranch size={13} className="dashboard-dropdown-icon-purple" />
        <div className="dashboard-dropdown-item-text">
          <span className="dashboard-dropdown-item-title">New Worktree（未接入）</span>
          <span className="dashboard-dropdown-item-desc">当前环境尚未提供独立工作树执行</span>
        </div>
        {activeEnvironment === "worktree" && <Check size={13} className="dashboard-dropdown-check" />}
      </button>
    </DashboardPopover>
  );

  // Dynamic Saki Model Refresh from Backend
  const refreshModels = useCallback(async () => {
    if (!canUseAgent && !canUseChat) return;
    try {
      if (!canConfigureSaki) {
        const status = await api.sakiStatus(token);
        if (status.model) {
          const model = { id: status.model, name: status.model, label: status.model, provider: status.provider ?? "" };
          setAvailableModels([model]);
          setActiveModelKey(sakiModelSelectionKey(model));
        }
        return;
      }
      const config = await api.sakiConfig(token);
      const configuredKey = config.model
        ? sakiModelSelectionKey({ id: config.model, provider: config.provider })
        : "";
      const res = await api.sakiModels(token, {
        provider: config.provider,
        model: config.model,
        ollamaUrl: config.ollamaUrl,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        providerConfigs: config.providerConfigs
      });

      const models = Array.isArray(res.models) ? res.models : [];
      if (models.length > 0) {
        setAvailableModels(models);
        setActiveModelKey((current) => {
          if (current && models.some((m) => sakiModelMatchesSelection(m, current))) {
            return current;
          }
          if (configuredKey && models.some((m) => sakiModelMatchesSelection(m, configuredKey))) {
            return configuredKey;
          }
          return sakiModelSelectionKey(models[0]!);
        });
      } else if (config.model) {
        setActiveModelKey(configuredKey);
      }
    } catch (err) {
      console.warn("Failed to load Saki models from backend:", err);
    }
  }, [token, canConfigureSaki, canUseAgent, canUseChat]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    if (modelDropdownOpen) {
      void refreshModels();
    }
  }, [modelDropdownOpen, refreshModels]);

  const currentSelectedModel = useMemo(() => {
    return availableModels.find((m) => sakiModelMatchesSelection(m, activeModelKey));
  }, [availableModels, activeModelKey]);

  const currentModelDisplayName = useMemo(() => {
    if (currentSelectedModel) {
      return currentSelectedModel.label || currentSelectedModel.name || currentSelectedModel.id;
    }
    if (activeModelKey) {
      const parsed = parseSakiModelSelection(activeModelKey);
      return parsed.model || activeModelKey;
    }
    return "选择模型";
  }, [currentSelectedModel, activeModelKey]);

  const renderModelSelector = () => (
    <div className="dashboard-model-dropdown-wrapper" ref={modelDropdownRef}>
      <button
        className="dashboard-model-btn"
        type="button"
        onClick={() => setModelDropdownOpen((v) => !v)}
        title="切换 AI 模型"
      >
        <Sparkles size={12} className="dashboard-model-sparkle-icon" />
        <span className="dashboard-model-name">{currentModelDisplayName}</span>
        {reasoningEffort !== "auto" ? <span className="saki-reasoning-trigger-label">{sakiReasoningEffortLabel(reasoningEffort)}</span> : null}
        <ChevronDown size={11} className={`dashboard-model-chevron ${modelDropdownOpen ? "is-open" : ""}`} />
      </button>

      {modelDropdownOpen && (
        <DashboardPopover anchorRef={modelDropdownRef} onClose={() => setModelDropdownOpen(false)} className="dashboard-model-popover" width={320}>
          <SakiModelPicker models={availableModels} currentModelId={activeModelKey} currentModelName={currentModelDisplayName} onSelectModel={setActiveModelKey} />
        </DashboardPopover>
      )}
    </div>
  );

  const renderModeSelector = () => (
    <div className="dashboard-model-dropdown-wrapper" ref={modeDropdownRef}>
      <button
        className={`dashboard-model-btn dashboard-mode-btn is-${interactionMode}`}
        type="button"
        onClick={() => setModeDropdownOpen((v) => !v)}
        title="切换交互模式：Agent 智能体 / 聊天问答"
      >
        {interactionMode === "agent" ? (
          <Bot size={13} className="dashboard-mode-icon-agent" />
        ) : (
          <MessageSquare size={12} className="dashboard-mode-icon-chat" />
        )}
        <span>{interactionMode === "agent" ? "Agent" : "聊天"}</span>
        <ChevronDown size={11} className={`dashboard-model-chevron ${modeDropdownOpen ? "is-open" : ""}`} />
      </button>

      {modeDropdownOpen && (
        <DashboardPopover anchorRef={modeDropdownRef} onClose={() => setModeDropdownOpen(false)} className="dashboard-model-popover dashboard-mode-popover">
          <div className="dashboard-dropdown-section-title">交互模式</div>
          <button
            className={`dashboard-dropdown-item ${interactionMode === "agent" ? "is-selected" : ""}`}
            type="button"
            disabled={!canUseAgent || !canUseProjectMode("agent") || isStreaming || Boolean(actionBusyId)}
            onClick={() => {
              setInteractionMode("agent");
              setModeDropdownOpen(false);
            }}
          >
            <Bot size={14} className="dashboard-mode-icon-agent" />
            <div className="dashboard-dropdown-item-text">
              <span className="dashboard-dropdown-item-title">Agent 智能体</span>
              <span className="dashboard-dropdown-item-desc">自主规划与自动化运维工具执行</span>
            </div>
            {interactionMode === "agent" && <Check size={13} className="dashboard-dropdown-check" />}
          </button>
          <button
            className={`dashboard-dropdown-item ${interactionMode === "chat" ? "is-selected" : ""}`}
            type="button"
            disabled={!canUseChat || !canUseProjectMode("chat") || isStreaming || Boolean(actionBusyId)}
            onClick={() => {
              setInteractionMode("chat");
              setModeDropdownOpen(false);
            }}
          >
            <MessageSquare size={14} className="dashboard-mode-icon-chat" />
            <div className="dashboard-dropdown-item-text">
              <span className="dashboard-dropdown-item-title">聊天问答</span>
              <span className="dashboard-dropdown-item-desc">只读对话分析与建议咨询</span>
            </div>
            {interactionMode === "chat" && <Check size={13} className="dashboard-dropdown-check" />}
          </button>
        </DashboardPopover>
      )}
    </div>
  );

  const renderPermissionSelector = () => {
    if (interactionMode !== "agent") return null;
    return (
      <div className="dashboard-model-dropdown-wrapper" ref={permissionDropdownRef}>
        <button
          className={`dashboard-model-btn dashboard-permission-btn is-${activePermission.color}`}
          type="button"
          onClick={() => setPermissionDropdownOpen((v) => !v)}
          title={`${activePermission.description}。${projectPermissionHint}`}
          aria-expanded={permissionDropdownOpen}
          aria-label={`智能体权限策略：${activePermission.label}`}
        >
          <PermissionIcon size={12} className={`dashboard-perm-icon is-${activePermission.color}`} />
          <span>{activePermission.label}</span>
          <ChevronDown size={11} className={`dashboard-model-chevron ${permissionDropdownOpen ? "is-open" : ""}`} />
        </button>

        {permissionDropdownOpen && (
          <DashboardPopover anchorRef={permissionDropdownRef} onClose={() => setPermissionDropdownOpen(false)} className="dashboard-model-popover dashboard-permission-popover">
            <div className="dashboard-dropdown-section-title">智能体权限策略</div>
            <div className="dashboard-project-permission-note">{projectPermissionHint}。审批方式不会增加账号权限。</div>
            {AGENT_PERMISSION_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isSelected = agentPermission === option.id;
              return (
                <button
                  key={option.id}
                  className={`dashboard-dropdown-item ${isSelected ? "is-selected" : ""}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setAgentPermission(option.id);
                    setPermissionDropdownOpen(false);
                  }}
                >
                  <Icon size={14} className={`dashboard-perm-icon is-${option.color}`} />
                  <div className="dashboard-dropdown-item-text">
                    <span className="dashboard-dropdown-item-title">{option.menuLabel}</span>
                    <span className="dashboard-dropdown-item-desc">{option.description}</span>
                  </div>
                  {isSelected && <Check size={13} className="dashboard-dropdown-check" />}
                </button>
              );
            })}
          </DashboardPopover>
        )}
      </div>
    );
  };

  const handleAddFiles = useCallback(async (files: File[], preferredKind: "image" | "file") => {
    if (files.length === 0 || composerBusy) return;
    const available = Math.max(0, sakiMaxInputAttachments - attachments.length);
    if (available <= 0) {
      setError(`最多只能附加 ${sakiMaxInputAttachments} 个项目。`);
      return;
    }

    setComposerBusy(preferredKind);
    try {
      const selected = files.slice(0, available);
      const nextAttachments: SakiInputAttachment[] = [];
      for (const file of selected) {
        nextAttachments.push(await fileToSakiAttachment(file, preferredKind));
      }
      setAttachments((current) => [...current, ...nextAttachments].slice(0, sakiMaxInputAttachments));
      if (files.length > selected.length) {
        setError(`最多只能附加 ${sakiMaxInputAttachments} 个项目，已自动忽略多余文件。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "附件读取失败");
    } finally {
      setComposerBusy(null);
    }
  }, [attachments.length, composerBusy]);

  const handlePasteClipboardImage = useCallback(async () => {
    if (composerBusy) return;
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard?.read) {
      imageInputRef.current?.click();
      return;
    }
    setComposerBusy("image");
    try {
      const items = await clipboard.read();
      const imageFiles: File[] = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext = imageType.split("/")[1]?.replace("jpeg", "jpg") || "png";
        imageFiles.push(new File([blob], `screenshot-${Date.now()}.${ext}`, { type: imageType }));
      }
      if (imageFiles.length > 0) {
        await handleAddFiles(imageFiles, "image");
      } else {
        setError("剪贴板中未找到可用图片，已打开本地图片选择。");
        imageInputRef.current?.click();
      }
    } catch {
      imageInputRef.current?.click();
    } finally {
      setComposerBusy(null);
    }
  }, [composerBusy, handleAddFiles]);

  const handleToggleAddMenu = useCallback((btnRef: React.RefObject<HTMLButtonElement | null>) => {
    if (addMenuOpen && activeAddAnchorRef.current === btnRef.current) {
      setAddMenuOpen(false);
    } else {
      activeAddAnchorRef.current = btnRef.current;
      setAddMenuOpen(true);
    }
  }, [addMenuOpen]);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files") || hasAnyFileDragData(e.dataTransfer)) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    // 1. Check if dropped from instance file manager
    const instancePayload = parseSakiInstanceFileDragPayload(e.dataTransfer);
    if (instancePayload) {
      window.dispatchEvent(new CustomEvent("saki:attach_instance_file", { detail: instancePayload }));
      return;
    }

    // 2. Otherwise handle native OS files
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) {
      const first = files[0];
      const preferredKind = first?.type.startsWith("image/") ? "image" : "file";
      void handleAddFiles(files, preferredKind);
    }
  }, [handleAddFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;
    const files = Array.from(clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      const first = files[0];
      const preferredKind = first?.type.startsWith("image/") ? "image" : "file";
      void handleAddFiles(files, preferredKind);
    }
  }, [handleAddFiles]);

  const renderAddPopover = () => {
    if (!addMenuOpen || !activeAddAnchorRef.current) return null;
    return (
      <DashboardPopover
        anchorRef={activeAddAnchorRef}
        onClose={() => setAddMenuOpen(false)}
        className="dashboard-model-popover dashboard-add-popover"
        width={220}
      >
        <div className="dashboard-dropdown-section-title">添加内容</div>
        <button
          className="dashboard-dropdown-item"
          type="button"
          disabled={Boolean(composerBusy)}
          onClick={() => {
            setAddMenuOpen(false);
            imageInputRef.current?.click();
          }}
        >
          <ImageIcon size={15} style={{ color: "#0071e3" }} />
          <div className="dashboard-dropdown-item-text">
            <span className="dashboard-dropdown-item-title">上传图片</span>
            <span className="dashboard-dropdown-item-desc">PNG, JPG, WebP 图像</span>
          </div>
        </button>
        <button
          className="dashboard-dropdown-item"
          type="button"
          disabled={Boolean(composerBusy)}
          onClick={() => {
            setAddMenuOpen(false);
            fileInputRef.current?.click();
          }}
        >
          <Paperclip size={15} style={{ color: "#10b981" }} />
          <div className="dashboard-dropdown-item-text">
            <span className="dashboard-dropdown-item-title">上传文件</span>
            <span className="dashboard-dropdown-item-desc">文档、配置、日志或代码</span>
          </div>
        </button>
        <button
          className="dashboard-dropdown-item"
          type="button"
          disabled={Boolean(composerBusy)}
          onClick={() => {
            setAddMenuOpen(false);
            void handlePasteClipboardImage();
          }}
        >
          <ClipboardList size={15} style={{ color: "#8b5cf6" }} />
          <div className="dashboard-dropdown-item-text">
            <span className="dashboard-dropdown-item-title">粘贴图片</span>
            <span className="dashboard-dropdown-item-desc">读取剪贴板最新图片</span>
          </div>
        </button>
      </DashboardPopover>
    );
  };

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    if (!sessionId || activeSessionIdRef.current !== sessionId) return;
    const generation = ++sessionRequestGenerationRef.current;
    const isCurrent = () => sessionRequestGenerationRef.current === generation && activeSessionIdRef.current === sessionId;
    const existingSession = sessionsRef.current.find((item) => item.id === sessionId);
    if (streamRunsRef.current.has(sessionId)) {
      // Live events own the message list; fetch history again once this stream settles.
      if (existingSession?.messages !== undefined) setMessages(existingSession.messages);
      setSessionLoading(false);
      setSessionLoadError(null);
      return;
    }
    if (hydratedSessionIdsRef.current.has(sessionId) && existingSession?.messages !== undefined) {
      setMessages(existingSession.messages);
      setActiveInstanceId(existingSession.instanceId);
      setWorkspaceInstanceIds(normalizeSakiWorkspaceIds(existingSession.instanceId, existingSession.workspaceInstanceIds));
      sessionLoadingRef.current = false;
      setSessionLoading(false);
      setSessionLoadError(null);
      return;
    }

    sessionLoadingRef.current = true;
    setSessionLoading(true);
    setSessionLoadError(null);
    const cached = readResourceSnapshot<SakiSavedConversation>(token, `conversation:${sessionId}`)
      ?? readSakiConversations(userId).find((item) => item.id === sessionId);
    setMessages((cached?.messages ?? []).map((m: any, idx: number) =>
      formatStoredChatMessage(m, idx, cached!.updatedAt, language)
    ));
    try {
      // A local cache is display-only until the authoritative history is loaded.
      const remote = localHistoryOnlyRef.current && cached ? cached : await api.sakiGetConversation(token, sessionId);
      if (!isCurrent() || streamRunsRef.current.has(sessionId)) return;
      const formatted = (remote.messages || []).map((m: any, idx: number) =>
        formatStoredChatMessage(m, idx, remote.updatedAt, language)
      );
      historyVersionsRef.current.set(remote.id, remote.updatedAt);
      hydratedSessionIdsRef.current.add(sessionId);
      setMessages(formatted);
      setActiveInstanceId(remote.instanceId ?? null);
      setWorkspaceInstanceIds(normalizeSakiWorkspaceIds(remote.instanceId, remote.workspaceInstanceIds ?? sakiWorkspaceIdsFromContextKey(remote.contextKey, remote.instanceId)));
      setSessions((current) => current.map((item) => item.id === sessionId ? { ...item, messages: formatted, updatedAt: remote.updatedAt } : item));
      sessionLoadingRef.current = false;
      setSessionLoading(false);
    } catch (error) {
      if (!isCurrent()) return;
      // Keep sending locked: an empty or stale history must never replace the saved conversation.
      setSessionLoading(false);
      setSessionLoadError(error instanceof Error ? error.message : "会话加载失败，请重试。");
    }
  }, [language, token, userId]);

  useEffect(() => {
    hydratedSessionIdsRef.current.clear();
    sessionRequestGenerationRef.current++;
    return () => { sessionRequestGenerationRef.current++; };
  }, [token, userId]);

  // Sync stored conversations on mount (lightweight metadata list first)
  useEffect(() => {
    let isCancelled = false;
    async function loadConversations() {
      try {
        const remote = await api.sakiListConversations(token, { excludeMessages: true });
        if (isCancelled) return;
        if (Array.isArray(remote)) {
          localHistoryOnlyRef.current = false;
          for (const conversation of remote) {
            const previousVersion = historyVersionsRef.current.get(conversation.id);
            if (previousVersion && previousVersion !== conversation.updatedAt) hydratedSessionIdsRef.current.delete(conversation.id);
            historyVersionsRef.current.set(conversation.id, conversation.updatedAt);
          }
          setSessions((current) => {
            const currentById = new Map(current.map((session) => [session.id, session]));
            const loaded = remote.map((c) => ({
              id: c.id,
              instanceId: c.instanceId ?? null,
              workspaceInstanceIds: c.workspaceInstanceIds ?? sakiWorkspaceIdsFromContextKey(c.contextKey, c.instanceId),
              updatedAt: c.updatedAt,
              title: c.title || "历史会话",
              category: c.instanceId ? c.label || "实例会话" : "无项目",
              time: formatRelativeTime(c.updatedAt, language)
            }));
            const loadedIds = new Set(loaded.map((session) => session.id));
            return [
              ...loaded.map((session) => {
                const existing = currentById.get(session.id);
                return existing?.messages ? { ...session, messages: existing.messages } : session;
              }),
              ...current.filter((session) => !loadedIds.has(session.id) && (!session.updatedAt || streamRunsRef.current.has(session.id)))
            ];
          });
          setConversationsLoaded(true);
          return;
        }
      } catch {
        // Fallback to local storage if remote list is unavailable
      }

      localHistoryOnlyRef.current = true;
      const stored = readSakiConversations(userId);
      if (!isCancelled && stored.length > 0) {
        setSessions((current) => {
          const loaded = stored.map((c) => ({
            id: c.id,
            instanceId: c.instanceId ?? null,
            workspaceInstanceIds: c.workspaceInstanceIds ?? sakiWorkspaceIdsFromContextKey(c.contextKey, c.instanceId),
            title: c.title || "历史会话",
            category: c.label || "历史记录",
            time: formatRelativeTime(c.updatedAt, language),
            updatedAt: c.updatedAt,
            messages: (c.messages || []).map((m: any, idx: number) =>
              formatStoredChatMessage(m, idx, c.updatedAt, language)
            )
          }));
          return [...loaded.map((session) => current.find((item) => item.id === session.id) ?? session),
            ...current.filter((session) => !loaded.some((item) => item.id === session.id))];
        });
      }
      if (!isCancelled) setConversationsLoaded(true);
    }
    void loadConversations();
    return () => {
      isCancelled = true;
    };
  }, [language, token, userId]);

  // Discover work that continued while this page was unmounted. Task snapshots
  // are scoped by conversation, including multiple conversations in one project.
  useEffect(() => {
    if (!conversationsLoaded) return;
    setSessions((current) => {
      let next = current;
      for (const [id, task] of latestTasks) {
        if (streamRunsRef.current.has(id)) continue;
        const session = next.find((item) => item.id === id);
        if (!dashboardTaskNeedsSync(session?.messages ?? [], task)) continue;
        const updated = { ...session, id, instanceId: task.instanceId, workspaceInstanceIds: task.workspaceInstanceIds, title: session?.title ?? task.message.slice(0, 24),
          category: session?.category ?? "智能体运维", time: session?.time ?? "刚刚", messages: dashboardTaskMessages(session?.messages ?? [], task) };
        next = session ? next.map((item) => item.id === id ? updated : item) : [updated, ...next];
      }
      return next;
    });
    const task = activeSessionId ? latestTasks.get(activeSessionId) : undefined;
    if (task && !streamRunsRef.current.has(activeSessionId!)) {
      setMessages((current) => dashboardTaskMessages(current, task));
    }
  }, [conversationsLoaded, latestTasks, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadSessionDetail(activeSessionId);
  }, [conversationsLoaded, activeSessionId, loadSessionDetail, isStreaming]);

  const reconnectTask = useCallback(async (task: SakiActiveTaskSummary) => {
    const sessionId = dashboardTaskSessionId(task);
    if (streamRunsRef.current.has(sessionId)) return;
    const run = startStream(sessionId, "agent", task.id);
    const assistantId = task.assistantMessageId ?? `${task.id}-assistant`;
    let content = "";
    let thinking = "";
    let timeline: ChatMessage["timeline"] = [];
    let settled = false;
    const patch = (update: Partial<ChatMessage>) => publishSessionMessages(sessionId, (current) =>
      dashboardTaskMessages(current, task).map((message) => message.id === assistantId ? { ...message, ...update,
        ...(update.timeline ? { timeline: dashboardMergeTimeline(message.timelineBase, update.timeline) } : {}),
        ...(update.actions && update.isStreaming !== false ? { actions: [...new Map([...(message.actions ?? []), ...update.actions].map((action) => [action.id, action])).values()] } : {}) } : message));
    patch({ isStreaming: true, isThinking: false, workflowMessage: task.progress?.message ?? "正在恢复任务连接…" });
    try {
      await api.sakiStreamTaskReconnect(token, task.id, (event) => {
        if (run.detached || run.controller.signal.aborted) return;
        timeline = dashboardStreamTimeline(timeline, event);
        patch({ timeline });
        if (event.type === "meta") patch({ content: "", thinking: "" });
        else if (event.type === "delta") { content += event.text; patch({ content, isThinking: false, workflowMessage: undefined }); }
        else if (event.type === "thinking") { thinking += event.text; patch({ thinking, isThinking: true }); }
        else if (event.type === "action") {
          patch({ actions: [event.action], isThinking: false, workflowMessage: undefined });
        } else if (event.type === "workflow") patch({ workflowMessage: event.stage === "narration" || event.status !== "running" ? undefined : event.message });
        else if (event.type === "done") {
          settled = true;
          patch({ content: event.response.message, thinking: event.response.thinking ?? thinking,
            ...(event.response.actions ? { actions: event.response.actions } : {}), isStreaming: false, isThinking: false, workflowMessage: undefined });
        } else if (event.type === "error") {
          settled = true;
          patch({ content: content || event.message, isStreaming: false, isThinking: false, workflowMessage: undefined });
        }
      }, run.controller.signal);
    } catch {
      // A dropped observer never cancels the server task. Polling discovers its
      // latest state and reconnects the selected conversation on the next tick.
    } finally {
      if (!run.detached) {
        reconnectAfterRef.current.set(task.id, Date.now() + (settled ? 1000 : 3000));
        finishStream(sessionId, run);
      }
    }
  }, [token, startStream, finishStream, publishSessionMessages]);

  useEffect(() => {
    if (!conversationsLoaded || !activeSessionId) return;
    const task = latestTasks.get(activeSessionId);
    if (task?.status === "running" && !streamRunsRef.current.has(activeSessionId) && Date.now() >= (reconnectAfterRef.current.get(task.id) ?? 0)) void reconnectTask(task);
  }, [conversationsLoaded, activeSessionId, latestTasks, reconnectTask]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    const isCurrent = () => generation === refreshGenerationRef.current;
    setError("");
    const failed = (err: unknown) => {
      if (!isCurrent()) return;
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError((current) => current || (err instanceof Error ? err.message : "概览数据加载失败"));
    };
    if (!canViewNodes) setNodes([]);
    if (!canViewInstances) setInstances([]);
    await Promise.all([
      api.dashboard(token).then((next) => { if (isCurrent()) setOverview(next); }).catch(failed)
        .finally(() => { if (isCurrent()) setLoading(false); }),
      canViewNodes ? api.nodes(token).then((next) => { if (isCurrent()) setNodes(next); }).catch(failed) : Promise.resolve(),
      canViewInstances ? api.instances(token, { cachedStatus: true }).then(async (next) => {
        if (!isCurrent()) return;
        setInstances(next);
        const statuses = await api.instanceStatuses(token);
        if (isCurrent()) setInstances((current) => mergeInstanceStatuses(current, statuses, next));
      }).catch(failed) : Promise.resolve()
    ]);
  }, [canViewInstances, canViewNodes, onLogout, token]);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onVisible, 10000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      refreshGenerationRef.current++;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshTick]);

  useEffect(() => {
    if (canViewInstances && readResourceSnapshot(token, "instances") !== undefined) writeResourceSnapshot(token, "instances", instances);
  }, [token, instances, canViewInstances]);
  useEffect(() => {
    if (canViewNodes && readResourceSnapshot(token, "nodes") !== undefined) writeResourceSnapshot(token, "nodes", nodes);
  }, [token, nodes, canViewNodes]);

  useGlobalEvent("node.status_changed", (event) => {
    const data = event.data as { nodeId?: string; status?: ManagedNode["status"]; lastSeenAt?: string | null } | undefined;
    if (!data?.nodeId) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === data.nodeId
          ? {
              ...n,
              status: data.status ?? n.status,
              lastSeenAt: (data.lastSeenAt !== undefined ? data.lastSeenAt : n.lastSeenAt) ?? null
            }
          : n
      )
    );
  });

  const chartData = useMemo(
    () =>
      overview?.history.map((item) => ({
        ...item,
        label: formatDate(item.time)
      })) ?? [],
    [overview]
  );

  async function testNode(id: string) {
    if (!canTestNodes) return;
    setTestingNodeId(id);
    setError("");
    try {
      await api.testNode(token, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点测试失败");
    } finally {
      setTestingNodeId(null);
    }
  }

  const displayStats = useMemo(() => {
    if (overview) {
      const overviewResources = overview.resources;
      const hasOverviewResources =
        overviewResources.cpuUsage > 0 || overviewResources.memoryUsage > 0 || overviewResources.diskUsage > 0;
      const nodeResources = resourcesFromNodes(nodes);
      const hasNodeResources =
        nodeResources.cpuUsage > 0 || nodeResources.memoryUsage > 0 || nodeResources.diskUsage > 0;
      const nodeCounts =
        overview.nodes.total > 0
          ? overview.nodes
          : {
              online: nodes.filter((node) => node.status === "ONLINE").length,
              total: nodes.length
            };

      return {
        online: nodeCounts.online,
        total: nodeCounts.total,
        resources: hasOverviewResources || !hasNodeResources ? overviewResources : nodeResources
      };
    }

    if (nodes.length > 0) {
      return {
        online: nodes.filter((node) => node.status === "ONLINE").length,
        total: nodes.length,
        resources: resourcesFromNodes(nodes)
      };
    }

    return null;
  }, [nodes, overview]);

  const recentInstances = useMemo(() => {
    const visits = readRecentInstances();
    const visitRank = new Map(visits.map((entry, index) => [entry.id, index]));
    const openedAtById = new Map(visits.map((entry) => [entry.id, entry.openedAt]));
    const visited = instances
      .filter((instance) => visitRank.has(instance.id))
      .sort((left, right) => (visitRank.get(left.id) ?? 0) - (visitRank.get(right.id) ?? 0));
    const rest = instances
      .filter((instance) => !visitRank.has(instance.id))
      .sort((left, right) => {
        const leftTime = new Date(left.lastStartedAt || left.updatedAt).getTime();
        const rightTime = new Date(right.lastStartedAt || right.updatedAt).getTime();
        return rightTime - leftTime;
      });
    return [...visited, ...rest].slice(0, RECENT_INSTANCE_LIMIT).map((instance) => ({
      instance,
      openedAt: openedAtById.get(instance.id)
    }));
  }, [instances]);

  const resources = displayStats?.resources ?? { cpuUsage: 0, memoryUsage: 0, diskUsage: 0 };
  const nodeCountValue =
    loading && !displayStats ? "-" : `${displayStats?.online ?? 0}/${displayStats?.total ?? 0}`;
  const formatMetricValue = (value: number) => (loading && !displayStats ? "-" : formatNumber(value));

  // Stop Generation Handler
  const handleStopGeneration = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    const run = streamRunsRef.current.get(sessionId);
    if (run?.cancelRequested) return;
    if (run) run.cancelRequested = true;
    const taskId = run ? run.taskId : latestTasks.get(sessionId)?.id;
    if (taskId) { void cancelConversationTask(sessionId, taskId, run); return; }
    // Before Agent metadata arrives, keep the submission alive long enough to
    // obtain its ID and deliver this explicit cancellation to that task only.
    if (run?.mode === "chat") {
      run.controller.abort();
      finishStream(sessionId, run);
      publishSessionMessages(sessionId, (current) => current.map((message) => message.isStreaming ? { ...message, isStreaming: false, isThinking: false, workflowMessage: undefined } : message));
    }
  }, [latestTasks, cancelConversationTask, finishStream, publishSessionMessages]);

  // Handle Send Message with Real Backend Streaming
  const handleSendMessage = useCallback(
    async (textToSend?: string, historyOverride?: ChatMessage[], attachmentOverride?: SakiInputAttachment[]) => {
      const trimmedPrompt = (textToSend ?? promptText).trim();
      const currentAttachments = [...(attachmentOverride ?? attachments)];
      if ((!trimmedPrompt && currentAttachments.length === 0) || sessionLoadingRef.current || sessionLoading || Boolean(sessionLoadError) || workspaceSelectionBusy || isStreaming || (activeSessionId && streamRunsRef.current.has(activeSessionId)) || (actionBusyId && !historyOverride) || !(interactionMode === "agent" ? canUseAgent : canUseChat)) return;
      if (!canUseProjectMode(interactionMode)) {
        setError("已选工作区不可用或未授权，请重新选择工作区。");
        return;
      }

      const prompt = trimmedPrompt || (currentAttachments.length === 1 ? `查看附件：${currentAttachments[0]?.name}` : `查看已上传的 ${currentAttachments.length} 个附件`);

      const userMsgId = `u-${newClientId()}`;
      const assistantMsgId = `a-${newClientId()}`;
      const convId = activeSessionId ?? `s-${newClientId()}`;
      hydratedSessionIdsRef.current.add(convId);
      sessionRequestGenerationRef.current++;
      const sourceMessages = historyOverride ?? messages;
      const createdAt = new Date().toISOString();

      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: prompt,
        time: "刚刚", createdAt,
        ...(currentAttachments.length > 0 ? { attachments: currentAttachments } : {})
      };

      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        time: "刚刚", createdAt,
        isStreaming: true
      };

      setMessages([...sourceMessages, userMsg, assistantMsg]);
      setPromptText("");
      setAttachments([]);
      setMentionCaret(0);
      setMentionDismissedStart(null);
      setAddMenuOpen(false);
      selectSession(convId);
      const sessionTitle = prompt.length > 24 ? `${prompt.slice(0, 24)}...` : prompt;
      const initialSession: SessionItem = { id: convId, instanceId: activeInstanceId, workspaceInstanceIds: selectedWorkspaceIds, title: sessions.find((session) => session.id === convId)?.title ?? sessionTitle,
        category: interactionMode === "agent" ? "智能体运维" : "聊天问答", time: "刚刚", messages: [...sourceMessages, userMsg, assistantMsg] };
      setSessions((current) => [initialSession, ...current.filter((session) => session.id !== convId)]);
      const run = startStream(convId, interactionMode);
      const abortController = run.controller;
      const updateMessages = (update: (current: ChatMessage[]) => ChatMessage[]) => {
        if (!run.detached) publishSessionMessages(convId, update);
      };

      const persistLocal = (next: ChatMessage[]) => {
        const stored = readSakiConversations(userId);
        const previous = stored.find((session) => session.id === convId);
        writeSakiConversations([{ id: convId, contextKey: sakiWorkspaceContextKey(activeInstanceId, selectedWorkspaceIds),
          title: sessionTitle, label: interactionMode === "agent" ? "Agent" : "Chat", detail: currentModelDisplayName || "",
          instanceId: activeInstanceId, workspaceInstanceIds: selectedWorkspaceIds, createdAt: previous?.createdAt ?? createdAt, updatedAt: new Date().toISOString(),
          messages: next.map((message) => {
            const { attachments: msgAttachments, ...rest } = message;
            return {
              ...rest,
              thinking: rest.thinking ?? "",
              actions: rest.actions ?? [],
              timeline: rest.timeline ?? [],
              createdAt: rest.createdAt ?? createdAt,
              streaming: Boolean(rest.isStreaming),
              ...(msgAttachments && msgAttachments.length > 0 ? { attachments: msgAttachments } : {})
            };
          })
        }, ...stored.filter((session) => session.id !== convId)], userId);
      };
      persistLocal(initialSession.messages!);

      const historyPayload: SakiChatMessage[] = sourceMessages.filter((message) => !message.rollbackJournal).map((m) => ({
        role: m.role,
        content: m.content
      }));

      const { model: requestedModel, provider: requestedProvider } = parseSakiModelSelection(activeModelKey);

      const mentionedSkills = resolveSakiMentionedSkills(prompt, skills);
      const mentionedSkillIds = mentionedSkills.map((s) => s.id);

      const requestPayload: SakiChatRequest = {
        message: prompt,
        clientRequestId: newClientId(),
        conversationId: convId,
        userMessageId: userMsgId,
        assistantMessageId: assistantMsgId,
        mode: interactionMode,
        agentPermissionMode: agentPermission,
        instanceId: activeInstanceId, workspaceInstanceIds: selectedWorkspaceIds,
        terminalSandbox: true,
        model: requestedModel || null,
        provider: requestedProvider || null,
        reasoningEffort,
        history: historyPayload,
        ...(mentionedSkillIds.length > 0 ? { selectedSkillIds: mentionedSkillIds } : {}),
        ...(currentAttachments.length > 0 ? { attachments: currentAttachments } : {})
      };

      let finalContent = "";
      let finalThinking = "";
      let finalActions: SakiAgentAction[] = [];
      let finalTimeline: ChatMessage["timeline"] = [];
      let finalTaskId: string | undefined;
      let streamSettled = false;
      let thinkingSegmentStartedAt: number | undefined;
      let thinkingElapsedMs = 0;
      const finishThinking = () => {
        if (thinkingSegmentStartedAt !== undefined) {
          thinkingElapsedMs += Date.now() - thinkingSegmentStartedAt;
          thinkingSegmentStartedAt = undefined;
        }
        return finalThinking ? Math.max(1, Math.round(thinkingElapsedMs / 1000)) : undefined;
      };

      try {
        await api.sakiChatStream(
          token,
          requestPayload,
          (event: SakiChatStreamEvent) => {
            if (event.type === "meta" && event.taskId) {
              run.taskId = event.taskId;
              finalTaskId = event.taskId;
              persistLocal([...sourceMessages, userMsg, { ...assistantMsg, taskId: event.taskId }]);
              if (run.cancelRequested) { void cancelConversationTask(convId, event.taskId, run); return; }
              if (run.detached) { abortController.abort(); return; }
              window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
              updateMessages((current) => current.map((message) => message.id === assistantMsgId ? { ...message, taskId: event.taskId } : message));
              return;
            }
            if (run.detached || abortController.signal.aborted) return;
            finalTimeline = dashboardStreamTimeline(finalTimeline, event);
            const timeline = finalTimeline;
            updateMessages((current) => current.map((message) => message.id === assistantMsgId ? { ...message, timeline } : message));
            if (event.type === "delta") {
              const thinkingDurationSec = finishThinking();
              finalContent += event.text;
              updateMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId ? { ...msg, content: finalContent, isThinking: false, workflowMessage: undefined, thinkingDurationSec } : msg
                )
              );
            } else if (event.type === "thinking") {
              thinkingSegmentStartedAt ??= Date.now();
              finalThinking += event.text;
              updateMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId ? { ...msg, thinking: finalThinking, isThinking: true } : msg
                )
              );
            } else if (event.type === "action") {
              const thinkingDurationSec = finishThinking();
              const act = event.action;
              const existingIdx = finalActions.findIndex((a) => a.id === act.id);
              if (existingIdx >= 0) {
                finalActions[existingIdx] = act;
              } else {
                finalActions.push(act);
              }
              const updatedActions = [...finalActions];
              updateMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        actions: updatedActions,
                        isThinking: false,
                        thinkingDurationSec,
                        workflowMessage: undefined
                      }
                    : msg
                )
              );
            } else if (event.type === "workflow") {
              updateMessages((current) => current.map((message) => message.id === assistantMsgId
                ? { ...message, workflowMessage: event.stage === "narration" || event.status !== "running" ? undefined : event.message } : message));
            } else if (event.type === "done") {
              streamSettled = true;
              if (event.response.message) finalContent = event.response.message;
              if (event.response.thinking) finalThinking = event.response.thinking;
              if (event.response.actions) finalActions = event.response.actions;
              updateMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        content: finalContent,
                        thinking: finalThinking,
                        actions: finalActions,
                        thinkingDurationSec: finishThinking(),
                        isThinking: false,
                        isStreaming: false,
                        workflowMessage: undefined
                      }
                    : msg
                )
              );
            } else if (event.type === "error") {
              streamSettled = true;
              finalContent = finalContent
                ? `${finalContent}\n\n[异常: ${event.message}]`
                : `执行遇到错误: ${event.message}`;
              updateMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: finalContent, isStreaming: false, workflowMessage: undefined }
                    : msg
                )
              );
            }
          },
          abortController.signal
        );
      } catch (err: any) {
        if (!run.detached && !abortController.signal.aborted) {
          if (interactionMode === "agent" && finalTaskId) {
            // Recover from a transport interruption by observing the same task.
            // Never submit the user's message a second time.
            return;
          }
          const errMsg = err instanceof Error ? err.message : String(err || "连接异常");
          finalContent = finalContent ? `${finalContent}\n\n[连接中断: ${errMsg}]` : `请求失败: ${errMsg}`;
          finalTimeline = dashboardStreamTimeline(finalTimeline, { type: "error", message: errMsg });
          const timeline = finalTimeline;
          updateMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: finalContent, timeline, isStreaming: false }
                : msg
            )
          );
        }
      } finally {
        if (run.detached) return;
        if (interactionMode === "agent" && finalTaskId && !streamSettled && !run.cancelRequested) {
          finishStream(convId, run);
          return;
        }
        const thinkingDurationSec = finishThinking();
        finishStream(convId, run);

        updateMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, isStreaming: false, isThinking: false, thinkingDurationSec } : msg))
        );

        const completedMessages = [
          ...sourceMessages,
          userMsg,
          {
            ...assistantMsg,
            content: finalContent,
            thinking: finalThinking,
            thinkingDurationSec,
            actions: finalActions,
            timeline: finalTimeline,
            taskId: finalTaskId,
            isStreaming: false
          }
        ];

        const updatedSession: SessionItem = {
          id: convId,
          instanceId: activeInstanceId, workspaceInstanceIds: selectedWorkspaceIds,
          title: sessionTitle,
          category: interactionMode === "agent" ? "智能体运维" : "聊天问答",
          time: "刚刚",
          messages: completedMessages
        };

        setSessions((prev) => {
          const exists = prev.some((s) => s.id === convId);
          if (exists) {
            return prev.map((s) =>
              s.id === convId ? { ...s, time: "刚刚", messages: completedMessages } : s
            );
          }
          return [updatedSession, ...prev];
        });

        try {
          if (interactionMode === "chat" && !abortController.signal.aborted) {
            const saved = await api.sakiSaveConversation(token, {
              id: convId,
              title: sessionTitle,
              label: "Chat",
              detail: currentModelDisplayName || requestedModel || undefined,
              instanceId: activeInstanceId, workspaceInstanceIds: selectedWorkspaceIds,
              contextKey: sakiWorkspaceContextKey(activeInstanceId, selectedWorkspaceIds),
              baseUpdatedAt: historyVersionsRef.current.get(convId) ?? sessions.find((session) => session.id === convId)?.updatedAt,
              messages: completedMessages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                thinking: m.thinking ?? "",
                thinkingDurationSec: m.thinkingDurationSec,
                actions: m.actions ?? [],
                timeline: m.timeline,
                timelineEvents: m.timelineEvents,
                taskId: m.taskId,
                rollbackJournal: m.rollbackJournal,
                attachments: m.attachments,
                createdAt: m.createdAt ?? createdAt
              }))
            });
            historyVersionsRef.current.set(convId, saved.updatedAt);
            setSessions((current) => current.map((session) => session.id === convId ? { ...session, updatedAt: saved.updatedAt } : session));
          }
        } catch {
          // ignore
        }

        persistLocal(completedMessages);
      }
    },
    [
      activeModelKey,
      reasoningEffort,
      activeSessionId,
      activeInstanceId,
      workspaceInstanceIds,
      workspaceSelectionBusy,
      authorizedProjects,
      selectedProject,
      actionBusyId,
      canUseAgent,
      canUseChat,
      agentPermission,
      currentModelDisplayName,
      interactionMode,
      isStreaming,
      sessionLoading,
      sessionLoadError,
      messages,
      promptText,
      attachments,
      token,
      userId,
      sessions,
      startStream, finishStream, publishSessionMessages, cancelConversationTask
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMenuOpen && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((current) => (current + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (
        (e.key === "Enter" || e.key === "Tab") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.nativeEvent.isComposing
      ) {
        const selected = mentionCandidates[mentionIndex] ?? mentionCandidates[0];
        if (selected) {
          e.preventDefault();
          handleApplyMention(selected);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissedStart(activeSakiMentionQuery(promptText, mentionCaret)?.start ?? null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleNewChat = () => {
    if (actionBusyId || workspaceSelectionBusy) return;
    sessionLoadingRef.current = false;
    setSessionLoading(false);
    setSessionLoadError(null);
    selectSession(null);
    setMessages([]);
    setSelectedTool(null);
    setPromptText("");
    setAttachments([]);
    setMentionCaret(0);
    setMentionDismissedStart(null);
    setAddMenuOpen(false);
    setViewMode("workspace");
    setGreetingSentence(getGreetingSentence());
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
      setSidebarCollapsed(true);
    }
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleSelectSession = (sessionId: string) => {
    if (actionBusyId || workspaceSelectionBusy) return;
    selectSession(sessionId);
    setSelectedTool(null);
    setViewMode("workspace");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
      setSidebarCollapsed(true);
    }
    const found = sessions.find((s) => s.id === sessionId);
    setActiveInstanceId(found?.instanceId ?? null);
    setWorkspaceInstanceIds(normalizeSakiWorkspaceIds(found?.instanceId, found?.workspaceInstanceIds));

    sessionLoadingRef.current = true;
    setSessionLoading(true);
    setSessionLoadError(null);
    setMessages([]);
    if (activeSessionId === sessionId) void loadSessionDetail(sessionId);

  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const task = latestTasks.get(id);
    if (isSessionRunning(id) || task && dashboardTaskIsPending(task)) return;
    try {
      await api.sakiDeleteConversation(token, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除会话失败");
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    const stored = readSakiConversations(userId);
    writeSakiConversations(stored.filter((s) => s.id !== id), userId);
    if (activeSessionId === id) {
      handleNewChat();
    }
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    return sessions.filter((s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, sessions]);

  async function prepareMessageHistoryWrite() {
    if (localHistoryOnlyRef.current) return { localOnly: true, baseUpdatedAt: undefined as string | undefined };
    if (!activeSessionId) return { localOnly: false, baseUpdatedAt: undefined };
    let remote: SakiSavedConversation | null = null;
    try {
      remote = await api.sakiGetConversation(token, activeSessionId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        remote = null;
      } else {
        throw err;
      }
    }
    if (remote && !dashboardHistoryMatches(remote.messages, messages)) throw new Error("对话已在其他设备更新，请重新打开后再操作。");
    if (!remote && sessions.find((session) => session.id === activeSessionId)?.updatedAt) throw new Error("对话已被删除，请重新打开历史记录。");
    return { localOnly: false, baseUpdatedAt: remote?.updatedAt };
  }

  function storeMessageHistory(next: ChatMessage[], updatedAt = new Date().toISOString()) {
    if (!activeSessionId) return;
    const cached = readSakiConversations(userId);
    const previous = cached.find((conversation) => conversation.id === activeSessionId);
    const title = next.find((message) => message.role === "user")?.content.slice(0, 24) || "新对话";
    const conversation = {
      id: activeSessionId, contextKey: sakiWorkspaceContextKey(activeInstanceId, selectedWorkspaceIds), title,
      label: previous?.label ?? (interactionMode === "agent" ? "Agent" : "Chat"), detail: previous?.detail ?? "",
      instanceId: activeInstanceId, workspaceInstanceIds: selectedWorkspaceIds, createdAt: previous?.createdAt ?? updatedAt, updatedAt,
      messages: next.map((message) => ({ id: message.id, role: message.role, content: message.content,
        thinking: message.thinking ?? "", thinkingDurationSec: message.thinkingDurationSec, actions: message.actions ?? [], timeline: message.timeline ?? [], timelineBase: message.timelineBase,
        taskId: message.taskId, rollbackJournal: message.rollbackJournal,
        ...(message.attachments ? { attachments: message.attachments } : {}), createdAt: message.createdAt ?? updatedAt }))
    };
    writeSakiConversations([conversation, ...cached.filter((item) => item.id !== activeSessionId)], userId);
    setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, title, messages: next, updatedAt, time: "刚刚" } : session));
    setMessages(next);
    return conversation;
  }

  async function saveMessageHistory(next: ChatMessage[], write: Awaited<ReturnType<typeof prepareMessageHistoryWrite>>) {
    if (!activeSessionId) throw new Error("当前对话尚未保存。");
    let updatedAt = new Date().toISOString();
    if (!write.localOnly) {
      const saved = await api.sakiSaveConversation(token, {
        id: activeSessionId, instanceId: activeInstanceId, workspaceInstanceIds: selectedWorkspaceIds, contextKey: sakiWorkspaceContextKey(activeInstanceId, selectedWorkspaceIds),
        title: next.find((message) => message.role === "user")?.content.slice(0, 24) || "新对话",
        baseUpdatedAt: write.baseUpdatedAt,
        messages: next.map((message) => ({ ...message, createdAt: message.createdAt ?? updatedAt, streaming: false }))
      });
      updatedAt = saved.updatedAt;
      historyVersionsRef.current.set(activeSessionId, updatedAt);
    }
    storeMessageHistory(next, updatedAt);
  }

  async function handleMessageOperation(messageId: string, operation: DashboardMessageOperation) {
    const target = messages.find((message) => message.id === messageId);
    if (!target) return;
    if (operation === "copy") {
      try {
        const content = target.role === "assistant" ? parseThinkingContent(target.content, target.thinking).answer : target.content;
        await navigator.clipboard.writeText(content);
        setCopiedMessageId(messageId);
      } catch { setError("复制失败，请手动选择复制。"); }
      return;
    }
    if (messageMutationRef.current || isStreaming || actionBusyId) return;
    messageMutationRef.current = true;
    setError("");
    setActionBusyId(`message:${messageId}`);
    let working = messages;
    let changedActions = false;
    let resend: { content: string; history: ChatMessage[]; attachments: SakiInputAttachment[] } | undefined;
    try {
      const write = await prepareMessageHistoryWrite();
      const turn = dashboardTurnRange(messages, messageId)!;
      const editUser = typeof operation === "object" && target.role === "user";
      const undoIndex = turn.start;
      const affected = operation === "undo" || operation === "rollback_files" || editUser ? messages.slice(undoIndex)
        : operation === "delete" ? messages.slice(turn.start, turn.end) : [target];
      if ((operation === "undo" || operation === "rollback_files" || editUser) && dashboardHasUntrackedTerminalChanges(affected)) {
        throw new Error("这段对话包含没有文件检查点的终端调用，无法自动恢复其代码改动。请先手动恢复文件；新版本的终端调用会记录工作区文件检查点。");
      }
      // Discard pending approvals without resuming their Agent run.
      const pendingMessages = affected.filter((message) => visibleSakiActions(message.actions).some((action) => action.status === "pending_approval" || action.status === "pending_input"));
      for (const pendingMessage of pendingMessages) {
        let taskId = pendingMessage.taskId;
        if (!taskId) {
          const active = await api.sakiGetActiveTasks(token);
          taskId = active.tasks.find((task) => task.conversationId === activeSessionId && task.assistantMessageId === pendingMessage.id)?.id;
        }
        if (!taskId) throw new Error("无法确认待处理任务已停止，请先在任务列表停止该任务。");
        await api.sakiCancelTask(token, taskId);
        for (const action of visibleSakiActions(pendingMessage.actions).filter((item) => item.status === "pending_approval" || item.status === "pending_input")) {
          working = dashboardRecordAction(working, { ...action, status: "rejected", ok: false, observation: "已随对话操作取消。" });
        }
        changedActions = true;
      }
      if (operation === "undo" || operation === "rollback_files" || editUser) {
        const rollbackActions = dashboardRollbackActions(working.slice(undoIndex)).filter((action) => operation !== "rollback_files" || dashboardIsCodeChange(action));
        let restored = 0;
        for (const action of rollbackActions) {
          const result = await api.sakiAction(token, action.id, "rollback", { instanceId: activeInstanceId });
          working = dashboardRecordAction(working, result.action);
          changedActions = true;
          restored++;
        }
        const next = operation === "rollback_files" ? working : working.slice(0, undoIndex);
        await saveMessageHistory(next, write);
        if (editUser && typeof operation === "object") resend = { content: operation.edit, history: next, attachments: target.attachments ?? [] };
        else if (operation === "rollback_files") setMessageNotice(restored ? `已撤回 ${restored} 次代码更改，对话记录已保留。` : "此处没有可撤回的代码更改。");
        else {
          setPromptText(messages[turn.start]?.role === "user" ? messages[turn.start]!.content : "");
          setAttachments(messages[turn.start]?.attachments ?? []);
          setMessageNotice(restored ? `已撤回到此处，并还原 ${restored} 次修改。` : "已撤回对话到此处；此处没有可回滚的文件检查点。");
          textareaRef.current?.focus();
        }
      } else if (operation === "delete") {
        await saveMessageHistory(dashboardDeleteTurn(working, turn), write);
        setMessageNotice("已删除这轮对话记录，文件改动已保留。");
      } else {
        await saveMessageHistory(working.map((message) => message.id === messageId ? { ...message, content: operation.edit, timeline: undefined, timelineEvents: undefined } : message), write);
        setMessageNotice("对话已修改。");
      }
      setSelectedTool(null); setTerminalPanelOpen(false);
    } catch (error) {
      // A failed rollback must keep the conversation and successful rollback
      // states, so retrying cannot replay already restored checkpoints.
      if (changedActions) storeMessageHistory(working);
      setError(`操作未完成，对话记录已保留：${error instanceof Error ? error.message : "请重试"}`);
      throw error;
    } finally {
      if (changedActions) {
        window.dispatchEvent(new CustomEvent("saki:files_modified"));
        window.dispatchEvent(new CustomEvent("workspace:refresh"));
      }
      messageMutationRef.current = false;
      setActionBusyId(null);
    }
    if (resend) await handleSendMessage(resend.content, resend.history, resend.attachments);
  }

  async function decideAction(messageId: string, action: SakiAgentAction, decision: "approve" | "reject" | "rollback" | { selection?: string; customText?: string; skipped?: boolean }) {
    if (actionBusyId || isStreaming) return;
    const sessionId = activeSessionId;
    if (!sessionId) return;
    const current = visibleSakiActions(messages.find((message) => message.id === messageId)?.actions).find((item) => item.id === action.id);
    if (!current || (decision === "approve" || decision === "reject") && current.status !== "pending_approval") return;
    setActionBusyId(action.id);
    const generation = runtimeGenerationRef.current;
    let streamController: AbortController | undefined;
    let streamRun: DashboardStreamRun | undefined;
    try {
      const result: SakiActionDecisionResponse = typeof decision === "string"
        ? await api.sakiAction(token, action.id, decision)
        : await api.sakiAnswerQuestion(token, action.id, decision);
      if (generation !== runtimeGenerationRef.current) {
        window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
        return;
      }
      let updated = messages.map((message) => message.id === messageId ? {
        ...message,
        content: result.response?.message ?? message.content,
        thinking: result.response?.thinking ?? message.thinking ?? "",
        actions: [...new Map([...(message.actions ?? []), ...(result.response?.actions ?? []), result.action].map((item) => [item.id, item])).values()]
      } : message);
      updated = updated.map((message) => message.id === messageId && message.timeline?.length ? {
        ...message, timeline: result.response
          ? dashboardStreamTimeline(dashboardStreamTimeline(message.timeline, { type: "action", action: result.action }), { type: "done", response: result.response })
          : dashboardStreamTimeline(message.timeline, { type: "action", action: result.action })
      } : message);
      const publish = (patch?: Partial<ChatMessage>) => {
        if (patch) updated = updated.map((message) => message.id === messageId ? { ...message, ...patch } : message);
        const target = updated.find((message) => message.id === messageId);
        if (!streamRun?.detached) publishSessionMessages(sessionId, (current) => current.map((message) => message.id === messageId && target ? target : message));
      };
      publish();
      if (result.taskId) {
        streamRun = startStream(sessionId, "agent", result.taskId);
        streamController = streamRun.controller;
        const controller = streamController;
        window.dispatchEvent(new CustomEvent("saki:active_task_updated"));
        setActionBusyId(null);
        let content = "";
        let thinking = "";
        let actions = updated.find((message) => message.id === messageId)?.actions ?? [];
        const timelineBase = updated.find((message) => message.id === messageId)?.timeline ?? [];
        let timeline: ChatMessage["timeline"] = timelineBase;
        publish({ taskId: result.taskId, timelineBase, isStreaming: true, workflowMessage: "指令已执行，正在继续任务…" });
        try {
          await api.sakiStreamTaskReconnect(token, result.taskId, (event) => {
            if (streamRun?.detached || controller.signal.aborted) return;
            if (event.type !== "meta") timeline = dashboardStreamTimeline(timeline, event);
            publish({ timeline });
            if (event.type === "delta") {
              content += event.text;
              publish({ content, isThinking: false, workflowMessage: undefined });
            } else if (event.type === "thinking") {
              thinking += event.text;
              publish({ thinking, isThinking: true });
            } else if (event.type === "action") {
              actions = [...new Map([...actions, event.action].map((item) => [item.id, item])).values()];
              publish({ actions, isThinking: false, workflowMessage: undefined });
            } else if (event.type === "workflow") {
              publish({ workflowMessage: event.stage === "narration" || event.status !== "running" ? undefined : event.message });
            } else if (event.type === "done") {
              publish({ content: event.response.message, thinking: event.response.thinking ?? thinking,
                actions: event.response.actions ?? actions, isStreaming: false, isThinking: false, workflowMessage: undefined });
            } else if (event.type === "error") {
              setError(event.message);
              publish({ isStreaming: false, isThinking: false, workflowMessage: undefined });
            }
          }, controller.signal);
        } finally {
          if (!streamRun.detached) {
            finishStream(sessionId, streamRun);
            publish({ isStreaming: false, isThinking: false, workflowMessage: undefined });
          }
        }
      }
      if (streamRun?.detached) return;
      const cached = readSakiConversations(userId);
      writeSakiConversations(cached.map((conversation) => conversation.id === activeSessionId ? {
        ...conversation, updatedAt: new Date().toISOString(), messages: conversation.messages.map((message) => {
          const latest = updated.find((item) => item.id === message.id);
          return latest ? { ...message, content: latest.content, thinking: latest.thinking ?? "", actions: latest.actions ?? [], timeline: latest.timeline ?? [], timelineBase: latest.timelineBase } : message;
        })
      } : conversation), userId);
    } catch (err) {
      if (!streamController?.signal.aborted) setError(err instanceof Error ? err.message : "处理审批失败");
    } finally { setActionBusyId((current) => current === action.id ? null : current); }
  }

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      {messageNotice ? <div role="status" className="dashboard-message-notice">{messageNotice}</div> : null}

      <div className="dashboard-root">
        {/* Mobile backdrop for sidebar drawer */}
        {!sidebarCollapsed && (
          <div
            className="dashboard-sidebar-mobile-backdrop"
            aria-hidden="true"
            onClick={() => setSidebarCollapsed(true)}
          />
        )}

        {/* Left Sidebar: Conversation History & Projects */}
        <aside className={`dashboard-sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}>
          <div className="dashboard-sidebar-header">
            <div className="dashboard-sidebar-brand">
              <span className="dashboard-sidebar-brand-icon">
                <Terminal size={16} />
              </span>
              <span>Saki Assistant</span>
            </div>
            <button
              className="dashboard-icon-btn"
              type="button"
              title="折叠侧栏"
              aria-label="折叠侧栏"
              onClick={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          <button className="dashboard-new-chat-btn" type="button" onClick={handleNewChat}>
            <Plus size={14} />
            <span>新建对话</span>
          </button>

          <div className="dashboard-sidebar-search">
            <Search size={12} />
            <input
              className="dashboard-sidebar-search-input"
              type="text"
              placeholder="搜索项目或记录..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="dashboard-sidebar-scroll">
            <div className="dashboard-sidebar-group">
              <div className="dashboard-sidebar-group-title">
                <span>项目与实例</span>
                <Folder size={11} />
              </div>

              <button
                className={`dashboard-sidebar-item ${!activeInstanceId ? "is-active" : ""}`}
                type="button"
                onClick={() => {
                  selectWorkspace(null);
                  setViewMode("workspace");
                }}
              >
                <div className="dashboard-sidebar-item-content">
                  <span className="dashboard-status-dot online" />
                  <span className="dashboard-sidebar-item-title">无项目</span>
                </div>
              </button>

              {agentProjects.slice(0, 10).map((inst) => {
                const isServer = inst.id.startsWith("node:");
                return (
                  <button
                    key={inst.id}
                    className={`dashboard-sidebar-item ${activeInstanceId === inst.id ? "is-active" : ""}`}
                    type="button"
                    onClick={() => {
                      selectWorkspace(inst.id);
                      setViewMode("workspace");
                    }}
                    title={isServer ? `远程 SSH 服务器: ${inst.name}` : `托管实例: ${inst.name}`}
                  >
                    <div className="dashboard-sidebar-item-content">
                      <span className={`dashboard-status-dot ${inst.status === "RUNNING" ? "online" : "offline"}`} />
                      <span className="dashboard-sidebar-item-title">{inst.name}</span>
                      {isServer && (
                        <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "4px", background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", marginLeft: "auto", flexShrink: 0 }}>
                          SSH
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="dashboard-sidebar-group">
              <div className="dashboard-sidebar-group-title">
                <span>历史会话</span>
                <SlidersHorizontal size={11} />
              </div>

              {filteredSessions.map((session) => (
                <div key={session.id} className="dashboard-sidebar-conversation">
                  <button
                    className={`dashboard-sidebar-item ${activeSessionId === session.id ? "is-active" : ""}`}
                    type="button"
                    onClick={() => handleSelectSession(session.id)}
                  >
                    <div className="dashboard-sidebar-item-content">
                      <span className="dashboard-sidebar-item-title" title={session.title}>
                        {session.title}
                      </span>
                    </div>
                    {isSessionRunning(session.id) ? <span className="dashboard-session-running" role="status" aria-label="任务运行中" title="任务正在后台运行">
                      <Loader2 size={13} aria-hidden="true" />
                    </span> : latestTasks.get(session.id)?.status === "pending_approval" || latestTasks.get(session.id)?.status === "pending_input" ?
                      <span className="dashboard-session-waiting" role="status" aria-label="任务等待处理" title="任务等待审批或回答"><Activity size={13} aria-hidden="true" /></span> : null}
                  </button>
                  <div className="dashboard-sidebar-item-actions">
                    <button
                      className="dashboard-sidebar-item-delete"
                      type="button"
                      title="删除记录"
                      disabled={isSessionRunning(session.id) || Boolean(latestTasks.get(session.id) && dashboardTaskIsPending(latestTasks.get(session.id)!))}
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="dashboard-sidebar-footer">
            <span>Daemon 集群已连接</span>
            <span className="dashboard-status-dot online" />
          </div>
        </aside>

        {/* Right Main Workspace */}
        <main className="dashboard-workspace">
          {/* Top Unified Navigation Bar - Borderless Cupertino / Saki */}
          <div className="dashboard-workspace-topbar">
            <div className="dashboard-topbar-left">
              <div className={`dashboard-topbar-navigation ${!sidebarCollapsed ? "is-hidden" : ""}`}>
              {/* Sleek Ghost Sidebar Toggle Button */}
              <button
                className="dashboard-nav-toggle-btn"
                type="button"
                title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
                aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>

              {/* New Chat Button right beside the sidebar expand button */}
              <button
                className="dashboard-nav-toggle-btn dashboard-nav-new-chat-btn"
                type="button"
                title="新建对话"
                aria-label="新建对话"
                onClick={handleNewChat}
              >
                <SquarePen size={15} />
              </button>
              </div>

              {/* During active chat sessions, keep the instance/page breadcrumb selector in topbar */}
              {messages.some((message) => !message.rollbackJournal) && (
                <div className="dashboard-topbar-breadcrumb">
                  <div className="dashboard-project-selector-wrapper" ref={topbarDropdownRef}>
                    <button
                      className="dashboard-project-selector-btn"
                      type="button"
                      onClick={() => setTopbarDropdownOpen(!topbarDropdownOpen)}
                    >
                      {activeInstanceId ? (
                        activeInstanceId.startsWith("node:") ? (
                          <Server size={14} className="dashboard-project-icon" style={{ color: "#38bdf8" }} />
                        ) : (
                          <Server size={14} className="dashboard-project-icon is-instance" />
                        )
                      ) : (
                        <Folder size={14} className="dashboard-project-icon" />
                      )}
                      <span className="dashboard-project-name" title={workspaceNames}>
                        {workspaceLabel}
                      </span>
                      <ChevronDown size={12} className={`dashboard-project-arrow ${topbarDropdownOpen ? "is-open" : ""}`} />
                    </button>

                    {topbarDropdownOpen && renderInstanceAndPagePopover(() => setTopbarDropdownOpen(false), topbarDropdownRef)}
                  </div>

                  <span className="dashboard-context-slash" aria-hidden="true">/</span>

                  <div className="dashboard-project-selector-wrapper" ref={worktreeShelfRef}>
                    <button
                      className="dashboard-project-selector-btn"
                      type="button"
                      onClick={() => setWorktreeShelfOpen(!worktreeShelfOpen)}
                    >
                      {activeEnvironment === "local" ? (
                        <Monitor size={13} className="dashboard-context-icon-teal" />
                      ) : (
                        <GitBranch size={13} className="dashboard-context-icon-purple" />
                      )}
                      <span className="dashboard-project-name" title={workspaceNames}>
                        {activeEnvironment === "local" ? "Local" : "New Worktree"}
                      </span>
                      <ChevronDown size={11} className={`dashboard-project-arrow ${worktreeShelfOpen ? "is-open" : ""}`} />
                    </button>

                    {worktreeShelfOpen && renderEnvironmentPopover(() => setWorktreeShelfOpen(false))}
                  </div>
                </div>
              )}
            </div>

            <div className="dashboard-topbar-right">
              <button className="dashboard-icon-btn" type="button" title="打开终端详情" aria-label="打开终端详情"
                onClick={() => setTerminalPanelOpen((open) => !open)}><Terminal size={16} /></button>
              <div className="dashboard-pill-switcher" role="tablist">
                <button
                  className={`dashboard-pill-btn ${viewMode === "workspace" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setViewMode("workspace")}
                >
                  工作区
                </button>
                <button
                  className={`dashboard-pill-btn ${viewMode === "metrics" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setViewMode("metrics")}
                >
                  完整大盘
                </button>
              </div>
              <button
                className="dashboard-icon-btn"
                type="button"
                title="刷新数据"
                aria-label="刷新数据"
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} />
              </button>
              <button
                className="dashboard-icon-btn"
                type="button"
                title="系统体征详情"
                aria-label="系统体征详情"
                onClick={() => setMetricDetail("nodes")}
              >
                <Activity size={16} />
              </button>
            </div>
          </div>

          {/* View Body */}
          {viewMode === "metrics" ? (
            /* Traditional Full Metrics View */
            <div className="dashboard-full-metrics-view">
              <section className="metrics-grid">
                <MetricTile
                  icon={<Server size={22} />}
                  label="在线节点"
                  value={nodeCountValue}
                  tone="teal"
                  onClick={() => setMetricDetail("nodes")}
                />
                <MetricTile
                  icon={<Cpu size={22} />}
                  label="CPU"
                  value={formatMetricValue(resources.cpuUsage)}
                  gaugeValue={resources.cpuUsage}
                  tone="blue"
                  onClick={() => setMetricDetail("cpu")}
                />
                <MetricTile
                  icon={<MemoryStick size={22} />}
                  label="内存"
                  value={formatMetricValue(resources.memoryUsage)}
                  gaugeValue={resources.memoryUsage}
                  tone="amber"
                  onClick={() => setMetricDetail("memory")}
                />
                <MetricTile
                  icon={<HardDrive size={22} />}
                  label="磁盘"
                  value={formatMetricValue(resources.diskUsage)}
                  gaugeValue={resources.diskUsage}
                  tone="gray"
                  onClick={() => setMetricDetail("disk")}
                />
              </section>

              <section className="content-grid">
                <div className="panel-block chart-block">
                  <div className="section-heading">
                    <h2>资源曲线</h2>
                    <span>{overview ? formatDate(overview.generatedAt) : "-"}</span>
                  </div>
                  <div className="chart-frame">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e8" />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#687786" />
                        <YAxis tick={{ fontSize: 12 }} stroke="#687786" width={34} />
                        <Tooltip />
                        <Line type="monotone" dataKey="cpuUsage" name="CPU" stroke="#2563eb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="memoryUsage" name="内存" stroke="#d97706" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="diskUsage" name="磁盘" stroke="#0f766e" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="panel-block recent-instances-block">
                  <div className="section-heading">
                    <h2>最近实例</h2>
                    {canViewInstances ? (
                      <button className="recent-instances-all" type="button" onClick={() => onOpenInstance(null)}>
                        <span>查看全部</span>
                        <ArrowRight size={14} />
                      </button>
                    ) : null}
                  </div>
                  <div className="recent-instance-list">
                    {recentInstances.map(({ instance, openedAt }) => {
                      const meta = instanceStatusMeta(instance.status);
                      const activityAt = instanceActivityAt(instance, openedAt);
                      return (
                        <button
                          className={`recent-instance-row ${meta.className}`}
                          key={instance.id}
                          type="button"
                          onClick={() => onOpenInstance(instance.id)}
                          title={`进入 ${instance.name}`}
                        >
                          <span className={`recent-instance-icon ${meta.className}`} aria-hidden="true">
                            <InstanceStatusIcon status={instance.status} size={18} />
                          </span>
                          <span className="recent-instance-copy">
                            <strong>{instance.name}</strong>
                            <small>
                              {instanceTypeLabel(instance.type)}
                              <span className="recent-instance-dot" aria-hidden="true">
                                ·
                              </span>
                              {instance.nodeName || instance.nodeId}
                            </small>
                          </span>
                          <span className="recent-instance-meta">
                            <InstanceStatusBadge status={instance.status} compact />
                            <time dateTime={activityAt} title={formatDate(activityAt)}>
                              {formatRelativeTime(activityAt, language)}
                            </time>
                          </span>
                          <ChevronRight className="recent-instance-chevron" size={16} aria-hidden="true" />
                        </button>
                      );
                    })}
                    {!loading && recentInstances.length === 0 ? (
                      <SakiEmptyState
                        illustration="instances"
                        title={canViewInstances ? "暂无实例" : "暂无实例权限"}
                        description={
                          canViewInstances
                            ? "创建或打开实例后，最近使用的会显示在这里"
                            : "当前账号没有实例查看权限"
                        }
                        compact
                      />
                    ) : null}
                  </div>
                </div>
              </section>

              {canViewNodes ? (
                <section className="panel-block nodes-block dashboard-nodes-block">
                  <div className="section-heading">
                    <h2>节点</h2>
                    <span>{nodes.length} 台</span>
                  </div>
                  <div className="table-wrap">
                    <table className="dashboard-nodes-table">
                      <thead>
                        <tr>
                          <th>名称</th>
                          <th>地址</th>
                          <th>状态</th>
                          <th>系统</th>
                          <th>资源</th>
                          <th>心跳</th>
                          {canTestNodes ? <th></th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.map((node) => (
                          <tr key={node.id}>
                            <td>
                              <strong>{node.name}</strong>
                            </td>
                            <td>{`${node.protocol}://${node.host}:${node.port}`}</td>
                            <td>
                              <NodeStatusPill
                                status={node.status}
                                onClick={canTestNodes ? () => void testNode(node.id) : undefined}
                                loading={testingNodeId === node.id}
                                disabled={testingNodeId === node.id}
                              />
                            </td>
                            <td>{[node.os, node.arch].filter(Boolean).join(" / ") || "-"}</td>
                            <td>
                              {node.latestMetric
                                ? `${formatNumber(node.latestMetric.cpuUsage)} / ${formatNumber(node.latestMetric.memoryUsage)}`
                                : "-"}
                            </td>
                            <td>{formatDate(node.lastSeenAt)}</td>
                            {canTestNodes ? (
                              <td>
                                <button
                                  className="icon-button mini"
                                  title="测试连接"
                                  aria-label="测试连接"
                                  type="button"
                                  onClick={() => void testNode(node.id)}
                                  disabled={testingNodeId === node.id}
                                >
                                  <Wifi size={14} />
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            /* Dashboard Workspace View - Single Screen Fit, Real Liquid Glass Refraction */
            <div className="dashboard-workspace-body">
              {!activeSessionId && !messages.some((message) => !message.rollbackJournal) ? (
                <div className="dashboard-empty-container">
                  {/* Single Clean Greeting Sentence (No emojis, no extra elements) */}
                  <div className="dashboard-greeting-sentence">
                    {greetingSentence}
                  </div>

                  {/* Unified Floating Context Breadcrumb directly above Liquid Glass Input */}
                  <div className="dashboard-input-context-row">
                    <div className="dashboard-project-selector-wrapper" ref={contextDropdownRef}>
                      <button
                        className="dashboard-project-selector-btn dashboard-hero-context-btn"
                        type="button"
                        onClick={() => setContextDropdownOpen(!contextDropdownOpen)}
                      >
                        {activeInstanceId ? (
                          activeInstanceId.startsWith("node:") ? (
                            <Server size={14} className="dashboard-project-icon" style={{ color: "#38bdf8" }} />
                          ) : (
                            <Server size={14} className="dashboard-project-icon is-instance" />
                          )
                        ) : (
                          <Folder size={14} className="dashboard-project-icon" />
                        )}
                        <span className="dashboard-project-name" title={workspaceNames}>
                          {workspaceLabel}
                        </span>
                        <ChevronDown size={12} className={`dashboard-project-arrow ${contextDropdownOpen ? "is-open" : ""}`} />
                      </button>

                      {contextDropdownOpen && renderInstanceAndPagePopover(() => setContextDropdownOpen(false), contextDropdownRef)}
                    </div>

                    <span className="dashboard-context-slash" aria-hidden="true">/</span>

                    <div className="dashboard-project-selector-wrapper" ref={worktreeShelfRef}>
                      <button
                        className="dashboard-project-selector-btn dashboard-hero-context-btn"
                        type="button"
                        onClick={() => setWorktreeShelfOpen(!worktreeShelfOpen)}
                      >
                        {activeEnvironment === "local" ? (
                          <Monitor size={13} className="dashboard-context-icon-teal" />
                        ) : (
                          <GitBranch size={13} className="dashboard-context-icon-purple" />
                        )}
                        <span className="dashboard-project-name" title={workspaceNames}>
                          {activeEnvironment === "local" ? "Local" : "New Worktree"}
                        </span>
                        <ChevronDown size={11} className={`dashboard-project-arrow ${worktreeShelfOpen ? "is-open" : ""}`} />
                      </button>

                      {worktreeShelfOpen && renderEnvironmentPopover(() => setWorktreeShelfOpen(false))}
                    </div>
                  </div>

                  {/* Refractive Liquid Glass Input Bar (Real Shader Refraction Lens) */}
                  <div
                    ref={heroInputWrapperRef}
                    className={`dashboard-liquid-input-wrapper ${mentionMenuOpen ? "has-mention-open" : ""}`}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {mentionMenuOpen && (
                      <SakiMentionMenu
                        candidates={mentionCandidates}
                        activeIndex={mentionIndex}
                        onHover={setMentionIndex}
                        onSelect={handleApplyMention}
                        anchorRef={heroInputWrapperRef}
                        variant="dashboard"
                      />
                    )}
                    <LiquidGlassContainer
                      className={`saki-input-container liquid-glass-container dashboard-liquid-input ${isDragOver ? "is-drag-over" : ""}`}
                      displacementScale={100}
                      zoom={1.20}
                      refractionIntensity={1.2}
                      blurAmount={0}
                      saturation={108}
                      cornerRadius={24}
                      mode="shader"
                    >
                      {/* Drag & drop overlay hint */}
                      {isDragOver && (
                        <div className="dashboard-input-drop-overlay">
                          <Upload size={20} className="dashboard-drop-overlay-icon" />
                          <span>松开鼠标添加图片或文件</span>
                        </div>
                      )}

                      {/* Attachment Tray */}
                      {attachments.length > 0 && (
                        <div className="dashboard-attachment-tray saki-attachment-tray">
                          {attachments.map((attachment, index) => (
                            <SakiAttachmentChip
                              attachment={attachment}
                              key={attachment.id ?? `${attachment.name}-${index}`}
                              removable
                              onClick={() => setPreviewingAttachment({ attachment, editable: true })}
                              onRemove={() => setAttachments((curr) => curr.filter((a) => a !== attachment))}
                            />
                          ))}
                        </div>
                      )}

                      <div className="dashboard-input-main-row">
                        <textarea
                          ref={textareaRef}
                          className="dashboard-input-textarea"
                          rows={1}
                          placeholder={
                            attachments.length > 0 || skills.length > 0
                              ? "输入 @ 引用文件或 Skill，或直接下达运维指令..."
                              : interactionMode === "agent"
                              ? `输入 Agent 自动化运维指令 (${activePermission.label})...`
                              : "向 AI 咨询集群架构、配置或运维知识 (问答聊天模式)..."
                          }
                          value={promptText}
                          onChange={(e) => {
                            setPromptText(e.target.value);
                            setMentionDismissedStart(null);
                            handleSyncMentionCaret(e.currentTarget);
                          }}
                          onClick={(e) => handleSyncMentionCaret(e.currentTarget)}
                          onSelect={(e) => handleSyncMentionCaret(e.currentTarget)}
                          onKeyUp={(e) => handleSyncMentionCaret(e.currentTarget)}
                          onFocus={(e) => handleSyncMentionCaret(e.currentTarget)}
                          onBlur={() => {
                            const active = activeSakiMentionQuery(promptText, mentionCaret);
                            if (active) setMentionDismissedStart(active.start);
                          }}
                          onKeyDown={handleKeyDown}
                          onPaste={handlePaste}
                        />
                      </div>

                      <div className="dashboard-input-toolbar">
                        <div className="dashboard-toolbar-left">
                          <button
                            ref={heroAddBtnRef}
                            className={`dashboard-glass-action-btn ${addMenuOpen && activeAddAnchorRef.current === heroAddBtnRef.current ? "is-active" : ""}`}
                            type="button"
                            title="上传图片或文件"
                            onClick={() => handleToggleAddMenu(heroAddBtnRef)}
                          >
                            <Plus size={15} />
                          </button>

                          {renderModelSelector()}
                          {renderModeSelector()}
                          {renderPermissionSelector()}
                        </div>

                        <div className="dashboard-toolbar-right">
                          <button className="dashboard-glass-action-btn" type="button" title="语音指令">
                            <Mic size={14} />
                          </button>
                          <button
                            className={`dashboard-send-circle-btn ${(promptText.trim() || attachments.length > 0) ? "has-input" : ""} ${isStreaming ? "is-streaming" : ""}`}
                            type="button"
                            disabled={sessionLoading || Boolean(sessionLoadError)}
                            title={isStreaming ? "停止生成" : sessionLoading ? "会话加载中..." : "发送指令"}
                            onClick={isStreaming ? handleStopGeneration : () => void handleSendMessage()}
                          >
                            {isStreaming ? <Square size={12} fill="currentColor" /> : sessionLoading ? <Loader2 size={14} className="dashboard-spinner" style={{ animation: "spin 1s linear infinite" }} /> : <ArrowUp size={15} />}
                          </button>
                        </div>
                      </div>
                    </LiquidGlassContainer>
                    <div className="dashboard-project-permission-hint" role="note">{projectPermissionHint}</div>
                  </div>

                  {/* Compact Integrated Bento Grid (Fits in Single Screen) */}
                  <div className="dashboard-bento-grid">
                    {/* Card 1: Compute / CPU Sparkline */}
                    <div
                      className="dashboard-bento-card"
                      onClick={() => setMetricDetail("cpu")}
                      title="点击展开 CPU 历史曲线详情"
                    >
                      <div className="dashboard-bento-header">
                        <span className="dashboard-bento-label">
                          <span className="dashboard-bento-icon">
                            <Cpu size={14} />
                          </span>
                          计算负载
                        </span>
                        <span className="dashboard-bento-badge">多核综合</span>
                      </div>
                      <div className="dashboard-bento-value-row">
                        <span className="dashboard-bento-big-value">{formatMetricValue(resources.cpuUsage)}</span>
                        <span className="dashboard-bento-subtext">动态采样中</span>
                      </div>
                      <div className="dashboard-sparkline-frame">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData.slice(-12)}>
                            <defs>
                              <linearGradient id="dashboardCpuGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#0071e3" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#0071e3" stopOpacity={0.0} />
                              </linearGradient>
                            </defs>
                            <Area
                              type="monotone"
                              dataKey="cpuUsage"
                              stroke="#0071e3"
                              strokeWidth={2}
                              fill="url(#dashboardCpuGrad)"
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Card 2: Memory & Storage Allocation */}
                    <div
                      className="dashboard-bento-card"
                      onClick={() => setMetricDetail("memory")}
                      title="点击展开内存详情"
                    >
                      <div className="dashboard-bento-header">
                        <span className="dashboard-bento-label">
                          <span className="dashboard-bento-icon">
                            <MemoryStick size={14} />
                          </span>
                          内存分配
                        </span>
                        <span className="dashboard-bento-badge">物理驻留</span>
                      </div>
                      <div className="dashboard-bento-value-row">
                        <span className="dashboard-bento-big-value">{formatMetricValue(resources.memoryUsage)}</span>
                        <span className="dashboard-bento-subtext">分配率正常</span>
                      </div>
                      <div className="dashboard-progress-capsule">
                        <div
                          className="dashboard-progress-fill"
                          style={{ width: `${Math.min(100, Math.max(0, resources.memoryUsage))}%` }}
                        />
                      </div>
                      <div style={{ marginTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "#86868b" }}>
                        <span>磁盘占用: {formatMetricValue(resources.diskUsage)}</span>
                        <span>缓存正常</span>
                      </div>
                    </div>

                    {/* Card 3: Node Cluster Health */}
                    <div
                      className="dashboard-bento-card"
                      onClick={() => setMetricDetail("nodes")}
                      title="点击查看所有节点"
                    >
                      <div className="dashboard-bento-header">
                        <span className="dashboard-bento-label">
                          <span className="dashboard-bento-icon">
                            <Server size={14} />
                          </span>
                          节点矩阵
                        </span>
                        <span className="dashboard-bento-badge">{nodeCountValue} 在线</span>
                      </div>
                      <div className="dashboard-mini-rows-list">
                        {nodes.slice(0, 2).map((node) => (
                          <div key={node.id} className="dashboard-mini-row-item">
                            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                              <span className={`dashboard-status-dot ${node.status === "ONLINE" ? "online" : "offline"}`} />
                              <strong>{node.name}</strong>
                            </span>
                            <span style={{ color: "#86868b" }}>{node.host}</span>
                          </div>
                        ))}
                        {nodes.length === 0 ? (
                          <div className="dashboard-mini-row-item" style={{ color: "#86868b" }}>
                            未连接 Daemon 节点
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Card 4: Active Instances */}
                    <div
                      className="dashboard-bento-card"
                      onClick={() => onOpenInstance(null)}
                      title="点击进入实例管理"
                    >
                      <div className="dashboard-bento-header">
                        <span className="dashboard-bento-label">
                          <span className="dashboard-bento-icon">
                            <HardDrive size={14} />
                          </span>
                          活跃实例
                        </span>
                        <span className="dashboard-bento-badge">{recentInstances.length} 个实例</span>
                      </div>
                      <div className="dashboard-mini-rows-list">
                        {recentInstances.slice(0, 2).map(({ instance }) => (
                          <div key={instance.id} className="dashboard-mini-row-item">
                            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                              <span className={`dashboard-status-dot ${instance.status === "RUNNING" ? "online" : "offline"}`} />
                              <strong>{instance.name}</strong>
                            </span>
                            <span style={{ color: "#86868b" }}>{instanceTypeLabel(instance.type)}</span>
                          </div>
                        ))}
                        {recentInstances.length === 0 ? (
                          <div className="dashboard-mini-row-item" style={{ color: "#86868b" }}>
                            暂无运行中实例
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Compact Quick Action Suggestion Chips */}
                  <div className="dashboard-quick-chips">
                    <button
                      className="dashboard-chip-btn"
                      type="button"
                      onClick={() => handleSendMessage("执行全节点连通性自检与延迟评估")}
                    >
                      全节点连通性自检
                    </button>
                    <button
                      className="dashboard-chip-btn"
                      type="button"
                      onClick={() => handleSendMessage("分析高负载实例并提供内存优化建议")}
                    >
                      排查高负载实例进程
                    </button>
                    <button
                      className="dashboard-chip-btn"
                      type="button"
                      onClick={() => handleSendMessage("生成当前集群资源利用率体征快报")}
                    >
                      生成集群体征快报
                    </button>
                  </div>
                </div>
              ) : (
                /* In-Conversation Stream Mode */
                <>
                  <DashboardChatStream resetKey={`${activeSessionId}:${messages.filter((message) => message.role === "user").at(-1)?.id}`}>
                    <div className="dashboard-chat-stream-inner">
                      {sessionLoadError ? (
                        <div role="alert" className="dashboard-history-status">
                          <p>会话记录校验失败：{sessionLoadError}</p>
                          <button type="button" className="secondary-button" onClick={() => activeSessionId && void loadSessionDetail(activeSessionId)}><RefreshCw size={14} />重新加载</button>
                        </div>
                      ) : sessionLoading ? (
                        <div className={messages.length ? "dashboard-history-status" : "dashboard-chat-loading-placeholder"} role="status">
                          <Loader2 size={16} className="dashboard-spinner" style={{ animation: "spin 1s linear infinite" }} />
                          <span>{messages.length ? "已显示缓存，正在校验最新记录..." : "正在加载会话记录..."}</span>
                        </div>
                      ) : null}
                      <DashboardMessageList key={activeSessionId ?? "new"} messages={messages}
                        busyId={sessionLoading || sessionLoadError ? "history-loading" : isStreaming ? "streaming" : actionBusyId}
                        selectedTool={selectedTool} onSelectAction={selectTool} onDecide={decideAction}
                        onMessageOperation={handleMessageOperation} copiedMessageId={copiedMessageId}
                        rollbackCodeMessageIds={rollbackCodeMessageIds}
                        onPreviewAttachment={(attachment) => setPreviewingAttachment({ attachment, editable: false })} />
                      {!isStreaming && gitChangesSummary && (gitChangesSummary.filesCount > 0 || gitChangesSummary.canRestore) ? (
                        <div className="dashboard-session-bottom-changes">
                          <SakiChangedFilesPill summary={gitChangesSummary} onClick={handleOpenChangesDetails} />
                        </div>
                      ) : null}
                    </div>
                  </DashboardChatStream>

                  {/* Docked Liquid Glass Input */}
                  <div
                    className="dashboard-docked-input"
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {isStreaming && gitChangesSummary && (gitChangesSummary.filesCount > 0 || gitChangesSummary.canRestore) ? (
                      <div className="dashboard-docked-changes-pill-wrap">
                        <SakiChangedFilesPill summary={gitChangesSummary} onClick={handleOpenChangesDetails} />
                      </div>
                    ) : null}
                    <div
                      ref={dockedInputWrapperRef}
                      className={`dashboard-liquid-input-wrapper dashboard-docked-liquid-wrapper ${mentionMenuOpen ? "has-mention-open" : ""}`}
                    >
                      {mentionMenuOpen && (
                        <SakiMentionMenu
                          candidates={mentionCandidates}
                          activeIndex={mentionIndex}
                          onHover={setMentionIndex}
                          onSelect={handleApplyMention}
                          anchorRef={dockedInputWrapperRef}
                          variant="dashboard"
                        />
                      )}
                      <LiquidGlassContainer
                        className={`saki-input-container liquid-glass-container dashboard-liquid-input ${isDragOver ? "is-drag-over" : ""}`}
                        displacementScale={100}
                        zoom={1.20}
                        refractionIntensity={1.2}
                        blurAmount={0}
                        saturation={108}
                        cornerRadius={22}
                        mode="shader"
                      >
                        {/* Drag & drop overlay hint */}
                        {isDragOver && (
                          <div className="dashboard-input-drop-overlay">
                            <Upload size={20} className="dashboard-drop-overlay-icon" />
                            <span>松开鼠标添加图片或文件</span>
                          </div>
                        )}

                        {/* Attachment Tray */}
                        {attachments.length > 0 && (
                          <div className="dashboard-attachment-tray saki-attachment-tray">
                            {attachments.map((attachment, index) => (
                              <SakiAttachmentChip
                                attachment={attachment}
                                key={attachment.id ?? `${attachment.name}-${index}`}
                                removable
                                onClick={() => setPreviewingAttachment({ attachment, editable: true })}
                                onRemove={() => setAttachments((curr) => curr.filter((a) => a !== attachment))}
                              />
                            ))}
                          </div>
                        )}

                        <div className="dashboard-input-main-row">
                          <textarea
                            ref={dockedTextareaRef}
                            className="dashboard-input-textarea"
                            rows={1}
                            disabled={sessionLoading || Boolean(sessionLoadError)}
                            placeholder={
                              sessionLoading
                                ? "正在加载会话记录..."
                                : attachments.length > 0 || skills.length > 0
                                ? "输入 @ 引用文件或 Skill，或继续发送指令..."
                                : interactionMode === "agent"
                                ? `继续下达 Agent 自动化运维指令 (${activePermission.label})...`
                                : "继续向 AI 咨询集群知识 (问答聊天模式)..."
                            }
                            value={promptText}
                            onChange={(e) => {
                              setPromptText(e.target.value);
                              setMentionDismissedStart(null);
                              handleSyncMentionCaret(e.currentTarget);
                            }}
                            onClick={(e) => handleSyncMentionCaret(e.currentTarget)}
                            onSelect={(e) => handleSyncMentionCaret(e.currentTarget)}
                            onKeyUp={(e) => handleSyncMentionCaret(e.currentTarget)}
                            onFocus={(e) => handleSyncMentionCaret(e.currentTarget)}
                            onBlur={() => {
                              const active = activeSakiMentionQuery(promptText, mentionCaret);
                              if (active) setMentionDismissedStart(active.start);
                            }}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                          />
                        </div>
                        <div className="dashboard-input-toolbar">
                          <div className="dashboard-toolbar-left">
                            <button
                              ref={sessionAddBtnRef}
                              className={`dashboard-glass-action-btn ${addMenuOpen && activeAddAnchorRef.current === sessionAddBtnRef.current ? "is-active" : ""}`}
                              type="button"
                              title="上传图片或文件"
                              onClick={() => handleToggleAddMenu(sessionAddBtnRef)}
                            >
                              <Plus size={14} />
                            </button>
                            {renderModelSelector()}
                            {renderModeSelector()}
                            {renderPermissionSelector()}
                          </div>
                          <div className="dashboard-toolbar-right">
                            <button
                              className={`dashboard-send-circle-btn ${(promptText.trim() || attachments.length > 0) ? "has-input" : ""} ${isStreaming ? "is-streaming" : ""}`}
                              type="button"
                              disabled={sessionLoading || Boolean(sessionLoadError)}
                              title={isStreaming ? "停止生成" : sessionLoading ? "会话加载中..." : "发送指令"}
                              onClick={isStreaming ? handleStopGeneration : () => void handleSendMessage()}
                            >
                              {isStreaming ? <Square size={12} fill="currentColor" /> : sessionLoading ? <Loader2 size={14} className="dashboard-spinner" style={{ animation: "spin 1s linear infinite" }} /> : <ArrowUp size={14} />}
                            </button>
                          </div>
                        </div>
                      </LiquidGlassContainer>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
        {terminalPanelOpen ? (
          <DashboardToolDetails
            {...(selectedTool && selectedToolAction ? { messageId: selectedTool.messageId, action: selectedToolAction } : {})}
            token={token}
            instance={selectedProject ?? null}
            terminals={terminals}
            workspaceInstances={agentProjects.filter(instance => selectedWorkspaceIds.includes(instance.id))}
            activeTerminalId={activeTerminalId}
            onSelectTerminal={(id) => {
              setActiveTerminalId(id);
              setDetailsTab("terminal");
            }}
            onCreateTerminal={() => void createTerminal()}
            canCreateTerminal={canCreateTerminal}
            terminalBusy={terminalBusy}
            busyId={isStreaming ? "streaming" : actionBusyId}
            onDecide={decideAction}
            onClose={() => {
              setTerminalPanelOpen(false);
              setSelectedTool(null);
            }}
            changesSummary={gitChangesSummary}
            revertingChanges={revertingChanges}
            onRevertAllChanges={handleRevertAllChanges}
            onRestoreAllChanges={handleRestoreAllChanges}
            activeTab={detailsTab}
            onSelectTab={setDetailsTab}
          />
        ) : null}
      </div>

      {/* Metric Detail Modal */}
      {metricDetail ? (
        <MetricDetailModal
          kind={metricDetail}
          overview={overview}
          nodes={nodes}
          clusterResources={resources}
          onClose={() => setMetricDetail(null)}
          onTestNode={canTestNodes ? (id: string) => { void testNode(id); } : undefined}
          testingNodeId={testingNodeId}
        />
      ) : null}

      {/* Attachment Preview & Editor Modal */}
      {previewingAttachment ? (
        <SakiAttachmentModal
          attachment={previewingAttachment.attachment}
          editable={previewingAttachment.editable}
          onClose={() => setPreviewingAttachment(null)}
          onSave={(updated) => {
            setAttachments((curr) => curr.map((item) => (item === previewingAttachment.attachment ? updated : item)));
            setPreviewingAttachment(null);
          }}
          onRemove={() => {
            setAttachments((curr) => curr.filter((item) => item !== previewingAttachment.attachment));
            setPreviewingAttachment(null);
          }}
        />
      ) : null}

      {/* Hidden File Inputs for Attachment Upload */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void handleAddFiles(files, "image");
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void handleAddFiles(files, "file");
          e.target.value = "";
        }}
      />

      {/* Upload Dropdown Popover */}
      {renderAddPopover()}
    </>
  );
}
