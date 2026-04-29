import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { panelCorsMethods, resolvePanelCorsOrigin } from "./cors.js";
import { panelConfig } from "./config.js";
import { authenticate } from "./auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDaemonRoutes } from "./routes/daemon.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerInstanceRoutes } from "./routes/instances.js";
import { registerNodeRoutes } from "./routes/nodes.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerTemplateRoutes } from "./routes/templates.js";
import { registerTerminalRoutes } from "./routes/terminal.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerSakiRoutes } from "./routes/saki.js";
import { registerSystemRoutes } from "./routes/system.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: typeof authenticate;
  }
}

export async function createPanelServer() {
  const app = Fastify({
    bodyLimit: 16 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? "warn"
    }
  });

  await app.register(fastifyCors, {
    delegator: (request, callback) => {
      callback(null, {
        origin: resolvePanelCorsOrigin(request),
        methods: panelCorsMethods,
        credentials: true
      });
    }
  });

  await app.register(jwt, {
    secret: panelConfig.jwtSecret
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

  app.decorate("authenticate", authenticate);

  app.get("/health", async () => ({
    ok: true,
    service: "panel",
    time: new Date().toISOString()
  }));

  await registerAuthRoutes(app);
  await registerDaemonRoutes(app);
  await registerDashboardRoutes(app);
  await registerNodeRoutes(app);
  await registerInstanceRoutes(app);
  await registerFileRoutes(app);
  await registerTaskRoutes(app);
  await registerTemplateRoutes(app);
  await registerAuditRoutes(app);
  await registerUserRoutes(app);
  await registerSystemRoutes(app);
  await registerSakiRoutes(app);
  await registerTerminalRoutes(app);

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error(error);
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const message = error instanceof Error ? error.message : "Internal Server Error";
    reply.code(statusCode).send({
      message
    });
  });

  return app;
}
