import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { SakiInputAttachment } from "@webops/shared";
import { panelPaths } from "../../config.js";
import { RouteError } from "./types.js";

const maxVideoBytes = 100 * 1024 * 1024;

function videoDir(userId: string): string {
  return path.join(panelPaths.dataDir, "saki-generated-videos", createHash("sha256").update(userId).digest("hex"));
}

export async function saveSakiGeneratedVideo(userId: string, response: Response, signal?: AbortSignal): Promise<SakiInputAttachment> {
  if (!response.body) throw new RouteError("Video API returned an empty download.", 502);
  if (Number(response.headers.get("content-length")) > maxVideoBytes) {
    await response.body.cancel();
    throw new RouteError("Generated video exceeds the 100 MB limit.", 502);
  }

  const id = randomUUID();
  const dir = videoDir(userId);
  const name = `saki-${id}.mp4`;
  const file = path.join(dir, name);
  const partial = `${file}.part`;
  let size = 0;
  try {
    await fs.mkdir(dir, { recursive: true });
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), async function* (source) {
      let header = Buffer.alloc(0);
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > maxVideoBytes) throw new RouteError("Generated video exceeds the 100 MB limit.", 502);
        if (header.byteLength < 12) {
          header = Buffer.concat([header, chunk]);
          if (header.byteLength < 12) continue;
          if (header.toString("ascii", 4, 8) !== "ftyp") throw new RouteError("Video API did not return an MP4 file.", 502);
          yield header;
        } else {
          yield chunk;
        }
      }
      if (size < 12) throw new RouteError("Video API returned an incomplete MP4 file.", 502);
    }, createWriteStream(partial, { flags: "wx" }), { signal });
    await fs.rename(partial, file);
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => undefined);
    if (!response.body.locked) await response.body.cancel().catch(() => undefined);
    if (signal?.aborted || error instanceof RouteError) throw error;
    throw new RouteError("Could not save the generated video.", 502);
  }
  return { id, kind: "video", generatedVideoId: id, name, mimeType: "video/mp4", size, capturedAt: new Date().toISOString() };
}

export async function openSakiGeneratedVideo(userId: string, id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
    throw new RouteError("Invalid generated video ID.", 400);
  }
  const name = `saki-${id}.mp4`;
  const file = await fs.open(path.join(videoDir(userId), name), "r").catch(() => null);
  if (!file) throw new RouteError("Generated video not found.", 404);
  return { name, stream: file.createReadStream() };
}
