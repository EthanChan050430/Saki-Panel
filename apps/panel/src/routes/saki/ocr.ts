import type { SakiConfigResponse, SakiInputAttachment } from "@webops/shared";
import {
  isSakiImageAttachment,
  sakiAttachmentsForMessage,
  sakiModelSupportsVision
} from "@webops/shared";
import { logSakiModelEvent } from "./types.js";

type TesseractWorker = {
  recognize(image: string): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let ocrQueue: Promise<void> = Promise.resolve();

async function createOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import("tesseract.js");
  try {
    return (await createWorker("chi_sim+eng")) as unknown as TesseractWorker;
  } catch (error) {
    logSakiModelEvent("chat.ocr.worker-fallback", {
      error: error instanceof Error ? error.message : String(error)
    });
    return (await createWorker("eng")) as unknown as TesseractWorker;
  }
}

export async function terminateSakiOcrWorker(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Worker never started or already stopped.
  }
}

async function getOcrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function ocrSakiImageDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return "";
  let text = "";
  const run = async () => {
    const worker = await getOcrWorker();
    const result = await worker.recognize(dataUrl);
    text = (result.data.text || "").replace(/\u00a0/g, " ").trim();
  };
  ocrQueue = ocrQueue.then(run, run);
  try {
    await ocrQueue;
  } catch (error) {
    logSakiModelEvent("chat.ocr.error", {
      error: error instanceof Error ? error.message : String(error)
    });
    return "";
  }
  return text;
}

export async function hydrateSakiAttachmentsForModel(
  attachments: SakiInputAttachment[],
  message: string,
  config: Pick<SakiConfigResponse, "model" | "provider">
): Promise<SakiInputAttachment[]> {
  if (attachments.length === 0) return attachments;
  const selected = sakiAttachmentsForMessage(message, attachments);
  const supportsVision = sakiModelSupportsVision(config.model, config.provider);
  const next: SakiInputAttachment[] = [];

  for (const attachment of selected) {
    if (!isSakiImageAttachment(attachment)) {
      next.push(attachment);
      continue;
    }
    if (supportsVision && attachment.dataUrl) {
      next.push(attachment);
      continue;
    }
    const existingText = attachment.text?.trim();
    const ocrText = existingText || (attachment.dataUrl ? await ocrSakiImageDataUrl(attachment.dataUrl) : "");
    const { dataUrl: _dataUrl, ...rest } = attachment;
    next.push({
      ...rest,
      text: ocrText || "（未能识别图片中的文字）"
    });
  }

  if (!supportsVision && next.some((attachment) => isSakiImageAttachment(attachment) && attachment.text)) {
    logSakiModelEvent("chat.ocr", {
      model: config.model,
      provider: config.provider,
      images: next.filter(isSakiImageAttachment).length
    });
  }

  return next;
}
