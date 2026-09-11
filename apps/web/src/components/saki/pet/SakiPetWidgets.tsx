import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListMusic, Pause, Play, Plus, Repeat, Repeat1, SkipBack, SkipForward, Trash2, Upload, Volume2, X } from "lucide-react";
import type { SakiPetController, SakiPetNote, SakiPetSticker } from "./sakiPetState.js";
import { weatherGlyph, weatherLabel } from "./sakiPetState.js";
import { formatTrackTime, sakiMusicAccept } from "./sakiPetMusic.js";

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
              <span>{pet.pomodoro.mode === "focus" ? "Focus" : language === "en-US" ? "Break" : language === "ja-JP" ? "休憩" : "休息"}</span>
              <strong>{formatPomodoro(pet.pomodoro.remainingMs)}</strong>
            </div>,
            document.body
          )
        : null}
      {pet.music.playing || pet.music.current
        ? createPortal(<SakiMusicBar pet={pet} isEn={language === "en-US"} />, document.body)
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
          const el = event.currentTarget;
          const ox = event.clientX - note.x;
          const oy = event.clientY - note.y;
          let latest = { x: note.x, y: note.y };
          const move = (ev: PointerEvent) => {
            latest = { x: ev.clientX - ox, y: ev.clientY - oy };
            el.style.transform = `translate(${latest.x - note.x}px, ${latest.y - note.y}px)`;
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            el.style.transform = "";
            if (latest.x !== note.x || latest.y !== note.y) {
              pet.updateNote(note.id, { x: latest.x, y: latest.y });
            }
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
        const el = event.currentTarget;
        const ox = event.clientX - sticker.x;
        const oy = event.clientY - sticker.y;
        let latest = { x: sticker.x, y: sticker.y };
        const move = (ev: PointerEvent) => {
          latest = { x: ev.clientX - ox, y: ev.clientY - oy };
          el.style.transform = `translate(${latest.x - sticker.x}px, ${latest.y - sticker.y}px) scale(${sticker.scale})`;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          el.style.transform = `scale(${sticker.scale})`;
          if (latest.x !== sticker.x || latest.y !== sticker.y) {
            pet.updateSticker(sticker.id, { x: latest.x, y: latest.y });
          }
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
  const isJa = language === "ja-JP";
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
            : pet.widget === "music"
            ? isEn ? "Sing" : "唱歌"
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
      {pet.widget === "music" ? <MusicPanel pet={pet} isEn={isEn} /> : null}
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
  const week = language === "en-US" ? ["S", "M", "T", "W", "T", "F", "S"] : language === "ja-JP" ? ["日", "月", "火", "水", "木", "金", "土"] : ["日", "一", "二", "三", "四", "五", "六"];
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

function MusicPanel({ pet, isEn }: { pet: SakiPetController; isEn: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="saki-pet-widget-body">
      <p className="saki-pet-widget-hint">
        {isEn ? "Upload songs. Saki will sing while they play." : "上传歌曲后，Saki 会边播边唱。"}
      </p>
      <input
        ref={fileRef}
        type="file"
        accept={sakiMusicAccept}
        multiple
        hidden
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) void pet.music.addFiles(files);
          event.target.value = "";
        }}
      />
      <button type="button" className="saki-pet-primary" onClick={() => fileRef.current?.click()}>
        <Upload size={13} />
        {isEn ? "Add songs" : "添加歌曲"}
      </button>
      <ul className="saki-pet-check-list saki-pet-music-list">
        {pet.music.tracks.length === 0 ? <li className="empty">{isEn ? "Playlist is empty." : "播放列表还是空的～"}</li> : null}
        {pet.music.tracks.map((track) => (
          <li key={track.id} className={track.id === pet.music.currentId ? "active" : ""}>
            <button type="button" className="saki-pet-music-name" onClick={() => pet.music.playTrack(track.id)}>
              {track.name}
              <small>{formatTrackTime(track.duration)}</small>
            </button>
            <button type="button" className="saki-pet-music-remove" onClick={() => void pet.music.removeTrack(track.id)} aria-label="删除">
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SakiMusicBar({ pet, isEn }: { pet: SakiPetController; isEn: boolean }) {
  const music = pet.music;
  const title = music.current?.name ?? (isEn ? "No song" : "还没选歌");
  const duration = music.duration || 1;
  return (
    <div className="saki-pet-music-bar" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" onClick={music.playPrev} aria-label={isEn ? "Previous" : "上一首"}>
        <SkipBack size={14} />
      </button>
      <button type="button" className="saki-pet-music-play" onClick={() => void music.togglePlay()} aria-label={music.playing ? "暂停" : "播放"}>
        {music.playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button type="button" onClick={music.playNext} aria-label={isEn ? "Next" : "下一首"}>
        <SkipForward size={14} />
      </button>
      <div className="saki-pet-music-meta">
        <strong title={title}>{title}</strong>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(music.currentTime, duration)}
          onChange={(event) => music.seek(Number(event.target.value))}
        />
        <span>
          {formatTrackTime(music.currentTime)} / {formatTrackTime(music.duration)}
        </span>
      </div>
      <label className="saki-pet-music-vol">
        <Volume2 size={13} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={music.volume}
          onChange={(event) => music.setVolume(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        className={music.loop !== "off" ? "active" : ""}
        onClick={() => music.setLoop(music.loop === "all" ? "one" : music.loop === "one" ? "off" : "all")}
        title={music.loop === "one" ? (isEn ? "Repeat one" : "单曲循环") : music.loop === "all" ? (isEn ? "Repeat all" : "列表循环") : isEn ? "No repeat" : "不循环"}
      >
        {music.loop === "one" ? <Repeat1 size={14} /> : <Repeat size={14} />}
      </button>
      <button type="button" onClick={() => pet.openWidget("music")} aria-label={isEn ? "Playlist" : "播放列表"}>
        <ListMusic size={14} />
      </button>
    </div>
  );
}
