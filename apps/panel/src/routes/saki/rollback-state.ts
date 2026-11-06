import type { SakiAgentAction } from "@webops/shared";
import { prisma } from "../../db.js";
import { RouteError } from "./types.js";

function hasActionReference(messages: unknown, id: string): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some(message => {
    if (!message || typeof message !== "object") return false;
    const actions = [
      ...(Array.isArray(message.actions) ? message.actions : []),
      ...(Array.isArray(message.timeline) ? message.timeline.flatMap((item: any) => item?.kind === "action" ? [item.action] : []) : []),
      ...(Array.isArray(message.timelineEvents) ? message.timelineEvents.flatMap((event: any) => event?.type === "action" ? [event.payload?.action] : []) : [])
    ];
    return actions.some(action => action?.id === id);
  });
}

/** A consumed checkpoint is a no-op only after the server recorded a successful rollback. */
export async function alreadyRolledBackSakiAction(userId: string, action: SakiAgentAction, instanceId?: string | null): Promise<SakiAgentAction | null> {
  if (action.status !== "rolled_back") return null;
  const conversations = await prisma.sakiConversation.findMany({
    where: { userId, ...(instanceId !== undefined ? { instanceId } : {}), messages: { contains: action.id } },
    select: { messages: true }
  });
  const owned = conversations.some(conversation => {
    try { return hasActionReference(JSON.parse(conversation.messages), action.id); }
    catch { return false; }
  });
  if (!owned) throw new RouteError("Rollback action not found in this conversation workspace.", 404);
  // A history reference authorizes only an idempotent receipt, not disclosure
  // of an old command, its output, or media attached to the completed action.
  return { id: action.id, tool: action.tool, args: {}, observation: "此操作已撤回，无需重复还原文件。", ok: true,
    status: "rolled_back", createdAt: action.createdAt,
    approval: { required: false, reason: "Rollback already completed.", risk: "low", rollbackAvailable: false } };
}
