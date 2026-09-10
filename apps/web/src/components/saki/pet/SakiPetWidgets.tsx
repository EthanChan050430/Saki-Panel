import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Trash2, X } from "lucide-react";
import type { SakiPetController, SakiPetNote, SakiPetSticker } from "./sakiPetState.js";
import { weatherGlyph, weatherLabel } from "./sakiPetState.js";

function formatClock(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatPomodoro(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function monthMatrix(ms: number) {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let day = 1; day <= days; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return { year, month, cells, today: d.getDate() };
}

export function SakiPetDesktopBits({
  pet,
  language
}: {
  pet: SakiPetController;
  language?: string | undefined;
}) {
  return (
    <>
      {pet.notes.map((note) => (
        <DesktopNote key={note.id} note={note} pet={pet} />
      ))}
      {pet.stickers.map((sticker) => (
        <DesktopSticker key={sticker.id} sticker={sticker} pet={pet} />
      ))}
      {pet.pomodoro.running
        ? createPortal(
            <div className={`saki-pet-pomo-chip ${pet.pomodoro.mode}`} title="番茄钟">
              <span>{pet.pomodoro.mode === "focus" ? "Focus" : language === "en-US" ? "Break" : "休息"}</span>
              <strong>{formatPomodoro(pet.pomodoro.remainingMs)}</strong>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function DesktopNote({ note, pet }: { note: SakiPetNote; pet: SakiPetController }) {
  return (
    createPortal(
      <div
        className="saki-pet-sticky"
        style={{ left: note.x, top: note.y, background: note.color }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button, textarea")) return;
          const ox = event.clientX - note.x;
          const oy = event.clientY - note.y;
          const move = (ev: PointerEvent) => pet.updateNote(note.id, { x: ev.clientX - ox, y: ev.clientY - oy });
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <button type="button" className="saki-pet-sticky-close" onClick={() => pet.removeNote(note.id)} aria-label="关闭便签">
          <X size={12} />
        </button>
        <textarea
          value={note.text}
          placeholder="写点什么…"
          onChange={(event) => pet.updateNote(note.id, { text: event.target.value })}
        />
      </div>,
      document.body
    )
  );
}

function DesktopSticker({ sticker, pet }: { sticker: SakiPetSticker; pet: SakiPetController }) {
  return createPortal(
    <div
      className="saki-pet-sticker"
      style={{ left: sticker.x, top: sticker.y, transform: `scale(${sticker.scale})` }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        const ox = event.clientX - sticker.x;
        const oy = event.clientY - sticker.y;
        const move = (ev: PointerEvent) => pet.updateSticker(sticker.id, { x: ev.clientX - ox, y: ev.clientY - oy });
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      <img src={sticker.src} alt="" draggable={false} />
      <button type="button" onClick={() => pet.removeSticker(sticker.id)} aria-label="移除贴图">
        <X size={12} />
      </button>
    </div>,
    document.body
  );
}

export function SakiPetWidgetCard({
  pet,
  language,
  edge,
  below,
  foods,
  canAfford,
  onFeed,
  onCaptureSticker
}: {
  pet: SakiPetController;
  language?: string | undefined;
  edge: string;
  below?: boolean;
  foods: Array<{ id: string; name: string; image: string; cost: number; favorability: number; desc: string }>;
  canAfford: (cost: number) => boolean;
  onFeed: (foodId: string) => void;
  onCaptureSticker: () => void;
}) {
  if (!pet.widget) return null;
  const isEn = language === "en-US";
  return (
    <div className={`saki-pet-widget-card edge-${edge} ${below ? "is-below" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <strong>
          {pet.widget === "feed"
            ? isEn ? "Feed Saki" : "喂食"
            : pet.widget === "todo"
            ? isEn ? "Todos" : "待办清单"
            : pet.widget === "schedule"
            ? isEn ? "Reminders" : "日程提醒"
            : pet.widget === "pomodoro"
            ? isEn ? "Pomodoro" : "番茄钟"
            : pet.widget === "notes"
            ? isEn ? "Sticky notes" : "便签"
            : pet.widget === "sticker"
            ? isEn ? "Screenshot stickers" : "截图贴图"
            : pet.widget === "skins"
            ? isEn ? "Outfits" : "换装"
            : isEn ? "Calendar" : "日历"}
        </strong>
        <button type="button" onClick={pet.closeWidget} aria-label="关闭">
          <X size={14} />
        </button>
      </header>
      {pet.widget === "feed" ? (
        <FeedPanel foods={foods} canAfford={canAfford} onFeed={onFeed} isEn={isEn} />
      ) : null}
      {pet.widget === "todo" ? <TodoPanel pet={pet} isEn={isEn} /> : null}
      {pet.widget === "schedule" ? <SchedulePanel pet={pet} isEn={isEn} /> : null}
      {pet.widget === "pomodoro" ? <PomodoroPanel pet={pet} isEn={isEn} /> : null}
      {pet.widget === "notes" ? <NotesPanel pet={pet} isEn={isEn} /> : null}
      {pet.widget === "sticker" ? (
        <div className="saki-pet-widget-body">
          <p className="saki-pet-widget-hint">{isEn ? "Capture the screen, then stick it on the desktop." : "截取画面后贴在桌面上，可拖动。"}</p>
          <button type="button" className="saki-pet-primary" onClick={onCaptureSticker}>
            {isEn ? "Capture sticker" : "截一张贴图"}
          </button>
        </div>
      ) : null}
      {pet.widget === "calendar" ? <CalendarPanel pet={pet} language={language} /> : null}
      {pet.widget === "skins" ? <SkinsPanel pet={pet} isEn={isEn} /> : null}
    </div>
  );
}

function FeedPanel({
  foods,
  canAfford,
  onFeed,
  isEn
}: {
  foods: Array<{ id: string; name: string; image: string; cost: number; favorability: number; desc: string }>;
  canAfford: (cost: number) => boolean;
  onFeed: (foodId: string) => void;
  isEn: boolean;
}) {
  return (
    <div className="saki-pet-feed-list">
      {foods.map((food) => {
        const ok = canAfford(food.cost);
        return (
          <button
            key={food.id}
            type="button"
            className={`saki-pet-feed-item ${ok ? "" : "disabled"}`}
            disabled={!ok}
            onClick={() => onFeed(food.id)}
          >
            <img src={food.image} alt="" />
            <span>
              <b>{food.name}</b>
              <small>{food.desc}</small>
            </span>
            <em>{isEn ? `+${food.favorability}` : `+${food.favorability}`}</em>
          </button>
        );
      })}
    </div>
  );
}

function TodoPanel({ pet, isEn }: { pet: SakiPetController; isEn: boolean }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="saki-pet-widget-body">
      <form
        className="saki-pet-add-row"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          pet.addTodo(text);
          setDraft("");
        }}
      >
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={isEn ? "Add a task" : "添加待办"} />
        <button type="submit" aria-label="添加">
          <Plus size={14} />
        </button>
      </form>
      <ul className="saki-pet-check-list">
        {pet.todos.length === 0 ? <li className="empty">{isEn ? "Nothing yet." : "还没有待办～"}</li> : null}
        {pet.todos.map((item) => (
          <li key={item.id} className={item.done ? "done" : ""}>
            <button type="button" onClick={() => pet.toggleTodo(item.id)} aria-label="完成">
              <Check size={13} />
            </button>
            <span>{item.text}</span>
            <button type="button" onClick={() => pet.removeTodo(item.id)} aria-label="删除">
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SchedulePanel({ pet, isEn }: { pet: SakiPetController; isEn: boolean }) {
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  return (
    <div className="saki-pet-widget-body">
      <form
        className="saki-pet-schedule-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || !at) return;
          pet.addEvent(title.trim(), new Date(at).toISOString());
          setTitle("");
          setAt("");
        }}
      >
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={isEn ? "Reminder" : "提醒内容"} />
        <input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
        <button type="submit">{isEn ? "Add" : "添加"}</button>
      </form>
      <ul className="saki-pet-check-list">
        {pet.events.length === 0 ? <li className="empty">{isEn ? "No reminders." : "暂无日程"}</li> : null}
        {pet.events.map((item) => (
          <li key={item.id}>
            <span>
              <b>{item.title}</b>
              <small>{new Date(item.at).toLocaleString()}</small>
            </span>
            <button type="button" onClick={() => pet.removeEvent(item.id)} aria-label="删除">
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PomodoroPanel({ pet, isEn }: { pet: SakiPetController; isEn: boolean }) {
  return (
    <div className="saki-pet-widget-body saki-pet-pomo">
      <div className="saki-pet-pomo-face">{formatPomodoro(pet.pomodoro.remainingMs)}</div>
      <p>{pet.pomodoro.mode === "focus" ? (isEn ? "Focus 25:00" : "专注 25 分钟") : isEn ? "Short break" : "短休息"}</p>
      <div className="saki-pet-pomo-actions">
        <button type="button" className="saki-pet-primary" onClick={pet.togglePomodoro}>
          {pet.pomodoro.running ? (isEn ? "Pause" : "暂停") : isEn ? "Start" : "开始"}
        </button>
        <button type="button" onClick={() => pet.resetPomodoro(pet.pomodoro.mode)}>
          {isEn ? "Reset" : "重置"}
        </button>
      </div>
    </div>
  );
}

function NotesPanel({ pet, isEn }: { pet: SakiPetController; isEn: boolean }) {
  const colors = ["#ffe8a3", "#ffd0e0", "#d8f5c8", "#d6e8ff", "#f3e0ff"];
  return (
    <div className="saki-pet-widget-body">
      <p className="saki-pet-widget-hint">{isEn ? "Drop a note onto the desktop." : "点颜色，便签会出现在桌面上。"}</p>
      <div className="saki-pet-note-swatches">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            style={{ background: color }}
            onClick={() => pet.addNote("", color, Math.round(window.innerWidth / 2 - 90), 120)}
            aria-label={color}
          />
        ))}
      </div>
    </div>
  );
}

function CalendarPanel({ pet, language }: { pet: SakiPetController; language?: string | undefined }) {
  const { year, month, cells, today } = useMemo(() => monthMatrix(pet.nowMs), [pet.nowMs]);
  const week = language === "en-US" ? ["S", "M", "T", "W", "T", "F", "S"] : ["日", "一", "二", "三", "四", "五", "六"];
  return (
    <div className="saki-pet-widget-body">
      <div className="saki-pet-clock-row">
        <strong>{formatClock(pet.nowMs)}</strong>
        <span>
          {pet.weather ? `${weatherGlyph(pet.weather.code)} ${pet.weather.temp}° ${weatherLabel(pet.weather.code, language)}` : "—"}
        </span>
      </div>
      <div className="saki-pet-cal-title">
        {year} / {month + 1}
      </div>
      <div className="saki-pet-cal-grid">
        {week.map((d, i) => (
          <span key={`${d}-${i}`} className="dow">
            {d}
          </span>
        ))}
        {cells.map((day, i) => (
          <span key={i} className={day === today ? "today" : day ? "" : "blank"}>
            {day ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function SkinsPanel({ isEn }: { pet: SakiPetController; isEn: boolean }) {
  return (
    <div className="saki-pet-widget-body">
      <p className="saki-pet-widget-hint">
        {isEn
          ? "Outfit packs will be added through plugins. This is just the entry for now."
          : "皮肤包将通过插件添加，这里先留一个入口。"}
      </p>
    </div>
  );
}
