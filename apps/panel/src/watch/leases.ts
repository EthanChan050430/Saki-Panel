const defaultLeaseMs = 10 * 60 * 1000;
const leases = new Map<string, number>();

export function suppressRestart(instanceId: string, durationMs = defaultLeaseMs): string {
  const until = Date.now() + Math.max(5_000, durationMs);
  leases.set(instanceId, until);
  return new Date(until).toISOString();
}

export function clearRestartLease(instanceId: string): void {
  leases.delete(instanceId);
}

export function restartLeaseUntil(instanceId: string): string | null {
  const until = leases.get(instanceId);
  if (!until) return null;
  if (until <= Date.now()) {
    leases.delete(instanceId);
    return null;
  }
  return new Date(until).toISOString();
}

export function listActiveRestartLeases(): Array<{ instanceId: string; suppressUntil: string }> {
  const now = Date.now();
  const active: Array<{ instanceId: string; suppressUntil: string }> = [];
  for (const [instanceId, until] of leases) {
    if (until <= now) {
      leases.delete(instanceId);
      continue;
    }
    active.push({ instanceId, suppressUntil: new Date(until).toISOString() });
  }
  return active;
}
