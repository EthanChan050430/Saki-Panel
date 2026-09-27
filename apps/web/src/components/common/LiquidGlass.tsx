import React, {
  type CSSProperties,
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  displacementMap,
  polarDisplacementMap,
  prominentDisplacementMap,
} from "./liquid-glass-utils.js";
import {
  generateLiquidGlassMap,
  ShaderDisplacementGenerator,
  createSizedLiquidGlassFragment,
} from "./liquid-glass-shader.js";

export type LiquidGlassMode = "standard" | "polar" | "prominent" | "shader";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : React.useEffect;

const generateShaderDisplacementMap = (
  width: number,
  height: number,
  cornerRadius = 24,
  zoom = 1.15,
  refractionIntensity = 1.2,
): { dataUrl: string; scale: number } => {
  return generateLiquidGlassMap({
    physicalWidth: width,
    physicalHeight: height,
    cornerRadius,
    zoom,
    refractionIntensity,
  });
};

const getMap = (mode: LiquidGlassMode, shaderMapUrl?: string) => {
  switch (mode) {
    case "standard":
      return shaderMapUrl || displacementMap;
    case "polar":
      return polarDisplacementMap;
    case "prominent":
      return prominentDisplacementMap;
    case "shader":
      return shaderMapUrl || displacementMap;
    default:
      return shaderMapUrl || displacementMap;
  }
};

const GlassFilter: React.FC<{
  id: string;
  scale: number;
  displacementScale: number;
  aberrationIntensity?: number | undefined;
  width: number;
  height: number;
  mode: LiquidGlassMode;
  shaderMapUrl?: string | undefined;
}> = ({
  id,
  scale,
  displacementScale,
  width,
  height,
  mode,
  shaderMapUrl,
}) => {
  const map = getMap(mode, shaderMapUrl);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const baseScale = scale || 24;
  const factor = displacementScale ? displacementScale / 100 : 1;
  const finalScale = baseScale * factor;

  const svgContent = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width="0"
      height="0"
      style={{
        position: "absolute",
        top: "-9999px",
        left: "-9999px",
        width: 0,
        height: 0,
        opacity: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      <defs>
        <filter
          id={id}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
          x="0"
          y="0"
          width={w}
          height={h}
        >
          <feImage
            id={`${id}_map`}
            width={w}
            height={h}
            preserveAspectRatio="none"
            result="DISPLACEMENT_MAP"
            href={map}
            xlinkHref={map}
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="DISPLACEMENT_MAP"
            scale={finalScale}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(svgContent, document.body);
  }
  return svgContent;
};

const useFirefox = () => {
  const [isFirefox, setIsFirefox] = useState(false);
  React.useEffect(() => {
    setIsFirefox(typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("firefox"));
  }, []);
  return isFirefox;
};

const assignRef = <T,>(forwarded: React.ForwardedRef<T>, node: T | null) => {
  if (typeof forwarded === "function") forwarded(node);
  else if (forwarded) (forwarded as React.MutableRefObject<T | null>).current = node;
};

export interface SharedGlassProps {
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  cornerRadius?: number;
  zoom?: number;
  refractionIntensity?: number;
  mode?: LiquidGlassMode;
}

function useGlassSize() {
  const glassRef = useRef<HTMLElement | null>(null);
  const [glassSize, setGlassSize] = useState({ width: 300, height: 60 });

  useIsomorphicLayoutEffect(() => {
    const el = glassRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextW = Math.round(rect.width);
        const nextH = Math.round(rect.height);
        setGlassSize((prev) =>
          prev.width === nextW && prev.height === nextH
            ? prev
            : { width: nextW, height: nextH },
        );
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return { glassRef, glassSize };
}

function useShaderMap(
  mode: LiquidGlassMode,
  width: number,
  height: number,
  cornerRadius = 24,
  zoom = 1.15,
  refractionIntensity = 1.2,
) {
  return useMemo(() => {
    if (typeof window === "undefined" || (mode !== "standard" && mode !== "shader")) {
      return { dataUrl: displacementMap, scale: 24 };
    }
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    try {
      return generateShaderDisplacementMap(w, h, cornerRadius, zoom, refractionIntensity);
    } catch (err) {
      console.warn("Liquid glass shader map generation fallback:", err);
      return { dataUrl: displacementMap, scale: 24 };
    }
  }, [mode, width, height, cornerRadius, zoom, refractionIntensity]);
}

const GlassShell: React.FC<{
  filterId: string;
  displacementScale: number;
  scale: number;
  blurAmount: number;
  saturation: number;
  aberrationIntensity?: number;
  cornerRadius: number;
  mode: LiquidGlassMode;
  shaderMapUrl?: string | undefined;
  glassSize: { width: number; height: number };
  isFirefox: boolean;
  mouseOffset: { x: number; y: number };
  children: React.ReactNode;
}> = ({
  filterId,
  displacementScale,
  scale,
  blurAmount: _blurAmount,
  saturation: _saturation,
  aberrationIntensity,
  cornerRadius,
  mode,
  shaderMapUrl,
  glassSize,
  isFirefox: _isFirefox,
  mouseOffset: _mouseOffset,
  children,
}) => {
  const radius = `${cornerRadius}px`;

  return (
    <>
      <GlassFilter
        id={filterId}
        scale={scale}
        displacementScale={displacementScale}
        aberrationIntensity={aberrationIntensity}
        width={glassSize.width}
        height={glassSize.height}
        mode={mode}
        shaderMapUrl={shaderMapUrl}
      />
      {/* Backdrop Refraction Layer */}
      <span
        className="glass__warp liquid-glass-warp"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {/* Liquid Glass Inner Content */}
      <div className="liquid-glass-inner" style={{ position: "relative", zIndex: 1, width: "100%", height: "100%" }}>
        {children}
      </div>
    </>
  );
};

export interface LiquidGlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, SharedGlassProps {
  elasticity?: number;
  overLight?: boolean;
}

export const LiquidGlassButton = forwardRef<HTMLButtonElement, LiquidGlassButtonProps>(
  (
    {
      children,
      displacementScale = 100,
      blurAmount = 0,
      saturation = 108,
      aberrationIntensity = 1.5,
      cornerRadius = 18,
      zoom = 1.15,
      refractionIntensity = 1.2,
      mode = "shader",
      className = "",
      style,
      elasticity: _elasticity,
      overLight: _overLight,
      onClick,
      onMouseEnter,
      onMouseLeave,
      onMouseDown,
      onMouseUp,
      onMouseMove,
      ...buttonProps
    },
    forwardedRef,
  ) => {
    const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const isFirefox = useFirefox();
    const { glassRef, glassSize } = useGlassSize();
    const { dataUrl: shaderMapUrl, scale } = useShaderMap(
      mode,
      glassSize.width,
      glassSize.height,
      cornerRadius,
      zoom,
      refractionIntensity,
    );
    const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
    const rootRef = useRef<HTMLButtonElement | null>(null);

    const updateMouse = useCallback((event: React.MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMouseOffset({
        x: ((event.clientX - (rect.left + rect.width / 2)) / rect.width) * 100,
        y: ((event.clientY - (rect.top + rect.height / 2)) / rect.height) * 100,
      });
    }, []);

    const activeFilterId = `lg_btn_${rawId}_${glassSize.width}x${glassSize.height}`;
    const filterUrl = `url(#${activeFilterId})`;
    const blurPart = blurAmount && blurAmount > 0 ? `blur(${blurAmount}px) ` : "";
    const backdropFilterValue = isFirefox
      ? `blur(${blurAmount && blurAmount > 0 ? blurAmount : 16}px) saturate(180%) contrast(1.05) brightness(1.05)`
      : `${filterUrl} ${blurPart}contrast(1.08) brightness(1.04) saturate(1.15)`;

    return (
      <button
        ref={(node) => {
          rootRef.current = node;
          glassRef.current = node;
          assignRef(forwardedRef, node);
        }}
        type="button"
        className={`liquid-glass-btn glass liquid-glass-face ${className}`}
        style={{
          position: "relative",
          borderRadius: `${cornerRadius}px`,
          overflow: "hidden",
          backdropFilter: backdropFilterValue,
          WebkitBackdropFilter: backdropFilterValue,
          ...style,
        }}
        onClick={onClick}
        onMouseMove={(event) => {
          updateMouse(event);
          onMouseMove?.(event);
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={(event) => {
          setMouseOffset({ x: 0, y: 0 });
          onMouseLeave?.(event);
        }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        {...buttonProps}
      >
        <GlassShell
          filterId={activeFilterId}
          displacementScale={displacementScale}
          scale={scale}
          blurAmount={blurAmount}
          saturation={saturation}
          aberrationIntensity={aberrationIntensity}
          cornerRadius={cornerRadius}
          mode={mode}
          shaderMapUrl={shaderMapUrl}
          glassSize={glassSize}
          isFirefox={isFirefox}
          mouseOffset={mouseOffset}
        >
          {children}
        </GlassShell>
      </button>
    );
  },
);

LiquidGlassButton.displayName = "LiquidGlassButton";

export interface LiquidGlassContainerProps
  extends React.HTMLAttributes<HTMLDivElement>, SharedGlassProps {
  elasticity?: number;
  overLight?: boolean;
}

export const LiquidGlassContainer = forwardRef<HTMLDivElement, LiquidGlassContainerProps>(
  (
    {
      children,
      displacementScale = 100,
      blurAmount = 0,
      saturation = 108,
      aberrationIntensity = 1.5,
      cornerRadius = 24,
      zoom = 1.15,
      refractionIntensity = 1.2,
      mode = "shader",
      className = "",
      style,
      elasticity: _elasticity,
      overLight: _overLight,
      onMouseMove,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      ...divProps
    },
    forwardedRef,
  ) => {
    const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const isFirefox = useFirefox();
    const { glassRef, glassSize } = useGlassSize();
    const { dataUrl: shaderMapUrl, scale } = useShaderMap(
      mode,
      glassSize.width,
      glassSize.height,
      cornerRadius,
      zoom,
      refractionIntensity,
    );
    const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
    const rootRef = useRef<HTMLDivElement | null>(null);

    const updateMouse = useCallback((event: React.MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMouseOffset({
        x: ((event.clientX - (rect.left + rect.width / 2)) / rect.width) * 100,
        y: ((event.clientY - (rect.top + rect.height / 2)) / rect.height) * 100,
      });
    }, []);

    const activeFilterId = `lg_cnt_${rawId}_${glassSize.width}x${glassSize.height}`;
    const filterUrl = `url(#${activeFilterId})`;
    const blurPart = blurAmount && blurAmount > 0 ? `blur(${blurAmount}px) ` : "";
    const backdropFilterValue = isFirefox
      ? `blur(${blurAmount && blurAmount > 0 ? blurAmount : 16}px) saturate(180%) contrast(1.05) brightness(1.05)`
      : `${filterUrl} ${blurPart}contrast(1.08) brightness(1.04) saturate(1.15)`;

    return (
      <div
        ref={(node) => {
          rootRef.current = node;
          glassRef.current = node;
          assignRef(forwardedRef, node);
        }}
        className={`liquid-glass-container glass liquid-glass-face ${className}`}
        style={{
          position: "relative",
          borderRadius: `${cornerRadius}px`,
          overflow: "hidden",
          backdropFilter: backdropFilterValue,
          WebkitBackdropFilter: backdropFilterValue,
          ...style,
        }}
        onMouseMove={(event) => {
          updateMouse(event);
          onMouseMove?.(event);
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={(event) => {
          setMouseOffset({ x: 0, y: 0 });
          onMouseLeave?.(event);
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        {...divProps}
      >
        <GlassShell
          filterId={activeFilterId}
          displacementScale={displacementScale}
          scale={scale}
          blurAmount={blurAmount}
          saturation={saturation}
          aberrationIntensity={aberrationIntensity}
          cornerRadius={cornerRadius}
          mode={mode}
          shaderMapUrl={shaderMapUrl}
          glassSize={glassSize}
          isFirefox={isFirefox}
          mouseOffset={mouseOffset}
        >
          {children}
        </GlassShell>
      </div>
    );
  },
);

LiquidGlassContainer.displayName = "LiquidGlassContainer";

export default LiquidGlassButton;
