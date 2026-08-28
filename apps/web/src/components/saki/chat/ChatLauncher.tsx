import React from "react";
import { SakiCharacterArt, type SakiArtMood } from "../SakiComponents.js";

export interface ChatLauncherProps {
  open: boolean;
  sakiLieMode: boolean;
  launcherRef: React.RefObject<HTMLButtonElement | null>;
  launcherDragging: boolean;
  launcherEdgeAttached: boolean;
  launcherEdge: string;
  launcherStyle?: React.CSSProperties | undefined;
  sakiFileHoverActive: boolean;
  fileDragActive: boolean;
  artMood: SakiArtMood;
  draggingExpression?: string | null | undefined;
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
  launcherDragging,
  launcherEdgeAttached,
  launcherEdge,
  launcherStyle,
  sakiFileHoverActive,
  fileDragActive,
  artMood,
  draggingExpression,
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
  if (sakiLieMode) return null;

  return (
    <button
      ref={launcherRef}
      className={`saki-launcher ${launcherDragging ? "is-dragging" : ""} ${sakiFileHoverActive ? "drop-ready" : ""} ${open ? "hiding" : ""} ${launcherEdgeAttached ? `edge-attached edge-${launcherEdge}` : ""}`}
      type="button"
      title="Saki"
      aria-label="打开 Saki"
      style={launcherStyle}
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
      />
    </button>
  );
}
