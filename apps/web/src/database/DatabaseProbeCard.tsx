import React, { useState, useEffect, useCallback } from "react";
import { Activity, Clock, Cpu, HardDrive, Layers, Server, Shield } from "lucide-react";
import type { DatabaseVisualizerInstance, ManagedNode } from "@webops/shared";
import { api } from "../api.js";

export function DatabaseProbeCard({
  token,
  database
}: {
  token: string;
  database: DatabaseVisualizerInstance;
}) {
  const [latency, setLatency] = useState<number | null>(null);
  const [version, setVersion] = useState<string>("");
  const [totalKeys, setTotalKeys] = useState<number | undefined>(undefined);
  const [memory, setMemory] = useState<string>("");
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: 12 }, () => Math.floor(Math.random() * 3 + 1)));

  const probe = useCallback(async () => {
    try {
      const res = await api.getDatabaseStats(token, database.id);
      if (res.ok) {
        const ms = res.latencyMs ?? 1;
        setLatency(ms);
        if (res.version) setVersion(res.version);
        if (res.totalKeys !== undefined) setTotalKeys(res.totalKeys);
        if (res.memory) setMemory(res.memory);

        setHistory((prev) => [...prev.slice(1), ms]);
      }
    } catch {
      setLatency(null);
    }
  }, [token, database.id]);

  useEffect(() => {
    void probe();
    const interval = window.setInterval(probe, 4000);
    return () => window.clearInterval(interval);
  }, [probe]);

  const maxVal = Math.max(10, ...history);
  const svgWidth = 260;
  const svgHeight = 40;
  const points = history.map((val, idx) => {
    const x = (idx / (history.length - 1)) * svgWidth;
    const y = svgHeight - (val / maxVal) * (svgHeight - 8) - 4;
    return `${x},${y}`;
  });
  const path = `M ${points.join(" L ")}`;

  return (
    <div className="glass-panel instance-side-card instance-probe-card">
      <div className="side-card-header" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} style={{ color: "#10b981" }} />
          <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>实时健康与连通探针</h4>
        </div>
        <span className={`status-tag ${latency !== null ? "online" : "offline"}`}>
          {latency !== null ? "连接正常" : "检测中"}
        </span>
      </div>

      <div className="probe-card-body">
        <div className="probe-kpi-grid">
          <div className="probe-kpi-tile">
            <div className="kpi-label">
              <Clock size={12} />
              <span>往返延迟</span>
            </div>
            <div className="kpi-value-row">
              <strong className="kpi-number">{latency !== null ? `${latency}ms` : "-"}</strong>
              <span className={`kpi-badge ${latency !== null && latency < 20 ? "good" : "warn"}`}>
                {latency !== null && latency < 20 ? "极优" : "正常"}
              </span>
            </div>
          </div>

          <div className="probe-kpi-tile">
            <div className="kpi-label">
              <Shield size={12} />
              <span>引擎版本</span>
            </div>
            <div className="kpi-value-row">
              <strong className="kpi-number" style={{ fontSize: 12 }} title={version || database.engine}>
                {version ? version.slice(0, 14) : database.engine.toUpperCase()}
              </strong>
            </div>
          </div>
        </div>

        {/* Live Sparkline */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#86868b", marginBottom: 4 }}>
            <span>响应延迟波形</span>
            <span>{latency ?? 0} ms</span>
          </div>
          <div style={{ width: "100%", height: 40, background: "rgba(0, 0, 0, 0.03)", borderRadius: 8, overflow: "hidden" }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
              <path d={path} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
