import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Bath,
  CalendarDays,
  Camera,
  ClipboardList,
  Clock,
  Heart,
  MessageSquare,
  Moon,
  PawPrint,
  Stethoscope,
  StickyNote,
  Timer,
  UtensilsCrossed,
  Mic2
} from "lucide-react";
import type { SakiPetController, SakiPetWidget } from "./sakiPetState.js";
import { weatherGlyph } from "./sakiPetState.js";
import { SakiPetWidgetCard } from "./SakiPetWidgets.js";
import { panelT } from "../../../i18n/translations.js";

function formatClock(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function StatBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`saki-pet-stat ${tone}`}>
      <span>{label}</span>
      <i>
        <b style={{ width: `${value}%` }} />
      </i>
    </div>
  );
}

const viewportPad = 8;
const moveThresholdPx = 24;

function overlayShouldSitBelow(
  stageRect: DOMRectReadOnly,
  overlayHeight: number,
  currentBelow: boolean,
  lockSide: boolean
): boolean {
  const spaceAbove = stageRect.top;
  const spaceBelow = window.innerHeight - stageRect.bottom;
  const need = overlayHeight + viewportPad;
  const fitsAbove = spaceAbove >= need;
  const fitsBelow = spaceBelow >= need;
  if (lockSide) {
    if (currentBelow) return fitsBelow || !fitsAbove;
    return fitsAbove || !fitsBelow ? false : true;
  }
  if (fitsAbove) return false;
  if (fitsBelow) return true;
  return spaceBelow > spaceAbove;
}

import { sampleLuminanceAtPoint } from "../sakiLuminance.js";

function detectUnderlyingBackdrop(stage: HTMLElement, chrome: HTMLElement | null): "light" | "dark" {
  const stageRect = stage.getBoundingClientRect();
  const samplePoints: Array<[number, number]> = [];

  samplePoints.push([stageRect.left + stageRect.width / 2, stageRect.top + stageRect.height / 2]);
  samplePoints.push([stageRect.left + stageRect.width / 2, stageRect.top + stageRect.height * 0.2]);
  samplePoints.push([stageRect.left + stageRect.width * 0.2, stageRect.top + stageRect.height * 0.4]);
  samplePoints.push([stageRect.left + stageRect.width * 0.8, stageRect.top + stageRect.height * 0.4]);

  if (chrome && chrome.offsetParent !== null) {
    const chromeRect = chrome.getBoundingClientRect();
    if (chromeRect.width > 0 && chromeRect.height > 0) {
      samplePoints.push([chromeRect.left + chromeRect.width / 2, chromeRect.top + chromeRect.height / 2]);
      samplePoints.push([chromeRect.left + chromeRect.width * 0.25, chromeRect.top + chromeRect.height * 0.3]);
      samplePoints.push([chromeRect.left + chromeRect.width * 0.75, chromeRect.top + chromeRect.height * 0.3]);
    }
  }

  let totalLuminance = 0;
  for (const [sx, sy] of samplePoints) {
    totalLuminance += sampleLuminanceAtPoint(sx, sy, stage, ".saki-pet-stage");
  }
  const avgLuminance = totalLuminance / samplePoints.length;

  return avgLuminance > 0.45 ? "light" : "dark";
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
  const chromeRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const sitBelowRef = useRef(false);
  const sessionOpenRef = useRef(false);
  const stageTopRef = useRef<number | null>(null);
  const backdropRef = useRef<"light" | "dark">("light");
  const [sitBelow, setSitBelow] = useState(false);
  const [backdrop, setBackdrop] = useState<"light" | "dark">("light");

  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    const stage = chrome?.closest(".saki-pet-stage");
    if (!chrome || !(stage instanceof HTMLElement)) return;

    const commit = (next: boolean) => {
      if (sitBelowRef.current === next) return;
      sitBelowRef.current = next;
      setSitBelow(next);
    };

    const place = (mode: "lock" | "unlock" = "lock") => {
      let overlayHeight = 0;
      if (showChrome) overlayHeight = Math.max(overlayHeight, chrome.getBoundingClientRect().height);
      if (bubbleRef.current) overlayHeight = Math.max(overlayHeight, bubbleRef.current.getBoundingClientRect().height + viewportPad);
      if (overlayHeight <= 0) {
        sessionOpenRef.current = false;
        stageTopRef.current = null;
      } else {
        const stageRect = stage.getBoundingClientRect();
        const moved =
          stageTopRef.current !== null && Math.abs(stageRect.top - stageTopRef.current) > moveThresholdPx;
        const next = overlayShouldSitBelow(
          stageRect,
          overlayHeight,
          sitBelowRef.current,
          sessionOpenRef.current && !moved && mode === "lock"
        );
        stageTopRef.current = stageRect.top;
        sessionOpenRef.current = true;
        commit(next);
      }

      // Dynamic background luminance detection
      const nextBackdrop = detectUnderlyingBackdrop(stage, chrome);
      stage.setAttribute("data-backdrop", nextBackdrop);
      chrome.setAttribute("data-backdrop", nextBackdrop);
      if (backdropRef.current !== nextBackdrop) {
        backdropRef.current = nextBackdrop;
        setBackdrop(nextBackdrop);
      }
    };

    place();
    const resizeObserver = new ResizeObserver(() => place("lock"));
    resizeObserver.observe(chrome);
    // Coalesce bursts of stage style/class mutations (e.g. per-frame drag writes)
    // into a single measurement pass per frame.
    let placeRaf = 0;
    const schedulePlace = () => {
      if (placeRaf) return;
      placeRaf = requestAnimationFrame(() => {
        placeRaf = 0;
        place("lock");
      });
    };
    const mutationObserver = new MutationObserver(schedulePlace);
    mutationObserver.observe(stage, { attributes: true, attributeFilter: ["style", "class"] });
    const onViewportResize = () => place("unlock");
    const onScroll = schedulePlace;
    window.addEventListener("resize", onViewportResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (placeRaf) cancelAnimationFrame(placeRaf);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", onViewportResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, [showChrome, pet.scale, pet.behavior, pet.bubble]);

  return (
    <>
      {pet.bubble ? (
        <div
          ref={bubbleRef}
          className={`saki-pet-bubble ${sitBelow ? "is-below" : ""}`}
          data-backdrop={backdrop}
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
        ref={chromeRef}
        className={`saki-pet-chrome ${showChrome ? "is-open" : ""} ${sitBelow ? "is-below" : ""}`}
        data-backdrop={backdrop}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="saki-pet-nameplate">
          <div className="saki-pet-nameplate-top">
            <span className="saki-pet-lv">
              <Heart size={10} />
              Lv.{intimacyLevel} {intimacyTitle}
            </span>
            <span className="saki-pet-ambient">
              <Clock size={10} />
              {formatClock(pet.nowMs)}
              {pet.weather ? (
                <>
                  <em>
                    {weatherGlyph(pet.weather.code)} {pet.weather.temp}°
                  </em>
                </>
              ) : null}
            </span>
          </div>
          <div className="saki-pet-stats">
            <StatBar label={t("saki.pet.hunger")} value={pet.stats.hunger} tone="hunger" />
            <StatBar label={t("saki.pet.mood")} value={pet.stats.mood} tone="mood" />
            <StatBar label={t("saki.pet.health")} value={pet.stats.health} tone="health" />
          </div>
        </div>

        <div className="saki-pet-orbit">
          <button
            type="button"
            className={`saki-pet-petal companion ${pet.group === "companion" ? "active" : ""}`}
            onClick={() => pet.setGroup(pet.group === "companion" ? "none" : "companion")}
          >
            <PawPrint size={13} />
            <span>{t("saki.pet.care")}</span>
          </button>
          <button type="button" className="saki-pet-petal chat" onClick={onOpenChat}>
            <MessageSquare size={14} />
            <span>{t("saki.pet.chat")}</span>
          </button>
          <button
            type="button"
            className={`saki-pet-petal tools ${pet.group === "tools" ? "active" : ""}`}
            onClick={() => pet.setGroup(pet.group === "tools" ? "none" : "tools")}
          >
            <ClipboardList size={13} />
            <span>{t("saki.pet.tools")}</span>
          </button>
        </div>

        {pet.group === "companion" ? (
          <div className="saki-pet-tray companion">
            <TrayChip
              icon={<UtensilsCrossed size={11} />}
              label={t("saki.pet.feed")}
              active={pet.widget === "feed"}
              onClick={() => toggleWidget(pet, "feed")}
            />
            <TrayChip
              icon={<Heart size={11} />}
              label={t("saki.pet.petAction")}
              onClick={() => {
                pet.applyCare("pet");
                onIntimacy?.(3);
                pet.showBubble(t("saki.pet.ticklesBubble"));
              }}
            />
            <TrayChip
              icon={<Moon size={11} />}
              label={t("saki.pet.sleep")}
              onClick={() => {
                pet.applyCare("sleep");
                onIntimacy?.(2);
                pet.showBubble(t("saki.pet.nappingBubble"));
              }}
            />
            <TrayChip
              icon={<Bath size={11} />}
              label={t("saki.pet.bath")}
              onClick={() => {
                pet.applyCare("bath");
                onIntimacy?.(4);
                pet.showBubble(t("saki.pet.bathBubble"));
              }}
            />
            <TrayChip
              icon={<Stethoscope size={11} />}
              label={t("saki.pet.doctor")}
              onClick={() => {
                pet.applyCare("doctor");
                onIntimacy?.(2);
                pet.showBubble(t("saki.pet.doctorBubble"));
              }}
            />
            <TrayChip
              icon={<PawPrint size={11} />}
              label={t("saki.pet.skins")}
              active={pet.widget === "skins"}
              onClick={() => toggleWidget(pet, "skins")}
            />
          </div>
        ) : null}

        {pet.group === "tools" ? (
          <div className="saki-pet-tray tools">
            <TrayChip
              icon={<ClipboardList size={11} />}
              label={t("saki.pet.todo")}
              active={pet.widget === "todo"}
              onClick={() => toggleWidget(pet, "todo")}
            />
            <TrayChip
              icon={<Clock size={11} />}
              label={t("saki.pet.agenda")}
              active={pet.widget === "schedule"}
              onClick={() => toggleWidget(pet, "schedule")}
            />
            <TrayChip
              icon={<Timer size={11} />}
              label={t("saki.pet.timer")}
              active={pet.widget === "pomodoro"}
              onClick={() => toggleWidget(pet, "pomodoro")}
            />
            <TrayChip
              icon={<StickyNote size={11} />}
              label={t("saki.pet.notes")}
              active={pet.widget === "notes"}
              onClick={() => toggleWidget(pet, "notes")}
            />
            <TrayChip
              icon={<Camera size={11} />}
              label={t("saki.pet.sticker")}
              active={pet.widget === "sticker"}
              onClick={() => toggleWidget(pet, "sticker")}
            />
            <TrayChip
              icon={<CalendarDays size={11} />}
              label={t("saki.pet.calendar")}
              active={pet.widget === "calendar"}
              onClick={() => toggleWidget(pet, "calendar")}
            />
            <TrayChip
              icon={<Mic2 size={11} />}
              label={t("saki.pet.sing")}
              active={pet.widget === "music"}
              onClick={() => toggleWidget(pet, "music")}
            />
          </div>
        ) : null}

        {pet.group === "companion" ? (
          <div className="saki-pet-play-row">
            <button
              type="button"
              className={pet.behavior === "idle" ? "active" : ""}
              onClick={() => pet.startBehavior("idle", 14000)}
            >
              {t("saki.pet.poseStand")}
            </button>
            <button
              type="button"
              className={pet.behavior === "sit" ? "active" : ""}
              onClick={() => pet.startBehavior(pet.behavior === "sit" ? "idle" : "sit", pet.behavior === "sit" ? 14000 : 10000)}
            >
              {t("saki.pet.poseSit")}
            </button>
            <button
              type="button"
              className={pet.behavior === "lie" ? "active" : ""}
              onClick={() => pet.startBehavior(pet.behavior === "lie" ? "idle" : "lie", pet.behavior === "lie" ? 14000 : 10000)}
            >
              {t("saki.pet.poseLie")}
            </button>
            <button
              type="button"
              className={pet.behavior === "roll" ? "active" : ""}
              onClick={() => pet.startBehavior("roll", 2200)}
            >
              {t("saki.pet.poseRoll")}
            </button>
          </div>
        ) : null}
      </div>

      <SakiPetWidgetCard
        pet={pet}
        language={language}
        edge={edge}
        below={sitBelow}
        foods={foods}
        canAfford={canAfford}
        onFeed={onFeed}
        onCaptureSticker={onCaptureSticker}
      />
    </>
  );
}

function toggleWidget(pet: SakiPetController, widget: SakiPetWidget) {
  if (pet.widget === widget) pet.closeWidget();
  else pet.openWidget(widget);
}

function TrayChip({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`saki-pet-chip ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

