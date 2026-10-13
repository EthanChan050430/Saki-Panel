import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Copy, CornerUpLeft, FileDiff, Maximize2, Minimize2, MoreHorizontal, Pencil, Plus, Terminal, Trash2, X } from "lucide-react";
import type { InstanceGitChangesSummary, ManagedInstance, SakiAgentAction, SakiInputAttachment } from "@webops/shared";
import { MarkdownContent } from "../common/MarkdownContent.js";
import { DashboardPopover } from "./DashboardPopover.js";
import type { DashboardMessageOperation } from "./message-operations.js";
import { parseThinkingContent, SakiAttachmentChip, SakiThinkingActionCard, SakiToolActionCard, SakiToolIcon,
  sakiActionTarget, sakiActionTitle, visibleSakiActions } from "../saki/SakiComponents.js";
import { SakiCodeChangesDetails } from "../saki/chat/SakiCodeChanges.js";
const DashboardWebTerminal = React.lazy(() => import("../terminal/WebTerminal.js").then((module) => ({ default: module.WebTerminal })));

export interface DashboardChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  createdAt?: string | undefined;
  taskId?: string | undefined;
  /** Checkpoints for a deleted turn; contains no conversation text. */
  rollbackJournal?: boolean | undefined;
  thinking?: string | undefined;
  thinkingDurationSec?: number | undefined;
  isThinking?: boolean | undefined;
  actions?: SakiAgentAction[] | undefined;
  isStreaming?: boolean | undefined;
  workflowMessage?: string | undefined;
  attachments?: SakiInputAttachment[];
}

export type DashboardActionDecision = "approve" | "reject" | "rollback" | { selection?: string; customText?: string; skipped?: boolean };
type DecideAction = (messageId: string, action: SakiAgentAction, decision: DashboardActionDecision) => Promise<void>;
export type DashboardTerminalSession = NonNullable<SakiAgentAction["terminal"]>;

export function dashboardActionTerminal(action: SakiAgentAction, instanceId: string | null): DashboardTerminalSession | undefined {
  if (!instanceId) return undefined;
  if (action.terminal) return action.terminal.instanceId === instanceId ? action.terminal : undefined;
  if (!["runcommand", "runinshell", "createshell", "sendshellinput"].includes(action.tool.toLowerCase())) return undefined;
  const shellId = typeof action.args.shellId === "string" ? action.args.shellId : action.observation.match(/^shellId=([a-zA-Z0-9_-]+)$/m)?.[1];
  return shellId && /^[a-zA-Z0-9_-]{1,200}$/.test(shellId) ? { instanceId, shellId } : undefined;
}

function ActionControls({ action, messageId, busyId, onDecide, expanded = false }: {
  action: SakiAgentAction; messageId: string; busyId: string | null; onDecide: DecideAction; expanded?: boolean;
}) {
  return <SakiToolActionCard key={action.id} action={action} actionBusyId={busyId} defaultExpanded={expanded}
    onDecision={(target, decision) => { void onDecide(messageId, target, decision); }}
    onAnswer={(target, answer) => onDecide(messageId, target, answer)} />;
}

const routineTools = new Set([
  "readfile",
  "listfiles",
  "findfiles",
  "searchfiles",
  "outlinefile",
  "findsymbols",
  "readsymbol",
  "statfile",
  "runcommand",
  "runinshell",
  "diagnosecode",
  "gitstatus",
  "gitdiff",
  "getenvironmentinfo",
  "readmemory"
]);

export type PresentedDashboardAction =
  | { kind: "action"; id: string; action: SakiAgentAction }
  | { kind: "group"; id: string; items: SakiAgentAction[] };

export function compactDashboardActions(actions: SakiAgentAction[]): PresentedDashboardAction[] {
  const visible = visibleSakiActions(actions);
  const result: PresentedDashboardAction[] = [];
  let group: SakiAgentAction[] = [];

  const flush = () => {
    if (group.length > 1) {
      result.push({ kind: "group", id: `group:${group[0]!.id}`, items: group });
    } else if (group.length === 1) {
      result.push({ kind: "action", id: group[0]!.id, action: group[0]! });
    }
    group = [];
  };

  for (const action of visible) {
    const isRoutine =
      action.ok &&
      (!action.status || action.status === "completed") &&
      !action.approval?.rollbackAvailable &&
      routineTools.has(action.tool.toLowerCase());

    if (isRoutine) {
      group.push(action);
    } else {
      flush();
      result.push({ kind: "action", id: action.id, action });
    }
  }
  flush();
  return result;
}

function DashboardToolEntry({
  action,
  messageId,
  selected,
  busyId,
  onSelectAction,
  onDecide
}: {
  action: SakiAgentAction;
  messageId: string;
  selected: boolean;
  busyId: string | null;
  onSelectAction: (messageId: string, actionId: string) => void;
  onDecide: DecideAction;
}) {
  const pending = action.status === "pending_approval" || action.status === "pending_input";
  return (
    <div key={action.id} className="dashboard-tool-entry">
      <button
        type="button"
        className={`dashboard-tool-row${selected ? " is-selected" : ""}`}
        aria-label={`查看工具详情：${action.tool}`}
        aria-expanded={selected}
        aria-controls={selected ? "dashboard-tool-details" : undefined}
        onClick={() => onSelectAction(messageId, action.id)}
      >
        <SakiToolIcon action={action} size={14} />
        <span className="dashboard-tool-title">{sakiActionTitle(action)}</span>
        <code className="dashboard-tool-target">{sakiActionTarget(action)}</code>
        <span
          className={`dashboard-tool-state is-${action.status || (action.ok ? "completed" : "failed")}`}
          role="img"
          aria-label={
            pending
              ? action.status === "pending_input"
                ? "需回答"
                : "待确认"
              : action.status === "rolled_back"
                ? "已回滚"
                : action.ok
                  ? "已完成"
                  : "未完成"
          }
          title={
            pending
              ? action.status === "pending_input"
                ? "需回答"
                : "待确认"
              : action.status === "rolled_back"
                ? "已回滚"
                : action.ok
                  ? "已完成"
                  : "未完成"
          }
        />
        <ChevronRight size={13} />
      </button>
      {pending && !selected ? (
        <div className="dashboard-inline-approval">
          <ActionControls action={action} messageId={messageId} busyId={busyId} onDecide={onDecide} />
        </div>
      ) : null}
    </div>
  );
}

function DashboardToolGroup({
  group,
  messageId,
  selectedActionId,
  busyId,
  onSelectAction,
  onDecide
}: {
  group: { id: string; items: SakiAgentAction[] };
  messageId: string;
  selectedActionId?: string | undefined;
  busyId: string | null;
  onSelectAction: (messageId: string, actionId: string) => void;
  onDecide: DecideAction;
}) {
  const hasSelected = group.items.some((item) => item.id === selectedActionId);
  const [isOpen, setIsOpen] = useState(hasSelected);

  useEffect(() => {
    if (hasSelected) {
      setIsOpen(true);
    }
  }, [hasSelected]);

  return (
    <details
      className="dashboard-tool-group"
      key={group.id}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>已完成 {group.items.length} 个步骤</summary>
      <div className="dashboard-tool-group-content">
        {group.items.map((action) => (
          <DashboardToolEntry
            key={action.id}
            action={action}
            messageId={messageId}
            selected={selectedActionId === action.id}
            busyId={busyId}
            onSelectAction={onSelectAction}
            onDecide={onDecide}
          />
        ))}
      </div>
    </details>
  );
}

export function DashboardAgentMessage({ message, selectedActionId, busyId, onSelectAction, onDecide, onMessageOperation, copiedMessageId, canRollbackCode = false, onPreviewAttachment }: {
  message: DashboardChatMessage; selectedActionId?: string | undefined; busyId: string | null;
  onSelectAction: (messageId: string, actionId: string) => void; onDecide: DecideAction;
  onMessageOperation?: (messageId: string, operation: DashboardMessageOperation) => Promise<void>;
  copiedMessageId?: string | null;
  canRollbackCode?: boolean;
  onPreviewAttachment?: (attachment: SakiInputAttachment) => void;
}) {
  const parsed = message.role === "assistant" ? parseThinkingContent(message.content, message.thinking) : { answer: message.content, thinking: "" };
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const disabled = Boolean(busyId || message.isStreaming);
  const operate = (operation: DashboardMessageOperation) => { setMenuOpen(false); void onMessageOperation?.(message.id, operation).catch(() => {}); };
  const hasPendingAction = Boolean(
    message.actions?.some((action) => action.status === "pending_approval" || action.status === "pending_input")
  );
  const isStreamingActive = Boolean(message.isStreaming && !hasPendingAction);
  const isStreamingAnswer = Boolean(isStreamingActive && !message.isThinking && !message.workflowMessage);
  return <article className={`dashboard-message-row ${message.role}${editing ? " is-editing" : ""}${menuOpen ? " is-menu-open" : ""}`}>
    <div className="dashboard-message-meta">{message.role === "assistant" ? "Saki" : "你"}</div>
    <div className="dashboard-message-content">
      {message.attachments && message.attachments.length > 0 ? (
        <div className="saki-message-attachments" style={{ marginBottom: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {message.attachments.map((attachment, index) => (
            <SakiAttachmentChip
              attachment={attachment}
              key={attachment.id ?? `${attachment.name}-${index}`}
              onClick={() => onPreviewAttachment?.(attachment)}
            />
          ))}
        </div>
      ) : null}
      {parsed.thinking ? <SakiThinkingActionCard thinking={parsed.thinking} durationSec={message.thinkingDurationSec}
        streaming={Boolean(message.isStreaming && message.isThinking)} completedLabel="Think for" /> : null}
      {message.role === "assistant" && message.actions?.length ? <div className="dashboard-actions-container">
        {compactDashboardActions(message.actions).map((item) => {
          if (item.kind === "group") {
            return (
              <DashboardToolGroup
                key={item.id}
                group={item}
                messageId={message.id}
                selectedActionId={selectedActionId}
                busyId={busyId}
                onSelectAction={onSelectAction}
                onDecide={onDecide}
              />
            );
          }
          return (
            <DashboardToolEntry
              key={item.id}
              action={item.action}
              messageId={message.id}
              selected={selectedActionId === item.action.id}
              busyId={busyId}
              onSelectAction={onSelectAction}
              onDecide={onDecide}
            />
          );
        })}
      </div> : null}
      {editing ? <form className="dashboard-message-editor" onSubmit={(event) => {
        event.preventDefault();
        if (!editText.trim() || disabled) return;
        void onMessageOperation?.(message.id, { edit: editText.trim() }).then(() => setEditing(false)).catch(() => {});
      }}>
        <textarea aria-label={message.role === "user" ? "编辑提问内容" : "编辑回复内容"} value={editText} onChange={(event) => setEditText(event.target.value)} rows={5} autoFocus disabled={disabled}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setEditing(false); } }} />
        <div><button type="button" disabled={disabled} onClick={() => setEditing(false)}>取消</button>
          <button type="submit" disabled={disabled || !editText.trim()}>{message.role === "user" ? "保存并重新发送" : "保存修改"}</button></div>
      </form> : parsed.answer ? <div className="dashboard-markdown-body">
        {isStreamingAnswer ? (
          <div className="saki-stream-raw-wrap">
            <span className="saki-stream-raw">{parsed.answer}</span>
            <span className="dashboard-streaming-cursor" />
          </div>
        ) : (
          <MarkdownContent content={parsed.answer} />
        )}
      </div>
        : isStreamingActive && !parsed.thinking && !message.actions?.length && !message.workflowMessage ? <div className="dashboard-streaming-placeholder">
          <span className="dashboard-streaming-pulse-dot" /><span>Saki 正在规划与执行...</span>
        </div> : null}
      {isStreamingActive && message.workflowMessage ? <div className="dashboard-streaming-placeholder" role="status">
        <span className="dashboard-streaming-pulse-dot" /><span>{message.workflowMessage}</span>
      </div> : null}
    </div>
    {onMessageOperation && !message.isStreaming ? <div className="dashboard-message-actions">
      <button type="button" aria-label={message.role === "user" ? "复制提问内容" : "复制回复"} title="复制" disabled={!parsed.answer.trim()}
        onClick={() => operate("copy")}>{copiedMessageId === message.id ? <Check size={13} className="is-copied" /> : <Copy size={13} />}<span>{copiedMessageId === message.id ? "已复制" : "复制"}</span></button>
      <button type="button" aria-label={message.role === "user" ? "编辑提问" : "编辑回复"} title="编辑" disabled={disabled}
        onClick={() => { setMenuOpen(false); setEditText(parsed.answer); setEditing(true); }}><Pencil size={13} /><span>编辑</span></button>
      <div ref={menuRef}><button type="button" aria-label={message.role === "user" ? "提问的更多操作" : "回复的更多操作"} aria-expanded={menuOpen} disabled={disabled}
        onClick={() => setMenuOpen((current) => !current)}><MoreHorizontal size={15} /></button>
        {menuOpen ? <DashboardPopover anchorRef={menuRef} onClose={() => setMenuOpen(false)} width={250} className="dashboard-message-menu">
          <button type="button" className="dashboard-dropdown-item" disabled={disabled || !canRollbackCode} title="撤回这轮及之后的代码更改，保留对话记录" onClick={() => operate("rollback_files")}>
            <CornerUpLeft size={14} /><span>撤回代码更改</span><small>保留对话</small></button>
          <button type="button" className="dashboard-dropdown-item" disabled={disabled} title="撤回这轮及之后的修改，并将提问放回输入框" onClick={() => operate("undo")}>
            <CornerUpLeft size={14} /><span>撤回到此处</span><small>Undo to this point</small></button>
          <button type="button" className="dashboard-dropdown-item is-danger" disabled={disabled} title="删除这轮对话记录，保留文件改动" onClick={() => operate("delete")}>
            <Trash2 size={14} /><span>删除这轮对话</span></button>
        </DashboardPopover> : null}
      </div>
    </div> : null}
  </article>;
}

export function DashboardToolDetails({ messageId, action, busyId, onDecide, onClose, token, instance, terminals, workspaceInstances,
  activeTerminalId, onSelectTerminal, onCreateTerminal, canCreateTerminal, terminalBusy,
  changesSummary, revertingChanges, onRevertAllChanges, onRestoreAllChanges, activeTab, onSelectTab }: {
  messageId?: string | undefined; action?: SakiAgentAction | undefined; busyId: string | null; onDecide: DecideAction; onClose: () => void;
  token: string; instance: ManagedInstance | null; terminals: DashboardTerminalSession[]; activeTerminalId: string | null;
  workspaceInstances?: ManagedInstance[] | undefined;
  onSelectTerminal: (id: string | null) => void; onCreateTerminal: () => void; canCreateTerminal: boolean; terminalBusy: boolean;
  changesSummary?: InstanceGitChangesSummary | null | undefined;
  revertingChanges?: boolean | undefined;
  onRevertAllChanges?: (() => Promise<void>) | undefined;
  onRestoreAllChanges?: (() => Promise<void>) | undefined;
  activeTab?: "action" | "terminal" | "changes" | undefined;
  onSelectTab?: ((tab: "action" | "terminal" | "changes") => void) | undefined;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [isTheater, setIsTheater] = useState(false);
  const onTerminalStatus = useCallback(() => {}, []);
  const isChanges = activeTab === "changes";
  const terminal = !isChanges ? terminals.find((item) => `${item.instanceId}:${item.shellId}` === activeTerminalId) : undefined;
  const terminalInstance = workspaceInstances?.find(item => item.id === terminal?.instanceId) ?? (instance?.id === terminal?.instanceId ? instance : null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [narrow, isTheater]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest(".terminal-panel")) return;
      if (event.key === "Escape" && !document.querySelector("[data-dashboard-popover]")) {
        if (isTheater) {
          event.stopPropagation();
          setIsTheater(false);
          return;
        }
        onClose();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, isTheater]);

  const hasTabs = Boolean((terminals && terminals.length > 0) || (changesSummary && (changesSummary.filesCount > 0 || changesSummary.canRestore)) || action);

  const panel = <aside id="dashboard-tool-details" ref={panelRef}
    className={`dashboard-tool-details${isTheater ? " is-theater-mode" : ""}${narrow ? " is-overlay" : ""}${isChanges ? " is-code-changes" : ""}`}
    aria-label={isChanges ? "代码更改详情" : "工具调用详情"}
    role={narrow || isTheater ? "dialog" : "region"} aria-modal={narrow || isTheater ? true : undefined}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !(event.target instanceof Element && event.target.closest(".terminal-panel"))) {
        if (isTheater) {
          event.stopPropagation();
          setIsTheater(false);
          return;
        }
        event.stopPropagation();
        onClose();
      }
      if ((!narrow && !isTheater) || event.key !== "Tab") return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? [])
        .filter((item) => item.getClientRects().length);
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="dashboard-tool-details-header">
      <div className="dashboard-tool-details-header-main">
        {hasTabs ? (
          <div className="dashboard-terminal-tabs-unified" role="tablist" aria-label="右侧详情与终端">
            {changesSummary && (changesSummary.filesCount > 0 || changesSummary.canRestore) ? (
              <button
                type="button"
                role="tab"
                className="dashboard-tab-chip"
                aria-selected={isChanges}
                onClick={() => { onSelectTerminal(null); onSelectTab?.("changes"); }}
              >
                <FileDiff size={12} />
                <span>代码更改</span>
                {changesSummary.filesCount > 0 ? (
                  <span className="dashboard-tab-chip-count">{changesSummary.filesCount}</span>
                ) : null}
              </button>
            ) : null}
            {action ? (
              <button
                type="button"
                role="tab"
                className="dashboard-tab-chip"
                aria-selected={!terminal && !isChanges}
                onClick={() => { onSelectTerminal(null); onSelectTab?.("action"); }}
              >
                <span>调用详情</span>
              </button>
            ) : null}
            {terminals.map((item) => (
              <button
                type="button"
                key={`${item.instanceId}:${item.shellId}`}
                role="tab"
                className="dashboard-tab-chip"
                aria-selected={!isChanges && terminal?.shellId === item.shellId && terminal?.instanceId === item.instanceId}
                onClick={() => { onSelectTerminal(`${item.instanceId}:${item.shellId}`); onSelectTab?.("terminal"); }}
              >
                <Terminal size={12} />
                <span>{workspaceInstances && workspaceInstances.length > 1 ? `${workspaceInstances.find(instance => instance.id === item.instanceId)?.name ?? item.instanceId} · ` : ""}{item.label || `终端 ${item.shellId.slice(0, 6)}`}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-tool-details-header-title">
            <span>{isChanges ? "代码更改详情" : "工具调用详情"}</span>
            <strong>{isChanges ? (changesSummary && changesSummary.filesCount > 0 ? `${changesSummary.filesCount} 个文件已更改` : "代码更改") : terminal ? terminal.label || "终端" : action ? sakiActionTitle(action) : "详情"}</strong>
          </div>
        )}
      </div>
      <div className="dashboard-tool-panel-actions">
        {isChanges ? (
          <button
            type="button"
            className={`dashboard-icon-btn${isTheater ? " is-active" : ""}`}
            aria-label={isTheater ? "退出全屏模式" : "全屏沉浸对比"}
            title={isTheater ? "退出全屏 (Esc)" : "全屏沉浸对比模式"}
            onClick={() => setIsTheater((v) => !v)}
          >
            {isTheater ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        ) : null}
        {canCreateTerminal && !isChanges ? (
          <button
            type="button"
            className="dashboard-icon-btn"
            aria-label="新建终端"
            title={canCreateTerminal ? "在当前项目新建终端" : "新建终端需要已选择项目及超级管理员终端权限"}
            disabled={!canCreateTerminal || terminalBusy}
            onClick={onCreateTerminal}
          >
            <Plus size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className="dashboard-icon-btn"
          aria-label="关闭工具详情"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
    </header>
    {isChanges ? <div className="dashboard-tool-details-body" style={{ padding: 0 }}>
      <SakiCodeChangesDetails variant="drawer" summary={changesSummary ?? null} loading={Boolean(revertingChanges)} reverting={Boolean(revertingChanges)}
        onRevertAll={onRevertAllChanges ?? (async () => {})} onRestoreAll={onRestoreAllChanges ?? (async () => {})} onClose={onClose} />
    </div> : terminal && terminalInstance ? <div className="dashboard-terminal-panel">
      {action && dashboardActionTerminal(action, terminalInstance.id)?.shellId === terminal.shellId ? <details className="dashboard-terminal-call-output" open>
        <summary>本次调用输出</summary><pre>{action.observation || "（无输出）"}</pre></details> : null}
      <React.Suspense fallback={<p>正在连接终端…</p>}><DashboardWebTerminal key={`${terminalInstance.id}:${terminal.shellId}`} token={token} instance={terminalInstance} shellSessionId={terminal.shellId} onStatus={onTerminalStatus} /></React.Suspense>
    </div> : <div className="dashboard-tool-details-body">
      {action && messageId ? <><ActionControls action={action} messageId={messageId} busyId={busyId} onDecide={onDecide} expanded />
        <details className="dashboard-tool-raw"><summary>调用参数</summary><pre>{JSON.stringify(action.args, null, 2)}</pre></details>
        <details className="dashboard-tool-raw"><summary>完整输出</summary><pre>{action.observation || "（无输出）"}</pre></details></>
        : <p>选择工具调用查看详情，或新建终端。</p>}
    </div>}
  </aside>;

  if (isTheater) {
    return createPortal(
      <>
        <div className="dashboard-theater-backdrop" onClick={() => setIsTheater(false)} />
        {panel}
      </>,
      document.body
    );
  }

  return narrow ? createPortal(<><div className="dashboard-tool-details-backdrop" onClick={onClose} />{panel}</>, document.body) : (
    <>
      {isChanges ? <div className="dashboard-drawer-backdrop" onClick={onClose} /> : null}
      {panel}
    </>
  );
}
