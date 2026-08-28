import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  HardDrive,
  Layers,
  MemoryStick,
  RefreshCw,
  Server,
  Wifi,
  Zap
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { DashboardOverview, ManagedNode } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { usePanelT } from "../i18n/index.js";
import { MetricTile, NodeStatusPill, PageErrorToast } from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { formatBytes, formatDate, formatNumber, resourcesFromNodes } from "../utils/path.js";

export function DashboardView({
  token,
  onLogout,
  refreshTick,
  canViewNodes,
  canTestNodes
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
  canViewNodes: boolean;
  canTestNodes: boolean;
}) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);

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

    setLoading(false);
  }, [canViewNodes, onLogout, token]);

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
        />
        <MetricTile icon={<Cpu size={22} />} label="CPU" value={formatMetricValue(resources.cpuUsage)} tone="blue" />
        <MetricTile icon={<MemoryStick size={22} />} label="内存" value={formatMetricValue(resources.memoryUsage)} tone="amber" />
        <MetricTile icon={<HardDrive size={22} />} label="磁盘" value={formatMetricValue(resources.diskUsage)} tone="gray" />
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

        <div className="panel-block operations-block">
          <div className="section-heading">
            <h2>最近操作</h2>
          </div>
          <div className="operation-list">
            {(overview?.recentOperations ?? []).map((item) => (
              <div className="operation-row" key={item.id}>
                <span>{item.action}</span>
                <strong className={item.result === "SUCCESS" ? "success" : "failure"}>
                  {item.result === "SUCCESS" ? "成功" : "失败"}
                </strong>
                <time>{formatDate(item.createdAt)}</time>
              </div>
            ))}
            {(overview?.recentOperations?.length ?? 0) === 0 ? (
              <SakiEmptyState
                illustration="logs"
                title="暂无操作记录"
                description="近期系统运行平稳，暂无新的操作信号或审计记录产生"
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
    </>
  );
}

