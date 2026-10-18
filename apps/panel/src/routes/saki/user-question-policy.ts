import type { SakiModelToolTurn } from "./types.js";
import { normalizedAgentToolName } from "./tools.js";

export function directUserQuestion(text: string): string | null {
  const question = text.trim();
  if (!question || question.length > 500 || !/[?？]$/.test(question)) return null;
  if ((question.match(/[?？]/g) ?? []).length !== 1 || /[`<>\n\r]/.test(question)) return null;
  if (/例如|比如|示例|举例|for example|\be\.g\.|such as/i.test(question)) return null;
  const chineseRequest = /^(?:请(?:先)?(?:确认|选择|提供|指定|补充|告诉我)|需要你(?:先)?(?:确认|选择|提供|指定|补充)|(?:你(?:希望|想要|更倾向于?)|(?:需要|希望)我)[^。！？]*(?:哪|什么|多少|如何|还是))/;
  const englishRequest = /^(?:please (?:confirm|choose|select|provide|specify|tell me)\b|(?:which|what|where)\b[^?]*(?:should (?:I|we)|do you|would you|will you|are we)\b)/i;
  return chineseRequest.test(question) || englishRequest.test(question) ? question : null;
}

export function normalizeUserQuestionTurn(turn: SakiModelToolTurn): SakiModelToolTurn {
  const explicit = turn.toolCalls.find((call) => normalizedAgentToolName(call.name) === "askuser");
  if (explicit) return { ...turn, toolCalls: [explicit] };
  const response = turn.toolCalls.length === 1 && normalizedAgentToolName(turn.toolCalls[0]!.name) === "respond" ? turn.toolCalls[0] : undefined;
  if (turn.toolCalls.length && !response) return turn;
  const question = directUserQuestion(response ? String(response.args?.text ?? "") : turn.content);
  if (!question) return turn;
  return {
    ...turn,
    content: "",
    toolCalls: [{ ...(response?.id ? { id: response.id } : {}), name: "askUser", args: { question } }]
  };
}
