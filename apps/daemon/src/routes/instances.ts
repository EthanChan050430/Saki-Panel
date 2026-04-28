import type { FastifyInstance } from "fastify";
import type { InstanceCommandRequest, InstanceLogsResponse, InstanceType } from "@webops/shared";
import { authenticatePanelRequest } from "../daemon-auth.js";
import { instanceManager, type DaemonInstanceSpec } from "../instance-manager.js";

function parseSpec(body: unknown): DaemonInstanceSpec {
  const input = body as Partial<DaemonInstanceSpec>;
  if (!input.id || !input.name || !input.workingDirectory || !input.startCommand) {
    throw new Error("id, name, workingDirectory and startCommand are required");
  }

  return {
    id: input.id,
    name: input.name,
    type: (input.type ?? "generic_command") as InstanceType,
    workingDirectory: input.workingDirectory,
    startCommand: input.startCommand,
    stopCommand: input.stopCommand ?? null,
    restartPolicy: input.restartPolicy ?? "never",
    restartMaxRetries: input.restartMaxRetries ?? 0
  };
}

export async function registerInstanceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/instances/:id/start", { preHandler: authenticatePanelRequest }, async (request) => {
    const spec = parseSpec(request.body);
    return instanceManager.start(spec);
  });

  app.post("/api/instances/:id/stop", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as Partial<DaemonInstanceSpec>;
    const { id } = request.params as { id: string };
    return instanceManager.stop({ id, stopCommand: body.stopCommand ?? null });
  });

  app.post("/api/instances/:id/restart", { preHandler: authenticatePanelRequest }, async (request) => {
    const spec = parseSpec(request.body);
    return instanceManager.restart(spec);
  });

  app.post("/api/instances/:id/kill", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    return instanceManager.kill(id);
  });

  app.post("/api/instances/:id/input", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { data?: string };
    if (typeof body.data !== "string") {
      throw new Error("data is required");
    }
    return instanceManager.writeInput(id, body.data);
  });

  app.post("/api/instances/:id/command", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<InstanceCommandRequest>;
    const command = typeof body.command === "string" ? body.command.trim() : "";
    if (!command) {
      throw new Error("command is required");
    }
    const options: { workingDirectory?: string; timeoutMs?: number; input?: string } = {};
    if (typeof body.workingDirectory === "string") options.workingDirectory = body.workingDirectory;
    if (typeof body.timeoutMs === "number") options.timeoutMs = body.timeoutMs;
    if (typeof body.input === "string") options.input = body.input;
    return instanceManager.runCommand(id, command, options);
  });

  app.get("/api/instances/:id/logs", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { lines?: string };
    const limit = Math.max(1, Math.min(Number(query.lines ?? 200) || 200, 1000));
    const state = instanceManager.state(id);
    const response: InstanceLogsResponse = {
      instanceId: id,
      status: state.status,
      exitCode: state.exitCode,
      lines: state.logs.slice(-limit)
    };
    return response;
  });

  app.get("/api/instances/:id/status", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const state = instanceManager.state(id);
    return {
      instanceId: id,
      status: state.status,
      exitCode: state.exitCode
    };
  });
}
