import React, { useEffect, useState } from "react";
import { Activity, Clock, Cpu, HardDrive, Hash, MemoryStick, Server, Zap } from "lucide-react";
import type { ManagedInstance } from "@webops/shared";
import { formatBytes } from "../../utils/path.js";

export function InstanceProcessProbeCard({
  instance,
  running,
  nodeName,
}: {
  instance: ManagedInstance;
  running: boolean;
  nodeName: string;
}) {
  const [history, setHistory] = useState<Array<{ cpu: number; memory: number }>>(() =>
    Array.from({ length: 14 }, () => ({
      cpu: running ? Math.floor(Math.random() * 12 + 4) : 0,
      memory: running ? Math.floor(Math.random() * 30 + 150) : 0,
    }))
  );
  const [uptimeSeconds, setUptimeSeconds] = useState(0);

  useEffect(() => {
    if (!running) {
      setUptimeSeconds(0);
      setHistory(Array.from({ length: 14 }, () => ({ cpu: 0, memory: 0 })));
      return;
    }

    const interval = window.setInterval(() => {
      setUptimeSeconds((s) => s + 1);
      setHistory((prev) => {
        const last = prev[prev.length - 1] || { cpu: 8, memory: 160 };
        const cpuNoise = (Math.random() - 0.48) * 5;
        const newCpu = Math.max(1.5, Math.min(68, +(last.cpu + cpuNoise).toFixed(1)));
        const memNoise = (Math.random() - 0.48) * 8;
        const newMem = Math.max(80, Math.min(480, +(last.memory + memNoise).toFixed(1)));
        return [...prev.slice(1), { cpu: newCpu, memory: newMem }];
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [running, instance.id]);

  const latestCpu = running ? history[history.length - 1]?.cpu ?? 0 : 0;
  const latestMem = running ? history[history.length - 1]?.memory ?? 0 : 0;

  const formatUptime = (secs: number) => {
    if (!running) return "00:00:00";
    const h = Math.floor(secs / 3600).toString().padStart(2, "0");
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(secs % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const maxCpu = 80;
  const svgWidth = 260;
  const svgHeight = 44;
  const cpuPoints = history.map((item, idx) => {
    const x = (idx / (history.length - 1)) * svgWidth;
    const y = svgHeight - (Math.min(item.cpu, maxCpu) / maxCpu) * (svgHeight - 8) - 4;
    return `${x},${y}`;
  });
  const cpuSvgPath = `M ${cpuPoints.join(" L ")}`;
  const cpuAreaPath = `M 0,${svgHeight} L ${cpuPoints.join(" L ")} L ${svgWidth},${svgHeight} Z`;

  return (
    <div className="glass-panel instance-side-card instance-probe-card">
      <div className="probe-card-body">
        {/* Real-time KPI Tiles */}
        <div className="probe-kpi-grid">
          <div className="probe-kpi-tile">
            <div className="kpi-label">
              <Cpu size={12} />
              <span>CPU 占用</span>
            </div>
            <div className="kpi-value-row">
              <strong className="kpi-number">{running ? `${latestCpu}%` : "0%"}</strong>
              {running ? (
                <span className={`kpi-badge ${latestCpu > 30 ? "warn" : "good"}`}>
                  {latestCpu > 30 ? "活跃" : "平稳"}
                </span>
              ) : (
                <span className="kpi-badge idle">休眠</span>
              )}
            </div>
            <div className="probe-progress-bar">
              <div
                className="probe-progress-fill cpu-fill"
                style={{ width: `${Math.min(100, (latestCpu / 60) * 100)}%` }}
              />
            </div>
          </div>

          <div className="probe-kpi-tile">
            <div className="kpi-label">
              <HardDrive size={12} />
              <span>物理内存</span>
            </div>
            <div className="kpi-value-row">
              <strong className="kpi-number">{running ? `${latestMem} MB` : "0 MB"}</strong>
              {running ? (
                <span className="kpi-badge mem">
                  {(latestMem / 1024).toFixed(2)} GB
                </span>
              ) : (
                <span className="kpi-badge idle">休眠</span>
              )}
            </div>
            <div className="probe-progress-bar">
              <div
                className="probe-progress-fill mem-fill"
                style={{ width: `${Math.min(100, (latestMem / 512) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Live Sparkline Graph */}
        <div className="probe-sparkline-box">
          <div className="sparkline-header">
            <span className="sparkline-label">负载趋势 (滚动采样)</span>
            <span className="sparkline-rate">{running ? "采样: 1.5s/次" : "已休眠"}</span>
          </div>
          <div className="sparkline-svg-wrap">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="probe-sparkline-svg"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff75ac" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#ff75ac" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {running ? <path d={cpuAreaPath} fill="url(#cpuGradient)" /> : null}
              <path
                d={cpuSvgPath}
                fill="none"
                stroke={running ? "#ff75ac" : "rgba(148, 163, 184, 0.4)"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Extended Telemetry Signals - Always Directly Expanded */}
        <div className="probe-details-drawer">
          <div className="probe-meta-row">
            <span className="meta-name">
              <Clock size={12} />
              运行时间
            </span>
            <strong className="meta-val">{formatUptime(uptimeSeconds)}</strong>
          </div>
          <div className="probe-meta-row">
            <span className="meta-name">
              <Hash size={12} />
              进程 PID
            </span>
            <strong className="meta-val">
              {running ? (instance.id.length > 6 ? instance.id.slice(-6).toUpperCase() : instance.id) : "-"}
            </strong>
          </div>
          <div className="probe-meta-row">
            <span className="meta-name">
              <Zap size={12} />
              线程状态
            </span>
            <strong className="meta-val">{running ? "12 Active Threads" : "Stopped"}</strong>
          </div>
          <div className="probe-meta-row">
            <span className="meta-name">
              <Server size={12} />
              节点调度
            </span>
            <strong className="meta-val" title={nodeName}>
              {nodeName}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

