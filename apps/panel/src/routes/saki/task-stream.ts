import type { FastifyReply, FastifyRequest } from "fastify";
import type { SakiActiveTask, SakiActiveTaskEvent } from "./types.js";
import { effectiveSakiAgentPermissionMode } from "./types.js";
import { startSakiEventStream } from "./stream.js";

export function connectSakiTaskStream(task: SakiActiveTask, request: FastifyRequest, reply: FastifyReply, validateAccess?: () => Promise<void>): void {
  const stream = startSakiEventStream(request, reply);
  stream.send("meta", { source: "direct-model", mode: task.input.mode ?? "agent", agentPermissionMode: effectiveSakiAgentPermissionMode(task.input), terminalSandbox: task.input.terminalSandbox !== false, taskId: task.id, status: task.status, runVersion: task.runVersion ?? 1 });
  for (const event of task.eventsBuffer) {
    if (event.type !== "done" && event.type !== "error") stream.send(event.type, event.payload);
  }
  if (task.status !== "running") {
    if (task.status === "cancelled") stream.send("error", { message: "任务已取消。" });
    else if (task.response) stream.send("done", { response: task.response });
    else stream.send("error", { message: task.error || "任务已停止。" });
    stream.end();
    return;
  }
  const send = (event: SakiActiveTaskEvent) => {
    stream.send(event.type, event.payload);
    if (event.type === "done" || event.type === "error") {
      task.subscribers.delete(subscriber);
      stream.end();
    }
  };
  let closed = false;
  let validating = false;
  const queued: SakiActiveTaskEvent[] = [];
  const drain = async () => {
    if (validating || closed) return;
    validating = true;
    try {
      while (queued.length && !closed) {
        await validateAccess!();
        if (closed) break;
        for (const event of queued.splice(0)) send(event);
      }
    } catch {
      queued.length = 0;
      closed = true;
      task.subscribers.delete(subscriber);
      stream.send("error", { message: "任务访问权限已失效，请重新确认账号和实例权限。" });
      stream.end();
    } finally { validating = false; }
  };
  const subscriber = (event: SakiActiveTaskEvent) => {
    if (closed) return;
    if (!validateAccess) { send(event); return; }
    queued.push(event);
    void drain();
  };
  task.subscribers.add(subscriber);
  reply.raw.on("close", () => { closed = true; queued.length = 0; task.subscribers.delete(subscriber); });
}
