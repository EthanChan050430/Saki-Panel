import {
  defaultSakiImageGenConfig,
  parseSakiImageGenAspectRatio,
  parseSakiImageGenQuality,
  resolveSakiImageSize,
  sanitizeSakiImageGenConfig,
  sakiImageGenPreset
} from "../packages/shared/src/index.ts";
import {
  buildOpenAiImagesBody,
  imageGenerationEndpoint,
  isSakiImageOutputPath,
  normalizeSakiImageOutputPath,
  parseGeneratedImagePayload
} from "../apps/panel/src/routes/saki/image-gen.ts";
import { canonicalToolSchema, toolSchemasForRuntime } from "../apps/panel/src/routes/saki/tools.ts";
import type { SakiAgentRuntime } from "../apps/panel/src/routes/saki/types.ts";
import { defaultSakiImageGenConfig as panelDefault } from "../packages/shared/src/index.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const empty = sanitizeSakiImageGenConfig(undefined);
assert(empty.enabled === false, "image gen defaults to disabled");
assert(empty.provider === "sd-webui", "default provider is local SD WebUI");
assert(empty.protocol === "sd-webui", "default protocol is sd-webui");
assert(empty.baseUrl.includes("7860"), "default SD URL is localhost:7860");

const openai = sanitizeSakiImageGenConfig({
  enabled: true,
  provider: "openai",
  apiKey: " sk-test ",
  defaultAspectRatio: "16:9",
  defaultQuality: "hd"
});
assert(openai.enabled === true, "enabled is preserved");
assert(openai.protocol === "openai-images", "openai preset uses openai-images protocol");
assert(openai.baseUrl === "https://api.openai.com/v1", "openai preset fills official URL");
assert(openai.model === "dall-e-3", "openai preset fills default model");
assert(openai.apiKey === "sk-test", "api key is trimmed");
assert(openai.defaultAspectRatio === "16:9", "aspect ratio is kept");
assert(openai.defaultQuality === "hd", "quality is kept");
assert(openai.defaultWidth > openai.defaultHeight, "16:9 hd is landscape");

const custom = sanitizeSakiImageGenConfig({
  enabled: true,
  provider: "custom",
  protocol: "sd-webui",
  baseUrl: "http://192.168.1.8:7860",
  apiKey: "",
  model: "sdxl"
});
assert(custom.protocol === "sd-webui", "custom can use sd-webui protocol");
assert(custom.baseUrl === "http://192.168.1.8:7860", "custom URL is kept");

assert(sakiImageGenPreset("xai").baseUrl === "https://api.x.ai/v1", "xAI preset URL");
assert(sakiImageGenPreset("xai").model.includes("grok-imagine"), "xAI default model is grok imagine");
assert(parseSakiImageGenQuality("2k") === "hd", "2k maps to hd");
assert(parseSakiImageGenQuality("low") === "draft", "low maps to draft");
assert(parseSakiImageGenAspectRatio("16:9") === "16:9", "exact aspect ratio");
assert(parseSakiImageGenAspectRatio("1.78:1") === "16:9", "numeric ratio snaps to nearest preset");

const square = resolveSakiImageSize({
  aspectRatio: "1:1",
  quality: "standard",
  defaults: defaultSakiImageGenConfig
});
assert(square.width === 1024 && square.height === 1024, "standard 1:1 is 1024");

const explicit = resolveSakiImageSize({ width: 768, height: 512, quality: "draft" });
assert(explicit.width === 768 && explicit.height === 512, "explicit width/height win");
assert(explicit.aspectRatio === "3:2", "explicit size infers 3:2");

const sdUrl = imageGenerationEndpoint({
  ...panelDefault,
  enabled: true,
  protocol: "sd-webui",
  baseUrl: "http://127.0.0.1:7860/"
});
assert(sdUrl === "http://127.0.0.1:7860/sdapi/v1/txt2img", "SD WebUI endpoint is txt2img");

const openAiUrl = imageGenerationEndpoint({
  ...openai,
  protocol: "openai-images",
  baseUrl: "https://api.openai.com/v1"
});
assert(openAiUrl.endsWith("/images/generations"), "OpenAI endpoint is images/generations");

const customNoVersion = imageGenerationEndpoint({
  ...openai,
  provider: "custom",
  protocol: "openai-images",
  baseUrl: "https://llmapi.paratera.com"
});
assert(
  customNoVersion === "https://llmapi.paratera.com/v1/images/generations",
  "custom OpenAI-compatible URL without /v1 still hits /v1/images/generations"
);

const xaiUrl = imageGenerationEndpoint({
  ...openai,
  provider: "xai",
  protocol: "openai-images",
  baseUrl: "https://api.x.ai/v1"
});
assert(xaiUrl === "https://api.x.ai/v1/images/generations", "xAI endpoint is OpenAI-compatible");

const geminiUrl = imageGenerationEndpoint({
  ...openai,
  provider: "gemini",
  protocol: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: "imagen-4.0-generate-001"
});
assert(geminiUrl.includes("/models/imagen-4.0-generate-001:predict"), "Gemini endpoint uses predict");

const customBody = buildOpenAiImagesBody(
  sanitizeSakiImageGenConfig({
    enabled: true,
    provider: "custom",
    protocol: "openai-images",
    baseUrl: "https://llmapi.paratera.com",
    model: "Doubao-Seedream-4.0"
  }),
  "想要图片的内容描述",
  resolveSakiImageSize({ aspectRatio: "16:9", quality: "draft" })
);
assert(customBody.model === "Doubao-Seedream-4.0", "custom body sends model");
assert(customBody.prompt === "想要图片的内容描述", "custom body sends prompt");
assert(!("response_format" in customBody), "custom gateway body does not request b64_json");
assert(!("n" in customBody), "custom gateway body matches vendor sample without n");
assert(typeof customBody.size === "string", "custom body still sends size for aspect ratio");

const png = parseGeneratedImagePayload({
  protocol: "openai-images",
  contentType: "application/json",
  text: JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo", revised_prompt: "a cat" }] }),
  bytes: new Uint8Array()
});
assert(png.base64 === "iVBORw0KGgo", "parses OpenAI b64_json");
assert(png.mimeType === "image/png", "sniffs PNG from b64");
assert(png.revisedPrompt === "a cat", "keeps revised prompt");

const sd = parseGeneratedImagePayload({
  protocol: "sd-webui",
  contentType: "application/json",
  text: JSON.stringify({ images: ["iVBORw0KGgoAAA"] }),
  bytes: new Uint8Array()
});
assert(sd.base64.startsWith("iVBORw0KGgo"), "parses SD WebUI images[]");

const gemini = parseGeneratedImagePayload({
  protocol: "gemini",
  contentType: "application/json",
  text: JSON.stringify({ predictions: [{ bytesBase64Encoded: "iVBORw0KGgo", mimeType: "image/png" }] }),
  bytes: new Uint8Array()
});
assert(gemini.base64 === "iVBORw0KGgo", "parses Gemini predictions");

const urlOnly = parseGeneratedImagePayload({
  protocol: "openai-images",
  contentType: "application/json",
  text: JSON.stringify({ data: [{ url: "https://cdn.example.com/a.png" }] }),
  bytes: new Uint8Array()
});
assert(urlOnly.url === "https://cdn.example.com/a.png", "parses URL-only OpenAI responses");

assert(isSakiImageOutputPath("assets/hero.png") === true, "png path is accepted");
assert(isSakiImageOutputPath("readme.md") === false, "non-image path is rejected");
assert(normalizeSakiImageOutputPath("assets/hero", "png") === "assets/hero.png", "appends png when missing");
assert(normalizeSakiImageOutputPath("assets/hero.PNG", "jpg") === "assets/hero.PNG", "keeps existing image extension");

const schema = canonicalToolSchema("drawImage");
assert(schema?.name === "generateImage", "drawImage aliases generateImage");

const disabledRuntime = {
  input: { message: "draw a logo", mode: "agent" },
  config: { searchEnabled: true, imageGen: sanitizeSakiImageGenConfig({ enabled: false }), provider: "ollama", model: "llama3" },
  skills: [],
  usedToolNames: []
} as unknown as SakiAgentRuntime;
assert(
  !toolSchemasForRuntime(disabledRuntime).some((item) => item.name === "generateImage"),
  "generateImage is hidden when disabled"
);

const enabledRuntime = {
  input: { message: "fix the bug", mode: "agent" },
  config: { searchEnabled: true, imageGen: sanitizeSakiImageGenConfig({ enabled: true, provider: "openai" }), provider: "ollama", model: "llama3" },
  skills: [],
  usedToolNames: []
} as unknown as SakiAgentRuntime;
assert(
  toolSchemasForRuntime(enabledRuntime).some((item) => item.name === "generateImage"),
  "generateImage is advertised when enabled even if the user did not mention drawing"
);

const generateSchema = canonicalToolSchema("generateImage");
assert(generateSchema?.parameters && !((generateSchema.parameters as { required?: string[] }).required ?? []).includes("path"), "generateImage path is optional so chat mode can display without saving a file");

const chatRuntime = {
  input: { message: "画一只猫", mode: "chat" },
  config: { searchEnabled: true, imageGen: sanitizeSakiImageGenConfig({ enabled: true, provider: "openai" }), provider: "ollama", model: "llama3" },
  skills: [],
  usedToolNames: [],
  toolProfile: "chat"
} as unknown as SakiAgentRuntime;
const chatTools = toolSchemasForRuntime(chatRuntime).map((item) => item.name);
assert(chatTools.includes("generateImage"), "chat profile advertises generateImage");
assert(!chatTools.includes("writeFile"), "chat profile does not advertise writeFile");
assert(!chatTools.includes("runCommand"), "chat profile does not advertise runCommand");

if (process.exitCode) {
  console.error("image generation tests failed");
  process.exit(1);
}
console.log("image generation tests passed");
