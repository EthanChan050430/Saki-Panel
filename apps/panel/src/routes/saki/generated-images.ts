import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SakiInputAttachment } from "@webops/shared";
import { panelPaths } from "../../config.js";
import type { SakiGeneratedImage } from "./image-gen.js";
import { RouteError } from "./types.js";

export interface StoredSakiGeneratedImage {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  extension: string;
  size: number;
  width: number;
  height: number;
  prompt?: string;
  createdAt: string;
}

function safeUserSegment(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return safe || "unknown";
}

function generatedImageDir(userId: string): string {
  return path.join(panelPaths.dataDir, "saki-generated", safeUserSegment(userId));
}

function assertGeneratedImageId(id: string): string {
  const trimmed = id.trim();
  if (!/^[a-zA-Z0-9]{8,32}$/.test(trimmed)) {
    throw new RouteError("Invalid generated image id.", 400);
  }
  return trimmed;
}

export function sakiGeneratedImageAttachment(record: StoredSakiGeneratedImage): SakiInputAttachment {
  return {
    id: record.id,
    kind: "image",
    name: record.fileName,
    mimeType: record.mimeType,
    size: record.size,
    generatedImageId: record.id,
    width: record.width,
    height: record.height,
    capturedAt: record.createdAt
  };
}

export async function saveSakiGeneratedImage(
  userId: string,
  image: SakiGeneratedImage,
  prompt?: string
): Promise<{ record: StoredSakiGeneratedImage; attachment: SakiInputAttachment }> {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const dir = generatedImageDir(userId);
  await fs.mkdir(dir, { recursive: true });
  const bytes = Buffer.from(image.base64, "base64");
  const fileName = `saki-${id}.${image.extension}`;
  await fs.writeFile(path.join(dir, `${id}.${image.extension}`), bytes);
  const record: StoredSakiGeneratedImage = {
    id,
    userId,
    fileName,
    mimeType: image.mimeType,
    extension: image.extension,
    size: bytes.byteLength,
    width: image.width,
    height: image.height,
    ...(prompt ? { prompt: prompt.slice(0, 500) } : {}),
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { record, attachment: sakiGeneratedImageAttachment(record) };
}

export async function readSakiGeneratedImage(
  userId: string,
  rawId: string
): Promise<{ record: StoredSakiGeneratedImage; bytes: Buffer }> {
  const id = assertGeneratedImageId(rawId);
  const dir = generatedImageDir(userId);
  let metaRaw = "";
  try {
    metaRaw = await fs.readFile(path.join(dir, `${id}.json`), "utf8");
  } catch {
    throw new RouteError("Generated image not found.", 404);
  }
  let record: StoredSakiGeneratedImage;
  try {
    record = JSON.parse(metaRaw) as StoredSakiGeneratedImage;
  } catch {
    throw new RouteError("Generated image metadata is invalid.", 500);
  }
  if (record.userId !== userId) {
    throw new RouteError("Generated image not found.", 404);
  }
  const bytes = await fs.readFile(path.join(dir, `${id}.${record.extension}`)).catch(() => null);
  if (!bytes) {
    throw new RouteError("Generated image file is missing.", 404);
  }
  return { record, bytes };
}
