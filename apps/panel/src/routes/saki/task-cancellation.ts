import { findConversationReferences } from "./conversation-store.js";
import { withPendingSakiActionDecision } from "./decision-lock.js";
import {
  completedSakiActions, pendingSakiActions, removePendingSakiAction,
  sakiActionsReady, saveCompletedSakiAction
} from "./state.js";
import { RouteError, type PendingSakiAction } from "./types.js";

/** Tasks are in memory, but approvals and conversation references survive restarts. */
export async function cancelRestoredSakiTask(userId: string, taskId: string): Promise<{ ok: boolean }> {
  await sakiActionsReady;
  const pending = [...pendingSakiActions.values()].filter(action => action.userId === userId && action.resume?.taskId === taskId);
  if (!pending.length) {
    // Already cancelled/expired tasks are a successful no-op only when the
    // requester has an exact task reference in their own saved conversation.
    for await (const message of findConversationReferences(userId, taskId)) {
      if ((message as { taskId?: string } | null)?.taskId === taskId) return { ok: true };
    }
    throw new RouteError("Task not found.", 404);
  }

  // Use the same locks as approve/answer so cancellation cannot race a command
  // execution or accidentally resume a saved question.
  const lock = (index: number, work: () => Promise<{ ok: boolean }>): Promise<{ ok: boolean }> =>
    index === pending.length ? work() : withPendingSakiActionDecision(pending[index]!.id, () => lock(index + 1, work));
  return lock(0, async () => {
    const current: PendingSakiAction[] = [];
    for (const previous of pending) {
      const confirmed = completedSakiActions.get(previous.id);
      if (confirmed && confirmed.status !== "rejected") {
        throw new RouteError("旧操作已执行或正在处理，请重新打开对话获取最新结果后再编辑。", 409);
      }
      const action = pendingSakiActions.get(previous.id);
      if (action?.userId === userId && action.resume?.taskId === taskId) current.push(action);
    }
    for (const action of current) {
      await saveCompletedSakiAction({
        id: action.id, tool: action.call.name, args: action.call.args,
        observation: "已随对话操作取消。", ok: false, status: "rejected",
        approval: { ...action.approval, required: false, rollbackAvailable: false },
        createdAt: new Date().toISOString()
      });
      await removePendingSakiAction(action.id);
    }
    return { ok: true };
  });
}
