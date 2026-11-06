import React, { useRef, useState } from "react";
import { ArrowDown, ArrowUp, CornerUpLeft, GripVertical, Loader2, MoreHorizontal, Paperclip, Pencil, Trash2, X } from "lucide-react";
import type { SakiQueuedFollowUp } from "@webops/shared";
import { DashboardPopover } from "../../dashboard/DashboardPopover.js";

export function SakiFollowUpQueue({ items, busy, running, error, onChange, onWithdraw }: {
  items: SakiQueuedFollowUp[]; busy: boolean; running: boolean; error?: string;
  onChange: (action: string, id?: string, message?: string, ids?: string[]) => Promise<unknown>;
  onWithdraw: (id?: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");
  const [menu, setMenu] = useState<{ id: string | null } | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const act = async (work: () => Promise<unknown>) => {
    try { await work(); setLocalError(""); }
    catch (error) { setLocalError(error instanceof Error ? error.message : "操作未完成，消息已保留。"); }
  };
  const move = (id: string, target: string) => {
    const ids = items.map(item => item.id);
    const from = ids.indexOf(id), to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1); ids.splice(to, 0, id);
    void act(() => onChange("reorder", undefined, undefined, ids));
  };
  const openMenu = (anchor: HTMLElement, id: string | null) => {
    menuAnchor.current = anchor;
    setMenu(current => current?.id === id ? null : { id });
  };
  const menuAction = (work: () => Promise<unknown>) => { setMenu(null); void act(work); };
  if (!items.length && !error && !localError) return null;
  const locked = busy || items.some(item => item.status === "sending");
  const menuIndex = menu?.id ? items.findIndex(item => item.id === menu.id) : -1;
  return <section className="saki-followup-panel" aria-label="后续消息队列">
    {items.length ? <>
      <header><span className="saki-followup-heading">排队 <span>{items.length}</span></span><div>
        {items.some(item => item.status === "paused") ? <button type="button" className="saki-followup-resume" disabled={locked || items.some(item => item.editing)} onClick={() => void act(() => onChange("resume_all"))}>继续队列</button> : null}
        <button type="button" className="saki-followup-icon" disabled={locked} aria-label="队列更多操作" aria-haspopup="menu" aria-expanded={menu?.id === null}
          onClick={event => openMenu(event.currentTarget, null)}><MoreHorizontal size={16} /></button>
      </div></header>
      <ol>{items.map((item, index) => <li key={item.id} data-queue-id={item.id} data-dragging={dragged === item.id || undefined}
        onDragOver={event => { if (dragged && !locked) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragged && !locked) move(dragged, item.id); setDragged(null); }}>
        <div className="saki-followup-row">
          <button type="button" className="saki-followup-icon saki-followup-drag" draggable={!locked && editing !== item.id} disabled={locked || editing === item.id}
            title="拖动排序" aria-label={`拖动排序第 ${index + 1} 条消息`}
            onDragStart={event => { setDragged(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-saki-follow-up", item.id); }}
            onDragEnd={() => setDragged(null)}><GripVertical size={14} /></button>
          <div className="saki-followup-content">
            {editing === item.id ? <div className="saki-followup-editor">
              <textarea aria-label="编辑排队消息" value={text} onChange={event => setText(event.target.value)} autoFocus disabled={busy} />
              <div><button type="button" className="saki-followup-save" onClick={() => void act(async () => { await onChange("edit", item.id, text); setEditing(null); })} disabled={busy || !text.trim()}>保存</button>
                <button type="button" onClick={() => void act(async () => { await onChange("release", item.id); setEditing(null); })} disabled={busy}>取消</button></div>
            </div> : <details className="saki-followup-message"><summary title={item.input.message}>{item.input.message}</summary></details>}
            {editing !== item.id && item.status === "paused" ? <small className="saki-followup-status" title={item.reason}>{item.reason || "已暂停"}</small> : null}
          </div>
          {editing !== item.id ? <div className="saki-followup-actions">
            {item.input.attachments?.length ? <span className="saki-followup-attachment" title={item.input.attachments.map(attachment => attachment.name).join("、")} aria-label={`${item.input.attachments.length} 个附件`}><Paperclip size={12} />{item.input.attachments.length}</span> : null}
            {item.status === "sending" ? <Loader2 size={14} className="status-spinner" aria-label="正在提交" /> : <button type="button" className="saki-followup-guide" disabled={locked}
              onClick={() => void act(() => onChange(running ? "steer" : "resume", item.id))}>{running ? "引导" : "发送"}</button>}
            <button type="button" className="saki-followup-icon" disabled={locked} title="编辑" aria-label={`编辑第 ${index + 1} 条排队消息`}
              onClick={() => void act(async () => { await onChange("hold", item.id); setEditing(item.id); setText(item.input.message); })}><Pencil size={13} /></button>
            <button type="button" className="saki-followup-icon" disabled={locked} title="更多操作" aria-label={`第 ${index + 1} 条消息更多操作`} aria-haspopup="menu" aria-expanded={menu?.id === item.id}
              onClick={event => openMenu(event.currentTarget, item.id)}><MoreHorizontal size={15} /></button>
            <button type="button" className="saki-followup-icon" disabled={locked} title="取消排队" aria-label={`取消第 ${index + 1} 条消息排队`}
              onClick={() => void act(() => onChange("remove", item.id))}><X size={14} /></button>
          </div> : null}
        </div>
      </li>)}</ol>
    </> : null}
    {error || localError ? <p className="saki-followup-error" role="alert">{error || localError}</p> : null}
    {menu && (menu.id === null || menuIndex >= 0) ? <DashboardPopover anchorRef={menuAnchor} onClose={() => setMenu(null)} width={176} className="saki-followup-menu">
      <div role="menu" aria-label={menu.id === null ? "队列操作" : "排队消息操作"}>
        {menu.id === null ? <>
          <button type="button" role="menuitem" disabled={locked} onClick={() => menuAction(() => onWithdraw())}><Pencil size={13} />编辑全部</button>
          <button type="button" role="menuitem" disabled={locked} onClick={() => menuAction(() => onChange("clear"))}><Trash2 size={13} />清空队列</button>
        </> : <>
          <button type="button" role="menuitem" disabled={locked} onClick={() => menuAction(() => onWithdraw(menu.id!))}><CornerUpLeft size={13} />撤回到输入框</button>
          <button type="button" role="menuitem" disabled={locked || menuIndex === 0} onClick={() => { move(menu.id!, items[menuIndex - 1]!.id); setMenu(null); }}><ArrowUp size={13} />上移</button>
          <button type="button" role="menuitem" disabled={locked || menuIndex === items.length - 1} onClick={() => { move(menu.id!, items[menuIndex + 1]!.id); setMenu(null); }}><ArrowDown size={13} />下移</button>
        </>}
      </div>
    </DashboardPopover> : null}
  </section>;
}
