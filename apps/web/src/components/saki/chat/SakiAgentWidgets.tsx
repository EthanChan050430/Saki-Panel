import { useState } from "react";
import { Check, CircleHelp, ClipboardList, Loader2, Send, SkipForward } from "lucide-react";
import type { SakiAgentAction } from "@webops/shared";

export function SakiTodoCard({ action }: { action: SakiAgentAction }) {
  const items = action.todos ?? [];
  const completed = items.filter((item) => item.completed).length;
  if (!items.length) return null;
  return (
    <section className="saki-agent-widget saki-todo-card" aria-label="任务清单">
      <div className="saki-agent-widget-heading">
        <span className="saki-agent-widget-icon"><ClipboardList size={16} /></span>
        <strong>任务进度</strong>
        <span className="saki-todo-count">{completed} / {items.length}</span>
      </div>
      <div className="saki-todo-progress" role="progressbar" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={items.length}>
        <span style={{ width: `${completed / items.length * 100}%` }} />
      </div>
      <ul className="saki-todo-items">
        {items.map((item, index) => (
          <li className={item.completed ? "done" : ""} key={`${index}:${item.text}`}>
            <span className="saki-todo-check" aria-hidden="true">{item.completed ? <Check size={12} /> : null}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
    catch (cause) { setError(cause instanceof Error ? cause.message : "回答发送失败，请重试。"); }
  };
  const pending = action.status === "pending_input";
  const options = action.question?.options ?? [];
  const answer = action.answer;
  return (
    <section className="saki-agent-widget saki-question-card" aria-label="Saki 提问">
      <div className="saki-agent-widget-heading">
        <span className="saki-agent-widget-icon"><CircleHelp size={16} /></span>
        <strong>Saki 想确认</strong>
        <span className="saki-question-state">{pending ? "等待你的回答" : answer?.skipped ? "已跳过" : "已回答"}</span>
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
            placeholder={options.length ? "也可以补充说明，或直接写自己的答案…" : "写下你的回答…"}
            aria-label="自定义回答或补充说明" />
          <div className="saki-question-actions">
            <button type="button" className="saki-question-submit" disabled={busy || (!selection && !customText.trim())}
              onClick={() => void submit({ ...(selection ? { selection } : {}), ...(customText.trim() ? { customText: customText.trim() } : {}) })}>
              {busy ? <Loader2 size={14} className="status-spinner" /> : <Send size={14} />} 发送回答
            </button>
            <button type="button" className="saki-question-skip" disabled={busy} onClick={() => void submit({ skipped: true })}>
              <SkipForward size={14} /> 跳过
            </button>
          </div>
          {error ? <p className="saki-question-error" role="alert">{error}</p> : null}
        </>
      ) : (
        <p className="saki-question-answer">{answer?.skipped ? "你选择跳过，Saki 将自行判断。" : [answer?.selection, answer?.customText].filter(Boolean).join(" · ")}</p>
      )}
    </section>
  );
}
