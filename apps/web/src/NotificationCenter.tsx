import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";
import { useGlobalEvent } from "./GlobalEventContext.js";

export type NotificationLevel = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  level: NotificationLevel;
  message: string;
  title?: string;
  createdAt: number;
  durationMs?: number;          // undefined = manual dismiss only
  action?: { label: string; onClick: () => void };
  metadata?: Record<string, unknown>;
}

interface NotificationCenterValue {
  notifications: Notification[];
  pushNotification: (
    level: NotificationLevel,
    message: string,
    opts?: Partial<Pick<Notification, "title" | "durationMs" | "action" | "metadata">>,
  ) => string;
  dismissNotification: (id: string) => void;
  clearAll: () => void;
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null);

function makeId(): string {
  return `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const dismissTimers = useRef<Map<string, number>>(new Map());

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const t = dismissTimers.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      dismissTimers.current.delete(id);
    }
  }, []);

  const pushNotification = useCallback<NotificationCenterValue["pushNotification"]>(
    (level, message, opts) => {
      const id = makeId();
      const notif: Notification = {
        id,
        level,
        message,
        createdAt: Date.now(),
        ...(opts?.title !== undefined ? { title: opts.title } : {}),
        ...(opts?.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
        ...(opts?.action !== undefined ? { action: opts.action } : {}),
        ...(opts?.metadata !== undefined ? { metadata: opts.metadata } : {}),
      };
      setNotifications((prev) => [...prev, notif]);
      if (notif.durationMs !== undefined && notif.durationMs > 0) {
        const timer = window.setTimeout(() => dismissNotification(id), notif.durationMs);
        dismissTimers.current.set(id, timer);
      }
      return id;
    },
    [dismissNotification],
  );

  const clearAll = useCallback(() => {
    for (const t of dismissTimers.current.values()) window.clearTimeout(t);
    dismissTimers.current.clear();
    setNotifications([]);
  }, []);

  const value = useMemo<NotificationCenterValue>(
    () => ({ notifications, pushNotification, dismissNotification, clearAll }),
    [notifications, pushNotification, dismissNotification, clearAll],
  );

  // Auto-subscribe to instance state changes from the global event bus.
  useGlobalEvent("INSTANCE_STATE_CHANGED", (event) => {
    const data = event.data as { instanceId: string; fromStatus?: string; toStatus?: string; action?: string } | undefined;
    if (!data) return;
    const action = data.action ?? data.toStatus ?? "changed";
    const label = action === "start" ? "started"
      : action === "stop" ? "stopped"
      : action === "restart" ? "restarted"
      : action === "kill" ? "killed"
      : action.toLowerCase();
    const level: NotificationLevel = data.toStatus === "RUNNING" ? "success"
      : data.toStatus === "EXITED" || data.toStatus === "STOPPED" ? "info"
      : data.toStatus === "FAILED" ? "error"
      : "info";
    pushNotification(level, `Instance ${label}`, {
      durationMs: 5000,
      metadata: { instanceId: data.instanceId },
    });
  });

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter(): NotificationCenterValue {
  const ctx = useContext(NotificationCenterContext);
  if (!ctx) {
    throw new Error("useNotificationCenter must be used inside <NotificationProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Bare-bones in-panel bar. Styled via BEM-like classes so the existing
// panel stylesheet (which already has `.page-error`) can be extended.
// ---------------------------------------------------------------------------

const LEVEL_ICON: Record<NotificationLevel, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function NotificationBar() {
  const { notifications, dismissNotification } = useNotificationCenter();
  if (notifications.length === 0) return null;

  // Show at most 3 stacked; newest first.
  const visible = notifications.slice(-3).reverse();

  return (
    <div className="notification-bar" role="region" aria-label="Notifications">
      {visible.map((n) => {
        const Icon = LEVEL_ICON[n.level];
        const cls = `notification notification--${n.level}`;
        return (
          <div key={n.id} className={cls} role="status">
            <Icon size={16} className="notification-icon" aria-hidden="true" />
            <div className="notification-body">
              {n.title ? <div className="notification-title">{n.title}</div> : null}
              <div className="notification-message">{n.message}</div>
            </div>
            {n.action ? (
              <button
                type="button"
                className="notification-action"
                onClick={() => { n.action?.onClick(); dismissNotification(n.id); }}
              >
                {n.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="notification-close"
              onClick={() => dismissNotification(n.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
