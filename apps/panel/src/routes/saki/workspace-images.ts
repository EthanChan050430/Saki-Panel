import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { SakiInputAttachment } from "@webops/shared";
import { RouteError } from "./types.js";

export const maxWorkspaceImageBytes = 10 * 1024 * 1024;
export function isWorkspaceImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
}

export function assertWorkspaceImageSize(size: number, maxBytes = maxWorkspaceImageBytes): void {
  if (size > maxBytes) throw new RouteError(`图片超过当前识图读取上限（${Math.floor(maxBytes / 1024 / 1024)} MB）。请使用较小的图片。`, 413);
}

export async function readWorkspaceImageStream(stream: Readable, name: string, signal?: AbortSignal, maxBytes = maxWorkspaceImageBytes): Promise<SakiInputAttachment> {
  const deadline = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  const abort = () => stream.destroy(new Error("Image read was cancelled or timed out."));
  deadline.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    deadline.throwIfAborted();
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      assertWorkspaceImageSize(size, maxBytes);
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
      : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii")) ? "image/gif"
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : "";
    if (!mimeType) throw new RouteError("文件不是可识别的 PNG、JPEG、WebP 或 GIF 图片。", 400);
    return { id: `read-image-${randomUUID()}`, name, kind: "image", mimeType, size,
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
  } finally {
    deadline.removeEventListener("abort", abort);
    stream.destroy();
  }
}
