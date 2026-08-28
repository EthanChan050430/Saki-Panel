import React from "react";
import { sakiArtAssets } from "../../constants.js";

export interface SakiEmptyStateProps {
  imageSrc?: string;
  illustration?: "healthy" | "instances" | "tasks" | "logs" | "offline" | "404";
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function SakiEmptyState({
  imageSrc,
  illustration,
  title,
  description,
  action,
  compact = false,
  className = "",
  style
}: SakiEmptyStateProps) {
  let resolvedSrc = imageSrc;
  if (!resolvedSrc && illustration) {
    switch (illustration) {
      case "healthy":
        resolvedSrc = sakiArtAssets.emptyHealthy;
        break;
      case "instances":
        resolvedSrc = sakiArtAssets.emptyInstances;
        break;
      case "tasks":
        resolvedSrc = sakiArtAssets.emptyTasks;
        break;
      case "logs":
        resolvedSrc = sakiArtAssets.emptyLogs;
        break;
      case "offline":
        resolvedSrc = sakiArtAssets.daemonOffline;
        break;
      case "404":
        resolvedSrc = sakiArtAssets.page404;
        break;
    }
  }

  return (
    <div className={`saki-empty-state ${compact ? "compact" : ""} ${className}`} style={style}>
      {resolvedSrc ? (
        <div className="saki-empty-illustration-wrap">
          <img
            src={resolvedSrc}
            alt={title}
            className="saki-empty-illustration"
            draggable={false}
            loading="lazy"
          />
        </div>
      ) : null}
      <div className="saki-empty-content">
        <h4 className="saki-empty-title">{title}</h4>
        {description ? <p className="saki-empty-desc">{description}</p> : null}
        {action ? (
          <button
            type="button"
            className="primary-button saki-empty-btn"
            onClick={action.onClick}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
