import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, RefreshCw, Maximize2, Minimize2, Gamepad2 } from "lucide-react";
import type { InstalledPlugin } from "@webops/shared";
import { usePanelT } from "../i18n/index.js";

interface PluginGameModalProps {
  plugin: InstalledPlugin;
  onClose: () => void;
}

export function PluginGameModal({ plugin, onClose }: PluginGameModalProps) {
  const t = usePanelT();
  const [fullscreen, setFullscreen] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const game = plugin.manifest.game;
  const entry = game?.entry ? game.entry.replace(/^[/\\]+/, "") : "index.html";
  const gameUrl = `/api/plugins/${encodeURIComponent(plugin.id)}/assets/${entry}?v=${encodeURIComponent(plugin.manifest.version)}`;

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Lock background body scroll when open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="plugin-game-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`plugin-game-modal-container ${fullscreen ? "is-fullscreen" : ""}`}
        style={
          !fullscreen && game?.width && game?.height
            ? {
                width: Math.min(game.width + 40, window.innerWidth - 40),
                height: Math.min(game.height + 72, window.innerHeight - 40),
                maxWidth: "95vw"
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="plugin-game-modal-header">
          <div className="plugin-game-modal-title">
            <Gamepad2 size={18} className="plugin-game-icon" />
            <span>{game?.title || plugin.manifest.displayName}</span>
            <small className="plugin-game-author">by {plugin.manifest.author}</small>
          </div>
          <div className="plugin-game-modal-actions">
            <button
              type="button"
              className="plugin-game-btn"
              onClick={handleRefresh}
              title={t("plugins.gameModal.restart")}
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              className="plugin-game-btn"
              onClick={() => setFullscreen(!fullscreen)}
              title={fullscreen ? t("plugins.gameModal.exitFullscreen") : t("plugins.gameModal.fullscreen")}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              className="plugin-game-btn is-close"
              onClick={onClose}
              title={t("plugins.gameModal.close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="plugin-game-modal-body">
          <iframe
            key={refreshKey}
            ref={iframeRef}
            src={gameUrl}
            title={plugin.manifest.displayName}
            sandbox="allow-scripts allow-same-origin allow-pointer-lock"
            className="plugin-game-iframe"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
