import React from "react";

export interface ThemeMorphIconProps {
  darkMode: boolean;
  size?: number;
  className?: string;
}

export const ThemeMorphIcon: React.FC<ThemeMorphIconProps> = ({
  darkMode,
  size = 18,
  className = ""
}) => {
  return (
    <span
      className={`theme-morph-wrapper ${darkMode ? "is-dark" : "is-light"} ${className}`}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        flexShrink: 0
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="theme-morph-svg"
      >
        {/* Sun center core */}
        <circle
          className="theme-sun-body"
          cx="12"
          cy="12"
          r="4.8"
          fill="currentColor"
          stroke="none"
        />

        {/* 8 Sunbeams radiating in light mode */}
        <g className="theme-sun-rays" stroke="currentColor">
          <line x1="12" y1="1.5" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="22.5" />
          <line x1="4.5" y1="4.5" x2="6.3" y2="6.3" />
          <line x1="17.7" y1="17.7" x2="19.5" y2="19.5" />
          <line x1="1.5" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="22.5" y2="12" />
          <line x1="4.5" y1="19.5" x2="6.3" y2="17.7" />
          <line x1="17.7" y1="6.3" x2="19.5" y2="4.5" />
        </g>

        {/* Crescent Moon path (gracefully rotates & emerges in dark mode) */}
        <path
          className="theme-moon-body"
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.2"
        />

        {/* Twinkling star cluster (emerges in dark mode) */}
        <g className="theme-morph-stars" fill="currentColor" stroke="none">
          <circle className="theme-star star-alpha" cx="19.5" cy="4.5" r="1.1" />
          <circle className="theme-star star-beta" cx="18" cy="18" r="0.8" />
          <circle className="theme-star star-gamma" cx="5" cy="17" r="0.9" />
        </g>
      </svg>
    </span>
  );
};
