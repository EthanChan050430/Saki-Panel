import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, CircleHelp, ClipboardList, Loader2, RotateCw, Send, SkipForward } from "lucide-react";
import type { SakiAgentAction } from "@webops/shared";

export function SakiTodoCard({ action }: { action: SakiAgentAction }) {
  const items = action.todos ?? [];
  const [collapsed, setCollapsed] = useState(true);
  const completed = items.filter((item) => item.completed).length;
  const current = items.find((item) => item.inProgress && !item.completed) ?? items.find((item) => !item.completed);
  if (!items.length) return null;
  return (
    <section className="saki-agent-widget saki-todo-card" aria-label="任务清单">
      <button type="button" className="saki-agent-widget-heading saki-todo-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>
        <span className="saki-agent-widget-icon"><ClipboardList size={16} /></span>
        <strong>计划</strong>
        <span className="saki-todo-count">{completed} / {items.length}</span>
        {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {collapsed ? <p className="saki-todo-current">{current?.text ?? "已完成"}</p> : <>
      <div className="saki-todo-progress" role="progressbar" aria-label="任务完成进度" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={items.length}>
        <span style={{ width: `${completed / items.length * 100}%` }} />
      </div>
      <ul className="saki-todo-items">
        {items.map((item, index) => (
          <li className={item.completed ? "done" : item.inProgress ? "in-progress" : ""} key={`${index}:${item.text}`}>
            <span className="saki-todo-check" aria-hidden="true">{item.completed ? <Check size={12} /> : item.inProgress ? <Loader2 size={12} className="status-spinner" /> : null}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      </>}
    </section>
  );
}

export function SakiRetryCard({
  reason,
  busy,
  onRetry,
  onDismiss
}: {
  reason: string;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const cleanReason = (reason || "任务执行中断")
    .replace(/[，,]?\s*选择\s*Retry\s*可从中断处继续[。.]?/gi, "")
    .replace(/[，,]?\s*选择\s*Retry\s*可从当前进度继续[。.]?/gi, "")
    .replace(/[，,]?\s*选择\s*Retry\s*继续[。.]?/gi, "")
    .trim();

  return (
    <section className="saki-agent-widget saki-retry-card" aria-label="任务中断">
      <div className="saki-agent-widget-heading">
        <span className="saki-agent-widget-icon saki-retry-icon">
          <AlertTriangle size={15} />
        </span>
        <strong>任务中断</strong>
      </div>
      <p className="saki-retry-reason">{cleanReason}</p>
      <div className="saki-question-actions">
        <button
          type="button"
          className="saki-question-submit"
          disabled={busy}
          onClick={onRetry}
        >
          {busy ? <Loader2 size={13} className="status-spinner" /> : <RotateCw size={13} />} 重试
        </button>
        <button
          type="button"
          className="saki-question-skip"
          disabled={busy}
          onClick={onDismiss}
        >
          取消
        </button>
      </div>
    </section>
  );
}

export const SakiRetryDialog = SakiRetryCard;

export function SakiAskUserCard({
  action,
  busy,
  onAnswer
}: {
  action: SakiAgentAction;
  busy: boolean;
  onAnswer: (answer: { selection?: string; customText?: string; skipped?: boolean }) => Promise<void> | void;
}) {
  const [selection, setSelection] = useState("");
  const [customText, setCustomText] = useState("");
  const [error, setError] = useState("");
  const submit = async (value: { selection?: string; customText?: string; skipped?: boolean }) => {
    setError("");
    try { await onAnswer(value); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试。"); }
  };
  const pending = action.status === "pending_input";
  const options = [...new Set(action.question?.options ?? [])];
  const answer = action.answer;
  return (
    <section className="saki-agent-widget saki-question-card" aria-label="确认">
      <div className="saki-agent-widget-heading">
        <span className="saki-agent-widget-icon"><CircleHelp size={16} /></span>
        <strong>确认</strong>
        <span className="saki-question-state">{pending ? "待确认" : answer?.skipped ? "已跳过" : "已确认"}</span>
      </div>
      <p className="saki-question-text">{action.question?.text ?? String(action.args.question ?? "")}</p>
      {pending ? (
        <>
          {options.length ? (
            <div className="saki-question-options" role="radiogroup" aria-label="选择回答">
              {options.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={selection === option}
                  className={`saki-question-option ${selection === option ? "selected" : ""}`}
                  disabled={busy} onClick={() => setSelection(selection === option ? "" : option)}>
                  <span className="saki-question-radio">{selection === option ? <Check size={11} /> : null}</span>
                  <span>{option}</span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea className="saki-question-custom" rows={2} maxLength={4000} value={customText}
            onChange={(event) => setCustomText(event.target.value)} disabled={busy}
            placeholder={options.length ? "补充说明或自定义回答…" : "输入说明或回答…"}
            aria-label="自定义回答或补充说明" />
          <div className="saki-question-actions">
            <button type="button" className="saki-question-submit" disabled={busy || (!selection && !customText.trim())}
              onClick={() => void submit({ ...(selection ? { selection } : {}), ...(customText.trim() ? { customText: customText.trim() } : {}) })}>
              {busy ? <Loader2 size={14} className="status-spinner" /> : <Send size={14} />} 确认
            </button>
            <button type="button" className="saki-question-skip" disabled={busy} onClick={() => void submit({ skipped: true })}>
              <SkipForward size={14} /> 跳过
            </button>
          </div>
          {error ? <p className="saki-question-error" role="alert">{error}</p> : null}
        </>
      ) : (
        <p className="saki-question-answer">{answer?.skipped ? "已跳过" : [answer?.selection, answer?.customText].filter(Boolean).join(" · ")}</p>
      )}
    </section>
  );
}
