import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DashboardAgentMessage, type DashboardChatMessage } from "./DashboardAgentConversation.js";
import type { ComponentProps } from "react";

type MessageProps = ComponentProps<typeof DashboardAgentMessage>;
const pageSize = 40;

export function DashboardMessageList({ messages, rollbackCodeMessageIds, ...props }: Omit<MessageProps, "message" | "canRollbackCode" | "selectedActionId"> & {
  messages: DashboardChatMessage[];
  rollbackCodeMessageIds: Set<string>;
  selectedTool: { messageId: string; actionId: string } | null;
}) {
  const [earliestId, setEarliestId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prependRef = useRef<{ top: number; height: number } | null>(null);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const onSelectAction = useCallback<NonNullable<MessageProps["onSelectAction"]>>((...args) => callbacksRef.current.onSelectAction(...args), []);
  const onDecide = useCallback<NonNullable<MessageProps["onDecide"]>>((...args) => callbacksRef.current.onDecide(...args), []);
  const onMessageOperation = useCallback<NonNullable<MessageProps["onMessageOperation"]>>(async (...args) => { await callbacksRef.current.onMessageOperation?.(...args); }, []);
  const onPreviewAttachment = useCallback<NonNullable<MessageProps["onPreviewAttachment"]>>((...args) => callbacksRef.current.onPreviewAttachment?.(...args), []);
  const visible = useMemo(() => messages.filter((message) => !message.rollbackJournal), [messages]);
  const anchorIndex = earliestId ? visible.findIndex((message) => message.id === earliestId) : -1;
  const start = anchorIndex >= 0 ? anchorIndex : Math.max(0, visible.length - pageSize);

  useLayoutEffect(() => {
    const previous = prependRef.current;
    const stream = containerRef.current?.closest<HTMLElement>(".dashboard-chat-stream");
    if (previous && stream) {
      stream.scrollTop = previous.top + stream.scrollHeight - previous.height;
      prependRef.current = null;
    }
  }, [earliestId]);

  return <div ref={containerRef} className="dashboard-message-list">
    {start > 0 ? <div className="dashboard-history-more">
      <button className="secondary-button" type="button" onClick={() => {
        const stream = containerRef.current?.closest<HTMLElement>(".dashboard-chat-stream");
        if (stream) prependRef.current = { top: stream.scrollTop, height: stream.scrollHeight };
        setEarliestId(visible[Math.max(0, start - pageSize)]!.id);
      }}>显示更早的消息（还有 {start} 条）</button>
    </div> : null}
    {visible.slice(start).map((message) => <DashboardAgentMessage key={message.id} message={message}
      busyId={props.busyId} selectedActionId={props.selectedTool?.messageId === message.id ? props.selectedTool.actionId : undefined}
      onSelectAction={onSelectAction} onDecide={onDecide}
      {...(props.onMessageOperation ? { onMessageOperation } : {})}
      onPreviewAttachment={onPreviewAttachment}
      copiedMessageId={props.copiedMessageId === message.id ? message.id : null}
      canRollbackCode={rollbackCodeMessageIds.has(message.id)} />)}
  </div>;
}
