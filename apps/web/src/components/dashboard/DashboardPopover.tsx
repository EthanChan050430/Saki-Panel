import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Render outside the glass compositor and all clipped workspace containers. */
export function DashboardPopover({ anchorRef, onClose, className = "", children, width = 300 }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
  width?: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, width, maxHeight: 320, ready: false });

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      const availableAbove = Math.max(0, rect.top - 16);
      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - 16);
      const desiredHeight = Math.min(360, menu.scrollHeight);
      const above = availableBelow < desiredHeight && availableAbove > availableBelow;
      const maxHeight = Math.max(60, Math.min(360, above ? availableAbove : availableBelow));
      const height = Math.min(desiredHeight, maxHeight);
      const menuWidth = Math.min(width, window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
        top: Math.max(8, above ? rect.top - height - 8 : rect.bottom + 8), width: menuWidth, maxHeight, ready: true });
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) onClose();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    update();
    const observer = new ResizeObserver(update);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", keyDown);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", keyDown);
    };
  }, [anchorRef, onClose, width]);

  return createPortal(<div ref={menuRef} data-dashboard-popover className={`dashboard-dropdown-popover dashboard-portal-popover ${className}`}
    style={{ position: "fixed", left: position.left, top: position.top, bottom: "auto", width: position.width,
      minWidth: 0, maxWidth: "none", maxHeight: position.maxHeight, visibility: position.ready ? "visible" : "hidden" }}>
    {children}
  </div>, document.body);
}
