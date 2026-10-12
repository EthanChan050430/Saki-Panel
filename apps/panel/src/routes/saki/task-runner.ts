import type { SakiChatResponse } from "@webops/shared";
import type { SakiActiveTask, SakiAgentRunEvents } from "./types.js";
import { emitActiveSakiTaskEvent, finishActiveSakiTask } from "./state.js";
import { persistSakiTaskConversation, syncSakiTaskResult } from "./conversations.js";

export function trackedSakiTaskEvents(taskId: string): Required<SakiAgentRunEvents> {
  return {
    workflow: (update) => emitActiveSakiTaskEvent(taskId, "workflow", { ...update }),
    action: (action) => emitActiveSakiTaskEvent(taskId, "action", { action }),
    delta: (text) => emitActiveSakiTaskEvent(taskId, "delta", { text }),
    thinking: (text) => emitActiveSakiTaskEvent(taskId, "thinking", { text })
  };
}

// The execution promise belongs to the task, never to an HTTP connection.
export function runTrackedSakiTask(task: SakiActiveTask, work: () => Promise<SakiChatResponse>): Promise<SakiChatResponse> {
  if (task.execution) return task.execution;
  const execution = Promise.resolve().then(async () => {
    let response: SakiChatResponse;
    try {
      await persistSakiTaskConversation(task);
      response = await work();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      response = { source: "local-fallback", message: reason, retry: { reason, taskId: task.id } };
    }
    await syncSakiTaskResult(task, response);
    finishActiveSakiTask(task.id, "completed", response);
    return response;
  });
  task.execution = execution;
  void execution.finally(() => { if (task.execution === execution) delete task.execution; }).catch(() => {});
  return execution;
}
