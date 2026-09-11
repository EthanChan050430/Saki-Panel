import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  ArrowLeft,
  RotateCcw,
  Zap,
  Skull,
  Heart
} from "lucide-react";
import { usePanelLanguage } from "../../../i18n/index.js";

export interface SakiPlantSlayerGameProps {
  onClose: () => void;
  onFinish: (score: number, expReward: number) => void;
  onBackToPhone?: () => void;
}

export type PlantStage = 1 | 2 | 3 | 4 | 5 | 6;
export type ElementalType = "fire" | "poison" | "lightning" | "ice" | null;

export interface ElementalOption {
  type: "fire" | "poison" | "lightning" | "ice";
  name: string;
  nameTw: string;
  nameEn: string;
  desc: string;
  descTw: string;
  descEn: string;
  icon: string;
  color: string;
  glow: string;
}

export const ELEMENTAL_OPTIONS: ElementalOption[] = [
  {
    type: "fire",
    name: "火焰超级机枪",
    nameTw: "火焰超級機槍",
    nameEn: "Pyro Super Gatling",
    desc: "每一发子弹伤害大幅暴涨，命中产生剧烈烈焰爆炸群伤！",
    descTw: "每一發子彈傷害大幅暴漲，命中產生劇烈烈焰爆炸群傷！",
    descEn: "Massive bullet damage with burning fiery explosive splash!",
    icon: "🔥",
    color: "#ea580c",
    glow: "rgba(234, 88, 12, 0.6)"
  },
  {
    type: "poison",
    name: "毒液超级机枪",
    nameTw: "毒液超級機槍",
    nameEn: "Toxic Super Gatling",
    desc: "子弹附带剧毒，命中持续叠层使后续伤害翻倍，打BOSS与精英的终极神器！",
    descTw: "子彈附帶劇毒，命中持續疊層使後續傷害翻倍，打BOSS與精英的終極神器！",
    descEn: "Every hit stacks poison doubling subsequent damage, ultimate boss melter!",
    icon: "🧪",
    color: "#16a34a",
    glow: "rgba(22, 163, 74, 0.6)"
  },
  {
    type: "lightning",
    name: "电能超级机枪",
    nameTw: "電能超級機槍",
    nameEn: "Tesla Super Gatling",
    desc: "每发子弹自带无限穿透 + 狂暴电击，对周围所有目标造成致命连锁电弧！",
    descTw: "每發子彈自帶無限穿透 + 狂暴電擊，對周圍所有目標造成致命連鎖電弧！",
    descEn: "Infinite pierce + chain shock damage arching to all surrounding zombies!",
    icon: "⚡",
    color: "#0284c7",
    glow: "rgba(2, 132, 199, 0.6)"
  },
  {
    type: "ice",
    name: "寒冰超级机枪",
    nameTw: "寒冰超級機槍",
    nameEn: "Cryo Super Gatling",
    desc: "每发子弹直接绝对冻结僵尸，并在击杀时产生大范围极冻粉碎冰爆！",
    descTw: "每發子彈直接絕對凍結殭屍，並在擊殺時產生大範圍極凍粉碎冰爆！",
    descEn: "Every bullet freezes zombies solid with shattering AoE frost ring on kill!",
    icon: "❄️",
    color: "#06b6d4",
    glow: "rgba(6, 182, 212, 0.6)"
  }
];

// 游戏音效合成器
class PlantSoundFX {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  public init() {
    try {
      if (!this.ctx && typeof window !== "undefined") {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        void this.ctx.resume();
      }
    } catch {}
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public playShoot() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(780, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.05);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);

      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = "triangle";
      subOsc.frequency.setValueAtTime(160, now);
      subOsc.frequency.exponentialRampToValueAtTime(40, now + 0.04);
      subGain.gain.setValueAtTime(0.15, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.04);
    } catch {}
  }

  public playHit() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.04);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch {}
  }

  public playZap() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(900 + Math.random() * 300, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.1);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {}
  }

  public playExplosion() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(20, now + 0.35);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch {}
  }

  public playSunCollect() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.setValueAtTime(880, now + 0.04);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  public playChime(index: number = 0) {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5];
      const freq = notes[index % notes.length]!;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.05, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  public playUltimate() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const freqs = [440, 554.37, 659.25, 880, 1108.73];
      freqs.forEach((f, idx) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(f, now + idx * 0.06);
        gain.gain.setValueAtTime(0.2, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.4);
        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.4);
      });
    } catch {}
  }

  public playLevelUp() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, now + i * 0.07);
        gain.gain.setValueAtTime(0.2, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.25);
      });
    } catch {}
  }

  public playVictory() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const chords = [
        [523.25, 659.25, 783.99],
        [587.33, 739.99, 880.0],
        [659.25, 830.61, 987.77],
        [783.99, 987.77, 1174.66]
      ];
      chords.forEach((chord, i) => {
        chord.forEach((freq) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, now + i * 0.15);
          gain.gain.setValueAtTime(0.12, now + i * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.35);
          osc.connect(gain);
          gain.connect(this.ctx!.destination);
          osc.start(now + i * 0.15);
          osc.stop(now + i * 0.15 + 0.35);
        });
      });
    } catch {}
  }

  public playExplode() {
    this.playExplosion();
  }

  public playSplash() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  }

  public playFreeze() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(2200, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }
}

interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  isCrit: boolean;
  pierce: number;
  color: string;
  radius: number;
  isUltimate: boolean;
  element?: ElementalType;
  hitZombieIds?: Set<number>;
}

interface Zombie {
  id: number;
  type: "buckethead" | "chainsaw" | "void_reaper" | "boss_titan";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  baseSpeed: number;
  damage: number;
  radius: number;
  hitFlashTimer: number;
  frozenTimer: number;
  burnTimer: number;
  poisonStacks?: number;
  teleportTimer?: number;
  isElite?: boolean;
  bossLevel?: number;
  specialSkillTimer?: number;
}

interface SunDrop {
  id: number;
  x: number;
  y: number;
  value: number;
  isBean?: boolean;
  isMagnetized?: boolean;
}

interface GameSprites {
  plantPeashooter: HTMLImageElement;
  plantRepeater: HTMLImageElement;
  plantThreepeater: HTMLImageElement;
  plantGatling: HTMLImageElement;
  plantSuperGatling: HTMLImageElement;
  plantSuperGatlingFire: HTMLImageElement;
  plantSuperGatlingPoison: HTMLImageElement;
  plantSuperGatlingLightning: HTMLImageElement;
  plantSuperGatlingIce: HTMLImageElement;
  zombieBucket: HTMLImageElement;
  zombieFootball: HTMLImageElement;
  zombieReaper: HTMLImageElement;
  bossTitan: HTMLImageElement;
  sunCrystal: HTMLImageElement;
  energyBean: HTMLImageElement;
  lawnPattern: HTMLImageElement;
}

interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  isCrit?: boolean;
  life: number;
  maxLife: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  life: number;
  maxLife: number;
}

interface LightningBolt {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  life: number;
}

interface Shockwave {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
}

export const PLANT_STAGE_INFO: Record<PlantStage, { name: string; nameTw: string; nameEn: string; icon: string }> = {
  1: { name: "基础豌豆", nameTw: "基礎豌豆", nameEn: "Peashooter", icon: "🌱" },
  2: { name: "双发射手", nameTw: "雙發射手", nameEn: "Repeater", icon: "🌿" },
  3: { name: "三线射手", nameTw: "三線射手", nameEn: "Threepeater", icon: "🎯" },
  4: { name: "机枪射手", nameTw: "機槍射手", nameEn: "Gatling Pea", icon: "🎖️" },
  5: { name: "超级机枪射手", nameTw: "超級機槍射手", nameEn: "Super Gatling", icon: "👑" },
  6: { name: "元素超级机枪", nameTw: "元素超級機槍", nameEn: "Elemental Gatling", icon: "⚡" }
};

export function SakiPlantSlayerGame({
  onClose,
  onFinish,
  onBackToPhone
}: SakiPlantSlayerGameProps) {
  const { language } = usePanelLanguage();
  const isEn = language === "en-US";
  const isTw = language === "zh-TW";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const soundRef = useRef<PlantSoundFX>(new PlantSoundFX());

  // 游戏状态
  const [score, setScore] = useState(0);
  const [kills, setKills] = useState(0);
  const [level, setLevel] = useState(1);
  const [sunExp, setSunExp] = useState(0);
  const [sunNext, setSunNext] = useState(120);
  const [hp, setHp] = useState(100);
  const [maxHp] = useState(100);
  const [shield, setShield] = useState(0);
  const [energyBeans, setEnergyBeans] = useState(1);
  const [isUltimate, setIsUltimate] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [bossHp, setBossHp] = useState<number | null>(null);
  const [bossMaxHp, setBossMaxHp] = useState<number | null>(null);
  const [currentBossLevel, setCurrentBossLevel] = useState(1);
  const [comboText, setComboText] = useState<string | null>(null);
  const [sakiShout, setSakiShout] = useState<string | null>(null);

  // 植物与元素状态
  const [plantStage, setPlantStage] = useState<PlantStage>(1);
  const [elementalType, setElementalType] = useState<ElementalType>(null);
  const [isElementalChoose, setIsElementalChoose] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isVictory, setIsVictory] = useState(false);

  // 实体状态引用
  const nextEntityId = useRef(1);
  const playerRef = useRef({
    x: 180,
    y: 320,
    radius: 20,
    angle: 0,
    hp: 100,
    shield: 0,
    speed: 3.8,
    shootCooldown: 0,
    isUltimate: false,
    ultimateTimer: 0,
    energyBeans: 1,
    recoil: 0,
    invulnerableTimer: 0,
    emergencyShieldUsed: false,
    stage: 1 as PlantStage,
    element: null as ElementalType,
    extraAtkBonus: 0,
    level: 1,
    sunExp: 0,
    sunNext: 120
  });

  const spritesRef = useRef<GameSprites | null>(null);

  // 预加载贴图资源
  useEffect(() => {
    if (typeof window === "undefined") return;
    const load = (src: string) => {
      const img = new Image();
      img.src = src;
      return img;
    };
    spritesRef.current = {
      plantPeashooter: load("/assets/game/slayer/plant_peashooter.webp"),
      plantRepeater: load("/assets/game/slayer/plant_repeater.webp"),
      plantThreepeater: load("/assets/game/slayer/plant_threepeater.webp"),
      plantGatling: load("/assets/game/slayer/plant_gatling.webp"),
      plantSuperGatling: load("/assets/game/slayer/plant_super_gatling.webp"),
      plantSuperGatlingFire: load("/assets/game/slayer/plant_super_gatling_fire.webp"),
      plantSuperGatlingPoison: load("/assets/game/slayer/plant_super_gatling_poison.webp"),
      plantSuperGatlingLightning: load("/assets/game/slayer/plant_super_gatling_lightning.webp"),
      plantSuperGatlingIce: load("/assets/game/slayer/plant_super_gatling_ice.webp"),
      zombieBucket: load("/assets/game/slayer/zombie_bucket.webp"),
      zombieFootball: load("/assets/game/slayer/zombie_football.webp"),
      zombieReaper: load("/assets/game/slayer/zombie_reaper.webp"),
      bossTitan: load("/assets/game/slayer/boss_titan.webp"),
      sunCrystal: load("/assets/game/slayer/sun_crystal.webp"),
      energyBean: load("/assets/game/slayer/energy_bean.webp"),
      lawnPattern: load("/assets/game/slayer/slayer_battle_lawn.webp")
    };
  }, []);

  const bulletsRef = useRef<Bullet[]>([]);
  const zombiesRef = useRef<Zombie[]>([]);
  const sunDropsRef = useRef<SunDrop[]>([]);
  const floatTextsRef = useRef<FloatText[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lightningRef = useRef<LightningBolt[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);

  // 计时器与生成系统
  const spawnTimerRef = useRef(0);
  const gameTimeRef = useRef(0);
  const killsCountRef = useRef(0);
  const nextBossTimeRef = useRef(45);
  const nextBossKillsRef = useRef(45);
  const bossLevelRef = useRef(1);
  const activeBossRef = useRef(false);
  const bossSpawnedRef = useRef(false);
  const keysDownRef = useRef<Set<string>>(new Set());
  const touchJoystickRef = useRef<{ active: boolean; startX: number; startY: number; currX: number; currY: number } | null>(null);
  const screenShakeRef = useRef(0);

  // 初始化音效
  useEffect(() => {
    soundRef.current.init();
    return () => {
      soundRef.current.setMuted(true);
    };
  }, []);

  const triggerScreenShake = useCallback((amount: number) => {
    screenShakeRef.current = Math.min(24, screenShakeRef.current + amount);
  }, []);

  // 释放能量豆大招
  const triggerPlantFoodUltimate = useCallback((e?: React.SyntheticEvent) => {
    if (e) {
      e.stopPropagation();
      if ("preventDefault" in e) e.preventDefault();
    }
    const p = playerRef.current;
    if (p.energyBeans <= 0 || p.isUltimate || isElementalChoose || isFinished) return;

    soundRef.current.playUltimate();
    p.energyBeans -= 1;
    setEnergyBeans(p.energyBeans);
    p.isUltimate = true;
    p.ultimateTimer = 5.5;

    // 大招期间无敌
    p.invulnerableTimer = 5.5;
    p.hp = Math.min(100, p.hp + 25);
    p.shield = Math.max(p.shield, 50);
    setHp(p.hp);
    setShield(p.shield);

    setIsUltimate(true);
    triggerScreenShake(22);

    // 各阶段与元素大招效果
    if (p.stage === 1) {
      // 基础豌豆射手大招
      setSakiShout(isEn ? "🌱 MEGA PEA CANNON BURST!! 💣" : isTw ? "🌱 巨型毀滅豌豆加農炮連發——！！💣" : "🌱 巨型毁灭豌豆加农炮连发——！！💣");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 320,
        color: "#10b981"
      });
      for (let m = 0; m < 6; m++) {
        const mAngle = p.angle + (m - 2.5) * 0.12;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x + Math.cos(p.angle) * 30,
          y: p.y + Math.sin(p.angle) * 30,
          vx: Math.cos(mAngle) * 580,
          vy: Math.sin(mAngle) * 580,
          damage: 480 + p.extraAtkBonus * 2,
          isCrit: true,
          pierce: 99,
          color: "#34d399",
          radius: 18,
          isUltimate: true,
          hitZombieIds: new Set()
        });
      }
    } else if (p.stage === 2) {
      // 双发射手大招
      setSakiShout(isEn ? "🌿 TWIN HELIX PLASMA STORM!! 🌀" : isTw ? "🌿 雙螺旋等離子風暴——！！🌀" : "🌿 双螺旋等离子风暴——！！🌀");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 340,
        color: "#4ade80"
      });
      for (let s = 0; s < 14; s++) {
        const sOffset = (s % 2 === 0 ? 1 : -1) * 0.16;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x + Math.cos(p.angle) * 28,
          y: p.y + Math.sin(p.angle) * 28,
          vx: Math.cos(p.angle + sOffset) * (640 + s * 15),
          vy: Math.sin(p.angle + sOffset) * (640 + s * 15),
          damage: 180 + p.extraAtkBonus,
          isCrit: true,
          pierce: 6,
          color: s % 2 === 0 ? "#4ade80" : "#a7f3d0",
          radius: 8,
          isUltimate: true,
          hitZombieIds: new Set()
        });
      }
    } else if (p.stage === 3) {
      // 三线射手大招
      setSakiShout(isEn ? "🎯 THREE-HEADED 360° BULLET HELL!! 🌪️" : isTw ? "🎯 三頭全域360°彈幕狂歡地獄——！！🌪️" : "🎯 三头全域360°弹幕狂欢地狱——！！🌪️");
      for (let ring = 0; ring < 3; ring++) {
        shockwavesRef.current.push({
          id: nextEntityId.current++,
          x: p.x,
          y: p.y,
          radius: 10 + ring * 25,
          maxRadius: 360,
          color: "#22c55e"
        });
      }
      for (let d = 0; d < 32; d++) {
        const radAngle = (d / 32) * Math.PI * 2;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x,
          y: p.y,
          vx: Math.cos(radAngle) * 640,
          vy: Math.sin(radAngle) * 640,
          damage: 220 + p.extraAtkBonus,
          isCrit: true,
          pierce: 5,
          color: "#22c55e",
          radius: 7.5,
          isUltimate: true,
          hitZombieIds: new Set()
        });
      }
    } else if (p.stage === 4) {
      // 机枪射手大招
      setSakiShout(isEn ? "🎖️ SUPERSONIC METALSTORM SHREDDER!! 💥" : isTw ? "🎖️ 戰術金屬風暴加特林絞殺——！！💥" : "🎖️ 战术金属风暴加特林绞杀——！！💥");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 360,
        color: "#f59e0b"
      });
      for (let g = 0; g < 24; g++) {
        const gAngle = p.angle + (Math.random() - 0.5) * 0.45;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x + Math.cos(p.angle) * 32,
          y: p.y + Math.sin(p.angle) * 32,
          vx: Math.cos(gAngle) * (800 + Math.random() * 100),
          vy: Math.sin(gAngle) * (800 + Math.random() * 100),
          damage: 240 + p.extraAtkBonus,
          isCrit: true,
          pierce: 8,
          color: "#facc15",
          radius: 7,
          isUltimate: true,
          hitZombieIds: new Set()
        });
      }
    } else if (p.stage === 5 && !p.element) {
      // 超级机枪射手大招
      setSakiShout(isEn ? "👑 HYPER-NOVA ZENITH PULSE!! 🌟" : isTw ? "👑 五維天頂超頻等離子脈衝——！！🌟" : "👑 五维天顶超频等离子脉冲——！！🌟");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 380,
        color: "#facc15"
      });
      zombiesRef.current.forEach((z) => {
        z.hp -= 380;
        lightningRef.current.push({
          id: nextEntityId.current++,
          x1: z.x,
          y1: 0,
          x2: z.x,
          y2: z.y,
          color: "#facc15",
          life: 0.28
        });
      });
    } else if (p.element === "fire") {
      // 火焰元素大招
      setSakiShout(isEn ? "🔥 INFERNO HELLFIRE MELTDOWN!! 🌋" : isTw ? "🔥 滅世紅蓮流星煉獄焚燒——！！🌋" : "🔥 灭世红莲流星炼狱焚烧——！！🌋");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 400,
        color: "#ea580c"
      });
      for (let f = 0; f < 10; f++) {
        const fAngle = p.angle + (f - 4.5) * 0.25;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x + Math.cos(p.angle) * 32,
          y: p.y + Math.sin(p.angle) * 32,
          vx: Math.cos(fAngle) * 650,
          vy: Math.sin(fAngle) * 650,
          damage: 460 + p.extraAtkBonus * 2,
          isCrit: true,
          pierce: 4,
          color: "#f97316",
          radius: 14,
          isUltimate: true,
          element: "fire",
          hitZombieIds: new Set()
        });
      }
      zombiesRef.current.forEach((z) => {
        z.burnTimer = 4.0;
        z.hp -= 200;
      });
    } else if (p.element === "poison") {
      // 毒液元素大招
      setSakiShout(isEn ? "🧪 BIOHAZARD ACID TSUNAMI!! ☣️" : isTw ? "🧪 劇毒生化酸雨海嘯溶蝕——！！☣️" : "🧪 剧毒生化酸雨海啸溶蚀——！！☣️");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 400,
        color: "#16a34a"
      });
      for (let ps = 0; ps < 16; ps++) {
        const psAngle = p.angle + (ps - 7.5) * 0.18;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x + Math.cos(p.angle) * 32,
          y: p.y + Math.sin(p.angle) * 32,
          vx: Math.cos(psAngle) * 680,
          vy: Math.sin(psAngle) * 680,
          damage: 320 + p.extraAtkBonus,
          isCrit: true,
          pierce: 6,
          color: "#84cc16",
          radius: 11,
          isUltimate: true,
          element: "poison",
          hitZombieIds: new Set()
        });
      }
      // 全体叠加毒液层数
      zombiesRef.current.forEach((z) => {
        z.poisonStacks = 10;
        z.hp -= 340;
        z.hitFlashTimer = 0.15;
      });
    } else if (p.element === "lightning") {
      // 电能元素大招
      setSakiShout(isEn ? "⚡ BILLION-VOLT EMP SUPERSTORM!! 🌩️" : isTw ? "⚡ 億伏特超導電磁雷暴核爆——！！🌩️" : "⚡ 亿伏特超导电磁雷暴核爆——！！🌩️");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 420,
        color: "#38bdf8"
      });
      for (let lt = 0; lt < 18; lt++) {
        const ltAngle = p.angle + (lt - 8.5) * 0.15;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x + Math.cos(p.angle) * 32,
          y: p.y + Math.sin(p.angle) * 32,
          vx: Math.cos(ltAngle) * 850,
          vy: Math.sin(ltAngle) * 850,
          damage: 340 + p.extraAtkBonus,
          isCrit: true,
          pierce: 20,
          color: "#38bdf8",
          radius: 10,
          isUltimate: true,
          element: "lightning",
          hitZombieIds: new Set()
        });
      }
      zombiesRef.current.forEach((z) => {
        z.hp -= 420;
        z.hitFlashTimer = 0.15;
        if (lightningRef.current.length < 25) {
          lightningRef.current.push({
            id: nextEntityId.current++,
            x1: z.x,
            y1: 0,
            x2: z.x,
            y2: z.y,
            color: "#38bdf8",
            life: 0.35
          });
        }
      });
    } else if (p.element === "ice") {
      // 寒冰元素大招
      setSakiShout(isEn ? "❄️ ABSOLUTE ZERO GLACIATION!! 🧊" : isTw ? "❄️ 絕對零度極凍冰河世紀——！！🧊" : "❄️ 绝对零度极冻冰河世纪——！！🧊");
      shockwavesRef.current.push({
        id: nextEntityId.current++,
        x: p.x,
        y: p.y,
        radius: 10,
        maxRadius: 420,
        color: "#06b6d4"
      });
      for (let ic = 0; ic < 16; ic++) {
        const icAngle = p.angle + (ic - 7.5) * 0.18;
        bulletsRef.current.push({
          id: nextEntityId.current++,
          x: p.x + Math.cos(p.angle) * 32,
          y: p.y + Math.sin(p.angle) * 32,
          vx: Math.cos(icAngle) * 720,
          vy: Math.sin(icAngle) * 720,
          damage: 320 + p.extraAtkBonus,
          isCrit: true,
          pierce: 8,
          color: "#06b6d4",
          radius: 12,
          isUltimate: true,
          element: "ice",
          hitZombieIds: new Set()
        });
      }
      zombiesRef.current.forEach((z) => {
        z.frozenTimer = 5.0;
        z.hp -= 280;
        z.hitFlashTimer = 0.15;
      });
    }

    window.setTimeout(() => setSakiShout(null), 3200);

    // 清理身边范围内的僵尸并重创精英/Boss
    zombiesRef.current.forEach((z) => {
      const dx = z.x - p.x;
      const dy = z.y - p.y;
      if (Math.hypot(dx, dy) < 260) {
        if (z.type === "boss_titan") {
          z.hp -= 650;
        } else if (z.isElite) {
          z.hp -= 500;
        } else {
          z.hp = 0;
        }
        z.hitFlashTimer = 0.2;
      }
    });
  }, [isEn, isTw, isElementalChoose, isFinished, triggerScreenShake]);

  // 6级元素分支选择
  const handleSelectElement = (elemType: "fire" | "poison" | "lightning" | "ice") => {
    playerRef.current.element = elemType;
    setElementalType(elemType);
    setIsElementalChoose(false);
    soundRef.current.playLevelUp();
    triggerScreenShake(14);

    const chosenOpt = ELEMENTAL_OPTIONS.find((o) => o.type === elemType);
    const chosenName = chosenOpt ? (isEn ? chosenOpt.nameEn : isTw ? chosenOpt.nameTw : chosenOpt.name) : "";

    setComboText(isEn ? `AWAKENED: ${chosenName}!` : isTw ? `終極覺醒：${chosenName}！` : `终极觉醒：${chosenName}！`);
    window.setTimeout(() => setComboText(null), 3000);

    setSakiShout(
      isEn
        ? `🔥 ${chosenName} ACTIVATED! ANNIHILATE THEM!`
        : isTw
        ? `🔥 ${chosenName} 已就緒！主人盡情割草吧！`
        : `🔥 ${chosenName} 已就绪！主人尽情割草吧！`
    );
    window.setTimeout(() => setSakiShout(null), 3500);

    shockwavesRef.current.push({
      id: nextEntityId.current++,
      x: playerRef.current.x,
      y: playerRef.current.y,
      radius: 10,
      maxRadius: 280,
      color: chosenOpt?.color || "#facc15"
    });
  };

  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysDownRef.current.add(e.key.toLowerCase());
      if (e.key === " " || e.key.toLowerCase() === "q" || e.key.toLowerCase() === "e") {
        triggerPlantFoodUltimate();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysDownRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [triggerPlantFoodUltimate]);

  // 虚拟摇杆控制
  const handlePointerDown = (e: React.PointerEvent) => {
    soundRef.current.init();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    touchJoystickRef.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      currX: clientX,
      currY: clientY
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!touchJoystickRef.current?.active) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    touchJoystickRef.current.currX = e.clientX - rect.left;
    touchJoystickRef.current.currY = e.clientY - rect.top;
  };

  const handlePointerUp = () => {
    touchJoystickRef.current = null;
  };

  // 主循环
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gameLoop = (currentTime: number) => {
      try {
        const dt = Math.min(0.033, (currentTime - lastTime) / 1000);
        lastTime = currentTime;

      const width = canvas.width;
      const height = canvas.height;

      if (!isElementalChoose && !isFinished) {
        // 移动更新
        let moveX = 0;
        let moveY = 0;

        if (keysDownRef.current.has("w") || keysDownRef.current.has("arrowup")) moveY -= 1;
        if (keysDownRef.current.has("s") || keysDownRef.current.has("arrowdown")) moveY += 1;
        if (keysDownRef.current.has("a") || keysDownRef.current.has("arrowleft")) moveX -= 1;
        if (keysDownRef.current.has("d") || keysDownRef.current.has("arrowright")) moveX += 1;

        if (touchJoystickRef.current?.active) {
          const dx = touchJoystickRef.current.currX - touchJoystickRef.current.startX;
          const dy = touchJoystickRef.current.currY - touchJoystickRef.current.startY;
          const dist = Math.hypot(dx, dy);
          if (dist > 8) {
            moveX = dx / dist;
            moveY = dy / dist;
          }
        }

        const len = Math.hypot(moveX, moveY);
        const p = playerRef.current;
        const curSpeed = p.isUltimate ? p.speed * 1.5 : p.speed;
        if (len > 0) {
          p.x += (moveX / len) * curSpeed * 60 * dt;
          p.y += (moveY / len) * curSpeed * 60 * dt;
        }

        p.x = Math.max(p.radius, Math.min(width - p.radius, p.x));
        p.y = Math.max(p.radius + 35, Math.min(height - p.radius - 20, p.y));

        // 后坐力恢复
        p.recoil = Math.max(0, p.recoil - dt * 25);

        // 无敌帧递减
        if (p.invulnerableTimer > 0) {
          p.invulnerableTimer -= dt;
        }

        // 大招计时
        if (p.isUltimate) {
          p.ultimateTimer -= dt;
          if (p.ultimateTimer <= 0) {
            p.isUltimate = false;
            setIsUltimate(false);
          }
        }

        // 自动瞄准最近目标
        let nearestZombie: Zombie | null = null;
        let nearestDist = Infinity;
        for (let i = 0; i < zombiesRef.current.length; i++) {
          const z = zombiesRef.current[i]!;
          const d = Math.hypot(z.x - p.x, z.y - p.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearestZombie = z;
          }
        }

        if (nearestZombie) {
          p.angle = Math.atan2(nearestZombie.y - p.y, nearestZombie.x - p.x);
        } else if (p.isUltimate) {
          p.angle += 8 * dt;
        }

        // 射击弹道配置
        p.shootCooldown -= dt;

        let baseInterval = 0.16;
        let barrelCount = 1;
        let baseDamage = 38 + p.extraAtkBonus;
        let bulletSpeed = 540;
        let pierceCount = 0;
        let bulletColor = "#34d399";
        let bulletRadius = 4.5;
        let spreadAngle = 0.12;

        if (p.isUltimate) {
          if (p.stage === 1) {
            barrelCount = 3;
            baseInterval = 0.045;
            baseDamage = 260 + p.extraAtkBonus;
            bulletSpeed = 760;
            pierceCount = 6;
            bulletColor = "#4ade80";
            bulletRadius = 9.0;
            spreadAngle = 0.14;
          } else if (p.stage === 2) {
            barrelCount = 6;
            baseInterval = 0.032;
            baseDamage = 180 + p.extraAtkBonus;
            bulletSpeed = 800;
            pierceCount = 4;
            bulletColor = "#22c55e";
            bulletRadius = 6.2;
            spreadAngle = 0.16;
          } else if (p.stage === 3) {
            barrelCount = 9;
            baseInterval = 0.035;
            baseDamage = 160 + p.extraAtkBonus;
            bulletSpeed = 780;
            pierceCount = 4;
            bulletColor = "#10b981";
            bulletRadius = 6.4;
            spreadAngle = 0.32;
          } else if (p.stage === 4) {
            barrelCount = 10;
            baseInterval = 0.024;
            baseDamage = 210 + p.extraAtkBonus;
            bulletSpeed = 880;
            pierceCount = 6;
            bulletColor = "#059669";
            bulletRadius = 6.8;
            spreadAngle = 0.18;
          } else if (p.stage === 5) {
            barrelCount = 12;
            baseInterval = 0.020;
            baseDamage = 250 + p.extraAtkBonus;
            bulletSpeed = 920;
            pierceCount = 8;
            bulletColor = "#facc15";
            bulletRadius = 7.2;
            spreadAngle = 0.20;
          } else if (p.stage === 6) {
            if (p.element === "fire") {
              barrelCount = 10;
              baseInterval = 0.022;
              baseDamage = 450 + p.extraAtkBonus;
              bulletSpeed = 880;
              pierceCount = 5;
              bulletColor = "#f97316";
              bulletRadius = 8.8;
              spreadAngle = 0.18;
            } else if (p.element === "poison") {
              barrelCount = 12;
              baseInterval = 0.019;
              baseDamage = 230 + p.extraAtkBonus;
              bulletSpeed = 860;
              pierceCount = 8;
              bulletColor = "#84cc16";
              bulletRadius = 7.5;
              spreadAngle = 0.22;
            } else if (p.element === "lightning") {
              barrelCount = 12;
              baseInterval = 0.017;
              baseDamage = 270 + p.extraAtkBonus;
              bulletSpeed = 980;
              pierceCount = 999;
              bulletColor = "#38bdf8";
              bulletRadius = 7.5;
              spreadAngle = 0.22;
            } else if (p.element === "ice") {
              barrelCount = 10;
              baseInterval = 0.020;
              baseDamage = 280 + p.extraAtkBonus;
              bulletSpeed = 880;
              pierceCount = 6;
              bulletColor = "#06b6d4";
              bulletRadius = 8.0;
              spreadAngle = 0.20;
            } else {
              barrelCount = 12;
              baseInterval = 0.020;
              baseDamage = 250 + p.extraAtkBonus;
              bulletSpeed = 920;
              pierceCount = 8;
              bulletColor = "#facc15";
              bulletRadius = 7.2;
              spreadAngle = 0.20;
            }
          } else {
            barrelCount = 8;
            baseInterval = 0.03;
            baseDamage = 120 + p.extraAtkBonus;
            bulletSpeed = 750;
            pierceCount = 8;
            bulletColor = "#38bdf8";
            bulletRadius = 6.5;
            spreadAngle = 0.16;
          }
        } else if (p.stage === 1) {
          barrelCount = 1;
          baseInterval = 0.16;
          baseDamage = 38 + p.extraAtkBonus;
          bulletSpeed = 540;
          pierceCount = 0;
          bulletColor = "#34d399";
          bulletRadius = 4.5;
        } else if (p.stage === 2) {
          barrelCount = 2;
          baseInterval = 0.13;
          baseDamage = 50 + p.extraAtkBonus;
          bulletSpeed = 580;
          pierceCount = 0;
          bulletColor = "#4ade80";
          bulletRadius = 4.8;
          spreadAngle = 0.09;
        } else if (p.stage === 3) {
          barrelCount = 3;
          baseInterval = 0.11;
          baseDamage = 64 + p.extraAtkBonus;
          bulletSpeed = 620;
          pierceCount = 1;
          bulletColor = "#22c55e";
          bulletRadius = 5.0;
          spreadAngle = 0.16;
        } else if (p.stage === 4) {
          barrelCount = 4;
          baseInterval = 0.085;
          baseDamage = 82 + p.extraAtkBonus;
          bulletSpeed = 660;
          pierceCount = 2;
          bulletColor = "#10b981";
          bulletRadius = 5.2;
          spreadAngle = 0.15;
        } else if (p.stage === 5) {
          barrelCount = 5;
          baseInterval = 0.075;
          baseDamage = 105 + p.extraAtkBonus;
          bulletSpeed = 700;
          pierceCount = 3;
          bulletColor = "#facc15";
          bulletRadius = 5.5;
          spreadAngle = 0.16;
        } else if (p.stage === 6) {
          barrelCount = 5;
          spreadAngle = 0.16;
          if (p.element === "fire") {
            baseInterval = 0.072;
            baseDamage = 220 + p.extraAtkBonus;
            bulletSpeed = 720;
            pierceCount = 1;
            bulletColor = "#f97316";
            bulletRadius = 6.0;
          } else if (p.element === "poison") {
            baseInterval = 0.070;
            baseDamage = 95 + p.extraAtkBonus;
            bulletSpeed = 680;
            pierceCount = 2;
            bulletColor = "#22c55e";
            bulletRadius = 5.6;
          } else if (p.element === "lightning") {
            baseInterval = 0.068;
            baseDamage = 110 + p.extraAtkBonus;
            bulletSpeed = 760;
            pierceCount = 999;
            bulletColor = "#38bdf8";
            bulletRadius = 5.8;
          } else if (p.element === "ice") {
            baseInterval = 0.072;
            baseDamage = 115 + p.extraAtkBonus;
            bulletSpeed = 700;
            pierceCount = 2;
            bulletColor = "#06b6d4";
            bulletRadius = 5.6;
          } else {
            baseInterval = 0.075;
            baseDamage = 105 + p.extraAtkBonus;
            bulletSpeed = 700;
            pierceCount = 3;
            bulletColor = "#facc15";
            bulletRadius = 5.5;
          }
        }

        if (p.shootCooldown <= 0 && (nearestZombie || p.isUltimate)) {
          p.shootCooldown = baseInterval;
          p.recoil = 6.0;
          soundRef.current.playShoot();

          for (let b = 0; b < barrelCount; b++) {
            const offsetAngle = (b - (barrelCount - 1) / 2) * spreadAngle;
            const finalAngle = p.angle + offsetAngle;
            const isCrit = Math.random() < 0.25;
            const damage = isCrit ? baseDamage * 2.2 : baseDamage;

            bulletsRef.current.push({
              id: nextEntityId.current++,
              x: p.x + Math.cos(p.angle) * 26,
              y: p.y + Math.sin(p.angle) * 26,
              vx: Math.cos(finalAngle) * bulletSpeed,
              vy: Math.sin(finalAngle) * bulletSpeed,
              damage: Math.round(damage),
              isCrit,
              pierce: pierceCount,
              color: isCrit ? "#facc15" : bulletColor,
              radius: bulletRadius,
              isUltimate: p.isUltimate,
              element: p.element,
              hitZombieIds: new Set()
            });
          }

          // 5阶被动：12%概率触发齐射
          if (p.stage >= 5 && !p.isUltimate && Math.random() < 0.12) {
            soundRef.current.playZap();
            triggerScreenShake(7);
            for (let od = 0; od < 8; od++) {
              const odAngle = p.angle + (od - 3.5) * 0.28;
              bulletsRef.current.push({
                id: nextEntityId.current++,
                x: p.x + Math.cos(p.angle) * 30,
                y: p.y + Math.sin(p.angle) * 30,
                vx: Math.cos(odAngle) * 720,
                vy: Math.sin(odAngle) * 720,
                damage: Math.round((baseDamage + 60) * 1.6),
                isCrit: true,
                pierce: 3,
                color: "#38bdf8",
                radius: 6,
                isUltimate: true,
                element: p.element,
                hitZombieIds: new Set()
              });
            }
            floatTextsRef.current.push({
              id: nextEntityId.current++,
              x: p.x,
              y: p.y - 28,
              text: "⚡ OVERDRIVE BURST! ⚡",
              color: "#38bdf8",
              isCrit: true,
              life: 0.75,
              maxLife: 0.75
            });
          }

          // 大招期间随机轰击全场敌人
          if (p.isUltimate && Math.random() < 0.5 && zombiesRef.current.length > 0) {
            const targetZ = zombiesRef.current[Math.floor(Math.random() * zombiesRef.current.length)]!;
            if (p.element === "fire") {
              targetZ.hp -= 320;
              targetZ.burnTimer = 3.0;
              targetZ.hitFlashTimer = 0.12;
              soundRef.current.playExplode();
              shockwavesRef.current.push({
                id: nextEntityId.current++,
                x: targetZ.x,
                y: targetZ.y,
                radius: 5,
                maxRadius: 60,
                color: "#f97316"
              });
            } else if (p.element === "poison") {
              targetZ.hp -= 260;
              targetZ.poisonStacks = Math.min(15, (targetZ.poisonStacks ?? 0) + 3);
              targetZ.hitFlashTimer = 0.12;
              soundRef.current.playSplash();
            } else if (p.element === "ice") {
              targetZ.hp -= 280;
              targetZ.frozenTimer = 3.0;
              targetZ.hitFlashTimer = 0.12;
              soundRef.current.playFreeze();
            } else {
              // 雷电/默认大招落雷
              targetZ.hp -= 280;
              targetZ.hitFlashTimer = 0.12;
              soundRef.current.playZap();
              lightningRef.current.push({
                id: nextEntityId.current++,
                x1: targetZ.x,
                y1: 0,
                x2: targetZ.x,
                y2: targetZ.y,
                color: "#38bdf8",
                life: 0.18
              });
            }
          }
        }

        // 子弹物理与碰撞检测
        for (let i = bulletsRef.current.length - 1; i >= 0; i--) {
          const b = bulletsRef.current[i]!;
          b.x += b.vx * dt;
          b.y += b.vy * dt;

          if (b.x < -20 || b.x > width + 20 || b.y < -20 || b.y > height + 20) {
            bulletsRef.current.splice(i, 1);
            continue;
          }

          for (let j = 0; j < zombiesRef.current.length; j++) {
            const z = zombiesRef.current[j]!;

            // 防止单颗穿透子弹单帧重复命中
            if (b.hitZombieIds && b.hitZombieIds.has(z.id)) {
              continue;
            }

            if (Math.hypot(z.x - b.x, z.y - b.y) < z.radius + b.radius) {
              if (!b.hitZombieIds) b.hitZombieIds = new Set();
              b.hitZombieIds.add(z.id);

              let finalDamage = b.damage;

              // 毒液：命中叠层并提升后续伤害
              if (b.element === "poison" || p.element === "poison") {
                z.poisonStacks = Math.min(10, (z.poisonStacks ?? 0) + 1);
                const poisonMult = 1 + z.poisonStacks * 0.45;
                finalDamage = Math.round(finalDamage * poisonMult);
              }

              z.hp -= finalDamage;
              z.hitFlashTimer = 0.08;
              soundRef.current.playHit();

              // 击退
              const bLen = Math.hypot(b.vx, b.vy);
              if (bLen > 0 && z.type !== "boss_titan") {
                z.x += (b.vx / bLen) * 5;
                z.y += (b.vy / bLen) * 5;
              }

              // 火焰：爆炸范围伤害
              if (b.element === "fire" || p.element === "fire") {
                if (shockwavesRef.current.length < 20) {
                  shockwavesRef.current.push({
                    id: nextEntityId.current++,
                    x: b.x,
                    y: b.y,
                    radius: 8,
                    maxRadius: 65,
                    color: "#ea580c"
                  });
                }
                zombiesRef.current.forEach((otherZ) => {
                  if (otherZ !== z && Math.hypot(otherZ.x - b.x, otherZ.y - b.y) < 65) {
                    otherZ.hp -= 125 + p.extraAtkBonus;
                    otherZ.hitFlashTimer = 0.08;
                    otherZ.burnTimer = 2.0;
                  }
                });
              }

              // 寒冰：冰冻目标
              if (b.element === "ice" || p.element === "ice") {
                z.frozenTimer = 2.8;
              }

              // 电能：连锁闪电
              if (b.element === "lightning" || p.element === "lightning") {
                let targets = 0;
                for (let k = 0; k < zombiesRef.current.length && targets < 4; k++) {
                  const chainZ = zombiesRef.current[k]!;
                  if (chainZ.id !== z.id && Math.hypot(chainZ.x - z.x, chainZ.y - z.y) < 160) {
                    chainZ.hp -= 85 + p.extraAtkBonus;
                    chainZ.hitFlashTimer = 0.08;
                    targets++;
                    if (lightningRef.current.length < 25) {
                      lightningRef.current.push({
                        id: nextEntityId.current++,
                        x1: z.x,
                        y1: z.y,
                        x2: chainZ.x,
                        y2: chainZ.y,
                        color: "#38bdf8",
                        life: 0.18
                      });
                    }
                  }
                }
              }

              // 伤害飘字
              if (floatTextsRef.current.length < 35) {
                const isPoisonStacked = (z.poisonStacks || 0) > 1;
                floatTextsRef.current.push({
                  id: nextEntityId.current++,
                  x: z.x + (Math.random() * 20 - 10),
                  y: z.y - 12,
                  text: isPoisonStacked
                    ? `${finalDamage} (x${(1 + (z.poisonStacks || 0) * 0.45).toFixed(1)}) 🧪`
                    : b.element === "fire"
                    ? `CRIT ${finalDamage}! 🔥`
                    : b.isCrit
                    ? `CRIT ${finalDamage}!`
                    : `-${finalDamage}`,
                  color: isPoisonStacked
                    ? "#4ade80"
                    : b.element === "fire"
                    ? "#f97316"
                    : b.element === "ice"
                    ? "#38bdf8"
                    : b.isCrit
                    ? "#facc15"
                    : "#ffffff",
                  isCrit: b.isCrit || b.element === "fire",
                  life: 0.6,
                  maxLife: 0.6
                });
              }

              // 受击火花
              if (particlesRef.current.length < 120) {
                for (let k = 0; k < 3; k++) {
                  particlesRef.current.push({
                    id: nextEntityId.current++,
                    x: b.x,
                    y: b.y,
                    vx: (Math.random() - 0.5) * 180,
                    vy: (Math.random() - 0.5) * 180,
                    color: b.color,
                    radius: Math.random() * 3 + 1.5,
                    life: 0.25,
                    maxLife: 0.25
                  });
                }
              }

              if (b.pierce <= 0) {
                bulletsRef.current.splice(i, 1);
                break;
              } else {
                b.pierce -= 1;
              }
            }
          }
        }

        // 僵尸波次刷新
        gameTimeRef.current += dt;
        if (Math.floor(gameTimeRef.current) !== Math.floor(gameTimeRef.current - dt)) {
          setElapsedTime(Math.floor(gameTimeRef.current));
        }
        spawnTimerRef.current += dt;

        const timeMin = gameTimeRef.current / 60;
        const levelScale = Math.max(0, p.level - 1);
        const hpMult = 1 + levelScale * 0.42 + timeMin * 0.35;
        const speedMult = Math.min(1.45, 1 + levelScale * 0.04 + timeMin * 0.06);
        const dmgMult = 1 + levelScale * 0.18 + timeMin * 0.15;

        const spawnInterval = Math.max(0.52, 1.5 - timeMin * 0.22 - levelScale * 0.08);
        if (spawnTimerRef.current >= spawnInterval) {
          spawnTimerRef.current = 0;

          // 按玩家等级成批生成僵尸
          const squadCount = Math.min(10, Math.floor(Math.random() * 3) + 3 + Math.floor(levelScale * 0.7));
          const side = Math.floor(Math.random() * 4);
          const eliteChance = Math.min(0.32, Math.max(0, (p.level - 1) * 0.075));

          for (let s = 0; s < squadCount; s++) {
            let sx = 0;
            let sy = 0;
            const jitter = (s - squadCount / 2) * 24;

            if (side === 0) {
              sx = Math.random() * width + jitter;
              sy = -25;
            } else if (side === 1) {
              sx = width + 25;
              sy = Math.random() * height + jitter;
            } else if (side === 2) {
              sx = Math.random() * width + jitter;
              sy = height + 25;
            } else {
              sx = -25;
              sy = Math.random() * height + jitter;
            }

            const roll = Math.random();
            let type: Zombie["type"] = "buckethead";
            let baseHp = 130;
            let baseSpeed = 52;
            let radius = 17;
            let baseDmg = 12;

            if (roll < 0.32) {
              type = "chainsaw";
              baseHp = 210;
              baseSpeed = 86;
              radius = 19;
              baseDmg = 18;
            } else if (roll < 0.52) {
              type = "void_reaper";
              baseHp = 115;
              baseSpeed = 58;
              radius = 16;
              baseDmg = 14;
            }

            const isElite = Math.random() < eliteChance;
            const finalHp = Math.round(baseHp * hpMult * (isElite ? 3.2 : 1.0));
            const finalSpeed = Math.round(baseSpeed * speedMult * (isElite ? 0.9 : 1.0));
            const finalRadius = isElite ? Math.round(radius * 1.25) : radius;
            const finalDmg = Math.round(baseDmg * dmgMult * (isElite ? 1.5 : 1.0));

            zombiesRef.current.push({
              id: nextEntityId.current++,
              type,
              x: sx,
              y: sy,
              hp: finalHp,
              maxHp: finalHp,
              speed: finalSpeed,
              baseSpeed: finalSpeed,
              damage: finalDmg,
              radius: finalRadius,
              hitFlashTimer: 0,
              frozenTimer: 0,
              burnTimer: 0,
              teleportTimer: 3.0,
              isElite
            });
          }
        }

        // 周期性 Boss 生成
        if (
          !activeBossRef.current &&
          (gameTimeRef.current >= nextBossTimeRef.current || killsCountRef.current >= nextBossKillsRef.current)
        ) {
          activeBossRef.current = true;
          const bLv = bossLevelRef.current;
          setCurrentBossLevel(bLv);

          soundRef.current.playExplosion();
          triggerScreenShake(18);
          setSakiShout(
            isEn
              ? `⚠️ WARNING: TITAN MECH GARGANTUAR MK.${bLv} HAS ARRIVED!`
              : isTw
              ? `⚠️ 警告：毀滅泰坦機甲巨人 MK.${bLv} 降臨！`
              : `⚠️ 警告：毁灭泰坦机甲巨人 MK.${bLv} 降临！`
          );
          window.setTimeout(() => setSakiShout(null), 4000);

          const bossHp = Math.round(4200 * (1 + (bLv - 1) * 0.85) * (1 + (p.level - 1) * 0.15));
          const bossSpeed = Math.min(62, 38 + (bLv - 1) * 4);
          const bossDmg = Math.round(28 * (1 + (bLv - 1) * 0.25));

          zombiesRef.current.push({
            id: nextEntityId.current++,
            type: "boss_titan",
            bossLevel: bLv,
            x: width / 2,
            y: -60,
            hp: bossHp,
            maxHp: bossHp,
            speed: bossSpeed,
            baseSpeed: bossSpeed,
            damage: bossDmg,
            radius: 42,
            hitFlashTimer: 0,
            frozenTimer: 0,
            burnTimer: 0,
            specialSkillTimer: 4.5
          });
        }

        // 僵尸状态与移动更新
        for (let i = zombiesRef.current.length - 1; i >= 0; i--) {
          const z = zombiesRef.current[i]!;

          if (z.hitFlashTimer > 0) z.hitFlashTimer -= dt;

          // 减速/冰冻状态更新
          if (z.frozenTimer > 0) {
            z.frozenTimer -= dt;
            z.speed = z.baseSpeed * 0.35;
          } else {
            z.speed = z.baseSpeed;
          }

          const zAngle = Math.atan2(p.y - z.y, p.x - z.x);
          z.x += Math.cos(zAngle) * z.speed * dt;
          z.y += Math.sin(zAngle) * z.speed * dt;

          // 特殊能力逻辑
          if (z.type === "void_reaper") {
            z.teleportTimer = (z.teleportTimer || 3.0) - dt;
            if (z.teleportTimer <= 0) {
              z.teleportTimer = 3.5;
              const tAngle = Math.random() * Math.PI * 2;
              const safeDist = 135 + Math.random() * 55;
              z.x = Math.max(z.radius, Math.min(width - z.radius, p.x + Math.cos(tAngle) * safeDist));
              z.y = Math.max(z.radius, Math.min(height - z.radius, p.y + Math.sin(tAngle) * safeDist));
              soundRef.current.playZap();
            }
          }

          if (z.type === "boss_titan") {
            setBossHp(Math.max(0, z.hp));
            setBossMaxHp(z.maxHp);

            // Boss 践踏技能
            z.specialSkillTimer = (z.specialSkillTimer ?? 4.5) - dt;
            if (z.specialSkillTimer <= 0) {
              z.specialSkillTimer = 4.8;
              soundRef.current.playExplosion();
              triggerScreenShake(14);
              shockwavesRef.current.push({
                id: nextEntityId.current++,
                x: z.x,
                y: z.y,
                radius: 12,
                maxRadius: 180,
                color: "#ef4444"
              });

              // 击退范围内玩家
              const distToBoss = Math.hypot(p.x - z.x, p.y - z.y);
              if (distToBoss < 180) {
                const kAngle = Math.atan2(p.y - z.y, p.x - z.x);
                p.x += Math.cos(kAngle) * 45;
                p.y += Math.sin(kAngle) * 45;
                if (!p.isUltimate && p.invulnerableTimer <= 0) {
                  p.hp = Math.max(0, p.hp - 12);
                  setHp(Math.round(p.hp));
                  p.invulnerableTimer = 0.5;
                }
              }
            }
          }

          // 玩家受击结算
          const distToP = Math.hypot(p.x - z.x, p.y - z.y);
          if (distToP < p.radius + z.radius) {
            // 碰撞排斥分离
            const cDist = distToP || 1;
            const nx = (z.x - p.x) / cDist;
            const ny = (z.y - p.y) / cDist;
            z.x = p.x + nx * (p.radius + z.radius + 3);
            z.y = p.y + ny * (p.radius + z.radius + 3);

            if (!p.isUltimate && p.invulnerableTimer <= 0) {
              p.invulnerableTimer = 0.65; // 无敌帧
              triggerScreenShake(7);
              soundRef.current.playHit();

              let rawDmg = z.damage;

              // 护盾抵扣
              if (p.shield > 0) {
                const absorbed = Math.min(p.shield, rawDmg);
                p.shield -= absorbed;
                rawDmg -= absorbed;
                setShield(Math.max(0, Math.round(p.shield)));
              }

              if (rawDmg > 0) {
                // 名刀/防猝死紧急护盾
                if (p.hp - rawDmg <= 0 && !p.emergencyShieldUsed) {
                  p.emergencyShieldUsed = true;
                  p.hp = 30;
                  p.shield = 50;
                  p.invulnerableTimer = 1.6;
                  setHp(30);
                  setShield(50);
                  soundRef.current.playExplosion();
                  triggerScreenShake(14);
                  setSakiShout(
                    isEn
                      ? "⚠️ EMERGENCY SHIELD DEPLOYED! USE ENERGY BEAN!"
                      : isTw
                      ? "⚠️ 緊急防護罩已展開！主人快用能量豆大招！"
                      : "⚠️ 紧急防护罩已展开！主人快用能量豆大招！"
                  );
                  window.setTimeout(() => setSakiShout(null), 3500);

                  // 击退附近敌人
                  shockwavesRef.current.push({
                    id: nextEntityId.current++,
                    x: p.x,
                    y: p.y,
                    radius: 10,
                    maxRadius: 240,
                    color: "#38bdf8"
                  });
                  zombiesRef.current.forEach((otherZ) => {
                    const od = Math.hypot(otherZ.x - p.x, otherZ.y - p.y) || 1;
                    if (od < 240) {
                      otherZ.x += ((otherZ.x - p.x) / od) * 110;
                      otherZ.y += ((otherZ.y - p.y) / od) * 110;
                      otherZ.hitFlashTimer = 0.15;
                    }
                  });
                } else {
                  p.hp = Math.max(0, p.hp - rawDmg);
                  setHp(Math.max(0, Math.round(p.hp)));

                  floatTextsRef.current.push({
                    id: nextEntityId.current++,
                    x: p.x + (Math.random() - 0.5) * 20,
                    y: p.y - 18,
                    text: `-${rawDmg}`,
                    color: "#ef4444",
                    life: 0.8,
                    maxLife: 0.8
                  });

                  if (p.hp <= 0) {
                    p.hp = 0;
                    soundRef.current.playHit();
                    triggerScreenShake(15);
                    window.setTimeout(() => {
                      setIsFinished(true);
                      setIsVictory(false);
                    }, 1000);
                    return;
                  }
                }
              }
            }
          }

          // 僵尸击杀结算
          if (z.hp <= 0) {
            zombiesRef.current.splice(i, 1);
            killsCountRef.current += 1;
            const currentKills = killsCountRef.current;
            setKills(currentKills);
            if (currentKills % 25 === 0) {
              setComboText(
                currentKills >= 150
                  ? "🌟 GODLIKE SAKI SLAYER! 🌟"
                  : currentKills >= 100
                  ? "🔥 UNSTOPPABLE RAMPAGE! 🔥"
                  : currentKills >= 50
                  ? "⚡ MEGA KILL STREAK! ⚡"
                  : "💥 MULTI KILL!"
              );
              window.setTimeout(() => setComboText(null), 2000);
            }

            const pts = z.type === "boss_titan" ? 8000 : z.isElite ? 260 : z.type === "chainsaw" ? 90 : 45;
            setScore((prev) => prev + pts);

            // 击杀爆炸连锁
            if (Math.random() < 0.35 || p.isUltimate) {
              shockwavesRef.current.push({
                id: nextEntityId.current++,
                x: z.x,
                y: z.y,
                radius: 8,
                maxRadius: 75,
                color: "#f59e0b"
              });
              soundRef.current.playExplosion();
              zombiesRef.current.forEach((otherZ) => {
                if (otherZ !== z && Math.hypot(otherZ.x - z.x, otherZ.y - z.y) < 75) {
                  otherZ.hp -= 85;
                  otherZ.hitFlashTimer = 0.08;
                }
              });
            }

            // 掉落阳光/能量豆
            let dropVal = 12;
            let beanChance = 0.08;
            if (z.type === "boss_titan") {
              dropVal = 200;
              beanChance = 1.0;
            } else if (z.isElite) {
              dropVal = 45;
              beanChance = 0.35;
            } else if (z.type === "chainsaw") {
              dropVal = 18;
              beanChance = 0.12;
            }

            sunDropsRef.current.push({
              id: nextEntityId.current++,
              x: z.x,
              y: z.y,
              value: dropVal,
              isBean: Math.random() < beanChance || z.type === "boss_titan",
              isMagnetized: p.isUltimate
            });

            // 击杀粒子
            for (let k = 0; k < (z.isElite ? 16 : 10); k++) {
              particlesRef.current.push({
                id: nextEntityId.current++,
                x: z.x,
                y: z.y,
                vx: (Math.random() - 0.5) * (z.isElite ? 220 : 160),
                vy: (Math.random() - 0.5) * (z.isElite ? 220 : 160),
                color: z.isElite ? "#facc15" : z.type === "chainsaw" ? "#ef4444" : z.type === "void_reaper" ? "#a855f7" : "#6ee7b7",
                radius: Math.random() * 4 + 2,
                life: 0.35,
                maxLife: 0.35
              });
            }

            // 冰冻击杀碎冰伤害
            if (z.frozenTimer > 0) {
              shockwavesRef.current.push({
                id: nextEntityId.current++,
                x: z.x,
                y: z.y,
                radius: 8,
                maxRadius: 90,
                color: "#06b6d4"
              });
              soundRef.current.playExplosion();
              zombiesRef.current.forEach((otherZ) => {
                if (otherZ !== z && Math.hypot(otherZ.x - z.x, otherZ.y - z.y) < 90) {
                  otherZ.hp -= 110;
                  otherZ.frozenTimer = 2.0;
                  otherZ.hitFlashTimer = 0.08;
                }
              });
            }

            // Boss 击杀结算与波次推进
            if (z.type === "boss_titan") {
              activeBossRef.current = false;
              const defeatedLevel = z.bossLevel ?? bossLevelRef.current;
              bossLevelRef.current += 1;
              nextBossTimeRef.current = gameTimeRef.current + 55;
              nextBossKillsRef.current = killsCountRef.current + 60;

              setBossHp(null);
              setBossMaxHp(null);
              soundRef.current.playVictory();
              triggerScreenShake(22);

              for (let s = 0; s < 22; s++) {
                sunDropsRef.current.push({
                  id: nextEntityId.current++,
                  x: z.x + (Math.random() - 0.5) * 160,
                  y: z.y + (Math.random() - 0.5) * 160,
                  isBean: s < 2,
                  value: 55,
                  isMagnetized: true
                });
              }

              setSakiShout(
                isEn
                  ? `🎉 TITAN MECH MK.${defeatedLevel} ANNIHILATED! Next wave incoming!`
                  : isTw
                  ? `🎉 泰坦機甲 MK.${defeatedLevel} 已被徹底消滅！能量豆噴發！`
                  : `🎉 泰坦机甲 MK.${defeatedLevel} 已被彻底消灭！能量豆喷发！`
              );
              window.setTimeout(() => setSakiShout(null), 3500);

              setComboText(
                isEn
                  ? `👑 TITAN MK.${defeatedLevel} DESTROYED! 👑`
                  : isTw
                  ? `👑 泰坦巨人 MK.${defeatedLevel} 已被粉碎！👑`
                  : `👑 泰坦巨人 MK.${defeatedLevel} 已被粉碎！👑`
              );
              window.setTimeout(() => setComboText(null), 2500);
            }
          }
        }

        // 掉落物拾取与升级
        for (let i = sunDropsRef.current.length - 1; i >= 0; i--) {
          const drop = sunDropsRef.current[i]!;
          const dist = Math.hypot(p.x - drop.x, p.y - drop.y);

          if (dist < 120 || p.isUltimate || drop.isMagnetized) {
            const pullSpeed = drop.isMagnetized ? 0.35 : 0.22;
            drop.x += (p.x - drop.x) * pullSpeed;
            drop.y += (p.y - drop.y) * pullSpeed;
          }

          if (dist < p.radius + 18) {
            sunDropsRef.current.splice(i, 1);

            if (drop.isBean) {
              soundRef.current.playChime(7);
              p.energyBeans = Math.min(3, p.energyBeans + 1);
              setEnergyBeans(p.energyBeans);
              floatTextsRef.current.push({
                id: nextEntityId.current++,
                x: drop.x,
                y: drop.y,
                text: "+1 能量豆! 🌟",
                color: "#34d399",
                life: 0.9,
                maxLife: 0.9
              });
            } else {
              soundRef.current.playChime(p.sunExp % 8);
              p.sunExp += drop.value;

              while (p.sunExp >= p.sunNext) {
                soundRef.current.playLevelUp();
                p.sunExp -= p.sunNext;
                p.level += 1;

                if (p.level === 2) {
                  p.sunNext = 260;
                } else if (p.level === 3) {
                  p.sunNext = 480;
                } else if (p.level === 4) {
                  p.sunNext = 800;
                } else if (p.level === 5) {
                  p.sunNext = 1250;
                } else {
                  p.sunNext = Math.round(p.sunNext * 1.45);
                }

                const newLevel = p.level;
                setLevel(newLevel);
                setSunExp(p.sunExp);
                setSunNext(p.sunNext);

                // 升级吸附全部阳光
                sunDropsRef.current.forEach((d) => {
                  d.isMagnetized = true;
                });

                if (newLevel === 2) {
                  p.stage = 2;
                  setPlantStage(2);
                  setSakiShout(isEn ? "🌱 EVOLVED: Repeater! Twin Barrel Fire!" : isTw ? "🌱 植物進化：【雙發射手】！雙倍彈幕連射！" : "🌱 植物进化：【双发射手】！双倍弹幕连射！");
                  window.setTimeout(() => setSakiShout(null), 3000);
                  setComboText(isEn ? "PLANT EVOLVED: REPEATER!" : isTw ? "植物進化：雙發射手！" : "植物进化：双发射手！");
                  window.setTimeout(() => setComboText(null), 2500);
                } else if (newLevel === 3) {
                  p.stage = 3;
                  setPlantStage(3);
                  setSakiShout(isEn ? "🌿 EVOLVED: Threepeater! Triple Fan Spread!" : isTw ? "🌿 植物進化：【三線射手】！三向散射彈幕覆蓋！" : "🌿 植物进化：【三线射手】！三向散射弹幕覆盖！");
                  window.setTimeout(() => setSakiShout(null), 3000);
                  setComboText(isEn ? "PLANT EVOLVED: THREEPEATER!" : isTw ? "植物進化：三線射手！" : "植物进化：三线射手！");
                  window.setTimeout(() => setComboText(null), 2500);
                } else if (newLevel === 4) {
                  p.stage = 4;
                  setPlantStage(4);
                  setSakiShout(isEn ? "🎖️ EVOLVED: Gatling Pea! Rapid Armor Piercing!" : isTw ? "🎖️ 植物進化：【機槍射手】！超高速4連發穿透彈！" : "🎖️ 植物进化：【机枪射手】！超高速4连发穿透弹！");
                  window.setTimeout(() => setSakiShout(null), 3000);
                  setComboText(isEn ? "PLANT EVOLVED: GATLING PEA!" : isTw ? "植物進化：機槍射手！" : "植物进化：机枪射手！");
                  window.setTimeout(() => setComboText(null), 2500);
                } else if (newLevel === 5) {
                  p.stage = 5;
                  setPlantStage(5);
                  setSakiShout(isEn ? "👑 EVOLVED: Super Gatling Pea! Overdrive Chance Unlocked!" : isTw ? "👑 植物進化：【超級機槍射手】！普攻有幾率釋放能量豆暴走！" : "👑 植物进化：【超级机枪射手】！普攻有几率释放能量豆暴走！");
                  window.setTimeout(() => setSakiShout(null), 3500);
                  setComboText(isEn ? "PLANT EVOLVED: SUPER GATLING PEA!" : isTw ? "植物進化：超級機槍射手！" : "植物进化：超级机枪射手！");
                  window.setTimeout(() => setComboText(null), 2500);
                } else if (newLevel === 6) {
                  p.stage = 6;
                  setPlantStage(6);
                  setIsElementalChoose(true);
                } else if (newLevel >= 7) {
                  p.extraAtkBonus += 22;
                  p.hp = Math.min(100, p.hp + 25);
                  p.shield = Math.min(80, p.shield + 20);
                  setHp(p.hp);
                  setShield(p.shield);
                  setComboText(isEn ? `⚡ POWER BREAKTHROUGH Lv.${newLevel}! ATK +22, HP +25` : isTw ? `⚡ 屬性突破 Lv.${newLevel}！攻擊力 +22，生命恢復 +25` : `⚡ 属性突破 Lv.${newLevel}！攻击力 +22，生命恢复 +25`);
                  window.setTimeout(() => setComboText(null), 2200);
                }
              }
              setSunExp(p.sunExp);
            }
          }
        }

        // 粒子与浮动文字生命周期
        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const pt = particlesRef.current[i]!;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.life -= dt;
          if (pt.life <= 0) particlesRef.current.splice(i, 1);
        }

        for (let i = floatTextsRef.current.length - 1; i >= 0; i--) {
          const ft = floatTextsRef.current[i]!;
          ft.y -= 34 * dt;
          ft.life -= dt;
          if (ft.life <= 0) floatTextsRef.current.splice(i, 1);
        }

        for (let i = lightningRef.current.length - 1; i >= 0; i--) {
          const l = lightningRef.current[i]!;
          l.life -= dt;
          if (l.life <= 0) lightningRef.current.splice(i, 1);
        }

        for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
          const sw = shockwavesRef.current[i]!;
          sw.radius += (sw.maxRadius - sw.radius) * 10 * dt;
          if (sw.radius >= sw.maxRadius - 5) shockwavesRef.current.splice(i, 1);
        }
      }

      // 画布渲染
      ctx.save();

      // 屏幕抖动
      if (screenShakeRef.current > 0) {
        const sx = (Math.random() - 0.5) * screenShakeRef.current;
        const sy = (Math.random() - 0.5) * screenShakeRef.current;
        ctx.translate(sx, sy);
        screenShakeRef.current = Math.max(0, screenShakeRef.current - dt * 28);
      }

      // 草坪背景
      const sprites = spritesRef.current;
      if (sprites?.lawnPattern && sprites.lawnPattern.complete) {
        const pattern = ctx.createPattern(sprites.lawnPattern, "repeat");
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, width, height);
        }
      } else {
        const tileSize = 44;
        const cols = Math.ceil(width / tileSize);
        const rows = Math.ceil(height / tileSize);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? "#15803d" : "#166534";
            ctx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
          }
        }
      }

      // 边框
      ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(4, 4, width - 8, height - 8);

      // 冲击波
      shockwavesRef.current.forEach((sw) => {
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = 4;
        ctx.globalAlpha = 1 - sw.radius / sw.maxRadius;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // 闪电
      lightningRef.current.forEach((l) => {
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        const mx = (l.x1 + l.x2) / 2 + (Math.random() - 0.5) * 26;
        const my = (l.y1 + l.y2) / 2 + (Math.random() - 0.5) * 26;
        ctx.lineTo(mx, my);
        ctx.lineTo(l.x2, l.y2);
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = l.color;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      // 掉落物（阳光 / 能量豆）
      sunDropsRef.current.forEach((drop) => {
        ctx.save();
        ctx.translate(drop.x, drop.y);

        if (drop.isBean) {
          if (sprites?.energyBean && sprites.energyBean.complete) {
            const pulse = 1 + Math.sin(currentTime * 0.008) * 0.14;
            ctx.scale(pulse, pulse);
            ctx.drawImage(sprites.energyBean, -16, -16, 32, 32);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, 11, 0, Math.PI * 2);
            ctx.fillStyle = "#10b981";
            ctx.shadowColor = "#34d399";
            ctx.shadowBlur = 14;
            ctx.fill();
          }
        } else {
          if (sprites?.sunCrystal && sprites.sunCrystal.complete) {
            const spin = currentTime * 0.002;
            ctx.rotate(spin);
            ctx.drawImage(sprites.sunCrystal, -18, -18, 36, 36);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, 9, 0, Math.PI * 2);
            ctx.fillStyle = "#f59e0b";
            ctx.fill();
          }
        }
        ctx.restore();
      });

      // 僵尸
      zombiesRef.current.forEach((z) => {
        ctx.save();
        ctx.translate(z.x, z.y);

        const wobble = Math.sin(currentTime * 0.008 * (z.speed / 40)) * 0.14;
        ctx.rotate(wobble);

        const isHitFlash = z.hitFlashTimer > 0;
        let sImg: HTMLImageElement | null = null;
        let sW = 46;
        let sH = 46;

        if (z.type === "boss_titan") {
          sImg = sprites?.bossTitan ?? null;
          sW = 96;
          sH = 96;
        } else if (z.type === "void_reaper") {
          sImg = sprites?.zombieReaper ?? null;
          sW = 50;
          sH = 50;
        } else if (z.type === "chainsaw") {
          sImg = sprites?.zombieFootball ?? null;
          sW = 52;
          sH = 52;
        } else {
          sImg = sprites?.zombieBucket ?? null;
          sW = 46;
          sH = 46;
        }

        if (z.isElite) {
          sW = Math.round(sW * 1.25);
          sH = Math.round(sH * 1.25);

          // 精英怪光环
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, z.radius * 1.35, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(234, 179, 8, 0.28)";
          ctx.shadowColor = "#facc15";
          ctx.shadowBlur = 16;
          ctx.fill();
          ctx.restore();
        }

        if (sImg && sImg.complete) {
          ctx.save();
          if (isHitFlash) {
            ctx.filter = "brightness(2.6) contrast(1.5)";
          } else if (z.frozenTimer > 0) {
            ctx.filter = "hue-rotate(180deg) saturate(2) brightness(1.2)";
          }
          ctx.drawImage(sImg, -sW / 2, -sH / 2, sW, sH);
          ctx.restore();
        } else {
          ctx.fillStyle = isHitFlash ? "#ffffff" : z.type === "boss_titan" ? "#1e293b" : z.isElite ? "#ca8a04" : "#4ade80";
          ctx.beginPath();
          ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // 血条与精英标记
        if (z.isElite) {
          ctx.save();
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = "#facc15";
          ctx.shadowColor = "rgba(0,0,0,0.8)";
          ctx.shadowBlur = 4;
          ctx.fillText("👑 ELITE", 0, -sH / 2 - 12);
          ctx.restore();
        }

        if (z.hp < z.maxHp || z.isElite) {
          const barW = Math.min(68, Math.max(28, z.radius * 2));
          const barY = -sH / 2 - 8;
          ctx.fillStyle = "rgba(0,0,0,0.65)";
          ctx.fillRect(-barW / 2, barY, barW, 4.5);
          ctx.fillStyle = z.frozenTimer > 0 ? "#38bdf8" : z.type === "boss_titan" ? "#f43f5e" : z.isElite ? "#eab308" : "#22c55e";
          ctx.fillRect(-barW / 2, barY, barW * Math.max(0, z.hp / z.maxHp), 4.5);
        }

        ctx.restore();
      });

      // 子弹渲染
      bulletsRef.current.forEach((b) => {
        ctx.save();
        ctx.translate(b.x, b.y);
        const bAngle = Math.atan2(b.vy, b.vx);
        ctx.rotate(bAngle);

        if (b.element === "fire") {
          // 火焰弹
          const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, b.radius * 1.5);
          grad.addColorStop(0, "#fef08a");
          grad.addColorStop(0.35, "#f97316");
          grad.addColorStop(0.8, "#dc2626");
          grad.addColorStop(1, "rgba(124, 45, 18, 0)");

          ctx.beginPath();
          ctx.moveTo(b.radius * 1.2, 0);
          ctx.lineTo(-b.radius * 2.8, -b.radius * 0.9);
          ctx.lineTo(-b.radius * 4.2, 0);
          ctx.lineTo(-b.radius * 2.8, b.radius * 0.9);
          ctx.closePath();
          ctx.fillStyle = "rgba(249, 115, 22, 0.45)";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(0, 0, b.radius * 1.3, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.shadowColor = "#f97316";
          ctx.shadowBlur = b.isUltimate ? 18 : 10;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(b.radius * 0.3, 0, b.radius * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        } else if (b.element === "poison") {
          // 毒液弹
          ctx.beginPath();
          ctx.moveTo(b.radius, 0);
          ctx.lineTo(-b.radius * 2.2, -b.radius * 0.6);
          ctx.lineTo(-b.radius * 3.2, 0);
          ctx.lineTo(-b.radius * 2.2, b.radius * 0.6);
          ctx.closePath();
          ctx.fillStyle = "rgba(132, 204, 22, 0.4)";
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(0, 0, b.radius * 1.4, b.radius * 0.85, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#22c55e";
          ctx.shadowColor = "#4ade80";
          ctx.shadowBlur = b.isUltimate ? 16 : 8;
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(b.radius * 0.2, -b.radius * 0.2, b.radius * 0.7, b.radius * 0.4, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#bef264";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(-b.radius * 0.6, b.radius * 0.2, b.radius * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        } else if (b.element === "lightning") {
          // 电能弹
          ctx.beginPath();
          ctx.moveTo(b.radius * 2.5, 0);
          ctx.lineTo(-b.radius * 4.5, -b.radius * 0.4);
          ctx.lineTo(-b.radius * 4.5, b.radius * 0.4);
          ctx.closePath();
          ctx.fillStyle = "rgba(56, 189, 248, 0.5)";
          ctx.shadowColor = "#38bdf8";
          ctx.shadowBlur = b.isUltimate ? 20 : 12;
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(b.radius * 2.4, 0);
          ctx.lineTo(-b.radius * 0.8, -b.radius * 0.9);
          ctx.lineTo(-b.radius * 1.8, 0);
          ctx.lineTo(-b.radius * 0.8, b.radius * 0.9);
          ctx.closePath();
          ctx.fillStyle = "#e0f2fe";
          ctx.fill();

          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(-b.radius * 3.5, 0);
          ctx.lineTo(b.radius * 2.2, 0);
          ctx.stroke();

          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(-b.radius, -b.radius * 0.9);
          ctx.lineTo(0, -b.radius * 1.6);
          ctx.lineTo(b.radius, -b.radius * 0.8);
          ctx.moveTo(-b.radius, b.radius * 0.9);
          ctx.lineTo(0, b.radius * 1.6);
          ctx.lineTo(b.radius, b.radius * 0.8);
          ctx.stroke();
        } else if (b.element === "ice") {
          // 寒冰弹
          ctx.beginPath();
          ctx.moveTo(b.radius * 2.2, 0);
          ctx.lineTo(0, -b.radius * 0.95);
          ctx.lineTo(-b.radius * 2.4, 0);
          ctx.lineTo(0, b.radius * 0.95);
          ctx.closePath();
          ctx.fillStyle = "#06b6d4";
          ctx.shadowColor = "#67e8f9";
          ctx.shadowBlur = b.isUltimate ? 16 : 9;
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(b.radius * 1.6, 0);
          ctx.lineTo(0, -b.radius * 0.55);
          ctx.lineTo(-b.radius * 1.4, 0);
          ctx.lineTo(0, b.radius * 0.55);
          ctx.closePath();
          ctx.fillStyle = "#cffafe";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(0, 0, b.radius * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        } else if (b.isUltimate || b.color === "#facc15" || b.isCrit) {
          // 暴击/大招弹
          ctx.beginPath();
          ctx.ellipse(0, 0, b.radius * 1.6, b.radius * 0.9, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#facc15";
          ctx.shadowColor = "#f59e0b";
          ctx.shadowBlur = 12;
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(-b.radius * 0.6, 0, b.radius * 0.4, b.radius * 1.2, 0, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(254, 240, 138, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(b.radius * 0.3, -b.radius * 0.2, b.radius * 0.8, b.radius * 0.35, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        } else {
          // 普通豌豆
          ctx.beginPath();
          ctx.ellipse(0, 0, b.radius * 1.25, b.radius, 0, 0, Math.PI * 2);
          ctx.fillStyle = b.color;
          ctx.shadowColor = b.color;
          ctx.shadowBlur = 8;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(b.radius * 0.3, -b.radius * 0.25, b.radius * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        }

        ctx.restore();
      });

      // 玩家植物
      const p = playerRef.current;
      ctx.save();
      ctx.translate(p.x, p.y);

      // 无敌闪烁
      const isIFrameBlink = p.invulnerableTimer > 0 && Math.floor(currentTime / 70) % 2 === 0;
      if (isIFrameBlink) {
        ctx.globalAlpha = 0.35;
      }

      // 护盾光效
      if (p.shield > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 12, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
        ctx.lineWidth = 3.5;
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // 大招光环
      if (p.isUltimate) {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 18, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = 24;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.rotate(p.angle);

      // 后坐力位移
      ctx.translate(-p.recoil, 0);

      // 贴图绘制
      let plantImg: HTMLImageElement | null = null;
      if (p.stage === 1) {
        plantImg = sprites?.plantPeashooter ?? null;
      } else if (p.stage === 2) {
        plantImg = sprites?.plantRepeater ?? null;
      } else if (p.stage === 3) {
        plantImg = sprites?.plantThreepeater ?? null;
      } else if (p.stage === 4) {
        plantImg = sprites?.plantGatling ?? null;
      } else if (p.stage >= 5) {
        if (p.element === "fire") {
          plantImg = sprites?.plantSuperGatlingFire ?? null;
        } else if (p.element === "poison") {
          plantImg = sprites?.plantSuperGatlingPoison ?? null;
        } else if (p.element === "lightning") {
          plantImg = sprites?.plantSuperGatlingLightning ?? null;
        } else if (p.element === "ice") {
          plantImg = sprites?.plantSuperGatlingIce ?? null;
        } else {
          plantImg = sprites?.plantSuperGatling ?? null;
        }
      }

      let renderedOk = false;
      if (plantImg && plantImg.complete && plantImg.naturalWidth > 0) {
        try {
          ctx.save();
          if (p.element === "fire") {
            ctx.shadowColor = "#f97316";
            ctx.shadowBlur = 14;
          } else if (p.element === "poison") {
            ctx.shadowColor = "#22c55e";
            ctx.shadowBlur = 14;
          } else if (p.element === "lightning") {
            ctx.shadowColor = "#38bdf8";
            ctx.shadowBlur = 16;
          } else if (p.element === "ice") {
            ctx.shadowColor = "#06b6d4";
            ctx.shadowBlur = 14;
          } else if (p.stage >= 5) {
            ctx.shadowColor = "#facc15";
            ctx.shadowBlur = 12;
          }
          ctx.drawImage(plantImg, -28, -28, 56, 56);
          ctx.restore();
          renderedOk = true;
        } catch {
          renderedOk = false;
        }
      }

      if (!renderedOk) {
        // 贴图未加载时的降级矢量绘制
        const mainColor = p.element === "fire" ? "#ea580c" : p.element === "poison" ? "#65a30d" : p.element === "lightning" ? "#0284c7" : p.element === "ice" ? "#06b6d4" : p.stage >= 5 ? "#eab308" : "#10b981";
        const darkColor = p.element === "fire" ? "#7c2d12" : p.element === "poison" ? "#14532d" : p.element === "lightning" ? "#0c4a6e" : p.element === "ice" ? "#0e7490" : p.stage >= 5 ? "#854d0e" : "#065f46";
        const glowColor = p.element === "fire" ? "#f97316" : p.element === "poison" ? "#4ade80" : p.element === "lightning" ? "#38bdf8" : p.element === "ice" ? "#67e8f9" : p.stage >= 5 ? "#facc15" : "#34d399";

        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 14;

        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = mainColor;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = darkColor;
        ctx.stroke();

        const numBarrels = p.stage >= 5 ? 5 : p.stage >= 4 ? 4 : p.stage === 3 ? 3 : p.stage === 2 ? 2 : 1;
        const bSpacing = 6;
        for (let b = 0; b < numBarrels; b++) {
          const by = (b - (numBarrels - 1) / 2) * bSpacing;
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(10, by - 2.5, 18, 5);
          ctx.fillStyle = glowColor;
          ctx.fillRect(26, by - 2.5, 3, 5);
        }

        ctx.fillStyle = glowColor;
        ctx.fillRect(-2, -6, 12, 5);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(2, -5, 4, 3);

        ctx.restore();
      }

      // 开火枪口火光
      if (p.recoil > 1.2) {
        ctx.save();
        ctx.fillStyle = "#facc15";
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(28, -10);
        ctx.lineTo(46, 0);
        ctx.lineTo(28, 10);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();

      // 残血红边
      if (hp < 35 && !isFinished) {
        const pulse = Math.sin(currentTime * 0.007) * 0.5 + 0.5;
        const grad = ctx.createRadialGradient(width / 2, height / 2, width * 0.25, width / 2, height / 2, width * 0.7);
        grad.addColorStop(0, "rgba(239, 68, 68, 0)");
        grad.addColorStop(1, `rgba(239, 68, 68, ${0.15 + pulse * 0.22})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // 环绕元素法球
      if (p.element) {
        const orbitSpeed = currentTime * 0.003;
        const orbitRadius = 48;
        const elemColor = p.element === "fire" ? "#f97316" : p.element === "poison" ? "#22c55e" : p.element === "lightning" ? "#0284c7" : "#06b6d4";
        const elemIcon = p.element === "fire" ? "🔥" : p.element === "poison" ? "🧪" : p.element === "lightning" ? "⚡" : "❄️";

        for (let i = 0; i < 2; i++) {
          const angle = orbitSpeed + i * Math.PI;
          const fx = p.x + Math.cos(angle) * orbitRadius;
          const fy = p.y + Math.sin(angle) * orbitRadius;

          ctx.save();
          ctx.translate(fx, fy);
          ctx.beginPath();
          ctx.arc(0, 0, 11, 0, Math.PI * 2);
          ctx.fillStyle = elemColor;
          ctx.shadowColor = elemColor;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = "11px sans-serif";
          ctx.fillText(elemIcon, -6, 4);
          ctx.restore();

          zombiesRef.current.forEach((z) => {
            if (Math.hypot(z.x - fx, z.y - fy) < z.radius + 14) {
              z.hp -= 120 * dt;
              if (p.element === "ice") z.frozenTimer = 1.0;
            }
          });
        }
      }

      // 粒子
      particlesRef.current.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = pt.life / pt.maxLife;
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      // 战斗飘字
      floatTextsRef.current.forEach((ft) => {
        ctx.save();
        ctx.fillStyle = ft.color;
        ctx.font = ft.isCrit ? "900 15px sans-serif" : "bold 12px sans-serif";
        ctx.shadowColor = "#000000";
        ctx.shadowBlur = 6;
        ctx.globalAlpha = ft.life / ft.maxLife;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      });

      // 虚拟摇杆
      if (touchJoystickRef.current?.active) {
        const tj = touchJoystickRef.current;
        ctx.beginPath();
        ctx.arc(tj.startX, tj.startY, 40, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(tj.currX, tj.currY, 18, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(56, 189, 248, 0.7)";
        ctx.fill();
      }

      ctx.restore();
      } catch (loopErr) {
        console.error("Game loop error:", loopErr);
      } finally {
        animationFrameId = requestAnimationFrame(gameLoop);
      }
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isElementalChoose, isFinished, triggerScreenShake]);

  // 游戏结算
  const handleFinish = () => {
    soundRef.current.playVictory();
    const calculatedExp = Math.min(2500, Math.max(500, Math.round(score / 8) + kills * 12));
    onFinish(score, calculatedExp);
    onClose();
  };

  const handleBackToPhone = () => {
    soundRef.current.playVictory();
    const calculatedExp = Math.min(2500, Math.max(500, Math.round(score / 8) + kills * 12));
    onFinish(score, calculatedExp);
    if (onBackToPhone) {
      onBackToPhone();
    } else {
      onClose();
    }
  };

  const handleRestart = () => {
    setScore(0);
    setKills(0);
    setLevel(1);
    setSunExp(0);
    setSunNext(120);
    setHp(100);
    setShield(0);
    setEnergyBeans(1);
    setIsUltimate(false);
    setElapsedTime(0);
    setBossHp(null);
    setBossMaxHp(null);
    setCurrentBossLevel(1);
    setPlantStage(1);
    setElementalType(null);
    setIsElementalChoose(false);
    setIsFinished(false);
    setIsVictory(false);
    bulletsRef.current = [];
    zombiesRef.current = [];
    sunDropsRef.current = [];
    floatTextsRef.current = [];
    particlesRef.current = [];
    lightningRef.current = [];
    shockwavesRef.current = [];
    bossSpawnedRef.current = false;
    gameTimeRef.current = 0;
    killsCountRef.current = 0;
    nextBossTimeRef.current = 45;
    nextBossKillsRef.current = 45;
    bossLevelRef.current = 1;
    activeBossRef.current = false;
    playerRef.current.x = 180;
    playerRef.current.y = 320;
    playerRef.current.hp = 100;
    playerRef.current.shield = 0;
    playerRef.current.energyBeans = 1;
    playerRef.current.isUltimate = false;
    playerRef.current.recoil = 0;
    playerRef.current.invulnerableTimer = 0;
    playerRef.current.emergencyShieldUsed = false;
    playerRef.current.stage = 1;
    playerRef.current.element = null;
    playerRef.current.extraAtkBonus = 0;
    playerRef.current.level = 1;
    playerRef.current.sunExp = 0;
    playerRef.current.sunNext = 120;
  };

  const currentStageInfo = PLANT_STAGE_INFO[plantStage] || PLANT_STAGE_INFO[1];
  const currentElem = ELEMENTAL_OPTIONS.find((e) => e.type === elementalType);
  const currentStageName = currentElem
    ? isEn
      ? currentElem.nameEn
      : isTw
      ? currentElem.nameTw
      : currentElem.name
    : isEn
    ? currentStageInfo.nameEn
    : isTw
    ? currentStageInfo.nameTw
    : currentStageInfo.name;
  const currentStageIcon = currentElem ? currentElem.icon : currentStageInfo.icon;

  return (
    <div ref={containerRef} className="saki-plant-slayer-container">
      {/* Top HUD */}
      <div className="plant-hud-top">
        <div className="hud-left">
          <button
            type="button"
            className="plant-icon-btn"
            onClick={onBackToPhone || onClose}
            title={isEn ? "Exit" : isTw ? "退出" : "退出"}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="plant-bars-group">
            {/* HP Bar */}
            <div className="plant-hud-bar hp">
              <Heart size={10} className="fill-rose-500 text-rose-400" />
              <div className="bar-track">
                <div className="bar-fill hp-fill" style={{ width: `${(hp / maxHp) * 100}%` }} />
              </div>
              <span className="bar-val">{hp}</span>
            </div>
            {/* Sun EXP Bar */}
            <div className="plant-hud-bar exp">
              <Zap size={10} className="fill-emerald-400 text-emerald-300" />
              <div className="bar-track">
                <div className="bar-fill exp-fill" style={{ width: `${Math.min(100, (sunExp / sunNext) * 100)}%` }} />
              </div>
              <span className="bar-val">Lv.{level}</span>
            </div>
          </div>
        </div>

        <div className="hud-center">
          {/* Plant Evolution Stage Badge */}
          <div className={`plant-stage-badge stage-${plantStage} ${elementalType || ""}`}>
            <span>{currentStageIcon}</span>
            <span>{currentStageName}</span>
          </div>

          <span className="plant-kills-pill">
            <Skull size={12} className="text-rose-400" />
            <span>{kills}</span>
          </span>
          <span className="plant-score-pill">
            <Trophy size={12} className="text-amber-400" />
            <span>{score}</span>
          </span>
        </div>

        <div className="hud-right">
          {/* Extract & Settle Run Button */}
          <button
            type="button"
            className="plant-extract-btn"
            onClick={() => {
              setIsVictory(true);
              setIsFinished(true);
            }}
            title={isEn ? "Extract & Settle" : isTw ? "撤離結算" : "撤离结算"}
          >
            <span>🏁</span>
            <span>{isEn ? "Extract" : isTw ? "撤離" : "撤离"}</span>
          </button>

          <button
            type="button"
            className="plant-icon-btn"
            onClick={() => {
              const n = !isMuted;
              setIsMuted(n);
              soundRef.current.setMuted(n);
            }}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* Boss Health Bar (When Boss Active) */}
      {bossHp !== null && bossMaxHp !== null ? (
        <div className="plant-boss-bar-wrap">
          <div className="boss-title">
            <span>
              ⚠️ {isEn ? `TITAN MECH GARGANTUAR MK.${currentBossLevel}` : isTw ? `毀滅泰坦機甲巨人 MK.${currentBossLevel}` : `毁灭泰坦机甲巨人 MK.${currentBossLevel}`}
            </span>
            <span>{Math.round((bossHp / bossMaxHp) * 100)}%</span>
          </div>
          <div className="boss-bar-track">
            <div className="boss-bar-fill" style={{ width: `${(bossHp / bossMaxHp) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {/* Kill Streak Announcement Toast */}
      {comboText ? (
        <div className="plant-combo-banner animate-bounce">
          <span>{comboText}</span>
        </div>
      ) : null}

      {/* Saki Voice Speech Bubble */}
      {sakiShout ? (
        <div className="plant-saki-bubble">
          <img src="/assets/expression/happy.webp" alt="Saki" className="bubble-saki-avatar" />
          <span>{sakiShout}</span>
        </div>
      ) : null}

      {/* Main Game Canvas */}
      <canvas
        ref={canvasRef}
        width={360}
        height={620}
        className="plant-slayer-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Energy Bean Ultimate Action Button (Bottom Right) */}
      <div className="plant-ultimate-wrap">
        <button
          type="button"
          className={`plant-bean-btn ${energyBeans > 0 ? "ready" : "empty"} ${isUltimate ? "active" : ""}`}
          onClick={(e) => triggerPlantFoodUltimate(e)}
          onPointerDown={(e) => e.stopPropagation()}
          title={isEn ? "Plant Food Ultimate (Space / Q)" : isTw ? "能量豆大招 (空格鍵 / Q)" : "能量豆大招 (空格键 / Q)"}
        >
          <div className="bean-inner">
            <span className="bean-emoji">🌟</span>
            <span className="bean-count">{energyBeans}/3</span>
          </div>
          <div className="bean-pulse" aria-hidden="true" />
        </button>
      </div>

      {/* Level 6 Elemental Specialization Modal */}
      {isElementalChoose ? (
        <div className="plant-modal-backdrop">
          <div className="plant-levelup-card elemental-modal-card">
            <div className="levelup-header">
              <Sparkles className="text-amber-300" size={24} />
              <h2>{isEn ? "ULTIMATE ELEMENTAL SPECIALIZATION" : isTw ? "終極元素覺醒！選擇超級機槍形態" : "终极元素觉醒！选择超级机枪形态"}</h2>
            </div>
            <p className="elemental-subtitle">
              {isEn
                ? "Choose one elemental path to awaken your Super Gatling Pea:"
                : isTw
                ? "為超級機槍射手選擇一項終極元素覺醒形態："
                : "为超级机枪射手选择一项终极元素觉醒形态："}
            </p>
            <div className="upgrade-cards-list">
              {ELEMENTAL_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  className={`upgrade-item-card elemental-choice-btn elem-${opt.type}`}
                  style={{ borderColor: opt.color }}
                  onClick={() => handleSelectElement(opt.type)}
                >
                  <div className="upgrade-icon-wrap" style={{ background: opt.color, boxShadow: `0 0 14px ${opt.glow}` }}>
                    <span>{opt.icon}</span>
                  </div>
                  <div className="upgrade-content">
                    <div className="upgrade-title-row">
                      <span className="upgrade-name" style={{ color: opt.color }}>{isEn ? opt.nameEn : isTw ? opt.nameTw : opt.name}</span>
                      <span className="upgrade-lvl">AWAKEN</span>
                    </div>
                    <p className="upgrade-desc">{isEn ? opt.descEn : isTw ? opt.descTw : opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Settlement Screen (Victory or Game Over) */}
      {isFinished ? (
        <div className="plant-modal-backdrop">
          <div className="saki-sweet-match-settlement-card">
            <div className="settlement-header">
              <Trophy size={28} className="settlement-trophy" />
              <h3>{isVictory ? (isEn ? "VICTORY! ZOMBIES SLAIN!" : isTw ? "大獲全勝！殭屍全滅！" : "大获全胜！僵尸全灭！") : (isEn ? "MISSION COMPLETE" : isTw ? "特攻任務結算" : "特攻任务结算")}</h3>
            </div>

            <div className="settlement-score-hero">
              <span className="score-num">{score}</span>
              <span className="score-label">{isEn ? "SCORE" : isTw ? "作戰評分" : "作战评分"}</span>
            </div>

            <div className="settlement-stats-grid">
              <div className="settlement-stat-card score-card">
                <div className="stat-card-header">
                  <span className="stat-icon">💀</span>
                  <span className="stat-label">{isEn ? "Kills" : isTw ? "殲滅殭屍" : "歼灭僵尸"}</span>
                </div>
                <div className="stat-card-val score-val">{kills}</div>
              </div>

              <div className="settlement-stat-card exp-card">
                <div className="stat-card-header">
                  <span className="stat-icon">💖</span>
                  <span className="stat-label">{isEn ? "Affection EXP" : isTw ? "好感度獎勵" : "好感度奖励"}</span>
                </div>
                <div className="stat-card-val exp-val">+{Math.min(2500, Math.max(500, Math.round(score / 8) + kills * 12))}</div>
              </div>

              <div className="settlement-stat-card combo-card">
                <div className="stat-card-header">
                  <span className="stat-icon">⏱️</span>
                  <span className="stat-label">{isEn ? "Time" : isTw ? "作戰時長" : "作战时长"}</span>
                </div>
                <div className="stat-card-val combo-val">{Math.round(elapsedTime)}s</div>
              </div>
            </div>

            {/* Polished Saki Speech Reaction with Halo & Expression */}
            <div className="settlement-saki-speech">
              <img
                src={isVictory ? "/assets/expression/happy.webp" : "/assets/expression/surprised.webp"}
                alt="Saki"
                className="settlement-saki-avatar"
              />
              <p>
                {isVictory
                  ? isEn
                    ? "Incredible! Saki saw your electric gatling wipe out the whole horde! Master is invincible! ✨"
                    : isTw
                    ? "太厲害啦！Saki 看見主人的電能機槍把泰坦機甲都融化了，好帥氣呀～✨"
                    : "太厉害啦！Saki 看见主人的电能机枪把泰坦机甲都融化了，好帅气呀～✨"
                  : isEn
                  ? "Great battle! The zombie horde was huge, but we harvested tons of sun and data! Let's play again! 💖"
                  : isTw
                  ? "辛苦啦主人！剛才的割草彈幕好過癮，Saki 為你準備了滿滿的好感度獎勵唷～💖"
                  : "辛苦啦主人！刚才的割草弹幕好过瘾，Saki 为你准备了满满的好感度奖励唷～💖"}
              </p>
            </div>

            <button type="button" className="saki-settlement-btn" onClick={handleFinish}>
              <Sparkles size={16} className="btn-icon" />
              <span>{isEn ? "Claim Rewards & Complete" : isTw ? "領取獎勵並完成" : "领取奖励并完成"}</span>
              <div className="btn-shine" aria-hidden="true" />
            </button>

            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button
                type="button"
                className="saki-phone-exit-btn saki-settlement-restart-btn"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={handleRestart}
              >
                <RotateCcw size={14} />
                <span>{isEn ? "Restart" : isTw ? "再來一局" : "再来一局"}</span>
              </button>

              {onBackToPhone ? (
                <button
                  type="button"
                  className="saki-phone-exit-btn saki-settlement-back-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={handleBackToPhone}
                >
                  <ArrowLeft size={14} />
                  <span>{isEn ? "Back to Phone" : isTw ? "返回手機" : "返回手机"}</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
