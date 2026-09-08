import { rememberedLoginKey, autoLoginKey, manualLogoutKey } from "../constants.js";
import type { RememberedLogin } from "../types/app.js";

export function tokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(window.atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function readRememberedLogin(): RememberedLogin | null {
  try {
    const raw = window.localStorage.getItem(rememberedLoginKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin> & { password?: unknown };
    if (typeof parsed.username !== "string") return null;
    // Security cleanup: remove legacy plaintext password if present in localStorage
    if ("password" in parsed) {
      window.localStorage.setItem(rememberedLoginKey, JSON.stringify({ username: parsed.username }));
    }
    return {
      username: parsed.username
    };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(username: string): void {
  window.localStorage.setItem(rememberedLoginKey, JSON.stringify({ username }));
}

export function clearRememberedLogin(): void {
  window.localStorage.removeItem(rememberedLoginKey);
  window.localStorage.removeItem(autoLoginKey);
}

export function readAutoLogin(): boolean {
  try {
    return window.localStorage.getItem(autoLoginKey) === "true";
  } catch {
    return false;
  }
}

export function saveAutoLogin(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(autoLoginKey, "true");
    } else {
      window.localStorage.removeItem(autoLoginKey);
    }
  } catch {}
}

export function isManualLogoutSuppressed(): boolean {
  try {
    return window.sessionStorage.getItem(manualLogoutKey) === "true";
  } catch {
    return false;
  }
}

export function setManualLogoutSuppressed(suppressed: boolean): void {
  try {
    if (suppressed) {
      window.sessionStorage.setItem(manualLogoutKey, "true");
    } else {
      window.sessionStorage.removeItem(manualLogoutKey);
    }
  } catch {}
}
