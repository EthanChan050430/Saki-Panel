import React from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  CornerUpLeft,
  Loader2,
  RotateCw,
  Trash2
} from "lucide-react";
import { MarkdownContent } from "../../common/MarkdownContent.js";
import { isSakiImageAttachment, type InstanceGitChangesSummary, type SakiAgentAction, type SakiChatMode, type SakiInputAttachment } from "@webops/shared";
import { SakiChatGeneratedImages } from "./SakiChatImages.js";
import { SakiRetryCard } from "./SakiAgentWidgets.js";
import { SakiChangedFilesPill, SakiCodeChangesDetails, filterGitChangesForSession } from "./SakiCodeChanges.js";
import type { LocalSakiMessage } from "../../../types/app.js";
import { SakiMoreMenu } from "./SakiMoreMenu.js";
import { compactSakiTimeline } from "./timeline-presentation.js";
import {
  SakiAttachmentChip,
  SakiPendingToolCard,
  SakiStreamStatus,
  SakiThinkingActionCard,
  SakiToolActionCard,
  assistantVisibleText,
  isSakiFileRollbackAction,
  isSakiRollbackableFileEdit,
  parseThinkingContent,
  renderableSakiTimeline,
  visibleSakiActions
} from "../SakiComponents.js";

export interface SakiMessagesListProps {
  mode?: SakiChatMode;
  messagesRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  messages: LocalSakiMessage[];
  loading: boolean;
  hasStreamingAssistant: boolean;
  avatar: string;
  thinkingGif: string;
  actionBusyId: string | null;
  copiedUserMessageId: string | null;
  copiedAssistantMessageId?: string | null;
  dismissedRetryId?: string | null;
  onDismissRetry?: (messageId: string) => void;
  onRollbackUserTurn: (messageId: string) => Promise<void> | void;
  onCopyUserMessage: (messageId: string, content: string) => Promise<void> | void;
  onCopyAssistantMessage?: (messageId: string, content: string) => Promise<void> | void;
  onRetryAssistantTurn?: (messageId: string) => Promise<void> | void;
  onDeleteAssistantTurn?: (messageId: string) => Promise<void> | void;
  onDecideAction: (targetAction: SakiAgentAction, decision: "approve" | "reject" | "rollback") => Promise<void> | void;
  onAnswerQuestion: (targetAction: SakiAgentAction, answer: { selection?: string; customText?: string; skipped?: boolean }) => Promise<void> | void;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  onRollbackAllFileActions: (messageId: string, fileRollbackActions: SakiAgentAction[]) => Promise<void> | void;
  onPreviewAttachment: (preview: { attachment: SakiInputAttachment; editable: boolean }) => void;
  token: string;
  changesSummary?: InstanceGitChangesSummary | null | undefined;
  showCodeChangesDetails?: boolean | undefined;
  revertingChanges?: boolean | undefined;
  changesLoading?: boolean | undefined;
  onToggleCodeChangesDetails?: (() => void) | undefined;
  onCloseCodeChangesDetails?: (() => void) | undefined;
  onRevertAllChanges?: (() => Promise<void>) | undefined;
  onRestoreAllChanges?: (() => Promise<void>) | undefined;
}

function findPrecedingUserMessage(messages: LocalSakiMessage[], assistantId: string): LocalSakiMessage | null {
  const index = messages.findIndex((message) => message.id === assistantId);
  if (index <= 0) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = messages[cursor];
    if (candidate?.role === "user") return candidate;
  }
  return null;
}

export const SakiMessagesList = React.memo(function SakiMessagesList({
  mode = "chat",
  messagesRef,
  onScroll,
  messages,
  loading,
  hasStreamingAssistant,
  avatar,
  thinkingGif,
  actionBusyId,
  copiedUserMessageId,
  copiedAssistantMessageId = null,
  dismissedRetryId = null,
  onDismissRetry,
  onRollbackUserTurn,
  onCopyUserMessage,
  onCopyAssistantMessage,
  onRetryAssistantTurn,
  onDeleteAssistantTurn,
  onDecideAction,
  onAnswerQuestion,
  onOpenPath,
  onRollbackAllFileActions,
  onPreviewAttachment,
  token,
  changesSummary,
  showCodeChangesDetails,
  revertingChanges,
  changesLoading,
  onToggleCodeChangesDetails,
  onCloseCodeChangesDetails,
  onRevertAllChanges,
  onRestoreAllChanges
}: SakiMessagesListProps) {
  const activeChangesSummary = React.useMemo(() => {
    return filterGitChangesForSession(changesSummary, messages);
  }, [changesSummary, messages]);

  return (
    <div className={`saki-messages${mode === "agent" ? " saki-messages-agent" : ""}`} ref={messagesRef} onScroll={onScroll}>
      {messages.filter((message) => !message.rollbackJournal).map((message) => {
        const actionItems = visibleSakiActions(message.actions).filter((action) => action.tool.toLowerCase() !== "managetodos");
        const fileRollbackActions = actionItems.filter(isSakiFileRollbackAction);
        const rollbackableFileActions = fileRollbackActions.filter(isSakiRollbackableFileEdit);
        const timelineItems = message.role === "assistant" ? compactSakiTimeline(renderableSakiTimeline(message)) : [];
        const precedingUser = message.role === "assistant" ? findPrecedingUserMessage(messages, message.id) : null;
        const showAssistantActions = Boolean(onCopyAssistantMessage) && message.role === "assistant" && message.id !== "saki-welcome" && !message.streaming;
        const showRetryCard = Boolean(
          message.role === "assistant" &&
          message.retry &&
          message.id !== dismissedRetryId &&
          onRetryAssistantTurn
        );
        let renderedRetryCard = false;
        const isRetryReasonText = (text: string) => {
          if (!message.retry?.reason) return false;
          const t = text.trim();
          const r = message.retry.reason.trim();
          return t === r || (r.length > 8 && (t.startsWith(r) || r.startsWith(t)));
        };

        return (
          <div className={`saki-message saki-message-${message.role}`} key={message.id}>
            <div className="saki-message-meta">
              {message.role === "assistant" ? (
                <img className="saki-message-avatar" src={avatar} alt="" />
              ) : null}
              <span>{message.role === "assistant" ? "Saki" : "你"}</span>
              {message.source === "local-fallback" ? <em>fallback</em> : null}
            </div>

            {message.role === "user" ? (
              <div className="saki-user-message-wrapper">
                <div className="saki-user-message-actions">
                  <SakiMoreMenu label="提问的更多操作" align="right">
                  <button
                    className="saki-user-action-btn rollback-btn"
                    type="button"
                    title="回退到此对话并撤销所有修改"
                    disabled={Boolean(actionBusyId) || loading}
                    onClick={() => void onRollbackUserTurn(message.id)}
                  >
                    {actionBusyId === `rollback_user:${message.id}` ? (
                      <Loader2 size={12} className="status-spinner" />
                    ) : (
                      <CornerUpLeft size={12} />
                    )}
                    <span>回退</span>
                  </button>
                  </SakiMoreMenu>
                  <button
                    className="saki-user-action-btn copy-btn"
                    type="button"
                    title="复制提问内容"
                    aria-label="复制提问内容"
                    onClick={() => void onCopyUserMessage(message.id, message.content)}
                  >
                    {copiedUserMessageId === message.id ? (
                      <Check size={12} style={{ color: "#10b981" }} />
                    ) : (
                      <Copy size={12} />
                    )}
                    <span>{copiedUserMessageId === message.id ? "已复制" : "复制"}</span>
                  </button>
                </div>
                <div className="saki-message-body">
                  <MarkdownContent content={message.content} />
                </div>
              </div>
            ) : message.role === "assistant" && timelineItems.length > 0 ? (
              <div className="saki-message-timeline">
                {timelineItems.map((item) => {
                  if (item.kind === "tool-group") {
                    return <details className="saki-tool-group" key={item.id}>
                      <summary>已完成 {item.items.length} 个步骤</summary>
                      {item.items.map((entry) => <SakiToolActionCard key={entry.id} action={entry.action} actionBusyId={actionBusyId}
                        onDecision={(targetAction, decision) => void onDecideAction(targetAction, decision)}
                        onAnswer={onAnswerQuestion} onOpenPath={onOpenPath} />)}
                    </details>;
                  }
                  if (item.kind === "pending") {
                    return (
                      <div className="saki-tool-timeline-item" key={item.id}>
                        <SakiPendingToolCard
                          tool={item.tool}
                          {...(item.call ? { call: item.call } : {})}
                          message={item.message}
                        />
                      </div>
                    );
                  }
                  if (item.kind === "action") {
                    if (item.action.tool.toLowerCase() === "managetodos") return null;
                    return (
                      <div className="saki-tool-timeline-item" key={item.id}>
                        <SakiToolActionCard
                          action={item.action}
                          actionBusyId={actionBusyId}
                          onDecision={(targetAction, decision) => void onDecideAction(targetAction, decision)}
                          onAnswer={(targetAction, answer) => onAnswerQuestion(targetAction, answer)}
                          onOpenPath={onOpenPath}
                        />
                      </div>
                    );
                  }
                  if (item.kind === "text" && isRetryReasonText(item.content)) {
                    if (showRetryCard && !renderedRetryCard) {
                      renderedRetryCard = true;
                      return (
                        <div key={item.id} className="saki-tool-timeline-item">
                          <SakiRetryCard
                            reason={message.retry!.reason}
                            busy={loading || Boolean(actionBusyId)}
                            onRetry={() => void onRetryAssistantTurn?.(message.id)}
                            onDismiss={() => onDismissRetry?.(message.id)}
                          />
                        </div>
                      );
                    }
                    return null;
                  }
                  const parsed = parseThinkingContent(
                    item.content,
                    item.thinking,
                    Boolean(message.streaming && item.source === "delta")
                  );
                  const hasThinking = Boolean(parsed.thinking);
                  const hasAnswer = Boolean(parsed.answer.trim());
                  const isThinkingStreaming = Boolean(message.streaming && item.source === "delta" && !hasAnswer);
                  const durationSec = item.thinkingDurationSec ?? message.thinkingDurationSec;

                  if (!hasThinking && !hasAnswer) return null;

                  return (
                    <div key={item.id} className="saki-timeline-text-item">
                      {hasThinking ? (
                        <div className="saki-tool-timeline-item" style={{ margin: "2px 0 4px 0" }}>
                          <SakiThinkingActionCard
                            thinking={parsed.thinking}
                            streaming={isThinkingStreaming}
                            durationSec={durationSec}
                          />
                        </div>
                      ) : null}
                      {hasAnswer ? (
                        <div className={`saki-message-body saki-message-body-${item.source}`}>
                          {message.streaming && item.source === "delta" ? (
                            <div className="saki-stream-raw-wrap">
                              <span className="saki-stream-raw">{parsed.answer}</span>
                              <span className="saki-stream-cursor" />
                            </div>
                          ) : (
                            <MarkdownContent content={parsed.answer} />
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {message.streaming && message.workflow?.length && !timelineItems.some((item) => item.kind === "pending") ? (
                  <SakiStreamStatus workflow={message.workflow} />
                ) : null}
                {showRetryCard && !renderedRetryCard ? (
                  <div className="saki-tool-timeline-item">
                    <SakiRetryCard
                      reason={message.retry!.reason}
                      busy={loading || Boolean(actionBusyId)}
                      onRetry={() => void onRetryAssistantTurn?.(message.id)}
                      onDismiss={() => onDismissRetry?.(message.id)}
                    />
                  </div>
                ) : null}
              </div>
            ) : message.role === "assistant" && message.streaming && !message.content && !message.thinking ? (
              <div className="saki-message-body">
                <p className="saki-stream-placeholder">等待模型响应...</p>
              </div>
            ) : message.role === "assistant" && (message.content || message.thinking) ? (
              (() => {
                const parsed = parseThinkingContent(message.content, message.thinking, Boolean(message.streaming));
                const hasThinking = Boolean(parsed.thinking);
                const isRetryAnswer = isRetryReasonText(parsed.answer);
                const hasAnswer = Boolean(parsed.answer.trim()) && !isRetryAnswer;
                const isThinkingStreaming = Boolean(message.streaming && !hasAnswer);
                if (!hasThinking && !hasAnswer && !showRetryCard) {
                  return message.streaming ? (
                    <div className="saki-message-assistant-content">
                      <div className="saki-message-body">
                        <p className="saki-stream-placeholder">等待模型响应...</p>
                      </div>
                    </div>
                  ) : null;
                }
                return (
                  <div className="saki-message-assistant-content">
                    {hasThinking ? (
                      <div className="saki-tool-timeline-item" style={{ margin: "2px 0 4px 0" }}>
                        <SakiThinkingActionCard
                          thinking={parsed.thinking}
                          streaming={isThinkingStreaming}
                          durationSec={message.thinkingDurationSec}
                        />
                      </div>
                    ) : null}
                    {hasAnswer ? (
                      <div className="saki-message-body">
                        {message.streaming ? (
                          <div className="saki-stream-raw-wrap">
                            <span className="saki-stream-raw">{parsed.answer}</span>
                            <span className="saki-stream-cursor" />
                          </div>
                        ) : (
                          <MarkdownContent content={parsed.answer} />
                        )}
                      </div>
                    ) : null}
                    {showRetryCard ? (
                      <div className="saki-tool-timeline-item">
                        <SakiRetryCard
                          reason={message.retry!.reason}
                          busy={loading || Boolean(actionBusyId)}
                          onRetry={() => void onRetryAssistantTurn?.(message.id)}
                          onDismiss={() => onDismissRetry?.(message.id)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })()
            ) : message.role === "assistant" ? (
              showRetryCard ? (
                <div className="saki-tool-timeline-item">
                  <SakiRetryCard
                    reason={message.retry!.reason}
                    busy={loading || Boolean(actionBusyId)}
                    onRetry={() => void onRetryAssistantTurn?.(message.id)}
                    onDismiss={() => onDismissRetry?.(message.id)}
                  />
                </div>
              ) : (
                <div className="saki-message-body saki-message-body-failed">
                  <div className="saki-message-failed-notice">
                    <AlertTriangle size={14} className="saki-failed-icon" />
                    <span>{message.source === "local-fallback" ? "Agent 执行中断或未完成" : "未收到 Agent 回应"}</span>
                  </div>
                </div>
              )
            ) : null}

            {message.role === "assistant" ? (
              <SakiChatGeneratedImages
                message={message}
                token={token}
                onPreview={(attachment) => onPreviewAttachment({ attachment, editable: false })}
              />
            ) : null}

            {(() => {
              const leftover = (message.attachments ?? []).filter(
                (attachment) => message.role === "user" || !isSakiImageAttachment(attachment)
              );
              if (!leftover.length) return null;
              return (
                <div className="saki-message-attachments">
                  {leftover.map((attachment, index) => (
                    <SakiAttachmentChip
                      attachment={attachment}
                      key={attachment.id ?? `${attachment.name}-${index}`}
                      onClick={() => onPreviewAttachment({ attachment, editable: false })}
                    />
                  ))}
                </div>
              );
            })()}

            {showAssistantActions ? (
              <div className="saki-assistant-message-actions">
                <button
                  className="saki-user-action-btn copy-btn"
                  type="button"
                  title="复制回复"
                  aria-label="复制回复"
                  onClick={() => void onCopyAssistantMessage?.(message.id, assistantVisibleText(message))}
                >
                  {copiedAssistantMessageId === message.id ? (
                    <Check size={12} style={{ color: "#10b981" }} />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>{copiedAssistantMessageId === message.id ? "已复制" : "复制"}</span>
                </button>
                {precedingUser && onRetryAssistantTurn && !showRetryCard ? (
                  <button
                    className="saki-user-action-btn retry-btn"
                    type="button"
                    title={message.retry ? "保留修改并继续任务" : "回滚本次代码改动并重新生成"}
                    aria-label="重试回复"
                    disabled={Boolean(actionBusyId) || loading}
                    onClick={() => void onRetryAssistantTurn(message.id)}
                  >
                    {actionBusyId === `retry:${message.id}` ? (
                      <Loader2 size={12} className="status-spinner" />
                    ) : (
                      <RotateCw size={12} />
                    )}
                    <span>重试</span>
                  </button>
                ) : null}
                {(precedingUser && onDeleteAssistantTurn) || fileRollbackActions.length > 1 || message.usage ? <SakiMoreMenu label="回复的更多操作" align="left">
                {precedingUser && onDeleteAssistantTurn ? (
                  <button
                    className="saki-user-action-btn delete-btn"
                    type="button"
                    title="删除这轮对话（含提问）"
                    disabled={Boolean(actionBusyId) || loading}
                    onClick={() => void onDeleteAssistantTurn(message.id)}
                  >
                    {actionBusyId === `delete:${message.id}` ? (
                      <Loader2 size={12} className="status-spinner" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    <span>删除</span>
                  </button>
                ) : null}
                {fileRollbackActions.length > 1 ? <button type="button" disabled={Boolean(actionBusyId) || loading || rollbackableFileActions.length === 0}
                  onClick={() => void onRollbackAllFileActions(message.id, fileRollbackActions)}>
                  <CornerUpLeft size={12} />回滚文件改动（{rollbackableFileActions.length}）
                </button> : null}
                {message.usage ? <p className="saki-token-usage-text">{message.usage.tokensUsed.toLocaleString()} Token{message.usage.isUnlimited ? "" : ` · ${message.usage.pointsUsed.toLocaleString()} 积分`}</p> : null}
                </SakiMoreMenu> : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {loading && !hasStreamingAssistant ? (
        <div className="saki-message saki-message-assistant">
          <div className="saki-message-meta">
            <img className="saki-message-avatar" src={avatar} alt="" />
            <span>Saki</span>
          </div>
          <p className="saki-thinking-bubble">
            <img src={thinkingGif} alt="" />
            <span>思考中...</span>
          </p>
        </div>
      ) : null}

      {showCodeChangesDetails && activeChangesSummary ? (
        <div className="saki-code-changes-inline-container">
          <SakiCodeChangesDetails
            summary={activeChangesSummary}
            loading={changesLoading}
            reverting={revertingChanges}
            onRevertAll={onRevertAllChanges ?? (async () => {})}
            onRestoreAll={onRestoreAllChanges ?? (async () => {})}
            onClose={onCloseCodeChangesDetails}
            onOpenPath={onOpenPath}
            variant="inline"
          />
        </div>
      ) : null}

      {!loading && !hasStreamingAssistant && activeChangesSummary && (activeChangesSummary.filesCount > 0 || activeChangesSummary.canRestore) ? (
        <div className="saki-session-bottom-changes">
          <SakiChangedFilesPill
            summary={activeChangesSummary}
            onClick={() => onToggleCodeChangesDetails?.()}
          />
        </div>
      ) : null}
    </div>
  );
});
