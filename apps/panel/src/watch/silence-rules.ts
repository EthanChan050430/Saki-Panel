import type { CreateSilenceRuleRequest, IncidentTrigger, ManagedSilenceRule } from "@webops/shared";
import { prisma } from "../db.js";

// 静默规则匹配：规则上每一个非空字段都必须与输入相等，且未过期；
// 三个匹配字段全空的规则不匹配任何 incident（防止误建的全局静默吞掉所有告警）。
export async function isIncidentSilenced(input: {
  instanceId: string;
  fingerprint: string;
  trigger: string;
}): Promise<boolean> {
  const now = new Date();
  const rules = await prisma.silenceRule.findMany({
    where: {
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    }
  });
  return rules.some((rule) => {
    if (!rule.instanceId && !rule.fingerprint && !rule.trigger) return false;
    if (rule.instanceId !== null && rule.instanceId !== input.instanceId) return false;
    if (rule.fingerprint !== null && rule.fingerprint !== input.fingerprint) return false;
    if (rule.trigger !== null && rule.trigger !== input.trigger) return false;
    return true;
  });
}

export function toManagedSilenceRule(
  row: {
    id: string;
    instanceId: string | null;
    fingerprint: string | null;
    trigger: string | null;
    reason: string | null;
    expiresAt: Date | null;
    createdAt: Date;
  },
  instanceName?: string | null
): ManagedSilenceRule {
  return {
    id: row.id,
    instanceId: row.instanceId,
    instanceName: instanceName ?? null,
    fingerprint: row.fingerprint,
    trigger: (row.trigger as IncidentTrigger | null) ?? null,
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

export async function listSilenceRules(): Promise<ManagedSilenceRule[]> {
  const rows = await prisma.silenceRule.findMany({ orderBy: { createdAt: "desc" } });
  const instanceIds = [...new Set(rows.map((row) => row.instanceId).filter((id): id is string => Boolean(id)))];
  const instances = instanceIds.length
    ? await prisma.instance.findMany({ where: { id: { in: instanceIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(instances.map((instance) => [instance.id, instance.name]));
  return rows.map((row) => toManagedSilenceRule(row, row.instanceId ? nameById.get(row.instanceId) ?? null : null));
}

export async function createSilenceRule(input: CreateSilenceRuleRequest): Promise<ManagedSilenceRule> {
  const rawMinutes = typeof input.minutes === "number" && Number.isFinite(input.minutes) ? input.minutes : null;
  const minutes = rawMinutes !== null ? Math.max(1, Math.min(rawMinutes, 365 * 24 * 60)) : null;
  const expiresAt = minutes !== null ? new Date(Date.now() + minutes * 60 * 1000) : null;
  const row = await prisma.silenceRule.create({
    data: {
      instanceId: input.instanceId ?? null,
      fingerprint: input.fingerprint ?? null,
      trigger: input.trigger ?? null,
      reason: input.reason ?? null,
      expiresAt
    }
  });
  let instanceName: string | null = null;
  if (row.instanceId) {
    const instance = await prisma.instance.findUnique({ where: { id: row.instanceId }, select: { name: true } });
    instanceName = instance?.name ?? null;
  }
  return toManagedSilenceRule(row, instanceName);
}

export async function deleteSilenceRule(id: string): Promise<boolean> {
  const existing = await prisma.silenceRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.silenceRule.delete({ where: { id } });
  return true;
}
