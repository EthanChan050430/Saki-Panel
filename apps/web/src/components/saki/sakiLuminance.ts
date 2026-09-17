export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseCssColor(colorStr: string): RGBA | null {
  if (!colorStr || colorStr === "transparent" || colorStr === "inherit" || colorStr === "initial") {
    return null;
  }
  const str = colorStr.trim().toLowerCase();
  if (str === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (str === "black") return { r: 0, g: 0, b: 0, a: 1 };

  const rgbaComma = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgbaComma) {
    return {
      r: parseFloat(rgbaComma[1]!),
      g: parseFloat(rgbaComma[2]!),
      b: parseFloat(rgbaComma[3]!),
      a: rgbaComma[4] !== undefined ? parseFloat(rgbaComma[4]) : 1
    };
  }

  const rgbaSlash = str.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/);
  if (rgbaSlash) {
    const rawAlpha = rgbaSlash[4];
    let alpha = 1;
    if (rawAlpha) {
      alpha = rawAlpha.endsWith("%") ? parseFloat(rawAlpha) / 100 : parseFloat(rawAlpha);
    }
    return {
      r: parseFloat(rgbaSlash[1]!),
      g: parseFloat(rgbaSlash[2]!),
      b: parseFloat(rgbaSlash[3]!),
      a: alpha
    };
  }

  const colorSrgb = str.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/);
  if (colorSrgb) {
    const rawAlpha = colorSrgb[4];
    let alpha = 1;
    if (rawAlpha) {
      alpha = rawAlpha.endsWith("%") ? parseFloat(rawAlpha) / 100 : parseFloat(rawAlpha);
    }
    return {
      r: Math.round(parseFloat(colorSrgb[1]!) * 255),
      g: Math.round(parseFloat(colorSrgb[2]!) * 255),
      b: Math.round(parseFloat(colorSrgb[3]!) * 255),
      a: alpha
    };
  }

  if (str.startsWith("#")) {
    let hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255
      };
    }
  }

  return null;
}

export function sampleLuminanceAtPoint(
  x: number,
  y: number,
  ignoreEl?: HTMLElement | null,
  ignoreSelector?: string
): number {
  if (typeof document === "undefined") return 1;
  const clampedX = Math.max(1, Math.min((window.innerWidth || 800) - 1, x));
  const clampedY = Math.max(1, Math.min((window.innerHeight || 600) - 1, y));

  const elements = document.elementsFromPoint(clampedX, clampedY);
  let accR = 0;
  let accG = 0;
  let accB = 0;
  let accA = 0;

  for (const el of elements) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    if (ignoreEl && (el === ignoreEl || ignoreEl.contains(el))) continue;
    if (ignoreSelector && el.closest?.(ignoreSelector)) continue;

    const style = window.getComputedStyle(el);
    const bg = parseCssColor(style.backgroundColor);
    if (bg && bg.a > 0.01) {
      const remainingAlpha = 1 - accA;
      const layerEffectiveAlpha = bg.a * remainingAlpha;
      accR += bg.r * layerEffectiveAlpha;
      accG += bg.g * layerEffectiveAlpha;
      accB += bg.b * layerEffectiveAlpha;
      accA += layerEffectiveAlpha;

      if (accA >= 0.95) break;
    }
  }

  if (accA < 0.95) {
    const isDarkTheme =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      document.body?.classList.contains("dark");
    const fallbackColor = isDarkTheme ? { r: 15, g: 23, b: 42 } : { r: 255, g: 255, b: 255 };
    const remainingAlpha = 1 - accA;
    accR += fallbackColor.r * remainingAlpha;
    accG += fallbackColor.g * remainingAlpha;
    accB += fallbackColor.b * remainingAlpha;
    accA = 1;
  }

  const rNorm = accR / 255;
  const gNorm = accG / 255;
  const bNorm = accB / 255;
  return 0.2126 * rNorm + 0.7152 * gNorm + 0.0722 * bNorm;
}
