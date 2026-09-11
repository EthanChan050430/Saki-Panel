import React, { useState } from "react";
import { Wrench, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import type { InstalledPlugin } from "@webops/shared";

interface PluginWidgetCardProps {
  plugin: InstalledPlugin;
}

export function PluginWidgetCard({ plugin }: PluginWidgetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const widget = plugin.manifest.widget;
  const entry = widget?.entry ? widget.entry.replace(/^[/\\]+/, "") : "index.html";
  const widgetUrl = `/api/plugins/${encodeURIComponent(plugin.id)}/assets/${entry}?v=${encodeURIComponent(plugin.manifest.version)}`;

  return (
    <div className={`plugin-widget-card ${expanded ? "is-expanded" : ""}`}>
      <div className="plugin-widget-header">
        <div className="plugin-widget-title">
          <Wrench size={16} />
          <span>{plugin.manifest.displayName}</span>
        </div>
        <div className="plugin-widget-actions">
          <button
            type="button"
            className="plugin-widget-btn"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="刷新组件"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="plugin-widget-btn"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "收起" : "展开"}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
      <div
        className="plugin-widget-body"
        style={{
          height: expanded ? (widget?.height ? widget.height * 1.5 : 450) : (widget?.height || 260)
        }}
      >
        <iframe
          key={refreshKey}
          src={widgetUrl}
          title={plugin.manifest.displayName}
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          className="plugin-widget-iframe"
        />
      </div>
    </div>
  );
}
