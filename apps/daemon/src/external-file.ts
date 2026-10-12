import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { SakiExternalFileSnapshot } from "@webops/shared";

const maxBytes = 1024 * 1024;
function reject(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

export async function inspectExternalFile(filePath: string): Promise<SakiExternalFileSnapshot> {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) || /[\x00-\x1f]/.test(filePath)
    || filePath.startsWith("\\\\") || /^\/(?:proc|sys|dev)(?:\/|$)/.test(filePath)) {
    reject("External reads require an absolute local regular-file path.");
  }
  const canonical = await fs.realpath(filePath);
  if (/^\/(?:proc|sys|dev)(?:\/|$)/.test(canonical) || canonical.startsWith("\\\\")) reject("Special files are not supported.");
  const stat = await fs.stat(canonical, { bigint: true });
  if (!stat.isFile() || stat.size > BigInt(maxBytes)) reject("Only regular text files up to 1 MiB are supported.");
  const handle = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    // On Windows Node path stat reports dev=0, while descriptor stat returns
    // the volume identity. Capture the latter and bind every later read to it.
    if (!opened.isFile() || opened.ino !== stat.ino || opened.size !== stat.size || opened.mtimeNs !== stat.mtimeNs
      || (stat.dev !== 0n && opened.dev !== stat.dev) || await fs.realpath(canonical) !== canonical) reject("File was replaced during inspection.");
    return { path: canonical, device: String(opened.dev), inode: String(opened.ino), size: Number(opened.size), modifiedNs: String(opened.mtimeNs) };
  } finally { await handle.close(); }
}

export async function readApprovedExternalFile(snapshot: SakiExternalFileSnapshot, startLine: number, lineCount: number) {
  if (!snapshot || typeof snapshot.path !== "string" || !Number.isInteger(snapshot.size) || snapshot.size < 0 || snapshot.size > maxBytes
    || !Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(lineCount) || lineCount < 1 || lineCount > 2000) reject("Invalid external-read approval.");
  const current = await inspectExternalFile(snapshot.path);
  if (current.path !== snapshot.path || current.device !== snapshot.device || current.inode !== snapshot.inode
    || current.size !== snapshot.size || current.modifiedNs !== snapshot.modifiedNs) reject("File changed since approval. Request access again.");
  const handle = await fs.open(snapshot.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    const matches = (stat: typeof before) => stat.isFile() && String(stat.dev) === snapshot.device && String(stat.ino) === snapshot.inode
      && Number(stat.size) === snapshot.size && String(stat.mtimeNs) === snapshot.modifiedNs;
    if (!matches(before)) reject("File was replaced since approval.");
    // Read a bounded amount from the verified descriptor, never reopen by path.
    const bytes = Buffer.alloc(snapshot.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== snapshot.size || !matches(await handle.stat({ bigint: true }))) reject("File changed while reading.");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    if (content.includes("\0")) reject("Binary files are not supported.");
    const lines = content.split(/\r?\n/);
    if (content.endsWith("\n")) lines.pop();
    return { path: snapshot.path, content: lines.slice(startLine - 1, startLine - 1 + lineCount).join("\n"), size: snapshot.size,
      totalLines: lines.length, endLine: Math.min(lines.length, startLine + lineCount - 1), modifiedAt: new Date(Number(before.mtimeMs)).toISOString(), isDirectory: false };
  } finally { await handle.close(); }
}
