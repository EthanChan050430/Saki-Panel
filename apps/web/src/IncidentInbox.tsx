import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Bell, BellOff, Check, CheckCheck, ChevronDown, Clock, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import type { IncidentStatus, IncidentTrigger, ManagedIncident, ManagedSilenceRule } from "@webops/shared";
import { api, ApiError } from "./api.js";

// 与后端 incidents.ts 的 activeIncidentStatuses 保持同一口径：
// openCount 与铃铛角标统计的都是"待处理"状态集合。
const activeStatuses = new Set<IncidentStatus>([
  "open",
  "diagnosing",
  "diagnosed",
  "awaiting_approval",
  "applying",
  "verifying",
  "rate_limited"
]);

// 近期完结区展示的状态（resolved/rolled_back/failed/ignored）。
const recentStatuses = new Set<IncidentStatus>(["resolved", "rolled_back", "failed", "ignored"]);

// 允许（再次）确认诊断的状态，与后端 diagnosableStatuses 一致。
const diagnosableStatuses = new Set<IncidentStatus>(["open", "diagnosed", "failed", "rate_limited"]);

const INCIDENT_LIST_LIMIT = 50;
const ACTIVE_DISPLAY_LIMIT = 20;
const RECENT_DISPLAY_LIMIT = 10;
const DIAGNOSE_CONFIRM_MS = 3000;

// 弹层左侧分类侧栏的筛选项："all" 表示不筛选。
type TriggerFilter = "all" | IncidentTrigger;

const triggerCategories: Array<{ key: TriggerFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "crash", label: "进程崩溃" },
  { key: "crash_loop", label: "崩溃循环" },
  { key: "disk", label: "磁盘告警" },
  { key: "memory", label: "内存告警" },
  { key: "webhook", label: "外部告警" },
  { key: "health", label: "健康检查" }
];

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

function statusDisplayLabel(status: IncidentStatus): string {
  return status === "resolved" ? "已恢复 ✓" : statusLabel(status);
}

function triggerLabel(trigger: ManagedIncident["trigger"]): string {
  switch (trigger) {
    case "crash_loop":
      return "崩溃循环";
    case "disk":
      return "磁盘告警";
    case "memory":
      return "内存告警";
    case "webhook":
      return "外部告警";
    case "health":
      return "健康检查";
    default:
      return "进程崩溃";
  }
}

function formatClock(value: string | number): string {
  const date = new Date(value);
  const pad = (unit: number) => String(unit).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatClockWithSeconds(value: string | number): string {
  const date = new Date(value);
  const pad = (unit: number) => String(unit).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 同一 groupKey 的连续事件折叠成一个分组块；groupKey 缺失时退回事件 id（即自成一组）。
interface IncidentGroup {
  key: string;
  items: ManagedIncident[];
}

function groupIncidents(list: ManagedIncident[]): IncidentGroup[] {
  const groups: IncidentGroup[] = [];
  for (const incident of list) {
    const key = incident.groupKey ?? incident.id;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(incident);
    } else {
      groups.push({ key, items: [incident] });
    }
  }
  return groups;
}

// 静默规则作用域文案：实例名（缺省为全部实例）+ 触发类型或指纹后 8 位。
function silenceRuleScope(rule: ManagedSilenceRule): string {
  const scope = rule.instanceName || "全部实例";
  if (rule.trigger) return `${scope} · ${triggerLabel(rule.trigger)}`;
  if (rule.fingerprint) return `${scope} · 指纹 ${rule.fingerprint.slice(-8)}`;
  return scope;
}

// 静默规则到期文案：null 为永久；当天只显示时刻，跨天带上日期。
function silenceRuleExpiry(rule: ManagedSilenceRule): string {
  if (!rule.expiresAt) return "永久";
  const date = new Date(rule.expiresAt);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? `至 ${formatClock(rule.expiresAt)}`
    : `至 ${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(rule.expiresAt)}`;
}

interface IncidentInboxState {
  incidents: ManagedIncident[];
  openCount: number;
  lastError: string | null;
  lastUpdatedAt: number | null;
}

// 模块级共享 store：IncidentBell（常驻顶栏）与 IncidentBanner / InstancesView 的
// useIncidents 可能同时挂载，共享一份数据、一条 SSE 连接和一个轮询计时器，
// 避免每个 hook 实例各自建连。
const store: {
  state: IncidentInboxState;
  listeners: Set<() => void>;
  token: string;
  onAuthError: (() => void) | null;
  refCount: number;
  pollTimer: number | null;
  sseAbort: AbortController | null;
  started: boolean;
} = {
  state: { incidents: [], openCount: 0, lastError: null, lastUpdatedAt: null },
  listeners: new Set(),
  token: "",
  onAuthError: null,
  refCount: 0,
  pollTimer: null,
  sseAbort: null,
  started: false
};

function setStoreState(patch: Partial<IncidentInboxState>) {
  store.state = { ...store.state, ...patch };
  store.listeners.forEach((listener) => listener());
}

async function refreshIncidents() {
  if (!store.token) return;
  try {
    const response = await api.incidents(store.token);
    setStoreState({
      incidents: response.incidents,
      openCount: response.openCount,
      lastError: null,
      lastUpdatedAt: Date.now()
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      store.onAuthError?.();
      return;
    }
    setStoreState({
      lastError: error instanceof Error ? error.message : "网络异常，操作未完成。"
    });
  }
}

function startIncidentFeed() {
  if (store.started) return;
  store.started = true;
  void refreshIncidents();
  store.pollTimer = window.setInterval(() => {
    void refreshIncidents();
  }, 15000);
  const abort = new AbortController();
  store.sseAbort = abort;
  void api
    .incidentsStreamWithReconnect(
      store.token,
      (event) => {
        if (event.incidents) {
          setStoreState({
            incidents: event.incidents,
            ...(typeof event.openCount === "number" ? { openCount: event.openCount } : {}),
            lastError: null,
            lastUpdatedAt: Date.now()
          });
          return;
        }
        if (event.incident) {
          const incoming = event.incident;
          const next = store.state.incidents.filter((item) => item.id !== incoming.id);
          next.unshift(incoming);
          setStoreState({
            incidents: next.slice(0, INCIDENT_LIST_LIMIT),
            lastError: null,
            lastUpdatedAt: Date.now()
          });
          return;
        }
        if (typeof event.openCount === "number") {
          setStoreState({ openCount: event.openCount });
        }
      },
      abort.signal,
      () => store.onAuthError?.()
    )
    .catch(() => undefined);
}

function stopIncidentFeed() {
  store.started = false;
  if (store.pollTimer !== null) {
    window.clearInterval(store.pollTimer);
    store.pollTimer = null;
  }
  store.sseAbort?.abort();
  store.sseAbort = null;
}

export function useIncidents(token: string, onAuthError: () => void) {
  const [state, setState] = useState(store.state);

  // onAuthError 可能每次渲染都是新引用，只同步最新值，不参与生命周期。
  useEffect(() => {
    store.onAuthError = onAuthError;
  }, [onAuthError]);

  useEffect(() => {
    if (store.token && store.token !== token) {
      // 账号切换：丢弃旧会话的连接与数据。
      stopIncidentFeed();
      store.state = { incidents: [], openCount: 0, lastError: null, lastUpdatedAt: null };
    }
    store.token = token;
    store.refCount += 1;
    startIncidentFeed();
    const listener = () => setState(store.state);
    store.listeners.add(listener);
    listener();
    return () => {
      store.listeners.delete(listener);
      store.refCount -= 1;
      if (store.refCount <= 0) {
        store.refCount = 0;
        stopIncidentFeed();
      }
    };
  }, [token]);

  const active = useMemo(
    () => state.incidents.filter((incident) => activeStatuses.has(incident.status)),
    [state.incidents]
  );
  const recent = useMemo(
    () => state.incidents.filter((incident) => recentStatuses.has(incident.status)),
    [state.incidents]
  );

  return {
    incidents: state.incidents,
    active,
    recent,
    openCount: state.openCount,
    lastError: state.lastError,
    lastUpdatedAt: state.lastUpdatedAt,
    refresh: refreshIncidents
  };
}

// 提取操作错误文案：优先服务端 message（409 冷却/预算、403 非诊断发起人等），401 走登出。
function actionErrorMessage(error: unknown, onAuthError: () => void): string | null {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      onAuthError();
      return null;
    }
    return error.message || "操作失败，请稍后重试。";
  }
  return "网络异常，操作未完成。";
}

// “确认诊断/再次诊断”会消耗额度，点击后先进入二次确认态，3 秒无操作自动恢复，
// 避免 SSE 实时插入导致列表条目移位时误触。
function useDiagnoseConfirm() {
  const [armingId, setArmingId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const disarm = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setArmingId(null);
  }, []);

  const confirm = useCallback(
    (id: string, execute: () => void) => {
      if (armingId === id) {
        disarm();
        execute();
        return;
      }
      disarm();
      setArmingId(id);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setArmingId(null);
      }, DIAGNOSE_CONFIRM_MS);
    },
    [armingId, disarm]
  );

  useEffect(() => disarm, [disarm]);

  return { armingId, confirm, disarm };
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
  const { active, recent, openCount, lastError, lastUpdatedAt, refresh } = useIncidents(token, onLogout);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all");
  const [ignoreAllBusy, setIgnoreAllBusy] = useState(false);
  // 分组展开覆盖：key 为 `${section}:${groupKey}`，未覆盖时按默认规则（待处理 ≤3 条展开，其余折叠）。
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  // 静默规则：首次展开时才拉取，之后缓存在 state；创建/删除后重新加载。
  const [silenceOpen, setSilenceOpen] = useState(false);
  const [silenceRules, setSilenceRules] = useState<ManagedSilenceRule[] | null>(null);
  const [silenceLoading, setSilenceLoading] = useState(false);
  const [silenceBusyId, setSilenceBusyId] = useState<string | null>(null);
  const { armingId, confirm: confirmDiagnose, disarm: disarmDiagnose } = useDiagnoseConfirm();
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const bellContainerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // 各分类下的事件数（待处理 + 近期完结），用于侧栏角标。
  const categoryCounts = useMemo(() => {
    const counts: Record<TriggerFilter, number> = { all: 0, crash: 0, crash_loop: 0, disk: 0, memory: 0, webhook: 0, health: 0 };
    for (const incident of [...active, ...recent]) {
      counts.all += 1;
      counts[incident.trigger] += 1;
    }
    return counts;
  }, [active, recent]);

  const visibleActive = useMemo(
    () => (triggerFilter === "all" ? active : active.filter((item) => item.trigger === triggerFilter)),
    [active, triggerFilter]
  );
  const visibleRecent = useMemo(
    () => (triggerFilter === "all" ? recent : recent.filter((item) => item.trigger === triggerFilter)),
    [recent, triggerFilter]
  );

  useEffect(() => {
    if (!open) return;
    function placePopover() {
      const button = bellContainerRef.current?.querySelector("button");
      if (!button) return;
      if (window.matchMedia("(max-width: 720px)").matches) {
        setPopoverPos(null);
        return;
      }
      const rect = button.getBoundingClientRect();
      // Align the popover's right edge with the button, but clamp so the
      // popover never slides past the viewport's left or right edge.
      const width = popoverRef.current?.offsetWidth || 500;
      const idealRight = window.innerWidth - rect.right;
      const maxRight = Math.max(12, window.innerWidth - width - 12);
      setPopoverPos({
        top: Math.round(rect.bottom + 10),
        right: Math.round(Math.min(Math.max(12, idealRight), maxRight))
      });
    }
    placePopover();
    // Re-measure after layout settles (topbar/sidebar transitions can shift
    // the button right after the popover opens).
    const settleFrame = window.requestAnimationFrame(() => placePopover());
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    return () => {
      window.cancelAnimationFrame(settleFrame);
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function run(id: string, action: "diagnose" | "approve" | "ignore" | "rollback") {
    setBusyId(id);
    setActionError(null);
    try {
      if (action === "diagnose") await api.diagnoseIncident(token, id);
      if (action === "approve") {
        const result = await api.approveIncident(token, id);
        // 批量批准逐项执行：单项失败不再 500，需要把部分失败提示出来。
        if (!result.ok && result.results?.some((item) => !item.ok)) {
          setActionError("部分变更应用失败，其余已应用。");
        }
      }
      if (action === "ignore") {
        const ignored = await api.ignoreIncident(token, id, { minutes: 60 });
        setNotice(ignored.ignoredUntil ? `已忽略至 ${formatClock(ignored.ignoredUntil)}` : "已忽略 1 小时");
      }
      if (action === "rollback") await api.rollbackIncident(token, id);
      await refresh();
    } catch (error) {
      const message = actionErrorMessage(error, onLogout);
      if (message) setActionError(message);
    } finally {
      setBusyId(null);
    }
  }

  // 全部忽略：逐条调用现有的 ignore 接口（60 分钟），作用于当前筛选分类下的待处理事件。
  async function ignoreAllVisible() {
    const targets = visibleActive;
    if (targets.length === 0 || ignoreAllBusy) return;
    setIgnoreAllBusy(true);
    setActionError(null);
    setNotice(null);
    let succeeded = 0;
    let failed = 0;
    for (const incident of targets) {
      try {
        await api.ignoreIncident(token, incident.id, { minutes: 60 });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const message = actionErrorMessage(error, onLogout);
        if (message && !actionError) setActionError(message);
      }
    }
    await refresh();
    setIgnoreAllBusy(false);
    if (failed > 0) {
      setActionError(`${succeeded} 条已忽略，${failed} 条失败，请稍后重试。`);
    } else {
      setNotice(`已忽略 ${succeeded} 条事件（1 小时）`);
    }
  }

  // 永久静默：以事件的 实例+指纹 生成永久静默规则并忽略该事件；复用二次确认键 `silence:${id}`。
  async function silenceForever(id: string) {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await api.silenceIncident(token, id, {});
      setNotice("已永久静默该类告警（可在下方规则列表撤销）");
      await refresh();
      if (silenceRules !== null) await loadSilenceRules();
    } catch (error) {
      const message = actionErrorMessage(error, onLogout);
      if (message) setActionError(message);
    } finally {
      setBusyId(null);
    }
  }

  async function loadSilenceRules() {
    setSilenceLoading(true);
    try {
      const response = await api.silenceRules(token);
      setSilenceRules(response.rules);
    } catch (error) {
      const message = actionErrorMessage(error, onLogout);
      if (message) setActionError(message);
    } finally {
      setSilenceLoading(false);
    }
  }

  function toggleSilenceSection() {
    const next = !silenceOpen;
    setSilenceOpen(next);
    if (next && silenceRules === null && !silenceLoading) {
      void loadSilenceRules();
    }
  }

  async function removeSilenceRule(id: string) {
    if (silenceBusyId) return;
    setSilenceBusyId(id);
    setActionError(null);
    try {
      await api.deleteSilenceRule(token, id);
      await loadSilenceRules();
    } catch (error) {
      const message = actionErrorMessage(error, onLogout);
      if (message) setActionError(message);
    } finally {
      setSilenceBusyId(null);
    }
  }

  function renderActions(incident: ManagedIncident) {
    const busy = busyId === incident.id;
    const arming = armingId === incident.id;
    const silenceArming = armingId === `silence:${incident.id}`;
    return (
      <div className="incident-item-actions">
        {diagnosableStatuses.has(incident.status) ? (
          <button
            type="button"
            className={`incident-action-btn incident-approve-btn ${arming ? "is-arming" : ""}`}
            disabled={busy}
            title="确认后才会调用模型，会消耗额度"
            onClick={() => confirmDiagnose(incident.id, () => void run(incident.id, "diagnose"))}
          >
            {busy ? <Loader2 size={12} className="status-spinner" /> : <Sparkles size={12} />}
            {arming ? "确认消耗额度并开始诊断？" : incident.status === "open" || incident.status === "rate_limited" ? "确认诊断" : "再次诊断"}
          </button>
        ) : null}
        {incident.status === "awaiting_approval" ? (
          <button
            type="button"
            className="incident-action-btn incident-approve-btn"
            disabled={busy}
            onClick={() => void run(incident.id, "approve")}
          >
            {busy ? <Loader2 size={12} className="status-spinner" /> : <Check size={12} />}
            批准
          </button>
        ) : null}
        {incident.rollbackSet.length > 0 &&
        (incident.status === "resolved" || incident.status === "failed" || incident.status === "diagnosed") ? (
          <button
            type="button"
            className="incident-action-btn incident-ignore-btn"
            disabled={busy}
            onClick={() => void run(incident.id, "rollback")}
          >
            {busy ? <Loader2 size={12} className="status-spinner" /> : <RotateCcw size={12} />}
            回滚修复
          </button>
        ) : null}
        {activeStatuses.has(incident.status) ? (
          <button
            type="button"
            className="incident-action-btn incident-ignore-btn"
            disabled={busy}
            onClick={() => void run(incident.id, "ignore")}
          >
            <Clock size={12} />
            忽略 1 小时
          </button>
        ) : null}
        {activeStatuses.has(incident.status) ? (
          <button
            type="button"
            className={`incident-action-btn incident-silence-btn ${silenceArming ? "is-arming" : ""}`}
            disabled={busy}
            title="永久静默该类告警"
            aria-label="永久静默该类告警"
            onClick={() => confirmDiagnose(`silence:${incident.id}`, () => void silenceForever(incident.id))}
          >
            {busy ? <Loader2 size={12} className="status-spinner" /> : <BellOff size={12} />}
            {silenceArming ? "确认永久静默？" : null}
          </button>
        ) : null}
      </div>
    );
  }

  function renderItem(incident: ManagedIncident) {
    return (
      <li key={incident.id} className={`incident-item ${recentStatuses.has(incident.status) ? "is-recent" : ""}`}>
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
            <span className="incident-item-badges">
              {incident.recurrenceCount > 0 ? (
                <span
                  className="incident-chip"
                  title={`该指纹历史上已出现 ${incident.recurrenceCount} 次，上次修复可能未治本`}
                >
                  复发×{incident.recurrenceCount}
                </span>
              ) : null}
              {incident.flapping ? (
                <span className="incident-chip is-warning" title="一小时内反复出现，疑似抖动">
                  抖动
                </span>
              ) : null}
              {incident.autoApplied ? (
                <span className="incident-chip is-success" title="已由自治策略自动执行修复">
                  自动修复
                </span>
              ) : null}
              {incident.escalatedAt && activeStatuses.has(incident.status) ? (
                <span className="incident-chip is-warning" title="超时未处理，已推送升级通知">
                  已升级
                </span>
              ) : null}
              <span className={`incident-badge-meta status-${incident.status}`}>
                {triggerLabel(incident.trigger)} · {statusDisplayLabel(incident.status)}
              </span>
            </span>
          </div>
          <span className="incident-item-summary">{incident.summary || "等待你确认后才会消耗额度开始诊断。"}</span>
        </button>
        {renderActions(incident)}
      </li>
    );
  }

  // 分组渲染：单条组直接按平铺条目渲染；多条组渲染为可折叠分组块，
  // 组头显示触发类型、条数徽标与涉及实例（去重，最多 3 个）。
  function renderGroup(group: IncidentGroup, section: "active" | "recent") {
    const firstItem = group.items[0];
    if (!firstItem) return null;
    if (group.items.length === 1) return renderItem(firstItem);
    const stateKey = `${section}:${group.key}`;
    const defaultExpanded = section === "active" && group.items.length <= 3;
    const expanded = groupOverrides[stateKey] ?? defaultExpanded;
    const names = [...new Set(group.items.map((item) => item.instanceName))];
    const shownNames = names.slice(0, 3);
    return (
      <li key={stateKey} className={`incident-group ${expanded ? "is-expanded" : ""}`}>
        <button
          type="button"
          className="incident-group-header"
          aria-expanded={expanded}
          onClick={() => setGroupOverrides((prev) => ({ ...prev, [stateKey]: !expanded }))}
        >
          <ChevronDown size={12} className="incident-group-chevron" />
          <span className="incident-group-title">{triggerLabel(firstItem.trigger)}</span>
          <span className="incident-group-count">{group.items.length} 条</span>
          <span className="incident-group-instances">
            {shownNames.join("、")}
            {names.length > 3 ? ` 等 ${names.length} 个实例` : ""}
          </span>
        </button>
        {expanded ? <ul className="incident-group-items">{group.items.map(renderItem)}</ul> : null}
      </li>
    );
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
            <div className="incident-popover-header-actions">
              <button
                type="button"
                className="incident-ignore-all-btn"
                disabled={ignoreAllBusy || visibleActive.length === 0}
                title={
                  visibleActive.length === 0
                    ? "当前分类下没有待处理事件"
                    : `忽略当前分类下全部 ${visibleActive.length} 条待处理事件（1 小时）`
                }
                onClick={() => void ignoreAllVisible()}
              >
                {ignoreAllBusy ? <Loader2 size={12} className="status-spinner" /> : <CheckCheck size={12} />}
                全部忽略
              </button>
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
          </div>
          {actionError ? (
            <div className="incident-popover-error" role="alert">
              <AlertTriangle size={13} />
              <span>{actionError}</span>
              <button type="button" className="incident-popover-notice-close" onClick={() => setActionError(null)} aria-label="关闭">
                <X size={12} />
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="incident-popover-notice" role="status">
              <Check size={13} />
              <span>{notice}</span>
            </div>
          ) : null}
          {active.length === 0 && recent.length === 0 ? (
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
            <div className="incident-popover-main">
              <nav className="incident-category-nav" aria-label="告警分类筛选">
                {triggerCategories.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    className={`incident-category-item ${triggerFilter === category.key ? "is-active" : ""}`}
                    aria-pressed={triggerFilter === category.key}
                    onClick={() => setTriggerFilter(category.key)}
                  >
                    <span>{category.label}</span>
                    {categoryCounts[category.key] > 0 ? (
                      <span className="incident-category-count">{categoryCounts[category.key]}</span>
                    ) : null}
                  </button>
                ))}
              </nav>
              <div className="incident-popover-body">
                {visibleActive.length === 0 && visibleRecent.length === 0 ? (
                  <div className="incident-filtered-empty">
                    <Check size={16} />
                    <span>该分类下暂无事件</span>
                  </div>
                ) : null}
                {visibleActive.length > 0 ? (
                  <>
                    <div className="incident-section-label">待处理</div>
                    <ul className="incident-list">
                      {groupIncidents(visibleActive.slice(0, ACTIVE_DISPLAY_LIMIT)).map((group) => renderGroup(group, "active"))}
                    </ul>
                  </>
                ) : null}
                {visibleRecent.length > 0 ? (
                  <>
                    <div className="incident-section-label">最近已完结</div>
                    <ul className="incident-list">
                      {groupIncidents(visibleRecent.slice(0, RECENT_DISPLAY_LIMIT)).map((group) => renderGroup(group, "recent"))}
                    </ul>
                  </>
                ) : null}
              </div>
            </div>
          )}
          <div className={`incident-silence-section ${silenceOpen ? "is-open" : ""}`}>
            <button
              type="button"
              className="incident-silence-header"
              aria-expanded={silenceOpen}
              onClick={toggleSilenceSection}
            >
              <BellOff size={12} />
              <span>静默规则</span>
              {silenceRules && silenceRules.length > 0 ? (
                <span className="incident-silence-count">{silenceRules.length}</span>
              ) : null}
              <ChevronDown size={12} className="incident-silence-chevron" />
            </button>
            {silenceOpen ? (
              <div className="incident-silence-body">
                {silenceLoading && silenceRules === null ? (
                  <div className="incident-silence-empty">
                    <Loader2 size={12} className="status-spinner" />
                    加载中…
                  </div>
                ) : silenceRules && silenceRules.length > 0 ? (
                  <ul className="incident-silence-list">
                    {silenceRules.map((rule) => (
                      <li key={rule.id} className="incident-silence-rule">
                        <div className="incident-silence-rule-info">
                          <span className="incident-silence-rule-scope">{silenceRuleScope(rule)}</span>
                          <span className="incident-silence-rule-expiry">{silenceRuleExpiry(rule)}</span>
                        </div>
                        <button
                          type="button"
                          className="incident-silence-rule-delete"
                          disabled={silenceBusyId === rule.id}
                          title="删除该静默规则"
                          aria-label="删除该静默规则"
                          onClick={() => void removeSilenceRule(rule.id)}
                        >
                          {silenceBusyId === rule.id ? (
                            <Loader2 size={11} className="status-spinner" />
                          ) : (
                            <X size={11} />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="incident-silence-empty">暂无静默规则</div>
                )}
              </div>
            ) : null}
          </div>
          <div className={`incident-popover-footer ${lastError ? "is-error" : ""}`}>
            {lastError
              ? lastUpdatedAt
                ? `连接中断，最后更新于 ${formatClockWithSeconds(lastUpdatedAt)}`
                : "连接中断，正在重连…"
              : lastUpdatedAt
                ? `上次检查 ${formatClockWithSeconds(lastUpdatedAt)}`
                : "正在连接…"}
          </div>
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
        onClick={() => {
          setOpen((value) => !value);
          setActionError(null);
          disarmDiagnose();
        }}
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
  const { active, recent, refresh } = useIncidents(token, onLogout);
  // resolved/failed 且留有 checkpoint 的事件保留回滚入口，不因完结立刻消失。
  const incident =
    active.find((item) => item.instanceId === instanceId) ??
    recent.find(
      (item) =>
        item.instanceId === instanceId &&
        item.rollbackSet.length > 0 &&
        (item.status === "resolved" || item.status === "failed")
    ) ??
    null;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { armingId, confirm: confirmDiagnose } = useDiagnoseConfirm();

  async function act(action: "diagnose" | "approve" | "ignore" | "rollback") {
    if (!incident) return;
    setBusy(true);
    setActionError(null);
    try {
      if (action === "diagnose") await api.diagnoseIncident(token, incident.id);
      if (action === "approve") {
        const result = await api.approveIncident(token, incident.id);
        if (!result.ok && result.results?.some((item) => !item.ok)) {
          setActionError("部分变更应用失败，其余已应用。");
        }
      }
      if (action === "ignore") await api.ignoreIncident(token, incident.id, { minutes: 60 });
      if (action === "rollback") await api.rollbackIncident(token, incident.id);
      await refresh();
    } catch (error) {
      const message = actionErrorMessage(error, onLogout);
      if (message) setActionError(message);
    } finally {
      setBusy(false);
    }
  }

  if (!incident) return null;

  const summary =
    incident.summary ||
    incident.rootCause ||
    "Saki 发现了问题，但不会自动消耗额度。确认后才会开始诊断。";

  const arming = armingId === incident.id;
  const errorLine = actionError ? <p className="incident-panel-error" role="alert">{actionError}</p> : null;

  const actions = (
      <div className="incident-banner-actions">
        {onAskSaki ? (
          <button className="small-button" type="button" onClick={onAskSaki}>
            <Sparkles size={14} />
            打开 Saki
          </button>
        ) : null}
        {diagnosableStatuses.has(incident.status) ? (
          <button
            className="small-button"
            type="button"
            disabled={busy}
            title="确认后才会调用模型，会消耗额度"
            onClick={() => confirmDiagnose(incident.id, () => void act("diagnose"))}
          >
            {busy ? <Loader2 size={14} className="status-spinner" /> : <Sparkles size={14} />}
            {arming ? "确认消耗额度并开始诊断？" : incident.status === "open" || incident.status === "rate_limited" ? "确认诊断" : "再次诊断"}
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
        {activeStatuses.has(incident.status) ? (
          <button className="small-button" type="button" disabled={busy} onClick={() => void act("ignore")}>
            <X size={14} />
            忽略 1 小时
          </button>
        ) : null}
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
              {triggerLabel(incident.trigger)} · {statusDisplayLabel(incident.status)}
            </strong>
          </div>
        </div>
        <div className="incident-panel-body">
          <p className="incident-panel-summary">{summary}</p>
          {incident.rootCause && incident.rootCause !== incident.summary ? (
            <p className="incident-panel-cause">{incident.rootCause}</p>
          ) : null}
          {errorLine}
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
            {triggerLabel(incident.trigger)} · {statusDisplayLabel(incident.status)}
          </strong>
          <p>{summary}</p>
          {errorLine}
        </div>
      </div>
      {actions}
    </div>
  );
}
