import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  Code2,
  Cpu,
  Edit3,
  FileCode,
  FileSearch,
  FileText,
  FolderOpen,
  Heart,
  Keyboard,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Plus,
  Search,
  Send,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal as TerminalIcon,
  UtensilsCrossed,
  X,
  Zap
} from "lucide-react";
import type {
  SakiAgentPermissionMode,
  SakiChatMode,
  SakiModelOption
} from "@webops/shared";
import type { BrowserSpeechRecognition } from "../../types/app.js";
import { getSakiAffectionQuote, getSpeechRecognitionConstructor } from "./sakiChatHelpers.js";
import type { SakiPetController } from "./pet/sakiPetState.js";

export interface SakiCapsuleTaskInfo {
  tool?: string | undefined;
  stage?: string | undefined;
  message?: string | undefined;
  title?: string | undefined;
}

export interface SakiCapsuleHUDProps {
  isBusy?: boolean | undefined;
  activeTask?: SakiCapsuleTaskInfo | null | undefined;
  onClick?: (() => void) | undefined;
  onSendPrompt?: ((prompt: string) => void) | undefined;
  sakiMode?: SakiChatMode | undefined;
  onSakiModeChange?: ((mode: SakiChatMode) => void) | undefined;
  permissionMode?: SakiAgentPermissionMode | undefined;
  onPermissionModeChange?: ((perm: SakiAgentPermissionMode) => void) | undefined;
  currentModelId?: string | undefined;
  availableModels?: SakiModelOption[] | undefined;
  onModelChange?: ((modelId: string) => void) | undefined;
  className?: string | undefined;
  pet?: SakiPetController | undefined;
  stageHovered?: boolean | undefined;
  language?: string | undefined;
  intimacyLevel?: number | undefined;
  intimacyTitle?: string | undefined;
  onOpenFeed?: (() => void) | undefined;
  onIntimacy?: ((amount: number) => void) | undefined;
}

export type SakiCapsuleMode = "dock" | "text_input" | "voice_recording";

function MetricCircleIcon({
  icon,
  value,
  max = 100,
  color,
  tooltip,
  onClick
}: {
  icon: React.ReactNode;
  value: number;
  max?: number | undefined;
  color: string;
  tooltip: string;
  onClick?: (() => void) | undefined;
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <button
      type="button"
      className="capsule-metric-badge"
      title={tooltip}
      aria-label={tooltip}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      <svg className="capsule-metric-svg" width="22" height="22" viewBox="0 0 22 22">
        <circle
          className="capsule-metric-track"
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          strokeWidth="2"
        />
        <circle
          className="capsule-metric-gauge"
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          strokeWidth="2"
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="capsule-metric-icon" style={{ color }}>
        {icon}
      </span>
      <span className="capsule-metric-tooltip">{tooltip}</span>
    </button>
  );
}

function TriRingVitalsBadge({
  hunger,
  mood,
  health,
  onClick
}: {
  hunger: number;
  mood: number;
  health: number;
  onClick?: (() => void) | undefined;
}) {
  const hPercent = Math.min(100, Math.max(0, hunger));
  const mPercent = Math.min(100, Math.max(0, mood));
  const hePercent = Math.min(100, Math.max(0, health));

  const r1 = 9.6;
  const c1 = 2 * Math.PI * r1;
  const offset1 = c1 - (hPercent / 100) * c1;

  const r2 = 7.0;
  const c2 = 2 * Math.PI * r2;
  const offset2 = c2 - (mPercent / 100) * c2;

  const r3 = 4.4;
  const c3 = 2 * Math.PI * r3;
  const offset3 = c3 - (hePercent / 100) * c3;

  const isLowVital = hPercent < 30 || mPercent < 30 || hePercent < 30;

  return (
    <button
      type="button"
      className={`capsule-metric-badge capsule-vitals-badge ${isLowVital ? "is-low-vital" : ""}`}
      title={`状态: 饱食 ${Math.round(hPercent)}% · 心情 ${Math.round(mPercent)}% · 健康 ${Math.round(hePercent)}%`}
      aria-label={`状态: 饱食 ${Math.round(hPercent)}% · 心情 ${Math.round(mPercent)}% · 健康 ${Math.round(hePercent)}%`}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      <svg className="capsule-metric-svg" width="22" height="22" viewBox="0 0 22 22">
        <circle
          className="capsule-metric-track"
          cx="11"
          cy="11"
          r={r1}
          fill="none"
          strokeWidth="1.6"
          stroke="rgba(251, 146, 60, 0.20)"
        />
        <circle
          className="capsule-metric-gauge"
          cx="11"
          cy="11"
          r={r1}
          fill="none"
          strokeWidth="1.6"
          stroke="#fb923c"
          strokeDasharray={c1}
          strokeDashoffset={offset1}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
        />

        <circle
          className="capsule-metric-track"
          cx="11"
          cy="11"
          r={r2}
          fill="none"
          strokeWidth="1.6"
          stroke="rgba(245, 158, 11, 0.20)"
        />
        <circle
          className="capsule-metric-gauge"
          cx="11"
          cy="11"
          r={r2}
          fill="none"
          strokeWidth="1.6"
          stroke="#f59e0b"
          strokeDasharray={c2}
          strokeDashoffset={offset2}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
        />

        <circle
          className="capsule-metric-track"
          cx="11"
          cy="11"
          r={r3}
          fill="none"
          strokeWidth="1.6"
          stroke="rgba(16, 185, 129, 0.20)"
        />
        <circle
          className="capsule-metric-gauge"
          cx="11"
          cy="11"
          r={r3}
          fill="none"
          strokeWidth="1.6"
          stroke="#10b981"
          strokeDasharray={c3}
          strokeDashoffset={offset3}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
        />

        <circle
          cx="11"
          cy="11"
          r="1.6"
          fill={isLowVital ? "#f43f5e" : "#fbbf24"}
          className="vitals-center-dot"
        />
      </svg>

      <span className="capsule-metric-tooltip capsule-vitals-tooltip">
        <span className="tip-metric-val val-hunger">饱食 {Math.round(hPercent)}%</span>
        <span className="tip-sep">·</span>
        <span className="tip-metric-val val-mood">心情 {Math.round(mPercent)}%</span>
        <span className="tip-sep">·</span>
        <span className="tip-metric-val val-health">健康 {Math.round(hePercent)}%</span>
      </span>
    </button>
  );
}

export function SakiCapsuleHUD({
  isBusy = false,
  activeTask = null,
  onClick,
  onSendPrompt,
  sakiMode = "agent",
  onSakiModeChange,
  permissionMode = "ask",
  onPermissionModeChange,
  currentModelId = "",
  availableModels = [],
  onModelChange,
  className = "",
  pet,
  stageHovered = false,
  language,
  intimacyLevel = 1,
  intimacyTitle = "相识",
  onOpenFeed,
  onIntimacy
}: SakiCapsuleHUDProps) {
  const hasTask = Boolean(isBusy || activeTask);
  const [isHovered, setIsHovered] = useState(false);
  const [stageActive, setStageActive] = useState(false);
  const stageTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<SakiCapsuleMode>("dock");
  const [textDraft, setTextDraft] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const isStageHovered = Boolean(stageHovered || pet?.hovered);
    if (isStageHovered) {
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      setStageActive(true);
    } else {
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
      }
      stageTimerRef.current = window.setTimeout(() => {
        setStageActive(false);
        stageTimerRef.current = null;
      }, 300);
    }
    return () => {
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
      }
    };
  }, [stageHovered, pet?.hovered]);

  const isCapsuleExpanded = isHovered || stageActive;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode === "text_input") {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [mode]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      const recognition = recognitionRef.current;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort?.();
        recognition.stop?.();
      } catch {}
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => stopSpeechRecognition, [stopSpeechRecognition]);

  const startVoiceRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setMenuOpen(false);

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setMode("text_input");
      return;
    }

    stopSpeechRecognition();
    setVoiceTranscript("");
    setMode("voice_recording");

    try {
      const recognition = new Recognition();
      recognition.lang = navigator.language || "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      let latestTranscript = "";

      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition) return;
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i]?.[0]?.transcript ?? "";
        }
        if (transcript) {
          latestTranscript = transcript;
          setVoiceTranscript(transcript);
        }
      };

      recognition.onerror = (err) => {
        if (recognitionRef.current !== recognition) return;
        console.warn("[SakiCapsuleHUD] Speech recognition error:", err);
        stopSpeechRecognition();
        setMode("text_input");
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setTextDraft(latestTranscript);
        setMode("text_input");
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("[SakiCapsuleHUD] Failed to start speech recognition:", err);
      stopSpeechRecognition();
      setMode("text_input");
    }
  }, [stopSpeechRecognition]);

  const finishAndSendVoice = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    stopSpeechRecognition();
    const promptToSend = voiceTranscript.trim();
    setVoiceTranscript("");
    setMode("dock");
    setMenuOpen(false);
    if (promptToSend && onSendPrompt) {
      onSendPrompt(promptToSend);
    }
  }, [stopSpeechRecognition, voiceTranscript, onSendPrompt]);

  const cancelVoiceRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    stopSpeechRecognition();
    setVoiceTranscript("");
    setMode("dock");
    setMenuOpen(false);
  }, [stopSpeechRecognition]);

  const handleSendText = useCallback((e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const promptToSend = textDraft.trim();
    if (!promptToSend) return;
    setTextDraft("");
    setMode("dock");
    setMenuOpen(false);
    if (onSendPrompt) {
      onSendPrompt(promptToSend);
    }
  }, [textDraft, onSendPrompt]);

  const cancelTextMode = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setTextDraft("");
    setMode("dock");
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    if (mode === "dock" && !menuOpen) return;
    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        if (mode === "voice_recording") {
          stopSpeechRecognition();
          setVoiceTranscript("");
        }
        setMode("dock");
        setMenuOpen(false);
      } else if (menuOpen && menuRef.current && target && !menuRef.current.contains(target)) {
        const plusBtn = rootRef.current?.querySelector(".capsule-plus-btn");
        if (!plusBtn || !plusBtn.contains(target)) {
          setMenuOpen(false);
        }
      }
    };
    document.addEventListener("pointerdown", handlePointerDownOutside);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside);
  }, [mode, menuOpen, stopSpeechRecognition]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      handleSendText();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (menuOpen) {
        setMenuOpen(false);
      } else {
        cancelTextMode();
      }
    }
  }, [handleSendText, cancelTextMode, menuOpen]);

  const taskDetails = useMemo(() => {
    if (!hasTask) return null;

    const tool = (activeTask?.tool || "").toLowerCase();
    const stage = (activeTask?.stage || "").toLowerCase();
    const rawMsg = activeTask?.message || activeTask?.title || "";

    if (
      tool.includes("write") ||
      tool.includes("edit") ||
      tool.includes("replace") ||
      tool.includes("append") ||
      rawMsg.includes("编辑") ||
      rawMsg.includes("写入") ||
      rawMsg.includes("修改")
    ) {
      return {
        icon: <Edit3 size={15} strokeWidth={2.2} className="capsule-icon-action" />,
        label: rawMsg || "正在编辑文件",
        type: "edit"
      };
    }

    if (
      tool.includes("read") ||
      tool.includes("view") ||
      tool.includes("cat") ||
      rawMsg.includes("阅读") ||
      rawMsg.includes("查看文件") ||
      rawMsg.includes("读取")
    ) {
      return {
        icon: <BookOpen size={15} strokeWidth={2.2} className="capsule-icon-action" />,
        label: rawMsg || "正在阅读文件",
        type: "read"
      };
    }

    if (
      tool.includes("list") ||
      tool.includes("check") ||
      tool.includes("find") ||
      tool.includes("search") ||
      tool.includes("glob") ||
      rawMsg.includes("搜索") ||
      rawMsg.includes("检索") ||
      rawMsg.includes("目录")
    ) {
      return {
        icon: <Search size={15} strokeWidth={2.2} className="capsule-icon-action" />,
        label: rawMsg || "正在检索工作区",
        type: "search"
      };
    }

    if (
      tool.includes("exec") ||
      tool.includes("command") ||
      tool.includes("bash") ||
      tool.includes("sh") ||
      tool.includes("terminal") ||
      rawMsg.includes("执行") ||
      rawMsg.includes("命令")
    ) {
      return {
        icon: <TerminalIcon size={15} strokeWidth={2.2} className="capsule-icon-action" />,
        label: rawMsg || "正在执行终端命令",
        type: "exec"
      };
    }

    if (stage.includes("think") || stage.includes("plan") || rawMsg.includes("思考") || rawMsg.includes("研判")) {
      return {
        icon: <Sparkles size={15} strokeWidth={2.2} className="capsule-icon-action sparkle-pulse" />,
        label: rawMsg || "Saki 深度研判中",
        type: "think"
      };
    }

    return {
      icon: <Activity size={15} strokeWidth={2.2} className="capsule-icon-action" />,
      label: rawMsg || "Saki 任务进程运行中",
      type: "general"
    };
  }, [hasTask, activeTask]);

  const morphStateClass = hasTask
    ? "is-active"
    : mode === "text_input"
    ? "is-text-input"
    : mode === "voice_recording"
    ? "is-voice-recording"
    : isCapsuleExpanded
    ? "is-hover-expanded"
    : "is-idle";

  const effectiveModels = availableModels;

  return (
    <div
      ref={rootRef}
      className={`saki-feet-capsule-root ${morphStateClass} ${taskDetails?.type || ""} ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        if (mode === "dock") setIsHovered(false);
      }}
      role="region"
      aria-label="Saki 灵动交互胶囊"
    >
      {hasTask ? (
        <div
          className="saki-feet-expanded-pill"
          role="button"
          tabIndex={0}
          onClick={(event) => { event.stopPropagation(); onClick?.(); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onClick?.();
            }
          }}
          title={taskDetails?.label || "Saki 任务运行中"}
        >
          <div className="capsule-left-icon">
            {taskDetails?.icon}
          </div>
          <span className="capsule-dock-divider" />
          <div className="capsule-soundwave-bars" aria-label="进程活动波形">
            <span className="eq-bar bar-1" />
            <span className="eq-bar bar-2" />
            <span className="eq-bar bar-3" />
            <span className="eq-bar bar-4" />
          </div>
          {taskDetails?.label && (
            <div className="capsule-task-hover-bubble">
              <span>{taskDetails.label}</span>
            </div>
          )}
        </div>
      ) : mode === "text_input" ? (
        <div className="saki-feet-input-morph" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`capsule-plus-btn ${menuOpen ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            title="Saki 模式、权限与模型选择"
          >
            <Plus size={14} />
          </button>

          <input
            ref={inputRef}
            type="text"
            className="capsule-text-input-field"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            style={{
              border: "none",
              outline: "none",
              boxShadow: "none",
              background: "transparent",
              WebkitAppearance: "none"
            }}
            placeholder={
              sakiMode === "agent"
                ? "输入运维指令或向 Saki Agent 提问..."
                : "与 Saki 畅快聊天..."
            }
          />

          <div className="capsule-input-actions">
            <button
              type="button"
              className={`capsule-action-icon-btn send-btn ${textDraft.trim() ? "can-send" : ""}`}
              onClick={handleSendText}
              disabled={!textDraft.trim()}
              title="发送指令 (Enter)"
            >
              <Send size={12} />
            </button>
            <button
              type="button"
              className="capsule-action-icon-btn close-btn"
              onClick={cancelTextMode}
              title="取消 (ESC)"
            >
              <X size={12} />
            </button>
          </div>

          {menuOpen && (
            <div ref={menuRef} className="capsule-settings-popover" onClick={(e) => e.stopPropagation()}>
              <div className="popover-group">
                <div className="popover-group-label">
                  <Bot size={12} />
                  <span>交互模式</span>
                </div>
                <div className="popover-button-group">
                  <button
                    type="button"
                    className={`popover-choice-btn ${sakiMode === "chat" ? "active" : ""}`}
                    onClick={() => {
                      onSakiModeChange?.("chat");
                    }}
                  >
                    <MessageSquare size={12} />
                    <span>聊天</span>
                  </button>
                  <button
                    type="button"
                    className={`popover-choice-btn ${sakiMode === "agent" ? "active" : ""}`}
                    onClick={() => {
                      onSakiModeChange?.("agent");
                    }}
                  >
                    <Bot size={12} />
                    <span>Agent (智能体)</span>
                  </button>
                </div>
              </div>

              {sakiMode === "agent" && (
                <div className="popover-group">
                  <div className="popover-group-label">
                    <Shield size={12} />
                    <span>执行权限</span>
                  </div>
                  <div className="popover-button-group">
                    <button
                      type="button"
                      className={`popover-choice-btn ${permissionMode === "ask" ? "active" : ""}`}
                      onClick={() => onPermissionModeChange?.("ask")}
                      title="高危操作每次询问确认"
                    >
                      <Lock size={12} />
                      <span>询问</span>
                    </button>
                    <button
                      type="button"
                      className={`popover-choice-btn ${permissionMode === "acceptEdits" ? "active" : ""}`}
                      onClick={() => onPermissionModeChange?.("acceptEdits")}
                      title="允许直接编辑修改文件"
                    >
                      <Zap size={12} />
                      <span>自动</span>
                    </button>
                    <button
                      type="button"
                      className={`popover-choice-btn ${permissionMode === "bypassPermissions" ? "active" : ""}`}
                      onClick={() => onPermissionModeChange?.("bypassPermissions")}
                      title="完全绕过权限自由运维"
                    >
                      <ShieldCheck size={12} />
                      <span>完全</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="popover-group">
                <div className="popover-group-label">
                  <Cpu size={12} />
                  <span>模型切换</span>
                </div>
                <div className="popover-model-list">
                  {effectiveModels.map((m) => {
                    const isSelected =
                      m.id === currentModelId || (!currentModelId && m.id === "auto");
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!onModelChange}
                        className={`popover-model-item ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          onModelChange?.(m.id);
                          setMenuOpen(false);
                        }}
                      >
                        <span className="model-name">{m.name}</span>
                        {m.provider && <span className="model-badge">{m.provider}</span>}
                        {isSelected && <Check size={12} className="model-check" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : mode === "voice_recording" ? (
        <div className="saki-feet-recording-morph" onClick={(e) => e.stopPropagation()}>
          <div className="capsule-recording-orb">
            <span className="recording-ripple" />
            <Mic size={13} className="recording-mic-icon" />
          </div>

          <div className="capsule-live-soundwave">
            <span className="live-wave wave-1" />
            <span className="live-wave wave-2" />
            <span className="live-wave wave-3" />
            <span className="live-wave wave-4" />
            <span className="live-wave wave-5" />
          </div>

          <div className="capsule-transcript-stream" title={voiceTranscript || "正在聆听语音输入..."}>
            {voiceTranscript ? (
              <span className="transcript-live-text">{voiceTranscript}</span>
            ) : (
              <span className="transcript-placeholder">
                正在聆听语音<span className="typing-dots">...</span>
              </span>
            )}
          </div>

          <div className="capsule-recording-actions">
            <button
              type="button"
              className={`capsule-action-icon-btn done-btn ${voiceTranscript.trim() ? "ready" : ""}`}
              onClick={finishAndSendVoice}
              title={voiceTranscript.trim() ? "完成并发送" : "停止并发送"}
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              className="capsule-action-icon-btn close-btn"
              onClick={cancelVoiceRecording}
              title="取消录音"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ) : isCapsuleExpanded ? (
        <div className="saki-feet-hover-actions" onClick={(e) => e.stopPropagation()}>
          {pet && (
            <>
              <MetricCircleIcon
                icon={<Heart size={11} fill="currentColor" />}
                value={Math.min(100, Math.max(15, intimacyLevel * 10))}
                max={100}
                color="#f43f5e"
                tooltip={`好感度: Lv.${intimacyLevel} · ${intimacyTitle}`}
                onClick={() => {
                  pet.applyCare("pet");
                  onIntimacy?.(2);
                  const quote = getSakiAffectionQuote(intimacyLevel, language);
                  pet.showBubble(quote, 3400);
                }}
              />

              <TriRingVitalsBadge
                hunger={pet.stats.hunger}
                mood={pet.stats.mood}
                health={pet.stats.health}
                onClick={() => {
                  if (pet.group === "companion") {
                    pet.setGroup("none");
                  } else if (pet.stats.hunger < 50 && onOpenFeed) {
                    onOpenFeed();
                  } else {
                    pet.setGroup("companion");
                  }
                }}
              />

              <span className="capsule-hover-divider" />
            </>
          )}

          <button
            type="button"
            className="capsule-hover-btn icon-only keyboard-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMode("text_input");
            }}
            title="文字输入 (点击向 Saki 提问或输入指令)"
            aria-label="文字输入"
          >
            <Keyboard size={13} />
            <span className="capsule-metric-tooltip">文字输入</span>
          </button>

          <span className="capsule-hover-divider" />

          <button
            type="button"
            className="capsule-hover-btn mic-btn icon-only"
            onClick={startVoiceRecording}
            title="语音输入 (开始与 Saki 语音交流)"
            aria-label="语音输入"
          >
            <Mic size={13} />
            <span className="capsule-metric-tooltip">语音输入</span>
          </button>
        </div>
      ) : (
        <div
          className="saki-feet-collapsed-pill"
          onClick={(e) => {
            e.stopPropagation();
            setIsHovered(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              setIsHovered(true);
            }
          }}
          role="button"
          tabIndex={0}
          title="点击展开 Saki 快捷操作与状态"
        >
          <span className="collapsed-dock-line" />
        </div>
      )}
    </div>
  );
}
