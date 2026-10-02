import type { CopilotSession, MessageOptions, Tool, ToolResultObject } from "@github/copilot-sdk";
import type { ParsedToolCall, SakiModelToolTurn } from "../types.js";
import { createStreamingTextState, currentAgentAbortSignal, flushStreamingTextState, pushStreamingTextDelta, RouteError, stripThinking } from "../types.js";
import { advertisedSakiToolSchemas, normalizeStructuredToolCall } from "../tools.js";
import { streamPromptAgentTurnWithFilteredDelta, withTurnUsage } from "./common.js";
import { parseToolCallsFromText } from "./catalog.js";

type AgentSession = Pick<CopilotSession, "send" | "on" | "abort" | "disconnect">;

// Copilot owns an agent loop too. Stop at its first tool batch so Saki's loop
// remains responsible for instance routing, permissions, execution and auditing.
export async function requestCopilotAgentTurn(
  createSession: (tools: Tool[]) => Promise<AgentSession>,
  options: MessageOptions,
  timeoutMs: number,
  onDelta?: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  const nativeCalls: ParsedToolCall[] = [];
  const allowedNames = new Set(advertisedSakiToolSchemas().map((schema) => schema.name));
  const generate = async (filteredDelta?: (text: string) => void): Promise<string> => {
    const state = createStreamingTextState();
    let content = "";
    let resolveTurn!: () => void;
    let rejectTurn!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
    // Attach a rejection handler before asynchronous session creation/send.
    void ready.catch(() => undefined);
    let releaseHandlers!: (result: ToolResultObject) => void;
    const deferredResult = new Promise<ToolResultObject>((resolve) => { releaseHandlers = resolve; });
    const capture = (name: string, args: unknown, id: string) => {
      if (!allowedNames.has(name)) throw new RouteError(`Copilot requested an unadvertised tool '${name}'.`, 502);
      if (!nativeCalls.some((call) => call.id === id)) {
        nativeCalls.push(normalizeStructuredToolCall({ name, arguments: args, id }));
      }
    };
    const tools: Tool[] = advertisedSakiToolSchemas().map((schema) => ({
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
      overridesBuiltInTool: true,
      // This handler only captures a request; Saki checks permission before
      // executing it. Never grant the CLI permission to access local files.
      skipPermission: true,
      handler: (args, invocation) => {
        try {
          capture(schema.name, args, invocation.toolCallId);
          resolveTurn();
        } catch (error) {
          rejectTurn(error);
        }
        return deferredResult;
      }
    }));
    const session = await createSession(tools);
    const signal = currentAgentAbortSignal();
    const onAbort = () => rejectTurn(new DOMException("Copilot agent turn cancelled.", "AbortError"));
    const timer = setTimeout(() => rejectTurn(new RouteError("GitHub Copilot agent turn timed out.", 504)), timeoutMs);
    const unsubscribe = session.on((event) => {
      if (event.agentId) return;
      try {
        if (event.type === "assistant.message_delta") {
          pushStreamingTextDelta(state, event.data.deltaContent, filteredDelta ?? (() => undefined), onThinking);
        } else if (event.type === "assistant.reasoning_delta") {
          onThinking?.(event.data.deltaContent);
        } else if (event.type === "assistant.message") {
          content = event.data.content;
          // Capture the whole batch, including parallel calls, before aborting.
          for (const call of event.data.toolRequests ?? []) capture(call.name, call.arguments ?? {}, call.toolCallId);
          if (nativeCalls.length) resolveTurn();
        } else if (event.type === "session.idle") {
          resolveTurn();
        } else if (event.type === "session.error") {
          rejectTurn(new RouteError(event.data.message, 502));
        }
      } catch (error) {
        rejectTurn(error);
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal?.aborted) onAbort();
      else void session.send(options).catch(rejectTurn);
      await ready;
      flushStreamingTextState(state, filteredDelta ?? (() => undefined), onThinking);
      const text = stripThinking(content || state.raw);
      if (!text && !nativeCalls.length) throw new RouteError("GitHub Copilot returned an empty response.", 502);
      return text;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsubscribe();
      // Keep handlers pending until generation has stopped, so the CLI cannot
      // continue reasoning from a synthetic success/failure observation.
      try {
        await session.abort();
      } catch {
        // A completed/disconnected session may already have nothing to abort.
      } finally {
        releaseHandlers({ resultType: "rejected", textResultForLlm: "Tool execution is handled by Saki Panel." });
        await session.disconnect().catch(() => undefined);
      }
    }
  };
  const turn = onDelta
    ? await streamPromptAgentTurnWithFilteredDelta(generate, onDelta, onThinking)
    : { content: await generate(), toolCalls: [] };
  return withTurnUsage({ ...turn, toolCalls: nativeCalls.length ? nativeCalls : parseToolCallsFromText(turn.content) }, options.prompt, undefined, true);
}
