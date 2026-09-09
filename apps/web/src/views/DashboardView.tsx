import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  Cpu,
  HardDrive,
  MemoryStick,
  Server,
  Wifi
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { DashboardOverview, ManagedInstance, ManagedNode } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { usePanelLanguage } from "../i18n/index.js";
import type { PanelLanguage } from "../i18n/translations.js";
import {
  InstanceStatusBadge,
  InstanceStatusIcon,
  instanceStatusMeta,
  instanceTypeLabel,
  MetricTile,
  NodeStatusPill,
  PageErrorToast
} from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { MetricDetailModal, type MetricDetailKind } from "../components/dashboard/MetricDetailModal.js";
import { formatDate, formatNumber, resourcesFromNodes } from "../utils/path.js";
import { readRecentInstances } from "../utils/recentInstances.js";

const RECENT_INSTANCE_LIMIT = 8;

function formatRelativeTime(value: string | null | undefined, language: PanelLanguage): string {
  if (!value) return "-";
  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "-";
  const abs = Math.abs(diff);
  const locale = language === "en-US" ? "en" : language === "zh-TW" ? "zh-Hant" : "zh-Hans";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60_000) return rtf.format(0, "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

function instanceActivityAt(instance: ManagedInstance, openedAt?: string): string {
  return openedAt || instance.lastStartedAt || instance.updatedAt;
}

export function DashboardView({
  token,
  onLogout,
  refreshTick,
  canViewNodes,
  canTestNodes,
  canViewInstances,
  onOpenInstance
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  canViewNodes: boolean;
  canTestNodes: boolean;
  canViewInstances: boolean;
  onOpenInstance: (instanceId: string | null) => void;
}) {
  const { language } = usePanelLanguage();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [instances, setInstances] = useState<ManagedInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [metricDetail, setMetricDetail] = useState<MetricDetailKind | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      setOverview(await api.dashboard(token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "概览数据加载失败");
    }

    if (canViewNodes) {
      try {
        setNodes(await api.nodes(token));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onLogout();
          return;
        }
        setError((current) => current || (err instanceof Error ? err.message : "节点数据加载失败"));
      }
    } else {
      setNodes([]);
    }

    if (canViewInstances) {
      try {
        setInstances(await api.instances(token));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onLogout();
          return;
        }
        setError((current) => current || (err instanceof Error ? err.message : "实例数据加载失败"));
      }
    } else {
      setInstances([]);
    }

    setLoading(false);
  }, [canViewInstances, canViewNodes, onLogout, token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshTick]);

  const chartData = useMemo(
    () =>
      overview?.history.map((item) => ({
        ...item,
        label: formatDate(item.time)
      })) ?? [],
    [overview]
  );

  async function testNode(id: string) {
    if (!canTestNodes) return;
    setTestingNodeId(id);
    setError("");
    try {
      await api.testNode(token, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "节点测试失败");
    } finally {
      setTestingNodeId(null);
    }
  }

  const displayStats = useMemo(() => {
    if (overview) {
      const overviewResources = overview.resources;
      const hasOverviewResources =
        overviewResources.cpuUsage > 0 || overviewResources.memoryUsage > 0 || overviewResources.diskUsage > 0;
      const nodeResources = resourcesFromNodes(nodes);
      const hasNodeResources =
        nodeResources.cpuUsage > 0 || nodeResources.memoryUsage > 0 || nodeResources.diskUsage > 0;
      const nodeCounts =
        overview.nodes.total > 0
          ? overview.nodes
          : {
              online: nodes.filter((node) => node.status === "ONLINE").length,
              total: nodes.length
            };

      return {
        online: nodeCounts.online,
        total: nodeCounts.total,
        resources: hasOverviewResources || !hasNodeResources ? overviewResources : nodeResources
      };
    }

    if (nodes.length > 0) {
      return {
        online: nodes.filter((node) => node.status === "ONLINE").length,
        total: nodes.length,
        resources: resourcesFromNodes(nodes)
      };
    }

    return null;
  }, [nodes, overview]);

  const recentInstances = useMemo(() => {
    const visits = readRecentInstances();
    const visitRank = new Map(visits.map((entry, index) => [entry.id, index]));
    const openedAtById = new Map(visits.map((entry) => [entry.id, entry.openedAt]));
    const visited = instances
      .filter((instance) => visitRank.has(instance.id))
      .sort((left, right) => (visitRank.get(left.id) ?? 0) - (visitRank.get(right.id) ?? 0));
    const rest = instances
      .filter((instance) => !visitRank.has(instance.id))
      .sort((left, right) => {
        const leftTime = new Date(left.lastStartedAt || left.updatedAt).getTime();
        const rightTime = new Date(right.lastStartedAt || right.updatedAt).getTime();
        return rightTime - leftTime;
      });
    return [...visited, ...rest].slice(0, RECENT_INSTANCE_LIMIT).map((instance) => ({
      instance,
      openedAt: openedAtById.get(instance.id)
    }));
  }, [instances]);

  const resources = displayStats?.resources ?? { cpuUsage: 0, memoryUsage: 0, diskUsage: 0 };
  const nodeCountValue =
    loading && !displayStats ? "-" : `${displayStats?.online ?? 0}/${displayStats?.total ?? 0}`;
  const formatMetricValue = (value: number) => (loading && !displayStats ? "-" : formatNumber(value));

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />

      <section className="metrics-grid">
        <MetricTile
          icon={<Server size={22} />}
          label="在线节点"
          value={nodeCountValue}
          tone="teal"
          onClick={() => setMetricDetail("nodes")}
        />
        <MetricTile
          icon={<Cpu size={22} />}
          label="CPU"
          value={formatMetricValue(resources.cpuUsage)}
          tone="blue"
          onClick={() => setMetricDetail("cpu")}
        />
        <MetricTile
          icon={<MemoryStick size={22} />}
          label="内存"
          value={formatMetricValue(resources.memoryUsage)}
          tone="amber"
          onClick={() => setMetricDetail("memory")}
        />
        <MetricTile
          icon={<HardDrive size={22} />}
          label="磁盘"
          value={formatMetricValue(resources.diskUsage)}
          tone="gray"
          onClick={() => setMetricDetail("disk")}
        />
      </section>

      <section className="content-grid">
        <div className="panel-block chart-block">
          <div className="section-heading">
            <h2>资源曲线</h2>
            <span>{overview ? formatDate(overview.generatedAt) : "-"}</span>
          </div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e8" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#687786" />
                <YAxis tick={{ fontSize: 12 }} stroke="#687786" width={34} />
                <Tooltip />
                <Line type="monotone" dataKey="cpuUsage" name="CPU" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="memoryUsage" name="内存" stroke="#d97706" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="diskUsage" name="磁盘" stroke="#0f766e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-block recent-instances-block">
          <div className="section-heading">
            <h2>最近实例</h2>
            {canViewInstances ? (
              <button className="recent-instances-all" type="button" onClick={() => onOpenInstance(null)}>
                <span>查看全部</span>
                <ArrowRight size={14} />
              </button>
            ) : null}
          </div>
          <div className="recent-instance-list">
            {recentInstances.map(({ instance, openedAt }) => {
              const meta = instanceStatusMeta(instance.status);
              const activityAt = instanceActivityAt(instance, openedAt);
              return (
                <button
                  className={`recent-instance-row ${meta.className}`}
                  key={instance.id}
                  type="button"
                  onClick={() => onOpenInstance(instance.id)}
                  title={`进入 ${instance.name}`}
                >
                  <span className={`recent-instance-icon ${meta.className}`} aria-hidden="true">
                    <InstanceStatusIcon status={instance.status} size={18} />
                  </span>
                  <span className="recent-instance-copy">
                    <strong>{instance.name}</strong>
                    <small>
                      {instanceTypeLabel(instance.type)}
                      <span className="recent-instance-dot" aria-hidden="true">
                        ·
                      </span>
                      {instance.nodeName || instance.nodeId}
                    </small>
                  </span>
                  <span className="recent-instance-meta">
                    <InstanceStatusBadge status={instance.status} compact />
                    <time dateTime={activityAt} title={formatDate(activityAt)}>
                      {formatRelativeTime(activityAt, language)}
                    </time>
                  </span>
                  <ChevronRight className="recent-instance-chevron" size={16} aria-hidden="true" />
                </button>
              );
            })}
            {!loading && recentInstances.length === 0 ? (
              <SakiEmptyState
                illustration="instances"
                title={canViewInstances ? "暂无实例" : "暂无实例权限"}
                description={
                  canViewInstances
                    ? "创建或打开实例后，最近使用的会显示在这里"
                    : "当前账号没有实例查看权限"
                }
                compact
              />
            ) : null}
          </div>
        </div>
      </section>

      {canViewNodes ? (
        <section className="panel-block nodes-block">
          <div className="section-heading">
            <h2>节点</h2>
            <span>{nodes.length} 台</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>地址</th>
                  <th>状态</th>
                  <th>系统</th>
                  <th>资源</th>
                  <th>心跳</th>
                  {canTestNodes ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => (
                  <tr key={node.id}>
                    <td>
                      <strong>{node.name}</strong>
                    </td>
                    <td>{`${node.protocol}://${node.host}:${node.port}`}</td>
                    <td>
                      <NodeStatusPill status={node.status} />
                    </td>
                    <td>{[node.os, node.arch].filter(Boolean).join(" / ") || "-"}</td>
                    <td>
                      {node.latestMetric
                        ? `${formatNumber(node.latestMetric.cpuUsage)} / ${formatNumber(node.latestMetric.memoryUsage)}`
                        : "-"}
                    </td>
                    <td>{formatDate(node.lastSeenAt)}</td>
                    {canTestNodes ? (
                      <td>
                        <button
                          className="icon-button mini"
                          title="测试连接"
                          aria-label="测试连接"
                          type="button"
                          onClick={() => void testNode(node.id)}
                          disabled={testingNodeId === node.id}
                        >
                          <Wifi size={14} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {nodes.length === 0 ? (
                  <tr>
                    <td colSpan={canTestNodes ? 7 : 6}>
                      <SakiEmptyState
                        illustration="offline"
                        title="暂无已连接节点"
                        description="未检测到活跃的 Daemon 节点，请在节点管理中添加并连接"
                        compact
                      />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {metricDetail ? (
        <MetricDetailModal
          kind={metricDetail}
          overview={overview}
          nodes={nodes}
          clusterResources={resources}
          onClose={() => setMetricDetail(null)}
        />
      ) : null}
    </>
  );
}

