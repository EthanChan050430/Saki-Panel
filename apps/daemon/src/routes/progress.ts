// Daemon progress task endpoints.
// Clients poll GET /api/progress/tasks/:id after kicking off a long-running
// operation. Each daemon route that opts in must call progressReporter.start()
// before the work begins and complete()/fail() when it ends.

import type { FastifyInstance } from "fastify";
import { progressReporter, type ProgressTask } from "../progress-reporter.js";

export async function registerProgressRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/progress/tasks/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    const task = progressReporter.get(id);
    if (!task) {
      reply.code(404).send({ error: "progress task not found" });
      return;
    }
    reply.send(task satisfies ProgressTask);
  });
}
