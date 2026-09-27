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
  tieEdgeBlink: "/assets/tiebian_blink.webp",
  hang: "/assets/hang.webp",
  lie: "/assets/lie.webp",
  files: "/assets/saki_files.webp",
  shuru: "/assets/shuru_sit.webp",
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
  petToiletF1: "/assets/pet/toilet_f1.png",
  petToiletF2: "/assets/pet/toilet_f2.png",
  petToiletF3: "/assets/pet/toilet_f3.png",
  petToiletF4: "/assets/pet/toilet_f4.png",
  petToiletF5: "/assets/pet/toilet_f5.png",
  petToiletF6: "/assets/pet/toilet_f6.png",
  petToiletF7: "/assets/pet/toilet_f7.png",
  petToiletF8: "/assets/pet/toilet_f8.png",
  petToiletF9: "/assets/pet/toilet_f9.png",
  petToiletF10: "/assets/pet/toilet_f10.png",
  petToiletF11: "/assets/pet/toilet_f11.png",
  petToiletF12: "/assets/pet/toilet_f12.png",
  petToiletF13: "/assets/pet/toilet_f13.png",
  petToiletF14: "/assets/pet/toilet_f14.png",
  petToiletF15: "/assets/pet/toilet_f15.png",
  petToiletF16: "/assets/pet/toilet_f16.png",
  petToiletF17: "/assets/pet/toilet_f17.png",
  petToiletF18: "/assets/pet/toilet_f18.png",
  petToiletF19: "/assets/pet/toilet_f19.png",
  petToiletF20: "/assets/pet/toilet_f20.png",
  petToiletF21: "/assets/pet/toilet_f21.png",
  petToiletF22: "/assets/pet/toilet_f22.png",
  petToiletF23: "/assets/pet/toilet_f23.png",
  petToiletF24: "/assets/pet/toilet_f24.png",
  petToiletF25: "/assets/pet/toilet_f25.png",
  petToiletF26: "/assets/pet/toilet_f26.png",
  petToiletF27: "/assets/pet/toilet_f27.png",
  petToiletF28: "/assets/pet/toilet_f28.png",
  petToiletF29: "/assets/pet/toilet_f29.png",
  petToiletF30: "/assets/pet/toilet_f30.png",
  petToiletF31: "/assets/pet/toilet_f31.png",
  petToiletF32: "/assets/pet/toilet_f32.png",
  petToiletF33: "/assets/pet/toilet_f33.png",
  petToiletF34: "/assets/pet/toilet_f34.png",
  petToiletF35: "/assets/pet/toilet_f35.png",
  petToiletF36: "/assets/pet/toilet_f36.png",
  petToiletF37: "/assets/pet/toilet_f37.png",
  petPickupEnterF1: "/assets/pet/pickup_enter_f1.webp",
  petPickupEnterF2: "/assets/pet/pickup_enter_f2.webp",
  petPickupEnterF3: "/assets/pet/pickup_enter_f3.webp",
  petPickupEnterF4: "/assets/pet/pickup_enter_f4.webp",
  petPickupEnterF5: "/assets/pet/pickup_enter_f5.webp",
  petPickupEnterF6: "/assets/pet/pickup_enter_f6.webp",
  petPickupEnterF7: "/assets/pet/pickup_enter_f7.webp",
  petPickupEnterF8: "/assets/pet/pickup_enter_f8.webp",
  petPickupEnterF9: "/assets/pet/pickup_enter_f9.webp",
  petPickupEnterF10: "/assets/pet/pickup_enter_f10.webp",
  petPickupEnterF11: "/assets/pet/pickup_enter_f11.webp",
  petPickupEnterF12: "/assets/pet/pickup_enter_f12.webp",
  petPickupEnterF13: "/assets/pet/pickup_enter_f13.webp",
  petPickupEnterF14: "/assets/pet/pickup_enter_f14.webp",
  petPickupEnterF15: "/assets/pet/pickup_enter_f15.webp",
  petPickupEnterF16: "/assets/pet/pickup_enter_f16.webp",
  petPickupEnterF17: "/assets/pet/pickup_enter_f17.webp",
  petPickupLoopF1: "/assets/pet/pickup_loop_f1.webp",
  petPickupLoopF2: "/assets/pet/pickup_loop_f2.webp",
  petPickupLoopF3: "/assets/pet/pickup_loop_f3.webp",
  petPickupLoopF4: "/assets/pet/pickup_loop_f4.webp",
  petPickupLoopF5: "/assets/pet/pickup_loop_f5.webp",
  petPickupLoopF6: "/assets/pet/pickup_loop_f6.webp",
  petPickupLoopF7: "/assets/pet/pickup_loop_f7.webp",
  petPickupLoopF8: "/assets/pet/pickup_loop_f8.webp",
  petPickupLoopF9: "/assets/pet/pickup_loop_f9.webp",
  petPickupLoopF10: "/assets/pet/pickup_loop_f10.webp",
  petPickupLoopF11: "/assets/pet/pickup_loop_f11.webp",
  petPickupLoopF12: "/assets/pet/pickup_loop_f12.webp",
  petPickupLoopF13: "/assets/pet/pickup_loop_f13.webp",
  petPickupLoopF14: "/assets/pet/pickup_loop_f14.webp",
  petPickupLoopF15: "/assets/pet/pickup_loop_f15.webp",
  petPickupLoopF16: "/assets/pet/pickup_loop_f16.webp",
  petPickupLoopF17: "/assets/pet/pickup_loop_f17.webp",
  petPickupLoopF18: "/assets/pet/pickup_loop_f18.webp",
  petSitF1: "/assets/pet/sit_f1.webp",
  petSitF2: "/assets/pet/sit_f2.webp",
  petSitF3: "/assets/pet/sit_f3.webp",
  petSitF4: "/assets/pet/sit_f4.webp",
  petSitF5: "/assets/pet/sit_f5.webp",
  petSitF6: "/assets/pet/sit_f6.webp",
  petSitF7: "/assets/pet/sit_f7.webp",
  petSitF8: "/assets/pet/sit_f8.webp",
  petSitF9: "/assets/pet/sit_f9.webp",
  petSitF10: "/assets/pet/sit_f10.webp",
  petSitF11: "/assets/pet/sit_f11.webp",
  petSitF12: "/assets/pet/sit_f12.webp",
  petSitF13: "/assets/pet/sit_f13.webp",
  petSitF14: "/assets/pet/sit_f14.webp",
  petSitF15: "/assets/pet/sit_f15.webp",
  petSitF16: "/assets/pet/sit_f16.webp",
  petSitF17: "/assets/pet/sit_f17.webp",
  petSitF18: "/assets/pet/sit_f18.webp",
  petSitF19: "/assets/pet/sit_f19.webp",
  petSitF20: "/assets/pet/sit_f20.webp",
  petSitF21: "/assets/pet/sit_f21.webp",
  petSitF22: "/assets/pet/sit_f22.webp",
  petSitF23: "/assets/pet/sit_f23.webp",
  petSitF24: "/assets/pet/sit_f24.webp",
  petSitF25: "/assets/pet/sit_f25.webp",
  petSleep: "/assets/pet/sleep.webp",
  petSleepF1: "/assets/pet/sleep_f1.webp",
  petSleepF2: "/assets/pet/sleep_f2.webp",
  petSleepF3: "/assets/pet/sleep_f3.webp",
  petSleepF4: "/assets/pet/sleep_f4.webp",
  petSleepF5: "/assets/pet/sleep_f5.webp",
  petSleepF6: "/assets/pet/sleep_f6.webp",
  petSleepF7: "/assets/pet/sleep_f7.webp",
  petSleepF8: "/assets/pet/sleep_f8.webp",
  petSleepF9: "/assets/pet/sleep_f9.webp",
  petSleepF10: "/assets/pet/sleep_f10.webp",
  petSleepF11: "/assets/pet/sleep_f11.webp",
  petSleepF12: "/assets/pet/sleep_f12.webp",
  petSleepF13: "/assets/pet/sleep_f13.webp",
  petSleepF14: "/assets/pet/sleep_f14.webp",
  petSleepF15: "/assets/pet/sleep_f15.webp",
  petSleepF16: "/assets/pet/sleep_f16.webp",
  petSleepF17: "/assets/pet/sleep_f17.webp",
  petSleepF18: "/assets/pet/sleep_f18.webp",
  petSleepF19: "/assets/pet/sleep_f19.webp",
  petSleepF20: "/assets/pet/sleep_f20.webp",
  petSleepF21: "/assets/pet/sleep_f21.webp",
  petSleepF22: "/assets/pet/sleep_f22.webp",
  petSleepF23: "/assets/pet/sleep_f23.webp",
  petSleepF24: "/assets/pet/sleep_f24.webp",
  petSleepF25: "/assets/pet/sleep_f25.webp",
  petSleepF26: "/assets/pet/sleep_f26.webp",
  petSleepF27: "/assets/pet/sleep_f27.webp",
  petSleepF28: "/assets/pet/sleep_f28.webp",
  petSleepF29: "/assets/pet/sleep_f29.webp",
  petSleepF30: "/assets/pet/sleep_f30.webp",
  petSleepF31: "/assets/pet/sleep_f31.webp",
  petSleepF32: "/assets/pet/sleep_f32.webp",
  petSleepF33: "/assets/pet/sleep_f33.webp",
  petSleepF34: "/assets/pet/sleep_f34.webp",
  petSleepF35: "/assets/pet/sleep_f35.webp",
  petSleepF36: "/assets/pet/sleep_f36.webp",
  petSleepF37: "/assets/pet/sleep_f37.webp",
  petRoll: "/assets/pet/roll.webp",
  petRollF1: "/assets/pet/roll_f1.webp",
  petRollF2: "/assets/pet/roll_f2.webp",
  petRollF3: "/assets/pet/roll_f3.webp",
  petRollF4: "/assets/pet/roll_f4.webp",
  petRollF5: "/assets/pet/roll_f5.webp",
  petRollF6: "/assets/pet/roll_f6.webp",
  petRollF7: "/assets/pet/roll_f7.webp",
  petRollF8: "/assets/pet/roll_f8.webp",
  petRollF9: "/assets/pet/roll_f9.webp",
  petRollF10: "/assets/pet/roll_f10.webp",
  petRollF11: "/assets/pet/roll_f11.webp",
  petRollF12: "/assets/pet/roll_f12.webp",
  petRollF13: "/assets/pet/roll_f13.webp",
  petRollF14: "/assets/pet/roll_f14.webp",
  petRollF15: "/assets/pet/roll_f15.webp",
  petRollF16: "/assets/pet/roll_f16.webp",
  petRollF17: "/assets/pet/roll_f17.webp",
  petRollF18: "/assets/pet/roll_f18.webp",
  petRollF19: "/assets/pet/roll_f19.webp",
  petRollF20: "/assets/pet/roll_f20.webp",
  petRollF21: "/assets/pet/roll_f21.webp",
  petRollF22: "/assets/pet/roll_f22.webp",
  petRollF23: "/assets/pet/roll_f23.webp",
  petWalk: "/assets/pet/walk.webp",
  petWalk2: "/assets/pet/walk2.webp",
  petWalk3: "/assets/pet/walk3.webp",
  petIdle: "/assets/pet/idle.webp",
  petIdleF1: "/assets/pet/idle_f1.webp",
  petIdleF2: "/assets/pet/idle_f2.webp",
  petIdleF3: "/assets/pet/idle_f3.webp",
  petIdleF4: "/assets/pet/idle_f4.webp",
  petIdleF5: "/assets/pet/idle_f5.webp",
  petIdleF6: "/assets/pet/idle_f6.webp",
  petIdleF7: "/assets/pet/idle_f7.webp",
  petIdleF8: "/assets/pet/idle_f8.webp",
  petIdleF9: "/assets/pet/idle_f9.webp",
  petIdleF10: "/assets/pet/idle_f10.webp",
  petIdleF11: "/assets/pet/idle_f11.webp",
  petIdleF12: "/assets/pet/idle_f12.webp",
  petIdleF13: "/assets/pet/idle_f13.webp",
  petIdleF14: "/assets/pet/idle_f14.webp",
  petIdleF15: "/assets/pet/idle_f15.webp",
  petIdleF16: "/assets/pet/idle_f16.webp",
  petIdleF17: "/assets/pet/idle_f17.webp",
  petIdleF18: "/assets/pet/idle_f18.webp",
  petIdleF19: "/assets/pet/idle_f19.webp",
  petIdleF20: "/assets/pet/idle_f20.webp",
  petHover: "/assets/pet/hover.webp",
  petRun: "/assets/pet/run.webp",
  petRunF1: "/assets/pet/run_f1.webp",
  petRunF2: "/assets/pet/run_f2.webp",
  petRunF3: "/assets/pet/run_f3.webp",
  petRunF4: "/assets/pet/run_f4.webp",
  petRunF5: "/assets/pet/run_f5.webp",
  petRunF6: "/assets/pet/run_f6.webp",
  petRunF7: "/assets/pet/run_f7.webp",
  petRunF8: "/assets/pet/run_f8.webp",
  petRunF9: "/assets/pet/run_f9.webp",
  petRunF10: "/assets/pet/run_f10.webp",
  petRunF11: "/assets/pet/run_f11.webp",
  petRunF12: "/assets/pet/run_f12.webp",
  petRunF13: "/assets/pet/run_f13.webp",
  petRunF14: "/assets/pet/run_f14.webp",
  petRunF15: "/assets/pet/run_f15.webp",
  petRunF16: "/assets/pet/run_f16.webp",
  petRunF17: "/assets/pet/run_f17.webp",
  petRunF18: "/assets/pet/run_f18.webp",
  petRunF19: "/assets/pet/run_f19.webp",
  petRunF20: "/assets/pet/run_f20.webp",
  petRunF21: "/assets/pet/run_f21.webp",
  petRunF22: "/assets/pet/run_f22.webp",
  petRunF23: "/assets/pet/run_f23.webp",
  petRunF24: "/assets/pet/run_f24.webp",
  petRunF25: "/assets/pet/run_f25.webp",
  petLook: "/assets/pet/look.webp",
  petPickup: "/assets/pet/pickup.webp",
  petFall: "/assets/pet/fall.webp",
  petClimb: "/assets/pet/climb.webp",
  petLie: "/assets/pet/lie.webp",
  petLieF1: "/assets/pet/lie_f1.webp",
  petLieF2: "/assets/pet/lie_f2.webp",
  petLieF3: "/assets/pet/lie_f3.webp",
  petLieF4: "/assets/pet/lie_f4.webp",
  petLieF5: "/assets/pet/lie_f5.webp",
  petLieF6: "/assets/pet/lie_f6.webp",
  petLieF7: "/assets/pet/lie_f7.webp",
  petLieF8: "/assets/pet/lie_f8.webp",
  petLieF9: "/assets/pet/lie_f9.webp",
  petLieF10: "/assets/pet/lie_f10.webp",
  petLieF11: "/assets/pet/lie_f11.webp",
  petLieF12: "/assets/pet/lie_f12.webp",
  petLieF13: "/assets/pet/lie_f13.webp",
  petLieF14: "/assets/pet/lie_f14.webp",
  petLieF15: "/assets/pet/lie_f15.webp",
  petLieF16: "/assets/pet/lie_f16.webp",
  petLieF17: "/assets/pet/lie_f17.webp",
  petLieF18: "/assets/pet/lie_f18.webp",
  petLieF19: "/assets/pet/lie_f19.webp",
  petLieF20: "/assets/pet/lie_f20.webp",
  petLieF21: "/assets/pet/lie_f21.webp",
  petLieF22: "/assets/pet/lie_f22.webp",
  petLieF23: "/assets/pet/lie_f23.webp",
  petHang: "/assets/pet/hang.webp",
  petHappy: "/assets/pet/happy.webp",
  petDoctor: "/assets/pet/doctor.webp",
  petEat: "/assets/pet/eat.webp",
  petBath: "/assets/pet/bath.webp",
  petPoke: "/assets/pet/poke.webp",
  petPokeF1: "/assets/pet/poke_f1.webp",
  petPokeF2: "/assets/pet/poke_f2.webp",
  petPokeF3: "/assets/pet/poke_f3.webp",
  petPokeF4: "/assets/pet/poke_f4.webp",
  petPokeF5: "/assets/pet/poke_f5.webp",
  petPokeF6: "/assets/pet/poke_f6.webp",
  petPokeF7: "/assets/pet/poke_f7.webp",
  petPokeF8: "/assets/pet/poke_f8.webp",
  petPokeF9: "/assets/pet/poke_f9.webp",
  petPokeF10: "/assets/pet/poke_f10.webp",
  petPokeF11: "/assets/pet/poke_f11.webp",
  petPokeF12: "/assets/pet/poke_f12.webp",
  petPokeF13: "/assets/pet/poke_f13.webp",
  petPokeF14: "/assets/pet/poke_f14.webp",
  petPokeF15: "/assets/pet/poke_f15.webp",
  petPokeF16: "/assets/pet/poke_f16.webp",
  petPokeF17: "/assets/pet/poke_f17.webp",
  petPokeF18: "/assets/pet/poke_f18.webp",
  petPokeF19: "/assets/pet/poke_f19.webp",
  petPokeF20: "/assets/pet/poke_f20.webp",
  petPokeF21: "/assets/pet/poke_f21.webp",
  petPokeF22: "/assets/pet/poke_f22.webp",
  petPokeF23: "/assets/pet/poke_f23.webp",
  petPokeF24: "/assets/pet/poke_f24.webp",
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
  petBathF7: "/assets/pet/bath_f7.webp",
  petBathF8: "/assets/pet/bath_f8.webp",
  petBathF9: "/assets/pet/bath_f9.webp",
  petBathF10: "/assets/pet/bath_f10.webp",
  petBathF11: "/assets/pet/bath_f11.webp",
  petBathF12: "/assets/pet/bath_f12.webp",
  petBathF13: "/assets/pet/bath_f13.webp",
  petBathF14: "/assets/pet/bath_f14.webp",
  petBathF15: "/assets/pet/bath_f15.webp",
  petBathF16: "/assets/pet/bath_f16.webp",
  petBathF17: "/assets/pet/bath_f17.webp",
  petBathF18: "/assets/pet/bath_f18.webp",
  petBathF19: "/assets/pet/bath_f19.webp",
  petBathF20: "/assets/pet/bath_f20.webp",
  petBathF21: "/assets/pet/bath_f21.webp",
  petBathF22: "/assets/pet/bath_f22.webp",
  petBathF23: "/assets/pet/bath_f23.webp",
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
  petEatF6: "/assets/pet/eat_f6.webp",
  singingF1: "/assets/expression/anim/singing_f1.webp",
  singingF2: "/assets/expression/anim/singing_f2.webp",
  singingF3: "/assets/expression/anim/singing_f3.webp",
  singingF4: "/assets/expression/anim/singing_f4.webp",
  singingF5: "/assets/expression/anim/singing_f5.webp",
  singingF6: "/assets/expression/anim/singing_f6.webp"
};

export let sakiIdleLauncherAssets: readonly string[] = [sakiArtAssets.launcher, sakiArtAssets.launcher2];
export let sakiSpeakingAssets: readonly string[] = [sakiArtAssets.speaking1, sakiArtAssets.speaking2];
const petIdleFrameKeys = Array.from(
  { length: 20 },
  (_, index) => `petIdleF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetIdleFrames: readonly string[] = petIdleFrameKeys.map((key) => sakiArtAssets[key]);
const petPickupEnterFrameKeys = Array.from(
  { length: 17 },
  (_, index) => `petPickupEnterF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetPickupEnterFrames: readonly string[] = petPickupEnterFrameKeys.map((key) => sakiArtAssets[key]);
const petPickupLoopFrameKeys = Array.from(
  { length: 18 },
  (_, index) => `petPickupLoopF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetPickupLoopFrames: readonly string[] = petPickupLoopFrameKeys.map((key) => sakiArtAssets[key]);
const petSitFrameKeys = Array.from(
  { length: 25 },
  (_, index) => `petSitF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetSitFrames: readonly string[] = petSitFrameKeys.map((key) => sakiArtAssets[key]);
const petToiletFrameKeys = Array.from(
  { length: 37 },
  (_, index) => `petToiletF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetToiletFrames: readonly string[] = petToiletFrameKeys.map((key) => sakiArtAssets[key]);
const petRunFrameKeys = Array.from(
  { length: 25 },
  (_, index) => `petRunF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetRunFrames: readonly string[] = petRunFrameKeys.map((key) => sakiArtAssets[key]);
export let sakiPetWalkFrames: readonly string[] = [
  sakiArtAssets.petWalkF1,
  sakiArtAssets.petWalkF2,
  sakiArtAssets.petWalkF3,
  sakiArtAssets.petWalkF4,
  sakiArtAssets.petWalkF5,
  sakiArtAssets.petWalkF6
];
export let sakiPetClimbFrames: readonly string[] = [
  sakiArtAssets.petClimbF1,
  sakiArtAssets.petClimbF2,
  sakiArtAssets.petClimbF3,
  sakiArtAssets.petClimbF4,
  sakiArtAssets.petClimbF5,
  sakiArtAssets.petClimbF6
];
const petLieFrameKeys = Array.from(
  { length: 23 },
  (_, index) => `petLieF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetLieFrames: readonly string[] = petLieFrameKeys.map((key) => sakiArtAssets[key]);
const petPokeFrameKeys = Array.from(
  { length: 24 },
  (_, index) => `petPokeF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetPokeFrames: readonly string[] = petPokeFrameKeys.map((key) => sakiArtAssets[key]);
const petRollFrameKeys = Array.from(
  { length: 23 },
  (_, index) => `petRollF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetRollFrames: readonly string[] = petRollFrameKeys.map((key) => sakiArtAssets[key]);
const petSleepFrameKeys = Array.from(
  { length: 37 },
  (_, index) => `petSleepF${index + 1}` as keyof typeof sakiArtAssets
);
export let sakiPetSleepFrames: readonly string[] = petSleepFrameKeys.map((key) => sakiArtAssets[key]);
const petBathFrameKeys = [
  "petBathF1",
  "petBathF2",
  "petBathF3",
  "petBathF4",
  "petBathF5",
  "petBathF6",
  "petBathF7",
  "petBathF8",
  "petBathF9",
  "petBathF10",
  "petBathF11",
  "petBathF12",
  "petBathF13",
  "petBathF14",
  "petBathF15",
  "petBathF16",
  "petBathF17",
  "petBathF18",
  "petBathF19",
  "petBathF20",
  "petBathF21",
  "petBathF22",
  "petBathF23"
] as const;
export let sakiPetBathFrames: readonly string[] = petBathFrameKeys.map((key) => sakiArtAssets[key]);
export let sakiPetDoctorFrames: readonly string[] = [
  sakiArtAssets.petDoctorF1,
  sakiArtAssets.petDoctorF2,
  sakiArtAssets.petDoctorF3,
  sakiArtAssets.petDoctorF4,
  sakiArtAssets.petDoctorF5,
  sakiArtAssets.petDoctorF6
];
export let sakiPetSingingFrames: readonly string[] = [
  sakiArtAssets.singingF1,
  sakiArtAssets.singingF2,
  sakiArtAssets.singingF3,
  sakiArtAssets.singingF4,
  sakiArtAssets.singingF5,
  sakiArtAssets.singingF6
];
export let sakiPetEatFrames: readonly string[] = [
  sakiArtAssets.petEatF1,
  sakiArtAssets.petEatF2,
  sakiArtAssets.petEatF3,
  sakiArtAssets.petEatF4,
  sakiArtAssets.petEatF5,
  sakiArtAssets.petEatF6
];

function expressionAnimFrames(name: string): readonly string[] {
  return [1, 2, 3, 4, 5, 6].map((i) => `/assets/expression/anim/${name}_f${i}.webp`);
}

export const sakiExpressionPlayOnce = new Set([
  "surprised",
  "OK",
  "wink",
  "sorry",
  "cry",
  "blocked",
  "happy",
  "shy",
  "pout",
  "upset",
  "rollback",
  "middlefinger"
]);

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
  blocked: expressionAnimFrames("blocked"),
  middlefinger: expressionAnimFrames("middlefinger"),
  singing: expressionAnimFrames("singing")
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
};

export const defaultSakiArtAssets: Record<string, string> = { ...sakiArtAssets };
const defaultExpressionImages = { ...expressionImages };
const defaultExpressionAnimFrames: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(sakiExpressionAnimFrames).map(([key, frames]) => [key, [...frames]])
);

let skinRevision = 0;
const skinChangeListeners = new Set<() => void>();

export function getSkinRevision(): number {
  return skinRevision;
}

export function subscribeSkinChange(listener: () => void): () => void {
  skinChangeListeners.add(listener);
  return () => {
    skinChangeListeners.delete(listener);
  };
}

function rebuildDerivedSkinArrays() {
  sakiIdleLauncherAssets = [sakiArtAssets.launcher, sakiArtAssets.launcher2];
  sakiSpeakingAssets = [sakiArtAssets.speaking1, sakiArtAssets.speaking2];
  sakiPetIdleFrames = petIdleFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetPickupEnterFrames = petPickupEnterFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetPickupLoopFrames = petPickupLoopFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetSitFrames = petSitFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetToiletFrames = petToiletFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetRunFrames = petRunFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetWalkFrames = [
    sakiArtAssets.petWalkF1,
    sakiArtAssets.petWalkF2,
    sakiArtAssets.petWalkF3,
    sakiArtAssets.petWalkF4,
    sakiArtAssets.petWalkF5,
    sakiArtAssets.petWalkF6
  ];
  sakiPetClimbFrames = [
    sakiArtAssets.petClimbF1,
    sakiArtAssets.petClimbF2,
    sakiArtAssets.petClimbF3,
    sakiArtAssets.petClimbF4,
    sakiArtAssets.petClimbF5,
    sakiArtAssets.petClimbF6
  ];
  sakiPetLieFrames = petLieFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetPokeFrames = petPokeFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetRollFrames = petRollFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetSleepFrames = petSleepFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetBathFrames = petBathFrameKeys.map((key) => sakiArtAssets[key]);
  sakiPetDoctorFrames = [
    sakiArtAssets.petDoctorF1,
    sakiArtAssets.petDoctorF2,
    sakiArtAssets.petDoctorF3,
    sakiArtAssets.petDoctorF4,
    sakiArtAssets.petDoctorF5,
    sakiArtAssets.petDoctorF6
  ];
  sakiPetSingingFrames = [
    sakiArtAssets.singingF1,
    sakiArtAssets.singingF2,
    sakiArtAssets.singingF3,
    sakiArtAssets.singingF4,
    sakiArtAssets.singingF5,
    sakiArtAssets.singingF6
  ];
  sakiPetEatFrames = [
    sakiArtAssets.petEatF1,
    sakiArtAssets.petEatF2,
    sakiArtAssets.petEatF3,
    sakiArtAssets.petEatF4,
    sakiArtAssets.petEatF5,
    sakiArtAssets.petEatF6
  ];
}

function publishSkinChange() {
  skinRevision += 1;
  rebuildDerivedSkinArrays();
  skinChangeListeners.forEach((fn) => fn());
}

export function applySkinAssetOverrides(
  overrides: Record<string, string>,
  pathRemap?: (originalPath: string) => string | null
) {
  Object.assign(sakiArtAssets, defaultSakiArtAssets);
  Object.assign(expressionImages, defaultExpressionImages);
  for (const [key, frames] of Object.entries(defaultExpressionAnimFrames)) {
    sakiExpressionAnimFrames[key] = [...frames];
  }

  const art = sakiArtAssets as Record<string, string>;
  const expr = expressionImages as Record<string, string>;

  for (const [key, value] of Object.entries(overrides)) {
    if (key in art) art[key] = value;
    if (key in expr) expr[key] = value;
  }

  for (const [key, frames] of Object.entries(defaultExpressionAnimFrames)) {
    sakiExpressionAnimFrames[key] = frames.map((original) => pathRemap?.(original) || original);
  }

  publishSkinChange();
}

export function resetSkinAssetOverrides() {
  Object.assign(sakiArtAssets, defaultSakiArtAssets);
  Object.assign(expressionImages, defaultExpressionImages);
  for (const [key, frames] of Object.entries(defaultExpressionAnimFrames)) {
    sakiExpressionAnimFrames[key] = [...frames];
  }
  publishSkinChange();
}

