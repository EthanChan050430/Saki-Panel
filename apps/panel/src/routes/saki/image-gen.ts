import {
  parseSakiImageGenQuality,
  resolveSakiImageSize,
  sanitizeSakiImageGenConfig,
  type SakiImageGenConfig,
  type SakiImageGenProtocol,
  type SakiImageGenProviderId,
  type SakiImageGenQuality
} from "@webops/shared";
import { errorMessageFromJson, fetchWithTimeout, objectValue, RouteError, trimString } from "./types.js";

const maxImagePromptChars = 4000;
const maxImageBytes = 20 * 1024 * 1024;
const imageGenTimeoutMs = 180_000;
const imageUrlFetchTimeoutMs = 30_000;
const dashscopePollIntervalMs = 2000;
const dashscopePollAttempts = 60;

export interface SakiGenerateImageInput {
  prompt: string;
  negativePrompt?: string;
  width?: unknown;
  height?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
  seed?: unknown;
  steps?: unknown;
}

export interface SakiGeneratedImage {
  mimeType: string;
  extension: string;
  base64: string;
  width: number;
  height: number;
  quality: SakiImageGenQuality;
  aspectRatio: string;
  revisedPrompt?: string;
  model: string;
  provider: SakiImageGenProviderId;
  protocol: SakiImageGenProtocol;
}

function assertHttpUrl(raw: string, field: string): URL {
  const value = trimString(raw);
  if (!value) {
    throw new RouteError(`${field} is required for image generation.`, 400);
  }
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new RouteError(`${field} is not a valid URL.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RouteError(`${field} must be an http(s) URL.`, 400);
  }
  return parsed;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function imageGenerationEndpoint(config: SakiImageGenConfig): string {
  const presetUrl = assertHttpUrl(config.baseUrl, "Image API Base URL").toString();
  const base = stripTrailingSlash(presetUrl);

  if (config.protocol === "sd-webui") {
    const root = base.replace(/\/sdapi\/v1(?:\/.*)?$/i, "");
    if (/\/txt2img$/i.test(base)) return base;
    return `${root}/sdapi/v1/txt2img`;
  }

  if (config.protocol === "stability") {
    const engine = trimString(config.model) || "core";
    const root = base.replace(/\/v2beta(?:\/.*)?$/i, "");
    if (/\/generate\/[^/]+$/i.test(base)) return base;
    return `${root}/v2beta/stable-image/generate/${encodeURIComponent(engine)}`;
  }

  if (config.protocol === "gemini") {
    const model = trimString(config.model) || "imagen-4.0-generate-001";
    const root = base.replace(/\/models(?:\/.*)?$/i, "");
    if (/:predict$/i.test(base) || /:generateImages$/i.test(base)) return base;
    return `${root}/models/${encodeURIComponent(model)}:predict`;
  }

  if (config.protocol === "dashscope") {
    if (/image-synthesis$/i.test(base) || /generation$/i.test(base)) return base;
    const root = base.replace(/\/services(?:\/.*)?$/i, "");
    return `${root}/services/aigc/text2image/image-synthesis`;
  }

  if (/\/images\/generations$/i.test(base)) return base;
  // 补齐 /v1 路径
  const withVersion = /\/v\d+(?:beta)?(?:\/openai)?$/i.test(base) ? base : `${base}/v1`;
  return `${withVersion}/images/generations`;
}

function mimeToExtension(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function sniffMimeFromBase64(base64: string, fallback = "image/png"): string {
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function openaiCompatibleSize(model: string, width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  const square = Math.abs(ratio - 1) < 0.12;
  const landscape = ratio > 1;
  if (/dall-e-2/i.test(model)) {
    const side = Math.max(width, height);
    if (side <= 384) return "256x256";
    if (side <= 768) return "512x512";
    return "1024x1024";
  }
  if (/dall-e-3/i.test(model)) {
    if (square) return "1024x1024";
    return landscape ? "1792x1024" : "1024x1792";
  }
  if (square) return "1024x1024";
  if (landscape) return width >= 1400 || height >= 1400 ? "1792x1024" : "1536x1024";
  return width >= 1400 || height >= 1400 ? "1024x1792" : "1024x1536";
}

function xaiResolution(quality: SakiImageGenQuality): "1k" | "2k" {
  return quality === "hd" ? "2k" : "1k";
}

function xaiQuality(quality: SakiImageGenQuality): "low" | "medium" | "high" {
  if (quality === "draft") return "low";
  if (quality === "hd") return "high";
  return "medium";
}

function sdSteps(quality: SakiImageGenQuality, explicit?: unknown): number {
  const parsed = Number(explicit);
  if (Number.isFinite(parsed) && parsed >= 1) return Math.max(1, Math.min(150, Math.floor(parsed)));
  if (quality === "draft") return 12;
  if (quality === "hd") return 30;
  return 20;
}

function optionalSeed(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
}

function authHeaders(config: SakiImageGenConfig, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(extra ?? {})
  };
  const apiKey = trimString(config.apiKey);
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function readResponsePayload(response: Response): Promise<{ text: string; bytes: Uint8Array; contentType: string }> {
  const contentType = response.headers.get("content-type") || "";
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxImageBytes) {
    throw new RouteError(`Image API returned a payload larger than ${Math.round(maxImageBytes / (1024 * 1024))}MB.`, 502);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  return { text, bytes: buffer, contentType };
}

function jsonPayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function safeImageApiUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("key")) parsed.searchParams.set("key", "[redacted]");
    if (parsed.searchParams.has("api_key")) parsed.searchParams.set("api_key", "[redacted]");
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function throwImageApiError(url: string, status: number, payload: unknown, text: string): never {
  const message = errorMessageFromJson(payload) || text.replace(/\s+/g, " ").trim().slice(0, 240) || statusTextFallback(status);
  const statusCode = status >= 400 && status < 500 ? status : 502;
  const upstreamAuth =
    status === 401 &&
    /Received Model Group|Error happened to model|OpenAIException|身份验证失败/i.test(`${message}\n${text}`);
  const hint = upstreamAuth
    ? " Your API key was accepted by the gateway, but the upstream channel for this image model failed authentication. Switch to another image model on the same gateway (for example Doubao-Seedream-4.0)."
    : "";
  throw new RouteError(`Image API ${status} from ${safeImageApiUrl(url)}: ${message}${hint}`, statusCode);
}

function statusTextFallback(status: number): string {
  if (status === 401 || status === 403) return "authentication failed";
  if (status === 404) return "endpoint not found";
  if (status === 429) return "rate limited";
  return "request failed";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = trimString(value);
    if (text) return text;
  }
  return "";
}

function extractBase64Field(value: unknown): string {
  const text = trimString(value);
  if (!text) return "";
  const dataUrl = text.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return dataUrl?.[1] || text.replace(/\s+/g, "");
}

export function parseGeneratedImagePayload(input: {
  protocol: SakiImageGenProtocol;
  contentType: string;
  text: string;
  bytes: Uint8Array;
}): { base64: string; mimeType: string; revisedPrompt?: string; url?: string } {
  const contentType = input.contentType.toLowerCase();
  if (contentType.startsWith("image/")) {
    return {
      base64: bytesToBase64(input.bytes),
      mimeType: contentType.split(";")[0] || "image/png"
    };
  }

  const payload = jsonPayload(input.text);
  const item = objectValue(payload);
  if (!item) {
    throw new RouteError("Image API returned a non-JSON, non-image response.", 502);
  }

  const data = Array.isArray(item.data) ? item.data : Array.isArray(item.images) ? item.images : null;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === "string") {
      const base64 = extractBase64Field(first);
      return { base64, mimeType: sniffMimeFromBase64(base64) };
    }
    const row = objectValue(first);
    if (row) {
      const base64 = extractBase64Field(row.b64_json ?? row.base64 ?? row.image_base64 ?? row.image);
      const url = firstString(row.url, row.image_url);
      const revisedPrompt = firstString(row.revised_prompt, row.revisedPrompt);
      if (base64) {
        return { base64, mimeType: sniffMimeFromBase64(base64), ...(revisedPrompt ? { revisedPrompt } : {}) };
      }
      if (url) {
        return { base64: "", mimeType: "image/png", url, ...(revisedPrompt ? { revisedPrompt } : {}) };
      }
    }
  }

  const predictions = Array.isArray(item.predictions) ? item.predictions : [];
  if (predictions.length > 0) {
    const row = objectValue(predictions[0]) ?? {};
    const base64 = extractBase64Field(row.bytesBase64Encoded ?? row.bytesBase64encoded ?? row.image);
    if (base64) {
      return {
        base64,
        mimeType: firstString(row.mimeType, row.mime_type) || sniffMimeFromBase64(base64)
      };
    }
  }

  const output = objectValue(item.output) ?? item;
  const results = Array.isArray(output.results) ? output.results : Array.isArray(item.results) ? item.results : [];
  if (results.length > 0) {
    const row = objectValue(results[0]) ?? {};
    const base64 = extractBase64Field(row.b64_json ?? row.base64 ?? row.image);
    const url = firstString(row.url, row.image_url);
    if (base64) return { base64, mimeType: sniffMimeFromBase64(base64) };
    if (url) return { base64: "", mimeType: "image/png", url };
  }

  const nestedUrl = firstString(item.url, item.image_url, objectValue(item.image)?.url);
  if (nestedUrl) {
    return { base64: "", mimeType: "image/png", url: nestedUrl };
  }

  const nestedBase64 = extractBase64Field(item.b64_json ?? item.base64 ?? item.image);
  if (nestedBase64 && nestedBase64.length > 80) {
    return { base64: nestedBase64, mimeType: sniffMimeFromBase64(nestedBase64) };
  }

  const errorText = errorMessageFromJson(payload);
  if (errorText) {
    throw new RouteError(`Image API error: ${errorText}`, 502);
  }
  throw new RouteError("Image API response did not contain image data.", 502);
}

async function fetchImageUrlAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  assertHttpUrl(url, "Image result URL");
  const response = await fetchWithTimeout(url, { method: "GET", headers: { accept: "image/*,application/json" } }, imageUrlFetchTimeoutMs);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throwImageApiError(url, response.status, jsonPayload(payload.text), payload.text);
  }
  if (payload.contentType.toLowerCase().startsWith("image/") || payload.bytes.length > 32) {
    const mimeType = payload.contentType.toLowerCase().startsWith("image/")
      ? payload.contentType.split(";")[0] || "image/png"
      : sniffMimeFromBase64(bytesToBase64(payload.bytes));
    return { base64: bytesToBase64(payload.bytes), mimeType };
  }
  const parsed = parseGeneratedImagePayload({
    protocol: "openai-images",
    contentType: payload.contentType,
    text: payload.text,
    bytes: payload.bytes
  });
  if (parsed.base64) return { base64: parsed.base64, mimeType: parsed.mimeType };
  throw new RouteError("Image URL did not return image bytes.", 502);
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; contentType: string; text: string; bytes: Uint8Array }> {
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    },
    imageGenTimeoutMs
  );
  const payload = await readResponsePayload(response);
  return { status: response.status, ...payload };
}

function requireConfigured(config: SakiImageGenConfig): SakiImageGenConfig {
  const sanitized = sanitizeSakiImageGenConfig(config);
  if (!sanitized.enabled) {
    throw new RouteError("Image generation is disabled. Enable it in Settings → AI Model → Image Generation.", 400);
  }
  if (!trimString(sanitized.baseUrl)) {
    throw new RouteError("Image generation Base URL is not configured.", 400);
  }
  const presetNeedsKey = sanitized.provider !== "sd-webui";
  if (presetNeedsKey && sanitized.provider !== "custom" && !trimString(sanitized.apiKey)) {
    throw new RouteError("Image generation API Key is not configured.", 400);
  }
  if (sanitized.provider === "custom" && sanitized.protocol !== "sd-webui" && !trimString(sanitized.apiKey)) {
    throw new RouteError("Custom image API Key is required unless the protocol is Stable Diffusion WebUI.", 400);
  }
  return sanitized;
}

export function buildOpenAiImagesBody(
  config: SakiImageGenConfig,
  prompt: string,
  size: ReturnType<typeof resolveSakiImageSize>
): Record<string, unknown> {
  const model = trimString(config.model);
  const body: Record<string, unknown> = { prompt };
  if (model) body.model = model;

  if (config.provider === "xai" || /api\.x\.ai/i.test(config.baseUrl) || /grok-imagine/i.test(model)) {
    body.n = 1;
    body.aspect_ratio = size.aspectRatio;
    body.resolution = xaiResolution(size.quality);
    body.quality = xaiQuality(size.quality);
    return body;
  }

  if (config.provider === "siliconflow" || /siliconflow/i.test(config.baseUrl)) {
    body.n = 1;
    body.size = `${size.width}x${size.height}`;
    body.image_size = `${size.width}x${size.height}`;
    return body;
  }

  const officialOpenAi = config.provider === "openai" || /api\.openai\.com/i.test(config.baseUrl);
  if (officialOpenAi || /dall-e|gpt-image/i.test(model)) {
    body.n = 1;
    body.size = openaiCompatibleSize(model, size.width, size.height);
    if (/dall-e-3|gpt-image/i.test(model)) {
      body.quality = size.quality === "hd" ? "hd" : "standard";
    }
    if (/dall-e/i.test(model) && !/gpt-image/i.test(model)) {
      body.response_format = "b64_json";
    }
    return body;
  }

  // 第三方网关兼容格式
  body.size = `${size.width}x${size.height}`;
  return body;
}

function dashscopeTaskUrl(config: SakiImageGenConfig, taskId: string): string {
  const base = stripTrailingSlash(assertHttpUrl(config.baseUrl, "Image API Base URL").toString());
  const root = base.replace(/\/services(?:\/.*)?$/i, "").replace(/\/tasks(?:\/.*)?$/i, "");
  return `${root}/tasks/${encodeURIComponent(taskId)}`;
}

async function generateViaOpenAiImages(
  config: SakiImageGenConfig,
  prompt: string,
  size: ReturnType<typeof resolveSakiImageSize>
): Promise<{ base64: string; mimeType: string; revisedPrompt?: string }> {
  const url = imageGenerationEndpoint(config);
  const posted = await postJson(url, buildOpenAiImagesBody(config, prompt, size), authHeaders(config));
  if (!posted.status || posted.status >= 400) {
    throwImageApiError(url, posted.status, jsonPayload(posted.text), posted.text);
  }
  const parsed = parseGeneratedImagePayload({
    protocol: "openai-images",
    contentType: posted.contentType,
    text: posted.text,
    bytes: posted.bytes
  });
  if (parsed.base64) {
    return { base64: parsed.base64, mimeType: parsed.mimeType, ...(parsed.revisedPrompt ? { revisedPrompt: parsed.revisedPrompt } : {}) };
  }
  if (parsed.url) {
    const fetched = await fetchImageUrlAsBase64(parsed.url);
    return { ...fetched, ...(parsed.revisedPrompt ? { revisedPrompt: parsed.revisedPrompt } : {}) };
  }
  throw new RouteError("OpenAI-compatible image API did not return image data.", 502);
}

async function generateViaSdWebui(
  config: SakiImageGenConfig,
  prompt: string,
  negativePrompt: string,
  size: ReturnType<typeof resolveSakiImageSize>,
  input: SakiGenerateImageInput
): Promise<{ base64: string; mimeType: string }> {
  const url = imageGenerationEndpoint(config);
  const body: Record<string, unknown> = {
    prompt,
    negative_prompt: negativePrompt,
    width: size.width,
    height: size.height,
    steps: sdSteps(size.quality, input.steps),
    cfg_scale: 7,
    sampler_name: "Euler a",
    batch_size: 1,
    n_iter: 1
  };
  const model = trimString(config.model);
  if (model) body.override_settings = { sd_model_checkpoint: model };
  const seed = optionalSeed(input.seed);
  if (seed !== undefined) body.seed = seed;
  const headers = authHeaders(config);
  const posted = await postJson(url, body, headers);
  if (posted.status >= 400) {
    throwImageApiError(url, posted.status, jsonPayload(posted.text), posted.text);
  }
  const parsed = parseGeneratedImagePayload({
    protocol: "sd-webui",
    contentType: posted.contentType,
    text: posted.text,
    bytes: posted.bytes
  });
  if (!parsed.base64) {
    throw new RouteError("Stable Diffusion WebUI did not return image data.", 502);
  }
  return { base64: parsed.base64, mimeType: parsed.mimeType || "image/png" };
}

async function generateViaStability(
  config: SakiImageGenConfig,
  prompt: string,
  negativePrompt: string,
  size: ReturnType<typeof resolveSakiImageSize>
): Promise<{ base64: string; mimeType: string }> {
  const url = imageGenerationEndpoint(config);
  const form = new FormData();
  form.set("prompt", prompt);
  if (negativePrompt) form.set("negative_prompt", negativePrompt);
  form.set("aspect_ratio", size.aspectRatio);
  form.set("output_format", "png");
  const headers = authHeaders(config, { accept: "image/*" });
  delete headers["content-type"];
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: form
    },
    imageGenTimeoutMs
  );
  const payload = await readResponsePayload(response);
  if (response.status >= 400) {
    throwImageApiError(url, response.status, jsonPayload(payload.text), payload.text);
  }
  const parsed = parseGeneratedImagePayload({
    protocol: "stability",
    contentType: payload.contentType,
    text: payload.text,
    bytes: payload.bytes
  });
  if (parsed.base64) return { base64: parsed.base64, mimeType: parsed.mimeType };
  if (parsed.url) return fetchImageUrlAsBase64(parsed.url);
  throw new RouteError("Stability API did not return image data.", 502);
}

async function generateViaGemini(
  config: SakiImageGenConfig,
  prompt: string,
  size: ReturnType<typeof resolveSakiImageSize>
): Promise<{ base64: string; mimeType: string }> {
  const url = new URL(imageGenerationEndpoint(config));
  const apiKey = trimString(config.apiKey);
  if (apiKey && !url.searchParams.has("key")) {
    url.searchParams.set("key", apiKey);
  }
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: size.aspectRatio
    }
  };
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers["x-goog-api-key"] = apiKey;
  const posted = await postJson(url.toString(), body, headers);
  if (posted.status >= 400) {
    throwImageApiError(url.toString(), posted.status, jsonPayload(posted.text), posted.text);
  }
  const parsed = parseGeneratedImagePayload({
    protocol: "gemini",
    contentType: posted.contentType,
    text: posted.text,
    bytes: posted.bytes
  });
  if (!parsed.base64) {
    throw new RouteError("Gemini Imagen did not return image data.", 502);
  }
  return { base64: parsed.base64, mimeType: parsed.mimeType };
}

async function generateViaDashscope(
  config: SakiImageGenConfig,
  prompt: string,
  negativePrompt: string,
  size: ReturnType<typeof resolveSakiImageSize>
): Promise<{ base64: string; mimeType: string }> {
  const url = imageGenerationEndpoint(config);
  const model = trimString(config.model) || "wanx2.1-t2i-turbo";
  const body = {
    model,
    input: {
      prompt,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {})
    },
    parameters: {
      size: `${size.width}*${size.height}`,
      n: 1
    }
  };
  const posted = await postJson(url, body, authHeaders(config, { "x-dashscope-async": "enable" }));
  if (posted.status >= 400) {
    throwImageApiError(url, posted.status, jsonPayload(posted.text), posted.text);
  }
  const immediate = jsonPayload(posted.text);
  const immediateItem = objectValue(immediate);
  const output = objectValue(immediateItem?.output) ?? immediateItem;
  const taskId = firstString(output?.task_id, immediateItem?.task_id);
  const taskStatus = firstString(output?.task_status, immediateItem?.task_status).toUpperCase();
  if (taskId && taskStatus !== "SUCCEEDED") {
    const finalPayload = await pollDashscopeTask(config, taskId);
    const parsed = parseGeneratedImagePayload({
      protocol: "dashscope",
      contentType: "application/json",
      text: JSON.stringify(finalPayload),
      bytes: new Uint8Array()
    });
    if (parsed.base64) return { base64: parsed.base64, mimeType: parsed.mimeType };
    if (parsed.url) return fetchImageUrlAsBase64(parsed.url);
    const results = objectValue(finalPayload);
    const resultOutput = objectValue(results?.output);
    const resultsList = Array.isArray(resultOutput?.results) ? resultOutput.results : [];
    const first = objectValue(resultsList[0]);
    const imageUrl = firstString(first?.url, first?.image_url);
    if (imageUrl) return fetchImageUrlAsBase64(imageUrl);
    throw new RouteError("DashScope task finished without image data.", 502);
  }

  const parsed = parseGeneratedImagePayload({
    protocol: "dashscope",
    contentType: posted.contentType,
    text: posted.text,
    bytes: posted.bytes
  });
  if (parsed.base64) return { base64: parsed.base64, mimeType: parsed.mimeType };
  if (parsed.url) return fetchImageUrlAsBase64(parsed.url);
  throw new RouteError("DashScope did not return image data.", 502);
}

async function pollDashscopeTask(config: SakiImageGenConfig, taskId: string): Promise<unknown> {
  const url = dashscopeTaskUrl(config, taskId);
  for (let attempt = 0; attempt < dashscopePollAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, dashscopePollIntervalMs));
    const response = await fetchWithTimeout(url, { method: "GET", headers: authHeaders(config) }, imageUrlFetchTimeoutMs);
    const payload = await readResponsePayload(response);
    if (response.status >= 400) {
      throwImageApiError(url, response.status, jsonPayload(payload.text), payload.text);
    }
    const parsed = jsonPayload(payload.text);
    const item = objectValue(parsed);
    const output = objectValue(item?.output) ?? item;
    const status = firstString(output?.task_status, item?.task_status).toUpperCase();
    if (status === "SUCCEEDED" || status === "SUCCESS") return parsed;
    if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED" || status === "UNKNOWN") {
      const message = errorMessageFromJson(parsed) || firstString(output?.message, item?.message) || status;
      throw new RouteError(`DashScope image task ${status}: ${message}`, 502);
    }
  }
  throw new RouteError("DashScope image task timed out while waiting for completion.", 504);
}

export async function generateSakiImage(config: SakiImageGenConfig, input: SakiGenerateImageInput): Promise<SakiGeneratedImage> {
  const sanitized = requireConfigured(config);
  const prompt = trimString(input.prompt);
  if (!prompt) {
    throw new RouteError("generateImage requires a prompt.", 400);
  }
  if (prompt.length > maxImagePromptChars) {
    throw new RouteError(`Image prompt is too long. Limit is ${maxImagePromptChars} characters.`, 400);
  }
  const negativePrompt = trimString(input.negativePrompt);
  const size = resolveSakiImageSize({
    width: input.width,
    height: input.height,
    aspectRatio: input.aspectRatio,
    quality: input.quality ?? sanitized.defaultQuality,
    defaults: sanitized
  });

  let result: { base64: string; mimeType: string; revisedPrompt?: string };
  if (sanitized.protocol === "sd-webui") {
    result = await generateViaSdWebui(sanitized, prompt, negativePrompt, size, input);
  } else if (sanitized.protocol === "stability") {
    result = await generateViaStability(sanitized, prompt, negativePrompt, size);
  } else if (sanitized.protocol === "gemini") {
    result = await generateViaGemini(sanitized, prompt, size);
  } else if (sanitized.protocol === "dashscope") {
    result = await generateViaDashscope(sanitized, prompt, negativePrompt, size);
  } else {
    result = await generateViaOpenAiImages(sanitized, prompt, size);
  }

  if (!result.base64) {
    throw new RouteError("Image generation returned empty image data.", 502);
  }

  const mimeType = result.mimeType || sniffMimeFromBase64(result.base64);
  return {
    mimeType,
    extension: mimeToExtension(mimeType),
    base64: result.base64,
    width: size.width,
    height: size.height,
    quality: parseSakiImageGenQuality(size.quality),
    aspectRatio: size.aspectRatio,
    ...(result.revisedPrompt ? { revisedPrompt: result.revisedPrompt } : {}),
    model: trimString(sanitized.model) || sanitized.provider,
    provider: sanitized.provider,
    protocol: sanitized.protocol
  };
}

export function isSakiImageOutputPath(relativePath: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(relativePath);
}

export function normalizeSakiImageOutputPath(relativePath: string, extension: string): string {
  const trimmed = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed) {
    throw new RouteError("generateImage requires a workspace-relative output path.", 400);
  }
  if (isSakiImageOutputPath(trimmed)) return trimmed;
  const cleanExt = extension.replace(/^\./, "") || "png";
  return `${trimmed}.${cleanExt}`;
}
