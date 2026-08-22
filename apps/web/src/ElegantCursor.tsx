import React, { useEffect, useRef, useState } from "react";

interface Stardust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  maxLife: number;
  life: number;
  hue: number; // 330 (pink) to 280 (purple)
}

interface FlashBloom {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  hue: number;
}

export function ElegantCursor() {
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Disable on touch-only devices
    if (window.matchMedia("(pointer: coarse)").matches) return;
    setMounted(true);
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
    let rafId: number;
    let lastMoveTime = 0;

    const stardusts: Stardust[] = [];
    const blooms: FlashBloom[] = [];

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });

    function resizeCanvas() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function spawnClickBloom(x: number, y: number) {
      // Add radiant flash blooms
      blooms.push({
        x,
        y,
        radius: 4,
        maxRadius: isHovering ? 64 : 50,
        alpha: 0.85,
        hue: 330, // Sakura pink
      });

      blooms.push({
        x,
        y,
        radius: 2,
        maxRadius: isHovering ? 90 : 75,
        alpha: 0.5,
        hue: 275, // Lavender
      });

      // Spawn glowing starburst particles
      const count = 7;
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
          hue: i % 2 === 0 ? 330 : 275,
        });
      }
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

      // Calculate movement velocity
      const dx = mouseX - prevMouseX;
      const dy = mouseY - prevMouseY;
      const dist = Math.hypot(dx, dy);

      // Spawn trail sparkles when moving with velocity
      if (dist > 4 && Math.random() < 0.38) {
        const angle = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5) * 0.8;
        const speed = 0.3 + Math.random() * 1.1;
        stardusts.push({
          x: mouseX + (Math.random() - 0.5) * 6,
          y: mouseY + (Math.random() - 0.5) * 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.1,
          size: 1.2 + Math.random() * 1.4,
          alpha: 0.7,
          maxLife: 20 + Math.floor(Math.random() * 12),
          life: 0,
          hue: Math.random() < 0.6 ? 330 : 275,
        });
      }

      prevMouseX = mouseX;
      prevMouseY = mouseY;

      // Check if hovering interactive element
      const target = e.target as HTMLElement | null;
      if (target) {
        const interactive = Boolean(
          target.closest(
            'button, a, input, textarea, select, [role="button"], label, .icon-button, .link-button, .tab-item, summary, .clickable, .saki-chip, .saki-model-btn, .saki-permission-btn, [tabindex]:not([tabindex="-1"])'
          )
        );
        isHovering = interactive;
      }
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
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mousedown", onMouseDown, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("mouseenter", onMouseEnter);

    let time = 0;

    function loop() {
      time += 0.03;

      // Smooth lag follower for ambient fluid aura
      const ease = 0.16;
      glowX += (mouseX - glowX) * ease;
      glowY += (mouseY - glowY) * ease;

      if (ctx && canvas) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        const isDark = document.documentElement.getAttribute("data-theme") === "dark";

        // 1. Draw Ambient Fluid Light Aura
        if (isVisible && glowX > -100 && glowY > -100) {
          const breathing = Math.sin(time) * 8;
          const baseRadius = (isHovering ? 200 : 160) + breathing;

          // Multi-stop radial soft aura
          const grad = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, baseRadius);

          if (isDark) {
            const coreAlpha = isHovering ? 0.18 : 0.12;
            const midAlpha = isHovering ? 0.08 : 0.05;
            grad.addColorStop(0, `rgba(255, 155, 200, ${coreAlpha})`);
            grad.addColorStop(0.35, `rgba(192, 132, 252, ${midAlpha})`);
            grad.addColorStop(0.7, `rgba(147, 197, 253, ${midAlpha * 0.4})`);
            grad.addColorStop(1, "rgba(255, 255, 255, 0)");
          } else {
            const coreAlpha = isHovering ? 0.14 : 0.09;
            const midAlpha = isHovering ? 0.06 : 0.035;
            grad.addColorStop(0, `rgba(255, 117, 172, ${coreAlpha})`);
            grad.addColorStop(0.35, `rgba(168, 85, 247, ${midAlpha})`);
            grad.addColorStop(0.7, `rgba(125, 211, 252, ${midAlpha * 0.4})`);
            grad.addColorStop(1, "rgba(255, 255, 255, 0)");
          }

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(glowX, glowY, baseRadius, 0, Math.PI * 2);
          ctx.fill();

          // Subtle inner bright glint when hovering
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

        // 2. Draw Click Flash Blooms / Ethereal Shockwaves
        for (let i = blooms.length - 1; i >= 0; i--) {
          const b = blooms[i];
          if (!b) continue;

          b.radius += (b.maxRadius - b.radius) * 0.14;
          b.alpha *= 0.87;

          // Draw radiant expansion ring
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${b.hue}, 85%, ${isDark ? "72%" : "65%"}, ${b.alpha})`;
          ctx.lineWidth = 2 * (b.alpha / 0.85);
          ctx.stroke();

          // Soft inner fill glow
          const ringGrad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
          ringGrad.addColorStop(0, `hsla(${b.hue}, 90%, 75%, ${b.alpha * 0.35})`);
          ringGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
          ctx.fillStyle = ringGrad;
          ctx.fill();

          if (b.alpha < 0.02 || b.radius >= b.maxRadius - 1) {
            blooms.splice(i, 1);
          }
        }

        // 3. Draw Luminous Stardust Particles
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

          // Glowing starlet
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.fillStyle = `hsla(${p.hue}, 90%, ${isDark ? "78%" : "68%"}, ${currentAlpha})`;
          ctx.shadowBlur = 6;
          ctx.shadowColor = `hsla(${p.hue}, 90%, 70%, ${currentAlpha * 0.8})`;

          ctx.beginPath();
          ctx.arc(0, 0, p.size * (1 - progress * 0.4), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          if (p.life >= p.maxLife) {
            stardusts.splice(i, 1);
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("mouseenter", onMouseEnter);
    };
  }, [mounted]);

  if (!mounted) return null;

  return <canvas ref={canvasRef} className="elegant-cursor-canvas" />;
}
