// Adapted & enhanced from https://github.com/shuding/liquid-glass
// Realistic liquid glass lens shader: SDF-based magnification & meniscus refraction

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
  radius: number
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
 * Combines bounded physical lens magnification in the interior with a meniscus liquid rim refraction near edges.
 * Uses physical screen pixel units to ensure invariant refraction angle across any container width or height.
 */
export function createSizedLiquidGlassFragment(
  physicalWidth: number,
  physicalHeight: number,
  cornerRadius: number,
  zoom = 1.15,
  refractionIntensity = 1.0
): (uv: Vec2, mouse?: Vec2) => Vec2 {
  const w = Math.max(1, physicalWidth);
  const h = Math.max(1, physicalHeight);
  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.max(2, Math.min(cornerRadius, halfW - 1, halfH - 1));

  // Physical meniscus rim width in screen pixels (fixed 8px - 16px, capped at 38% of half-dimension)
  const rimWidth = Math.max(8, Math.min(16, Math.min(halfW, halfH) * 0.38));

  // Physical magnification displacement bounds (at most ~4px)
  const maxMagDisplacement = Math.min(4, rimWidth * 0.28);
  const zoomFactor = Math.max(1.01, zoom);
  const zoomDelta = 1 - 1 / zoomFactor;

  return (uv: Vec2, mouse?: Vec2): Vec2 => {
    // Current pixel coordinate in physical element space, centered at (0, 0)
    const px = (uv.x - 0.5) * w;
    const py = (uv.y - 0.5) * h;

    // Signed distance to rounded rectangle boundary in physical pixels
    const dist = roundedRectSDF(px, py, halfW, halfH, r);

    // Outside the glass border: zero displacement
    if (dist > 0) {
      return { x: uv.x, y: uv.y };
    }

    // Depth from border towards inside: 0 at border, >0 in interior
    const depth = -dist;

    // 1. Magnification component: pulls coordinates inward to magnify backdrop
    // Using tanh to ensure magnification displacement never blows up on elongated elements
    let magDx = -maxMagDisplacement * Math.tanh((px * zoomDelta) / Math.max(0.1, maxMagDisplacement));
    let magDy = -maxMagDisplacement * Math.tanh((py * zoomDelta) / Math.max(0.1, maxMagDisplacement));

    // Optional mouse interaction subtly pulls lens focus
    if (mouse && (mouse.x !== 0 || mouse.y !== 0)) {
      const mouseInfluence = smoothStep(0, 1, 1 - depth / Math.max(halfW, halfH)) * 0.05;
      magDx += mouse.x * Math.min(halfW, 40) * mouseInfluence;
      magDy += mouse.y * Math.min(halfH, 40) * mouseInfluence;
    }

    // 2. Meniscus liquid rim refraction:
    let rimDx = 0;
    let rimDy = 0;

    if (depth < rimWidth) {
      // Normal of the SDF boundary (points outward)
      const eps = 1.0;
      const dX =
        roundedRectSDF(px + eps, py, halfW, halfH, r) -
        roundedRectSDF(px - eps, py, halfW, halfH, r);
      const dY =
        roundedRectSDF(px, py + eps, halfW, halfH, r) -
        roundedRectSDF(px, py - eps, halfW, halfH, r);
      const gradLen = Math.sqrt(dX * dX + dY * dY) || 1;
      const normX = dX / gradLen;
      const normY = dY / gradLen;

      // Normalized depth in rim: 0 at outer edge, 1 at interior rim junction
      const t = depth / rimWidth;
      // Meniscus arch curve: 0 at outer edge, peaks mid-rim, smoothly reaches 0 at interior
      const peakRimDisplacement = 12 * refractionIntensity;
      const rimFactor =
        Math.sin(t * Math.PI) * Math.pow(1 - t, 0.25) * peakRimDisplacement;

      rimDx = -normX * rimFactor;
      rimDy = -normY * rimFactor;

      // Feather magnification near edge so it smoothly meets 0 at border
      const edgeFeather = smoothStep(0, 2.5, depth);
      magDx *= edgeFeather;
      magDy *= edgeFeather;
    }

    const totalDx = magDx + rimDx;
    const totalDy = magDy + rimDy;

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
 * Generates an SVG displacement map where optical refraction angle and rim bevel width
 * remain strictly constant regardless of how wide or tall the container expands.
 */
export function generateLiquidGlassMap(options: LiquidGlassShaderOptions): ShaderResult {
  const {
    physicalWidth,
    physicalHeight,
    cornerRadius = 26,
    zoom = 1.15,
    refractionIntensity = 1.0,
    mousePosition,
    maxEdge = 480,
  } = options;

  const srcW = Math.max(1, Math.round(physicalWidth));
  const srcH = Math.max(1, Math.round(physicalHeight));
  const halfW = srcW / 2;
  const halfH = srcH / 2;
  const r = Math.max(2, Math.min(cornerRadius, halfW - 1, halfH - 1));

  // Meniscus rim width in physical screen pixels (capped between 8px and 16px)
  const rimWidth = Math.max(8, Math.min(16, Math.min(halfW, halfH) * 0.38));
  const maxMagDisplacement = Math.min(4, rimWidth * 0.28);
  const zoomFactor = Math.max(1.01, zoom);
  const zoomDelta = 1 - 1 / zoomFactor;

  // Internal canvas resolution capped for performance while ensuring smooth gradient sampling
  const canvasW = Math.max(16, Math.min(srcW, maxEdge));
  const canvasH = Math.max(16, Math.min(srcH, Math.round(maxEdge * 0.5)));

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { dataUrl: "", scale: 24 };
  }

  let maxPhysicalDisplacement = 0;
  const totalPixels = canvasW * canvasH;
  const rawDx = new Float32Array(totalPixels);
  const rawDy = new Float32Array(totalPixels);

  let idx = 0;
  for (let y = 0; y < canvasH; y++) {
    const v = (y + 0.5) / canvasH;
    const py = (v - 0.5) * srcH;

    for (let x = 0; x < canvasW; x++) {
      const u = (x + 0.5) / canvasW;
      const px = (u - 0.5) * srcW;

      const dist = roundedRectSDF(px, py, halfW, halfH, r);
      if (dist > 0) {
        rawDx[idx] = 0;
        rawDy[idx] = 0;
        idx++;
        continue;
      }

      const depth = -dist;

      let magDx = -maxMagDisplacement * Math.tanh((px * zoomDelta) / Math.max(0.1, maxMagDisplacement));
      let magDy = -maxMagDisplacement * Math.tanh((py * zoomDelta) / Math.max(0.1, maxMagDisplacement));

      if (mousePosition && (mousePosition.x !== 0 || mousePosition.y !== 0)) {
        const mouseInfluence = smoothStep(0, 1, 1 - depth / Math.max(halfW, halfH)) * 0.05;
        magDx += mousePosition.x * Math.min(halfW, 40) * mouseInfluence;
        magDy += mousePosition.y * Math.min(halfH, 40) * mouseInfluence;
      }

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
        const normX = dX / gradLen;
        const normY = dY / gradLen;

        const t = depth / rimWidth;
        const peakRimDisplacement = 12 * refractionIntensity;
        const rimFactor =
          Math.sin(t * Math.PI) * Math.pow(1 - t, 0.25) * peakRimDisplacement;

        rimDx = -normX * rimFactor;
        rimDy = -normY * rimFactor;

        const edgeFeather = smoothStep(0, 2.5, depth);
        magDx *= edgeFeather;
        magDy *= edgeFeather;
      }

      const totalDx = magDx + rimDx;
      const totalDy = magDy + rimDy;

      const absDx = Math.abs(totalDx);
      const absDy = Math.abs(totalDy);
      if (absDx > maxPhysicalDisplacement) maxPhysicalDisplacement = absDx;
      if (absDy > maxPhysicalDisplacement) maxPhysicalDisplacement = absDy;

      rawDx[idx] = totalDx;
      rawDy[idx] = totalDy;
      idx++;
    }
  }

  const maxDisp = Math.max(1, maxPhysicalDisplacement);
  const svgScale = maxDisp * 2;

  const imageData = ctx.createImageData(canvasW, canvasH);
  const data = imageData.data;

  idx = 0;
  for (let y = 0; y < canvasH; y++) {
    for (let x = 0; x < canvasW; x++) {
      const dx = rawDx[idx]!;
      const dy = rawDy[idx]!;
      idx++;

      const edgeDistance = Math.min(x, y, canvasW - x - 1, canvasH - y - 1);
      const edgeFactor = Math.min(1, edgeDistance / 1.5);

      const normDx = (dx * edgeFactor) / maxDisp;
      const normDy = (dy * edgeFactor) / maxDisp;

      const rVal = normDx * 0.5 + 0.5;
      const gVal = normDy * 0.5 + 0.5;

      const pixelIndex = (y * canvasW + x) * 4;
      data[pixelIndex] = Math.max(0, Math.min(255, Math.round(rVal * 255)));
      data[pixelIndex + 1] = Math.max(0, Math.min(255, Math.round(gVal * 255)));
      data[pixelIndex + 2] = Math.max(0, Math.min(255, Math.round(gVal * 255)));
      data[pixelIndex + 3] = 255;
    }
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
 * Generator that executes the fragment shader over a 2D canvas and outputs
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

    // Calculate displacement vectors for each canvas pixel
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const uv: Vec2 = { x: x / w, y: y / h };
        const pos = this.options.fragment(uv, mousePosition);

        // Displacement in pixels on this canvas
        const dx = pos.x * w - x;
        const dy = pos.y * h - y;

        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
        rawValues.push(dx, dy);
      }
    }

    // Minimum scale to avoid division by zero
    const maxDisplacement = Math.max(1, maxScale);
    const svgScale = maxDisplacement * 2;

    const imageData = this.context.createImageData(w, h);
    const data = imageData.data;

    let rawIndex = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = rawValues[rawIndex++] ?? 0;
        const dy = rawValues[rawIndex++] ?? 0;

        // Smooth pixel borders to prevent aliasing
        const edgeDistance = Math.min(x, y, w - x - 1, h - y - 1);
        const edgeFactor = Math.min(1, edgeDistance / 1.5);

        const smoothedDx = dx * edgeFactor;
        const smoothedDy = dy * edgeFactor;

        // Map displacement to 0..255 (128 is 0 displacement)
        const normDx = smoothedDx / maxDisplacement; // [-1, 1]
        const normDy = smoothedDy / maxDisplacement; // [-1, 1]

        const r = normDx * 0.5 + 0.5; // [0, 1]
        const g = normDy * 0.5 + 0.5; // [0, 1]

        const pixelIndex = (y * w + x) * 4;
        data[pixelIndex] = Math.max(0, Math.min(255, Math.round(r * 255))); // R: X displacement
        data[pixelIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255))); // G: Y displacement
        data[pixelIndex + 2] = Math.max(0, Math.min(255, Math.round(g * 255))); // B: for chromatic aberration / compatibility
        data[pixelIndex + 3] = 255; // Alpha
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
