import type { PanelAppearanceSettings } from "@webops/shared";
import { defaultPanelAppearance } from "../constants.js";

let defaultUserAvatarSrc = defaultPanelAppearance.defaultAvatarSrc;
const defaultUserAvatarListeners = new Set<() => void>();

export function getDefaultUserAvatarSrc(): string {
  return defaultUserAvatarSrc;
}

export function subscribeDefaultUserAvatarSrc(onStoreChange: () => void): () => void {
  defaultUserAvatarListeners.add(onStoreChange);
  return () => {
    defaultUserAvatarListeners.delete(onStoreChange);
  };
}

function publishDefaultUserAvatarSrc(src: string) {
  const next = src.trim() || defaultPanelAppearance.defaultAvatarSrc;
  if (next === defaultUserAvatarSrc) return;
  defaultUserAvatarSrc = next;
  defaultUserAvatarListeners.forEach((listener) => listener());
}

export function isVideoSource(source?: string | null): boolean {
  if (!source) return false;
  const clean = source.trim().toLowerCase();
  if (clean.startsWith("data:video/")) return true;
  const urlWithoutParams = clean.split(/[?#]/)[0] ?? "";
  return /\.(mp4|webm|ogg|mov|m4v)$/i.test(urlWithoutParams);
}

function sanitizeAppearanceSrc(source: string): string {
  const trimmed = source.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (trimmed.startsWith("data:video/")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return trimmed;
  } catch {
    // ignore
  }
  return "";
}

function migrateBundledAssetSrc(source: string): string {
  const trimmed = sanitizeAppearanceSrc(source);
  if (!trimmed.startsWith("/assets/")) return trimmed;
  if (trimmed.endsWith(".png")) return `${trimmed.slice(0, -4)}.webp`;
  if (trimmed.endsWith("/background_room.jpg")) return trimmed.replace(/\.jpg$/i, ".webp");
  return trimmed;
}

export function normalizePanelAppearance(input?: Partial<PanelAppearanceSettings> | null): PanelAppearanceSettings {
  return {
    ...defaultPanelAppearance,
    ...(input ?? {}),
    appTitle: input?.appTitle?.trim() || defaultPanelAppearance.appTitle,
    appSubtitle: input?.appSubtitle ?? defaultPanelAppearance.appSubtitle,
    appLogoSrc: migrateBundledAssetSrc(input?.appLogoSrc?.trim() || "") || defaultPanelAppearance.appLogoSrc,
    sidebarLogoSrc: migrateBundledAssetSrc(input?.sidebarLogoSrc?.trim() || "") || defaultPanelAppearance.sidebarLogoSrc,
    loginCoverSrc: migrateBundledAssetSrc(input?.loginCoverSrc?.trim() || "") || defaultPanelAppearance.loginCoverSrc,
    defaultAvatarSrc: migrateBundledAssetSrc(input?.defaultAvatarSrc?.trim() || "") || defaultPanelAppearance.defaultAvatarSrc,
    backgroundSrc: migrateBundledAssetSrc(input?.backgroundSrc?.trim() || "") || defaultPanelAppearance.backgroundSrc,
    mobileBackgroundSrc:
      migrateBundledAssetSrc(input?.mobileBackgroundSrc?.trim() || "") || defaultPanelAppearance.mobileBackgroundSrc,
    darkBackgroundSrc: migrateBundledAssetSrc(input?.darkBackgroundSrc?.trim() || "") || defaultPanelAppearance.darkBackgroundSrc,
    mobileDarkBackgroundSrc:
      migrateBundledAssetSrc(input?.mobileDarkBackgroundSrc?.trim() || "") || defaultPanelAppearance.mobileDarkBackgroundSrc,
    showServerTime: typeof input?.showServerTime === "boolean" ? input.showServerTime : defaultPanelAppearance.showServerTime ?? true
  };
}

export function cssImageUrl(source: string): string {
  const safe = sanitizeAppearanceSrc(source).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (!safe) return "none";
  return `url("${safe}")`;
}

export function getEffectiveBackgroundSources(appearance: PanelAppearanceSettings, darkMode: boolean) {
  const norm = normalizePanelAppearance(appearance);
  const desktopSrc = darkMode ? norm.darkBackgroundSrc : norm.backgroundSrc;
  const mobileSrc = darkMode ? norm.mobileDarkBackgroundSrc : norm.mobileBackgroundSrc;
  return {
    desktopSrc,
    mobileSrc,
    isDesktopVideo: isVideoSource(desktopSrc),
    isMobileVideo: isVideoSource(mobileSrc)
  };
}

export function applyPanelAppearance(appearance: PanelAppearanceSettings, darkMode: boolean): void {
  const { desktopSrc, mobileSrc, isDesktopVideo, isMobileVideo } = getEffectiveBackgroundSources(appearance, darkMode);

  if (isDesktopVideo) {
    document.documentElement.style.setProperty("--app-background-image", "none");
    document.body.classList.add("has-desktop-video-bg");
  } else {
    document.documentElement.style.setProperty("--app-background-image", cssImageUrl(desktopSrc));
    document.body.classList.remove("has-desktop-video-bg");
  }

  if (isMobileVideo) {
    document.documentElement.style.setProperty("--mobile-background-image", "none");
    document.body.classList.add("has-mobile-video-bg");
  } else {
    document.documentElement.style.setProperty("--mobile-background-image", cssImageUrl(mobileSrc));
    document.body.classList.remove("has-mobile-video-bg");
  }

  if (isDesktopVideo || isMobileVideo) {
    document.body.classList.add("has-video-bg");
  } else {
    document.body.classList.remove("has-video-bg");
  }

  document.documentElement.style.setProperty("--login-cover-image", cssImageUrl(appearance.loginCoverSrc));
  const defaultAvatar = sanitizeAppearanceSrc(appearance.defaultAvatarSrc) || defaultPanelAppearance.defaultAvatarSrc;
  publishDefaultUserAvatarSrc(defaultAvatar);
  document.title = appearance.appTitle || defaultPanelAppearance.appTitle;

  if (typeof document !== "undefined") {
    const faviconSrc = sanitizeAppearanceSrc(appearance.appLogoSrc) || defaultPanelAppearance.appLogoSrc;
    let iconLink = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }
    if (faviconSrc && iconLink.getAttribute("href") !== faviconSrc) {
      iconLink.removeAttribute("type");
      iconLink.href = faviconSrc;
    }
  }
}
