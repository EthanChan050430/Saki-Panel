import type { ManagedWatchPolicy, UpdateWatchPolicyRequest, WatchPolicyMode } from "@webops/shared";
import { prisma } from "../db.js";

export const defaultWatchPolicy = {
  enabled: true,
  mode: "diagnose_and_patch" as WatchPolicyMode,
  cooldownSeconds: 900,
  maxRunsPerHour: 3,
  verifyWaitSeconds: 20,
  approverUserId: null as string | null
};

export function normalizeWatchPolicyMode(value: unknown, fallback: WatchPolicyMode = defaultWatchPolicy.mode): WatchPolicyMode {
  if (value === "off" || value === "diagnose_only" || value === "diagnose_and_patch") return value;
  return fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function toManagedWatchPolicy(instanceId: string, row: {
  enabled: boolean;
  mode: string;
  cooldownSeconds: number;
  maxRunsPerHour: number;
  verifyWaitSeconds: number;
  approverUserId: string | null;
} | null): ManagedWatchPolicy {
  return {
    instanceId,
    enabled: row?.enabled ?? defaultWatchPolicy.enabled,
    mode: normalizeWatchPolicyMode(row?.mode),
    cooldownSeconds: row?.cooldownSeconds ?? defaultWatchPolicy.cooldownSeconds,
    maxRunsPerHour: row?.maxRunsPerHour ?? defaultWatchPolicy.maxRunsPerHour,
    verifyWaitSeconds: row?.verifyWaitSeconds ?? defaultWatchPolicy.verifyWaitSeconds,
    approverUserId: row?.approverUserId ?? null
  };
}

export async function readWatchPolicy(instanceId: string): Promise<ManagedWatchPolicy> {
  const row = await prisma.watchPolicy.findUnique({ where: { instanceId } });
  return toManagedWatchPolicy(instanceId, row);
}

export async function upsertWatchPolicy(instanceId: string, input: UpdateWatchPolicyRequest): Promise<ManagedWatchPolicy> {
  const current = await readWatchPolicy(instanceId);
  const data = {
    enabled: input.enabled ?? current.enabled,
    mode: input.mode ? normalizeWatchPolicyMode(input.mode, current.mode) : current.mode,
    cooldownSeconds: input.cooldownSeconds !== undefined
      ? clampInt(input.cooldownSeconds, current.cooldownSeconds, 60, 86400)
      : current.cooldownSeconds,
    maxRunsPerHour: input.maxRunsPerHour !== undefined
      ? clampInt(input.maxRunsPerHour, current.maxRunsPerHour, 1, 20)
      : current.maxRunsPerHour,
    verifyWaitSeconds: input.verifyWaitSeconds !== undefined
      ? clampInt(input.verifyWaitSeconds, current.verifyWaitSeconds, 5, 180)
      : current.verifyWaitSeconds,
    approverUserId: input.approverUserId === undefined ? current.approverUserId ?? null : input.approverUserId
  };
  const row = await prisma.watchPolicy.upsert({
    where: { instanceId },
    update: {
      enabled: data.enabled,
      mode: data.mode,
      cooldownSeconds: data.cooldownSeconds,
      maxRunsPerHour: data.maxRunsPerHour,
      verifyWaitSeconds: data.verifyWaitSeconds,
      approverUserId: data.approverUserId
    },
    create: {
      instanceId,
      enabled: data.enabled,
      mode: data.mode,
      cooldownSeconds: data.cooldownSeconds,
      maxRunsPerHour: data.maxRunsPerHour,
      verifyWaitSeconds: data.verifyWaitSeconds,
      approverUserId: data.approverUserId
    }
  });
  return toManagedWatchPolicy(instanceId, row);
}
