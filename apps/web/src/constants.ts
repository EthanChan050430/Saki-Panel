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
  middlefinger: "/assets/expression/middlefinger.webp",
  petSit: "/assets/pet/sit.webp",
  petSleep: "/assets/pet/sleep.webp",
  petRoll: "/assets/pet/roll.webp",
  petWalk: "/assets/pet/walk.webp",
  petWalk2: "/assets/pet/walk2.webp",
  petWalk3: "/assets/pet/walk3.webp",
  petIdle: "/assets/pet/idle.webp",
  petHover: "/assets/pet/hover.webp",
  petRun: "/assets/pet/run.webp",
  petLook: "/assets/pet/look.webp",
  petPickup: "/assets/pet/pickup.webp",
  petFall: "/assets/pet/fall.webp",
  petClimb: "/assets/pet/climb.webp",
  petLie: "/assets/pet/lie.webp",
  petHang: "/assets/pet/hang.webp",
  petHappy: "/assets/pet/happy.webp",
  petDoctor: "/assets/pet/doctor.webp",
  petEat: "/assets/pet/eat.webp",
  petBath: "/assets/pet/bath.webp",
  petPoke: "/assets/pet/poke.webp",
  petYawn: "/assets/pet/yawn.webp",
  petPout: "/assets/pet/pout.webp",
  petBlink: "/assets/pet/blink.webp",
  petShy: "/assets/pet/shy.webp",
  petDrink: "/assets/pet/drink.webp",
  petWalkF1: "/assets/pet/walk_f1.webp",
  petWalkF2: "/assets/pet/walk_f2.webp",
  petWalkF3: "/assets/pet/walk_f3.webp",
  petWalkF4: "/assets/pet/walk_f4.webp",
  petWalkF5: "/assets/pet/walk_f5.webp",
  petWalkF6: "/assets/pet/walk_f6.webp",
  petClimbF1: "/assets/pet/climb_f1.webp",
  petClimbF2: "/assets/pet/climb_f2.webp",
  petClimbF3: "/assets/pet/climb_f3.webp",
  petClimbF4: "/assets/pet/climb_f4.webp",
  petClimbF5: "/assets/pet/climb_f5.webp",
  petClimbF6: "/assets/pet/climb_f6.webp",
  petBathF1: "/assets/pet/bath_f1.webp",
  petBathF2: "/assets/pet/bath_f2.webp",
  petBathF3: "/assets/pet/bath_f3.webp",
  petBathF4: "/assets/pet/bath_f4.webp",
  petBathF5: "/assets/pet/bath_f5.webp",
  petBathF6: "/assets/pet/bath_f6.webp",
  petDoctorF1: "/assets/pet/doctor_f1.webp",
  petDoctorF2: "/assets/pet/doctor_f2.webp",
  petDoctorF3: "/assets/pet/doctor_f3.webp",
  petDoctorF4: "/assets/pet/doctor_f4.webp",
  petDoctorF5: "/assets/pet/doctor_f5.webp",
  petDoctorF6: "/assets/pet/doctor_f6.webp",
  petEatF1: "/assets/pet/eat_f1.webp",
  petEatF2: "/assets/pet/eat_f2.webp",
  petEatF3: "/assets/pet/eat_f3.webp",
  petEatF4: "/assets/pet/eat_f4.webp",
  petEatF5: "/assets/pet/eat_f5.webp",
  petEatF6: "/assets/pet/eat_f6.webp"
} as const;

export const sakiIdleLauncherAssets = [sakiArtAssets.launcher, sakiArtAssets.launcher2] as const;
export const sakiSpeakingAssets = [sakiArtAssets.speaking1, sakiArtAssets.speaking2] as const;
export const sakiPetWalkFrames = [
  sakiArtAssets.petWalkF1,
  sakiArtAssets.petWalkF2,
  sakiArtAssets.petWalkF3,
  sakiArtAssets.petWalkF4,
  sakiArtAssets.petWalkF5,
  sakiArtAssets.petWalkF6
] as const;
export const sakiPetClimbFrames = [
  sakiArtAssets.petClimbF1,
  sakiArtAssets.petClimbF2,
  sakiArtAssets.petClimbF3,
  sakiArtAssets.petClimbF4,
  sakiArtAssets.petClimbF5,
  sakiArtAssets.petClimbF6
] as const;
export const sakiPetBathFrames = [
  sakiArtAssets.petBathF1,
  sakiArtAssets.petBathF2,
  sakiArtAssets.petBathF3,
  sakiArtAssets.petBathF4,
  sakiArtAssets.petBathF5,
  sakiArtAssets.petBathF6
] as const;
export const sakiPetDoctorFrames = [
  sakiArtAssets.petDoctorF1,
  sakiArtAssets.petDoctorF2,
  sakiArtAssets.petDoctorF3,
  sakiArtAssets.petDoctorF4,
  sakiArtAssets.petDoctorF5,
  sakiArtAssets.petDoctorF6
] as const;
export const sakiPetEatFrames = [
  sakiArtAssets.petEatF1,
  sakiArtAssets.petEatF2,
  sakiArtAssets.petEatF3,
  sakiArtAssets.petEatF4,
  sakiArtAssets.petEatF5,
  sakiArtAssets.petEatF6
] as const;

function expressionAnimFrames(name: string): readonly string[] {
  return [1, 2, 3, 4, 5, 6].map((i) => `/assets/expression/anim/${name}_f${i}.webp`);
}

export const sakiExpressionAnimFrames: Record<string, readonly string[]> = {
  happy: expressionAnimFrames("happy"),
  shy: expressionAnimFrames("shy"),
  wink: expressionAnimFrames("wink"),
  surprised: expressionAnimFrames("surprised"),
  pout: expressionAnimFrames("pout"),
  sorry: expressionAnimFrames("sorry"),
  cry: expressionAnimFrames("cry"),
  eating: expressionAnimFrames("eating"),
  sleepy: expressionAnimFrames("sleepy"),
  OK: expressionAnimFrames("OK"),
  thinking: expressionAnimFrames("think"),
  worry: expressionAnimFrames("worry"),
  working: expressionAnimFrames("working"),
  reading: expressionAnimFrames("reading"),
  checkfiles: expressionAnimFrames("checkfiles"),
  upset: expressionAnimFrames("upset"),
  gaming: expressionAnimFrames("gaming"),
  hearing: expressionAnimFrames("listen"),
  waiting: expressionAnimFrames("waiting"),
  writing: expressionAnimFrames("writing"),
  terminal: expressionAnimFrames("terminal"),
  search: expressionAnimFrames("search"),
  diagnose: expressionAnimFrames("diagnose"),
  rollback: expressionAnimFrames("rollback"),
  blocked: expressionAnimFrames("blocked")
};

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
