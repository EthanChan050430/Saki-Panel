import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  Coins,
  Infinity as InfinityIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  X
} from "lucide-react";
import type { UserPointsSummary } from "@webops/shared";
import { api } from "./api.js";

function formatDate(raw: string): string {
  try {
    const d = new Date(raw);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hour}:${minute}`;
  } catch {
    return raw;
  }
}

export function PointsUsageModal({
  token,
  open,
  onClose,
  darkMode
}: {
  token: string;
  open: boolean;
  onClose: () => void;
  darkMode?: boolean;
}) {
  const [summary, setSummary] = useState<UserPointsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!token || !open) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.myPoints(token);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取使用量数据失败");
    } finally {
      setLoading(false);
    }
  }, [open, token]);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  if (!open) return null;

  const chartData = (summary?.dailyUsage ?? []).map((item) => ({
    ...item,
    displayDate: item.date.slice(5) // MM-DD
  }));

  const isDark = Boolean(darkMode);
  const strokeColor = "#ff75ac";
  const fillColor = isDark ? "rgba(255, 117, 172, 0.15)" : "rgba(255, 117, 172, 0.25)";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const textColor = isDark ? "#94a3b8" : "#64748b";

  return (
    <div
      className="modal-backdrop points-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog points-usage-modal" role="dialog" aria-modal="true">
        <header className="points-modal-header">
          <div className="points-modal-title">
            <Sparkles size={20} className="points-title-icon" />
            <div>
              <h3>积分与使用量统计</h3>
              <p>查看您的可用积分与 Token 消耗趋势</p>
            </div>
          </div>
          <div className="points-modal-actions">
            <button
              className="icon-button mini"
              type="button"
              title="刷新"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
            <button className="icon-button mini" type="button" title="关闭" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        {error ? <div className="form-error" style={{ margin: "0 24px 16px" }}>{error}</div> : null}

        <div className="points-modal-body">
          {/* 3 张概览卡片 */}
          <div className="points-stats-grid">
            <div className="points-stat-card">
              <div className="points-stat-icon-wrap points-icon-amber">
                <Coins size={18} />
              </div>
              <div className="points-stat-info">
                <span className="points-stat-label">当前可用积分</span>
                {summary?.unlimitedPoints ? (
                  <div className="points-stat-unlimited">
                    <InfinityIcon size={20} />
                    <strong>无限积分</strong>
                  </div>
                ) : (
                  <strong className="points-stat-value">
                    {summary ? summary.points.toLocaleString() : "-"}
                    <small> 积分</small>
                  </strong>
                )}
              </div>
            </div>

            <div className="points-stat-card">
              <div className="points-stat-icon-wrap points-icon-blue">
                <Activity size={18} />
              </div>
              <div className="points-stat-info">
                <span className="points-stat-label">近 14 天总消耗 Token</span>
                <strong className="points-stat-value">
                  {summary ? summary.totalTokensUsed.toLocaleString() : "-"}
                  <small> Tokens</small>
                </strong>
              </div>
            </div>

            <div className="points-stat-card">
              <div className="points-stat-icon-wrap points-icon-pink">
                <TrendingUp size={18} />
              </div>
              <div className="points-stat-info">
                <span className="points-stat-label">近 14 天总扣减积分</span>
                <strong className="points-stat-value">
                  {summary ? summary.totalPointsConsumed.toLocaleString() : "-"}
                  <small> 积分</small>
                </strong>
              </div>
            </div>
          </div>

          {/* 可视化趋势图表 */}
          <section className="points-chart-section">
            <div className="points-section-heading">
              <h4>近 14 天使用趋势 (Tokens)</h4>
            </div>
            <div className="points-chart-container">
              {loading && !summary ? (
                <div className="points-chart-loading">
                  <Loader2 size={24} className="spin" />
                  <span>加载趋势图...</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pointsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff75ac" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#ff75ac" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                    <XAxis dataKey="displayDate" stroke={textColor} fontSize={12} tickLine={false} />
                    <YAxis stroke={textColor} fontSize={12} tickLine={false} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload[0]?.payload) {
                          const data = payload[0].payload as { date: string; tokens: number; points: number };
                          return (
                            <div className="points-chart-tooltip">
                              <span className="tooltip-date">{data.date}</span>
                              <div className="tooltip-row">
                                <span>消耗 Token:</span>
                                <strong>{data.tokens.toLocaleString()}</strong>
                              </div>
                              <div className="tooltip-row">
                                <span>消耗积分:</span>
                                <strong>{data.points.toLocaleString()}</strong>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke={strokeColor}
                      strokeWidth={2.5}
                      fill="url(#pointsAreaGrad)"
                      dot={{ r: 3, fill: strokeColor }}
                      activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* 消费记录表格 */}
          <section className="points-records-section">
            <div className="points-section-heading">
              <h4>最近使用明细</h4>
            </div>
            <div className="points-records-table-wrap">
              <table className="points-records-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>说明</th>
                    <th>消耗 Token</th>
                    <th>积分变动</th>
                    <th>变动后余额</th>
                  </tr>
                </thead>
                <tbody>
                  {!summary || summary.recentRecords.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        暂无使用记录
                      </td>
                    </tr>
                  ) : (
                    summary.recentRecords.map((record) => (
                      <tr key={record.id}>
                        <td className="time-cell">{formatDate(record.createdAt)}</td>
                        <td>{record.description || "无说明"}</td>
                        <td>{record.tokensUsed ? record.tokensUsed.toLocaleString() : "-"}</td>
                        <td>
                          {record.delta < 0 ? (
                            <span className="point-delta negative">
                              {record.delta} 积分
                            </span>
                          ) : record.delta > 0 ? (
                            <span className="point-delta positive">
                              +{record.delta} 积分
                            </span>
                          ) : (
                            <span className="point-delta zero">
                              0 (无限)
                            </span>
                          )}
                        </td>
                        <td>
                          {record.balanceAfter !== null && record.balanceAfter !== undefined
                            ? `${record.balanceAfter} 积分`
                            : summary.unlimitedPoints
                            ? "无限"
                            : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
