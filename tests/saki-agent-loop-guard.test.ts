import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ParsedToolCall, SakiAgentRuntime, SakiAgentResumeState } from "../apps/panel/src/routes/saki/types.js";
import type { SakiAgentAction } from "../packages/shared/src/index.js";

test("agent loop distinguishes checklist sync, new evidence and real failures", async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "saki-loop-guard-"));
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const envKeys = ["SAKI_AGENT_MAX_LOOPS", "SAKI_AGENT_MAX_TOKENS", "SAKI_AGENT_MAX_DURATION_MS", "http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];
  const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) process.env[key] = key.startsWith("SAKI_") ? "0" : "";
  console.info = (...args) => { if (!String(args[0]).startsWith("[Saki")) originalInfo(...args); };
  const { panelPaths } = await import("../apps/panel/src/config.js");
  const originalDataDir = panelPaths.dataDir;
  panelPaths.dataDir = temporary;
  const { runSakiAgent } = await import("../apps/panel/src/routes/saki/loop.js");
  const { sessionAgentMemoriesReady, extractConfirmedTodos } = await import("../apps/panel/src/routes/saki/state.js");
  await sessionAgentMemoriesReady;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    panelPaths.dataDir = originalDataDir;
    for (const [key, value] of originalEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(temporary, { recursive: true, force: true });
  });

  type Spec = { name: string; args: Record<string, unknown> };
  const plan = (todos = "- [x] Check results"): Spec => ({ name: "manageTodos", args: { todos } });
  async function run(choose: (round: number) => Spec[] | null, result?: (call: ParsedToolCall, round: number) => Partial<SakiAgentAction>, restored: SakiAgentAction[] = [], denyPlan = false) {
    let rounds = 0;
    const executed: string[] = [];
    const events: SakiAgentAction[] = [];
    globalThis.fetch = async url => {
      assert.match(String(url), /^http:\/\/127\.0\.0\.1:1\/v1\//);
      const calls = choose(++rounds);
      const message = calls ? { role: "assistant", content: "继续检查。", tool_calls: calls.map((call, index) => ({ id: `call-${rounds}-${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) }
        : { role: "assistant", content: "已完成检查。" };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } }), { headers: { "content-type": "application/json" } });
    };
    const input = { message: "检查结果并报告。", mode: "agent" as const };
    const runtime = { input, context: { instance: null, workspace: null, logs: [] }, skills: [], userId: "", permissions: [],
      config: { provider: "openai", model: "gpt-4o", baseUrl: "http://127.0.0.1:1/v1", apiKey: "local-fixture", providerConfigs: {}, searchEnabled: false, mcpEnabled: false, requestTimeoutMs: 120000, ollamaUrl: "", imageGen: {}, videoGen: {}, appearance: {} }, kind: "chat", maxLoops: 30 } as SakiAgentRuntime;
    const resume: SakiAgentResumeState = { input, skills: [], actions: restored, scratchpadEntries: [], toolExecutions: 0 };
    const execute = async (_runtime: SakiAgentRuntime, call: ParsedToolCall): Promise<SakiAgentAction> => {
      executed.push(call.name);
      const args = call.args as Record<string, unknown>;
      return { id: `a-${rounds}-${executed.length}`, tool: call.name, args, observation: `confirmed ${call.name}`, ok: true, status: "completed", createdAt: new Date().toISOString(),
        ...(call.name === "manageTodos" ? { todos: [{ text: String(args.todos).slice(6), completed: true, inProgress: false }] } : {}), ...result?.(call, rounds) };
    };
    Object.assign(execute, { authorize: async (_runtime: SakiAgentRuntime, call: ParsedToolCall) => {
      if (denyPlan && call.name === "manageTodos") throw new Error("fixture authorization denied");
    } });
    const response = await runSakiAgent(runtime, { action: action => events.push(action) }, resume, execute);
    return { response, executed, events, rounds };
  }

  await t.test("unchanged plans between real work are reused beyond three submissions", async () => {
    const { response, executed, events } = await run(round => round > 8 ? null : [plan(), { name: "statFile", args: { path: `result-${round}` } }]);
    assert.equal(response.retry, undefined);
    assert.equal(executed.filter(name => name === "manageTodos").length, 1);
    assert.equal(executed.filter(name => name === "statFile").length, 8);
    const plans = events.filter(action => action.tool === "manageTodos");
    assert.equal(plans.length, 8);
    assert.ok(plans.every(action => action.ok && action.todos?.[0]?.completed));
    assert.match(plans[7]!.observation, /计划未变化/);
  });

  await t.test("changing A to B and back to A executes the current update", async () => {
    const { response, executed, events } = await run(round => round === 1 ? [plan("- [x] A"), plan("- [x] B"), plan("- [x] A")] : null);
    assert.equal(response.retry, undefined);
    assert.equal(executed.length, 3);
    assert.equal(events.at(-1)?.args.todos, "- [x] A");
  });

  await t.test("restored checklist replay still revalidates authorization", async () => {
    const restored: SakiAgentAction = { id: "previous", tool: "manageTodos", args: plan().args, todos: [{ text: "Check results", completed: true }], observation: "previous plan", ok: true, status: "completed", createdAt: new Date().toISOString() };
    const allowed = await run(round => round === 1 ? [plan(), { name: "statFile", args: { path: "result" } }] : null, undefined, [restored]);
    assert.equal(allowed.executed.filter(name => name === "manageTodos").length, 0);
    assert.equal(allowed.response.retry, undefined);
    const denied = await run(round => round === 1 ? [plan()] : null, undefined, [restored], true);
    assert.equal(denied.events.length, 1);
    assert.equal(denied.events[0]?.ok, false);
    assert.match(denied.events[0]!.observation, /Authorization denied/);
  });

  await t.test("plan-only loops stop without reporting a failed checklist update", async () => {
    const { response, executed, events, rounds } = await run(() => [plan()]);
    assert.equal(rounds, 4);
    assert.equal(executed.length, 1);
    assert.ok(events.every(action => action.ok));
    assert.match(response.retry!.reason, /连续 4 轮未获得新的执行结果/);
  });

  await t.test("refreshing unchanged reads cannot manufacture progress", async () => {
    const { response, executed, rounds } = await run(() => [{ name: "statFile", args: { path: "same", refresh: true } }]);
    assert.equal(executed.length, 5);
    assert.equal(rounds, 5);
    assert.match(response.retry!.reason, /连续 4 轮/);
  });

  await t.test("changing read results remain valid beyond the duplicate threshold", async () => {
    const { response, executed } = await run(round => round > 7 ? null : [{ name: "statFile", args: { path: "same", refresh: true } }], (_call, round) => ({ observation: round <= 3 ? "pending" : `version=${round}` }));
    assert.equal(executed.length, 7);
    assert.equal(response.retry, undefined);
  });

  await t.test("a read-only terminal inspection can change after three equal results", async () => {
    const { response, executed } = await run(round => round > 4 ? null : [{ name: "runCommand", args: { command: "git status" } }], (_call, round) => ({ observation: round <= 3 ? "pending" : "changed state" }));
    assert.equal(executed.length, 4);
    assert.equal(response.retry, undefined);
  });

  await t.test("checklist aliases preserve the latest completion state", async () => {
    const { response, executed } = await run(round => round > 2 ? null : [{ name: "taskList", args: { todos: "- [x] Done" } }, { name: "statFile", args: { path: `result-${round}` } }]);
    assert.equal(executed.filter(name => name === "manageTodos").length, 1);
    const historical: SakiAgentAction = { id: "alias", tool: "taskList", args: { todos: "- [x] Done" }, observation: "confirmed", ok: true, status: "completed", createdAt: new Date().toISOString() };
    assert.deepEqual(extractConfirmedTodos([historical], []), ["- [x] Done"]);
    assert.equal(response.retry, undefined);
  });

  await t.test("changing narration does not bypass repeated mutation blocking", async () => {
    const { response, executed, events } = await run(round => [{ name: "runCommand", args: { command: "fixture-operation", note: `attempt ${round}` } }]);
    assert.equal(executed.length, 3);
    assert.equal(events.filter(action => !action.ok).length, 2);
    assert.match(events.at(-1)!.observation, /连续 3 次/);
    assert.match(response.retry!.reason, /连续 4 轮/);
  });

  await t.test("plan sync does not erase five real tool failures", async () => {
    const calls = Array.from({ length: 5 }, (_, index) => [{ name: "runCommand", args: { command: `fixture-failure-${index}` } }, plan()]).flat();
    const { response, events } = await run(() => calls, call => call.name === "runCommand" ? { ok: false, status: "failed", observation: "fixture failure" } : {});
    assert.equal(events.filter(action => !action.ok).length, 5);
    assert.match(response.retry!.reason, /连续多次工具调用失败/);
  });
});
