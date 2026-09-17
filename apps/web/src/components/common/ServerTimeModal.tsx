import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Clock,
  ExternalLink,
  Globe,
  RotateCcw,
  Search,
  Sparkles,
  Wifi,
  X
} from "lucide-react";
import { api } from "../../api.js";
import { usePanelLanguage } from "../../i18n/index.js";

const CALIBRATED_TZ_STORAGE_KEY = "saki_calibrated_timezone";

export interface WorldCityInfo {
  id: string;
  nameZh: string;
  nameTw: string;
  nameEn: string;
  timeZone: string;
  flag: string;
  badge: string;
}

export const WORLD_CITIES: WorldCityInfo[] = [
  { id: "beijing", nameZh: "北京 / 上海", nameTw: "北京 / 上海", nameEn: "Beijing / Shanghai", timeZone: "Asia/Shanghai", flag: "🇨🇳", badge: "UTC+8" },
  { id: "tokyo", nameZh: "东京", nameTw: "東京", nameEn: "Tokyo", timeZone: "Asia/Tokyo", flag: "🇯🇵", badge: "UTC+9" },
  { id: "singapore", nameZh: "新加坡 / 香港", nameTw: "新加坡 / 香港", nameEn: "Singapore / HK", timeZone: "Asia/Singapore", flag: "🇸🇬", badge: "UTC+8" },
  { id: "dubai", nameZh: "迪拜", nameTw: "杜拜", nameEn: "Dubai", timeZone: "Asia/Dubai", flag: "🇦🇪", badge: "UTC+4" },
  { id: "london", nameZh: "伦敦", nameTw: "倫敦", nameEn: "London", timeZone: "Europe/London", flag: "🇬🇧", badge: "UTC+0/+1" },
  { id: "paris", nameZh: "巴黎 / 柏林", nameTw: "巴黎 / 柏林", nameEn: "Paris / Berlin", timeZone: "Europe/Paris", flag: "🇫🇷", badge: "UTC+1/+2" },
  { id: "moscow", nameZh: "莫斯科", nameTw: "莫斯科", nameEn: "Moscow", timeZone: "Europe/Moscow", flag: "🇷🇺", badge: "UTC+3" },
  { id: "new_york", nameZh: "纽约", nameTw: "紐約", nameEn: "New York", timeZone: "America/New_York", flag: "🇺🇸", badge: "UTC-5/-4" },
  { id: "los_angeles", nameZh: "洛杉矶 / 旧金山", nameTw: "洛杉磯 / 舊金山", nameEn: "Los Angeles / SF", timeZone: "America/Los_Angeles", flag: "🇺🇸", badge: "UTC-8/-7" },
  { id: "sydney", nameZh: "悉尼", nameTw: "雪梨", nameEn: "Sydney", timeZone: "Australia/Sydney", flag: "🇦🇺", badge: "UTC+10/+11" },
  { id: "utc", nameZh: "世界协调时间", nameTw: "世界協調時間", nameEn: "UTC Standard", timeZone: "UTC", flag: "🌐", badge: "UTC" }
];

export function getSupportedTimeZones(): string[] {
  if (typeof Intl !== "undefined" && typeof (Intl as any).supportedValuesOf === "function") {
    try {
      return (Intl as any).supportedValuesOf("timeZone");
    } catch {
      // ignore
    }
  }
  return [
    "UTC",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Taipei",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Asia/Singapore",
    "Asia/Bangkok",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Moscow",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Vancouver",
    "America/Sao_Paulo",
    "Australia/Sydney",
    "Australia/Melbourne",
    "Pacific/Auckland",
    "Pacific/Honolulu"
  ];
}

function formatTimeWithZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  } catch {
    return date.toTimeString().slice(0, 8);
  }
}

function formatDateWithZone(date: Date, timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

function getTimezoneAbbrOrOffset(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short"
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart?.value || timeZone;
  } catch {
    return timeZone;
  }
}

function getTimeDifferenceHours(date: Date, tzA: string, tzB: string): number {
  try {
    const strA = date.toLocaleString("en-US", { timeZone: tzA });
    const strB = date.toLocaleString("en-US", { timeZone: tzB });
    const dateA = new Date(strA).getTime();
    const dateB = new Date(strB).getTime();
    return Math.round((dateA - dateB) / (1000 * 60 * 60));
  } catch {
    return 0;
  }
}

// Global in-memory time sync state shared across components
let globalOffsetMs = 0;
let globalServerTz = "UTC";
let globalLatencyMs = 0;
let hasSyncedOnce = false;
let globalCalibratedTz = typeof window !== "undefined" ? localStorage.getItem(CALIBRATED_TZ_STORAGE_KEY) || "" : "";
const clockListeners = new Set<() => void>();

function notifyClockListeners() {
  clockListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}

export function useServerClock() {
  const [now, setNow] = useState<Date>(() => new Date(Date.now() + globalOffsetMs));
  const [serverTz, setServerTz] = useState<string>(globalServerTz);
  const [latencyMs, setLatencyMs] = useState<number>(globalLatencyMs);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [calibratedTz, setCalibratedTzState] = useState<string>(() => globalCalibratedTz);

  const activeTimezone = calibratedTz || serverTz;

  useEffect(() => {
    const handleUpdate = () => {
      setCalibratedTzState(globalCalibratedTz);
      setServerTz(globalServerTz);
      setLatencyMs(globalLatencyMs);
      setNow(new Date(Date.now() + globalOffsetMs));
    };
    clockListeners.add(handleUpdate);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === CALIBRATED_TZ_STORAGE_KEY) {
        globalCalibratedTz = e.newValue || "";
        notifyClockListeners();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", handleStorage);
    }
    return () => {
      clockListeners.delete(handleUpdate);
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", handleStorage);
      }
    };
  }, []);

  const syncWithServer = useCallback(async () => {
    setIsSyncing(true);
    const tStart = performance.now();
    try {
      const res = await api.getSystemTime();
      const tEnd = performance.now();
      const roundTrip = Math.round(tEnd - tStart);
      const serverEstimatedNow = res.timestamp + roundTrip / 2;
      const offset = serverEstimatedNow - Date.now();

      globalOffsetMs = offset;
      globalServerTz = res.timezone || "UTC";
      globalLatencyMs = roundTrip;
      hasSyncedOnce = true;

      setServerTz(res.timezone || "UTC");
      setLatencyMs(roundTrip);
      setNow(new Date(Date.now() + offset));
      notifyClockListeners();
    } catch {
      // If API fails, fall back to client clock
      if (!hasSyncedOnce) {
        setServerTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!hasSyncedOnce) {
      void syncWithServer();
    }
  }, [syncWithServer]);

  // Periodic resync every 3 minutes
  useEffect(() => {
    const timer = window.setInterval(() => {
      void syncWithServer();
    }, 180_000);
    return () => window.clearInterval(timer);
  }, [syncWithServer]);

  // 1-second interval ticking
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date(Date.now() + globalOffsetMs));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const setCalibratedTimezone = useCallback((tz: string) => {
    globalCalibratedTz = tz;
    setCalibratedTzState(tz);
    if (typeof window !== "undefined") {
      if (tz) {
        localStorage.setItem(CALIBRATED_TZ_STORAGE_KEY, tz);
      } else {
        localStorage.removeItem(CALIBRATED_TZ_STORAGE_KEY);
      }
    }
    notifyClockListeners();
  }, []);

  const resetToServerTimezone = useCallback(() => {
    globalCalibratedTz = "";
    setCalibratedTzState("");
    if (typeof window !== "undefined") {
      localStorage.removeItem(CALIBRATED_TZ_STORAGE_KEY);
    }
    notifyClockListeners();
  }, []);

  return {
    now,
    serverTz,
    activeTimezone,
    isCalibrated: Boolean(calibratedTz && calibratedTz !== serverTz),
    latencyMs,
    isSyncing,
    syncWithServer,
    setCalibratedTimezone,
    resetToServerTimezone
  };
}

export interface TopbarServerTimeBadgeProps {
  onOpenModal: () => void;
}

export const TopbarServerTimeBadge = React.memo(function TopbarServerTimeBadge({
  onOpenModal
}: TopbarServerTimeBadgeProps) {
  const { now, activeTimezone, isCalibrated } = useServerClock();
  const timeString = useMemo(() => formatTimeWithZone(now, activeTimezone), [now, activeTimezone]);

  return (
    <button
      className={`topbar-server-time-btn ${isCalibrated ? "is-calibrated" : ""}`}
      type="button"
      onClick={onOpenModal}
      title={`服务器时间 (${activeTimezone})，点击校准世界时区`}
      aria-label="服务器时间与世界时钟校准"
    >
      <span className="topbar-clock-digits">{timeString}</span>
    </button>
  );
});

export interface ServerTimeModalProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export const ServerTimeModal = React.memo(function ServerTimeModal({
  open,
  onClose,
  onOpenSettings
}: ServerTimeModalProps) {
  const { language, t, tFormat } = usePanelLanguage();
  const locale = language || "zh-CN";

  const {
    now,
    serverTz,
    activeTimezone,
    isCalibrated,
    latencyMs,
    isSyncing,
    syncWithServer,
    setCalibratedTimezone,
    resetToServerTimezone
  } = useServerClock();

  const [searchQuery, setSearchQuery] = useState("");
  const allTimeZones = useMemo(() => getSupportedTimeZones(), []);

  const filteredTimezones = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allTimeZones
      .filter((tz) => tz.toLowerCase().includes(q))
      .slice(0, 10);
  }, [allTimeZones, searchQuery]);

  const activeFormattedTime = useMemo(
    () => formatTimeWithZone(now, activeTimezone),
    [now, activeTimezone]
  );
  const activeFormattedDate = useMemo(
    () => formatDateWithZone(now, activeTimezone, locale),
    [now, activeTimezone, locale]
  );
  const activeTzAbbr = useMemo(
    () => getTimezoneAbbrOrOffset(now, activeTimezone),
    [now, activeTimezone]
  );

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

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-backdrop modal-fullscreen-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel modal-fullscreen-panel server-time-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-time-modal-title"
      >
        {/* Header */}
        <header className="modal-fullscreen-header">
          <div className="modal-fullscreen-title-wrap">
            <div className="modal-fullscreen-icon-wrap">
              <Globe size={22} className="points-title-icon" />
            </div>
            <div className="modal-fullscreen-title-text">
              <h3 id="server-time-modal-title">
                {t("serverTime.modal.title")}
              </h3>
              <p className="modal-fullscreen-subtitle">
                <span>
                  {t("serverTime.modal.desc")}
                </span>
                <span className="server-time-sync-pill">
                  <Wifi size={11} />
                  <span>
                    {tFormat("serverTime.modal.latency", latencyMs)}
                  </span>
                </span>
              </p>
            </div>
          </div>
          <button
            className="icon-button mini modal-fullscreen-close-btn"
            type="button"
            title={t("common.close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        {/* Scrollable Body */}
        <div className="modal-fullscreen-body server-time-body">
          <div className="modal-fullscreen-content">
            {/* Hero Digital Clock Card */}
            <div className="server-time-hero-card">
              <div className="server-time-hero-header">
                <div className="hero-status-tag">
                  <span className="status-dot-pulse" />
                  <strong>
                    {isCalibrated
                      ? t("serverTime.modal.calibrated")
                      : t("serverTime.modal.serverNative")}
                  </strong>
                </div>
                <div className="hero-actions-row">
                  {isCalibrated ? (
                    <button
                      className="ghost-button mini reset-tz-btn"
                      type="button"
                      onClick={resetToServerTimezone}
                      title={t("serverTime.modal.resetTooltip")}
                    >
                      <RotateCcw size={12} />
                      <span>{t("serverTime.modal.resetServer")}</span>
                    </button>
                  ) : null}
                  <button
                    className="ghost-button mini sync-now-btn"
                    type="button"
                    disabled={isSyncing}
                    onClick={() => void syncWithServer()}
                    title={t("serverTime.modal.syncTooltip")}
                  >
                    <RotateCcw size={12} className={isSyncing ? "spin" : ""} />
                    <span>{isSyncing ? t("serverTime.modal.syncing") : t("serverTime.modal.syncNow")}</span>
                  </button>
                </div>
              </div>

              <div className="server-time-digits-display">
                <span className="time-digits">{activeFormattedTime}</span>
                <span className="time-tz-badge">{activeTzAbbr}</span>
              </div>

              <div className="server-time-hero-meta">
                <span className="time-date-text">{activeFormattedDate}</span>
                <span className="time-iana-name">{activeTimezone}</span>
              </div>
            </div>

            {/* World Cities Section */}
            <div className="server-time-section">
              <div className="server-time-section-header">
                <div className="section-title-wrap">
                  <Clock size={16} className="section-icon" />
                  <h4>{t("serverTime.modal.majorCities")}</h4>
                </div>
                <span className="section-tip">
                  {t("serverTime.modal.majorCitiesDesc")}
                </span>
              </div>

              <div className="world-cities-grid">
                {WORLD_CITIES.map((city) => {
                  const isCurrentActive = activeTimezone === city.timeZone;
                  const cityTime = formatTimeWithZone(now, city.timeZone);
                  const cityDate = formatDateWithZone(now, city.timeZone, locale);
                  const diffHours = getTimeDifferenceHours(now, city.timeZone, serverTz);
                  const diffText =
                    diffHours === 0
                      ? t("serverTime.modal.sameAsServer")
                      : diffHours > 0
                      ? tFormat("serverTime.modal.diffFaster", diffHours)
                      : tFormat("serverTime.modal.diffSlower", Math.abs(diffHours));

                  const cityName = language === "en-US" ? city.nameEn : (language === "zh-TW" ? city.nameTw : city.nameZh);

                  return (
                    <div
                      key={city.id}
                      className={`world-city-card ${isCurrentActive ? "active" : ""}`}
                    >
                      <div className="city-card-top">
                        <div className="city-info-col">
                          <span className="city-flag">{city.flag}</span>
                          <div className="city-names">
                            <strong className="city-title">{cityName}</strong>
                            <small className="city-tz-name">{city.timeZone}</small>
                          </div>
                        </div>
                        <span className="city-tz-badge">{city.badge}</span>
                      </div>

                      <div className="city-card-middle">
                        <span className="city-time-digits">{cityTime}</span>
                        <div className="city-submeta">
                          <span className="city-date">{cityDate}</span>
                          <span className="city-diff">{diffText}</span>
                        </div>
                      </div>

                      <div className="city-card-bottom">
                        {isCurrentActive ? (
                          <div className="city-active-tag">
                            <Check size={13} />
                            <span>{t("serverTime.modal.activeTopbar")}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="city-calibrate-btn"
                            onClick={() => setCalibratedTimezone(city.timeZone)}
                          >
                            <Sparkles size={12} />
                            <span>{t("serverTime.modal.calibrateTopbar")}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom Timezone Search */}
            <div className="server-time-section">
              <div className="server-time-section-header">
                <div className="section-title-wrap">
                  <Search size={16} className="section-icon" />
                  <h4>{t("serverTime.modal.searchTimezone")}</h4>
                </div>
              </div>

              <div className="timezone-search-wrap">
                <div className="timezone-input-box">
                  <Search size={15} className="search-box-icon" />
                  <input
                    className="timezone-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("serverTime.modal.searchPlaceholder")}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="icon-button mini"
                      onClick={() => setSearchQuery("")}
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </div>

                {filteredTimezones.length > 0 ? (
                  <div className="timezone-search-results">
                    {filteredTimezones.map((tz) => {
                      const isCurr = activeTimezone === tz;
                      const timeStr = formatTimeWithZone(now, tz);
                      return (
                        <div key={tz} className={`timezone-result-item ${isCurr ? "active" : ""}`}>
                          <div className="tz-item-left">
                            <strong>{tz}</strong>
                            <span className="tz-item-time">{timeStr}</span>
                          </div>
                          {isCurr ? (
                            <span className="city-active-tag">
                              <Check size={12} />
                              <span>{t("serverTime.modal.active")}</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="city-calibrate-btn mini"
                              onClick={() => {
                                setCalibratedTimezone(tz);
                                setSearchQuery("");
                              }}
                            >
                              <span>{t("serverTime.modal.select")}</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : searchQuery ? (
                  <div className="timezone-search-empty">
                    <span>{t("serverTime.modal.noMatch")}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Pinned Sticky Footer */}
        <footer className="modal-fullscreen-footer server-time-footer">
          <div className="server-time-footer-inner">
            <div className="footer-notice-tip">
              <span>{t("serverTime.modal.settingsTip")}</span>
              {onOpenSettings ? (
                <button
                  className="ghost-button mini footer-settings-link"
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  <ExternalLink size={12} />
                  <span>{t("serverTime.modal.openSettings")}</span>
                </button>
              ) : null}
            </div>
            <button className="primary-button" type="button" onClick={onClose}>
              {t("serverTime.modal.done")}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
});
