import React, { useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { SakiImageGenConfig, SakiVideoGenConfig, SakiImageModelListResponse } from "@webops/shared";
import { api } from "../../api.js";

export function SakiImageModelPicker({ token, config, model, onChange, media = "image" }: {
  token: string;
  config: SakiImageGenConfig | SakiVideoGenConfig;
  media?: "image" | "video";
  model: string;
  onChange: (model: string) => void;
}) {
  const [catalog, setCatalog] = useState<SakiImageModelListResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const modelId = useId();

  useEffect(() => {
    setCatalog(null);
    setError("");
    setLoading(false);
    return () => request.current?.abort();
  }, [config.apiKey, config.baseUrl, config.enabled, config.protocol, config.provider, token]);

  async function detect() {
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = media === "video"
        ? await api.sakiVideoModels(token, config as SakiVideoGenConfig, controller.signal)
        : await api.sakiImageModels(token, config as SakiImageGenConfig, controller.signal);
      if (!controller.signal.aborted) setCatalog(result);
    } catch (err) {
      if (!controller.signal.aborted) {
        setCatalog(null);
        setError(err instanceof Error ? err.message : "无法读取模型列表，可手动填写模型 ID。");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const hasModels = catalog && (catalog.models.length > 0 || catalog.unclassified.length > 0);
  const mediaName = media === "video" ? "视频" : "图片";
  const selected = catalog?.models.includes(model) || catalog?.unclassified.includes(model);
  return (
    <div className="settings-field">
      <div className="settings-field">
        <label className="settings-field-label" htmlFor={modelId}>{media === "video" ? "默认视频模型" : "默认画图模型"}</label>
        <div className="settings-input-with-action">
          <input id={modelId} className="settings-input" value={model} onChange={(event) => onChange(event.target.value)} placeholder="输入模型 ID 或检测后选择" />
          <button type="button" className="settings-inline-action-btn" disabled={!config.enabled || !config.baseUrl || loading} onClick={() => void detect()}>
            {loading ? <Loader2 size={14} className="status-spinner" /> : <RefreshCw size={14} />}
            {loading ? "检测中…" : "检测模型"}
          </button>
        </div>
      </div>
      {hasModels ? (
        <select className="settings-select" aria-label={`选择检测到的${mediaName}模型`} value={selected ? model : ""} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>选择检测到的模型</option>
          {catalog.models.length > 0 && <optgroup label={`${mediaName}生成模型`}>
            {catalog.models.map((id) => <option value={id} key={id}>{id}</option>)}
          </optgroup>}
          {catalog.unclassified.length > 0 && <optgroup label="能力未标注，请按服务商说明选择">
            {catalog.unclassified.map((id) => <option value={id} key={id}>{id}</option>)}
          </optgroup>}
        </select>
      ) : null}
      {error && <span role="alert" className="settings-field-hint">{error}</span>}
      {hasModels && media === "video" && <span className="settings-field-hint">这里读取的是服务商模型目录，不会试生成视频。目录中的模型是否当前可用，以生成接口返回为准。</span>}
      {catalog && !hasModels && <span role="status" className="settings-field-hint">目录中没有检测到{mediaName}生成模型，可手动填写模型 ID。</span>}
    </div>
  );
}
