import assert from "node:assert/strict";
import test from "node:test";
import { AgentToolLoopGuard, agentChecklistSignature, agentToolExecutionSignature, isAgentChecklistTool } from "../apps/panel/src/routes/saki/agent-tool-guard.js";
import type { SakiAgentAction } from "../packages/shared/src/index.js";

const action = (observation = "ok", ok = true): SakiAgentAction => ({ id: "a", tool: "runCommand", args: {}, observation, ok, status: ok ? "completed" : "failed", createdAt: new Date().toISOString() });
const work = { readOnly: false, bookkeeping: false };
const read = { readOnly: true, bookkeeping: false };

test("checklist identity preserves task state but ignores CRLF and checkbox case", () => {
  assert.equal(agentChecklistSignature({ todos: "- [X] Done\r\n- [-] Work  " }), agentChecklistSignature({ list: " - [x] Done\n- [-] Work" }));
  assert.notEqual(agentChecklistSignature({ todos: "- [ ] Work" }), agentChecklistSignature({ todos: "- [x] Work" }));
  for (const todos of ["", "Work", "- [ ] ", "- [ ] " + "a".repeat(201)]) assert.equal(agentChecklistSignature({ todos }), null);
  for (const alias of ["manageTodos", "setTodos", "todos", "updateTodos", "manage_todos", "todoTool", "taskList"]) assert.equal(isAgentChecklistTool(alias), true);
});

test("semantic execution identity ignores narration and refresh, not inputs or scope", () => {
  const key = agentToolExecutionSignature("runcommand", { command: "echo ok", cwd: ".", note: "first" }, "one");
  assert.equal(key, agentToolExecutionSignature("runcommand", { refresh: true, note: "next", cwd: ".", command: "echo ok" }, "one"));
  assert.notEqual(key, agentToolExecutionSignature("runcommand", { command: "echo changed", cwd: "." }, "one"));
  assert.notEqual(key, agentToolExecutionSignature("runcommand", { command: "echo ok", cwd: "." }, "two"));
});

test("repeat blocking follows consecutive equal outcomes, not lifetime attempts", () => {
  const guard = new AgentToolLoopGuard(3);
  for (let index = 0; index < 3; index++) {
    assert.equal(guard.blockedAttempts("a", false), 0);
    guard.record("a", action(), work);
  }
  assert.equal(guard.blockedAttempts("a", false), 3);
  guard.record("plan", action(), { readOnly: true, bookkeeping: true });
  assert.equal(guard.blockedAttempts("a", false), 3);
  guard.record("different-real-work", action("new result"), read);
  assert.equal(guard.blockedAttempts("a", false), 0);
  guard.record("a", action("changed result"), work);
  assert.equal(guard.blockedAttempts("a", false), 0);
  for (let index = 0; index < 3; index++) guard.record("b", action(), work);
  assert.equal(guard.blockedAttempts("b", false), 3);
  guard.reset();
  assert.equal(guard.blockedAttempts("b", false), 0);
  assert.equal(guard.record("b", action(), work), true);
});

test("refreshing unchanged evidence is not progress and does not block changing reads", () => {
  const guard = new AgentToolLoopGuard(3);
  assert.equal(guard.record("read", action("pending"), read), true);
  for (let index = 0; index < 6; index++) {
    assert.equal(guard.record("read", action("pending"), read), false);
    assert.equal(guard.blockedAttempts("read", true), 0);
  }
  assert.equal(guard.record("read", action("ready"), read), true);
  assert.equal(guard.record("plan", action("new plan"), { readOnly: true, bookkeeping: true }), false);
  assert.equal(guard.record("read", action("ready"), read), false);
  guard.record("edit", action("changed files"), work);
  assert.equal(guard.record("read", action("ready"), read), true);
});

test("repeated failures remain blocked, pending approval never becomes evidence", () => {
  const guard = new AgentToolLoopGuard(3);
  for (let index = 0; index < 3; index++) assert.equal(guard.record("a", action("failure", false), read), false);
  assert.equal(guard.blockedAttempts("a", true), 3);
  assert.equal(guard.record("pending", { ...action(), status: "pending_approval" }, work), false);
  assert.equal(guard.blockedAttempts("a", true), 3);
});
