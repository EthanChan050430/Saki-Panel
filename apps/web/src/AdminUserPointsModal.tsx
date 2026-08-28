import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpDown,
  Coins,
  History,
  Infinity as InfinityIcon,
  Loader2,
  RefreshCw,
  Sliders,
  Sparkles,
  Target,
  X
} from "lucide-react";
import type { ManagedUser, PointRecordItem, UpdateUserPointsRequest } from "@webops/shared";
import { api } from "./api.js";
import { usePanelLanguage } from "./i18n/index.js";

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

export function AdminUserPointsModal({
  token,
  user,
  open,
  onClose,
  onUpdated
}: {
  token: string;
  user: ManagedUser | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (updatedUser: { id: string; points: number; unlimitedPoints: boolean }) => void;
}) {
  const { language } = usePanelLanguage();
  const isEn = language === "en-US";
  const isTw = language === "zh-TW";

  const [tab, setTab] = useState<"manage" | "records">("manage");
  const [actionType, setActionType] = useState<"adjust" | "set" | "set_unlimited">("adjust");
  const [amount, setAmount] = useState<string>("100");
  const [unlimitedChecked, setUnlimitedChecked] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [records, setRecords] = useState<PointRecordItem[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setTab("manage");
    setActionType("adjust");
    setAmount("100");
    setUnlimitedChecked(Boolean(user.unlimitedPoints));
    setNote("");
    setError("");
    setNotice("");
    void loadRecords();
  }, [open, user]);

  const loadRecords = useCallback(async () => {
    if (!user || !token) return;
    setRecordsLoading(true);
    try {
      const res = await api.userPointRecords(token, user.id, 50);
      setRecords(res);
    } catch {} finally {
      setRecordsLoading(false);
    }
  }, [token, user]);

  if (!open || !user) return null;

  const currentPoints = user.points ?? 0;
  const numericAmount = Number(amount) || 0;
  const estimatedPoints = Math.max(0, currentPoints + numericAmount);
  const ptsUnit = isEn ? " pts" : isTw ? " 積分" : " 积分";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const payload: UpdateUserPointsRequest = {
        action: actionType,
        ...(note.trim() ? { note: note.trim() } : {})
      };

      if (actionType === "set_unlimited") {
        payload.unlimited = unlimitedChecked;
      } else if (actionType === "set") {
        const val = Number(amount);
        if (Number.isNaN(val) || val < 0) throw new Error(isEn ? "Please enter a valid points value" : isTw ? "請輸入合法的設定積分數值" : "请输入合法的设定积分数值");
        payload.amount = val;
      } else if (actionType === "adjust") {
        const val = Number(amount);
        if (Number.isNaN(val) || val === 0) throw new Error(isEn ? "Please enter a valid adjustment amount (positive to add, negative to deduct)" : isTw ? "請輸入合法的變動數值（支援正數增加或負數扣除）" : "请输入合法的变动数值（支持正数增加或负数扣除）");
        payload.amount = val;
      }

      const res = await api.updateUserPoints(token, user.id, payload);
      setNotice(isEn ? "Points updated successfully!" : isTw ? "積分更新成功！" : "积分更新成功！");
      onUpdated?.({
        id: user.id,
        points: res.points,
        unlimitedPoints: res.unlimitedPoints
      });
      void loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEn ? "Update failed" : isTw ? "更新失敗" : "更新失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop admin-points-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog admin-points-modal" role="dialog" aria-modal="true">
        <header className="points-modal-header">
          <div className="points-modal-title">
            <div className="points-title-icon-wrap">
              <Coins size={22} className="points-title-icon" />
            </div>
            <div>
              <h3>{isEn ? "Manage User Points" : isTw ? "管理使用者積分" : "管理用户积分"}</h3>
              <p className="points-modal-subtitle">
                {isEn ? "Target User: " : isTw ? "目標使用者：" : "目标用户："}<strong>{user.displayName || user.username}</strong>
                <span className="user-curr-points-tag">
                  {isEn
                    ? `Current: ${user.unlimitedPoints ? "∞ Unlimited" : `${currentPoints} pts`}`
                    : isTw
                    ? `目前：${user.unlimitedPoints ? "∞ 無限積分" : `${currentPoints} 積分`}`
                    : `当前：${user.unlimitedPoints ? "∞ 无限积分" : `${currentPoints} 积分`}`}
                </span>
              </p>
            </div>
          </div>
          <button className="icon-button mini" type="button" title={isEn ? "Close" : isTw ? "關閉" : "关闭"} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="admin-points-tabs-segmented">
          <button
            type="button"
            className={`admin-points-tab-btn ${tab === "manage" ? "active" : ""}`}
            onClick={() => setTab("manage")}
          >
            <Sliders size={14} />
            <span>{isEn ? "Point Actions" : isTw ? "積分操作" : "积分操作"}</span>
          </button>
          <button
            type="button"
            className={`admin-points-tab-btn ${tab === "records" ? "active" : ""}`}
            onClick={() => setTab("records")}
          >
            <History size={14} />
            <span>{isEn ? "Usage & Change History" : isTw ? "消耗與變動明細" : "消耗与变动明细"}</span>
            {records.length > 0 ? <span className="tab-record-count">{records.length}</span> : null}
          </button>
        </div>

        {error ? <div className="admin-form-alert error">{error}</div> : null}
        {notice ? <div className="admin-form-alert success">{notice}</div> : null}

        <div className="points-modal-body admin-points-body">
          {tab === "manage" ? (
            <form onSubmit={(e) => void handleSave(e)} className="admin-points-form">
              <div className="admin-form-group">
                <label className="admin-form-label">{isEn ? "Action Type" : isTw ? "操作類型" : "操作类型"}</label>
                <div className="admin-action-cards">
                  <button
                    type="button"
                    className={`admin-action-card ${actionType === "adjust" ? "selected" : ""}`}
                    onClick={() => setActionType("adjust")}
                  >
                    <ArrowUpDown size={16} className="card-icon" />
                    <div className="card-info">
                      <strong>{isEn ? "Increase / Decrease" : isTw ? "增加 / 減少" : "增加 / 减少"}</strong>
                      <small>{isEn ? "Adjust existing balance" : isTw ? "在現有積分上增減" : "在现有积分上增减"}</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`admin-action-card ${actionType === "set" ? "selected" : ""}`}
                    onClick={() => setActionType("set")}
                  >
                    <Target size={16} className="card-icon" />
                    <div className="card-info">
                      <strong>{isEn ? "Set Exact Value" : isTw ? "直接設值" : "直接设值"}</strong>
                      <small>{isEn ? "Override with specific amount" : isTw ? "覆蓋為指定分值" : "覆盖为指定分值"}</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`admin-action-card ${actionType === "set_unlimited" ? "selected" : ""}`}
                    onClick={() => setActionType("set_unlimited")}
                  >
                    <InfinityIcon size={16} className="card-icon" />
                    <div className="card-info">
                      <strong>{isEn ? "Unlimited Points" : isTw ? "無限積分" : "无限积分"}</strong>
                      <small>{isEn ? "No limits or deductions" : isTw ? "免扣費無限制" : "免扣费无限制"}</small>
                    </div>
                  </button>
                </div>
              </div>

              {actionType === "adjust" ? (
                <div className="admin-form-group">
                  <label className="admin-form-label">
                    {isEn ? "Adjustment Amount" : isTw ? "變動數值" : "变动数值"}{" "}
                    <span className="label-sub">
                      {isEn ? "(Positive to add, negative to deduct)" : isTw ? "(正數代表儲值/增加，負數代表扣除)" : "(正数代表充值/增加，负数代表扣除)"}
                    </span>
                  </label>
                  <div className="admin-input-wrapper">
                    <input
                      className="admin-points-input"
                      type="number"
                      value={amount}
                      placeholder={isEn ? "e.g. 100 or -50" : "例如 100 或 -50"}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                    <span className="admin-input-suffix">{ptsUnit.trim()}</span>
                  </div>

                  <div className="points-calc-preview">
                    <div className="calc-item">
                      <span className="calc-label">{isEn ? "Current" : isTw ? "目前積分" : "当前积分"}</span>
                      <span className="calc-val">{currentPoints}</span>
                    </div>
                    <ArrowRight size={14} className="calc-arrow" />
                    <div className="calc-item">
                      <span className="calc-label">{isEn ? "Change" : isTw ? "變動量" : "变动量"}</span>
                      <span className={`calc-val delta ${numericAmount >= 0 ? "plus" : "minus"}`}>
                        {numericAmount >= 0 ? `+${numericAmount}` : numericAmount}
                      </span>
                    </div>
                    <ArrowRight size={14} className="calc-arrow" />
                    <div className="calc-item">
                      <span className="calc-label">{isEn ? "Estimated" : isTw ? "調整後預估" : "调整后预估"}</span>
                      <span className="calc-val highlight">{estimatedPoints} {ptsUnit.trim()}</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {actionType === "set" ? (
                <div className="admin-form-group">
                  <label className="admin-form-label">{isEn ? "Target Points Value" : isTw ? "目標積分數值" : "目标积分数值"}</label>
                  <div className="admin-input-wrapper">
                    <input
                      className="admin-points-input"
                      type="number"
                      min="0"
                      value={amount}
                      placeholder={isEn ? "e.g. 500" : "例如 500"}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                    <span className="admin-input-suffix">{ptsUnit.trim()}</span>
                  </div>
                </div>
              ) : null}

              {actionType === "set_unlimited" ? (
                <div className="admin-form-group">
                  <label className="admin-form-label">{isEn ? "Unlimited Points Switch" : isTw ? "無限積分權限開關" : "无限积分权限开关"}</label>
                  <div
                    className={`admin-switch-card ${unlimitedChecked ? "active" : ""}`}
                    onClick={() => setUnlimitedChecked((v) => !v)}
                  >
                    <div className="switch-left">
                      <div className="switch-icon-wrap">
                        <InfinityIcon size={20} />
                      </div>
                      <div>
                        <strong>{isEn ? "Enable Unlimited Points for this User" : isTw ? "開啟該使用者的無限積分權限" : "开启该用户的无限积分权限"}</strong>
                        <p>{isEn ? "When enabled, Agent usage is unrestricted and points are not deducted from records." : isTw ? "開啟後該使用者調用 Agent 不受積分限制，且消費流水中不會扣減積分。" : "开启后该用户调用 Agent 不受积分限制，且消费流水中不会扣减积分。"}</p>
                      </div>
                    </div>
                    <div className={`custom-switch ${unlimitedChecked ? "checked" : ""}`}>
                      <span className="switch-thumb" />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="admin-form-group">
                <label className="admin-form-label">
                  {isEn ? "Note / Reason" : isTw ? "操作備註說明" : "操作备注说明"}{" "}
                  <span className="label-sub">{isEn ? "(Optional, logged in audit)" : isTw ? "(可選，記於日誌與流水)" : "(可选，记入日志与流水)"}</span>
                </label>
                <input
                  className="admin-points-input"
                  type="text"
                  value={note}
                  placeholder={isEn ? "e.g. Admin recharge bonus / Event giveaway / Violation deduction" : "例如：管理员充值发放奖励 / 活动赠送 / 违规扣除"}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="admin-points-footer">
                <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
                  {isEn ? "Cancel" : isTw ? "取消" : "取消"}
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                  {isEn ? "Save Changes" : isTw ? "確認儲存" : "确认保存"}
                </button>
              </div>
            </form>
          ) : (
            <div className="admin-points-records">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <button
                  className="secondary-button mini"
                  type="button"
                  onClick={() => void loadRecords()}
                  disabled={recordsLoading}
                >
                  <RefreshCw size={13} className={recordsLoading ? "spin" : ""} />
                  {isEn ? "Refresh Records" : isTw ? "重新整理記錄" : "刷新记录"}
                </button>
              </div>
              <div className="points-records-table-wrap">
                <table className="points-records-table">
                  <thead>
                    <tr>
                      <th>{isEn ? "Time" : isTw ? "時間" : "时间"}</th>
                      <th>{isEn ? "Description" : isTw ? "說明" : "说明"}</th>
                      <th>{isEn ? "Tokens" : isTw ? "Token 消耗" : "Token 消耗"}</th>
                      <th>{isEn ? "Points Delta" : isTw ? "積分變動" : "积分变动"}</th>
                      <th>{isEn ? "Balance" : isTw ? "餘額" : "余额"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-cell">
                          {recordsLoading ? (isEn ? "Loading records..." : isTw ? "正在載入明細..." : "正在加载明细...") : (isEn ? "No point records" : isTw ? "暫無積分變動記錄" : "暂无积分变动记录")}
                        </td>
                      </tr>
                    ) : (
                      records.map((r) => (
                        <tr key={r.id}>
                          <td className="time-cell">{formatDate(r.createdAt)}</td>
                          <td>{r.description || (isEn ? "No description" : isTw ? "無說明" : "无说明")}</td>
                          <td>{r.tokensUsed ? r.tokensUsed.toLocaleString() : "-"}</td>
                          <td>
                            {r.delta < 0 ? (
                              <span className="point-delta negative">{r.delta} {ptsUnit.trim()}</span>
                            ) : r.delta > 0 ? (
                              <span className="point-delta positive">+{r.delta} {ptsUnit.trim()}</span>
                            ) : (
                              <span className="point-delta zero">0 ({isEn ? "Unlimited" : isTw ? "無限" : "无限"})</span>
                            )}
                          </td>
                          <td>{r.balanceAfter !== null && r.balanceAfter !== undefined ? `${r.balanceAfter} ${ptsUnit.trim()}` : (isEn ? "Unlimited" : isTw ? "無限" : "无限")}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
