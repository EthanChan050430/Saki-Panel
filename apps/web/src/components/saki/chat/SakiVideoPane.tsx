import React, { memo, useState, useEffect } from "react";
import {
  Gamepad2,
  Heart,
  MessageSquare,
  Mic,
  MicOff,
  Paintbrush,
  PhoneOff,
  RefreshCw,
  Sparkles,
  UtensilsCrossed,
  X
} from "lucide-react";
import type { PanelLanguage } from "../../../i18n/index.js";
import {
  SakiCharacterArt,
  getLocalizedFoodMenu,
  type SakiActivityMood,
  type SakiArtMood,
  type SakiVoiceEchoState
} from "../SakiComponents.js";
import { SakiDessertDropGame } from "../SakiDessertDropGame.js";
import { SakiPhoneLauncher } from "../phone/SakiPhoneLauncher.js";
import { SakiSweetMatchGame } from "../games/SakiSweetMatchGame.js";
import { SakiPlantSlayerGame } from "../games/SakiPlantSlayerGame.js";
import { MarkdownContent } from "../../common/MarkdownContent.js";
import {
  getFavorabilityLevelInfo,
  type FavorabilityLevelInfo
} from "../sakiChatHelpers.js";

export type SakiFoodItem = ReturnType<typeof getLocalizedFoodMenu>[number];

export interface DraggingFoodState {
  food: SakiFoodItem;
  currentX: number;
  currentY: number;
  isDragging: boolean;
}

export interface SakiVideoPaneProps {
  mobileActiveTab: "video" | "chat";
  setMobileActiveTab: (tab: "video" | "chat") => void;
  customRoomBg: string | null;
  setCustomRoomBg: (bg: string | null) => void;
  roomBgInputRef: React.RefObject<HTMLInputElement | null>;
  handleCustomRoomBgUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  miniGameActive: boolean;
  setMiniGameActive: React.Dispatch<React.SetStateAction<boolean>>;
  setSakiPokeMood: (mood: SakiActivityMood | null) => void;
  handleMiniGameFinish: (score: number, expReward: number) => void;
  chatPulseAlert: boolean;
  setChatPulseAlert: (val: boolean) => void;
  sakiFavorabilityExp: number;
  favorabilityPop: { id: number; amount: number } | null;
  language: PanelLanguage;
  closeSakiPanel: () => void;
  sakiCharacterRef: React.RefObject<HTMLDivElement | null>;
  artMood: SakiArtMood;
  effectiveActivityMood: SakiActivityMood | null;
  isDragOverSaki: boolean;
  sakiEchoState: SakiVoiceEchoState;
  isSakiListening: boolean;
  handleSakiCharacterPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleSakiCharacterPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleSakiCharacterPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleSakiPoke: () => void;
  draggingFood: DraggingFoodState | null;
  videoBubbleText: string | null;
  isStreamingReply: boolean;
  videoBubbleRef: React.RefObject<HTMLDivElement | null>;
  feedMenuOpen: boolean;
  setFeedMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isUnlimitedPoints: boolean;
  numericSakiPoints: number;
  startFoodDrag: (e: React.PointerEvent, food: SakiFoodItem) => void;
  listening: boolean;
  toggleSpeechInput: () => void;
}

export const SakiVideoPane = memo(function SakiVideoPane({
  mobileActiveTab,
  setMobileActiveTab,
  customRoomBg,
  setCustomRoomBg,
  roomBgInputRef,
  handleCustomRoomBgUpload,
  miniGameActive,
  setMiniGameActive,
  setSakiPokeMood,
  handleMiniGameFinish,
  chatPulseAlert,
  setChatPulseAlert,
  sakiFavorabilityExp,
  favorabilityPop,
  language,
  closeSakiPanel,
  sakiCharacterRef,
  artMood,
  effectiveActivityMood,
  isDragOverSaki,
  sakiEchoState,
  isSakiListening,
  handleSakiCharacterPointerDown,
  handleSakiCharacterPointerUp,
  handleSakiCharacterPointerCancel,
  handleSakiPoke,
  draggingFood,
  videoBubbleText,
  isStreamingReply,
  videoBubbleRef,
  feedMenuOpen,
  setFeedMenuOpen,
  isUnlimitedPoints,
  numericSakiPoints,
  startFoodDrag,
  listening,
  toggleSpeechInput
}: SakiVideoPaneProps) {
  const favInfo = getFavorabilityLevelInfo(sakiFavorabilityExp, language);
  const isEn = language === "en-US";
  const isTw = language === "zh-TW";

  const [activeGame, setActiveGame] = useState<"dessert_drop" | "sweet_match" | "plant_slayer" | null>(null);

  useEffect(() => {
    if (!miniGameActive) {
      setActiveGame(null);
    }
  }, [miniGameActive]);

  const favBadgeTitle = isEn
    ? `[Saki Affection Details]\nLevel: Lv.${favInfo.level} · ${favInfo.title}\nCurrent EXP: ${favInfo.currentExp} / ${favInfo.maxExpForLevel} EXP (${favInfo.levelProgress}%)\n${favInfo.isMaxLevel ? "Max affection level reached!" : `EXP needed for next level: ${favInfo.maxExpForLevel - favInfo.currentExp}`}`
    : isTw
    ? `【Saki 好感度詳情】\n等級: Lv.${favInfo.level} · ${favInfo.title}\n目前經驗: ${favInfo.currentExp} / ${favInfo.maxExpForLevel} EXP (${favInfo.levelProgress}%)\n${favInfo.isMaxLevel ? "已達最高好感度！" : `距離下一級還需 ${favInfo.maxExpForLevel - favInfo.currentExp} EXP`}`
    : `【Saki 好感度详情】\n等级: Lv.${favInfo.level} · ${favInfo.title}\n当前经验: ${favInfo.currentExp} / ${favInfo.maxExpForLevel} EXP (${favInfo.levelProgress}%)\n${favInfo.isMaxLevel ? "已达最高好感度！" : `距离下一级还需 ${favInfo.maxExpForLevel - favInfo.currentExp} EXP`}`;

  return (
    <div
      className={`saki-video-pane ${mobileActiveTab === "video" ? "mobile-show" : "mobile-hide"}`}
      style={customRoomBg ? { backgroundImage: `url("${customRoomBg}")` } : undefined}
    >
      <input
        ref={roomBgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handleCustomRoomBgUpload}
      />

      {/* Mini Game & Phone Launcher occupying the FULL saki-video-pane */}
      {miniGameActive ? (
        activeGame === "dessert_drop" ? (
          <SakiDessertDropGame
            onClose={() => {
              setMiniGameActive(false);
              setActiveGame(null);
            }}
            onBackToPhone={() => {
              setActiveGame(null);
            }}
            onFinish={(score, expReward) => {
              handleMiniGameFinish(score, expReward);
            }}
          />
        ) : activeGame === "sweet_match" ? (
          <SakiSweetMatchGame
            onClose={() => {
              setMiniGameActive(false);
              setActiveGame(null);
            }}
            onBackToPhone={() => {
              setActiveGame(null);
            }}
            onFinish={(score, expReward) => {
              handleMiniGameFinish(score, expReward);
            }}
          />
        ) : activeGame === "plant_slayer" ? (
          <SakiPlantSlayerGame
            onClose={() => {
              setMiniGameActive(false);
              setActiveGame(null);
            }}
            onBackToPhone={() => {
              setActiveGame(null);
            }}
            onFinish={(score, expReward) => {
              handleMiniGameFinish(score, expReward);
            }}
          />
        ) : (
          <SakiPhoneLauncher
            favorabilityLevel={favInfo.level}
            onSelectGame={(gameId) => {
              setActiveGame(gameId);
              setSakiPokeMood("gaming");
            }}
            onClose={() => {
              setMiniGameActive(false);
              setSakiPokeMood(null);
              setActiveGame(null);
            }}
            onOpenFeed={() => {
              setFeedMenuOpen(true);
            }}
            onOpenDecorate={() => {
              roomBgInputRef.current?.click();
            }}
            onSwitchToChat={() => {
              setMobileActiveTab("chat");
            }}
          />
        )
      ) : null}

      <div className="saki-video-header">
        <div className="saki-video-header-left">
          <button
            className="saki-video-settings-btn"
            type="button"
            title="装修房间 (自定义背景图)"
            aria-label="装修房间"
            onClick={() => roomBgInputRef.current?.click()}
          >
            <Paintbrush size={15} />
          </button>
          {customRoomBg ? (
            <button
              className="saki-video-settings-btn mini"
              type="button"
              title="恢复默认房间装修"
              aria-label="恢复默认装修"
              onClick={() => {
                setCustomRoomBg(null);
                try {
                  localStorage.removeItem("saki_custom_room_bg");
                } catch {}
              }}
            >
              <RefreshCw size={12} />
            </button>
          ) : null}
        </div>

        {/* Aesthetic Floating Island Switcher (Mobile Only) */}
        <div className="saki-mobile-island-switcher" role="tablist" aria-label="移动端视图切换">
          <button
            type="button"
            className={`saki-island-pill ${mobileActiveTab === "video" ? "active" : ""}`}
            onClick={() => setMobileActiveTab("video")}
            role="tab"
            aria-selected={mobileActiveTab === "video"}
          >
            <Sparkles size={12} />
            <span>陪伴</span>
          </button>
          <button
            type="button"
            className={`saki-island-pill ${mobileActiveTab === "chat" ? "active" : ""} ${chatPulseAlert && mobileActiveTab === "video" ? "has-pulse-alert" : ""}`}
            onClick={() => {
              setMobileActiveTab("chat");
              setChatPulseAlert(false);
            }}
            role="tab"
            aria-selected={mobileActiveTab === "chat"}
          >
            <MessageSquare size={12} />
            <span>聊天</span>
            {chatPulseAlert && mobileActiveTab === "video" ? (
              <span className="saki-island-breathing-light" aria-label="输出完成" />
            ) : null}
          </button>
        </div>

        <div className="saki-video-header-right">
          <div className="saki-video-favorability-badge" title={favBadgeTitle}>
            <div className={`saki-favorability-heart-wrap ${favorabilityPop ? "pop" : ""}`}>
              <Heart size={32} className="saki-favorability-heart fill-rose-500 text-rose-400" />
              <span className={`saki-favorability-heart-level ${favInfo.level >= 100 ? "three-digits" : favInfo.level >= 10 ? "two-digits" : ""}`}>
                {favInfo.level}
              </span>
            </div>

            <div className="saki-favorability-tooltip" role="tooltip">
              <div className="tooltip-title">
                {isEn ? "Affection " : isTw ? "好感度 " : "好感度 "}Lv.{favInfo.level} · {favInfo.title}
              </div>
              <div className="tooltip-exp-bar">
                <div className="tooltip-exp-fill" style={{ width: `${favInfo.levelProgress}%` }} />
              </div>
              <div className="tooltip-exp-nums">
                <span>{favInfo.currentExp} / {favInfo.maxExpForLevel} EXP</span>
                <span>{favInfo.levelProgress}%</span>
              </div>
            </div>

            {favorabilityPop ? (
              <span key={favorabilityPop.id} className="saki-favorability-gain-float">
                +{favorabilityPop.amount} EXP
              </span>
            ) : null}
          </div>

          <button
            className="saki-video-close-btn"
            type="button"
            title={isEn ? "Close Saki" : isTw ? "關閉 Saki" : "关闭 Saki"}
            aria-label={isEn ? "Close Saki" : isTw ? "關閉 Saki" : "关闭 Saki"}
            onClick={closeSakiPanel}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="saki-video-stage">
        <div
          ref={sakiCharacterRef}
          className={`saki-video-character-wrap mood-${artMood} ${effectiveActivityMood ?? ""} ${isDragOverSaki ? "saki-drag-hover" : ""} ${sakiEchoState === "speaking" ? "saki-speaking" : ""} ${isSakiListening ? "saki-hearing" : ""}`}
          onPointerDown={handleSakiCharacterPointerDown}
          onPointerUp={handleSakiCharacterPointerUp}
          onPointerCancel={handleSakiCharacterPointerCancel}
          onLostPointerCapture={handleSakiCharacterPointerCancel}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSakiPoke();
            }
          }}
          title={isEn ? "Tap to poke, hold to speak" : isTw ? "點按戳戳，長按說話" : "点按戳戳，长按说话"}
          role="button"
          tabIndex={0}
        >
          {draggingFood && draggingFood.isDragging ? (
            <div className={`saki-feed-target-indicator ${isDragOverSaki ? "ready" : ""}`}>
              <div className="target-pulse-ring">
                <Heart size={22} className="fill-rose-400 text-rose-400" />
              </div>
            </div>
          ) : null}

          {videoBubbleText ? (
            <div
              className={`saki-video-bubble ${isStreamingReply || (videoBubbleText && videoBubbleText.length > 25) ? "streaming-reply" : ""}`}
              aria-live="polite"
            >
              <div ref={videoBubbleRef} className="saki-video-bubble-content">
                {isStreamingReply || (videoBubbleText && videoBubbleText.length > 25) ? (
                  <div className="saki-video-bubble-markdown">
                    <MarkdownContent content={videoBubbleText} />
                    {isStreamingReply ? (
                      <span className="saki-bubble-typing-cursor">▌</span>
                    ) : null}
                  </div>
                ) : (
                  <span style={{ unicodeBidi: "isolate" }}>{videoBubbleText}</span>
                )}
              </div>
            </div>
          ) : null}
          <SakiCharacterArt mood={artMood} activityMood={effectiveActivityMood} />
          <div className="saki-video-carpet-shadow" aria-hidden="true" />
        </div>
      </div>

      {feedMenuOpen ? (
        <div className="saki-feed-drawer">
          <div className="saki-feed-items">
            {getLocalizedFoodMenu(language).map((food) => {
              const canAfford = isUnlimitedPoints || numericSakiPoints >= food.cost;
              const isCurrentDragging = Boolean(draggingFood && draggingFood.food.id === food.id && draggingFood.isDragging);
              const costUnit = isEn ? " pt" : isTw ? " 點" : "分";
              const costTooltip = canAfford
                ? `${food.name} (${food.cost} ${isEn ? "pts" : isTw ? "積分" : "积分"})`
                : `${isEn ? "Insufficient points" : isTw ? "積分不足" : "积分不足"} (${food.cost})`;
              return (
                <button
                  key={food.id}
                  className={`saki-feed-card ${!canAfford ? "disabled" : ""} ${isCurrentDragging ? "dragging" : ""}`}
                  type="button"
                  title={costTooltip}
                  onPointerDown={(e) => startFoodDrag(e, food)}
                >
                  <div className="saki-feed-card-img-wrap">
                    <img src={food.image} alt={food.name} draggable={false} />
                  </div>
                  <div className="saki-feed-card-info">
                    <span className="food-name">{food.name}</span>
                    <div className="food-meta">
                      <span className="food-cost">{food.cost}{costUnit}</span>
                      <span className="food-fav">+{food.favorability}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Dragging Food Floating Ghost */}
      {draggingFood && draggingFood.isDragging ? (
        <div
          className={`saki-dragging-food-ghost ${isDragOverSaki ? "over-target" : ""}`}
          style={{
            left: `${draggingFood.currentX}px`,
            top: `${draggingFood.currentY}px`
          }}
        >
          <img src={draggingFood.food.image} alt={draggingFood.food.name} draggable={false} />
        </div>
      ) : null}

      <div className="saki-video-controls" role="toolbar" aria-label="视频通话控制">
        <button
          className={`saki-video-btn ${listening ? "active pulse" : ""}`}
          type="button"
          title={listening ? "关闭麦克风 (停止语音识别)" : "开启麦克风 (语音输入)"}
          aria-label="麦克风"
          onClick={toggleSpeechInput}
        >
          {listening ? <Mic size={17} /> : <MicOff size={17} />}
        </button>
        <button
          className={`saki-video-btn ${miniGameActive ? "active" : ""}`}
          type="button"
          title={isEn ? "Saki Phone (Mini-games)" : isTw ? "星夢手機 (選擇小遊戲玩耍)" : "星梦手机 (选择小游戏玩耍)"}
          aria-label={isEn ? "Mini-games" : "小游戏中心"}
          onClick={() => {
            setFeedMenuOpen(false);
            setMiniGameActive((prev) => {
              const next = !prev;
              if (!next) {
                setActiveGame(null);
                setSakiPokeMood(null);
              } else {
                setActiveGame(null);
              }
              return next;
            });
          }}
        >
          <Gamepad2 size={17} />
        </button>
        <button
          className={`saki-video-btn ${feedMenuOpen ? "active" : ""}`}
          type="button"
          title="投喂 Saki (花费积分买食物提升好感度)"
          aria-label="投喂食物"
          onClick={() => {
            setFeedMenuOpen((prev) => !prev);
          }}
        >
          <UtensilsCrossed size={17} />
        </button>
        <button
          className={`saki-video-btn mobile-switch-to-chat ${chatPulseAlert && mobileActiveTab === "video" ? "pulse-alert" : ""}`}
          type="button"
          title="切换到聊天对话"
          aria-label="切换到聊天"
          onClick={() => {
            setMobileActiveTab("chat");
            setChatPulseAlert(false);
          }}
        >
          <MessageSquare size={17} />
          {chatPulseAlert && mobileActiveTab === "video" ? (
            <span className="saki-dock-breathing-dot" aria-hidden="true" />
          ) : null}
        </button>
        <button
          className="saki-video-btn hangup"
          type="button"
          title="挂断视频通话"
          aria-label="挂断"
          onClick={closeSakiPanel}
        >
          <PhoneOff size={17} />
        </button>
      </div>
    </div>
  );
});
