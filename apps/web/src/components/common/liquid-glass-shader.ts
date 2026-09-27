// Adapted directly from https://github.com/shuding/liquid-glass
// Realistic liquid glass lens shader: SDF-based magnification & meniscus edge refraction

export interface Vec2 {
  x: number;
  y: number;
}

export interface ShaderOptions {
  width: number;
  height: number;
  fragment: (uv: Vec2, mouse?: Vec2) => Vec2;
  mousePosition?: Vec2;
}

export interface ShaderResult {
  dataUrl: string;
  scale: number;
}

export function smoothStep(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * 2D Signed Distance Field (SDF) for a rounded rectangle.
 * Inside is negative, on the boundary is 0, outside is positive.
 */
export function roundedRectSDF(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): number {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

export function texture(x: number, y: number): Vec2 {
  return { x, y };
}

/**
 * Creates a sized liquid glass fragment function.
 * Combines physical lens magnification in the interior with a meniscus liquid rim refraction near edges,
 * matching the official shuding/liquid-glass SDF shader.
 */
export function createSizedLiquidGlassFragment(
  physicalWidth: number,
  physicalHeight: number,
  cornerRadius = 24,
  zoom = 1.15,
  refractionIntensity = 1.2,
): (uv: Vec2, mouse?: Vec2) => Vec2 {
  const w = Math.max(1, physicalWidth);
  const h = Math.max(1, physicalHeight);
  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.max(0, Math.min(cornerRadius, Math.min(halfW, halfH)));

  // Bevel rim width in screen pixels (responsive between 10px and 28px)
  const rimWidth = Math.max(10, Math.min(28, Math.min(halfW, halfH) * 0.45));
  const peakRimDisplacement = rimWidth * 0.75 * refractionIntensity;

  return (uv: Vec2, mouse?: Vec2): Vec2 => {
    // Current pixel coordinate in physical element space, centered at (0, 0)
    const px = (uv.x - 0.5) * w;
    const py = (uv.y - 0.5) * h;

    // Signed distance to rounded rectangle boundary
    const dist = roundedRectSDF(px, py, halfW, halfH, r);
    if (dist > 1.0) {
      return { x: uv.x, y: uv.y };
    }

    const depth = -dist; // depth > 0 inside the glass border

    // 1. Edge Refraction via SDF Normal Gradient (shuding meniscus bend)
    let rimDx = 0;
    let rimDy = 0;

    if (depth < rimWidth) {
      const eps = 1.0;
      const dX =
        roundedRectSDF(px + eps, py, halfW, halfH, r) -
        roundedRectSDF(px - eps, py, halfW, halfH, r);
      const dY =
        roundedRectSDF(px, py + eps, halfW, halfH, r) -
        roundedRectSDF(px, py - eps, halfW, halfH, r);
      const gradLen = Math.sqrt(dX * dX + dY * dY) || 1;
      const normX = dX / gradLen; // outward normal
      const normY = dY / gradLen;

      // Smooth meniscus profile: arch curve peaking near border, smoothly tapering inward
      const t = Math.max(0, depth / rimWidth);
      const rimFactor = Math.sin(t * Math.PI) * Math.pow(1 - t, 0.25);

      // Inward displacement towards the center axis
      rimDx = -normX * rimFactor * peakRimDisplacement;
      rimDy = -normY * rimFactor * peakRimDisplacement;
    }

    // 2. Center Lens Magnification (subtle zoom)
    const zoomDelta = zoom - 1.0;
    const interiorFactor = smoothStep(0, rimWidth, depth);
    const maxMag = Math.min(8, rimWidth * 0.35);
    const magDx = -(px / Math.max(1, halfW)) * zoomDelta * interiorFactor * maxMag;
    const magDy = -(py / Math.max(1, halfH)) * zoomDelta * interiorFactor * maxMag;

    // 3. Mouse Focus Interaction
    let mouseDx = 0;
    let mouseDy = 0;
    if (mouse && (mouse.x !== 0 || mouse.y !== 0)) {
      const mouseInfluence = smoothStep(0, 1, 1 - depth / Math.max(halfW, halfH)) * 0.08;
      mouseDx = mouse.x * Math.min(halfW, 30) * mouseInfluence;
      mouseDy = mouse.y * Math.min(halfH, 30) * mouseInfluence;
    }

    const totalDx = rimDx + magDx + mouseDx;
    const totalDy = rimDy + magDy + mouseDy;

    return {
      x: uv.x + totalDx / w,
      y: uv.y + totalDy / h,
    };
  };
}

export interface LiquidGlassShaderOptions {
  physicalWidth: number;
  physicalHeight: number;
  cornerRadius?: number;
  zoom?: number;
  refractionIntensity?: number;
  mousePosition?: Vec2;
  maxEdge?: number;
}

/**
 * Generates an SVG displacement map using the SDF fragment shader.
 * Encodes physical displacement vectors directly into RGB channels for feDisplacementMap.
 */
export function generateLiquidGlassMap(options: LiquidGlassShaderOptions): ShaderResult {
  const {
    physicalWidth,
    physicalHeight,
    cornerRadius = 24,
    zoom = 1.15,
    refractionIntensity = 1.2,
    mousePosition,
    maxEdge = 480,
  } = options;

  const srcW = Math.max(1, Math.round(physicalWidth));
  const srcH = Math.max(1, Math.round(physicalHeight));

  // Scaled canvas resolution capped for performance while ensuring smooth gradient sampling
  let canvasW = srcW;
  let canvasH = srcH;
  if (canvasW > maxEdge || canvasH > maxEdge) {
    if (canvasW >= canvasH) {
      canvasH = Math.max(16, Math.round((srcH / srcW) * maxEdge));
      canvasW = maxEdge;
    } else {
      canvasW = Math.max(16, Math.round((srcW / srcH) * maxEdge));
      canvasH = maxEdge;
    }
  }
  canvasW = Math.max(16, canvasW);
  canvasH = Math.max(16, canvasH);

  if (typeof document === "undefined") {
    return { dataUrl: "", scale: 24 };
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { dataUrl: "", scale: 24 };
  }

  const fragment = createSizedLiquidGlassFragment(
    srcW,
    srcH,
    cornerRadius,
    zoom,
    refractionIntensity,
  );

  let maxPhysicalDisplacement = 0;
  const totalPixels = canvasW * canvasH;
  const rawDx = new Float32Array(totalPixels);
  const rawDy = new Float32Array(totalPixels);

  let idx = 0;
  for (let y = 0; y < canvasH; y++) {
    const v = (y + 0.5) / canvasH;
    for (let x = 0; x < canvasW; x++) {
      const u = (x + 0.5) / canvasW;
      const pos = fragment({ x: u, y: v }, mousePosition);

      // pos is in normalized UV [0, 1]
      const dx = (pos.x - u) * srcW;
      const dy = (pos.y - v) * srcH;

      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX > maxPhysicalDisplacement) maxPhysicalDisplacement = absX;
      if (absY > maxPhysicalDisplacement) maxPhysicalDisplacement = absY;

      rawDx[idx] = dx;
      rawDy[idx] = dy;
      idx++;
    }
  }

  const maxDisp = Math.max(1, maxPhysicalDisplacement);
  const svgScale = maxDisp * 2;

  const imageData = ctx.createImageData(canvasW, canvasH);
  const data = imageData.data;

  for (let i = 0; i < totalPixels; i++) {
    const dx = rawDx[i]!;
    const dy = rawDy[i]!;

    // Normalized displacement in [-1, 1] mapped to [0, 1]
    const normDx = dx / maxDisp;
    const normDy = dy / maxDisp;

    const rVal = normDx * 0.5 + 0.5;
    const gVal = normDy * 0.5 + 0.5;

    const pixelIndex = i * 4;
    data[pixelIndex] = Math.max(0, Math.min(255, Math.round(rVal * 255)));
    data[pixelIndex + 1] = Math.max(0, Math.min(255, Math.round(gVal * 255)));
    data[pixelIndex + 2] = 0;
    data[pixelIndex + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  canvas.remove();

  return {
    dataUrl,
    scale: svgScale,
  };
}

export const fragmentShaders = {
  liquidGlass: (uv: Vec2): Vec2 => {
    const ix = uv.x - 0.5;
    const iy = uv.y - 0.5;
    const distanceToEdge = roundedRectSDF(ix, iy, 0.4, 0.35, 0.2);
    const displacement = smoothStep(0.6, 0, distanceToEdge - 0.1);
    const scaled = smoothStep(0, 1, displacement) * 0.88;
    return texture(ix * scaled + 0.5, iy * scaled + 0.5);
  },
};

export type FragmentShaderType = keyof typeof fragmentShaders;

/**
 * Generator that executes a fragment shader over a 2D canvas and outputs
 * an SVG displacement map image dataURL and computed maximum scale.
 */
export class ShaderDisplacementGenerator {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private canvasDPI = 1;

  constructor(private options: ShaderOptions) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.max(1, Math.round(options.width * this.canvasDPI));
    this.canvas.height = Math.max(1, Math.round(options.height * this.canvasDPI));
    this.canvas.style.display = "none";

    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Could not get 2D context");
    }
    this.context = context;
  }

  updateShader(mousePosition?: Vec2): ShaderResult {
    const w = this.canvas.width;
    const h = this.canvas.height;

    let maxScale = 0;
    const rawValues: number[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const uv: Vec2 = { x: x / w, y: y / h };
        const pos = this.options.fragment(uv, mousePosition);

        const dx = pos.x * w - x;
        const dy = pos.y * h - y;

        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
        rawValues.push(dx, dy);
      }
    }

    const maxDisplacement = Math.max(1, maxScale);
    const svgScale = maxDisplacement * 2;

    const imageData = this.context.createImageData(w, h);
    const data = imageData.data;

    let rawIndex = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = rawValues[rawIndex++] ?? 0;
        const dy = rawValues[rawIndex++] ?? 0;

        const normDx = dx / maxDisplacement;
        const normDy = dy / maxDisplacement;

        const r = normDx * 0.5 + 0.5;
        const g = normDy * 0.5 + 0.5;

        const pixelIndex = (y * w + x) * 4;
        data[pixelIndex] = Math.max(0, Math.min(255, Math.round(r * 255)));
        data[pixelIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        data[pixelIndex + 2] = 0;
        data[pixelIndex + 3] = 255;
      }
    }

    this.context.putImageData(imageData, 0, 0);

    return {
      dataUrl: this.canvas.toDataURL("image/png"),
      scale: svgScale / this.canvasDPI,
    };
  }

  destroy(): void {
    this.canvas.remove();
  }

  getScale(): number {
    return this.canvasDPI;
  }
}
