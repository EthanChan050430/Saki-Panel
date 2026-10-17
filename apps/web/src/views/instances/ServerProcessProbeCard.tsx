import React, { useEffect, useState, useRef } from "react";
import { Activity, Clock, Cpu, HardDrive, Hash, Layers, MemoryStick, Server, Zap, Disc } from "lucide-react";
import type { ManagedNode, NodeMetricSnapshot } from "@webops/shared";
import { api } from "../../api.js";
import { formatBytes } from "../../utils/path.js";

export function ServerProcessProbeCard({
  node,
  token,
}: {
  node: ManagedNode;
  token: string;
}) {
  const isOnline = node.status === "ONLINE";
  const [metricsHistory, setMetricsHistory] = useState<Array<{ cpu: number; memory: number; totalMem: number; diskUsed: number; diskTotal: number }>>(() =>
    Array.from({ length: 14 }, () => ({
      cpu: isOnline ? 12 : 0,
      memory: isOnline ? 1024 : 0,
      totalMem: 4096,
      diskUsed: 20480,
      diskTotal: 51200
    }))
  );
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [loadavg, setLoadavg] = useState("-");

  // Fetch real metrics from backend
  useEffect(() => {
    if (!isOnline) {
      setMetricsHistory(Array.from({ length: 14 }, () => ({ cpu: 0, memory: 0, totalMem: 4096, diskUsed: 0, diskTotal: 51200 })));
      setUptimeSeconds(0);
      return;
    }

    let isSubscribed = true;

    const fetchMetrics = async () => {
      try {
        const res = await api.nodeMetrics(token, node.id);
        if (!isSubscribed || !res.metrics || res.metrics.length === 0) return;

        const latest = res.metrics[res.metrics.length - 1];
        if (latest) {
          if (latest.uptimeSeconds) {
            setUptimeSeconds(latest.uptimeSeconds);
          }
          if (latest.loadAverage1m !== undefined) {
            setLoadavg(latest.loadAverage1m.toFixed(2));
          }

          setMetricsHistory((prev) => {
            const totMem = latest.totalMemoryMb || 4096;
            const usedMem = latest.usedMemoryMb || Math.round((totMem * latest.memoryUsage) / 100);
            const totDiskMb = (latest.totalDiskGb || 50) * 1024;
            const usedDiskMb = (latest.usedDiskGb ? latest.usedDiskGb * 1024 : Math.round((totDiskMb * latest.diskUsage) / 100));

            const newPoint = {
              cpu: +(latest.cpuUsage?.toFixed(1) ?? 5),
              memory: Math.round(usedMem),
              totalMem: Math.round(totMem),
              diskUsed: Math.round(usedDiskMb),
              diskTotal: Math.round(totDiskMb),
            };
            return [...prev.slice(1), newPoint];
          });
        }
      } catch {
        // Silently fallback to previous metrics if polling failed
      }
    };

    void fetchMetrics();
    const interval = window.setInterval(fetchMetrics, 3500);

    return () => {
      isSubscribed = false;
      window.clearInterval(interval);
    };
  }, [node.id, isOnline, token]);

  // Subtle real-time tick for uptime
  useEffect(() => {
    if (!isOnline) return;
    const tick = window.setInterval(() => {
      setUptimeSeconds((s) => (s > 0 ? s + 1 : 0));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [isOnline]);

  const latestItem = metricsHistory[metricsHistory.length - 1] ?? {
    cpu: 0,
    memory: 0,
    totalMem: 4096,
    diskUsed: 0,
    diskTotal: 51200
  };

  const latestCpu = isOnline ? latestItem.cpu : 0;
  const latestMem = isOnline ? latestItem.memory : 0;
  const totalMem = latestItem.totalMem || 4096;
  const latestDisk = isOnline ? latestItem.diskUsed : 0;
  const totalDisk = latestItem.diskTotal || 51200;

  const memPercent = Math.min(100, Math.round((latestMem / Math.max(totalMem, 1)) * 100));
  const diskPercent = Math.min(100, Math.round((latestDisk / Math.max(totalDisk, 1)) * 100));

  const formatUptime = (secs: number) => {
    if (!isOnline || secs <= 0) return "00:00:00";
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (d > 0) {
      return `${d}天 ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const maxCpu = 100;
  const svgWidth = 260;
  const svgHeight = 44;
  const cpuPoints = metricsHistory.map((item, idx) => {
    const x = (idx / (metricsHistory.length - 1)) * svgWidth;
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
              <strong className="kpi-number">{isOnline ? `${latestCpu}%` : "0%"}</strong>
              {isOnline ? (
                <span className={`kpi-badge ${latestCpu > 60 ? "warn" : "good"}`}>
                  {latestCpu > 60 ? "繁忙" : latestCpu > 20 ? "活跃" : "平稳"}
                </span>
              ) : (
                <span className="kpi-badge idle">离线</span>
              )}
            </div>
            <div className="probe-progress-bar">
              <div
                className="probe-progress-fill cpu-fill"
                style={{ width: `${Math.min(100, latestCpu)}%` }}
              />
            </div>
          </div>

          <div className="probe-kpi-tile">
            <div className="kpi-label">
              <HardDrive size={12} />
              <span>物理内存</span>
            </div>
            <div className="kpi-value-row">
              <strong className="kpi-number">
                {isOnline ? `${(latestMem / 1024).toFixed(1)} GB` : "0 GB"}
              </strong>
              {isOnline ? (
                <span className="kpi-badge mem">
                  {memPercent}%
                </span>
              ) : (
                <span className="kpi-badge idle">离线</span>
              )}
            </div>
            <div className="probe-progress-bar">
              <div
                className="probe-progress-fill mem-fill"
                style={{ width: `${memPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Live Sparkline Graph */}
        <div className="probe-sparkline-box">
          <div className="sparkline-header">
            <span className="sparkline-label">服务器负载走势 (实时探针)</span>
            <span className="sparkline-rate">{isOnline ? "采样: 3.5s/次" : "已离线"}</span>
          </div>
          <div className="sparkline-svg-wrap">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="probe-sparkline-svg"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="serverCpuGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {isOnline ? <path d={cpuAreaPath} fill="url(#serverCpuGradient)" /> : null}
              <path
                d={cpuSvgPath}
                fill="none"
                stroke={isOnline ? "#38bdf8" : "rgba(148, 163, 184, 0.4)"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Extended Telemetry Signals */}
        <div className="probe-details-drawer">
          <div className="probe-meta-row">
            <span className="meta-name">
              <Clock size={12} />
              持续运行
            </span>
            <strong className="meta-val">{formatUptime(uptimeSeconds)}</strong>
          </div>
          <div className="probe-meta-row">
            <span className="meta-name">
              <Disc size={12} />
              根盘空间
            </span>
            <strong className="meta-val">
              {isOnline ? `${(latestDisk / 1024).toFixed(1)}G / ${(totalDisk / 1024).toFixed(1)}G (${diskPercent}%)` : "-"}
            </strong>
          </div>
          <div className="probe-meta-row">
            <span className="meta-name">
              <Zap size={12} />
              系统平均负载
            </span>
            <strong className="meta-val">{isOnline && loadavg !== "-" ? loadavg : (isOnline ? "Normal" : "Offline")}</strong>
          </div>
          <div className="probe-meta-row">
            <span className="meta-name">
              <Server size={12} />
              架构与平台
            </span>
            <strong className="meta-val" title={`${node.os || "Linux"} ${node.arch || "x64"}`}>
              {node.os || "Linux"} · {node.arch || "x64"}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
