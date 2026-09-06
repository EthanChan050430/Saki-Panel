import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Repeat,
  Timer,
  Wrench
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
import type { IncidentReport, IncidentTrigger } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { formatDate } from "../utils/path.js";

const reportDayOptions = [7, 14, 30] as const;

function reportTriggerLabel(trigger: IncidentTrigger): string {
  switch (trigger) {
    case "crash":
      return "进程崩溃";
    case "crash_loop":
      return "崩溃循环";
    case "disk":
      return "磁盘告警";
    case "memory":
      return "内存告警";
    case "webhook":
      return "Webhook";
    case "health":
      return "健康检查";
    default:
      return trigger;
  }
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatMinutes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return String(Math.round(value * 10) / 10);
}

function truncateFingerprint(fingerprint: string, maxLength = 18): string {
  return fingerprint.length > maxLength ? `${fingerprint.slice(0, maxLength)}…` : fingerprint;
}

function ReliabilityTile({
  icon,
  label,
  value,
  sub,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "teal" | "amber" | "blue" | "gray";
}) {
  return (
    <div className={`metric-tile metric-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {sub ? <small className="metric-sub">{sub}</small> : null}
      </div>
    </div>
  );
}

export function ReliabilityView({
  token,
  onLogout,
  refreshTick
}: {
  token: string;
  onLogout: () => void;
  refreshTick: number;
}) {
  const [days, setDays] = useState<number>(7);
  const [report, setReport] = useState<IncidentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      setReport(await api.incidentReport(token, days));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "可靠性报告加载失败");
    } finally {
      setLoading(false);
    }
  }, [days, onLogout, token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshTick]);

  const chartData = useMemo(
    () =>
      (report?.daily ?? []).map((item) => ({
        ...item,
        label: item.date.slice(5)
      })),
    [report]
  );

  const totals = report?.totals;
  const empty = report !== null && totals?.opened === 0;

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />

      <section className="panel-block reliability-header-block">
        <div className="section-heading">
          <h2>可靠性报告</h2>
          <div className="reliability-header-tools">
            <div className="reliability-days">
              {reportDayOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={days === option ? "active" : ""}
                  onClick={() => setDays(option)}
                >
                  {option} 天
                </button>
              ))}
            </div>
            <span className="reliability-updated">
              {report ? `更新于 ${formatDate(report.generatedAt)}` : loading ? "载入中" : "-"}
            </span>
          </div>
        </div>
      </section>

      {empty ? (
        <section className="panel-block reliability-empty-block">
          <SakiEmptyState
            illustration="healthy"
            title="窗口期内没有值班事件"
            description={`最近 ${report?.days ?? days} 天各实例运行平稳，Saki 值班没有记录到新事件`}
          />
        </section>
      ) : (
        <>
          <section className="metrics-grid reliability-metrics">
            <ReliabilityTile
              icon={<Timer size={22} />}
              label="MTTR（分钟）"
              value={report ? formatMinutes(report.mttrMinutes) : "-"}
              sub="平均恢复时间"
              tone="teal"
            />
            <ReliabilityTile
              icon={<Activity size={22} />}
              label="事件总数"
              value={report ? String(totals?.opened ?? 0) : "-"}
              sub={`${totals?.activeNow ?? 0} 进行中`}
              tone="blue"
            />
            <ReliabilityTile
              icon={<CheckCircle2 size={22} />}
              label="已恢复 / 失败"
              value={report ? `${totals?.resolved ?? 0} / ${totals?.failed ?? 0}` : "-"}
              sub="已解决 / 修复失败"
              tone="amber"
            />
            <ReliabilityTile
              icon={<Wrench size={22} />}
              label="自动修复成功率"
              value={report ? formatPercent(report.autoFix.successRate) : "-"}
              sub={`尝试 ${report?.autoFix.attempted ?? 0} 次 · 成功 ${report?.autoFix.succeeded ?? 0} 次`}
              tone="teal"
            />
            <ReliabilityTile
              icon={<Repeat size={22} />}
              label="复发率"
              value={report ? formatPercent(report.recurrenceRate) : "-"}
              sub="复发事件占比"
              tone="gray"
            />
          </section>

          <section className="panel-block chart-block reliability-chart-block">
            <div className="section-heading">
              <h2>事件趋势</h2>
              <span>新增 vs 已恢复</span>
            </div>
            <div className="chart-frame">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e8" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#687786" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#687786" width={34} allowDecimals={false} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="opened"
                    name="新增事件"
                    stroke="#dc2626"
                    fill="#dc2626"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="resolved"
                    name="已恢复"
                    stroke="#0f766e"
                    fill="#0f766e"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="reliability-tables">
            <div className="panel-block reliability-table-block">
              <div className="section-heading">
                <h2>TOP 复发指纹</h2>
                <span>{report?.topRecurring.length ?? 0} 条</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>指纹</th>
                      <th>实例</th>
                      <th>触发类型</th>
                      <th>次数</th>
                      <th>最近发生</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.topRecurring ?? []).map((item) => (
                      <tr key={`${item.instanceId}-${item.fingerprint}`}>
                        <td>
                          <code className="reliability-fingerprint" title={item.fingerprint}>
                            {truncateFingerprint(item.fingerprint)}
                          </code>
                        </td>
                        <td>
                          <strong>{item.instanceName}</strong>
                        </td>
                        <td>{reportTriggerLabel(item.trigger)}</td>
                        <td>{item.count} 次</td>
                        <td>{formatDate(item.lastOccurredAt)}</td>
                      </tr>
                    ))}
                    {(report?.topRecurring.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <SakiEmptyState
                            illustration="healthy"
                            title="暂无复发事件"
                            description="窗口期内没有重复出现的故障指纹"
                            compact
                          />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel-block reliability-table-block">
              <div className="section-heading">
                <h2>实例可靠性排行</h2>
                <span>{report?.perInstance.length ?? 0} 个实例</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>实例</th>
                      <th>事件数</th>
                      <th>已恢复</th>
                      <th>失败</th>
                      <th>MTTR（分钟）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.perInstance ?? []).map((item) => (
                      <tr key={item.instanceId}>
                        <td>
                          <strong>{item.instanceName}</strong>
                        </td>
                        <td>{item.total}</td>
                        <td>{item.resolved}</td>
                        <td>{item.failed}</td>
                        <td>{formatMinutes(item.mttrMinutes)}</td>
                      </tr>
                    ))}
                    {(report?.perInstance.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <SakiEmptyState
                            illustration="instances"
                            title="暂无实例数据"
                            description="窗口期内各实例没有值班事件记录"
                            compact
                          />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
