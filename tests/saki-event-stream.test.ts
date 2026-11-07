import assert from "node:assert/strict";
import test from "node:test";
import { fetchSakiStreamResponse, readSakiEventFrames } from "../apps/web/src/components/saki/saki-event-stream.js";

const encoder = new TextEncoder();

test("SSE preserves split UTF-8, CRLF boundaries and the final unterminated frame", async () => {
  const bytes = encoder.encode("data: 中文\r\n\r\ndata: end");
  const frames: string[] = [];
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  await readSakiEventFrames(stream, frame => { frames.push(frame); return true; });
  assert.deepEqual(frames, ["data: 中文", "data: end"]);
  assert.equal(stream.locked, false);
});

test("terminal event cancels an HTTP body that stays open", async () => {
  let cancelled = false;
  const frames: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode("data: done\n\ndata: obsolete\n\n")); },
    cancel() { cancelled = true; }
  });
  await readSakiEventFrames(stream, frame => { frames.push(frame); return false; });
  assert.deepEqual(frames, ["data: done"]);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("idle connections and explicit aborts cancel only the observer", async () => {
  for (const abort of [false, true]) {
    let cancelled = false;
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const reading = readSakiEventFrames(stream, () => true, controller.signal, 15);
    if (abort) controller.abort(new Error("observer stopped"));
    await assert.rejects(reading, abort ? /observer stopped/ : /长时间未响应/);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  }
});

test("large reconnect snapshots and many frames arrive without loss", async () => {
  const snapshot = `data: ${"x".repeat(2_000_000)}`;
  let count = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoder.encode(`${snapshot}\n\n${"data: delta\n\n".repeat(10000)}`));
    controller.close();
  } });
  await readSakiEventFrames(stream, frame => {
    if (count === 0) assert.equal(frame, snapshot);
    count++;
    return true;
  });
  assert.equal(count, 10001);
});

test("response-header timeout and caller cancellation abort fetch, successful headers release the timer", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    await assert.rejects(fetchSakiStreamResponse("https://example.invalid", {}, 10), /连接超时/);
    const controller = new AbortController();
    const pending = fetchSakiStreamResponse("https://example.invalid", { signal: controller.signal });
    controller.abort(new Error("cancelled"));
    await assert.rejects(pending, /cancelled/);
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = async (_input, init) => { signal = init?.signal; return new Response("ok"); };
    const response = await fetchSakiStreamResponse("https://example.invalid", {}, 5);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(signal?.aborted, false);
    assert.equal(await response.text(), "ok");
  } finally { globalThis.fetch = original; }
});
