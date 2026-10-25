const mutations = new Map<string, Promise<void>>();

/** Serialize Agent edits, terminal snapshots and undo within one instance. */
export async function withSakiWorkspaceMutation<T>(instanceId: string, work: () => Promise<T>): Promise<T> {
  const previous = mutations.get(instanceId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  mutations.set(instanceId, current);
  await previous;
  try { return await work(); }
  finally { release(); if (mutations.get(instanceId) === current) mutations.delete(instanceId); }
}

/** Acquire multiple instance locks in one order to avoid cross-workspace deadlocks. */
export function withSakiWorkspaceMutations<T>(instanceIds: readonly string[], work: () => Promise<T>): Promise<T> {
  const ids = [...new Set(instanceIds)].sort();
  const acquire = (index: number): Promise<T> => index === ids.length ? work()
    : withSakiWorkspaceMutation(ids[index]!, () => acquire(index + 1));
  return acquire(0);
}
