import React from "react";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  ImageIcon,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  Shield,
  Square,
  TextQuote,
  Wrench,
  X,
  XOctagon,
  Zap
} from "lucide-react";
import {
  activeSakiMentionQuery,
  isSakiImageAttachment,
  type SakiAgentPermissionMode,
  type SakiChatMode,
  type SakiInputAttachment,
  type SakiModelOption
} from "@webops/shared";
import { compactContextText } from "../../../utils/path.js";
import { SakiAttachmentChip } from "../SakiComponents.js";
import { SakiMentionMenu } from "../SakiMentionMenu.js";
import {
  sakiPermissionModeLabel,
  sakiPermissionModeTitle,
  type LocalSakiMessage
} from "../sakiChatHelpers.js";
import { SakiMiniChat } from "./SakiMiniChat.js";

export interface SakiComposerProps {
  // Submission & form
  onSubmit: (event?: React.FormEvent<HTMLFormElement>, options?: { message?: string; steer?: boolean }) => Promise<void> | void;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  attachmentInputRef: React.RefObject<HTMLInputElement | null>;
  onAddFiles: (files: File[], kind: "image" | "file") => Promise<void> | void;

  // Expansion
  messagesExpanded: boolean;
  onToggleMessagesExpanded: () => void;

  // Mini-chat support
  messages: LocalSakiMessage[];
  loading: boolean;
  hasStreamingAssistant: boolean;

  // Peep icon
  artShuru: string;
  artShuruBlack: string;
  thinkingGif: string;
  sakiFileHoverActive: boolean;

  // Mention menu
  mentionMenuOpen: boolean;
  mentionCandidates: SakiInputAttachment[];
  mentionIndex: number;
  onMentionIndexChange: (idx: number | ((prev: number) => number)) => void;
  onApplyMention: (candidate: SakiInputAttachment) => void;
  onSyncMentionCaret: (target: HTMLTextAreaElement) => void;
  onMentionDismissedStart: (start: number | null) => void;
  mentionCaret: number;

  // Add menu button
  sakiAddMenuOpen: boolean;
  sakiAddBtnRef: React.RefObject<HTMLButtonElement | null>;
  onToggleAddMenu: () => void;

  // Textarea
  composerTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (text: string) => void;
  onComposerPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void> | void;

  // Attachments & queue
  attachments: SakiInputAttachment[];
  onPreviewAttachment: (preview: { attachment: SakiInputAttachment; editable: boolean }) => void;
  onRemoveAttachment: (attachment: SakiInputAttachment) => void;
  followUpQueue: Array<{ id: string; message: string }>;
  onRemoveFollowUp: (id: string) => void;
  composerNotice: string | null;

  // Toolbar actions
  listening: boolean;
  onToggleSpeechInput: () => void;
  annotationMode: boolean;
  onToggleSelectionAnnotation: () => void;
  composerBusy: "image" | "file" | "screenshot" | null;
  onPasteImageFromClipboard: () => Promise<void> | void;
  onOpenComposerFilePicker: (input: HTMLInputElement | null) => void;
  onCaptureScreenAttachment: () => Promise<void> | void;

  // Mode and permissions
  canUseChat: boolean;
  canUseAgent: boolean;
  mode: SakiChatMode;
  onSelectMode: (mode: SakiChatMode) => void;
  permissionSelectorRef: React.RefObject<HTMLDivElement | null>;
  permissionDropdownOpen: boolean;
  onTogglePermissionDropdown: () => void;
  permissionMode: SakiAgentPermissionMode;

  // Model selection
  modelSelectorRef: React.RefObject<HTMLDivElement | null>;
  modelDropdownOpen: boolean;
  onToggleModelDropdown: () => void;
  currentModelName: string | undefined;
  currentModelId: string;
  availableModels: SakiModelOption[];

  // Send & Stop
  onStopSakiGeneration: () => void;
  contextText: string | null;
  auditSearchActive: boolean;
  hasActiveInstance: boolean;
  token?: string;
}

export const SakiComposer = React.memo(function SakiComposer({
  onSubmit,
  imageInputRef,
  attachmentInputRef,
  onAddFiles,
  messagesExpanded,
  onToggleMessagesExpanded,
  messages,
  loading,
  hasStreamingAssistant,
  artShuru,
  artShuruBlack,
  thinkingGif,
  sakiFileHoverActive,
  mentionMenuOpen,
  mentionCandidates,
  mentionIndex,
  onMentionIndexChange,
  onApplyMention,
  onSyncMentionCaret,
  onMentionDismissedStart,
  mentionCaret,
  sakiAddMenuOpen,
  sakiAddBtnRef,
  onToggleAddMenu,
  composerTextareaRef,
  draft,
  onDraftChange,
  onComposerPaste,
  attachments,
  onPreviewAttachment,
  onRemoveAttachment,
  followUpQueue,
  onRemoveFollowUp,
  composerNotice,
  listening,
  onToggleSpeechInput,
  annotationMode,
  onToggleSelectionAnnotation,
  composerBusy,
  onPasteImageFromClipboard,
  onOpenComposerFilePicker,
  onCaptureScreenAttachment,
  canUseChat,
  canUseAgent,
  mode,
  onSelectMode,
  permissionSelectorRef,
  permissionDropdownOpen,
  onTogglePermissionDropdown,
  permissionMode,
  modelSelectorRef,
  modelDropdownOpen,
  onToggleModelDropdown,
  currentModelName,
  currentModelId,
  availableModels,
  onStopSakiGeneration,
  contextText,
  auditSearchActive,
  hasActiveInstance,
  token
}: SakiComposerProps) {
  const placeholder = attachments.some(isSakiImageAttachment)
    ? "输入 @ 引用已上传的参考图"
    : mode === "agent" && permissionMode === "plan"
    ? "让 Saki 先阅读项目并给出执行计划"
    : contextText
    ? "针对已附加的上下文继续追问"
    : auditSearchActive
    ? "让 Saki 查找审计日志"
    : hasActiveInstance
    ? "问 Saki 当前实例里的问题"
    : "问 Saki";

  return (
    <form className="saki-composer" onSubmit={(event) => void onSubmit(event)}>
      <input
        ref={imageInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.currentTarget.value = "";
          void onAddFiles(files, "image");
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
          void onAddFiles(files, "file");
        }}
      />
      <div className="saki-composer-expand-hint">
        <button
          type="button"
          className="saki-composer-expand-btn"
          title={messagesExpanded ? "折叠对话" : "展开对话"}
          aria-label={messagesExpanded ? "折叠对话" : "展开对话"}
          aria-expanded={messagesExpanded}
          onClick={onToggleMessagesExpanded}
        >
          {messagesExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!messagesExpanded && (
        <SakiMiniChat
          messages={messages}
          loading={loading}
          hasStreamingAssistant={hasStreamingAssistant}
          thinkingGif={thinkingGif}
          {...(token ? { token } : {})}
        />
      )}

      <div className="saki-input-container">
        {mentionMenuOpen ? (
          <SakiMentionMenu
            candidates={mentionCandidates}
            activeIndex={mentionIndex}
            onHover={(idx) => onMentionIndexChange(idx)}
            onSelect={onApplyMention}
          />
        ) : null}

        {!messagesExpanded && (
          <div
            className={`saki-input-peep ${loading ? "is-loading" : ""} ${sakiFileHoverActive ? "is-dropping" : ""}`}
            onClick={onToggleMessagesExpanded}
            title="点击展开与 Saki 的完整对话"
            role="button"
            tabIndex={0}
          >
            <img
              src={artShuru}
              alt="Saki"
              className="saki-input-peep-img saki-peep-light"
              draggable={false}
            />
            <img
              src={artShuruBlack}
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
              onClick={onToggleAddMenu}
              ref={sakiAddBtnRef}
            >
              <Plus size={16} />
            </button>
          </div>
          <textarea
            ref={composerTextareaRef}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
              onMentionDismissedStart(null);
              onSyncMentionCaret(event.currentTarget);
            }}
            onClick={(event) => onSyncMentionCaret(event.currentTarget)}
            onSelect={(event) => onSyncMentionCaret(event.currentTarget)}
            onKeyUp={(event) => onSyncMentionCaret(event.currentTarget)}
            onBlur={() => {
              const active = activeSakiMentionQuery(draft, mentionCaret);
              if (active) onMentionDismissedStart(active.start);
            }}
            onKeyDown={(event) => {
              if (mentionMenuOpen && mentionCandidates.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onMentionIndexChange((current) => (current + 1) % mentionCandidates.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  onMentionIndexChange((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length);
                  return;
                }
                if (
                  (event.key === "Enter" || event.key === "Tab") &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.nativeEvent.isComposing
                ) {
                  const selected = mentionCandidates[mentionIndex] ?? mentionCandidates[0];
                  if (selected) {
                    event.preventDefault();
                    onApplyMention(selected);
                    return;
                  }
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onMentionDismissedStart(activeSakiMentionQuery(draft, mentionCaret)?.start ?? null);
                  return;
                }
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!loading && (draft.trim() || attachments.length > 0)) {
                  void onSubmit();
                }
              }
            }}
            onPaste={onComposerPaste}
            placeholder={placeholder}
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
                onClick={() => onPreviewAttachment({ attachment, editable: true })}
                onRemove={() => onRemoveAttachment(attachment)}
              />
            ))}
          </div>
        ) : null}

        {followUpQueue.length > 0 ? (
          <div className="saki-followup-queue">
            {followUpQueue.map((job, index) => (
              <button
                key={job.id}
                type="button"
                className="saki-followup-chip"
                title="从队列移除"
                onClick={() => onRemoveFollowUp(job.id)}
              >
                <span>#{index + 1}</span>
                <span>{compactContextText(job.message, 48)}</span>
                <X size={11} />
              </button>
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
              onClick={onToggleSpeechInput}
            >
              <Mic size={15} />
            </button>
            <button
              className={`icon-button mini ${annotationMode ? "active" : ""}`}
              type="button"
              title={annotationMode ? "取消注释选择" : "注释选中文本"}
              aria-pressed={annotationMode}
              disabled={loading}
              onClick={onToggleSelectionAnnotation}
            >
              <TextQuote size={15} />
            </button>
            <button
              className={`icon-button mini ${composerBusy === "image" ? "active" : ""}`}
              type="button"
              title="粘贴图片 / 选择图片"
              disabled={composerBusy !== null}
              onClick={() => void onPasteImageFromClipboard()}
            >
              <ImageIcon size={15} />
            </button>
            <button
              className={`icon-button mini ${composerBusy === "file" ? "active" : ""}`}
              type="button"
              title="上传文件"
              disabled={composerBusy !== null}
              onClick={() => onOpenComposerFilePicker(attachmentInputRef.current)}
            >
              <Paperclip size={15} />
            </button>
            <button
              className={`icon-button mini ${composerBusy === "screenshot" ? "active" : ""}`}
              type="button"
              title="网页截图"
              disabled={composerBusy !== null}
              onClick={() => void onCaptureScreenAttachment()}
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
                  onClick={() => onSelectMode("chat")}
                >
                  <MessageSquare size={14} />
                </button>
              ) : null}
              {canUseAgent ? (
                <button
                  className={`saki-mode-icon-btn ${mode === "agent" ? "active" : ""}`}
                  type="button"
                  title="智能体模式"
                  onClick={() => onSelectMode("agent")}
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
                  onClick={onTogglePermissionDropdown}
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
              <button className="saki-model-btn" type="button" onClick={onToggleModelDropdown}>
                <Zap size={12} />
                <span className="saki-model-full-name">
                  {currentModelName || availableModels.find((m) => m.id === currentModelId)?.label || currentModelId}
                </span>
                <span className="saki-model-short-name">
                  {(() => {
                    const raw =
                      currentModelName || availableModels.find((m) => m.id === currentModelId)?.label || currentModelId;
                    const seg = raw.split(/[/:]/).pop() || raw;
                    return seg.split(/[-\s]/).slice(0, 2).join("-");
                  })()}
                </span>
                <ChevronDown size={10} />
              </button>
            </div>

            {/* Steer & Send */}
            {loading && draft.trim() ? (
              <button
                className="saki-steer-btn"
                type="button"
                title="插入当前任务，当前步骤后生效"
                onClick={() => void onSubmit(undefined, { message: draft, steer: true })}
              >
                插入
              </button>
            ) : null}
            <button
              className={`primary-button send-btn ${loading && !draft.trim() ? "stop" : ""}`}
              type={loading && !draft.trim() ? "button" : "submit"}
              title={loading && draft.trim() ? "加入队列，当前任务结束后开始" : loading ? "停止生成" : "Ctrl+Enter 发送"}
              aria-label={loading && draft.trim() ? "加入队列" : loading ? "停止生成" : "Ctrl+Enter 发送"}
              disabled={!loading && !draft.trim() && attachments.length === 0}
              onClick={loading && !draft.trim() ? onStopSakiGeneration : undefined}
            >
              {loading && !draft.trim() ? <Square size={13} /> : <ArrowRight size={15} />}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
});
