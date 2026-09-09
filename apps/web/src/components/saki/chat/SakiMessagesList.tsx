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
import type { SakiAgentAction, SakiInputAttachment } from "@webops/shared";
import type { LocalSakiMessage } from "../../../types/app.js";
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
  onRollbackUserTurn: (messageId: string) => Promise<void> | void;
  onCopyUserMessage: (messageId: string, content: string) => Promise<void> | void;
  onCopyAssistantMessage?: (messageId: string, content: string) => Promise<void> | void;
  onRetryAssistantTurn?: (messageId: string) => Promise<void> | void;
  onDeleteAssistantTurn?: (messageId: string) => Promise<void> | void;
  onDecideAction: (targetAction: SakiAgentAction, decision: "approve" | "reject" | "rollback") => Promise<void> | void;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  onRollbackAllFileActions: (messageId: string, fileRollbackActions: SakiAgentAction[]) => Promise<void> | void;
  onPreviewAttachment: (preview: { attachment: SakiInputAttachment; editable: boolean }) => void;
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
  onRollbackUserTurn,
  onCopyUserMessage,
  onCopyAssistantMessage,
  onRetryAssistantTurn,
  onDeleteAssistantTurn,
  onDecideAction,
  onOpenPath,
  onRollbackAllFileActions,
  onPreviewAttachment
}: SakiMessagesListProps) {
  return (
    <div className="saki-messages" ref={messagesRef} onScroll={onScroll}>
      {messages.map((message) => {
        const actionItems = visibleSakiActions(message.actions);
        const fileRollbackActions = actionItems.filter(isSakiFileRollbackAction);
        const rollbackableFileActions = fileRollbackActions.filter(isSakiRollbackableFileEdit);
        const timelineItems = message.role === "assistant" ? renderableSakiTimeline(message) : [];
        const precedingUser = message.role === "assistant" ? findPrecedingUserMessage(messages, message.id) : null;
        const showAssistantActions = Boolean(onCopyAssistantMessage) && message.role === "assistant" && message.id !== "saki-welcome" && !message.streaming;

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
                  <button
                    className="saki-user-action-btn rollback-btn"
                    type="button"
                    title="回退到此对话并撤销所有修改"
                    disabled={Boolean(actionBusyId)}
                    onClick={() => void onRollbackUserTurn(message.id)}
                  >
                    {actionBusyId === `rollback_user:${message.id}` ? (
                      <Loader2 size={12} className="status-spinner" />
                    ) : (
                      <CornerUpLeft size={12} />
                    )}
                    <span>回退</span>
                  </button>
                  <button
                    className="saki-user-action-btn copy-btn"
                    type="button"
                    title="复制提问内容"
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
                    return (
                      <div className="saki-tool-timeline-item" key={item.id}>
                        <SakiToolActionCard
                          action={item.action}
                          actionBusyId={actionBusyId}
                          onDecision={(targetAction, decision) => void onDecideAction(targetAction, decision)}
                          onOpenPath={onOpenPath}
                        />
                      </div>
                    );
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
                {message.streaming && message.workflow?.length ? (
                  <SakiStreamStatus workflow={message.workflow} />
                ) : null}
                {fileRollbackActions.length > 1 ? (
                  <div className="saki-rollback-bulk">
                    <span>
                      {rollbackableFileActions.length} / {fileRollbackActions.length} 个文件改动可回滚
                    </span>
                    <button
                      className="small-button"
                      type="button"
                      disabled={Boolean(actionBusyId) || rollbackableFileActions.length === 0}
                      onClick={() => void onRollbackAllFileActions(message.id, fileRollbackActions)}
                    >
                      {actionBusyId === `rollback_all:${message.id}` ? (
                        <Loader2 size={14} className="status-spinner" />
                      ) : (
                        <CornerUpLeft size={14} />
                      )}
                      全部回滚
                    </button>
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
                const hasAnswer = Boolean(parsed.answer.trim());
                const isThinkingStreaming = Boolean(message.streaming && !hasAnswer);
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
                  </div>
                );
              })()
            ) : message.role === "assistant" ? (
              <div className="saki-message-body saki-message-body-failed">
                <div className="saki-message-failed-notice">
                  <AlertTriangle size={14} className="saki-failed-icon" />
                  <span>{message.source === "local-fallback" ? "Agent 执行中断或未完成" : "未收到 Agent 回应"}</span>
                </div>
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
                  <SakiAttachmentChip
                    attachment={attachment}
                    key={attachment.id ?? `${attachment.name}-${index}`}
                    onClick={() => onPreviewAttachment({ attachment, editable: false })}
                  />
                ))}
              </div>
            ) : null}

            {showAssistantActions ? (
              <div className="saki-assistant-message-actions">
                <button
                  className="saki-user-action-btn copy-btn"
                  type="button"
                  title="复制回复"
                  onClick={() => void onCopyAssistantMessage?.(message.id, assistantVisibleText(message))}
                >
                  {copiedAssistantMessageId === message.id ? (
                    <Check size={12} style={{ color: "#10b981" }} />
                  ) : (
                    <Copy size={12} />
                  )}
                  <span>{copiedAssistantMessageId === message.id ? "已复制" : "复制"}</span>
                </button>
                {precedingUser && onRetryAssistantTurn ? (
                  <button
                    className="saki-user-action-btn retry-btn"
                    type="button"
                    title="回滚本次代码改动并重新生成"
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
    </div>
  );
});
