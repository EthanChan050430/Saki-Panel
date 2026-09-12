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
import { looksLikeDsmlMarkup, stripDsmlWrappers } from "../apps/panel/src/routes/saki/types.ts";
import { findAgentStreamStopIndex, streamPromptAgentTurnWithFilteredDelta } from "../apps/panel/src/routes/saki/providers/common.ts";

const parsedXml1 = parseXmlToolCalls('<tool_calls>\n<command name="runCommand">\n<command>curl -sS http://api.example.com</command>\n</command>\n</tool_calls>');
assert(parsedXml1?.length === 1 && parsedXml1[0]?.name === "runCommand" && parsedXml1[0]?.args.command === "curl -sS http://api.example.com", "<command name='runCommand'> in <tool_calls> parses properly");

const parsedXml2 = parseAnyToolCalls('API 每次总是返回 404\n<tool_calls>\n<command name="runCommand">\n<command>curl -sS -m 15 -X POST "http://api.tooldelta.top/api/mc" -H "Content-Type: application/json" -d \'');
assert(parsedXml2?.length === 1 && parsedXml2[0]?.name === "runCommand" && String(parsedXml2[0]?.args.command).includes("curl -sS"), "unclosed <command> tag parses properly");

const grokDsml = `<|DSML|function_calls>
<|DSML|invoke name="runCommand">
<|DSML|parameter name="command">ls -la index.html</|DSML|parameter>
</|DSML|invoke>
</|DSML|function_calls>`;
assert(looksLikeDsmlMarkup(grokDsml), "ASCII DSML markup is detected");
assert(stripDsmlWrappers(grokDsml).includes('<invoke name="runCommand">'), "ASCII DSML strips to <invoke>");
const parsedGrok = parseAnyToolCalls(grokDsml);
assert(parsedGrok.length === 1 && parsedGrok[0]?.name === "runCommand" && parsedGrok[0]?.args.command === "ls -la index.html", "Grok <|DSML|invoke> parses runCommand");

const fw = "\uFF5C";
const fullwidthDsml = `补丁报告成功但磁盘未变，我改用字节级确认后直接精确删除。

<${fw}${fw}DSML${fw}${fw} calls>
<${fw}${fw}DSML${fw}${fw} invoke name="runCommand">
<${fw}${fw}DSML${fw}${fw} parameter name="command">grep -n "3010" index.html legal.html | cat -A</${fw}${fw}DSML${fw}${fw} parameter>
</${fw}${fw}DSML${fw}${fw} invoke>
<${fw}${fw}DSML${fw}${fw} invoke name="runCommand">
<${fw}${fw}DSML${fw}${fw} parameter name="command" string="true">ls -la index.html; stat -c '%y %s' index.html</${fw}${fw}DSML${fw}${fw} parameter>
</${fw}${fw}DSML${fw}${fw} invoke>
</${fw}${fw}DSML${fw}${fw} calls>`;
assert(looksLikeDsmlMarkup(fullwidthDsml), "fullwidth DSML markup is detected");
const parsedFw = parseAnyToolCalls(fullwidthDsml);
assert(parsedFw.length === 2, "fullwidth DSML parses two invokes");
assert(parsedFw[0]?.name === "runCommand" && String(parsedFw[0]?.args.command).includes("grep -n"), "first DSML invoke keeps grep command");
assert(parsedFw[1]?.name === "runCommand" && String(parsedFw[1]?.args.command).includes("stat -c"), "second DSML invoke reads name= despite extra attrs");

const spacedDsml = `< |DSML| |calls>
< |DSML| |invoke name="readFile">
< |DSML| |parameter name="path">src/app.ts</ |DSML| |parameter>
</ |DSML| |invoke>
</ |DSML| |calls>`;
const parsedSpaced = parseAnyToolCalls(spacedDsml);
assert(parsedSpaced.length === 1 && parsedSpaced[0]?.name === "readFile" && parsedSpaced[0]?.args.path === "src/app.ts", "spaced < |DSML| |invoke> still parses");

assert(findAgentStreamStopIndex(fullwidthDsml) > 0, "streaming stop index sits after the Chinese narration");
assert(findAgentStreamStopIndex(grokDsml) === 0, "pure DSML payload stops at the start");
assert(findAgentStreamStopIndex("just a normal reply") === -1, "plain text is not a tool-call stop");

let leaked = "";
const streamed = await streamPromptAgentTurnWithFilteredDelta(
  async (onDelta) => {
    onDelta(fullwidthDsml);
    return fullwidthDsml;
  },
  (chunk) => {
    leaked += chunk;
  }
);
assert(!leaked.includes("DSML") && !leaked.includes("invoke name="), "DSML payload is not forwarded to the chat stream");
assert(leaked.includes("补丁报告成功但磁盘未变"), "narration before DSML is still streamed");
assert(streamed.toolCalls.length === 2 && streamed.toolCalls[0]?.name === "runCommand", "streamed DSML turn yields executable tool calls");

let leakedChunks = "";
const chunked = await streamPromptAgentTurnWithFilteredDelta(
  async (onDelta) => {
    for (const char of fullwidthDsml) onDelta(char);
    return fullwidthDsml;
  },
  (chunk) => {
    leakedChunks += chunk;
  }
);
assert(!leakedChunks.includes("DSML") && !leakedChunks.includes("invoke name="), "chunked DSML stream does not leak markup");
assert(leakedChunks.includes("补丁报告成功但磁盘未变"), "chunked stream still forwards narration");
assert(chunked.toolCalls.length === 2, "chunked DSML stream still parses tool calls");

assert(stripDsmlWrappers("<|tool_call|>runCommand").includes("<|tool_call|>"), "DSML strip must not destroy Qwen <|tool_call|> tokens");

const qwenToken = `<|tool_call|>runCommand\n<|tool_call_argument|>{"command":"ls -la"}`;
const parsedQwenToken = parseAnyToolCalls(qwenToken);
assert(parsedQwenToken.length === 1 && parsedQwenToken[0]?.name === "runCommand" && String(parsedQwenToken[0]?.args.command).includes("ls -la"), "Qwen <|tool_call|> parses");
assert(findAgentStreamStopIndex(qwenToken) === 0, "Qwen <|tool_call|> is not streamed");

const flower = `接下来执行命令。\n✿FUNCTION✿runCommand\n✿ARGS✿{"command":"ls"}`;
const parsedFlower = parseAnyToolCalls(flower);
assert(parsedFlower.length === 1 && parsedFlower[0]?.name === "runCommand", "✿FUNCTION✿ parses");
assert(findAgentStreamStopIndex(flower) > 0, "✿FUNCTION✿ stop sits after narration");

const toolsWrapper = `<tools>\n<tool_call>\n<function>runCommand</function>\n<parameter><name>command</name><value>ls</value></parameter>\n</tool_call>\n</tools>`;
const parsedTools = parseAnyToolCalls(toolsWrapper);
assert(parsedTools.length === 1 && parsedTools[0]?.name === "runCommand" && parsedTools[0]?.args.command === "ls", "<tools><parameter><name>/<value> parses");

const harmony = `<|channel|>commentary to=functions.runCommand <|constrain|>json\n<|message|>{"command":"ls"}`;
const parsedHarmony = parseAnyToolCalls(harmony);
assert(parsedHarmony.length === 1 && parsedHarmony[0]?.name === "runCommand", "Harmony channel to= tool call parses");
assert(findAgentStreamStopIndex(harmony) === 0, "Harmony tool channel is not streamed");
assert(findAgentStreamStopIndex("<|channel|>final\nhello there") === -1, "Harmony final channel is still visible text");

const section = `<|tool_calls_section_begin|>\n<|tool_call_begin|>\nfunctions.readFile:0\n<|tool_call_argument_begin|>\n{"path":"src/a.ts"}\n<|tool_call_argument_end|>\n<|tool_call_end|>\n<|tool_calls_section_end|>`;
const parsedSection = parseAnyToolCalls(section);
assert(parsedSection.length === 1 && parsedSection[0]?.name === "readFile" && parsedSection[0]?.args.path === "src/a.ts", "tool_calls_section parses");
assert(findAgentStreamStopIndex(section) === 0, "tool_calls_section is not streamed");

const bracket = `[TOOL_REQUEST]\nrunCommand\n{"command":"ls"}\n[END_TOOL_REQUEST]`;
const parsedBracket = parseAnyToolCalls(bracket);
assert(parsedBracket.length === 1 && parsedBracket[0]?.name === "runCommand", "[TOOL_REQUEST] parses");
assert(findAgentStreamStopIndex(bracket) === 0, "[TOOL_REQUEST] is not streamed");

let qwenLeaked = "";
const streamedQwen = await streamPromptAgentTurnWithFilteredDelta(
  async (onDelta) => {
    onDelta("先看目录。\n" + qwenToken);
    return "先看目录。\n" + qwenToken;
  },
  (chunk) => {
    qwenLeaked += chunk;
  }
);
assert(qwenLeaked.includes("先看目录") && !qwenLeaked.includes("<|tool_call"), "Qwen special tokens do not leak into the chat stream");
assert(streamedQwen.toolCalls.length === 1 && streamedQwen.toolCalls[0]?.name === "runCommand", "streamed Qwen token turn yields tool calls");

if (process.exitCode) {
  console.error("agent message protocol tests failed");
  process.exit(1);
}
console.log("agent message protocol tests passed");
