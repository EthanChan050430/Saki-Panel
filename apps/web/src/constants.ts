import type { PanelAppearanceSettings } from "@webops/shared";

export const tokenKey = "webops.token";
export const panelLanguageKey = "webops.panel.language";
export const rememberedLoginKey = "webops.rememberedLogin";
export const autoLoginKey = "webops.autoLogin";
export const manualLogoutKey = "webops.manualLoggedOut";

export const defaultPanelAppearance: PanelAppearanceSettings = {
  appTitle: "Saki Panel",
  sidebarTitle: "Saki Panel",
  appSubtitle: "System Administration",
  appLogoSrc: "/assets/saki-panel-icon.png",
  sidebarLogoSrc: "/assets/saki-panel-icon.png",
  loginCoverSrc: "/assets/cover.png",
  backgroundSrc: "/assets/background.png",
  mobileBackgroundSrc: "/assets/background_mobile.png",
  darkBackgroundSrc: "/assets/background_dark.png",
  mobileDarkBackgroundSrc: "/assets/background_mobile_dark.png"
};

export const defaultStartCommand = "npm run start";
export const defaultSakiRequestTimeoutMs = 120000;
// Last-resort hang detector. Heartbeats arrive every ~8s, so this must be
// well above a missed beat or a long tool/model turn without tokens.
export const sakiStreamIdleFallbackMs = 90000;

export const sakiArtAssets = {
  avatar: "/assets/head.png",
  launcher: "/assets/sakiicon.png",
  launcherHover: "/assets/saki_click.png",
  tieEdge: "/assets/tiebian.png",
  hang: "/assets/hang.png",
  lie: "/assets/lie.png",
  files: "/assets/saki_files.png",
  shuru: "/assets/shuru.png",
  shuruBlack: "/assets/shuru_sit.png",
  normal: "/assets/expression/normal.png",
  thinking: "/assets/expression/think.png",
  worry: "/assets/expression/worry.png",
  thinkingGif: "/assets/Thinking.gif",
  pickup1: "/assets/expression/pickup1.png",
  pickup2: "/assets/expression/pickup2.png",
  happy: "/assets/expression/happy.png",
  OK: "/assets/expression/OK.png",
  reading: "/assets/expression/reading.png",
  upset: "/assets/expression/upset.png",
  working: "/assets/expression/working.png",
  checkfiles: "/assets/expression/checkfiles.png",
  shy: "/assets/expression/shy.png",
  eating: "/assets/expression/eating.png",
  gaming: "/assets/expression/gaming.png",
  listen: "/assets/expression/listen.png",
  emptyHealthy: "/assets/expression/empty_healthy.png",
  emptyInstances: "/assets/expression/empty_instances.png",
  emptyTasks: "/assets/expression/empty_tasks.png",
  emptyLogs: "/assets/expression/empty_logs.png",
  daemonOffline: "/assets/expression/daemon_offline.png",
  page404: "/assets/expression/page_404.png"
} as const;

export const expressionImages = {
  pickup: "/assets/expression/pickup.png",
  pickup2: "/assets/expression/pickup2.png",
  happy: "/assets/expression/happy.png",
  OK: "/assets/expression/OK.png",
  reading: "/assets/expression/reading.png",
  upset: "/assets/expression/upset.png",
  working: "/assets/expression/working.png",
  checkfiles: "/assets/expression/checkfiles.png",
  shy: "/assets/expression/shy.png",
  eating: "/assets/expression/eating.png",
  gaming: "/assets/expression/gaming.png",
  listen: "/assets/expression/listen.png",
  emptyHealthy: "/assets/expression/empty_healthy.png",
  emptyInstances: "/assets/expression/empty_instances.png",
  emptyTasks: "/assets/expression/empty_tasks.png",
  emptyLogs: "/assets/expression/empty_logs.png",
  daemonOffline: "/assets/expression/daemon_offline.png",
  page404: "/assets/expression/page_404.png"
} as const;
