import { useEffect, useState, useMemo } from "react";
import {
  Activity,
  Cpu,
  HardDrive,
  Server,
  Clock,
  Layers,
  RotateCw,
  X,
  ShieldCheck,
  Disc
} from "lucide-react";
import type { ManagedNode, NodeMetricSnapshot } from "@webops/shared";
import { api } from "../../api.js";
import { formatDate } from "../../utils/path.js";

export interface SshSystemInfoModalProps {
  open: boolean;
  node: ManagedNode | null;
  token: string;
  onClose: () => void;
}

export function SshSystemInfoModal({
  open,
  node,
  token,
  onClose
}: SshSystemInfoModalProps) {
  if (!open || !node) return null;

  const isOnline = node.status === "ONLINE";
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<NodeMetricSnapshot[]>([]);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [loadavg, setLoadavg] = useState("-");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  const fetchMetrics = async (showLoading = false) => {
    if (!node.id || !isOnline) return;
    if (showLoading) setLoading(true);
    try {
      const res = await api.nodeMetrics(token, node.id);
      if (res && Array.isArray(res.metrics)) {
        setMetrics(res.metrics);
        const latest = res.metrics[res.metrics.length - 1];
        if (latest) {
          if (latest.uptimeSeconds) setUptimeSeconds(latest.uptimeSeconds);
          if (latest.loadAverage1m !== undefined) setLoadavg(latest.loadAverage1m.toFixed(2));
        }
      }
      setLastRefreshedAt(new Date());
    } catch {
      // ignore
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMetrics(true);
    const interval = window.setInterval(() => {
      void fetchMetrics(false);
    }, 3500);
    return () => window.clearInterval(interval);
  }, [node.id, token, isOnline]);

  useEffect(() => {
    if (!isOnline) return;
    const tick = window.setInterval(() => {
      setUptimeSeconds((s) => (s > 0 ? s + 1 : 0));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [isOnline]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const latestMetric = metrics[metrics.length - 1] ?? {
    cpuUsage: 0,
    memoryUsage: 0,
    diskUsage: 0,
    totalMemoryMb: 4096,
    usedMemoryMb: 0,
    totalDiskGb: 50,
    usedDiskGb: 0
  };

  const currentCpu = isOnline ? (latestMetric.cpuUsage ?? 0) : 0;
  const currentMemMb = isOnline ? (latestMetric.usedMemoryMb ?? Math.round(((latestMetric.totalMemoryMb || 4096) * (latestMetric.memoryUsage || 0)) / 100)) : 0;
  const totalMemMb = latestMetric.totalMemoryMb || 4096;
  const currentDiskGb = isOnline ? (latestMetric.usedDiskGb ?? Math.round(((latestMetric.totalDiskGb || 50) * (latestMetric.diskUsage || 0)) / 100)) : 0;
  const totalDiskGb = latestMetric.totalDiskGb || 50;

  const memPercent = Math.min(100, Math.round((currentMemMb / Math.max(totalMemMb, 1)) * 100));
  const diskPercent = Math.min(100, Math.round((currentDiskGb / Math.max(totalDiskGb, 1)) * 100));

  const formatUptime = (secs: number) => {
    if (!isOnline || secs <= 0) return "-";
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (d > 0) return `${d}天 ${h}小时 ${m}分`;
    if (h > 0) return `${h}小时 ${m}分 ${s}秒`;
    return `${m}分 ${s}秒`;
  };

  const chartPoints = useMemo(() => {
    const dataList = metrics.length > 0 ? metrics : Array.from({ length: 12 }, () => ({ cpuUsage: 0 }));
    const count = dataList.length;
    const width = 640;
    const height = 110;
    const padding = { top: 12, bottom: 20, left: 36, right: 12 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const coords = dataList.map((item, idx) => {
      const x = padding.left + (count > 1 ? (idx / (count - 1)) * chartW : chartW / 2);
      const val = Math.min(100, Math.max(0, item.cpuUsage || 0));
      const y = padding.top + chartH - (val / 100) * chartH;
      return { x, y, val };
    });

    const linePath = coords.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const areaPath = coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1]!.x.toFixed(1)} ${(padding.top + chartH).toFixed(1)} L ${coords[0]!.x.toFixed(1)} ${(padding.top + chartH).toFixed(1)} Z`
      : "";

    const cpuValues = dataList.map((d) => d.cpuUsage || 0);
    const avg = cpuValues.length > 0 ? (cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length).toFixed(1) : "0.0";
    const peak = cpuValues.length > 0 ? Math.max(...cpuValues).toFixed(1) : "0.0";

    return { linePath, areaPath, coords, avg, peak, width, height, padding, chartW, chartH };
  }, [metrics]);

  return (
    <div
      className="glass-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass-modal-container ssh-sysinfo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-sysinfo-title"
      >
        <div className="glass-modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon-badge">
              <Activity size={19} />
            </div>
            <div>
              <h3 id="ssh-sysinfo-title" className="modal-title">
                系统信息
              </h3>
              <span className="modal-subtitle">
                {node.name} · {node.host}:{node.port} · {node.os || "Linux"} ({node.arch || "x64"})
              </span>
            </div>
          </div>
          <button
            className="icon-button mini modal-close-btn"
            type="button"
            onClick={onClose}
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="glass-modal-body ssh-sysinfo-modal-body">
          <div className="ssh-sysinfo-kpi-grid">
            <div className="ssh-sysinfo-kpi-card">
              <div className="sysinfo-kpi-header">
                <span className="sysinfo-kpi-title">
                  <Cpu size={14} />
                  <span>CPU 负载</span>
                </span>
                <span className={`sysinfo-status-pill ${currentCpu > 70 ? "warn" : "normal"}`}>
                  {isOnline ? (currentCpu > 70 ? "负载偏高" : "正常") : "离线"}
                </span>
              </div>
              <div className="sysinfo-kpi-value-row">
                <span className="sysinfo-kpi-main-val">{currentCpu.toFixed(1)}%</span>
                <span className="sysinfo-kpi-sub-val">1m 负载 {loadavg}</span>
              </div>
              <div className="sysinfo-mini-track">
                <div
                  className="sysinfo-mini-fill cpu-fill"
                  style={{ width: `${Math.min(100, Math.max(0, currentCpu))}%` }}
                />
              </div>
            </div>

            <div className="ssh-sysinfo-kpi-card">
              <div className="sysinfo-kpi-header">
                <span className="sysinfo-kpi-title">
                  <Layers size={14} />
                  <span>物理内存</span>
                </span>
                <span className="sysinfo-status-pill normal">
                  {memPercent}%
                </span>
              </div>
              <div className="sysinfo-kpi-value-row">
                <span className="sysinfo-kpi-main-val">{(currentMemMb / 1024).toFixed(1)} GB</span>
                <span className="sysinfo-kpi-sub-val">总量 {(totalMemMb / 1024).toFixed(1)} GB</span>
              </div>
              <div className="sysinfo-mini-track">
                <div
                  className="sysinfo-mini-fill mem-fill"
                  style={{ width: `${Math.min(100, Math.max(0, memPercent))}%` }}
                />
              </div>
            </div>

            <div className="ssh-sysinfo-kpi-card">
              <div className="sysinfo-kpi-header">
                <span className="sysinfo-kpi-title">
                  <HardDrive size={14} />
                  <span>根分区存储</span>
                </span>
                <span className="sysinfo-status-pill normal">
                  {diskPercent}%
                </span>
              </div>
              <div className="sysinfo-kpi-value-row">
                <span className="sysinfo-kpi-main-val">{currentDiskGb.toFixed(1)} GB</span>
                <span className="sysinfo-kpi-sub-val">容量 {totalDiskGb.toFixed(1)} GB</span>
              </div>
              <div className="sysinfo-mini-track">
                <div
                  className="sysinfo-mini-fill disk-fill"
                  style={{ width: `${Math.min(100, Math.max(0, diskPercent))}%` }}
                />
              </div>
            </div>

            <div className="ssh-sysinfo-kpi-card">
              <div className="sysinfo-kpi-header">
                <span className="sysinfo-kpi-title">
                  <Clock size={14} />
                  <span>持续运行时间</span>
                </span>
                <span className={`sysinfo-status-pill ${isOnline ? "online" : "offline"}`}>
                  {isOnline ? "探针在线" : "离线"}
                </span>
              </div>
              <div className="sysinfo-kpi-value-row">
                <span className="sysinfo-kpi-main-val" style={{ fontSize: "16px", letterSpacing: "0.2px" }}>
                  {formatUptime(uptimeSeconds)}
                </span>
                <span className="sysinfo-kpi-sub-val">端口 {node.port} · SSH</span>
              </div>
              <div className="sysinfo-mini-track">
                <div
                  className="sysinfo-mini-fill uptime-fill"
                  style={{ width: isOnline ? "100%" : "0%" }}
                />
              </div>
            </div>
          </div>

          <div className="ssh-sysinfo-panel-card">
            <div className="sysinfo-panel-header">
              <div className="sysinfo-panel-title">
                <Activity size={15} />
                <span>CPU 负载历史趋势</span>
              </div>
              <div className="sysinfo-chart-stats">
                <span>平均负载: <strong>{chartPoints.avg}%</strong></span>
                <span className="stat-divider">·</span>
                <span>峰值记录: <strong>{chartPoints.peak}%</strong></span>
              </div>
            </div>

            <div className="sysinfo-svg-chart-wrap">
              <svg
                viewBox={`0 0 ${chartPoints.width} ${chartPoints.height}`}
                className="sysinfo-svg-canvas"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0284c7" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {[0, 25, 50, 75, 100].map((pct) => {
                  const y = chartPoints.padding.top + chartPoints.chartH - (pct / 100) * chartPoints.chartH;
                  return (
                    <g key={pct}>
                      <line
                        x1={chartPoints.padding.left}
                        y1={y}
                        x2={chartPoints.width - chartPoints.padding.right}
                        y2={y}
                        className="sysinfo-grid-line"
                      />
                      <text
                        x={chartPoints.padding.left - 6}
                        y={y + 3}
                        className="sysinfo-axis-text"
                        textAnchor="end"
                      >
                        {pct}%
                      </text>
                    </g>
                  );
                })}

                {chartPoints.areaPath && (
                  <path d={chartPoints.areaPath} fill="url(#cpuGradient)" />
                )}
                {chartPoints.linePath && (
                  <path
                    d={chartPoints.linePath}
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {chartPoints.coords.length > 0 && (
                  <circle
                    cx={chartPoints.coords[chartPoints.coords.length - 1]!.x}
                    cy={chartPoints.coords[chartPoints.coords.length - 1]!.y}
                    r="4"
                    fill="#0284c7"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                )}
              </svg>
            </div>
          </div>

          <div className="ssh-sysinfo-panel-card">
            <div className="sysinfo-panel-header">
              <div className="sysinfo-panel-title">
                <Disc size={15} />
                <span>资源分配与容量</span>
              </div>
            </div>

            <div className="sysinfo-alloc-container">
              <div className="sysinfo-alloc-block">
                <div className="alloc-header-row">
                  <span className="alloc-name">物理内存 (RAM)</span>
                  <div className="alloc-tags">
                    <span className="alloc-used-tag">已用 {(currentMemMb / 1024).toFixed(1)} GB</span>
                    <span className="alloc-free-tag">可用 {Math.max(0, (totalMemMb - currentMemMb) / 1024).toFixed(1)} GB</span>
                  </div>
                </div>
                <div className="alloc-bar-track">
                  <div
                    className="alloc-bar-segment used-mem"
                    style={{ width: `${memPercent}%` }}
                  />
                </div>
              </div>

              <div className="sysinfo-alloc-block">
                <div className="alloc-header-row">
                  <span className="alloc-name">系统存储 (Root Partition /)</span>
                  <div className="alloc-tags">
                    <span className="alloc-used-tag">已用 {currentDiskGb.toFixed(1)} GB</span>
                    <span className="alloc-free-tag">可用 {Math.max(0, totalDiskGb - currentDiskGb).toFixed(1)} GB</span>
                  </div>
                </div>
                <div className="alloc-bar-track">
                  <div
                    className="alloc-bar-segment used-disk"
                    style={{ width: `${diskPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="ssh-sysinfo-panel-card">
            <div className="sysinfo-panel-header">
              <div className="sysinfo-panel-title">
                <Server size={15} />
                <span>系统规格与硬件参数</span>
              </div>
            </div>

            <div className="sysinfo-specs-grid">
              <div className="spec-item">
                <span className="spec-label">节点名称</span>
                <span className="spec-value" title={node.name}>{node.name}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">主机地址</span>
                <span className="spec-value" title={node.host}>{node.host}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">服务端口</span>
                <span className="spec-value">{node.port}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">连接协议</span>
                <span className="spec-value">SSH 2.0</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">操作系统</span>
                <span className="spec-value">{node.os || "Linux"}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">硬件架构</span>
                <span className="spec-value">{node.arch || "x64"}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">默认工作目录</span>
                <span className="spec-value">/</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">探针就绪状态</span>
                <span className="spec-value">{isOnline ? "在线正常" : "未连接"}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">初次接入时间</span>
                <span className="spec-value">{formatDate(node.createdAt)}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">最近心跳时间</span>
                <span className="spec-value">{formatDate(node.lastSeenAt || node.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary, #86868b)" }}>
            最近数据刷新: {lastRefreshedAt.toLocaleTimeString()}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void fetchMetrics(true)}
              disabled={loading}
              title="立即刷新系统监控数据"
            >
              <RotateCw size={14} className={loading ? "spin" : ""} style={{ marginRight: 6 }} />
              刷新
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
