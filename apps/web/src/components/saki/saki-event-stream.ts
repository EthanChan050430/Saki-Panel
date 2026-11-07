export async function fetchSakiStreamResponse(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 20_000
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Saki 连接超时，正在重新确认任务状态。")), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

/** Stop at a terminal event even if a proxy leaves HTTP open; heartbeats reset the idle timer. */
export async function readSakiEventFrames(
  body: ReadableStream<Uint8Array>,
  dispatch: (frame: string) => boolean,
  signal?: AbortSignal,
  idleMs = 45_000
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const read = () => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const fail = (error: unknown) => { cleanup(); cancel(); reject(error); };
    const abort = () => fail(signal?.reason ?? new Error("Stream aborted"));
    const timer = setTimeout(() => fail(new Error("Saki 流式连接长时间未响应，正在重新确认任务状态。")), idleMs);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    reader.read().then(value => { cleanup(); resolve(value); }, fail);
  });
  try {
    while (true) {
      const { done, value } = await read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (!dispatch(frame)) { cancel(); return; }
      }
      if (done) {
        if (buffer.trim()) dispatch(buffer);
        return;
      }
    }
  } catch (error) {
    cancel();
    throw error;
  } finally { reader.releaseLock(); }
}
