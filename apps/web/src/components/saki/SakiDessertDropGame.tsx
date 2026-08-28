import React, { useEffect, useRef, useState } from "react";
import { Sparkles, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { sakiArtAssets } from "../../constants.js";
import { usePanelLanguage } from "../../i18n/index.js";

interface SakiDessertDropGameProps {
  onClose: () => void;
  onFinish: (score: number, expReward: number) => void;
}

interface GameFallingItem {
  id: number;
  x: number;
  y: number;
  speed: number;
  points: number;
  iconSrc: string;
  name: string;
  isBug: boolean;
  scale: number;
}

interface GameFloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  rating?: string;
  color: string;
}

interface GameParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  shape: "star" | "heart" | "spark";
  life: number;
}

interface GameShockwave {
  id: number;
  x: number;
  y: number;
  color: string;
}

class GameSoundFX {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  public init() {
    try {
      if (!this.ctx && typeof window !== "undefined") {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === "suspended") {
        void this.ctx.resume();
      }
    } catch {}
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }
  public playCatch(combo: number, isWishStar: boolean = false) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;

      if (isWishStar) {
        // Celestial harp glissando for Wish Star
        const notes = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51];
        notes.forEach((freq, i) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, t + i * 0.035);

          gain.gain.setValueAtTime(0, t + i * 0.035);
          gain.gain.linearRampToValueAtTime(0.16, t + i * 0.035 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.035 + 0.2);

          osc.connect(gain);
          gain.connect(this.ctx!.destination);
          osc.start(t + i * 0.035);
          osc.stop(t + i * 0.035 + 0.22);
        });
        return;
      }

      // Pop / arcade sound with dynamic pitch scaling
      const basePitches = [392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99, 880.0, 987.77, 1046.5];
      const freq = basePitches[Math.min(combo, basePitches.length - 1)] ?? 440;

      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.45, t + 0.08);

      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq * 2, t);
      osc2.frequency.exponentialRampToValueAtTime(freq * 2.5, t + 0.06);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc2.start(t);
      osc.stop(t + 0.14);
      osc2.stop(t + 0.14);
    } catch {}
  }
  public playBugHit() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(180, t);
      osc1.frequency.exponentialRampToValueAtTime(45, t + 0.22);

      osc2.type = "square";
      osc2.frequency.setValueAtTime(155, t);
      osc2.frequency.exponentialRampToValueAtTime(40, t + 0.22);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.26);
      osc2.stop(t + 0.26);
    } catch {}
  }
  public playFever() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((freq, i) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t + i * 0.05);

        gain.gain.setValueAtTime(0.18, t + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start(t + i * 0.05);
        osc.stop(t + i * 0.05 + 0.32);
      });
    } catch {}
  }
  public playCountdownTick(isFinal: boolean = false) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(isFinal ? 880 : 660, t);

      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
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
        { f: 783.99, time: 0.24, dur: 0.14 },
        { f: 1046.5, time: 0.38, dur: 0.4 }
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
  public playWhoosh() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(340, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.08);

      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    } catch {}
  }
}

export function SakiDessertDropGame({ onClose, onFinish }: SakiDessertDropGameProps) {
  const { language } = usePanelLanguage();
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameOver, setGameOver] = useState(false);
  const [basketX, setBasketX] = useState(50);
  const [basketTilt, setBasketTilt] = useState(0);
  const [floatTexts, setFloatTexts] = useState<GameFloatText[]>([]);
  const [particles, setParticles] = useState<GameParticle[]>([]);
  const [shockwaves, setShockwaves] = useState<GameShockwave[]>([]);
  const [shaking, setShaking] = useState(false);
  const [feverFlash, setFeverFlash] = useState(false);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem("saki_game_sound_muted") === "true";
    } catch {
      return false;
    }
  });

  const soundFxRef = useRef<GameSoundFX>(new GameSoundFX());
  const gameAreaRef = useRef<HTMLDivElement | null>(null);

  const itemsRef = useRef<GameFallingItem[]>([]);
  const particlesRef = useRef<GameParticle[]>([]);
  const [, setTick] = useState(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const basketXRef = useRef(50);
  const lastBasketXRef = useRef(50);
  const isGameOverRef = useRef(false);

  scoreRef.current = score;
  comboRef.current = combo;
  maxComboRef.current = maxCombo;
  basketXRef.current = basketX;

  useEffect(() => {
    soundFxRef.current.setMuted(soundMuted);
  }, [soundMuted]);

  useEffect(() => {
    if (gameOver) {
      soundFxRef.current.playVictory();
    }
  }, [gameOver]);

  const itemTypes = [
    { name: "心愿星", iconSrc: "/assets/game/star.png", points: 30, isBug: false, weight: 2 },
    { name: "草莓大福", iconSrc: "/assets/game/caomeidafu.png", points: 25, isBug: false, weight: 3 },
    { name: "珍珠奶茶", iconSrc: "/assets/game/naicha.png", points: 25, isBug: false, weight: 3 },
    { name: "甜甜圈", iconSrc: "/assets/game/donut.png", points: 20, isBug: false, weight: 4 },
    { name: "马卡龙", iconSrc: "/assets/game/macaron.png", points: 15, isBug: false, weight: 4 },
    { name: "调皮Bug", iconSrc: "/assets/game/bug.png", points: -15, isBug: true, weight: 2 }
  ];

  const spawnParticleBurst = (x: number, y: number, isBug: boolean) => {
    const count = isBug ? 8 : 12;
    const newParts: GameParticle[] = [];
    const colors = isBug
      ? ["#f43f5e", "#9333ea", "#e11d48"]
      : ["#fbbf24", "#ff75ac", "#38bdf8", "#4ade80", "#ffffff"];
    const shapes: ("star" | "heart" | "spark")[] = isBug ? ["spark"] : ["star", "heart", "spark"];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
      const spd = Math.random() * 2.5 + 1.5;
      newParts.push({
        id: Date.now() + Math.random(),
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 1.2,
        size: Math.random() * 8 + 6,
        color: colors[Math.floor(Math.random() * colors.length)] ?? "#ff75ac",
        shape: shapes[Math.floor(Math.random() * shapes.length)] ?? "star",
        life: 1
      });
    }

    particlesRef.current = [...particlesRef.current.slice(-30), ...newParts];
    setParticles([...particlesRef.current]);
  };

  const spawnShockwave = (x: number, y: number, color: string) => {
    const sw: GameShockwave = { id: Date.now() + Math.random(), x, y, color };
    setShockwaves((prev) => [...prev.slice(-4), sw]);
    setTimeout(() => {
      setShockwaves((prev) => prev.filter((item) => item.id !== sw.id));
    }, 550);
  };

  useEffect(() => {
    let animFrame: number;
    let lastSpawn = Date.now();

    const spawnItem = () => {
      if (isGameOverRef.current) return;
      const totalWeight = itemTypes.reduce((acc, t) => acc + t.weight, 0);
      let r = Math.random() * totalWeight;
      let chosen = itemTypes[0] ?? { name: "甜甜圈", iconSrc: "/assets/game/donut.png", points: 20, isBug: false, weight: 4 };
      for (const t of itemTypes) {
        if (r < t.weight) {
          chosen = t;
          break;
        }
        r -= t.weight;
      }

      itemsRef.current.push({
        id: Date.now() + Math.random(),
        x: Math.random() * 80 + 10,
        y: 0,
        speed: Math.random() * 0.8 + 0.9,
        points: chosen.points,
        iconSrc: chosen.iconSrc,
        name: chosen.name,
        isBug: chosen.isBug,
        scale: 1
      });
    };

    const loop = () => {
      if (isGameOverRef.current) return;

      const now = Date.now();
      if (now - lastSpawn > 620) {
        spawnItem();
        lastSpawn = now;
      }

      const basketPos = basketXRef.current;
      const caughtList: GameFallingItem[] = [];
      const remaining: GameFallingItem[] = [];

      for (const item of itemsRef.current) {
        item.y += item.speed * 0.88;
        if (item.y >= 75 && item.y <= 88) {
          const dist = Math.abs(item.x - basketPos);
          if (dist < 14) {
            caughtList.push(item);
            continue;
          }
        }
        if (item.y <= 102) {
          remaining.push(item);
        }
      }
      itemsRef.current = remaining;

      // Update particle physics
      if (particlesRef.current.length > 0) {
        const remainingParts: GameParticle[] = [];
        for (const p of particlesRef.current) {
          p.x += p.vx * 0.7;
          p.y += p.vy * 0.7;
          p.vy += 0.08; // gravity
          p.life -= 0.035;
          if (p.life > 0) {
            remainingParts.push(p);
          }
        }
        particlesRef.current = remainingParts;
        setParticles(remainingParts);
      }

      if (caughtList.length > 0) {
        caughtList.forEach((item) => {
          if (item.isBug) {
            soundFxRef.current.playBugHit();
            setScore((prev) => Math.max(0, prev - 15));
            setCombo(0);
            setShaking(true);
            setTimeout(() => setShaking(false), 350);
            spawnParticleBurst(item.x, item.y, true);
            spawnShockwave(item.x, item.y, "rgba(244, 63, 94, 0.8)");
            setFloatTexts((prev) => [
              ...prev.slice(-5),
              { id: Date.now() + Math.random(), x: item.x, y: item.y, text: "-15 💥", rating: "MISS!", color: "#f43f5e" }
            ]);
          } else {
            const isFever = comboRef.current >= 4;
            const pts = isFever ? item.points * 2 : item.points;
            soundFxRef.current.playCatch(comboRef.current, item.name === "心愿星");
            setScore((prev) => prev + pts);
            setCombo((prev) => {
              const n = prev + 1;
              if (n === 5) {
                soundFxRef.current.playFever();
                setFeverFlash(true);
                setTimeout(() => setFeverFlash(false), 400);
              }
              if (n > maxComboRef.current) setMaxCombo(n);
              return n;
            });

            spawnParticleBurst(item.x, item.y, false);
            spawnShockwave(item.x, item.y, isFever ? "rgba(251, 191, 36, 0.9)" : "rgba(255, 117, 172, 0.8)");

            const rating = isFever ? "FEVER! 🔥" : comboRef.current >= 6 ? "PERFECT! 🌟" : comboRef.current >= 3 ? "GREAT! ✨" : "NICE!";
            const comboText = isFever ? `+${pts} (2X)` : `+${pts}`;
            setFloatTexts((prev) => [
              ...prev.slice(-5),
              { id: Date.now() + Math.random(), x: item.x, y: item.y, text: comboText, rating, color: isFever ? "#fbbf24" : "#ff75ac" }
            ]);
          }
        });
      }

      setTick((t) => (t + 1) % 10000);
      animFrame = requestAnimationFrame(loop);
    };

    animFrame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, []);

  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setGameOver(true);
          isGameOverRef.current = true;
          return 0;
        }
        if (prev <= 6 && prev > 1) {
          soundFxRef.current.playCountdownTick(prev === 2);
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameOver]);

  useEffect(() => {
    if (floatTexts.length === 0) return;
    const t = setTimeout(() => {
      setFloatTexts((prev) => prev.slice(1));
    }, 750);
    return () => clearTimeout(t);
  }, [floatTexts]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!gameAreaRef.current || gameOver) return;
    soundFxRef.current.init();
    const rect = gameAreaRef.current.getBoundingClientRect();
    const clientX = e.clientX;
    const relX = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(12, Math.min(88, relX));
    const delta = clamped - lastBasketXRef.current;
    if (Math.abs(delta) > 5.5) {
      soundFxRef.current.playWhoosh();
    }
    lastBasketXRef.current = clamped;
    const tilt = Math.max(-16, Math.min(16, delta * 3.5));
    setBasketTilt(tilt);
    setBasketX(clamped);
    setTimeout(() => setBasketTilt(0), 120);
  };

  const expReward = Math.max(15, Math.round(score * 0.35));
  const isFeverMode = combo >= 5;

  const handleFinishGame = () => {
    onFinish(score, expReward);
    onClose();
  };

  return (
    <div
      ref={gameAreaRef}
      className={`saki-mini-game-overlay ${shaking ? "shaking" : ""} ${isFeverMode ? "fever-active" : ""}`}
      style={{ backgroundImage: `url("/assets/game/game_bg.png")` }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerMove}
    >
      {/* Fever Flash Light */}
      {feverFlash ? <div className="saki-game-fever-flash" aria-hidden="true" /> : null}

      {/* Fever Mode Aura Border */}
      {isFeverMode ? <div className="saki-game-fever-border" aria-hidden="true" /> : null}

      {/* Game Header */}
      <div className="saki-game-header">
        <div className="saki-game-stat">
          <span className="stat-label">倒计时</span>
          <span className="stat-value timer">{timeLeft}s</span>
        </div>
        <div className="saki-game-stat">
          <span className="stat-label">得分</span>
          <span className="stat-value score">{score}</span>
        </div>
        <div className="saki-game-header-actions">
          <button
            className="saki-game-sound-btn"
            type="button"
            title={soundMuted ? "开启音效" : "静音"}
            aria-label={soundMuted ? "开启音效" : "静音"}
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
            {soundMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button
            className="saki-game-close-btn"
            type="button"
            title="退出游戏"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {!gameOver ? (
        <div className="saki-game-stage">
          {/* Dynamic Glowing Arcade Combo & Fever Typography */}
          {combo >= 2 ? (
            <div
              key={combo}
              className={`saki-stage-combo-text ${isFeverMode ? "fever" : ""}`}
              aria-live="polite"
            >
              {isFeverMode ? (
                <div className="combo-fever-badge">FEVER 2X</div>
              ) : null}
              <div className="combo-line">
                <span className="combo-num">{combo}</span>
                <span className="combo-txt">COMBO</span>
              </div>
            </div>
          ) : null}

          {/* Shockwaves */}
          {shockwaves.map((sw) => (
            <div
              key={sw.id}
              className="saki-game-shockwave"
              style={{ left: `${sw.x}%`, top: `${sw.y}%`, borderColor: sw.color }}
            />
          ))}

          {/* Particle Bursts */}
          {particles.map((p) => (
            <div
              key={p.id}
              className={`saki-game-particle ${p.shape}`}
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

          {/* Falling Items */}
          {itemsRef.current.map((item) => (
            <div
              key={item.id}
              className={`saki-game-item ${item.isBug ? "bug" : "sweet"}`}
              style={{ left: `${item.x}%`, top: `${item.y}%` }}
            >
              <img src={item.iconSrc} alt={item.name} draggable={false} />
            </div>
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

          {/* Catcher Basket with 3D Tilt */}
          <div
            className={`saki-game-basket ${isFeverMode ? "fever-glow" : ""}`}
            style={{
              left: `${basketX}%`,
              transform: `translateX(-50%) rotate(${basketTilt}deg)`
            }}
          >
            <img src="/assets/game/basket.png" alt="接物盘" draggable={false} />
            <div className="saki-basket-glow-aura" />
          </div>
        </div>
      ) : (
        <div className="saki-game-settlement">
          <div className="settlement-ambient-glow" aria-hidden="true" />

          {(() => {
            const isEn = language === "en-US";
            const isTw = language === "zh-TW";
            const rankInfo =
              score >= 1000
                ? {
                    grade: "SSS",
                    title: isEn ? "Dessert Master" : isTw ? "甜點神捕手" : "甜点神捕手",
                    badgeColor: "gold",
                    expression: "/assets/expression/eating.png",
                    quote: isEn
                      ? "Wowww! Caught so many desserts! Master is truly a dessert champion, amazing～ (੭ˊ꒳​ˋ)੭✧"
                      : isTw
                      ? "哇哇哇！接到超多甜點！主人簡直是甜點大師，太厲害啦～ (੭ˊ꒳​ˋ)੭✧"
                      : "哇哇哇！接到超多甜点！主人简直是甜点大师，太厉害啦～ (੭ˊ꒳​ˋ)੭✧"
                  }
                : score >= 600
                ? {
                    grade: "S",
                    title: isEn ? "Sweet Harvest" : isTw ? "美味大豐收" : "美味大丰收",
                    badgeColor: "pink",
                    expression: "/assets/expression/eating.png",
                    quote: isEn
                      ? "Caught so many delicious pastries! Afternoon tea is all set, the donuts smell incredible～ (≧∇≦)ﾉ"
                      : isTw
                      ? "接到了好多美味點心！今天的下午茶有著落啦，甜甜圈超香的～ (≧∇≦)ﾉ"
                      : "接到了好多美味点心！今天的下午茶有着落啦，甜甜圈超香的～ (≧∇≦)ﾉ"
                  }
                : score >= 300
                ? {
                    grade: "A",
                    title: isEn ? "Full Basket" : isTw ? "滿載而歸" : "满载而归",
                    badgeColor: "cyan",
                    expression: "/assets/expression/happy.png",
                    quote: isEn
                      ? "Phew～ Caught quite a few treats! We'll definitely catch even more together next time, hehe～ (๑>◡<๑)"
                      : isTw
                      ? "呼～接到了不少點心呢！下次我們配合一定能接到更多，嘿嘿～ (๑>◡<๑)"
                      : "呼～接到了不少点心呢！下次我们配合一定能接到更多，嘿嘿～ (๑>◡<๑)"
                  }
                : {
                    grade: "B",
                    title: isEn ? "Keep It Up" : isTw ? "繼續加油" : "继续加油",
                    badgeColor: "purple",
                    expression: "/assets/expression/upset.png",
                    quote: isEn
                      ? "Aww, just missed by a little bit... But having Master play with me makes me super happy! Next time will be even better～ (´,,•ω•,,)"
                      : isTw
                      ? "嗚嗚就差一點點了... 不過有主人陪我玩就超開心！下次一定更棒～ (´,,•ω•,,)"
                      : "呜呜就差一点点了... 不过有主人陪我玩就超开心！下次一定更棒～ (´,,•ω•,,)"
                  };

            return (
              <div className="settlement-header">
                <div className={`settlement-rank-pill ${rankInfo.badgeColor}`}>
                  <span className="rank-star">✦</span>
                  <span className="rank-grade">{rankInfo.grade}</span>
                  <span className="rank-divider">·</span>
                  <span className="rank-title">{rankInfo.title}</span>
                </div>
                <h3 className="settlement-title">{isEn ? "Challenge Complete!" : isTw ? "挑戰完成！" : "挑战完成！"}</h3>

                <div className="settlement-character-wrap">
                  <div className="character-halo" aria-hidden="true" />
                  <img
                    src={rankInfo.expression}
                    alt="Saki Celebration"
                    className="settlement-character-img"
                    draggable={false}
                  />
                  <div className="character-sweets-float" aria-hidden="true">
                    <span className="sweet-icon sweet-left">🍓</span>
                    <span className="sweet-icon sweet-right">🍩</span>
                    <span className="sweet-icon sweet-spark">✨</span>
                  </div>
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
                <span className="stat-label">最终得分</span>
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
                <span className="stat-label">最高连击</span>
              </div>
              <div className="stat-card-val combo-val">{maxCombo}x</div>
            </div>
          </div>

          <div className="settlement-actions">
            <button
              className="saki-settlement-btn"
              type="button"
              onClick={handleFinishGame}
            >
              <Sparkles size={16} className="btn-icon" />
              <span>领取奖励并完成</span>
              <div className="btn-shine" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
