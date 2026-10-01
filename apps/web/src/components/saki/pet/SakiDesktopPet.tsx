import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bath,
  CalendarDays,
  Camera,
  ClipboardList,
  Clock,
  DoorClosed,
  Heart,
  MessageSquare,
  Moon,
  PawPrint,
  Sparkles,
  Stethoscope,
  StickyNote,
  Timer,
  UtensilsCrossed,
  Mic2,
  X
} from "lucide-react";
import type { SakiPetController, SakiPetWidget } from "./sakiPetState.js";
import { SakiPetWidgetCard } from "./SakiPetWidgets.js";
import { getSakiAffectionQuote } from "../sakiChatHelpers.js";
import { panelT } from "../../../i18n/translations.js";
import { sampleLuminanceAtPoint } from "../sakiLuminance.js";

function detectUnderlyingBackdrop(stage: HTMLElement, root: HTMLElement | null): "light" | "dark" {
  const stageRect = stage.getBoundingClientRect();
  const samplePoints: Array<[number, number]> = [];

  samplePoints.push([stageRect.left + stageRect.width / 2, stageRect.top + stageRect.height / 2]);
  samplePoints.push([stageRect.left + stageRect.width / 2, stageRect.top + stageRect.height * 0.2]);
  samplePoints.push([stageRect.left + stageRect.width * 0.2, stageRect.top + stageRect.height * 0.4]);
  samplePoints.push([stageRect.left + stageRect.width * 0.8, stageRect.top + stageRect.height * 0.4]);

  if (root && root.offsetParent !== null) {
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width > 0 && rootRect.height > 0) {
      samplePoints.push([rootRect.left + rootRect.width / 2, rootRect.top + rootRect.height / 2]);
      samplePoints.push([rootRect.left + rootRect.width * 0.25, rootRect.top + rootRect.height * 0.3]);
      samplePoints.push([rootRect.left + rootRect.width * 0.75, rootRect.top + rootRect.height * 0.3]);
    }
  }

  let totalLuminance = 0;
  for (const [sx, sy] of samplePoints) {
    totalLuminance += sampleLuminanceAtPoint(sx, sy, stage, ".saki-pet-stage");
  }
  const avgLuminance = totalLuminance / samplePoints.length;

  return avgLuminance > 0.45 ? "light" : "dark";
}

function toggleWidget(pet: SakiPetController, widget: SakiPetWidget) {
  if (pet.widget === widget) pet.closeWidget();
  else pet.openWidget(widget);
}

export function SakiDesktopPet({
  pet,
  language,
  intimacyLevel,
  intimacyTitle,
  edge,
  visible,
  foods,
  canAfford,
  onFeed,
  onOpenChat,
  onCaptureSticker,
  onIntimacy
}: {
  pet: SakiPetController;
  language?: string | undefined;
  intimacyLevel: number;
  intimacyTitle: string;
  edge: string;
  visible: boolean;
  foods: Array<{ id: string; name: string; image: string; cost: number; favorability: number; desc: string }>;
  canAfford: (cost: number) => boolean;
  onFeed: (foodId: string) => void;
  onOpenChat: () => void;
  onCaptureSticker: () => void;
  onIntimacy?: ((amount: number) => void) | undefined;
}) {
  const t = (k: Parameters<typeof panelT>[1]) => panelT(language || "zh-CN", k);
  const showChrome = visible && (pet.hovered || pet.widget !== null || pet.group !== "none");
  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"left" | "right">("right");
  const [backdrop, setBackdrop] = useState<"light" | "dark">("light");

  useLayoutEffect(() => {
    const root = rootRef.current;
    const stage = root?.closest(".saki-pet-stage");
    if (!root || !(stage instanceof HTMLElement)) return;

    const updatePlacement = () => {
      const stageRect = stage.getBoundingClientRect();
      const isRightSide = stageRect.left + stageRect.width / 2 > window.innerWidth / 2;
      const nextSide = edge === "right" ? "left" : edge === "left" ? "right" : isRightSide ? "left" : "right";
      setSide(nextSide);

      const nextBackdrop = detectUnderlyingBackdrop(stage, root);
      stage.setAttribute("data-backdrop", nextBackdrop);
      root.setAttribute("data-backdrop", nextBackdrop);
      setBackdrop(nextBackdrop);
    };

    updatePlacement();
    const resizeObserver = new ResizeObserver(updatePlacement);
    resizeObserver.observe(stage);

    let placeRaf = 0;
    const scheduleUpdate = () => {
      if (placeRaf) return;
      placeRaf = requestAnimationFrame(() => {
        placeRaf = 0;
        updatePlacement();
      });
    };
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(stage, { attributes: true, attributeFilter: ["style", "class"] });

    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    return () => {
      if (placeRaf) cancelAnimationFrame(placeRaf);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", scheduleUpdate);
    };
  }, [edge, pet.scale, pet.behavior]);

  const careActions = useMemo(
    () => [
      {
        id: "feed",
        label: t("saki.pet.feed"),
        icon: <UtensilsCrossed size={16} />,
        color: "#fb923c",
        active: pet.widget === "feed",
        onClick: () => toggleWidget(pet, "feed")
      },
      {
        id: "pet",
        label: t("saki.pet.petAction"),
        icon: <Heart size={16} />,
        color: "#f43f5e",
        onClick: () => {
          pet.applyCare("pet");
          onIntimacy?.(3);
          const quote = getSakiAffectionQuote(intimacyLevel, language);
          pet.showBubble(quote, 3400);
        }
      },
      {
        id: "bath",
        label: t("saki.pet.bath"),
        icon: <Bath size={16} />,
        color: "#38bdf8",
        onClick: () => {
          pet.applyCare("bath");
          onIntimacy?.(4);
          pet.showBubble(t("saki.pet.bathBubble"));
        }
      },
      {
        id: "sleep",
        label: t("saki.pet.sleep"),
        icon: <Moon size={16} />,
        color: "#a78bfa",
        onClick: () => {
          pet.applyCare("sleep");
          onIntimacy?.(2);
          pet.showBubble(t("saki.pet.nappingBubble"));
        }
      },
      {
        id: "doctor",
        label: t("saki.pet.doctor"),
        icon: <Stethoscope size={16} />,
        color: "#10b981",
        onClick: () => {
          pet.applyCare("doctor");
          onIntimacy?.(2);
          pet.showBubble(t("saki.pet.doctorBubble"));
        }
      },
      {
        id: "toilet",
        label: t("saki.pet.toilet"),
        icon: <DoorClosed size={16} />,
        color: "#f59e0b",
        onClick: () => {
          pet.applyCare("toilet");
          onIntimacy?.(2);
          pet.showBubble(t("saki.pet.toiletBubble"));
        }
      },
      {
        id: "pose",
        label: `姿态: ${
          pet.behavior === "sit"
            ? t("saki.pet.poseSit")
            : pet.behavior === "lie"
            ? t("saki.pet.poseLie")
            : pet.behavior === "roll"
            ? t("saki.pet.poseRoll")
            : t("saki.pet.poseStand")
        }`,
        icon: <Sparkles size={16} />,
        color: "#ec4899",
        onClick: () => {
          const nextPose =
            pet.behavior === "idle"
              ? "sit"
              : pet.behavior === "sit"
              ? "lie"
              : pet.behavior === "lie"
              ? "roll"
              : "idle";
          pet.startBehavior(nextPose, nextPose === "roll" ? 2200 : 14000);
          pet.showBubble(
            nextPose === "sit"
              ? "🪑 Saki 乖乖坐好啦～"
              : nextPose === "lie"
              ? "🛌 Saki 想要躺平休息～"
              : nextPose === "roll"
              ? "🌀 Saki 开心地打了个滚！"
              : "✨ Saki 站起来啦！"
          );
        }
      }
    ],
    [pet, onIntimacy, t]
  );

  const toolActions = useMemo(
    () => [
      {
        id: "todo",
        label: t("saki.pet.todo"),
        icon: <ClipboardList size={16} />,
        color: "#8b5cf6",
        active: pet.widget === "todo",
        onClick: () => toggleWidget(pet, "todo")
      },
      {
        id: "schedule",
        label: t("saki.pet.agenda"),
        icon: <Clock size={16} />,
        color: "#06b6d4",
        active: pet.widget === "schedule",
        onClick: () => toggleWidget(pet, "schedule")
      },
      {
        id: "pomodoro",
        label: t("saki.pet.timer"),
        icon: <Timer size={16} />,
        color: "#f43f5e",
        active: pet.widget === "pomodoro",
        onClick: () => toggleWidget(pet, "pomodoro")
      },
      {
        id: "notes",
        label: t("saki.pet.notes"),
        icon: <StickyNote size={16} />,
        color: "#eab308",
        active: pet.widget === "notes",
        onClick: () => toggleWidget(pet, "notes")
      },
      {
        id: "sticker",
        label: t("saki.pet.sticker"),
        icon: <Camera size={16} />,
        color: "#ec4899",
        active: pet.widget === "sticker",
        onClick: () => toggleWidget(pet, "sticker")
      },
      {
        id: "music",
        label: t("saki.pet.sing"),
        icon: <Mic2 size={16} />,
        color: "#10b981",
        active: pet.widget === "music",
        onClick: () => toggleWidget(pet, "music")
      }
    ],
    [pet, t]
  );

  const [displayedGroup, setDisplayedGroup] = useState<"companion" | "tools" | "none">(pet.group);
  const [isClosingGroup, setIsClosingGroup] = useState(false);
  const closeGroupTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (pet.group !== "none") {
      if (closeGroupTimerRef.current !== null) {
        window.clearTimeout(closeGroupTimerRef.current);
        closeGroupTimerRef.current = null;
      }
      setDisplayedGroup(pet.group);
      setIsClosingGroup(false);
    } else if (displayedGroup !== "none") {
      setIsClosingGroup(true);
      closeGroupTimerRef.current = window.setTimeout(() => {
        setDisplayedGroup("none");
        setIsClosingGroup(false);
      }, 220);
    }
    return () => {
      if (closeGroupTimerRef.current !== null) {
        window.clearTimeout(closeGroupTimerRef.current);
      }
    };
  }, [pet.group, displayedGroup]);

  const subArcActions =
    displayedGroup === "companion" ? careActions : displayedGroup === "tools" ? toolActions : null;

  return (
    <div ref={rootRef} className={`saki-pet-agent-layer side-${side} ${showChrome ? "is-active" : ""}`}>
      {pet.bubble ? (
        <div
          ref={bubbleRef}
          className="saki-pet-bubble"
          data-backdrop={backdrop}
          onClick={(e) => {
            e.stopPropagation();
            onOpenChat();
          }}
          title="点击展开完整聊天"
          role="button"
          tabIndex={0}
        >
          {pet.bubble}
        </div>
      ) : null}

      {pet.fx !== "none" ? <div className={`saki-pet-fx fx-${pet.fx}`} aria-hidden="true" /> : null}

      {pet.dueEvents.length > 0 ? (
        <div className="saki-pet-due-dot" title={pet.dueEvents[0]?.title}>
          !
        </div>
      ) : null}

      <div
        className={`saki-pet-arc-wrapper side-${side} ${showChrome ? "is-open" : ""}`}
        data-backdrop={backdrop}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="saki-pet-arc-dock">
          <svg className="saki-pet-arc-track-svg" viewBox="0 0 40 140" aria-hidden="true">
            <path
              d={side === "right" ? "M 6 12 Q 28 70 6 128" : "M 34 12 Q 12 70 34 128"}
              className="saki-pet-arc-track-path"
            />
          </svg>

          <button
            type="button"
            className={`saki-pet-arc-btn companion ${pet.group === "companion" ? "active" : ""}`}
            title={t("saki.pet.care")}
            aria-label={t("saki.pet.care")}
            onClick={() => pet.setGroup(pet.group === "companion" ? "none" : "companion")}
          >
            <div className="saki-pet-arc-btn-icon">
              <PawPrint size={18} />
            </div>
            <span className="saki-pet-arc-btn-tooltip">{t("saki.pet.care")}</span>
          </button>

          <button
            type="button"
            className="saki-pet-arc-btn chat"
            title={t("saki.pet.chat")}
            aria-label={t("saki.pet.chat")}
            onClick={onOpenChat}
          >
            <div className="saki-pet-arc-btn-icon">
              <MessageSquare size={19} />
            </div>
            <span className="saki-pet-arc-btn-tooltip">{t("saki.pet.chat")}</span>
          </button>

          <button
            type="button"
            className={`saki-pet-arc-btn tools ${pet.group === "tools" ? "active" : ""}`}
            title={t("saki.pet.tools")}
            aria-label={t("saki.pet.tools")}
            onClick={() => pet.setGroup(pet.group === "tools" ? "none" : "tools")}
          >
            <div className="saki-pet-arc-btn-icon">
              <ClipboardList size={18} />
            </div>
            <span className="saki-pet-arc-btn-tooltip">{t("saki.pet.tools")}</span>
          </button>
        </div>

        {subArcActions && subArcActions.length > 0 ? (
          <div
            className={`saki-pet-sub-arc-wrapper side-${side} ${isClosingGroup ? "is-closing" : "is-entering"}`}
            data-backdrop={backdrop}
          >
            <div className="saki-pet-sub-arc-dock">
              <svg className="saki-pet-sub-arc-track-svg" viewBox="0 0 50 320" aria-hidden="true" preserveAspectRatio="none">
                <path
                  className="saki-pet-arc-track-path"
                  d={
                    side === "right"
                      ? "M 6 12 Q 44 160 6 308"
                      : "M 44 12 Q 6 160 44 308"
                  }
                />
              </svg>

              {subArcActions.map((act, index) => {
                const N = subArcActions.length;
                const mid = (N - 1) / 2;
                const norm = (index - mid) / mid;
                const curveFactor = 1 - norm * norm;
                const maxDisplacement = 22;
                const offsetX = Math.round(
                  side === "right" ? curveFactor * maxDisplacement : -curveFactor * maxDisplacement
                );
                const enterDelay = index * 26;
                const exitDelay = (N - 1 - index) * 14;
                const animDelay = isClosingGroup ? exitDelay : enterDelay;

                return (
                  <button
                    key={act.id}
                    type="button"
                    className={`saki-pet-sub-arc-btn ${act.active ? "active" : ""}`}
                    style={
                      {
                        "--arc-x": `${offsetX}px`,
                        animationDelay: `${animDelay}ms`
                      } as React.CSSProperties
                    }
                    title={act.label}
                    aria-label={act.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      act.onClick();
                    }}
                  >
                    <div className="saki-pet-sub-arc-btn-icon" style={{ color: act.color }}>
                      {act.icon}
                    </div>
                    <span className="saki-pet-sub-arc-btn-tooltip">{act.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <SakiPetWidgetCard
        pet={pet}
        language={language}
        edge={edge}
        below={false}
        foods={foods}
        canAfford={canAfford}
        onFeed={onFeed}
        onCaptureSticker={onCaptureSticker}
        side={side}
      />
    </div>
  );
}
