import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { DashboardOverview, ManagedNode } from "@webops/shared";
import { usePanelLanguage } from "../../i18n/index.js";
import { NodeStatusPill } from "../common/CommonUI.js";
import { SakiEmptyState } from "../saki/SakiEmptyState.js";
import { formatDate, formatNumber } from "../../utils/path.js";

export type MetricDetailKind = "nodes" | "cpu" | "memory" | "disk";

const metricMeta: Record<
  MetricDetailKind,
  {
    title: string;
    hint: string;
    tone: "teal" | "blue" | "amber" | "gray";
    color: string;
    historyKey: "cpuUsage" | "memoryUsage" | "diskUsage" | null;
    nodeKey: "cpuUsage" | "memoryUsage" | "diskUsage" | null;
  }
> = {
  nodes: {
    title: "节点详情",
    hint: "查看每台节点的在线状态与资源占用",
    tone: "teal",
    color: "#ff75ac",
    historyKey: null,
    nodeKey: null
  },
  cpu: {
    title: "CPU 详情",
    hint: "集群平均占用与各节点实时负载",
    tone: "blue",
    color: "#2563eb",
    historyKey: "cpuUsage",
    nodeKey: "cpuUsage"
  },
  memory: {
    title: "内存详情",
    hint: "集群内存占用趋势与节点用量",
    tone: "amber",
    color: "#d97706",
    historyKey: "memoryUsage",
    nodeKey: "memoryUsage"
  },
  disk: {
    title: "磁盘详情",
    hint: "集群磁盘占用趋势与节点容量",
    tone: "gray",
    color: "#0f766e",
    historyKey: "diskUsage",
    nodeKey: "diskUsage"
  }
};

function formatMemory(mb?: number | null): string | null {
  if (typeof mb !== "number" || !Number.isFinite(mb)) return null;
  if (mb >= 1024) return `${Math.round((mb / 1024) * 10) / 10} GB`;
  return `${Math.round(mb)} MB`;
}

function formatDisk(gb?: number | null): string | null {
  if (typeof gb !== "number" || !Number.isFinite(gb)) return null;
  if (gb >= 1024) return `${Math.round((gb / 1024) * 100) / 100} TB`;
  return `${Math.round(gb * 10) / 10} GB`;
}

function formatUptime(seconds?: number | null): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function usageTone(value: number): "ok" | "warn" | "hot" {
  if (value >= 85) return "hot";
  if (value >= 65) return "warn";
  return "ok";
}

function nodeMetricValue(node: ManagedNode, key: "cpuUsage" | "memoryUsage" | "diskUsage"): number {
  return node.latestMetric?.[key] ?? 0;
}

export function MetricDetailModal({
  kind,
  overview,
  nodes,
  clusterResources,
  onClose
}: {
  kind: MetricDetailKind;
  overview: DashboardOverview | null;
  nodes: ManagedNode[];
  clusterResources: { cpuUsage: number; memoryUsage: number; diskUsage: number };
  onClose: () => void;
}) {
  const { language } = usePanelLanguage();
  const meta = metricMeta[kind];
  const isEn = language === "en-US";
  const isTw = language === "zh-TW";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const history = useMemo(
    () =>
      (overview?.history ?? []).map((item) => ({
        ...item,
        label: formatDate(item.time)
      })),
    [overview]
  );

  const historyValues = useMemo(() => {
    if (!meta.historyKey) return [];
    return history.map((item) => item[meta.historyKey!]).filter((value) => Number.isFinite(value));
  }, [history, meta.historyKey]);

  const historyStats = useMemo(() => {
    if (historyValues.length === 0) return { avg: 0, peak: 0, low: 0 };
    return {
      avg: Math.round((historyValues.reduce((sum, value) => sum + value, 0) / historyValues.length) * 10) / 10,
      peak: Math.round(Math.max(...historyValues) * 10) / 10,
      low: Math.round(Math.min(...historyValues) * 10) / 10
    };
  }, [historyValues]);

  const rankedNodes = useMemo(() => {
    const list = [...nodes];
    if (meta.nodeKey) {
      list.sort((left, right) => nodeMetricValue(right, meta.nodeKey!) - nodeMetricValue(left, meta.nodeKey!));
    } else {
      list.sort((left, right) => Number(right.status === "ONLINE") - Number(left.status === "ONLINE"));
    }
    return list;
  }, [meta.nodeKey, nodes]);

  const onlineCount = nodes.filter((node) => node.status === "ONLINE").length;
  const hottestNode = rankedNodes[0] ?? null;
  const currentValue =
    kind === "cpu" ? clusterResources.cpuUsage : kind === "memory" ? clusterResources.memoryUsage : kind === "disk" ? clusterResources.diskUsage : onlineCount;

  const title = isEn
    ? kind === "nodes"
      ? "Node Details"
      : kind === "cpu"
        ? "CPU Details"
        : kind === "memory"
          ? "Memory Details"
          : "Disk Details"
    : isTw
      ? kind === "nodes"
        ? "節點詳情"
        : kind === "cpu"
          ? "CPU 詳情"
          : kind === "memory"
            ? "記憶體詳情"
            : "磁碟詳情"
      : meta.title;

  const hint = isEn
    ? kind === "nodes"
      ? "Live status and resource usage for every node"
      : kind === "cpu"
        ? "Cluster average load and per-node CPU"
        : kind === "memory"
          ? "Memory trend and usage by node"
          : "Disk trend and capacity by node"
    : isTw
      ? meta.hint.replace("集群", "叢集").replace("节点", "節點").replace("内存", "記憶體").replace("磁盘", "磁碟")
      : meta.hint;

  const chartName = kind === "cpu" ? "CPU" : kind === "memory" ? (isEn ? "Memory" : isTw ? "記憶體" : "内存") : isEn ? "Disk" : isTw ? "磁碟" : "磁盘";

  const modal = (
    <div
      className={`metric-detail-backdrop tone-${meta.tone}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="metric-detail-modal" role="dialog" aria-modal="true" aria-labelledby="metric-detail-title">
        <header className="metric-detail-header">
          <div className={`metric-detail-brand metric-${meta.tone}`}>
            <span className="metric-detail-brand-icon">
              {kind === "nodes" ? <Server size={20} /> : kind === "cpu" ? <Cpu size={20} /> : kind === "memory" ? <MemoryStick size={20} /> : <HardDrive size={20} />}
            </span>
            <div>
              <h2 id="metric-detail-title">{title}</h2>
              <p>{hint}</p>
            </div>
          </div>
          <div className="metric-detail-header-value">
            <strong>{kind === "nodes" ? `${onlineCount}/${nodes.length}` : formatNumber(typeof currentValue === "number" ? currentValue : 0)}</strong>
            <span>{kind === "nodes" ? (isEn ? "online / total" : isTw ? "在線 / 全部" : "在线 / 全部") : isEn ? "cluster avg" : isTw ? "叢集平均" : "集群平均"}</span>
          </div>
          <button className="icon-button mini metric-detail-close" type="button" title={isEn ? "Close" : isTw ? "關閉" : "关闭"} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="metric-detail-hero">
          {kind === "nodes" ? (
            <>
              <HeroStat icon={<Wifi size={16} />} label={isEn ? "Online" : isTw ? "在線" : "在线"} value={String(onlineCount)} tone="ok" />
              <HeroStat icon={<WifiOff size={16} />} label={isEn ? "Offline" : isTw ? "離線" : "离线"} value={String(Math.max(nodes.length - onlineCount, 0))} tone="warn" />
              <HeroStat icon={<Server size={16} />} label={isEn ? "Total nodes" : isTw ? "節點總數" : "节点总数"} value={String(nodes.length)} />
              <HeroStat
                icon={<Activity size={16} />}
                label={isEn ? "Last heartbeat" : isTw ? "最近心跳" : "最近心跳"}
                value={formatDate(nodes.map((node) => node.lastSeenAt).filter(Boolean).sort().at(-1) as string | undefined)}
              />
            </>
          ) : (
            <>
              <HeroStat
                icon={<Activity size={16} />}
                label={isEn ? "Current" : isTw ? "目前" : "当前"}
                value={formatNumber(typeof currentValue === "number" ? currentValue : 0)}
                tone={usageTone(typeof currentValue === "number" ? currentValue : 0)}
              />
              <HeroStat icon={<Activity size={16} />} label={isEn ? "Peak" : isTw ? "峰值" : "峰值"} value={formatNumber(historyStats.peak)} tone={usageTone(historyStats.peak)} />
              <HeroStat icon={<Activity size={16} />} label={isEn ? "Average" : isTw ? "平均" : "平均"} value={formatNumber(historyStats.avg)} />
              <HeroStat
                icon={<Server size={16} />}
                label={isEn ? "Hottest node" : isTw ? "最高負載節點" : "最高负载节点"}
                value={hottestNode ? `${hottestNode.name} ${formatNumber(meta.nodeKey ? nodeMetricValue(hottestNode, meta.nodeKey) : 0)}` : "-"}
              />
            </>
          )}
        </div>

        <div className={`metric-detail-body ${kind === "nodes" ? "nodes-only" : ""}`}>
          {kind !== "nodes" ? (
            <section className="metric-detail-chart-card">
              <div className="metric-detail-section-heading">
                <h3>{isEn ? "Trend" : isTw ? "趨勢" : "趋势"}</h3>
                <span>{overview ? formatDate(overview.generatedAt) : "-"}</span>
              </div>
              <div className="metric-detail-chart">
                {history.length === 0 ? (
                  <SakiEmptyState
                    illustration="logs"
                    title={isEn ? "No history yet" : isTw ? "暫無歷史曲線" : "暂无历史曲线"}
                    description={isEn ? "Metrics will appear after nodes start reporting." : isTw ? "節點開始上報後就會出現曲線。" : "节点开始上报后就会出现曲线。"}
                    compact
                  />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`metric-area-${kind}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={meta.color} stopOpacity={0.38} />
                          <stop offset="95%" stopColor={meta.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.25)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={36} tickLine={false} domain={[0, 100]} />
                      <Tooltip
                        formatter={(value) => [typeof value === "number" ? formatNumber(value) : String(value ?? "-"), chartName]}
                      />
                      <Area
                        type="monotone"
                        dataKey={meta.historyKey ?? "cpuUsage"}
                        name={chartName}
                        stroke={meta.color}
                        strokeWidth={2.4}
                        fill={`url(#metric-area-${kind})`}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          ) : null}

          <section className="metric-detail-nodes-card">
            <div className="metric-detail-section-heading">
              <h3>{kind === "nodes" ? (isEn ? "All nodes" : isTw ? "全部節點" : "全部节点") : isEn ? "By node" : isTw ? "各節點" : "各节点"}</h3>
              <span>{nodes.length}</span>
            </div>
            {rankedNodes.length === 0 ? (
              <SakiEmptyState
                illustration="offline"
                title={isEn ? "No nodes" : isTw ? "暫無節點" : "暂无节点"}
                description={isEn ? "Connect a daemon to see live metrics here." : isTw ? "接入 Daemon 後即可在此查看即時指標。" : "接入 Daemon 后即可在此查看实时指标。"}
                compact
              />
            ) : (
              <div className="metric-detail-node-list">
                {rankedNodes.map((node) => (
                  <NodeMetricCard key={node.id} node={node} emphasis={kind} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function HeroStat({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok" | "warn" | "hot";
}) {
  return (
    <div className={`metric-detail-stat ${tone ?? ""}`}>
      <span className="metric-detail-stat-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function NodeMetricCard({ node, emphasis }: { node: ManagedNode; emphasis: MetricDetailKind }) {
  const metric = node.latestMetric;
  const cpu = metric?.cpuUsage ?? 0;
  const memory = metric?.memoryUsage ?? 0;
  const disk = metric?.diskUsage ?? 0;
  const memoryLabel = formatMemory(metric?.usedMemoryMb);
  const memoryTotal = formatMemory(metric?.totalMemoryMb);
  const diskLabel = formatDisk(metric?.usedDiskGb);
  const diskTotal = formatDisk(metric?.totalDiskGb);
  const uptime = formatUptime(metric?.uptimeSeconds);
  const load = typeof metric?.loadAverage1m === "number" ? metric.loadAverage1m.toFixed(2) : null;

  return (
    <article className={`metric-node-card ${node.status === "ONLINE" ? "online" : "offline"} ${emphasis}`}>
      <div className="metric-node-card-head">
        <div className="metric-node-card-title">
          <strong>{node.name}</strong>
          <small>
            {node.protocol}://{node.host}:{node.port}
          </small>
        </div>
        <NodeStatusPill status={node.status} />
      </div>
      <div className="metric-node-bars">
        <MetricBar label="CPU" value={cpu} highlight={emphasis === "cpu"} />
        <MetricBar
          label="内存"
          value={memory}
          highlight={emphasis === "memory"}
          extra={memoryLabel && memoryTotal ? `${memoryLabel} / ${memoryTotal}` : memoryLabel}
        />
        <MetricBar
          label="磁盘"
          value={disk}
          highlight={emphasis === "disk"}
          extra={diskLabel && diskTotal ? `${diskLabel} / ${diskTotal}` : diskLabel}
        />
      </div>
      <div className="metric-node-foot">
        <span>{[node.os, node.arch].filter(Boolean).join(" / ") || "未知系统"}</span>
        <span>心跳 {formatDate(node.lastSeenAt)}</span>
        {load ? <span>负载 {load}</span> : null}
        {uptime ? <span>运行 {uptime}</span> : null}
      </div>
    </article>
  );
}

function MetricBar({
  label,
  value,
  highlight,
  extra
}: {
  label: string;
  value: number;
  highlight?: boolean;
  extra?: string | null;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`metric-bar ${highlight ? "is-highlight" : ""} ${usageTone(clamped)}`}>
      <div className="metric-bar-label">
        <span>{label}</span>
        <strong>
          {formatNumber(clamped)}
          {extra ? <em>{extra}</em> : null}
        </strong>
      </div>
      <div className="metric-bar-track" aria-hidden="true">
        <div className="metric-bar-fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
