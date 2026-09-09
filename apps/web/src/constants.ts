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
  appLogoSrc: "/assets/saki-panel-icon.webp",
  sidebarLogoSrc: "/assets/saki-panel-icon.webp",
  loginCoverSrc: "/assets/cover.webp",
  defaultAvatarSrc: "/assets/head.webp",
  backgroundSrc: "/assets/background.webp",
  mobileBackgroundSrc: "/assets/background_mobile.webp",
  darkBackgroundSrc: "/assets/background_dark.webp",
  mobileDarkBackgroundSrc: "/assets/background_mobile_dark.webp",
  showServerTime: true
};

export const defaultStartCommand = "npm run start";
export const defaultSakiRequestTimeoutMs = 120000;
// Last-resort hang detector. Heartbeats arrive every ~8s, so this must be
// well above a missed beat or a long tool/model turn without tokens.
export const sakiStreamIdleFallbackMs = 90000;

export const sakiArtAssets = {
  avatar: "/assets/head.webp",
  launcher: "/assets/sakiicon.webp",
  launcher2: "/assets/sakiicon2.webp",
  launcherHover: "/assets/saki_click.webp",
  tieEdge: "/assets/tiebian.webp",
  hang: "/assets/hang.webp",
  lie: "/assets/lie.webp",
  files: "/assets/saki_files.webp",
  shuru: "/assets/shuru.webp",
  shuruBlack: "/assets/shuru_sit.webp",
  normal: "/assets/expression/normal.webp",
  thinking: "/assets/expression/think.webp",
  worry: "/assets/expression/worry.webp",
  thinkingGif: "/assets/Thinking.gif",
  pickup1: "/assets/expression/pickup1.webp",
  pickup2: "/assets/expression/pickup2.webp",
  happy: "/assets/expression/happy.webp",
  OK: "/assets/expression/OK.webp",
  reading: "/assets/expression/reading.webp",
  upset: "/assets/expression/upset.webp",
  working: "/assets/expression/working.webp",
  checkfiles: "/assets/expression/checkfiles.webp",
  shy: "/assets/expression/shy.webp",
  eating: "/assets/expression/eating.webp",
  gaming: "/assets/expression/gaming.webp",
  listen: "/assets/expression/listen.webp",
  waiting: "/assets/expression/waiting.webp",
  writing: "/assets/expression/writing.webp",
  terminal: "/assets/expression/terminal.webp",
  search: "/assets/expression/search.webp",
  diagnose: "/assets/expression/diagnose.webp",
  surprised: "/assets/expression/surprised.webp",
  pout: "/assets/expression/pout.webp",
  sorry: "/assets/expression/sorry.webp",
  cry: "/assets/expression/cry.webp",
  sleepy: "/assets/expression/sleepy.webp",
  wink: "/assets/expression/wink.webp",
  rollback: "/assets/expression/rollback.webp",
  blocked: "/assets/expression/blocked.webp",
  speaking1: "/assets/expression/speaking1.webp",
  speaking2: "/assets/expression/speaking2.webp",
  emptyHealthy: "/assets/expression/empty_healthy.webp",
  emptyInstances: "/assets/expression/empty_instances.webp",
  emptyTasks: "/assets/expression/empty_tasks.webp",
  emptyLogs: "/assets/expression/empty_logs.webp",
  daemonOffline: "/assets/expression/daemon_offline.webp",
  page404: "/assets/expression/page_404.webp",
  middlefinger: "/assets/expression/middlefinger.webp"
} as const;

export const sakiIdleLauncherAssets = [sakiArtAssets.launcher, sakiArtAssets.launcher2] as const;
export const sakiSpeakingAssets = [sakiArtAssets.speaking1, sakiArtAssets.speaking2] as const;

export const expressionImages = {
  pickup1: "/assets/expression/pickup1.webp",
  pickup2: "/assets/expression/pickup2.webp",
  happy: "/assets/expression/happy.webp",
  OK: "/assets/expression/OK.webp",
  reading: "/assets/expression/reading.webp",
  upset: "/assets/expression/upset.webp",
  working: "/assets/expression/working.webp",
  checkfiles: "/assets/expression/checkfiles.webp",
  shy: "/assets/expression/shy.webp",
  eating: "/assets/expression/eating.webp",
  gaming: "/assets/expression/gaming.webp",
  listen: "/assets/expression/listen.webp",
  waiting: "/assets/expression/waiting.webp",
  writing: "/assets/expression/writing.webp",
  terminal: "/assets/expression/terminal.webp",
  search: "/assets/expression/search.webp",
  diagnose: "/assets/expression/diagnose.webp",
  surprised: "/assets/expression/surprised.webp",
  pout: "/assets/expression/pout.webp",
  sorry: "/assets/expression/sorry.webp",
  cry: "/assets/expression/cry.webp",
  sleepy: "/assets/expression/sleepy.webp",
  wink: "/assets/expression/wink.webp",
  rollback: "/assets/expression/rollback.webp",
  blocked: "/assets/expression/blocked.webp",
  speaking1: "/assets/expression/speaking1.webp",
  speaking2: "/assets/expression/speaking2.webp",
  emptyHealthy: "/assets/expression/empty_healthy.webp",
  emptyInstances: "/assets/expression/empty_instances.webp",
  emptyTasks: "/assets/expression/empty_tasks.webp",
  emptyLogs: "/assets/expression/empty_logs.webp",
  daemonOffline: "/assets/expression/daemon_offline.webp",
  page404: "/assets/expression/page_404.webp",
  middlefinger: "/assets/expression/middlefinger.webp"
} as const;
