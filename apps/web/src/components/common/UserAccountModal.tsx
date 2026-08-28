import React, { useEffect, useRef, useState } from "react";
import { Camera, LogOut, Save, Trash2, Upload, X } from "lucide-react";
import type { CurrentUser, UpdateCurrentUserRequest } from "@webops/shared";
import { api, ApiError } from "../../api.js";
import { usePanelT } from "../../i18n/index.js";
import { AccountAvatar, avatarFileToDataUrl } from "./AccountAvatar.js";

export function UserAccountModal({
  token,
  user,
  open,
  onClose,
  onLogout,
  onUserChange
}: {
  token: string;
  user: CurrentUser;
  open: boolean;
  onClose: () => void;
  onLogout: (options?: { manual?: boolean }) => void;
  onUserChange: (user: CurrentUser) => void;
}) {
  const t = usePanelT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(user.avatarDataUrl ?? null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    setDisplayName(user.displayName);
    setAvatarDataUrl(user.avatarDataUrl ?? null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setNotice("");
  }, [open, user.avatarDataUrl, user.displayName]);

  if (!open) return null;

  async function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.item(0);
    event.target.value = "";
    if (!file) return;

    setError("");
    setNotice("");
    try {
      setAvatarDataUrl(await avatarFileToDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("account.errorAvatarRead"));
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      setError(t("account.errorDisplayNameRequired"));
      return;
    }
    if (newPassword || currentPassword || confirmPassword) {
      if (newPassword.length < 8) {
        setError(t("account.errorNewPasswordLength"));
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(t("account.errorPasswordMismatch"));
        return;
      }
      if (!currentPassword) {
        setError(t("account.errorCurrentPasswordRequired"));
        return;
      }
    }

    const payload: UpdateCurrentUserRequest = {};
    if (trimmedDisplayName !== user.displayName) {
      payload.displayName = trimmedDisplayName;
    }
    if ((avatarDataUrl ?? null) !== (user.avatarDataUrl ?? null)) {
      payload.avatarDataUrl = avatarDataUrl;
    }
    if (newPassword) {
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    }

    if (Object.keys(payload).length === 0) {
      setNotice(t("account.noticeSynced"));
      setError("");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextUser = await api.updateProfile(token, payload);
      onUserChange(nextUser);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(t("account.noticeSaved"));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("account.errorCurrentPasswordWrong") : err instanceof Error ? err.message : t("account.errorSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="account-modal" role="dialog" aria-modal="true" aria-label={t("account.dialog")}>
        <div className="account-modal-hero">
          <button
            className="account-avatar-button"
            type="button"
            title={t("account.uploadAvatar")}
            onClick={() => fileInputRef.current?.click()}
          >
            <AccountAvatar
              avatarDataUrl={avatarDataUrl}
              displayName={displayName}
              username={user.username}
              className="large"
            />
            <span className="account-avatar-action">
              <Camera size={15} />
            </span>
          </button>
          <div className="account-modal-title">
            <h2>{displayName.trim() || user.username}</h2>
            <span>@{user.username}</span>
          </div>
          <div className="account-modal-tools">
            <span className="account-rank">{user.isSuperAdmin ? "SUPER" : "ACTIVE"}</span>
            <button className="icon-button mini" title={t("common.close")} type="button" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        <form className="account-modal-body" onSubmit={(event) => void saveProfile(event)}>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAvatar(event)}
          />

          <div className="account-avatar-stage">
            <AccountAvatar
              avatarDataUrl={avatarDataUrl}
              displayName={displayName}
              username={user.username}
              className="preview"
            />
            <div className="account-upload-actions">
              <button className="icon-button mini" type="button" title={t("account.uploadAvatar")} aria-label={t("account.uploadAvatar")} onClick={() => fileInputRef.current?.click()}>
                <Upload size={15} />
              </button>
              <button className="icon-button mini danger-action" type="button" title={t("common.remove")} aria-label={t("common.remove")} onClick={() => setAvatarDataUrl(null)}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <div className="account-form-stack">
            <label className="account-field">
              {t("account.displayName")}
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>

            <div className="account-password-grid">
              <label className="account-field wide">
                {t("account.currentPassword")}
                <input
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <label className="account-field">
                {t("account.newPassword")}
                <input
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                />
              </label>
              <label className="account-field">
                {t("account.confirmPassword")}
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                />
              </label>
            </div>

            {error ? <div className="form-error account-feedback">{error}</div> : null}
            {notice ? <div className="page-notice account-feedback">{notice}</div> : null}

            <div className="account-modal-actions">
              <button className="ghost-button account-logout-button" type="button" onClick={() => onLogout({ manual: true })}>
                <LogOut size={16} />
                {t("account.logout")}
              </button>
              <button className="primary-button account-save-button" disabled={saving} type="submit">
                <Save size={16} />
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
