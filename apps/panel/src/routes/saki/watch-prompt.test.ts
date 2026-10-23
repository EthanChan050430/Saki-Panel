import assert from "node:assert/strict";
import test from "node:test";
import { buildWatchSystemPrompt, buildWatchUserMessage } from "./watch-prompt.js";
import type { InstanceWithNode } from "./types.js";

const instance = { name: "Recovery Demo", status: "CRASHED", lastExitCode: 1, startCommand: "node server.mjs", workingDirectory: "demo", restartPolicy: "never" } as InstanceWithNode;
const input = { instance, context: { instance, workspace: null, logs: [] }, exitCode: 1, logTail: "ERR_SOCKET_BAD_PORT: 70000", trigger: "crash", mode: "diagnose_and_patch" as const, willRetry: false };

test("Watch receives the configured health endpoint without credentials or query secrets", () => {
  const prompt = buildWatchUserMessage({ ...input, healthCheckUrl: "http://user:secret@127.0.0.1:16541/health?token=private#fragment" });
  assert.ok(prompt.includes("http://127.0.0.1:16541/health"));
  for (const secret of ["user:secret", "private", "fragment"]) assert.ok(!prompt.includes(secret));
});

test("missing health checks are explicit and uncertain fixes are constrained", () => {
  assert.ok(buildWatchUserMessage(input).includes("(not configured)"));
  assert.ok(buildWatchSystemPrompt("diagnose_and_patch").includes("Never choose an arbitrary valid port"));
  assert.ok(buildWatchSystemPrompt("diagnose_only").includes("Do not edit files."));
});
