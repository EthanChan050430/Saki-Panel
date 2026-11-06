import { sakiFetch } from "./model-fetch.js";
import { setTimeout as delay } from "node:timers/promises";
import { sanitizeSakiVideoGenConfig, type SakiVideoGenConfig } from "@webops/shared";
import { errorMessageFromJson, objectValue, RouteError, trimString } from "./types.js";
import { assertPublicHttpUrl } from "./web.js";

const pendingStates = new Set(["queued", "pending", "preparing", "submitted", "running", "processing", "in_progress", "waiting"]);
const completedStates = new Set(["succeeded", "success", "completed", "done"]);

export interface SakiVideoGenerationOptions {
  aspectRatio?: unknown;
  resolution?: unknown;
  generateAudio?: unknown;
  referenceImageDataUrl?: string;
}

function videoOptions(config: SakiVideoGenConfig, input: SakiVideoGenerationOptions) {
  const ratio = trimString(input.aspectRatio);
  const resolution = trimString(input.resolution).toLowerCase();
  if (ratio && !["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21"].includes(ratio)) throw new RouteError("视频画幅比例无效。", 400);
  if (resolution && !["480p", "720p", "768p", "1080p", "2k", "4k"].includes(resolution)) throw new RouteError("视频分辨率无效。", 400);
  if (input.generateAudio !== undefined && typeof input.generateAudio !== "boolean") throw new RouteError("generateAudio 必须是 true 或 false。", 400);
  const seedance = config.protocol === "seedance" || config.protocol === "cloudwise-seedance";
  if (seedance && resolution && !["480p", "720p", "1080p", "4k"].includes(resolution)) throw new RouteError("Seedance 分辨率应为 480p、720p、1080p 或 4k；具体支持范围由模型决定。", 400);
  if ((ratio || resolution) && !seedance && config.protocol !== "minimax") throw new RouteError("当前视频协议尚不支持独立的画幅和分辨率参数，请使用支持这些参数的 Seedance 或 MiniMax 协议。", 400);
  if (input.generateAudio !== undefined && !seedance) throw new RouteError("当前视频协议尚不支持音频开关，请省略 generateAudio 或使用 Seedance 协议。", 400);
  if (input.referenceImageDataUrl) {
    if (!seedance) throw new RouteError("当前视频协议尚不支持本地参考图片，请使用 Seedance 协议。", 400);
    if (input.referenceImageDataUrl.length > 14 * 1024 * 1024
      || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.referenceImageDataUrl)
      || Buffer.byteLength(input.referenceImageDataUrl.split(",")[1]!, "base64") > 10 * 1024 * 1024) throw new RouteError("参考图片格式无效或超过 10 MB。", 400);
  }
  return { ratio, resolution, audio: input.generateAudio, referenceImageDataUrl: input.referenceImageDataUrl };
}

function videoApiRequest(config: SakiVideoGenConfig, prompt: string, duration: number | undefined, options: ReturnType<typeof videoOptions>) {
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new RouteError("Video API Base URL must be a valid HTTP(S) URL.", 400);
  }
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new RouteError("Video API Base URL must be an HTTP(S) URL without credentials, query, or fragment.", 400);
  }
  const root = base.href.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|models)$/i, "");
  const model = config.model;
  const content: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  if (options.referenceImageDataUrl) content.push({ type: "image_url", image_url: { url: options.referenceImageDataUrl },
    role: /seedance[-.]2/i.test(model) ? "reference_image" : "first_frame" });
  const durationParam = duration === undefined ? {} : { duration };
  const seedanceParams = {
    ...(options.ratio ? { ratio: options.ratio } : {}),
    ...(options.resolution ? { resolution: options.resolution } : {}),
    ...(options.audio !== undefined ? { generate_audio: options.audio } : {})
  };
  const versioned = (suffix: string, version: string) => {
    const prefix = root.endsWith(suffix) ? root.slice(0, -suffix.length) : root;
    return /\/v\d+(?:beta\d*)?$/i.test(prefix) ? prefix : `${prefix}${version}`;
  };

  switch (config.protocol) {
    case "seedance": {
      const path = "/contents/generations/tasks";
      const submitUrl = `${versioned(path, "/api/v3")}${path}`;
      return { submitUrl, statusUrl: (id: string) => `${submitUrl}/${id}`, body: { model, content, ...durationParam, ...seedanceParams } };
    }
    case "cloudwise-seedance": {
      const path = "/aiproducts/video/seedance";
      const submitUrl = `${versioned(path, "/api/v1")}${path}`;
      return { submitUrl, statusUrl: (id: string) => `${submitUrl}/tasks/${id}`, body: { model, content, ...durationParam, ...seedanceParams } };
    }
    case "wan": {
      const path = "/services/aigc/video-generation/video-synthesis";
      const api = versioned(path, "/api/v1");
      return {
        submitUrl: `${api}${path}`,
        statusUrl: (id: string) => `${api}/tasks/${id}`,
        body: { model, input: { prompt }, ...(duration === undefined ? {} : { parameters: durationParam }) }
      };
    }
    case "minimax": {
      if (duration !== undefined && (duration < 4 || duration > 15)) {
        throw new RouteError("MiniMax H3 supports durations from 4 to 15 seconds.", 400);
      }
      const api = root.replace(/\/v[12](?:\/video_generation)?$/i, "");
      return {
        submitUrl: `${api}/v2/video_generation`,
        statusUrl: (id: string) => `${api}/v2/query/video_generation/${id}`,
        body: { model, content, duration: duration ?? 5, resolution: options.resolution?.toUpperCase() || "768P", ratio: options.ratio || "16:9" }
      };
    }
    case "xai": {
      const path = "/videos/generations";
      const api = versioned(path, "/v1");
      return { submitUrl: `${api}${path}`, statusUrl: (id: string) => `${api}/videos/${id}`, body: { model, prompt, ...durationParam } };
    }
    case "relay": {
      const path = "/video/generations";
      const api = versioned(path, "/v1");
      const submitUrl = `${api}${path}`;
      return {
        submitUrl, statusUrl: (id: string) => `${submitUrl}/${id}`,
        contentUrl: (id: string) => `${api}/videos/${id}/content`, body: { model, prompt, ...durationParam }
      };
    }
    case "openai": {
      const path = "/videos";
      const submitUrl = `${versioned(path, "/v1")}${path}`;
      const body = new FormData();
      body.set("model", model);
      body.set("prompt", prompt);
      if (duration !== undefined) body.set("seconds", String(duration));
      return { submitUrl, statusUrl: (id: string) => `${submitUrl}/${id}`, contentUrl: (id: string) => `${submitUrl}/${id}/content`, body };
    }
  }
}

function taskResult(payload: Record<string, unknown>) {
  const task = objectValue(payload.task) ?? objectValue(payload.output) ?? objectValue(payload.data) ?? payload;
  const first = Array.isArray(task.results) ? objectValue(task.results[0]) : null;
  const content = objectValue(task.content);
  return {
    id: trimString(task.task_id ?? task.request_id ?? task.id ?? payload.task_id ?? payload.id),
    status: trimString(task.status ?? task.task_status ?? payload.status).toLowerCase(),
    error: errorMessageFromJson(task) || errorMessageFromJson(payload),
    url: trimString(content?.video_url ?? content?.url ?? objectValue(task.video)?.url ?? task.video_url ?? first?.video_url ?? task.url)
  };
}

async function videoTaskJson(url: string, init: RequestInit, deadline: AbortSignal): Promise<Record<string, unknown>> {
  const response = await sakiFetch(url, { ...init, redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(45_000)]) });
  const payload = objectValue(await response.json().catch(() => null));
  if (!response.ok || !payload || payload.success === false || payload.error) {
    const message = errorMessageFromJson(payload);
    const statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new RouteError(message ? `Video API error: ${message.slice(0, 400)}` : `Video API returned an unexpected response (HTTP ${response.status}).`, statusCode);
  }
  return payload;
}

async function downloadVideo(url: string, submitUrl: string, deadline: AbortSignal, options: { token?: string; allowSameOrigin: boolean }): Promise<Response> {
  const origin = new URL(submitUrl).origin;
  let target = new URL(url, submitUrl);
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(120_000)]);
  for (let redirects = 0; redirects < 5; redirects++) {
    const sameOrigin = target.origin === origin;
    if (target.username || target.password) throw new RouteError("Video download URL contains credentials.", 502);
    if (!sameOrigin || !options.allowSameOrigin) await assertPublicHttpUrl(target.href);
    const headers = sameOrigin && options.token ? { authorization: `Bearer ${options.token}` } : {};
    const response = await sakiFetch(target, { headers, redirect: "manual", signal });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      target = new URL(location, target);
      // Only the configured content endpoint should receive the API key.
      options = { allowSameOrigin: options.allowSameOrigin };
      continue;
    }
    if (response.ok && response.body) return response;
    await response.body?.cancel();
    throw new RouteError(`Video download returned HTTP ${response.status}.`, 502);
  }
  throw new RouteError("Video download exceeded the redirect limit.", 502);
}

export async function generateSakiVideo(
  input: SakiVideoGenConfig | undefined,
  prompt: string,
  rawDuration: unknown,
  signal?: AbortSignal,
  options: SakiVideoGenerationOptions = {}
): Promise<Response> {
  const config = sanitizeSakiVideoGenConfig(input);
  if (!config.enabled) throw new RouteError("Video generation is disabled in Settings → AI Model → Video Generation.", 400);
  if (!config.baseUrl || !config.model || (!config.apiKey && config.provider !== "custom")) {
    throw new RouteError("Configure the video API Base URL, model, and required API key first.", 400);
  }
  if (!prompt || prompt.length > 4000) throw new RouteError("generateVideo requires a prompt of 1–4000 characters.", 400);
  const duration = rawDuration === undefined ? undefined : Number(rawDuration);
  if (duration !== undefined && (!Number.isInteger(duration) || duration < 1 || duration > 30)) {
    throw new RouteError("Video duration must be a whole number from 1 to 30 seconds.", 400);
  }

  const { submitUrl, statusUrl, contentUrl, body } = videoApiRequest(config, prompt, duration, videoOptions(config, options));
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const form = body instanceof FormData;
  const timeout = AbortSignal.timeout(15 * 60_000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let id = "";
  let providerTaskId = "";
  try {
    const payload = await videoTaskJson(submitUrl, {
      method: "POST",
      headers: { ...headers, ...(!form ? { "content-type": "application/json" } : {}), ...(config.protocol === "wan" ? { "X-DashScope-Async": "enable" } : {}) },
      body: form ? body : JSON.stringify(body)
    }, deadline);
    let result = taskResult(payload);
    if (result.id === "." || result.id === "..") throw new RouteError("Video API returned an invalid task ID.", 502);
    id = result.id ? encodeURIComponent(result.id) : "";
    providerTaskId = result.id;
    while (true) {
      if (completedStates.has(result.status) || (!result.status && result.url)) {
        const url = result.url || (id ? contentUrl?.(id) : undefined);
        if (!url) throw new RouteError("The completed video task did not return a video.", 502);
        return await downloadVideo(url, submitUrl, deadline, {
          allowSameOrigin: config.provider === "custom",
          ...(!result.url && config.apiKey ? { token: config.apiKey } : {})
        });
      }
      if (result.status && !pendingStates.has(result.status)) {
        throw new RouteError(`Video task ${result.status}: ${result.error.slice(0, 400) || "generation did not complete"}`, 502);
      }
      if (!id) throw new RouteError("Video API did not return a task ID.", 502);
      await delay(config.protocol === "minimax" ? 10_000 : 5_000, undefined, { signal: deadline });
      result = taskResult(await videoTaskJson(statusUrl(id), { headers }, deadline));
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    const taskNote = providerTaskId ? ` Provider task ID: ${providerTaskId.slice(0, 120)}.` : "";
    if (error instanceof RouteError) {
      const model = JSON.stringify(config.model);
      const hint = /output audio[\s\S]*copyright|audio[\s\S]*copyright restrictions/i.test(error.message)
        ? "服务商因生成音频的版权限制拒绝了本次任务。可以在新的请求中选择静音视频；本次不会自动重试。"
        : /copyright restrictions/i.test(error.message)
        ? "服务商因版权限制拒绝了本次任务，请核对提示词和参考素材，或联系服务商；本次不会自动重试。"
        : /model[\s\S]*(?:not supported|unsupported)|unsupported[\s\S]*model|model_not_found/i.test(error.message)
        ? `当前视频接口不支持模型 ${model}。请核对视频协议，并按服务商文档选择该接口支持的模型。`
        : /temporarily unavailable|model[\s\S]*(?:unavailable|overloaded)|no available channel|无可用渠道|没有可用渠道/i.test(error.message)
        ? `服务商的视频模型 ${model} 暂时不可用。请稍后重试，或选择其他模型、联系服务商确认通道状态。`
        : "";
      throw new RouteError(`${hint ? `${hint}\n` : ""}${error.message}${taskNote}`, error.statusCode);
    }
    if (timeout.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new RouteError(`Video API timed out.${taskNote}`, 504);
    }
    throw new RouteError(`Could not connect to the video API or download the video.${taskNote}`, 502);
  }
}
