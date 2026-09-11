import React, { useEffect, useRef, useState, useCallback } from "react";
import { Sparkles, Trophy, Volume2, VolumeX, X, ArrowLeft, RotateCcw, Zap, Bomb, Hammer, Shuffle, Clock } from "lucide-react";
import { usePanelLanguage } from "../../../i18n/index.js";

interface SakiSweetMatchGameProps {
  onClose: () => void;
  onFinish: (score: number, expReward: number) => void;
  onBackToPhone?: () => void;
}

type GemType = "star" | "strawberry" | "donut" | "boba" | "prism" | "lightning" | "bomb" | "rainbow";

interface MatchTile {
  id: number;
  type: GemType;
  isMatching?: boolean | undefined;
}

interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  rating?: string | undefined;
  color: string;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  size: number;
}

interface Shockwave {
  id: number;
  x: number;
  y: number;
}

const NORMAL_GEMS: GemType[] = ["star", "strawberry", "donut", "boba", "prism"];

const GEM_ICONS: Record<GemType, string> = {
  star: "/assets/game/star.webp",
  strawberry: "/assets/game/caomeidafu.webp",
  donut: "/assets/game/donut.webp",
  boba: "/assets/game/naicha.webp",
  prism: "/assets/game/match/gem_prism.webp",
  lightning: "/assets/game/match/gem_lightning.webp",
  bomb: "/assets/game/match/gem_bomb.webp",
  rainbow: "/assets/game/match/gem_rainbow.webp"
};

const GEM_NAMES: Record<GemType, string> = {
  star: "心愿星",
  strawberry: "草莓大福",
  donut: "甜甜圈",
  boba: "珍珠奶茶",
  prism: "星钻棱镜",
  lightning: "闪电宝石",
  bomb: "甜蜜炸弹",
  rainbow: "彩虹愿望星"
};

class MatchSoundFX {
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

  public playSelect() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.exponentialRampToValueAtTime(900, t + 0.05);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch {}
  }

  public playSwap() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(480, t + 0.08);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    } catch {}
  }

  public playPop(combo: number) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const baseNotes = [440, 493.88, 554.37, 587.33, 659.25, 739.99, 830.61, 880, 987.77, 1108.73];
      const freq = baseNotes[Math.min(combo, baseNotes.length - 1)] ?? 440;

      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.08);

      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 2, t);
      osc2.frequency.exponentialRampToValueAtTime(freq * 2.2, t + 0.06);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc2.start(t);
      osc.stop(t + 0.15);
      osc2.stop(t + 0.15);
    } catch {}
  }

  public playBomb() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.35);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    } catch {}
  }

  public playLightning() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(850, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.25);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.28);
    } catch {}
  }

  public playRainbow() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51, 1567.98];
      notes.forEach((freq, i) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t + i * 0.03);
        gain.gain.setValueAtTime(0, t + i * 0.03);
        gain.gain.linearRampToValueAtTime(0.15, t + i * 0.03 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.03 + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(t + i * 0.03);
        osc.stop(t + i * 0.03 + 0.28);
      });
    } catch {}
  }

  public playHammer() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(360, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      gain.gain.setValueAtTime(0.32, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);

      const chime = this.ctx.createOscillator();
      const cGain = this.ctx.createGain();
      chime.type = "triangle";
      chime.frequency.setValueAtTime(1100, t);
      chime.frequency.exponentialRampToValueAtTime(600, t + 0.15);
      cGain.gain.setValueAtTime(0.2, t);
      cGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      chime.connect(cGain);
      cGain.connect(this.ctx.destination);
      chime.start(t);
      chime.stop(t + 0.2);
    } catch {}
  }

  public playShuffle() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(260, t);
      osc.frequency.exponentialRampToValueAtTime(750, t + 0.22);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    } catch {}
  }

  public playVictory() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const melody = [
        { f: 523.25, time: 0, dur: 0.12 },
        { f: 659.25, time: 0.12, dur: 0.12 },
        { f: 783.99, time: 0.24, dur: 0.15 },
        { f: 1046.5, time: 0.4, dur: 0.45 }
      ];
      melody.forEach((m) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(m.f, t + m.time);
        gain.gain.setValueAtTime(0.2, t + m.time);
        gain.gain.exponentialRampToValueAtTime(0.001, t + m.time + m.dur);
        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(t + m.time);
        osc.stop(t + m.time + m.dur + 0.02);
      });
    } catch {}
  }
}

const ROWS = 7;
const COLS = 7;

function createRandomGem(): GemType {
  const r = Math.floor(Math.random() * NORMAL_GEMS.length);
  return NORMAL_GEMS[r] ?? "star";
}

function createInitialBoard(): MatchTile[][] {
  let board: MatchTile[][] = [];
  let idCounter = 1;

  for (let r = 0; r < ROWS; r++) {
    board[r] = [];
    for (let c = 0; c < COLS; c++) {
      let gem: GemType;
      do {
        gem = createRandomGem();
      } while (
        (r >= 2 && board[r - 1]?.[c]?.type === gem && board[r - 2]?.[c]?.type === gem) ||
        (c >= 2 && board[r]?.[c - 1]?.type === gem && board[r]?.[c - 2]?.type === gem)
      );
      board[r]![c] = { id: idCounter++, type: gem };
    }
  }
  return board;
}

export function SakiSweetMatchGame({ onClose, onFinish, onBackToPhone }: SakiSweetMatchGameProps) {
  const { language } = usePanelLanguage();
  const isEn = language === "en-US";
  const isTw = language === "zh-TW";
  const isJa = language === "ja-JP";
  const [board, setBoard] = useState<MatchTile[][]>(() => createInitialBoard());
  const [selectedPos, setSelectedPos] = useState<{ r: number; c: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [gameOver, setGameOver] = useState(false);
  const [shakeMode, setShakeMode] = useState<"none" | "mild" | "intense">("none");

  // Boosters Charges
  const [hammerCharges, setHammerCharges] = useState(3);
  const [shuffleCharges, setShuffleCharges] = useState(2);
  const [timeCharges, setTimeCharges] = useState(1);
  const [isHammerActive, setIsHammerActive] = useState(false);

  const [floatTexts, setFloatTexts] = useState<FloatText[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [shockwaves, setShockwaves] = useState<Shockwave[]>([]);
  const [activeBeams, setActiveBeams] = useState<{ id: number; r?: number | undefined; c?: number | undefined }[]>([]);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem("saki_game_sound_muted") === "true";
    } catch {
      return false;
    }
  });

  const soundFxRef = useRef<MatchSoundFX>(new MatchSoundFX());
  const boardRef = useRef<MatchTile[][]>(board);
  boardRef.current = board;
  const isGameOverRef = useRef(false);
  isGameOverRef.current = gameOver;
  const comboRef = useRef(0);
  const idGenRef = useRef(1000);

  useEffect(() => {
    soundFxRef.current.setMuted(soundMuted);
  }, [soundMuted]);

  useEffect(() => {
    if (gameOver) {
      soundFxRef.current.playVictory();
      try {
        const prevBest = Number(localStorage.getItem("saki_match_high_score") || "0");
        if (score > prevBest) {
          localStorage.setItem("saki_match_high_score", String(score));
        }
      } catch {}
    }
  }, [gameOver, score]);

  // Round Timer
  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setGameOver(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameOver]);

  // Clean float texts
  useEffect(() => {
    if (floatTexts.length === 0) return;
    const t = setTimeout(() => {
      setFloatTexts((prev) => prev.slice(1));
    }, 850);
    return () => clearTimeout(t);
  }, [floatTexts]);

  const triggerShake = (intensity: "mild" | "intense") => {
    setShakeMode(intensity);
    setTimeout(() => setShakeMode("none"), intensity === "intense" ? 350 : 220);
  };

  const isFeverMode = combo >= 5;

  const spawnParticles = useCallback((xPercent: number, yPercent: number, color: string, count: number = 10) => {
    const newParts: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 3.5 + 1.8;
      newParts.push({
        id: Date.now() + Math.random(),
        x: xPercent,
        y: yPercent,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        life: 1,
        size: Math.random() * 7 + 4
      });
    }
    setParticles((prev) => [...prev.slice(-30), ...newParts]);
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParts.some((np) => np.id === p.id)));
    }, 450);
  }, []);

  const spawnShockwave = (xPercent: number, yPercent: number) => {
    const sw: Shockwave = { id: Date.now() + Math.random(), x: xPercent, y: yPercent };
    setShockwaves((prev) => [...prev.slice(-3), sw]);
    setTimeout(() => {
      setShockwaves((prev) => prev.filter((item) => item.id !== sw.id));
    }, 480);
  };

  // Find all horizontal and vertical matches
  const checkMatches = useCallback((b: MatchTile[][]) => {
    const matchedCoords: Set<string> = new Set();
    const matchGroups: { coords: [number, number][]; type: GemType; isCross?: boolean }[] = [];

    // Horizontal runs
    for (let r = 0; r < ROWS; r++) {
      let matchLen = 1;
      for (let c = 0; c < COLS; c++) {
        const cur = b[r]?.[c]?.type;
        const next = b[r]?.[c + 1]?.type;
        if (cur && cur === next && !cur.startsWith("lightning") && !cur.startsWith("bomb") && !cur.startsWith("rainbow")) {
          matchLen++;
        } else {
          if (matchLen >= 3 && cur) {
            const groupCoords: [number, number][] = [];
            for (let k = 0; k < matchLen; k++) {
              const coord: [number, number] = [r, c - k];
              groupCoords.push(coord);
              matchedCoords.add(`${r},${c - k}`);
            }
            matchGroups.push({ coords: groupCoords, type: cur });
          }
          matchLen = 1;
        }
      }
    }

    // Vertical runs
    for (let c = 0; c < COLS; c++) {
      let matchLen = 1;
      for (let r = 0; r < ROWS; r++) {
        const cur = b[r]?.[c]?.type;
        const next = b[r + 1]?.[c]?.type;
        if (cur && cur === next && !cur.startsWith("lightning") && !cur.startsWith("bomb") && !cur.startsWith("rainbow")) {
          matchLen++;
        } else {
          if (matchLen >= 3 && cur) {
            const groupCoords: [number, number][] = [];
            for (let k = 0; k < matchLen; k++) {
              const coord: [number, number] = [r - k, c];
              groupCoords.push(coord);
              matchedCoords.add(`${r - k},${c}`);
            }
            matchGroups.push({ coords: groupCoords, type: cur });
          }
          matchLen = 1;
        }
      }
    }

    return { matchedCoords, matchGroups };
  }, []);

  // Process Match Resolution & Cascade
  const resolveBoard = useCallback(
    async (
      initialBoard: MatchTile[][],
      specialActions: { type: "lightning" | "bomb" | "rainbow" | "hammer"; r: number; c: number; targetColor?: GemType }[] = []
    ) => {
      setIsProcessing(true);
      let curBoard = initialBoard.map((row) => row.map((tile) => ({ ...tile })));
      let hasMatches = true;
      let cascadeCount = 0;

      while (hasMatches) {
        if (isGameOverRef.current) break;

        const { matchedCoords, matchGroups } = checkMatches(curBoard);
        const clearSet = new Set(matchedCoords);
        const newSpecialSpawns: { r: number; c: number; type: GemType }[] = [];

        // Apply special actions from clicks/swaps
        for (const sa of specialActions) {
          const fx = (sa.c / COLS) * 100 + 7;
          const fy = (sa.r / ROWS) * 100 + 7;

          if (sa.type === "hammer") {
            soundFxRef.current.playHammer();
            triggerShake("intense");
            spawnShockwave(fx, fy);
            spawnParticles(fx, fy, "#fbbf24", 26);

            const clickedTile = curBoard[sa.r]?.[sa.c];
            if (clickedTile?.type === "bomb") {
              // Direct Detonation: Sweet Bomb
              soundFxRef.current.playBomb();
              for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                  const tr = sa.r + dr;
                  const tc = sa.c + dc;
                  if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS) {
                    clearSet.add(`${tr},${tc}`);
                  }
                }
              }
            } else if (clickedTile?.type === "lightning") {
              // Direct Detonation: Lightning Gem
              soundFxRef.current.playLightning();
              for (let cc = 0; cc < COLS; cc++) clearSet.add(`${sa.r},${cc}`);
              for (let rr = 0; rr < ROWS; rr++) clearSet.add(`${rr},${sa.c}`);
              const beamId = Date.now();
              setActiveBeams((prev) => [...prev, { id: beamId, r: sa.r, c: sa.c }]);
              setTimeout(() => {
                setActiveBeams((prev) => prev.filter((bm) => bm.id !== beamId));
              }, 350);
            } else if (clickedTile?.type === "rainbow") {
              // Direct Detonation: Rainbow Wish Star on most prominent color
              soundFxRef.current.playRainbow();
              const colorCounts: Partial<Record<GemType, number>> = {};
              for (let rr = 0; rr < ROWS; rr++) {
                for (let cc = 0; cc < COLS; cc++) {
                  const t = curBoard[rr]?.[cc]?.type;
                  if (t && t !== "bomb" && t !== "lightning" && t !== "rainbow") {
                    colorCounts[t] = (colorCounts[t] || 0) + 1;
                  }
                }
              }
              let bestColor: GemType = "star";
              let maxC = 0;
              for (const [col, count] of Object.entries(colorCounts)) {
                if ((count as number) > maxC) {
                  maxC = count as number;
                  bestColor = col as GemType;
                }
              }
              for (let rr = 0; rr < ROWS; rr++) {
                for (let cc = 0; cc < COLS; cc++) {
                  if (curBoard[rr]?.[cc]?.type === bestColor) {
                    clearSet.add(`${rr},${cc}`);
                  }
                }
              }
              clearSet.add(`${sa.r},${sa.c}`);
            } else {
              // Targeted smash on regular gem
              clearSet.add(`${sa.r},${sa.c}`);
            }

            // Reward bonus points and time
            setScore((s) => s + 500);
            setTimeLeft((t) => Math.min(60, t + 2));
            setFloatTexts((prev) => [
              ...prev.slice(-4),
              {
                id: Date.now() + Math.random(),
                x: fx,
                y: fy,
                text: "+500",
                rating: isEn ? "HAMMER SMASH! 🔨" : isTw ? "星錘粉碎! 🔨" : isJa ? "ハンマースマッシュ! 🔨" : "星锤粉碎! 🔨",
                color: "#fbbf24"
              }
            ]);
          } else if (sa.type === "lightning") {
            soundFxRef.current.playLightning();
            triggerShake("intense");
            // Clear entire row and column
            for (let cc = 0; cc < COLS; cc++) clearSet.add(`${sa.r},${cc}`);
            for (let rr = 0; rr < ROWS; rr++) clearSet.add(`${rr},${sa.c}`);
            const beamId = Date.now();
            setActiveBeams((prev) => [...prev, { id: beamId, r: sa.r, c: sa.c }]);
            spawnParticles(fx, fy, "#38bdf8", 14);
            setTimeout(() => {
              setActiveBeams((prev) => prev.filter((bm) => bm.id !== beamId));
            }, 350);
          } else if (sa.type === "bomb") {
            soundFxRef.current.playBomb();
            triggerShake("intense");
            spawnShockwave(fx, fy);
            spawnParticles(fx, fy, "#f43f5e", 18);
            // 3x3 blast around sa.r, sa.c
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const tr = sa.r + dr;
                const tc = sa.c + dc;
                if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS) {
                  clearSet.add(`${tr},${tc}`);
                }
              }
            }
          } else if (sa.type === "rainbow" && sa.targetColor) {
            soundFxRef.current.playRainbow();
            triggerShake("intense");
            spawnShockwave(fx, fy);
            spawnParticles(fx, fy, "#fef08a", 20);
            for (let rr = 0; rr < ROWS; rr++) {
              for (let cc = 0; cc < COLS; cc++) {
                if (curBoard[rr]?.[cc]?.type === sa.targetColor) {
                  clearSet.add(`${rr},${cc}`);
                }
              }
            }
            clearSet.add(`${sa.r},${sa.c}`);
          }
        }
        specialActions = []; // only apply once

        // 特殊道具生成：4连=闪电，5连直线=彩虹星，其他>=5连=炸弹
        for (const mg of matchGroups) {
          if (mg.coords.length === 4) {
            const pivot = mg.coords[1] ?? mg.coords[0]!;
            newSpecialSpawns.push({ r: pivot[0], c: pivot[1], type: "lightning" });
            clearSet.delete(`${pivot[0]},${pivot[1]}`);
          } else if (mg.coords.length >= 5) {
            const pivot = mg.coords[2] ?? mg.coords[0]!;
            const r0 = mg.coords[0]![0];
            const isStraightLine = mg.coords.every((c) => c[0] === r0);
            const typeToSpawn = isStraightLine ? "rainbow" : "bomb";
            newSpecialSpawns.push({ r: pivot[0], c: pivot[1], type: typeToSpawn });
            clearSet.delete(`${pivot[0]},${pivot[1]}`);
          }
        }

        if (clearSet.size === 0) {
          hasMatches = false;
          break;
        }

        cascadeCount++;
        comboRef.current++;
        setCombo(comboRef.current);
        setMaxCombo((prev) => Math.max(prev, comboRef.current));

        soundFxRef.current.playPop(comboRef.current);
        if (comboRef.current >= 3) {
          triggerShake("mild");
        }

        const earnedPoints = clearSet.size * 35 * (comboRef.current >= 5 ? 2 : 1) * Math.min(cascadeCount, 5);
        setScore((s) => s + earnedPoints);

        if (clearSet.size >= 4) {
          setTimeLeft((t) => Math.min(60, t + 2));
        }

        // Float text
        const sampleCoord = Array.from(clearSet)[0]?.split(",").map(Number);
        if (sampleCoord && sampleCoord[0] !== undefined && sampleCoord[1] !== undefined) {
          const fx = (sampleCoord[1] / COLS) * 100 + 7;
          const fy = (sampleCoord[0] / ROWS) * 100 + 7;
          const rating =
            comboRef.current >= 6
              ? "SUPERNOVA!"
              : comboRef.current >= 4
              ? "PERFECT!"
              : comboRef.current >= 2
              ? "GREAT!"
              : undefined;

          setFloatTexts((prev) => [
            ...prev.slice(-4),
            {
              id: Date.now() + Math.random(),
              x: fx,
              y: fy,
              text: `+${earnedPoints}`,
              rating,
              color: comboRef.current >= 5 ? "#fbbf24" : "#ff75ac"
            }
          ]);
          spawnParticles(fx, fy, "#fef08a", 10);
        }

        // Mark tiles as matching for explode animation
        curBoard = curBoard.map((row, r) =>
          row.map((tile, c) => ({
            ...tile,
            isMatching: clearSet.has(`${r},${c}`)
          }))
        );
        setBoard([...curBoard.map((r) => [...r])]);

        await new Promise((res) => setTimeout(res, 220));

        // Gravity Drop
        const nextBoard: MatchTile[][] = [];
        for (let r = 0; r < ROWS; r++) nextBoard[r] = [];

        for (let c = 0; c < COLS; c++) {
          const survivingTiles: MatchTile[] = [];
          for (let r = ROWS - 1; r >= 0; r--) {
            if (!clearSet.has(`${r},${c}`)) {
              survivingTiles.push({ ...curBoard[r]![c]!, isMatching: false });
            }
          }

          let targetR = ROWS - 1;
          for (const tile of survivingTiles) {
            nextBoard[targetR]![c] = tile;
            targetR--;
          }

          while (targetR >= 0) {
            nextBoard[targetR]![c] = {
              id: ++idGenRef.current,
              type: createRandomGem(),
              isMatching: false
            };
            targetR--;
          }
        }

        // Apply newly generated special items
        for (const sp of newSpecialSpawns) {
          nextBoard[sp.r]![sp.c] = {
            id: ++idGenRef.current,
            type: sp.type,
            isMatching: false
          };
        }

        curBoard = nextBoard;
        setBoard([...curBoard.map((r) => [...r])]);

        await new Promise((res) => setTimeout(res, 180));
      }

      setIsProcessing(false);
      setTimeout(() => {
        if (!isProcessing) {
          comboRef.current = 0;
          setCombo(0);
        }
      }, 1400);
    },
    [checkMatches, isProcessing, spawnParticles]
  );

  // Handle Tile Click / Selection / Hammer
  const handleTileClick = async (r: number, c: number) => {
    if (isProcessing || gameOver) return;
    soundFxRef.current.init();

    // If Hammer booster is active
    if (isHammerActive) {
      if (hammerCharges <= 0) {
        setIsHammerActive(false);
        return;
      }
      setHammerCharges((ch) => ch - 1);
      setIsHammerActive(false);
      setSelectedPos(null);

      await resolveBoard(board, [{ type: "hammer", r, c }]);
      return;
    }

    const clickedTile = board[r]?.[c];
    if (!clickedTile) return;

    // Direct click on special powerups
    if (clickedTile.type === "bomb") {
      await resolveBoard(board, [{ type: "bomb", r, c }]);
      setSelectedPos(null);
      return;
    }
    if (clickedTile.type === "lightning") {
      await resolveBoard(board, [{ type: "lightning", r, c }]);
      setSelectedPos(null);
      return;
    }

    if (!selectedPos) {
      soundFxRef.current.playSelect();
      setSelectedPos({ r, c });
      return;
    }

    const { r: r1, c: c1 } = selectedPos;
    if (r1 === r && c1 === c) {
      setSelectedPos(null);
      return;
    }

    const isAdjacent = Math.abs(r1 - r) + Math.abs(c1 - c) === 1;
    if (!isAdjacent) {
      soundFxRef.current.playSelect();
      setSelectedPos({ r, c });
      return;
    }

    soundFxRef.current.playSwap();
    setSelectedPos(null);

    const tile1 = board[r1]![c1]!;
    const tile2 = board[r]![c]!;

    // Rainbow swap
    if (tile1.type === "rainbow" || tile2.type === "rainbow") {
      const rainbowPos = tile1.type === "rainbow" ? { r: r1, c: c1 } : { r, c };
      const targetColor = tile1.type === "rainbow" ? tile2.type : tile1.type;
      await resolveBoard(board, [{ type: "rainbow", r: rainbowPos.r, c: rainbowPos.c, targetColor }]);
      return;
    }

    // Bomb swap
    if (tile1.type === "bomb" || tile2.type === "bomb") {
      const bombPos = tile1.type === "bomb" ? { r: r1, c: c1 } : { r, c };
      await resolveBoard(board, [{ type: "bomb", r: bombPos.r, c: bombPos.c }]);
      return;
    }

    // Lightning swap
    if (tile1.type === "lightning" || tile2.type === "lightning") {
      const lightningPos = tile1.type === "lightning" ? { r: r1, c: c1 } : { r, c };
      await resolveBoard(board, [{ type: "lightning", r: lightningPos.r, c: lightningPos.c }]);
      return;
    }

    // Regular Swap test
    const testBoard = board.map((row) => row.map((tile) => ({ ...tile })));
    testBoard[r1]![c1] = { ...tile2, id: tile1.id };
    testBoard[r]![c] = { ...tile1, id: tile2.id };

    const { matchedCoords } = checkMatches(testBoard);

    if (matchedCoords.size > 0) {
      setBoard(testBoard);
      await resolveBoard(testBoard);
    } else {
      setBoard(testBoard);
      setTimeout(() => {
        setBoard(board);
      }, 160);
    }
  };

  // Booster: Shuffle Board
  const handleShuffle = () => {
    if (isProcessing || gameOver || shuffleCharges <= 0) return;
    setShuffleCharges((c) => c - 1);
    soundFxRef.current.playShuffle();
    triggerShake("mild");

    const flatGems: GemType[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        flatGems.push(board[r]![c]!.type);
      }
    }
    // Shuffle array
    for (let i = flatGems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = flatGems[i]!;
      flatGems[i] = flatGems[j]!;
      flatGems[j] = temp;
    }

    let idx = 0;
    const newBoard = board.map((row) =>
      row.map((tile) => ({
        id: ++idGenRef.current,
        type: flatGems[idx++]!
      }))
    );
    setBoard(newBoard);
    setSelectedPos(null);
  };

  // Booster: Time Watch (+10s)
  const handleAddTime = () => {
    if (isProcessing || gameOver || timeCharges <= 0) return;
    setTimeCharges((c) => c - 1);
    soundFxRef.current.playSelect();
    setTimeLeft((t) => t + 10);
    setFloatTexts((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        x: 50,
        y: 40,
        text: "+10s TIME!",
        rating: "EXTRA TIME",
        color: "#4ade80"
      }
    ]);
  };

  const handleRestart = () => {
    setBoard(createInitialBoard());
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setTimeLeft(60);
    setGameOver(false);
    setSelectedPos(null);
    setIsProcessing(false);
    setIsHammerActive(false);
    setHammerCharges(3);
    setShuffleCharges(2);
    setTimeCharges(1);
    comboRef.current = 0;
  };

  const expReward = Math.max(20, Math.round(score * 0.28));

  const handleFinish = () => {
    onFinish(score, expReward);
    onClose();
  };

  const handleBackToPhone = () => {
    onFinish(score, expReward);
    if (onBackToPhone) {
      onBackToPhone();
    } else {
      onClose();
    }
  };

  return (
    <div
      className={`saki-match-overlay ${isFeverMode ? "fever-active" : ""}`}
      style={{ backgroundImage: `url("/assets/game/match/match_bg.jpg")` }}
    >
      {!gameOver ? (
        <>
          {/* Game Header */}
          <div className="saki-match-header">
            <div className="saki-match-stats">
              <div className="saki-match-stat-item">
                <span className="saki-match-stat-label">倒计时</span>
                <span className="saki-match-stat-val timer">{timeLeft}s</span>
              </div>
              <div className="saki-match-stat-item">
                <span className="saki-match-stat-label">得分</span>
                <span className="saki-match-stat-val score">{score}</span>
              </div>
            </div>

            <div className="saki-match-header-actions">
              <button
                className="saki-match-btn-icon"
                type="button"
                title={soundMuted ? "开启音效" : "静音"}
                onClick={() => {
                  setSoundMuted((prev) => {
                    const next = !prev;
                    try {
                      localStorage.setItem("saki_game_sound_muted", String(next));
                    } catch {}
                    return next;
                  });
                }}
              >
                {soundMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>

              {onBackToPhone ? (
                <button
                  className="saki-match-btn-icon"
                  type="button"
                  title="返回手机应用"
                  onClick={onBackToPhone}
                >
                  <ArrowLeft size={14} />
                </button>
              ) : null}

              <button
                className="saki-match-btn-icon exit"
                type="button"
                title="退出游戏"
                onClick={onClose}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className={`saki-match-board-area ${shakeMode === "intense" ? "shaking-intense" : shakeMode === "mild" ? "shaking-mild" : ""} ${isHammerActive ? "hammer-mode" : ""}`}>
            {/* Hammer Targeting Hint Banner */}
            {isHammerActive ? (
              <div className="saki-match-hammer-hint">
                🔨 {isEn ? "Select any tile to smash and trigger combos!" : isTw ? "點擊任意方塊將其敲碎並觸發連鎖！" : isJa ? "好きなマスを選んで壊してコンボを決めよう！" : "点击任意方块将其敲碎并触发连锁！"}
              </div>
            ) : null}

            {/* Fever Banner */}
            {isFeverMode ? (
              <div className="saki-match-fever-banner">
                🔥 FEVER 狂欢 2X 得分!
              </div>
            ) : null}

            {/* Dynamic Combo Popup */}
            {combo >= 2 ? (
              <div key={combo} className="saki-match-combo-popup">
                <span className="combo-num">{combo}</span>
                <span className="combo-text">COMBO CHAIN</span>
              </div>
            ) : null}

            {/* Lightning Beams */}
            {activeBeams.map((bm) => (
              <React.Fragment key={bm.id}>
                {bm.r !== undefined ? (
                  <div
                    className="saki-lightning-beam-h"
                    style={{ top: `${(bm.r / ROWS) * 100 + 7}%` }}
                  />
                ) : null}
                {bm.c !== undefined ? (
                  <div
                    className="saki-lightning-beam-v"
                    style={{ left: `${(bm.c / COLS) * 100 + 7}%` }}
                  />
                ) : null}
              </React.Fragment>
            ))}

            {/* Bomb Shockwaves */}
            {shockwaves.map((sw) => (
              <div
                key={sw.id}
                className="saki-bomb-shockwave"
                style={{ left: `${sw.x}%`, top: `${sw.y}%` }}
              />
            ))}

            {/* Particle Bursts */}
            {particles.map((p) => (
              <div
                key={p.id}
                className="saki-game-particle star"
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  backgroundColor: p.color,
                  opacity: p.life,
                  boxShadow: `0 0 8px ${p.color}`
                }}
              />
            ))}

            {/* Floating score text */}
            {floatTexts.map((ft) => (
              <div
                key={ft.id}
                className="saki-game-float-text"
                style={{ left: `${ft.x}%`, top: `${ft.y}%`, color: ft.color }}
              >
                {ft.rating ? <span className="float-rating">{ft.rating}</span> : null}
                <span className="float-score">{ft.text}</span>
              </div>
            ))}

            {/* The 7x7 Grid Container (STRICTLY CONTAINS ALL 7 ROWS) */}
            <div className="saki-match-grid-container">
              {board.map((row, r) =>
                row.map((tile, c) => {
                  const isSelected = selectedPos?.r === r && selectedPos?.c === c;
                  const isPowerup = tile.type === "lightning" || tile.type === "bomb" || tile.type === "rainbow";
                  return (
                    <div
                      key={`${r}-${c}-${tile.id}`}
                      className={`saki-match-tile ${isSelected ? "selected" : ""} ${tile.isMatching ? "matching" : ""} ${isPowerup ? "is-powerup" : ""}`}
                      onClick={() => handleTileClick(r, c)}
                    >
                      <img
                        src={GEM_ICONS[tile.type]}
                        alt={GEM_NAMES[tile.type]}
                        draggable={false}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Interactive Boosters Bar at Bottom */}
          <div className="saki-match-boosters-bar">
            {/* Booster 1: Star Hammer */}
            <button
              className={`saki-booster-btn ${isHammerActive ? "active" : ""}`}
              type="button"
              disabled={hammerCharges <= 0 || isProcessing}
              title={
                isEn
                  ? "Star Hammer: Smash any tile directly, or detonate special powerups!"
                  : isTw
                  ? "魔法星錘：敲碎指定方塊並觸發連鎖，亦可直接引爆特殊道具！"
                  : "魔法星锤：敲碎指定方块并触发连锁，亦可直接引爆特殊道具！"
              }
              onClick={() => setIsHammerActive((prev) => !prev)}
            >
              <Hammer size={18} style={{ color: "#fbbf24" }} />
              <span className="saki-booster-label">
                {isHammerActive ? (isEn ? "Cancel" : isTw ? "取消" : isJa ? "キャンセル" : "取消") : (isEn ? "Hammer" : isTw ? "星錘" : isJa ? "ハンマー" : "星锤")}
              </span>
              <span className="saki-booster-badge">{hammerCharges}</span>
            </button>

            {/* Booster 2: Galaxy Shuffle */}
            <button
              className="saki-booster-btn"
              type="button"
              disabled={shuffleCharges <= 0 || isProcessing}
              title="银河洗牌：随机重新打乱全屏所有方块"
              onClick={handleShuffle}
            >
              <Shuffle size={18} style={{ color: "#38bdf8" }} />
              <span className="saki-booster-label">洗牌</span>
              <span className="saki-booster-badge">{shuffleCharges}</span>
            </button>

            {/* Booster 3: Time Watch */}
            <button
              className="saki-booster-btn"
              type="button"
              disabled={timeCharges <= 0 || isProcessing}
              title="时光沙漏：立刻增加 10 秒挑战时间"
              onClick={handleAddTime}
            >
              <Clock size={18} style={{ color: "#4ade80" }} />
              <span className="saki-booster-label">+10秒</span>
              <span className="saki-booster-badge">{timeCharges}</span>
            </button>
          </div>
        </>
      ) : (
        /* Settlement Screen */
        <div className="saki-game-settlement">
          <div className="settlement-ambient-glow" aria-hidden="true" />

          {(() => {
            const isEn = language === "en-US";
            const isTw = language === "zh-TW";
            const isJa = language === "ja-JP";
            const rankInfo =
              score >= 3200
                ? {
                    grade: "SSS",
                    title: isEn ? "Puzzle Goddess" : isTw ? "消消樂神祇" : isJa ? "パズルの女神" : "消消乐神祇",
                    badgeColor: "gold",
                    expression: "/assets/expression/eating.webp",
                    quote: isEn
                      ? "Unbelievable! High combo explosion after explosion! Master's intuition is so sharp～ (੭ˊ꒳​ˋ)੭✨"
                      : isTw
                      ? "不可思議！超高連擊一波接一波！主人的直覺太敏銳啦～ (੭ˊ꒳​ˋ)੭✨"
                      : isJa
                      ? "信じられない！高コンボが連続炸裂！主人の直感が鋭すぎるよ～ (੭ˊ꒳​ˋ)੭✨"
                      : "不可思议！超高连击一波接一波！主人的直觉太敏锐啦～ (੭ˊ꒳​ˋ)੭✨"
                  }
                : score >= 2000
                ? {
                    grade: "S",
                    title: isEn ? "Star Eliminator" : isTw ? "星夢消除大師" : isJa ? "スターエリミネーター" : "星梦消除大师",
                    badgeColor: "pink",
                    expression: "/assets/expression/happy.webp",
                    quote: isEn
                      ? "Amazing combos! The rainbow stars and lightning cleared the whole screen, super satisfying～ (≧∇≦)ﾉ"
                      : isTw
                      ? "太爽快啦！彩虹願望星和閃電直接清空全屏，看得我好激動～ (≧∇≦)ﾉ"
                      : isJa
                      ? "コンボがすごい！レインボースターと稲妻が画面全体を一気にクリアするの、超気持ちいい～ (≧∇≦)ﾉ"
                      : "太爽快啦！彩虹愿望星和闪电直接清空全屏，看得我好激动～ (≧∇≦)ﾉ"
                  }
                : score >= 1000
                ? {
                    grade: "A",
                    title: isEn ? "Sweet Combiner" : isTw ? "甜蜜連擊手" : isJa ? "スイートコンボ" : "甜蜜连击手",
                    badgeColor: "cyan",
                    expression: "/assets/expression/wink.webp",
                    quote: isEn
                      ? "Well done! We scored tons of points together! Next time let's chain even more combos～ (๑>◡<๑)"
                      : isTw
                      ? "表現很棒哦！拿到了好多好感經驗！下次一定能打出更長的連擊～ (๑>◡<๑)"
                      : isJa
                      ? "よくやったね！たくさんポイント取れたよ！次はもっと長いコンボを繋げようね～ (๑>◡<๑)"
                      : "表现很棒哦！拿到了好多好感经验！下次一定能打出更长的连击～ (๑>◡<๑)"
                  }
                : {
                    grade: "B",
                    title: isEn ? "Practice Makes Perfect" : isTw ? "萌新實習生" : isJa ? "練習あるのみ" : "萌新实习生",
                    badgeColor: "purple",
                    expression: "/assets/expression/think.webp",
                    quote: isEn
                      ? "Keep going! Try spotting 4-gem lines to make lightning bombs next time～ (´,,•ω•,,)"
                      : isTw
                      ? "再接再厲～ 下次留意湊四連生成閃電炸彈，分數會翻倍哦～ (´,,•ω•,,)"
                      : isJa
                      ? "頑張って！次は4つ連なっているのを見つけて稲妻爆弾を作ろうね～ (´,,•ω•,,)"
                      : "再接再厉～ 下次留意凑四连生成闪电炸弹，分数会翻倍哦～ (´,,•ω•,,)"
                  };

            return (
              <div className="settlement-header">
                <div className={`settlement-rank-pill ${rankInfo.badgeColor}`}>
                  <span className="rank-star">✦</span>
                  <span className="rank-grade">{rankInfo.grade}</span>
                  <span className="rank-divider">·</span>
                  <span className="rank-title">{rankInfo.title}</span>
                </div>
                <h3 className="settlement-title">
                  {isEn ? "Match Complete!" : isTw ? "消除挑戰完成！" : isJa ? "マッチ完了！" : "消除挑战完成！"}
                </h3>

                <div className="settlement-character-wrap">
                  <div className="character-halo" aria-hidden="true" />
                  <img
                    src={rankInfo.expression}
                    alt="Saki Reaction"
                    className="settlement-character-img"
                    draggable={false}
                  />
                </div>

                <div className="settlement-dialogue-bubble">
                  <span className="bubble-tail" aria-hidden="true" />
                  <p className="settlement-quote">{rankInfo.quote}</p>
                </div>
              </div>
            );
          })()}

          <div className="settlement-stats-grid">
            <div className="settlement-stat-card score-card">
              <div className="stat-card-header">
                <span className="stat-icon">⭐</span>
                <span className="stat-label">消除得分</span>
              </div>
              <div className="stat-card-val score-val">{score}</div>
            </div>

            <div className="settlement-stat-card exp-card">
              <div className="stat-card-header">
                <span className="stat-icon">💖</span>
                <span className="stat-label">好感经验</span>
              </div>
              <div className="stat-card-val exp-val">+{expReward}</div>
            </div>

            <div className="settlement-stat-card combo-card">
              <div className="stat-card-header">
                <span className="stat-icon">🔥</span>
                <span className="stat-label">最大连击</span>
              </div>
              <div className="stat-card-val combo-val">{maxCombo}x</div>
            </div>
          </div>

          <div className="settlement-actions" style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", marginTop: "14px" }}>
            <button
              className="saki-settlement-btn"
              type="button"
              onClick={handleFinish}
            >
              <Sparkles size={16} className="btn-icon" />
              <span>领取奖励并完成</span>
              <div className="btn-shine" aria-hidden="true" />
            </button>

            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button
                className="saki-phone-exit-btn saki-settlement-restart-btn"
                type="button"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={handleRestart}
              >
                <RotateCcw size={14} />
                <span>再来一局</span>
              </button>

              {onBackToPhone ? (
                <button
                  className="saki-phone-exit-btn saki-settlement-back-btn"
                  type="button"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={handleBackToPhone}
                >
                  <ArrowLeft size={14} />
                  <span>返回手机</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
