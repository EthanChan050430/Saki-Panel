import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translateDomText, usePanelLanguage } from "../../i18n/index.js";
import { DashboardAgentMessage, type DashboardChatMessage } from "./DashboardAgentConversation.js";
import { dashboardIsCodeChange, dashboardLatestUntrackedTerminalIndex, dashboardRollbackActions } from "./message-operations.js";
import type { ComponentProps } from "react";

type MessageProps = ComponentProps<typeof DashboardAgentMessage>;
const pageSize = 40;

export function DashboardMessageList({ messages, rollbackCodeMessageIds, hasEarlierMessages, earlierLoading, onLoadEarlierMessages, ...props }: Omit<MessageProps, "message" | "canRollbackCode" | "selectedActionId" | "rollbackBlocked"> & {
  hasEarlierMessages?: boolean;
  earlierLoading?: boolean;
  onLoadEarlierMessages?: () => Promise<void>;
  messages: DashboardChatMessage[];
  rollbackCodeMessageIds: Set<string>;
  selectedTool: { messageId: string; actionId: string } | null;
}) {
  const { language } = usePanelLanguage();
  const [earliestId, setEarliestId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prependRef = useRef<{ top: number; height: number } | null>(null);
  const showLoadedRef = useRef(false);
  const loadingRef = useRef(false);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const onSelectAction = useCallback<NonNullable<MessageProps["onSelectAction"]>>((...args) => callbacksRef.current.onSelectAction(...args), []);
  const onDecide = useCallback<NonNullable<MessageProps["onDecide"]>>((...args) => callbacksRef.current.onDecide(...args), []);
  const onMessageOperation = useCallback<NonNullable<MessageProps["onMessageOperation"]>>(async (...args) => { await callbacksRef.current.onMessageOperation?.(...args); }, []);
  const onPreviewAttachment = useCallback<NonNullable<MessageProps["onPreviewAttachment"]>>((...args) => callbacksRef.current.onPreviewAttachment?.(...args), []);
  const visible = useMemo(() => messages.filter(message => !message.rollbackJournal
    || dashboardRollbackActions([message]).some(dashboardIsCodeChange)), [messages]);
  const rollbackBlockedIds = useMemo(() => {
    const lastUntracked = dashboardLatestUntrackedTerminalIndex(messages);
    if (lastUntracked < 0) return new Set<string>();
    const nextUser = messages.findIndex((message, index) => index > lastUntracked && message.role === "user");
    return new Set(messages.slice(0, nextUser < 0 ? messages.length : nextUser).map(message => message.id));
  }, [messages]);
  const anchorIndex = earliestId ? visible.findIndex((message) => message.id === earliestId) : -1;
  const start = showLoadedRef.current ? 0 : anchorIndex >= 0 ? anchorIndex : Math.max(0, visible.length - pageSize);

  const loadMore = async () => {
    if (loadingRef.current || earlierLoading || start === 0 && !hasEarlierMessages) return;
    const stream = containerRef.current?.closest<HTMLElement>(".dashboard-chat-stream");
    if (stream) prependRef.current = { top: stream.scrollTop, height: stream.scrollHeight };
    if (start > 0) {
      setEarliestId(visible[Math.max(0, start - pageSize)]!.id);
    } else if (hasEarlierMessages && onLoadEarlierMessages) {
      loadingRef.current = true;
      showLoadedRef.current = true;
      try { await onLoadEarlierMessages(); }
      finally { loadingRef.current = false; }
    }
  };
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    const stream = containerRef.current?.closest<HTMLElement>(".dashboard-chat-stream");
    const onScroll = () => { if (stream && stream.scrollTop < 120) void loadMoreRef.current(); };
    stream?.addEventListener("scroll", onScroll);
    return () => stream?.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const previous = prependRef.current;
    const stream = containerRef.current?.closest<HTMLElement>(".dashboard-chat-stream");
    if (previous && stream && !earlierLoading) {
      stream.scrollTop = previous.top + stream.scrollHeight - previous.height;
      prependRef.current = null;
    }
  }, [earliestId, messages, earlierLoading]);

  return <div ref={containerRef} className="dashboard-message-list">
    {start > 0 || hasEarlierMessages ? <div className="dashboard-history-more">
      <button className="secondary-button" type="button" disabled={earlierLoading} onClick={() => void loadMore()}>
        {translateDomText(earlierLoading ? "正在加载…" : start > 0 ? `显示更早的消息（还有 ${start} 条）` : "加载更早的消息", language)}</button>
    </div> : null}
    {visible.slice(start).map((message) => message.rollbackJournal ? (
      <div key={message.id} className="dashboard-history-more">
        <button className="secondary-button" type="button" disabled={Boolean(props.busyId)}
          onClick={() => void onMessageOperation(message.id, "rollback_saved_files").catch(() => {})}>
          {translateDomText("还原已撤回对话的文件改动", language)}
        </button>
      </div>
    ) : <DashboardAgentMessage key={message.id} message={message}
      token={props.token}
      busyId={props.busyId} selectedActionId={props.selectedTool?.messageId === message.id ? props.selectedTool.actionId : undefined}
      onSelectAction={onSelectAction} onDecide={onDecide}
      {...(props.onMessageOperation ? { onMessageOperation } : {})}
      onPreviewAttachment={onPreviewAttachment}
      copiedMessageId={props.copiedMessageId === message.id ? message.id : null}
      rollbackBlocked={rollbackBlockedIds.has(message.id)}
      canRollbackCode={rollbackCodeMessageIds.has(message.id)} />)}
  </div>;
}
