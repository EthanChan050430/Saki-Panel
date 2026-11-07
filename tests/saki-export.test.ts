import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { conversationMarkdownFileName, conversationMarkdownParts, snapshotConversationForExport } from "../apps/panel/src/routes/saki/conversation-export.js";
import { registerSakiRoutes } from "../apps/panel/src/routes/saki/routes.js";
import { prisma } from "../apps/panel/src/db.js";
import { panelConfig } from "../apps/panel/src/config.js";
import type { SakiActiveTask } from "../apps/panel/src/routes/saki/types.js";

const createdAt = "2026-11-03T00:00:00.000Z";
const tool = { id: "call-1", tool: "runCommand", args: { command: "echo 中文", cwd: "/workspace" },
  observation: "result\n```md\n# tool output\n````\n完整返回", ok: true, status: "completed", createdAt,
  approval: { required: true, risk: "medium", reason: "approved", preview: "preview" },
  question: { text: "继续？", options: ["继续", "停止"] }, answer: { selection: "继续" }, todos: [{ text: "build", completed: true }] };
const conversation = { id: "qa-conversation", title: "中文会话 / Test", createdAt, updatedAt: createdAt, contextKey: "global",
  messages: Array.from({ length: 1000 }, (_, index) => ({ id: `m-${index}`, role: index % 2 ? "assistant" : "user", content: `unique-message-${index}` })) };

test("Markdown export includes all messages, complete tool inputs/results, approvals, attachments, and legacy records", () => {
  const archive = { ...conversation, messages: [...conversation.messages, { id: "tools", role: "assistant", content: "完成", thinking: "stored thinking",
    actions: [tool], timelineEvents: [{ id: "event-1", type: "action", ts: 1, payload: { action: tool } }],
    timeline: [{ kind: "action", id: tool.id, action: tool }], timelineBase: [{ kind: "text", content: "earlier execution" }],
    attachments: [{ name: "notes.md", text: "attachment text", path: "/notes.md" }], retry: { reason: "retry detail" }, usage: { tokensUsed: 400 } }] };
  const markdown = [...conversationMarkdownParts(archive, createdAt)].join("");
  assert.ok(markdown.includes("unique-message-0"));
  assert.ok(markdown.includes("unique-message-999"));
  assert.ok(markdown.includes('"messageCount": 1001'));
  for (const text of ["输入参数", "返回结果", "echo 中文", "完整返回", "approved", "继续？", "继续", "build", "attachment text", "earlier execution", "stored thinking", "retry detail", "tokensUsed"]) {
    assert.ok(markdown.includes(text), `Missing ${text}`);
  }
  assert.ok(markdown.includes("`````text\n" + tool.observation + "\n`````"));
  assert.ok(markdown.indexOf("unique-message-0") < markdown.indexOf("unique-message-999"));
});

test("a long conversation is emitted incrementally without losing early execution events", () => {
  const archive = { ...conversation, messages: [{ id: "long", role: "assistant", content: "done",
    timelineEvents: Array.from({ length: 2500 }, (_, index) => ({ id: `e-${index}`, type: "workflow", payload: { message: `step-${index}` }, ts: index })) }] };
  let chunks = 0;
  let early = false;
  let last = false;
  for (const chunk of conversationMarkdownParts(archive, createdAt)) { chunks++; early ||= chunk.includes("step-0"); last ||= chunk.includes("step-2499"); }
  assert.ok(chunks > 2500);
  assert.ok(early && last);
});

test("live task export includes buffered events beyond 500 and never mutates saved history", () => {
  const source = { ...conversation, messages: [{ id: "older", role: "user", content: "keep earlier history" }] };
  const task = { id: "task-qa", userId: "owner", instanceId: null, input: { conversationId: source.id, message: "new task", userMessageId: "new-user", assistantMessageId: "new-assistant" },
    status: "running", startedAt: createdAt, updatedAt: createdAt, subscribers: new Set(),
    historyEvents: Array.from({ length: 700 }, (_, index) => ({ id: `e-${index}`, type: "delta", payload: { text: `${index},` }, ts: index })),
    eventsBuffer: [{ id: "call", type: "action", payload: { action: tool }, ts: 701 }] } as SakiActiveTask;
  const snapshot = snapshotConversationForExport(source, [task]);
  const assistant = snapshot.messages.at(-1) as any;
  assert.equal(snapshot.messages.length, 3);
  assert.equal(assistant.timelineEvents.length, 701);
  assert.equal(assistant.taskStatus, "running");
  assert.deepEqual(assistant.actions, [tool]);
  assert.ok(assistant.content.startsWith("0,1,"));
  assert.ok(assistant.content.endsWith("699,"));
  assert.equal(source.messages.length, 1);
  assert.equal(task.eventsBuffer.length, 1);
});

test("export filenames retain Unicode and exclude path/header injection characters", () => {
  const name = conversationMarkdownFileName('中文/会话\r\n"\\:<>|?*', "qa-id");
  assert.ok(name.startsWith("中文_会话"));
  assert.ok(name.endsWith("-qa-id.md"));
  assert.doesNotMatch(name, /[\r\n/\\:"<>|?*]/);
});

test("export endpoint streams all history, supplies an attachment filename, and enforces user access", async () => {
  const app = Fastify();
  const findConversation = prisma.sakiConversation.findFirst;
  const findMessages = prisma.sakiConversationMessage.findMany;
  const findMessage = prisma.sakiConversationMessage.findUnique;
  const queryRaw = prisma.$queryRaw;
  const transaction = prisma.$transaction;
  const findUser = prisma.user.findUnique;
  const authDisabled = panelConfig.disableAuth;
  const queries: unknown[] = [];
  panelConfig.disableAuth = false;
  prisma.user.findUnique = async (args: any) => ({ id: args.where.id, username: args.where.id, status: "ACTIVE", createdAt: new Date(createdAt),
    roles: [{ role: { name: "member", permissions: args.where.id === "no-permission" ? [] : [{ permission: { code: "saki.agent" } }] } }] }) as any;
  prisma.sakiConversation.findFirst = async (args: any) => {
    queries.push(args.where);
    if (args.where.userId !== "owner" || args.where.id === "missing") return null;
    return { ...conversation, userId: "owner", label: "Agent", detail: "", instanceId: null,
      messages: args.where.id === "corrupt" ? "broken JSON" : JSON.stringify(conversation.messages),
      createdAt: new Date(createdAt), updatedAt: new Date(createdAt) } as any;
  };
  prisma.sakiConversationMessage.findMany = (async (args: any) => conversation.messages.map((message: any, position) =>
    args.select.messageId ? { messageId: message.id } : { position })) as typeof findMessages;
  prisma.sakiConversationMessage.findUnique = (async (args: any) => ({
    data: JSON.stringify(conversation.messages[args.where.conversationId_position.position])
  })) as typeof findMessage;
  prisma.$queryRaw = (async (_sql: TemplateStringsArray, id: string) => id === "corrupt" ? [{ pending: 1 }] : []) as typeof queryRaw;
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => run({
    $queryRaw: async () => [{ kind: "invalid" }]
  })) as typeof transaction;
  try {
    await app.register(jwt, { secret: "qa-conversation-export-test-secret" });
    await registerSakiRoutes(app);
    const token = (sub: string) => app.jwt.sign({ sub, username: sub, permissions: ["saki.agent"] });
    const headers = { authorization: `Bearer ${token("owner")}` };
    const response = await app.inject({ url: `/api/saki/conversations/${conversation.id}/export`, headers });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-type"]), /text\/markdown; charset=utf-8/);
    assert.match(String(response.headers["content-disposition"]), /attachment;.*filename\*=UTF-8''/);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(response.body.includes("unique-message-0") && response.body.includes("unique-message-999"));
    assert.deepEqual(queries[0], { id: conversation.id, userId: "owner" });
    assert.equal((await app.inject({ url: `/api/saki/conversations/${conversation.id}/export` })).statusCode, 401);
    assert.equal((await app.inject({ url: `/api/saki/conversations/${conversation.id}/export`, headers: { authorization: `Bearer ${token("no-permission")}` } })).statusCode, 403);
    assert.equal((await app.inject({ url: `/api/saki/conversations/${conversation.id}/export`, headers: { authorization: `Bearer ${token("other")}` } })).statusCode, 404);
    assert.equal((await app.inject({ url: "/api/saki/conversations/corrupt/export", headers })).statusCode, 500);
  } finally {
    await app.close();
    prisma.sakiConversation.findFirst = findConversation;
    prisma.sakiConversationMessage.findMany = findMessages;
    prisma.sakiConversationMessage.findUnique = findMessage;
    prisma.$queryRaw = queryRaw;
    prisma.$transaction = transaction;
    prisma.user.findUnique = findUser;
    panelConfig.disableAuth = authDisabled;
    await prisma.$disconnect();
  }
});
