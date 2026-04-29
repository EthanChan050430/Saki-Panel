import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { collectMetrics } from "./metrics.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerTerminalRoutes } from "./routes/terminal.js";

export async function createDaemonServer() {
  const app = Fastify({
    bodyLimit: 16 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? "warn"
    }
  });

  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 64
    }
  });

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "daemon",
    time: new Date().toISOString()
  }));

  app.get("/api/status", async () => ({
    ok: true,
    metrics: await collectMetrics()
  }));

  await registerInstanceRoutes(app);
  await registerFileRoutes(app);
  await registerTerminalRoutes(app);

  return app;
}
