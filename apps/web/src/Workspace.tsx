import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  BookOpen,
  Bot,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Code2,
  Coins,
  Copy,
  Cpu,
  DownloadCloud,
  Edit3,
  Eye,
  EyeOff,
  FolderArchive,
  FolderOpen,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  Heart,
  History,
  Infinity as InfinityIcon,
  Info,
  KeyRound,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  List,
  Loader2,
  LogIn,
  LogOut,
  MemoryStick,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Move,
  Paintbrush,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  UserRound,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Zap
} from "lucide-react";
import type {
  CurrentUser,
  ManagedInstance,
  PanelAppearanceSettings,
  SakiModelOption
} from "@webops/shared";
import type {
  PanelRoute,
  SakiInstanceFileDragPayload,
  SakiInstanceFileDropRequest,
  SakiPanelContext,
  SakiPromptSeed,
  ViewMode
} from "./types/app.js";
import { api, ApiError } from "./api.js";
import {
  panelLanguageOptions,
  type PanelLanguage,
  panelT,
  type PanelTextKey,
  usePanelT
} from "./i18n/index.js";
import { defaultPanelAppearance, sakiArtAssets } from "./constants.js";
import { AccountAvatar } from "./components/common/AccountAvatar.js";
import { UserAccountModal } from "./components/common/UserAccountModal.js";
import { AccessEmptyView } from "./components/common/CommonUI.js";
import { PointsUsageModal } from "./PointsUsageModal.js";
import { SakiFloatingChat } from "./components/saki/SakiFloatingChat.js";
import { type SakiPullDragRequest } from "./components/saki/SakiComponents.js";
import { coerceSakiMode } from "./components/saki/sakiChatHelpers.js";
import { DashboardView } from "./views/DashboardView.js";
import { NodesView } from "./views/NodesView.js";
import { InstancesView } from "./views/instances/InstancesView.js";
import { TasksView } from "./views/TasksView.js";
import { TemplatesView } from "./views/TemplatesView.js";
import { UsersView } from "./views/UsersView.js";
import { AuditView } from "./views/AuditView.js";
import { AboutView } from "./views/AboutView.js";
import { SettingsView } from "./views/SettingsView.js";
import { IncidentBell } from "./IncidentInbox.js";
import { cssImageUrl } from "./utils/appearance.js";
import { parseHashRoute, routeIcon, updateHashRoute, validViews } from "./utils/route.js";

export function Workspace({
  token,
  user,
  appearance,
  language,
  onLogout,
  onSwitchUser,
  onUserChange,
  onAppearanceChange,
  onLanguageChange,
  darkMode,
  onToggleDarkMode,
  themeSwitching
}: {
  token: string;
  user: CurrentUser;
  appearance: PanelAppearanceSettings;
  language: PanelLanguage;
  onLogout: (options?: { manual?: boolean }) => void;
  onSwitchUser: (token: string, user: CurrentUser) => void;
  onUserChange: (user: CurrentUser) => void;
  onAppearanceChange: (appearance: PanelAppearanceSettings) => void;
  onLanguageChange: (language: PanelLanguage) => void;
  darkMode: boolean;
  onToggleDarkMode: (e?: React.MouseEvent<HTMLElement>) => void;
  themeSwitching: boolean;
}) {
  const initialRoute = useMemo(() => parseHashRoute(), []);
  const [activeView, setActiveView] = useState<ViewMode>(initialRoute.view);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(initialRoute.instanceId);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sakiInstance, setSakiInstance] = useState<ManagedInstance | null>(null);
  const [sakiSeed, setSakiSeed] = useState<SakiPromptSeed | null>(null);
  const [sakiFileDragActive, setSakiFileDragActive] = useState(false);
  const [sakiFileDropRequest, setSakiFileDropRequest] = useState<SakiInstanceFileDropRequest | null>(null);
  const [sakiCurrentModelId, setSakiCurrentModelId] = useState<string>("");
  const [sakiCurrentModelName, setSakiCurrentModelName] = useState<string>("");
  const [sakiAvailableModels, setSakiAvailableModels] = useState<SakiModelOption[]>([]);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sakiLieMode, setSakiLieMode] = useState<boolean>(() => {
    try {
      const saved = globalThis.localStorage?.getItem("saki_lie_mode");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });
  const [sakiWakeCount, setSakiWakeCount] = useState(0);
  const [pointsUsageOpen, setPointsUsageOpen] = useState(false);
  const [sakiLauncherDragging, setSakiLauncherDragging] = useState(false);
  const [sakiPullDrag, setSakiPullDrag] = useState<SakiPullDragRequest | null>(null);
  const [sakiLieHolding, setSakiLieHolding] = useState(false);
  const liePressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    offsetX: number;
    offsetY: number;
    timer: number | null;
    longPressed: boolean;
  } | null>(null);
  const lieClickSuppressedRef = useRef(false);
  const [userPointsSummary, setUserPointsSummary] = useState<{ points: number; unlimitedPoints: boolean }>({
    points: user.points ?? 0,
    unlimitedPoints: Boolean(user.unlimitedPoints)
  });

  const loadMyPoints = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.myPoints(token);
      setUserPointsSummary({
        points: res.points,
        unlimitedPoints: res.unlimitedPoints
      });
    } catch {}
  }, [token]);

  useEffect(() => {
    void loadMyPoints();
  }, [loadMyPoints, refreshTick, pointsUsageOpen]);

  const handleWakeSakiFromLie = useCallback(() => {
    setSakiLieMode(false);
    setSakiWakeCount((c) => c + 1);
    try {
      globalThis.localStorage?.setItem("saki_lie_mode", "false");
    } catch {}
  }, []);

  const liePressMoveRef = useRef<((event: PointerEvent) => void) | null>(null);
  const liePressUpRef = useRef<((event: PointerEvent) => void) | null>(null);

  const handleLiePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      timer: null as number | null,
      longPressed: false
    };
    liePressRef.current = session;
    setSakiLieHolding(true);
    event.preventDefault();

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return;
      session.lastX = moveEvent.clientX;
      session.lastY = moveEvent.clientY;
      if (!session.longPressed && Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY) > 14) {
        if (session.timer !== null) {
          window.clearTimeout(session.timer);
          session.timer = null;
        }
        setSakiLieHolding(false);
      }
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== session.pointerId) return;
      if (session.timer !== null) {
        window.clearTimeout(session.timer);
        session.timer = null;
      }
      setSakiLieHolding(false);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      liePressMoveRef.current = null;
      liePressUpRef.current = null;
      liePressRef.current = null;
    };
    liePressMoveRef.current = onMove;
    liePressUpRef.current = onUp;
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);

    session.timer = window.setTimeout(() => {
      if (liePressRef.current !== session) return;
      session.longPressed = true;
      lieClickSuppressedRef.current = true;
      setSakiLieHolding(false);
      setSakiLieMode(false);
      try {
        globalThis.localStorage?.setItem("saki_lie_mode", "false");
      } catch {}
      setSakiPullDrag({
        pointerId: session.pointerId,
        offsetX: session.offsetX,
        offsetY: session.offsetY,
        clientX: session.lastX,
        clientY: session.lastY
      });
    }, 420);
  }, [handleWakeSakiFromLie]);

  const handleLieClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (lieClickSuppressedRef.current) {
      lieClickSuppressedRef.current = false;
      return;
    }
    handleWakeSakiFromLie();
  }, [handleWakeSakiFromLie]);

  const handleReturnSakiToLie = useCallback(() => {
    setSakiLieMode(true);
    try {
      globalThis.localStorage?.setItem("saki_lie_mode", "true");
    } catch {}
  }, []);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const floatingSidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const shouldFocusFloatingSidebarToggleRef = useRef(false);
  const canUseSakiChat = user.permissions.includes("saki.chat");
  const canUseSakiAgent = user.permissions.includes("saki.agent");
  const canUseSaki = canUseSakiChat || canUseSakiAgent;
  const canUseSakiSkills = user.permissions.includes("saki.skills");
  const canConfigureSaki = user.permissions.includes("saki.configure");
  const canOpenDashboard = user.permissions.includes("dashboard.view");
  const canOpenInstances = user.permissions.includes("instance.view");
  const canViewNodes = user.permissions.includes("node.view");
  const canTestNodes = user.permissions.includes("node.test");
  const hasAssignedRole = user.roleNames.length > 0;
  const canOpenNodes = hasAssignedRole && user.isAdmin && canViewNodes;
  const canOpenTemplates = user.permissions.includes("template.view");
  const canOpenUsers = user.permissions.includes("user.view") || (user.isAdmin && user.permissions.includes("instance.update"));
  const canOpenAudit = hasAssignedRole && user.isAdmin && user.permissions.includes("audit.view");
  const canOpenAbout = true;
  const t = useCallback((key: PanelTextKey) => panelT(language, key), [language]);
  const availableViews = useMemo<ViewMode[]>(() => {
    const views: ViewMode[] = [];
    if (canOpenDashboard) views.push("dashboard");
    if (canOpenInstances) views.push("instances");
    if (canOpenNodes) views.push("nodes");
    if (canOpenTemplates) views.push("templates");
    if (canOpenUsers) views.push("users");
    if (canOpenAudit) views.push("audit");
    if (canConfigureSaki) views.push("settings");
    if (canOpenAbout) views.push("about");
    return views;
  }, [
    canConfigureSaki,
    canOpenAbout,
    canOpenAudit,
    canOpenDashboard,
    canOpenInstances,
    canOpenNodes,
    canOpenTemplates,
    canOpenUsers
  ]);
  const hasAnyAccessibleView = availableViews.length > 0;
  const effectiveView = availableViews.includes(activeView) ? activeView : availableViews[0] ?? activeView;
  const panelContext = useMemo<SakiPanelContext>(() => {
    if (effectiveView === "audit") {
      return { label: t("context.audit.label"), detail: t("context.audit.detail"), auditSearch: true };
    }
    if (effectiveView === "instances") {
      return { label: t("context.instances.label"), detail: t("context.instances.detail") };
    }
    if (effectiveView === "nodes") return { label: t("context.nodes.label"), detail: t("context.nodes.detail") };
    if (effectiveView === "templates") return { label: t("context.templates.label"), detail: t("context.templates.detail") };
    if (effectiveView === "users") return { label: t("context.users.label"), detail: t("context.users.detail") };
    if (effectiveView === "settings") return { label: t("context.settings.label"), detail: t("context.settings.detail") };
    return { label: t("context.dashboard.label"), detail: t("context.dashboard.detail") };
  }, [effectiveView, t]);

  const openSaki = useCallback((seed: Omit<SakiPromptSeed, "nonce">) => {
    if (!canUseSaki) return;
    if (seed.clearInstance) {
      setSakiInstance(null);
    }
    setSakiSeed({
      ...seed,
      mode: coerceSakiMode(seed.mode, canUseSakiChat, canUseSakiAgent),
      nonce: Date.now()
    });
  }, [canUseSaki, canUseSakiAgent, canUseSakiChat]);

  const attachInstanceFileToSaki = useCallback(
    (payload: SakiInstanceFileDragPayload) => {
      if (!canUseSaki) return;
      setSakiFileDragActive(false);
      setSakiFileDropRequest({
        ...payload,
        nonce: Date.now()
      });
    },
    [canUseSaki]
  );

  useEffect(() => {
    if (activeView !== "instances") {
      setSakiInstance(null);
      setSakiFileDragActive(false);
    }
  }, [activeView]);

  useEffect(() => {
    function clearSakiFileDrag() {
      setSakiFileDragActive(false);
    }
    window.addEventListener("dragend", clearSakiFileDrag);
    window.addEventListener("drop", clearSakiFileDrag);
    return () => {
      window.removeEventListener("dragend", clearSakiFileDrag);
      window.removeEventListener("drop", clearSakiFileDrag);
    };
  }, []);

  const hideSidebar = useCallback(() => {
    const activeElement = document.activeElement;
    if (sidebarRef.current && activeElement instanceof HTMLElement && sidebarRef.current.contains(activeElement)) {
      activeElement.blur();
      shouldFocusFloatingSidebarToggleRef.current = true;
    }
    setSidebarHidden(true);
  }, []);

  useEffect(() => {
    if (!sidebarHidden) {
      shouldFocusFloatingSidebarToggleRef.current = false;
      return;
    }
    if (!shouldFocusFloatingSidebarToggleRef.current) return;
    shouldFocusFloatingSidebarToggleRef.current = false;
    window.requestAnimationFrame(() => {
      floatingSidebarToggleRef.current?.focus({ preventScroll: true });
    });
  }, [sidebarHidden]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const syncSidebar = () => setSidebarHidden(media.matches);
    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const sidebar = document.getElementById("workspace-sidebar");
      const floatingToggle = document.querySelector(".sidebar-floating-toggle");
      if (
        sidebar &&
        floatingToggle &&
        !sidebar.contains(e.target as Node) &&
        !floatingToggle.contains(e.target as Node) &&
        !sidebarHidden &&
        window.matchMedia("(max-width: 760px)").matches
      ) {
        hideSidebar();
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [sidebarHidden, hideSidebar]);

  useEffect(() => {
    const onHashChange = () => {
      const route = parseHashRoute();
      if (availableViews.includes(route.view)) {
        setActiveView(route.view);
        setSelectedInstanceId(route.instanceId);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [availableViews]);

  useEffect(() => {
    if (hasAnyAccessibleView && !availableViews.includes(activeView)) {
      const nextView = availableViews[0];
      if (nextView) {
        setActiveView(nextView);
        updateHashRoute({ view: nextView });
      }
    }
  }, [activeView, availableViews, hasAnyAccessibleView]);

  const selectView = useCallback((view: ViewMode) => {
    if (!availableViews.includes(view)) return;
    setActiveView(view);
    const nextInstanceId = view === "instances" ? selectedInstanceId : null;
    updateHashRoute({ view, instanceId: nextInstanceId });
    if (window.matchMedia("(max-width: 760px)").matches) {
      hideSidebar();
    }
  }, [availableViews, hideSidebar, selectedInstanceId]);

  return (
    <>
      <div className={`app-shell ${sidebarHidden ? "sidebar-hidden" : ""}`}>
        <aside id="workspace-sidebar" ref={sidebarRef} className="sidebar glass-sidebar" inert={sidebarHidden || undefined}>
          <div className="sidebar-brand">
            <div className="sidebar-logo">
              <img className="app-logo-img sidebar-app-logo" src={appearance.sidebarLogoSrc || appearance.appLogoSrc} alt="" draggable={false} />
              <span>{appearance.sidebarTitle || appearance.appTitle}</span>
            </div>
            <div className="sidebar-brand-actions">
              <button
                className={`sidebar-inline-toggle theme-toggle-button${themeSwitching ? " theme-switching" : ""}`}
                type="button"
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                onClick={onToggleDarkMode}
              >
                {darkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              </button>
              <button
                className="sidebar-inline-toggle"
                type="button"
                aria-label={t("sidebar.collapse")}
                aria-controls="workspace-sidebar"
                aria-expanded={!sidebarHidden}
                title={t("sidebar.collapse")}
                onClick={() => {
                  hideSidebar();
                }}
              >
                <PanelLeftClose size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          {hasAnyAccessibleView ? (
            <nav>
              {canOpenDashboard ? (
                <button className={`nav-item-dashboard ${effectiveView === "dashboard" ? "active" : ""}`} onClick={() => selectView("dashboard")}>
                  <Activity size={18} />
                  {t("nav.dashboard")}
                </button>
              ) : null}
              {canOpenInstances ? (
                <button className={`nav-item-instances ${effectiveView === "instances" ? "active" : ""}`} onClick={() => selectView("instances")}>
                  <TerminalIcon size={18} />
                  {t("nav.instances")}
                </button>
              ) : null}
              {canOpenNodes ? (
                <button className={`nav-item-nodes ${effectiveView === "nodes" ? "active" : ""}`} onClick={() => selectView("nodes")}>
                  <Server size={18} />
                  {t("nav.nodes")}
                </button>
              ) : null}
              {canOpenTemplates ? (
                <button className={`nav-item-templates ${effectiveView === "templates" ? "active" : ""}`} onClick={() => selectView("templates")}>
                  <LayoutTemplate size={18} />
                  {t("nav.templates")}
                </button>
              ) : null}
              {canOpenUsers ? (
                <button className={`nav-item-users ${effectiveView === "users" ? "active" : ""}`} onClick={() => selectView("users")}>
                  <UserCog size={18} />
                  {t("nav.users")}
                </button>
              ) : null}
              {canOpenAudit ? (
                <button className={`nav-item-audit ${effectiveView === "audit" ? "active" : ""}`} onClick={() => selectView("audit")}>
                  <ClipboardList size={18} />
                  {t("nav.audit")}
                </button>
              ) : null}
              {canConfigureSaki ? (
                <button className={`nav-item-settings ${effectiveView === "settings" ? "active" : ""}`} onClick={() => selectView("settings")}>
                  <Settings size={18} />
                  {t("nav.settings")}
                </button>
              ) : null}
              {canOpenAbout ? (
                <button className={`nav-item-about ${effectiveView === "about" ? "active" : ""}`} onClick={() => selectView("about")}>
                  <Info size={18} />
                  {t("nav.about")}
                </button>
              ) : null}
            </nav>
          ) : (
            <div className="sidebar-empty">
              <Shield size={18} />
              <span>{t("sidebar.waitingPermissions")}</span>
            </div>
          )}

          <div className="sidebar-account">
            <button className="sidebar-account-button" type="button" onClick={() => setAccountOpen(true)}>
              <AccountAvatar avatarDataUrl={user.avatarDataUrl} displayName={user.displayName} username={user.username} />
              <span className="sidebar-account-copy">
                <strong>{user.displayName}</strong>
                <small>@{user.username}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </aside>

        <main className="workspace view-transition-enter" key={hasAnyAccessibleView ? effectiveView : "access-empty"}>
          <header className="topbar">
            <button
              ref={floatingSidebarToggleRef}
              className="sidebar-floating-toggle"
              type="button"
              aria-label={t("sidebar.expand")}
              aria-controls="workspace-sidebar"
              aria-expanded={!sidebarHidden}
              inert={!sidebarHidden || undefined}
              tabIndex={sidebarHidden ? 0 : -1}
              title={t("sidebar.expand")}
              onClick={(e) => {
                e.currentTarget.blur();
                setSidebarHidden(false);
              }}
            >
              <PanelLeftOpen size={18} aria-hidden="true" />
            </button>
            <div className="topbar-inner">
              <div className="topbar-title">
                <span className="topbar-context">{t("topbar.context")}</span>
                <ChevronRight size={14} className="topbar-separator" />
                <h1>
                  {!hasAnyAccessibleView
                    ? t("topbar.noAccess")
                    : effectiveView === "dashboard"
                      ? t("nav.dashboard")
                      : effectiveView === "instances"
                        ? t("view.instances")
                        : effectiveView === "nodes"
                          ? t("view.nodes")
                          : effectiveView === "templates"
                            ? t("nav.templates")
                            : effectiveView === "settings"
                              ? t("view.settings")
                              : effectiveView === "users"
                                ? t("view.users")
                                : effectiveView === "about"
                                  ? t("nav.about")
                                  : t("view.audit")}
                </h1>
              </div>
              <div className="topbar-actions">
                {canUseSaki ? (
                  <IncidentBell
                    token={token}
                    onLogout={onLogout}
                    onOpenIncident={(incident) => {
                      selectView("instances");
                      setSelectedInstanceId(incident.instanceId);
                      openSaki({
                        message: "",
                        contextTitle: `值班：${incident.instanceName}`,
                        contextText: incident.summary ?? "",
                        mode: "agent"
                      });
                    }}
                  />
                ) : null}
                {hasAnyAccessibleView ? (
                  <button className="topbar-refresh-btn" type="button" onClick={() => setRefreshTick((value) => value + 1)} title={t("common.refresh")}>
                    <RefreshCw size={14} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className={`topbar-inner topbar-companion-panel ${sakiLieMode ? "has-lie" : "is-empty"} ${!sakiLieMode && (sakiLauncherDragging || sakiPullDrag) ? "is-dragging-saki" : ""}`}>
              <div
                className="topbar-points-badge"
                title="点击查看积分使用量与消耗明细"
                role="button"
                tabIndex={0}
                onClick={() => setPointsUsageOpen(true)}
              >
                <Sparkles size={14} className="topbar-points-icon" />
                {userPointsSummary.unlimitedPoints ? (
                  <>
                    <span className="topbar-points-value">∞</span>
                    <span className="topbar-points-label">无限</span>
                  </>
                ) : (
                  <>
                    <span className="topbar-points-value">{userPointsSummary.points}</span>
                    <span className="topbar-points-label">积分</span>
                  </>
                )}
              </div>
              {canUseSaki ? (
                <div className="topbar-lie-slot">
                  {sakiLieMode ? (
                    <button
                      type="button"
                      className={`topbar-lie-character ${sakiLieHolding ? "is-holding" : ""}`}
                      onPointerDown={handleLiePointerDown}
                      onClick={handleLieClick}
                      onContextMenu={(event) => event.preventDefault()}
                      title="点击唤醒，长按拖到任意位置"
                      aria-label="唤醒 Saki，长按可拖动"
                    >
                      <img
                        src={sakiArtAssets.lie}
                        alt="Saki"
                        className="topbar-lie-image"
                        draggable={false}
                      />
                    </button>
                  ) : (
                    <div className="topbar-lie-target-placeholder" title="拖拽 Saki 回此区域可收纳">
                      <span className="topbar-lie-target-ring" />
                    </div>
                  )}
                </div>
              ) : null}
              {canUseSaki && !sakiLieMode && sakiLauncherDragging ? (
                <div className="topbar-hide-saki-bubble" role="tooltip" aria-hidden="true">
                  <span className="topbar-hide-saki-arrow" />
                  <Sparkles size={13} className="topbar-hide-saki-icon" />
                  <span className="topbar-hide-saki-text">拖动到这里隐藏 Saki</span>
                </div>
              ) : null}
            </div>
          </header>

          {!hasAnyAccessibleView ? (
            <AccessEmptyView user={user} onOpenAccount={() => setAccountOpen(true)} />
          ) : effectiveView === "dashboard" ? (
            <DashboardView
              token={token}
              onLogout={onLogout}
              refreshTick={refreshTick}
              canViewNodes={canViewNodes}
              canTestNodes={canTestNodes}
            />
          ) : effectiveView === "instances" ? (
            <InstancesView
              token={token}
              onLogout={onLogout}
              refreshTick={refreshTick}
              onOpenTemplates={() => selectView("templates")}
              onInstanceFocus={setSakiInstance}
              onAskSaki={canUseSaki ? openSaki : undefined}
              onSakiFileDragChange={setSakiFileDragActive}
              onSakiInstanceFileDrop={canUseSaki ? attachInstanceFileToSaki : undefined}
              darkMode={darkMode}
              initialInstanceId={selectedInstanceId}
              onSelectInstance={setSelectedInstanceId}
            />
          ) : effectiveView === "nodes" ? (
            <NodesView token={token} onLogout={onLogout} refreshTick={refreshTick} />
          ) : effectiveView === "templates" ? (
            <TemplatesView token={token} onLogout={onLogout} refreshTick={refreshTick} />
          ) : effectiveView === "users" ? (
            <UsersView token={token} currentUser={user} onLogout={onLogout} onSwitchUser={onSwitchUser} refreshTick={refreshTick} />
          ) : effectiveView === "settings" ? (
            <SettingsView
              token={token}
              onLogout={onLogout}
              onSessionRefresh={onSwitchUser}
              refreshTick={refreshTick}
              onAppearanceChange={onAppearanceChange}
              language={language}
              onLanguageChange={onLanguageChange}
            />
          ) : effectiveView === "about" ? (
            <AboutView token={token} />
          ) : (
            <AuditView
              token={token}
              onLogout={onLogout}
              refreshTick={refreshTick}
              onAskSaki={canUseSaki ? openSaki : undefined}
              canDeleteLogs={user.isSuperAdmin}
              darkMode={darkMode}
            />
          )}
        </main>
      </div>
      <UserAccountModal
        token={token}
        user={user}
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onLogout={onLogout}
        onUserChange={onUserChange}
      />
      {canUseSaki ? (
        <SakiFloatingChat
          token={token}
          instance={sakiInstance}
          seed={sakiSeed}
          panelContext={panelContext}
          fileDragActive={sakiFileDragActive}
          instanceFileDropRequest={sakiFileDropRequest}
          canUseChat={canUseSakiChat}
          canUseAgent={canUseSakiAgent}
          canUseSkills={canUseSakiSkills}
          currentModelId={sakiCurrentModelId}
          currentModelName={sakiCurrentModelName}
          availableModels={sakiAvailableModels}
          onCurrentModelIdChange={setSakiCurrentModelId}
          onCurrentModelNameChange={setSakiCurrentModelName}
          onAvailableModelsChange={setSakiAvailableModels}
          sakiLieMode={sakiLieMode}
          onReturnToLie={handleReturnSakiToLie}
          wakeCount={sakiWakeCount}
          onOpenPointsUsage={() => setPointsUsageOpen(true)}
          onLauncherDraggingChange={setSakiLauncherDragging}
          onPointsBalanceChange={setUserPointsSummary}
          pointsSummary={userPointsSummary}
          pullDragRequest={sakiPullDrag}
          onPullDragConsumed={() => setSakiPullDrag(null)}
        />
      ) : null}
      <PointsUsageModal
        token={token}
        open={pointsUsageOpen}
        onClose={() => setPointsUsageOpen(false)}
        darkMode={darkMode}
      />
    </>
  );
}
