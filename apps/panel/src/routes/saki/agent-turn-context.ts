import { AsyncLocalStorage } from "node:async_hooks";
import type { SakiChatRequest, SakiInputAttachment } from "@webops/shared";
import type { SakiAgentTurnConversation } from "./agent-messages.js";
import { imageAttachments, imageDataFromAttachment } from "./types.js";

const store = new AsyncLocalStorage<SakiAgentTurnConversation>();
export function withAgentTurnConversation<T>(conversation: SakiAgentTurnConversation | undefined, fn: () => T): T {
  return conversation?.messages.length ? store.run(conversation, fn) : fn();
}
export function currentAgentTurnConversation(): SakiAgentTurnConversation | undefined { return store.getStore(); }

export function currentAgentToolImages(): SakiInputAttachment[] {
  const images = (store.getStore()?.messages ?? []).flatMap(message => message.images ?? []).filter(image => imageDataFromAttachment(image));
  return [...new Map(images.map(image => [image.dataUrl, image])).values()].slice(-8);
}

/** XML tool-calling fallbacks need the same visual context as native tool calls. */
export function agentRequestImages(input: SakiChatRequest): ReturnType<typeof imageAttachments> {
  const images = imageAttachments({ ...input, attachments: [...(input.attachments ?? []), ...currentAgentToolImages()] });
  return [...new Map(images.map(image => [image.dataUrl, image])).values()].slice(-8);
}
