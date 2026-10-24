import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { daemonPaths } from "./config.js";
import { writeTextFileAtomic } from "./atomic-file.js";
import { DaemonError } from "./errors.js";

type Entry = { kind: "directory" } | { kind: "link"; hash: string } | { kind: "file"; hash: string; content: string; mode: number };
type Tree = Record<string, Entry>;
interface Snapshot {
  instanceId: string;
  root: string;
  before: Tree;
  changes?: { path: string; after?: Entry }[];
  restored?: boolean;
}
const omitted = new Set([".git", "node_modules", ".venv", "venv", ".webops-saki-trash"]);
const maxBytes = 100 * 1024 * 1024;
const maxEntries = 20000;
// Expected conflicts must retain their actionable reason in production responses.
const problem = (message: string) => new DaemonError("WORKSPACE_CHECKPOINT_FAILED", message, message, 409);
const storage = () => path.join(daemonPaths.dataDir, "agent-workspace-checkpoints");
const snapshotPath = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw problem("Invalid workspace checkpoint.");
  return path.join(storage(), `${id}.json`);
};
const equal = (a?: Entry, b?: Entry) => a?.kind === b?.kind && (a?.kind === "file" ? b?.kind === "file" && a.hash === b.hash && a.mode === b.mode
  : a?.kind !== "link" || b?.kind === "link" && a.hash === b.hash);

async function tree(root: string): Promise<Tree> {
  const entries: Tree = Object.create(null);
  let bytes = 0, count = 0;
  const visit = async (directory: string, prefix: string) => {
    if (!(await fs.lstat(directory)).isDirectory() || await fs.realpath(directory) !== directory
      || (directory !== root && !directory.startsWith(`${root}${path.sep}`))) throw problem("Workspace checkpoint directory changed or escaped its root.");
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (omitted.has(item.name)) continue;
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (++count > maxEntries) throw problem("Workspace checkpoint exceeds 20,000 entries. Use file tools for edits.");
      const target = path.join(directory, item.name);
      const stat = await fs.lstat(target, { bigint: true });
      // Links must never cause reads outside the authorized workspace.
      if (stat.isSymbolicLink()) {
        entries[relative] = { kind: "link", hash: createHash("sha256").update(await fs.readlink(target)).digest("hex") };
        continue;
      }
      if (stat.isDirectory()) {
        entries[relative] = { kind: "directory" };
        await visit(target, relative);
      } else if (stat.isFile()) {
        if (stat.size > BigInt(maxBytes - bytes)) throw problem("Workspace checkpoint exceeds 100 MB. Use file tools for edits.");
        const canonical = await fs.realpath(target);
        if (!canonical.startsWith(`${root}${path.sep}`)) throw problem("Workspace checkpoint path escaped its root.");
        const handle = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const opened = await handle.stat({ bigint: true });
          const sameFile = (current: typeof opened) => current.isFile() && current.ino === stat.ino && current.size === stat.size
            && current.mtimeNs === stat.mtimeNs && (stat.dev === 0n || current.dev === stat.dev);
          if (!sameFile(opened) || await fs.realpath(target) !== canonical || await fs.realpath(root) !== root) throw problem("Workspace file changed during checkpoint capture.");
          // Read from the verified descriptor with a strict bound, even if a running process grows the file.
          const buffer = Buffer.alloc(Number(stat.size) + 1);
          let length = 0;
          while (length < buffer.length) {
            const read = await handle.read(buffer, length, buffer.length - length, length);
            if (!read.bytesRead) break;
            length += read.bytesRead;
          }
          if (length !== Number(stat.size) || !sameFile(await handle.stat({ bigint: true }))) throw problem("Workspace file changed during checkpoint capture.");
          const content = buffer.subarray(0, length);
          bytes += length;
          entries[relative] = { kind: "file", hash: createHash("sha256").update(content).digest("hex"), content: content.toString("base64"), mode: Number(stat.mode & 0o777n) };
        } finally { await handle.close(); }
      } else throw problem(`Cannot checkpoint special file: ${relative}`);
    }
  };
  await visit(root, "");
  return entries;
}

async function load(instanceId: string, root: string, id: string): Promise<Snapshot> {
  const snapshot = JSON.parse(await fs.readFile(snapshotPath(id), "utf8")) as Snapshot;
  if (snapshot.instanceId !== instanceId || snapshot.root !== await fs.realpath(root)) throw problem("Workspace checkpoint belongs to a different instance or directory.");
  return snapshot;
}

/** No shell commands, Git reset, ignored dependencies or external paths are involved. */
export async function captureWorkspaceCheckpoint(instanceId: string, workingDirectory: string) {
  const root = await fs.realpath(workingDirectory);
  const id = randomUUID();
  const before = await tree(root);
  await fs.mkdir(storage(), { recursive: true });
  await writeTextFileAtomic(snapshotPath(id), JSON.stringify({ instanceId, root, before } satisfies Snapshot), true);
  return { snapshotId: id };
}

export async function finalizeWorkspaceCheckpoint(instanceId: string, workingDirectory: string, id: string) {
  const snapshot = await load(instanceId, workingDirectory, id);
  const after = await tree(snapshot.root);
  snapshot.changes = [...new Set([...Object.keys(snapshot.before), ...Object.keys(after)])]
    .filter((file) => !equal(snapshot.before[file], after[file]))
    .map((file) => ({ path: file, ...(after[file] ? { after: after[file] } : {}) }));
  if (!snapshot.changes.length) await fs.unlink(snapshotPath(id));
  else {
    // Store only changed originals and post-command hashes, not a second copy.
    const before: Tree = Object.create(null);
    for (const change of snapshot.changes) {
      if (snapshot.before[change.path]) before[change.path] = snapshot.before[change.path]!;
      if (change.after?.kind === "file") change.after.content = "";
    }
    snapshot.before = before;
    await writeTextFileAtomic(snapshotPath(id), JSON.stringify(snapshot));
  }
  return { snapshotId: id, changedCount: snapshot.changes.length };
}

async function safeTarget(root: string, relative: string): Promise<string> {
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:]/.test(part) || omitted.has(part))) throw problem("Unsafe workspace checkpoint path.");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw problem(`Checkpoint path was replaced with a link: ${relative}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return current;
}

export async function restoreWorkspaceCheckpoint(instanceId: string, workingDirectory: string, id: string) {
  const snapshot = await load(instanceId, workingDirectory, id);
  if (!snapshot.changes) throw problem("Terminal checkpoint is unfinished; wait for the command to stop.");
  if (snapshot.restored) return { restoredCount: 0 };
  const current = await tree(snapshot.root);
  for (const change of snapshot.changes) {
    await safeTarget(snapshot.root, change.path);
    if (snapshot.before[change.path]?.kind === "link") throw problem(`A terminal changed a symbolic link: ${change.path}. Restore that link manually before undo.`);
  }
  const pending = snapshot.changes.filter((change) => !equal(current[change.path], snapshot.before[change.path]));
  const byPath = new Map(pending.map((change) => [change.path, change]));
  // Validate the entire change set before touching any file.
  for (const change of pending) {
    await safeTarget(snapshot.root, change.path);
    if (!equal(current[change.path], change.after)) throw problem(`File changed after the terminal command: ${change.path}. Preserve or resolve that edit before undo.`);
    if (current[change.path]?.kind === "directory" && snapshot.before[change.path]?.kind !== "directory") {
      for (const child of Object.keys(current).filter((file) => file.startsWith(`${change.path}/`))) {
        if (!byPath.has(child) || snapshot.before[child]) throw problem(`Directory contains a later change: ${child}`);
      }
    }
  }
  // Remove newly created entries deepest first, then restore old directories/files.
  for (const change of [...pending].sort((a, b) => b.path.split("/").length - a.path.split("/").length)) {
    const present = current[change.path], before = snapshot.before[change.path];
    if (present && (!before || present.kind !== before.kind)) {
      const target = await safeTarget(snapshot.root, change.path);
      if (present.kind === "directory") await fs.rmdir(target);
      else await fs.unlink(target);
    }
  }
  for (const change of [...pending].sort((a, b) => a.path.split("/").length - b.path.split("/").length)) {
    const before = snapshot.before[change.path];
    if (!before) continue;
    const target = await safeTarget(snapshot.root, change.path);
    if (before.kind === "directory") await fs.mkdir(target, { recursive: true });
    else if (before.kind === "file") {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await writeTextFileAtomic(target, Buffer.from(before.content, "base64"), !change.after, change.after?.kind === "file" ? change.after.hash : undefined);
      await fs.chmod(target, before.mode);
    }
  }
  snapshot.restored = true;
  snapshot.before = Object.create(null) as Tree;
  await writeTextFileAtomic(snapshotPath(id), JSON.stringify(snapshot));
  return { restoredCount: pending.length };
}
