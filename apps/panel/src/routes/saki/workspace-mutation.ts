const mutations = new Map<string, Promise<void>>();

/** Serialize Agent edits, terminal snapshots and undo within one instance. */
export async function withSakiWorkspaceMutation<T>(instanceId: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const previous = mutations.get(instanceId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  mutations.set(instanceId, current);
  const unlock = () => { release(); if (mutations.get(instanceId) === current) mutations.delete(instanceId); };
  let removeAbortListener: (() => void) | undefined;
  let acquired = false;
  try {
    if (signal) {
      await Promise.race([previous, new Promise<never>((_, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      })]);
    } else {
      await previous;
    }
    acquired = true;
    signal?.throwIfAborted();
    return await work();
  } finally {
    removeAbortListener?.();
    if (acquired) unlock();
    else void previous.then(unlock);
  }
}

/** Acquire multiple instance locks in one order to avoid cross-workspace deadlocks. */
export function withSakiWorkspaceMutations<T>(instanceIds: readonly string[], work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const ids = [...new Set(instanceIds)].sort();
  const acquire = (index: number): Promise<T> => index === ids.length ? work()
    : withSakiWorkspaceMutation(ids[index]!, () => acquire(index + 1), signal);
  return acquire(0);
}
