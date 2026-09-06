// Lightweight LRU-ish cache for connection pools.
// - Caps total pool count to MAX_POOLS.
// - Evicts any pool whose last-used timestamp is older than IDLE_TIMEOUT_MS.
// - Pool factories/cleanups are caller-owned so this stays provider-agnostic.

const MAX_POOLS = 24;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry<T> {
  value: T;
  lastUsedAt: number;
  end: (value: T) => Promise<void> | void;
}

export class PoolCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxPools: number;
  private readonly idleTimeoutMs: number;

  constructor(options?: { maxPools?: number; idleTimeoutMs?: number }) {
    this.maxPools = options?.maxPools ?? MAX_POOLS;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  }

  getOrCreate(
    key: string,
    factory: () => T,
    onReady?: (value: T) => void,
    onEvict?: (value: T) => Promise<void> | void
  ): T {
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      // Opportunistically prune other stale/surplus pools on every hit.
      this.prune();
      return existing.value;
    }

    // Make room before creating a new pool.
    this.prune();

    if (this.entries.size >= this.maxPools) {
      // Drop the oldest entry to make room.
      this.evictOldest();
    }

    const value = factory();
    onReady?.(value);
    this.entries.set(key, {
      value,
      lastUsedAt: Date.now(),
      end: (v) => onEvict?.(v)
    });
    return value;
  }

  invalidate(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    void Promise.resolve(entry.end(entry.value)).catch(() => {});
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  size(): number {
    return this.entries.size;
  }

  async closeAll(): Promise<void> {
    const all = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(all.map((entry) => Promise.resolve(entry.end(entry.value)).catch(() => {})));
  }

  private prune(): void {
    if (this.entries.size === 0) return;

    const now = Date.now();
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.entries) {
      if (now - entry.lastUsedAt > this.idleTimeoutMs) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      this.entries.delete(key);
      void Promise.resolve(entry.end(entry.value)).catch(() => {});
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const entry = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (entry) void Promise.resolve(entry.end(entry.value)).catch(() => {});
    }
  }
}
