import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Bell, Check, Clock, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import type { IncidentStatus, ManagedIncident } from "@webops/shared";
import { api, ApiError } from "./api.js";

const activeStatuses = new Set<IncidentStatus>([
  "open",
  "diagnosing",
  "diagnosed",
  "awaiting_approval",
  "applying",
  "verifying",
  "rate_limited"
]);

function statusLabel(status: IncidentStatus): string {
  switch (status) {
    case "open":
      return "待确认";
    case "diagnosing":
      return "诊断中";
    case "diagnosed":
      return "已诊断";
    case "awaiting_approval":
      return "等待批准";
    case "applying":
      return "正在修复";
    case "verifying":
      return "验证中";
    case "resolved":
      return "已恢复";
    case "rolled_back":
      return "已回滚";
    case "failed":
      return "失败";
    case "ignored":
      return "已忽略";
    case "rate_limited":
      return "次数已满";
    default:
      return status;
  }
}

function triggerLabel(trigger: ManagedIncident["trigger"]): string {
  switch (trigger) {
    case "crash_loop":
      return "崩溃循环";
    case "disk":
      return "磁盘告警";
    case "memory":
      return "内存告警";
    default:
      return "进程崩溃";
  }
}

export function useIncidents(token: string, onAuthError: () => void) {
  const [incidents, setIncidents] = useState<ManagedIncident[]>([]);
  const [openCount, setOpenCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await api.incidents(token);
      setIncidents(response.incidents);
      setOpenCount(response.openCount);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onAuthError();
    }
  }, [onAuthError, token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const abort = new AbortController();
    void api
      .incidentsStream(
        token,
        (event) => {
          if (event.incidents) {
            setIncidents(event.incidents);
            if (typeof event.openCount === "number") setOpenCount(event.openCount);
            return;
          }
          if (event.incident) {
            setIncidents((current) => {
              const next = current.filter((item) => item.id !== event.incident!.id);
              next.unshift(event.incident!);
              return next.slice(0, 50);
            });
          }
        },
        abort.signal
      )
      .catch(() => undefined);
    return () => abort.abort();
  }, [token]);

  const active = useMemo(
    () => incidents.filter((incident) => activeStatuses.has(incident.status)),
    [incidents]
  );

  return { incidents, active, openCount, refresh };
}

export function IncidentBell({
  token,
  onLogout,
  onOpenIncident
}: {
  token: string;
  onLogout: () => void;
  onOpenIncident: (incident: ManagedIncident) => void;
}) {
  const { active, refresh } = useIncidents(token, onLogout);
  const openCount = active.length;
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const bellContainerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function placePopover() {
      const button = bellContainerRef.current?.querySelector("button");
      if (!button) return;
      const rect = button.getBoundingClientRect();
      if (window.matchMedia("(max-width: 720px)").matches) {
        setPopoverPos(null);
        return;
      }
      setPopoverPos({
        top: Math.round(rect.bottom + 10),
        right: Math.round(Math.max(12, window.innerWidth - rect.right))
      });
    }
    placePopover();
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    return () => {
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (bellContainerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function run(id: string, action: "diagnose" | "approve" | "ignore" | "rollback") {
    setBusyId(id);
    try {
      if (action === "diagnose") await api.diagnoseIncident(token, id);
      if (action === "approve") await api.approveIncident(token, id);
      if (action === "ignore") await api.ignoreIncident(token, id, { minutes: 60 });
      if (action === "rollback") await api.rollbackIncident(token, id);
      await refresh();
    } catch {
      // keep the list; next poll will reconcile
    } finally {
      setBusyId(null);
    }
  }

  const popover = open
    ? createPortal(
        <>
          <div className="incident-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={popoverRef}
            className="incident-popover"
            role="dialog"
            aria-label="Saki 值班事件"
            style={popoverPos ? { top: popoverPos.top, right: popoverPos.right } : undefined}
          >
          <div className="incident-popover-header">
            <div className="incident-popover-title-wrap">
              <strong>Saki 值班</strong>
              <span className={`incident-popover-pill ${openCount === 0 ? "is-clean" : ""}`}>
                {openCount > 0 ? `${openCount} 条未完成` : "运行正常"}
              </span>
            </div>
            <button
              type="button"
              className="incident-popover-close"
              onClick={() => setOpen(false)}
              title="关闭"
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>
          {active.length === 0 ? (
            <div className="incident-empty">
              <img
                src="/assets/expression/empty_healthy.png"
                alt="Saki Healthy"
                className="incident-empty-saki"
                draggable={false}
              />
              <strong style={{ fontSize: "14px", color: "var(--text-main, #1e293b)" }}>系统运行一切正常 ✨</strong>
              <span>暂无未完成的崩溃或告警事件</span>
            </div>
          ) : (
            <ul className="incident-list">
              {active.slice(0, 8).map((incident) => (
                <li key={incident.id} className="incident-item">
                  <button
                    className="incident-item-main"
                    type="button"
                    onClick={() => {
                      onOpenIncident(incident);
                      setOpen(false);
                    }}
                  >
                    <div className="incident-item-header-row">
                      <span className="incident-item-title">{incident.instanceName}</span>
                      <span className={`incident-badge-meta status-${incident.status}`}>
                        {triggerLabel(incident.trigger)} · {statusLabel(incident.status)}
                      </span>
                    </div>
                    <span className="incident-item-summary">{incident.summary || "等待你确认后才会消耗额度开始诊断。"}</span>
                  </button>
                  <div className="incident-item-actions">
                    {incident.status === "open" || incident.status === "diagnosed" || incident.status === "failed" ? (
                      <button
                        type="button"
                        className="incident-action-btn incident-approve-btn"
                        disabled={busyId === incident.id}
                        title="确认后才会调用模型，会消耗额度"
                        onClick={() => void run(incident.id, "diagnose")}
                      >
                        {busyId === incident.id ? <Loader2 size={12} className="status-spinner" /> : <Sparkles size={12} />}
                        {incident.status === "open" ? "确认诊断" : "再次诊断"}
                      </button>
                    ) : null}
                    {incident.status === "awaiting_approval" ? (
                      <button
                        type="button"
                        className="incident-action-btn incident-approve-btn"
                        disabled={busyId === incident.id}
                        onClick={() => void run(incident.id, "approve")}
                      >
                        {busyId === incident.id ? <Loader2 size={12} className="status-spinner" /> : <Check size={12} />}
                        批准
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="incident-action-btn incident-ignore-btn"
                      disabled={busyId === incident.id}
                      onClick={() => void run(incident.id, "ignore")}
                    >
                      <Clock size={12} />
                      忽略
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div className={`incident-bell ${open ? "is-open" : ""}`} ref={bellContainerRef}>
      <button
        className={`topbar-refresh-btn incident-bell-button ${openCount ? "has-open" : ""} ${open ? "is-active" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={openCount ? `${openCount} 条值班事件` : "值班事件"}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={14} />
        {openCount > 0 ? <span className="incident-bell-count">{openCount > 9 ? "9+" : openCount}</span> : null}
      </button>
      {popover}
    </div>
  );
}

export function IncidentBanner({
  token,
  instanceId,
  onLogout,
  onAskSaki,
  variant = "top"
}: {
  token: string;
  instanceId: string;
  onLogout: () => void;
  onAskSaki?: (() => void) | undefined;
  variant?: "top" | "panel";
}) {
  const { active, refresh } = useIncidents(token, onLogout);
  const incident = active.find((item) => item.instanceId === instanceId) ?? null;
  const [busy, setBusy] = useState(false);
  if (!incident) return null;
  if (variant === "top") return null;

  async function act(action: "diagnose" | "approve" | "ignore" | "rollback") {
    setBusy(true);
    try {
      if (action === "diagnose") await api.diagnoseIncident(token, incident!.id);
      if (action === "approve") await api.approveIncident(token, incident!.id);
      if (action === "ignore") await api.ignoreIncident(token, incident!.id, { minutes: 60 });
      if (action === "rollback") await api.rollbackIncident(token, incident!.id);
      await refresh();
    } catch {} finally {
      setBusy(false);
    }
  }

  const summary =
    incident.summary ||
    incident.rootCause ||
    "Saki 发现了问题，但不会自动消耗额度。确认后才会开始诊断。";

  const actions = (
      <div className="incident-banner-actions">
        {onAskSaki ? (
          <button className="small-button" type="button" onClick={onAskSaki}>
            <Sparkles size={14} />
            打开 Saki
          </button>
        ) : null}
        {incident.status === "open" || incident.status === "diagnosed" || incident.status === "failed" ? (
          <button
            className="small-button"
            type="button"
            disabled={busy}
            title="确认后才会调用模型，会消耗额度"
            onClick={() => void act("diagnose")}
          >
            {busy ? <Loader2 size={14} className="status-spinner" /> : <Sparkles size={14} />}
            {incident.status === "open" ? "确认诊断" : "再次诊断"}
          </button>
        ) : null}
        {incident.status === "awaiting_approval" ? (
          <button className="small-button" type="button" disabled={busy} onClick={() => void act("approve")}>
            {busy ? <Loader2 size={14} className="status-spinner" /> : <Check size={14} />}
            批准并重启
          </button>
        ) : null}
        {incident.rollbackSet.length > 0 && (incident.status === "resolved" || incident.status === "failed" || incident.status === "diagnosed") ? (
          <button className="small-button" type="button" disabled={busy} onClick={() => void act("rollback")}>
            <RotateCcw size={14} />
            回滚修复
          </button>
        ) : null}
        <button className="small-button" type="button" disabled={busy} onClick={() => void act("ignore")}>
          <X size={14} />
          忽略 1 小时
        </button>
      </div>
  );

  if (variant === "panel") {
    return (
      <div className={`glass-panel instance-side-card incident-panel-card status-${incident.status}`}>
        <div className="incident-panel-header">
          <div className="incident-panel-icon" aria-hidden="true">
            <AlertTriangle size={18} />
          </div>
          <div className="incident-panel-heading">
            <span className="incident-panel-kicker">Saki 值班</span>
            <strong>
              {triggerLabel(incident.trigger)} · {statusLabel(incident.status)}
            </strong>
          </div>
        </div>
        <div className="incident-panel-body">
          <p className="incident-panel-summary">{summary}</p>
          {incident.rootCause && incident.rootCause !== incident.summary ? (
            <p className="incident-panel-cause">{incident.rootCause}</p>
          ) : null}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className={`incident-banner status-${incident.status}`}>
      <div className="incident-banner-copy">
        <AlertTriangle size={16} />
        <div>
          <strong>
            {triggerLabel(incident.trigger)} · {statusLabel(incident.status)}
          </strong>
          <p>{summary}</p>
        </div>
      </div>
      {actions}
    </div>
  );
}
