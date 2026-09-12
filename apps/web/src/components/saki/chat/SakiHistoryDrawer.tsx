import React, { useMemo } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { sakiConversationTimestamp, sortSakiConversationsByTime, type StoredSakiConversation } from "../SakiComponents.js";

export interface SakiHistoryDrawerProps {
  isOpen: boolean;
  activeConversationId: string | null;
  storedConversations: StoredSakiConversation[];
  onClose: () => void;
  onNewConversation: () => void;
  onLoadConversation: (conversation: StoredSakiConversation) => void;
  onDeleteConversation: (id: string) => void;
  formatDate: (timestamp?: string | null) => string;
}

export const SakiHistoryDrawer = React.memo(function SakiHistoryDrawer({
  isOpen,
  activeConversationId,
  storedConversations,
  onClose,
  onNewConversation,
  onLoadConversation,
  onDeleteConversation,
  formatDate
}: SakiHistoryDrawerProps) {
  const orderedConversations = useMemo(
    () => sortSakiConversationsByTime(storedConversations),
    [storedConversations]
  );

  if (!isOpen) return null;

  return (
    <aside className="saki-history-panel" aria-label="Saki history">
      <div className="saki-history-heading">
        <span>历史记录</span>
        <button className="icon-button mini" type="button" title="关闭" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <button className="small-button saki-history-new" type="button" onClick={onNewConversation}>
        <Plus size={14} />
        新对话
      </button>
      <div className="saki-history-list">
        {orderedConversations.length === 0 ? (
          <p>暂无历史对话</p>
        ) : (
          orderedConversations.map((conversation) => {
            const lastActive = sakiConversationTimestamp(conversation);
            const lastActiveAt = lastActive > 0 ? new Date(lastActive).toISOString() : conversation.updatedAt;
            return (
            <div
              className={conversation.id === activeConversationId ? "saki-history-item active" : "saki-history-item"}
              key={conversation.id}
            >
              <button type="button" onClick={() => onLoadConversation(conversation)}>
                <strong>{conversation.title}</strong>
                <span>{conversation.label} · {formatDate(lastActiveAt)}</span>
              </button>
              <button
                className="icon-button mini danger-action"
                type="button"
                title="删除"
                onClick={() => onDeleteConversation(conversation.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
            );
          })
        )}
      </div>
    </aside>
  );
});
