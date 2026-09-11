import { useEffect, useRef, useState } from "react";
import { isPerfLite, onPerformanceModeChange } from "./perf.js";

interface Stardust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  maxLife: number;
  life: number;
  hue: number;
}

interface FlashBloom {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  hue: number;
}

const maxStardust = 40;
const maxBlooms = 6;

type GlowStop = readonly [number, string];
interface GlowVariant {
  radius: number;
  stops: readonly GlowStop[];
}
type GlowVariantKey =
  | "agent-dark"
  | "agent-light"
  | "hover-dark"
  | "base-dark"
  | "hover-light"
  | "base-light"
  | "glint-agent-dark"
  | "glint-agent-light"
  | "glint-hover-dark"
  | "glint-hover-light";

// Precomputed gradient definitions (identical colors/alphas/stops as before).
// Each variant is rendered once onto an offscreen sprite canvas and blitted
// with drawImage, so the rAF loop allocates zero gradients per frame.
const GLOW_VARIANTS: Record<GlowVariantKey, GlowVariant> = {
  "agent-dark": {
    radius: 115,
    stops: [
      [0, "rgba(255, 255, 255, 0.07)"],
      [0.45, "rgba(235, 242, 255, 0.025)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "agent-light": {
    radius: 115,
    stops: [
      [0, "rgba(255, 255, 255, 0.11)"],
      [0.45, "rgba(255, 248, 252, 0.035)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "hover-dark": {
    radius: 200,
    stops: [
      [0, "rgba(255, 155, 200, 0.18)"],
      [0.4, "rgba(192, 132, 252, 0.08)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "base-dark": {
    radius: 160,
    stops: [
      [0, "rgba(255, 155, 200, 0.12)"],
      [0.4, "rgba(192, 132, 252, 0.05)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "hover-light": {
    radius: 200,
    stops: [
      [0, "rgba(255, 117, 172, 0.14)"],
      [0.4, "rgba(168, 85, 247, 0.06)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "base-light": {
    radius: 160,
    stops: [
      [0, "rgba(255, 117, 172, 0.09)"],
      [0.4, "rgba(168, 85, 247, 0.035)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "glint-agent-dark": {
    radius: 20,
    stops: [
      [0, "rgba(255, 255, 255, 0.12)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "glint-agent-light": {
    radius: 20,
    stops: [
      [0, "rgba(255, 255, 255, 0.22)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "glint-hover-dark": {
    radius: 32,
    stops: [
      [0, "rgba(255, 180, 215, 0.22)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  "glint-hover-light": {
    radius: 32,
    stops: [
      [0, "rgba(255, 150, 190, 0.18)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  }
};

export function ElegantCursor() {
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sync = () => setMounted(!isPerfLite());
    sync();
    return onPerformanceModeChange(sync);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    let mouseX = -500;
    let mouseY = -500;
    let prevMouseX = -500;
    let prevMouseY = -500;
    let glowX = -500;
    let glowY = -500;
    let isHovering = false;
    let isAgentInput = false;
    let isVisible = false;
    let rafId = 0;
    let lastMoveTime = 0;
    let lastHoverCheck = 0;
    let time = 0;
    let isDark = document.documentElement.getAttribute("data-theme") === "dark";
    let dpr = 1;

    const stardusts: Stardust[] = [];
    const blooms: FlashBloom[] = [];

    // Offscreen sprite per glow variant, rendered once (per DPR) and reused
    // via drawImage — radial glows are position-independent, only the blit
    // origin moves with the cursor.
    const glowSpriteCache = new Map<GlowVariantKey, HTMLCanvasElement>();
    function getGlowSprite(key: GlowVariantKey): HTMLCanvasElement | null {
      const cached = glowSpriteCache.get(key);
      if (cached) return cached;
      const variant = GLOW_VARIANTS[key];
      const size = Math.max(2, Math.ceil(variant.radius * 2 * dpr));
      const sprite = document.createElement("canvas");
      sprite.width = size;
      sprite.height = size;
      const spriteCtx = sprite.getContext("2d");
      if (!spriteCtx) return null;
      spriteCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = variant.radius;
      const grad = spriteCtx.createRadialGradient(r, r, 0, r, r, r);
      for (const [offset, color] of variant.stops) {
        grad.addColorStop(offset, color);
      }
      spriteCtx.fillStyle = grad;
      spriteCtx.beginPath();
      spriteCtx.arc(r, r, r, 0, Math.PI * 2);
      spriteCtx.fill();
      glowSpriteCache.set(key, sprite);
      return sprite;
    }

    // Cache for particle color strings: keyed by (hue, theme, kind, alpha
    // quantized to 1/1000) so the draw loop does not allocate a new
    // `hsla(...)` string per particle per frame.
    const fxColorCache = new Map<number, string>();
    function fxColor(hue: number, dark: boolean, kind: 0 | 1, alpha: number): string {
      const q = alpha <= 0 ? 0 : alpha >= 1 ? 1000 : Math.round(alpha * 1000);
      const key = ((hue * 2 + (dark ? 1 : 0)) * 2 + kind) * 1001 + q;
      const cached = fxColorCache.get(key);
      if (cached !== undefined) return cached;
      const a = q / 1000;
      const s =
        kind === 0
          ? `hsla(${hue}, 85%, ${dark ? "72%" : "65%"}, ${a})`
          : `hsla(${hue}, 90%, ${dark ? "78%" : "68%"}, ${a})`;
      fxColorCache.set(key, s);
      return s;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true, desynchronized: true });

    function resizeCanvas() {
      if (!canvas) return;
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (nextDpr !== dpr) glowSpriteCache.clear();
      dpr = nextDpr;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    resizeCanvas();

    const themeObserver = new MutationObserver(() => {
      isDark = document.documentElement.getAttribute("data-theme") === "dark";
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    function capFx() {
      if (stardusts.length > maxStardust) stardusts.splice(0, stardusts.length - maxStardust);
      if (blooms.length > maxBlooms) blooms.splice(0, blooms.length - maxBlooms);
    }

    function spawnClickBloom(x: number, y: number) {
      blooms.push({
        x,
        y,
        radius: 4,
        maxRadius: isHovering ? 64 : 50,
        alpha: 0.85,
        hue: 330
      });
      blooms.push({
        x,
        y,
        radius: 2,
        maxRadius: isHovering ? 90 : 75,
        alpha: 0.5,
        hue: 275
      });

      const count = 6;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = 1.4 + Math.random() * 2.4;
        stardusts.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1.6 + Math.random() * 1.8,
          alpha: 0.95,
          maxLife: 26 + Math.floor(Math.random() * 14),
          life: 0,
          hue: i % 2 === 0 ? 330 : 275
        });
      }
      capFx();
      ensureLoop();
    }

    function ensureLoop() {
      if (!rafId) rafId = requestAnimationFrame(loop);
    }

    function onMouseMove(e: MouseEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      lastMoveTime = performance.now();

      if (!isVisible) {
        isVisible = true;
        glowX = mouseX;
        glowY = mouseY;
        prevMouseX = mouseX;
        prevMouseY = mouseY;
      }

      const dx = mouseX - prevMouseX;
      const dy = mouseY - prevMouseY;
      const dist = Math.hypot(dx, dy);

      if (!isAgentInput && dist > 5 && stardusts.length < maxStardust && Math.random() < 0.28) {
        const angle = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5) * 0.8;
        const speed = 0.3 + Math.random() * 1.1;
        stardusts.push({
          x: mouseX + (Math.random() - 0.5) * 6,
          y: mouseY + (Math.random() - 0.5) * 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.1,
          size: 1.2 + Math.random() * 1.4,
          alpha: 0.7,
          maxLife: 18 + Math.floor(Math.random() * 10),
          life: 0,
          hue: Math.random() < 0.6 ? 330 : 275
        });
      }

      prevMouseX = mouseX;
      prevMouseY = mouseY;

      if (lastMoveTime - lastHoverCheck > 80) {
        lastHoverCheck = lastMoveTime;
        const target = e.target as HTMLElement | null;
        isAgentInput = Boolean(
          target?.closest(".saki-input-container, .saki-composer") &&
          !target?.closest('button, [role="button"], .icon-button, .saki-chip, .saki-model-btn')
        );
        isHovering = Boolean(
          target?.closest(
            'button, a, input, textarea, select, [role="button"], label, .icon-button, .link-button, .tab-item, summary, .clickable, .saki-chip, .saki-model-btn, .saki-permission-btn'
          )
        );
      }
      ensureLoop();
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      spawnClickBloom(e.clientX, e.clientY);
    }

    function onMouseLeave() {
      isVisible = false;
    }

    function onMouseEnter() {
      isVisible = true;
      ensureLoop();
    }

    function onVisibility() {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        return;
      }
      ensureLoop();
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mousedown", onMouseDown, { passive: true });
    window.addEventListener("resize", resizeCanvas, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("mouseenter", onMouseEnter);
    document.addEventListener("visibilitychange", onVisibility);

    function loop(now: number) {
      time += 0.03;
      const hasFx = blooms.length > 0 || stardusts.length > 0;
      const moving = Math.hypot(mouseX - glowX, mouseY - glowY) > 0.35;
      const recentlyMoved = now - lastMoveTime < 220;

      if (document.hidden || (!isVisible && !hasFx)) {
        if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        rafId = 0;
        return;
      }

      glowX += (mouseX - glowX) * 0.16;
      glowY += (mouseY - glowY) * 0.16;

      if (ctx && canvas) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        if (isVisible && glowX > -100 && glowY > -100) {
          const breathing = recentlyMoved ? Math.sin(time) * 8 : 0;
          const variantKey: GlowVariantKey = isAgentInput
            ? isDark
              ? "agent-dark"
              : "agent-light"
            : isDark
              ? isHovering
                ? "hover-dark"
                : "base-dark"
              : isHovering
                ? "hover-light"
                : "base-light";
          const variant = GLOW_VARIANTS[variantKey];
          const baseRadius = variant.radius + breathing;
          const glowSprite = getGlowSprite(variantKey);
          if (glowSprite) {
            ctx.drawImage(glowSprite, glowX - baseRadius, glowY - baseRadius, baseRadius * 2, baseRadius * 2);
          }

          if (isAgentInput) {
            // Subtle, pure translucent glass glint highlight
            const glintSprite = getGlowSprite(isDark ? "glint-agent-dark" : "glint-agent-light");
            if (glintSprite) {
              ctx.drawImage(glintSprite, mouseX - 20, mouseY - 20, 40, 40);
            }
          } else if (isHovering) {
            const glintSprite = getGlowSprite(isDark ? "glint-hover-dark" : "glint-hover-light");
            if (glintSprite) {
              ctx.drawImage(glintSprite, mouseX - 32, mouseY - 32, 64, 64);
            }
          }
        }

        for (let i = blooms.length - 1; i >= 0; i--) {
          const b = blooms[i];
          if (!b) continue;
          b.radius += (b.maxRadius - b.radius) * 0.14;
          b.alpha *= 0.87;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
          ctx.strokeStyle = fxColor(b.hue, isDark, 0, b.alpha);
          ctx.lineWidth = 2 * (b.alpha / 0.85);
          ctx.stroke();
          if (b.alpha < 0.02 || b.radius >= b.maxRadius - 1) blooms.splice(i, 1);
        }

        for (let i = stardusts.length - 1; i >= 0; i--) {
          const p = stardusts[i];
          if (!p) continue;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.94;
          p.vy *= 0.94;
          p.life++;
          const progress = p.life / p.maxLife;
          const currentAlpha = (1 - progress) * p.alpha;
          ctx.fillStyle = fxColor(p.hue, isDark, 1, currentAlpha);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - progress * 0.4), 0, Math.PI * 2);
          ctx.fill();
          if (p.life >= p.maxLife) stardusts.splice(i, 1);
        }
      }

      if (!hasFx && !moving && !recentlyMoved) {
        rafId = 0;
        return;
      }
      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      themeObserver.disconnect();
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("mouseenter", onMouseEnter);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mounted]);

  if (!mounted) return null;

  return <canvas ref={canvasRef} className="elegant-cursor-canvas" />;
}
