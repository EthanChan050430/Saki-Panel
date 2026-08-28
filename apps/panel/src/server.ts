import Fastify from "fastify";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { applyPanelCorsHeaders } from "./cors.js";
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
import { registerDatabaseRoutes } from "./routes/databases.js";
import { registerWatchRoutes } from "./watch/index.js";
import { registerJoinScriptRoutes } from "./routes/join-scripts.js";
import { registerUserKeyRoutes } from "./routes/user-keys.js";
import { registerPointsRoutes } from "./routes/points.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: typeof authenticate;
  }
}

export async function createPanelServer() {
  const app = Fastify({
    bodyLimit: Math.ceil(panelConfig.maxTransferBytes * 1.5),
    ...(panelConfig.https ? { https: panelConfig.https } : {}),
    logger: {
      level: process.env.LOG_LEVEL ?? "warn"
    }
  });

  app.addHook("onRequest", (request, reply, done) => {
    applyPanelCorsHeaders(request, reply);
    if (request.method === "OPTIONS") {
      reply.code(204).header("Content-Length", "0").send();
      return;
    }
    done();
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
      fileSize: panelConfig.maxTransferBytes,
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
  await registerWatchRoutes(app);
  await registerTerminalRoutes(app);
  await registerDatabaseRoutes(app);
  await registerJoinScriptRoutes(app);
  await registerUserKeyRoutes(app);
  await registerPointsRoutes(app);

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
