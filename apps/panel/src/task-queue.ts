export function createKeyedTaskQueue(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const pending = new Map<string, Promise<unknown>>();

  return function run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const request = new Promise<void>((resolve) => {
      const start = () => { active++; resolve(); };
      if (active < limit) start(); else waiting.push(start);
    }).then(work).finally(() => {
      pending.delete(key);
      active--;
      waiting.shift()?.();
    });
    pending.set(key, request);
    return request;
  };
}
