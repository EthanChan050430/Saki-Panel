import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AnnouncementItem } from "./api.js";
import { useGlobalEvent, useGlobalEventConnectionState } from "./GlobalEventContext.js";

const POLL_INTERVAL_MS = 60_000;

export function useAnnouncements(token: string, onAuthError?: () => void) {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const tokenRef = useRef(token);
  const authErrorRef = useRef(onAuthError);
  const requestSeq = useRef(0);
  tokenRef.current = token;
  authErrorRef.current = onAuthError;

  const refresh = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    const seq = ++requestSeq.current;
    try {
      const next = await api.announcements(currentToken);
      if (seq !== requestSeq.current || currentToken !== tokenRef.current) return;
      setItems(Array.isArray(next) ? next : []);
      setLoaded(true);
    } catch (error) {
      if (seq !== requestSeq.current || currentToken !== tokenRef.current) return;
      if (error instanceof ApiError && error.status === 401) authErrorRef.current?.();
    }
  }, []);

  useEffect(() => {
    setItems([]);
    setLoaded(false);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      requestSeq.current++;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [token, refresh]);

  const connection = useGlobalEventConnectionState();
  useEffect(() => {
    if (connection === "connected") void refresh();
  }, [connection, refresh]);

  useGlobalEvent("announcement.changed", () => void refresh(), [refresh]);

  const ack = useCallback(
    async (id: string, input: { popupShown?: boolean; read?: boolean }) => {
      const currentToken = tokenRef.current;
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                readAt: input.read ? (item.readAt ?? now) : item.readAt,
                popupShownAt: input.popupShown ? (item.popupShownAt ?? now) : item.popupShownAt
              }
            : item
        )
      );
      try {
        await api.ackAnnouncement(currentToken, id, input);
      } catch (error) {
        if (currentToken !== tokenRef.current) return;
        void refresh();
        if (error instanceof ApiError && error.status === 401) authErrorRef.current?.();
      }
    },
    [refresh]
  );

  const unreadCount = items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0);

  return { items, loaded, unreadCount, refresh, ack };
}
