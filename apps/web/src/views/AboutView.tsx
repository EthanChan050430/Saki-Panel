import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Bot,
  Bug,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Code2,
  Cpu,
  Database,
  DownloadCloud,
  FileText,
  FolderOpen,
  Github,
  Heart,
  Info,
  Layers,
  LayoutTemplate,
  Loader2,
  LogIn,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal as TerminalIcon,
  Users,
  Wrench,
  X
} from "lucide-react";
import type { RegistrationIdentity } from "@webops/shared";
import { PANEL_VERSION, isNewerVersion, extractVersionString } from "@webops/shared";
import { usePanelLanguage, usePanelT } from "../i18n/index.js";
import { defaultPanelAppearance } from "../constants.js";
import { api } from "../api.js";
import {
  InstanceActionsMockup,
  InstanceSummaryMockup,
  InstanceProbeMockup,
  TerminalConsoleMockup,
  FileManagerMockup,
  SakiPatchDiffMockup,
  NodeClusterMockup,
  DatabaseProbeMockup,
  RbacQuotaMockup,
  SakiAssistantWindowMockup,
  SakiCompanionMockup,
  SakiMiniGameMockup,
  TopbarCompanionMockup,
  DashboardMockup,
  SettingsNavMockup,
  IncidentInboxMockup,
  LoginScreenMockup,
  ReliabilityMockup,
  CronTasksMockup,
  ServerTimeMockup,
  PointsUsageMockup,
  CreateInstanceMockup,
  NodeJoinMockup,
  DatabaseWorkspaceMockup,
  AgentMonitorMockup
} from "./about/AboutWikiMockups.js";
import type { WikiSubSection } from "./about/wikiData.js";
import { getWikiCategories, getWikiChapters } from "./about/wikiLocalize.js";

interface AboutViewProps {
  token?: string;
}

export function AboutView({ token }: AboutViewProps = {}) {
  const t = usePanelT();
  const { language } = usePanelLanguage();
  const wikiChapters = useMemo(() => getWikiChapters(language), [language]);
  const wikiCategories = useMemo(() => getWikiCategories(language), [language]);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "up-to-date" | "updating" | "error">("idle");
  const [updateMessage, setUpdateMessage] = useState("");
  const currentVersion = `v${PANEL_VERSION}`;
  const projectLogoSrc = defaultPanelAppearance.appLogoSrc;
  const [latestVersion, setLatestVersion] = useState("");
  const [latestReleaseUrl, setLatestReleaseUrl] = useState("");
  const [deploymentMode, setDeploymentMode] = useState<"git" | "release" | null>(null);

  // Wiki Search & Category Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeChapterId, setActiveChapterId] = useState<string>("wiki-start");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Press '/' to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        const tagName = (document.activeElement?.tagName || "").toLowerCase();
        if (tagName !== "input" && tagName !== "textarea") {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Update Check Logic
  const checkForUpdates = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateMessage(t("about.update.messageChecking"));
    try {
      let resolvedVersion = "";
      let resolvedUrl = "https://github.com/EthanChan050430/Saki-Panel/releases";
      let hasUpdate = false;
      let detectedMode: "git" | "release" = "release";

      // 先走后端 API 查版本
      try {
        const backendRes = await api.checkSystemUpdate(true, token);
        if (backendRes) {
          resolvedVersion = backendRes.latestVersion || "";
          resolvedUrl = backendRes.releaseUrl || resolvedUrl;
          hasUpdate = backendRes.hasUpdate;
          detectedMode = backendRes.mode || "release";
          setDeploymentMode(detectedMode);
        }
      } catch {
        // Fall back to direct browser fetch if backend check fails
      }

      // 后端拿不到就浏览器直连 GitHub / 镜像兜底
      if (!resolvedVersion) {
        const clientSources = [
          "https://api.github.com/repos/EthanChan050430/Saki-Panel/releases/latest",
          "https://api.github.com/repos/EthanChan050430/Saki-Panel/releases?per_page=1",
          "https://api.github.com/repos/EthanChan050430/Saki-Panel/tags?per_page=1",
          "https://raw.githubusercontent.com/EthanChan050430/Saki-Panel/main/package.json",
          "https://mirror.ghproxy.com/https://raw.githubusercontent.com/EthanChan050430/Saki-Panel/main/package.json"
        ];

        for (const url of clientSources) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const response = await fetch(url, {
              signal: controller.signal,
              headers: { Accept: "application/vnd.github.v3+json" }
            });
            clearTimeout(timeoutId);

            if (!response.ok) continue;

            const data = await response.json();
            if (!data) continue;

            if (url.includes("package.json")) {
              const pkg = data as { version?: string };
              if (pkg.version) {
                resolvedVersion = `v${pkg.version}`;
                resolvedUrl = "https://github.com/EthanChan050430/Saki-Panel/releases";
                hasUpdate = isNewerVersion(resolvedVersion, currentVersion);
                break;
              }
            } else if (Array.isArray(data)) {
              if (data.length === 0) continue;
              const item = data[0] as { tag_name?: string; name?: string; html_url?: string };
              const rawVer = item.tag_name || item.name || "";
              const ver = extractVersionString(rawVer) || rawVer;
              if (ver) {
                resolvedVersion = ver.startsWith("v") || ver.startsWith("V") ? ver : `v${ver}`;
                resolvedUrl = item.html_url || `https://github.com/EthanChan050430/Saki-Panel/releases/tag/${resolvedVersion}`;
                hasUpdate = isNewerVersion(resolvedVersion, currentVersion);
                break;
              }
            } else if (typeof data === "object" && data !== null) {
              const payload = data as { tag_name?: string; name?: string; html_url?: string };
              const rawVer = payload.tag_name || payload.name || "";
              const ver = extractVersionString(rawVer) || rawVer;
              if (ver) {
                resolvedVersion = ver.startsWith("v") || ver.startsWith("V") ? ver : `v${ver}`;
                resolvedUrl = payload.html_url || `https://github.com/EthanChan050430/Saki-Panel/releases/tag/${resolvedVersion}`;
                hasUpdate = isNewerVersion(resolvedVersion, currentVersion);
                break;
              }
            }
          } catch {
            continue;
          }
        }
      }

      if (!resolvedVersion && !hasUpdate) {
        throw new Error(t("about.update.errorVersion"));
      }

      setLatestVersion(resolvedVersion);
      setLatestReleaseUrl(resolvedUrl);

      if (hasUpdate) {
        if (detectedMode === "release") {
          // Release executable mode: Jump directly to download page
          setUpdateStatus("available");
          setUpdateMessage(t("about.update.redirectingDownload"));
          const targetUrl = resolvedUrl || "https://github.com/EthanChan050430/Saki-Panel/releases";
          const newWin = window.open(targetUrl, "_blank", "noopener,noreferrer");
          if (!newWin) {
            window.location.href = targetUrl;
          }
        } else {
          // Git clone mode: Automatically pull latest code and npm run build
          setUpdateStatus("updating");
          setUpdateMessage(t("about.update.pullingAndBuilding"));
          try {
            const upgradeRes = await api.upgradeSystemCode(token);
            if (upgradeRes.success) {
              setUpdateStatus("up-to-date");
              setUpdateMessage(upgradeRes.message || t("about.update.upgradeSuccess"));
            } else {
              setUpdateStatus("error");
              setUpdateMessage(upgradeRes.message || t("about.update.upgradeFailed"));
            }
          } catch (upgradeErr) {
            setUpdateStatus("error");
            setUpdateMessage(upgradeErr instanceof Error ? upgradeErr.message : t("about.update.upgradeFailed"));
          }
        }
      } else {
        setUpdateStatus("up-to-date");
        setUpdateMessage(t("about.update.messageCurrent"));
      }
    } catch (err) {
      setUpdateStatus("error");
      setUpdateMessage(err instanceof Error ? err.message : t("about.update.errorFailed"));
    }
  }, [currentVersion, t, token]);

  // Filter Chapters based on Search Query and Category Filter
  const filteredChapters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return wikiChapters.filter((chapter) => {
      // Category filter
      if (selectedCategory !== "all" && chapter.category !== selectedCategory) {
        return false;
      }
      // Query search
      if (!q) return true;

      const inTitle = chapter.title.toLowerCase().includes(q) || chapter.shortTitle.toLowerCase().includes(q);
      const inSummary = chapter.summary.toLowerCase().includes(q);
      const inKeywords = chapter.keywords.some((k) => k.toLowerCase().includes(q));
      const inSubsections = chapter.subsections.some(
        (sub) =>
          sub.title.toLowerCase().includes(q) ||
          (sub.description && sub.description.toLowerCase().includes(q)) ||
          (sub.bullets && sub.bullets.some((b) => b.toLowerCase().includes(q))) ||
          (sub.parameters && sub.parameters.some((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)))
      );

      return inTitle || inSummary || inKeywords || inSubsections;
    });
  }, [searchQuery, selectedCategory, wikiChapters]);

  // Flag to ignore observer events during programmatic smooth scroll
  const isProgrammaticScrollRef = useRef(false);

  // Refs for JS-driven sticky positioning of the TOC
  const sideColumnRef = useRef<HTMLElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const wikiLayoutRef = useRef<HTMLDivElement>(null);

  // JS-driven sticky scroll following for .about-toc
  useEffect(() => {
    const toc = tocRef.current;
    const sideCol = sideColumnRef.current;
    const wikiLayout = wikiLayoutRef.current;
    if (!toc || !sideCol || !wikiLayout) return;

    let rafId = 0;

    const updateTocPosition = () => {
      // In narrow/mobile screens (<=900px), TOC is displayed horizontally above the article
      if (window.innerWidth <= 900) {
        if (toc.style.transform) toc.style.transform = "";
        return;
      }

      const sideColRect = sideCol.getBoundingClientRect();
      const naturalTocOffset = toc.offsetTop;
      const naturalViewportTop = sideColRect.top + naturalTocOffset;
      const topGap = 20;

      let translateY = 0;
      if (naturalViewportTop < topGap) {
        translateY = topGap - naturalViewportTop;
        const maxTranslateY = sideCol.offsetHeight - naturalTocOffset - toc.offsetHeight;
        if (maxTranslateY > 0) {
          translateY = Math.min(translateY, maxTranslateY);
        } else {
          translateY = 0;
        }
      }

      const nextTransform = translateY > 0 ? `translate3d(0, ${Math.round(translateY)}px, 0)` : "";
      if (toc.style.transform !== nextTransform) {
        toc.style.transform = nextTransform;
      }
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateTocPosition);
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const ro = new ResizeObserver(scheduleUpdate);
    ro.observe(wikiLayout);
    ro.observe(sideCol);
    ro.observe(toc);

    updateTocPosition();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      ro.disconnect();
    };
  }, [filteredChapters.length]);

  // Sync active chapter with scroll position via IntersectionObserver
  useEffect(() => {
    if (filteredChapters.length === 0) return;

    const sectionIds = filteredChapters.map((ch) => ch.id);
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (sections.length === 0) return;

    const stickyTop = 80;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;

        const visibleEntries = entries.filter((e) => e.isIntersecting);
        if (visibleEntries.length === 0) return;

        // Pick the topmost intersecting section that's at or below the sticky zone
        const candidate = visibleEntries
          .filter((e) => e.boundingClientRect.top >= stickyTop - 20)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];

        const chosen = candidate ?? visibleEntries[0];
        if (!chosen) return;
        const id = chosen.target.id;
        setActiveChapterId((prev) => (prev === id ? prev : id));
      },
      {
        rootMargin: `-${stickyTop - 10}px 0px -60% 0px`,
        threshold: [0, 0.1, 0.25]
      }
    );

    sections.forEach((el) => observer.observe(el));

    // Fallback selector — sync current chapter on load/filter change
    const syncActive = () => {
      const firstVisible =
        [...sections].reverse().find((el) => el.getBoundingClientRect().top <= stickyTop) ??
        sections.find((el) => el.getBoundingClientRect().top >= stickyTop);
      if (firstVisible) {
        setActiveChapterId((prev) => (prev === firstVisible.id ? prev : firstVisible.id));
      }
    };
    const rafId = requestAnimationFrame(syncActive);
    const resizeHandler = () => syncActive();
    window.addEventListener("resize", resizeHandler);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeHandler);
      observer.disconnect();
    };
  }, [filteredChapters]);

  // Auto-scroll the active TOC item into view within the sidebar list
  useEffect(() => {
    if (!activeChapterId) return;
    const tocList = document.querySelector<HTMLElement>(".wiki-toc-list");
    if (!tocList) return;
    const activeItem = tocList.querySelector<HTMLElement>(`.wiki-toc-item.active`);
    if (!activeItem) return;

    const listRect = tocList.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();

    if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
      activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeChapterId]);

  // Scroll to Chapter Anchor
  const scrollToChapter = useCallback((chapterId: string) => {
    isProgrammaticScrollRef.current = true;
    setActiveChapterId(chapterId);
    const elem = document.getElementById(chapterId);
    if (elem) {
      const navOffset = 80;
      const elementPosition = elem.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - navOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
      // Release the flag after smooth scroll settles
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 800);
    } else {
      isProgrammaticScrollRef.current = false;
    }
  }, []);

  // Render specific UI mockups
  const renderMockup = (mockupKey?: WikiSubSection["mockupKey"]) => {
    switch (mockupKey) {
      case "saki-window":
        return <SakiAssistantWindowMockup />;
      case "saki-companion":
        return <SakiCompanionMockup />;
      case "saki-game":
        return <SakiMiniGameMockup />;
      case "saki-patch":
        return <SakiPatchDiffMockup />;
      case "topbar-companion":
        return <TopbarCompanionMockup />;
      case "instance-actions":
        return <InstanceActionsMockup />;
      case "instance-summary":
        return <InstanceSummaryMockup />;
      case "instance-probe":
        return <InstanceProbeMockup />;
      case "terminal-console":
        return <TerminalConsoleMockup />;
      case "file-manager":
        return <FileManagerMockup />;
      case "node-cluster":
        return <NodeClusterMockup />;
      case "database-probe":
        return <DatabaseProbeMockup />;
      case "rbac-quota":
        return <RbacQuotaMockup />;
      case "dashboard":
        return <DashboardMockup />;
      case "settings-nav":
        return <SettingsNavMockup />;
      case "incident-inbox":
        return <IncidentInboxMockup />;
      case "login":
        return <LoginScreenMockup />;
      case "reliability":
        return <ReliabilityMockup />;
      case "cron-tasks":
        return <CronTasksMockup />;
      case "server-time":
        return <ServerTimeMockup />;
      case "points-usage":
        return <PointsUsageMockup />;
      case "create-instance":
        return <CreateInstanceMockup />;
      case "node-join":
        return <NodeJoinMockup />;
      case "database-workspace":
        return <DatabaseWorkspaceMockup />;
      case "agent-monitor":
        return <AgentMonitorMockup />;
      default:
        return null;
    }
  };

  // Render chapter icon
  const renderChapterIcon = (iconName: string) => {
    switch (iconName) {
      case "Layers":
        return <Layers size={19} className="text-pink-500" />;
      case "Activity":
        return <Activity size={19} className="text-emerald-500" />;
      case "Play":
        return <Play size={19} className="text-blue-500" />;
      case "Cpu":
        return <Cpu size={19} className="text-purple-500" />;
      case "Terminal":
        return <TerminalIcon size={19} className="text-green-500" />;
      case "FolderOpen":
        return <FolderOpen size={19} className="text-amber-500" />;
      case "Bot":
        return <Bot size={19} className="text-pink-500" />;
      case "Server":
        return <Server size={19} className="text-indigo-500" />;
      case "LayoutTemplate":
        return <LayoutTemplate size={19} className="text-cyan-500" />;
      case "Users":
        return <Users size={19} className="text-orange-500" />;
      case "Database":
        return <Database size={19} className="text-blue-600" />;
      case "Clock":
        return <Clock size={19} className="text-amber-500" />;
      case "Settings":
        return <Settings size={19} className="text-slate-500" />;
      case "Heart":
        return <Heart size={19} className="text-rose-500" />;
      case "Bell":
        return <Bell size={19} className="text-pink-500" />;
      case "LogIn":
        return <LogIn size={19} className="text-sky-500" />;
      case "Shield":
        return <Shield size={19} className="text-teal-500" />;
      case "ClipboardList":
        return <ClipboardList size={19} className="text-slate-500" />;
      default:
        return <BookOpen size={19} />;
    }
  };

  return (
    <div className="about-page">
      {/* Top Search and Category Filter Toolbar */}
      <div className="wiki-search-toolbar">
        <div className="wiki-search-input-box">
          <Search size={17} className="wiki-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="wiki-search-input"
            placeholder={t("about.wiki.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="wiki-search-clear-btn"
              title={t("about.wiki.searchClear")}
              onClick={() => setSearchQuery("")}
            >
              <X size={15} />
            </button>
          )}
          <span className="wiki-search-stats">
            {filteredChapters.length} {t("about.wiki.related")}
          </span>
        </div>

        {/* Category Chips */}
        <div className="wiki-category-chips" role="tablist">
          {wikiCategories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`wiki-category-chip ${selectedCategory === cat.key ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat.key)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wikiLayoutRef} className="about-wiki-layout">
        {/* Main Documentation Articles Column */}
        <article className="about-article">
          <header className="wiki-clean-header">
            <div className="wiki-header-title-box">
              <h1 className="wiki-main-title">
                {t("about.wiki.title")}
                <span className="wiki-version-tag">v{PANEL_VERSION}</span>
              </h1>
              <p className="wiki-subtitle">
                {t("about.wiki.subtitle")}
              </p>
            </div>
          </header>

          {/* Chapters Rendering */}
          {filteredChapters.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center", color: "#64748b" }}>
              <Search size={36} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 6px" }}>{t("about.wiki.emptyTitle")}</h3>
              <p style={{ fontSize: "13px", margin: 0 }}>
                {t("about.wiki.emptyHint")}
              </p>
              <button
                type="button"
                className="wiki-category-chip active"
                style={{ marginTop: "14px" }}
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                }}
              >
                {t("about.wiki.reset")}
              </button>
            </div>
          ) : (
            filteredChapters.map((chapter) => (
              <section
                key={chapter.id}
                id={chapter.id}
                className="wiki-chapter-article"
              >
                <div className="wiki-chapter-header">
                  <div className="wiki-chapter-title-row">
                    <h2 className="wiki-chapter-title">
                      {renderChapterIcon(chapter.iconName)}
                      <span>{chapter.title}</span>
                    </h2>
                    {chapter.badge && (
                      <span className="wiki-chapter-badge">{chapter.badge}</span>
                    )}
                  </div>
                  <p className="wiki-chapter-summary">{chapter.summary}</p>
                </div>

                {/* Subsections */}
                {chapter.subsections.map((sub) => (
                  <div key={sub.id} className="wiki-subsection">
                    <h3 className="wiki-subsection-title">{sub.title}</h3>

                    {sub.description && (
                      <p className="wiki-subsection-desc">{sub.description}</p>
                    )}

                    {/* Bullets */}
                    {sub.bullets && sub.bullets.length > 0 && (
                      <ul className="wiki-bullet-list">
                        {sub.bullets.map((bullet, bIdx) => (
                          <li key={bIdx}>{bullet}</li>
                        ))}
                      </ul>
                    )}

                    {/* Callout */}
                    {sub.callout && (
                      <div className={`wiki-callout ${sub.callout.type}`}>
                        {sub.callout.type === "tip" && <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
                        {sub.callout.type === "warning" && <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
                        {sub.callout.type === "note" && <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
                        <div>
                          <strong>{sub.callout.title}</strong>
                          <span>{sub.callout.text}</span>
                        </div>
                      </div>
                    )}

                    {/* Table */}
                    {sub.table && (
                      <div className="wiki-table-container">
                        <table className="wiki-data-table">
                          <thead>
                            <tr>
                              {sub.table.headers.map((h, hIdx) => (
                                <th key={hIdx}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sub.table.rows.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx}>{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Parameters Table */}
                    {sub.parameters && sub.parameters.length > 0 && (
                      <div className="wiki-table-container">
                        <table className="wiki-data-table">
                          <thead>
                            <tr>
                              <th>{t("about.wiki.paramName")}</th>
                              <th>{t("about.wiki.paramType")}</th>
                              <th>{t("about.wiki.paramDefault")}</th>
                              <th>{t("about.wiki.paramDesc")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sub.parameters.map((param, pIdx) => (
                              <tr key={pIdx}>
                                <td><code>{param.name}</code></td>
                                <td><span style={{ color: "#6366f1", fontWeight: 600 }}>{param.type || "string"}</span></td>
                                <td>{param.defaultVal ? <code>{param.defaultVal}</code> : "-"}</td>
                                <td>{param.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Embedded Pure CSS/DOM UI Mockup Legend (Non-interactive) */}
                    {sub.mockupKey && renderMockup(sub.mockupKey)}
                  </div>
                ))}
              </section>
            ))
          )}
        </article>

        {/* Right Sticky Column: Infobox + Updates + Wiki Table of Contents */}
        <aside ref={sideColumnRef} className="about-side-column" aria-label={t("about.sidebar")}>
          {/* Infobox & Update Checker */}
          <section className="about-infobox" aria-label={t("about.projectInfo")}>
            <div className="about-infobox-title">
              <div className="about-icon">
                <img className="about-project-logo" src={projectLogoSrc} alt="" draggable={false} />
              </div>
              <div>
                <strong>Saki Panel</strong>
                <span>{t("about.subtitle")}</span>
              </div>
            </div>

            <dl className="about-info-list">
              <div>
                <dt>{t("about.currentVersion")}</dt>
                <dd>{currentVersion}</dd>
              </div>
              <div>
                <dt>{t("about.author")}</dt>
                <dd>帥気的男主角</dd>
              </div>
              <div>
                <dt>{t("about.contact")}</dt>
                <dd>QQ: 3151815823</dd>
              </div>
              <div>
                <dt>{t("about.license")}</dt>
                <dd>Apache-2.0</dd>
              </div>
              <div>
                <dt>{t("about.repository")}</dt>
                <dd>
                  <a href="https://github.com/EthanChan050430/Saki-Panel" target="_blank" rel="noopener noreferrer">
                    <Github size={14} />
                    EthanChan050430/Saki-Panel
                  </a>
                </dd>
              </div>
            </dl>

            {/* Check for updates */}
            <div className="about-update-panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h2 style={{ margin: 0 }}>
                  <RefreshCw size={15} />
                  {t("about.updateCheck")}
                </h2>
                {deploymentMode && (
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "10px",
                      backgroundColor: deploymentMode === "git" ? "rgba(99, 102, 241, 0.12)" : "rgba(16, 185, 129, 0.12)",
                      color: deploymentMode === "git" ? "#818cf8" : "#34d399",
                      fontWeight: 600
                    }}
                  >
                    {deploymentMode === "git" ? t("about.update.modeGit") : t("about.update.modeRelease")}
                  </span>
                )}
              </div>
              <div className="update-status">
                <div className={`status-indicator ${updateStatus}`}>
                  {updateStatus === "checking" && <Loader2 size={15} className="status-spinner" />}
                  {updateStatus === "available" && <DownloadCloud size={15} />}
                  {updateStatus === "up-to-date" && <CheckCircle2 size={15} />}
                  {updateStatus === "updating" && <Loader2 size={15} className="status-spinner" />}
                  {updateStatus === "error" && <Bug size={15} />}
                  {updateStatus === "idle" && <Clock size={15} />}
                </div>
                <span className="status-text">{updateMessage || t("about.update.idle")}</span>
              </div>
              <div className="update-actions">
                <button
                  className="update-btn check-btn"
                  onClick={checkForUpdates}
                  disabled={updateStatus === "checking" || updateStatus === "updating"}
                >
                  {updateStatus === "checking" ? t("about.update.checking") : updateStatus === "updating" ? t("common.loading") : t("about.update.check")}
                </button>
                {updateStatus === "available" && (
                  <a
                    className="update-btn update-btn-primary"
                    href={latestReleaseUrl || "https://github.com/EthanChan050430/Saki-Panel/releases"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DownloadCloud size={14} />
                    {t("about.update.release")}
                  </a>
                )}
                {updateStatus === "up-to-date" && deploymentMode === "git" && (
                  <button
                    className="update-btn"
                    onClick={() => window.location.reload()}
                    title={t("about.update.refreshPage")}
                  >
                    <RefreshCw size={13} />
                    {t("about.update.refreshPage")}
                  </button>
                )}
              </div>
              {latestVersion && (
                <p className="latest-version-info">{t("about.update.latest")}: {latestVersion}</p>
              )}
            </div>
          </section>

          {/* Dynamic Wiki Table of Contents */}
          <nav ref={tocRef} className="about-toc" aria-label={t("about.wiki.tocAria")}>
            <div className="about-toc-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{t("about.toc")} ({filteredChapters.length})</span>
              {searchQuery && (
                <span style={{ fontSize: "11px", color: "#ff75ac", fontWeight: 600 }}>{t("about.wiki.searching")}</span>
              )}
            </div>

            <div className="wiki-toc-list">
              {filteredChapters.map((ch) => (
                <a
                  key={ch.id}
                  href={`#${ch.id}`}
                  className={`wiki-toc-item ${activeChapterId === ch.id ? "active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToChapter(ch.id);
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ch.shortTitle}
                  </span>
                  {ch.badge && (
                    <span className="wiki-toc-badge">{ch.badge}</span>
                  )}
                </a>
              ))}
            </div>

            <div style={{ padding: "8px 10px 2px", fontSize: "11px", color: "#64748b", borderTop: "1px solid rgba(226, 232, 240, 0.6)" }}>
              💡 {t("about.wiki.slashHint")} <kbd style={{ padding: "1px 4px", borderRadius: 3, background: "rgba(148,163,184,0.18)", fontSize: "10px" }}>/</kbd> {t("about.wiki.slashHintAfter")}
            </div>
          </nav>
        </aside>
      </div>
    </div>
  );
}

const registrationIdentityOptions: Array<{ value: RegistrationIdentity; label: string }> = [
  { value: "none", label: "无角色" },
  { value: "user", label: "用户" },
  { value: "admin", label: "管理员" },
  { value: "super_admin", label: "超级管理员" }
];
