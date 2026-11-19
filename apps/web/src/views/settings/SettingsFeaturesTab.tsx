import React, { memo } from "react";
import { Globe, ShieldCheck, Wrench, Zap } from "lucide-react";
import type { PanelTextKey } from "../../i18n/index.js";
import { SettingsAgentNotifications } from "./SettingsAgentNotifications.js";

export interface SettingsFeaturesTabProps {
  userId: string;
  isActive: boolean;
  searchEnabled: boolean;
  onSearchEnabledChange: (enabled: boolean) => void;
  mcpEnabled: boolean;
  onMcpEnabledChange: (enabled: boolean) => void;
  allowCrossInstanceEnforcement: boolean;
  onAllowCrossInstanceEnforcementChange: (enabled: boolean) => void;
  t: (key: PanelTextKey) => string;
}

export const SettingsFeaturesTab = memo(function SettingsFeaturesTab({
  userId,
  isActive,
  searchEnabled,
  onSearchEnabledChange,
  mcpEnabled,
  onMcpEnabledChange,
  allowCrossInstanceEnforcement,
  onAllowCrossInstanceEnforcementChange,
  t
}: SettingsFeaturesTabProps) {
  return (
    <div
      className={`settings-group ${isActive ? "active" : "settings-section-hidden"}`}
      id="settings-features"
    >
      <div className="settings-group-title">
        <div className="settings-group-icon">
          <Wrench size={16} />
        </div>
        <div>
          <h3>{t("settings.features")}</h3>
          <span>{t("settings.features.detail")}</span>
        </div>
      </div>
      <div className="settings-group-content">
        <SettingsAgentNotifications userId={userId} />
        <div
          className="settings-switch-card"
          onClick={() => onSearchEnabledChange(!searchEnabled)}
        >
          <div className="settings-switch-info">
            <div className="settings-switch-title">
              <Globe size={18} className="settings-switch-icon" />
              <strong>联网搜索与网页内容提取</strong>
            </div>
            <span>允许 Saki 在回答技术问题或排查故障时自主检索最新互联网资料与官方文档。</span>
          </div>
          <label className="settings-switch-toggle" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={searchEnabled}
              onChange={(event) => onSearchEnabledChange(event.target.checked)}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

        <div
          className="settings-switch-card"
          onClick={() => onMcpEnabledChange(!mcpEnabled)}
        >
          <div className="settings-switch-info">
            <div className="settings-switch-title">
              <Zap size={18} className="settings-switch-icon" />
              <strong>Model Context Protocol (MCP)</strong>
            </div>
            <span>启用标准化 MCP 扩展工具与外部上下文集成协议，为 Saki 提供深度工具交互。</span>
          </div>
          <label className="settings-switch-toggle" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={mcpEnabled}
              onChange={(event) => onMcpEnabledChange(event.target.checked)}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

        <div
          className="settings-switch-card"
          onClick={() => onAllowCrossInstanceEnforcementChange(!allowCrossInstanceEnforcement)}
        >
          <div className="settings-switch-info">
            <div className="settings-switch-title">
              <ShieldCheck size={18} className="settings-switch-icon" />
              <strong>允许 Saki 跨实例执法</strong>
            </div>
            <span>
              关闭后，Saki Agent 将被严格限制在当前实例文件夹内，无法通过文件工具或命令行访问其他实例的目录，防止利用
              Agent 漏洞攻击服务器。
            </span>
          </div>
          <label className="settings-switch-toggle" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={allowCrossInstanceEnforcement}
              onChange={(event) => onAllowCrossInstanceEnforcementChange(event.target.checked)}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

      </div>
    </div>
  );
});
