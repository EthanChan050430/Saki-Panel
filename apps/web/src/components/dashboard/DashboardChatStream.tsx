import { useLayoutEffect, useRef, type ReactNode } from "react";

export function DashboardChatStream({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const streamRef = useRef<HTMLDivElement>(null);
  const followBottomRef = useRef(true);
  const scrollTopRef = useRef(0);

  useLayoutEffect(() => {
    followBottomRef.current = true;
    scrollTopRef.current = 0;
  }, [resetKey]);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (stream && followBottomRef.current) {
      stream.scrollTop = stream.scrollHeight;
      scrollTopRef.current = stream.scrollTop;
    }
  }, [children, resetKey]);

  return <div className="dashboard-chat-stream" ref={streamRef} tabIndex={0} aria-label="Agent 对话"
    onWheel={(event) => { if (event.deltaY < 0) followBottomRef.current = false; }}
    onTouchMove={() => { followBottomRef.current = false; }}
    onKeyDown={(event) => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followBottomRef.current = false; }}
    onScroll={(event) => {
      const stream = event.currentTarget;
      const movingUp = stream.scrollTop < scrollTopRef.current;
      followBottomRef.current = !movingUp && stream.scrollHeight - stream.scrollTop - stream.clientHeight <= 48;
      scrollTopRef.current = stream.scrollTop;
    }}>
    {children}
  </div>;
}
