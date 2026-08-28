import type {
  ManagedInstance,
  SakiAgentAction,
  SakiAgentPermissionMode,
  SakiChatMessage,
  SakiChatMode,
  SakiInputAttachment
} from "@webops/shared";
import type {
  BrowserSpeechRecognitionConstructor,
  LocalSakiMessage,
  SakiInstanceFileDragPayload,
  SakiSelectionCapture
} from "../../types/app.js";
import { formatBytes, imageMimeTypeFromPath, compactContextText } from "../../utils/path.js";
import { newClientId } from "../../utils/id.js";
import { sakiAttachmentHistoryText } from "./SakiComponents.js";

export function createSakiWelcomeMessage(content: string): LocalSakiMessage {
  return {
    id: "saki-welcome",
    role: "assistant",
    content,
    createdAt: new Date().toISOString()
  };
}

export function formatSakiContextPath(pathStr: string, maxLength: number = 24): string {
  if (!pathStr) return "";
  const trimmed = pathStr.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const isWindows = trimmed.includes("\\");
  const sep = isWindows ? "\\" : "/";
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    const twoSegments = `…${sep}${prev}${sep}${last}`;
    if (twoSegments.length <= maxLength) return twoSegments;
    const oneSegment = `…${sep}${last}`;
    if (oneSegment.length <= maxLength) return oneSegment;
    return `${oneSegment.slice(0, maxLength - 1)}…`;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function getSakiWelcomeMessageText(instance: ManagedInstance | null | undefined, contextLabel: string): string {
  if (instance) {
    return `跟过来啦，我们现在在「${instance.name}」这边～ 是遇到什么报错要翻日志，还是想改点配置或者写脚本？你说，我来弄。`;
  }
  if (contextLabel === "控制台" || contextLabel === "概览") {
    return `在呢！今天各服务目前看着都挺平稳的。是遇到什么棘手报错要排查，还是想让我帮写点脚本跑跑看？随时叫我，我一直都在。`;
  }
  return `在呢，我帮你盯着「${contextLabel}」这边呢。遇到什么小状况，或者想查什么、改什么，尽管丢给我，咱们一起看。`;
}

export function isSakiModeAllowed(mode: SakiChatMode, canUseChat: boolean, canUseAgent: boolean): boolean {
  return mode === "agent" ? canUseAgent : canUseChat;
}

export function coerceSakiMode(mode: SakiChatMode | undefined, canUseChat: boolean, canUseAgent: boolean): SakiChatMode {
  if (mode && isSakiModeAllowed(mode, canUseChat, canUseAgent)) return mode;
  return canUseChat ? "chat" : "agent";
}

export const defaultSakiAgentPermissionMode: SakiAgentPermissionMode = "acceptEdits";

export function sakiPermissionModeLabel(mode: SakiAgentPermissionMode): string {
  if (mode === "ask") return "询问";
  if (mode === "plan") return "计划";
  if (mode === "bypassPermissions") return "免确认";
  return "自动改文件";
}

export function sakiPermissionModeTitle(mode: SakiAgentPermissionMode): string {
  if (mode === "ask") return "编辑、命令和状态变更都先确认";
  if (mode === "plan") return "只读探索并输出计划，不写文件";
  if (mode === "bypassPermissions") return "在账号权限和安全策略内尽量不打断执行";
  return "文件编辑自动执行，命令和高风险操作先确认";
}

export function formatSakiActionArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "()";
  return `(${entries
    .map(([key, value]) => `${key}: ${compactContextText(typeof value === "string" ? value.replace(/\s+/g, " ") : JSON.stringify(value) ?? String(value), 120)}`)
    .join(", ")})`;
}

export function sakiHistoryContent(message: LocalSakiMessage): string {
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

export function toSakiHistoryMessage(message: LocalSakiMessage): SakiChatMessage {
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

export const sakiMaxInputAttachments = 6;
export const sakiTextAttachmentLimit = 18000;
export const sakiImageMaxDimension = 1280;
export const sakiImageQuality = 0.82;
export const sakiInstanceFileDragMime = "application/x-webops-instance-file";
export const sakiSelectionContextLimit = 12000;

export let latestSakiTerminalSelectionText = "";

export function normalizeSakiSelectionText(value: string): string {
  if (!value) return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function countSelectionCharacters(text: string): number {
  if (!text) return 0;
  return Array.from(text).length;
}

export function rememberSakiTerminalSelection(value: string): void {
  latestSakiTerminalSelectionText = normalizeSakiSelectionText(value);
}

export function clearRememberedSakiTerminalSelection(): void {
  latestSakiTerminalSelectionText = "";
}

export function targetIsInsideSelector(target: EventTarget | null, selector: string): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest(selector));
}

export function readEditableSelectionText(target: EventTarget | null): string {
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

export function readBrowserSelectionText(target: EventTarget | null): string {
  const editableSelection = readEditableSelectionText(target);
  if (editableSelection) return editableSelection;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return "";
  return normalizeSakiSelectionText(selection.toString());
}

export function readSakiSelectionCapture(target: EventTarget | null): SakiSelectionCapture | null {
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

export const sakiTextAttachmentExtensions = new Set([
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

export function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  const win = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function hasSakiInstanceFileDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(sakiInstanceFileDragMime);
}

export function parseSakiInstanceFileDragPayload(dataTransfer: DataTransfer): SakiInstanceFileDragPayload | null {
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

export function sakiMimeTypeFromPath(pathname: string): string {
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

export function isLikelyTextAttachment(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith("text/")) return true;
  if (/json|xml|yaml|javascript|typescript|ecmascript|csv|markdown|sql|toml|shell|x-sh/.test(mimeType)) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return sakiTextAttachmentExtensions.has(extension);
}

export async function readSakiTextAttachment(file: File): Promise<string> {
  const chunk = file.slice(0, Math.min(file.size, sakiTextAttachmentLimit * 4), file.type || "text/plain");
  const text = await chunk.text();
  const truncated = compactContextText(text, sakiTextAttachmentLimit);
  return file.size > chunk.size ? `${truncated}\n...(文件较大，仅附加前 ${formatBytes(chunk.size)})` : truncated;
}

export function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

export async function imageFileToSakiAttachment(
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

export async function fileToSakiAttachment(file: File, preferredKind: "image" | "file"): Promise<SakiInputAttachment> {
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

