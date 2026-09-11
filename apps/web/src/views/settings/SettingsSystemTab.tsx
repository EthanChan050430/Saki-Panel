import React, { memo, useMemo } from "react";
import { Settings } from "lucide-react";
import type { RegistrationIdentity } from "@webops/shared";
import { getAvailableLanguageOptions, type PanelLanguage, type PanelTextKey } from "../../i18n/index.js";
import { usePlugins } from "../../plugins/PluginContext.js";
import { defaultSakiRequestTimeoutMs } from "../../constants.js";

export interface SettingsSystemTabProps {
  isActive: boolean;
  language: PanelLanguage;
  onLanguageChange: (language: PanelLanguage) => void;
  registrationIdentity: RegistrationIdentity;
  onRegistrationIdentityChange: (identity: RegistrationIdentity) => void;
  sessionTimeoutMinutes: string;
  onSessionTimeoutMinutesChange: (minutes: string) => void;
  requestTimeoutMs: number;
  onRequestTimeoutMsChange: (timeoutMs: number) => void;
  localizedRegistrationIdentityOptions: Array<{ value: RegistrationIdentity; label: string }>;
  t: (key: PanelTextKey) => string;
}

export const SettingsSystemTab = memo(function SettingsSystemTab({
  isActive,
  language,
  onLanguageChange,
  registrationIdentity,
  onRegistrationIdentityChange,
  sessionTimeoutMinutes,
  onSessionTimeoutMinutesChange,
  requestTimeoutMs,
  onRequestTimeoutMsChange,
  localizedRegistrationIdentityOptions,
  t
}: SettingsSystemTabProps) {
  // Trigger re-render whenever plugin state changes (install/enable/unload locale plugins)
  const { state } = usePlugins();
  // Compute fresh every render — dynamic languages Map updates via registerLocaleDictionary
  // and a PluginContext state change will trigger a re-render here thanks to usePlugins()
  void state;
  const languageOptions = getAvailableLanguageOptions();

  return (
    <div
      className={`settings-group ${isActive ? "active" : "settings-section-hidden"}`}
      id="settings-system"
    >
      <div className="settings-group-title">
        <div className="settings-group-icon">
          <Settings size={20} />
        </div>
        <div>
          <h3>{t("settings.system")}</h3>
          <span>{t("settings.system.detail")}</span>
        </div>
      </div>
      <div className="settings-group-content">
        <div className="settings-form-row">
          <label className="settings-field">
            <span className="settings-field-label">{t("settings.language")}</span>
            <select
              className="settings-select"
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as PanelLanguage)}
            >
              {languageOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.flag ? `${option.flag}  ` : ""}{option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span className="settings-field-label">{t("settings.registrationIdentity")}</span>
            <select
              className="settings-select"
              value={registrationIdentity}
              onChange={(event) => onRegistrationIdentityChange(event.target.value as RegistrationIdentity)}
            >
              {localizedRegistrationIdentityOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-form-row">
          <label className="settings-field">
            <span className="settings-field-label">{t("settings.sessionTimeout")}</span>
            <input
              className="settings-input"
              type="number"
              min={0}
              step={0.1}
              value={sessionTimeoutMinutes}
              onChange={(event) => onSessionTimeoutMinutesChange(event.target.value)}
              placeholder={t("settings.sessionTimeout.placeholder")}
            />
            <span className="settings-field-hint">单位：分钟。设为 0 表示不自动过期。</span>
          </label>

          <label className="settings-field">
            <span className="settings-field-label">{t("settings.requestTimeout")}</span>
            <input
              className="settings-input"
              type="number"
              min={5000}
              max={600000}
              step={1000}
              value={requestTimeoutMs}
              onChange={(event) =>
                onRequestTimeoutMsChange(Number(event.target.value) || defaultSakiRequestTimeoutMs)
              }
              placeholder="60000"
            />
            <span className="settings-field-hint">单位：毫秒（建议 30000 ~ 120000）。</span>
          </label>
        </div>
      </div>
    </div>
  );
});
