import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SakiAgentAction, SakiTimelineEvent } from "../packages/shared/src/index.js";
import { mergeConversationMessages, pageConversationMessages } from "../apps/panel/src/routes/saki/conversation-history.js";
import { sakiTaskHistorySnapshot } from "../apps/panel/src/routes/saki/task-history.js";
import { replaySakiTimeline } from "../apps/web/src/components/saki/timeline-replay.js";
import { saveClientSakiConversation } from "../apps/panel/src/routes/saki/conversations.js";
import { prisma } from "../apps/panel/src/db.js";
import { panelPaths } from "../apps/panel/src/config.js";
import { toSakiActiveTaskSummary } from "../apps/panel/src/routes/saki/state.js";
import type { SakiActiveTask } from "../apps/panel/src/routes/saki/types.js";

const history = Array.from({ length: 1000 }, (_, index) => ({ id: `m-${index}`, role: index % 2 ? "assistant" : "user", content: `${index}` }));
const action = (id: string, workflowId = `w-${id}`): SakiAgentAction => ({ id, workflowId, tool: "readFile", args: {}, observation: "ok", ok: true, createdAt: new Date(1000).toISOString() });
const event = (id: string, type: SakiTimelineEvent["type"], payload: Record<string, unknown>, ts = 1000): SakiTimelineEvent => ({ id, type, payload, ts });

test("latest history page is small; older cursors survive new messages", () => {
  const page = pageConversationMessages(history, 30);
  assert.equal(page.messages.length, 30);
  assert.equal(page.messages[0]?.id, "m-970");
  const older = pageConversationMessages([...history, { id: "new", role: "user", content: "new" }], 30, page.historyBeforeId!);
  assert.deepEqual(older.messages, history.slice(940, 970));
});

test("paging keeps a question with its answer and reaches the beginning", () => {
  assert.equal(pageConversationMessages(history, 29).messages[0]?.role, "user");
  assert.equal(pageConversationMessages(history, 30, "m-10").historyBeforeId, null);
  assert.deepEqual(pageConversationMessages([], 30).messages, []);
  assert.throws(() => pageConversationMessages(history, 30, "deleted"));
  assert.throws(() => pageConversationMessages(history, Number.NaN));
});

test("saving a suffix preserves every unseen message, including deletion of its first loaded turn", () => {
  const edited = [{ ...history[972]!, content: "edited" }, ...history.slice(973)];
  const merged = mergeConversationMessages(history, edited, "m-970");
  assert.deepEqual(merged.slice(0, 970), history.slice(0, 970));
  assert.equal(merged.length, 998);
  assert.equal(merged[970]?.content, "edited");
  assert.throws(() => mergeConversationMessages(history, edited, "deleted"));
  assert.deepEqual(mergeConversationMessages(history, []), []);
});

test("snapshot retains more than 500 events and the latest approval/action state", () => {
  const events = Array.from({ length: 1200 }, (_, index) => event(`e-${index}`, "delta", { text: `${index},` }));
  const pending = { ...action("a"), status: "pending_approval" as const };
  const completed = { ...action("a"), status: "completed" as const };
  const snapshot = sakiTaskHistorySnapshot([...events, event("pending", "action", { action: pending }), event("completed", "action", { action: completed }), { type: "done", payload: {}, ts: 1000 }]);
  assert.equal(snapshot.timelineEvents?.length, 1202);
  assert.ok(snapshot.message.startsWith("0,1,"));
  assert.ok(snapshot.message.endsWith("1199,"));
  assert.deepEqual(snapshot.actions, [completed]);
});

test("task polling can omit the transcript while task details retain it", () => {
  const response = { source: "direct-model" as const, message: "done", timelineEvents: [event("old", "delta", { text: "done" })] };
  const task = { id: "qa", userId: "owner", instanceId: null, input: { message: "qa", mode: "agent" },
    status: "completed", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    eventsBuffer: [], subscribers: new Set(), response } as SakiActiveTask;
  assert.equal(toSakiActiveTaskSummary(task, false).response, undefined);
  assert.strictEqual(toSakiActiveTaskSummary(task).response, response);
});

test("replay preserves text, narration, thinking duration, tool order, and updated action IDs", () => {
  const events = [event("think", "thinking", { text: "reason" }, 1000), event("text", "delta", { text: "answer" }, 2000),
    event("work", "workflow", { id: "w-a", stage: "tool", status: "running", tool: "readFile", message: "reading" }, 3000),
    event("act", "action", { action: action("a") }, 4000),
    event("narr", "workflow", { id: "narr", stage: "narration", message: "continue" }, 5000),
    event("more", "delta", { text: "done" }, 6000),
    event("updated", "action", { action: { ...action("a"), observation: "updated" } }, 7000)];
  const timeline = replaySakiTimeline(events);
  assert.deepEqual(timeline.map(item => item.kind), ["text", "action", "text", "text"]);
  assert.equal(timeline[0]?.kind === "text" && timeline[0].content, "answer");
  assert.equal(timeline[0]?.kind === "text" && timeline[0].thinkingDurationSec, 2);
  assert.equal(timeline[1]?.kind === "action" && timeline[1].action.observation, "updated");
  assert.strictEqual(replaySakiTimeline(events), timeline);
});

test("replay handles a long task without quadratic array rebuilding", () => {
  const events: SakiTimelineEvent[] = [];
  for (let index = 0; index < 20000; index++) {
    events.push(event(`w-${index}`, "workflow", { id: `w-${index}`, stage: "tool", status: "running", tool: "readFile", message: "reading" }));
    events.push(event(`a-${index}`, "action", { action: action(`${index}`, `w-${index}`) }));
  }
  const started = performance.now();
  const timeline = replaySakiTimeline(events);
  assert.equal(timeline.length, 20000);
  assert.ok(timeline.every(item => item.kind === "action"));
  assert.ok(performance.now() - started < 5000, "40,000 events should replay within five seconds");
  assert.equal(events.length, 40000);
});

test("conversation persistence protects the unloaded prefix, ownership, and conflicting versions", async () => {
  const originalFind = prisma.sakiConversation.findUnique;
  const originalUpdate = prisma.sakiConversation.updateMany;
  const updatedAt = new Date("2026-11-03T00:00:00.000Z");
  let saved: Record<string, unknown> | undefined;
  prisma.sakiConversation.findUnique = async () => ({ id: "history-qa", userId: "owner", messages: JSON.stringify(history), updatedAt }) as any;
  prisma.sakiConversation.updateMany = async (args: any) => { saved = args.data; return { count: 1 }; };
  try {
    await saveClientSakiConversation("owner", "history-qa", { historyBeforeId: "m-970", baseUpdatedAt: updatedAt.toISOString(), messages: history.slice(972) });
    const persisted = JSON.parse(saved!.messages as string);
    assert.equal(persisted.length, 998);
    assert.deepEqual(persisted.slice(0, 970), history.slice(0, 970));
    saved = undefined;
    await assert.rejects(saveClientSakiConversation("owner", "history-qa", { historyBeforeId: "m-970", baseUpdatedAt: "stale", messages: history.slice(970) }), /changed on another device/);
    await assert.rejects(saveClientSakiConversation("other", "history-qa", { messages: [] }), /Forbidden/);
    await assert.rejects(saveClientSakiConversation("owner", "history-qa", { messages: [], messagesLoaded: false }), /Load conversation/);
    assert.equal(saved, undefined);
  } finally {
    prisma.sakiConversation.findUnique = originalFind;
    prisma.sakiConversation.updateMany = originalUpdate;
    await prisma.$disconnect();
  }
});

test("default permission policy is persisted and survives unrelated model settings updates", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "saki-history-settings-"));
  const originalPath = panelPaths.sakiConfigFile;
  const destination = path.join(directory, "settings.json");
  panelPaths.sakiConfigFile = destination;
  try {
    const { readEffectiveSakiConfig, saveSakiConfig } = await import("../apps/panel/src/routes/saki/config.js");
    assert.equal((await readEffectiveSakiConfig()).defaultAgentPermissionMode, "acceptEdits");
    for (const mode of ["ask", "acceptEdits", "plan", "bypassPermissions"] as const) {
      await saveSakiConfig({ defaultAgentPermissionMode: mode });
      assert.equal((await readEffectiveSakiConfig()).defaultAgentPermissionMode, mode);
    }
    await saveSakiConfig({ model: "qa-model" });
    assert.equal((await readEffectiveSakiConfig()).defaultAgentPermissionMode, "bypassPermissions");
  } finally {
    panelPaths.sakiConfigFile = originalPath;
    await fs.rm(destination, { force: true });
    await fs.rmdir(directory);
  }
});
