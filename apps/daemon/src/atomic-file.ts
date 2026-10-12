import fs from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// Serialize panel writes per target and flush a staged file before publishing.
const writes = new Map<string, Promise<void>>();

async function publishStagedFile(target: string, createOnly: boolean, stage: (temporary: string, mode: number) => Promise<void>, expectedSha256?: string): Promise<void> {
  const key = process.platform === "win32" ? target.toLowerCase() : target;
  const previous = writes.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let destination = target;
    let mode: number | undefined;
    try {
      const stats = await fs.stat(target);
      if (!stats.isFile()) throw new Error("Target is not a regular file");
      mode = stats.mode;
      if (!createOnly) destination = await fs.realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = path.join(path.dirname(destination), `.saki-write-${randomUUID()}.tmp`);
    try {
      await stage(temporary, mode ?? 0o666);
      const handle = await fs.open(temporary, "r+");
      try {
        if (mode !== undefined) await handle.chmod(mode);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (expectedSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedSha256)
        || createHash("sha256").update(await fs.readFile(destination)).digest("hex") !== expectedSha256)) {
        throw Object.assign(new Error("File changed after the Agent edit. Preserve or resolve that edit before undo."), { statusCode: 409 });
      }
      if (createOnly) {
        try {
          await fs.link(temporary, destination);
        } catch (error) {
          // Some Windows sandboxes and network filesystems prohibit links.
          // Exclusive copy preserves no-clobber semantics on those systems.
          if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL);
        }
      } else await fs.rename(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") Object.assign(error as Error, { statusCode: 409 });
      throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  writes.set(key, operation);
  try {
    await operation;
  } finally {
    if (writes.get(key) === operation) writes.delete(key);
  }
}

export function writeTextFileAtomic(target: string, content: string | Uint8Array, createOnly = false, expectedSha256?: string): Promise<void> {
  return publishStagedFile(target, createOnly, (temporary, mode) => fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode }), expectedSha256);
}

export function writeStreamFileAtomic(target: string, source: NodeJS.ReadableStream, maxBytes: number, createOnly = false): Promise<void> {
  // A queued upload can disconnect before pipeline attaches its listeners.
  let sourceError: Error | undefined;
  const captureError = (error: Error) => { sourceError = error; };
  source.on("error", captureError);
  return publishStagedFile(target, createOnly, async (temporary, mode) => {
    if (sourceError) throw sourceError;
    let seen = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        seen += chunk.length;
        callback(seen > maxBytes ? Object.assign(new Error(`File transfer size exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`), { statusCode: 413 }) : null, chunk);
      }
    });
    await pipeline(source, limit, createWriteStream(temporary, { flags: "wx", mode }));
    // Multipart parsers can end normally after silently truncating at their cap.
    if ((source as NodeJS.ReadableStream & { truncated?: boolean }).truncated) {
      throw Object.assign(new Error("Uploaded file was truncated by the multipart size limit"), { statusCode: 413 });
    }
  }).finally(() => source.removeListener("error", captureError));
}
