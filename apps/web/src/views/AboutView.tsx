import React, { useCallback, useState } from "react";
import {
  Bug,
  CheckCircle2,
  ClipboardList,
  Clock,
  Code2,
  DownloadCloud,
  FileText,
  Github,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal as TerminalIcon,
  Wrench
} from "lucide-react";
import type { RegistrationIdentity } from "@webops/shared";
import { PANEL_VERSION, isNewerVersion, extractVersionString } from "@webops/shared";
import { usePanelT } from "../i18n/index.js";
import { defaultPanelAppearance } from "../constants.js";
import { api } from "../api.js";

interface AboutViewProps {
  token?: string;
}

export function AboutView({ token }: AboutViewProps = {}) {
  const t = usePanelT();
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "up-to-date" | "updating" | "error">("idle");
  const [updateMessage, setUpdateMessage] = useState("");
  const currentVersion = `v${PANEL_VERSION}`;
  const projectLogoSrc = defaultPanelAppearance.appLogoSrc;
  const [latestVersion, setLatestVersion] = useState("");
  const [latestReleaseUrl, setLatestReleaseUrl] = useState("");

  const checkForUpdates = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateMessage(t("about.update.messageChecking"));
    try {
      let resolvedVersion = "";
      let resolvedUrl = "https://github.com/EthanChan050430/Saki-Panel/releases";
      let hasUpdate = false;

      // 1. First attempt update check via Panel backend API
      try {
        const backendRes = await api.checkSystemUpdate(true, token);
        if (backendRes && backendRes.latestVersion) {
          resolvedVersion = backendRes.latestVersion;
          resolvedUrl = backendRes.releaseUrl || resolvedUrl;
          hasUpdate = backendRes.hasUpdate;
        }
      } catch {
        // Fall back to direct browser fetch if backend check fails
      }

      // 2. Client-side fallback to GitHub APIs / Mirrors
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

      if (resolvedVersion) {
        setLatestVersion(resolvedVersion);
        setLatestReleaseUrl(resolvedUrl);
        if (hasUpdate) {
          setUpdateStatus("available");
          setUpdateMessage(`${t("about.update.messageAvailable")}: ${resolvedVersion}`);
        } else {
          setUpdateStatus("up-to-date");
          setUpdateMessage(t("about.update.messageCurrent"));
        }
      } else {
        throw new Error(t("about.update.errorVersion"));
      }
    } catch (err) {
      setUpdateStatus("error");
      setUpdateMessage(err instanceof Error ? err.message : t("about.update.errorFailed"));
    }
  }, [currentVersion, t, token]);

  return (
    <div className="about-page">
      <div className="about-wiki-layout">
        <article className="about-article">
          <header className="about-article-header">
            <div className="about-kicker">
              <img className="about-kicker-logo" src={projectLogoSrc} alt="" draggable={false} />
              {t("about.kicker")}
            </div>
            <h1>Saki Panel</h1>
            <p>{t("about.summary")}</p>
            <div className="about-meta-strip" aria-label={t("about.kicker")}>
              <span>{t("about.meta.version")} {currentVersion}</span>
              <span>Apache-2.0 License</span>
              <span>React + TypeScript</span>
              <span>{t("about.meta.architecture")}</span>
            </div>
          </header>

          <section id="about-overview" className="about-wiki-section">
            <h2>
              <Info size={18} />
              {t("about.overview")}
            </h2>
            <p>{t("about.overview.copy")}</p>
            <dl className="about-definition-list">
              <div>
                <dt>{t("about.position")}</dt>
                <dd>{t("about.position.value")}</dd>
              </div>
              <div>
                <dt>{t("about.scenario")}</dt>
                <dd>{t("about.scenario.value")}</dd>
              </div>
              <div>
                <dt>{t("about.design")}</dt>
                <dd>{t("about.design.value")}</dd>
              </div>
            </dl>
          </section>

          <section id="about-architecture" className="about-wiki-section">
            <h2>
              <Layers size={18} />
              {t("about.architecture")}
            </h2>
            <p>{t("about.architecture.copy")}</p>
            <div className="about-component-grid">
              <div>
                <Server size={18} />
                <strong>Panel</strong>
                <span>{t("about.panel.copy")}</span>
              </div>
              <div>
                <TerminalIcon size={18} />
                <strong>Daemon</strong>
                <span>{t("about.daemon.copy")}</span>
              </div>
              <div>
                <FileText size={18} />
                <strong>Web Console</strong>
                <span>{t("about.web.copy")}</span>
              </div>
            </div>
          </section>

          <section id="about-features" className="about-wiki-section">
            <h2>
              <Wrench size={18} />
              {t("about.features")}
            </h2>
            <div className="about-feature-table" role="table" aria-label={t("about.features")}>
              <div role="row">
                <span role="columnheader">{t("about.features.module")}</span>
                <span role="columnheader">{t("about.features.purpose")}</span>
                <span role="columnheader">{t("about.features.value")}</span>
              </div>
              <div role="row">
                <span role="cell">{t("about.feature.instances")}</span>
                <span role="cell">{t("about.feature.instances.purpose")}</span>
                <span role="cell">{t("about.feature.instances.value")}</span>
              </div>
              <div role="row">
                <span role="cell">{t("about.feature.files")}</span>
                <span role="cell">{t("about.feature.files.purpose")}</span>
                <span role="cell">{t("about.feature.files.value")}</span>
              </div>
              <div role="row">
                <span role="cell">{t("about.feature.nodes")}</span>
                <span role="cell">{t("about.feature.nodes.purpose")}</span>
                <span role="cell">{t("about.feature.nodes.value")}</span>
              </div>
              <div role="row">
                <span role="cell">{t("about.feature.templates")}</span>
                <span role="cell">{t("about.feature.templates.purpose")}</span>
                <span role="cell">{t("about.feature.templates.value")}</span>
              </div>
              <div role="row">
                <span role="cell">{t("about.feature.saki")}</span>
                <span role="cell">{t("about.feature.saki.purpose")}</span>
                <span role="cell">{t("about.feature.saki.value")}</span>
              </div>
            </div>
          </section>

          <section id="about-workflow" className="about-wiki-section">
            <h2>
              <ClipboardList size={18} />
              {t("about.workflow")}
            </h2>
            <ol className="about-flow-list">
              <li>
                <strong>{t("about.workflow.node")}</strong>
                <span>{t("about.workflow.node.copy")}</span>
              </li>
              <li>
                <strong>{t("about.workflow.template")}</strong>
                <span>{t("about.workflow.template.copy")}</span>
              </li>
              <li>
                <strong>{t("about.workflow.deploy")}</strong>
                <span>{t("about.workflow.deploy.copy")}</span>
              </li>
              <li>
                <strong>{t("about.workflow.maintain")}</strong>
                <span>{t("about.workflow.maintain.copy")}</span>
              </li>
            </ol>
          </section>

          <section id="about-security" className="about-wiki-section">
            <h2>
              <ShieldCheck size={18} />
              {t("about.security")}
            </h2>
            <p>{t("about.security.copy")}</p>
            <ul className="about-check-list">
              <li>{t("about.security.userRoles")}</li>
              <li>{t("about.security.assignment")}</li>
              <li>{t("about.security.audit")}</li>
              <li>{t("about.security.runtime")}</li>
            </ul>
          </section>

          <section id="about-stack" className="about-wiki-section">
            <h2>
              <Code2 size={18} />
              {t("about.stack")}
            </h2>
            <div className="about-stack-list">
              <span>React 19</span>
              <span>TypeScript</span>
              <span>Vite</span>
              <span>Fastify</span>
              <span>Prisma</span>
              <span>WebSocket</span>
              <span>xterm.js</span>
              <span>CodeMirror</span>
            </div>
          </section>

          <section id="about-maintenance" className="about-wiki-section">
            <h2>
              <RefreshCw size={18} />
              {t("about.maintenance")}
            </h2>
            <p>{t("about.maintenance.copy")}</p>
          </section>
        </article>

        <aside className="about-side-column" aria-label={t("about.sidebar")}>
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
                    <Github size={15} />
                    EthanChan050430/Saki-Panel
                  </a>
                </dd>
              </div>
            </dl>

            <div className="about-update-panel">
              <h2>
                <RefreshCw size={16} />
                {t("about.updateCheck")}
              </h2>
              <div className="update-status">
                <div className={`status-indicator ${updateStatus}`}>
                  {updateStatus === "checking" && <Loader2 size={16} className="status-spinner" />}
                  {updateStatus === "available" && <DownloadCloud size={16} />}
                  {updateStatus === "up-to-date" && <CheckCircle2 size={16} />}
                  {updateStatus === "updating" && <Loader2 size={16} className="status-spinner" />}
                  {updateStatus === "error" && <Bug size={16} />}
                  {updateStatus === "idle" && <Clock size={16} />}
                </div>
                <span className="status-text">{updateMessage || t("about.update.idle")}</span>
              </div>
              <div className="update-actions">
                <button
                  className="update-btn check-btn"
                  onClick={checkForUpdates}
                  disabled={updateStatus === "checking" || updateStatus === "updating"}
                >
                  {updateStatus === "checking" ? t("about.update.checking") : t("about.update.check")}
                </button>
                {updateStatus === "available" && (
                  <a
                    className="update-btn update-btn-primary"
                    href={latestReleaseUrl || "https://github.com/EthanChan050430/Saki-Panel/releases"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DownloadCloud size={15} />
                    {t("about.update.release")}
                  </a>
                )}
              </div>
              {latestVersion && (
                <p className="latest-version-info">{t("about.update.latest")}: {latestVersion}</p>
              )}
            </div>
          </section>

          <nav className="about-toc" aria-label={t("about.toc")}>
            <div className="about-toc-heading">{t("about.toc")}</div>
            <a href="#about-overview">{t("about.overview")}</a>
            <a href="#about-architecture">{t("about.architecture")}</a>
            <a href="#about-features">{t("about.features")}</a>
            <a href="#about-workflow">{t("about.workflow")}</a>
            <a href="#about-security">{t("about.security")}</a>
            <a href="#about-stack">{t("about.stack")}</a>
            <a href="#about-maintenance">{t("about.maintenance")}</a>
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
