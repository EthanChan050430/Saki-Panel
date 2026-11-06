import { sakiFetch } from "./model-fetch.js";
import { sanitizeSakiImageGenConfig, type SakiImageModelListResponse } from "@webops/shared";
import { imageGenerationEndpoint } from "./image-gen.js";
import { objectValue, RouteError, trimString } from "./types.js";

function modelRows(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const item = objectValue(value);
  return [item?.data, item?.models, item?.items].find(Array.isArray) as unknown[] | undefined;
}

function classifyModel(id: string, model: Record<string, unknown> | null): "image" | "other" | "unknown" {
  const architecture = objectValue(model?.architecture);
  const modalities = model?.output_modalities ?? model?.outputModalities ?? architecture?.output_modalities;
  const capabilities = [model?.type, model?.sub_type, model?.modality, model?.task, model?.capabilities,
    model?.supported_endpoints, model?.supportedGenerationMethods].flat().filter((item) => typeof item === "string");
  const flags = objectValue(model?.capabilities);
  if (flags?.image_generation === true || flags?.text_to_image === true || flags?.imageGeneration === true
    || capabilities.some((item) => /^(?:image|ig|image[-_ ]generation|text[-_ ]to[-_ ]image|t2i|generateImages|\/?(?:v\d+\/)?images\/generations)$/i.test(item))) return "image";
  if (Array.isArray(modalities) && modalities.length) {
    return modalities.some((item) => /^image(?:\/|$)/i.test(trimString(item))) ? "image" : "other";
  }
  if (/(?:^|[/_-])(?:dall-e|gpt-image|imagen|seedream|cogview|flux|stable[-_. ]?diffusion|sdxl|sd3|ideogram|recraft|t2i|text-to-image|nano-banana)(?:\b|\d|_)/i.test(id)
    || /(?:gemini|grok-imagine|glm|qwen|wan)[\w.-]*-image(?:\b|_)/i.test(id)) return "image";
  if (capabilities.some((item) => /^(?:chat|text|llm|embedding|rerank|audio|video|tts|asr)$/i.test(item))
    || /^(?:gpt-(?:3\.5|4|5)|chatgpt-|claude-|deepseek-|text-embedding-|o[134](?:-|$))|embedding|rerank|seedance|(?:^|[-_])(?:t2v|i2v|tts|asr|whisper|video)(?:[-_]|$)/i.test(id)) return "other";
  return "unknown";
}

export async function detectSakiImageModels(input: unknown): Promise<SakiImageModelListResponse> {
  const config = sanitizeSakiImageGenConfig(input);
  const url = new URL(imageGenerationEndpoint(config));
  const protocol = config.protocol;
  const isXai = protocol === "openai-images" && /^(?:api|us\.api)\.x\.ai$/i.test(url.hostname);
  const siliconFlow = protocol === "openai-images" && /^api\.siliconflow\.(?:cn|com)$/i.test(url.hostname);
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.apiKey) headers[protocol === "gemini" ? "x-goog-api-key" : "authorization"] =
    protocol === "gemini" ? config.apiKey : `Bearer ${config.apiKey}`;

  if (protocol === "sd-webui") url.pathname = url.pathname.replace(/\/sdapi\/v1\/.*$/i, "/sdapi/v1/sd-models");
  else if (protocol === "gemini") url.pathname = url.pathname.replace(/\/models\/.*$/i, "/models");
  else if (protocol === "dashscope") {
    url.pathname = url.pathname.replace(/\/services\/.*$/i, "/models");
    url.searchParams.set("capabilities", "IG");
    url.searchParams.set("page_size", "100");
  } else if (protocol === "stability") {
    throw new RouteError("Stability Stable Image v2beta does not provide a model list. Enter core, sd3, or ultra.", 400);
  } else {
    url.pathname = url.pathname.replace(/\/images\/generations\/?$/i, isXai ? "/image-generation-models" : "/models");
    if (siliconFlow) url.searchParams.set("sub_type", "text-to-image");
  }

  const models = new Set<string>();
  const unclassified = new Set<string>();
  const dedicated = isXai || siliconFlow || protocol === "sd-webui" || protocol === "dashscope";
  const signal = AbortSignal.timeout(25_000);
  for (let page = 1; ; page++) {
    if (protocol === "dashscope") url.searchParams.set("page_no", String(page));
    let payload: unknown;
    try {
      const response = await sakiFetch(url, { headers, signal, redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        throw new RouteError(`Image model list returned HTTP ${response.status}.`, 502);
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof RouteError) throw error;
      throw new RouteError("Could not read the image model list from this API.", 502);
    }
    const result = objectValue(payload);
    const output = objectValue(result?.output) ?? result;
    const rows = modelRows(output ?? payload);
    if (!rows) throw new RouteError("This API did not return a model catalog.", 502);
    let processed = 0;
    for (const row of rows) {
      const model = objectValue(row);
      const rawId = trimString(row) || trimString(protocol === "sd-webui" ? model?.title : model?.id ?? model?.model ?? model?.name);
      const id = protocol === "gemini" ? rawId.replace(/^models\//, "") : rawId;
      if (!id) continue;
      const category = dedicated ? "image" : classifyModel(id, model);
      const aliases = Array.isArray(model?.aliases) ? model.aliases.map(trimString).filter(Boolean) : [];
      for (const name of [id, ...aliases]) {
        if (!models.has(name) && !unclassified.has(name)) processed++;
        if (category === "image") models.add(name);
        if (category === "unknown") unclassified.add(name);
      }
    }
    const nextToken = trimString(result?.nextPageToken ?? result?.next_page_token);
    if (nextToken && nextToken !== url.searchParams.get("pageToken")) {
      url.searchParams.set("pageToken", nextToken);
    } else if (protocol !== "dashscope" || !processed || page * (Number(output?.page_size) || rows.length) >= Number(output?.total ?? 0)) {
      break;
    }
    if (page >= 100) throw new RouteError("Image model catalog exceeded the pagination limit.", 502);
  }
  return { models: [...models].sort(), unclassified: [...unclassified].filter((model) => !models.has(model)).sort() };
}
