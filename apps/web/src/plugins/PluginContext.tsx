import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import type { InstalledPlugin, PluginStoreState, GitHubMirrorOption, PluginUpdateStatus } from "@webops/shared";
import { api } from "../api.js";
import { applyPluginTheme, applyPublicTheme } from "./ThemeLoader.js";
import { applyPluginSkin } from "./SkinLoader.js";
import { registerLocaleDictionary, unregisterLocaleDictionary, subscribeLocaleChange } from "../i18n/translations.js";

export interface PluginContextValue {
  state: PluginStoreState | null;
  loading: boolean;
  error: string | null;
  installedPlugins: InstalledPlugin[];
  activeTheme: InstalledPlugin | null;
  activeSkin: InstalledPlugin | null;
  pluginGames: InstalledPlugin[];
  pluginWidgets: InstalledPlugin[];
  mirrors: GitHubMirrorOption[];
  selectedMirrorId: string;
  updateStatuses: Record<string, PluginUpdateStatus>;
  localeRevision: number;
  refreshPlugins: () => Promise<void>;
  togglePlugin: (id: string, enabled?: boolean) => Promise<boolean>;
  setActiveTheme: (id: string | null) => Promise<boolean>;
  setActiveSkin: (id: string | null) => Promise<boolean>;
  uninstallPlugin: (id: string) => Promise<boolean>;
  installFromGithub: (input: {
    repoOrUrl: string;
    mirrorId?: string;
    customMirrorUrl?: string;
    ref?: string;
    pluginName?: string;
  }) => Promise<InstalledPlugin[]>;
  saveMirrorConfig: (mirrorId: string, customMirrorUrl?: string) => Promise<void>;
  checkUpdates: (ids?: string[]) => Promise<Record<string, PluginUpdateStatus>>;
  updatePlugin: (id: string) => Promise<InstalledPlugin | null>;
}

const PluginContext = createContext<PluginContextValue | null>(null);

export function PluginProvider({
  token,
  children
}: {
  token: string | null;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<PluginStoreState | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, PluginUpdateStatus>>({});
  const [localeRevision, setLocaleRevision] = useState(0);

  const refreshPlugins = useCallback(async () => {
    if (!token) {
      try {
        const res = await fetch("/api/plugins/active-theme");
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean; theme?: Parameters<typeof applyPublicTheme>[0] };
          applyPublicTheme(data.theme ?? null);
        } else {
          applyPluginTheme(null);
        }
      } catch {
        applyPluginTheme(null);
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      setError(null);
      const res = await api.plugins(token);
      if (res.ok) {
        setState(res.state);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshPlugins();
  }, [refreshPlugins]);

  // 订阅 locale 字典注册事件，语言下拉框才能及时重渲染
  useEffect(() => subscribeLocaleChange(() => setLocaleRevision((r) => r + 1)), []);

  // Apply Theme & Skin whenever state updates
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!state) {
        applyPluginSkin(null);
        return;
      }

      const currentTheme = state.installed.find(
        (p) => p.id === state.activeThemeId && p.enabled && p.manifest.type === "theme"
      ) ?? null;
      applyPluginTheme(currentTheme);

      const currentSkin = state.installed.find(
        (p) => p.id === state.activeSkinId && p.enabled && p.manifest.type === "skin"
      ) ?? null;

      if (!currentSkin) {
        applyPluginSkin(null);
        return;
      }

      let files: Set<string> | undefined;
      if (token) {
        try {
          const res = await api.pluginFiles(token, currentSkin.id);
          if (res.ok && Array.isArray(res.files)) {
            files = new Set(res.files);
          }
        } catch {
          // overlay still works via explicit mapping
        }
      }
      if (!cancelled) {
        applyPluginSkin(currentSkin, files);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [state, token]);

  // Load locale-plugin dictionaries into the i18n runtime registry.
  // Runs whenever the installed-plugin list changes (install/uninstall/toggle).
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!state) return;

      // 收集启用中的 locale 插件
      const enabledLocales = state.installed.filter(
        (p) => p.enabled && p.manifest.type === "locale" && p.manifest.locale
      );
      const currentCodes = new Set(enabledLocales.map((p) => p.manifest.locale!.language));

      // 清掉已经不再启用的语言字典
      const allPluginCodes = state.installed
        .filter((p) => p.manifest.type === "locale" && p.manifest.locale)
        .map((p) => p.manifest.locale!.language);
      for (const code of allPluginCodes) {
        if (!currentCodes.has(code)) {
          unregisterLocaleDictionary(code);
        }
      }

      // 拉取并注册每个插件的翻译字典
      await Promise.all(
        enabledLocales.map(async (plugin) => {
          const localeMeta = plugin.manifest.locale!;
          try {
            const url = `/api/plugins/${plugin.id}/assets/${localeMeta.translations}`;
            const resp = await fetch(url);
            if (!resp.ok) return;
            const dict = (await resp.json()) as Record<string, string>;
            if (!cancelled && dict && typeof dict === "object") {
              registerLocaleDictionary(localeMeta.language, dict, {
                label: localeMeta.label ?? plugin.manifest.displayName,
                ...(localeMeta.flag ? { flag: localeMeta.flag } : {})
              });
            }
          } catch (err) {
            console.warn(`[locale] Failed to load ${plugin.id}:`, err);
          }
        })
      );
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const togglePlugin = useCallback(async (id: string, enabled?: boolean): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await api.togglePlugin(token, id, enabled);
      if (res.ok) {
        await refreshPlugins();
        return true;
      }
    } catch (err) {
      console.error("Failed to toggle plugin:", err);
    }
    return false;
  }, [token, refreshPlugins]);

  const setActiveTheme = useCallback(async (id: string | null): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await api.setActivePlugin(token, id ?? "none", { type: "theme", active: Boolean(id) });
      if (res.ok) {
        setState(res.state);
        return true;
      }
    } catch (err) {
      console.error("Failed to set active theme:", err);
    }
    return false;
  }, [token]);

  const setActiveSkin = useCallback(async (id: string | null): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await api.setActivePlugin(token, id ?? "none", { type: "skin", active: Boolean(id) });
      if (res.ok) {
        setState(res.state);
        return true;
      }
    } catch (err) {
      console.error("Failed to set active skin:", err);
    }
    return false;
  }, [token]);

  const uninstallPlugin = useCallback(async (id: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await api.uninstallPlugin(token, id);
      if (res.ok) {
        await refreshPlugins();
        return true;
      }
    } catch (err) {
      console.error("Failed to uninstall plugin:", err);
    }
    return false;
  }, [token, refreshPlugins]);

  const installFromGithub = useCallback(async (input: {
    repoOrUrl: string;
    mirrorId?: string;
    customMirrorUrl?: string;
    ref?: string;
    pluginName?: string;
  }): Promise<InstalledPlugin[]> => {
    if (!token) throw new Error("未登录");
    const res = await api.installPlugin(token, input);
    if (res.ok && res.plugins?.length) {
      await refreshPlugins();
      return res.plugins;
    }
    throw new Error(res.message || "安装失败");
  }, [token, refreshPlugins]);

  const saveMirrorConfig = useCallback(async (mirrorId: string, customMirrorUrl?: string): Promise<void> => {
    if (!token) return;
    const payload = customMirrorUrl !== undefined ? { mirrorId, customMirrorUrl } : { mirrorId };
    const res = await api.saveMirrorConfig(token, payload);
    if (res.ok) {
      setState(res.state);
    }
  }, [token]);

  const checkUpdates = useCallback(async (ids?: string[]): Promise<Record<string, PluginUpdateStatus>> => {
    if (!token) return {};
    const input: { ids?: string[]; mirrorId?: string; customMirrorUrl?: string } = {};
    if (ids && ids.length > 0) input.ids = ids;
    if (state?.selectedMirrorId) input.mirrorId = state.selectedMirrorId;
    if (state?.customMirrorUrl) input.customMirrorUrl = state.customMirrorUrl;

    const res = await api.checkPluginUpdates(token, input);
    if (!res.ok) return {};

    const map: Record<string, PluginUpdateStatus> = {};
    for (const s of res.statuses) {
      map[s.pluginId] = s;
    }
    setUpdateStatuses((prev) => ({ ...prev, ...map }));
    return map;
  }, [token, state?.selectedMirrorId, state?.customMirrorUrl]);

  const updatePlugin = useCallback(async (id: string): Promise<InstalledPlugin | null> => {
    if (!token) return null;
    const input: { mirrorId?: string; customMirrorUrl?: string } = {};
    if (state?.selectedMirrorId) input.mirrorId = state.selectedMirrorId;
    if (state?.customMirrorUrl) input.customMirrorUrl = state.customMirrorUrl;

    const res = await api.updatePlugin(token, id, input);
    if (res.ok) {
      // Mark update as applied: no longer available, clear error, keep timestamp
      setUpdateStatuses((prev) => {
        const next = { ...prev };
        if (next[id]) {
          next[id] = {
            ...next[id],
            updatesAvailable: false,
            lastCheckedAt: new Date().toISOString()
          };
        }
        return next;
      });
      await refreshPlugins();
      return res.plugin;
    }
    return null;
  }, [token, state?.selectedMirrorId, state?.customMirrorUrl, refreshPlugins]);

  const installedPlugins = useMemo(() => state?.installed ?? [], [state]);

  const activeTheme = useMemo(() => {
    if (!state?.activeThemeId) return null;
    return state.installed.find((p) => p.id === state.activeThemeId) ?? null;
  }, [state]);

  const activeSkin = useMemo(() => {
    if (!state?.activeSkinId) return null;
    return state.installed.find((p) => p.id === state.activeSkinId) ?? null;
  }, [state]);

  const pluginGames = useMemo(() => {
    return (state?.installed ?? []).filter((p) => p.enabled && p.manifest.type === "game" && p.manifest.game?.entry);
  }, [state]);

  const pluginWidgets = useMemo(() => {
    return (state?.installed ?? []).filter((p) => p.enabled && p.manifest.type === "widget" && p.manifest.widget?.entry);
  }, [state]);

  const mirrors = useMemo(() => state?.mirrors ?? [], [state]);
  const selectedMirrorId = state?.selectedMirrorId ?? "ghfast";

  const contextValue = useMemo<PluginContextValue>(() => ({
    state,
    loading,
    error,
    installedPlugins,
    activeTheme,
    activeSkin,
    pluginGames,
    pluginWidgets,
    mirrors,
    selectedMirrorId,
    updateStatuses,
    localeRevision,
    refreshPlugins,
    togglePlugin,
    setActiveTheme,
    setActiveSkin,
    uninstallPlugin,
    installFromGithub,
    saveMirrorConfig,
    checkUpdates,
    updatePlugin
  }), [
    state,
    loading,
    error,
    installedPlugins,
    activeTheme,
    activeSkin,
    pluginGames,
    pluginWidgets,
    mirrors,
    selectedMirrorId,
    updateStatuses,
    localeRevision,
    refreshPlugins,
    togglePlugin,
    setActiveTheme,
    setActiveSkin,
    uninstallPlugin,
    installFromGithub,
    saveMirrorConfig,
    checkUpdates,
    updatePlugin
  ]);

  return <PluginContext.Provider value={contextValue}>{children}</PluginContext.Provider>;
}

export function usePlugins(): PluginContextValue {
  const ctx = useContext(PluginContext);
  if (!ctx) {
    throw new Error("usePlugins must be used within a PluginProvider");
  }
  return ctx;
}
