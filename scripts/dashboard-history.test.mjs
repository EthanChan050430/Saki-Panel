import test from "node:test";
import assert from "node:assert/strict";
import { loadCallback } from "./regression-support.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function fixture(cachedMessages) {
  const requests = [];
  const state = { messages: [], loading: false, error: null, sessions: [{ id: "B", instanceId: null }] };
  const globals = {
    activeSessionIdRef: { current: "B" }, sessionRequestGenerationRef: { current: 0 },
    hydratedSessionIdsRef: { current: new Set() }, sessionLoadingRef: { current: false },
    sessionsRef: { current: state.sessions }, streamRunsRef: { current: new Map() },
    localHistoryOnlyRef: { current: false }, historyVersionsRef: { current: new Map() },
    userId: "review", token: "review", language: "zh",
    setMessages: value => { state.messages = value; },
    setSessionLoading: value => { state.loading = value; },
    setSessionLoadError: value => { state.error = value; },
    setActiveInstanceId() {}, setWorkspaceInstanceIds() {},
    normalizeSakiWorkspaceIds: () => [], sakiWorkspaceIdsFromContextKey: () => [],
    formatStoredChatMessage: value => value,
    readSakiConversations: () => cachedMessages ? [{ id: "B", messages: cachedMessages, updatedAt: "v1" }] : [],
    setSessions: update => { state.sessions = update(state.sessions); globals.sessionsRef.current = state.sessions; },
    api: { sakiGetConversation: (token, id) => { const request = { id, ...deferred() }; requests.push(request); return request.promise; } }
  };
  const load = loadCallback("apps/web/src/views/DashboardView.tsx", "loadSessionDetail", globals);
  const remote = (id = "B", messages = [{ content: "remote history" }]) => ({ id, messages, updatedAt: "v2", instanceId: null });
  return { state, globals, requests, load, remote };
}

test("cached history stays locked until authoritative detail arrives", async () => {
  const f = fixture([{ content: "cached history" }]);
  const pending = f.load("B");
  assert.equal(f.globals.sessionLoadingRef.current, true);
  assert.equal(f.state.loading, true);
  f.requests[0].resolve(f.remote());
  await pending;
  assert.equal(f.state.messages[0].content, "remote history");
  assert.equal(f.globals.sessionLoadingRef.current, false);
});

test("failed history remains locked, and retry restores the full history", async () => {
  const f = fixture();
  const failed = f.load("B");
  f.requests[0].reject(new Error("offline"));
  await failed;
  assert.equal(f.state.error, "offline");
  assert.equal(f.globals.sessionLoadingRef.current, true);
  const retry = f.load("B");
  f.requests[1].resolve(f.remote());
  await retry;
  assert.equal(f.state.error, null);
  assert.equal(f.globals.sessionLoadingRef.current, false);
});

test("an invalidated response cannot erase messages from a new turn", async () => {
  const f = fixture([{ content: "cached" }]);
  const pending = f.load("B");
  f.globals.sessionRequestGenerationRef.current++;
  f.state.messages = [{ content: "new question" }];
  f.requests[0].resolve(f.remote());
  await pending;
  assert.equal(f.state.messages[0].content, "new question");
  assert.equal(f.globals.historyVersionsRef.current.size, 0);
});

test("same-session requests resolving out of order keep the newest result", async () => {
  const f = fixture();
  const first = f.load("B");
  const second = f.load("B");
  f.requests[1].resolve(f.remote("B", [{ content: "newest" }]));
  await second;
  f.requests[0].resolve(f.remote("B", [{ content: "stale" }]));
  await first;
  assert.equal(f.state.messages[0].content, "newest");
});

test("switching sessions suppresses the previous session's success and failure", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    const pending = f.load("B");
    f.globals.activeSessionIdRef.current = "C";
    f.state.messages = [{ content: "session C" }];
    if (fail) f.requests[0].reject(new Error("late failure"));
    else f.requests[0].resolve(f.remote());
    await pending;
    assert.equal(f.state.messages[0].content, "session C");
    assert.equal(f.state.error, null);
  }
});

test("successfully loaded empty conversations do not trigger repeated fetches", async () => {
  const f = fixture();
  const pending = f.load("B");
  f.requests[0].resolve(f.remote("B", []));
  await pending;
  await f.load("B");
  assert.equal(f.requests.length, 1);
  assert.equal(f.globals.sessionLoadingRef.current, false);
});

test("live streams retain their messages and history reloads after they settle", async () => {
  const f = fixture();
  const pending = f.load("B");
  f.globals.streamRunsRef.current.set("B", {});
  f.state.sessions[0].messages = [{ content: "live output" }];
  f.state.messages = [];
  await f.load("B");
  f.requests[0].resolve(f.remote());
  await pending;
  assert.equal(f.state.messages[0].content, "live output");
  assert.equal(f.state.loading, false);
  f.globals.streamRunsRef.current.clear();
  const reload = f.load("B");
  f.requests[1].resolve(f.remote("B", [{ content: "complete history" }]));
  await reload;
  assert.equal(f.state.messages[0].content, "complete history");
  assert.equal(f.globals.sessionLoadingRef.current, false);
});
