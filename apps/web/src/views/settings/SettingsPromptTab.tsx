import React, { memo } from "react";
import { TextQuote } from "lucide-react";
import type { PanelTextKey } from "../../i18n/index.js";

export interface SettingsPromptTabProps {
  isActive: boolean;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  t: (key: PanelTextKey) => string;
}

export const SettingsPromptTab = memo(function SettingsPromptTab({
  isActive,
  systemPrompt,
  onSystemPromptChange,
  t
}: SettingsPromptTabProps) {
  return (
    <div
      className={`settings-group ${isActive ? "active" : "settings-section-hidden"}`}
      id="settings-prompt"
    >
      <div className="settings-group-title">
        <div className="settings-group-icon">
          <TextQuote size={20} />
        </div>
        <div>
          <h3>{t("settings.prompt")}</h3>
          <span>{t("settings.prompt.detail")}</span>
        </div>
      </div>
      <div className="settings-group-content">
        <label className="settings-field">
          <div className="settings-field-head">
            <span className="settings-field-label">全局系统提示词 (System Prompt)</span>
            <span className="settings-char-count">{systemPrompt.length} 字符</span>
          </div>
          <textarea
            className="settings-textarea prompt-editor"
            value={systemPrompt}
            onChange={(event) => onSystemPromptChange(event.target.value)}
            rows={8}
            placeholder="设定 Saki 的性格特点、回复语气、运维管理规范与操作约束..."
          />
          <span className="settings-field-hint">
            此提示词将作为 Saki 在所有会话与运维排查中的全局基准系统人设。
          </span>
        </label>
      </div>
    </div>
  );
});
