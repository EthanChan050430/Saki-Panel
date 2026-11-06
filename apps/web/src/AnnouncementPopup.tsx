import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { AnnouncementItem } from "./api.js";
import { AnnouncementContent } from "./AnnouncementContent.js";
import { AccountAvatar } from "./components/common/AccountAvatar.js";
import { usePanelLanguage } from "./i18n/index.js";

interface AnnouncementPopupProps {
  items: AnnouncementItem[];
  loaded: boolean;
  ack: (id: string, input: { popupShown?: boolean; read?: boolean }) => Promise<void>;
}

export function formatAnnouncementTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function AnnouncementPopup({ items, loaded, ack }: AnnouncementPopupProps) {
  const { t, tFormat } = usePanelLanguage();
  const [queue, setQueue] = useState<string[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const acknowledgedId = useRef("");

  useEffect(() => {
    if (!loaded) return;
    const fresh = items.filter((item) => item.popup && !item.popupShownAt && !seen.current.has(item.id));
    if (!fresh.length) return;
    for (const item of fresh) seen.current.add(item.id);
    setQueue((current) => [...current, ...fresh.map((item) => item.id)]);
  }, [items, loaded, ack]);

  const currentId = queue[0];
  const current = currentId ? items.find((item) => item.id === currentId) : undefined;

  useEffect(() => {
    if (current && !current.popupShownAt && acknowledgedId.current !== current.id) {
      acknowledgedId.current = current.id;
      void ack(current.id, { popupShown: true });
    }
  }, [current, ack]);

  useEffect(() => {
    if (currentId && !current) setQueue((list) => list.slice(1));
  }, [currentId, current]);

  const close = () => {
    if (!current) return;
    void ack(current.id, { read: true });
    setQueue((list) => list.slice(1));
  };

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!current) return null;

  return createPortal(
    <div className="announcement-popup-backdrop" role="presentation">
      <div
        className={`announcement-popup is-${current.level}`}
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
      >
        <div className="announcement-popup-header">
          <AccountAvatar
            className="announcement-popup-icon"
            avatarDataUrl={current.createdByAvatarDataUrl}
            displayName={current.createdByName ?? ""}
            username=""
          />
          <div className="announcement-popup-heading">
            <strong>{current.title}</strong>
          </div>
          <button type="button" className="announcement-popup-close" aria-label="关闭" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="announcement-popup-body">
          <AnnouncementContent value={current.body} />
        </div>
        <div className="announcement-popup-footer">
          <span>
            {current.createdByName ? `${tFormat("announcement.publisher", current.createdByName)} · ` : ""}
            {formatAnnouncementTime(current.createdAt)}
          </span>
          {queue.length > 1 ? <span>{tFormat("announcement.next", queue.length - 1)}</span> : null}
          <button type="button" className="announcement-popup-confirm" onClick={close}>
            {queue.length > 1 ? t("announcement.gotItNext") : t("announcement.gotIt")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
