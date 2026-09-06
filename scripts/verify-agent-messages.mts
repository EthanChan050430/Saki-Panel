import {
  compactAgentTurnMessages,
  serializeTurnMessagesForPrompt,
  toAnthropicMessages,
  toOpenAiMessages,
  type SakiAgentTurnConversation
} from "../apps/panel/src/routes/saki/agent-messages.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const conversation: SakiAgentTurnConversation = {
  systemPrompt: "You are Saki.",
  messages: [
    { role: "user", content: "Request: fix the bug" },
    { role: "user", content: "Git status:\n M app.ts" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "readFile", args: { path: "app.ts" } }]
    },
    { role: "tool", toolCallId: "call_1", name: "readFile", content: "file body ".repeat(400) },
    { role: "user", content: "System correction: continue" }
  ]
};

const openAi = toOpenAiMessages(conversation);
assert(openAi[0]?.role === "system", "OpenAI starts with system");
const openAiRoles = openAi.map((message) => message.role).join(",");
assert(!openAiRoles.includes("user,user"), "consecutive user messages are merged for OpenAI-compatible APIs");
const userMessages = openAi.filter((message) => message.role === "user");
assert(String(userMessages[0]?.content).includes("fix the bug") && String(userMessages[0]?.content).includes("Git status"), "merged user keeps request and git");
const assistant = openAi.find((message) => message.role === "assistant");
assert(Array.isArray(assistant?.tool_calls) && assistant?.tool_calls.length === 1, "assistant tool_calls preserved");
const tool = openAi.find((message) => message.role === "tool");
assert(tool?.tool_call_id === "call_1", "tool result keeps matching id");

const anthropic = toAnthropicMessages(conversation);
assert(anthropic.every((message) => message.role === "user" || message.role === "assistant"), "Anthropic has no role:tool");
const roles = anthropic.map((message) => message.role).join(",");
assert(!roles.includes("user,user"), "Anthropic does not emit consecutive users");

const compacted = compactAgentTurnMessages(conversation.messages, 1000);
assert(compacted.length === conversation.messages.length, "compact never drops assistant/tool pairs");
assert((compacted[3]?.content.length ?? 0) < conversation.messages[3]!.content.length, "compact shrinks old tool observations");

const firstTurn: SakiAgentTurnConversation = {
  systemPrompt: "You are Saki.",
  messages: [{ role: "user", content: "hi" }]
};
assert(
  !serializeTurnMessagesForPrompt(firstTurn).includes("Continue the task"),
  "XML fallback does not force-continue on the first user turn"
);

import { parseXmlToolCalls, parseAnyToolCalls } from "../apps/panel/src/routes/saki/tools.ts";

const parsedXml1 = parseXmlToolCalls('<tool_calls>\n<command name="runCommand">\n<command>curl -sS http://api.example.com</command>\n</command>\n</tool_calls>');
assert(parsedXml1?.length === 1 && parsedXml1[0]?.name === "runCommand" && parsedXml1[0]?.args.command === "curl -sS http://api.example.com", "<command name='runCommand'> in <tool_calls> parses properly");

const parsedXml2 = parseAnyToolCalls('API 每次总是返回 404\n<tool_calls>\n<command name="runCommand">\n<command>curl -sS -m 15 -X POST "http://api.tooldelta.top/api/mc" -H "Content-Type: application/json" -d \'');
assert(parsedXml2?.length === 1 && parsedXml2[0]?.name === "runCommand" && String(parsedXml2[0]?.args.command).includes("curl -sS"), "unclosed <command> tag parses properly");

if (process.exitCode) {
  console.error("agent message protocol tests failed");
  process.exit(1);
}
console.log("agent message protocol tests passed");
