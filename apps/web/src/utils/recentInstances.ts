const STORAGE_KEY = "webops.recentInstances";
const MAX_RECENT_INSTANCES = 12;

export interface RecentInstanceEntry {
  id: string;
  openedAt: string;
}

function isRecentInstanceEntry(value: unknown): value is RecentInstanceEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecentInstanceEntry>;
  return typeof entry.id === "string" && entry.id.length > 0 && typeof entry.openedAt === "string";
}

export function readRecentInstances(): RecentInstanceEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentInstanceEntry).slice(0, MAX_RECENT_INSTANCES);
  } catch {
    return [];
  }
}

export function readRecentInstanceIds(): string[] {
  return readRecentInstances().map((entry) => entry.id);
}

export function touchRecentInstance(id: string | null | undefined): void {
  const instanceId = id?.trim();
  if (!instanceId) return;
  const next: RecentInstanceEntry[] = [
    { id: instanceId, openedAt: new Date().toISOString() },
    ...readRecentInstances().filter((entry) => entry.id !== instanceId)
  ].slice(0, MAX_RECENT_INSTANCES);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Recent-instance history is a convenience, so storage failures can be ignored.
  }
}

export function recentInstanceOpenedAt(id: string): string | undefined {
  return readRecentInstances().find((entry) => entry.id === id)?.openedAt;
}
