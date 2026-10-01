import React, { useId, useMemo } from "react";

export interface SparklineRibbonProps {
  data?: number[] | undefined;
  width?: number | string | undefined;
  height?: number | undefined;
  color?: string | undefined;
  glowColor?: string | undefined;
  label?: string | undefined;
  currentValue?: string | undefined;
  animated?: boolean | undefined;
  className?: string | undefined;
}

export function SparklineRibbon({
  data = [0, 0],
  width = "100%",
  height = 32,
  color = "#ff75ac",
  glowColor = "rgba(255, 117, 172, 0.45)",
  label,
  currentValue,
  animated = true,
  className = ""
}: SparklineRibbonProps) {
  const ribbonId = useId();
  const points = useMemo(() => {
    const values = data.filter(Number.isFinite).slice(-2048);
    if (values.length === 0) return { path: "", area: "", lastX: 0, lastY: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const coords = values.map((val, idx) => {
      const x = (idx / Math.max(1, values.length - 1)) * 100;
      const y = 85 - ((val - min) / range) * 70;
      return { x, y };
    });

    if (coords.length === 0) return { path: "", area: "", lastX: 0, lastY: 0 };
    const first = coords[0] ?? { x: 0, y: 50 };

    let path = `M ${first.x} ${first.y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i] ?? { x: 0, y: 50 };
      const p1 = coords[i + 1] ?? { x: 100, y: 50 };
      const cx = (p0.x + p1.x) / 2;
      path += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }

    const last = coords[coords.length - 1] ?? { x: 100, y: 50 };
    const area = `${path} L ${last.x} 100 L 0 100 Z`;

    return { path, area, lastX: last.x, lastY: last.y };
  }, [data]);

  return (
    <div className={`sparkline-ribbon-wrap ${className}`} style={{ width }}>
      {(label || currentValue) && (
        <div className="sparkline-ribbon-meta">
          {label && <span className="sparkline-label">{label}</span>}
          {currentValue && <span className="sparkline-val">{currentValue}</span>}
        </div>
      )}

      <div className="sparkline-svg-box" style={{ height }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="sparkline-svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${ribbonId}-gradient`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>

            <filter id={`${ribbonId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor={glowColor} />
            </filter>
          </defs>

          <path
            d={points.area}
            fill={`url(#${ribbonId}-gradient)`}
            className="sparkline-area"
          />

          <path
            d={points.path}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${ribbonId}-glow)`}
            className={`sparkline-line ${animated ? "ribbon-flow" : ""}`}
          />

          <circle
            cx={points.lastX}
            cy={points.lastY}
            r="2.5"
            fill={color}
            className="sparkline-head-dot"
          />
        </svg>
      </div>
    </div>
  );
}
