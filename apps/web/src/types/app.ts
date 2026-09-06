import type {
  ExtractArchiveConflict,
  ExtractConflictAction,
  InstanceFileEntry,
  SakiAgentAction,
  SakiChatMessage,
  SakiChatMode,
  SakiInputAttachment
} from "@webops/shared";
import type { SakiChatWorkflowStatus } from "../api.js";

export type SakiSettingsSection = "system" | "model" | "features" | "appearance" | "prompt" | "skills" | "watch";
export type ViewMode = "dashboard" | "instances" | "nodes" | "templates" | "users" | "audit" | "settings" | "about" | "reliability";
export type InstanceDirectoryView = "cards" | "list" | "graph";

export interface PanelRoute {
  view: ViewMode;
  instanceId: string | null;
  settingsSection: SakiSettingsSection | null;
}

export interface SakiPromptSeed {
  message: string;
  panelError?: string;
  contextTitle?: string;
  contextText?: string;
  clearInstance?: boolean;
  mode?: SakiChatMode;
  nonce: number;
}

export interface SakiPanelContext {
  label: string;
  detail: string;
  auditSearch?: boolean;
}

export interface RememberedLogin {
  username: string;
  password: string;
}

export interface LocalSakiWorkflowStep {
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

export type LocalSakiTimelineTextSource = "workflow" | "delta" | "final" | "error";

export type LocalSakiTimelineItem =
  | {
      kind: "text";
      id: string;
      content: string;
      thinking?: string;
      thinkingDurationSec?: number;
      thinkingStartedAt?: number;
      source: LocalSakiTimelineTextSource;
      createdAt: string;
    }
  | {
      kind: "action";
      id: string;
      action: SakiAgentAction;
      createdAt: string;
    }
  | {
      kind: "pending";
      id: string;
      tool: string;
      call?: string;
      message: string;
      createdAt: string;
    };

export interface LocalSakiMessage extends SakiChatMessage {
  id: string;
  source?: "direct-model" | "local-fallback";
  actions?: SakiAgentAction[];
  attachments?: SakiInputAttachment[];
  workflow?: LocalSakiWorkflowStep[];
  timeline?: LocalSakiTimelineItem[];
  workflowExpanded?: boolean;
  rollbackGroupExpanded?: boolean;
  streaming?: boolean | undefined;
  thinking?: string | undefined;
  thinkingDurationSec?: number | undefined;
  thinkingStartedAt?: number | undefined;
  usage?: {
    tokensUsed: number;
    pointsUsed: number;
    isUnlimited: boolean;
    remainingPoints?: number;
  } | undefined;
}

export interface SakiSubmitOverride {
  message?: string;
  panelError?: string | null;
  contextTitle?: string | null;
  contextText?: string | null;
  mode?: SakiChatMode;
  attachments?: SakiInputAttachment[];
  steer?: boolean;
}

export interface SakiSelectionCapture {
  source: "page" | "terminal";
  title: string;
  text: string;
}

export interface SakiOpenFileRequest {
  instanceId: string;
  path: string;
  line?: number;
  nonce: number;
}

export interface SakiFollowUpJob {
  id: string;
  message: string;
  attachments?: SakiInputAttachment[];
}

export interface SakiInstanceFileDragPayload {
  source: "webops-instance-file";
  instanceId: string;
  instanceName: string;
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface SakiInstanceFileDropRequest extends SakiInstanceFileDragPayload {
  nonce: number;
}

export interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0?: {
    transcript?: string;
  };
}

export interface BrowserSpeechRecognitionEvent extends Event {
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  error?: string;
  message?: string;
}

export interface BrowserSpeechRecognition extends EventTarget {
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

export type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export type FileConflictChoice = "overwrite" | "keep";

export interface FileConflictPrompt {
  action: "create" | "upload";
  name: string;
  suggestedName: string;
  canOverwrite: boolean;
}

export interface ExtractConflictPrompt {
  archivePath: string;
  outputPath: string;
  conflicts: ExtractArchiveConflict[];
  resolutions: Record<string, ExtractConflictAction>;
}

export interface FileToast {
  id: number;
  title: string;
  detail: string;
}

export interface SyntaxRule {
  className: string;
  pattern: RegExp;
}

export interface HighlightToken {
  text: string;
  className?: string;
}

export interface FindMatchRange {
  start: number;
  end: number;
}

export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string };
