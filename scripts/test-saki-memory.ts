import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, afterEach } from "node:test";
import { panelPaths } from "../apps/panel/src/config.js";
import { createStreamingTextState, flushStreamingTextState, pushStreamingTextDelta } from "../apps/panel/src/routes/saki/types.js";
import { streamPromptAgentTurnWithFilteredDelta } from "../apps/panel/src/routes/saki/providers/common.js";

// state.ts loads persisted actions on import. Keep these tests away from real data.
const dataDir = await mkdtemp(path.join(tmpdir(), "saki-memory-test-"));
const originalDataDir = panelPaths.dataDir;
panelPaths.dataDir = dataDir;
const state = await import("../apps/panel/src/routes/saki/state.js");
panelPaths.dataDir = originalDataDir;
after(async () => {
  // Allow the empty fixture directories' asynchronous startup reads to finish.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(dataDir, { recursive: true, force: true });
});
afterEach(() => {
  state.activeSakiTasks.clear();
  state.activeSakiTasksByContext.clear();
});

function heapUsed(): number {
  assert.equal(typeof global.gc, "function", "Run with node --expose-gc --import tsx --test");
  global.gc!();
  global.gc!();
  return process.memoryUsage().heapUsed;
}

const chunk = "这是用于诊断流式文本内存保留的测试文字。";
const chunkCount = 3000;
const maxRetainedBytes = 24 * 1024 * 1024;

for (const thinking of [false, true]) {
  test(`${thinking ? "thinking" : "body"} stream retains linear memory while preserving all text`, (t) => {
    const baseline = heapUsed();
    let replay = "";
    // Keep the replay alive, but release the producer before measuring, just as
    // a completed request leaves only its task history behind.
    (() => {
      const stream = createStreamingTextState();
      const receive = (text: string) => { replay += text; };
      for (let i = 0; i < chunkCount; i++) {
        if (thinking) pushStreamingTextDelta(stream, "", () => {}, receive, chunk);
        else pushStreamingTextDelta(stream, chunk, receive);
      }
      flushStreamingTextState(stream, thinking ? () => {} : receive, thinking ? receive : undefined);
    })();
    const retained = heapUsed() - baseline;
    t.diagnostic(`retained heap: ${(retained / 1024 / 1024).toFixed(2)} MiB`);
    assert.ok(retained < maxRetainedBytes, `retained ${retained} bytes for a 60k-character replay`);
    assert.equal(replay, chunk.repeat(chunkCount));
  });
}

test("agent filtering does not retain every earlier full response", async (t) => {
  const baseline = heapUsed();
  let replay = "";
  const turn = await streamPromptAgentTurnWithFilteredDelta(async (onDelta) => {
    for (let i = 0; i < chunkCount; i++) onDelta(chunk);
    return chunk.repeat(chunkCount);
  }, (text) => { replay += text; });
  const retained = heapUsed() - baseline;
  t.diagnostic(`retained heap: ${(retained / 1024 / 1024).toFixed(2)} MiB`);
  assert.ok(retained < maxRetainedBytes, `filtered stream retained ${retained} bytes`);
  assert.equal(replay, chunk.repeat(chunkCount));
  assert.equal(turn.content, replay);
});

test("task replay detaches slices from producers outside the streaming helpers", (t) => {
  const baseline = heapUsed();
  const task = state.createActiveSakiTask("replay", "user", null, { message: "fixture" });
  let subscriberText = "";
  task.subscribers.add((event) => { subscriberText += event.payload.text as string; });
  (() => {
    let accumulated = "";
    for (let i = 0; i < chunkCount; i++) {
      accumulated += chunk;
      // Case conversion flattens the growing rope, reproducing the input that
      // previously left each tiny slice attached to an entire earlier answer.
      const text = accumulated.toLowerCase();
      state.emitActiveSakiTaskEvent(task.id, "delta", { text: text.slice(i * chunk.length) });
    }
  })();
  const retained = heapUsed() - baseline;
  t.diagnostic(`retained heap: ${(retained / 1024 / 1024).toFixed(2)} MiB`);
  assert.ok(retained < maxRetainedBytes, `task replay retained ${retained} bytes`);
  assert.equal(task.eventsBuffer.length, 1);
  assert.equal(task.eventsBuffer[0]!.payload.text, chunk.repeat(chunkCount));
  assert.equal(subscriberText, task.eventsBuffer[0]!.payload.text);
});

test("split surrogate pairs and lone UTF-16 surrogates survive streaming and replay", async () => {
  const chunks = ["中文".repeat(40), "\ud83d", "\ude00", "\ud800", "结尾"];
  const expected = chunks.join("");
  for (const type of ["delta", "thinking"] as const) {
    const task = state.createActiveSakiTask(type, "user", null, { message: "fixture" });
    const receive = (text: string) => state.emitActiveSakiTaskEvent(task.id, type, { text });
    const stream = createStreamingTextState();
    for (const text of chunks) {
      if (type === "thinking") pushStreamingTextDelta(stream, "", () => {}, receive, text);
      else pushStreamingTextDelta(stream, text, receive);
    }
    flushStreamingTextState(stream, type === "delta" ? receive : () => {}, type === "thinking" ? receive : undefined);
    assert.equal(task.eventsBuffer[0]!.payload.text, expected);
  }
  let filtered = "";
  await streamPromptAgentTurnWithFilteredDelta(async (onDelta) => {
    for (const text of chunks) onDelta(text);
    return expected;
  }, (text) => { filtered += text; });
  assert.equal(filtered, expected);
});

test("expired finished tasks are removed without deleting live work or newer context mappings", () => {
  const now = Date.now();
  const old = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const finished = state.createActiveSakiTask("old", "user", "instance", { message: "fixture" });
  finished.status = "completed";
  finished.updatedAt = old;
  const running = state.createActiveSakiTask("running", "user", "instance", { message: "fixture" });
  running.updatedAt = old;
  const approval = state.createActiveSakiTask("approval", "user", "other", { message: "fixture" });
  approval.status = "pending_approval";
  approval.updatedAt = old;
  const recent = state.createActiveSakiTask("recent", "user", null, { message: "fixture" });
  recent.startedAt = old;
  recent.status = "failed";
  const cancelled = state.createActiveSakiTask("cancelled", "user", "cancelled", { message: "fixture" });
  cancelled.status = "cancelled";
  cancelled.updatedAt = old;
  assert.equal(state.pruneExpiredSakiTasks(now), 2);
  assert.equal(state.getActiveSakiTaskById("old"), null);
  assert.equal(state.getActiveSakiTaskById("cancelled"), null);
  assert.equal(state.activeSakiTasksByContext.get("user:instance"), running.id);
  assert.equal(state.activeSakiTasksByContext.has("user:cancelled"), false);
  assert.equal(state.getActiveSakiTaskById("approval"), approval);
  assert.equal(state.getActiveSakiTaskById("recent"), recent);
});

test("maintenance expires completed tasks automatically and can be stopped", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.now() });
  const stop = state.startSakiTaskMaintenance();
  t.after(stop);
  const task = state.createActiveSakiTask("automatic", "user", null, { message: "fixture" });
  task.status = "completed";
  t.mock.timers.tick(61 * 60 * 1000);
  assert.equal(state.getActiveSakiTaskById(task.id), null);
  stop();
  const retained = state.createActiveSakiTask("stopped", "user", null, { message: "fixture" });
  retained.status = "completed";
  t.mock.timers.tick(61 * 60 * 1000);
  assert.equal(state.getActiveSakiTaskById(retained.id), retained);
});
