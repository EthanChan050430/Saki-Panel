// Frontend WebSocket client for the panel's global event bus.
//
// Design goals:
//   - Single shared WebSocket for all subscribers (no N connections per page).
//   - Automatic reconnect with exponential backoff, stops on logout.
//   - Lightweight pub/sub; subscribers MUST call the returned unsubscribe fn.
//   - Works even when no event is ever received (cleanup on unmount is still required).
//
// Usage:
//   import { GlobalEventProvider, useGlobalEvent } from "./GlobalEventContext";
//
//   function App() {
//     return (
//       <GlobalEventProvider>
//         <Workspace />
//       </GlobalEventProvider>
//     );
//   }
//
//   function SomeView() {
//     useGlobalEvent("INSTANCE_STATE_CHANGED", (event) => {
//       console.log("instance changed", event.data);
//     });
//     // ...
//   }

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";

export interface GlobalEvent {
  type: string;
  timestamp: number;
  data?: unknown;
}

type Listener = (event: GlobalEvent) => void;

interface GlobalEventContextValue {
  connectionState: "connecting" | "connected" | "disconnected";
  subscribe: (type: string, listener: Listener) => () => void;
}

const GlobalEventContext = createContext<GlobalEventContextValue | null>(null);

export function GlobalEventProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] = useState<GlobalEventContextValue["connectionState"]>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<Listener>>>(new Map());
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);

  const subscribe = useMemo(() => {
    return (type: string, listener: Listener): (() => void) => {
      if (disposedRef.current) return () => {};
      let set = listenersRef.current.get(type);
      if (!set) {
        set = new Set();
        listenersRef.current.set(type, set);
      }
      set.add(listener);
      // Auto-init connection on first subscribe (lazy start, saves WS when nobody cares).
      if (!socketRef.current) {
        connect();
      }
      return () => {
        const bucket = listenersRef.current.get(type);
        if (bucket) bucket.delete(listener);
      };
    };
  }, []);

  const connect = () => {
    if (disposedRef.current) return;
    if (socketRef.current) return;

    setConnectionState(reconnectAttemptRef.current > 0 ? "disconnected" : "connecting");
    const socket = new WebSocket(api.eventsUrl());
    socketRef.current = socket;

    socket.onopen = () => {
      if (disposedRef.current) { socket.close(); return; }
      reconnectAttemptRef.current = 0;
      setConnectionState("connected");
    };

    socket.onmessage = (ev: MessageEvent) => {
      if (disposedRef.current) return;
      try {
        const parsed = JSON.parse(ev.data) as GlobalEvent;
        const bucket = listenersRef.current.get(parsed.type);
        if (bucket) {
          for (const fn of bucket) {
            try { fn(parsed); } catch (err) { console.error("[global-event] subscriber error", err); }
          }
        }
        // Also dispatch to wildcard "*" subscribers.
        const any = listenersRef.current.get("*");
        if (any) {
          for (const fn of any) {
            try { fn(parsed); } catch (err) { console.error("[global-event] * subscriber error", err); }
          }
        }
      } catch {
        // ignore malformed frames (e.g. heartbeat text)
      }
    };

    const scheduleReconnect = () => {
      if (disposedRef.current) return;
      socketRef.current = null;
      setConnectionState("disconnected");
      reconnectAttemptRef.current += 1;
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptRef.current - 1), 30_000);
      reconnectTimerRef.current = window.setTimeout(() => connect(), delay);
    };

    socket.onclose = () => scheduleReconnect();
    socket.onerror = () => { try { socket.close(); } catch { /* noop */ } };
  };

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const s = socketRef.current;
      if (s && (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING)) {
        s.close();
      }
      socketRef.current = null;
    };
  }, []);

  const value = useMemo<GlobalEventContextValue>(
    () => ({ connectionState, subscribe }),
    [connectionState, subscribe],
  );

  return <GlobalEventContext.Provider value={value}>{children}</GlobalEventContext.Provider>;
}

export function useGlobalEvent(type: string, listener: Listener, deps: unknown[] = []): void {
  const ctx = useContext(GlobalEventContext);
  useEffect(() => {
    if (!ctx) {
      console.warn("[useGlobalEvent] No GlobalEventProvider found. Did you wrap <App/>?");
      return;
    }
    const unsub = ctx.subscribe(type, listener);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, ctx?.subscribe, ...deps]);
}

export function useGlobalEventConnectionState(): GlobalEventContextValue["connectionState"] {
  const ctx = useContext(GlobalEventContext);
  if (!ctx) return "disconnected";
  return ctx.connectionState;
}
