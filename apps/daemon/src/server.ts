import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { collectMetrics } from "./metrics.js";
import { daemonConfig } from "./config.js";
import { authenticatePanelRequest } from "./daemon-auth.js";
import { DaemonError, isDaemonError } from "./errors.js";
import { applyRestartLeases, instanceManager } from "./instance-manager.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerTerminalRoutes } from "./routes/terminal.js";
import { registerDatabaseRoutes } from "./routes/databases.js";
import { registerProgressRoutes } from "./routes/progress.js";

export async function createDaemonServer() {
  const app = Fastify({
    bodyLimit: Math.ceil(daemonConfig.maxTransferBytes * 1.5),
    ...(daemonConfig.https ? { https: daemonConfig.https } : {}),
    logger: {
      level: process.env.LOG_LEVEL ?? "warn"
    }
  });

  await app.register(websocket, {
    options: {
      // Full-screen TUIs (agy, claude, vim, htop) emit large ANSI frames.
      maxPayload: 8 * 1024 * 1024
    }
  });

  await app.register(multipart, {
    limits: {
      fileSize: daemonConfig.maxTransferBytes,
      files: 1
    }
  });

  // Pass the raw body stream through so /files/upload-raw can pipe to disk
  // without Fastify buffering the whole payload or rejecting octet-stream.
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
    done(null, payload);
  });

  // /health is intentionally open for load-balancer probing. It returns no sensitive details.
  app.get("/health", async () => ({ ok: true }));

  // /api/status returns runtime metrics and instance snapshots so a panel that
  // connected this daemon by node key (pull, no daemon-pushed heartbeat) can
  // still open Saki watch incidents.
  app.get("/api/status", { preHandler: authenticatePanelRequest }, async () => ({
    ok: true,
    os: daemonConfig.osName,
    arch: daemonConfig.arch,
    version: daemonConfig.version,
    metrics: await collectMetrics(),
    instances: instanceManager.listSnapshots()
  }));

  app.post("/api/restart-leases", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { leases?: Array<{ instanceId?: unknown; suppressUntil?: unknown }> } | null;
    const rawLeases = body && Array.isArray(body.leases) ? body.leases : [];
    const leases = rawLeases.flatMap((item) => {
      if (!item || typeof item.instanceId !== "string" || typeof item.suppressUntil !== "string") return [];
      return [{ instanceId: item.instanceId, suppressUntil: item.suppressUntil }];
    });
    applyRestartLeases(leases);
    return { ok: true };
  });

  await registerInstanceRoutes(app);
  await registerFileRoutes(app);
  await registerTerminalRoutes(app);
  await registerDatabaseRoutes(app);
  await registerProgressRoutes(app);

  // Unified error handler — DaemonErrors carry machine-readable codes;
  // other errors are treated as 500s. Production mode hides raw messages.
  const isProd = process.env.NODE_ENV?.toLowerCase() === "production";
  app.setErrorHandler((error: unknown, _request, reply) => {
    if (isDaemonError(error)) {
      const status = error.httpStatus;
      const body: Record<string, unknown> = {
        code: error.code,
        hint: error.hint
      };
      if (!isProd) {
        body.message = error.message;
      } else {
        // Production clients still need *some* clue; hint is safe.
        if (error.hint) body.message = error.hint;
      }
      reply.code(status).send(body);
      return;
    }

    // Unknown / unexpected errors → always log, always return generic.
    // Extract statusCode from Fastify's default wrapped errors (e.g. validation).
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (isProd) {
      reply.code(statusCode).send({ code: "INTERNAL_ERROR", message: statusCode >= 500 ? "Internal Server Error" : "Bad Request" });
    } else {
      reply.code(statusCode).send({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return app;
}
