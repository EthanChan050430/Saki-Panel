import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SakiActiveTask } from "../apps/panel/src/routes/saki/types.js";

test("legacy history migrates once and follow-ups save only their own turn", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "saki-storage-test-"));
  const schema = path.join(directory, "schema.prisma");
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(directory, "history.db")}`;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await fs.writeFile(schema, (await fs.readFile("prisma/schema.prisma", "utf8")).replace("file:../data/panel/dev.db", "file:./history.db"));
    await fs.writeFile(path.join(directory, "history.db"), "");
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", schema]);
    const { prisma } = await import("../apps/panel/src/db.js");
    disconnect = () => prisma.$disconnect();
    const { saveClientSakiConversation, persistSakiTaskConversation } = await import("../apps/panel/src/routes/saki/conversations.js");
    const { readMessageAt, selectConversationPage, iterateConversationMessages, conversationEditHistory } = await import("../apps/panel/src/routes/saki/conversation-store.js");
    await prisma.user.create({ data: { id: "owner", username: "owner", passwordHash: "test", displayName: "Owner" } });
    const output = "large tool output".repeat(150_000);
    const history = Array.from({ length: 8 }, (_, index) => ({
      id: `m-${index}`, role: index % 2 ? "assistant" : "user", content: String(index),
      ...(index % 2 ? { actions: [{ id: "action", tool: "readFile", observation: output }] } : {})
    }));
    const originalRow = await prisma.sakiConversation.create({
      data: { id: "history", userId: "owner", contextKey: "global", title: "History", messages: JSON.stringify(history) },
      select: { updatedAt: true }
    });
    const [page, samePage] = await Promise.all([selectConversationPage("history", 30), selectConversationPage("history", 30)]);
    assert.deepEqual(page, samePage);
    assert.equal(page.historyBeforeId, "m-6");
    assert.deepEqual(await readMessageAt("history", page.positions.at(-1)!), history.at(-1));
    const oldData = await prisma.sakiConversationMessage.findMany({ select: { position: true, data: true }, orderBy: { position: "asc" } });
    const task = { id: "run", userId: "owner", instanceId: null, input: { conversationId: "history", message: "continue" },
      startedAt: new Date().toISOString(), eventsBuffer: [] } as unknown as SakiActiveTask;
    await persistSakiTaskConversation(task);
    await persistSakiTaskConversation(task, { source: "direct-model", message: "finished" });
    const stored = await prisma.sakiConversationMessage.findMany({ select: { position: true, data: true }, orderBy: { position: "asc" } });
    assert.deepEqual(stored.slice(0, history.length), oldData);
    assert.equal(stored.length, history.length + 2);
    assert.equal((await conversationEditHistory("history", "m-7"))[2]?.content, "finished");
    const current = await prisma.sakiConversation.findUniqueOrThrow({ where: { id: "history" }, select: { updatedAt: true, messages: true } });
    assert.equal(current.messages, "[]");
    await assert.rejects(saveClientSakiConversation("owner", "history", { baseUpdatedAt: originalRow.updatedAt.toISOString(), messages: [] }), /changed on another device/);
    await assert.rejects(saveClientSakiConversation("other", "history", { messages: [] }), /Forbidden/);
    await assert.rejects(saveClientSakiConversation("owner", "history", { messages: [], messagesLoaded: false }), /Load conversation/);
    await saveClientSakiConversation("owner", "history", { baseUpdatedAt: current.updatedAt.toISOString(), historyBeforeId: "m-7", messages: [{ id: "edited", role: "user", content: "replacement" }] });
    const preserved = [];
    for await (const message of iterateConversationMessages("history")) preserved.push(message);
    assert.deepEqual(preserved.slice(0, 7), history.slice(0, 7));
    assert.equal(preserved.length, 8);
    await prisma.sakiConversation.delete({ where: { id: "history" } });
    assert.equal(await prisma.sakiConversationMessage.count(), 0);
  } finally {
    await disconnect?.();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
  }
});
