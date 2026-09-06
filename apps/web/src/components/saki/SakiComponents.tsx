import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  BookMarked,
  BookOpen,
  Bot,
  Bug,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  Copy,
  CornerUpLeft,
  Cpu,
  Download,
  Edit3,
  Eye,
  FileArchive,
  FilePlus,
  FileSearch,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  HardDrive,
  History,
  Image as ImageIcon,
  Layers,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Move,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  TextQuote,
  Trash2,
  Upload,
  UserCheck,
  UserCog,
  Wifi,
  WifiOff,
  Wrench,
  X,
  XOctagon,
  Zap
} from "lucide-react";
import type { SakiAgentAction, SakiChatMessage, SakiInputAttachment } from "@webops/shared";
import type {
  LocalSakiMessage,
  LocalSakiTimelineItem,
  LocalSakiTimelineTextSource,
  LocalSakiWorkflowStep
} from "../../types/app.js";
import type { SakiChatStreamEvent, SakiChatWorkflowStatus } from "../../api.js";
import { sakiArtAssets } from "../../constants.js";
import { compactContextText, formatBytes } from "../../utils/path.js";
import { newClientId } from "../../utils/id.js";
import { MarkdownContent } from "../common/MarkdownContent.js";

export function sakiAttachmentKindLabel(kind: SakiInputAttachment["kind"]): string {
  if (kind === "screenshot") return "截图";
  if (kind === "image") return "图片";
  return "文件";
}

export function sakiAttachmentSummary(attachment: SakiInputAttachment): string {
  const pieces = [sakiAttachmentKindLabel(attachment.kind), attachment.mimeType || "unknown"];
  if (typeof attachment.size === "number") pieces.push(formatBytes(attachment.size));
  if (attachment.width && attachment.height) pieces.push(`${attachment.width}x${attachment.height}`);
  return pieces.join(" · ");
}

export function stripHeavySakiAttachmentData(attachment: SakiInputAttachment): SakiInputAttachment {
  const { dataUrl: _dataUrl, text: _text, ...rest } = attachment;
  return rest;
}

export function persistableSakiMessages(messages: LocalSakiMessage[]): LocalSakiMessage[] {
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

export function hasPersistableSakiSpeech(messages: LocalSakiMessage[]): boolean {
  return messages.some(
    (message) =>
      message.id !== "saki-welcome" &&
      (message.role === "user" ||
        message.content.trim().length > 0 ||
        Boolean(message.attachments?.length) ||
        Boolean(message.actions?.length) ||
        Boolean(message.timeline?.length) ||
        message.source === "local-fallback")
  );
}

export function sakiAttachmentHistoryText(attachments: SakiInputAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .map((attachment, index) => `${index + 1}. ${attachment.name} (${sakiAttachmentSummary(attachment)})`)
    .join("\n");
}

export type SakiArtMood = "normal" | "thinking" | "worry";
export type SakiActivityMood = "working" | "reading" | "checkfiles" | "upset" | "happy" | "OK" | "eating" | "gaming" | "hearing" | "speaking" | null;
export type SakiVoiceEchoState = "idle" | "hearing" | "speaking";
export type SakiLauncherEdge = "left" | "right";
export type SakiLauncherSizeMode = "current" | "expanded" | "attached";

export interface SakiLauncherPosition {
  x: number;
  y: number;
  edge?: SakiLauncherEdge | null;
}

export interface SakiPullDragRequest {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  clientX: number;
  clientY: number;
}

export const sakiLauncherPositionKey = "webops.saki.launcherPosition";
export const sakiLauncherEdgePadding = 12;
export const sakiLauncherEdgeSnapDistance = 56;
export const sakiLauncherExpandedSize = { width: 86, height: 118 };
export const sakiLauncherAttachedSize = { width: 58, height: 92 };
export const sakiConversationStorageKey = "webops.saki.conversations.v1";

export interface StoredSakiConversation {
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

export function readSakiConversations(): StoredSakiConversation[] {
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

export function writeSakiConversations(conversations: StoredSakiConversation[]) {
  try {
    globalThis.localStorage?.setItem(sakiConversationStorageKey, JSON.stringify(conversations.slice(0, 80)));
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function sakiConversationTitle(messages: LocalSakiMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const firstUserText = firstUser?.content?.trim();
  if (firstUserText) return compactContextText(firstUserText.replace(/\s+/g, " "), 38);
  if (firstUser?.attachments?.length) {
    const attachName = firstUser.attachments[0]?.name || "附件";
    return compactContextText(attachName.replace(/\s+/g, " "), 38);
  }
  const firstAssistant = messages.find((message) => message.role === "assistant" && message.content?.trim());
  if (firstAssistant) {
    return compactContextText(firstAssistant.content.trim().replace(/\s+/g, " "), 38);
  }
  return "新对话";
}

export function latestSakiConversationForContext(conversations: StoredSakiConversation[], contextKey: string): StoredSakiConversation | null {
  return conversations
    .filter((conversation) => conversation.contextKey === contextKey)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null;
}

export function isSakiLauncherPosition(value: unknown): value is SakiLauncherPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<SakiLauncherPosition>;
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

export function readSakiLauncherPosition(): SakiLauncherPosition | null {
  try {
    const raw = globalThis.localStorage?.getItem(sakiLauncherPositionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isSakiLauncherPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSakiLauncherPosition(position: SakiLauncherPosition) {
  try {
    globalThis.localStorage?.setItem(sakiLauncherPositionKey, JSON.stringify(position));
  } catch {
    // Drag position is a convenience, so storage failures can be ignored.
  }
}

export function sakiLauncherSize(element: HTMLElement | null, mode: SakiLauncherSizeMode = "current") {
  if (mode === "expanded") return sakiLauncherExpandedSize;
  if (mode === "attached") return sakiLauncherAttachedSize;
  const rect = element?.getBoundingClientRect();
  return {
    width: rect?.width || sakiLauncherExpandedSize.width,
    height: rect?.height || sakiLauncherExpandedSize.height
  };
}

export function clampSakiLauncherPosition(
  position: SakiLauncherPosition,
  element: HTMLElement | null,
  mode: SakiLauncherSizeMode = "current"
): SakiLauncherPosition {
  const { width, height } = sakiLauncherSize(element, mode);
  const viewportWidth = globalThis.innerWidth || width + sakiLauncherEdgePadding * 2;
  const viewportHeight = globalThis.innerHeight || height + sakiLauncherEdgePadding * 2;
  const sidePadding = mode === "attached" ? 0 : sakiLauncherEdgePadding;
  const maxX = Math.max(sidePadding, viewportWidth - width - sidePadding);
  const maxY = Math.max(sakiLauncherEdgePadding, viewportHeight - height - sakiLauncherEdgePadding);

  return {
    x: Math.min(Math.max(sidePadding, position.x), maxX),
    y: Math.min(Math.max(sakiLauncherEdgePadding, position.y), maxY)
  };
}

export function sakiLauncherEdgeForPosition(position: SakiLauncherPosition): SakiLauncherEdge {
  const viewportWidth = globalThis.innerWidth || sakiLauncherExpandedSize.width + sakiLauncherEdgePadding * 2;
  return position.x + sakiLauncherExpandedSize.width / 2 < viewportWidth / 2 ? "left" : "right";
}

export function sakiLauncherSnapEdgeForPosition(position: SakiLauncherPosition): SakiLauncherEdge | null {
  const viewportWidth = globalThis.innerWidth || sakiLauncherExpandedSize.width + sakiLauncherEdgePadding * 2;
  const rightGap = viewportWidth - (position.x + sakiLauncherExpandedSize.width);
  if (position.x <= sakiLauncherEdgeSnapDistance) return "left";
  if (rightGap <= sakiLauncherEdgeSnapDistance) return "right";
  return null;
}

export function sakiLauncherAttachedEdgeForPosition(position: SakiLauncherPosition): SakiLauncherEdge | null {
  if (position.edge === "left" || position.edge === "right") return position.edge;

  const viewportWidth = globalThis.innerWidth || sakiLauncherAttachedSize.width + sakiLauncherEdgePadding * 2;
  const rightEdgeX = Math.max(0, viewportWidth - sakiLauncherAttachedSize.width);
  if (position.x <= 1) return "left";
  if (Math.abs(position.x - rightEdgeX) <= 1 || viewportWidth - (position.x + sakiLauncherAttachedSize.width) <= 1) return "right";
  return null;
}

export function snapSakiLauncherPositionToEdge(
  position: SakiLauncherPosition,
  edge: SakiLauncherEdge = sakiLauncherEdgeForPosition(position)
): SakiLauncherPosition {
  const viewportWidth = globalThis.innerWidth || sakiLauncherAttachedSize.width + sakiLauncherEdgePadding * 2;
  const viewportHeight = globalThis.innerHeight || sakiLauncherAttachedSize.height + sakiLauncherEdgePadding * 2;
  const maxY = Math.max(sakiLauncherEdgePadding, viewportHeight - sakiLauncherAttachedSize.height - sakiLauncherEdgePadding);
  return {
    x: edge === "left" ? 0 : Math.max(0, viewportWidth - sakiLauncherAttachedSize.width),
    y: Math.min(Math.max(sakiLauncherEdgePadding, position.y), maxY),
    edge
  };
}

export function sameSakiLauncherPosition(left: SakiLauncherPosition, right: SakiLauncherPosition) {
  return Math.round(left.x) === Math.round(right.x) && Math.round(left.y) === Math.round(right.y) && (left.edge ?? null) === (right.edge ?? null);
}

export function getSakiActivityExpressionSrc(activityMood: SakiActivityMood): string | null {
  if (!activityMood) return null;
  switch (activityMood) {
    case "working":
      return sakiArtAssets.working;
    case "reading":
      return sakiArtAssets.reading;
    case "checkfiles":
      return sakiArtAssets.checkfiles;
    case "upset":
      return sakiArtAssets.upset;
    case "happy":
      return sakiArtAssets.happy;
    case "OK":
      return sakiArtAssets.OK;
    case "eating":
      return sakiArtAssets.eating;
    case "gaming":
      return sakiArtAssets.gaming;
    case "hearing":
      return sakiArtAssets.listen;
    case "speaking":
      return sakiArtAssets.shy;
    default:
      return null;
  }
}

export function SakiCharacterArt({
  mood = "normal",
  compact = false,
  fileDrop = false,
  edgeAttached = false,
  dragging = false,
  draggingExpressionSrc = null,
  activityMood = null
}: {
  mood?: SakiArtMood;
  compact?: boolean;
  fileDrop?: boolean;
  edgeAttached?: boolean;
  dragging?: boolean;
  draggingExpressionSrc?: string | null;
  activityMood?: SakiActivityMood;
}) {
  const activityExpressionSrc = getSakiActivityExpressionSrc(activityMood);
  const expressionSrc = dragging && draggingExpressionSrc
    ? draggingExpressionSrc
    : activityExpressionSrc
    ? activityExpressionSrc
    : fileDrop
    ? sakiArtAssets.files
    : mood === "thinking"
    ? sakiArtAssets.thinking
    : mood === "worry"
    ? sakiArtAssets.worry
    : sakiArtAssets.files;

  if (compact) {
    if (dragging) {
      return (
        <div className="saki-character-art compact" aria-hidden="true">
          <img
            className="saki-character-image"
            src={expressionSrc}
            alt=""
            draggable={false}
          />
        </div>
      );
    }

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

    if (edgeAttached) {
      return (
        <div className="saki-character-art compact edge-attached" aria-hidden="true">
          <img
            className="saki-character-image saki-character-image-edge"
            src={sakiArtAssets.tieEdge}
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

export function SakiAttachmentChip({
  attachment,
  removable = false,
  onRemove,
  onClick
}: {
  attachment: SakiInputAttachment;
  removable?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
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
    <span
      className={`saki-attachment-chip ${onClick ? "is-clickable" : ""}`}
      title={`${attachment.name}\n${sakiAttachmentSummary(attachment)}${onClick ? "\n点击查看与编辑" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
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
        <button
          className="saki-attachment-remove-btn"
          type="button"
          title="移除附件"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
        >
          <X size={13} />
        </button>
      ) : null}
    </span>
  );
}

export function visibleSakiActivitySteps(steps: LocalSakiWorkflowStep[] | undefined, streaming: boolean): LocalSakiWorkflowStep[] {
  const items = steps ?? [];
  const visible = items.filter((step) => {
    if (step.stage === "narration") return true;
    if (step.status === "running" || step.status === "pending") return true;
    if (streaming && step.status === "completed" && step.stage === "tool") return true;
    if (step.status !== "failed") return false;
    const text = `${step.message} ${step.detail ?? ""}`.toLowerCase();
    return !/流式|连接中断|network error|stream/.test(text);
  });
  if (streaming) return visible.slice(-6);
  return visible.filter((step) => step.stage === "narration" || step.status === "pending" || step.status === "failed").slice(-6);
}

export function sakiActivityStatusText(status: SakiChatWorkflowStatus): string | null {
  if (status === "running") return "进行中";
  if (status === "completed") return "完成";
  if (status === "pending") return "待确认";
  if (status === "failed") return "受阻";
  return null;
}

export function workflowEventChatText(event: SakiChatStreamEvent): string | null {
  if (event.type !== "workflow") return null;
  const message = event.message.trim();
  if (!message) return null;
  if (event.stage === "narration") return message;
  return null;
}

export function workflowStatusText(step: LocalSakiWorkflowStep): string | null {
  if (step.status !== "running" && step.status !== "pending") return null;
  if (step.stage === "thinking") return step.message || "正在深度思考...";
  const tool = step.tool?.toLowerCase();
  if (!tool) return step.message || "思考中...";
  const call = step.call || step.message || "";
  if (tool === "readfile") {
    const path = extractArgFromCall(call, "path");
    return path ? `读取 ${path}` : "读取文件...";
  }
  if (tool === "writefile") {
    const path = extractArgFromCall(call, "path");
    return path ? `写入 ${path}` : "写入文件...";
  }
  if (tool === "replaceinfile" || tool === "editlines") {
    const path = extractArgFromCall(call, "path");
    return path ? `编辑 ${path}` : "编辑文件...";
  }
  if (tool === "runcommand") {
    const cmd = extractArgFromCall(call, "command");
    return cmd ? `运行 ${cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd}` : "运行命令...";
  }
  if (tool === "listfiles") {
    const path = extractArgFromCall(call, "path") || ".";
    return `浏览 ${path}`;
  }
  if (tool === "searchfiles") return "搜索文件内容...";
  if (tool === "findfiles") return "查找文件...";
  if (tool === "sendinput" || tool === "sendcommand") return "发送输入...";
  if (tool === "instanceaction") return "操作实例...";
  if (tool === "deletepath") {
    const path = extractArgFromCall(call, "path");
    return path ? `删除 ${path}` : "删除...";
  }
  if (tool === "mkdir") {
    const path = extractArgFromCall(call, "path");
    return path ? `创建目录 ${path}` : "创建目录...";
  }
  if (tool === "renamepath") return "重命名...";
  if (tool === "searchweb") return "搜索网页...";
  if (tool === "browse" || tool === "crawl") return "浏览网页...";
  if (tool === "researchweb") return "研究搜索...";
  if (tool === "readmemory") return "读取项目记忆...";
  if (tool === "writememory") return "保存项目记忆...";
  if (tool === "plan") return "制定计划...";
  if (tool === "spawntask") return "执行子任务...";
  if (tool === "readskill") return "加载技能...";
  if (tool === "instancelogs") return "读取日志...";
  if (tool === "updateinstancesettings") return "更新实例设置...";
  return step.message || "处理中...";
}

export function extractArgFromCall(call: string, argName: string): string | null {
  if (!call) return null;
  try {
    const jsonMatch = call.match(new RegExp(`"${argName}"\\s*:\\s*"([^"]*)"`));
    if (jsonMatch?.[1]) return jsonMatch[1];
    const plainMatch = call.match(new RegExp(`(?:^|,\\s*)${argName}\\s*:\\s*([^,]+)`));
    return plainMatch?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export function appendSakiAssistantText(current: string, next: string): string {
  const text = next.trim();
  if (!text) return current;
  const recent = current.slice(-2000);
  if (recent.includes(text)) return current;
  return current ? `${current}\n\n${text}` : text;
}

export function mergeSakiFinalText(current: string, finalText: string): string {
  const currentTrimmed = current.trim();
  const finalTrimmed = finalText.trim();
  if (!currentTrimmed) return finalText;
  if (!finalTrimmed) return current;
  if (currentTrimmed === finalTrimmed) return finalText;
  if (
    currentTrimmed.includes("needs your approval") ||
    currentTrimmed.includes("action preview first") ||
    currentTrimmed.includes("需要审批") ||
    currentTrimmed.includes("等待审批")
  ) {
    return finalText;
  }
  if (currentTrimmed.includes(finalTrimmed)) return current;
  if (finalTrimmed.includes(currentTrimmed)) return finalText;
  return `${current}\n\n${finalText}`;
}

export function upsertSakiTimelineText(
  timeline: LocalSakiTimelineItem[] | undefined,
  item: {
    id: string;
    content: string;
    source: LocalSakiTimelineTextSource;
    createdAt?: string;
    thinking?: string;
    thinkingDurationSec?: number;
    thinkingStartedAt?: number;
  }
): LocalSakiTimelineItem[] {
  const content = item.content.trim();
  const thinking = item.thinking?.trim();
  const current = timeline ?? [];
  if (!content && !thinking) return current;
  const index = current.findIndex((entry) => entry.kind === "text" && entry.id === item.id);
  const nextItem: LocalSakiTimelineItem = {
    kind: "text",
    id: item.id,
    content,
    ...(thinking ? { thinking } : {}),
    ...(item.thinkingDurationSec ? { thinkingDurationSec: item.thinkingDurationSec } : {}),
    ...(item.thinkingStartedAt ? { thinkingStartedAt: item.thinkingStartedAt } : {}),
    source: item.source,
    createdAt: item.createdAt ?? new Date().toISOString()
  };
  if (index < 0) return [...current, nextItem];
  return current.map((entry, entryIndex) =>
    entryIndex === index && entry.kind === "text"
      ? {
          ...entry,
          content,
          source: item.source,
          ...(thinking ? { thinking: `${entry.thinking ?? ""}${thinking}`.trim() } : {}),
          ...(item.thinkingDurationSec || entry.thinkingDurationSec
            ? { thinkingDurationSec: item.thinkingDurationSec ?? entry.thinkingDurationSec }
            : {})
        }
      : entry
  );
}

export function appendSakiTimelineDelta(timeline: LocalSakiTimelineItem[] | undefined, text: string): LocalSakiTimelineItem[] {
  if (!text) return timeline ?? [];
  const current = timeline ?? [];
  const last = current.at(-1);
  if (last?.kind === "text" && last.source === "delta") {
    const durationSec =
      last.thinking && last.thinkingStartedAt && !last.thinkingDurationSec
        ? Math.max(1, Math.round((Date.now() - last.thinkingStartedAt) / 1000))
        : last.thinkingDurationSec;
    return [
      ...current.slice(0, -1),
      {
        ...last,
        content: `${last.content}${text}`,
        ...(durationSec ? { thinkingDurationSec: durationSec } : {})
      }
    ];
  }
  return [
    ...current,
    {
      kind: "text",
      id: `delta:${newClientId()}`,
      content: text,
      source: "delta",
      createdAt: new Date().toISOString()
    }
  ];
}

export function appendSakiTimelineThinking(timeline: LocalSakiTimelineItem[] | undefined, text: string): LocalSakiTimelineItem[] {
  if (!text) return timeline ?? [];
  const current = timeline ?? [];
  const last = current.at(-1);
  if (last?.kind === "text" && last.source === "delta") {
    return [
      ...current.slice(0, -1),
      {
        ...last,
        thinking: `${last.thinking ?? ""}${text}`,
        thinkingStartedAt: last.thinkingStartedAt ?? Date.now()
      }
    ];
  }
  return [
    ...current,
    {
      kind: "text",
      id: `delta:${newClientId()}`,
      content: "",
      thinking: text,
      thinkingStartedAt: Date.now(),
      source: "delta",
      createdAt: new Date().toISOString()
    }
  ];
}

export function sealSakiTimelineDelta(timeline: LocalSakiTimelineItem[] | undefined): LocalSakiTimelineItem[] {
  const current = timeline ?? [];
  const last = current.at(-1);
  if (last?.kind === "text" && last.source === "delta" && (last.content.trim() || last.thinking?.trim())) {
    const durationSec =
      last.thinking && last.thinkingStartedAt && !last.thinkingDurationSec
        ? Math.max(1, Math.round((Date.now() - last.thinkingStartedAt) / 1000))
        : last.thinkingDurationSec;
    return [
      ...current.slice(0, -1),
      {
        ...last,
        source: "final" as const,
        ...(durationSec ? { thinkingDurationSec: durationSec } : {})
      }
    ];
  }
  return current;
}

export function upsertSakiTimelinePending(
  timeline: LocalSakiTimelineItem[] | undefined,
  item: { id: string; tool: string; call?: string; message: string; createdAt?: string }
): LocalSakiTimelineItem[] {
  const current = sealSakiTimelineDelta(timeline);
  const id = `pending:${item.id}`;
  const index = current.findIndex((entry) => entry.kind === "pending" && entry.id === id);
  const nextItem: LocalSakiTimelineItem = {
    kind: "pending",
    id,
    tool: item.tool,
    ...(item.call ? { call: item.call } : {}),
    message: item.message,
    createdAt: current[index]?.createdAt ?? item.createdAt ?? new Date().toISOString()
  };
  if (index < 0) return [...current, nextItem];
  return current.map((entry, entryIndex) => (entryIndex === index ? nextItem : entry));
}

export function settleSakiTimelinePending(
  timeline: LocalSakiTimelineItem[] | undefined,
  action: SakiAgentAction
): LocalSakiTimelineItem[] {
  const current = timeline ?? [];
  const toolName = action.tool.toLowerCase();
  let removed = false;
  const withoutPending = current.filter((entry) => {
    if (entry.kind !== "pending") return true;
    if (removed) return true;
    if (entry.tool.toLowerCase() !== toolName) return true;
    removed = true;
    return false;
  });
  return upsertSakiTimelineAction(withoutPending, action);
}

export function upsertSakiTimelineAction(timeline: LocalSakiTimelineItem[] | undefined, action: SakiAgentAction): LocalSakiTimelineItem[] {
  const current = timeline ?? [];
  const id = `action:${action.id}`;
  const index = current.findIndex((entry) => entry.kind === "action" && entry.action.id === action.id);
  const nextItem: LocalSakiTimelineItem = {
    kind: "action",
    id,
    action,
    createdAt: current[index]?.createdAt ?? new Date().toISOString()
  };
  if (index < 0) return [...current, nextItem];
  return current.map((entry, entryIndex) => (entryIndex === index ? nextItem : entry));
}

export function mergeSakiTimelineActions(timeline: LocalSakiTimelineItem[] | undefined, actions: SakiAgentAction[] | undefined): LocalSakiTimelineItem[] {
  return (actions ?? []).reduce<LocalSakiTimelineItem[]>((current, action) => settleSakiTimelinePending(current, action), timeline ?? []);
}

export function mergeSakiActionList(
  current: SakiAgentAction[] | undefined,
  incoming: SakiAgentAction[] | undefined
): SakiAgentAction[] | undefined {
  if (!incoming?.length) return current;
  const next = [...(current ?? [])];
  for (const action of incoming) {
    const index = next.findIndex((item) => item.id === action.id);
    if (index >= 0) {
      next[index] = action;
    } else {
      next.push(action);
    }
  }
  return next;
}

export function mergeSakiFinalTimeline(timeline: LocalSakiTimelineItem[] | undefined, finalText: string): LocalSakiTimelineItem[] {
  const text = finalText.trim();
  const rawCurrent = timeline ?? [];
  const current = rawCurrent.filter(
    (entry) =>
      entry.kind !== "text" ||
      (!entry.content.includes("needs your approval") &&
        !entry.content.includes("action preview first") &&
        !entry.content.includes("需要审批") &&
        !entry.content.includes("等待审批"))
  );
  if (!text) return current;
  const textItems = current.filter((entry): entry is Extract<LocalSakiTimelineItem, { kind: "text" }> => entry.kind === "text");
  if (textItems.some((entry) => entry.content.trim() === text || entry.content.includes(text))) return current;
  const last = current.at(-1);
  if (last?.kind === "text" && (last.source === "delta" || last.source === "final")) {
    const lastTrimmed = last.content.trim();
    if (text.includes(lastTrimmed)) {
      return [
        ...current.slice(0, -1),
        {
          ...last,
          content: text,
          source: "final"
        }
      ];
    }
  }
  return [
    ...current,
    {
      kind: "text",
      id: `final:${newClientId()}`,
      content: text,
      source: "final",
      createdAt: new Date().toISOString()
    }
  ];
}

function timelineTextIsVisible(entry: Extract<LocalSakiTimelineItem, { kind: "text" }>): boolean {
  return Boolean(entry.content.trim() || entry.thinking?.trim());
}

export function renderableSakiTimeline(message: LocalSakiMessage): LocalSakiTimelineItem[] {
  let timeline = (message.timeline ?? []).filter((entry) => {
    if (entry.kind === "action" || entry.kind === "pending") return true;
    return timelineTextIsVisible(entry);
  });
  const visibleActions = visibleSakiActions(message.actions);
  if (timeline.length) {
    const hasThinkingItem = timeline.some((entry) => entry.kind === "text" && entry.thinking?.trim());
    if (!hasThinkingItem && message.thinking?.trim()) {
      timeline = [
        {
          kind: "text",
          id: `${message.id}:thinking`,
          content: "",
          thinking: message.thinking,
          source: "final",
          createdAt: message.createdAt ?? new Date().toISOString()
        },
        ...timeline
      ];
    }
    const timelineActionIds = new Set(timeline.filter((entry) => entry.kind === "action").map((entry) => entry.action.id));
    const missingActionItems: LocalSakiTimelineItem[] = visibleActions
      .filter((action) => !timelineActionIds.has(action.id))
      .map((action) => ({
        kind: "action",
        id: `action:${action.id}`,
        action,
        createdAt: action.createdAt
      }));
    return missingActionItems.length ? [...timeline, ...missingActionItems] : timeline;
  }
  const fallback: LocalSakiTimelineItem[] = [];
  if (message.content.trim() || message.thinking?.trim()) {
    fallback.push({
      kind: "text",
      id: `${message.id}:content`,
      content: message.content,
      ...(message.thinking?.trim() ? { thinking: message.thinking } : {}),
      source: "final",
      createdAt: message.createdAt ?? new Date().toISOString()
    });
  }
  for (const action of visibleActions) {
    fallback.push({
      kind: "action",
      id: `action:${action.id}`,
      action,
      createdAt: action.createdAt
    });
  }
  return fallback;
}

export function SakiActivityTrace({ steps }: { steps: LocalSakiWorkflowStep[]; streaming: boolean }) {
  if (steps.length === 0) return null;
  return (
    <div className="saki-thought-trace" aria-label="Saki 活动">
      {steps.map((step) => (
        <div className={`saki-thought-step ${step.status}`} key={step.id}>
          <span className="saki-thought-dot" />
          <div>
            <div className="saki-thought-row">
              <strong>{step.message}</strong>
              {sakiActivityStatusText(step.status) ? <em>{sakiActivityStatusText(step.status)}</em> : null}
            </div>
            {step.status === "failed" && step.detail ? <p>{step.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function isReadOnlySakiTool(tool: string | undefined): boolean {
  if (!tool) return true;
  return new Set([
    "listinstances",
    "describeinstance",
    "instancelogs",
    "listfiles",
    "readfile",
    "searchaudit",
    "listtasks",
    "taskruns",
    "searchweb",
    "browse",
    "crawl",
    "researchweb",
    "listskills",
    "searchskills",
    "readskill",
    "reportprogress",
    "respond"
  ]).has(tool.toLowerCase());
}

export function visibleSakiActions(actions: SakiAgentAction[] | undefined): SakiAgentAction[] {
  const hiddenTools = new Set(["reportprogress", "respond"]);
  return (actions ?? []).filter((action) => !hiddenTools.has(action.tool.toLowerCase()));
}

export function isSakiFileEditTool(tool: string): boolean {
  const normalized = tool.toLowerCase();
  return normalized === "writefile" || normalized === "replaceinfile" || normalized === "editlines" || normalized === "uploadbase64";
}

export function sakiFileEditActionLabel(tool: string): "创建" | "编辑" {
  const normalized = tool.toLowerCase();
  return normalized === "replaceinfile" || normalized === "editlines" ? "编辑" : "创建";
}

export function isSakiRollbackableFileEdit(action: SakiAgentAction): boolean {
  return Boolean(action.approval?.rollbackAvailable) && isSakiFileEditTool(action.tool);
}

export function isSakiFileRollbackAction(action: SakiAgentAction): boolean {
  return isSakiFileEditTool(action.tool) && (action.status === "rolled_back" || Boolean(action.approval?.rollbackAvailable));
}

export function sakiActionStatusLabel(action: SakiAgentAction): string {
  if (action.status === "pending_approval") return "待审批";
  if (action.status === "rejected") return "已拒绝";
  if (action.status === "rolled_back") return "已回滚";
  if (isSakiRollbackableFileEdit(action)) return "可回溯";
  if (action.ok) return "完成";
  return "失败";
}

export function sakiActionStringArg(action: SakiAgentAction, keys: string[]): string {
  for (const key of keys) {
    const value = action.args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

export function sakiActionTarget(action: SakiAgentAction): string {
  const tool = action.tool.toLowerCase();
  if (tool === "renamepath") {
    const fromPath = sakiActionStringArg(action, ["fromPath"]);
    const toPath = sakiActionStringArg(action, ["toPath"]);
    return fromPath && toPath ? `${fromPath} -> ${toPath}` : fromPath || toPath;
  }
  if (tool === "runcommand" || tool === "sendcommand") return sakiActionStringArg(action, ["command"]);
  if (tool === "sendinput") return sakiActionStringArg(action, ["input", "stdin", "data"]);
  if (tool === "searchweb" || tool === "researchweb" || tool === "searchskills" || tool === "searchaudit") {
    return sakiActionStringArg(action, ["query"]);
  }
  if (tool === "browse" || tool === "crawl") return sakiActionStringArg(action, ["url"]);
  if (tool === "searchfiles") return sakiActionStringArg(action, ["pattern"]);
  if (tool === "findfiles") return sakiActionStringArg(action, ["pattern"]);
  if (tool === "readmemory" || tool === "writememory") return "SAKI.md";
  if (tool === "plan") return sakiActionStringArg(action, ["summary"]);
  if (tool === "spawntask") return sakiActionStringArg(action, ["task"]);
  if (tool === "readskill") return sakiActionStringArg(action, ["skillId"]);
  if (tool === "listfiles") return sakiActionStringArg(action, ["path"]) || ".";
  if (tool === "applypatch" || tool === "apply_patch" || tool === "applydiff") {
    const patch = sakiActionStringArg(action, ["patch"]);
    const match = patch.match(/(?:^\+\+\+ [ab]\/|\*\*\* (?:Add|Update|Delete) File:\s*)(.+)$/m);
    return match?.[1]?.trim() || "patch";
  }
  return sakiActionStringArg(action, ["path", "instanceId", "taskId", "action"]);
}

export interface ParsedThinkingResult {
  hasThinking: boolean;
  thinking: string;
  answer: string;
  isThinkingActive: boolean;
}

export function parseThinkingContent(
  rawText: string = "",
  externalThinking?: string,
  isStreaming?: boolean
): ParsedThinkingResult {
  const thinkingParts: string[] = [];
  if (externalThinking && externalThinking.trim()) {
    thinkingParts.push(externalThinking.trim());
  }

  let text = rawText || "";
  let isThinkingActive = false;

  // Extract all closed tags: <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>
  const closedTagRe = /<(think|thought|reasoning)>([\s\S]*?)<\/\1>/gi;
  const matches = Array.from(text.matchAll(closedTagRe));
  for (const match of matches) {
    const thought = (match[2] ?? "").trim();
    if (thought) {
      thinkingParts.push(thought);
    }
  }
  text = text.replace(closedTagRe, "").trim();

  // Extract open unclosed tag: <think>... (e.g. while streaming)
  const openTagRe = /<(think|thought|reasoning)>([\s\S]*)$/i;
  const openMatch = text.match(openTagRe);
  if (openMatch) {
    const unclosedThought = (openMatch[2] ?? "").trim();
    if (unclosedThought) {
      thinkingParts.push(unclosedThought);
    }
    text = text.slice(0, openMatch.index).trim();
    if (isStreaming) {
      isThinkingActive = true;
    }
  }

  const thinking = thinkingParts.join("\n\n").trim();
  return {
    hasThinking: Boolean(thinking),
    thinking,
    answer: text,
    isThinkingActive: Boolean(isStreaming && thinking) || isThinkingActive
  };
}

export function SakiThinkingActionCard({
  thinking,
  streaming,
  durationSec,
  defaultExpanded = false
}: {
  thinking: string;
  streaming?: boolean | undefined;
  durationSec?: number | undefined;
  defaultExpanded?: boolean | undefined;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const displaySec = durationSec && durationSec > 0 ? durationSec : Math.max(1, Math.round(thinking.length / 80));

  return (
    <div className={`saki-action-row saki-thinking-action-row ${streaming ? "running" : ""}`}>
      <div
        className="saki-action-row-main"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <span className="saki-action-icon">
          {streaming ? <Loader2 size={13} className="status-spinner" /> : <Sparkles size={13} />}
        </span>
        <span className="saki-action-label">
          <span style={{ fontWeight: 500 }}>
            {streaming ? "Thinking..." : `Thought for ${displaySec}s`}
          </span>
        </span>
        {streaming ? (
          <span className="saki-action-status-dot saki-action-status-live" />
        ) : (
          <span className="saki-action-status-dot" style={{ backgroundColor: "#8b5cf6" }} />
        )}
        <span className="saki-action-expand">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && thinking ? (
        <div className="saki-action-detail">
          <pre className="saki-action-observation saki-thinking-pre" style={{ maxHeight: "320px", whiteSpace: "pre-wrap" }}>
            {thinking}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function SakiThinkingContent({
  content,
  thinking: explicitThinking,
  streaming
}: {
  content: string;
  thinking?: string | undefined;
  streaming?: boolean | undefined;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const { hasThinking, thinking, answer, isThinkingActive } = useMemo(
    () => parseThinkingContent(content, explicitThinking, streaming),
    [content, explicitThinking, streaming]
  );
  const expanded = userExpanded ?? isThinkingActive;

  if (!hasThinking) {
    if (streaming) {
      return (
        <div className="saki-stream-raw-wrap">
          <span className="saki-stream-raw">{content}</span>
          <span className="saki-stream-cursor" />
        </div>
      );
    }
    return <MarkdownContent content={content} />;
  }

  const charCount = thinking ? Math.max(1, thinking.length) : 0;
  const preview = thinking.replace(/\s+/g, " ").trim();

  return (
    <div className="saki-message-with-thinking">
      <div className={`saki-thinking-collapse ${expanded ? "is-expanded" : "is-collapsed"} ${isThinkingActive ? "is-live" : ""}`}>
        <button
          type="button"
          className="saki-thinking-toggle"
          onClick={() => setUserExpanded(!(userExpanded ?? isThinkingActive))}
          title={expanded ? "收起思考过程" : "展开思考过程"}
          aria-expanded={expanded}
        >
          <span className="saki-thinking-toggle-icon">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="saki-thinking-toggle-title">
            <Sparkles size={13} className="saki-thinking-sparkle" />
            {isThinkingActive ? "正在深度思考..." : "思考过程"}
          </span>
          {thinking ? (
            <span className="saki-thinking-badge">
              {isThinkingActive ? "思考中" : `${charCount} 字`}
            </span>
          ) : null}
        </button>
        {expanded ? (
          <div className="saki-thinking-drawer">
            <div className="saki-thinking-body">
              {streaming && isThinkingActive ? (
                <div className="saki-stream-raw-wrap">
                  <span className="saki-stream-raw saki-thinking-raw">{thinking}</span>
                  <span className="saki-stream-cursor" />
                </div>
              ) : (
                <MarkdownContent content={thinking} />
              )}
            </div>
          </div>
        ) : preview ? (
          <p className="saki-thinking-preview">{preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}</p>
        ) : null}
      </div>

      {answer ? (
        <div className="saki-thinking-answer">
          {streaming && !isThinkingActive ? (
            <div className="saki-stream-raw-wrap">
              <span className="saki-stream-raw">{answer}</span>
              <span className="saki-stream-cursor" />
            </div>
          ) : (
            <MarkdownContent content={answer} />
          )}
        </div>
      ) : isThinkingActive ? (
        <div className="saki-thinking-pending-answer">
          <span className="saki-thinking-pulse-dot" />
          <span>正在组织回答...</span>
        </div>
      ) : null}
    </div>
  );
}

export function sakiActionMeta(action: SakiAgentAction): string {
  const tool = action.tool.toLowerCase();
  const parts: string[] = [];
  const add = (label: string, value: string) => {
    if (value) parts.push(`${label}: ${value}`);
  };
  if (tool === "listfiles") add("limit", sakiActionStringArg(action, ["limit"]));
  if (tool === "readfile") {
    add("start", sakiActionStringArg(action, ["startLine"]));
    add("lines", sakiActionStringArg(action, ["lineCount"]));
  }
  if (tool === "editlines") {
    const startLine = sakiActionStringArg(action, ["startLine"]);
    const endLine = sakiActionStringArg(action, ["endLine"]);
    if (startLine || endLine) parts.push(`lines: ${startLine || "?"}-${endLine || "?"}`);
  }
  if (tool === "runcommand") {
    add("cwd", sakiActionStringArg(action, ["cwd", "workingDirectory"]));
    add("timeout", sakiActionStringArg(action, ["timeoutMs"]));
  }
  return parts.join(" / ");
}

export function sakiActionTitle(action: SakiAgentAction): string {
  switch (action.tool.toLowerCase()) {
    case "listinstances":
      return "查看实例列表";
    case "describeinstance":
      return "查看实例信息";
    case "instancelogs":
      return "读取实例日志";
    case "listfiles":
      return "查看目录结构";
    case "readfile":
      return "读取文件";
    case "writefile":
      return "写入文件";
    case "replaceinfile":
      return "替换文件内容";
    case "editlines":
      return "编辑文件行";
    case "applypatch":
    case "apply_patch":
    case "applydiff":
      return "应用补丁";
    case "mkdir":
      return "创建目录";
    case "deletepath":
      return "删除路径";
    case "renamepath":
      return "移动/重命名";
    case "uploadbase64":
      return "上传文件";
    case "runcommand":
      return "运行终端命令";
    case "sendinput":
      return "发送控制台输入";
    case "sendcommand":
      return "发送控制台命令";
    case "searchaudit":
      return "查询审计日志";
    case "listtasks":
      return "查看计划任务";
    case "taskruns":
      return "查看任务运行";
    case "searchweb":
    case "researchweb":
      return "检索网页";
    case "browse":
    case "crawl":
      return "读取网页";
    case "listskills":
    case "searchskills":
      return "查找技能";
    case "readskill":
      return "读取技能";
    case "searchfiles":
      return "搜索文件内容";
    case "findfiles":
      return "查找文件";
    case "readmemory":
      return "读取项目记忆";
    case "writememory":
      return "保存项目记忆";
    case "plan":
      return "制定计划";
    case "spawntask":
      return "子任务";
    default:
      return action.tool;
  }
}

export function sakiByteText(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function sakiObservationLine(observation: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = observation.match(new RegExp(`^${escapedLabel}\\s*[:=]\\s*(.+)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

export function sakiResultSummary(action: SakiAgentAction): string {
  const observation = action.observation.trim();
  const tool = action.tool.toLowerCase();
  const target = sakiActionTarget(action);

  if (action.status === "pending_approval") {
    return action.approval?.reason ? `等待确认：${compactContextText(action.approval.reason, 180)}` : "等待你确认后执行。";
  }
  if (action.status === "rejected") return "这次调用已被拒绝，没有执行。";
  if (action.status === "rolled_back") return target ? `已回滚 ${target}。` : "已回滚到执行前的状态。";
  if (!observation) return action.ok ? "调用完成，没有返回额外内容。" : "调用失败，没有返回详细信息。";
  if (!action.ok) return compactContextText(observation.replace(/\s+/g, " "), 220);

  if (tool === "listfiles") {
    if (/Directory is empty\./i.test(observation)) return target ? `${target} 是空目录。` : "目录为空。";
    const lines = observation.split(/\r?\n/);
    const dirCount = lines.filter((line) => line.startsWith("[DIR]")).length;
    const fileCount = lines.filter((line) => line.startsWith("[FILE]")).length;
    const truncated = lines.find((line) => /^Showing\s+/i.test(line.trim()));
    return `找到 ${dirCount} 个目录、${fileCount} 个文件。${truncated ? ` ${compactContextText(truncated.trim(), 120)}` : ""}`;
  }

  if (tool === "readfile") {
    const file = sakiObservationLine(observation, "File") || target || "文件";
    const size = sakiObservationLine(observation, "Size").replace(/\s*bytes$/i, "");
    const totalLines = sakiObservationLine(observation, "Total lines");
    const showing = sakiObservationLine(observation, "Showing lines");
    return `已读取 ${file}${totalLines ? `，共 ${totalLines} 行` : ""}${showing ? `，显示 ${showing}` : ""}${size ? `，${sakiByteText(size)}` : ""}。`;
  }

  if (tool === "writefile" || tool === "uploadbase64") {
    const size = observation.match(/\((\d+)\s+bytes\)/i)?.[1] ?? "";
    return `已${tool === "writefile" ? "写入" : "上传"} ${target || "文件"}${size ? `，${sakiByteText(size)}` : ""}。`;
  }

  if (tool === "replaceinfile" || tool === "editlines") {
    const size = observation.match(/\((\d+)\s+bytes\)/i)?.[1] ?? "";
    const removed = sakiObservationLine(observation, "Removed lines");
    const inserted = sakiObservationLine(observation, "Inserted lines");
    return `已编辑 ${target || "文件"}${removed ? `，删除 ${removed} 行` : ""}${inserted ? `，插入 ${inserted} 行` : ""}${size ? `，${sakiByteText(size)}` : ""}。`;
  }

  if (tool === "mkdir") return `目录已准备好：${target || "目标目录"}。`;
  if (tool === "deletepath") return target ? `已处理删除：${target}，可用回滚检查点恢复。` : "删除操作已完成。";
  if (tool === "renamepath") return target ? `已移动/重命名：${target}。` : "移动或重命名已完成。";

  if (tool === "runcommand") {
    const exitCode = sakiObservationLine(observation, "exitCode");
    const duration = sakiObservationLine(observation, "durationMs");
    const stdoutEmpty = /stdout:\s*\(empty\)/i.test(observation);
    const stderrEmpty = /stderr:\s*\(empty\)/i.test(observation);
    return `命令已结束${exitCode ? `，退出码 ${exitCode}` : ""}${duration ? `，耗时 ${duration}ms` : ""}${stdoutEmpty ? "，stdout 为空" : ""}${stderrEmpty ? "，stderr 为空" : ""}。`;
  }

  if (tool === "sendinput" || tool === "sendcommand") return "控制台输入已发送。";

  if (tool === "spawntask") {
    const taskText = sakiActionStringArg(action, ["task"]);
    return taskText ? `子任务: ${taskText.slice(0, 80)}` : "子任务执行";
  }

  return compactContextText(observation.replace(/\s+/g, " "), 220);
}

export function sakiActionDetailsLabel(action: SakiAgentAction): string {
  switch (action.tool.toLowerCase()) {
    case "listfiles":
      return "查看目录条目";
    case "readfile":
      return "查看文件内容";
    case "runcommand":
      return "查看命令输出";
    default:
      return "查看调用结果";
  }
}

export function sakiActionTone(action: SakiAgentAction): "read" | "write" | "delete" | "terminal" | "system" {
  const tool = action.tool.toLowerCase();
  if (tool === "deletepath") return "delete";
  if (tool === "runcommand" || tool === "sendinput" || tool === "sendcommand") return "terminal";
  if (tool === "writefile" || tool === "replaceinfile" || tool === "editlines" || tool === "mkdir" || tool === "renamepath" || tool === "uploadbase64") return "write";
  if (tool === "listfiles" || tool === "readfile" || tool === "instancelogs" || tool === "listinstances" || tool === "describeinstance") return "read";
  return "system";
}

export function sakiActionStateClass(action: SakiAgentAction): string {
  if (action.status === "pending_approval") return "pending";
  if (action.status === "rolled_back") return "rolled-back";
  if (!action.ok || action.status === "failed" || action.status === "rejected") return "error";
  return "ok";
}

export function SakiToolIcon({ action }: { action: SakiAgentAction }) {
  switch (action.tool.toLowerCase()) {
    case "listfiles":
      return <Folder size={16} />;
    case "readfile":
      return <FileText size={16} />;
    case "writefile":
    case "uploadbase64":
      return <FilePlus size={16} />;
    case "replaceinfile":
    case "editlines":
    case "applypatch":
    case "apply_patch":
    case "applydiff":
      return <Code2 size={16} />;
    case "mkdir":
      return <FolderPlus size={16} />;
    case "deletepath":
      return <Trash2 size={16} />;
    case "runcommand":
    case "sendinput":
    case "sendcommand":
      return <TerminalIcon size={16} />;
    case "instancelogs":
    case "searchaudit":
      return <ClipboardList size={16} />;
    case "listinstances":
    case "describeinstance":
      return <Server size={16} />;
    case "searchweb":
    case "researchweb":
    case "browse":
    case "crawl":
      return <Search size={16} />;
    case "searchfiles":
      return <Search size={16} />;
    case "findfiles":
      return <FileSearch size={16} />;
    case "readmemory":
      return <BookOpen size={16} />;
    case "writememory":
      return <BookMarked size={16} />;
    case "plan":
      return <ListChecks size={16} />;
    case "spawntask":
      return <GitBranch size={16} />;
    default:
      return <Wrench size={16} />;
  }
}

function sakiDiffPathFromLine(line: string): string | null {
  const update = line.match(/^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+)$/);
  if (update?.[1]) return update[1].trim().replace(/^[ab]\//, "");
  const unified = line.match(/^(?:\+\+\+|---) [ab]\/(.+)$/);
  if (unified?.[1] && unified[1] !== "/dev/null") return unified[1].trim();
  return null;
}

function sakiDiffLineNumber(line: string): number | undefined {
  const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
  if (!hunk?.[1]) return undefined;
  const parsed = Number(hunk[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function SakiToolActionCard({
  action,
  actionBusyId,
  onDecision,
  onOpenPath
}: {
  action: SakiAgentAction;
  actionBusyId: string | null;
  onDecision: (action: SakiAgentAction, decision: "approve" | "reject" | "rollback") => void;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const busy = actionBusyId === action.id;
  const controlsDisabled = Boolean(actionBusyId);
  const target = sakiActionTarget(action);
  const meta = sakiActionMeta(action);
  const observation = action.observation.trim() || "没有返回内容。";
  const toolLower = action.tool.toLowerCase();
  const isCommand = toolLower === "runcommand" || toolLower === "sendcommand" || toolLower === "sendinput";
  const diffText =
    action.approval?.diff ||
    ((toolLower === "applypatch" || toolLower === "apply_patch" || toolLower === "applydiff") &&
    /^(--- |\+\+\+ |\*\*\*)/m.test(observation)
      ? observation
      : "");
  const isPending = action.status === "pending_approval";
  const isFailed = !action.ok || action.status === "failed" || action.status === "rejected";
  const statusColor = isPending ? "#f59e0b" : isFailed ? "#ef4444" : "#22c55e";

  return (
    <div className={`saki-action-row ${isPending ? "pending" : ""} ${isFailed ? "failed" : ""}`}>
      <div className="saki-action-row-main" onClick={() => setExpanded(!expanded)}>
        <span className="saki-action-icon"><SakiToolIcon action={action} /></span>
        <span className="saki-action-label" title={target || undefined}>
          {target ? (
            onOpenPath && !target.includes(" ") ? (
              <button
                type="button"
                className="saki-action-path-link"
                title={target}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenPath(target);
                }}
              >
                <code>{compactContextText(target, 120)}</code>
              </button>
            ) : (
              <code title={target}>{compactContextText(target, 120)}</code>
            )
          ) : (
            <span>{sakiActionTitle(action)}</span>
          )}
          {meta ? <span className="saki-action-meta">{meta}</span> : null}
        </span>
        <span className="saki-action-status-dot" style={{ backgroundColor: statusColor }} />
        {action.approval?.rollbackAvailable && !isPending ? (
          <button
            className="saki-action-inline-rollback"
            type="button"
            title="回滚此操作"
            disabled={controlsDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onDecision(action, "rollback");
            }}
          >
            {busy ? <Loader2 size={12} className="status-spinner" /> : <CornerUpLeft size={12} />}
          </button>
        ) : null}
        <span className="saki-action-expand">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded ? (
        <div className="saki-action-detail">
          {isCommand ? (
            <div className="saki-action-terminal">
              <div className="saki-action-terminal-header">
                <span>{sakiActionTitle(action)}</span>
                <span className="saki-action-terminal-status">{sakiResultSummary(action)}</span>
              </div>
              <pre className="saki-action-terminal-output">{compactContextText(observation, 8000)}</pre>
            </div>
          ) : (
            <pre className="saki-action-observation">{compactContextText(observation, 5200)}</pre>
          )}
          {diffText ? (
            <div className="saki-action-diff">
              <div className="saki-action-diff-header">差异</div>
              <pre className="saki-action-diff-body">
                {compactContextText(diffText, 6000)
                  .split("\n")
                  .map((line, index) => {
                    const kind = line.startsWith("+++") || line.startsWith("---") || line.startsWith("***")
                      ? "file"
                      : line.startsWith("+")
                        ? "add"
                        : line.startsWith("-")
                          ? "del"
                          : line.startsWith("@@")
                            ? "hunk"
                            : "ctx";
                    const path = sakiDiffPathFromLine(line);
                    const hunkLine = sakiDiffLineNumber(line);
                    const clickable = Boolean(onOpenPath && (path || (kind === "hunk" && hunkLine && target)));
                    return (
                      <span
                        key={`${index}:${line.slice(0, 24)}`}
                        className={`saki-diff-line saki-diff-${kind}${clickable ? " saki-diff-clickable" : ""}`}
                        onClick={
                          clickable
                            ? (event) => {
                                event.stopPropagation();
                                onOpenPath?.(path || target, hunkLine);
                              }
                            : undefined
                        }
                      >
                        {line}
                        {"\n"}
                      </span>
                    );
                  })}
              </pre>
            </div>
          ) : null}
          {action.approval?.preview && !action.approval.diff ? (
            <div className="saki-action-diff">
              <div className="saki-action-diff-header">预览</div>
              <pre>{compactContextText(action.approval.preview, 2000)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {isPending ? (
        <div className="saki-action-approval">
          <button className="saki-approval-btn approve" type="button" disabled={controlsDisabled} onClick={() => onDecision(action, "approve")}>
            {busy ? <Loader2 size={13} className="status-spinner" /> : <CheckCircle2 size={13} />}
            批准
          </button>
          <button className="saki-approval-btn reject" type="button" disabled={controlsDisabled} onClick={() => onDecision(action, "reject")}>
            <X size={13} />
            拒绝
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SakiPendingToolCard({
  tool,
  call,
  message
}: {
  tool: string;
  call?: string | undefined;
  message: string;
}) {
  const target =
    extractArgFromCall(call ?? "", "path") ||
    extractArgFromCall(call ?? "", "command") ||
    extractArgFromCall(call ?? "", "query") ||
    extractArgFromCall(call ?? "", "pattern") ||
    extractArgFromCall(call ?? "", "url") ||
    "";
  const fakeAction = {
    id: "",
    tool,
    args: {},
    observation: "",
    ok: true,
    createdAt: new Date().toISOString()
  } as SakiAgentAction;
  return (
    <div className="saki-action-row running">
      <div className="saki-action-row-main">
        <span className="saki-action-icon">
          <Loader2 size={16} className="status-spinner" />
        </span>
        <span className="saki-action-label" title={target || undefined}>
          {target ? <code title={target}>{compactContextText(target, 120)}</code> : <span>{sakiActionTitle(fakeAction)}</span>}
          <span className="saki-action-meta">{message || "进行中"}</span>
        </span>
        <span className="saki-action-status-dot saki-action-status-live" />
      </div>
    </div>
  );
}

export function SakiStreamStatus({ workflow }: { workflow: LocalSakiWorkflowStep[] }) {
  const runningStep = [...workflow].reverse().find((step) => step.status === "running" || step.status === "pending");
  if (!runningStep) return null;
  const statusText = workflowStatusText(runningStep);
  if (!statusText) return null;
  const tool = runningStep.tool?.toLowerCase();
  const iconMap: Record<string, string> = {
    readfile: "📖", writefile: "✏️", replaceinfile: "✏️", editlines: "✏️",
    runcommand: "💻", listfiles: "📁", searchfiles: "🔍", findfiles: "🔎",
    deletepath: "🗑️", mkdir: "📁", renamepath: "📝", searchweb: "🌐",
    browse: "🌐", crawl: "🌐", researchweb: "🌐", sendinput: "⌨️",
    sendcommand: "⌨️", readmemory: "💾", writememory: "💾", plan: "📋",
    spawntask: "🔄", readskill: "📖", instancelogs: "📋"
  };
  const icon = tool ? (iconMap[tool] ?? "⚙️") : runningStep.stage === "thinking" ? "💭" : "⚙️";
  return (
    <div className="saki-stream-status">
      <span className="saki-stream-status-icon">{icon}</span>
      <span className="saki-stream-status-text">{statusText}</span>
      <span className="saki-stream-status-dots">
        <span className="saki-dot saki-dot-1">·</span>
        <span className="saki-dot saki-dot-2">·</span>
        <span className="saki-dot saki-dot-3">·</span>
      </span>
    </div>
  );
}

export const sakiFoodMenu = [
  {
    id: "caomeidafu",
    name: "草莓大福",
    image: "/assets/game/caomeidafu.png",
    cost: 1,
    favorability: 10,
    desc: "软糯香甜，仅需 1 Saki 积分",
    greeting: "嗷呜～软糯的草莓大福太美味啦！谢谢你～ (๑>؂<๑)۶",
    mood: "eating" as SakiActivityMood
  },
  {
    id: "naicha",
    name: "波霸珍珠奶茶",
    image: "/assets/game/naicha.png",
    cost: 2,
    favorability: 25,
    desc: "Q弹珍珠，仅需 2 Saki 积分",
    greeting: "吸一口甜甜的珍珠奶茶，活力瞬间拉满！(*╹▽╹*)",
    mood: "eating" as SakiActivityMood
  },
  {
    id: "biandang",
    name: "猫咪爱心便当",
    image: "/assets/game/biandang.png",
    cost: 5,
    favorability: 60,
    desc: "特制萌猫便当，仅需 5 Saki 积分",
    greeting: "这...这是特制给我的猫咪便当吗？！太感动了，最喜欢你啦～ (｡♥‿♥｡)",
    mood: "eating" as SakiActivityMood
  }
];

export function getLocalizedFoodMenu(language?: string) {
  if (language === "en-US") {
    return [
      {
        id: "caomeidafu",
        name: "Strawberry Daifuku",
        image: "/assets/game/caomeidafu.png",
        cost: 1,
        favorability: 10,
        desc: "Soft and sweet, only 1 Saki Point",
        greeting: "Nom nom～ The soft strawberry daifuku is so delicious! Thank you～ (๑>؂<๑)۶",
        mood: "eating" as SakiActivityMood
      },
      {
        id: "naicha",
        name: "Boba Pearl Milk Tea",
        image: "/assets/game/naicha.png",
        cost: 2,
        favorability: 25,
        desc: "Chewy boba, only 2 Saki Points",
        greeting: "A sip of sweet pearl milk tea fills me with energy! (*╹▽╹*)",
        mood: "eating" as SakiActivityMood
      },
      {
        id: "biandang",
        name: "Kitty Heart Bento",
        image: "/assets/game/biandang.png",
        cost: 5,
        favorability: 60,
        desc: "Special kitty bento, only 5 Saki Points",
        greeting: "Is... is this cute kitty bento made specially for me?! I'm so touched, I love you so much～ (｡♥‿♥｡)",
        mood: "eating" as SakiActivityMood
      }
    ];
  }
  if (language === "zh-TW") {
    return [
      {
        id: "caomeidafu",
        name: "草莓大福",
        image: "/assets/game/caomeidafu.png",
        cost: 1,
        favorability: 10,
        desc: "軟糯香甜，僅需 1 Saki 積分",
        greeting: "嗷嗚～軟糯的草莓大福太美味啦！謝謝你～ (๑>؂<๑)۶",
        mood: "eating" as SakiActivityMood
      },
      {
        id: "naicha",
        name: "波霸珍珠奶茶",
        image: "/assets/game/naicha.png",
        cost: 2,
        favorability: 25,
        desc: "Q彈珍珠，僅需 2 Saki 積分",
        greeting: "吸一口甜甜的珍珠奶茶，活力瞬間拉滿！(*╹▽╹*)",
        mood: "eating" as SakiActivityMood
      },
      {
        id: "biandang",
        name: "貓咪愛心便當",
        image: "/assets/game/biandang.png",
        cost: 5,
        favorability: 60,
        desc: "特製萌貓便當，僅需 5 Saki 積分",
        greeting: "這...這是特製給我的貓咪便當嗎？！太感動了，最喜歡你啦～ (｡♥‿♥｡)",
        mood: "eating" as SakiActivityMood
      }
    ];
  }
  return sakiFoodMenu;
}
