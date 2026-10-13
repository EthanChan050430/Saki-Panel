import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, FileText, Sparkles, FileCode, Folder } from "lucide-react";
import type { SakiInputAttachment, SakiMentionCandidate } from "@webops/shared";
import { sakiAttachmentMentionToken, isSakiImageAttachment } from "@webops/shared";

export type SakiMentionMenuCandidate = SakiInputAttachment | SakiMentionCandidate;

export interface SakiMentionMenuProps {
  candidates: SakiMentionMenuCandidate[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: SakiMentionMenuCandidate) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  variant?: "dashboard" | "composer";
}

export function SakiMentionMenu({
  candidates,
  activeIndex,
  onHover,
  onSelect,
  anchorRef,
  variant = "dashboard"
}: SakiMentionMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  const [coords, setCoords] = useState<{
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
    ready: boolean;
  }>({
    left: 0,
    bottom: 0,
    width: 320,
    maxHeight: 240,
    ready: false
  });

  useLayoutEffect(() => {
    if (!anchorRef?.current) return;

    const updatePosition = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Available space between the top of the anchor and top edge of viewport
      const availableAbove = Math.max(80, rect.top - 16);
      const maxHeight = Math.min(260, availableAbove);
      const bottom = Math.max(8, viewportHeight - rect.top + 8);

      let width: number;
      let left: number;

      if (variant === "dashboard") {
        width = Math.min(480, Math.max(300, rect.width - 24));
        left = Math.max(12, Math.min(rect.left + 12, viewportWidth - width - 12));
      } else {
        width = Math.min(viewportWidth - 24, Math.max(280, rect.width));
        left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12));
      }

      setCoords({
        left,
        bottom,
        width,
        maxHeight,
        ready: true
      });
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchorRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, variant]);

  // Keep active option smoothly scrolled into view on keyboard navigation
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const menuContent = (
    <div
      className={`saki-mention-menu ${anchorRef ? "is-portal" : ""}`}
      role="listbox"
      aria-label="引用"
      style={
        anchorRef
          ? {
              position: "fixed",
              left: coords.left,
              bottom: coords.bottom,
              width: coords.width,
              maxHeight: coords.maxHeight,
              zIndex: 2147483640,
              visibility: coords.ready ? "visible" : "hidden"
            }
          : undefined
      }
    >
      <div className="saki-mention-header">
        <span className="saki-mention-title">引用</span>
        {candidates.length > 0 ? (
          <span className="saki-mention-count">{candidates.length}</span>
        ) : null}
      </div>

      <div className="saki-mention-list" ref={listRef}>
        {candidates.length === 0 ? (
          <div className="saki-mention-empty">无匹配项</div>
        ) : (
          candidates.map((item, index) => {
            const isSelected = index === activeIndex;
            const isSkill = "kind" in item && item.kind === "skill";
            const isWorkspaceFile = "kind" in item && item.kind === "file";
            const key = isSkill
              ? `skill-${item.id}`
              : isWorkspaceFile
              ? `file-${item.id}`
              : ("id" in item && item.id ? item.id : `${item.name}-${index}`);

            if (isSkill) {
              const skillCandidate = item as SakiMentionCandidate;
              return (
                <button
                  key={key}
                  ref={isSelected ? activeItemRef : undefined}
                  className={`saki-mention-item is-skill ${isSelected ? "active" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(skillCandidate);
                  }}
                >
                  <span className="saki-mention-icon is-skill">
                    <Sparkles size={14} />
                  </span>
                  <span className="saki-mention-copy">
                    <span className="saki-mention-name-row">
                      <strong>{skillCandidate.name}</strong>
                      <span className="saki-mention-badge">Skill</span>
                    </span>
                    <em>{skillCandidate.token}</em>
                    {skillCandidate.description ? (
                      <span className="saki-mention-desc" title={skillCandidate.description}>
                        {skillCandidate.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            }

            if (isWorkspaceFile) {
              const fileCandidate = item as SakiMentionCandidate;
              const isDir = Boolean(fileCandidate.file?.isDirectory);
              return (
                <button
                  key={key}
                  ref={isSelected ? activeItemRef : undefined}
                  className={`saki-mention-item is-file ${isSelected ? "active" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(fileCandidate);
                  }}
                >
                  <span className="saki-mention-icon is-file">
                    {isDir ? <Folder size={14} /> : <FileCode size={14} />}
                  </span>
                  <span className="saki-mention-copy">
                    <span className="saki-mention-name-row">
                      <strong>{fileCandidate.name}</strong>
                      <span className="saki-mention-badge is-file">工作区</span>
                    </span>
                    <em>{fileCandidate.file?.path || fileCandidate.token}</em>
                  </span>
                </button>
              );
            }

            const rawAttachment = "attachment" in item && item.attachment ? item.attachment : (item as SakiInputAttachment);
            const isImg = isSakiImageAttachment(rawAttachment);
            const token = "token" in item ? item.token : sakiAttachmentMentionToken(rawAttachment);

            return (
              <button
                key={key}
                ref={isSelected ? activeItemRef : undefined}
                className={`saki-mention-item ${isSelected ? "active" : ""}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                }}
              >
                {isImg && rawAttachment.dataUrl ? (
                  <img src={rawAttachment.dataUrl} alt="" draggable={false} />
                ) : (
                  <span className="saki-mention-icon">
                    {isImg ? <ImageIcon size={14} /> : <FileText size={14} />}
                  </span>
                )}
                <span className="saki-mention-copy">
                  <strong>{rawAttachment.name}</strong>
                  <em>{token}</em>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  if (anchorRef) {
    return createPortal(menuContent, document.body);
  }

  return menuContent;
}
