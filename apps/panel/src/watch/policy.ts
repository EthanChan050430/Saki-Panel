import type { AutoApproveRiskLevel, ManagedWatchPolicy, UpdateWatchPolicyRequest, WatchPolicyMode } from "@webops/shared";
import { autoApproveRiskLevels } from "@webops/shared";
import { prisma } from "../db.js";

export const defaultWatchPolicy = {
  enabled: true,
  mode: "diagnose_and_patch" as WatchPolicyMode,
  cooldownSeconds: 900,
  maxRunsPerHour: 3,
  verifyWaitSeconds: 20,
  approverUserId: null as string | null,
  autoApproveRisk: "none" as AutoApproveRiskLevel,
  autoApproveMinConfidence: 0.85,
  healthCheckUrl: null as string | null,
  healthCheckTimeoutSeconds: 5,
  notifyChannelIds: [] as string[],
  escalationMinutes: 30
};

export function normalizeWatchPolicyMode(value: unknown, fallback: WatchPolicyMode = defaultWatchPolicy.mode): WatchPolicyMode {
  if (value === "off" || value === "diagnose_only" || value === "diagnose_and_patch") return value;
  return fallback;
}

export function normalizeAutoApproveRisk(value: unknown, fallback: AutoApproveRiskLevel = defaultWatchPolicy.autoApproveRisk): AutoApproveRiskLevel {
  if (typeof value === "string" && (autoApproveRiskLevels as readonly string[]).includes(value)) {
    return value as AutoApproveRiskLevel;
  }
  return fallback;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeHealthCheckUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function parseNotifyChannelIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

export function toManagedWatchPolicy(instanceId: string, row: {
  enabled: boolean;
  mode: string;
  cooldownSeconds: number;
  maxRunsPerHour: number;
  verifyWaitSeconds: number;
  approverUserId: string | null;
  autoApproveRisk: string;
  autoApproveMinConfidence: number;
  healthCheckUrl: string | null;
  healthCheckTimeoutSeconds: number;
  notifyChannelIds: string;
  escalationMinutes: number;
} | null): ManagedWatchPolicy {
  return {
    instanceId,
    enabled: row?.enabled ?? defaultWatchPolicy.enabled,
    mode: normalizeWatchPolicyMode(row?.mode),
    cooldownSeconds: row?.cooldownSeconds ?? defaultWatchPolicy.cooldownSeconds,
    maxRunsPerHour: row?.maxRunsPerHour ?? defaultWatchPolicy.maxRunsPerHour,
    verifyWaitSeconds: row?.verifyWaitSeconds ?? defaultWatchPolicy.verifyWaitSeconds,
    approverUserId: row?.approverUserId ?? null,
    autoApproveRisk: normalizeAutoApproveRisk(row?.autoApproveRisk),
    autoApproveMinConfidence: row?.autoApproveMinConfidence ?? defaultWatchPolicy.autoApproveMinConfidence,
    healthCheckUrl: row?.healthCheckUrl ?? null,
    healthCheckTimeoutSeconds: row?.healthCheckTimeoutSeconds ?? defaultWatchPolicy.healthCheckTimeoutSeconds,
    notifyChannelIds: parseNotifyChannelIds(row?.notifyChannelIds),
    escalationMinutes: row?.escalationMinutes ?? defaultWatchPolicy.escalationMinutes
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
    approverUserId: input.approverUserId === undefined ? current.approverUserId ?? null : input.approverUserId,
    autoApproveRisk: input.autoApproveRisk !== undefined
      ? normalizeAutoApproveRisk(input.autoApproveRisk, current.autoApproveRisk)
      : current.autoApproveRisk,
    autoApproveMinConfidence: input.autoApproveMinConfidence !== undefined
      ? clampFloat(input.autoApproveMinConfidence, current.autoApproveMinConfidence, 0, 1)
      : current.autoApproveMinConfidence,
    healthCheckUrl: input.healthCheckUrl === undefined
      ? current.healthCheckUrl ?? null
      : normalizeHealthCheckUrl(input.healthCheckUrl),
    healthCheckTimeoutSeconds: input.healthCheckTimeoutSeconds !== undefined
      ? clampInt(input.healthCheckTimeoutSeconds, current.healthCheckTimeoutSeconds, 1, 60)
      : current.healthCheckTimeoutSeconds,
    notifyChannelIds: input.notifyChannelIds !== undefined
      ? input.notifyChannelIds.filter((item): item is string => typeof item === "string" && item.length > 0)
      : current.notifyChannelIds,
    escalationMinutes: input.escalationMinutes !== undefined
      ? clampInt(input.escalationMinutes, current.escalationMinutes, 1, 7 * 24 * 60)
      : current.escalationMinutes
  };
  const row = await prisma.watchPolicy.upsert({
    where: { instanceId },
    update: {
      enabled: data.enabled,
      mode: data.mode,
      cooldownSeconds: data.cooldownSeconds,
      maxRunsPerHour: data.maxRunsPerHour,
      verifyWaitSeconds: data.verifyWaitSeconds,
      approverUserId: data.approverUserId,
      autoApproveRisk: data.autoApproveRisk,
      autoApproveMinConfidence: data.autoApproveMinConfidence,
      healthCheckUrl: data.healthCheckUrl,
      healthCheckTimeoutSeconds: data.healthCheckTimeoutSeconds,
      notifyChannelIds: JSON.stringify(data.notifyChannelIds),
      escalationMinutes: data.escalationMinutes
    },
    create: {
      instanceId,
      enabled: data.enabled,
      mode: data.mode,
      cooldownSeconds: data.cooldownSeconds,
      maxRunsPerHour: data.maxRunsPerHour,
      verifyWaitSeconds: data.verifyWaitSeconds,
      approverUserId: data.approverUserId,
      autoApproveRisk: data.autoApproveRisk,
      autoApproveMinConfidence: data.autoApproveMinConfidence,
      healthCheckUrl: data.healthCheckUrl,
      healthCheckTimeoutSeconds: data.healthCheckTimeoutSeconds,
      notifyChannelIds: JSON.stringify(data.notifyChannelIds),
      escalationMinutes: data.escalationMinutes
    }
  });
  return toManagedWatchPolicy(instanceId, row);
}
