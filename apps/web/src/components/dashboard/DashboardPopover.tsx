import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Render outside the glass compositor and all clipped workspace containers. */
export function DashboardPopover({ anchorRef, onClose, className = "", children, width = 300, popoverRef }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
  width?: number;
  popoverRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const menuRef = popoverRef ?? internalRef;
  const [position, setPosition] = useState({ left: 8, top: 8, width, maxHeight: 320, ready: false });

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const right = left + (viewport?.width ?? window.innerWidth) - 16;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
      const availableAbove = Math.max(0, Math.min(rect.top, bottom) - top - 8);
      const availableBelow = Math.max(0, bottom - Math.max(rect.bottom, top) - 8);
      const desiredHeight = Math.min(360, menu.scrollHeight);
      const above = availableBelow < desiredHeight && availableAbove > availableBelow;
      const maxHeight = Math.max(0, Math.min(360, bottom - top, above ? availableAbove : availableBelow));
      const height = Math.min(desiredHeight, maxHeight);
      const menuWidth = Math.min(width, right - left);
      setPosition({ left: Math.max(left, Math.min(rect.left, right - menuWidth)),
        top: Math.max(top, Math.min(above ? rect.top - height - 8 : rect.bottom + 8, bottom - height)), width: menuWidth, maxHeight, ready: true });
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) onClose();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      const anchor = anchorRef.current;
      (anchor?.matches("button") ? anchor : anchor?.querySelector<HTMLElement>("button"))?.focus();
    };
    update();
    const observer = new ResizeObserver(update);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", keyDown);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", keyDown);
    };
  }, [anchorRef, menuRef, onClose, width]);

  return createPortal(<div ref={menuRef} data-dashboard-popover className={`dashboard-dropdown-popover dashboard-portal-popover ${className}`}
    onClick={(event) => event.stopPropagation()}
    style={{ position: "fixed", left: position.left, top: position.top, bottom: "auto", width: position.width,
      minWidth: 0, maxWidth: "none", maxHeight: position.maxHeight, visibility: position.ready ? "visible" : "hidden" }}>
    {children}
  </div>, document.body);
}
