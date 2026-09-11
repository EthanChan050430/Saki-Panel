import React, { useEffect, useState, useRef } from "react";
import {
  X,
  Wifi,
  BatteryCharging,
  MessageSquare,
  Paintbrush,
  UtensilsCrossed,
  Heart,
  PhoneOff,
  Settings,
  Image as ImageIcon
} from "lucide-react";
import { usePanelLanguage } from "../../../i18n/index.js";
import { usePlugins } from "../../../plugins/PluginContext.js";

interface SakiPhoneLauncherProps {
  onSelectGame: (gameId: string) => void;
  onClose: () => void;
  favorabilityLevel?: number;
  onOpenFeed?: () => void;
  onOpenDecorate?: () => void;
  onSwitchToChat?: () => void;
}

class PhoneMusicPlayer {
  private ctx: AudioContext | null = null;
  private isPlaying: boolean = false;
  private timer: number | null = null;

  public togglePlay(onStateChange: (playing: boolean) => void) {
    if (this.isPlaying) {
      this.stop();
      onStateChange(false);
      return;
    }

    try {
      if (!this.ctx && typeof window !== "undefined") {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        void this.ctx.resume();
      }
      if (!this.ctx) return;

      this.isPlaying = true;
      onStateChange(true);

      // 8-bit 音效循环
      const notes = [
        523.25, 659.25, 783.99, 987.77,
        440.0, 523.25, 659.25, 783.99,
        349.23, 440.0, 523.25, 659.25,
        392.0, 493.88, 587.33, 783.99
      ];
      let step = 0;

      this.timer = window.setInterval(() => {
        if (!this.ctx || !this.isPlaying) return;
        const t = this.ctx.currentTime;
        const freq = notes[step % notes.length] ?? 440;
        step++;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.24);
      }, 160);
    } catch {
      this.isPlaying = false;
      onStateChange(false);
    }
  }

  public stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function SakiPhoneLauncher({
  onSelectGame,
  onClose,
  favorabilityLevel = 1,
  onOpenFeed,
  onOpenDecorate,
  onSwitchToChat
}: SakiPhoneLauncherProps) {
  const { language } = usePanelLanguage();
  const { pluginGames } = usePlugins();
  const isEn = language === "en-US";
  const isTw = language === "zh-TW";
  const isJa = language === "ja-JP";

  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [islandMessage, setIslandMessage] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);

  const musicPlayerRef = useRef<PhoneMusicPlayer>(new PhoneMusicPlayer());

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, "0");
      const m = String(now.getMinutes()).padStart(2, "0");
      setCurrentTime(`${h}:${m}`);

      const days = isEn
        ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
        : isJa
        ? ["日", "月", "火", "水", "木", "金", "土"]
        : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const month = now.getMonth() + 1;
      const date = now.getDate();
      const dayName = days[now.getDay()] ?? "";
      setCurrentDate(isEn ? `${dayName} · ${month}/${date}` : isJa ? `${month}月${date}日 ${dayName}` : `${month}月${date}日 ${dayName}`);
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => {
      clearInterval(timer);
      musicPlayerRef.current.stop();
    };
  }, [isEn]);

  const handleIslandClick = () => {
    const quotes = isEn
      ? ["Saki 5G connected ✨", "Battery 100% full! 💖", "Ready to play games with Master~ 🎮"]
      : isTw
      ? ["星夢 5G 信號滿格 ✨", "電量充沛 100%！💖", "隨時準備好和主人玩遊戲啦～ 🎮"]
      : isJa
      ? ["Saki 5G接続 ✨", "バッテリー満タン！💖", "主人とゲームの準備はいいよ～ 🎮"]
      : ["星梦 5G 信号满格 ✨", "电量充沛 100%！💖", "随时准备好和主人玩游戏啦～ 🎮"];
    const chosen = quotes[Math.floor(Math.random() * quotes.length)] ?? quotes[0]!;
    setIslandMessage(chosen);
    setTimeout(() => setIslandMessage(null), 2400);
  };

  const galleryItems = [
    { name: isEn ? "Snack Time" : isJa ? "スイーツタイム" : "品尝甜点", img: "/assets/expression/eating.webp", quote: "草莓大福好好吃～" },
    { name: isEn ? "Happy Wink" : isJa ? "ウィンクスマイル" : "眨眼微笑", img: "/assets/expression/wink.webp", quote: "今天也是元气满满的一天！" },
    { name: isEn ? "Gamer Saki" : isJa ? "ゲーマー咲" : "沉迷游戏", img: "/assets/expression/gaming.webp", quote: "看我的高分神操作！" },
    { name: isEn ? "Warm Hug" : isJa ? "温かなハグ" : "开心陪伴", img: "/assets/expression/happy.webp", quote: "最喜欢和主人在一起了～" }
  ];

  return (
    <div
      className="saki-phone-overlay"
      style={{ backgroundImage: `url("/assets/phone/wallpaper.jpg")` }}
    >
      {/* Top Status Bar */}
      <div className="saki-phone-status-bar">
        <div className="saki-phone-clock">{currentTime || "12:00"}</div>

        {/* Dynamic Island */}
        <button
          className="saki-phone-island"
          type="button"
          title="灵动岛"
          onClick={handleIslandClick}
        >
          <span className="island-dot" />
          <span className="island-text">
            {islandMessage || (isMusicPlaying ? "🎵 Saki Music" : "Saki Phone")}
          </span>
        </button>

        <div className="saki-phone-status-right">
          <span style={{ fontSize: "10px" }}>5G</span>
          <Wifi size={12} />
          <div className="saki-phone-battery">
            <div className="battery-pill">
              <div className="battery-level" />
            </div>
            <BatteryCharging size={11} style={{ color: "#4ade80", marginLeft: "-2px" }} />
          </div>
        </div>
      </div>

      {/* Main Desktop Screen */}
      <div className="saki-phone-desktop">
        {/* iOS Style Minimalist Top Widget */}
        <div className="saki-phone-widget-row">
          <div className="saki-phone-clock-widget">
            <span className="saki-widget-date">{currentDate}</span>
            <span className="saki-widget-time-big">{currentTime}</span>
            <span className="saki-widget-status">
              {isEn ? "SakiOS 4.0 · Clear sky" : isTw ? "星夢OS 4.0 · 晴空萬里" : isJa ? "SakiOS 4.0 · 快晴" : "星梦OS 4.0 · 晴空万里"}
            </span>
          </div>

          <div
            className="saki-phone-avatar-widget"
            onClick={handleIslandClick}
            title="Saki"
          >
            <img src="/assets/expression/happy.webp" alt="Saki Avatar" draggable={false} />
            <span className="widget-badge">Lv.{favorabilityLevel}</span>
          </div>
        </div>

        {/* Real App Grid (4 columns, clean icons + labels below, zero wall of text!) */}
        <div className="saki-app-grid">
          {/* App 1: Dessert Drop Game */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => onSelectGame("dessert_drop")}
          >
            <div className="saki-app-icon-squircle">
              <img src="/assets/phone/app_dessert_drop.jpg" alt="接甜点" draggable={false} />
              <span className="saki-app-badge-dot gold">经典</span>
            </div>
            <span className="saki-app-label">
              {isEn ? "Dessert Drop" : isTw ? "接甜點" : isJa ? "スイーツキャッチ" : "接甜点"}
            </span>
          </button>

          {/* App 2: Sweet Match Game */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => onSelectGame("sweet_match")}
          >
            <div className="saki-app-icon-squircle">
              <img src="/assets/phone/app_sweet_match.jpg" alt="消消乐" draggable={false} />
              <span className="saki-app-badge-dot red">NEW</span>
            </div>
            <span className="saki-app-label">
              {isEn ? "Match-3" : isTw ? "消消樂" : isJa ? "マッチ3" : "消消乐"}
            </span>
          </button>

          {/* App 3: Plant Slayer Survivor Game */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => onSelectGame("plant_slayer")}
          >
            <div className="saki-app-icon-squircle">
              <img src="/assets/phone/app_plant_slayer.webp" alt="植物特攻" draggable={false} />
              <span className="saki-app-badge-dot gold">HOT</span>
            </div>
            <span className="saki-app-label">
              {isEn ? "Plant Slayer" : isTw ? "植物特攻" : isJa ? "プラントスレイヤー" : "植物特攻"}
            </span>
          </button>

          {/* Plugin Games from Community & GitHub */}
          {pluginGames.map((pg) => {
            const icon = pg.manifest.icon
              ? `/api/plugins/${encodeURIComponent(pg.id)}/assets/${pg.manifest.icon.replace(/^[/\\]+/, "")}`
              : "/assets/phone/app_dessert_drop.jpg";
            return (
              <button
                key={pg.id}
                className="saki-app-item"
                type="button"
                onClick={() => onSelectGame(pg.id)}
              >
                <div className="saki-app-icon-squircle">
                  <img src={icon} alt="" draggable={false} />
                  <span className="saki-app-badge-dot gold">扩展</span>
                </div>
                <span className="saki-app-label">
                  {pg.manifest.game?.title || pg.manifest.displayName}
                </span>
              </button>
            );
          })}

          {/* App 3: Music Box */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => {
              musicPlayerRef.current.togglePlay(setIsMusicPlaying);
            }}
          >
            <div className="saki-app-icon-squircle">
              <img src="/assets/phone/app_music.svg" alt="音乐盒" draggable={false} />
              {isMusicPlaying ? <span className="saki-app-badge-dot blue">♫</span> : null}
            </div>
            <span className="saki-app-label">
              {isEn ? "Music" : isTw ? "音樂盒" : isJa ? "ミュージック" : "音乐盒"}
            </span>
          </button>

          {/* App 4: Photo Gallery */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => setShowGallery(true)}
          >
            <div className="saki-app-icon-squircle">
              <img src="/assets/phone/app_gallery.svg" alt="相册" draggable={false} />
            </div>
            <span className="saki-app-label">
              {isEn ? "Photos" : isTw ? "相冊" : isJa ? "写真" : "相册"}
            </span>
          </button>

          {/* App 5: Chat Dialogue */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => {
              onClose();
              if (onSwitchToChat) onSwitchToChat();
            }}
          >
            <div
              className="saki-app-icon-squircle"
              style={{
                background: "linear-gradient(135deg, #38bdf8, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff"
              }}
            >
              <MessageSquare size={26} />
            </div>
            <span className="saki-app-label">
              {isEn ? "Messages" : isTw ? "訊息" : isJa ? "メッセージ" : "信息"}
            </span>
          </button>

          {/* App 6: Feed Treat */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => {
              onClose();
              if (onOpenFeed) onOpenFeed();
            }}
          >
            <div
              className="saki-app-icon-squircle"
              style={{
                background: "linear-gradient(135deg, #f59e0b, #ea580c)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff"
              }}
            >
              <UtensilsCrossed size={26} />
            </div>
            <span className="saki-app-label">
              {isEn ? "Feed" : isTw ? "投餵" : isJa ? "えさやり" : "投喂"}
            </span>
          </button>

          {/* App 7: Decorate Room */}
          <button
            className="saki-app-item"
            type="button"
            onClick={() => {
              onClose();
              if (onOpenDecorate) onOpenDecorate();
            }}
          >
            <div
              className="saki-app-icon-squircle"
              style={{
                background: "linear-gradient(135deg, #ec4899, #a855f7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff"
              }}
            >
              <Paintbrush size={26} />
            </div>
            <span className="saki-app-label">
              {isEn ? "Decor" : isTw ? "裝修" : isJa ? "デコ" : "装修"}
            </span>
          </button>

          {/* App 8: Affection Profile */}
          <button
            className="saki-app-item"
            type="button"
            onClick={handleIslandClick}
          >
            <div
              className="saki-app-icon-squircle"
              style={{
                background: "linear-gradient(135deg, #f43f5e, #fda4af)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff"
              }}
            >
              <Heart size={26} />
            </div>
            <span className="saki-app-label">
              {isEn ? "Affection" : isTw ? "好感度" : isJa ? "好感度" : "好感度"}
            </span>
          </button>
        </div>

        {/* Page Dots Indicator */}
        <div className="saki-phone-pages">
          <div className="saki-phone-dot active" />
          <div className="saki-phone-dot" />
        </div>
      </div>

      {/* Photo Album Popup */}
      {showGallery ? (
        <div className="saki-phone-easter-popup">
          <div className="saki-easter-header">
            <span className="saki-easter-title">
              <ImageIcon size={15} style={{ color: "#ff75ac" }} />
              <span>{isEn ? "Saki's Memories" : isTw ? "Saki 的回憶相冊" : isJa ? "Saki の思い出アルバム" : "Saki 的回忆相册"}</span>
            </span>
            <button
              className="saki-easter-close"
              type="button"
              onClick={() => setShowGallery(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="saki-gallery-grid">
            {galleryItems.map((item, idx) => (
              <div
                key={idx}
                className="saki-gallery-card"
                onClick={() => {
                  setIslandMessage(item.quote);
                  setShowGallery(false);
                }}
              >
                <img src={item.img} alt={item.name} draggable={false} />
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Floating Glass Dock at Bottom */}
      <div className="saki-phone-glass-dock">
        {/* Dock App 1: Dessert Drop */}
        <button
          className="saki-dock-app-btn"
          type="button"
          title="接甜点"
          onClick={() => onSelectGame("dessert_drop")}
        >
          <div className="saki-dock-icon">
            <img src="/assets/phone/app_dessert_drop.jpg" alt="接甜点" draggable={false} />
          </div>
        </button>

        {/* Dock App 2: Sweet Match */}
        <button
          className="saki-dock-app-btn"
          type="button"
          title="消消乐"
          onClick={() => onSelectGame("sweet_match")}
        >
          <div className="saki-dock-icon">
            <img src="/assets/phone/app_sweet_match.jpg" alt="消消乐" draggable={false} />
          </div>
        </button>

        {/* Dock App 3: Messages */}
        <button
          className="saki-dock-app-btn"
          type="button"
          title="聊天"
          onClick={() => {
            onClose();
            if (onSwitchToChat) onSwitchToChat();
          }}
        >
          <div
            className="saki-dock-icon"
            style={{
              background: "linear-gradient(135deg, #38bdf8, #2563eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff"
            }}
          >
            <MessageSquare size={22} />
          </div>
        </button>

        {/* Dock App 4: Put away / Close */}
        <button
          className="saki-dock-app-btn"
          type="button"
          title="放回手机 / 返回房间"
          onClick={onClose}
        >
          <div
            className="saki-dock-icon"
            style={{
              background: "linear-gradient(135deg, #ef4444, #b91c1c)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff"
            }}
          >
            <PhoneOff size={22} />
          </div>
        </button>
      </div>

      {/* Home Bar Indicator */}
      <div className="saki-phone-home-bar-area" onClick={onClose} title="点击或上滑退出手机">
        <div className="saki-phone-home-indicator" />
      </div>
    </div>
  );
}
