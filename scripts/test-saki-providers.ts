import assert from "node:assert/strict";
import test from "node:test";
import type { SakiConfigResponse } from "@webops/shared";
import { sakiNvidiaBaseUrl, sakiNvidiaDefaultModel, sakiModelSupportsVision } from "@webops/shared";
import type { SakiAgentRuntime } from "../apps/panel/src/routes/saki/types.js";
import { RouteError, defaultProviderConfig, knownProviderIds } from "../apps/panel/src/routes/saki/types.js";
import { defaultProviderConfig as webDefaultProviderConfig, modelProviderOptions, providerBaseUrlDefaults } from "../apps/web/src/views/settings/settingsHelpers.js";
import { callConfiguredAgentTurn, callConfiguredPrompt, callConfiguredPromptStream } from "../apps/panel/src/routes/saki/providers/dispatcher.js";
import { AnthropicStreamToolCallAccumulator, anthropicAgentStreamDelta } from "../apps/panel/src/routes/saki/providers/anthropic.js";
import { OpenAiStreamToolCallAccumulator } from "../apps/panel/src/routes/saki/providers/openai.js";
import { fetchOpenAiModelCatalog, isToolCallingUnsupportedError } from "../apps/panel/src/routes/saki/providers/catalog.js";

// All network calls are intercepted. No credentials or running model service
// are needed: these fixtures exercise the actual routing/request/stream path.
const providers = ["openai", "nvidia", "deepseek", "zhipu", "gemini", "minimax", "moonshot", "tongyi", "doubao", "custom", "lmstudio", "antigravity", "anthropic", "ollama"];
const args = { path: "plugins/red_packet/config.json", startLine: 1 };
const xml = `<tool_call name="readFile"><path>${args.path}</path><startLine>1</startLine></tool_call>`;

function runtime(provider: string): SakiAgentRuntime {
  const config = {
    provider, model: "fixture-model", baseUrl: "http://fixture.invalid/v1", ollamaUrl: "http://fixture.invalid", apiKey: "fixture-key", requestTimeoutMs: 1000,
    providerConfigs: { antigravity: { mode: "proxy", baseUrl: "http://fixture.invalid/v1", apiKey: "fixture-key" } }
  } as unknown as SakiConfigResponse;
  return {
    config, input: { message: "Read the red packet plugin file", mode: "agent" }, skills: [], permissions: [], userId: "fixture-user",
    context: { instance: null, workspace: { instanceId: "fixture-instance", instanceName: "fixture", nodeName: "fixture-node", workingDirectory: "/instances/fixture", status: "STOPPED" }, logs: [] },
    turnMessages: [
      { role: "user", content: "Change the red packet title" },
      { role: "assistant", content: "", toolCalls: [{ id: "previous-call", name: "readFile", args: { path: "README.md" } }] },
      { role: "tool", toolCallId: "previous-call", name: "readFile", content: "1: Plugin configuration is in plugins/red_packet/config.json" },
      { role: "user", content: "Continue with that configuration" }
    ]
  } as SakiAgentRuntime;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function nvidiaRuntime(): SakiAgentRuntime {
  const fixture = runtime("nvidia");
  fixture.config.model = sakiNvidiaDefaultModel;
  fixture.config.baseUrl = ""; // Resolve the registered default endpoint.
  return fixture;
}

test("NVIDIA: frontend and backend register matching defaults and Omni vision capability", () => {
  assert.ok(knownProviderIds.includes("nvidia"));
  assert.ok(modelProviderOptions.some((option) => option.value === "nvidia"));
  assert.deepEqual(defaultProviderConfig("nvidia"), webDefaultProviderConfig("nvidia"));
  assert.deepEqual(defaultProviderConfig("nvidia"), { enabled: false, model: sakiNvidiaDefaultModel, baseUrl: sakiNvidiaBaseUrl, apiKey: "" });
  assert.equal(providerBaseUrlDefaults.nvidia, sakiNvidiaBaseUrl);
  assert.equal(sakiModelSupportsVision(sakiNvidiaDefaultModel, "nvidia"), true);
  assert.equal(sakiModelSupportsVision("nvidia/text-only-model", "nvidia"), false);
});

for (const streaming of [false, true]) {
  for (const fallback of [false, true]) {
    test(`NVIDIA Nemotron: ${streaming ? "stream" : "JSON"} ${fallback ? "fallback" : "native tools"} uses the supplied inference defaults`, async (t) => {
      t.mock.method(console, "info", () => {});
      const requests: Record<string, any>[] = [];
      t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
        assert.equal(url, `${sakiNvidiaBaseUrl}/chat/completions`);
        const headers = new Headers(options.headers);
        assert.equal(headers.get("authorization"), "Bearer fixture-key");
        assert.equal(headers.get("accept"), streaming ? "text/event-stream" : "application/json");
        const body = JSON.parse(options.body as string);
        requests.push(body);
        assert.equal(body.model, sakiNvidiaDefaultModel);
        assert.equal(body.max_tokens, 65536);
        assert.equal(body.reasoning_budget, 16384);
        assert.equal(body.temperature, 0.6);
        assert.equal(body.top_p, 0.95);
        if (fallback && body.tools) return json({ error: { message: "This model does not support tools" } }, 400);
        return fallback ? fallbackResponse("nvidia", streaming) : nativeResponse("nvidia", streaming);
      });
      const turn = await callConfiguredAgentTurn(nvidiaRuntime(), "fixture", streaming ? () => {} : undefined);
      assert.equal(requests.length, fallback ? 2 : 1);
      assert.equal(turn.toolCalls[0]!.name, "readFile");
    });
  }

  test(`NVIDIA Nemotron: ${streaming ? "stream" : "JSON"} ordinary chat sends image content and displays reasoning separately`, async (t) => {
    t.mock.method(console, "info", () => {});
    const fixture = nvidiaRuntime();
    const imageUrl = "data:image/png;base64,fixture";
    fixture.input = { message: "Describe this image", attachments: [{ kind: "image", name: "fixture.png", mimeType: "image/png", dataUrl: imageUrl }] };
    t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
      assert.equal(url, `${sakiNvidiaBaseUrl}/chat/completions`);
      const body = JSON.parse(options.body as string);
      assert.equal(body.tools, undefined);
      assert.equal(body.max_tokens, 65536);
      assert.equal(body.reasoning_budget, 16384);
      assert.equal(body.temperature, 0.6);
      assert.equal(body.top_p, 0.95);
      assert.ok(body.messages.some((message: any) => Array.isArray(message.content) && message.content.some((part: any) => part.image_url?.url === imageUrl)));
      return streaming ? stream([
        { choices: [{ delta: { reasoning_content: "Inspecting the image" } }] },
        { choices: [{ delta: { content: "A picture" } }] }
      ]) : json({ choices: [{ message: { reasoning_content: "Inspecting the image", content: "A picture" } }] });
    });
    const deltas: string[] = [];
    const thoughts: string[] = [];
    const text = streaming
      ? await callConfiguredPromptStream(fixture.input, "fixture", (delta) => deltas.push(delta), fixture.config, (delta) => thoughts.push(delta))
      : await callConfiguredPrompt(fixture.input, "fixture", fixture.config);
    assert.equal(text, "A picture");
    if (streaming) {
      assert.equal(deltas.join(""), "A picture");
      assert.equal(thoughts.join(""), "Inspecting the image");
    }
  });

  test(`NVIDIA: ${streaming ? "stream" : "JSON"} an optional reasoning-budget rejection keeps native tools`, async (t) => {
    t.mock.method(console, "info", () => {});
    let attempts = 0;
    t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
      attempts += 1;
      const body = JSON.parse(options.body as string);
      assert.ok(body.tools.some((tool: any) => tool.function.name === "readFile"));
      if ("reasoning_budget" in body) return json({ error: { message: "Unsupported parameter reasoning_budget" } }, 400);
      return nativeResponse("nvidia", streaming);
    });
    const turn = await callConfiguredAgentTurn(nvidiaRuntime(), "fixture", streaming ? () => {} : undefined);
    assert.equal(attempts, 2);
    assert.deepEqual(turn.toolCalls[0]!.args, args);
  });
}

test("NVIDIA: other hosted models do not inherit Nemotron-specific parameters", async (t) => {
  t.mock.method(console, "info", () => {});
  const fixture = runtime("nvidia");
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.reasoning_budget, undefined);
    assert.equal(body.top_p, undefined);
    assert.equal(body.temperature, 0.2);
    return nativeResponse("nvidia", false);
  });
  await callConfiguredAgentTurn(fixture, "fixture");
});

test("NVIDIA: model synchronization authenticates and recognizes the Omni model", async (t) => {
  t.mock.method(console, "info", () => {});
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, `${sakiNvidiaBaseUrl}/models`);
    assert.equal(new Headers(options.headers).get("authorization"), "Bearer fixture-key");
    return json({ data: [{ id: sakiNvidiaDefaultModel, owned_by: "nvidia" }] });
  });
  const models = await fetchOpenAiModelCatalog("nvidia", nvidiaRuntime().config);
  assert.equal(models.length, 1);
  assert.equal(models[0]!.provider, "nvidia");
  assert.equal(models[0]!.id, sakiNvidiaDefaultModel);
  assert.equal(models[0]!.supportsVision, true);
});

function stream(payloads: unknown[], ndjson = false): Response {
  const text = payloads.map((payload) => ndjson ? `${JSON.stringify(payload)}\n` : `data: ${JSON.stringify(payload)}\n\n`).join("");
  // Split frames and UTF-8 text across arbitrary byte boundaries, as a real
  // transport can. The provider must reconstruct complete frames correctly.
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 13) controller.enqueue(bytes.slice(offset, offset + 13));
    controller.close();
  } }), { headers: { "content-type": ndjson ? "application/x-ndjson" : "text/event-stream" } });
}

function nativeResponse(provider: string, streaming: boolean): Response {
  if (provider === "ollama") {
    const calls = [{ function: { index: 0, name: "readFile", arguments: args } }, { function: { index: 1, name: "readFile", arguments: { ...args, path: "plugins/another.json" } } }];
    return streaming
      ? stream([{ message: { content: "", tool_calls: calls.slice(0, 1) } }, { message: { content: "", tool_calls: calls.slice(1) } }, { done: true }], true)
      : json({ message: { content: "", tool_calls: calls } });
  }
  if (provider === "anthropic") {
    return streaming
      ? stream([
          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call-new", name: "readFile", input: {} } },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args).slice(0, 23) } },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args).slice(23) } },
          { type: "content_block_stop", index: 0 }, { type: "message_stop" }
        ])
      : json({ content: [{ type: "tool_use", id: "call-new", name: "readFile", input: args }] });
  }
  return streaming
    ? stream([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-new", function: { name: "readFile", arguments: JSON.stringify(args).slice(0, 23) } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(23) } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
      ])
    : json({ choices: [{ message: { content: null, tool_calls: [{ id: "call-new", type: "function", function: { name: "readFile", arguments: JSON.stringify(args) } }] } }] });
}

function fallbackResponse(provider: string, streaming: boolean): Response {
  if (!streaming) return provider === "ollama" ? json({ message: { content: xml } }) : provider === "anthropic" ? json({ content: [{ type: "text", text: xml }] }) : json({ choices: [{ message: { content: xml } }] });
  const fragments = Array.from({ length: Math.ceil(xml.length / 11) }, (_, index) => xml.slice(index * 11, (index + 1) * 11));
  if (provider === "ollama") return stream(fragments.map((content) => ({ message: { content } })), true);
  if (provider === "anthropic") return stream(fragments.map((text) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })));
  return stream(fragments.map((content) => ({ choices: [{ delta: { content } }] })));
}

for (const provider of providers) {
  for (const streaming of [false, true]) {
    test(`${provider}: ${streaming ? "stream" : "JSON"} registers native tools and preserves tool observations`, async (t) => {
      t.mock.method(console, "info", () => {});
      const requests: Record<string, any>[] = [];
      t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
        requests.push(JSON.parse(options.body as string));
        return nativeResponse(provider, streaming);
      });
      const deltas: string[] = [];
      const turn = await callConfiguredAgentTurn(runtime(provider), "fallback prompt", streaming ? (text) => deltas.push(text) : undefined);
      assert.equal(requests.length, 1);
      const request = requests[0]!;
      assert.ok(request.tools.some((tool: any) => (tool.name ?? tool.function?.name) === "readFile"));
      assert.match(JSON.stringify(request), /\/instances\/fixture/);
      assert.match(JSON.stringify(request.messages), /Plugin configuration is in/);
      assert.equal(turn.toolCalls[0]!.name, "readFile");
      assert.deepEqual(turn.toolCalls[0]!.args, args);
      assert.equal(turn.content, "");
      assert.equal(deltas.join(""), "");
      if (provider === "ollama") {
        assert.equal(turn.toolCalls.length, 2);
        const priorCall = request.messages.find((message: any) => message.tool_calls)?.tool_calls[0];
        assert.deepEqual(priorCall.function.arguments, { path: "README.md" });
        assert.equal(request.messages.find((message: any) => message.role === "tool").tool_name, "readFile");
      }
    });

    test(`${provider}: ${streaming ? "stream" : "JSON"} fallback keeps tool schemas, workspace and execution history`, async (t) => {
      t.mock.method(console, "info", () => {});
      const requests: Record<string, any>[] = [];
      t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
        const body = JSON.parse(options.body as string);
        requests.push(body);
        return body.tools ? json({ error: { message: "This model does not support tools" } }, 400) : fallbackResponse(provider, streaming);
      });
      const deltas: string[] = [];
      const turn = await callConfiguredAgentTurn(runtime(provider), "fallback prompt", streaming ? (text) => deltas.push(text) : undefined);
      assert.equal(requests.length, 2);
      const request = requests[1]!;
      assert.equal(request.tools, undefined);
      const system = request.system ?? request.messages.find((message: any) => message.role === "system")?.content;
      assert.match(system, /Available Saki tools/);
      assert.match(system, /"name":"readFile"/);
      assert.match(system, /"required":\["path"\]/);
      assert.match(system, /\/instances\/fixture/);
      assert.match(JSON.stringify(request.messages), /Observation \(readFile\)/);
      assert.match(JSON.stringify(request.messages), /Plugin configuration is in/);
      assert.ok(!request.messages.some((message: any) => message.role === "tool" || message.tool_calls));
      assert.equal(turn.toolCalls[0]!.name, "readFile");
      assert.deepEqual(turn.toolCalls[0]!.args, { ...args, startLine: "1" });
      assert.equal(deltas.join(""), "");
    });
  }
}

test("Antigravity direct mode reaches the Google-compatible route with native tools", async (t) => {
  t.mock.method(console, "info", () => {});
  const fixture = runtime("antigravity");
  fixture.config.providerConfigs = { antigravity: { mode: "direct", apiKey: "AIzaSy-fixture" } };
  let endpoint = "";
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    endpoint = url;
    assert.ok(JSON.parse(options.body as string).tools.length > 0);
    return nativeResponse("gemini", true);
  });
  const turn = await callConfiguredAgentTurn(fixture, "fixture", () => {});
  assert.match(endpoint, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/);
  assert.equal(turn.toolCalls[0]!.name, "readFile");
});

test("unrelated errors never silently turn native tools off", () => {
  for (const error of [
    new RouteError("Unknown parameter temperature", 400),
    new RouteError("Unknown parameter enable_thinking", 400),
    new RouteError("Invalid schema for tool readFile", 400),
    new RouteError("Tool backend authorization failed", 401),
    new RouteError("Tool calling rate limit", 429),
    new RouteError("Tool server unavailable", 502)
  ]) assert.equal(isToolCallingUnsupportedError(error), false, error.message);
  for (const message of ["tools are not supported", "This model does not support tools", "Unknown parameter: tools", "Unrecognized request argument tool_choice", "Function calling is not available"])
    assert.equal(isToolCallingUnsupportedError(new RouteError(message, 400)), true, message);
});

test("Claude preserves whitespace inside fragmented code and tool JSON", () => {
  const accumulator = new AnthropicStreamToolCallAccumulator();
  accumulator.ingest({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "write", name: "writeFile", input: {} } });
  const fragments = ['{"path":"plugin.py","content":"', '  title = ', "'天降洪福'", '  "}'];
  for (const partial_json of fragments) accumulator.ingest({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json } });
  assert.equal(accumulator.toParsedToolCalls()[0]!.args.content, "  title = '天降洪福'  ");
  assert.equal(anthropicAgentStreamDelta({ type: "content_block_delta", delta: { text: "  indented code \n" } }).content, "  indented code \n");
  const complete = new AnthropicStreamToolCallAccumulator();
  complete.ingest({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "read", name: "readFile", input: args } });
  assert.deepEqual(complete.toParsedToolCalls()[0]!.args, args);
});

test("OpenAI-compatible streams keep multiple interleaved calls separate", () => {
  const accumulator = new OpenAiStreamToolCallAccumulator();
  accumulator.ingest([{ index: 0, id: "a", function: { name: "readFile", arguments: '{"path":"a' } }, { index: 1, id: "b", function: { name: "readFile", arguments: '{"path":"b' } }]);
  accumulator.ingest([{ index: 1, function: { arguments: '.py"}' } }, { index: 0, function: { arguments: '.py"}' } }]);
  assert.deepEqual(accumulator.toParsedToolCalls().map((call) => call.args.path), ["a.py", "b.py"]);
});

const reasoning = "  Need this plugin configuration. \n";
const extraContent = { google: { thought_signature: "fixture-signature==" } };
const thinkingBlock = { type: "thinking", thinking: reasoning, signature: "signed-block==" };
const redactedBlock = { type: "redacted_thinking", data: "opaque-data==" };

function protocolResponse(provider: string, streaming: boolean): Response {
  if (provider === "anthropic") {
    const tool = { type: "tool_use", id: "next-call", name: "readFile", input: args };
    return streaming ? stream([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: reasoning } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signed-" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "block==" } },
      { type: "content_block_start", index: 1, content_block: redactedBlock },
      { type: "content_block_start", index: 2, content_block: { ...tool, input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } }
    ]) : json({ content: [thinkingBlock, redactedBlock, tool] });
  }
  if (provider === "ollama") {
    const message = { thinking: reasoning, content: "", tool_calls: [{ function: { name: "readFile", arguments: args } }] };
    return streaming ? stream([{ message }], true) : json({ message });
  }
  const call = { id: "next-call", type: "function", function: { name: "readFile", arguments: JSON.stringify(args) }, ...(provider === "gemini" ? { extra_content: extraContent } : {}) };
  return streaming ? stream([
    ...(provider === "deepseek" ? [
      { choices: [{ delta: { reasoning_content: reasoning.slice(0, 6) } }] },
      { choices: [{ delta: { reasoning_content: reasoning.slice(6) } }] }
    ] : []),
    { choices: [{ delta: { tool_calls: [{ ...call, index: 0, extra_content: undefined, function: { name: call.function.name, arguments: call.function.arguments.slice(0, 25) } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: call.function.arguments.slice(25) } }] } }] },
    ...(provider === "gemini" ? [{ choices: [{ delta: { tool_calls: [{ index: 0, extra_content: extraContent }] } }] }] : [])
  ]) : json({ choices: [{ message: { content: null, tool_calls: [call], ...(provider === "deepseek" ? { reasoning_content: reasoning } : {}) } }] });
}

for (const provider of ["deepseek", "anthropic", "gemini", "ollama"]) {
  for (const streaming of [false, true]) {
    test(`${provider}: ${streaming ? "stream" : "JSON"} preserves protocol state in the next tool round`, async (t) => {
      t.mock.method(console, "info", () => {});
      const fixture = runtime(provider);
      fixture.turnMessages = [{ role: "user", content: "Read the plugin" }];
      const requests: Record<string, any>[] = [];
      t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
        requests.push(JSON.parse(options.body as string));
        return protocolResponse(provider, streaming);
      });
      const deltas: string[] = [];
      const first = await callConfiguredAgentTurn(fixture, "fixture", streaming ? (text) => deltas.push(text) : undefined);
      assert.equal(deltas.join(""), "");
      fixture.turnMessages.push({ role: "assistant", content: first.content, toolCalls: first.toolCalls, ...(first.assistantState ? { assistantState: first.assistantState } : {}) });
      fixture.turnMessages.push({ role: "tool", toolCallId: first.toolCalls[0]!.id, name: "readFile", content: "configuration contents" });
      await callConfiguredAgentTurn(fixture, "fixture", streaming ? () => {} : undefined);
      const assistant = requests[1]!.messages.find((message: any) => message.role === "assistant");
      if (provider === "deepseek") assert.equal(assistant.reasoning_content, reasoning);
      if (provider === "ollama") assert.equal(assistant.thinking, reasoning);
      if (provider === "gemini") assert.deepEqual(assistant.tool_calls[0].extra_content, extraContent);
      if (provider === "anthropic") {
        assert.deepEqual(assistant.content.slice(0, 2), [thinkingBlock, redactedBlock]);
        assert.equal(assistant.content[2].type, "tool_use");
      }
    });
  }
}

for (const streaming of [false, true]) {
  test(`compatible gateway: ${streaming ? "stream" : "JSON"} removes rejected optional parameters in succession without dropping tools`, async (t) => {
    t.mock.method(console, "info", () => {});
    const fixture = runtime("custom");
    fixture.config.model = streaming ? "qwen3-stream-fixture" : "qwen3-json-fixture";
    const requests: Record<string, any>[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      requests.push(body);
      if ("stream_options" in body) return json({ error: { message: "Unknown parameter stream_options" } }, 400);
      if ("enable_thinking" in body) return json({ error: { message: "Unsupported parameter enable_thinking" } }, 400);
      if ("temperature" in body) return json({ error: { message: "Unsupported temperature for this model" } }, 400);
      return nativeResponse("custom", streaming);
    });
    const turn = await callConfiguredAgentTurn(fixture, "fixture", streaming ? () => {} : undefined);
    assert.equal(requests.length, streaming ? 4 : 3);
    assert.ok(requests.every((request) => request.tools.some((tool: any) => tool.function.name === "readFile")));
    assert.deepEqual(turn.toolCalls[0]!.args, args);
  });
}
