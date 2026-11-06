import React, { useState } from "react";
import { Eye, EyeOff, Video } from "lucide-react";
import { sanitizeSakiVideoGenConfig, sakiVideoGenPresets, sakiVideoGenProtocols, type SakiVideoGenConfig } from "@webops/shared";
import { SakiImageModelPicker } from "./SakiImageModelPicker.js";

const protocolLabels = {
  openai: "OpenAI 兼容（/videos）",
  relay: "中转站 JSON（/video/generations）",
  seedance: "火山方舟 Seedance",
  "cloudwise-seedance": "Cloudwise Seedance（专用接口）",
  wan: "阿里云百炼 DashScope",
  minimax: "MiniMax H3",
  xai: "xAI 兼容（/videos/generations）"
};

export function SettingsVideoGen({ token, config, onChange }: {
  token: string;
  config: SakiVideoGenConfig | undefined;
  onChange: (patch: Partial<SakiVideoGenConfig>) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const effective = sanitizeSakiVideoGenConfig(config);
  const preset = sakiVideoGenPresets[effective.provider];

  return (
    <div className="provider-card enabled wide-field settings-video-gen" style={{ marginTop: 10 }}>
      <div className="provider-card-header">
        <div className="provider-brand-info">
          <div className="provider-brand-icon" style={{ background: "rgba(255, 117, 172, 0.14)", color: "var(--primary, #ff75ac)" }}><Video size={20} /></div>
          <div className="provider-title-wrap">
            <div className="provider-title-row"><span className="provider-name">视频生成</span></div>
            <span className="provider-card-desc">在 Saki 对话中生成、播放和下载视频</span>
          </div>
        </div>
        <div className="provider-toggle-wrap">
          <span className={`provider-switch-label ${effective.enabled ? "on" : "off"}`}>{effective.enabled ? "已启用" : "已关闭"}</span>
          <label className="settings-switch-toggle">
            <input type="checkbox" aria-label="启用视频生成" checked={effective.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
            <span className="settings-switch-slider" />
          </label>
        </div>
      </div>

      <div className={`provider-card-body ${effective.enabled ? "" : "is-disabled"}`}>
        <div className="settings-form-row">
          <label className="settings-field">
            <span className="settings-field-label">视频服务商</span>
            <select className="settings-select" value={effective.provider} onChange={(event) => {
              setShowKey(false);
              onChange(sanitizeSakiVideoGenConfig({ provider: event.target.value, enabled: effective.enabled }));
            }}>
              {Object.entries(sakiVideoGenPresets).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
            </select>
          </label>
          {effective.provider === "custom" && (
            <label className="settings-field">
              <span className="settings-field-label">接口协议</span>
              <select className="settings-select" value={effective.protocol} onChange={(event) => onChange({ protocol: event.target.value as SakiVideoGenConfig["protocol"] })}>
                {sakiVideoGenProtocols.map((id) => <option key={id} value={id}>{protocolLabels[id]}</option>)}
              </select>
              <span className="settings-field-hint">按中转站文档选择协议。Cloudwise 的 Seedance 模型请选择专用接口；模型 ID 使用中转站提供的名称。</span>
            </label>
          )}
        </div>
        <div className="settings-form-row">
          <label className="settings-field">
            <span className="settings-field-label">Base URL</span>
            <input className="settings-input" value={config?.baseUrl ?? preset.baseUrl} placeholder={preset.baseUrl || "https://api.example.com/v1"} onChange={(event) => onChange({ baseUrl: event.target.value })} />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">API Key</span>
            <div className="settings-input-with-action">
              <input className="settings-input" type={showKey ? "text" : "password"} value={config?.apiKey ?? ""} autoComplete="off" onChange={(event) => onChange({ apiKey: event.target.value })} />
              <button type="button" className="settings-inline-action-btn icon-only" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
        </div>
        <div className="settings-form-row">
          <SakiImageModelPicker token={token} config={effective} media="video" model={config?.model ?? preset.model} onChange={(model) => onChange({ model })} />
        </div>
      </div>
    </div>
  );
}
