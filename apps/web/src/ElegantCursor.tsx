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
    let isVisible = false;
    let rafId = 0;
    let lastMoveTime = 0;
    let lastHoverCheck = 0;
    let time = 0;
    let isDark = document.documentElement.getAttribute("data-theme") === "dark";
    let dpr = 1;

    const stardusts: Stardust[] = [];
    const blooms: FlashBloom[] = [];

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true, desynchronized: true });

    function resizeCanvas() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
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

      if (dist > 5 && stardusts.length < maxStardust && Math.random() < 0.28) {
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
          const baseRadius = (isHovering ? 200 : 160) + breathing;
          const grad = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, baseRadius);

          if (isDark) {
            const coreAlpha = isHovering ? 0.18 : 0.12;
            const midAlpha = isHovering ? 0.08 : 0.05;
            grad.addColorStop(0, `rgba(255, 155, 200, ${coreAlpha})`);
            grad.addColorStop(0.4, `rgba(192, 132, 252, ${midAlpha})`);
            grad.addColorStop(1, "rgba(255, 255, 255, 0)");
          } else {
            const coreAlpha = isHovering ? 0.14 : 0.09;
            const midAlpha = isHovering ? 0.06 : 0.035;
            grad.addColorStop(0, `rgba(255, 117, 172, ${coreAlpha})`);
            grad.addColorStop(0.4, `rgba(168, 85, 247, ${midAlpha})`);
            grad.addColorStop(1, "rgba(255, 255, 255, 0)");
          }

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(glowX, glowY, baseRadius, 0, Math.PI * 2);
          ctx.fill();

          if (isHovering) {
            const glintGrad = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, 32);
            glintGrad.addColorStop(0, isDark ? "rgba(255, 180, 215, 0.22)" : "rgba(255, 150, 190, 0.18)");
            glintGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
            ctx.fillStyle = glintGrad;
            ctx.beginPath();
            ctx.arc(mouseX, mouseY, 32, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        for (let i = blooms.length - 1; i >= 0; i--) {
          const b = blooms[i];
          if (!b) continue;
          b.radius += (b.maxRadius - b.radius) * 0.14;
          b.alpha *= 0.87;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${b.hue}, 85%, ${isDark ? "72%" : "65%"}, ${b.alpha})`;
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
          ctx.fillStyle = `hsla(${p.hue}, 90%, ${isDark ? "78%" : "68%"}, ${currentAlpha})`;
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
