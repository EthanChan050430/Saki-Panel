import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Layers,
  DownloadCloud,
  Search,
  Palette,
  Gamepad2,
  Wrench,
  Globe,
  Smile,
  Trash2,
  Power,
  RefreshCw,
  Plus,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Activity,
  X,
  Check,
  Star,
  Code2,
  ArrowRight,
  ChevronDown,
  MoreHorizontal,
  Play,
  ExternalLink,
  Sparkles
} from "lucide-react";
import type { CurrentUser, InstalledPlugin, PluginRegistryItem, PluginType } from "@webops/shared";
import { api } from "../api.js";
import { usePlugins } from "../plugins/PluginContext.js";
import { PluginGameModal } from "../plugins/PluginGameModal.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { PageErrorToast, PageNoticeToast } from "../components/common/CommonUI.js";
import { usePanelT, usePanelLanguage } from "../i18n/index.js";

interface PluginStoreViewProps {
  token: string;
  currentUser: CurrentUser;
}

export function PluginStoreView({ token, currentUser }: PluginStoreViewProps) {
  const t = usePanelT();
  const { language } = usePanelLanguage();
  const {
    installedPlugins,
    activeTheme,
    activeSkin,
    mirrors,
    selectedMirrorId,
    updateStatuses,
    refreshPlugins,
    togglePlugin,
    setActiveTheme,
    setActiveSkin,
    uninstallPlugin,
    installFromGithub,
    saveMirrorConfig,
    checkUpdates,
    updatePlugin
  } = usePlugins();

  const [activeTab, setActiveTab] = useState<"installed" | "registry" | "updates">("installed");
  const [selectedType, setSelectedType] = useState<PluginType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Update section states
  const [updateStatusFilter, setUpdateStatusFilter] = useState<"all" | "has-update" | "up-to-date">("all");
  const [selectedForUpdate, setSelectedForUpdate] = useState<Set<string>>(new Set());
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [checkingSingleId, setCheckingSingleId] = useState<string | null>(null);

  // Registry state
  const [registryItems, setRegistryItems] = useState<PluginRegistryItem[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(false);

  // Mirror testing & Dropdown
  const [testingMirrors, setTestingMirrors] = useState(false);
  const [mirrorLatencies, setMirrorLatencies] = useState<Record<string, { pingMs: number; ok: boolean; error?: string }>>({});
  const [mirrorDropdownOpen, setMirrorDropdownOpen] = useState(false);
  const [activeCardMenuId, setActiveCardMenuId] = useState<string | null>(null);
  const mirrorDropdownRef = React.useRef<HTMLDivElement>(null);

  // Install Modal
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [installRepoInput, setInstallRepoInput] = useState("");
  const [installRefInput, setInstallRefInput] = useState("main");
  const [installCustomMirror, setInstallCustomMirror] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installingItemName, setInstallingItemName] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);

  // Developer Guide Modal
  const [guideModalOpen, setGuideModalOpen] = useState(false);

  // Playing Game
  const [playingGame, setPlayingGame] = useState<InstalledPlugin | null>(null);

  // Update checking
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const pluginsWithSource = useMemo(() => {
    return installedPlugins.filter((p) => Boolean(p.sourceRepo));
  }, [installedPlugins]);

  const availableUpdatesCount = useMemo(() => {
    return pluginsWithSource.filter((p) => Boolean(updateStatuses[p.id]?.updatesAvailable)).length;
  }, [pluginsWithSource, updateStatuses]);

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    setToastError(null);
    try {
      const results = await checkUpdates();
      setLastCheckedAt(new Date());
      const updatables = Object.values(results).filter((s) => s.updatesAvailable);
      if (updatables.length > 0) {
        setSelectedForUpdate(new Set(updatables.map((s) => s.pluginId)));
        setToastNotice(
          language === "en-US"
            ? `Check complete: found ${updatables.length} update(s)!`
            : language === "ja-JP"
            ? `確認完了：${updatables.length} 件の更新が見つかりました！`
            : language === "zh-TW"
            ? `檢查完成：發現 ${updatables.length} 個可升級擴充！`
            : `检测完成：发现 ${updatables.length} 个可升级扩展！`
        );
      } else {
        setToastNotice(
          language === "en-US"
            ? "Check complete: all plugins are up to date"
            : language === "ja-JP"
            ? "確認完了：すべてのプラグインが最新です"
            : language === "zh-TW"
            ? "檢查完成：所有已安裝擴充均已是最新版本"
            : "检测完成：所有已安装扩展均已是最新版本"
        );
      }
    } catch (err) {
      setToastError(
        language === "en-US"
          ? `Update check failed: ${err instanceof Error ? err.message : String(err)}`
          : language === "ja-JP"
          ? `更新確認失敗: ${err instanceof Error ? err.message : String(err)}`
          : language === "zh-TW"
          ? `檢查更新失敗: ${err instanceof Error ? err.message : String(err)}`
          : `检测更新失败: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleCheckSingle = async (pluginId: string) => {
    setCheckingSingleId(pluginId);
    setToastError(null);
    try {
      const res = await checkUpdates([pluginId]);
      const status = res[pluginId];
      if (status?.updatesAvailable) {
        setSelectedForUpdate((prev) => new Set(prev).add(pluginId));
        setToastNotice(
          language === "en-US"
            ? "New version available for this plugin!"
            : language === "ja-JP"
            ? "このプラグインの新バージョンが利用可能です！"
            : language === "zh-TW"
            ? "檢查到該擴充有新版本可用！"
            : "检测到该插件有新版本可用！"
        );
      } else if (status?.error) {
        setToastError(
          language === "en-US"
            ? `Check failed: ${status.error}`
            : language === "ja-JP"
            ? `確認失敗: ${status.error}`
            : language === "zh-TW"
            ? `檢查失敗: ${status.error}`
            : `检测失败: ${status.error}`
        );
      } else {
        setToastNotice(
          language === "en-US"
            ? "This plugin is already up to date"
            : language === "ja-JP"
            ? "このプラグインは最新バージョンです"
            : language === "zh-TW"
            ? "該擴充已是最新版本"
            : "该插件已是最新版本"
        );
      }
    } catch (err) {
      setToastError(
        language === "en-US"
          ? `Check failed: ${err instanceof Error ? err.message : String(err)}`
          : language === "ja-JP"
          ? `確認失敗: ${err instanceof Error ? err.message : String(err)}`
          : language === "zh-TW"
          ? `檢查失敗: ${err instanceof Error ? err.message : String(err)}`
          : `检测失败: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setCheckingSingleId(null);
    }
  };

  const handleUpdatePlugin = async (id: string, displayName: string) => {
    setUpdatingIds((prev) => new Set(prev).add(id));
    setToastError(null);
    try {
      const updated = await updatePlugin(id);
      if (updated) {
        setToastNotice(
          language === "en-US"
            ? `Plugin "${displayName}" updated to v${updated.manifest.version}`
            : language === "ja-JP"
            ? `プラグイン「${displayName}」が v${updated.manifest.version} に更新されました`
            : language === "zh-TW"
            ? `擴充「${displayName}」已更新至最新版本 v${updated.manifest.version}`
            : `扩展「${displayName}」已更新至最新版本 v${updated.manifest.version}`
        );
        setSelectedForUpdate((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        setToastError(
          language === "en-US"
            ? "Update failed, please try again"
            : language === "ja-JP"
            ? "更新に失敗しました。後でもう一度お試しください"
            : language === "zh-TW"
            ? "更新失敗，請稍後重試"
            : "更新失败，请稍后重试"
        );
      }
    } catch (err) {
      setToastError(
        language === "en-US"
          ? `Update failed: ${err instanceof Error ? err.message : String(err)}`
          : language === "ja-JP"
          ? `更新失敗: ${err instanceof Error ? err.message : String(err)}`
          : language === "zh-TW"
          ? `更新失敗: ${err instanceof Error ? err.message : String(err)}`
          : `更新失败: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleUpdateSelected = async () => {
    const updatableIds = Array.from(selectedForUpdate).filter((id) => {
      const p = installedPlugins.find((item) => item.id === id);
      return p && updateStatuses[id]?.updatesAvailable;
    });
    if (updatableIds.length === 0) return;

    setUpdatingIds((prev) => new Set([...prev, ...updatableIds]));
    setToastError(null);
    let successCount = 0;
    let failCount = 0;

    for (const id of updatableIds) {
      const p = installedPlugins.find((item) => item.id === id);
      try {
        const updated = await updatePlugin(id);
        if (updated) {
          successCount++;
          setSelectedForUpdate((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      } finally {
        setUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }

    if (successCount > 0 && failCount === 0) {
      setToastNotice(
        language === "en-US"
          ? `Successfully updated ${successCount} plugin(s) to latest version!`
          : language === "ja-JP"
          ? `${successCount} 件のプラグインを最新バージョンに更新しました！`
          : language === "zh-TW"
          ? `已成功將 ${successCount} 個擴充更新至最新版本！`
          : `已成功将 ${successCount} 个扩展更新至最新版本！`
      );
    } else if (successCount > 0 && failCount > 0) {
      setToastNotice(
        language === "en-US"
          ? `Successfully updated ${successCount} plugin(s), ${failCount} failed`
          : language === "ja-JP"
          ? `${successCount} 件の更新に成功し、${failCount} 件失敗しました`
          : language === "zh-TW"
          ? `已成功更新 ${successCount} 個擴充，${failCount} 個失敗`
          : `已成功更新 ${successCount} 个扩展，${failCount} 个失败`
      );
    } else if (failCount > 0) {
      setToastError(
        language === "en-US"
          ? "Failed to update plugins, please try again"
          : language === "ja-JP"
          ? "プラグインの更新に失敗しました。後でお試しください"
          : language === "zh-TW"
          ? "擴充更新失敗，請稍後重試"
          : "扩展更新失败，请稍后重试"
      );
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedForUpdate((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isAllAvailableSelected = useMemo(() => {
    const updatableIds = pluginsWithSource
      .filter((p) => Boolean(updateStatuses[p.id]?.updatesAvailable))
      .map((p) => p.id);
    if (updatableIds.length === 0) return false;
    return updatableIds.every((id) => selectedForUpdate.has(id));
  }, [pluginsWithSource, updateStatuses, selectedForUpdate]);

  const handleToggleSelectAll = () => {
    const updatableIds = pluginsWithSource
      .filter((p) => Boolean(updateStatuses[p.id]?.updatesAvailable))
      .map((p) => p.id);
    if (isAllAvailableSelected) {
      setSelectedForUpdate((prev) => {
        const next = new Set(prev);
        for (const id of updatableIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedForUpdate((prev) => {
        const next = new Set(prev);
        for (const id of updatableIds) next.add(id);
        return next;
      });
    }
  };

  const lastCheckedText = useMemo(() => {
    if (!lastCheckedAt) return null;
    const diffSec = Math.floor((Date.now() - lastCheckedAt.getTime()) / 1000);
    if (diffSec < 60) return t("plugins.updates.timeJustNow");
    if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      return language === "en-US"
        ? `${mins}m ago`
        : language === "ja-JP"
        ? `${mins}分前`
        : language === "zh-TW"
        ? `${mins} 分鐘前`
        : `${mins} 分钟前`;
    }
    return lastCheckedAt.toLocaleTimeString();
  }, [lastCheckedAt, t, language]);

  // Auto-check on first visiting updates tab
  useEffect(() => {
    if (activeTab === "updates" && !lastCheckedAt && !checkingUpdates && pluginsWithSource.length > 0) {
      void handleCheckUpdates();
    }
  }, [activeTab]);

  // Load community registry items
  const loadRegistry = useCallback(async () => {
    setLoadingRegistry(true);
    try {
      const res = await api.pluginRegistry(token);
      if (res.ok) {
        setRegistryItems(res.items);
      }
    } catch (err) {
      console.error("Failed to load plugin registry:", err);
    } finally {
      setLoadingRegistry(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  // Click outside to close menus & dropdowns
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (mirrorDropdownRef.current && !mirrorDropdownRef.current.contains(e.target as Node)) {
        setMirrorDropdownOpen(false);
      }
      const target = e.target as HTMLElement;
      if (!target.closest(".plugin-card-menu-container")) {
        setActiveCardMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  // Mirror latency test
  const handleTestMirrors = async () => {
    setTestingMirrors(true);
    try {
      const res = await api.testMirrors(token);
      if (res.ok && res.results) {
        const map: Record<string, { pingMs: number; ok: boolean; error?: string }> = {};
        for (const item of res.results) {
          map[item.mirrorId] = {
            pingMs: item.pingMs,
            ok: item.ok,
            ...(item.error !== undefined ? { error: item.error } : {})
          };
        }
        setMirrorLatencies(map);
      }
    } catch (err) {
      console.error("Mirror speed test error:", err);
    } finally {
      setTestingMirrors(false);
    }
  };

  const handleMirrorChange = async (mirrorId: string) => {
    await saveMirrorConfig(mirrorId);
  };

  const handleInstallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installRepoInput.trim()) return;

    setInstalling(true);
    setInstallError(null);
    setToastError(null);
    try {
      const payload: { repoOrUrl: string; ref?: string; mirrorId?: string; customMirrorUrl?: string } = {
        repoOrUrl: installRepoInput.trim()
      };
      if (installRefInput.trim()) payload.ref = installRefInput.trim();
      if (selectedMirrorId) payload.mirrorId = selectedMirrorId;
      if (installCustomMirror.trim()) payload.customMirrorUrl = installCustomMirror.trim();

      const installed = await installFromGithub(payload);
      setInstallModalOpen(false);
      setInstallRepoInput("");
      setToastNotice(
        language === "en-US"
          ? `Successfully installed plugin "${installed.map((p) => p.manifest.displayName).join("、")}"`
          : language === "ja-JP"
          ? `プラグイン「${installed.map((p) => p.manifest.displayName).join("、")}」をインストールしました`
          : language === "zh-TW"
          ? `已成功安裝擴充「${installed.map((p) => p.manifest.displayName).join("、")}」`
          : `已成功安装扩展「${installed.map((p) => p.manifest.displayName).join("、")}」`
      );
      setActiveTab("installed");
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  const handleQuickInstall = async (item: PluginRegistryItem) => {
    setInstalling(true);
    setInstallingItemName(item.name);
    setToastError(null);
    try {
      const installed = await installFromGithub({
        repoOrUrl: item.repo,
        pluginName: item.name,
        mirrorId: selectedMirrorId
      });
      setToastNotice(
        language === "en-US"
          ? `Successfully installed plugin "${installed.map((p) => p.manifest.displayName).join("、")}"`
          : language === "ja-JP"
          ? `プラグイン「${installed.map((p) => p.manifest.displayName).join("、")}」をインストールしました`
          : language === "zh-TW"
          ? `已成功安裝擴充「${installed.map((p) => p.manifest.displayName).join("、")}」`
          : `已成功安装扩展「${installed.map((p) => p.manifest.displayName).join("、")}」`
      );
      setActiveTab("installed");
    } catch (err) {
      setToastError(
        language === "en-US"
          ? `Installation failed: ${err instanceof Error ? err.message : String(err)}`
          : language === "ja-JP"
          ? `インストール失敗: ${err instanceof Error ? err.message : String(err)}`
          : language === "zh-TW"
          ? `安裝失敗: ${err instanceof Error ? err.message : String(err)}`
          : `安装失败: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setInstalling(false);
      setInstallingItemName(null);
    }
  };

  // Filtered lists
  const matchesSelectedType = (type: PluginType, selected: PluginType | "all") => {
    if (selected === "all") return true;
    if (selected === "widget") return type === "widget" || type === "locale";
    return type === selected;
  };

  // Filtered lists
  const filteredInstalled = useMemo(() => {
    return installedPlugins.filter((p) => {
      if (!matchesSelectedType(p.manifest.type, selectedType)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.manifest.displayName.toLowerCase().includes(q) ||
          p.manifest.description.toLowerCase().includes(q) ||
          p.manifest.author.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [installedPlugins, selectedType, searchQuery]);

  const filteredRegistry = useMemo(() => {
    return registryItems.filter((item) => {
      if (!matchesSelectedType(item.type, selectedType)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.displayName.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.author.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [registryItems, selectedType, searchQuery]);

  const filteredUpdates = useMemo(() => {
    return pluginsWithSource.filter((p) => {
      const status = updateStatuses[p.id];
      const hasUpdate = Boolean(status?.updatesAvailable);

      if (updateStatusFilter === "has-update" && !hasUpdate) return false;
      if (updateStatusFilter === "up-to-date" && hasUpdate) return false;

      if (!matchesSelectedType(p.manifest.type, selectedType)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.manifest.displayName.toLowerCase().includes(q) ||
          p.manifest.description.toLowerCase().includes(q) ||
          p.manifest.author.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.sourceRepo?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [pluginsWithSource, updateStatuses, updateStatusFilter, selectedType, searchQuery]);

  const getTypeIcon = (type: PluginType) => {
    switch (type) {
      case "theme":
        return <Palette size={13} />;
      case "skin":
        return <Smile size={13} />;
      case "game":
        return <Gamepad2 size={13} />;
      case "widget":
      case "locale":
        return <Wrench size={13} />;
      default:
        return <Layers size={13} />;
    }
  };

  const getTypeLabel = (type: PluginType) => {
    switch (type) {
      case "theme":
        return t("plugins.type.theme");
      case "skin":
        return t("plugins.type.skin");
      case "game":
        return t("plugins.type.game");
      case "widget":
      case "locale":
        return t("plugins.type.widget");
      default:
        return type;
    }
  };

  return (
    <div className="plugin-store-view">
      <PageErrorToast error={toastError} onDismiss={() => setToastError(null)} />
      <PageNoticeToast notice={toastNotice} onDismiss={() => setToastNotice(null)} />

      {/* Header */}
      <div className="plugin-store-header">
        <div className="plugin-header-title-wrap">
          <div className="plugin-header-badge-icon">
            <Layers size={18} />
          </div>
          <div className="plugin-header-texts">
            <h2 className="plugin-header-title">{t("plugins.header.title")}</h2>
            <div className="plugin-header-meta">
              <span className="plugin-header-count-pill">
                {installedPlugins.length} {t("plugins.header.installedCount")}
              </span>
              {availableUpdatesCount > 0 ? (
                <span className="plugin-header-update-pill">
                  <Sparkles size={11} /> {availableUpdatesCount} {t("plugins.header.updatesAvailable")}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="plugin-store-header-actions">
          {/* GitHub Mirror Compact Pill Dropdown */}
          <div className="plugin-mirror-wrapper" ref={mirrorDropdownRef}>
            <button
              type="button"
              className={`plugin-mirror-pill ${mirrorDropdownOpen ? "is-open" : ""}`}
              onClick={() => setMirrorDropdownOpen((prev) => !prev)}
              title={t("plugins.mirror.tooltip")}
            >
              <Globe size={13} className="plugin-mirror-globe" />
              <span className="plugin-mirror-current-name">
                {mirrors.find((m) => m.id === selectedMirrorId)?.name.replace(/ \(.*\)/, "") || t("plugins.mirror.defaultTitle")}
              </span>
              {mirrorLatencies[selectedMirrorId] ? (
                <span
                  className={`plugin-mirror-pill-ping ${
                    mirrorLatencies[selectedMirrorId].ok
                      ? mirrorLatencies[selectedMirrorId].pingMs < 300
                        ? "is-fast"
                        : "is-medium"
                      : "is-slow"
                  }`}
                >
                  {mirrorLatencies[selectedMirrorId].ok
                    ? `${mirrorLatencies[selectedMirrorId].pingMs}ms`
                    : t("plugins.mirror.anomaly")}
                </span>
              ) : null}
              <ChevronDown size={12} className={`plugin-mirror-chevron ${mirrorDropdownOpen ? "is-open" : ""}`} />
            </button>

            {mirrorDropdownOpen ? (
              <div className="plugin-mirror-dropdown-menu">
                <div className="plugin-mirror-dropdown-header">
                  <span className="mirror-menu-title">{t("plugins.mirror.title")}</span>
                  <button
                    type="button"
                    className="plugin-mirror-test-mini-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleTestMirrors();
                    }}
                    disabled={testingMirrors}
                    title={t("plugins.mirror.testTooltip")}
                  >
                    <Activity size={11} className={testingMirrors ? "spin" : ""} />
                    <span>{testingMirrors ? t("plugins.mirror.testing") : t("plugins.mirror.speedTest")}</span>
                  </button>
                </div>
                <div className="plugin-mirror-options-list">
                  {mirrors.map((m) => {
                    const ping = mirrorLatencies[m.id];
                    const isSelected = m.id === selectedMirrorId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`plugin-mirror-option-item ${isSelected ? "is-active" : ""}`}
                        onClick={() => {
                          if (currentUser.isAdmin) {
                            void handleMirrorChange(m.id);
                          }
                          setMirrorDropdownOpen(false);
                        }}
                        disabled={!currentUser.isAdmin}
                      >
                        <span className="mirror-opt-name">{m.name}</span>
                        {ping ? (
                          <span
                            className={`mirror-opt-ping ${
                              ping.ok
                                ? ping.pingMs < 300
                                  ? "is-fast"
                                  : "is-medium"
                                : "is-slow"
                            }`}
                          >
                            {ping.ok ? `${ping.pingMs}ms` : t("plugins.mirror.timeout")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="plugin-header-subtle-btn"
            onClick={() => setGuideModalOpen(true)}
            title={t("plugins.header.devGuideTooltip")}
          >
            <BookOpen size={13} />
            <span>{t("plugins.header.devGuide")}</span>
          </button>

          {currentUser.isAdmin ? (
            <button
              type="button"
              className="plugin-header-primary-btn"
              onClick={() => setInstallModalOpen(true)}
              title={t("plugins.header.installTooltip")}
            >
              <Plus size={14} />
              <span>{t("plugins.header.install")}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Tabs & Filters */}
      <div className="plugin-toolbar">
        <div className="plugin-tabs">
          <button
            type="button"
            className={`plugin-tab-btn ${activeTab === "installed" ? "active" : ""}`}
            onClick={() => setActiveTab("installed")}
          >
            <span>{t("plugins.tabs.installed")}</span>
            <span className="plugin-tab-count">{installedPlugins.length}</span>
          </button>
          <button
            type="button"
            className={`plugin-tab-btn ${activeTab === "registry" ? "active" : ""}`}
            onClick={() => setActiveTab("registry")}
          >
            <span>{t("plugins.tabs.registry")}</span>
            <span className="plugin-tab-count">{registryItems.length}</span>
          </button>
          <button
            type="button"
            className={`plugin-tab-btn ${activeTab === "updates" ? "active" : ""}`}
            onClick={() => setActiveTab("updates")}
          >
            <span>{t("plugins.tabs.updates")}</span>
            {availableUpdatesCount > 0 && (
              <span className="plugin-tab-count has-updates-badge">
                {availableUpdatesCount}
              </span>
            )}
          </button>
        </div>

        <div className="plugin-filter-group">
          {(["all", "theme", "skin", "game", "widget"] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={`plugin-filter-chip ${selectedType === type ? "active" : ""}`}
              onClick={() => setSelectedType(type)}
            >
              {type === "all" ? t("plugins.type.all") : getTypeLabel(type as PluginType)}
            </button>
          ))}
        </div>

        <div className="plugin-search-box">
          <Search size={13} className="plugin-search-icon" />
          <input
            type="text"
            className="plugin-search-input"
            placeholder={t("plugins.search.placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button
              type="button"
              className="plugin-search-clear"
              onClick={() => setSearchQuery("")}
              title={t("plugins.search.clear")}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Installed Plugins View */}
      {activeTab === "installed" ? (
        filteredInstalled.length === 0 ? (
          <div style={{ padding: "40px 0" }}>
            <SakiEmptyState
              illustration="instances"
              title={searchQuery ? t("plugins.empty.noSearchTitle") : t("plugins.empty.noInstalledTitle")}
              description={
                searchQuery
                  ? t("plugins.empty.noSearchDesc")
                  : t("plugins.empty.noInstalledDesc")
              }
            />
          </div>
        ) : (
          <div className="plugin-grid">
            {filteredInstalled.map((p) => {
              const isCurrentTheme = activeTheme?.id === p.id;
              const isCurrentSkin = activeSkin?.id === p.id;
              const updateStatus = updateStatuses[p.id];
              const hasUpdate = Boolean(p.sourceRepo) && Boolean(updateStatus?.updatesAvailable);
              const isUpdating = updatingIds.has(p.id);
              const isFromSource = Boolean(p.sourceRepo);
              const isMenuOpen = activeCardMenuId === p.id;

              return (
                <div key={p.id} className={`plugin-art-card ${p.enabled ? "is-enabled" : "is-disabled"}`}>
                  {/* Visual Stage */}
                  <div
                    className={`plugin-art-stage ${p.manifest.type === "game" && p.enabled ? "is-playable" : ""}`}
                    onClick={() => {
                      if (p.manifest.type === "game" && p.enabled) {
                        setPlayingGame(p);
                      }
                    }}
                    title={p.manifest.type === "game" && p.enabled ? t("plugins.card.playClickHint") : undefined}
                  >
                    {p.manifest.icon ? (
                      <img
                        src={`/api/plugins/${encodeURIComponent(p.id)}/assets/${p.manifest.icon.replace(/^[/\\]+/, "")}?v=${encodeURIComponent(p.manifest.version)}`}
                        alt=""
                        className="plugin-art-img"
                      />
                    ) : (
                      <div className="plugin-art-fallback">
                        {getTypeIcon(p.manifest.type)}
                      </div>
                    )}

                    {p.manifest.type === "game" && p.enabled ? (
                      <div className="plugin-art-play-hint">
                        <div className="plugin-art-play-hint-badge">
                          <Play size={14} fill="currentColor" />
                          <span>{t("plugins.card.play")}</span>
                        </div>
                      </div>
                    ) : null}

                    {/* Floating Badges & Actions */}
                    <div className="plugin-art-top-bar">
                      <span className="plugin-art-type-pill">
                        {getTypeLabel(p.manifest.type)}
                      </span>

                      <div className="plugin-art-top-actions">
                        <span
                          className={`plugin-art-status-dot ${p.enabled ? "is-active" : "is-off"}`}
                          title={p.enabled ? t("plugins.card.enabled") : t("plugins.card.disabled")}
                        />

                        {currentUser.isAdmin ? (
                          <div className="plugin-card-menu-container">
                            <button
                              type="button"
                              className={`plugin-art-menu-trigger ${isMenuOpen ? "is-open" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveCardMenuId(isMenuOpen ? null : p.id);
                              }}
                              title={t("plugins.card.moreActions")}
                            >
                              <MoreHorizontal size={14} />
                            </button>

                            {isMenuOpen ? (
                              <div className="plugin-art-menu-popover" onClick={(e) => e.stopPropagation()}>
                                {p.manifest.type === "game" && p.enabled ? (
                                  <button
                                    type="button"
                                    className="plugin-art-menu-item is-highlight"
                                    onClick={() => {
                                      setActiveCardMenuId(null);
                                      setPlayingGame(p);
                                    }}
                                  >
                                    <Play size={13} fill="currentColor" />
                                    <span>{t("plugins.card.play")}</span>
                                  </button>
                                ) : null}

                                {isFromSource ? (
                                  <button
                                    type="button"
                                    className="plugin-art-menu-item"
                                    onClick={() => {
                                      setActiveCardMenuId(null);
                                      void handleCheckSingle(p.id);
                                    }}
                                    disabled={checkingSingleId === p.id}
                                  >
                                    <RefreshCw size={13} className={checkingSingleId === p.id ? "spin" : ""} />
                                    <span>{t("plugins.card.checkUpdate")}</span>
                                  </button>
                                ) : null}

                                {hasUpdate ? (
                                  <button
                                    type="button"
                                    className="plugin-art-menu-item is-highlight"
                                    onClick={() => {
                                      setActiveCardMenuId(null);
                                      void handleUpdatePlugin(p.id, p.manifest.displayName);
                                    }}
                                    disabled={isUpdating}
                                  >
                                    <DownloadCloud size={13} />
                                    <span>{t("plugins.card.upgradeNow")}</span>
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  className="plugin-art-menu-item"
                                  onClick={() => {
                                    setActiveCardMenuId(null);
                                    void togglePlugin(p.id);
                                  }}
                                >
                                  <Power size={13} />
                                  <span>{p.enabled ? t("plugins.card.disable") : t("plugins.card.enable")}</span>
                                </button>

                                <button
                                  type="button"
                                  className="plugin-art-menu-item is-danger"
                                  onClick={() => {
                                    setActiveCardMenuId(null);
                                    const confirmMsg =
                                      language === "en-US"
                                        ? `Are you sure you want to completely uninstall "${p.manifest.displayName}"? Local plugin assets will be removed.`
                                        : language === "ja-JP"
                                        ? `プラグイン「${p.manifest.displayName}」をアンインストールしますか？関連ファイルが削除されます。`
                                        : language === "zh-TW"
                                        ? `確定要徹底解除安裝擴充「${p.manifest.displayName}」？此操作將刪除相關本地資源。`
                                        : `确定要彻底卸载扩展「${p.manifest.displayName}」？此操作将删除相关本地资源。`;
                                    if (confirm(confirmMsg)) {
                                      void uninstallPlugin(p.id);
                                    }
                                  }}
                                >
                                  <Trash2 size={13} />
                                  <span>{t("plugins.card.uninstall")}</span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Info & Action Body */}
                  <div className="plugin-art-body">
                    <div className="plugin-art-header-row">
                      <div className="plugin-art-title-group">
                        <h4 className="plugin-art-title" title={p.manifest.displayName}>
                          {p.manifest.displayName}
                        </h4>
                        <span className="plugin-art-version">v{p.manifest.version}</span>
                      </div>
                      {hasUpdate ? (
                        <span className="plugin-art-update-alert">{t("plugins.card.hasUpdate")}</span>
                      ) : null}
                    </div>

                    <div className="plugin-art-author-line">
                      <span>by {p.manifest.author}</span>
                    </div>

                    <p className="plugin-art-desc" title={p.manifest.description}>
                      {p.manifest.description}
                    </p>

                    <div className="plugin-art-footer">
                      {p.manifest.type === "theme" ? (
                        isCurrentTheme ? (
                          <button
                            type="button"
                            className="plugin-art-applied-badge is-interactive"
                            onClick={() => void setActiveTheme(null)}
                            title={t("plugins.card.themeDeactivateTooltip")}
                          >
                            <span className="badge-applied-text">
                              <Check size={13} />
                              <span>{t("plugins.card.activeTheme")}</span>
                            </span>
                            <span className="badge-hover-text">
                              <Power size={13} />
                              <span>{t("plugins.card.disableTheme")}</span>
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="plugin-art-action-btn"
                            onClick={() => void setActiveTheme(p.id)}
                          >
                            <span>{t("plugins.card.applyTheme")}</span>
                          </button>
                        )
                      ) : null}

                      {p.manifest.type === "skin" ? (
                        isCurrentSkin ? (
                          <button
                            type="button"
                            className="plugin-art-applied-badge is-interactive"
                            onClick={() => void setActiveSkin(null)}
                            title={t("plugins.card.skinDeactivateTooltip")}
                          >
                            <span className="badge-applied-text">
                              <Check size={13} />
                              <span>{t("plugins.card.activeSkin")}</span>
                            </span>
                            <span className="badge-hover-text">
                              <Power size={13} />
                              <span>{t("plugins.card.disableSkin")}</span>
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="plugin-art-action-btn"
                            onClick={() => void setActiveSkin(p.id)}
                          >
                            <span>{t("plugins.card.switchSkin")}</span>
                          </button>
                        )
                      ) : null}

                      {p.manifest.type === "game" || p.manifest.type === "widget" || p.manifest.type === "locale" ? (
                        <button
                          type="button"
                          className={`plugin-art-action-btn ${p.enabled ? "is-subtle is-danger-hover" : ""}`}
                          onClick={() => void togglePlugin(p.id)}
                        >
                          <Power size={13} />
                          <span>{p.enabled ? t("plugins.card.toggleDisable") : t("plugins.card.toggleEnable")}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {/* Community Registry View */}
      {activeTab === "registry" ? (
        loadingRegistry ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <RefreshCw size={24} className="spin" style={{ color: "var(--primary, #ff75ac)" }} />
            <p style={{ marginTop: 12, color: "var(--text-secondary)" }}>{t("plugins.empty.loadingRegistry")}</p>
          </div>
        ) : filteredRegistry.length === 0 ? (
          <div style={{ padding: "40px 0" }}>
            <SakiEmptyState
              illustration="instances"
              title={t("plugins.empty.noRegistryTitle")}
              description={t("plugins.empty.noRegistryDesc")}
            />
          </div>
        ) : (
          <div className="plugin-grid">
            {filteredRegistry.map((item) => {
              const isInstalled = installedPlugins.some(
                (p) => p.id === item.name || p.manifest.name === item.name
              );
              const isThisInstalling = installingItemName === item.name;

              return (
                <div key={item.name} className="plugin-art-card">
                  <div className="plugin-art-stage">
                    {item.iconUrl ? (
                      <img
                        src={item.iconUrl}
                        alt=""
                        loading="lazy"
                        className="plugin-art-img"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    {!item.iconUrl ? (
                      <div className="plugin-art-fallback">
                        {getTypeIcon(item.type)}
                      </div>
                    ) : null}

                    <div className="plugin-art-top-bar">
                      <span className="plugin-art-type-pill">
                        {getTypeLabel(item.type)}
                      </span>

                      {item.repo ? (
                        <a
                          href={`https://github.com/${item.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="plugin-art-repo-badge"
                          title={t("plugins.card.viewSource")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={11} />
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="plugin-art-body">
                    <div className="plugin-art-header-row">
                      <div className="plugin-art-title-group">
                        <h4 className="plugin-art-title" title={item.displayName}>
                          {item.displayName}
                        </h4>
                        <span className="plugin-art-version">v{item.version}</span>
                      </div>
                    </div>

                    <div className="plugin-art-author-line">
                      <span>by {item.author}</span>
                      {item.stars ? (
                        <span className="plugin-art-star-tag">
                          <Star size={11} /> {item.stars}
                        </span>
                      ) : null}
                    </div>

                    <p className="plugin-art-desc" title={item.description}>
                      {item.description}
                    </p>

                    <div className="plugin-art-footer">
                      {isInstalled ? (
                        <div className="plugin-art-applied-badge">
                          <Check size={13} />
                          <span>{t("plugins.card.installed")}</span>
                        </div>
                      ) : currentUser.isAdmin ? (
                        <button
                          type="button"
                          className="plugin-art-action-btn is-install"
                          onClick={() => handleQuickInstall(item)}
                          disabled={installing}
                        >
                          <DownloadCloud size={13} />
                          <span>{isThisInstalling ? t("plugins.card.installing") : t("plugins.card.quickInstall")}</span>
                        </button>
                      ) : (
                        <div className="plugin-art-applied-badge is-muted">
                          <span>{t("plugins.card.adminOnlyInstall")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {/* Plugin Updates View */}
      {activeTab === "updates" ? (
        <div className="plugin-updates-atelier">
          {availableUpdatesCount === 0 ? (
            /* Serene Clean State when everything is up to date */
            <>
              <div className="plugin-updates-serene-card">
                <div className="serene-icon-halo">
                  <CheckCircle2 size={30} />
                </div>
                <div className="serene-texts">
                  <h3 className="serene-title">{t("plugins.updates.sereneTitle")}</h3>
                  <p className="serene-subtitle">
                    {language === "en-US"
                      ? `Verified all ${pluginsWithSource.length} plugins · Last check: ${lastCheckedText || t("plugins.updates.timeJustNow")}`
                      : language === "ja-JP"
                      ? `全 ${pluginsWithSource.length} 件のプラグインを検証済み · 最終確認: ${lastCheckedText || t("plugins.updates.timeJustNow")}`
                      : language === "zh-TW"
                      ? `已對全部 ${pluginsWithSource.length} 款擴充完成校驗 · 上次同步: ${lastCheckedText || "剛剛"}`
                      : `已对全部 ${pluginsWithSource.length} 款扩展完成校验 · 上次同步: ${lastCheckedText || "刚刚"}`}
                  </p>
                </div>
                <div className="serene-actions">
                  {currentUser.isAdmin ? (
                    <button
                      type="button"
                      className="plugin-art-action-btn is-subtle serene-btn"
                      onClick={handleCheckUpdates}
                      disabled={checkingUpdates}
                    >
                      <RefreshCw size={13} className={checkingUpdates ? "spin" : ""} />
                      <span>{checkingUpdates ? t("plugins.updates.checking") : t("plugins.updates.recheck")}</span>
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="plugin-updates-list-header">
                <span>
                  {language === "en-US"
                    ? `Managed Plugins (${pluginsWithSource.length})`
                    : language === "ja-JP"
                    ? `管理対象プラグイン (${pluginsWithSource.length})`
                    : language === "zh-TW"
                    ? `線上管理擴充 (${pluginsWithSource.length})`
                    : `在线管理扩展 (${pluginsWithSource.length})`}
                </span>
              </div>

              <div className="plugin-updates-deck">
                {pluginsWithSource.map((p) => {
                  const isCheckingThis = checkingSingleId === p.id;
                  return (
                    <div key={p.id} className="plugin-update-row-card is-clean">
                      <div className="update-row-avatar">
                        {p.manifest.icon ? (
                          <img
                            src={`/api/plugins/${encodeURIComponent(p.id)}/assets/${p.manifest.icon.replace(/^[/\\]+/, "")}`}
                            alt=""
                          />
                        ) : (
                          <div className="update-row-avatar-fallback">{getTypeIcon(p.manifest.type)}</div>
                        )}
                      </div>

                      <div className="update-row-main">
                        <div className="update-row-title-bar">
                          <span className="update-row-name">{p.manifest.displayName}</span>
                          <span className="update-row-type">{getTypeLabel(p.manifest.type)}</span>
                          <span className="update-row-author">by {p.manifest.author}</span>
                        </div>
                        <div className="update-row-meta">
                          <span className="update-row-version">v{p.manifest.version}</span>
                          {p.sourceRepo ? (
                            <>
                              <span className="update-meta-dot">•</span>
                              <a
                                href={`https://github.com/${p.sourceRepo}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="update-row-repo"
                              >
                                <Globe size={11} />
                                <span>{p.sourceRepo}</span>
                              </a>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="update-row-status-pill">
                        <CheckCircle2 size={12} />
                        <span>{t("plugins.updates.upToDate")}</span>
                      </div>

                      <div className="update-row-action">
                        {currentUser.isAdmin ? (
                          <button
                            type="button"
                            className="update-row-icon-btn"
                            onClick={() => void handleCheckSingle(p.id)}
                            disabled={isCheckingThis || checkingUpdates}
                            title={t("plugins.updates.singleCheckTooltip")}
                          >
                            <RefreshCw size={12} className={isCheckingThis ? "spin" : ""} />
                            <span>{t("plugins.updates.singleCheck")}</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* Active Update Action Deck when updates are available */
            <>
              <div className="plugin-updates-action-hub">
                <div className="action-hub-left">
                  <span className="action-hub-badge">
                    <Sparkles size={13} />{" "}
                    {availableUpdatesCount}{" "}
                    {language === "en-US"
                      ? "updates available"
                      : language === "ja-JP"
                      ? "件の新バージョンあり"
                      : language === "zh-TW"
                      ? "項新版本可用"
                      : "项新版本可用"}
                  </span>
                  <span className="action-hub-time">
                    {language === "en-US"
                      ? "Last checked: "
                      : language === "ja-JP"
                      ? "最終確認: "
                      : language === "zh-TW"
                      ? "上次檢查: "
                      : "上次检测: "}
                    {lastCheckedText || t("plugins.updates.timeJustNow")}
                  </span>
                </div>

                <div className="action-hub-right">
                  <label className="action-hub-select-all">
                    <input
                      type="checkbox"
                      checked={isAllAvailableSelected}
                      onChange={handleToggleSelectAll}
                      disabled={updatingIds.size > 0}
                    />
                    <span>
                      {language === "en-US"
                        ? `Select all (${availableUpdatesCount})`
                        : language === "ja-JP"
                        ? `更新を一括選択 (${availableUpdatesCount})`
                        : language === "zh-TW"
                        ? `全選可更新 (${availableUpdatesCount})`
                        : `全选可更新 (${availableUpdatesCount})`}
                    </span>
                  </label>

                  {currentUser.isAdmin ? (
                    <>
                      <button
                        type="button"
                        className="plugin-art-action-btn is-subtle"
                        onClick={handleCheckUpdates}
                        disabled={checkingUpdates || updatingIds.size > 0}
                      >
                        <RefreshCw size={13} className={checkingUpdates ? "spin" : ""} />
                        <span>{t("plugins.updates.recheck")}</span>
                      </button>

                      <button
                        type="button"
                        className="plugin-art-action-btn is-highlight"
                        onClick={() => void handleUpdateSelected()}
                        disabled={selectedForUpdate.size === 0 || updatingIds.size > 0}
                      >
                        <DownloadCloud size={13} />
                        <span>
                          {updatingIds.size > 0
                            ? language === "en-US"
                              ? `Updating (${updatingIds.size})...`
                              : language === "ja-JP"
                              ? `更新中 (${updatingIds.size})...`
                              : language === "zh-TW"
                              ? `正在更新 (${updatingIds.size})...`
                              : `正在更新 (${updatingIds.size})...`
                            : language === "en-US"
                            ? `Update Selected (${selectedForUpdate.size})`
                            : language === "ja-JP"
                            ? `選択した項目を更新 (${selectedForUpdate.size})`
                            : language === "zh-TW"
                            ? `一鍵更新所選 (${selectedForUpdate.size})`
                            : `一键更新所选 (${selectedForUpdate.size})`}
                        </span>
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="plugin-updates-deck">
                {filteredUpdates.map((p) => {
                  const status = updateStatuses[p.id];
                  const hasUpdate = Boolean(status?.updatesAvailable);
                  const isUpdating = updatingIds.has(p.id);
                  const isCheckingThis = checkingSingleId === p.id;
                  const remoteVersionText =
                    status?.remoteVersion ||
                    (status?.remoteCommit ? status.remoteCommit.slice(0, 7) : t("plugins.updates.latestTag"));

                  return (
                    <div
                      key={p.id}
                      className={`plugin-update-row-card ${hasUpdate ? "is-pending-update" : "is-clean"}`}
                    >
                      <div className="update-row-checkbox">
                        {hasUpdate ? (
                          <input
                            type="checkbox"
                            checked={selectedForUpdate.has(p.id)}
                            onChange={() => handleToggleSelect(p.id)}
                            disabled={isUpdating}
                            aria-label={
                              language === "en-US"
                                ? `Select ${p.manifest.displayName} for update`
                                : language === "ja-JP"
                                ? `更新対象に選択: ${p.manifest.displayName}`
                                : language === "zh-TW"
                                ? `選擇更新 ${p.manifest.displayName}`
                                : `选择更新 ${p.manifest.displayName}`
                            }
                          />
                        ) : (
                          <Check size={13} className="update-row-checked-icon" />
                        )}
                      </div>

                      <div className="update-row-avatar">
                        {p.manifest.icon ? (
                          <img
                            src={`/api/plugins/${encodeURIComponent(p.id)}/assets/${p.manifest.icon.replace(/^[/\\]+/, "")}`}
                            alt=""
                          />
                        ) : (
                          <div className="update-row-avatar-fallback">{getTypeIcon(p.manifest.type)}</div>
                        )}
                      </div>

                      <div className="update-row-main">
                        <div className="update-row-title-bar">
                          <span className="update-row-name">{p.manifest.displayName}</span>
                          <span className="update-row-type">{getTypeLabel(p.manifest.type)}</span>
                          <span className="update-row-author">by {p.manifest.author}</span>
                        </div>

                        <div className="update-row-meta">
                          {p.sourceRepo ? (
                            <a
                              href={`https://github.com/${p.sourceRepo}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="update-row-repo"
                            >
                              <Globe size={11} />
                              <span>{p.sourceRepo}</span>
                            </a>
                          ) : null}
                          {p.manifest.description ? (
                            <>
                              <span className="update-meta-dot">•</span>
                              <span className="update-row-desc">{p.manifest.description}</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="update-row-version-box">
                        {hasUpdate ? (
                          <div className="update-diff-pill">
                            <span className="diff-from">v{p.manifest.version}</span>
                            <ArrowRight size={12} className="diff-arrow" />
                            <span className="diff-to">v{remoteVersionText}</span>
                          </div>
                        ) : (
                          <span className="update-stable-pill">v{p.manifest.version} ({t("plugins.updates.latestTag")})</span>
                        )}
                      </div>

                      <div className="update-row-action">
                        {currentUser.isAdmin ? (
                          hasUpdate ? (
                            <button
                              type="button"
                              className="plugin-art-action-btn is-highlight update-single-btn"
                              onClick={() => void handleUpdatePlugin(p.id, p.manifest.displayName)}
                              disabled={isUpdating}
                            >
                              <DownloadCloud size={12} />
                              <span>
                                {isUpdating
                                  ? language === "en-US"
                                    ? "Updating..."
                                    : language === "ja-JP"
                                    ? "更新中..."
                                    : language === "zh-TW"
                                    ? "更新中..."
                                    : "更新中..."
                                  : language === "en-US"
                                  ? "Update"
                                  : language === "ja-JP"
                                  ? "更新"
                                  : language === "zh-TW"
                                  ? "立即更新"
                                  : "立即更新"}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="update-row-icon-btn"
                              onClick={() => void handleCheckSingle(p.id)}
                              disabled={isCheckingThis || checkingUpdates}
                              title={t("plugins.updates.singleCheckTooltip")}
                            >
                              <RefreshCw size={12} className={isCheckingThis ? "spin" : ""} />
                              <span>{t("plugins.updates.singleCheck")}</span>
                            </button>
                          )
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Playing Game Modal */}
      {playingGame ? (
        <PluginGameModal plugin={playingGame} onClose={() => setPlayingGame(null)} />
      ) : null}

      {/* Install from GitHub Modal */}
      {typeof document !== "undefined" && installModalOpen
        ? createPortal(
            <div
              className="modal-backdrop"
              onClick={() => setInstallModalOpen(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className="modal-panel"
                style={{ maxWidth: 520 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <div className="modal-title-wrap">
                    <div className="modal-title-icon">
                      <Plus size={18} />
                    </div>
                    <div>
                      <h3 className="modal-title">{t("plugins.installModal.title")}</h3>
                      <p className="modal-subtitle">{t("plugins.installModal.subtitle")}</p>
                    </div>
                  </div>
                  <button
                    className="icon-button modal-close-btn"
                    type="button"
                    title={t("plugins.installModal.cancel")}
                    onClick={() => setInstallModalOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <form className="plugin-modal-form" onSubmit={handleInstallSubmit}>
                  <div className="plugin-form-item">
                    <label>{t("plugins.installModal.repoLabel")}</label>
                    <input
                      type="text"
                      className="plugin-field-input"
                      placeholder={t("plugins.installModal.repoPlaceholder")}
                      value={installRepoInput}
                      onChange={(e) => setInstallRepoInput(e.target.value)}
                      required
                    />
                    <small>
                      {t("plugins.installModal.repoHelp")}
                    </small>
                  </div>

                  <div className="plugin-form-item">
                    <label>{t("plugins.installModal.branchLabel")}</label>
                    <input
                      type="text"
                      className="plugin-field-input"
                      placeholder="main"
                      value={installRefInput}
                      onChange={(e) => setInstallRefInput(e.target.value)}
                    />
                  </div>

                  <div className="plugin-form-item">
                    <label>{t("plugins.installModal.mirrorLabel")}</label>
                    <select
                      className="plugin-field-input"
                      value={selectedMirrorId}
                      onChange={(e) => void handleMirrorChange(e.target.value)}
                    >
                      {mirrors.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <small>
                      {t("plugins.installModal.mirrorHelp")}
                    </small>
                  </div>

                  {selectedMirrorId === "custom" ? (
                    <div className="plugin-form-item">
                      <label>{t("plugins.installModal.customMirrorLabel")}</label>
                      <input
                        type="text"
                        className="plugin-field-input"
                        placeholder="https://your-custom-proxy.com/"
                        value={installCustomMirror}
                        onChange={(e) => setInstallCustomMirror(e.target.value)}
                      />
                    </div>
                  ) : null}

                  {installError ? (
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        background: "rgba(239, 68, 68, 0.1)",
                        border: "1px solid rgba(239, 68, 68, 0.28)",
                        color: "#ef4444",
                        fontSize: "12px",
                        whiteSpace: "pre-wrap"
                      }}
                    >
                      <AlertTriangle size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                      {installError}
                    </div>
                  ) : null}

                  <div className="modal-actions" style={{ marginTop: 8, padding: 0 }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setInstallModalOpen(false)}
                    >
                      {t("plugins.installModal.cancel")}
                    </button>
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={installing}
                    >
                      {installing ? (
                        <>
                          <RefreshCw size={14} className="spin" />
                          <span>{t("plugins.installModal.downloading")}</span>
                        </>
                      ) : (
                        <span>{t("plugins.installModal.confirm")}</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* Developer Guide Modal */}
      {typeof document !== "undefined" && guideModalOpen
        ? createPortal(
            <div
              className="modal-backdrop"
              onClick={() => setGuideModalOpen(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className="modal-panel"
                style={{ maxWidth: 620 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <div className="modal-title-wrap">
                    <div className="modal-title-icon">
                      <BookOpen size={18} />
                    </div>
                    <div>
                      <h3 className="modal-title">{t("plugins.guideModal.title")}</h3>
                      <p className="modal-subtitle">{t("plugins.guideModal.subtitle")}</p>
                    </div>
                  </div>
                  <button
                    className="icon-button modal-close-btn"
                    type="button"
                    title={t("plugins.installModal.cancel")}
                    onClick={() => setGuideModalOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="plugin-modal-form">
                  <div className="plugin-guide-content">
                    <div className="plugin-guide-card">
                      <div className="plugin-guide-card-title">
                        <Code2 size={16} />
                        <span>{t("plugins.guideModal.manifestTitle")}</span>
                      </div>
                      <p>
                        {t("plugins.guideModal.manifestDesc")}
                      </p>
                    </div>

                    <div className="plugin-guide-card">
                      <div className="plugin-guide-card-title">
                        <Palette size={16} />
                        <span>{t("plugins.guideModal.themeTitle")}</span>
                      </div>
                      <p>
                        {t("plugins.guideModal.themeDesc")}
                      </p>
                    </div>

                    <div className="plugin-guide-card">
                      <div className="plugin-guide-card-title">
                        <Smile size={16} />
                        <span>{t("plugins.guideModal.skinTitle")}</span>
                      </div>
                      <p>
                        {t("plugins.guideModal.skinDesc")}
                      </p>
                    </div>

                    <div className="plugin-guide-card">
                      <div className="plugin-guide-card-title">
                        <Gamepad2 size={16} />
                        <span>{t("plugins.guideModal.gameTitle")}</span>
                      </div>
                      <p>
                        {t("plugins.guideModal.gameDesc")}
                      </p>
                    </div>

                    <div className="plugin-guide-card">
                      <div className="plugin-guide-card-title">
                        <Wrench size={16} />
                        <span>{t("plugins.guideModal.widgetTitle")}</span>
                      </div>
                      <p>
                        {t("plugins.guideModal.widgetDesc")}
                      </p>
                    </div>
                  </div>

                  <div className="modal-actions" style={{ marginTop: 10, padding: 0 }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => setGuideModalOpen(false)}
                    >
                      {t("plugins.guideModal.done")}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

