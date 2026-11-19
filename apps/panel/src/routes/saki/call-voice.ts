import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { sakiCallVoiceDownloadPath, sakiCallVoiceModel } from "@webops/shared";
import type { FastifyInstance } from "fastify";
import { requireAnyPermission } from "../../auth.js";
import { sakiUsePermissions } from "./types.js";

const releaseHosts = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);

async function fetchRelease(source: keyof typeof sakiCallVoiceModel.urls, signal: AbortSignal) {
  let url = new URL(sakiCallVoiceModel.urls[source]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const allowed = releaseHosts.has(url.hostname) || (source === "mirror" && url.hostname === "gh-proxy.org");
    if (!allowed || url.protocol !== "https:" || url.username || url.password || url.port) break;
    const response = await fetch(url, { redirect: "manual", signal, headers: { "accept-encoding": "identity" } });
    if (response.ok) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (response.status < 300 || response.status >= 400 || !location) break;
    url = new URL(location, url);
  }
  throw new Error("Release asset unavailable");
}

export function registerSakiCallVoiceRoutes(app: FastifyInstance) {
  app.get<{ Params: { source: string } }>(`${sakiCallVoiceDownloadPath}/:source`, {
    preHandler: requireAnyPermission(sakiUsePermissions)
  }, async (request, reply) => {
    const { source } = request.params;
    if (source !== "github" && source !== "mirror") return reply.code(404).send({ message: "Unknown model source." });

    const abort = new AbortController();
    reply.raw.once("close", () => abort.abort());
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60_000)]);
    try {
      const response = await fetchRelease(source, signal);
      const length = response.headers.get("content-length");
      if (response.status !== 200 || !response.body || (length && Number(length) !== sakiCallVoiceModel.size)
          || response.headers.get("content-type")?.includes("text/html")) {
        await response.body?.cancel();
        throw new Error("Invalid release asset");
      }
      reply.header("Cache-Control", "private, no-store")
        .header("X-Accel-Buffering", "no")
        .type("application/octet-stream");
      return reply.send(Readable.fromWeb(response.body as ReadableStream<Uint8Array>));
    } catch {
      return reply.code(502).send({ message: "The Saki voice model download is unavailable." });
    }
  });
}
