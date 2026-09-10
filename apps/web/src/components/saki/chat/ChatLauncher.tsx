import React, { useEffect, useRef, useState } from "react";
import { SakiCharacterArt, type SakiArtMood } from "../SakiComponents.js";
import { SakiDesktopPet } from "../pet/SakiDesktopPet.js";
import { SakiPetDesktopBits } from "../pet/SakiPetWidgets.js";
import { isSakiPetTouchUi, type SakiPetController } from "../pet/sakiPetState.js";

function usePetTouchUi() {
  const [touchUi, setTouchUi] = useState(() => isSakiPetTouchUi());
  useEffect(() => {
    const hover = window.matchMedia("(hover: none)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const sync = () => setTouchUi(hover.matches || coarse.matches);
    hover.addEventListener("change", sync);
    coarse.addEventListener("change", sync);
    return () => {
      hover.removeEventListener("change", sync);
      coarse.removeEventListener("change", sync);
    };
  }, []);
  return touchUi;
}

function pinchDistance(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export interface ChatLauncherProps {
  open: boolean;
  sakiLieMode: boolean;
  launcherRef: React.RefObject<HTMLButtonElement | null>;
  petStageRef?: React.RefObject<HTMLDivElement | null>;
  launcherDragging: boolean;
  launcherEdgeAttached: boolean;
  launcherEdge: string;
  launcherStyle?: React.CSSProperties | undefined;
  sakiFileHoverActive: boolean;
  fileDragActive: boolean;
  artMood: SakiArtMood;
  draggingExpression?: string | null | undefined;
  pet: SakiPetController;
  language?: string | undefined;
  intimacyLevel: number;
  intimacyTitle: string;
  foods: Array<{ id: string; name: string; image: string; cost: number; favorability: number; desc: string }>;
  canAfford: (cost: number) => boolean;
  onFeed: (foodId: string) => void;
  onCaptureSticker: () => void;
  onIntimacy?: ((amount: number) => void) | undefined;
  onOpenChat: () => void;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}

export function ChatLauncher({
  open,
  sakiLieMode,
  launcherRef,
  petStageRef,
  launcherDragging,
  launcherEdgeAttached,
  launcherEdge,
  launcherStyle,
  sakiFileHoverActive,
  fileDragActive,
  artMood,
  draggingExpression,
  pet,
  language,
  intimacyLevel,
  intimacyTitle,
  foods,
  canAfford,
  onFeed,
  onCaptureSticker,
  onIntimacy,
  onOpenChat,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop
}: ChatLauncherProps) {
  const touchUi = usePetTouchUi();
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const menuOpen = pet.hovered || pet.widget !== null || pet.group !== "none";

  useEffect(() => {
    if (sakiLieMode || !touchUi || !menuOpen || open) return;
    const onPointerDown = (event: PointerEvent) => {
      const stage = petStageRef?.current;
      if (!stage) return;
      const target = event.target;
      if (target instanceof Node && stage.contains(target)) return;
      pet.dismissMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [sakiLieMode, touchUi, menuOpen, open, pet.dismissMenu, petStageRef]);

  if (sakiLieMode) {
    return <SakiPetDesktopBits pet={pet} language={language} />;
  }

  const petPose = launcherDragging
    ? null
    : launcherEdgeAttached
    ? "peek"
    : pet.behavior === "idle"
    ? null
    : pet.behavior;

  return (
    <div
      ref={petStageRef}
      className={`saki-pet-stage ${launcherDragging ? "is-dragging" : ""} ${sakiFileHoverActive ? "drop-ready" : ""} ${open ? "hiding" : ""} ${launcherEdgeAttached ? `edge-attached edge-${launcherEdge}` : ""} ${touchUi ? "is-touch" : ""} pet-${pet.behavior} skin-${pet.skin}`}
      style={{
        ...launcherStyle,
        ["--saki-pet-scale" as string]: String(pet.scale)
      }}
      onMouseEnter={touchUi ? undefined : () => pet.setHover(true)}
      onMouseLeave={touchUi ? undefined : () => pet.setHover(false)}
      onWheel={(event) => {
        if (event.cancelable) event.preventDefault();
        pet.onWheelScale(event.deltaY);
      }}
      onTouchStart={(event) => {
        if (event.touches.length === 2) {
          event.preventDefault();
          pinchRef.current = {
            distance: pinchDistance(event.touches[0]!, event.touches[1]!),
            scale: pet.scale
          };
        }
      }}
      onTouchMove={(event) => {
        const pinch = pinchRef.current;
        if (!pinch || event.touches.length !== 2) return;
        event.preventDefault();
        const distance = pinchDistance(event.touches[0]!, event.touches[1]!);
        if (pinch.distance <= 0) return;
        pet.setScale(pinch.scale * (distance / pinch.distance));
      }}
      onTouchEnd={(event) => {
        if (event.touches.length < 2) pinchRef.current = null;
      }}
      onTouchCancel={() => {
        pinchRef.current = null;
      }}
    >
      <button
        ref={launcherRef}
        className={`saki-launcher ${launcherDragging ? "is-dragging" : ""} ${sakiFileHoverActive ? "drop-ready" : ""} ${open ? "hiding" : ""} ${launcherEdgeAttached ? `edge-attached edge-${launcherEdge}` : ""}`}
        type="button"
        title="Saki"
        aria-label={touchUi ? "打开 Saki 菜单" : "打开 Saki"}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className="saki-launcher-glow" />
        <SakiCharacterArt
          mood={artMood}
          compact
          fileDrop={fileDragActive}
          edgeAttached={launcherEdgeAttached}
          dragging={launcherDragging}
          draggingExpressionSrc={draggingExpression ?? null}
          petPose={petPose}
        />
      </button>
      <SakiPetDesktopBits pet={pet} language={language} />
      {!open ? (
        <SakiDesktopPet
          pet={pet}
          language={language}
          intimacyLevel={intimacyLevel}
          intimacyTitle={intimacyTitle}
          edge={launcherEdge}
          visible={!launcherDragging}
          foods={foods}
          canAfford={canAfford}
          onFeed={onFeed}
          onOpenChat={() => {
            pet.dismissMenu();
            onOpenChat();
          }}
          onCaptureSticker={onCaptureSticker}
          onIntimacy={onIntimacy}
        />
      ) : null}
    </div>
  );
}
