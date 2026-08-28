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
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (typeof parsed.username !== "string" || typeof parsed.password !== "string") return null;
    return {
      username: parsed.username,
      password: parsed.password
    };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(username: string, password: string): void {
  window.localStorage.setItem(rememberedLoginKey, JSON.stringify({ username, password }));
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
