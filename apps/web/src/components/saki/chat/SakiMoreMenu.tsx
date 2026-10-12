import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function SakiMoreMenu({
  label = "更多操作",
  align = "left",
  children
}: {
  label?: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && ref.current) {
        ref.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useIsomorphicLayoutEffect(() => {
    if (!open || !contentRef.current || !ref.current) return;
    const content = contentRef.current;

    const adjustPosition = () => {
      content.style.transform = "";
      content.classList.remove("drop-down", "drop-up");

      const contentRect = content.getBoundingClientRect();
      const container =
        ref.current?.closest(".saki-messages-inner") ||
        ref.current?.closest(".saki-messages") ||
        null;

      const containerRect = container
        ? container.getBoundingClientRect()
        : { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 };

      const minLeft = containerRect.left + 8;
      const maxRight = containerRect.right - 8;

      let shiftX = 0;
      if (contentRect.left < minLeft) {
        shiftX = Math.round(minLeft - contentRect.left);
      } else if (contentRect.right > maxRight) {
        shiftX = Math.round(maxRight - contentRect.right);
      }

      if (shiftX !== 0) {
        content.style.transform = `translateX(${shiftX}px)`;
      }

      if (contentRect.top < containerRect.top + 8 && contentRect.bottom + contentRect.height <= containerRect.bottom) {
        content.classList.add("drop-down");
      }
    };

    adjustPosition();
    window.addEventListener("resize", adjustPosition);
    return () => window.removeEventListener("resize", adjustPosition);
  }, [open]);

  return (
    <details
      ref={ref}
      className={`saki-more-menu align-${align}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          if (ref.current) ref.current.open = false;
          ref.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        <MoreHorizontal size={16} />
      </summary>
      <div
        ref={contentRef}
        className="saki-more-menu-content"
        onClick={(event) => {
          if ((event.target as Element).closest("button") && ref.current) {
            ref.current.open = false;
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}
