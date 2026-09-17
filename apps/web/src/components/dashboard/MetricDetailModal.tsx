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
  onClose,
  onTestNode,
  testingNodeId
}: {
  kind: MetricDetailKind;
  overview: DashboardOverview | null;
  nodes: ManagedNode[];
  clusterResources: { cpuUsage: number; memoryUsage: number; diskUsage: number };
  onClose: () => void;
  onTestNode?: ((id: string) => void) | undefined;
  testingNodeId?: string | null | undefined;
}) {

  const { t } = usePanelLanguage();
  const meta = metricMeta[kind];

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

  const title = t(`metric.detail.title.${kind}` as any);
  const hint = t(`metric.detail.hint.${kind}` as any);
  const chartName = kind === "cpu" ? "CPU" : kind === "memory" ? t("metric.detail.memory") : t("metric.detail.disk");

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
            <span>{kind === "nodes" ? t("metric.detail.onlineTotal") : t("metric.detail.clusterAvg")}</span>
          </div>
          <button className="icon-button mini metric-detail-close" type="button" title={t("common.close")} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="metric-detail-hero">
          {kind === "nodes" ? (
            <>
              <HeroStat icon={<Wifi size={16} />} label={t("metric.detail.online")} value={String(onlineCount)} tone="ok" />
              <HeroStat icon={<WifiOff size={16} />} label={t("metric.detail.offline")} value={String(Math.max(nodes.length - onlineCount, 0))} tone="warn" />
              <HeroStat icon={<Server size={16} />} label={t("metric.detail.totalNodes")} value={String(nodes.length)} />
              <HeroStat
                icon={<Activity size={16} />}
                label={t("metric.detail.lastHeartbeat")}
                value={formatDate(nodes.map((node) => node.lastSeenAt).filter(Boolean).sort().at(-1) as string | undefined)}
              />
            </>
          ) : (
            <>
              <HeroStat
                icon={<Activity size={16} />}
                label={t("metric.detail.current")}
                value={formatNumber(typeof currentValue === "number" ? currentValue : 0)}
                tone={usageTone(typeof currentValue === "number" ? currentValue : 0)}
              />
              <HeroStat icon={<Activity size={16} />} label={t("metric.detail.peak")} value={formatNumber(historyStats.peak)} tone={usageTone(historyStats.peak)} />
              <HeroStat icon={<Activity size={16} />} label={t("metric.detail.average")} value={formatNumber(historyStats.avg)} />
              <HeroStat
                icon={<Server size={16} />}
                label={t("metric.detail.hottestNode")}
                value={hottestNode ? `${hottestNode.name} ${formatNumber(meta.nodeKey ? nodeMetricValue(hottestNode, meta.nodeKey) : 0)}` : "-"}
              />
            </>
          )}
        </div>

        <div className={`metric-detail-body ${kind === "nodes" ? "nodes-only" : ""}`}>
          {kind !== "nodes" ? (
            <section className="metric-detail-chart-card">
              <div className="metric-detail-section-heading">
                <h3>{t("metric.detail.trend")}</h3>
                <span>{overview ? formatDate(overview.generatedAt) : "-"}</span>
              </div>
              <div className="metric-detail-chart">
                {history.length === 0 ? (
                  <SakiEmptyState
                    illustration="logs"
                    title={t("metric.detail.noHistory")}
                    description={t("metric.detail.noHistoryDesc")}
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
              <h3>{kind === "nodes" ? t("metric.detail.allNodes") : t("metric.detail.byNode")}</h3>
              <span>{nodes.length}</span>
            </div>
            {rankedNodes.length === 0 ? (
              <SakiEmptyState
                illustration="offline"
                title={t("metric.detail.noNodes")}
                description={t("metric.detail.noNodesDesc")}
                compact
              />
            ) : (
              <div className="metric-detail-node-list">
                {rankedNodes.map((node) => (
                  <NodeMetricCard
                    key={node.id}
                    node={node}
                    emphasis={kind}
                    onTestNode={onTestNode}
                    testingNodeId={testingNodeId}
                  />
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

function NodeMetricCard({
  node,
  emphasis,
  onTestNode,
  testingNodeId
}: {
  node: ManagedNode;
  emphasis: MetricDetailKind;
  onTestNode?: ((id: string) => void) | undefined;
  testingNodeId?: string | null | undefined;
}) {
  const { t } = usePanelLanguage();
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
  const isTesting = testingNodeId === node.id;

  return (
    <article className={`metric-node-card ${node.status === "ONLINE" ? "online" : "offline"} ${emphasis}`}>
      <div className="metric-node-card-head">
        <div className="metric-node-card-title">
          <strong>{node.name}</strong>
          <small>
            {node.protocol}://{node.host}:{node.port}
          </small>
        </div>
        <NodeStatusPill
          status={node.status}
          onClick={onTestNode ? () => onTestNode(node.id) : undefined}
          loading={isTesting}
          disabled={isTesting}
        />
      </div>

      <div className="metric-node-bars">
        <MetricBar label="CPU" value={cpu} highlight={emphasis === "cpu"} />
        <MetricBar
          label={t("metric.detail.memory")}
          value={memory}
          highlight={emphasis === "memory"}
          extra={memoryLabel && memoryTotal ? `${memoryLabel} / ${memoryTotal}` : memoryLabel}
        />
        <MetricBar
          label={t("metric.detail.disk")}
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
