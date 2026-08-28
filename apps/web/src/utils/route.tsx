import React from "react";
import type { PanelRoute, SakiSettingsSection, ViewMode } from "../types/app.js";
import {
  Terminal as TerminalIcon,
  Clock,
  LayoutTemplate,
  UserCog,
  Server,
  FileText,
  Sparkles,
  ClipboardList
} from "lucide-react";

export const validViews: readonly ViewMode[] = [
  "dashboard",
  "instances",
  "nodes",
  "templates",
  "users",
  "audit",
  "settings",
  "about"
];

export function parseHashRoute(): PanelRoute {
  if (typeof window === "undefined") {
    return { view: "dashboard", instanceId: null, settingsSection: null };
  }
  const rawHash = window.location.hash.replace(/^#\/?/, "").trim();
  if (!rawHash) {
    const savedView = window.localStorage.getItem("webops.activeView") as ViewMode | null;
    const savedInstanceId = window.localStorage.getItem("webops.selectedInstanceId");
    const savedSection = window.localStorage.getItem("webops.settingsSection") as SakiSettingsSection | null;
    const view = savedView && validViews.includes(savedView) ? savedView : "dashboard";
    return {
      view,
      instanceId: view === "instances" ? savedInstanceId || null : null,
      settingsSection: view === "settings" ? savedSection || null : null
    };
  }

  const [pathPart = "", queryPart] = rawHash.split("?");
  const segments = pathPart.split("/").map(decodeURIComponent).filter(Boolean);
  const rootSegment = (segments[0] || "").toLowerCase() as ViewMode;
  const view: ViewMode = validViews.includes(rootSegment) ? rootSegment : "dashboard";

  let instanceId: string | null = null;
  let settingsSection: SakiSettingsSection | null = null;

  if (view === "instances") {
    if (segments.length > 1 && segments[1]) {
      instanceId = segments[1];
    } else if (queryPart) {
      const params = new URLSearchParams(queryPart);
      instanceId = params.get("id");
    }
    if (!instanceId) {
      instanceId = window.localStorage.getItem("webops.selectedInstanceId");
    }
  } else if (view === "settings") {
    if (segments.length > 1 && segments[1]) {
      const sec = segments[1] as SakiSettingsSection;
      if (["system", "model", "features", "appearance", "prompt", "skills"].includes(sec)) {
        settingsSection = sec;
      }
    }
    if (!settingsSection) {
      settingsSection = window.localStorage.getItem("webops.settingsSection") as SakiSettingsSection | null;
    }
  }

  return { view, instanceId, settingsSection };
}

export function updateHashRoute(route: Partial<PanelRoute>) {
  if (typeof window === "undefined") return;
  const current = parseHashRoute();
  const next: PanelRoute = {
    view: route.view ?? current.view,
    instanceId: route.instanceId !== undefined ? route.instanceId : (route.view && route.view !== "instances" ? null : current.instanceId),
    settingsSection: route.settingsSection !== undefined ? route.settingsSection : (route.view && route.view !== "settings" ? null : current.settingsSection)
  };

  let hash = `#${next.view}`;
  if (next.view === "instances" && next.instanceId) {
    hash += `/${encodeURIComponent(next.instanceId)}`;
  } else if (next.view === "settings" && next.settingsSection && next.settingsSection !== "system") {
    hash += `/${encodeURIComponent(next.settingsSection)}`;
  }

  if (window.location.hash !== hash) {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", hash);
    } else {
      window.location.hash = hash;
    }
  }

  try {
    window.localStorage.setItem("webops.activeView", next.view);
    if (next.view === "instances" && next.instanceId) {
      window.localStorage.setItem("webops.selectedInstanceId", next.instanceId);
    } else {
      window.localStorage.removeItem("webops.selectedInstanceId");
    }
    if (next.view === "settings" && next.settingsSection) {
      window.localStorage.setItem("webops.settingsSection", next.settingsSection);
    }
  } catch {}
}

export function routeIcon(key: string): React.ReactNode {
  if (key.includes("instance") || key.includes("terminal")) return <TerminalIcon size={18} />;
  if (key.includes("task")) return <Clock size={18} />;
  if (key.includes("template")) return <LayoutTemplate size={18} />;
  if (key.includes("user") || key.includes("role")) return <UserCog size={18} />;
  if (key.includes("node") || key.includes("daemon")) return <Server size={18} />;
  if (key.includes("file")) return <FileText size={18} />;
  if (key.includes("saki")) return <Sparkles size={18} />;
  return <ClipboardList size={18} />;
}
