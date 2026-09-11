import React, { memo } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Globe, ShieldCheck, Sparkles, Wrench, Zap } from "lucide-react";
import type { PanelTextKey } from "../../i18n/index.js";
import type { SakiVoiceEchoEngineType, WebGPUDetectionResult } from "../../components/saki/sakiVoiceEngine.js";

export interface SettingsFeaturesTabProps {
  isActive: boolean;
  searchEnabled: boolean;
  onSearchEnabledChange: (enabled: boolean) => void;
  mcpEnabled: boolean;
  onMcpEnabledChange: (enabled: boolean) => void;
  allowCrossInstanceEnforcement: boolean;
  onAllowCrossInstanceEnforcementChange: (enabled: boolean) => void;
  voiceEchoEngine: SakiVoiceEchoEngineType;
  onVoiceEchoEngineChange: (engine: SakiVoiceEchoEngineType) => void;
  webGpuInfo: WebGPUDetectionResult | null;
  t: (key: PanelTextKey) => string;
}

export const SettingsFeaturesTab = memo(function SettingsFeaturesTab({
  isActive,
  searchEnabled,
  onSearchEnabledChange,
  mcpEnabled,
  onMcpEnabledChange,
  allowCrossInstanceEnforcement,
  onAllowCrossInstanceEnforcementChange,
  voiceEchoEngine,
  onVoiceEchoEngineChange,
  webGpuInfo,
  t
}: SettingsFeaturesTabProps) {
  return (
    <div
      className={`settings-group ${isActive ? "active" : "settings-section-hidden"}`}
      id="settings-features"
    >
      <div className="settings-group-title">
        <div className="settings-group-icon">
          <Wrench size={20} />
        </div>
        <div>
          <h3>{t("settings.features")}</h3>
          <span>{t("settings.features.detail")}</span>
        </div>
      </div>
      <div className="settings-group-content">
        <div className="settings-switch-card">
          <div className="settings-switch-info">
            <div className="settings-switch-title">
              <Globe size={18} className="settings-switch-icon" />
              <strong>联网搜索与网页内容提取</strong>
            </div>
            <span>允许 Saki 在回答技术问题或排查故障时自主检索最新互联网资料与官方文档。</span>
          </div>
          <label className="settings-switch-toggle">
            <input
              type="checkbox"
              checked={searchEnabled}
              onChange={(event) => onSearchEnabledChange(event.target.checked)}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

        <div className="settings-switch-card">
          <div className="settings-switch-info">
            <div className="settings-switch-title">
              <Zap size={18} className="settings-switch-icon" />
              <strong>Model Context Protocol (MCP)</strong>
            </div>
            <span>启用标准化 MCP 扩展工具与外部上下文集成协议，为 Saki 提供深度工具交互。</span>
          </div>
          <label className="settings-switch-toggle">
            <input
              type="checkbox"
              checked={mcpEnabled}
              onChange={(event) => onMcpEnabledChange(event.target.checked)}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

        <div className="settings-switch-card">
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
          <label className="settings-switch-toggle">
            <input
              type="checkbox"
              checked={allowCrossInstanceEnforcement}
              onChange={(event) => onAllowCrossInstanceEnforcementChange(event.target.checked)}
            />
            <span className="settings-switch-slider" />
          </label>
        </div>

        <div
          className="settings-switch-card"
          style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }}
        >
          <div className="settings-switch-info" style={{ width: "100%" }}>
            <div className="settings-switch-title">
              <Sparkles size={18} className="settings-switch-icon" />
              <strong>Saki 学说话 (Voice Echo) 变声引擎</strong>
            </div>
            <span>
              长按右下角悬浮 Saki 头像时复读语音的变声引擎。完全运行于客户端浏览器，无须占用服务器 GPU 资源。
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 10
            }}
          >
            {/* Mode 1: DSP */}
            <div
              onClick={() => onVoiceEchoEngineChange("dsp")}
              style={{
                padding: "14px 16px",
                borderRadius: "10px",
                border:
                  voiceEchoEngine === "dsp"
                    ? "2px solid var(--primary, #3b82f6)"
                    : "1px solid var(--border-color, rgba(140, 140, 140, 0.25))",
                background: voiceEchoEngine === "dsp" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                transition: "all 0.15s ease"
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    fontSize: "0.95rem"
                  }}
                >
                  <Zap size={16} style={{ color: "#3b82f6" }} />
                  <span>轻量 DSP 增强模式 (推荐/默认)</span>
                </div>
                {voiceEchoEngine === "dsp" && <CheckCircle2 size={16} style={{ color: "#3b82f6" }} />}
              </div>
              <span style={{ fontSize: "0.82rem", opacity: 0.8, lineHeight: 1.45 }}>
                零额外体积占用（0 KB 下载）、&lt;30ms 极速响应。通过目标基频绝对锚定（392Hz）与 6
                级共振峰滤波统一音色基准，告别男女声调不齐与破音。
              </span>
            </div>

            {/* Mode 2: WebGPU AI */}
            <div
              onClick={() => onVoiceEchoEngineChange("ai")}
              style={{
                padding: "14px 16px",
                borderRadius: "10px",
                border:
                  voiceEchoEngine === "ai"
                    ? "2px solid var(--primary, #3b82f6)"
                    : "1px solid var(--border-color, rgba(140, 140, 140, 0.25))",
                background: voiceEchoEngine === "ai" ? "rgba(59, 130, 246, 0.08)" : "transparent",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                transition: "all 0.15s ease"
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    fontSize: "0.95rem"
                  }}
                >
                  <Cpu size={16} style={{ color: "#8b5cf6" }} />
                  <span>端侧 WebGPU / WASM AI 引擎</span>
                </div>
                {voiceEchoEngine === "ai" && <CheckCircle2 size={16} style={{ color: "#8b5cf6" }} />}
              </div>
              <span style={{ fontSize: "0.82rem", opacity: 0.8, lineHeight: 1.45 }}>
                利用客户端本地显卡/CPU 运行轻量模型转换 Saki 专属声线，服务器 0
                负载。首次切换时按需加载并缓存，若设备不支持将自动降级回 DSP。
              </span>
            </div>
          </div>

          {/* WebGPU Status Bar */}
          {webGpuInfo && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "0.8rem",
                padding: "8px 12px",
                borderRadius: 8,
                background: webGpuInfo.supported
                  ? "rgba(16, 185, 129, 0.1)"
                  : "rgba(245, 158, 11, 0.1)",
                color: webGpuInfo.supported ? "#059669" : "#d97706"
              }}
            >
              {webGpuInfo.supported ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>
                {webGpuInfo.supported
                  ? `客户端状态：已检测到本地 WebGPU 硬件加速 (${webGpuInfo.adapterName})`
                  : `客户端提示：${webGpuInfo.reason || "当前浏览器未开启 WebGPU，启用 AI 模式将自动降级为 DSP 模式"}`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
