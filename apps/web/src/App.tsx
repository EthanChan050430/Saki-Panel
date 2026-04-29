import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor, languageFromFileName } from "./CodeEditor.js";
import {
  Activity,
  Archive,
  Bug,
  Camera,
  ChartNetwork,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ClipboardList,
  Code2,
  CornerUpLeft,
  Cpu,
  Download,
  DownloadCloud,
  Eye,
  FileArchive,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Github,
  HardDrive,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  List,
  Loader2,
  LogIn,
  LogOut,
  Maximize2,
  MemoryStick,
  Mic,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Send,
  Server,
  Shield,
  ShieldCheck,
  Settings,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  TextQuote,
  Trash2,
  Upload,
  UserCheck,
  UserCog,
  UserRound,
  Wifi,
  WifiOff,
  Wrench,
  X,
  XOctagon
} from "lucide-react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type {
  AuditLogEntry,
  CreateNodeRequest,
  CreateSakiSkillRequest,
  CreateUserRequest,
  CreateInstanceRequest,
  CurrentUser,
  DashboardOverview,
  InstanceAssignee,
  InstanceFileEntry,
  InstanceLogLine,
  InstanceTemplate,
  InstanceStatus,
  ManagedInstance,
  ManagedNode,
  ManagedRole,
  ManagedScheduledTask,
  ManagedTaskRun,
  ManagedUser,
  PanelAppearanceSettings,
  PermissionCode,
  RestartPolicy,
  SakiChatMessage,
  SakiAgentAction,
  SakiChatMode,
  SakiInputAttachment,
  SakiConfigResponse,
  SakiSkillDetail,
  SakiModelOption,
  SakiProviderConfig,
  SakiSkillSummary,
  UpdateCurrentUserRequest,
  UpdateUserRequest,
  UpdateSakiSkillRequest,
  UpdateNodeRequest,
  UpdateSakiConfigRequest,
  ScheduledTaskType,
  TerminalServerMessage
} from "@webops/shared";
import { noRolePermissionRoleName, permissions } from "@webops/shared";
import { ApiError, api, type SakiChatStreamEvent, type SakiChatWorkflowStatus, type UploadProgressUpdate } from "./api.js";

const tokenKey = "webops.token";
const rememberedLoginKey = "webops.rememberedLogin";
const defaultStartCommand = "node -e \"let i=0; setInterval(()=>console.log('tick '+(++i)),1000)\"";

const defaultPanelAppearance: PanelAppearanceSettings = {
  appTitle: "Saki Panel",
  appSubtitle: "System Administration",
  appLogoSrc: "/assets/saki-panel-icon.png",
  loginCoverSrc: "/assets/cover.png",
  backgroundSrc: "/assets/background.png",
  mobileBackgroundSrc: "/assets/background_mobile.png"
};

type ViewMode = "dashboard" | "instances" | "nodes" | "templates" | "users" | "audit" | "settings" | "about";
type InstanceDirectoryView = "cards" | "list" | "graph";

interface SakiPromptSeed {
  message: string;
  panelError?: string;
  contextTitle?: string;
  contextText?: string;
  clearInstance?: boolean;
  mode?: SakiChatMode;
  nonce: number;
}

interface SakiPanelContext {
  label: string;
  detail: string;
  auditSearch?: boolean;
}

interface RememberedLogin {
  username: string;
  password: string;
}

function normalizePanelAppearance(input?: Partial<PanelAppearanceSettings> | null): PanelAppearanceSettings {
  return {
    ...defaultPanelAppearance,
    ...(input ?? {}),
    appTitle: input?.appTitle?.trim() || defaultPanelAppearance.appTitle,
    appSubtitle: input?.appSubtitle ?? defaultPanelAppearance.appSubtitle,
    appLogoSrc: input?.appLogoSrc?.trim() || defaultPanelAppearance.appLogoSrc,
    loginCoverSrc: input?.loginCoverSrc?.trim() || defaultPanelAppearance.loginCoverSrc,
    backgroundSrc: input?.backgroundSrc?.trim() || defaultPanelAppearance.backgroundSrc,
    mobileBackgroundSrc: input?.mobileBackgroundSrc?.trim() || defaultPanelAppearance.mobileBackgroundSrc
  };
}

function cssImageUrl(source: string): string {
  return `url("${source.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

function applyPanelAppearance(appearance: PanelAppearanceSettings): void {
  document.documentElement.style.setProperty("--app-background-image", cssImageUrl(appearance.backgroundSrc));
  document.documentElement.style.setProperty("--mobile-background-image", cssImageUrl(appearance.mobileBackgroundSrc));
  document.documentElement.style.setProperty("--login-cover-image", cssImageUrl(appearance.loginCoverSrc));
  document.title = appearance.appTitle || defaultPanelAppearance.appTitle;
}

function tokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(window.atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = window.localStorage.getItem(rememberedLoginKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (typeof parsed.username !== "string" || typeof parsed.password !== "string") return null;
    return {
      username: parsed.username,
      password: parsed.password
    };
  } catch {
    return null;
  }
}

function saveRememberedLogin(username: string, password: string): void {
  window.localStorage.setItem(rememberedLoginKey, JSON.stringify({ username, password }));
}

function clearRememberedLogin(): void {
  window.localStorage.removeItem(rememberedLoginKey);
}

interface LocalSakiWorkflowStep {
  id: string;
  stage: string;
  message: string;
  status: SakiChatWorkflowStatus;
  tool?: string;
  call?: string;
  actionId?: string;
  detail?: string;
  createdAt: string;
}

interface LocalSakiMessage extends SakiChatMessage {
  id: string;
  source?: "direct-model" | "local-fallback";
  actions?: SakiAgentAction[];
  attachments?: SakiInputAttachment[];
  workflow?: LocalSakiWorkflowStep[];
  workflowExpanded?: boolean;
  rollbackGroupExpanded?: boolean;
  streaming?: boolean;
}

interface SakiSubmitOverride {
  message?: string;
  panelError?: string | null;
  contextTitle?: string | null;
  contextText?: string | null;
  mode?: SakiChatMode;
  attachments?: SakiInputAttachment[];
}

function createSakiWelcomeMessage(content: string): LocalSakiMessage {
  return {
    id: "saki-welcome",
    role: "assistant",
    content,
    createdAt: new Date().toISOString()
  };
}

function isSakiModeAllowed(mode: SakiChatMode, canUseChat: boolean, canUseAgent: boolean): boolean {
  return mode === "agent" ? canUseAgent : canUseChat;
}

function coerceSakiMode(mode: SakiChatMode | undefined, canUseChat: boolean, canUseAgent: boolean): SakiChatMode {
  if (mode && isSakiModeAllowed(mode, canUseChat, canUseAgent)) return mode;
  return canUseChat ? "chat" : "agent";
}

function formatSakiActionArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "()";
  return `(${entries
    .map(([key, value]) => `${key}: ${compactContextText(typeof value === "string" ? value.replace(/\s+/g, " ") : JSON.stringify(value) ?? String(value), 120)}`)
    .join(", ")})`;
}

function sakiHistoryContent(message: LocalSakiMessage): string {
  const sections = [message.content];
  const attachmentSummary = sakiAttachmentHistoryText(message.attachments);
  if (attachmentSummary) {
    sections.push(`[User attachments]\n${attachmentSummary}`);
  }
  if (message.actions?.length) {
    const actionSummary = message.actions
      .map((action, index) => {
        const args = formatSakiActionArgs(action.args);
        const status = action.ok ? "ok" : "failed";
        return `${index + 1}. ${action.tool}${args}: ${status}. ${compactContextText(action.observation.replace(/\s+/g, " "), 240)}`;
      })
      .join("\n");
    sections.push(`[Agent actions from this reply]\n${actionSummary}`);
  }
  return sections.join("\n\n");
}

function toSakiHistoryMessage(message: LocalSakiMessage): SakiChatMessage {
  const content = sakiHistoryContent(message);
  return message.createdAt
    ? {
        role: message.role,
        content,
        createdAt: message.createdAt
      }
    : {
        role: message.role,
        content
      };
}

function isTerminalIssue(line: InstanceLogLine): boolean {
  return (
    line.stream === "stderr" ||
    /error|exception|failed|failure|traceback|fatal|panic|enoent|eaddrinuse|eacces|refused|timeout/i.test(line.text)
  );
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function taskTypeLabel(type: ScheduledTaskType): string {
  const labels: Record<ScheduledTaskType, string> = {
    run_command: "执行命令",
    restart_instance: "重启实例",
    stop_instance: "停止实例",
    start_instance: "启动实例"
  };
  return labels[type];
}

function restartPolicyLabel(policy: RestartPolicy): string {
  const labels: Record<RestartPolicy, string> = {
    never: "不自动重启",
    on_failure: "异常退出重启",
    always: "总是重启",
    fixed_interval: "固定间隔重启"
  };
  return labels[policy];
}

function nodeEndpointLabel(node?: ManagedNode | null): string {
  if (!node) return "";
  return `${node.name} · ${node.protocol}://${node.host}:${node.port}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${Math.round((value / 1024 / 1024) * 10) / 10} MB`;
}

const auditActionLabels: Record<string, string> = {
  "auth.login": "用户登录",
  "auth.login.rate_limited": "登录限流",
  "auth.logout": "退出登录",
  "auth.profile.update": "更新账户",
  "daemon.register": "节点注册",
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
  "settings.saki.update": "更新 Saki 设置",
  "task.create": "创建任务",
  "task.delete": "删除任务",
  "task.run": "执行任务",
  "task.update": "更新任务",
  "template.create": "创建模板",
  "terminal.input": "终端输入",
  "user.create": "创建用户",
  "user.switch": "切换账号",
  "user.update": "更新用户"
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

function compactContextText(value: string, maxLength = 1400): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...(已截断)` : value;
}

const sakiMaxInputAttachments = 6;
const sakiTextAttachmentLimit = 18000;
const sakiImageMaxDimension = 1280;
const sakiImageQuality = 0.82;
const sakiInstanceFileDragMime = "application/x-webops-instance-file";
const sakiSelectionContextLimit = 12000;

interface SakiSelectionCapture {
  source: "page" | "terminal";
  title: string;
  text: string;
}

let latestSakiTerminalSelectionText = "";

function normalizeSakiSelectionText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

function rememberSakiTerminalSelection(value: string): void {
  latestSakiTerminalSelectionText = normalizeSakiSelectionText(value);
}

function clearRememberedSakiTerminalSelection(): void {
  latestSakiTerminalSelectionText = "";
}

function targetIsInsideSelector(target: EventTarget | null, selector: string): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest(selector));
}

function readEditableSelectionText(target: EventTarget | null): string {
  const candidate =
    target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
      ? target
      : document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement
        ? document.activeElement
        : null;
  if (!candidate) return "";
  const start = candidate.selectionStart;
  const end = candidate.selectionEnd;
  if (start === null || end === null || start === end) return "";
  return normalizeSakiSelectionText(candidate.value.slice(Math.min(start, end), Math.max(start, end)));
}

function readBrowserSelectionText(target: EventTarget | null): string {
  const editableSelection = readEditableSelectionText(target);
  if (editableSelection) return editableSelection;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return "";
  return normalizeSakiSelectionText(selection.toString());
}

function readSakiSelectionCapture(target: EventTarget | null): SakiSelectionCapture | null {
  const terminalSelected = latestSakiTerminalSelectionText;
  const targetInsideTerminal = targetIsInsideSelector(target, ".xterm-host, .xterm");
  const activeInsideTerminal = targetIsInsideSelector(document.activeElement, ".xterm-host, .xterm");
  if (targetInsideTerminal && terminalSelected) {
    return {
      source: "terminal",
      title: "选中的终端文本",
      text: terminalSelected
    };
  }

  const pageSelected = readBrowserSelectionText(target);
  if (pageSelected) {
    return {
      source: "page",
      title: "选中的页面文本",
      text: pageSelected
    };
  }

  if (activeInsideTerminal && terminalSelected) {
    return {
      source: "terminal",
      title: "选中的终端文本",
      text: terminalSelected
    };
  }

  return null;
}

const sakiTextAttachmentExtensions = new Set([
  "c",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "py",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml"
]);

const imageMimeTypesByExtension: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jepg: "image/jpeg",
  jfif: "image/jpeg",
  jpg: "image/jpeg",
  pjpeg: "image/jpeg",
  pjp: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp"
};

interface SakiInstanceFileDragPayload {
  source: "webops-instance-file";
  instanceId: string;
  instanceName: string;
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

interface SakiInstanceFileDropRequest extends SakiInstanceFileDragPayload {
  nonce: number;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0?: {
    transcript?: string;
  };
}

interface BrowserSpeechRecognitionEvent extends Event {
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error?: string;
  message?: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  const win = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function sakiAttachmentKindLabel(kind: SakiInputAttachment["kind"]): string {
  if (kind === "screenshot") return "截图";
  if (kind === "image") return "图片";
  return "文件";
}

function sakiAttachmentSummary(attachment: SakiInputAttachment): string {
  const pieces = [sakiAttachmentKindLabel(attachment.kind), attachment.mimeType || "unknown"];
  if (typeof attachment.size === "number") pieces.push(formatBytes(attachment.size));
  if (attachment.width && attachment.height) pieces.push(`${attachment.width}x${attachment.height}`);
  return pieces.join(" · ");
}

function stripHeavySakiAttachmentData(attachment: SakiInputAttachment): SakiInputAttachment {
  const { dataUrl: _dataUrl, text: _text, ...rest } = attachment;
  return rest;
}

function persistableSakiMessages(messages: LocalSakiMessage[]): LocalSakiMessage[] {
  return messages.map((message) => {
    const { streaming: _streaming, ...persisted } = message;
    return persisted.attachments?.length
      ? {
          ...persisted,
          attachments: persisted.attachments.map(stripHeavySakiAttachmentData)
        }
      : persisted;
  });
}

function hasPersistableSakiSpeech(messages: LocalSakiMessage[]): boolean {
  return messages.some((message) => message.id !== "saki-welcome" && message.content.trim().length > 0);
}

function sakiAttachmentHistoryText(attachments: SakiInputAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .map((attachment, index) => `${index + 1}. ${attachment.name} (${sakiAttachmentSummary(attachment)})`)
    .join("\n");
}

function hasSakiInstanceFileDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(sakiInstanceFileDragMime);
}

function parseSakiInstanceFileDragPayload(dataTransfer: DataTransfer): SakiInstanceFileDragPayload | null {
  try {
    const raw = dataTransfer.getData(sakiInstanceFileDragMime);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SakiInstanceFileDragPayload>;
    if (
      parsed.source !== "webops-instance-file" ||
      !parsed.instanceId ||
      !parsed.path ||
      !parsed.name ||
      typeof parsed.size !== "number" ||
      !parsed.modifiedAt
    ) {
      return null;
    }
    return {
      source: "webops-instance-file",
      instanceId: parsed.instanceId,
      instanceName: parsed.instanceName ?? "",
      path: parsed.path,
      name: parsed.name,
      size: parsed.size,
      modifiedAt: parsed.modifiedAt
    };
  } catch {
    return null;
  }
}

function sakiMimeTypeFromPath(pathname: string): string {
  const imageMimeType = imageMimeTypeFromPath(pathname);
  if (imageMimeType) return imageMimeType;

  const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
  const mimeTypes: Record<string, string> = {
    css: "text/css",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    js: "text/javascript",
    json: "application/json",
    jsx: "text/javascript",
    log: "text/plain",
    md: "text/markdown",
    mdx: "text/markdown",
    py: "text/x-python",
    sh: "text/x-shellscript",
    ts: "text/typescript",
    tsx: "text/typescript",
    txt: "text/plain",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml"
  };
  return mimeTypes[extension] ?? "text/plain";
}

function isLikelyTextAttachment(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith("text/")) return true;
  if (/json|xml|yaml|javascript|typescript|ecmascript|csv|markdown|sql|toml|shell|x-sh/.test(mimeType)) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return sakiTextAttachmentExtensions.has(extension);
}

async function readSakiTextAttachment(file: File): Promise<string> {
  const chunk = file.slice(0, Math.min(file.size, sakiTextAttachmentLimit * 4), file.type || "text/plain");
  const text = await chunk.text();
  const truncated = compactContextText(text, sakiTextAttachmentLimit);
  return file.size > chunk.size ? `${truncated}\n...(文件较大，仅附加前 ${formatBytes(chunk.size)})` : truncated;
}

function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

async function imageFileToSakiAttachment(
  file: File,
  kind: "image" | "screenshot" = "image"
): Promise<SakiInputAttachment> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片读取失败"));
      image.src = objectUrl;
    });

    const originalWidth = image.naturalWidth || 1;
    const originalHeight = image.naturalHeight || 1;
    const scale = Math.min(1, sakiImageMaxDimension / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理图片");
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/webp", sakiImageQuality);
    return {
      id: newClientId(),
      kind,
      name: file.name,
      mimeType: "image/webp",
      size: Math.round((dataUrl.length * 3) / 4),
      dataUrl,
      width,
      height,
      ...(kind === "screenshot" ? { capturedAt: new Date().toISOString() } : {})
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fileToSakiAttachment(file: File, preferredKind: "image" | "file"): Promise<SakiInputAttachment> {
  if (file.type.startsWith("image/")) {
    return imageFileToSakiAttachment(file, "image");
  }
  return {
    id: newClientId(),
    kind: "file",
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    ...(isLikelyTextAttachment(file) ? { text: await readSakiTextAttachment(file) } : {})
  };
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string };

function isMarkdownBoundary(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^```/.test(trimmed) ||
    /^#{1,4}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed)
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeMatch = trimmed.match(/^```([A-Za-z0-9_-]*)/);
    if (codeMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: codeMatch[1] ?? "", code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1]?.length ?? 1, text: headingMatch[2] ?? "" });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] ?? "").trim())) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      while (index < lines.length) {
        const itemLine = (lines[index] ?? "").trim();
        const itemMatch = ordered ? itemLine.match(/^\d+[.)]\s+(.+)$/) : itemLine.match(/^[-*+]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index] ?? "";
      if (!paragraphLine.trim() || (paragraphLines.length > 0 && isMarkdownBoundary(paragraphLine))) break;
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks.length ? blocks : [{ type: "paragraph", text: "" }];
}

function safeMarkdownHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;
  if (href.startsWith("#") || href.startsWith("/")) return href;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" ? href : null;
  } catch {
    return null;
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`}>{match[2] ?? ""}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[3] ?? ""}</strong>);
    } else {
      const href = safeMarkdownHref(match[5] ?? "");
      nodes.push(
        href ? (
          <a href={href} key={`${keyPrefix}-link-${match.index}`} rel="noreferrer" target={href.startsWith("/") || href.startsWith("#") ? undefined : "_blank"}>
            {match[4] ?? href}
          </a>
        ) : (
          match[4] ?? token
        )
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderInlineLines(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split("\n").flatMap((line, index) => {
    const nodes = renderInlineMarkdown(line, `${keyPrefix}-${index}`);
    return index === 0 ? nodes : [<br key={`${keyPrefix}-br-${index}`} />, ...nodes];
  });
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className="saki-markdown">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const children = renderInlineMarkdown(block.text, `heading-${index}`);
          if (block.level <= 1) return <h3 key={index}>{children}</h3>;
          if (block.level === 2) return <h4 key={index}>{children}</h4>;
          return <h5 key={index}>{children}</h5>;
        }
        if (block.type === "quote") {
          return <blockquote key={index}>{renderInlineLines(block.text, `quote-${index}`)}</blockquote>;
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineLines(item, `list-${index}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "code") {
          return (
            <div className="saki-code-block" key={index}>
              {block.language ? <span>{block.language}</span> : null}
              <pre>
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }
        return <p key={index}>{renderInlineLines(block.text, `paragraph-${index}`)}</p>;
      })}
    </div>
  );
}

function FilePreview({ content, kind }: { content: string; kind: "html" | "markdown" | "image" }) {
  if (kind === "image") {
    return (
      <div className="image-file-preview">
        <img alt="" draggable={false} src={content} />
      </div>
    );
  }

  if (kind === "html") {
    return <iframe className="html-file-preview" sandbox="" srcDoc={content} title="HTML preview" />;
  }

  return (
    <div className="markdown-file-preview">
      <MarkdownContent content={content} />
    </div>
  );
}

function auditResourceIcon(resourceType: string, action: string): React.ReactNode {
  const key = `${resourceType} ${action}`.toLowerCase();
  if (action.startsWith("auth.")) return <KeyRound size={18} />;
  if (key.includes("instance") || key.includes("terminal")) return <TerminalIcon size={18} />;
  if (key.includes("task")) return <Clock size={18} />;
  if (key.includes("template")) return <LayoutTemplate size={18} />;
  if (key.includes("user") || key.includes("role")) return <UserCog size={18} />;
  if (key.includes("node") || key.includes("daemon")) return <Server size={18} />;
  if (key.includes("file")) return <FileText size={18} />;
  if (key.includes("saki")) return <Sparkles size={18} />;
  return <ClipboardList size={18} />;
}

function joinFilePath(basePath: string, name: string): string {
  return [basePath, name].filter(Boolean).join("/");
}

function parentFilePath(pathname: string): string {
  if (!pathname) return "";
  const pieces = pathname.split("/").filter(Boolean);
  pieces.pop();
  return pieces.join("/");
}

function fileExtension(pathname: string): string {
  const fileName = pathname.split("/").pop()?.toLowerCase() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : "";
}

function imageMimeTypeFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  return imageMimeTypesByExtension[fileExtension(pathname)] ?? null;
}

function isImageFile(pathname: string | null | undefined): boolean {
  return Boolean(imageMimeTypeFromPath(pathname));
}

function isArchiveFile(pathname: string): boolean {
  return ["zip", "rar", "7z"].includes(fileExtension(pathname));
}

function defaultExtractPath(pathname: string): string {
  const fileName = pathname.split("/").pop() ?? "archive";
  const baseName = fileName.replace(/\.(zip|rar|7z)$/i, "") || "archive";
  return joinFilePath(parentFilePath(pathname), baseName);
}

function splitNameForCopy(fileName: string): { stem: string; extension: string } {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: fileName, extension: "" };
  return {
    stem: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex)
  };
}

function uniqueSiblingName(fileName: string, entries: InstanceFileEntry[]): string {
  const occupied = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
  const { stem, extension } = splitNameForCopy(fileName);
  let copyIndex = 1;
  let candidate = `${stem}${copyIndex}${extension}`;
  while (occupied.has(candidate.toLocaleLowerCase())) {
    copyIndex += 1;
    candidate = `${stem}${copyIndex}${extension}`;
  }
  return candidate;
}

type FileConflictChoice = "overwrite" | "keep";

interface FileConflictPrompt {
  action: "create" | "upload";
  name: string;
  suggestedName: string;
  canOverwrite: boolean;
}

interface FileToast {
  id: number;
  title: string;
  detail: string;
}

function filePreviewKindFromPath(pathname: string | null): "html" | "markdown" | "image" | null {
  if (!pathname) return null;
  if (isImageFile(pathname)) return "image";
  const extension = fileExtension(pathname);
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "md" || extension === "markdown" || extension === "mdx") return "markdown";
  return null;
}

interface SyntaxRule {
  className: string;
  pattern: RegExp;
}

interface HighlightToken {
  text: string;
  className?: string;
}

interface FindMatchRange {
  start: number;
  end: number;
}

const htmlEscapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

const editorLanguageByExtension: Record<string, string> = {
  bash: "shell",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  env: "env",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  php: "php",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "css",
  sh: "shell",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  toml: "toml",
  xml: "html",
  yaml: "yaml",
  yml: "yaml"
};

function editorLanguageFromPath(pathname: string | null): string {
  if (!pathname) return "text";
  if (isImageFile(pathname)) return "image";
  const fileName = pathname.split("/").pop()?.toLowerCase() ?? "";
  if (!fileName) return "text";
  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) return "dockerfile";
  if (fileName === ".env" || fileName.startsWith(".env.")) return "env";
  const extension = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";
  return editorLanguageByExtension[extension] ?? "text";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEscapeMap[character] ?? character);
}

function pushHighlightToken(tokens: HighlightToken[], text: string, className?: string): void {
  if (!text) return;
  const previous = tokens[tokens.length - 1];
  if (previous && previous.className === className) {
    previous.text += text;
    return;
  }
  if (className) {
    tokens.push({ text, className });
  } else {
    tokens.push({ text });
  }
}

function syntaxRulesForLanguage(language: string): SyntaxRule[] {
  const quotedString: SyntaxRule = {
    className: "syntax-string",
    pattern: /"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`(?:\\.|[^`\\])*`/y
  };
  const numberRule: SyntaxRule = {
    className: "syntax-number",
    pattern: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/y
  };
  const constantRule: SyntaxRule = {
    className: "syntax-constant",
    pattern: /\b(?:true|false|null|undefined|NaN|Infinity)\b/y
  };
  const slashComment: SyntaxRule = {
    className: "syntax-comment",
    pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/y
  };
  const hashComment: SyntaxRule = {
    className: "syntax-comment",
    pattern: /#[^\n\r]*/y
  };

  if (language === "json") {
    return [
      quotedString,
      numberRule,
      { className: "syntax-constant", pattern: /\b(?:true|false|null)\b/y }
    ];
  }

  if (language === "css") {
    return [
      { className: "syntax-comment", pattern: /\/\*[\s\S]*?\*\//y },
      quotedString,
      { className: "syntax-keyword", pattern: /@[a-z-]+/iy },
      { className: "syntax-selector", pattern: /[#.][a-z_-][\w-]*/iy },
      { className: "syntax-property", pattern: /[a-z-]+(?=\s*:)/iy },
      { className: "syntax-constant", pattern: /#[0-9a-f]{3,8}\b/iy },
      { className: "syntax-number", pattern: /\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg)?\b/iy }
    ];
  }

  if (language === "html") {
    return [
      { className: "syntax-comment", pattern: /<!--[\s\S]*?-->/y },
      { className: "syntax-tag", pattern: /<\/?[a-z][a-z0-9:-]*/iy },
      { className: "syntax-attribute", pattern: /\s+[a-z_:][-a-z0-9_:.]*(?=\s*=)/iy },
      quotedString,
      { className: "syntax-tag", pattern: /\/?>/y }
    ];
  }

  if (language === "markdown") {
    return [
      { className: "syntax-comment", pattern: /<!--[\s\S]*?-->/y },
      { className: "syntax-keyword", pattern: /#{1,6}[^\n\r]*/y },
      { className: "syntax-string", pattern: /`[^`\n\r]*`/y },
      { className: "syntax-constant", pattern: /\*\*[^*\n\r]+?\*\*/y },
      { className: "syntax-property", pattern: /\[[^\]\n\r]+\]\([^)]+\)/y }
    ];
  }

  if (language === "shell" || language === "env" || language === "dockerfile" || language === "powershell") {
    return [
      hashComment,
      quotedString,
      { className: "syntax-property", pattern: /\$\{?[a-z_][\w]*\}?/iy },
      {
        className: "syntax-keyword",
        pattern:
          /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|in|echo|exit|export|set|run|cmd|copy|from|workdir|entrypoint|env|arg|label|user|expose|volume)\b/iy
      },
      numberRule
    ];
  }

  if (language === "python") {
    return [
      hashComment,
      {
        className: "syntax-string",
        pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'/y
      },
      {
        className: "syntax-keyword",
        pattern:
          /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/y
      },
      { className: "syntax-constant", pattern: /\b(?:True|False|None)\b/y },
      numberRule
    ];
  }

  if (language === "yaml" || language === "toml") {
    return [
      hashComment,
      quotedString,
      { className: "syntax-property", pattern: /[a-z0-9_.-]+(?=\s*[:=])/iy },
      constantRule,
      numberRule
    ];
  }

  if (language === "sql") {
    return [
      { className: "syntax-comment", pattern: /--[^\n\r]*|\/\*[\s\S]*?\*\//y },
      quotedString,
      {
        className: "syntax-keyword",
        pattern:
          /\b(?:select|from|where|join|left|right|inner|outer|insert|update|delete|create|alter|drop|table|index|view|as|and|or|not|null|is|in|order|group|by|limit|offset|values|set)\b/iy
      },
      numberRule
    ];
  }

  return [
    slashComment,
    quotedString,
    {
      className: "syntax-keyword",
      pattern:
        /\b(?:abstract|async|await|break|case|catch|class|const|continue|default|defer|delete|do|else|enum|export|extends|final|finally|for|from|func|function|go|if|implements|import|in|interface|let|match|module|namespace|new|package|private|protected|public|return|static|struct|switch|this|throw|trait|try|type|using|var|void|while|yield)\b/y
    },
    constantRule,
    numberRule
  ];
}

function tokenizeEditorContent(content: string, language: string): HighlightToken[] {
  const rules = syntaxRulesForLanguage(language);
  const tokens: HighlightToken[] = [];
  let offset = 0;

  while (offset < content.length) {
    let matched = false;
    for (const rule of rules) {
      rule.pattern.lastIndex = offset;
      const match = rule.pattern.exec(content);
      const value = match?.[0] ?? "";
      if (!match || match.index !== offset || !value) continue;
      pushHighlightToken(tokens, value, rule.className);
      offset += value.length;
      matched = true;
      break;
    }

    if (!matched) {
      pushHighlightToken(tokens, content[offset] ?? "");
      offset += 1;
    }
  }

  return tokens;
}

function collectFindMatches(content: string, query: string): FindMatchRange[] {
  if (!query) return [];
  const haystack = content.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const matches: FindMatchRange[] = [];
  let offset = 0;

  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) break;
    matches.push({ start: index, end: index + needle.length });
    offset = index + Math.max(needle.length, 1);
  }

  return matches;
}

function appendHighlightedSegment(output: string[], text: string, classNames: string[]): void {
  if (!text) return;
  const escaped = escapeHtml(text);
  if (classNames.length === 0) {
    output.push(escaped);
    return;
  }
  output.push(`<span class="${classNames.join(" ")}">${escaped}</span>`);
}

function highlightedEditorHtml(
  content: string,
  pathname: string | null,
  findQuery: string,
  activeFindIndex: number
): string {
  if (!content) return " ";
  const tokens = tokenizeEditorContent(content, editorLanguageFromPath(pathname));
  const matches = collectFindMatches(content, findQuery);
  const output: string[] = [];
  let tokenStart = 0;
  let matchIndex = 0;

  for (const token of tokens) {
    const tokenEnd = tokenStart + token.text.length;
    while (matchIndex < matches.length && (matches[matchIndex]?.end ?? 0) <= tokenStart) {
      matchIndex += 1;
    }

    let cursor = tokenStart;
    let localMatchIndex = matchIndex;
    while (localMatchIndex < matches.length) {
      const match = matches[localMatchIndex];
      if (!match || match.start >= tokenEnd) break;

      if (match.start > cursor) {
        appendHighlightedSegment(output, token.text.slice(cursor - tokenStart, match.start - tokenStart), [
          ...(token.className ? [token.className] : [])
        ]);
      }

      const start = Math.max(match.start, cursor);
      const end = Math.min(match.end, tokenEnd);
      appendHighlightedSegment(output, token.text.slice(start - tokenStart, end - tokenStart), [
        ...(token.className ? [token.className] : []),
        "editor-find-match",
        ...(localMatchIndex === activeFindIndex ? ["active"] : [])
      ]);
      cursor = end;

      if (match.end > tokenEnd) break;
      localMatchIndex += 1;
    }

    if (cursor < tokenEnd) {
      appendHighlightedSegment(output, token.text.slice(cursor - tokenStart), [
        ...(token.className ? [token.className] : [])
      ]);
    }

    tokenStart = tokenEnd;
    matchIndex = localMatchIndex;
  }

  return output.join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function base64ToBlob(contentBase64: string, type = ""): Blob {
  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function accountInitials(displayName: string, username: string): string {
  const source = (displayName || username).trim();
  if (!source) return "U";
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : source.slice(0, 2);
  return initials.toUpperCase();
}

function AccountAvatar({
  avatarDataUrl,
  displayName,
  username,
  className = ""
}: {
  avatarDataUrl?: string | null | undefined;
  displayName: string;
  username: string;
  className?: string;
}) {
  return (
    <span className={`account-avatar ${className}`}>
      {avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : <span>{accountInitials(displayName, username)}</span>}
    </span>
  );
}

async function avatarFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("头像读取失败"));
      image.src = objectUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) {
      throw new Error("头像读取失败");
    }

    const side = Math.min(width, height);
    const sourceX = Math.floor((width - side) / 2);
    const sourceY = Math.floor((height - side) / 2);
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器无法处理头像");
    }
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function appearanceFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("图片不能超过 10MB");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(result)) {
        reject(new Error("仅支持 PNG、JPG、WebP 或 GIF 图片"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function LoginView({
  appearance,
  onLogin
}: {
  appearance: PanelAppearanceSettings;
  onLogin: (token: string, user: CurrentUser) => void;
}) {
  const rememberedLogin = useMemo(() => readRememberedLogin(), []);
  const [username, setUsername] = useState(rememberedLogin?.username ?? "admin");
  const [password, setPassword] = useState(rememberedLogin?.password ?? "");
  const [rememberPassword, setRememberPassword] = useState(Boolean(rememberedLogin));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await api.login({ username, password });
      if (rememberPassword) {
        saveRememberedLogin(username, password);
      } else {
        clearRememberedLogin();
      }
      localStorage.setItem(tokenKey, response.token);
      onLogin(response.token, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell saki-login-shell">
      <div className="login-container">
        <div className="login-visual" aria-hidden="true">
          <img className="login-cover-img" src={appearance.loginCoverSrc} alt="" draggable={false} />
        </div>
        <form className="login-panel" onSubmit={submit}>
          <div className="login-header">
            <div className="brand-mark" aria-hidden="true">
              <img className="app-logo-img" src={appearance.appLogoSrc} alt="" draggable={false} />
            </div>
            <div>
              <h1>{appearance.appTitle}</h1>
              {appearance.appSubtitle ? <p>{appearance.appSubtitle}</p> : null}
            </div>
          </div>

          <div className="form-group">
            <label>
              <span className="label-text">用户名</span>
              <div className="input-with-icon">
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="Enter your username"
                />
              </div>
            </label>
          </div>

          <div className="form-group">
            <label>
              <span className="label-text">密码</span>
              <div className="input-with-icon">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                />
              </div>
            </label>
          </div>

          <label className="remember-password">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => {
                setRememberPassword(event.target.checked);
                if (!event.target.checked) clearRememberedLogin();
              }}
            />
            <span>记住密码</span>
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary-button login-btn" type="submit" disabled={loading}>
            {loading ? "验证中..." : "登录系统"}
            {!loading && <KeyRound size={18} />}
          </button>
        </form>
      </div>
    </main>
  );
}

function MetricTile({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "teal" | "amber" | "blue" | "gray";
}) {
  return (
    <div className={`metric-tile metric-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function NodeStatusPill({ status }: { status: ManagedNode["status"] }) {
  const online = status === "ONLINE";
  return (
    <span className={`status-pill ${online ? "online" : "offline"}`}>
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      {online ? "在线" : "离线"}
    </span>
  );
}

function instanceStatusMeta(status: InstanceStatus) {
  const meta: Record<
    InstanceStatus,
    {
      className: string;
      label: string;
      shortLabel: string;
      hint: string;
      rank: number;
    }
  > = {
    RUNNING: {
      className: "running",
      label: "运行中",
      shortLabel: "在线",
      hint: "进程正在运行",
      rank: 1
    },
    STARTING: {
      className: "transition",
      label: "启动中",
      shortLabel: "启动",
      hint: "进程正在启动",
      rank: 2
    },
    CRASHED: {
      className: "crashed",
      label: "异常",
      shortLabel: "异常",
      hint: "上次运行异常退出",
      rank: 3
    },
    UNKNOWN: {
      className: "unknown",
      label: "未知",
      shortLabel: "未知",
      hint: "暂时无法确认状态",
      rank: 4
    },
    STOPPING: {
      className: "transition",
      label: "停止中",
      shortLabel: "停止",
      hint: "正在停止进程",
      rank: 5
    },
    STOPPED: {
      className: "idle",
      label: "已停止",
      shortLabel: "休眠",
      hint: "进程已停止",
      rank: 6
    },
    CREATED: {
      className: "created",
      label: "待启动",
      shortLabel: "待命",
      hint: "实例已创建，尚未启动",
      rank: 7
    }
  };
  return meta[status];
}

function InstanceStatusIcon({ status, size = 14 }: { status: InstanceStatus; size?: number }) {
  if (status === "RUNNING") return <Activity size={size} />;
  if (status === "STARTING" || status === "STOPPING") return <RefreshCw size={size} />;
  if (status === "CRASHED") return <Bug size={size} />;
  if (status === "UNKNOWN") return <WifiOff size={size} />;
  if (status === "STOPPED") return <Square size={size} />;
  return <TerminalIcon size={size} />;
}

function InstanceStatusBadge({ status, compact = false }: { status: InstanceStatus; compact?: boolean }) {
  const meta = instanceStatusMeta(status);
  return (
    <span className={`status-pill instance-status ${meta.className} ${compact ? "compact" : ""}`} title={meta.hint}>
      <InstanceStatusIcon status={status} size={compact ? 13 : 14} />
      <span>{compact ? meta.shortLabel : meta.label}</span>
    </span>
  );
}

function instanceTypeLabel(type: ManagedInstance["type"]): string {
  const labels: Record<ManagedInstance["type"], string> = {
    generic_command: "CMD",
    nodejs: "Node",
    python: "Python",
    java_jar: "Java",
    shell_script: "Shell",
    docker_container: "Docker",
    docker_compose: "Compose",
    minecraft: "MC",
    steam_game_server: "Steam"
  };
  return labels[type] ?? type;
}

function ownerRoleLabel(role?: InstanceAssignee["role"] | null): string {
  if (role === "super_admin") return "超管";
  if (role === "admin") return "管理员";
  return "用户";
}

function managedUserOwnerRole(user: ManagedUser): InstanceAssignee["role"] {
  if (user.roleNames.includes("super_admin")) return "super_admin";
  if (user.roleNames.some((role) => role === "admin" || role === "administrator" || role === "operator")) {
    return "admin";
  }
  return "user";
}

function managedUserAssignee(user: ManagedUser): InstanceAssignee | null {
  const role = managedUserOwnerRole(user);
  if (role === "super_admin") return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role
  };
}

function userDisplayLabel(displayName?: string | null, username?: string | null): string {
  return displayName || username || "未设置";
}

function instanceCreatorLabel(instance: ManagedInstance): string {
  return userDisplayLabel(instance.createdByDisplayName, instance.createdByUsername);
}

function instanceAssigneeLabel(instance: ManagedInstance): string {
  return userDisplayLabel(instance.assignedToDisplayName, instance.assignedToUsername);
}

function compactCommand(command: string, maxLength = 92): string {
  const compact = command.trim().replace(/\s+/g, " ");
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function compactPathLabel(pathname: string): string {
  if (!pathname) return "-";
  const normalized = pathname.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return pathname;
  return `.../${parts.slice(-2).join("/")}`;
}

function AccessEmptyView({ user, onOpenAccount }: { user: CurrentUser; onOpenAccount: () => void }) {
  const hasNoPermissions = user.permissions.length === 0;
  const roleLabel = user.roleNames.length > 0 ? user.roleNames.join(", ") : "无角色";

  return (
    <section className="panel-block access-empty-panel">
      <div className="access-empty-icon">
        <Shield size={30} />
      </div>
      <div className="access-empty-copy">
        <span className="access-empty-kicker">{roleLabel}</span>
        <h2>{hasNoPermissions ? "暂无可用权限" : "暂无可打开的控制台模块"}</h2>
        <p>
          {hasNoPermissions
            ? `当前账号 @${user.username} 还没有被分配任何权限。`
            : `当前账号 @${user.username} 的权限暂时没有对应的侧边栏入口。`}
          请联系管理员调整角色或权限后再回来。
        </p>
      </div>
      <button className="primary-button access-empty-action" type="button" onClick={onOpenAccount}>
        <UserRound size={18} />
        账号设置
      </button>
    </section>
  );
}

function DashboardView({
  token,
  onLogout,
  refreshTick,
  canViewNodes,
  canTestNodes
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  canViewNodes: boolean;
  canTestNodes: boolean;
}) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [error, setError] = useState("");
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextOverview, nextNodes] = await Promise.all([
        api.dashboard(token),
        canViewNodes ? api.nodes(token) : Promise.resolve([])
      ]);
      setOverview(nextOverview);
      setNodes(nextNodes);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "刷新失败");
    }
  }, [canViewNodes, onLogout, token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshTick]);

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

  const resources = overview?.resources ?? { cpuUsage: 0, memoryUsage: 0, diskUsage: 0 };

  return (
    <>
      {error ? <div className="page-error">{error}</div> : null}

      <section className="metrics-grid">
        <MetricTile
          icon={<Server size={22} />}
          label="在线节点"
          value={`${overview?.nodes.online ?? 0}/${overview?.nodes.total ?? 0}`}
          tone="teal"
        />
        <MetricTile icon={<Cpu size={22} />} label="CPU" value={formatNumber(resources.cpuUsage)} tone="blue" />
        <MetricTile icon={<MemoryStick size={22} />} label="内存" value={formatNumber(resources.memoryUsage)} tone="amber" />
        <MetricTile icon={<HardDrive size={22} />} label="磁盘" value={formatNumber(resources.diskUsage)} tone="gray" />
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

        <div className="panel-block operations-block">
          <div className="section-heading">
            <h2>最近操作</h2>
          </div>
          <div className="operation-list">
            {(overview?.recentOperations ?? []).map((item) => (
              <div className="operation-row" key={item.id}>
                <span>{item.action}</span>
                <strong className={item.result === "SUCCESS" ? "success" : "failure"}>
                  {item.result === "SUCCESS" ? "成功" : "失败"}
                </strong>
                <time>{formatDate(item.createdAt)}</time>
              </div>
            ))}
            {overview?.recentOperations.length === 0 ? <div className="empty-state">暂无操作记录</div> : null}
          </div>
        </div>
      </section>

      {canViewNodes ? (
        <section className="panel-block nodes-block">
          <div className="section-heading">
            <h2>节点</h2>
            <span>{nodes.length} 台</span>
          </div>
          <div className="table-wrap">
            <table>
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
                      <NodeStatusPill status={node.status} />
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
                          className="small-button"
                          onClick={() => void testNode(node.id)}
                          disabled={testingNodeId === node.id}
                        >
                          <RefreshCw size={15} />
                          测试
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {nodes.length === 0 ? (
                  <tr>
                    <td colSpan={canTestNodes ? 7 : 6}>
                      <div className="empty-state">暂无节点</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function NodesView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<{ nodeId: string; nodeName: string; nodeToken: string } | null>(null);
  const [form, setForm] = useState({
    name: "Local Daemon",
    host: "127.0.0.1",
    port: "24444",
    protocol: "http" as CreateNodeRequest["protocol"],
    remarks: "",
    groupName: "",
    tags: ""
  });

  const refresh = useCallback(async () => {
    setError("");
    try {
      setNodes(await api.nodes(token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "节点刷新失败");
    }
  }, [onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  function resetForm() {
    setEditingNodeId(null);
    setCreatedSecret(null);
    setForm({
      name: "Local Daemon",
      host: "127.0.0.1",
      port: "24444",
      protocol: "http",
      remarks: "",
      groupName: "",
      tags: ""
    });
  }

  function editNode(node: ManagedNode) {
    setEditingNodeId(node.id);
    setCreatedSecret(null);
    setMessage("");
    setForm({
      name: node.name,
      host: node.host,
      port: String(node.port),
      protocol: node.protocol as CreateNodeRequest["protocol"],
      remarks: node.remarks ?? "",
      groupName: node.groupName ?? "",
      tags: node.tags ?? ""
    });
  }

  async function saveNode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const port = Number(form.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setError("端口必须是 1-65535 之间的整数");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload: CreateNodeRequest = {
        name: form.name.trim(),
        host: form.host.trim(),
        port,
        protocol: form.protocol
      };
      if (form.remarks.trim()) payload.remarks = form.remarks.trim();
      if (form.groupName.trim()) payload.groupName = form.groupName.trim();
      if (form.tags.trim()) payload.tags = form.tags.trim();

      if (editingNodeId) {
        const updatePayload: UpdateNodeRequest = {
          ...payload,
          remarks: payload.remarks ?? null,
          groupName: payload.groupName ?? null,
          tags: payload.tags ?? null
        };
        const updated = await api.updateNode(token, editingNodeId, updatePayload);
        setNodes((current) => current.map((node) => (node.id === updated.id ? updated : node)));
        setMessage("节点已保存");
      } else {
        const response = await api.createNode(token, payload);
        setNodes((current) => [response.node, ...current.filter((node) => node.id !== response.node.id)]);
        setCreatedSecret({
          nodeId: response.node.id,
          nodeName: response.node.name,
          nodeToken: response.nodeToken
        });
        setMessage("节点已创建");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function testNode(id: string) {
    setTestingNodeId(id);
    setError("");
    setMessage("");
    try {
      const result = await api.testNode(token, id);
      await refresh();
      setMessage(result.ok ? "节点连接正常" : `节点测试失败：${result.error ?? result.statusCode ?? "未知错误"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点测试失败");
    } finally {
      setTestingNodeId(null);
    }
  }

  async function deleteNode(node: ManagedNode) {
    if (!window.confirm(`删除节点 ${node.name}？关联实例也会被删除。`)) return;
    setBusyNodeId(node.id);
    setError("");
    setMessage("");
    try {
      await api.deleteNode(token, node.id);
      setNodes((current) => current.filter((item) => item.id !== node.id));
      if (editingNodeId === node.id) resetForm();
      setMessage("节点已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点删除失败");
    } finally {
      setBusyNodeId(null);
    }
  }

  return (
    <>
      {error ? <div className="page-error">{error}</div> : null}
      {message ? <div className="page-notice">{message}</div> : null}

      <section className="node-layout">
        <div className="panel-block node-form-panel">
          <div className="section-heading">
            <h2>{editingNodeId ? "编辑节点" : "添加节点"}</h2>
            {editingNodeId ? (
              <button className="small-button compact-button" type="button" onClick={resetForm}>
                取消
              </button>
            ) : null}
          </div>
          <form className="node-form" onSubmit={saveNode}>
            <label>
              名称
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
            <label>
              地址
              <input
                value={form.host}
                onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
                required
              />
            </label>
            <label>
              端口
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
                required
              />
            </label>
            <label>
              协议
              <select
                value={form.protocol}
                onChange={(event) =>
                  setForm((current) => ({ ...current, protocol: event.target.value as CreateNodeRequest["protocol"] }))
                }
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
            </label>
            <label>
              分组
              <input
                value={form.groupName}
                onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))}
              />
            </label>
            <label>
              标签
              <input
                value={form.tags}
                onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
              />
            </label>
            <label className="wide-field">
              备注
              <input
                value={form.remarks}
                onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
              />
            </label>
            <button className="primary-button form-submit" type="submit" disabled={saving}>
              <Server size={18} />
              {saving ? "保存中" : editingNodeId ? "保存节点" : "添加节点"}
            </button>
          </form>
          {createdSecret ? (
            <div className="node-token-box">
              <strong>{createdSecret.nodeName}</strong>
              <span>节点 ID</span>
              <code>{createdSecret.nodeId}</code>
              <span>节点令牌</span>
              <code>{createdSecret.nodeToken}</code>
            </div>
          ) : null}
        </div>

        <div className="panel-block nodes-block">
          <div className="section-heading">
            <h2>节点</h2>
            <span>{nodes.length} 台</span>
          </div>
          <div className="table-wrap">
            <table className="nodes-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>地址</th>
                  <th>状态</th>
                  <th>系统</th>
                  <th>资源</th>
                  <th>分组</th>
                  <th>心跳</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => {
                  const busy = busyNodeId === node.id || testingNodeId === node.id;
                  return (
                    <tr key={node.id}>
                      <td>
                        <strong>{node.name}</strong>
                      </td>
                      <td>{`${node.protocol}://${node.host}:${node.port}`}</td>
                      <td>
                        <NodeStatusPill status={node.status} />
                      </td>
                      <td>{[node.os, node.arch].filter(Boolean).join(" / ") || "-"}</td>
                      <td>
                        {node.latestMetric
                          ? `${formatNumber(node.latestMetric.cpuUsage)} / ${formatNumber(node.latestMetric.memoryUsage)}`
                          : "-"}
                      </td>
                      <td>{node.groupName || "-"}</td>
                      <td>{formatDate(node.lastSeenAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="small-button compact-button" disabled={busy} onClick={() => void testNode(node.id)}>
                            测试
                          </button>
                          <button className="small-button compact-button" disabled={busy} onClick={() => editNode(node)}>
                            编辑
                          </button>
                          <button
                            className="icon-button mini danger-action"
                            disabled={busy}
                            title="删除"
                            onClick={() => void deleteNode(node)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {nodes.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state">暂无节点</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

function InstanceLogs({ logs }: { logs: InstanceLogLine[] }) {
  return (
    <div className="log-console">
      {logs.length === 0 ? (
        <div className="log-empty">暂无日志</div>
      ) : (
        logs.map((line) => (
          <div className={`log-line log-${line.stream}`} key={line.id}>
            <span>{formatDate(line.time)}</span>
            <strong>{line.stream}</strong>
            <code>{line.text}</code>
          </div>
        ))
      )}
    </div>
  );
}

function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const sakiArtAssets = {
  avatar: "/assets/head.png",
  launcher: "/assets/sakiicon.png",
  launcherHover: "/assets/saki_click.png",
  files: "/assets/saki_files.png",
  normal: "/assets/expression/normal.png",
  thinking: "/assets/expression/think.png",
  worry: "/assets/expression/worry.png",
  thinkingGif: "/assets/Thinking.gif"
} as const;

type SakiArtMood = "normal" | "thinking" | "worry";

interface SakiLauncherPosition {
  x: number;
  y: number;
}

const sakiLauncherPositionKey = "webops.saki.launcherPosition";
const sakiLauncherEdgePadding = 12;
const sakiConversationStorageKey = "webops.saki.conversations.v1";

interface StoredSakiConversation {
  id: string;
  contextKey: string;
  label: string;
  detail: string;
  instanceId?: string | null;
  title: string;
  messages: LocalSakiMessage[];
  createdAt: string;
  updatedAt: string;
}

function readSakiConversations(): StoredSakiConversation[] {
  try {
    const raw = globalThis.localStorage?.getItem(sakiConversationStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): StoredSakiConversation | null => {
        if (!item || typeof item !== "object") return null;
        const value = item as Partial<StoredSakiConversation>;
        if (!value.id || !value.contextKey || !Array.isArray(value.messages)) return null;
        return {
          id: value.id,
          contextKey: value.contextKey,
          label: value.label ?? "Saki",
          detail: value.detail ?? "",
          instanceId: value.instanceId ?? null,
          title: value.title ?? "新对话",
          messages: value.messages,
          createdAt: value.createdAt ?? new Date().toISOString(),
          updatedAt: value.updatedAt ?? new Date().toISOString()
        };
      })
      .filter((item): item is StoredSakiConversation => Boolean(item))
      .filter((conversation) => hasPersistableSakiSpeech(conversation.messages))
      .slice(0, 80);
  } catch {
    return [];
  }
}

function writeSakiConversations(conversations: StoredSakiConversation[]) {
  try {
    globalThis.localStorage?.setItem(sakiConversationStorageKey, JSON.stringify(conversations.slice(0, 80)));
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

function sakiConversationTitle(messages: LocalSakiMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  return firstUserMessage ? compactContextText(firstUserMessage.replace(/\s+/g, " "), 38) : "新对话";
}

function latestSakiConversationForContext(conversations: StoredSakiConversation[], contextKey: string): StoredSakiConversation | null {
  return conversations
    .filter((conversation) => conversation.contextKey === contextKey)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null;
}

function isSakiLauncherPosition(value: unknown): value is SakiLauncherPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<SakiLauncherPosition>;
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

function readSakiLauncherPosition(): SakiLauncherPosition | null {
  try {
    const raw = globalThis.localStorage?.getItem(sakiLauncherPositionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isSakiLauncherPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSakiLauncherPosition(position: SakiLauncherPosition) {
  try {
    globalThis.localStorage?.setItem(sakiLauncherPositionKey, JSON.stringify(position));
  } catch {
    // Drag position is a convenience, so storage failures can be ignored.
  }
}

function sakiLauncherSize(element: HTMLElement | null) {
  const rect = element?.getBoundingClientRect();
  return {
    width: rect?.width || 86,
    height: rect?.height || 118
  };
}

function clampSakiLauncherPosition(position: SakiLauncherPosition, element: HTMLElement | null): SakiLauncherPosition {
  const { width, height } = sakiLauncherSize(element);
  const viewportWidth = globalThis.innerWidth || width + sakiLauncherEdgePadding * 2;
  const viewportHeight = globalThis.innerHeight || height + sakiLauncherEdgePadding * 2;
  const maxX = Math.max(sakiLauncherEdgePadding, viewportWidth - width - sakiLauncherEdgePadding);
  const maxY = Math.max(sakiLauncherEdgePadding, viewportHeight - height - sakiLauncherEdgePadding);

  return {
    x: Math.min(Math.max(sakiLauncherEdgePadding, position.x), maxX),
    y: Math.min(Math.max(sakiLauncherEdgePadding, position.y), maxY)
  };
}

function sameSakiLauncherPosition(left: SakiLauncherPosition, right: SakiLauncherPosition) {
  return Math.round(left.x) === Math.round(right.x) && Math.round(left.y) === Math.round(right.y);
}

function SakiCharacterArt({
  mood = "normal",
  compact = false,
  fileDrop = false
}: {
  mood?: SakiArtMood;
  compact?: boolean;
  fileDrop?: boolean;
}) {
  const expressionSrc =
    fileDrop ? sakiArtAssets.files : mood === "thinking" ? sakiArtAssets.thinking : mood === "worry" ? sakiArtAssets.worry : sakiArtAssets.normal;

  if (compact) {
    if (fileDrop) {
      return (
        <div className="saki-character-art compact" aria-hidden="true">
          <img
            className="saki-character-image saki-character-image-file-drop"
            src={sakiArtAssets.files}
            alt=""
            draggable={false}
          />
        </div>
      );
    }

    return (
      <div className="saki-character-art compact" aria-hidden="true">
        <img
          className="saki-character-image saki-character-image-idle"
          src={sakiArtAssets.launcher}
          alt=""
          draggable={false}
        />
        <img
          className="saki-character-image saki-character-image-hover"
          src={sakiArtAssets.launcherHover}
          alt=""
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className={`saki-character-art mood-${mood}`} aria-hidden="true">
      <img
        className="saki-character-image"
        src={expressionSrc}
        alt=""
        draggable={false}
      />
    </div>
  );
}

function SakiAttachmentChip({
  attachment,
  removable = false,
  onRemove
}: {
  attachment: SakiInputAttachment;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const icon =
    attachment.kind === "screenshot" ? (
      <Camera size={15} />
    ) : attachment.kind === "image" ? (
      <ImageIcon size={15} />
    ) : (
      <FileText size={15} />
    );
  return (
    <span className="saki-attachment-chip" title={`${attachment.name}\n${sakiAttachmentSummary(attachment)}`}>
      {attachment.dataUrl && attachment.kind !== "file" ? (
        <img src={attachment.dataUrl} alt="" draggable={false} />
      ) : (
        <span className="saki-attachment-icon">{icon}</span>
      )}
      <span className="saki-attachment-copy">
        <strong>{attachment.name}</strong>
        <em>{sakiAttachmentSummary(attachment)}</em>
      </span>
      {removable ? (
        <button className="icon-button mini" type="button" title="移除附件" onClick={onRemove}>
          <X size={13} />
        </button>
      ) : null}
    </span>
  );
}

function SakiThinkingTrace({ steps }: { steps: LocalSakiWorkflowStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="saki-thought-trace" aria-label="Saki 可见思路和工具调用">
      {steps.map((step) => (
        <div className={`saki-thought-step ${step.status}`} key={step.id}>
          <span className="saki-thought-dot" />
          <div>
            <div className="saki-thought-row">
              <strong>{step.message}</strong>
              {step.status === "failed" ? <em>遇到阻碍</em> : step.status === "pending" ? <em>需要确认</em> : null}
            </div>
            {step.call && step.tool !== "respond" ? <code>{step.call}</code> : null}
            {step.detail ? <p>{step.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function visibleSakiActions(actions: SakiAgentAction[] | undefined): SakiAgentAction[] {
  return (actions ?? []).filter(
    (action) => action.status === "pending_approval" || action.status === "rolled_back" || Boolean(action.approval?.rollbackAvailable)
  );
}

function isSakiFileEditTool(tool: string): boolean {
  const normalized = tool.toLowerCase();
  return normalized === "writefile" || normalized === "replaceinfile" || normalized === "editlines" || normalized === "uploadbase64";
}

function sakiFileEditActionLabel(tool: string): "创建" | "编辑" {
  const normalized = tool.toLowerCase();
  return normalized === "replaceinfile" || normalized === "editlines" ? "编辑" : "创建";
}

function isSakiRollbackableFileEdit(action: SakiAgentAction): boolean {
  return Boolean(action.approval?.rollbackAvailable) && isSakiFileEditTool(action.tool);
}

function isSakiFileRollbackAction(action: SakiAgentAction): boolean {
  return isSakiFileEditTool(action.tool) && (action.status === "rolled_back" || Boolean(action.approval?.rollbackAvailable));
}

function sakiActionTitle(action: SakiAgentAction): string {
  if (action.status === "pending_approval") return "需要你确认的操作";
  if (action.status === "rolled_back") return "已回滚的操作";
  if (isSakiRollbackableFileEdit(action)) return "可回溯代码";
  if (action.approval?.rollbackAvailable) return "已执行，可回滚";
  return "操作记录";
}

function sakiActionStatusLabel(action: SakiAgentAction): string {
  if (action.status === "pending_approval") return "待审批";
  if (action.status === "rolled_back") return "已回滚";
  if (isSakiRollbackableFileEdit(action)) return "可回溯";
  if (action.ok) return "完成";
  return "失败";
}

function SakiFloatingChat({
  token,
  instance,
  seed,
  panelContext,
  fileDragActive,
  instanceFileDropRequest,
  canUseChat,
  canUseAgent,
  canUseSkills
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
}) {
  const contextKey = instance ? `instance:${instance.id}` : `panel:${panelContext.label}:${panelContext.detail}`;
  const baseContextLabel = instance ? instance.name : panelContext.label;
  const baseContextPath = instance?.workingDirectory ?? panelContext.detail;
  const [open, setOpen] = useState(false);
  const [messagesExpanded, setMessagesExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<SakiChatMode>(() => coerceSakiMode("chat", canUseChat, canUseAgent));
  const [panelError, setPanelError] = useState<string | null>(null);
  const [contextTitle, setContextTitle] = useState<string | null>(null);
  const [contextText, setContextText] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalSakiMessage[]>([
    createSakiWelcomeMessage("我是 Saki。切到不同实例时，我会一起切换工作区上下文。")
  ]);
  const [skills, setSkills] = useState<SakiSkillSummary[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState<SakiLauncherPosition | null>(() => readSakiLauncherPosition());
  const [launcherDragging, setLauncherDragging] = useState(false);
  const [storedConversations, setStoredConversations] = useState<StoredSakiConversation[]>(() => readSakiConversations());
  const [activeConversationId, setActiveConversationId] = useState(() => newClientId());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<SakiInputAttachment[]>([]);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [composerBusy, setComposerBusy] = useState<"image" | "file" | "screenshot" | null>(null);
  const [sakiFileHoverActive, setSakiFileHoverActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechBaseDraftRef = useRef("");
  const composerNoticeTimerRef = useRef<number | null>(null);
  const sakiStreamAbortRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    return () => {
      sakiStreamAbortRef.current?.abort();
      recognitionRef.current?.abort();
      document.body.classList.remove("saki-selection-capture-active");
      if (composerNoticeTimerRef.current !== null) {
        window.clearTimeout(composerNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    annotationModeRef.current = annotationMode;
  }, [annotationMode]);

  useEffect(() => {
    setMode((current) => coerceSakiMode(current, canUseChat, canUseAgent));
  }, [canUseAgent, canUseChat]);

  useEffect(() => {
    function handleGlobalPointerDown(event: PointerEvent) {
      if (annotationMode) return;
      if (open && panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
        setMessagesExpanded(false);
      }
    }
    document.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleGlobalPointerDown);
    };
  }, [annotationMode, open]);

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
    restoringContextRef.current = true;
    const storedConversation = latestSakiConversationForContext(readSakiConversations(), contextKey);
    setActiveConversationId(storedConversation?.id ?? newClientId());
    setMessages(
      storedConversation?.messages ?? conversationsRef.current[contextKey] ?? [
        createSakiWelcomeMessage(instance ? `我是 Saki。当前智能体工作区：${instance.name}。` : `我是 Saki。当前上下文：${panelContext.label}。`)
      ]
    );
    setDraft("");
    setPanelError(null);
    setContextTitle(null);
    setContextText(null);
    setSelectedSkillIds([]);
    setAttachments([]);
    setComposerNotice(null);
    setMode(coerceSakiMode("chat", canUseChat, canUseAgent));
  }, [canUseAgent, canUseChat, contextKey, instance, messages, panelContext.label]);

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
        const clamped = clampSakiLauncherPosition(current, launcherRef.current);
        if (sameSakiLauncherPosition(current, clamped)) return current;
        writeSakiLauncherPosition(clamped);
        return clamped;
      });
    }

    clampCurrentLauncherPosition();
    globalThis.addEventListener?.("resize", clampCurrentLauncherPosition);
    return () => {
      globalThis.removeEventListener?.("resize", clampCurrentLauncherPosition);
    };
  }, []);

  function handleLauncherPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    launcherDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    setLauncherDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleLauncherPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance > 4) drag.moved = true;
    if (!drag.moved) return;

    event.preventDefault();
    setLauncherPosition(
      clampSakiLauncherPosition(
        {
          x: event.clientX - drag.offsetX,
          y: event.clientY - drag.offsetY
        },
        event.currentTarget
      )
    );
  }

  function finishLauncherDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = launcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.moved) {
      const nextPosition = clampSakiLauncherPosition(
        {
          x: event.clientX - drag.offsetX,
          y: event.clientY - drag.offsetY
        },
        event.currentTarget
      );
      setLauncherPosition(nextPosition);
      writeSakiLauncherPosition(nextPosition);
      suppressLauncherClickRef.current = true;
      globalThis.setTimeout(() => {
        suppressLauncherClickRef.current = false;
      }, 150);
    }

    launcherDragRef.current = null;
    setLauncherDragging(false);
  }

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
      createSakiWelcomeMessage(instance ? `我是 Saki。当前智能体工作区：${instance.name}。` : `我是 Saki。当前上下文：${panelContext.label}。`)
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
              actions: message.actions.map((item) => (item.id === action.id ? action : item))
            }
          : message
      )
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
              workflow: [...(message.workflow ?? []), step]
            }
          : message
      )
    );
  }

  async function decideAction(action: SakiAgentAction, decision: "approve" | "reject" | "rollback") {
    if (actionBusyId) return;
    setActionBusyId(action.id);
    try {
      const response = await api.sakiAction(token, action.id, decision);
      replaceAction(response.action);
      if (decision === "approve") appendActionCompletionThought(response.action);
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
    }
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
        const response = await api.downloadInstanceFile(token, payload.instanceId, payload.path);
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
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard?.read) {
      imageInputRef.current?.click();
      showComposerNotice("当前浏览器不支持直接读取剪贴板，已打开图片选择。");
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
        const extension = imageType.split("/")[1]?.replace("jpeg", "jpg") || "png";
        imageFiles.push(new File([blob], `clipboard-image-${Date.now()}.${extension}`, { type: imageType }));
      }

      if (imageFiles.length > 0) {
        setComposerBusy(null);
        await addFilesToComposer(imageFiles, "image");
        return;
      }

      imageInputRef.current?.click();
      showComposerNotice("剪贴板里没有图片，已打开图片选择。");
    } catch {
      imageInputRef.current?.click();
      showComposerNotice("剪贴板读取被浏览器拦截，已打开图片选择。");
    } finally {
      setComposerBusy(null);
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
    }
  }

  function toggleSpeechInput() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

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
    const controller = sakiStreamAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    setLoading(false);
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
      workflowExpanded: true,
      streaming: true
    };
    const nextMessages = [...messages, userMessage, assistantMessage];
    setMessages(nextMessages);
    setDraft("");
    setAttachments([]);
    setComposerNotice(null);
    setLoading(true);
    const abortController = new AbortController();
    sakiStreamAbortRef.current = abortController;

    try {
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
        selectedSkillIds,
        attachments: submittedAttachments
      };
      const applyStreamEvent = (streamEvent: SakiChatStreamEvent) => {
        if (abortController.signal.aborted) return;
        if (streamEvent.type === "meta") {
          setReachable(streamEvent.source === "direct-model");
          if (streamEvent.skills) setSkills(streamEvent.skills);
          return;
        }

        if (streamEvent.type === "delta") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: `${message.content}${streamEvent.text}`
                  }
                : message
            )
          );
          return;
        }

        if (streamEvent.type === "workflow") {
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
                  : [...actions, streamEvent.action]
              };
            })
          );
          return;
        }

        setReachable(streamEvent.response.source === "direct-model");
        if (streamEvent.response.skills) setSkills(streamEvent.response.skills);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? (() => {
                  const nextMessage: LocalSakiMessage = {
                    ...message,
                    content: streamEvent.response.message,
                    source: streamEvent.response.source,
                    workflowExpanded: false,
                    streaming: false
                  };
                  if (streamEvent.response.actions?.length) return { ...nextMessage, actions: streamEvent.response.actions };
                  if (message.actions?.length) return { ...nextMessage, actions: message.actions };
                  return nextMessage;
                })()
              : message
          )
        );
      };
      const response = await api.sakiChatStream(token, request, applyStreamEvent, abortController.signal);
      setReachable(response.source === "direct-model");
      if (response.skills) setSkills(response.skills);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? (() => {
                const nextMessage: LocalSakiMessage = {
                  ...message,
                  content: response.message,
                  source: response.source,
                  workflowExpanded: false,
                  streaming: false
                };
                if (response.actions?.length) return { ...nextMessage, actions: response.actions };
                if (message.actions?.length) return { ...nextMessage, actions: message.actions };
                return nextMessage;
              })()
            : message
        )
      );
      setPanelError(null);
    } catch (err) {
      if (abortController.signal.aborted) {
        settleInterruptedSakiMessage(assistantId);
        return;
      }
      const message = err instanceof Error ? err.message : "Saki 暂时没有回应";
      setReachable(false);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: message,
                source: "local-fallback",
                workflowExpanded: false,
                streaming: false,
                workflow: [
                  ...(item.workflow ?? []),
                  {
                    id: newClientId(),
                    stage: "error",
                    message: "流式连接中断",
                    status: "failed",
                    detail: message,
                    createdAt: new Date().toISOString()
                  }
                ]
              }
            : item
        )
      );
    } finally {
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
  const contextPreview = contextText ? compactContextText(contextText.replace(/\s+/g, " "), 180) : "";
  const hasStreamingAssistant = messages.some((message) => message.role === "assistant" && message.streaming);
  const launcherStyle = launcherPosition
    ? {
        left: `${launcherPosition.x}px`,
        top: `${launcherPosition.y}px`,
        right: "auto",
        bottom: "auto"
      }
    : undefined;

  return (
    <>
      <button
        ref={launcherRef}
        className={`saki-launcher ${launcherDragging ? "is-dragging" : ""} ${sakiFileHoverActive ? "drop-ready" : ""} ${open ? "hiding" : ""}`}
        type="button"
        title="Saki"
        aria-label="打开 Saki"
        style={launcherStyle}
        onClick={handleLauncherClick}
        onPointerDown={handleLauncherPointerDown}
        onPointerMove={handleLauncherPointerMove}
        onPointerUp={finishLauncherDrag}
        onPointerCancel={finishLauncherDrag}
        onDragEnter={handleSakiFileDragEnter}
        onDragOver={handleSakiFileDragOver}
        onDragLeave={handleSakiFileDragLeave}
        onDrop={handleSakiFileDrop}
      >
        <span className="saki-launcher-glow" />
        <SakiCharacterArt mood={artMood} compact fileDrop={fileDragActive} />
      </button>

      <section
        ref={panelRef}
        className={`saki-panel ${messagesExpanded ? "expanded" : "collapsed"} ${fullscreen ? "fullscreen" : ""} ${sakiFileHoverActive ? "drop-ready" : ""} ${open ? "visible" : "hidden"}`}
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
          <div className="saki-messages-inner">
            <div className="saki-header">
            <span className={`saki-agent-status ${statusClass}`}>{statusLabel}</span>
            <div className="saki-header-actions">
              <button className="icon-button mini" type="button" title="历史记录" onClick={toggleSakiHistory}>
                <Clock size={15} />
              </button>
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
            </div>
            <button className="icon-button mini" type="button" title="关闭输入框" onClick={closeSakiPanel}>
              <X size={15} />
            </button>
            <div className="saki-title">
              <div className="saki-title-avatar">
                <SakiCharacterArt mood={artMood} compact={true} fileDrop={fileDragActive} />
              </div>
              <div>
                <div className="saki-title-row">
                  <h2>Saki</h2>
                </div>
                <span className="saki-title-context">{contextLabel} · {contextPath}</span>
              </div>
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

          <div className="saki-messages">
            {messages.map((message) => {
              const workflowCount = message.workflow?.length ?? 0;
              const workflowOpen = Boolean(message.workflowExpanded);
              const actionItems = visibleSakiActions(message.actions);
              const fileRollbackActions = actionItems.filter(isSakiFileRollbackAction);
              const regularActions = actionItems.filter((action) => !isSakiFileRollbackAction(action));
              const rollbackableFileActions = fileRollbackActions.filter(isSakiRollbackableFileEdit);
              const rollbackGroupOpen = Boolean(message.rollbackGroupExpanded);
              return (
          <div className={`saki-message saki-message-${message.role}`} key={message.id}>
            <div className="saki-message-meta">
              {message.role === "assistant" ? (
                <img className="saki-message-avatar" src={sakiArtAssets.avatar} alt="" />
              ) : null}
              <span>{message.role === "assistant" ? "Saki" : "你"}</span>
              {message.source === "local-fallback" ? <em>fallback</em> : null}
            </div>
            <div className="saki-message-body">
              {workflowCount ? (
                <button
                  className="saki-workflow-toggle"
                  type="button"
                  aria-expanded={workflowOpen}
                  onClick={() => toggleSakiWorkflow(message.id)}
                >
                  <ChevronRight size={14} style={{ transform: workflowOpen ? "rotate(90deg)" : "none" }} />
                  {workflowOpen ? "收起过程" : `查看过程 · ${workflowCount}`}
                </button>
              ) : null}
              {message.workflow?.length && workflowOpen ? <SakiThinkingTrace steps={message.workflow} /> : null}
              {message.content ? <MarkdownContent content={message.content} /> : null}
              {!message.content && message.streaming ? <p className="saki-stream-placeholder">接收中...</p> : null}
              {message.attachments?.length ? (
                <div className="saki-message-attachments">
                  {message.attachments.map((attachment, index) => (
                    <SakiAttachmentChip attachment={attachment} key={attachment.id ?? `${attachment.name}-${index}`} />
                  ))}
                </div>
              ) : null}
            </div>
            {regularActions.length || fileRollbackActions.length ? (
              <div className="saki-action-log">
                {regularActions.map((action) => (
                  <div className={action.status === "pending_approval" ? "saki-action-item pending" : action.ok ? "saki-action-item ok" : "saki-action-item error"} key={action.id}>
                    <div>
                      <strong>{sakiActionTitle(action)}</strong>
                      <span>{sakiActionStatusLabel(action)}</span>
                    </div>
                    <p>{compactContextText(action.observation.replace(/\s+/g, " "), 220)}</p>
                    {action.approval?.preview ? <pre>{compactContextText(action.approval.preview, 1200)}</pre> : null}
                    {action.approval?.diff ? <pre>{compactContextText(action.approval.diff, 1800)}</pre> : null}
                    {action.status === "pending_approval" ? (
                      <div className="saki-action-controls">
                        <button className="small-button" type="button" disabled={actionBusyId === action.id} onClick={() => void decideAction(action, "approve")}>
                          <CheckCircle2 size={14} />
                          批准
                        </button>
                        <button className="small-button danger-action" type="button" disabled={actionBusyId === action.id} onClick={() => void decideAction(action, "reject")}>
                          <X size={14} />
                          拒绝
                        </button>
                      </div>
                    ) : action.approval?.rollbackAvailable ? (
                      <div className="saki-action-controls">
                        <button className="small-button" type="button" disabled={actionBusyId === action.id} onClick={() => void decideAction(action, "rollback")}>
                          <CornerUpLeft size={14} />
                          {isSakiRollbackableFileEdit(action) ? "回溯" : "回滚"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {fileRollbackActions.length ? (
                  <div className="saki-rollback-group">
                    <div className="saki-rollback-header">
                      <button
                        className="saki-rollback-toggle"
                        type="button"
                        aria-expanded={rollbackGroupOpen}
                        onClick={() => toggleSakiRollbackGroup(message.id)}
                      >
                        <ChevronRight size={14} style={{ transform: rollbackGroupOpen ? "rotate(90deg)" : "none" }} />
                        <span>可回溯代码</span>
                        <em>
                          {fileRollbackActions.length} 个文件
                          {rollbackableFileActions.length < fileRollbackActions.length ? ` · 已回溯 ${fileRollbackActions.length - rollbackableFileActions.length}` : ""}
                        </em>
                      </button>
                      <button
                        className="small-button"
                        type="button"
                        disabled={Boolean(actionBusyId) || rollbackableFileActions.length === 0}
                        onClick={() => void rollbackAllFileActions(message.id, fileRollbackActions)}
                      >
                        <CornerUpLeft size={14} />
                        全部回溯
                      </button>
                    </div>
                    {rollbackGroupOpen ? (
                      <div className="saki-rollback-list">
                        {fileRollbackActions.map((action) => (
                          <div
                            className={
                              action.status === "rolled_back"
                                ? "saki-rollback-row rolled-back"
                                : action.ok
                                  ? "saki-rollback-row"
                                  : "saki-rollback-row error"
                            }
                            key={action.id}
                          >
                            <span>{sakiActionPath(action) || action.tool}</span>
                            <em>{action.status === "rolled_back" ? "已回溯" : action.approval?.rollbackAvailable ? "可回溯" : action.ok ? "完成" : "失败"}</em>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
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

          {skillsLoading || skills.length > 0 ? (
            <div className="saki-skill-row">
              {skillsLoading ? <span className="saki-skill-loading">Skills...</span> : null}
              {skills.slice(0, 5).map((skill) => (
                <button
                  className={selectedSkillIds.includes(skill.id) ? "saki-skill-chip active" : "saki-skill-chip"}
                  type="button"
                  key={skill.id}
                  title={skill.description ?? skill.name}
                  onClick={() => toggleSkill(skill.id)}
                >
                  {skill.name}
                </button>
              ))}
            </div>
          ) : null}
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
            title={messagesExpanded ? "折叠对话" : "展开对话"}
            aria-label={messagesExpanded ? "折叠对话" : "展开对话"}
            aria-expanded={messagesExpanded}
            onClick={() => setMessagesExpanded((current) => !current)}
          >
            <ChevronLeft style={{ transform: messagesExpanded ? "rotate(-90deg)" : "rotate(90deg)" }} size={16} />
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
                        {message.content ? <MarkdownContent content={message.content} /> : null}
                        {!message.content && message.streaming ? <p className="saki-stream-placeholder">接收中...</p> : null}
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
          <div className="saki-mode-tabs">
            {canUseChat ? (
              <button className={mode === "chat" ? "active" : ""} type="button" onClick={() => selectSakiMode("chat")}>
                对话
              </button>
            ) : null}
            {canUseAgent ? (
              <button className={mode === "agent" ? "active" : ""} type="button" onClick={() => selectSakiMode("agent")}>
                智能体
              </button>
            ) : null}
          </div>
          <div className="saki-input-row">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handleComposerPaste}
              placeholder={
                contextText
                  ? "针对已附加的上下文继续追问"
                  : auditSearchActive
                    ? "让 Saki 查找审计日志"
                    : instance
                      ? "问 Saki 当前实例里的问题"
                      : "问 Saki"
              }
              rows={2}
            />
            {attachments.length > 0 ? (
              <div className="saki-attachment-tray">
                {attachments.map((attachment, index) => (
                  <SakiAttachmentChip
                    attachment={attachment}
                    key={attachment.id ?? `${attachment.name}-${index}`}
                    removable
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
                  onClick={() => attachmentInputRef.current?.click()}
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
              <button
                className={`primary-button send-btn ${loading ? "stop" : ""}`}
                type={loading ? "button" : "submit"}
                title={loading ? "停止生成" : "发送"}
                disabled={!loading && !draft.trim() && attachments.length === 0}
                onClick={loading ? stopSakiGeneration : undefined}
              >
                {loading ? <Square size={15} /> : <Send size={15} />}
                {loading ? "停止" : "发送"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
    </>
  );
}

type TerminalConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

function terminalStateLabel(state: TerminalConnectionState): string {
  const labels: Record<TerminalConnectionState, string> = {
    idle: "未连接",
    connecting: "连接中",
    connected: "已连接",
    reconnecting: "重连中",
    closed: "已断开",
    error: "连接异常"
  };
  return labels[state];
}

function formatTerminalLine(line: InstanceLogLine): string {
  const prefix =
    line.stream === "stdin"
      ? "\x1b[32m>\x1b[0m "
      : line.stream === "stderr"
        ? "\x1b[31mERR\x1b[0m "
        : line.stream === "system"
          ? "\x1b[33mSYS\x1b[0m "
          : "";
  return `${prefix}${line.text}\r\n`;
}

function WebTerminal({
  token,
  instance,
  onStatus,
  onAskSaki
}: {
  token: string;
  instance: ManagedInstance | null;
  onStatus: (instanceId: string, status: InstanceStatus, exitCode?: number | null) => void;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
}) {
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const directInputBufferRef = useRef("");
  const terminalDataHandlerRef = useRef<(data: string) => void>(() => {});
  const [terminalReady, setTerminalReady] = useState(false);
  const [connectionState, setConnectionState] = useState<TerminalConnectionState>("idle");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const [lastIssue, setLastIssue] = useState("");
  const [reconnectTick, setReconnectTick] = useState(0);
  const [terminalActionBusy, setTerminalActionBusy] = useState(false);
  const instanceId = instance?.id ?? null;
  const instanceName = instance?.name ?? "";

  useEffect(() => {
    if (!terminalElementRef.current || terminalRef.current) return;

    const terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Consolas, "SFMono-Regular", monospace',
      fontSize: 13,
      scrollback: 2500,
      theme: {
        background: "#101820",
        foreground: "#e5edf5",
        cursor: "#a7f3d0",
        selectionBackground: "#31505f"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElementRef.current);
    const inputSubscription = terminal.onData((data) => terminalDataHandlerRef.current(data));
    const selectionSubscription = terminal.onSelectionChange(() => rememberSakiTerminalSelection(terminal.getSelection()));
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);

    const resize = () => fitAddon.fit();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      inputSubscription.dispose();
      selectionSubscription.dispose();
      clearRememberedSakiTerminalSelection();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminalReady(false);
    };
  }, []);

  useEffect(() => {
    setLastIssue("");
    directInputBufferRef.current = "";
    clearRememberedSakiTerminalSelection();
    if (!terminalReady || !instanceId) {
      setConnectionState("idle");
      socketRef.current?.close(1000, "No instance selected");
      return;
    }

    let disposed = false;
    const terminal = terminalRef.current;
    if (!terminal) return;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      clearReconnectTimer();
      setError("");
      setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      const socket = new WebSocket(api.terminalUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionState("connected");
        socket.send(JSON.stringify({ type: "auth", token, instanceId }));
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as TerminalServerMessage;
          if (payload.type === "hello") {
            terminal.clear();
            for (const line of payload.lines) {
              terminal.write(formatTerminalLine(line));
            }
            onStatus(payload.instanceId, payload.status, payload.exitCode);
            return;
          }
          if (payload.type === "line") {
            terminal.write(formatTerminalLine(payload.line));
            if (isTerminalIssue(payload.line)) {
              setLastIssue(payload.line.text);
            }
            return;
          }
          if (payload.type === "status") {
            onStatus(payload.instanceId, payload.status, payload.exitCode);
            return;
          }
          if (payload.type === "error") {
            setError(payload.message);
            terminal.write(`\x1b[31m${payload.message}\x1b[0m\r\n`);
          }
        } catch {
          terminal.write(String(event.data));
        }
      };

      socket.onerror = () => {
        if (!disposed) {
          setConnectionState("error");
          setError("终端连接异常");
        }
      };

      socket.onclose = () => {
        if (disposed) {
          setConnectionState("closed");
          return;
        }
        reconnectAttemptRef.current += 1;
        setConnectionState("reconnecting");
        const delay = Math.min(5000, reconnectAttemptRef.current * 1200);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    terminal.clear();
    terminal.write(`\x1b[33mConnecting to ${instanceName}...\x1b[0m\r\n`);
    reconnectAttemptRef.current = 0;
    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearRememberedSakiTerminalSelection();
      socketRef.current?.close(1000, "Terminal view changed");
      socketRef.current = null;
    };
  }, [instanceId, instanceName, onStatus, reconnectTick, terminalReady, token]);

  function sendInput(data: string, echo = true) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("终端未连接");
      return;
    }
    socket.send(JSON.stringify({ type: "input", data, echo }));
  }

  function submitCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    sendInput(`${value}\n`);
    setCommand("");
  }

  async function toggleTerminalProcess() {
    if (!instance || terminalActionBusy) return;
    if (running) {
      sendInput("\u0003");
      return;
    }

    setTerminalActionBusy(true);
    setError("");
    try {
      const response = await api.startInstance(token, instance.id);
      onStatus(response.instance.id, response.instance.status, response.instance.lastExitCode);
      setReconnectTick((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "实例启动失败");
    } finally {
      setTerminalActionBusy(false);
    }
  }

  const running = instance?.status === "RUNNING";
  const starting = instance?.status === "STARTING";
  const stopping = instance?.status === "STOPPING";
  const connected = connectionState === "connected";
  const terminalActionDisabled = running ? !connected || terminalActionBusy : !instance || starting || stopping || terminalActionBusy;
  const terminalActionTitle = running ? "中断" : starting ? "启动中" : "启动";

  terminalDataHandlerRef.current = (data: string) => {
    if (data === "\u0003") {
      directInputBufferRef.current = "";
      sendInput("\u0003");
      return;
    }
    if (!connected || !running) {
      setError("实例运行并连接后才能输入");
      return;
    }
    if (data.startsWith("\x1b")) return;

    const terminal = terminalRef.current;
    let buffer = directInputBufferRef.current;
    const normalized = data.replace(/\r\n/g, "\r");

    for (const character of normalized) {
      if (character === "\r" || character === "\n") {
        terminal?.write("\r\n");
        sendInput(`${buffer}\n`, false);
        buffer = "";
        continue;
      }
      if (character === "\u007f" || character === "\b") {
        if (buffer.length > 0) {
          buffer = Array.from(buffer).slice(0, -1).join("");
          terminal?.write("\b \b");
        }
        continue;
      }
      if (character < " " && character !== "\t") continue;
      buffer += character;
      terminal?.write(character);
    }

    directInputBufferRef.current = buffer;
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <div className={`terminal-connection terminal-state-${connectionState}`}>
          <span />
          {terminalStateLabel(connectionState)}
        </div>
        <div className="terminal-toolbar-actions">
          <button
            className="icon-button mini"
            title="清空"
            type="button"
            onClick={() => {
              terminalRef.current?.clear();
              clearRememberedSakiTerminalSelection();
            }}
          >
            <Trash2 size={15} />
          </button>
          <button
            className="icon-button mini"
            title="重连"
            type="button"
            onClick={() => setReconnectTick((value) => value + 1)}
            disabled={!instance}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className={running ? "icon-button mini danger-action" : "icon-button mini"}
            title={terminalActionTitle}
            type="button"
            onClick={() => void toggleTerminalProcess()}
            disabled={terminalActionDisabled}
          >
            {running ? <XOctagon size={15} /> : <Play size={15} />}
          </button>
        </div>
      </div>
      <div className="xterm-host" ref={terminalElementRef} onClick={() => terminalRef.current?.focus()} />
      <form className="terminal-command-bar" onSubmit={submitCommand}>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          disabled={!connected || !running}
          placeholder={running ? "命令" : "实例未运行"}
        />
        <button className="primary-button terminal-send" type="submit" disabled={!connected || !running || !command.trim()}>
          <Send size={17} />
        </button>
      </form>
      {error ? <div className="terminal-error">{error}</div> : null}
      {lastIssue ? (
        <div className="terminal-issue">
          <span>{lastIssue}</span>
          {onAskSaki ? (
            <button
              className="small-button"
              type="button"
              onClick={() =>
                onAskSaki({
                  message: `请解释这个终端报错，并基于当前实例工作区给出修复方案：\n${lastIssue}`,
                  panelError: lastIssue,
                  mode: "agent"
                })
              }
            >
              <Sparkles size={14} />
              问 Saki
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FileManager({
  token,
  instance,
  onSakiFileDragChange,
  onSakiInstanceFileDrop
}: {
  token: string;
  instance: ManagedInstance | null;
  onSakiFileDragChange: (active: boolean) => void;
  onSakiInstanceFileDrop?: ((payload: SakiInstanceFileDragPayload) => void) | undefined;
}) {
  const instanceId = instance?.id ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const conflictResolveRef = useRef<((choice: FileConflictChoice | null) => void) | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const mobileFileLongPressRef = useRef<{
    pointerId: number;
    entry: InstanceFileEntry;
    payload: SakiInstanceFileDragPayload;
    startX: number;
    startY: number;
    timerId: number;
    active: boolean;
  } | null>(null);
  const suppressMobileFileClickRef = useRef(false);
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<InstanceFileEntry[]>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [findVisible, setFindVisible] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findActiveIndex, setFindActiveIndex] = useState(0);
  const [extractingPath, setExtractingPath] = useState<string | null>(null);
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const [fileConflictPrompt, setFileConflictPrompt] = useState<FileConflictPrompt | null>(null);
  const [uploadProgress, setUploadProgress] = useState<(UploadProgressUpdate & { fileName: string }) | null>(null);
  const [fileToast, setFileToast] = useState<FileToast | null>(null);
  const [mobileFileDrag, setMobileFileDrag] = useState<{
    name: string;
    path: string;
    x: number;
    y: number;
    overSaki: boolean;
  } | null>(null);
  const [mobileBrowserOpen, setMobileBrowserOpen] = useState(false);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filteredEntries = useMemo(() => {
    const query = fileSearchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => `${entry.name} ${entry.path}`.toLowerCase().includes(query));
  }, [entries, fileSearchQuery]);
  const selectedEntry = entries.find((entry) => entry.path === selectedPath) ?? null;
  const editorLanguage = useMemo(() => editorLanguageFromPath(editorPath), [editorPath]);
  const editorPreviewKind = useMemo(() => filePreviewKindFromPath(editorPath), [editorPath]);
  const editorIsImage = editorPreviewKind === "image";
  const editorCanEdit = Boolean(editorPath && !editorIsImage);
  const editorCanTogglePreview = editorPreviewKind === "html" || editorPreviewKind === "markdown";
  const findMatches = useMemo(
    () => (editorCanEdit ? collectFindMatches(editorContent, findQuery) : []),
    [editorCanEdit, editorContent, findQuery]
  );
  const activeFindIndex = findMatches.length > 0 ? Math.min(findActiveIndex, findMatches.length - 1) : -1;
  const findResultLabel = !findQuery
    ? "输入关键词"
    : findMatches.length > 0
      ? `${activeFindIndex + 1}/${findMatches.length}`
      : "无结果";

  const loadDirectory = useCallback(
    async (pathToLoad: string) => {
      if (!instanceId) return;
      setLoading(true);
      setError("");
      try {
        const response = await api.listInstanceFiles(token, instanceId, pathToLoad);
        setCurrentPath(response.path);
        setEntries(response.entries);
        setFileSearchQuery("");
        setSelectedPath(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "文件列表读取失败");
      } finally {
        setLoading(false);
      }
    },
    [instanceId, token]
  );

  useEffect(() => {
    setCurrentPath("");
    setEntries([]);
    setFileSearchQuery("");
    setSelectedPath(null);
    setEditorPath(null);
    setEditorContent("");
    setEditorMode("edit");
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
    setExtractingPath(null);
    setDraggingFilePath(null);
    setFileConflictPrompt(null);
    setUploadProgress(null);
    setFileToast(null);
    setMobileBrowserOpen(false);
    setMobileEditorOpen(false);
    if (instanceId) {
      void loadDirectory("");
    }
  }, [instanceId, loadDirectory]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (mobileFileLongPressRef.current) {
        window.clearTimeout(mobileFileLongPressRef.current.timerId);
      }
    };
  }, []);

  useEffect(() => {
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
  }, [editorPath]);

  useEffect(() => {
    if (editorIsImage && editorMode !== "preview") {
      setEditorMode("preview");
      return;
    }
    if (!editorPreviewKind && editorMode !== "edit") {
      setEditorMode("edit");
    }
    if (editorMode === "preview") {
      setFindVisible(false);
    }
  }, [editorIsImage, editorMode, editorPreviewKind]);

  useEffect(() => {
    setFindActiveIndex(0);
  }, [findQuery]);

  useEffect(() => {
    if (!mobileBrowserOpen && !mobileEditorOpen) return;
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 760px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileBrowserOpen, mobileEditorOpen]);

  useEffect(() => {
    if (!findVisible) return;
    const frame = window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [findVisible]);

  useEffect(() => {
    if (findMatches.length === 0) {
      if (findActiveIndex !== 0) setFindActiveIndex(0);
      return;
    }
    if (findActiveIndex >= findMatches.length) {
      setFindActiveIndex(findMatches.length - 1);
    }
  }, [findActiveIndex, findMatches.length]);

  useEffect(() => {
    const match = activeFindIndex >= 0 ? findMatches[activeFindIndex] : null;
    if (match) {
      revealFindMatch(match, false);
    }
  }, [activeFindIndex, editorContent, findMatches]);

  function revealFindMatch(_match: FindMatchRange, _focusEditor: boolean) {
  }

  function isMobileFileLayout() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
  }

  function closeMobileBrowserModal() {
    setMobileEditorOpen(false);
    setMobileBrowserOpen(false);
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
  }

  function closeMobileEditorModal() {
    setMobileEditorOpen(false);
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
  }

  function openEditorFind() {
    if (!editorCanEdit) return;
    setFindVisible(true);
  }

  function closeEditorFind() {
    setFindVisible(false);
    setFindQuery("");
    setFindActiveIndex(0);
  }

  function moveFindMatch(step: number, focusEditor: boolean) {
    if (findMatches.length === 0) return;
    const nextIndex =
      activeFindIndex >= 0 ? (activeFindIndex + step + findMatches.length) % findMatches.length : 0;
    setFindActiveIndex(nextIndex);
    const match = findMatches[nextIndex];
    if (match) {
      window.requestAnimationFrame(() => revealFindMatch(match, focusEditor));
    }
  }

  function handleFileManagerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!editorCanEdit || editorMode !== "edit") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openEditorFind();
      return;
    }
    if (event.key === "Escape" && findVisible) {
      event.preventDefault();
      closeEditorFind();
    }
  }

  function sakiPayloadForEntry(entry: InstanceFileEntry): SakiInstanceFileDragPayload | null {
    if (!instanceId || entry.type !== "file") return null;
    return {
      source: "webops-instance-file",
      instanceId,
      instanceName: instance?.name ?? "",
      path: entry.path,
      name: entry.name,
      size: entry.size,
      modifiedAt: entry.modifiedAt
    };
  }

  function handleEntryDragStart(event: React.DragEvent<HTMLElement>, entry: InstanceFileEntry) {
    const payload = sakiPayloadForEntry(entry);
    if (!payload) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(sakiInstanceFileDragMime, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", entry.path);
    setDraggingFilePath(entry.path);
    onSakiFileDragChange(true);
  }

  function handleEntryDragEnd() {
    setDraggingFilePath(null);
    onSakiFileDragChange(false);
  }

  function isSakiDropTargetAt(clientX: number, clientY: number): boolean {
    const element = document.elementFromPoint(clientX, clientY);
    return Boolean(element?.closest(".saki-launcher, .saki-panel"));
  }

  function cancelMobileFileLongPress() {
    const drag = mobileFileLongPressRef.current;
    if (drag) {
      window.clearTimeout(drag.timerId);
    }
    mobileFileLongPressRef.current = null;
    setMobileFileDrag(null);
    setDraggingFilePath(null);
    onSakiFileDragChange(false);
  }

  function handleEntryPointerDown(event: React.PointerEvent<HTMLTableRowElement>, entry: InstanceFileEntry) {
    if (!isMobileFileLayout() || event.pointerType === "mouse" || (event.target as HTMLElement).closest(".row-actions")) {
      return;
    }
    const payload = sakiPayloadForEntry(entry);
    if (!payload || !onSakiInstanceFileDrop) return;

    const target = event.currentTarget;
    const timerId = window.setTimeout(() => {
      const drag = mobileFileLongPressRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.active = true;
      setDraggingFilePath(entry.path);
      onSakiFileDragChange(true);
      setMobileFileDrag({
        name: entry.name,
        path: entry.path,
        x: drag.startX,
        y: drag.startY,
        overSaki: isSakiDropTargetAt(drag.startX, drag.startY)
      });
    }, 420);

    mobileFileLongPressRef.current = {
      pointerId: event.pointerId,
      entry,
      payload,
      startX: event.clientX,
      startY: event.clientY,
      timerId,
      active: false
    };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
    }
  }

  function handleEntryPointerMove(event: React.PointerEvent<HTMLTableRowElement>) {
    const drag = mobileFileLongPressRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active && distance > 12) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      cancelMobileFileLongPress();
      return;
    }

    if (!drag.active) return;
    event.preventDefault();
    setMobileFileDrag({
      name: drag.entry.name,
      path: drag.entry.path,
      x: event.clientX,
      y: event.clientY,
      overSaki: isSakiDropTargetAt(event.clientX, event.clientY)
    });
  }

  function finishMobileFileDrag(event: React.PointerEvent<HTMLTableRowElement>) {
    const drag = mobileFileLongPressRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const shouldDrop = drag.active && isSakiDropTargetAt(event.clientX, event.clientY);
    const payload = drag.payload;
    if (drag.active) {
      suppressMobileFileClickRef.current = true;
      window.setTimeout(() => {
        suppressMobileFileClickRef.current = false;
      }, 500);
    }
    cancelMobileFileLongPress();
    if (shouldDrop && onSakiInstanceFileDrop) {
      onSakiInstanceFileDrop(payload);
    }
  }

  function handleEntryPointerCancel(event: React.PointerEvent<HTMLTableRowElement>) {
    const drag = mobileFileLongPressRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    cancelMobileFileLongPress();
  }

  function handleEntryContextMenu(event: React.MouseEvent<HTMLTableRowElement>, entry: InstanceFileEntry) {
    if (entry.type === "file" && isMobileFileLayout()) {
      event.preventDefault();
    }
  }

  function showFileToast(title: string, detail: string) {
    const id = Date.now();
    setFileToast({ id, title, detail });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setFileToast((current) => (current?.id === id ? null : current));
    }, 3600);
  }

  function askFileConflict(prompt: FileConflictPrompt): Promise<FileConflictChoice | null> {
    return new Promise((resolve) => {
      conflictResolveRef.current = resolve;
      setFileConflictPrompt(prompt);
    });
  }

  function resolveFileConflict(choice: FileConflictChoice | null) {
    conflictResolveRef.current?.(choice);
    conflictResolveRef.current = null;
    setFileConflictPrompt(null);
  }

  function existingEntryByName(name: string): InstanceFileEntry | null {
    const normalized = name.toLocaleLowerCase();
    return entries.find((entry) => entry.name.toLocaleLowerCase() === normalized) ?? null;
  }

  async function chooseTargetName(action: FileConflictPrompt["action"], name: string) {
    const existing = existingEntryByName(name);
    if (!existing) {
      return { name, path: joinFilePath(currentPath, name), overwrite: false };
    }

    const suggestedName = uniqueSiblingName(name, entries);
    const choice = await askFileConflict({
      action,
      name,
      suggestedName,
      canOverwrite: existing.type === "file"
    });
    if (!choice) return null;
    if (choice === "overwrite" && existing.type === "file") {
      return { name, path: joinFilePath(currentPath, name), overwrite: true };
    }
    return {
      name: suggestedName,
      path: joinFilePath(currentPath, suggestedName),
      overwrite: false
    };
  }

  async function openEntry(entry: InstanceFileEntry) {
    setSelectedPath(entry.path);
    setError("");
    if (entry.type === "directory") {
      setEditorPath(null);
      setEditorContent("");
      setEditorMode("edit");
      await loadDirectory(entry.path);
      return;
    }

    if (!instanceId || entry.type !== "file") return;
    try {
      if (isImageFile(entry.path)) {
        const response = await api.downloadInstanceFile(token, instanceId, entry.path);
        const mimeType = imageMimeTypeFromPath(response.path) ?? imageMimeTypeFromPath(entry.path) ?? "image/png";
        setEditorPath(response.path);
        setEditorContent(`data:${mimeType};base64,${response.contentBase64}`);
        setEditorMode("preview");
        if (isMobileFileLayout()) {
          setMobileEditorOpen(true);
        }
        return;
      }

      const response = await api.readInstanceFile(token, instanceId, entry.path);
      setEditorPath(response.path);
      setEditorContent(response.content);
      setEditorMode(filePreviewKindFromPath(response.path) ? "preview" : "edit");
      if (isMobileFileLayout()) {
        setMobileEditorOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件读取失败");
    }
  }

  async function saveEditor() {
    if (!instanceId || !editorPath || !editorCanEdit) return;
    setSaving(true);
    setError("");
    try {
      await api.writeInstanceFile(token, instanceId, editorPath, editorContent);
      await loadDirectory(currentPath);
      setSelectedPath(editorPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function createFile() {
    if (!instanceId) return;
    const name = window.prompt("文件名")?.trim();
    if (!name) return;
    const target = await chooseTargetName("create", name);
    if (!target) return;
    setError("");
    try {
      await api.writeInstanceFile(token, instanceId, target.path, "");
      await loadDirectory(currentPath);
      const response = await api.readInstanceFile(token, instanceId, target.path);
      setSelectedPath(response.path);
      setEditorPath(response.path);
      setEditorContent(response.content);
      setEditorMode("edit");
      if (isMobileFileLayout()) {
        setMobileEditorOpen(true);
      }
      showFileToast(target.overwrite ? "文件已覆盖" : "文件已创建", `已保存为 ${target.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件创建失败");
    }
  }

  async function createDirectory() {
    if (!instanceId) return;
    const name = window.prompt("目录名")?.trim();
    if (!name) return;
    setError("");
    try {
      await api.makeInstanceDirectory(token, instanceId, joinFilePath(currentPath, name));
      await loadDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "目录创建失败");
    }
  }

  async function renameEntry(entry: InstanceFileEntry) {
    if (!instanceId) return;
    const nextName = window.prompt("新名称", entry.name)?.trim();
    if (!nextName || nextName === entry.name) return;
    const nextPath = joinFilePath(parentFilePath(entry.path), nextName);
    setError("");
    try {
      const response = await api.renameInstancePath(token, instanceId, entry.path, nextPath);
      await loadDirectory(currentPath);
      if (editorPath === entry.path) {
        await openEntry(response);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败");
    }
  }

  async function deleteEntry(entry: InstanceFileEntry) {
    if (!instanceId) return;
    if (!window.confirm(`删除 ${entry.name}？`)) return;
    setError("");
    try {
      await api.deleteInstancePath(token, instanceId, entry.path);
      if (editorPath === entry.path) {
        setEditorPath(null);
        setEditorContent("");
        setEditorMode("edit");
        setMobileEditorOpen(false);
      }
      await loadDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function uploadFile(file: File) {
    if (!instanceId) return;
    const target = await chooseTargetName("upload", file.name);
    if (!target) {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    setError("");
    setUploadProgress({ fileName: target.name, percent: 1, label: "读取文件" });
    try {
      const response = await api.uploadInstanceFileWithProgress(
        token,
        instanceId,
        target.path,
        file,
        target.overwrite,
        (progress) => setUploadProgress({ ...progress, fileName: target.name })
      );
      await loadDirectory(currentPath);
      setSelectedPath(response.path);
      if (editorPath === response.path) {
        setEditorPath(null);
        setEditorContent("");
        setEditorMode("edit");
      }
      showFileToast("上传成功", `已保存为 ${target.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      window.setTimeout(() => {
        setUploadProgress((current) => (current?.fileName === target.name ? null : current));
      }, 700);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function downloadEntry(entry: InstanceFileEntry) {
    if (!instanceId || entry.type !== "file") return;
    setError("");
    try {
      const response = await api.downloadInstanceFile(token, instanceId, entry.path);
      const url = URL.createObjectURL(base64ToBlob(response.contentBase64));
      const link = document.createElement("a");
      link.href = url;
      link.download = response.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败");
    }
  }

  async function extractArchive(entry: InstanceFileEntry) {
    if (!instanceId || entry.type !== "file" || !isArchiveFile(entry.path)) return;
    const suggestedPath = defaultExtractPath(entry.path);
    const rawOutputPath = window.prompt("解压到目录", suggestedPath);
    if (rawOutputPath === null) return;
    const outputPath = rawOutputPath.trim() || suggestedPath;
    setError("");
    setExtractingPath(entry.path);
    try {
      const response = await api.extractInstanceArchive(token, instanceId, entry.path, outputPath);
      setEditorPath(null);
      setEditorContent("");
      setEditorMode("edit");
      await loadDirectory(parentFilePath(response.outputPath));
      setSelectedPath(response.outputPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解压失败");
    } finally {
      setExtractingPath(null);
    }
  }

  if (!instance) {
    return <div className="empty-state">请选择实例</div>;
  }

  return (
    <div
      className={[
        "file-manager",
        mobileBrowserOpen ? "mobile-browser-open" : "",
        mobileEditorOpen ? "mobile-editor-open" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={handleFileManagerKeyDown}
    >
      <div className="mobile-file-entry">
        <button className="mobile-file-entry-button" type="button" onClick={() => setMobileBrowserOpen(true)}>
          <span className="mobile-file-entry-icon">
            <Folder size={22} />
          </span>
          <span className="mobile-file-entry-copy">
            <strong>打开文件管理</strong>
            <span>
              /{currentPath || ""} · {entries.length} 项
              {editorPath ? ` · ${editorPath}` : ""}
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
      </div>
      {mobileBrowserOpen ? (
        <div className="mobile-file-browser-scrim" role="presentation" onMouseDown={closeMobileBrowserModal} />
      ) : null}
      {mobileEditorOpen ? (
        <div className="mobile-file-editor-scrim" role="presentation" onMouseDown={closeMobileEditorModal} />
      ) : null}
      {mobileFileDrag ? (
        <div
          className={`mobile-file-drag-ghost ${mobileFileDrag.overSaki ? "over-saki" : ""}`}
          style={{ left: `${mobileFileDrag.x}px`, top: `${mobileFileDrag.y}px` }}
          aria-hidden="true"
        >
          <FileText size={16} />
          <span>{mobileFileDrag.name}</span>
        </div>
      ) : null}
      <div className="file-manager-modal-chrome">
        <div className="mobile-file-modal-header">
          <div>
            <strong>文件管理</strong>
            <span>{instance.name}</span>
          </div>
          <button className="icon-button mini" title="关闭文件管理" type="button" onClick={closeMobileBrowserModal}>
            <X size={15} />
          </button>
        </div>
        <div className="file-toolbar">
          <span className="path-pill">/{currentPath}</span>
          <label className="file-search-box">
            <Search size={15} />
            <input
              value={fileSearchQuery}
              onChange={(event) => setFileSearchQuery(event.target.value)}
              placeholder="搜索文件"
              aria-label="搜索文件"
            />
            {fileSearchQuery ? (
              <button className="icon-button mini" type="button" title="清空搜索" onClick={() => setFileSearchQuery("")}>
                <X size={14} />
              </button>
            ) : null}
          </label>
          <div className="file-toolbar-actions">
            <button
              className="small-button compact-button file-parent-button"
              type="button"
              title="返回上一级目录"
              disabled={!currentPath}
              onClick={() => void loadDirectory(parentFilePath(currentPath))}
            >
              <CornerUpLeft size={15} />
              <span>上一级</span>
            </button>
            <button className="icon-button mini" title="刷新" disabled={loading} onClick={() => void loadDirectory(currentPath)}>
              <RefreshCw size={15} />
            </button>
            <button className="icon-button mini" title="新建文件" onClick={() => void createFile()}>
              <FilePlus size={15} />
            </button>
            <button className="icon-button mini" title="新建目录" onClick={() => void createDirectory()}>
              <FolderPlus size={15} />
            </button>
            <button className="icon-button mini" title="上传" onClick={() => fileInputRef.current?.click()}>
              <Upload size={15} />
            </button>
            <input
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
              }}
            />
          </div>
        </div>
        <div className={`file-status-area ${!error && !uploadProgress ? "empty" : ""}`}>
          {uploadProgress ? (
            <div className="file-upload-progress" role="status" aria-live="polite">
              <div className="file-upload-progress-meta">
                <span>{uploadProgress.label}</span>
                <strong>{uploadProgress.fileName}</strong>
                <em>{uploadProgress.percent}%</em>
              </div>
              <div className="file-upload-progress-track">
                <span style={{ width: `${uploadProgress.percent}%` }} />
              </div>
            </div>
          ) : null}
          {error ? <div className="file-error">{error}</div> : null}
        </div>
        <div className="file-workspace">
        <div className="file-browser">
          <table className="file-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>大小</th>
                <th>修改时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr
                  className={[
                    selectedPath === entry.path ? "selected-row" : "",
                    entry.type === "file" ? "draggable-file-row" : "",
                    draggingFilePath === entry.path ? "dragging-row" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={entry.type === "file"}
                  key={entry.path || entry.name}
                  onDragStart={(event) => handleEntryDragStart(event, entry)}
                  onDragEnd={handleEntryDragEnd}
                  onPointerDown={(event) => handleEntryPointerDown(event, entry)}
                  onPointerMove={handleEntryPointerMove}
                  onPointerUp={finishMobileFileDrag}
                  onPointerCancel={handleEntryPointerCancel}
                  onContextMenu={(event) => handleEntryContextMenu(event, entry)}
                >
                  <td>
                    <button
                      className="file-name-button"
                      draggable={entry.type === "file"}
                      onClick={() => {
                        if (suppressMobileFileClickRef.current) {
                          suppressMobileFileClickRef.current = false;
                          return;
                        }
                        void openEntry(entry);
                      }}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        handleEntryDragStart(event, entry);
                      }}
                      onDragEnd={(event) => {
                        event.stopPropagation();
                        handleEntryDragEnd();
                      }}
                    >
                      {entry.type === "directory" ? (
                        <Folder size={16} />
                      ) : isImageFile(entry.path) ? (
                        <ImageIcon size={16} />
                      ) : isArchiveFile(entry.path) ? (
                        <FileArchive size={16} />
                      ) : (
                        <FileText size={16} />
                      )}
                      <span>{entry.name}</span>
                    </button>
                  </td>
                  <td>{entry.type === "file" ? formatBytes(entry.size) : "-"}</td>
                  <td>{formatDate(entry.modifiedAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-button mini"
                        title="解压"
                        disabled={entry.type !== "file" || !isArchiveFile(entry.path) || extractingPath === entry.path}
                        onClick={() => void extractArchive(entry)}
                      >
                        {extractingPath === entry.path ? <RotateCw size={15} /> : <Archive size={15} />}
                      </button>
                      <button
                        className="icon-button mini"
                        title="下载"
                        disabled={entry.type !== "file"}
                        onClick={() => void downloadEntry(entry)}
                      >
                        <Download size={15} />
                      </button>
                      <button className="small-button compact-button" onClick={() => void renameEntry(entry)}>
                        重命名
                      </button>
                      <button className="icon-button mini danger-action" title="删除" onClick={() => void deleteEntry(entry)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      {loading ? "读取中" : entries.length > 0 && fileSearchQuery.trim() ? "没有匹配的文件" : "目录为空"}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="file-editor" role={mobileEditorOpen ? "dialog" : undefined} aria-modal={mobileEditorOpen ? true : undefined}>
          <div className="file-editor-heading">
            <div className="file-editor-title-row">
              <span>{editorPath ?? selectedEntry?.name ?? "未选择文件"}</span>
              <button
                className="icon-button mini mobile-editor-close"
                title="关闭编辑器"
                type="button"
                onClick={closeMobileEditorModal}
              >
                <X size={15} />
              </button>
            </div>
            <div className="file-editor-actions">
              {editorCanTogglePreview ? (
                <div className="editor-view-toggle" aria-label="文件视图">
                  <button
                    className={editorMode === "edit" ? "active" : ""}
                    type="button"
                    title="源码"
                    onClick={() => setEditorMode("edit")}
                  >
                    <Code2 size={14} />
                    <span>源码</span>
                  </button>
                  <button
                    className={editorMode === "preview" ? "active" : ""}
                    type="button"
                    title="预览"
                    onClick={() => setEditorMode("preview")}
                  >
                    <Eye size={14} />
                    <span>预览</span>
                  </button>
                </div>
              ) : null}
              {editorPath ? <span className="file-language-pill">{editorLanguage}</span> : null}
              <button
                className="icon-button mini"
                title="查找 Ctrl+F"
                disabled={!editorCanEdit || editorMode !== "edit"}
                onClick={openEditorFind}
              >
                <Search size={15} />
              </button>
              <button className="primary-button save-file-button" disabled={!editorCanEdit || saving} onClick={() => void saveEditor()}>
                <Save size={16} />
                {saving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
          {editorPath ? (
            editorMode === "preview" && editorPreviewKind ? (
              <FilePreview content={editorContent} kind={editorPreviewKind} />
            ) : (
            <div className={`code-editor-stack ${findVisible ? "find-open" : ""}`}>
              {findVisible ? (
                <div className="editor-find-bar">
                  <Search size={15} />
                  <input
                    ref={findInputRef}
                    value={findQuery}
                    placeholder="查找当前文件"
                    onChange={(event) => setFindQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        moveFindMatch(event.shiftKey ? -1 : 1, true);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closeEditorFind();
                      }
                    }}
                  />
                  <span className={`find-result-count ${findQuery && findMatches.length === 0 ? "empty" : ""}`}>
                    {findResultLabel}
                  </span>
                  <button
                    className="icon-button mini"
                    title="上一个"
                    type="button"
                    disabled={findMatches.length === 0}
                    onClick={() => moveFindMatch(-1, true)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    className="icon-button mini"
                    title="下一个"
                    type="button"
                    disabled={findMatches.length === 0}
                    onClick={() => moveFindMatch(1, true)}
                  >
                    <ChevronRight size={15} />
                  </button>
                  <button className="icon-button mini" title="关闭查找" type="button" onClick={closeEditorFind}>
                    <X size={15} />
                  </button>
                </div>
              ) : null}
              <div className="code-editor-shell">
                <CodeEditor
                  value={editorContent}
                  language={editorLanguage}
                  onChange={(newValue) => setEditorContent(newValue)}
                  className="code-editor-surface"
                />
              </div>
            </div>
            )
          ) : (
            <div className="empty-state">选择文件查看或编辑</div>
          )}
        </div>
      </div>
      </div>
      {fileConflictPrompt ? (
        <div className="file-conflict-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) resolveFileConflict(null);
        }}>
          <div className="file-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="file-conflict-title">
            <div className="file-conflict-icon">
              <FileText size={22} />
            </div>
            <div className="file-conflict-copy">
              <h3 id="file-conflict-title">已存在同名文件</h3>
              <p>
                当前目录已经有 <strong>{fileConflictPrompt.name}</strong>。
                {fileConflictPrompt.canOverwrite ? "可以覆盖它，也可以保留两份。" : "同名路径不是普通文件，请保留两份。"}
              </p>
              <span>保留两份会保存为 {fileConflictPrompt.suggestedName}</span>
            </div>
            <div className="file-conflict-actions">
              <button className="ghost-button" type="button" onClick={() => resolveFileConflict(null)}>
                取消
              </button>
              <button
                className="small-button"
                type="button"
                disabled={!fileConflictPrompt.canOverwrite}
                onClick={() => resolveFileConflict("overwrite")}
              >
                覆盖
              </button>
              <button className="primary-button" type="button" onClick={() => resolveFileConflict("keep")}>
                保留两份
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {fileToast ? (
        <div className="file-toast" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <div>
            <strong>{fileToast.title}</strong>
            <span>{fileToast.detail}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InstanceTasksPanel({
  token,
  onLogout,
  refreshTick,
  instance,
  onClose
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  instance: ManagedInstance;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<ManagedScheduledTask[]>([]);
  const [runs, setRuns] = useState<ManagedTaskRun[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: `${instance.name}-restart`,
    type: "restart_instance" as ScheduledTaskType,
    cron: "@every 30m",
    command: "",
    enabled: true
  });

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const nextTasks = await api.tasks(token, instance.id);
      setTasks(nextTasks);
      setSelectedTaskId((current) =>
        current && nextTasks.some((task) => task.id === current) ? current : nextTasks[0]?.id ?? null
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "任务刷新失败");
    }
  }, [instance.id, onLogout, token]);

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
    setRuns([]);
    setSelectedTaskId(null);
    setForm({
      name: `${instance.name}-restart`,
      type: "restart_instance",
      cron: "@every 30m",
      command: "",
      enabled: true
    });
  }, [instance.id, instance.name]);

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
        instanceId: instance.id,
        enabled: form.enabled,
        payload: form.type === "run_command" ? { command: form.command } : {}
      });
      setTasks((current) => [task, ...current]);
      setSelectedTaskId(task.id);
      setForm((current) => ({
        ...current,
        name: `${instance.name}-restart`,
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
    <div
      className="modal-backdrop task-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-panel task-modal-panel instance-task-panel" role="dialog" aria-modal="true" aria-labelledby="instance-task-title">
      <div className="section-heading modal-heading">
        <div>
          <h2 id="instance-task-title">计划任务</h2>
          <span>{tasks.length} 个 · {instance.name}</span>
        </div>
        <button className="icon-button mini" title="关闭" type="button" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {error ? <div className="inline-panel-error">{error}</div> : null}
      <div className="instance-task-layout">
        <form className="task-form instance-task-form" onSubmit={createTask}>
          <label>
            名称
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
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
            启用任务
          </label>
          <button className="primary-button form-submit" disabled={creating} type="submit">
            <Clock size={18} />
            {creating ? "创建中" : "添加任务"}
          </button>
        </form>

        <div className="instance-task-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>类型</th>
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
                      <td>{task.cron}</td>
                      <td>{formatDate(task.nextRunAt)}</td>
                      <td>{task.enabled ? "启用" : "停用"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="small-button compact-button" disabled={busy} onClick={() => void runTask(task)}>
                            运行
                          </button>
                          <button className="small-button compact-button" disabled={busy} onClick={() => void toggleTask(task)}>
                            {task.enabled ? "停用" : "启用"}
                          </button>
                          <button className="icon-button mini danger-action" disabled={busy} title="删除" onClick={() => void deleteTask(task)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">暂无计划任务</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="instance-task-runs">
        <div className="section-heading subtle-heading">
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
      </div>
      </div>
    </div>
  );
}

function InstancesView({
  token,
  onLogout,
  refreshTick,
  onOpenTemplates,
  onInstanceFocus,
  onAskSaki,
  onSakiFileDragChange,
  onSakiInstanceFileDrop
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  onOpenTemplates: () => void;
  onInstanceFocus: (instance: ManagedInstance | null) => void;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  onSakiFileDragChange: (active: boolean) => void;
  onSakiInstanceFileDrop?: ((payload: SakiInstanceFileDragPayload) => void) | undefined;
}) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
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
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    nodeId: "",
    autoStart: false,
    restartPolicy: "never" as RestartPolicy,
    restartMaxRetries: 3
  });

  const selectedInstance = instances.find((instance) => instance.id === selectedId) ?? null;
  const selectedNode = selectedInstance ? nodes.find((node) => node.id === selectedInstance.nodeId) ?? null : null;
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
      .filter((status) => counts[status] > 0)
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
      const [nextNodes, nextInstances] = await Promise.all([api.nodes(token), api.instances(token)]);
      setNodes(nextNodes);
      setInstances(nextInstances);
      setSelectedId((current) =>
        current && nextInstances.some((instance) => instance.id === current) ? current : null
      );
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
  }, [onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("webops.instanceDirectoryView", directoryView);
  }, [directoryView]);

  useEffect(() => {
    if (!selectedInstance) return;
    setSettingsForm({
      nodeId: selectedInstance.nodeId,
      autoStart: selectedInstance.autoStart,
      restartPolicy: selectedInstance.restartPolicy,
      restartMaxRetries: selectedInstance.restartMaxRetries
    });
  }, [selectedInstance]);

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
      if (form.stopCommand) payload.stopCommand = form.stopCommand;
      if (form.description) payload.description = form.description;
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

  async function saveInstanceSettings() {
    if (!selectedInstance) return;
    setSettingsSaving(true);
    setError("");
    try {
      const updated = await api.updateInstance(token, selectedInstance.id, {
        nodeId: settingsForm.nodeId || selectedInstance.nodeId,
        autoStart: settingsForm.autoStart,
        restartPolicy: settingsForm.restartPolicy,
        restartMaxRetries: settingsForm.restartMaxRetries
      });
      setInstances((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存实例策略失败");
    } finally {
      setSettingsSaving(false);
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 id="create-instance-title">创建实例</h2>
              <p>配置新的服务实例运行参数</p>
            </div>
            <button className="icon-button mini" title="关闭" type="button" onClick={() => setShowCreateForm(false)}>
              <X size={18} />
            </button>
          </div>
        </div>
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
              <input
                value={form.startCommand}
                onChange={(event) => setForm((current) => ({ ...current, startCommand: event.target.value }))}
                required
              />
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
          <button className="primary-button" type="submit" form="create-instance-form" disabled={creating || nodes.length === 0}>
            <Plus size={18} />
            {creating ? "创建中" : "创建"}
          </button>
        </div>
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

  if (selectedInstance) {
    const running = selectedInstance.status === "RUNNING" || selectedInstance.status === "STARTING";
    const busy = busyId === selectedInstance.id;
    const selectedStatusMeta = instanceStatusMeta(selectedInstance.status);
    const selectedNodeName = selectedNode?.name ?? selectedInstance.nodeName ?? selectedInstance.nodeId;

    return (
      <>
        {error ? (
          <div className="page-error action-error">
            <span>{error}</span>
            {onAskSaki ? (
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
            ) : null}
          </div>
        ) : null}
        {createDialog}
        {showTaskModal ? (
          <InstanceTasksPanel
            token={token}
            onLogout={onLogout}
            refreshTick={refreshTick}
            instance={selectedInstance}
            onClose={() => setShowTaskModal(false)}
          />
        ) : null}

        <section className={`glass-panel console-titlebar instance-console-titlebar ${selectedStatusMeta.className}`}>
          <button className="glass-back-button" type="button" onClick={() => setSelectedId(null)}>
            <TerminalIcon size={18} />
            <span>实例</span>
          </button>
          <div className="console-title">
            <p>{instanceTypeLabel(selectedInstance.type)}</p>
            <h2>{selectedInstance.name}</h2>
            <div className="console-quick-meta">
              <span title="节点">
                <Server size={13} />
                {selectedNodeName}
              </span>
              <span title={`创建者 · ${ownerRoleLabel(selectedInstance.createdByRole)}`}>
                <UserRound size={13} />
                {instanceCreatorLabel(selectedInstance)}
              </span>
              <span title={`负责人 · ${ownerRoleLabel(selectedInstance.assignedToRole)}`}>
                <UserCheck size={13} />
                {instanceAssigneeLabel(selectedInstance)}
              </span>
              <span title="更新">
                <Clock size={13} />
                {formatDate(selectedInstance.updatedAt)}
              </span>
              {selectedInstance.lastExitCode !== null && selectedInstance.lastExitCode !== undefined ? (
                <span title="退出码">
                  <Bug size={13} />
                  {selectedInstance.lastExitCode}
                </span>
              ) : null}
            </div>
          </div>
          <InstanceStatusBadge status={selectedInstance.status} />
        </section>

        <section className="glass-panel console-terminal-panel">
          <div className="mac-window-header">
            <div className="mac-dots">
              <span className="dot red"></span>
              <span className="dot yellow"></span>
              <span className="dot green"></span>
            </div>
            <div className="mac-title">仿真终端</div>
            <div className="mac-subtitle">{formatDate(selectedInstance.updatedAt)}</div>
          </div>
          <div className="terminal-container">
            <WebTerminal
              token={token}
              instance={selectedInstance}
              onStatus={updateInstanceStatus}
              onAskSaki={onAskSaki}
            />
          </div>
        </section>

        <section className={`console-detail-grid ${toolsCollapsed ? "tools-collapsed" : ""}`}>
          <div className="glass-panel files-panel console-files-panel">
            <div className="glass-panel-heading">
              <h2>文件管理</h2>
              <span className="glass-subtitle">{selectedInstance.workingDirectory || "未设置工作目录"}</span>
            </div>
            <FileManager
              token={token}
              instance={selectedInstance}
              onSakiFileDragChange={onSakiFileDragChange}
              onSakiInstanceFileDrop={handleSakiInstanceFileDrop}
            />
          </div>

          <aside className={`glass-panel console-tools-panel ${toolsCollapsed ? "collapsed" : ""}`}>
            <div className="glass-panel-heading console-tools-heading">
              <div className="console-tools-title">
                {!toolsCollapsed ? (
                  <>
                    <h2>控制中枢</h2>
                    <span className="glass-subtitle">{restartPolicyLabel(selectedInstance.restartPolicy)}</span>
                  </>
                ) : null}
              </div>
              <button
                className="tools-toggle-btn"
                type="button"
                title={toolsCollapsed ? "展开控制中枢" : "折叠控制中枢"}
                onClick={() => setToolsCollapsed((current) => !current)}
              >
                {toolsCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>
            </div>
            {!toolsCollapsed ? (
            <div className="console-tools">
              <div className="tool-section">
                <div className="tool-section-title">
                  <span>生命周期</span>
                </div>
                <div className="tool-action-grid">
                  <button
                    className="small-button"
                    type="button"
                    disabled={busy || running}
                    onClick={() => void runAction(selectedInstance, "start")}
                  >
                    <Play size={15} />
                    启动
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    disabled={busy || !running}
                    onClick={() => void runAction(selectedInstance, "stop")}
                  >
                    <Square size={15} />
                    停止
                  </button>
                  <button
                    className="small-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void runAction(selectedInstance, "restart")}
                  >
                    <RotateCw size={15} />
                    重启
                  </button>
                  <button
                    className="small-button danger-action"
                    type="button"
                    disabled={busy || !running}
                    onClick={() => void runAction(selectedInstance, "kill")}
                  >
                    <XOctagon size={15} />
                    强杀
                  </button>
                </div>
              </div>

              <div className="tool-section">
                <div className="tool-section-title">
                  <span>开关</span>
                </div>
                <div className="settings-compact">
                  <label>
                    运行节点
                    <select
                      value={settingsForm.nodeId}
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, nodeId: event.target.value }))
                      }
                      disabled={nodes.length === 0}
                    >
                      {nodes.map((node) => (
                        <option value={node.id} key={node.id}>
                          {nodeEndpointLabel(node)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={settingsForm.autoStart}
                      onChange={(event) =>
                        setSettingsForm((current) => ({ ...current, autoStart: event.target.checked }))
                      }
                    />
                    自启动
                  </label>
                  <label>
                    重启策略
                    <select
                      value={settingsForm.restartPolicy}
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          restartPolicy: event.target.value as RestartPolicy
                        }))
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
                      value={settingsForm.restartMaxRetries}
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          restartMaxRetries: Number(event.target.value) || 0
                        }))
                      }
                    />
                  </label>
                  <button
                    className="primary-button settings-save"
                    type="button"
                    disabled={settingsSaving}
                    onClick={() => void saveInstanceSettings()}
                  >
                    <Settings size={17} />
                    {settingsSaving ? "保存中" : "保存"}
                  </button>
                </div>
              </div>

              <div className="tool-section">
                <div className="tool-section-title">
                  <span>入口</span>
                </div>
                <div className="tool-entry-list">
                  <button className="tool-entry-button" type="button" onClick={() => setShowTaskModal(true)}>
                    <Clock size={16} />
                    <span>计划任务</span>
                  </button>
                  <button className="tool-entry-button" type="button" onClick={onOpenTemplates}>
                    <LayoutTemplate size={16} />
                    <span>模板</span>
                  </button>
                  <button className="tool-entry-button" type="button" onClick={() => setShowCreateForm(true)}>
                    <Plus size={16} />
                    <span>创建实例</span>
                  </button>
                </div>
              </div>

              <div className="tool-section">
                <div className="tool-section-title">
                  <span>信息</span>
                </div>
                <dl className="instance-detail-list">
                  <dt>节点</dt>
                  <dd>{nodeEndpointLabel(selectedNode) || (selectedInstance.nodeName ?? selectedInstance.nodeId)}</dd>
                  <dt>工作目录</dt>
                  <dd>{selectedInstance.workingDirectory}</dd>
                  <dt>创建者</dt>
                  <dd>{instanceCreatorLabel(selectedInstance)}</dd>
                  <dt>负责人</dt>
                  <dd>{instanceAssigneeLabel(selectedInstance)}</dd>
                  <dt>退出码</dt>
                  <dd>{selectedInstance.lastExitCode ?? "-"}</dd>
                  <dt>更新</dt>
                  <dd>{formatDate(selectedInstance.updatedAt)}</dd>
                </dl>
              </div>
            </div>
            ) : (
              <div className="collapsed-tools-icons">
                <button
                  className="collapsed-tool-btn"
                  type="button"
                  disabled={busy || running}
                  onClick={() => void runAction(selectedInstance, "start")}
                  title="启动"
                >
                  <Play size={18} />
                </button>
                <button
                  className="collapsed-tool-btn"
                  type="button"
                  disabled={busy || !running}
                  onClick={() => void runAction(selectedInstance, "stop")}
                  title="停止"
                >
                  <Square size={18} />
                </button>
                <button
                  className="collapsed-tool-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction(selectedInstance, "restart")}
                  title="重启"
                >
                  <RotateCw size={18} />
                </button>
                <button
                  className="collapsed-tool-btn danger"
                  type="button"
                  disabled={busy || !running}
                  onClick={() => void runAction(selectedInstance, "kill")}
                  title="强杀"
                >
                  <XOctagon size={18} />
                </button>
                <button
                  className="collapsed-tool-btn"
                  type="button"
                  onClick={() => setShowTaskModal(true)}
                  title="计划任务"
                >
                  <Clock size={18} />
                </button>
              </div>
            )}
          </aside>
        </section>
      </>
    );
  }

  return (
    <>
      {error ? (
        <div className="page-error action-error">
          <span>{error}</span>
          {onAskSaki ? (
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
          ) : null}
        </div>
      ) : null}
      {createDialog}

      <section className="instance-directory">
        <div className="instance-command-center">
          <div className="instance-command-main">
            <div className="instance-command-icon">
              <TerminalIcon size={22} />
            </div>
            <div className="instance-command-count">
              <span>实例</span>
              <strong>{instances.length}</strong>
            </div>
          </div>

          <div className="instance-status-ribbon" aria-label="实例状态">
            {instanceStats.visibleStatuses.length > 0 ? (
              instanceStats.visibleStatuses.map((status) => {
                const meta = instanceStatusMeta(status);
                return (
                  <span className={`instance-status-chip ${meta.className}`} key={status} title={meta.hint}>
                    <InstanceStatusIcon status={status} size={13} />
                    <span>{meta.shortLabel}</span>
                    <strong>{instanceStats.counts[status]}</strong>
                  </span>
                );
              })
            ) : (
              <span className="instance-status-chip created">
                <TerminalIcon size={13} />
                <span>待命</span>
                <strong>0</strong>
              </span>
            )}
          </div>

          <div className="instance-command-actions">
            <div className="instance-view-switcher" role="group" aria-label="实例视图">
              {instanceViewOptions.map((option) => (
                <button
                  className={`instance-view-button ${directoryView === option.view ? "active" : ""}`}
                  type="button"
                  title={option.title}
                  aria-pressed={directoryView === option.view}
                  onClick={() => setDirectoryView(option.view)}
                  key={option.view}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <button className="icon-button" title="模板" type="button" onClick={onOpenTemplates}>
              <LayoutTemplate size={18} />
            </button>
            <button className="primary-button create-instance-button" type="button" onClick={() => setShowCreateForm(true)}>
              <Plus size={18} />
              创建
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
                    <span title={nodeDetail}>
                      <Server size={14} />
                      {nodeName}
                    </span>
                    <span title={instance.workingDirectory || "未设置工作目录"}>
                      <HardDrive size={14} />
                      {compactPathLabel(instance.workingDirectory)}
                    </span>
                    <span title="更新">
                      <Clock size={14} />
                      {formatDate(instance.updatedAt)}
                    </span>
                  </div>

                  <div className="instance-badge-strip">
                    <span title={`创建者 · ${ownerRoleLabel(instance.createdByRole)}`}>
                      <UserRound size={12} />
                      {instanceCreatorLabel(instance)}
                    </span>
                    <span title={`负责人 · ${ownerRoleLabel(instance.assignedToRole)}`}>
                      <UserCheck size={12} />
                      {instanceAssigneeLabel(instance)}
                    </span>
                    {instance.autoStart ? (
                      <span title="自启动">
                        <Play size={12} />
                        自启
                      </span>
                    ) : null}
                    {instance.restartPolicy !== "never" ? (
                      <span title={restartPolicyLabel(instance.restartPolicy)}>
                        <RefreshCw size={12} />
                        重试
                      </span>
                    ) : null}
                    {instance.lastExitCode !== null && instance.lastExitCode !== undefined ? (
                      <span title="退出码">
                        <Bug size={12} />
                        {instance.lastExitCode}
                      </span>
                    ) : null}
                  </div>

                  <div className="instance-card-footer">
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
            {instances.length === 0 ? (
              <div className="empty-state card-empty-state">
                <TerminalIcon size={24} />
                <span>暂无实例</span>
              </div>
            ) : null}
          </div>
        ) : directoryView === "list" ? (
          <div className="instance-list-view" role="table" aria-label="实例列表">
            <div className="instance-list-header" role="row">
              <span>实例</span>
              <span>状态</span>
              <span>节点</span>
              <span>工作目录</span>
              <span>归属</span>
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
            {instances.length === 0 ? (
              <div className="empty-state card-empty-state instance-list-empty">
                <TerminalIcon size={24} />
                <span>暂无实例</span>
              </div>
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
                <div className="empty-state card-empty-state instance-graph-empty">
                  <TerminalIcon size={24} />
                  <span>暂无实例</span>
                </div>
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
              <div className="instance-graph-status-list">
                {instanceStats.visibleStatuses.map((status) => {
                  const meta = instanceStatusMeta(status);
                  return (
                    <span className={`instance-status-chip ${meta.className}`} title={meta.hint} key={status}>
                      <InstanceStatusIcon status={status} size={13} />
                      <span>{meta.shortLabel}</span>
                      <strong>{instanceStats.counts[status]}</strong>
                    </span>
                  );
                })}
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

function TasksView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
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
      {error ? <div className="page-error">{error}</div> : null}

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
              启用任务
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
                          <button className="small-button compact-button" disabled={busy} onClick={() => void runTask(task)}>
                            运行
                          </button>
                          <button className="small-button compact-button" disabled={busy} onClick={() => void toggleTask(task)}>
                            {task.enabled ? "停用" : "启用"}
                          </button>
                          <button className="icon-button mini danger-action" disabled={busy} title="删除" onClick={() => void deleteTask(task)}>
                            <Trash2 size={15} />
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

function TemplatesView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    nodeId: "",
    name: "",
    workingDirectory: "",
    startCommand: "",
    autoStart: false,
    restartPolicy: "never" as RestartPolicy,
    restartMaxRetries: 3
  });

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;

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
      name: current.name || selectedTemplate.id,
      startCommand: selectedTemplate.defaultStartCommand
    }));
  }, [selectedTemplate]);

  async function createFromTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) return;
    setCreating(true);
    setError("");
    try {
      const payload = {
        nodeId: form.nodeId,
        name: form.name,
        autoStart: form.autoStart,
        restartPolicy: form.restartPolicy,
        restartMaxRetries: form.restartMaxRetries
      };
      await api.createInstanceFromTemplate(token, selectedTemplate.id, {
        ...payload,
        ...(form.workingDirectory ? { workingDirectory: form.workingDirectory } : {}),
        ...(form.startCommand ? { startCommand: form.startCommand } : {})
      });
      setForm((current) => ({ ...current, name: "", workingDirectory: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {error ? <div className="page-error">{error}</div> : null}
      <section className="template-layout">
        <div className="panel-block templates-panel">
          <div className="section-heading">
            <h2>实例模板</h2>
            <span>{templates.length} 个</span>
          </div>
          <div className="template-list">
            {templates.map((template) => (
              <button
                className={`template-item ${selectedTemplateId === template.id ? "active" : ""}`}
                key={template.id}
                onClick={() => {
                  setSelectedTemplateId(template.id);
                  setForm((current) => ({
                    ...current,
                    name: template.id,
                    startCommand: template.defaultStartCommand
                  }));
                }}
              >
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <code>{template.defaultStartCommand}</code>
              </button>
            ))}
          </div>
        </div>

        <div className="panel-block template-create-panel">
          <div className="section-heading">
            <h2>{selectedTemplate ? `创建 ${selectedTemplate.name}` : "创建实例"}</h2>
          </div>
          <form className="task-form" onSubmit={createFromTemplate}>
            <label>
              节点
              <select value={form.nodeId} onChange={(event) => setForm((current) => ({ ...current, nodeId: event.target.value }))} required>
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
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="wide-field">
              工作目录
              <input
                value={form.workingDirectory}
                onChange={(event) => setForm((current) => ({ ...current, workingDirectory: event.target.value }))}
                placeholder="留空按模板生成"
              />
            </label>
            <label className="wide-field">
              启动命令
              <input value={form.startCommand} onChange={(event) => setForm((current) => ({ ...current, startCommand: event.target.value }))} />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={form.autoStart} onChange={(event) => setForm((current) => ({ ...current, autoStart: event.target.checked }))} />
              自启动
            </label>
            <label>
              重启策略
              <select value={form.restartPolicy} onChange={(event) => setForm((current) => ({ ...current, restartPolicy: event.target.value as RestartPolicy }))}>
                <option value="never">不自动重启</option>
                <option value="on_failure">异常退出重启</option>
                <option value="always">总是重启</option>
              </select>
            </label>
            <label>
              最大重试
              <input type="number" min={0} max={99} value={form.restartMaxRetries} onChange={(event) => setForm((current) => ({ ...current, restartMaxRetries: Number(event.target.value) || 0 }))} />
            </label>
            <button className="primary-button form-submit" type="submit" disabled={creating || !selectedTemplate || nodes.length === 0}>
              <LayoutTemplate size={18} />
              {creating ? "创建中" : "用模板创建"}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}

const PERMISSION_GROUPS: { group: string; items: { code: PermissionCode; label: string }[] }[] = [
  {
    group: "仪表板与系统",
    items: [
      { code: "dashboard.view", label: "查看仪表板" },
      { code: "system.view", label: "查看系统信息" },
      { code: "audit.view", label: "查看审计日志" }
    ]
  },
  {
    group: "节点管理",
    items: [
      { code: "node.view", label: "查看节点" },
      { code: "node.create", label: "创建节点" },
      { code: "node.update", label: "编辑节点" },
      { code: "node.delete", label: "删除节点" },
      { code: "node.test", label: "测试节点" }
    ]
  },
  {
    group: "实例与容器",
    items: [
      { code: "instance.view", label: "查看实例" },
      { code: "instance.create", label: "创建实例" },
      { code: "instance.update", label: "编辑实例" },
      { code: "instance.delete", label: "删除实例" },
      { code: "instance.start", label: "启动实例" },
      { code: "instance.stop", label: "停止实例" },
      { code: "instance.restart", label: "重启实例" },
      { code: "instance.kill", label: "终止实例" },
      { code: "instance.logs", label: "查看运行日志" }
    ]
  },
  {
    group: "远程终端",
    items: [
      { code: "terminal.view", label: "打开终端" },
      { code: "terminal.input", label: "终端输入与交互" }
    ]
  },
  {
    group: "文件管理",
    items: [
      { code: "file.view", label: "查看文件列表" },
      { code: "file.read", label: "读取文件内容" },
      { code: "file.write", label: "修改 / 上传文件" },
      { code: "file.delete", label: "删除文件" }
    ]
  },
  {
    group: "计划任务",
    items: [
      { code: "task.view", label: "查看任务" },
      { code: "task.create", label: "创建任务" },
      { code: "task.update", label: "编辑任务" },
      { code: "task.delete", label: "删除任务" },
      { code: "task.run", label: "手动执行任务" }
    ]
  },
  {
    group: "模板管理",
    items: [
      { code: "template.view", label: "查看模板" },
      { code: "template.create", label: "创建模板" }
    ]
  },
  {
    group: "用户与角色",
    items: [
      { code: "user.view", label: "查看用户" },
      { code: "user.create", label: "创建用户" },
      { code: "user.update", label: "编辑用户" },
      { code: "role.view", label: "查看角色" },
      { code: "role.update", label: "编辑角色权限" }
    ]
  },
  {
    group: "Saki 助手",
    items: [
      { code: "saki.chat", label: "使用对话" },
      { code: "saki.agent", label: "使用智能体" },
      { code: "saki.skills", label: "管理 Saki 技能" },
      { code: "saki.configure", label: "配置 Saki 助手" }
    ]
  }
];

const elevatedRoleNamesForUi = new Set(["super_admin", "admin", "administrator", "operator"]);
const elevatedRolePermissionHintsForUi = new Set<PermissionCode>([
  "instance.update",
  "instance.delete",
  "node.create",
  "node.update",
  "node.delete",
  "user.view",
  "user.create",
  "user.update",
  "role.view",
  "role.update",
  "system.view"
]);

function isNoRolePermissionRole(role: ManagedRole): boolean {
  return role.name === noRolePermissionRoleName;
}

function roleDisplayName(role: ManagedRole): string {
  return isNoRolePermissionRole(role) ? "无角色" : role.name;
}

function isElevatedManagedRole(role: ManagedRole): boolean {
  if (isNoRolePermissionRole(role)) return false;
  return elevatedRoleNamesForUi.has(role.name) || role.permissions.some((permission) => elevatedRolePermissionHintsForUi.has(permission));
}

function UsersView({
  token,
  currentUser,
  onLogout,
  onSwitchUser,
  refreshTick
}: {
  token: string;
  currentUser: CurrentUser;
  onLogout: () => void;
  onSwitchUser: (token: string, user: CurrentUser) => void;
  refreshTick: number;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<InstanceAssignee[]>([]);
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [assignmentTargetUser, setAssignmentTargetUser] = useState<InstanceAssignee | null>(null);
  const [assignmentDraftIds, setAssignmentDraftIds] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [rolePermissions, setRolePermissions] = useState<PermissionCode[]>([]);
  const [error, setError] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserRequest>({});
  const [savingUser, setSavingUser] = useState(false);
  const [switchingUserId, setSwitchingUserId] = useState<string | null>(null);
  const canViewAccounts = currentUser.permissions.includes("user.view");
  const canUpdateAccounts = currentUser.permissions.includes("user.update");
  const canCreateUsers = currentUser.permissions.includes("user.create");
  const canManageRoles = currentUser.isSuperAdmin && currentUser.permissions.includes("role.view") && currentUser.permissions.includes("role.update");
  const canManageAccounts = currentUser.isAdmin && canViewAccounts && canUpdateAccounts;
  const canAssignInstances = currentUser.isAdmin && currentUser.permissions.includes("instance.update");
  const assignableRoles = useMemo(
    () =>
      roles.filter((role) => {
        if (isNoRolePermissionRole(role)) return false;
        return currentUser.isSuperAdmin || !isElevatedManagedRole(role);
      }),
    [currentUser.isSuperAdmin, roles]
  );
  const [form, setForm] = useState<CreateUserRequest>({
    username: "",
    password: "",
    displayName: "",
    roleIds: [],
    status: "ACTIVE"
  });

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextUsers, nextRoles, nextAssignees, nextInstances] = await Promise.all([
        canManageAccounts ? api.users(token) : Promise.resolve([]),
        currentUser.permissions.includes("role.view") ? api.roles(token) : Promise.resolve([]),
        canAssignInstances ? api.instanceAssignees(token) : Promise.resolve([]),
        canAssignInstances ? api.instances(token) : Promise.resolve([])
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setAssignableUsers(nextAssignees);
      setInstances(nextInstances);
      setSelectedRoleId((current) => current || nextRoles[0]?.id || "");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "用户读取失败");
    }
  }, [canAssignInstances, canManageAccounts, currentUser.permissions, onLogout, token]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const assignableUserIds = useMemo(() => new Set(assignableUsers.map((user) => user.id)), [assignableUsers]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  useEffect(() => {
    setRolePermissions(selectedRole?.permissions ?? []);
  }, [selectedRole]);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingUser(true);
    setError("");
    try {
      const user = await api.createUser(token, form);
      setUsers((current) => [user, ...current]);
      setForm({ username: "", password: "", displayName: "", roleIds: [], status: "ACTIVE" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "用户创建失败");
    } finally {
      setCreatingUser(false);
    }
  }

  function openUserEditor(user: ManagedUser) {
    setEditingUser(user);
    setEditForm({
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      roleIds: user.roleIds
    });
  }

  function closeUserEditor() {
    setEditingUser(null);
    setEditForm({});
  }

  async function saveEditedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;
    setSavingUser(true);
    setError("");
    try {
      const payload: UpdateUserRequest = {
        username: editForm.username ?? editingUser.username,
        displayName: editForm.displayName ?? editingUser.displayName,
        status: editForm.status ?? editingUser.status,
        roleIds: editForm.roleIds ?? editingUser.roleIds
      };
      if (editForm.password?.trim()) {
        payload.password = editForm.password;
      }
      const updated = await api.updateUser(token, editingUser.id, payload);
      setUsers((current) => current.map((item) => (item.id === editingUser.id ? updated : item)));
      closeUserEditor();
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "用户保存失败");
    } finally {
      setSavingUser(false);
    }
  }

  async function switchToUser(user: ManagedUser) {
    setSwitchingUserId(user.id);
    setError("");
    try {
      const result = await api.switchUser(token, user.id);
      onSwitchUser(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "账号切换失败");
      setSwitchingUserId(null);
    }
  }

  async function saveRolePermissions() {
    if (!selectedRole) return;
    setSavingRole(true);
    setError("");
    try {
      const updated = await api.updateRolePermissions(token, selectedRole.id, { permissions: rolePermissions });
      setRoles((current) => current.map((role) => (role.id === updated.id ? updated : role)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "角色权限保存失败");
    } finally {
      setSavingRole(false);
    }
  }

  function togglePermission(permission: PermissionCode) {
    setRolePermissions((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission].sort()
    );
  }

  function openAssignmentModal(user: InstanceAssignee) {
    setAssignmentTargetUser(user);
    setAssignmentDraftIds(instances.filter((instance) => instance.assignedToUserId === user.id).map((instance) => instance.id));
  }

  function toggleAssignmentDraft(instanceId: string, checked: boolean) {
    setAssignmentDraftIds((current) =>
      checked ? [...new Set([...current, instanceId])] : current.filter((id) => id !== instanceId)
    );
  }

  async function saveUserAssignments(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentTargetUser) return;
    setSavingAssignment(true);
    setError("");
    try {
      const draftIds = new Set(assignmentDraftIds);
      const updates = instances.filter((instance) => {
        const currentlyAssignedToTarget = instance.assignedToUserId === assignmentTargetUser.id;
        const shouldAssignToTarget = draftIds.has(instance.id);
        return currentlyAssignedToTarget !== shouldAssignToTarget;
      });
      const updatedInstances = await Promise.all(
        updates.map((instance) =>
          api.updateInstance(token, instance.id, {
            assignedToUserId: draftIds.has(instance.id) ? assignmentTargetUser.id : null
          })
        )
      );
      const updatedById = new Map(updatedInstances.map((instance) => [instance.id, instance]));
      setInstances((current) => current.map((instance) => updatedById.get(instance.id) ?? instance));
      setAssignmentTargetUser(null);
      setAssignmentDraftIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "实例分配失败");
    } finally {
      setSavingAssignment(false);
    }
  }

  return (
    <>
      {error ? <div className="page-error">{error}</div> : null}
      {assignmentTargetUser ? (
        <div className="modal-backdrop">
          <div className="modal-panel assignment-modal assignment-picker-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-modal-title">
            <div className="section-heading modal-heading">
              <div className="role-heading-info">
                <h2 id="assignment-modal-title">分配实例</h2>
                <p>选择要分配给该用户的实例，保存后立即生效。</p>
              </div>
              <button
                className="icon-button mini"
                disabled={savingAssignment}
                title="关闭"
                type="button"
                onClick={() => {
                  setAssignmentTargetUser(null);
                  setAssignmentDraftIds([]);
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="assignment-target-card">
              <UserRound size={20} />
              <div>
                <strong>{assignmentTargetUser.displayName || assignmentTargetUser.username}</strong>
                <span>
                  @{assignmentTargetUser.username} · {ownerRoleLabel(assignmentTargetUser.role)}
                </span>
              </div>
            </div>
            <form className="assignment-form assignment-picker-form" onSubmit={saveUserAssignments}>
              <div className="assignment-instance-summary">
                <div>
                  <strong>{assignmentDraftIds.length} 个实例已选择</strong>
                  <span>{instances.length} 个可管理实例</span>
                </div>
              </div>
              <div className="assignment-instance-grid assignment-picker-grid">
                {instances.map((instance) => {
                  const checked = assignmentDraftIds.includes(instance.id);
                  return (
                    <label className={`assignment-instance-row ${checked ? "active" : ""}`} key={instance.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingAssignment}
                        onChange={(event) => toggleAssignmentDraft(instance.id, event.target.checked)}
                      />
                      <span className="assignment-instance-icon">
                        <InstanceStatusIcon status={instance.status} size={16} />
                      </span>
                      <span className="assignment-instance-copy">
                        <strong>{instance.name}</strong>
                        <small>
                          {instanceTypeLabel(instance.type)} · {instance.nodeName ?? instance.nodeId}
                        </small>
                      </span>
                      <span className="assignment-instance-owner">{instanceAssigneeLabel(instance)}</span>
                    </label>
                  );
                })}
                {instances.length === 0 ? <div className="empty-state">当前没有可分配的实例</div> : null}
              </div>
              <div className="assignment-actions">
                <button
                  className="small-button"
                  disabled={savingAssignment}
                  type="button"
                  onClick={() => {
                    setAssignmentTargetUser(null);
                    setAssignmentDraftIds([]);
                  }}
                >
                  取消
                </button>
                <button className="primary-button" disabled={savingAssignment} type="submit">
                  <UserCheck size={17} />
                  {savingAssignment ? "保存中" : "保存分配"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingUser ? (
        <div className="modal-backdrop">
          <div className="modal-panel user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="user-edit-title">
            <div className="section-heading modal-heading">
              <div className="role-heading-info">
                <h2 id="user-edit-title">编辑用户</h2>
                <p>{editingUser.username} 的资料、角色和状态会在保存后立即生效。</p>
              </div>
              <button className="icon-button mini" disabled={savingUser} title="关闭" type="button" onClick={closeUserEditor}>
                <X size={18} />
              </button>
            </div>
            <form className="modal-form user-edit-form" onSubmit={saveEditedUser}>
              <div className="user-edit-grid">
                <label>
                  用户名
                  <input
                    value={editForm.username ?? ""}
                    onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  昵称
                  <input
                    value={editForm.displayName ?? ""}
                    onChange={(event) => setEditForm((current) => ({ ...current, displayName: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  状态
                  <select
                    value={editForm.status ?? "ACTIVE"}
                    onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as ManagedUser["status"] }))}
                  >
                    <option value="ACTIVE">启用</option>
                    <option value="DISABLED">禁用</option>
                  </select>
                </label>
                <label>
                  新密码
                  <input
                    type="password"
                    value={editForm.password ?? ""}
                    onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="留空则不修改"
                  />
                </label>
              </div>
              <div className="user-role-editor">
                <span className="user-role-editor-title">用户角色</span>
                <div className="permission-group-items user-role-options">
                  <label className={`permission-chip ${(editForm.roleIds ?? []).length === 0 ? "active" : ""}`}>
                    <input
                      className="hidden-checkbox"
                      type="checkbox"
                      checked={(editForm.roleIds ?? []).length === 0}
                      onChange={() => setEditForm((current) => ({ ...current, roleIds: [] }))}
                    />
                    <div className="permission-chip-content">
                      {(editForm.roleIds ?? []).length === 0 ? <ShieldCheck size={17} /> : <div className="permission-chip-dot" />}
                      <span className="permission-label">无角色</span>
                    </div>
                  </label>
                  {assignableRoles.map((role) => {
                    const isActive = (editForm.roleIds ?? []).includes(role.id);
                    return (
                      <label className={`permission-chip ${isActive ? "active" : ""}`} key={role.id}>
                        <input
                          className="hidden-checkbox"
                          type="checkbox"
                          checked={isActive}
                          onChange={(event) =>
                            setEditForm((current) => {
                              const currentRoleIds = current.roleIds ?? [];
                              return {
                                ...current,
                                roleIds: event.target.checked
                                  ? [...new Set([...currentRoleIds, role.id])]
                                  : currentRoleIds.filter((id) => id !== role.id)
                              };
                            })
                          }
                        />
                        <div className="permission-chip-content">
                          {isActive ? <ShieldCheck size={17} /> : <div className="permission-chip-dot" />}
                          <span className="permission-label">{roleDisplayName(role)}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="assignment-actions">
                <button className="small-button" disabled={savingUser} type="button" onClick={closeUserEditor}>
                  取消
                </button>
                <button className="primary-button" disabled={savingUser} type="submit">
                  <Save size={18} />
                  {savingUser ? "保存中..." : "保存用户"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {!canManageAccounts && canAssignInstances ? (
        <section className="panel-block users-panel">
          <div className="section-heading">
            <h2>用户</h2>
            <span>{assignableUsers.length} 个可分配对象</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>昵称</th>
                  <th>角色</th>
                  <th>已分配实例</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assignableUsers.map((assignee) => {
                  const assignedCount = instances.filter((instance) => instance.assignedToUserId === assignee.id).length;
                  return (
                    <tr key={assignee.id}>
                      <td>{assignee.username}</td>
                      <td>{assignee.displayName || "-"}</td>
                      <td>{ownerRoleLabel(assignee.role)}</td>
                      <td>{assignedCount}</td>
                      <td>
                        <div className="user-row-actions">
                          <button className="small-button compact-button" type="button" onClick={() => openAssignmentModal(assignee)}>
                            分配实例
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {assignableUsers.length === 0 ? <div className="empty-state">暂无可分配的管理员或用户</div> : null}
          </div>
        </section>
      ) : null}

      {canManageAccounts ? (
        <>
          <section className={`user-layout ${canCreateUsers ? "" : "single-column"}`}>
            {canCreateUsers ? (
              <div className="panel-block user-form-panel">
                <div className="section-heading">
                  <h2>创建用户</h2>
                </div>
                <form className="task-form" onSubmit={createUser}>
                  <label>
                    用户名
                    <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required />
                  </label>
                  <label>
                    昵称
                    <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required />
                  </label>
                  <label>
                    密码
                    <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
                  </label>
                  <label>
                    角色
                    <select
                      value={form.roleIds?.[0] ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, roleIds: event.target.value ? [event.target.value] : [] }))}
                    >
                      <option value="">无角色</option>
                      {assignableRoles.map((role) => (
                        <option value={role.id} key={role.id}>
                          {roleDisplayName(role)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button form-submit" disabled={creatingUser} type="submit">
                    <UserCog size={18} />
                    {creatingUser ? "创建中" : "创建用户"}
                  </button>
                </form>
              </div>
            ) : null}

            <div className="panel-block users-panel">
              <div className="section-heading">
                <h2>用户</h2>
                <span>{users.length} 个</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>用户名</th>
                      <th>昵称</th>
                      <th>角色</th>
                      <th>状态</th>
                      <th>最近登录</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const assignee = managedUserAssignee(user);
                      const canOpenAssignment =
                        canAssignInstances && user.status === "ACTIVE" && assignee !== null && assignableUserIds.has(user.id);
                      const canSwitchAccount =
                        currentUser.isSuperAdmin &&
                        user.id !== currentUser.id &&
                        user.status === "ACTIVE" &&
                        !user.roleNames.includes("super_admin");
                      return (
                        <tr key={user.id}>
                          <td>{user.username}</td>
                          <td>{user.displayName}</td>
                          <td>{user.roleNames.join(", ") || "无角色"}</td>
                          <td>{user.status === "ACTIVE" ? "启用" : "禁用"}</td>
                          <td>{formatDate(user.lastLoginAt)}</td>
                          <td>
                            <div className="user-row-actions">
                              <button className="small-button compact-button" type="button" onClick={() => openUserEditor(user)}>
                                <UserCog size={14} />
                                编辑
                              </button>
                              {canOpenAssignment && assignee ? (
                                <button className="small-button compact-button" type="button" onClick={() => openAssignmentModal(assignee)}>
                                  分配实例
                                </button>
                              ) : null}
                              {canSwitchAccount ? (
                                <button
                                  className="small-button compact-button"
                                  disabled={switchingUserId === user.id}
                                  type="button"
                                  onClick={() => void switchToUser(user)}
                                >
                                  <LogIn size={14} />
                                  {switchingUserId === user.id ? "切换中" : "切换"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {canManageRoles ? (
          <section className="panel-block role-panel">
            <div className="section-heading role-heading-wrap">
              <div className="role-heading-info">
                <h2>角色与权限分配</h2>
                <p>为角色以及未分配角色的用户配置操作权限。</p>
              </div>
              <select className="role-select-box" value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>
                {roles.map((role) => (
                  <option value={role.id} key={role.id}>
                    {roleDisplayName(role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="permission-groups">
              {PERMISSION_GROUPS.map((group) => (
                <div className="permission-group-card" key={group.group}>
                  <h3 className="permission-group-title">{group.group}</h3>
                  <div className="permission-group-items">
                    {group.items.map((item) => {
                      const isActive = rolePermissions.includes(item.code);
                      return (
                        <label className={`permission-chip ${isActive ? "active" : ""}`} key={item.code}>
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={() => togglePermission(item.code)}
                            className="hidden-checkbox"
                          />
                          <div className="permission-chip-content">
                            {isActive ? <ShieldCheck size={16} /> : <div className="permission-chip-dot" />}
                            <span className="permission-label">{item.label}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="role-actions">
              <button className="primary-button settings-save" disabled={!selectedRole || savingRole} onClick={() => void saveRolePermissions()}>
                <ShieldCheck size={17} />
                {savingRole ? "保存中" : "保存权限"}
              </button>
            </div>
          </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function AuditView({
  token,
  onLogout,
  refreshTick,
  onAskSaki,
  canDeleteLogs
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  canDeleteLogs: boolean;
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const pageSize = 20;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const result = await api.auditLogs(token, page, pageSize);
      setLogs(result.data);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "审计日志读取失败");
    }
  }, [onLogout, token, page]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick, page]);

  const summary = useMemo(() => {
    const success = logs.filter((log) => log.result === "SUCCESS").length;
    const failure = logs.length - success;
    const actors = new Set(logs.map((log) => auditActor(log))).size;
    const resourceTypes = new Set(logs.map((log) => log.resourceType || "system")).size;
    const successRate = logs.length > 0 ? `${Math.round((success / logs.length) * 100)}%` : "-";
    return { actors, failure, resourceTypes, success, successRate };
  }, [logs]);

  const visibleStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = Math.min(total, page * pageSize);
  const latestLogAt = logs[0]?.createdAt ? formatDate(logs[0].createdAt) : "-";

  useEffect(() => {
    setSelectedLog((current) => {
      if (current) {
        const next = logs.find((log) => log.id === current.id);
        if (next) return next;
      }
      return logs[0] ?? null;
    });
  }, [logs]);

  useEffect(() => {
    const visibleIds = new Set(logs.map((log) => log.id));
    setSelectedLogIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [logs]);

  const selectedLogIdSet = useMemo(() => new Set(selectedLogIds), [selectedLogIds]);
  const allVisibleSelected = logs.length > 0 && logs.every((log) => selectedLogIdSet.has(log.id));

  function toggleLogSelection(id: string) {
    setSelectedLogIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleVisibleSelection() {
    if (allVisibleSelected) {
      setSelectedLogIds([]);
      return;
    }
    setSelectedLogIds(logs.map((log) => log.id));
  }

  async function refreshAfterDelete(deletedIds: string[]) {
    const deletedOnPage = logs.filter((log) => deletedIds.includes(log.id)).length;
    setSelectedLogIds((current) => current.filter((id) => !deletedIds.includes(id)));
    setSelectedLog((current) => (current && deletedIds.includes(current.id) ? null : current));
    if (page > 1 && logs.length <= deletedOnPage) {
      setPage((current) => Math.max(1, current - 1));
      return;
    }
    await refresh();
  }

  function handleDeleteError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.status === 401) {
      onLogout();
      return;
    }
    setError(err instanceof Error ? err.message : fallback);
  }

  async function deleteActiveLog() {
    if (!activeLog || deleting) return;
    if (!window.confirm("确定删除当前审计日志吗？")) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await api.deleteAuditLog(token, activeLog.id);
      setNotice(`已删除 ${result.deleted} 条审计日志。`);
      await refreshAfterDelete([activeLog.id]);
    } catch (err) {
      handleDeleteError(err, "审计日志删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function deleteSelectedLogs() {
    if (selectedLogIds.length === 0 || deleting) return;
    if (!window.confirm(`确定删除选中的 ${selectedLogIds.length} 条审计日志吗？`)) return;
    const ids = [...selectedLogIds];
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await api.deleteAuditLogs(token, ids);
      setNotice(`已批量删除 ${result.deleted} 条审计日志。`);
      await refreshAfterDelete(ids);
    } catch (err) {
      handleDeleteError(err, "审计日志批量删除失败");
    } finally {
      setDeleting(false);
    }
  }

  async function clearAllLogs() {
    if (total === 0 || deleting) return;
    if (!window.confirm("确定清空全部审计日志吗？该操作无法撤销。")) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const result = await api.clearAuditLogs(token);
      setNotice(`已清空 ${result.deleted} 条审计日志。`);
      setSelectedLogIds([]);
      setSelectedLog(null);
      if (page !== 1) {
        setPage(1);
      } else {
        await refresh();
      }
    } catch (err) {
      handleDeleteError(err, "审计日志清空失败");
    } finally {
      setDeleting(false);
    }
  }

  function askSakiAboutLog(log: AuditLogEntry) {
    if (!onAskSaki) return;
    const payloadText = auditPayloadText(log.payload);
    onAskSaki({
      message: `请分析这条审计日志的风险，并在需要时继续查找相关记录：\n${log.action}`,
      contextTitle: `审计日志：${log.action}`,
      contextText: [
        `Action: ${log.action}`,
        `Result: ${log.result}`,
        `Actor: ${auditActor(log)}`,
        `Resource: ${auditResourceLabel(log)}`,
        `IP: ${log.ip ?? "-"}`,
        `Time: ${log.createdAt}`,
        payloadText ? `Payload:\n${payloadText}` : "Payload: none"
      ].join("\n"),
      mode: "agent",
      clearInstance: true
    });
  }

  function openAuditSaki() {
    if (!onAskSaki) return;
    onAskSaki({
      message: "请查找最近失败或高风险的审计日志，说明风险并给出下一步处理建议。",
      mode: "agent",
      clearInstance: true
    });
  }

  const activeLog = selectedLog ?? logs[0] ?? null;
  const selectedPayloadText = activeLog ? auditPayloadText(activeLog.payload) : "";

  return (
    <>
      {error ? <div className="page-error">{error}</div> : null}
      {notice ? <div className="page-notice">{notice}</div> : null}
      <section className="panel-block audit-panel">
        <div className="audit-summary-grid">
          <div className="audit-summary-card success">
            <span>本页成功</span>
            <strong>{summary.success}</strong>
            <small>{summary.successRate}</small>
          </div>
          <div className="audit-summary-card failure">
            <span>本页失败</span>
            <strong>{summary.failure}</strong>
            <small>需关注</small>
          </div>
          <div className="audit-summary-card">
            <span>涉及用户</span>
            <strong>{summary.actors}</strong>
            <small>当前页</small>
          </div>
          <div className="audit-summary-card">
            <span>最新记录</span>
            <strong>{latestLogAt}</strong>
            <small>{summary.resourceTypes} 类资源</small>
          </div>
        </div>

        <div className="audit-workbench">
          <div className="audit-board">
            <div className="audit-stream-heading">
              <h3>信号矩阵</h3>
              <span>
                {visibleStart}-{visibleEnd} / {total}
              </span>
              <div className="audit-toolbar-actions">
                {onAskSaki ? (
                  <button className="small-button" type="button" onClick={openAuditSaki}>
                    <Sparkles size={14} />
                    问 Saki
                  </button>
                ) : null}
                {canDeleteLogs ? (
                  <>
                    <button className="small-button" type="button" disabled={logs.length === 0 || deleting} onClick={toggleVisibleSelection}>
                      <CheckCircle2 size={14} />
                      {allVisibleSelected ? "取消本页" : "选择本页"}
                    </button>
                    <button className="small-button danger-action" type="button" disabled={selectedLogIds.length === 0 || deleting} onClick={() => void deleteSelectedLogs()}>
                      <Trash2 size={14} />
                      批量删除
                    </button>
                    <button className="small-button danger-action" type="button" disabled={!activeLog || deleting} onClick={() => void deleteActiveLog()}>
                      <Trash2 size={14} />
                      删除当前
                    </button>
                    <button className="small-button danger-action" type="button" disabled={total === 0 || deleting} onClick={() => void clearAllLogs()}>
                      <Trash2 size={14} />
                      清空全部
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {logs.length === 0 ? (
              <div className="audit-empty">
                <ClipboardList size={26} />
                <span>暂无审计日志</span>
              </div>
            ) : (
              <div className="audit-signal-grid">
                {logs.map((log, index) => {
                  const success = log.result === "SUCCESS";
                  const selected = activeLog?.id === log.id;
                  const featured = index === 0 || !success;
                  return (
                    <article
                      className={`audit-signal-tile ${success ? "success" : "failure"} ${featured ? "featured" : ""} ${
                        selected ? "active" : ""
                      } ${canDeleteLogs ? "selectable" : ""}`}
                      key={log.id}
                    >
                      <span className="audit-signal-bar" />
                      <button className="audit-signal-main" type="button" onClick={() => setSelectedLog(log)}>
                        <span className="audit-signal-top">
                          <span className="audit-action-icon" aria-hidden="true">
                            {auditResourceIcon(log.resourceType, log.action)}
                          </span>
                          <span className={`audit-result-badge ${success ? "success" : "failure"}`}>
                            {success ? "成功" : "失败"}
                          </span>
                        </span>
                        <strong>{auditActionLabel(log.action)}</strong>
                        <code>{log.action}</code>
                        <span className="audit-signal-meta">
                          <span>{auditActor(log)}</span>
                          <span>{formatDate(log.createdAt)}</span>
                        </span>
                        <span className="audit-signal-resource">{auditResourceLabel(log)}</span>
                      </button>
                      {canDeleteLogs ? (
                        <label className="audit-select-check">
                          <input
                            type="checkbox"
                            checked={selectedLogIdSet.has(log.id)}
                            onChange={() => toggleLogSelection(log.id)}
                          />
                          <span>选择</span>
                        </label>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="audit-inspector-panel">
            {activeLog ? (
              <>
                <div className={`audit-inspector-head ${activeLog.result === "SUCCESS" ? "success" : "failure"}`}>
                  <span className="audit-action-icon" aria-hidden="true">
                    {auditResourceIcon(activeLog.resourceType, activeLog.action)}
                  </span>
                  <div>
                    <p>{activeLog.result === "SUCCESS" ? "Verified" : "Attention"}</p>
                    <h3>{auditActionLabel(activeLog.action)}</h3>
                    <code>{activeLog.action}</code>
                  </div>
                </div>

                <div className="audit-inspector-grid">
                  <div>
                    <span>结果</span>
                    <strong>{activeLog.result === "SUCCESS" ? "成功" : "失败"}</strong>
                  </div>
                  <div>
                    <span>时间</span>
                    <strong>{formatDate(activeLog.createdAt)}</strong>
                  </div>
                  <div>
                    <span>用户</span>
                    <strong>{auditActor(activeLog)}</strong>
                  </div>
                  <div>
                    <span>资源</span>
                    <strong>{auditResourceLabel(activeLog)}</strong>
                  </div>
                  <div>
                    <span>IP</span>
                    <strong>{activeLog.ip ?? "-"}</strong>
                  </div>
                  <div>
                    <span>载荷</span>
                    <strong>{activeLog.payload ? "有" : "无"}</strong>
                  </div>
                </div>

                <div className="audit-inspector-payload">
                  <div className="audit-detail-section-title">
                    <FileText size={15} />
                    <span>Payload</span>
                    {onAskSaki ? (
                      <button className="small-button" type="button" onClick={() => askSakiAboutLog(activeLog)}>
                        <Sparkles size={14} />
                        交给 Saki
                      </button>
                    ) : null}
                  </div>
                  {selectedPayloadText ? <pre>{selectedPayloadText}</pre> : <div className="audit-payload-empty">无载荷</div>}
                </div>
              </>
            ) : (
              <div className="audit-empty compact">
                <ClipboardList size={22} />
                <span>暂无选中事件</span>
              </div>
            )}
          </aside>
        </div>

        {totalPages > 1 && (
          <div className="audit-pagination">
            <button className="small-button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={16} />
              上一页
            </button>
            <span>{page} / {totalPages}</span>
            <button className="small-button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>

    </>
  );
}

const emptySakiConfig: SakiConfigResponse = {
  requestTimeoutMs: 120000,
  provider: "ollama",
  model: "llama3",
  ollamaUrl: "http://localhost:11434",
  baseUrl: "",
  apiKey: "",
  providerConfigs: {
    ollama: {
      model: "llama3",
      ollamaUrl: "http://localhost:11434"
    }
  },
  searchEnabled: true,
  mcpEnabled: false,
  systemPrompt: "",
  appearance: defaultPanelAppearance,
  configPath: "",
  globalConfigPath: ""
};

const providerBaseUrlDefaults: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  minimax: "https://api.minimaxi.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  tongyi: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  custom: ""
};

const localProviderUrlDefaults = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234"
};

const modelProviderOptions = [
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "openai", label: "OpenAI Compatible" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "zhipu", label: "Zhipu" },
  { value: "gemini", label: "Gemini" },
  { value: "minimax", label: "MiniMax" },
  { value: "anthropic", label: "Anthropic" },
  { value: "moonshot", label: "Moonshot" },
  { value: "tongyi", label: "通义千问" },
  { value: "doubao", label: "豆包" },
  { value: "custom", label: "Custom" }
];

function isLocalProvider(provider: string): boolean {
  return provider === "ollama" || provider === "lmstudio";
}

function needsCloudApiFields(provider: string): boolean {
  return !isLocalProvider(provider) && provider !== "copilot";
}

function defaultProviderConfig(provider: string): SakiProviderConfig {
  if (provider === "ollama") {
    return {
      model: "llama3",
      ollamaUrl: localProviderUrlDefaults.ollama
    };
  }
  if (provider === "lmstudio") {
    return {
      model: "",
      ollamaUrl: localProviderUrlDefaults.lmstudio
    };
  }
  return {
    model: "",
    baseUrl: providerBaseUrlDefaults[provider] ?? "",
    apiKey: ""
  };
}

function providerConfigFromForm(form: SakiConfigResponse, provider: string): SakiProviderConfig {
  return {
    ...defaultProviderConfig(provider),
    ...(form.providerConfigs?.[provider] ?? {})
  };
}

interface SakiSkillDraft {
  name: string;
  description: string;
  tags: string;
  content: string;
  enabled: boolean;
}

const emptySakiSkillDraft: SakiSkillDraft = {
  name: "",
  description: "",
  tags: "",
  content: "",
  enabled: true
};

function parseSakiSkillTags(value: string): string[] {
  return value
    .split(/[,，;；\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function sakiSkillDraftFromDetail(skill: SakiSkillDetail): SakiSkillDraft {
  return {
    name: skill.name,
    description: skill.description ?? "",
    tags: skill.tags?.join(", ") ?? "",
    content: skill.content,
    enabled: skill.enabled !== false
  };
}

function formatSessionTimeoutMinutes(value: number): string {
  return Number.isFinite(value) ? String(value) : "120";
}

function parseSessionTimeoutMinutesDraft(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!trimmed || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error("登录超时时间必须是大于或等于 0 的数字。");
  }
  return Number(parsed.toFixed(3));
}

function AboutView() {
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "up-to-date" | "updating" | "error">("idle");
  const [updateMessage, setUpdateMessage] = useState("");
  const currentVersion = "v0.1.0";
  const projectLogoSrc = defaultPanelAppearance.appLogoSrc;
  const [latestVersion, setLatestVersion] = useState("");
  const [latestReleaseUrl, setLatestReleaseUrl] = useState("");

  const checkForUpdates = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateMessage("正在检测更新...");
    try {
      const response = await fetch("https://api.github.com/repos/EthanChan050430/Saki-Panel/releases/latest");
      if (response.ok) {
        const data = (await response.json()) as { tag_name?: string; name?: string; html_url?: string };
        const releaseVersion = data.tag_name || data.name || "";
        setLatestVersion(releaseVersion);
        setLatestReleaseUrl(data.html_url || "https://github.com/EthanChan050430/Saki-Panel/releases");
        if (releaseVersion && releaseVersion !== currentVersion) {
          setUpdateStatus("available");
          setUpdateMessage(`发现新版本: ${releaseVersion}`);
        } else {
          setUpdateStatus("up-to-date");
          setUpdateMessage("当前已是最新版本");
        }
      } else {
        throw new Error("无法获取版本信息");
      }
    } catch (err) {
      setUpdateStatus("error");
      setUpdateMessage(err instanceof Error ? err.message : "检测更新失败");
    }
  }, [currentVersion]);

  return (
    <div className="about-page">
      <div className="about-wiki-layout">
        <article className="about-article">
          <header className="about-article-header">
            <div className="about-kicker">
              <img className="about-kicker-logo" src={projectLogoSrc} alt="" draggable={false} />
              项目百科
            </div>
            <h1>Saki Panel</h1>
            <p>
              Saki Panel 是一套面向服务器实例、节点、模板、用户权限与审计日志的 Web 管理面板。
              它把日常运维中分散的启动、文件、终端、监控和权限动作收拢到一个清晰的工作台里。
            </p>
            <div className="about-meta-strip" aria-label="项目摘要">
              <span>版本 {currentVersion}</span>
              <span>Apache-2.0 License</span>
              <span>React + TypeScript</span>
              <span>Panel / Daemon 架构</span>
            </div>
          </header>

          <section id="about-overview" className="about-wiki-section">
            <h2>
              <Info size={18} />
              概览
            </h2>
            <p>
              面板围绕“实例”组织工作：你可以创建服务实例、分配节点、查看运行状态、打开终端、
              管理文件并追踪操作记录。界面侧重长期使用的可读性，信息密度适中，适合在桌面端持续管理，
              也兼顾移动端临时查看与处理。
            </p>
            <dl className="about-definition-list">
              <div>
                <dt>定位</dt>
                <dd>轻量级实例与节点运维面板</dd>
              </div>
              <div>
                <dt>适用场景</dt>
                <dd>个人服务器、小团队服务托管、模板化部署、远程文件管理</dd>
              </div>
              <div>
                <dt>设计重点</dt>
                <dd>清晰导航、权限隔离、可审计操作、低学习成本</dd>
              </div>
            </dl>
          </section>

          <section id="about-architecture" className="about-wiki-section">
            <h2>
              <Layers size={18} />
              系统组成
            </h2>
            <p>
              项目由前端控制台、Panel 服务端、Daemon 节点代理与共享类型包组成。前端负责交互，
              Panel 负责认证、权限、审计和 API 聚合，Daemon 则在目标节点上执行实例、文件与终端相关操作。
            </p>
            <div className="about-component-grid">
              <div>
                <Server size={18} />
                <strong>Panel</strong>
                <span>统一 API、用户会话、权限策略与审计入口。</span>
              </div>
              <div>
                <TerminalIcon size={18} />
                <strong>Daemon</strong>
                <span>连接实际节点，执行实例生命周期、文件和终端任务。</span>
              </div>
              <div>
                <FileText size={18} />
                <strong>Web Console</strong>
                <span>提供仪表盘、实例、模板、用户、设置与关于文档界面。</span>
              </div>
            </div>
          </section>

          <section id="about-features" className="about-wiki-section">
            <h2>
              <Wrench size={18} />
              核心能力
            </h2>
            <div className="about-feature-table" role="table" aria-label="核心能力">
              <div role="row">
                <span role="columnheader">模块</span>
                <span role="columnheader">用途</span>
                <span role="columnheader">价值</span>
              </div>
              <div role="row">
                <span role="cell">实例管理</span>
                <span role="cell">创建、启动、停止、重启与查看运行日志。</span>
                <span role="cell">把服务生命周期集中在一个入口。</span>
              </div>
              <div role="row">
                <span role="cell">文件管理</span>
                <span role="cell">浏览目录、上传下载、编辑文本文件与解压归档。</span>
                <span role="cell">减少反复切换 SSH 与本地工具的成本。</span>
              </div>
              <div role="row">
                <span role="cell">节点监控</span>
                <span role="cell">查看节点连接状态、资源指标与连通性。</span>
                <span role="cell">快速判断实例异常是否来自节点侧。</span>
              </div>
              <div role="row">
                <span role="cell">模板系统</span>
                <span role="cell">沉淀常用启动命令、环境变量与部署参数。</span>
                <span role="cell">让重复部署更稳定，也便于团队复用。</span>
              </div>
              <div role="row">
                <span role="cell">Saki 助手</span>
                <span role="cell">基于当前页面上下文进行问答、排查与辅助操作。</span>
                <span role="cell">把解释、诊断和执行连接到同一工作流。</span>
              </div>
            </div>
          </section>

          <section id="about-workflow" className="about-wiki-section">
            <h2>
              <ClipboardList size={18} />
              典型流程
            </h2>
            <ol className="about-flow-list">
              <li>
                <strong>接入节点</strong>
                <span>在节点侧运行 Daemon，并在面板中确认连接状态。</span>
              </li>
              <li>
                <strong>创建模板</strong>
                <span>整理启动命令、工作目录和常用环境变量。</span>
              </li>
              <li>
                <strong>部署实例</strong>
                <span>基于模板创建实例，按角色分配可见范围与操作权限。</span>
              </li>
              <li>
                <strong>观察与维护</strong>
                <span>通过日志、终端、文件管理和审计记录完成日常维护。</span>
              </li>
            </ol>
          </section>

          <section id="about-security" className="about-wiki-section">
            <h2>
              <ShieldCheck size={18} />
              安全与审计
            </h2>
            <p>
              Saki Panel 使用基于角色的权限模型控制不同用户能看到和操作的资源。
              关键操作会记录到审计日志中，便于回溯“谁在什么时间对什么资源做了什么事”。
            </p>
            <ul className="about-check-list">
              <li>支持用户、角色与权限组合管理。</li>
              <li>支持实例分配，降低无关资源暴露。</li>
              <li>保留登录、文件、实例、模板、节点、任务等操作记录。</li>
              <li>支持会话超时与面板外观等运行时配置。</li>
            </ul>
          </section>

          <section id="about-stack" className="about-wiki-section">
            <h2>
              <Code2 size={18} />
              技术栈
            </h2>
            <div className="about-stack-list">
              <span>React 19</span>
              <span>TypeScript</span>
              <span>Vite</span>
              <span>Fastify</span>
              <span>Prisma</span>
              <span>WebSocket</span>
              <span>xterm.js</span>
              <span>CodeMirror</span>
            </div>
          </section>

          <section id="about-maintenance" className="about-wiki-section">
            <h2>
              <RefreshCw size={18} />
              维护与更新
            </h2>
            <p>
              发布版本以 GitHub Releases 为准。建议在更新前阅读发布说明，并备份数据库、
              环境变量和自定义配置，尤其是涉及权限、会话或节点通信的版本。
            </p>
          </section>
        </article>

        <aside className="about-side-column" aria-label="关于页面侧栏">
          <section className="about-infobox" aria-label="项目资料">
            <div className="about-infobox-title">
              <div className="about-icon">
                <img className="about-project-logo" src={projectLogoSrc} alt="" draggable={false} />
              </div>
              <div>
                <strong>Saki Panel</strong>
                <span>系统管理面板</span>
              </div>
            </div>

            <dl className="about-info-list">
              <div>
                <dt>当前版本</dt>
                <dd>{currentVersion}</dd>
              </div>
              <div>
                <dt>作者</dt>
                <dd>帥気的男主角</dd>
              </div>
              <div>
                <dt>联系方式</dt>
                <dd>QQ: 3151815823</dd>
              </div>
              <div>
                <dt>许可证</dt>
                <dd>Apache-2.0</dd>
              </div>
              <div>
                <dt>仓库</dt>
                <dd>
                  <a href="https://github.com/EthanChan050430/Saki-Panel" target="_blank" rel="noopener noreferrer">
                    <Github size={15} />
                    EthanChan050430/Saki-Panel
                  </a>
                </dd>
              </div>
            </dl>

            <div className="about-update-panel">
              <h2>
                <RefreshCw size={16} />
                更新检查
              </h2>
              <div className="update-status">
                <div className={`status-indicator ${updateStatus}`}>
                  {updateStatus === "checking" && <Loader2 size={16} className="status-spinner" />}
                  {updateStatus === "available" && <DownloadCloud size={16} />}
                  {updateStatus === "up-to-date" && <CheckCircle2 size={16} />}
                  {updateStatus === "updating" && <Loader2 size={16} className="status-spinner" />}
                  {updateStatus === "error" && <Bug size={16} />}
                  {updateStatus === "idle" && <Clock size={16} />}
                </div>
                <span className="status-text">{updateMessage || "尚未检测更新"}</span>
              </div>
              <div className="update-actions">
                <button
                  className="update-btn check-btn"
                  onClick={checkForUpdates}
                  disabled={updateStatus === "checking" || updateStatus === "updating"}
                >
                  {updateStatus === "checking" ? "检测中..." : "检查更新"}
                </button>
                {updateStatus === "available" && (
                  <a
                    className="update-btn update-btn-primary"
                    href={latestReleaseUrl || "https://github.com/EthanChan050430/Saki-Panel/releases"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DownloadCloud size={15} />
                    查看发布页
                  </a>
                )}
              </div>
              {latestVersion && (
                <p className="latest-version-info">最新版本: {latestVersion}</p>
              )}
            </div>
          </section>

          <nav className="about-toc" aria-label="关于页面目录">
            <div className="about-toc-heading">目录</div>
            <a href="#about-overview">概览</a>
            <a href="#about-architecture">系统组成</a>
            <a href="#about-features">核心能力</a>
            <a href="#about-workflow">典型流程</a>
            <a href="#about-security">安全与审计</a>
            <a href="#about-stack">技术栈</a>
            <a href="#about-maintenance">维护与更新</a>
          </nav>
        </aside>
      </div>
    </div>
  );
}

type SakiSettingsSection = "system" | "model" | "features" | "appearance" | "prompt" | "skills";

function SettingsView({
  token,
  onLogout,
  onSessionRefresh,
  refreshTick,
  onAppearanceChange
}: {
  token: string;
  onLogout: () => void;
  onSessionRefresh: (token: string, user: CurrentUser) => void;
  refreshTick: number;
  onAppearanceChange: (appearance: PanelAppearanceSettings) => void;
}) {
  const [form, setForm] = useState<SakiConfigResponse>(emptySakiConfig);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState("120");
  const [skillList, setSkillList] = useState<SakiSkillSummary[]>([]);
  const [skillCreatorOpen, setSkillCreatorOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SakiSkillDetail | null>(null);
  const [skillEditDraft, setSkillEditDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [skillDownloadUrl, setSkillDownloadUrl] = useState("");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [activeSettingsSection, setActiveSettingsSection] = useState<SakiSettingsSection>("system");
  const [settingsMenuCollapsed, setSettingsMenuCollapsed] = useState(false);
  const [modelOptions, setModelOptions] = useState<SakiModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detectingModels, setDetectingModels] = useState(false);
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const skillDetailRequestRef = useRef(0);
  const appLogoInputRef = useRef<HTMLInputElement>(null);
  const loginCoverInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const mobileBackgroundInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const [nextConfig, nextSkills, nextSessionSettings] = await Promise.all([
        api.sakiConfig(token),
        api.sakiAllSkills(token),
        api.sessionSettings(token)
      ]);
      setForm(nextConfig);
      setSessionTimeoutMinutes(formatSessionTimeoutMinutes(nextSessionSettings.sessionTimeoutMinutes));
      onAppearanceChange(nextConfig.appearance);
      setSkillList(nextSkills);
      setModelOptions([]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "Saki 设置读取失败");
    } finally {
      setLoading(false);
    }
  }, [onAppearanceChange, onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  function withActiveProviderConfig(current: SakiConfigResponse, patch: SakiProviderConfig): SakiConfigResponse {
    const provider = current.provider;
    const nextConfig: SakiProviderConfig = providerConfigFromForm(current, provider);
    if (patch.model !== undefined) nextConfig.model = patch.model;
    if (patch.ollamaUrl !== undefined) nextConfig.ollamaUrl = patch.ollamaUrl;
    if (patch.baseUrl !== undefined) nextConfig.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) nextConfig.apiKey = patch.apiKey;

    const next: SakiConfigResponse = {
      ...current,
      providerConfigs: {
        ...current.providerConfigs,
        [provider]: nextConfig
      }
    };
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.ollamaUrl !== undefined) next.ollamaUrl = patch.ollamaUrl;
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) next.apiKey = patch.apiKey;
    return next;
  }

  function updateActiveProviderConfig(patch: SakiProviderConfig) {
    setModelOptions([]);
    setForm((current) => withActiveProviderConfig(current, patch));
  }

  function currentSakiConfigPayload(): UpdateSakiConfigRequest {
    const activeConfig = providerConfigFromForm(form, form.provider);
    const providerConfigs = {
      ...form.providerConfigs,
      [form.provider]: {
        ...activeConfig,
        model: form.model,
        ollamaUrl: form.ollamaUrl,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey
      }
    };
    return {
      requestTimeoutMs: Number(form.requestTimeoutMs) || 120000,
      provider: form.provider,
      model: form.model,
      ollamaUrl: form.ollamaUrl,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      providerConfigs,
      searchEnabled: form.searchEnabled,
      mcpEnabled: form.mcpEnabled,
      systemPrompt: form.systemPrompt ?? "",
      appearance: form.appearance
    };
  }

  function changeProvider(provider: string) {
    setModelOptions([]);
    setForm((current) => {
      const nextConfig = providerConfigFromForm(current, provider);
      return {
        ...current,
        provider,
        model: nextConfig.model ?? "",
        ollamaUrl: nextConfig.ollamaUrl ?? localProviderUrlDefaults[provider as keyof typeof localProviderUrlDefaults] ?? "",
        baseUrl: nextConfig.baseUrl ?? providerBaseUrlDefaults[provider] ?? "",
        apiKey: nextConfig.apiKey ?? ""
      };
    });
  }

  function updateAppearance(patch: Partial<PanelAppearanceSettings>) {
    setForm((current) => ({
      ...current,
      appearance: normalizePanelAppearance({
        ...current.appearance,
        ...patch
      })
    }));
  }

  async function chooseAppearanceImage(
    field: "appLogoSrc" | "loginCoverSrc" | "backgroundSrc" | "mobileBackgroundSrc",
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const dataUrl = await appearanceFileToDataUrl(file);
      updateAppearance({ [field]: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片读取失败");
    }
  }

  async function detectModels(silent = false) {
    const provider = form.provider;
    if (needsCloudApiFields(provider) && (!form.baseUrl.trim() || !form.apiKey.trim())) {
      if (!silent) {
        setNotice("");
        setError("请先填写模型 API Base URL 和 API Key。");
      }
      return;
    }
    if (provider === "ollama" && !form.ollamaUrl.trim()) {
      if (!silent) {
        setNotice("");
        setError("请先填写 Ollama URL。");
      }
      return;
    }

    setDetectingModels(true);
    if (!silent) {
      setError("");
      setNotice("");
    }
    try {
      const result = await api.sakiModels(token, currentSakiConfigPayload());
      setModelOptions(result.models);
      if (result.models.length > 0) {
        setForm((current) => {
          const hasCurrent = result.models.some((model) => model.id === current.model);
          const nextModel = result.models[0]?.id ?? current.model;
          return hasCurrent ? current : withActiveProviderConfig(current, { model: nextModel });
        });
      }
      if (!silent) {
        const warningText = result.warnings.length > 0 ? `；警告 ${result.warnings.length} 条` : "";
        setNotice(
          result.models.length > 0
            ? `${result.provider} 模型 API 检测成功，发现 ${result.models.length} 个模型${warningText}。`
            : `${result.provider} 模型 API 已响应，但没有返回可用模型${warningText}。`
        );
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "模型 API 检测失败");
      }
    } finally {
      setDetectingModels(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    const provider = form.provider;
    if (needsCloudApiFields(provider) && (!form.baseUrl.trim() || !form.apiKey.trim())) return;
    if (provider === "ollama" && !form.ollamaUrl.trim()) return;
    const timer = window.setTimeout(() => {
      void detectModels(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [form.apiKey, form.baseUrl, form.ollamaUrl, form.provider, loading]);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextSessionTimeoutMinutes = parseSessionTimeoutMinutesDraft(sessionTimeoutMinutes);
      const [saved, savedSessionSettings] = await Promise.all([
        api.updateSakiConfig(token, currentSakiConfigPayload()),
        api.updateSessionSettings(token, {
          sessionTimeoutMinutes: nextSessionTimeoutMinutes
        })
      ]);
      setForm(saved);
      setSessionTimeoutMinutes(formatSessionTimeoutMinutes(savedSessionSettings.sessionTimeoutMinutes));
      onAppearanceChange(saved.appearance);
      const refreshed = await api.refreshSession(token);
      onSessionRefresh(refreshed.token, refreshed.user);
      setNotice("设置已保存，登录超时策略已应用。");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function refreshSkillList() {
    const nextSkills = await api.sakiAllSkills(token);
    setSkillList(nextSkills);
    if (selectedSkillId && !nextSkills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(null);
      setSelectedSkill(null);
      setSkillEditDraft(emptySakiSkillDraft);
    }
  }

  async function createSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = skillDraft.name.trim();
    const content = skillDraft.content.trim();
    if (!name || !content) {
      setError("Skill name and content are required.");
      setNotice("");
      return;
    }
    const payload: CreateSakiSkillRequest = {
      name,
      description: skillDraft.description.trim(),
      content,
      tags: parseSakiSkillTags(skillDraft.tags),
      enabled: skillDraft.enabled
    };
    setSkillBusy("create");
    setError("");
    setNotice("");
    try {
      const skill = await api.createSakiSkill(token, payload);
      skillDetailRequestRef.current += 1;
      setSkillDraft(emptySakiSkillDraft);
      setSkillCreatorOpen(false);
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      setNotice(`Skill ${skill.name} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill save failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function downloadSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = skillDownloadUrl.trim();
    if (!url) {
      setError("OpenClaw Skill URL is required.");
      setNotice("");
      return;
    }
    setSkillBusy("download");
    setError("");
    setNotice("");
    try {
      const skill = await api.downloadSakiSkill(token, { url, enabled: true });
      skillDetailRequestRef.current += 1;
      setSkillDownloadUrl("");
      setSkillCreatorOpen(false);
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      setNotice(`Downloaded ${skill.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill download failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function selectSkill(skill: SakiSkillSummary) {
    const requestId = skillDetailRequestRef.current + 1;
    skillDetailRequestRef.current = requestId;
    setSkillCreatorOpen(false);
    setSelectedSkillId(skill.id);
    setSelectedSkill(null);
    setSkillEditDraft(emptySakiSkillDraft);
    setSkillDetailLoading(true);
    setError("");
    setNotice("");
    try {
      const detail = await api.sakiSkill(token, skill.id);
      if (skillDetailRequestRef.current !== requestId) return;
      setSelectedSkill(detail);
      setSkillEditDraft(sakiSkillDraftFromDetail(detail));
    } catch (err) {
      if (skillDetailRequestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Skill load failed");
    } finally {
      if (skillDetailRequestRef.current === requestId) {
        setSkillDetailLoading(false);
      }
    }
  }

  async function saveSelectedSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSkill) return;
    const name = skillEditDraft.name.trim();
    const content = skillEditDraft.content.trim();
    if (!name || !content) {
      setError("Skill name and content are required.");
      setNotice("");
      return;
    }
    const payload: UpdateSakiSkillRequest = {
      name,
      description: skillEditDraft.description.trim(),
      content,
      tags: parseSakiSkillTags(skillEditDraft.tags),
      enabled: skillEditDraft.enabled
    };
    setSkillBusy(selectedSkill.id);
    setError("");
    setNotice("");
    try {
      const skill = await api.updateSakiSkill(token, selectedSkill.id, payload);
      skillDetailRequestRef.current += 1;
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      setNotice(`Skill ${skill.name} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill update failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function toggleSkillEnabled(skill: SakiSkillSummary) {
    const patch: UpdateSakiSkillRequest = { enabled: skill.enabled === false };
    setSkillBusy(skill.id);
    setError("");
    setNotice("");
    try {
      const updatedSkill = await api.updateSakiSkill(token, skill.id, patch);
      if (selectedSkill?.id === skill.id) {
        setSelectedSkill(updatedSkill);
        setSkillEditDraft(sakiSkillDraftFromDetail(updatedSkill));
      }
      await refreshSkillList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill update failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function deleteSkill(skill: SakiSkillSummary) {
    if (skill.builtin) {
      await toggleSkillEnabled(skill);
      return;
    }
    if (!window.confirm(`Delete Skill "${skill.name}"?`)) return;
    setSkillBusy(skill.id);
    setError("");
    setNotice("");
    try {
      await api.deleteSakiSkill(token, skill.id);
      if (selectedSkill?.id === skill.id) {
        skillDetailRequestRef.current += 1;
        setSkillDetailLoading(false);
        setSelectedSkillId(null);
        setSelectedSkill(null);
        setSkillEditDraft(emptySakiSkillDraft);
      }
      await refreshSkillList();
      setNotice(`Deleted ${skill.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill delete failed");
    } finally {
      setSkillBusy(null);
    }
  }

  const settingsNavItems: Array<{ id: SakiSettingsSection; label: string; detail: string; icon: React.ReactNode }> = [
    { id: "system", label: "系统设置", detail: "基础配置", icon: <Settings size={17} /> },
    { id: "model", label: "AI 模型", detail: "Provider & Model", icon: <Cpu size={17} /> },
    { id: "features", label: "功能开关", detail: "扩展能力", icon: <Wrench size={17} /> },
    { id: "appearance", label: "外观自定义", detail: "登录页与背景", icon: <ImageIcon size={17} /> },
    { id: "prompt", label: "系统提示词", detail: "System Prompt", icon: <TextQuote size={17} /> },
    { id: "skills", label: "Skills", detail: `${skillList.length} installed`, icon: <Layers size={17} /> }
  ];

  return (
    <>
      {error ? <div className="page-error">{error}</div> : null}
      {notice ? <div className="page-notice">{notice}</div> : null}
      <section className="panel-block settings-panel">
        <div className="section-heading">
          <h2>Saki 设置</h2>
          <span>{loading ? "读取中" : "运行时配置"}</span>
        </div>
        <div className={`settings-grid settings-wiki ${settingsMenuCollapsed ? "toc-collapsed" : ""}`}>
          <input
            ref={appLogoInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("appLogoSrc", event)}
          />
          <input
            ref={loginCoverInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("loginCoverSrc", event)}
          />
          <input
            ref={backgroundInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("backgroundSrc", event)}
          />
          <input
            ref={mobileBackgroundInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("mobileBackgroundSrc", event)}
          />
          <nav className="settings-toc" aria-label="设置目录">
            <button
              className="settings-toc-toggle"
              type="button"
              title={settingsMenuCollapsed ? "展开目录" : "折叠目录"}
              onClick={() => setSettingsMenuCollapsed((current) => !current)}
            >
              {settingsMenuCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              <span>设置目录</span>
            </button>
            <div className="settings-toc-list">
              {settingsNavItems.map((item) => (
                <button
                  className={activeSettingsSection === item.id ? "active" : ""}
                  key={item.id}
                  type="button"
                  title={`${item.label} - ${item.detail}`}
                  onClick={() => setActiveSettingsSection(item.id)}
                >
                  <span className="settings-toc-icon">{item.icon}</span>
                  <span className="settings-toc-copy">
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </nav>
          <div className="settings-wiki-content">
          {activeSettingsSection !== "skills" ? (
          <form className="settings-config-form" onSubmit={(event) => void saveSettings(event)}>
          <div className={`settings-group ${activeSettingsSection === "system" ? "active" : "settings-section-hidden"}`} id="settings-system">
            <div className="settings-group-title">
              <div className="settings-group-icon">⚙️</div>
              <div>
                <h3>系统设置</h3>
                <span>基础配置</span>
              </div>
            </div>
            <div className="settings-group-content">
              <label>
                登录超时（分钟）
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={sessionTimeoutMinutes}
                  onChange={(event) => setSessionTimeoutMinutes(event.target.value)}
                  placeholder="0 表示永不超时"
                />
              </label>
              <label>
                请求超时 ms
                <input
                  type="number"
                  min={5000}
                  max={600000}
                  step={1000}
                  value={form.requestTimeoutMs}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, requestTimeoutMs: Number(event.target.value) || 120000 }))
                  }
                />
              </label>
            </div>
          </div>
          <div className={`settings-group ${activeSettingsSection === "model" ? "active" : "settings-section-hidden"}`} id="settings-model">
            <div className="settings-group-title">
              <div className="settings-group-icon">🤖</div>
              <div>
                <h3>AI 模型配置</h3>
                <span>Provider & Model</span>
              </div>
            </div>
            <div className="settings-group-content">
              <label>
                Provider
                <select
                  value={form.provider}
                  onChange={(event) => changeProvider(event.target.value)}
                >
                  {modelProviderOptions.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Model
                {modelOptions.length > 0 ? (
                  <select
                    value={form.model}
                    onChange={(event) => updateActiveProviderConfig({ model: event.target.value })}
                    required
                  >
                    {modelOptions.map((model) => (
                      <option value={model.id} key={`${model.provider}:${model.id}`}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={form.model}
                    onChange={(event) => updateActiveProviderConfig({ model: event.target.value })}
                    placeholder={form.provider === "ollama" ? "llama3" : "点击检测模型后自动填充"}
                    required
                  />
                )}
              </label>
              {isLocalProvider(form.provider) ? (
                <label>
                  {form.provider === "lmstudio" ? "LM Studio URL" : "Ollama URL"}
                  <input
                    value={form.ollamaUrl}
                    onChange={(event) => {
                      updateActiveProviderConfig({ ollamaUrl: event.target.value });
                    }}
                    placeholder={form.provider === "lmstudio" ? "http://localhost:1234" : "http://localhost:11434"}
                  />
                </label>
              ) : null}
              {needsCloudApiFields(form.provider) ? (
                <>
                  <label>
                    模型 API Base URL
                    <input
                      value={form.baseUrl}
                      onChange={(event) => {
                        updateActiveProviderConfig({ baseUrl: event.target.value });
                      }}
                      placeholder={providerBaseUrlDefaults[form.provider] || "https://api.example.com/v1"}
                    />
                  </label>
                  <label>
                    API Key
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(event) => {
                        updateActiveProviderConfig({ apiKey: event.target.value });
                      }}
                      placeholder="sk-..."
                    />
                  </label>
                </>
              ) : null}
            </div>
          </div>
          <div className={`settings-group ${activeSettingsSection === "features" ? "active" : "settings-section-hidden"}`} id="settings-features">
            <div className="settings-group-title">
              <div className="settings-group-icon">🎯</div>
              <div>
                <h3>功能开关</h3>
                <span>扩展能力</span>
              </div>
            </div>
            <div className="settings-group-content">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.searchEnabled ?? false}
                  onChange={(event) => setForm((current) => ({ ...current, searchEnabled: event.target.checked }))}
                />
                启用联网搜索与网页爬取
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.mcpEnabled ?? false}
                  onChange={(event) => setForm((current) => ({ ...current, mcpEnabled: event.target.checked }))}
                />
                启用 MCP
              </label>
            </div>
          </div>
          <div className={`settings-group ${activeSettingsSection === "appearance" ? "active" : "settings-section-hidden"}`} id="settings-appearance">
            <div className="settings-group-title">
              <div className="settings-group-icon">🎨</div>
              <div>
                <h3>外观自定义</h3>
                <span>登录页、图标与全站背景</span>
              </div>
            </div>
            <div className="settings-group-content">
              <label>
                登录标题
                <input
                  value={form.appearance?.appTitle ?? ""}
                  onChange={(event) => updateAppearance({ appTitle: event.target.value })}
                  placeholder="Saki Panel"
                />
              </label>
              <label>
                登录副标题
                <input
                  value={form.appearance?.appSubtitle ?? ""}
                  onChange={(event) => updateAppearance({ appSubtitle: event.target.value })}
                  placeholder="System Administration"
                />
              </label>
              <div className="appearance-field">
                <span>登录封面</span>
                <div className="appearance-source-row">
                  <input
                    value={form.appearance?.loginCoverSrc ?? ""}
                    onChange={(event) => updateAppearance({ loginCoverSrc: event.target.value })}
                    placeholder="/assets/cover.png"
                  />
                  <button className="small-button" type="button" onClick={() => loginCoverInputRef.current?.click()}>
                    <Upload size={15} />
                    选择图片
                  </button>
                </div>
                {form.appearance?.loginCoverSrc ? <img className="appearance-preview cover-preview" src={form.appearance.loginCoverSrc} alt="" /> : null}
              </div>
              <div className="appearance-field">
                <span>应用图标</span>
                <div className="appearance-source-row">
                  <input
                    value={form.appearance?.appLogoSrc ?? ""}
                    onChange={(event) => updateAppearance({ appLogoSrc: event.target.value })}
                    placeholder="/assets/saki-panel-icon.png"
                  />
                  <button className="small-button" type="button" onClick={() => appLogoInputRef.current?.click()}>
                    <Upload size={15} />
                    选择
                  </button>
                </div>
                {form.appearance?.appLogoSrc ? <img className="appearance-preview logo-preview" src={form.appearance.appLogoSrc} alt="" /> : null}
              </div>
              <div className="appearance-field">
                <span>网页背景</span>
                <div className="appearance-source-row">
                  <input
                    value={form.appearance?.backgroundSrc ?? ""}
                    onChange={(event) => updateAppearance({ backgroundSrc: event.target.value })}
                    placeholder="/assets/background.png"
                  />
                  <button className="small-button" type="button" onClick={() => backgroundInputRef.current?.click()}>
                    <Upload size={15} />
                    选择
                  </button>
                </div>
                {form.appearance?.backgroundSrc ? <img className="appearance-preview background-preview" src={form.appearance.backgroundSrc} alt="" /> : null}
              </div>
              <div className="appearance-field">
                <span>移动端背景</span>
                <div className="appearance-source-row">
                  <input
                    value={form.appearance?.mobileBackgroundSrc ?? ""}
                    onChange={(event) => updateAppearance({ mobileBackgroundSrc: event.target.value })}
                    placeholder="/assets/background_mobile.png"
                  />
                  <button className="small-button" type="button" onClick={() => mobileBackgroundInputRef.current?.click()}>
                    <Upload size={15} />
                    选择
                  </button>
                </div>
                {form.appearance?.mobileBackgroundSrc ? <img className="appearance-preview background-preview" src={form.appearance.mobileBackgroundSrc} alt="" /> : null}
              </div>
            </div>
          </div>
          <div className={`settings-group ${activeSettingsSection === "prompt" ? "active" : "settings-section-hidden"}`} id="settings-prompt">
            <div className="settings-group-title">
              <div className="settings-group-icon">📝</div>
              <div>
                <h3>系统提示词</h3>
                <span>System Prompt</span>
              </div>
            </div>
            <div className="settings-group-content">
              <label>
                System Prompt
                <textarea
                  value={form.systemPrompt ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                  rows={5}
                  placeholder="Saki 的人格、约束和默认工作方式"
                />
              </label>
            </div>
          </div>
            <div className="settings-wiki-footer">
              <div className="settings-paths">
                <span>Panel: {form.configPath || "-"}</span>
              </div>
              <div className="settings-actions wide-field">
            <button className="primary-button settings-save" disabled={saving || loading} type="submit">
              <Save size={17} />
              {saving ? "保存中" : "保存设置"}
            </button>
            <button
              className="ghost-button"
              disabled={detectingModels || loading}
              type="button"
              onClick={() => void detectModels(false)}
            >
              <RefreshCw size={17} />
              {detectingModels ? "检测中" : "检测模型 API"}
            </button>
              </div>
            </div>
          </form>
          ) : (
          <div className="settings-skills-page saki-skill-settings-panel">
        <div className="section-heading saki-skill-heading">
          <div className="saki-skill-title">
            <div>
              <h2>Saki Skills</h2>
              <span>{skillList.length} installed</span>
            </div>
          </div>
          <div className="saki-skill-header-actions">
            <button className="ghost-button" type="button" onClick={() => setSkillCreatorOpen((current) => !current)}>
              {skillCreatorOpen ? <X size={17} /> : <Plus size={17} />}
              {skillCreatorOpen ? "收起添加" : "添加 Skill"}
            </button>
          </div>
        </div>

        {skillCreatorOpen ? (
          <div className="saki-skill-creator-section">
            <form className="saki-skill-editor saki-skill-editor-panel" onSubmit={(event) => void createSkill(event)}>
              <div className="saki-skill-editor-heading">
                <div>
                  <strong>添加 Skill</strong>
                  <span>Local SKILL.md</span>
                </div>
                <button type="button" className="icon-button" onClick={() => setSkillCreatorOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="saki-skill-form-grid">
                <label className="saki-skill-form-field">
                  <span className="saki-skill-form-label">Skill name</span>
                  <input
                    value={skillDraft.name}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="my-framework-helper"
                  />
                </label>
                <label className="saki-skill-form-field">
                  <span className="saki-skill-form-label">Tags</span>
                  <input
                    value={skillDraft.tags}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="python, plugin, review"
                  />
                </label>
                <label className="saki-skill-form-field saki-skill-form-wide">
                  <span className="saki-skill-form-label">Description</span>
                  <input
                    value={skillDraft.description}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="When this Skill should be used"
                  />
                </label>
                <label className="saki-skill-form-field saki-skill-form-wide">
                  <span className="saki-skill-form-label">SKILL.md</span>
                  <textarea
                    value={skillDraft.content}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, content: event.target.value }))}
                    rows={8}
                    placeholder="# Skill instructions"
                  />
                </label>
                <label className="saki-skill-form-field saki-skill-form-checkbox">
                  <input
                    type="checkbox"
                    checked={skillDraft.enabled}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  <span>Enabled</span>
                </label>
              </div>
              <div className="saki-skill-form-actions">
                <button className="primary-button" disabled={skillBusy === "create"} type="submit">
                  <Plus size={17} />
                  {skillBusy === "create" ? "Saving" : "Add Skill"}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        <div className="saki-skill-workspace">
          <div className="saki-skill-sidebar">
            <div className="saki-skill-sidebar-header">
              <div className="saki-skill-search">
                <Search size={15} />
                <input
                  type="text"
                  value={skillSearchQuery}
                  onChange={(event) => setSkillSearchQuery(event.target.value)}
                  placeholder="Search skills..."
                />
              </div>
              <div className="saki-skill-filter">
                {[
                  { value: "all", label: "All" },
                  { value: "enabled", label: "Enabled" },
                  { value: "disabled", label: "Disabled" }
                ].map((option) => (
                  <button
                    key={option.value}
                    className={skillFilter === option.value ? "active" : ""}
                    type="button"
                    onClick={() => setSkillFilter(option.value as typeof skillFilter)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <form className="saki-skill-download" onSubmit={(event) => void downloadSkill(event)}>
              <div className="saki-skill-download-header">
                <DownloadCloud size={15} />
                <span>Install from URL</span>
              </div>
              <input
                value={skillDownloadUrl}
                onChange={(event) => setSkillDownloadUrl(event.target.value)}
                placeholder="https://github.com/org/repo/SKILL.md"
              />
              <button className="ghost-button" disabled={skillBusy === "download"} type="submit">
                <Download size={15} />
                {skillBusy === "download" ? "Downloading" : "Install"}
              </button>
            </form>

            <div className="saki-skill-list">
              {skillList
                .filter((skill) => {
                  const matchesSearch = skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                    skill.description?.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                    skill.tags?.some((tag) => tag.toLowerCase().includes(skillSearchQuery.toLowerCase()));
                  const matchesFilter = skillFilter === "all" ||
                    (skillFilter === "enabled" && skill.enabled) ||
                    (skillFilter === "disabled" && skill.enabled === false);
                  return matchesSearch && matchesFilter;
                })
                .map((skill) => {
                  const skillCardClassName = [
                    "saki-skill-card",
                    skill.enabled === false ? "disabled" : "",
                    selectedSkillId === skill.id ? "active" : ""
                  ].filter(Boolean).join(" ");
                  return (
                    <article className={skillCardClassName} key={skill.id}>
                      <button className="saki-skill-card-main" type="button" onClick={() => void selectSkill(skill)}>
                        <div className="saki-skill-card-status">
                          <span className={skill.enabled ? "status-active" : "status-inactive"}></span>
                        </div>
                        <div className="saki-skill-card-content">
                          <div className="saki-skill-card-header">
                            <strong>{skill.name}</strong>
                            {skill.builtin && <span className="saki-skill-builtin">Built-in</span>}
                          </div>
                          {skill.description ? <p>{skill.description}</p> : null}
                          {skill.tags?.length ? (
                            <div className="saki-skill-card-tags">
                              {skill.tags.slice(0, 4).map((tag) => (
                                <span key={`${skill.id}-${tag}`}>{tag}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="saki-skill-card-source">
                          <span>{skill.sourceType ?? "local"}</span>
                        </div>
                      </button>
                      <div className="saki-skill-card-actions">
                        <button
                          className={`icon-button ${skill.enabled ? "action-disable" : "action-enable"}`}
                          disabled={skillBusy === skill.id}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void toggleSkillEnabled(skill); }}
                          title={skill.enabled ? "Disable" : "Enable"}
                        >
                          {skill.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        {skill.builtin ? null : (
                          <button
                            className="icon-button action-delete"
                            disabled={skillBusy === skill.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void deleteSkill(skill); }}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
            </div>
          </div>

          <div className="saki-skill-detail">
            {skillDetailLoading ? (
              <div className="saki-skill-loading">
                <Loader2 size={28} className="spin" />
                <span>Loading Skill...</span>
              </div>
            ) : selectedSkill ? (
              <form className="saki-skill-detail-panel" onSubmit={(event) => void saveSelectedSkill(event)}>
                <div className="saki-skill-detail-header">
                  <div className="saki-skill-detail-title">
                    <h3>{selectedSkill.name}</h3>
                    <span className="saki-skill-detail-id">{selectedSkill.id}</span>
                  </div>
                  <div className="saki-skill-detail-meta">
                    <span className="saki-skill-detail-source">{selectedSkill.sourceType ?? "local"}</span>
                    {selectedSkill.builtin && <span className="saki-skill-detail-builtin">Built-in</span>}
                  </div>
                </div>

                <div className="saki-skill-detail-body">
                  <div className="saki-skill-detail-row">
                    <label className="saki-skill-detail-field">
                      <span className="saki-skill-detail-label">Skill name</span>
                      <input
                        value={skillEditDraft.name}
                        onChange={(event) => setSkillEditDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="my-framework-helper"
                      />
                    </label>
                    <label className="saki-skill-detail-field">
                      <span className="saki-skill-detail-label">Tags</span>
                      <input
                        value={skillEditDraft.tags}
                        onChange={(event) => setSkillEditDraft((current) => ({ ...current, tags: event.target.value }))}
                        placeholder="python, plugin, review"
                      />
                    </label>
                  </div>

                  <label className="saki-skill-detail-field saki-skill-detail-wide">
                    <span className="saki-skill-detail-label">Description</span>
                    <input
                      value={skillEditDraft.description}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, description: event.target.value }))}
                      placeholder="When this Skill should be used"
                    />
                  </label>

                  <label className="saki-skill-detail-field saki-skill-detail-wide saki-skill-detail-textarea">
                    <span className="saki-skill-detail-label">SKILL.md</span>
                    <textarea
                      value={skillEditDraft.content}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, content: event.target.value }))}
                      rows={12}
                      placeholder="# Skill instructions"
                    />
                  </label>

                  <label className="saki-skill-detail-field saki-skill-detail-checkbox">
                    <input
                      type="checkbox"
                      checked={skillEditDraft.enabled}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <span>Enabled</span>
                  </label>
                </div>

                <div className="saki-skill-detail-footer">
                  <div className="saki-skill-detail-info">
                    {selectedSkill.path && <span>Path: {selectedSkill.path}</span>}
                    {selectedSkill.sourceUrl && <span>Source: {selectedSkill.sourceUrl}</span>}
                  </div>
                  <div className="saki-skill-detail-actions">
                    <button className="primary-button" disabled={skillBusy === selectedSkill.id} type="submit">
                      <Save size={17} />
                      {skillBusy === selectedSkill.id ? "Saving" : "Save Skill"}
                    </button>
                    <button
                      className="ghost-button"
                      disabled={skillBusy === selectedSkill.id}
                      type="button"
                      onClick={() => void toggleSkillEnabled(selectedSkill)}
                    >
                      {selectedSkill.enabled === false ? "Enable" : "Disable"}
                    </button>
                    {selectedSkill.builtin ? null : (
                      <button
                        className="ghost-button danger-action"
                        disabled={skillBusy === selectedSkill.id}
                        type="button"
                        onClick={() => void deleteSkill(selectedSkill)}
                      >
                        <Trash2 size={16} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </form>
            ) : (
              <div className="saki-skill-detail-empty">
                <Layers size={48} />
                <h3>Select a Skill</h3>
                <p>Choose a skill from the list to view and edit its details</p>
              </div>
            )}
          </div>
        </div>
      </div>
          )}
          </div>
        </div>
      </section>
    </>
  );
}

function UserAccountModal({
  token,
  user,
  open,
  onClose,
  onLogout,
  onUserChange
}: {
  token: string;
  user: CurrentUser;
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  onUserChange: (user: CurrentUser) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(user.avatarDataUrl ?? null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    setDisplayName(user.displayName);
    setAvatarDataUrl(user.avatarDataUrl ?? null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setNotice("");
  }, [open, user.avatarDataUrl, user.displayName]);

  if (!open) return null;

  async function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.item(0);
    event.target.value = "";
    if (!file) return;

    setError("");
    setNotice("");
    try {
      setAvatarDataUrl(await avatarFileToDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "头像读取失败");
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      setError("显示名不能为空");
      return;
    }
    if (newPassword || currentPassword || confirmPassword) {
      if (newPassword.length < 8) {
        setError("新密码至少 8 位");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("两次密码不一致");
        return;
      }
      if (!currentPassword) {
        setError("请输入当前密码");
        return;
      }
    }

    const payload: UpdateCurrentUserRequest = {};
    if (trimmedDisplayName !== user.displayName) {
      payload.displayName = trimmedDisplayName;
    }
    if ((avatarDataUrl ?? null) !== (user.avatarDataUrl ?? null)) {
      payload.avatarDataUrl = avatarDataUrl;
    }
    if (newPassword) {
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    }

    if (Object.keys(payload).length === 0) {
      setNotice("已同步");
      setError("");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextUser = await api.updateProfile(token, payload);
      onUserChange(nextUser);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("已保存");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "当前密码不正确" : err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="account-modal" role="dialog" aria-modal="true" aria-label="账户">
        <div className="account-modal-hero">
          <button
            className="account-avatar-button"
            type="button"
            title="上传头像"
            onClick={() => fileInputRef.current?.click()}
          >
            <AccountAvatar
              avatarDataUrl={avatarDataUrl}
              displayName={displayName}
              username={user.username}
              className="large"
            />
            <span className="account-avatar-action">
              <Camera size={15} />
            </span>
          </button>
          <div className="account-modal-title">
            <h2>{displayName.trim() || user.username}</h2>
            <span>@{user.username}</span>
          </div>
          <div className="account-modal-tools">
            <span className="account-rank">{user.isSuperAdmin ? "SUPER" : "ACTIVE"}</span>
            <button className="icon-button mini" title="关闭" type="button" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        <form className="account-modal-body" onSubmit={(event) => void saveProfile(event)}>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAvatar(event)}
          />

          <div className="account-avatar-stage">
            <AccountAvatar
              avatarDataUrl={avatarDataUrl}
              displayName={displayName}
              username={user.username}
              className="preview"
            />
            <div className="account-upload-actions">
              <button className="small-button" type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload size={15} />
                上传头像
              </button>
              <button className="small-button" type="button" onClick={() => setAvatarDataUrl(null)}>
                移除
              </button>
            </div>
          </div>

          <div className="account-form-stack">
            <label className="account-field">
              显示名
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>

            <div className="account-password-grid">
              <label className="account-field wide">
                当前密码
                <input
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <label className="account-field">
                新密码
                <input
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                />
              </label>
              <label className="account-field">
                确认密码
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                />
              </label>
            </div>

            {error ? <div className="form-error account-feedback">{error}</div> : null}
            {notice ? <div className="page-notice account-feedback">{notice}</div> : null}

            <div className="account-modal-actions">
              <button className="ghost-button account-logout-button" type="button" onClick={onLogout}>
                <LogOut size={16} />
                退出登录
              </button>
              <button className="primary-button account-save-button" disabled={saving} type="submit">
                <Save size={16} />
                {saving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Workspace({
  token,
  user,
  appearance,
  onLogout,
  onSwitchUser,
  onUserChange,
  onAppearanceChange
}: {
  token: string;
  user: CurrentUser;
  appearance: PanelAppearanceSettings;
  onLogout: () => void;
  onSwitchUser: (token: string, user: CurrentUser) => void;
  onUserChange: (user: CurrentUser) => void;
  onAppearanceChange: (appearance: PanelAppearanceSettings) => void;
}) {
  const [activeView, setActiveView] = useState<ViewMode>("dashboard");
  const [refreshTick, setRefreshTick] = useState(0);
  const [sakiInstance, setSakiInstance] = useState<ManagedInstance | null>(null);
  const [sakiSeed, setSakiSeed] = useState<SakiPromptSeed | null>(null);
  const [sakiFileDragActive, setSakiFileDragActive] = useState(false);
  const [sakiFileDropRequest, setSakiFileDropRequest] = useState<SakiInstanceFileDropRequest | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const floatingSidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const shouldFocusFloatingSidebarToggleRef = useRef(false);
  const canUseSakiChat = user.permissions.includes("saki.chat");
  const canUseSakiAgent = user.permissions.includes("saki.agent");
  const canUseSaki = canUseSakiChat || canUseSakiAgent;
  const canUseSakiSkills = user.permissions.includes("saki.skills");
  const canConfigureSaki = user.permissions.includes("saki.configure");
  const canOpenDashboard = user.permissions.includes("dashboard.view");
  const canOpenInstances = user.permissions.includes("instance.view");
  const canViewNodes = user.permissions.includes("node.view");
  const canTestNodes = user.permissions.includes("node.test");
  const hasAssignedRole = user.roleNames.length > 0;
  const canOpenNodes = hasAssignedRole && user.isAdmin && canViewNodes;
  const canOpenTemplates = user.permissions.includes("template.view");
  const canOpenUsers = user.permissions.includes("user.view") || (user.isAdmin && user.permissions.includes("instance.update"));
  const canOpenAudit = hasAssignedRole && user.isAdmin && user.permissions.includes("audit.view");
  const canOpenAbout = true;
  const availableViews = useMemo<ViewMode[]>(() => {
    const views: ViewMode[] = [];
    if (canOpenDashboard) views.push("dashboard");
    if (canOpenInstances) views.push("instances");
    if (canOpenNodes) views.push("nodes");
    if (canOpenTemplates) views.push("templates");
    if (canOpenUsers) views.push("users");
    if (canOpenAudit) views.push("audit");
    if (canConfigureSaki) views.push("settings");
    if (canOpenAbout) views.push("about");
    return views;
  }, [
    canConfigureSaki,
    canOpenAbout,
    canOpenAudit,
    canOpenDashboard,
    canOpenInstances,
    canOpenNodes,
    canOpenTemplates,
    canOpenUsers
  ]);
  const hasAnyAccessibleView = availableViews.length > 0;
  const effectiveView = availableViews.includes(activeView) ? activeView : availableViews[0] ?? activeView;
  const panelContext = useMemo<SakiPanelContext>(() => {
    if (effectiveView === "audit") {
      return { label: "审计日志", detail: "可检索全部记录", auditSearch: true };
    }
    if (effectiveView === "instances") {
      return { label: "实例管理", detail: "选择实例后切换工作区" };
    }
    if (effectiveView === "nodes") return { label: "节点管理", detail: "节点连接与状态" };
    if (effectiveView === "templates") return { label: "模板", detail: "实例模板上下文" };
    if (effectiveView === "users") return { label: "用户权限", detail: "用户与角色上下文" };
    if (effectiveView === "settings") return { label: "Saki 设置", detail: "运行时模型配置" };
    return { label: "控制台", detail: "全局上下文" };
  }, [effectiveView]);

  const openSaki = useCallback((seed: Omit<SakiPromptSeed, "nonce">) => {
    if (!canUseSaki) return;
    if (seed.clearInstance) {
      setSakiInstance(null);
    }
    setSakiSeed({
      ...seed,
      mode: coerceSakiMode(seed.mode, canUseSakiChat, canUseSakiAgent),
      nonce: Date.now()
    });
  }, [canUseSaki, canUseSakiAgent, canUseSakiChat]);

  const attachInstanceFileToSaki = useCallback(
    (payload: SakiInstanceFileDragPayload) => {
      if (!canUseSaki) return;
      setSakiFileDragActive(false);
      setSakiFileDropRequest({
        ...payload,
        nonce: Date.now()
      });
    },
    [canUseSaki]
  );

  useEffect(() => {
    if (activeView !== "instances") {
      setSakiInstance(null);
      setSakiFileDragActive(false);
    }
  }, [activeView]);

  useEffect(() => {
    function clearSakiFileDrag() {
      setSakiFileDragActive(false);
    }
    window.addEventListener("dragend", clearSakiFileDrag);
    window.addEventListener("drop", clearSakiFileDrag);
    return () => {
      window.removeEventListener("dragend", clearSakiFileDrag);
      window.removeEventListener("drop", clearSakiFileDrag);
    };
  }, []);

  const hideSidebar = useCallback(() => {
    const activeElement = document.activeElement;
    if (sidebarRef.current && activeElement instanceof HTMLElement && sidebarRef.current.contains(activeElement)) {
      activeElement.blur();
      shouldFocusFloatingSidebarToggleRef.current = true;
    }
    setSidebarHidden(true);
  }, []);

  useEffect(() => {
    if (!sidebarHidden) {
      shouldFocusFloatingSidebarToggleRef.current = false;
      return;
    }
    if (!shouldFocusFloatingSidebarToggleRef.current) return;
    shouldFocusFloatingSidebarToggleRef.current = false;
    window.requestAnimationFrame(() => {
      floatingSidebarToggleRef.current?.focus({ preventScroll: true });
    });
  }, [sidebarHidden]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const syncSidebar = () => setSidebarHidden(media.matches);
    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const sidebar = document.getElementById("workspace-sidebar");
      const floatingToggle = document.querySelector(".sidebar-floating-toggle");
      if (
        sidebar &&
        floatingToggle &&
        !sidebar.contains(e.target as Node) &&
        !floatingToggle.contains(e.target as Node) &&
        !sidebarHidden &&
        window.matchMedia("(max-width: 760px)").matches
      ) {
        hideSidebar();
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [sidebarHidden, hideSidebar]);

  useEffect(() => {
    if (hasAnyAccessibleView && !availableViews.includes(activeView)) {
      const nextView = availableViews[0];
      if (nextView) setActiveView(nextView);
    }
  }, [activeView, availableViews, hasAnyAccessibleView]);

  const selectView = useCallback((view: ViewMode) => {
    if (!availableViews.includes(view)) return;
    setActiveView(view);
    if (window.matchMedia("(max-width: 760px)").matches) {
      hideSidebar();
    }
  }, [availableViews, hideSidebar]);

  return (
    <>
      <div className={`app-shell ${sidebarHidden ? "sidebar-hidden" : ""}`}>
        <aside id="workspace-sidebar" ref={sidebarRef} className="sidebar glass-sidebar" inert={sidebarHidden || undefined}>
          <div className="sidebar-brand">
            <div className="sidebar-logo">
              <img className="app-logo-img sidebar-app-logo" src={appearance.appLogoSrc} alt="" draggable={false} />
              <span>{appearance.appTitle}</span>
            </div>
            <button
              className="sidebar-inline-toggle"
              type="button"
              aria-label="折叠侧边栏"
              aria-controls="workspace-sidebar"
              aria-expanded={!sidebarHidden}
              title="折叠侧边栏"
              onClick={() => {
                hideSidebar();
              }}
            >
              <PanelLeftClose size={18} aria-hidden="true" />
            </button>
          </div>
          {hasAnyAccessibleView ? (
            <nav>
              {canOpenDashboard ? (
                <button className={`nav-item-dashboard ${effectiveView === "dashboard" ? "active" : ""}`} onClick={() => selectView("dashboard")}>
                  <Activity size={18} />
                  概览
                </button>
              ) : null}
              {canOpenInstances ? (
                <button className={`nav-item-instances ${effectiveView === "instances" ? "active" : ""}`} onClick={() => selectView("instances")}>
                  <TerminalIcon size={18} />
                  实例
                </button>
              ) : null}
              {canOpenNodes ? (
                <button className={`nav-item-nodes ${effectiveView === "nodes" ? "active" : ""}`} onClick={() => selectView("nodes")}>
                  <Server size={18} />
                  节点
                </button>
              ) : null}
              {canOpenTemplates ? (
                <button className={`nav-item-templates ${effectiveView === "templates" ? "active" : ""}`} onClick={() => selectView("templates")}>
                  <LayoutTemplate size={18} />
                  模板
                </button>
              ) : null}
              {canOpenUsers ? (
                <button className={`nav-item-users ${effectiveView === "users" ? "active" : ""}`} onClick={() => selectView("users")}>
                  <UserCog size={18} />
                  用户
                </button>
              ) : null}
              {canOpenAudit ? (
                <button className={`nav-item-audit ${effectiveView === "audit" ? "active" : ""}`} onClick={() => selectView("audit")}>
                  <ClipboardList size={18} />
                  审计
                </button>
              ) : null}
              {canConfigureSaki ? (
                <button className={`nav-item-settings ${effectiveView === "settings" ? "active" : ""}`} onClick={() => selectView("settings")}>
                  <Settings size={18} />
                  设置
                </button>
              ) : null}
              {canOpenAbout ? (
                <button className={`nav-item-about ${effectiveView === "about" ? "active" : ""}`} onClick={() => selectView("about")}>
                  <Info size={18} />
                  关于
                </button>
              ) : null}
            </nav>
          ) : (
            <div className="sidebar-empty">
              <Shield size={18} />
              <span>等待分配权限</span>
            </div>
          )}

          <div className="sidebar-account">
            <button className="sidebar-account-button" type="button" onClick={() => setAccountOpen(true)}>
              <AccountAvatar avatarDataUrl={user.avatarDataUrl} displayName={user.displayName} username={user.username} />
              <span className="sidebar-account-copy">
                <strong>{user.displayName}</strong>
                <small>@{user.username}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>

        <button
          ref={floatingSidebarToggleRef}
          className="sidebar-floating-toggle"
          type="button"
          aria-label="展开侧边栏"
          aria-controls="workspace-sidebar"
          aria-expanded={!sidebarHidden}
          inert={!sidebarHidden || undefined}
          tabIndex={sidebarHidden ? 0 : -1}
          title="展开侧边栏"
          onClick={(e) => {
            e.currentTarget.blur();
            setSidebarHidden(false);
          }}
        >
          <PanelLeftOpen size={20} aria-hidden="true" />
        </button>

        <main className="workspace view-transition-enter" key={hasAnyAccessibleView ? effectiveView : "access-empty"}>
          <header className="topbar">
            <div className="topbar-inner">
              <div className="topbar-title">
                <span className="topbar-context">控制台面板</span>
                <ChevronRight size={14} className="topbar-separator" />
                <h1>
                  {!hasAnyAccessibleView
                    ? "权限待分配"
                    : effectiveView === "dashboard"
                      ? "概览"
                      : effectiveView === "instances"
                        ? "实例管理"
                        : effectiveView === "nodes"
                          ? "节点管理"
                          : effectiveView === "templates"
                            ? "模板"
                            : effectiveView === "settings"
                              ? "Saki 设置"
                              : effectiveView === "users"
                                ? "用户与权限"
                                : effectiveView === "about"
                                  ? "关于"
                                  : "审计日志"}
                </h1>
              </div>
              <div className="topbar-actions">
                {hasAnyAccessibleView ? (
                  <button className="icon-button mini" onClick={() => setRefreshTick((value) => value + 1)} title="刷新">
                    <RefreshCw size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          {!hasAnyAccessibleView ? (
            <AccessEmptyView user={user} onOpenAccount={() => setAccountOpen(true)} />
          ) : effectiveView === "dashboard" ? (
            <DashboardView
              token={token}
              onLogout={onLogout}
              refreshTick={refreshTick}
              canViewNodes={canViewNodes}
              canTestNodes={canTestNodes}
            />
          ) : effectiveView === "instances" ? (
            <InstancesView
              token={token}
              onLogout={onLogout}
              refreshTick={refreshTick}
              onOpenTemplates={() => selectView("templates")}
              onInstanceFocus={setSakiInstance}
              onAskSaki={canUseSaki ? openSaki : undefined}
              onSakiFileDragChange={setSakiFileDragActive}
              onSakiInstanceFileDrop={canUseSaki ? attachInstanceFileToSaki : undefined}
            />
          ) : effectiveView === "nodes" ? (
            <NodesView token={token} onLogout={onLogout} refreshTick={refreshTick} />
          ) : effectiveView === "templates" ? (
            <TemplatesView token={token} onLogout={onLogout} refreshTick={refreshTick} />
          ) : effectiveView === "users" ? (
            <UsersView token={token} currentUser={user} onLogout={onLogout} onSwitchUser={onSwitchUser} refreshTick={refreshTick} />
          ) : effectiveView === "settings" ? (
            <SettingsView
              token={token}
              onLogout={onLogout}
              onSessionRefresh={onSwitchUser}
              refreshTick={refreshTick}
              onAppearanceChange={onAppearanceChange}
            />
          ) : effectiveView === "about" ? (
            <AboutView />
          ) : (
            <AuditView
              token={token}
              onLogout={onLogout}
              refreshTick={refreshTick}
              onAskSaki={canUseSaki ? openSaki : undefined}
              canDeleteLogs={user.isSuperAdmin}
            />
          )}
        </main>
      </div>
      <UserAccountModal
        token={token}
        user={user}
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onLogout={onLogout}
        onUserChange={onUserChange}
      />
      {canUseSaki ? (
        <SakiFloatingChat
          token={token}
          instance={sakiInstance}
          seed={sakiSeed}
          panelContext={panelContext}
          fileDragActive={sakiFileDragActive}
          instanceFileDropRequest={sakiFileDropRequest}
          canUseChat={canUseSakiChat}
          canUseAgent={canUseSakiAgent}
          canUseSkills={canUseSakiSkills}
        />
      ) : null}
    </>
  );
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(Boolean(token));
  const [appearance, setAppearance] = useState<PanelAppearanceSettings>(defaultPanelAppearance);

  const updateAppearanceState = useCallback((nextAppearance: PanelAppearanceSettings) => {
    setAppearance(normalizePanelAppearance(nextAppearance));
  }, []);

  const logout = useCallback(() => {
    const currentToken = localStorage.getItem(tokenKey);
    if (currentToken) {
      void api.logout(currentToken).catch(() => undefined);
    }
    localStorage.removeItem(tokenKey);
    setToken(null);
    setUser(null);
  }, []);

  const switchSession = useCallback((nextToken: string, nextUser: CurrentUser) => {
    localStorage.setItem(tokenKey, nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  useEffect(() => {
    api
      .sakiAppearance()
      .then(updateAppearanceState)
      .catch(() => undefined);
  }, [updateAppearanceState]);

  useEffect(() => {
    applyPanelAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!token) return;
    api
      .me(token)
      .then(setUser)
      .catch(logout)
      .finally(() => setBooting(false));
  }, [logout, token]);

  useEffect(() => {
    if (!token) return;
    const expiresAt = tokenExpiresAt(token);
    if (!expiresAt) return;

    let timer: number | undefined;
    const scheduleLogout = () => {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        logout();
        return;
      }
      timer = window.setTimeout(scheduleLogout, Math.min(remainingMs, 60000));
    };

    scheduleLogout();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [logout, token]);

  if (booting) {
    return (
      <main className="login-shell">
        <div className="loading-panel">
          <RefreshCw size={22} />
          载入中
        </div>
      </main>
    );
  }

  if (!token || !user) {
    return (
      <LoginView
        appearance={appearance}
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setUser(nextUser);
        }}
      />
    );
  }

  return (
    <Workspace
      token={token}
      user={user}
      appearance={appearance}
      onLogout={logout}
      onSwitchUser={switchSession}
      onUserChange={setUser}
      onAppearanceChange={updateAppearanceState}
    />
  );
}
