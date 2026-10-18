let scope = "";
const snapshots = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

function selectScope(token: string) {
  if (scope === token) return;
  scope = token;
  snapshots.clear();
  pending.clear();
}

export function readResourceSnapshot<T>(token: string, key: string): T | undefined {
  selectScope(token);
  return snapshots.get(key) as T | undefined;
}

export function loadResourceSnapshot<T>(token: string, key: string, load: () => Promise<T>): Promise<T> {
  selectScope(token);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request = Promise.resolve().then(load).then((value) => {
    if (scope === token && pending.get(key) === request) writeResourceSnapshot(token, key, value);
    return value;
  }).finally(() => {
    if (scope === token && pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

export function writeResourceSnapshot<T>(token: string, key: string, value: T): void {
  selectScope(token);
  snapshots.delete(key);
  snapshots.set(key, value);
  if (snapshots.size > 24) snapshots.delete(snapshots.keys().next().value!);
}

export function invalidateResourceSnapshots(token: string, prefix = ""): void {
  selectScope(token);
  for (const key of snapshots.keys()) if (key.startsWith(prefix)) snapshots.delete(key);
  for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key);
}
