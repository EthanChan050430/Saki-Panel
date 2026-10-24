import React, { useId, useState } from "react";
import { Check, ChevronLeft, ChevronRight, RotateCcw, ScanEye, Search, Zap } from "lucide-react";
import { normalizeSakiReasoningEffort, parseSakiModelSelection, sakiModelMatchesSelection, sakiModelSelectionKey,
  sakiReasoningEffortLabel, sakiReasoningProfile, type SakiModelOption, type SakiReasoningEffort } from "@webops/shared";
import { formatSakiModelMultiplier, resolveSakiModelPointsMultiplier, type SakiModelPointsMultiplierMap } from "./sakiChatHelpers.js";
import "../../styles/saki-reasoning.css";
import { useSakiReasoningEffort } from "./useSakiReasoningEffort.js";

export interface SakiModelReasoningPanelProps {
  models: SakiModelOption[];
  currentModelId: string;
  currentModelName?: string | undefined;
  effort: SakiReasoningEffort;
  onEffortChange: (effort: SakiReasoningEffort) => void;
  onSelectModel: (model: string) => void;
  modelPointsMultipliers?: SakiModelPointsMultiplierMap | undefined;
}

export function SakiModelPicker(props: Omit<SakiModelReasoningPanelProps, "effort" | "onEffortChange">) {
  const [effort, onEffortChange] = useSakiReasoningEffort(props.currentModelId);
  return <SakiModelReasoningPanel {...props} effort={effort} onEffortChange={onEffortChange} />;
}

export function SakiModelReasoningPanel({ models, currentModelId, currentModelName, effort, onEffortChange, onSelectModel, modelPointsMultipliers }: SakiModelReasoningPanelProps) {
  const [choosingModel, setChoosingModel] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const selection = parseSakiModelSelection(currentModelId);
  const selected = models.find((model) => sakiModelMatchesSelection(model, currentModelId));
  const name = currentModelName || selected?.label || selected?.name || selection.model || "选择模型";
  const profile = sakiReasoningProfile(selection.model, selection.provider);
  const value = normalizeSakiReasoningEffort(effort, selection.model, selection.provider);
  const index = Math.max(0, profile.levels.indexOf(value === "auto" ? profile.defaultLevel : value));
  const percent = profile.levels.length > 1 ? index / (profile.levels.length - 1) * 100 : 0;
  const ultra = value !== "auto" && index === profile.levels.length - 1;
  const label = ultra ? "Ultra" : sakiReasoningEffortLabel(value);
  const filtered = models.filter((model) => `${model.label} ${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(query.toLowerCase()));

  return <div className={`saki-reasoning-panel ${ultra ? "is-ultra" : ""}`}>
    {choosingModel ? <>
      <div className="saki-reasoning-list-heading">
        <button type="button" onClick={() => setChoosingModel(false)} aria-label="返回推理强度"><ChevronLeft size={16} /></button>
        <span>选择模型</span>
      </div>
      <label className="saki-reasoning-search"><Search size={14} /><input autoFocus={typeof window !== "undefined" && !window.matchMedia("(pointer: coarse)").matches} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型…" aria-label="搜索模型" /></label>
      <div className="saki-reasoning-models" role="listbox" aria-label="可用模型">
        {filtered.map((model) => {
          const active = sakiModelMatchesSelection(model, currentModelId);
          const multiplier = resolveSakiModelPointsMultiplier(modelPointsMultipliers, model);
          return <button type="button" role="option" aria-selected={active} key={sakiModelSelectionKey(model)} className={active ? "is-selected" : ""}
            onClick={() => { onSelectModel(sakiModelSelectionKey(model)); setChoosingModel(false); setQuery(""); }}>
            <span className="saki-reasoning-model-name">{model.label || model.name || model.id}<small>{model.provider || model.vendor || model.id}</small></span>
            {model.supportsVision ? <ScanEye size={13} aria-label="支持视觉" /> : null}
            {modelPointsMultipliers ? <small>{multiplier === 0 ? "免费" : formatSakiModelMultiplier(multiplier)}</small> : null}
            {active ? <Check size={14} /> : null}
          </button>;
        })}
        {filtered.length === 0 ? <p>{models.length ? "未找到匹配模型" : "暂无可用模型"}</p> : null}
      </div>
    </> : <>
      <div className="saki-reasoning-heading">
        <Zap size={17} className="saki-reasoning-bolt" aria-hidden="true" />
        <span id={`${id}-label`} className="saki-reasoning-level" aria-live="polite">{profile.levels.length ? label : "模型默认"}</span>
        <button type="button" className="saki-reasoning-reset" aria-label="恢复默认推理强度" title="恢复模型默认强度" disabled={value === "auto"} onClick={() => onEffortChange("auto")}><RotateCcw size={17} /></button>
      </div>
      <button type="button" className="saki-reasoning-model" onClick={() => setChoosingModel(true)} aria-label={`切换模型，当前 ${name}`} aria-expanded={false}>
        <span>{name}</span><ChevronRight size={13} />
      </button>
      {profile.levels.length ? <div className="saki-reasoning-slider" style={{ "--reasoning-progress": `${percent}%` } as React.CSSProperties}>
        <div className="saki-reasoning-track" aria-hidden="true"><span className="saki-reasoning-fill" />
          <span className="saki-reasoning-particles">{Array.from({ length: 15 }, (_, i) => <i key={i} style={{ "--particle-x": `${5 + (i * 17) % 88}%`, "--particle-y": `${20 + (i * 23) % 65}%`, "--particle-delay": `${i * -0.19}s` } as React.CSSProperties} />)}</span>
          <span className="saki-reasoning-stops">{profile.levels.map((level, step) => <i key={level} className={step <= index ? "is-filled" : ""} />)}</span>
        </div>
        <input type="range" min={0} max={profile.levels.length - 1} step={1} value={index} aria-label="推理强度" aria-valuetext={value === "auto" ? `模型默认：${sakiReasoningEffortLabel(profile.defaultLevel)}` : label}
          onPointerUp={(event) => onEffortChange(profile.levels[Number(event.currentTarget.value)]!)}
          onKeyDown={(event) => {
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              onEffortChange(profile.levels[event.key === "Home" ? 0 : profile.levels.length - 1]!);
            }
          }}
          onChange={(event) => onEffortChange(profile.levels[Number(event.target.value)]!)} />
      </div> : <p className="saki-reasoning-unavailable">此模型使用默认推理策略</p>}
    </>}
  </div>;
}
