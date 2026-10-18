import type { ManagedInstance } from "@webops/shared";

export type InstanceStatusSummary = Pick<ManagedInstance,
  "id" | "status" | "lastExitCode" | "lastStartedAt" | "lastStoppedAt" | "updatedAt">;

export function mergeInstanceStatuses(current: ManagedInstance[], incoming: InstanceStatusSummary[], baseline: ManagedInstance[]) {
  const byId = new Map(incoming.map((item) => [item.id, item]));
  const before = new Map(baseline.map((item) => [item.id, item]));
  let changed = false;
  const next = current.map((instance) => {
    const status = byId.get(instance.id);
    const original = before.get(instance.id);
    if (!status || !original || instance.status !== original.status || instance.lastExitCode !== original.lastExitCode
      || instance.updatedAt !== original.updatedAt || Date.parse(status.updatedAt) < Date.parse(instance.updatedAt)) return instance;
    if (instance.status === status.status && instance.lastExitCode === status.lastExitCode
      && instance.lastStartedAt === status.lastStartedAt && instance.lastStoppedAt === status.lastStoppedAt
      && instance.updatedAt === status.updatedAt) return instance;
    changed = true;
    return { ...instance, ...status };
  });
  return changed ? next : current;
}
