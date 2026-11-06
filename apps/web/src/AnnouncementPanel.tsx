import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCheck, ImagePlus, Info, Link, Loader2, Pencil, Pin, Trash2, X } from "lucide-react";
import {
  api,
  ApiError,
  type AnnouncementAudience,
  type AnnouncementAudienceUser,
  type AnnouncementInput,
  type AnnouncementItem,
  type AnnouncementLevel,
  type ManagedAnnouncement
} from "./api.js";
import { formatAnnouncementTime } from "./AnnouncementPopup.js";
import { AnnouncementContent, sanitizeAnnouncementHtml } from "./AnnouncementContent.js";
import { usePanelLanguage } from "./i18n/index.js";

export type AnnouncementFeed = {
  items: AnnouncementItem[];
  unreadCount: number;
  refresh: () => Promise<void> | void;
  ack: (id: string, flags: { popupShown?: boolean; read?: boolean }) => Promise<void> | void;
};

function LevelIcon({ level }: { level: AnnouncementLevel }) {
  return level === "info" ? <Info size={13} /> : <AlertTriangle size={13} />;
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type FormState = {
  id: string | null;
  title: string;
  body: string;
  level: AnnouncementLevel;
  pinned: boolean;
  popup: boolean;
  audience: AnnouncementAudience;
  userIds: string[];
  startsAt: string;
  expiresAt: string;
};

const emptyForm: FormState = {
  id: null,
  title: "",
  body: "",
  level: "info",
  pinned: false,
  popup: false,
  audience: "ALL",
  userIds: [],
  startsAt: "",
  expiresAt: ""
};

function formFromManaged(item: ManagedAnnouncement): FormState {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    level: item.level,
    pinned: item.pinned,
    popup: item.popup,
    audience: item.audience,
    userIds: [...item.userIds],
    startsAt: toLocalInput(item.startsAt),
    expiresAt: toLocalInput(item.expiresAt)
  };
}

function AnnouncementEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = usePanelLanguage();
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== sanitizeAnnouncementHtml(value)) {
      editorRef.current.innerHTML = sanitizeAnnouncementHtml(value);
    }
  }, [value]);

  function insertLink() {
    const url = window.prompt(t("announcement.linkUrl"), "https://");
    if (!url?.trim() || !/^https?:\/\//i.test(url.trim())) return;
    const text = window.prompt(t("announcement.linkText"), url.trim());
    if (!text?.trim() || !editorRef.current) return;
    const link = document.createElement("a");
    link.href = url.trim();
    link.textContent = text.trim();
    editorRef.current.focus();
    document.execCommand("insertHTML", false, link.outerHTML);
    onChange(editorRef.current.innerHTML);
  }

  function insertImage() {
    const url = window.prompt(t("announcement.imageUrl"), "https://");
    if (!url?.trim() || !/^https?:\/\//i.test(url.trim()) || !editorRef.current) return;
    const alt = window.prompt(t("announcement.imageAlt"), "") ?? "";
    const image = document.createElement("img");
    image.src = url.trim();
    image.alt = alt;
    editorRef.current.focus();
    document.execCommand(
      "insertHTML",
      false,
      image.outerHTML
    );
    onChange(editorRef.current.innerHTML);
  }

  return (
    <div className="announcement-editor-wrap">
      <div className="announcement-editor-tools">
        <button type="button" onClick={insertImage} title={t("announcement.insertImage")}>
          <ImagePlus size={13} />
          {t("announcement.insertImage")}
        </button>
        <button type="button" onClick={insertLink} title={t("announcement.insertLink")}>
          <Link size={13} />
          {t("announcement.insertLink")}
        </button>
      </div>
      <div
        ref={editorRef}
        className="announcement-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={t("announcement.editorPlaceholder")}
        dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementHtml(value) }}
        onInput={(event) => {
          const editor = event.currentTarget;
          const html = editor.innerHTML;
          const hasRichMarkup = /<(?!\/?(?:div|br)\b)[a-z][\s\S]*?>/i.test(html);
          onChange(hasRichMarkup ? html : editor.innerText.replace(/\u00a0/g, " "));
        }}
        onPaste={(event) => {
          const html = event.clipboardData.getData("text/html");
          if (!html) return;
          event.preventDefault();
          const sanitized = sanitizeAnnouncementHtml(html);
          document.execCommand("insertHTML", false, sanitized);
        }}
      />
    </div>
  );
}

export function AnnouncementPanel({
  token,
  isAdmin,
  feed,
  onAuthError,
  manageRequested,
  onManagingChange,
  onManageRequestHandled,
  managementAction,
  onManagementActionHandled
}: {
  token: string;
  isAdmin: boolean;
  feed: AnnouncementFeed;
  onAuthError: () => void;
  manageRequested?: boolean;
  onManagingChange?: (managing: boolean) => void;
  onManageRequestHandled?: () => void;
  managementAction?: "new" | "back";
  onManagementActionHandled?: () => void;
}) {
  const { t, tFormat } = usePanelLanguage();
  const { items, unreadCount, refresh, ack } = feed;
  const [managing, setManaging] = useState(false);
  const [managed, setManaged] = useState<ManagedAnnouncement[] | null>(null);
  const [users, setUsers] = useState<AnnouncementAudienceUser[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<AnnouncementItem | null>(null);

  useEffect(() => {
    onManagingChange?.(managing);
  }, [managing, onManagingChange]);

  useEffect(() => {
    if (!manageRequested || !isAdmin) return;
    setManaging(true);
    onManageRequestHandled?.();
  }, [manageRequested, isAdmin, onManageRequestHandled]);

  useEffect(() => {
    if (!managementAction || !isAdmin) return;
    if (managementAction === "new") {
      setForm({ ...emptyForm });
      setUserQuery("");
    } else {
      setForm(null);
      setManaging(false);
    }
    onManagementActionHandled?.();
  }, [managementAction, isAdmin, onManagementActionHandled]);

  useEffect(() => {
    if (!selectedItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedItem(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem]);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        onAuthError();
        return;
      }
      setError(err instanceof Error ? err.message : t("announcement.operationFailed"));
    },
    [onAuthError]
  );

  const loadManaged = useCallback(async () => {
    try {
      setManaged(await api.manageAnnouncements(token));
    } catch (err) {
      fail(err);
    }
  }, [token, fail]);

  useEffect(() => {
    if (managing && isAdmin) void loadManaged();
  }, [managing, isAdmin, loadManaged]);

  useEffect(() => {
    if (!form || form.audience !== "USERS" || users.length > 0) return;
    let cancelled = false;
    api
      .announcementAudienceUsers(token)
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [form, users.length, token, fail]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q) || (u.displayName ?? "").toLowerCase().includes(q));
  }, [users, userQuery]);

  async function markAllRead() {
    const unread = items.filter((item) => !item.readAt);
    await Promise.all(unread.map((item) => ack(item.id, { read: true })));
  }

  function toggleUser(id: string) {
    setForm((prev) =>
      prev
        ? { ...prev, userIds: prev.userIds.includes(id) ? prev.userIds.filter((x) => x !== id) : [...prev.userIds, id] }
        : prev
    );
  }

  function selectFiltered(select: boolean) {
    setForm((prev) => {
      if (!prev) return prev;
      const ids = new Set(prev.userIds);
      for (const u of filteredUsers) {
        if (select) ids.add(u.id);
        else ids.delete(u.id);
      }
      return { ...prev, userIds: [...ids] };
    });
  }

  async function save() {
    if (!form) return;
    if (!form.title.trim() || !form.body.trim()) {
      setError(t("announcement.titleBodyRequired"));
      return;
    }
    if (form.audience === "USERS" && form.userIds.length === 0) {
      setError(t("announcement.userRequired"));
      return;
    }
    const input: AnnouncementInput = {
      title: form.title.trim(),
      body: form.body.trim(),
      level: form.level,
      pinned: form.pinned,
      popup: form.popup,
      audience: form.audience,
      userIds: form.audience === "USERS" ? form.userIds : [],
      startsAt: fromLocalInput(form.startsAt),
      expiresAt: fromLocalInput(form.expiresAt)
    };
    setBusy(true);
    setError(null);
    try {
      if (form.id) await api.updateAnnouncement(token, form.id, input);
      else await api.createAnnouncement(token, input);
      setForm(null);
      await Promise.all([loadManaged(), refresh()]);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: ManagedAnnouncement) {
    if (!window.confirm(tFormat("announcement.confirmDelete", item.title))) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAnnouncement(token, item.id);
      await Promise.all([loadManaged(), refresh()]);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const errorNode = error ? (
    <div className="incident-popover-error" role="alert">
      <AlertTriangle size={13} />
      <span>{error}</span>
      <button type="button" className="incident-popover-notice-close" onClick={() => setError(null)} aria-label="关闭">
        <X size={12} />
      </button>
    </div>
  ) : null;

  if (managing && isAdmin) {
    if (form) {
      return (
        <div className="announcement-panel">
          {errorNode}
          <div className="announcement-form">
            <label className="announcement-field">
              <span>{t("announcement.title")}</span>
              <input
                value={form.title}
                maxLength={100}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t("announcement.titlePlaceholder")}
              />
            </label>
            <div className="announcement-field">
              <span>{t("announcement.body")}</span>
              <AnnouncementEditor value={form.body} onChange={(body) => setForm({ ...form, body })} />
              <small className="announcement-field-hint">{t("announcement.editorHint")}</small>
            </div>
            <label className="announcement-field">
                <span>{t("announcement.level.info")}</span>
                <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as AnnouncementLevel })}>
                  <option value="info">{t("announcement.level.info")}</option>
                  <option value="warning">{t("announcement.level.warning")}</option>
                  <option value="critical">{t("announcement.level.critical")}</option>
                </select>
              </label>
            <div className="announcement-check-row">
              <label className="announcement-check">
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
                <span>{t("announcement.pinned")}</span>
              </label>
              <label className="announcement-check">
                <input type="checkbox" checked={form.popup} onChange={(e) => setForm({ ...form, popup: e.target.checked })} />
                <span>{t("announcement.popup")}</span>
              </label>
            </div>
            <div className="announcement-field-row">
              <label className="announcement-field">
                <span>{t("announcement.startsAt")}</span>
                <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
              </label>
              <label className="announcement-field">
                <span>{t("announcement.expiresAt")}</span>
                <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              </label>
            </div>
            <div className="announcement-field">
              <span>{t("announcement.audience")}</span>
              <div className="announcement-audience-switch">
                <button
                  type="button"
                  className={form.audience === "ALL" ? "is-active" : ""}
                  onClick={() => setForm({ ...form, audience: "ALL" })}
                >
                  {t("announcement.allUsers")}
                </button>
                <button
                  type="button"
                  className={form.audience === "USERS" ? "is-active" : ""}
                  onClick={() => setForm({ ...form, audience: "USERS" })}
                >
                  {t("announcement.specificUsers")}
                </button>
              </div>
            </div>
            {form.audience === "USERS" ? (
              <div className="announcement-user-picker">
                <div className="announcement-user-picker-bar">
                  <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder={t("announcement.searchUsers")} />
                  <button type="button" className="announcement-link-btn" onClick={() => selectFiltered(true)}>
                    {t("announcement.selectAll")}
                  </button>
                  <button type="button" className="announcement-link-btn" onClick={() => selectFiltered(false)}>
                    {t("announcement.clear")}
                  </button>
                </div>
                <div className="announcement-user-picker-count">{tFormat("announcement.selectedUsers", form.userIds.length)}</div>
                <ul className="announcement-user-list">
                  {filteredUsers.map((u) => (
                    <li key={u.id}>
                      <label>
                        <input type="checkbox" checked={form.userIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
                        <span>{u.displayName || u.username}</span>
                        {u.displayName ? <em>@{u.username}</em> : null}
                      </label>
                    </li>
                  ))}
                  {filteredUsers.length === 0 ? <li className="announcement-empty-line">{t("announcement.noMatchingUsers")}</li> : null}
                </ul>
              </div>
            ) : null}
            <div className="announcement-form-actions">
              <button type="button" className="announcement-btn" disabled={busy} onClick={() => setForm(null)}>
                {t("announcement.cancel")}
              </button>
              <button type="button" className="announcement-btn is-primary" disabled={busy} onClick={() => void save()}>
                {busy ? <Loader2 size={12} className="status-spinner" /> : <Check size={12} />}
                {form.id ? t("announcement.save") : t("announcement.publish")}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="announcement-panel">
        {errorNode}
        {managed === null ? (
          <div className="announcement-empty-line">
            <Loader2 size={13} className="status-spinner" /> {t("announcement.loading")}
          </div>
        ) : managed.length === 0 ? (
          <div className="announcement-empty-line">{t("announcement.empty")}</div>
        ) : (
          <ul className="announcement-list">
            {managed.map((item) => (
              <li key={item.id} className={`announcement-item is-manage is-${item.level}`}>
                <div className="announcement-item-head">
                  <span className={`announcement-level is-${item.level}`}>
                    <LevelIcon level={item.level} />
                    {t(`announcement.level.${item.level}` as "announcement.level.info" | "announcement.level.warning" | "announcement.level.critical")}
                  </span>
                  {item.pinned ? <Pin size={12} className="announcement-pin" /> : null}
                  <strong>{item.title}</strong>
                </div>
                <div className="announcement-meta">
                  {item.audience === "ALL" ? t("announcement.allUsers") : tFormat("announcement.specificUsersMeta", item.userIds.length)}
                  {item.popup ? ` · ${tFormat("announcement.popupShownMeta", item.popupShownCount)}` : ""}
                  {` · ${tFormat("announcement.readMeta", item.readCount)}`}
                  {item.expiresAt ? ` · ${tFormat("announcement.expiredMeta", formatAnnouncementTime(item.expiresAt))}` : ""}
                  {` · ${item.createdByName}`}
                </div>
                <div className="announcement-item-actions">
                  <button
                    type="button"
                    className="announcement-btn"
                    disabled={busy}
                    onClick={() => {
                      setForm(formFromManaged(item));
                      setUserQuery("");
                    }}
                  >
                    <Pencil size={12} />
                    {t("announcement.edit")}
                  </button>
                  <button type="button" className="announcement-btn is-danger" disabled={busy} onClick={() => void remove(item)}>
                    <Trash2 size={12} />
                    {t("announcement.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="announcement-panel">
      {errorNode}
      {unreadCount > 0 ? (
        <div className="announcement-toolbar">
          <button type="button" className="announcement-btn" onClick={() => void markAllRead()}>
            <CheckCheck size={12} />
            {t("announcement.markAllRead")}
          </button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="announcement-empty-line">{t("announcement.empty")}</div>
      ) : (
        <ul className="announcement-list">
          {items.map((item) => {
            return (
              <li key={item.id} className={`announcement-item is-${item.level} ${item.readAt ? "" : "is-unread"}`}>
                <button
                  type="button"
                  className="announcement-item-main"
                  onClick={() => {
                    setSelectedItem(item);
                    if (!item.readAt) void ack(item.id, { read: true });
                  }}
                >
                  <div className="announcement-item-head">
                    <span className={`announcement-level is-${item.level}`}>
                      <LevelIcon level={item.level} />
                      {t(`announcement.level.${item.level}` as "announcement.level.info" | "announcement.level.warning" | "announcement.level.critical")}
                    </span>
                    {item.pinned ? <Pin size={12} className="announcement-pin" /> : null}
                    <strong>{item.title}</strong>
                    {!item.readAt ? <span className="announcement-unread-dot" aria-label="未读" /> : null}
                  </div>
                  <div className="announcement-meta">
                    {item.createdByName ? `${tFormat("announcement.publisher", item.createdByName)} · ` : ""}
                    {formatAnnouncementTime(item.createdAt)}
                  </div>
                  <div className="announcement-body">
                    <AnnouncementContent value={item.body} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selectedItem
        ? createPortal(
            <div className="announcement-detail-backdrop" role="presentation" onMouseDown={() => setSelectedItem(null)}>
              <article
                className={`announcement-detail-modal is-${selectedItem.level}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`announcement-detail-title-${selectedItem.id}`}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="announcement-detail-header">
                  <div className="announcement-detail-heading">
                    <div className="announcement-item-head">
                      <span className={`announcement-level is-${selectedItem.level}`}>
                        <LevelIcon level={selectedItem.level} />
                        {t(`announcement.level.${selectedItem.level}` as "announcement.level.info" | "announcement.level.warning" | "announcement.level.critical")}
                      </span>
                      {selectedItem.pinned ? <Pin size={12} className="announcement-pin" /> : null}
                    </div>
                    <h2 id={`announcement-detail-title-${selectedItem.id}`}>{selectedItem.title}</h2>
                    <div className="announcement-meta">
                      {selectedItem.createdByName ? `${tFormat("announcement.publisher", selectedItem.createdByName)} · ` : ""}
                      {formatAnnouncementTime(selectedItem.createdAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="announcement-detail-close"
                    aria-label={t("announcement.closeDetails")}
                    onClick={() => setSelectedItem(null)}
                  >
                    <X size={17} />
                  </button>
                </header>
                <div className="announcement-detail-content">
                  <AnnouncementContent value={selectedItem.body} />
                </div>
              </article>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
