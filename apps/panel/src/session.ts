import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { CurrentUser, LoginResponse, PanelSessionSettings, UpdatePanelSessionSettingsRequest } from "@webops/shared";
import { panelConfig, panelPaths } from "./config.js";

const minSessionTimeoutMinutes = 0;
const maxSessionTimeoutMinutes = 525600;

class SessionSettingsError extends Error {
  readonly statusCode = 400;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function normalizeSessionTimeoutMinutes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.max(minSessionTimeoutMinutes, Math.min(value, maxSessionTimeoutMinutes));
  return Number(clamped.toFixed(3));
}

function parseSessionTimeoutMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SessionSettingsError("登录超时时间必须是数字。");
  }
  if (value < minSessionTimeoutMinutes) {
    throw new SessionSettingsError("登录超时时间不能小于 0。");
  }
  if (value > maxSessionTimeoutMinutes) {
    throw new SessionSettingsError("登录超时时间不能超过 525600 分钟。");
  }
  return Number(value.toFixed(3));
}

function sessionTimeoutSeconds(minutes: number): number | null {
  if (minutes <= 0) return null;
  return Math.max(1, Math.round(minutes * 60));
}

export async function readPanelSessionSettings(): Promise<PanelSessionSettings> {
  const defaultTimeout = normalizeSessionTimeoutMinutes(panelConfig.sessionTimeoutMinutes, 120);
  const settings = await readJsonFile<Partial<PanelSessionSettings>>(panelPaths.sessionSettingsFile, {});
  return {
    sessionTimeoutMinutes: normalizeSessionTimeoutMinutes(settings.sessionTimeoutMinutes, defaultTimeout)
  };
}

export async function savePanelSessionSettings(
  input: UpdatePanelSessionSettingsRequest
): Promise<PanelSessionSettings> {
  const current = await readPanelSessionSettings();
  const next: PanelSessionSettings = {
    sessionTimeoutMinutes:
      input.sessionTimeoutMinutes === undefined
        ? current.sessionTimeoutMinutes
        : parseSessionTimeoutMinutes(input.sessionTimeoutMinutes)
  };
  await writeJsonFile(panelPaths.sessionSettingsFile, next);
  return next;
}

export async function createLoginResponse(app: FastifyInstance, currentUser: CurrentUser): Promise<LoginResponse> {
  const settings = await readPanelSessionSettings();
  const payload = {
    sub: currentUser.id,
    username: currentUser.username,
    permissions: currentUser.permissions
  };
  const timeoutSeconds = sessionTimeoutSeconds(settings.sessionTimeoutMinutes);
  const token = timeoutSeconds === null ? app.jwt.sign(payload) : app.jwt.sign(payload, { expiresIn: timeoutSeconds });
  return {
    token,
    user: currentUser,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes
  };
}
