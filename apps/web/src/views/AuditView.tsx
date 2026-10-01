import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderGit2,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Lock,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal as TerminalIcon,
  Trash2,
  Unlock,
  User,
  UserCheck,
  UserCog,
  Users,
  X
} from "lucide-react";
import type {
  AuditFocusCategory,
  AuditLogEntry,
  AuditLogQueryParams,
  AuditRangeSummary,
  AuditRetentionPolicy,
  AuditSortBy,
  AuditSortOrder,
  CurrentUser,
  SakiAuditConversationItem,
  SakiAuditConversationListResponse
} from "@webops/shared";
import type { SakiPromptSeed } from "../types/app.js";
import { api, ApiError } from "../api.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { FilePreviewModal } from "../components/common/FilePreviewModal.js";
import { AuditDiffLens } from "../components/audit/AuditDiffLens.js";
import { firstAuditText } from "../components/audit/auditDiff.js";
import { formatBytes, formatDate } from "../utils/path.js";

const auditActionLabels: Record<string, string> = {
  "auth.login": "用户登录",
  "auth.login.rate_limited": "登录限流",
  "auth.logout": "退出登录",
  "auth.profile.update": "更新账户",
  "auth.register": "用户注册",
  "daemon.register": "节点注册",
  "file.archive": "压缩文件",
  "file.archive.download": "压缩下载",
  "file.delete": "删除文件",
  "file.download": "下载文件",
  "file.extract": "解压文件",
  "file.mkdir": "新建目录",
  "file.read": "读取文件",
  "file.rename": "重命名文件",
  "file.upload": "上传文件",
  "file.write": "写入文件",
  "instance.create": "创建实例",
  "instance.delete": "删除实例",
  "instance.kill": "强杀实例",
  "instance.logs": "查看日志",
  "instance.restart": "重启实例",
  "instance.start": "启动实例",
  "instance.stop": "停止实例",
  "instance.update": "更新实例",
  "node.create": "创建节点",
  "node.delete": "删除节点",
  "node.test": "测试节点",
  "node.update": "更新节点",
  "role.permissions.update": "更新权限",
  "saki.chat": "Saki 对话",
  "saki.agent.tool": "Saki 工具调用",
  "saki.skill.create": "创建 Saki Skill",
  "saki.skill.update": "更新 Saki Skill",
  "saki.skill.delete": "删除 Saki Skill",
  "saki.skill.download": "下载 Saki Skill",
  "saki.config.update": "更新 Saki 配置",
  "saki.models.detect": "探测 Saki 模型",
  "settings.saki.update": "更新 Saki 设置",
  "task.create": "创建任务",
  "task.delete": "删除任务",
  "task.run": "执行任务",
  "task.update": "更新任务",
  "template.create": "创建模板",
  "terminal.input": "终端输入",
  "user.create": "创建用户",
  "user.delete": "删除用户",
  "user.switch": "切换账号",
  "user.update": "更新用户",
  "audit.logs.delete": "删除审计日志",
  "audit.logs.clear": "清空审计日志",
  "audit.logs.export": "导出审计日志",
  "audit.retention.update": "更新保留策略",
  "audit.retention.cleanup": "执行过期清理"
};

function auditActionLabel(action: string): string {
  return auditActionLabels[action] ?? action.replace(/\./g, " / ").replace(/_/g, " ");
}

function auditActor(log: AuditLogEntry): string {
  return log.username ?? (log.userId ? `用户 ${log.userId.slice(0, 8)}` : "系统");
}

function auditResourceLabel(log: AuditLogEntry): string {
  const resourceId = log.resourceId ? `/${log.resourceId.slice(0, 8)}` : "";
  return `${log.resourceType || "system"}${resourceId}`;
}

function auditPayloadText(payload?: string | null): string {
  if (!payload) return "";
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

function extractFailureReason(log: AuditLogEntry): string | null {
  if (log.result === "SUCCESS" && !log.payload?.includes("error")) {
    return null;
  }
  if (!log.payload) {
    return log.result === "FAILURE" ? "操作执行失败" : null;
  }
  try {
    const parsed = JSON.parse(log.payload);
    if (parsed.error && typeof parsed.error === "string") return parsed.error;
    if (parsed.reason && typeof parsed.reason === "string") return parsed.reason;
    if (parsed.message && typeof parsed.message === "string") return parsed.message;
    if (parsed.detail && typeof parsed.detail === "string") return parsed.detail;
    if (log.action === "auth.login.rate_limited") return "登录过于频繁已被限流拦截";
    if (log.result === "FAILURE") return "操作执行失败";
  } catch {
    if (log.result === "FAILURE") return log.payload.slice(0, 160);
  }
  return null;
}

function extractBriefSummary(log: AuditLogEntry): string {
  if (!log.payload) return log.result === "SUCCESS" ? "成功" : "失败";
  try {
    const parsed = JSON.parse(log.payload);
    if (log.action === "saki.chat" && parsed.conversation?.userMessage) {
      return `问: ${parsed.conversation.userMessage.slice(0, 36)}`;
    }
    if (log.action === "saki.agent.tool" && parsed.tool) {
      return `工具: ${parsed.tool}`;
    }
    if (parsed.path) return `${parsed.path}`;
    if (parsed.name) return `${parsed.name}`;
    if (parsed.reason) return `原因: ${parsed.reason}`;
    if (parsed.error) return `错误: ${parsed.error.slice(0, 36)}`;
    if (parsed.deletedCount !== undefined) return `删除 ${parsed.deletedCount} 项`;
  } catch {
  }
  return log.result === "SUCCESS" ? "成功" : "失败";
}

function auditResourceIcon(resourceType: string, action: string): React.ReactNode {
  const key = `${resourceType} ${action}`.toLowerCase();
  if (action.startsWith("auth.")) return <KeyRound size={15} />;
  if (action.startsWith("audit.")) return <Shield size={15} />;
  if (key.includes("instance") || key.includes("terminal")) return <TerminalIcon size={15} />;
  if (key.includes("task")) return <Clock size={15} />;
  if (key.includes("template")) return <LayoutTemplate size={15} />;
  if (key.includes("user") || key.includes("role")) return <UserCog size={15} />;
  if (key.includes("node") || key.includes("daemon")) return <Server size={15} />;
  if (key.includes("file")) return <FileText size={15} />;
  if (key.includes("saki")) return <Sparkles size={15} />;
  return <ClipboardList size={15} />;
}

type TimePreset = "all" | "1h" | "24h" | "7d" | "30d" | "custom";

function calculateTimeRange(preset: TimePreset, customFrom: string, customTo: string): { from?: string | undefined; to?: string | undefined } {
  const now = new Date();
  if (preset === "all") return {};
  if (preset === "1h") {
    return { from: new Date(now.getTime() - 60 * 60 * 1000).toISOString() };
  }
  if (preset === "24h") {
    return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString() };
  }
  if (preset === "7d") {
    return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() };
  }
  if (preset === "30d") {
    return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() };
  }
  if (preset === "custom") {
    const res: { from?: string | undefined; to?: string | undefined } = {};
    if (customFrom) res.from = new Date(customFrom).toISOString();
    if (customTo) res.to = new Date(customTo).toISOString();
    return res;
  }
  return {};
}

function renderAuditPayloadDetails(
  log: AuditLogEntry,
  token: string,
  onPreview: (instanceId: string, path: string, action: string) => void,
  onCopy: (key: string, text: string) => void,
  copiedKey: string | null,
  onOpenUserSakiChat?: ((username: string) => void) | undefined
) {
  if (!log.payload) {
    return <div className="audit-payload-empty">无载荷数据</div>;
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(log.payload);
  } catch {
    return <pre className="audit-pre-code">{log.payload}</pre>;
  }

  if (log.action === "saki.chat") {
    const conversation = parsed.conversation;
    return (
      <div className="audit-payload-saki-chat-inspector">
        <div className="saki-forensic-card">
          <div className="forensic-meta-row">
            <span className="meta-badge-purple">
              <Bot size={12} />
              Saki 对话交互
            </span>
            {parsed.mode && <span className="meta-tag">模式: {parsed.mode}</span>}
            {parsed.source && <span className="meta-tag">引擎: {parsed.source}</span>}
            {parsed.actionCount !== undefined && (
              <span className="meta-tag">工具调用: {parsed.actionCount} 项</span>
            )}
          </div>

          {conversation?.userMessage && (
            <div className="saki-bubble-box user-bubble">
              <div className="bubble-header">
                <span className="bubble-author">
                  <User size={12} />
                  用户提问
                </span>
                <button
                  type="button"
                  className="copy-mini-btn"
                  title="复制提问"
                  onClick={() => onCopy(`chat-u-${log.id}`, conversation.userMessage)}
                >
                  {copiedKey === `chat-u-${log.id}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
                  复制
                </button>
              </div>
              <div className="bubble-content">{conversation.userMessage}</div>
            </div>
          )}

          {conversation?.assistantMessage && (
            <div className="saki-bubble-box assistant-bubble">
              <div className="bubble-header">
                <span className="bubble-author">
                  <Sparkles size={12} />
                  Saki 回答
                </span>
                <button
                  type="button"
                  className="copy-mini-btn"
                  title="复制回答"
                  onClick={() => onCopy(`chat-a-${log.id}`, conversation.assistantMessage)}
                >
                  {copiedKey === `chat-a-${log.id}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
                  复制
                </button>
              </div>
              <div className="bubble-content assistant-text">{conversation.assistantMessage}</div>
            </div>
          )}

          {parsed.error && (
            <div className="saki-bubble-box error-bubble">
              <div className="bubble-header">
                <span className="bubble-author error">
                  <AlertTriangle size={12} />
                  异常原因
                </span>
              </div>
              <div className="bubble-content error-text">{parsed.error}</div>
            </div>
          )}

          {log.username && onOpenUserSakiChat && (
            <div className="forensic-actions-row">
              <button
                type="button"
                className="small-button secondary mini"
                onClick={() => onOpenUserSakiChat(log.username!)}
              >
                <MessagesSquare size={12} />
                在 Saki 会话全景中查找该用户
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (log.action === "saki.agent.tool") {
    const isFileTool = ["writefile", "editlines", "replaceinfile", "mkdir", "deletepath", "renamepath", "uploadbase64", "readfile"].includes(parsed.tool);
    return (
      <div className="audit-payload-tool">
        <div className="tool-header">
          <div className="tool-name-wrap">
            <span className="tool-tag">{isFileTool ? "文件工具" : "Agent 工具"}</span>
            <code className="tool-name">{parsed.tool}</code>
          </div>
          <span className={`tool-status-badge ${parsed.ok ? "success" : "failure"}`}>
            {parsed.status || (parsed.ok ? "执行成功" : "执行失败")}
          </span>
        </div>

        {parsed.args && (
          <div className="tool-section">
            <div className="tool-section-head">
              <span className="section-label">调用参数 (Arguments)</span>
              <button
                type="button"
                className="copy-mini-btn"
                onClick={() => onCopy(`tool-args-${log.id}`, JSON.stringify(parsed.args, null, 2))}
              >
                {copiedKey === `tool-args-${log.id}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
                复制参数
              </button>
            </div>
            <pre className="args-pre">{JSON.stringify(parsed.args, null, 2)}</pre>
          </div>
        )}

        {parsed.args && ["writefile", "editlines", "replaceinfile"].includes(parsed.tool) && firstAuditText(parsed.args.targetContent, parsed.args.oldContent, parsed.args.replacementContent, parsed.args.newContent, parsed.args.content) !== undefined && (
          <div className="tool-section">
            <div className="tool-section-head">
              <span className="section-label">代码变动透镜 (Code Diff Lens)</span>
            </div>
            <AuditDiffLens
              originalText={firstAuditText(parsed.args.targetContent, parsed.args.oldContent) ?? ""}
              modifiedText={firstAuditText(parsed.args.replacementContent, parsed.args.newContent, parsed.args.content, parsed.args.code) ?? ""}
              filePath={firstAuditText(parsed.args.filePath, parsed.args.path, parsed.args.file)}
              title={`变动透镜: ${parsed.tool}`}
              action={parsed.tool}
            />
          </div>
        )}

        {parsed.observation && (
          <div className="tool-section">
            <div className="tool-section-head">
              <span className="section-label">执行观测结果 (Observation)</span>
              <button
                type="button"
                className="copy-mini-btn"
                onClick={() => onCopy(`tool-obs-${log.id}`, parsed.observation)}
              >
                {copiedKey === `tool-obs-${log.id}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
                复制结果
              </button>
            </div>
            <pre className="observation-pre">{parsed.observation}</pre>
          </div>
        )}
      </div>
    );
  }

  if (log.action.startsWith("file.") || log.resourceType === "instance_file") {
    const isWriteOrUpload = log.action === "file.write" || log.action === "file.upload";
    const isDownloadOrRead = log.action === "file.download" || log.action === "file.read";
    const isRenameOrCopy = log.action === "file.rename" || log.action === "file.copy";
    const isDelete = log.action === "file.delete";
    const isMkdir = log.action === "file.mkdir";
    const filePath = parsed.path || parsed.toPath || parsed.fromPath;
    const hasPreview = (isWriteOrUpload || isDownloadOrRead) && filePath && log.resourceId;

    let opLabel = "文件操作";
    let opBadgeClass = "blue";
    if (isWriteOrUpload) { opLabel = "文件写入/上传"; opBadgeClass = "green"; }
    else if (isDelete) { opLabel = "文件删除"; opBadgeClass = "danger"; }
    else if (isRenameOrCopy) { opLabel = "重命名/移动"; opBadgeClass = "purple"; }
    else if (isMkdir) { opLabel = "新建目录"; opBadgeClass = "orange"; }

    return (
      <div className="audit-payload-file-inspector">
        <div className="file-forensic-header">
          <span className={`file-op-badge ${opBadgeClass}`}>
            <FileText size={12} />
            {opLabel}
          </span>
          {log.resourceId && (
            <span className="instance-tag">
              实例 ID: <code>{log.resourceId}</code>
            </span>
          )}
        </div>

        <div className="file-forensic-body">
          {filePath && (
            <div className="file-path-row">
              <span className="path-label">目标路径:</span>
              <code className="path-val mono">{filePath}</code>
              <button
                type="button"
                className="copy-mini-btn"
                title="复制路径"
                onClick={() => onCopy(`fpath-${log.id}`, filePath)}
              >
                {copiedKey === `fpath-${log.id}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
              </button>
            </div>
          )}

          {isRenameOrCopy && (
            <div className="rename-flow-box">
              {parsed.fromPath && (
                <div className="rename-step">
                  <span className="step-label">原路径:</span>
                  <code className="mono">{parsed.fromPath}</code>
                </div>
              )}
              {parsed.toPath && (
                <div className="rename-step">
                  <span className="step-label">新路径:</span>
                  <code className="mono">{parsed.toPath}</code>
                </div>
              )}
            </div>
          )}

          <div className="file-meta-grid">
            {parsed.size !== undefined && (
              <div className="meta-cell">
                <span className="cell-k">文件大小:</span>
                <span className="cell-v">{formatBytes(parsed.size)} ({parsed.size} 字节)</span>
              </div>
            )}
            {parsed.targetPath && (
              <div className="meta-cell full-width">
                <span className="cell-k">归档目标:</span>
                <code className="mono">{parsed.targetPath}</code>
              </div>
            )}
            {parsed.paths && Array.isArray(parsed.paths) && (
              <div className="meta-cell full-width">
                <span className="cell-k">归档包含文件:</span>
                <span className="cell-v">{parsed.paths.join(", ")}</span>
              </div>
            )}
            {parsed.error && (
              <div className="meta-cell full-width error-cell">
                <span className="cell-k">错误提示:</span>
                <span className="cell-v error-text">{parsed.error}</span>
              </div>
            )}
          </div>

          {(typeof parsed.content === "string" || typeof parsed.diff === "string") && (
            <div className="file-diff-section" style={{ marginTop: 10 }}>
              {typeof parsed.content === "string" ? (
              <AuditDiffLens
                originalText={firstAuditText(parsed.oldContent) ?? ""}
                modifiedText={parsed.content}
                filePath={firstAuditText(filePath)}
                title={`变动透镜: ${filePath || opLabel}`}
                action={log.action}
              />
              ) : <pre className="args-pre">{parsed.diff}</pre>}
            </div>
          )}

          {hasPreview && (
            <div className="file-action-buttons">
              <button
                className="small-button preview-file-button"
                type="button"
                onClick={() => onPreview(log.resourceId!, filePath, log.action)}
              >
                <Eye size={13} />
                在线预览该文件
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <pre className="audit-pre-code">{JSON.stringify(parsed, null, 2)}</pre>;
}

export function AuditView({
  token,
  onLogout,
  refreshTick,
  onAskSaki,
  canDeleteLogs,
  darkMode,
  currentUser
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  canDeleteLogs: boolean;
  darkMode: boolean;
  currentUser?: CurrentUser | null;
}) {
  const isSuperAdmin = currentUser?.isSuperAdmin ?? canDeleteLogs;

  const [activeTab, setActiveTab] = useState<"logs" | "saki_conversations">("logs");

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [summary, setSummary] = useState<AuditRangeSummary>({
    total: 0,
    success: 0,
    failure: 0,
    successRate: 100,
    actors: 0,
    resourceTypes: 0,
    failedLogins: 0,
    permissionChanges: 0,
    deleteOperations: 0,
    sakiChats: 0,
    fileChanges: 0,
    latestLogAt: null
  });

  const [retention, setRetention] = useState<AuditRetentionPolicy | null>(null);
  const [retentionModalOpen, setRetentionModalOpen] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);
  const [cleaningExpired, setCleaningExpired] = useState(false);

  const [facets, setFacets] = useState<{
    resourceTypes: string[];
    actions: string[];
    users?: Array<{ id: string; username: string; displayName: string; avatarDataUrl?: string | null }>;
  }>({
    resourceTypes: [],
    actions: [],
    users: []
  });

  const [timePreset, setTimePreset] = useState<TimePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filterActor, setFilterActor] = useState("");
  const [filterIp, setFilterIp] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const [filterResourceId, setFilterResourceId] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterResult, setFilterResult] = useState<"" | "SUCCESS" | "FAILURE">("");
  const [filterCategory, setFilterCategory] = useState<AuditFocusCategory>("all");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [userDropdownSearch, setUserDropdownSearch] = useState("");
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const [sortBy, setSortBy] = useState<AuditSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<AuditSortOrder>("desc");

  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 900 : true));
  const [isMobile, setIsMobile] = useState<boolean>(() => typeof window !== "undefined" && window.innerWidth <= 900);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [sakiConversations, setSakiConversations] = useState<SakiAuditConversationItem[]>([]);
  const [sakiConvPage, setSakiConvPage] = useState(1);
  const [sakiConvLimit] = useState(20);
  const [sakiConvTotal, setSakiConvTotal] = useState(0);
  const [sakiConvTotalPages, setSakiConvTotalPages] = useState(1);
  const [sakiConvLoading, setSakiConvLoading] = useState(false);
  const [sakiConvKeyword, setSakiConvKeyword] = useState("");
  const [sakiConvUser, setSakiConvUser] = useState("");
  const [sakiConvUserDropdownOpen, setSakiConvUserDropdownOpen] = useState(false);
  const [sakiConvUserSearch, setSakiConvUserSearch] = useState("");
  const sakiUserDropdownRef = useRef<HTMLDivElement>(null);
  const [sakiConvTimePreset, setSakiConvTimePreset] = useState<TimePreset>("all");
  const [sakiConvCustomFrom, setSakiConvCustomFrom] = useState("");
  const [sakiConvCustomTo, setSakiConvCustomTo] = useState("");
  const [selectedSakiConv, setSelectedSakiConv] = useState<SakiAuditConversationItem | null>(null);
  const [sakiConvDrawerOpen, setSakiConvDrawerOpen] = useState(false);
  const [sakiModalFullscreen, setSakiModalFullscreen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false);
      }
      if (sakiUserDropdownRef.current && !sakiUserDropdownRef.current.contains(event.target as Node)) {
        setSakiConvUserDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 900);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  const [controlledDeleteMode, setControlledDeleteMode] = useState(false);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    type: "single" | "batch" | "clear";
    targetId?: string | undefined;
    targetIds?: string[] | undefined;
  } | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteChallengeInput, setDeleteChallengeInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [previewFile, setPreviewFile] = useState<{
    instanceId: string;
    filePath: string;
    actionName: string;
  } | null>(null);

  const currentQueryParams = useMemo<AuditLogQueryParams>(() => {
    const { from, to } = calculateTimeRange(timePreset, customFrom, customTo);
    return {
      page,
      limit: pageSize,
      from,
      to,
      actor: filterActor.trim() || undefined,
      ip: filterIp.trim() || undefined,
      resourceType: filterResourceType.trim() || undefined,
      resourceId: filterResourceId.trim() || undefined,
      action: filterAction.trim() || undefined,
      result: filterResult || undefined,
      category: filterCategory !== "all" ? filterCategory : undefined,
      keyword: filterKeyword.trim() || undefined,
      sortBy,
      sortOrder
    };
  }, [
    page,
    pageSize,
    timePreset,
    customFrom,
    customTo,
    filterActor,
    filterIp,
    filterResourceType,
    filterResourceId,
    filterAction,
    filterResult,
    filterCategory,
    filterKeyword,
    sortBy,
    sortOrder
  ]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.auditLogs(token, currentQueryParams);
      setLogs(response.data);
      setTotal(response.total);
      setTotalPages(response.totalPages);
      setSummary(response.summary);
      if (response.facets) setFacets(response.facets);
      if (response.retention) setRetention(response.retention);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "审计日志读取失败");
    } finally {
      setLoading(false);
    }
  }, [token, currentQueryParams, onLogout]);

  const fetchSakiConversations = useCallback(async () => {
    if (!isSuperAdmin) return;
    setSakiConvLoading(true);
    setError("");
    try {
      const { from, to } = calculateTimeRange(sakiConvTimePreset, sakiConvCustomFrom, sakiConvCustomTo);
      const res = await api.auditListSakiConversations(token, {
        page: sakiConvPage,
        limit: sakiConvLimit,
        keyword: sakiConvKeyword.trim() || undefined,
        userId: sakiConvUser.trim() || undefined,
        from,
        to
      });
      setSakiConversations(res.data);
      setSakiConvTotal(res.total);
      setSakiConvTotalPages(res.totalPages);
      if (res.facets?.users) {
        const fetchedUsers = res.facets.users;
        setFacets((prev) => ({ ...prev, users: fetchedUsers }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "Saki 对话审计列表加载失败");
    } finally {
      setSakiConvLoading(false);
    }
  }, [token, isSuperAdmin, sakiConvPage, sakiConvLimit, sakiConvKeyword, sakiConvUser, sakiConvTimePreset, sakiConvCustomFrom, sakiConvCustomTo, onLogout]);

  useEffect(() => {
    if (activeTab === "logs") {
      void fetchLogs();
    } else if (activeTab === "saki_conversations" && isSuperAdmin) {
      void fetchSakiConversations();
    }
  }, [activeTab, fetchLogs, fetchSakiConversations, refreshTick, isSuperAdmin]);

  useEffect(() => {
    if (logs.length > 0) {
      if (!selectedLogId || !logs.some((l) => l.id === selectedLogId)) {
        setSelectedLogId(logs[0]?.id ?? null);
      }
    } else {
      setSelectedLogId(null);
    }
  }, [logs, selectedLogId]);

  const activeLog = useMemo(() => {
    if (!selectedLogId) return logs[0] ?? null;
    return logs.find((l) => l.id === selectedLogId) ?? logs[0] ?? null;
  }, [logs, selectedLogId]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (timePreset !== "all") count++;
    if (filterActor.trim()) count++;
    if (filterIp.trim()) count++;
    if (filterResourceType.trim()) count++;
    if (filterResourceId.trim()) count++;
    if (filterAction.trim()) count++;
    if (filterResult) count++;
    if (filterCategory !== "all") count++;
    if (filterKeyword.trim()) count++;
    return count;
  }, [
    timePreset,
    filterActor,
    filterIp,
    filterResourceType,
    filterResourceId,
    filterAction,
    filterResult,
    filterCategory,
    filterKeyword
  ]);

  const resetFilters = () => {
    setTimePreset("all");
    setCustomFrom("");
    setCustomTo("");
    setFilterActor("");
    setFilterIp("");
    setFilterResourceType("");
    setFilterResourceId("");
    setFilterAction("");
    setFilterResult("");
    setFilterCategory("all");
    setFilterKeyword("");
    setPage(1);
  };

  const handleSort = (column: AuditSortBy) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder(column === "createdAt" ? "desc" : "asc");
    }
    setPage(1);
  };

  const toggleSelectLog = (id: string) => {
    setSelectedLogIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleSelectAllPage = () => {
    const visibleIds = logs.map((l) => l.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedLogIds.includes(id));
    if (allSelected) {
      setSelectedLogIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedLogIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const copyToClipboard = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const handleExport = async (format: "csv" | "json") => {
    setExporting(format);
    setExportMenuOpen(false);
    setError("");
    try {
      await api.exportAuditLogs(token, { ...currentQueryParams, format });
      setNotice(`已导出 ${format.toUpperCase()} 审计报表`);
      setTimeout(() => setNotice(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  const executeDelete = async () => {
    if (!deleteConfirmModal) return;
    if (!deleteReason.trim()) {
      setError("请填写删除原因。");
      return;
    }
    if (deleteConfirmModal.type === "clear" && deleteChallengeInput !== "CLEAR") {
      setError('清空全部日志需输入 "CLEAR" 确认。');
      return;
    }

    setDeleting(true);
    setError("");

    try {
      if (deleteConfirmModal.type === "single" && deleteConfirmModal.targetId) {
        await api.deleteAuditLog(token, deleteConfirmModal.targetId, deleteReason.trim());
        setNotice(`已删除 1 条审计日志`);
      } else if (deleteConfirmModal.type === "batch" && deleteConfirmModal.targetIds) {
        const res = await api.deleteAuditLogs(token, deleteConfirmModal.targetIds, deleteReason.trim());
        setNotice(`已删除 ${res.deleted} 条审计日志`);
        setSelectedLogIds([]);
      } else if (deleteConfirmModal.type === "clear") {
        const res = await api.clearAuditLogs(token, deleteReason.trim());
        setNotice(`已清空 ${res.deleted} 条历史日志`);
        setSelectedLogIds([]);
      }
      setDeleteConfirmModal(null);
      setDeleteReason("");
      setDeleteChallengeInput("");
      await fetchLogs();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveRetention = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retention) return;
    setSavingRetention(true);
    setError("");
    try {
      const updated = await api.updateAuditRetention(token, retention);
      setRetention(updated);
      setNotice("保留策略已保存");
      setRetentionModalOpen(false);
      setTimeout(() => setNotice(""), 3000);
      await fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingRetention(false);
    }
  };

  const handleImmediateCleanup = async () => {
    if (!window.confirm("确定立即清理过期日志？")) return;
    setCleaningExpired(true);
    setError("");
    try {
      const res = await api.cleanupExpiredAuditLogs(token);
      setNotice(`清理完成，共移除 ${res.deleted} 条过期日志`);
      await fetchLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "清理失败");
    } finally {
      setCleaningExpired(false);
    }
  };

  const askSakiAboutLog = (log: AuditLogEntry) => {
    if (!onAskSaki) return;
    const payloadText = auditPayloadText(log.payload);
    onAskSaki({
      message: `请针对此审计事件进行风险分析并给出处理建议：\n动作：${log.action} (${auditActionLabel(log.action)})\n结果：${log.result}\n操作者：${auditActor(log)}\n资源：${auditResourceLabel(log)}`,
      contextTitle: `审计事件：${auditActionLabel(log.action)}`,
      contextText: [
        `Action: ${log.action} (${auditActionLabel(log.action)})`,
        `Result: ${log.result}`,
        `Time: ${log.createdAt}`,
        `Actor: ${auditActor(log)} (ID: ${log.userId ?? "system"})`,
        `Resource: ${log.resourceType}${log.resourceId ? ` / ${log.resourceId}` : ""}`,
        `IP: ${log.ip ?? "-"}`,
        `UserAgent: ${log.userAgent ?? "-"}`,
        payloadText ? `Payload:\n${payloadText}` : "Payload: none"
      ].join("\n"),
      mode: "agent",
      clearInstance: true
    });
  };

  const openAuditSaki = () => {
    if (!onAskSaki) return;
    onAskSaki({
      message: "请审查当前审计日志中的异常登录、权限变更、文件修改或删除操作，并列出潜在风险项。",
      mode: "agent",
      clearInstance: true
    });
  };

  const openUserSakiChatHistory = (username: string) => {
    setActiveTab("saki_conversations");
    setSakiConvUser(username);
    setSakiConvPage(1);
  };

  const filteredUsers = useMemo(() => {
    const list = facets.users || [];
    if (!userDropdownSearch.trim()) return list;
    const q = userDropdownSearch.toLowerCase().trim();
    return list.filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
  }, [facets.users, userDropdownSearch]);

  const filteredSakiUsers = useMemo(() => {
    const list = facets.users || [];
    if (!sakiConvUserSearch.trim()) return list;
    const q = sakiConvUserSearch.toLowerCase().trim();
    return list.filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
  }, [facets.users, sakiConvUserSearch]);

  const selectedActorUser = useMemo(() => {
    if (!filterActor || filterActor === "system") return null;
    return (facets.users || []).find((u) => u.username === filterActor || u.id === filterActor);
  }, [filterActor, facets.users]);

  const selectedSakiConvUser = useMemo(() => {
    if (!sakiConvUser) return null;
    return (facets.users || []).find((u) => u.username === sakiConvUser || u.id === sakiConvUser);
  }, [sakiConvUser, facets.users]);

  const allPageSelected = logs.length > 0 && logs.every((l) => selectedLogIds.includes(l.id));

  const renderDrawerInner = (log: AuditLogEntry) => (
    <>
      <div className="drawer-header">
        <div className="drawer-title-group">
          <span className="drawer-icon">
            {auditResourceIcon(log.resourceType, log.action)}
          </span>
          <div>
            <h4>{auditActionLabel(log.action)}</h4>
            <code className="drawer-code">{log.action}</code>
          </div>
        </div>
        <button
          type="button"
          className="icon-button mini"
          title="收起"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={14} />
        </button>
      </div>

      <div className="drawer-quick-filters">
        <button
          type="button"
          className="quick-filter-chip"
          onClick={() => {
            setFilterActor(log.username ?? log.userId ?? "system");
            setPage(1);
          }}
        >
          <User size={11} />
          查此用户
        </button>
        <button
          type="button"
          className="quick-filter-chip"
          onClick={() => {
            setFilterResourceType(log.resourceType);
            if (log.resourceId) setFilterResourceId(log.resourceId);
            setPage(1);
          }}
        >
          <Server size={11} />
          查同资源
        </button>
        <button
          type="button"
          className="quick-filter-chip"
          onClick={() => {
            setFilterAction(log.action);
            setPage(1);
          }}
        >
          <ClipboardList size={11} />
          查同动作
        </button>
        {onAskSaki && (
          <button
            type="button"
            className="quick-filter-chip saki-chip-btn"
            onClick={() => askSakiAboutLog(log)}
          >
            <Sparkles size={11} />
            Saki 研判
          </button>
        )}
      </div>

      <div className="drawer-body">
        {log.result === "FAILURE" && (
          <div className="drawer-error-alert">
            <AlertTriangle size={14} />
            <span>{extractFailureReason(log) || "操作执行失败"}</span>
          </div>
        )}

        <div className="drawer-specs-grid">
          <div className="spec-row">
            <span className="spec-key">日志 ID</span>
            <div className="spec-val">
              <code className="mono">{log.id}</code>
              <button
                type="button"
                className="copy-btn"
                onClick={() => copyToClipboard(`id-${log.id}`, log.id)}
              >
                {copiedKey === `id-${log.id}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
              </button>
            </div>
          </div>

          <div className="spec-row">
            <span className="spec-key">执行时间</span>
            <div className="spec-val">
              <span>{formatDate(log.createdAt)}</span>
            </div>
          </div>

          <div className="spec-row">
            <span className="spec-key">操作者</span>
            <div className="spec-val">
              <span>{auditActor(log)}</span>
              {log.userId && <small className="sub-val">({log.userId})</small>}
            </div>
          </div>

          <div className="spec-row">
            <span className="spec-key">资源目标</span>
            <div className="spec-val">
              <span className="resource-pill">{log.resourceType}</span>
              {log.resourceId && (
                <>
                  <code className="mono">{log.resourceId}</code>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyToClipboard(`res-${log.resourceId}`, log.resourceId!)}
                  >
                    {copiedKey === `res-${log.resourceId}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="spec-row">
            <span className="spec-key">来源 IP</span>
            <div className="spec-val">
              <code className="mono">{log.ip || "-"}</code>
            </div>
          </div>

          <div className="spec-row full-width">
            <span className="spec-key">User-Agent</span>
            <div className="spec-ua-box">
              <code>{log.userAgent || "-"}</code>
            </div>
          </div>
        </div>

        <div className="drawer-payload-section">
          <div className="payload-header">
            <span>操作载荷与详情</span>
            {log.payload && (
              <button
                type="button"
                className="small-button secondary mini"
                onClick={() => copyToClipboard(`payload-${log.id}`, auditPayloadText(log.payload))}
              >
                {copiedKey === `payload-${log.id}` ? <Check size={11} className="copied" /> : <Copy size={11} />}
                复制 JSON
              </button>
            )}
          </div>
          <div className="payload-content">
            {renderAuditPayloadDetails(
              log,
              token,
              (instanceId, filePath, actionName) => {
                setPreviewFile({ instanceId, filePath, actionName });
              },
              copyToClipboard,
              copiedKey,
              isSuperAdmin ? openUserSakiChatHistory : undefined
            )}
          </div>
        </div>

        {controlledDeleteMode && canDeleteLogs && (
          <div className="drawer-danger-zone">
            <button
              type="button"
              className="small-button danger-action mini full-width"
              onClick={() => {
                setDeleteConfirmModal({
                  type: "single",
                  targetId: log.id
                });
              }}
            >
              <Trash2 size={12} />
              删除本条审计记录
            </button>
          </div>
        )}
      </div>
    </>
  );

  const copyConversationTranscript = (conv: SakiAuditConversationItem, format: "markdown" | "json") => {
    if (format === "json") {
      copyToClipboard(`saki-conv-${conv.id}`, JSON.stringify(conv, null, 2));
      return;
    }
    const lines: string[] = [
      `# Saki 对话记录: ${conv.title}`,
      `- 操作用户: ${conv.displayName} (@${conv.username}, ID: ${conv.userId})`,
      `- 关联环境: ${conv.instanceName || conv.instanceId || conv.contextKey}`,
      `- 对话时间: ${formatDate(conv.createdAt)} ~ ${formatDate(conv.updatedAt)}`,
      `- 消息数量: ${conv.messageCount} 条`,
      "",
      "---",
      ""
    ];

    for (const msg of conv.messages) {
      const roleLabel = msg.role === "user" ? `👤 ${conv.displayName}` : msg.role === "assistant" ? "✨ Saki" : "⚙️ System";
      lines.push(`### ${roleLabel}${msg.timestamp ? ` (${formatDate(msg.timestamp)})` : ""}`);
      if (msg.thinking) {
        lines.push(`> **深度思考**:\n> ${msg.thinking.replace(/\n/g, "\n> ")}\n`);
      }
      lines.push(msg.content);
      if (Array.isArray(msg.actions) && msg.actions.length > 0) {
        lines.push(`\n*执行工具调用*: ${msg.actions.map((a: any) => a.tool || a.name).join(", ")}`);
      }
      lines.push("\n---");
    }

    copyToClipboard(`saki-conv-md-${conv.id}`, lines.join("\n"));
  };

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      {notice ? <div className="page-notice">{notice}</div> : null}

      <div className="audit-view-container">
        {isSuperAdmin && (
          <div className="audit-mode-switcher-bar">
            <div className="mode-tabs-pill">
              <button
                type="button"
                className={`mode-tab ${activeTab === "logs" ? "active" : ""}`}
                onClick={() => setActiveTab("logs")}
              >
                <ClipboardList size={14} />
                全局审计日志
                <span className="mode-count-badge">{summary.total}</span>
              </button>
              <button
                type="button"
                className={`mode-tab ${activeTab === "saki_conversations" ? "active" : ""}`}
                onClick={() => setActiveTab("saki_conversations")}
              >
                <Sparkles size={14} />
                Saki 用户会话全景审计
              </button>
            </div>
          </div>
        )}

        {activeTab === "logs" && (
          <>
            <div className="audit-metrics-row">
              <button
                type="button"
                className={`audit-metric-card ${filterCategory === "all" && !filterResult ? "active" : ""}`}
                onClick={() => {
                  setFilterCategory("all");
                  setFilterResult("");
                  setPage(1);
                }}
              >
                <span className="metric-label">全部事件</span>
                <strong className="metric-val">{summary.total}</strong>
              </button>

              <button
                type="button"
                className={`audit-metric-card purple ${filterCategory === "saki_chat" ? "active" : ""}`}
                onClick={() => {
                  setFilterCategory((prev) => (prev === "saki_chat" ? "all" : "saki_chat"));
                  setPage(1);
                }}
              >
                <span className="metric-label">
                  <Sparkles size={12} className="metric-label-icon" />
                  Saki 对话记录
                </span>
                <strong className="metric-val">{summary.sakiChats ?? 0}</strong>
              </button>

              <button
                type="button"
                className={`audit-metric-card cyan ${filterCategory === "file_change" ? "active" : ""}`}
                onClick={() => {
                  setFilterCategory((prev) => (prev === "file_change" ? "all" : "file_change"));
                  setPage(1);
                }}
              >
                <span className="metric-label">
                  <FileText size={12} className="metric-label-icon" />
                  文件变更记录
                </span>
                <strong className="metric-val">{summary.fileChanges ?? 0}</strong>
              </button>

              <button
                type="button"
                className={`audit-metric-card warning ${filterCategory === "failed_login" ? "active" : ""}`}
                onClick={() => {
                  setFilterCategory((prev) => (prev === "failed_login" ? "all" : "failed_login"));
                  setPage(1);
                }}
              >
                <span className="metric-label">失败登录</span>
                <strong className="metric-val">{summary.failedLogins}</strong>
              </button>

              <button
                type="button"
                className={`audit-metric-card purple-light ${filterCategory === "permission_change" ? "active" : ""}`}
                onClick={() => {
                  setFilterCategory((prev) => (prev === "permission_change" ? "all" : "permission_change"));
                  setPage(1);
                }}
              >
                <span className="metric-label">权限变更</span>
                <strong className="metric-val">{summary.permissionChanges}</strong>
              </button>

              <button
                type="button"
                className={`audit-metric-card danger ${filterCategory === "delete_operation" ? "active" : ""}`}
                onClick={() => {
                  setFilterCategory((prev) => (prev === "delete_operation" ? "all" : "delete_operation"));
                  setPage(1);
                }}
              >
                <span className="metric-label">删除操作</span>
                <strong className="metric-val">{summary.deleteOperations}</strong>
              </button>
            </div>

            <div className="audit-main-bar">
              <div className="audit-search-row">
                <div className="audit-search-field">
                  <Search size={14} className="search-icon" />
                  <input
                    type="text"
                    placeholder="搜索操作者、IP、资源、Saki对话、动作或关键词..."
                    value={filterKeyword}
                    onChange={(e) => {
                      setFilterKeyword(e.target.value);
                      setPage(1);
                    }}
                  />
                  {filterKeyword && (
                    <button type="button" className="clear-btn" onClick={() => setFilterKeyword("")}>
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div className="user-filter-wrapper" ref={userDropdownRef}>
                  <button
                    type="button"
                    className={`small-button user-filter-btn ${filterActor ? "has-user" : "secondary"}`}
                    onClick={() => setUserDropdownOpen((prev) => !prev)}
                  >
                    <Users size={13} />
                    <span className="user-filter-label">
                      {filterActor
                        ? filterActor === "system"
                          ? "系统操作"
                          : selectedActorUser
                          ? selectedActorUser.displayName
                          : filterActor
                        : "操作者筛选"}
                    </span>
                    {filterActor ? (
                      <span
                        className="clear-user-x"
                        title="清除用户筛选"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterActor("");
                          setPage(1);
                        }}
                      >
                        <X size={12} />
                      </span>
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>

                  {userDropdownOpen && (
                    <div className="user-filter-popover">
                      <div className="user-popover-search">
                        <Search size={12} />
                        <input
                          type="text"
                          placeholder="搜索用户名或昵称..."
                          value={userDropdownSearch}
                          onChange={(e) => setUserDropdownSearch(e.target.value)}
                          autoFocus
                        />
                      </div>

                      <div className="user-popover-list">
                        <button
                          type="button"
                          className={`user-option-item ${!filterActor ? "selected" : ""}`}
                          onClick={() => {
                            setFilterActor("");
                            setUserDropdownOpen(false);
                            setPage(1);
                          }}
                        >
                          <div className="user-option-avatar all-users-icon">
                            <Users size={12} />
                          </div>
                          <div className="user-option-info">
                            <span className="user-option-name">全部操作者</span>
                            <span className="user-option-sub">不限用户</span>
                          </div>
                          {!filterActor && <Check size={13} className="option-check" />}
                        </button>

                        <button
                          type="button"
                          className={`user-option-item ${filterActor === "system" ? "selected" : ""}`}
                          onClick={() => {
                            setFilterActor("system");
                            setUserDropdownOpen(false);
                            setPage(1);
                          }}
                        >
                          <div className="user-option-avatar system-icon">
                            <Server size={12} />
                          </div>
                          <div className="user-option-info">
                            <span className="user-option-name">系统内部操作</span>
                            <span className="user-option-sub">system / 定时任务</span>
                          </div>
                          {filterActor === "system" && <Check size={13} className="option-check" />}
                        </button>

                        {filteredUsers.length === 0 && (
                          <div className="user-popover-empty">未匹配到用户</div>
                        )}

                        {filteredUsers.map((u) => {
                          const isSelected = filterActor === u.username || filterActor === u.id;
                          return (
                            <button
                              key={u.id}
                              type="button"
                              className={`user-option-item ${isSelected ? "selected" : ""}`}
                              onClick={() => {
                                setFilterActor(u.username);
                                setUserDropdownOpen(false);
                                setPage(1);
                              }}
                            >
                              <div className="user-option-avatar">
                                {u.avatarDataUrl ? (
                                  <img src={u.avatarDataUrl} alt={u.username} />
                                ) : (
                                  <span>{u.displayName?.[0] || u.username[0] || "U"}</span>
                                )}
                              </div>
                              <div className="user-option-info">
                                <span className="user-option-name">{u.displayName}</span>
                                <span className="user-option-sub">@{u.username}</span>
                              </div>
                              {isSelected && <Check size={13} className="option-check" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="audit-time-pills">
                {(
                  [
                    ["all", "全部"],
                    ["1h", "1小时"],
                    ["24h", "24h"],
                    ["7d", "7天"],
                    ["30d", "30天"],
                    ["custom", "自定义"]
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`time-pill ${timePreset === key ? "active" : ""}`}
                    onClick={() => {
                      setTimePreset(key);
                      setPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {timePreset === "custom" && (
                <div className="audit-inline-custom-time">
                  <input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => {
                      setCustomFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                  <span>-</span>
                  <input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => {
                      setCustomTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              )}

              <div className="audit-bar-actions">
                <button
                  type="button"
                  className={`small-button secondary ${showAdvancedFilters ? "active" : ""}`}
                  onClick={() => setShowAdvancedFilters((prev) => !prev)}
                >
                  <Filter size={13} />
                  筛选
                  {activeFilterCount > 0 && <span className="filter-count-dot">{activeFilterCount}</span>}
                </button>

                <div className="export-dropdown-wrapper">
                  <button
                    type="button"
                    className="small-button secondary"
                    disabled={total === 0 || exporting !== null}
                    onClick={() => setExportMenuOpen((prev) => !prev)}
                  >
                    <Download size={13} />
                    导出
                    <ChevronDown size={12} />
                  </button>
                  {exportMenuOpen && (
                    <div className="export-popover">
                      <button type="button" onClick={() => void handleExport("csv")}>
                        <FileSpreadsheet size={13} />
                        导出 CSV 表格
                      </button>
                      <button type="button" onClick={() => void handleExport("json")}>
                        <FileDown size={13} />
                        导出 JSON 结构
                      </button>
                    </div>
                  )}
                </div>

                {onAskSaki && (
                  <button type="button" className="small-button saki-outline-btn" onClick={openAuditSaki}>
                    <Sparkles size={13} />
                    Saki 审查
                  </button>
                )}

                {canDeleteLogs && (
                  <button
                    type="button"
                    className="small-button secondary icon-only"
                    title="保留策略与治理"
                    onClick={() => setRetentionModalOpen(true)}
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>
            </div>

            {showAdvancedFilters && (
              <div className="audit-advanced-filter-bar">
                <div className="filter-item">
                  <label>操作者</label>
                  <input
                    type="text"
                    placeholder="用户名 / ID / system"
                    value={filterActor}
                    list="actor-datalist"
                    onChange={(e) => {
                      setFilterActor(e.target.value);
                      setPage(1);
                    }}
                  />
                  <datalist id="actor-datalist">
                    <option value="system">系统内部操作 (system)</option>
                    {(facets.users || []).map((u) => (
                      <option key={u.id} value={u.username}>
                        {u.displayName} (@{u.username})
                      </option>
                    ))}
                  </datalist>
                </div>

                <div className="filter-item">
                  <label>来源 IP</label>
                  <input
                    type="text"
                    placeholder="如 127.0.0.1"
                    value={filterIp}
                    onChange={(e) => {
                      setFilterIp(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>

                <div className="filter-item">
                  <label>资源类型</label>
                  <select
                    value={filterResourceType}
                    onChange={(e) => {
                      setFilterResourceType(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    <option value="saki">Saki</option>
                    <option value="file">文件</option>
                    <option value="instance_file">实例文件</option>
                    <option value="instance">实例</option>
                    <option value="user">用户</option>
                    <option value="role">角色</option>
                    <option value="node">节点</option>
                    <option value="task">任务</option>
                    <option value="template">模板</option>
                    <option value="audit">审计</option>
                    <option value="system">系统</option>
                  </select>
                </div>

                <div className="filter-item">
                  <label>资源 ID</label>
                  <input
                    type="text"
                    placeholder="资源 ID"
                    value={filterResourceId}
                    onChange={(e) => {
                      setFilterResourceId(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>

                <div className="filter-item">
                  <label>动作代码</label>
                  <input
                    type="text"
                    list="action-datalist"
                    placeholder="如 saki.chat / file.write"
                    value={filterAction}
                    onChange={(e) => {
                      setFilterAction(e.target.value);
                      setPage(1);
                    }}
                  />
                  <datalist id="action-datalist">
                    {Object.entries(auditActionLabels).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label} ({code})
                      </option>
                    ))}
                  </datalist>
                </div>

                <div className="filter-item">
                  <label>结果</label>
                  <select
                    value={filterResult}
                    onChange={(e) => {
                      setFilterResult(e.target.value as any);
                      setPage(1);
                    }}
                  >
                    <option value="">全部</option>
                    <option value="SUCCESS">仅成功</option>
                    <option value="FAILURE">仅失败</option>
                  </select>
                </div>

                {activeFilterCount > 0 && (
                  <button type="button" className="small-button secondary reset-btn" onClick={resetFilters}>
                    <RotateCcw size={12} />
                    重置
                  </button>
                )}
              </div>
            )}

            <div className={`audit-layout-grid ${!isMobile && sidebarOpen && activeLog ? "has-sidebar" : ""}`}>
              <div className="audit-table-card">
                {controlledDeleteMode && canDeleteLogs && (
                  <div className="audit-controlled-bar">
                    <span>受控删除模式：已选 <strong>{selectedLogIds.length}</strong> 条记录</span>
                    <div className="controlled-btns">
                      <button
                        type="button"
                        className="small-button danger-action mini"
                        disabled={selectedLogIds.length === 0}
                        onClick={() => {
                          setDeleteConfirmModal({
                            type: "batch",
                            targetIds: [...selectedLogIds]
                          });
                        }}
                      >
                        <Trash2 size={12} />
                        删除选中 ({selectedLogIds.length})
                      </button>
                      <button
                        type="button"
                        className="small-button secondary mini"
                        onClick={() => {
                          setDeleteConfirmModal({
                            type: "clear"
                          });
                        }}
                      >
                        清空历史
                      </button>
                      <button
                        type="button"
                        className="small-button secondary mini"
                        onClick={() => setControlledDeleteMode(false)}
                      >
                        退出
                      </button>
                    </div>
                  </div>
                )}

                {logs.length === 0 ? (
                  <div style={{ padding: "48px 0" }}>
                    <SakiEmptyState
                      illustration="logs"
                      title="暂无审计事件"
                      description={activeFilterCount > 0 ? "未找到符合当前条件的审计事件，请调整筛选条件。" : "系统暂无审计事件产生。"}
                    />
                  </div>
                ) : (
                  <div className="audit-table-wrap">
                    <table className="audit-clean-table">
                      <thead>
                        <tr>
                          {controlledDeleteMode && canDeleteLogs && (
                            <th className="th-chk">
                              <input
                                type="checkbox"
                                checked={allPageSelected}
                                onChange={toggleSelectAllPage}
                                aria-label="全选"
                              />
                            </th>
                          )}
                          <th className="th-sort th-time" onClick={() => handleSort("createdAt")}>
                            时间 {sortBy === "createdAt" && (sortOrder === "asc" ? "↑" : "↓")}
                          </th>
                          <th className="th-sort th-status" onClick={() => handleSort("result")}>
                            状态 {sortBy === "result" && (sortOrder === "asc" ? "↑" : "↓")}
                          </th>
                          <th className="th-sort th-action" onClick={() => handleSort("action")}>
                            动作 {sortBy === "action" && (sortOrder === "asc" ? "↑" : "↓")}
                          </th>
                          <th className="th-sort th-actor" onClick={() => handleSort("actor")}>
                            操作者 {sortBy === "actor" && (sortOrder === "asc" ? "↑" : "↓")}
                          </th>
                          <th className="th-sort th-resource" onClick={() => handleSort("resourceType")}>
                            资源目标 {sortBy === "resourceType" && (sortOrder === "asc" ? "↑" : "↓")}
                          </th>
                          <th className="th-sort th-ip" onClick={() => handleSort("ip")}>
                            来源 IP / 摘要 {sortBy === "ip" && (sortOrder === "asc" ? "↑" : "↓")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log) => {
                          const isSuccess = log.result === "SUCCESS";
                          const isSelected = activeLog?.id === log.id;
                          const failureReason = !isSuccess ? extractFailureReason(log) : null;
                          const briefSummary = extractBriefSummary(log);

                          return (
                            <tr
                              key={log.id}
                              className={`audit-row ${isSelected ? "selected" : ""} ${!isSuccess ? "is-failed" : ""}`}
                              onClick={() => {
                                setSelectedLogId(log.id);
                                setSidebarOpen(true);
                              }}
                            >
                              {controlledDeleteMode && canDeleteLogs && (
                                <td className="td-chk" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={selectedLogIds.includes(log.id)}
                                    onChange={() => toggleSelectLog(log.id)}
                                  />
                                </td>
                              )}

                              <td className="td-time">
                                <span className="mono-time">{formatDate(log.createdAt)}</span>
                              </td>

                              <td className="td-status">
                                <span className={`status-dot-pill ${isSuccess ? "ok" : "err"}`}>
                                  {isSuccess ? "成功" : "失败"}
                                </span>
                              </td>

                              <td className="td-action">
                                <div className="action-inline">
                                  <span className="action-icon">
                                    {auditResourceIcon(log.resourceType, log.action)}
                                  </span>
                                  <span className="action-title">{auditActionLabel(log.action)}</span>
                                  <code className="action-code">{log.action}</code>
                                </div>
                              </td>

                              <td className="td-actor">
                                <div className="actor-inline">
                                  <span className="actor-name">{auditActor(log)}</span>
                                  <button
                                    type="button"
                                    className="row-filter-btn"
                                    title="仅看该操作者"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFilterActor(log.username ?? log.userId ?? "system");
                                      setPage(1);
                                    }}
                                  >
                                    <Filter size={10} />
                                  </button>
                                </div>
                              </td>

                              <td className="td-resource">
                                <div className="resource-inline">
                                  <span className="resource-pill">{log.resourceType || "system"}</span>
                                  {log.resourceId && (
                                    <code className="resource-id" title={log.resourceId}>
                                      {log.resourceId.slice(0, 10)}
                                    </code>
                                  )}
                                  <button
                                    type="button"
                                    className="row-filter-btn"
                                    title="仅看该资源"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFilterResourceType(log.resourceType);
                                      if (log.resourceId) setFilterResourceId(log.resourceId);
                                      setPage(1);
                                    }}
                                  >
                                    <Filter size={10} />
                                  </button>
                                </div>
                              </td>

                              <td className="td-summary">
                                <div className="summary-inline">
                                  <span className="ip-val">{log.ip || "-"}</span>
                                  <span className={`summary-val ${!isSuccess ? "err-val" : ""}`}>
                                    {failureReason || briefSummary}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="audit-footer-pagination">
                  <div className="pagination-meta">
                    <span>每页</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      <option value="15">15 条</option>
                      <option value="25">25 条</option>
                      <option value="50">50 条</option>
                      <option value="100">100 条</option>
                    </select>
                    <span className="total-span">共 {total} 条记录</span>
                  </div>

                  <div className="pagination-controls">
                    <button
                      type="button"
                      className="page-nav-btn"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    >
                      <ChevronLeft size={13} />
                      上一页
                    </button>
                    <span className="page-indicator">
                      第 {page} / {totalPages} 页
                    </span>
                    <button
                      type="button"
                      className="page-nav-btn"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    >
                      下一页
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {!isMobile && sidebarOpen && activeLog && (
                <aside className="audit-drawer-pane">
                  {renderDrawerInner(activeLog)}
                </aside>
              )}
            </div>

            {isMobile && sidebarOpen && activeLog && typeof document !== "undefined" && createPortal(
              <div className="audit-mobile-fullscreen-overlay">
                <div className="audit-mobile-fullscreen-drawer">
                  {renderDrawerInner(activeLog)}
                </div>
              </div>,
              document.body
            )}
          </>
        )}

        {activeTab === "saki_conversations" && isSuperAdmin && (
          <div className="audit-saki-conversations-view">
            <div className="saki-conv-toolbar">
              <div className="audit-search-row">
                <div className="audit-search-field">
                  <Search size={14} className="search-icon" />
                  <input
                    type="text"
                    placeholder="搜索会话标题、消息文本、用户、环境..."
                    value={sakiConvKeyword}
                    onChange={(e) => {
                      setSakiConvKeyword(e.target.value);
                      setSakiConvPage(1);
                    }}
                  />
                  {sakiConvKeyword && (
                    <button type="button" className="clear-btn" onClick={() => setSakiConvKeyword("")}>
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div className="user-filter-wrapper" ref={sakiUserDropdownRef}>
                  <button
                    type="button"
                    className={`small-button user-filter-btn ${sakiConvUser ? "has-user" : "secondary"}`}
                    onClick={() => setSakiConvUserDropdownOpen((prev) => !prev)}
                  >
                    <Users size={13} />
                    <span className="user-filter-label">
                      {sakiConvUser
                        ? selectedSakiConvUser
                          ? `用户: ${selectedSakiConvUser.displayName}`
                          : `用户: ${sakiConvUser}`
                        : "全部用户"}
                    </span>
                    {sakiConvUser ? (
                      <span
                        className="clear-user-x"
                        title="清除用户筛选"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSakiConvUser("");
                          setSakiConvPage(1);
                        }}
                      >
                        <X size={12} />
                      </span>
                    ) : (
                      <ChevronDown size={12} />
                    )}
                  </button>

                  {sakiConvUserDropdownOpen && (
                    <div className="user-filter-popover">
                      <div className="user-popover-search">
                        <Search size={12} />
                        <input
                          type="text"
                          placeholder="搜索用户名或昵称..."
                          value={sakiConvUserSearch}
                          onChange={(e) => setSakiConvUserSearch(e.target.value)}
                          autoFocus
                        />
                      </div>

                      <div className="user-popover-list">
                        <button
                          type="button"
                          className={`user-option-item ${!sakiConvUser ? "selected" : ""}`}
                          onClick={() => {
                            setSakiConvUser("");
                            setSakiConvUserDropdownOpen(false);
                            setSakiConvPage(1);
                          }}
                        >
                          <div className="user-option-avatar all-users-icon">
                            <Users size={12} />
                          </div>
                          <div className="user-option-info">
                            <span className="user-option-name">全部用户对话</span>
                            <span className="user-option-sub">跨所有用户</span>
                          </div>
                          {!sakiConvUser && <Check size={13} className="option-check" />}
                        </button>

                        {filteredSakiUsers.map((u) => {
                          const isSelected = sakiConvUser === u.username || sakiConvUser === u.id;
                          return (
                            <button
                              key={u.id}
                              type="button"
                              className={`user-option-item ${isSelected ? "selected" : ""}`}
                              onClick={() => {
                                setSakiConvUser(u.username);
                                setSakiConvUserDropdownOpen(false);
                                setSakiConvPage(1);
                              }}
                            >
                              <div className="user-option-avatar">
                                {u.avatarDataUrl ? (
                                  <img src={u.avatarDataUrl} alt={u.username} />
                                ) : (
                                  <span>{u.displayName?.[0] || u.username[0] || "U"}</span>
                                )}
                              </div>
                              <div className="user-option-info">
                                <span className="user-option-name">{u.displayName}</span>
                                <span className="user-option-sub">@{u.username}</span>
                              </div>
                              {isSelected && <Check size={13} className="option-check" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="audit-time-pills">
                {(
                  [
                    ["all", "全部"],
                    ["24h", "24h"],
                    ["7d", "7天"],
                    ["30d", "30天"],
                    ["custom", "自定义"]
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`time-pill ${sakiConvTimePreset === key ? "active" : ""}`}
                    onClick={() => {
                      setSakiConvTimePreset(key);
                      setSakiConvPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {sakiConvTimePreset === "custom" && (
                <div className="audit-inline-custom-time">
                  <input
                    type="datetime-local"
                    value={sakiConvCustomFrom}
                    onChange={(e) => {
                      setSakiConvCustomFrom(e.target.value);
                      setSakiConvPage(1);
                    }}
                  />
                  <span>-</span>
                  <input
                    type="datetime-local"
                    value={sakiConvCustomTo}
                    onChange={(e) => {
                      setSakiConvCustomTo(e.target.value);
                      setSakiConvPage(1);
                    }}
                  />
                </div>
              )}

              <button
                type="button"
                className="small-button secondary"
                onClick={() => void fetchSakiConversations()}
                disabled={sakiConvLoading}
              >
                <RefreshCw size={13} className={sakiConvLoading ? "spin" : ""} />
                刷新
              </button>
            </div>

            {sakiConvLoading ? (
              <div style={{ padding: "48px 0", textAlign: "center", color: "var(--muted)" }}>
                正在加载 Saki 对话记录...
              </div>
            ) : sakiConversations.length === 0 ? (
              <div style={{ padding: "48px 0" }}>
                <SakiEmptyState
                  illustration="logs"
                  title="暂无 Saki 对话记录"
                  description="未检索到符合条件的用户与 Saki 聊天记录。"
                />
              </div>
            ) : (
              <div className="saki-conversations-grid">
                {sakiConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="saki-conversation-card"
                    onClick={() => {
                      setSelectedSakiConv(conv);
                      setSakiConvDrawerOpen(true);
                    }}
                  >
                    <div className="conv-card-header">
                      <div className="conv-user-info">
                        <div className="conv-avatar">
                          {conv.avatarDataUrl ? (
                            <img src={conv.avatarDataUrl} alt={conv.username} />
                          ) : (
                            <span>{conv.displayName?.[0] || conv.username[0] || "U"}</span>
                          )}
                        </div>
                        <div className="conv-user-text">
                          <span className="conv-user-name">{conv.displayName}</span>
                          <span className="conv-user-sub">@{conv.username}</span>
                        </div>
                      </div>

                      <div className="conv-badges">
                        <span className="conv-msg-badge">
                          <MessageSquare size={11} />
                          {conv.messageCount} 条对话
                        </span>
                      </div>
                    </div>

                    <div className="conv-card-title">
                      <h4>{conv.title}</h4>
                      {conv.instanceName ? (
                        <span className="conv-env-tag">
                          <Server size={10} />
                          {conv.instanceName}
                        </span>
                      ) : conv.contextKey ? (
                        <span className="conv-env-tag">
                          <FolderGit2 size={10} />
                          {conv.contextKey}
                        </span>
                      ) : null}
                    </div>

                    {conv.lastMessagePreview && (
                      <div className="conv-card-preview">
                        <span>{conv.lastMessagePreview}</span>
                      </div>
                    )}

                    <div className="conv-card-footer">
                      <span className="conv-time">
                        <Clock size={11} />
                        {formatDate(conv.updatedAt)}
                      </span>
                      <button type="button" className="conv-view-btn">
                        查看完整对话
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sakiConvTotalPages > 1 && (
              <div className="audit-footer-pagination" style={{ marginTop: "16px" }}>
                <div className="pagination-meta">
                  <span>共 {sakiConvTotal} 个对话会话</span>
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="page-nav-btn"
                    disabled={sakiConvPage <= 1 || sakiConvLoading}
                    onClick={() => setSakiConvPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={13} />
                    上一页
                  </button>
                  <span className="page-indicator">
                    第 {sakiConvPage} / {sakiConvTotalPages} 页
                  </span>
                  <button
                    type="button"
                    className="page-nav-btn"
                    disabled={sakiConvPage >= sakiConvTotalPages || sakiConvLoading}
                    onClick={() => setSakiConvPage((p) => Math.min(sakiConvTotalPages, p + 1))}
                  >
                    下一页
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {retentionModalOpen && retention && typeof document !== "undefined" && createPortal(
          <div className="audit-modal-overlay" onClick={() => setRetentionModalOpen(false)}>
            <div className="audit-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>审计日志保留策略与治理</h3>
                <button type="button" className="icon-button mini" onClick={() => setRetentionModalOpen(false)}>
                  <X size={14} />
                </button>
              </div>

              <form onSubmit={handleSaveRetention}>
                <div className="modal-body-fields">
                  <div className="form-group">
                    <label>日志保留天数 (0 表示永久保留)</label>
                    <input
                      type="number"
                      min="0"
                      max="3650"
                      value={retention.retentionDays}
                      onChange={(e) =>
                        setRetention({ ...retention, retentionDays: Math.max(0, parseInt(e.target.value, 10) || 0) })
                      }
                    />
                    <small>超过保留天数的常规审计日志将被自动标记并根据规则清理。</small>
                  </div>

                  <div className="form-group-checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={retention.autoCleanupEnabled}
                        onChange={(e) => setRetention({ ...retention, autoCleanupEnabled: e.target.checked })}
                      />
                      启用后台自动定时清理过期日志 (每 12 小时检查一次)
                    </label>
                  </div>

                  <div className="form-group-checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={retention.protectAuditTrailLogs}
                        onChange={(e) => setRetention({ ...retention, protectAuditTrailLogs: e.target.checked })}
                      />
                      强制保护审计治理日志 (禁止自动与手动删除任何 audit.* 记录以防篡改)
                    </label>
                  </div>

                  <div className="form-group-checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={retention.protectFailureLogs}
                        onChange={(e) => setRetention({ ...retention, protectFailureLogs: e.target.checked })}
                      />
                      保留所有失败/异常操作记录 (不随常规策略自动清除)
                    </label>
                  </div>

                  <div className="form-group-checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={retention.allowManualDelete}
                        onChange={(e) => setRetention({ ...retention, allowManualDelete: e.target.checked })}
                      />
                      允许超级管理员在界面手动勾选删除记录
                    </label>
                  </div>

                  {retention.lastCleanupAt && (
                    <div className="cleanup-history-box">
                      <span>上次自动/手动清理：{formatDate(retention.lastCleanupAt)}</span>
                      <span>已清理数量：{retention.lastCleanupDeleted ?? 0} 条</span>
                    </div>
                  )}
                </div>

                <div className="modal-actions-bar">
                  <button
                    type="button"
                    className="small-button danger-action mini"
                    disabled={cleaningExpired}
                    onClick={handleImmediateCleanup}
                  >
                    <Trash2 size={12} />
                    立即执行过期清理
                  </button>

                  <div className="actions-right">
                    <button
                      type="button"
                      className="small-button secondary"
                      onClick={() => setRetentionModalOpen(false)}
                    >
                      取消
                    </button>
                    <button type="submit" className="small-button primary" disabled={savingRetention}>
                      {savingRetention ? "保存中..." : "保存策略"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

        {deleteConfirmModal && typeof document !== "undefined" && createPortal(
          <div className="audit-modal-overlay" onClick={() => setDeleteConfirmModal(null)}>
            <div className="audit-modal-content delete-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>确认删除审计日志留证</h3>
                <button type="button" className="icon-button mini" onClick={() => setDeleteConfirmModal(null)}>
                  <X size={14} />
                </button>
              </div>

              <div className="modal-body-fields">
                <div className="delete-warning-text">
                  <AlertTriangle size={16} />
                  <span>
                    {deleteConfirmModal.type === "single" && "即将永久删除该条审计日志。此操作不可逆。"}
                    {deleteConfirmModal.type === "batch" &&
                      `即将永久删除选中的 ${deleteConfirmModal.targetIds?.length ?? 0} 条审计日志。此操作不可逆。`}
                    {deleteConfirmModal.type === "clear" &&
                      "即将清空全部历史审计日志（受保护的治理日志将自动保留）。"}
                  </span>
                </div>

                <div className="form-group">
                  <label>操作原因与批注 (必填，将作为治理留证记录)</label>
                  <input
                    type="text"
                    placeholder="如：合规归档清理、测试数据移除..."
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                  />
                </div>

                {deleteConfirmModal.type === "clear" && (
                  <div className="form-group">
                    <label>请输入 "CLEAR" 以确认清空全部</label>
                    <input
                      type="text"
                      placeholder="CLEAR"
                      value={deleteChallengeInput}
                      onChange={(e) => setDeleteChallengeInput(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="modal-actions-bar right-align">
                <button type="button" className="small-button secondary" onClick={() => setDeleteConfirmModal(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className="small-button danger-action"
                  disabled={
                    deleting ||
                    !deleteReason.trim() ||
                    (deleteConfirmModal.type === "clear" && deleteChallengeInput !== "CLEAR")
                  }
                  onClick={executeDelete}
                >
                  {deleting ? "删除中..." : "确认删除"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {previewFile && (
          <FilePreviewModal
            token={token}
            instanceId={previewFile.instanceId}
            filePath={previewFile.filePath}
            actionName={previewFile.actionName}
            onClose={() => setPreviewFile(null)}
            darkMode={darkMode}
          />
        )}

        {sakiConvDrawerOpen && selectedSakiConv && typeof document !== "undefined" && createPortal(
          <div className="audit-saki-dialogue-modal-overlay" onClick={() => setSakiConvDrawerOpen(false)}>
            <div
              className={`audit-saki-dialogue-modal ${sakiModalFullscreen ? "is-fullscreen" : ""}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dialogue-modal-header">
                <div className="header-left">
                  <div className="user-avatar-large">
                    {selectedSakiConv.avatarDataUrl ? (
                      <img src={selectedSakiConv.avatarDataUrl} alt={selectedSakiConv.username} />
                    ) : (
                      <span>{selectedSakiConv.displayName?.[0] || selectedSakiConv.username[0] || "U"}</span>
                    )}
                  </div>
                  <div className="header-title-box">
                    <h3>{selectedSakiConv.title}</h3>
                    <div className="dialogue-meta-line">
                      <span>用户: <strong>{selectedSakiConv.displayName}</strong> (@{selectedSakiConv.username})</span>
                      <span className="meta-divider">•</span>
                      <span>环境: {selectedSakiConv.instanceName || selectedSakiConv.contextKey || "全局"}</span>
                      <span className="meta-divider">•</span>
                      <span>最后更新: {formatDate(selectedSakiConv.updatedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="header-actions">
                  <button
                    type="button"
                    className="small-button secondary mini copy-action-btn"
                    onClick={() => copyConversationTranscript(selectedSakiConv, "markdown")}
                    title="复制为 Markdown 记录"
                  >
                    {copiedKey === `saki-conv-md-${selectedSakiConv.id}` ? <Check size={12} className="copied" /> : <Copy size={12} />}
                    <span className="btn-text-responsive">复制 Markdown</span>
                  </button>
                  <button
                    type="button"
                    className="small-button secondary mini copy-action-btn"
                    onClick={() => copyConversationTranscript(selectedSakiConv, "json")}
                    title="复制为 JSON"
                  >
                    {copiedKey === `saki-conv-${selectedSakiConv.id}` ? <Check size={12} className="copied" /> : <FileCode size={12} />}
                    <span className="btn-text-responsive">复制 JSON</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button maximize-toggle-btn"
                    title={sakiModalFullscreen ? "还原窗口" : "最大化全屏"}
                    onClick={() => setSakiModalFullscreen((prev) => !prev)}
                  >
                    {sakiModalFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="关闭"
                    onClick={() => setSakiConvDrawerOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="dialogue-modal-body">
                <div className="saki-transcript-flow">
                  {selectedSakiConv.messages.length === 0 ? (
                    <div className="empty-flow">本会话暂无消息内容</div>
                  ) : (
                    selectedSakiConv.messages.map((msg, idx) => {
                      const isUser = msg.role === "user";
                      return (
                        <div key={idx} className={`transcript-bubble-row ${isUser ? "user" : "assistant"}`}>
                          <div className="bubble-avatar">
                            {isUser ? (
                              selectedSakiConv.avatarDataUrl ? (
                                <img src={selectedSakiConv.avatarDataUrl} alt={selectedSakiConv.username} />
                              ) : (
                                <span>{selectedSakiConv.displayName?.[0] || "U"}</span>
                              )
                            ) : (
                              <Sparkles size={16} />
                            )}
                          </div>

                          <div className="bubble-body">
                            <div className="bubble-meta">
                              <span className="bubble-name">{isUser ? selectedSakiConv.displayName : "Saki"}</span>
                              {msg.timestamp && (
                                <span className="bubble-timestamp">{formatDate(msg.timestamp)}</span>
                              )}
                              {msg.model && (
                                <span className="bubble-model-tag">{msg.model}</span>
                              )}
                            </div>

                            {msg.thinking && (
                              <details className="saki-thinking-collapse">
                                <summary>
                                  <Sparkles size={11} />
                                  深度思考过程 (Thinking Trace)
                                </summary>
                                <div className="thinking-content">{msg.thinking}</div>
                              </details>
                            )}

                            <div className="bubble-text">{msg.content}</div>

                            {Array.isArray(msg.actions) && msg.actions.length > 0 && (
                              <div className="bubble-actions-container">
                                <span className="actions-title">执行的操作步骤:</span>
                                {msg.actions.map((act: any, aIdx: number) => (
                                  <div key={aIdx} className="action-step-item">
                                    <div className="step-head">
                                      <code className="step-tool">{act.tool || act.name}</code>
                                      <span className={`step-badge ${act.ok ? "ok" : "err"}`}>
                                        {act.ok ? "成功" : "失败"}
                                      </span>
                                    </div>
                                    {act.args && (
                                      <pre className="step-args">{JSON.stringify(act.args, null, 2)}</pre>
                                    )}
                                    {act.observation && (
                                      <pre className="step-obs">{act.observation}</pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </>
  );
}
