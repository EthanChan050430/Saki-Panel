import type { PanelAppearanceSettings } from "@webops/shared";
import { defaultPanelAppearance } from "../constants.js";

export function normalizePanelAppearance(input?: Partial<PanelAppearanceSettings> | null): PanelAppearanceSettings {
  return {
    ...defaultPanelAppearance,
    ...(input ?? {}),
    appTitle: input?.appTitle?.trim() || defaultPanelAppearance.appTitle,
    appSubtitle: input?.appSubtitle ?? defaultPanelAppearance.appSubtitle,
    appLogoSrc: input?.appLogoSrc?.trim() || defaultPanelAppearance.appLogoSrc,
    loginCoverSrc: input?.loginCoverSrc?.trim() || defaultPanelAppearance.loginCoverSrc,
    backgroundSrc: input?.backgroundSrc?.trim() || defaultPanelAppearance.backgroundSrc,
    mobileBackgroundSrc: input?.mobileBackgroundSrc?.trim() || defaultPanelAppearance.mobileBackgroundSrc
  };
}

export function cssImageUrl(source: string): string {
  return `url("${source.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

export function applyPanelAppearance(appearance: PanelAppearanceSettings, darkMode: boolean): void {
  const isDefaultBg = appearance.backgroundSrc === defaultPanelAppearance.backgroundSrc;
  const isDefaultMobileBg = appearance.mobileBackgroundSrc === defaultPanelAppearance.mobileBackgroundSrc;
  const bgSrc = (darkMode && isDefaultBg) ? "/assets/background_dark.png" : appearance.backgroundSrc;
  const mobileBgSrc = (darkMode && isDefaultMobileBg) ? "/assets/background_mobile_dark.png" : appearance.mobileBackgroundSrc;
  document.documentElement.style.setProperty("--app-background-image", cssImageUrl(bgSrc));
  document.documentElement.style.setProperty("--mobile-background-image", cssImageUrl(mobileBgSrc));
  document.documentElement.style.setProperty("--login-cover-image", cssImageUrl(appearance.loginCoverSrc));
  document.title = appearance.appTitle || defaultPanelAppearance.appTitle;
}
