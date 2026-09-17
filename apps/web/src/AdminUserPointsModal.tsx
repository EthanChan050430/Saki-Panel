import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  const { t, tFormat } = usePanelLanguage();

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
    setUnlimitedChecked(Boolean(user.unlimitedPoints));
    setAmount("100");
    setNote("");
    setError("");
    setNotice("");
    setActionType("adjust");
    setTab("manage");
    void loadRecords();
  }, [open, user?.id]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  const loadRecords = useCallback(async () => {
    if (!user || !token) return;
    setRecordsLoading(true);
    try {
      const res = await api.userPointRecords(token, user.id, 50);
      setRecords(res);
    } catch {
      // ignore
    } finally {
      setRecordsLoading(false);
    }
  }, [token, user?.id]);

  if (!open || !user || typeof document === "undefined") return null;

  const currentPoints = user.points ?? 0;
  const numericAmount = Number(amount) || 0;
  const estimatedPoints = Math.max(0, currentPoints + numericAmount);
  const ptsUnit = ` ${t("points.unit")}`;

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
        if (Number.isNaN(val) || val < 0) throw new Error(t("points.admin.invalidValue"));
        payload.amount = val;
      } else if (actionType === "adjust") {
        const val = Number(amount);
        if (Number.isNaN(val) || val === 0) throw new Error(t("points.admin.invalidDelta"));
        payload.amount = val;
      }

      const res = await api.updateUserPoints(token, user.id, payload);
      setNotice(t("points.admin.saveSuccess"));
      onUpdated?.({
        id: user.id,
        points: res.points,
        unlimitedPoints: res.unlimitedPoints
      });
      void loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("points.admin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="modal-backdrop modal-fullscreen-backdrop admin-points-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel modal-fullscreen-panel admin-points-modal" role="dialog" aria-modal="true">
        <header className="modal-fullscreen-header points-modal-header">
          <div className="modal-fullscreen-title-wrap points-modal-title">
            <div className="modal-fullscreen-icon-wrap points-title-icon-wrap">
              <Coins size={22} className="points-title-icon" />
            </div>
            <div className="modal-fullscreen-title-text">
              <h3>{t("points.admin.title")}</h3>
              <p className="modal-fullscreen-subtitle points-modal-subtitle">
                <span>{tFormat("points.admin.userSubtitle", user.displayName || user.username)}</span>
                <span className="user-curr-points-tag">
                  {user.unlimitedPoints ? `∞ ${t("points.admin.unlimitedText")}` : `${currentPoints} ${ptsUnit.trim()}`}
                </span>
              </p>
            </div>
          </div>
          <button className="icon-button mini modal-fullscreen-close-btn" type="button" title={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="modal-fullscreen-nav-bar">
          <div className="admin-points-tabs-segmented">
            <button
              type="button"
              className={`admin-points-tab-btn ${tab === "manage" ? "active" : ""}`}
              onClick={() => setTab("manage")}
            >
              <Sliders size={14} />
              <span>{t("points.admin.tabManage")}</span>
            </button>
            <button
              type="button"
              className={`admin-points-tab-btn ${tab === "records" ? "active" : ""}`}
              onClick={() => setTab("records")}
            >
              <History size={14} />
              <span>{t("points.admin.tabRecords")}</span>
              {records.length > 0 ? <span className="tab-record-count">{records.length}</span> : null}
            </button>
          </div>
        </div>

        {tab === "manage" ? (
          <form onSubmit={(e) => void handleSave(e)} className="modal-fullscreen-form-wrapper">
            <div className="modal-fullscreen-body admin-points-body">
              <div className="modal-fullscreen-content">
                {error ? <div className="admin-form-alert error">{error}</div> : null}
                {notice ? <div className="admin-form-alert success">{notice}</div> : null}

                <div className="admin-points-form">
                  <div className="admin-form-group">
                <label className="admin-form-label">{t("points.admin.adjustType")}</label>
                <div className="admin-action-cards">
                  <button
                    type="button"
                    className={`admin-action-card ${actionType === "adjust" ? "selected" : ""}`}
                    onClick={() => setActionType("adjust")}
                  >
                    <ArrowUpDown size={16} className="card-icon" />
                    <div className="card-info">
                      <strong>{t("points.admin.typeAdjust")}</strong>
                      <small>{t("points.admin.typeAdjustDesc")}</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`admin-action-card ${actionType === "set" ? "selected" : ""}`}
                    onClick={() => setActionType("set")}
                  >
                    <Target size={16} className="card-icon" />
                    <div className="card-info">
                      <strong>{t("points.admin.typeSet")}</strong>
                      <small>{t("points.admin.typeSetDesc")}</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`admin-action-card ${actionType === "set_unlimited" ? "selected" : ""}`}
                    onClick={() => setActionType("set_unlimited")}
                  >
                    <InfinityIcon size={16} className="card-icon" />
                    <div className="card-info">
                      <strong>{t("points.admin.typeUnlimited")}</strong>
                      <small>{t("points.admin.typeUnlimitedDesc")}</small>
                    </div>
                  </button>
                </div>
              </div>

              {actionType === "adjust" ? (
                <div className="admin-form-group">
                  <label className="admin-form-label">
                    {t("points.admin.amountLabel")}{" "}
                    <span className="label-sub">
                      {t("points.admin.amountHint")}
                    </span>
                  </label>
                  <div className="admin-input-wrapper">
                    <input
                      className="admin-points-input"
                      type="number"
                      value={amount}
                      placeholder="100"
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                    <span className="admin-input-suffix">{ptsUnit.trim()}</span>
                  </div>

                  <div className="points-calc-preview">
                    <div className="calc-item">
                      <span className="calc-label">{t("points.admin.currentPoints")}</span>
                      <span className="calc-val">{currentPoints}</span>
                    </div>
                    <ArrowRight size={14} className="calc-arrow" />
                    <div className="calc-item">
                      <span className="calc-label">{t("points.admin.deltaPoints")}</span>
                      <span className={`calc-val delta ${numericAmount >= 0 ? "plus" : "minus"}`}>
                        {numericAmount >= 0 ? `+${numericAmount}` : numericAmount}
                      </span>
                    </div>
                    <ArrowRight size={14} className="calc-arrow" />
                    <div className="calc-item">
                      <span className="calc-label">{t("points.admin.estimatedPoints")}</span>
                      <span className="calc-val highlight">{estimatedPoints} {ptsUnit.trim()}</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {actionType === "set" ? (
                <div className="admin-form-group">
                  <label className="admin-form-label">{t("points.admin.targetPoints")}</label>
                  <div className="admin-input-wrapper">
                    <input
                      className="admin-points-input"
                      type="number"
                      min="0"
                      value={amount}
                      placeholder="500"
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                    <span className="admin-input-suffix">{ptsUnit.trim()}</span>
                  </div>
                </div>
              ) : null}

              {actionType === "set_unlimited" ? (
                <div className="admin-form-group">
                  <label className="admin-form-label">{t("points.admin.unlimitedSwitch")}</label>
                  <div
                    className={`admin-switch-card ${unlimitedChecked ? "active" : ""}`}
                    onClick={() => setUnlimitedChecked((v) => !v)}
                  >
                    <div className="switch-left">
                      <div className="switch-icon-wrap">
                        <InfinityIcon size={20} />
                      </div>
                      <div>
                        <strong>{t("points.admin.enableUnlimited")}</strong>
                        <p>{t("points.admin.unlimitedDesc")}</p>
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
                  {t("points.admin.noteLabel")}{" "}
                  <span className="label-sub">{t("points.admin.noteOptional")}</span>
                </label>
                <input
                  className="admin-points-input"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <footer className="modal-fullscreen-footer admin-points-footer">
            <div className="modal-fullscreen-footer-inner">
              <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                {t("points.admin.saveBtn")}
              </button>
            </div>
          </footer>
        </form>
      ) : (
        <div className="modal-fullscreen-form-wrapper">
          <div className="modal-fullscreen-body admin-points-body">
            <div className="modal-fullscreen-content">
              {error ? <div className="admin-form-alert error">{error}</div> : null}
              {notice ? <div className="admin-form-alert success">{notice}</div> : null}

              <div className="admin-points-records">
                <div className="records-toolbar">
                  <span className="records-count-text">
                    {records.length > 0
                      ? tFormat("points.admin.totalRecords", records.length)
                      : t("points.admin.noRecords")}
                  </span>
                  <button
                    className="secondary-button mini"
                    type="button"
                    onClick={() => void loadRecords()}
                    disabled={recordsLoading}
                  >
                    <RefreshCw size={13} className={recordsLoading ? "spin" : ""} />
                    {t("points.admin.refreshRecords")}
                  </button>
                </div>
                <div className="points-records-table-wrap">
                  <table className="points-records-table">
                    <thead>
                      <tr>
                        <th>{t("points.admin.colTime")}</th>
                        <th>{t("points.admin.colDesc")}</th>
                        <th>{t("points.admin.colTokens")}</th>
                        <th>{t("points.admin.colDelta")}</th>
                        <th>{t("points.admin.colBalance")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty-cell">
                            {recordsLoading ? t("points.admin.loadingRecords") : t("points.admin.emptyRecords")}
                          </td>
                        </tr>
                      ) : (
                        records.map((r) => (
                          <tr key={r.id}>
                            <td className="time-cell">{formatDate(r.createdAt)}</td>
                            <td>{r.description || t("points.admin.noDesc")}</td>
                            <td>{r.tokensUsed ? r.tokensUsed.toLocaleString() : "-"}</td>
                            <td>
                              {r.delta < 0 ? (
                                <span className="point-delta negative">{r.delta} {ptsUnit.trim()}</span>
                              ) : r.delta > 0 ? (
                                <span className="point-delta positive">+{r.delta} {ptsUnit.trim()}</span>
                              ) : (
                                <span className="point-delta zero">0 ({t("points.admin.unlimitedText")})</span>
                              )}
                            </td>
                            <td>{r.balanceAfter !== null && r.balanceAfter !== undefined ? `${r.balanceAfter} ${ptsUnit.trim()}` : t("points.admin.unlimitedText")}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <footer className="modal-fullscreen-footer admin-points-footer">
            <div className="modal-fullscreen-footer-inner">
              <button className="secondary-button" type="button" onClick={onClose}>
                {t("common.close")}
              </button>
            </div>
          </footer>
        </div>
      )}
      </div>
    </div>,
    document.body
  );
}
