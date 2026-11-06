import { sakiFetch } from "./model-fetch.js";
import { sanitizeSakiVideoGenConfig, type SakiImageModelListResponse } from "@webops/shared";
import { objectValue, RouteError, trimString } from "./types.js";

export async function detectSakiVideoModels(input: unknown): Promise<SakiImageModelListResponse> {
  const config = sanitizeSakiVideoGenConfig(input);
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new RouteError("Video API Base URL is invalid.", 400); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new RouteError("Video API Base URL must be an HTTP(S) URL without credentials or query parameters.", 400);
  }
  const xai = /^(?:api|us\.api)\.x\.ai$/i.test(url.hostname);
  const dashscope = /(?:^|\.)(?:dashscope\.aliyuncs\.com|maas\.aliyuncs\.com)$/i.test(url.hostname);
  const siliconflow = /^api\.siliconflow\.(?:cn|com)$/i.test(url.hostname);
  if (config.protocol === "minimax" && /^(?:api\.minimax\.io|api\.minimaxi\.com)$/i.test(url.hostname)) {
    throw new RouteError("MiniMax does not provide a video model catalog. Enter the model ID manually.", 400);
  }
  let base = url.pathname.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|models|videos(?:\/generations)?|video\/generations|contents\/generations\/tasks|aiproducts\/video\/seedance|services\/aigc\/video-generation\/video-synthesis|v2\/video_generation)$/i, "");
  if (!/\/v\d+(?:beta\d*)?$/i.test(base)) base += config.protocol === "seedance" ? "/api/v3" : config.protocol === "wan" || config.protocol === "cloudwise-seedance" ? "/api/v1" : "/v1";
  url.pathname = `${base}/${xai ? "video-generation-models" : "models"}`;
  if (dashscope) { url.searchParams.set("capabilities", "VG"); url.searchParams.set("page_size", "100"); }
  if (siliconflow) url.searchParams.set("sub_type", "text-to-video");
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const signal = AbortSignal.timeout(25_000);
  const models = new Set<string>();
  const unclassified = new Set<string>();
  let seenRows = 0;
  for (let page = 1; page <= 100; page++) {
    if (dashscope) url.searchParams.set("page_no", String(page));
    let payload: Record<string, unknown> | null;
    try {
      const response = await sakiFetch(url, { headers, signal, redirect: "error" });
      if (!response.ok) { await response.body?.cancel(); throw new RouteError(`Video model list returned HTTP ${response.status}.`, 502); }
      payload = objectValue(await response.json());
    } catch (error) {
      if (error instanceof RouteError) throw error;
      throw new RouteError("Could not read the video model list from this API.", 502);
    }
    const output = objectValue(payload?.output) ?? payload;
    const rows = [output?.data, output?.models, output?.items].find(Array.isArray) as unknown[] | undefined;
    if (!rows) throw new RouteError("This API did not return a model catalog.", 502);
    for (const row of rows) {
      const item = objectValue(row);
      const id = trimString(row) || trimString(item?.id ?? item?.model ?? item?.name);
      if (!id) continue;
      const modalities = item?.output_modalities ?? item?.outputModalities ?? objectValue(item?.architecture)?.output_modalities;
      const capabilities = [item?.type, item?.sub_type, item?.task, item?.capabilities].flat().filter((value) => typeof value === "string");
      const flags = objectValue(item?.capabilities);
      const video = xai || dashscope || siliconflow || flags?.video_generation === true || flags?.text_to_video === true
        || capabilities.some((value) => /^(?:vg|video|video[-_ ]generation|text[-_ ]to[-_ ]video|t2v)$/i.test(value))
        || (Array.isArray(modalities) && modalities.some((value) => /^video(?:\/|$)/i.test(trimString(value))))
        || /seedance|(?:^|[-_/])(?:t2v|i2v|text-to-video)(?:[-_/.]|$)|(?:hailuo|kling|pixverse|sora|veo|video|wan2\.[0-9]+-t2v)|minimax-h3/i.test(id);
      const other = Array.isArray(modalities) && modalities.length > 0 && !modalities.some((value) => /^video(?:\/|$)/i.test(trimString(value)));
      if (!video && other) continue;
      for (const name of [id, ...(Array.isArray(item?.aliases) ? item.aliases.map(trimString).filter(Boolean) : [])]) {
        (video ? models : unclassified).add(name);
      }
    }
    seenRows += rows.length;
    const next = trimString(payload?.nextPageToken ?? payload?.next_page_token);
    if (next && next !== url.searchParams.get("pageToken")) url.searchParams.set("pageToken", next);
    else if (!dashscope || !rows.length || seenRows >= Number(output?.total ?? seenRows)) return {
      models: [...models].sort(), unclassified: [...unclassified].filter((id) => !models.has(id)).sort()
    };
  }
  throw new RouteError("Video model catalog exceeded the pagination limit.", 502);
}
