import type { PanelAppearanceSettings } from "@webops/shared";
import { defaultPanelAppearance } from "../constants.js";

export function isVideoSource(source?: string | null): boolean {
  if (!source) return false;
  const clean = source.trim().toLowerCase();
  if (clean.startsWith("data:video/")) return true;
  const urlWithoutParams = clean.split(/[?#]/)[0] ?? "";
  return /\.(mp4|webm|ogg|mov|m4v)$/i.test(urlWithoutParams);
}

export function normalizePanelAppearance(input?: Partial<PanelAppearanceSettings> | null): PanelAppearanceSettings {
  return {
    ...defaultPanelAppearance,
    ...(input ?? {}),
    appTitle: input?.appTitle?.trim() || defaultPanelAppearance.appTitle,
    appSubtitle: input?.appSubtitle ?? defaultPanelAppearance.appSubtitle,
    appLogoSrc: input?.appLogoSrc?.trim() || defaultPanelAppearance.appLogoSrc,
    sidebarLogoSrc: input?.sidebarLogoSrc?.trim() || defaultPanelAppearance.sidebarLogoSrc,
    loginCoverSrc: input?.loginCoverSrc?.trim() || defaultPanelAppearance.loginCoverSrc,
    backgroundSrc: input?.backgroundSrc?.trim() || defaultPanelAppearance.backgroundSrc,
    mobileBackgroundSrc: input?.mobileBackgroundSrc?.trim() || defaultPanelAppearance.mobileBackgroundSrc,
    darkBackgroundSrc: input?.darkBackgroundSrc?.trim() || defaultPanelAppearance.darkBackgroundSrc,
    mobileDarkBackgroundSrc: input?.mobileDarkBackgroundSrc?.trim() || defaultPanelAppearance.mobileDarkBackgroundSrc
  };
}

export function cssImageUrl(source: string): string {
  return `url("${source.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
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
  document.title = appearance.appTitle || defaultPanelAppearance.appTitle;
}
