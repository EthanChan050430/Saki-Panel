import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { collectMetrics } from "./metrics.js";
import { daemonConfig } from "./config.js";
import { authenticatePanelRequest } from "./daemon-auth.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerTerminalRoutes } from "./routes/terminal.js";
import { registerDatabaseRoutes } from "./routes/databases.js";

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

  // /health is intentionally open for load-balancer probing. It returns no sensitive details.
  app.get("/health", async () => ({ ok: true }));

  // /api/status returns runtime metrics; only the paired panel may read it.
  app.get("/api/status", { preHandler: authenticatePanelRequest }, async () => ({
    ok: true,
    metrics: await collectMetrics()
  }));

  await registerInstanceRoutes(app);
  await registerFileRoutes(app);
  await registerTerminalRoutes(app);
  await registerDatabaseRoutes(app);

  return app;
}
