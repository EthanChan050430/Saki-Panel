let tts;

function progress(phase, extra = {}) {
  self.postMessage({ type: "progress", phase, ...extra });
}

async function countryFromIp() {
  try {
    const response = await fetch("https://api.country.is/", {
      signal: AbortSignal.timeout(3500), credentials: "omit", cache: "no-store"
    });
    if (response.ok) return (await response.json()).country;
  } catch {}
  return "";
}

async function verify(buffer, model) {
  if (buffer.byteLength !== model.size) throw new Error("Unexpected voice model size");
  const bytes = new Uint8Array(await self.crypto.subtle.digest("SHA-256", buffer));
  const checksum = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (checksum !== model.sha256) throw new Error("Voice model checksum mismatch");
  return buffer;
}

async function download(url, model, source, token) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15 * 60_000);
  let watchdog = setTimeout(() => controller.abort(), 12_000);
  let reader;
  try {
    progress("connecting", { source });
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
    });
    const length = response.headers.get("content-length");
    if (!response.ok || !response.body || response.headers.get("content-type")?.includes("text/html")
        || (length && Number(length) !== model.size)) {
      await response.body?.cancel();
      throw new Error("Invalid voice model response");
    }
    const bytes = new Uint8Array(model.size);
    let loaded = 0;
    let lastPercent = -1;
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), 20_000);
      if (loaded + value.byteLength > model.size) throw new Error("Unexpected voice model size");
      bytes.set(value, loaded);
      loaded += value.byteLength;
      const percent = Math.floor(loaded * 100 / model.size);
      if (percent !== lastPercent) {
        lastPercent = percent;
        progress("downloading", { source, percent });
      }
    }
    progress("verifying");
    if (loaded !== model.size) throw new Error("Incomplete voice model download");
    return await verify(bytes.buffer, model);
  } finally {
    clearTimeout(deadline);
    clearTimeout(watchdog);
    await reader?.cancel().catch(() => {});
  }
}

async function loadModel(model, proxyUrl, token) {
  if (!self.crypto?.subtle) throw new Error("Voice model verification requires HTTPS or localhost");
  const cache = await self.caches?.open("saki-panel-call-voice-v1").catch(() => null);
  const key = self.location.href.split("?")[0] + "?model=" + model.sha256;
  const cached = await cache?.match(key).catch(() => null);
  if (cached) {
    try {
      progress("verifying");
      return await verify(await cached.arrayBuffer(), model);
    } catch {
      await cache.delete(key).catch(() => {});
    }
  }

  progress("selecting");
  const country = await countryFromIp();
  const sources = country === "CN" ? ["mirror"] : ["github", "mirror"];
  for (const source of sources) {
    for (const [url, authorization] of [[model.urls[source], ""], [`${proxyUrl}/${source}`, token]]) {
      try {
        const buffer = await download(url, model, source, authorization);
        try {
          if (!cache) throw new Error("Cache Storage unavailable");
          await cache.put(key, new Response(buffer));
        } catch {
          self.postMessage({ type: "cache-unavailable" });
        }
        return buffer;
      } catch {}
    }
  }
  throw new Error("Could not download the voice model");
}

async function initialize(model, proxyUrl, token) {
  let modelPackage = await loadModel(model, proxyUrl, token);
  progress("initializing");
  self.Module = {
    locateFile(path, directory) {
      return directory + path;
    },
    getPreloadedPackage(_name, size) {
      if (modelPackage?.byteLength !== size) throw new Error("Unexpected WASM model package");
      const bytes = modelPackage;
      modelPackage = null;
      return bytes;
    },
    onAbort(reason) {
      self.postMessage({ type: "error", message: String(reason) });
    },
    onRuntimeInitialized() {
      tts = createOfflineTts(self.Module);
      self.postMessage({ type: "ready" });
    }
  };
  importScripts("sherpa-onnx-tts.js", "sherpa-onnx-wasm-main-tts.js");
}

self.onmessage = ({ data }) => {
  if (data.type === "init") {
    initialize(data.model, data.proxyUrl, data.token).catch((error) => {
      self.postMessage({ type: "error", message: String(error.message ?? error) });
    });
  }
  if (data.type !== "generate") return;
  try {
    if (!tts) throw new Error("The Saki voice model is not ready");
    const { samples, sampleRate } = tts.generate({ text: data.text, sid: 0, speed: 1 });
    self.postMessage({ type: "audio", id: data.id, samples, sampleRate: sampleRate || tts.sampleRate }, [samples.buffer]);
  } catch (error) {
    self.postMessage({ type: "audio", id: data.id, error: String(error.message ?? error) });
  }
};

self.addEventListener("unhandledrejection", ({ reason }) => {
  self.postMessage({ type: "error", message: String(reason?.message ?? reason) });
});
