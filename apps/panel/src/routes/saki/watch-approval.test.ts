import assert from "node:assert/strict";
import test from "node:test";
import { assertWatchToolAllowed, shouldRequestSakiApproval } from "./tools.js";
import type { SakiAgentRuntime } from "./types.js";
import type { SakiAgentPermissionMode } from "@webops/shared";

function runtime(kind: "watch" | "chat", mode: SakiAgentPermissionMode = "ask"): SakiAgentRuntime {
  return { kind, watchMode: "diagnose_and_patch", input: { message: "Diagnose the crash", mode: "agent", agentPermissionMode: mode } } as SakiAgentRuntime;
}

test("Watch stages config edits even when ordinary Agent edits are accepted", () => {
  const calls = [
    ["writeFile", { path: "service.json", content: '{"port":16541}' }],
    ["replaceInFile", { path: "service.json", oldText: "70000", newText: "16541" }],
    ["editLines", { path: "service.json", startLine: 4, endLine: 4, replacement: '  "port": 16541' }],
    ["batchEdit", { edits: [{ path: "service.json", oldText: "70000", newText: "16541" }] }],
    ["apply_patch", { patch: '*** Begin Patch\n*** Update File: service.json\n@@\n-  "port": 70000\n+  "port": 16541\n*** End Patch' }]
  ] as const;
  for (const mode of ["ask", "acceptEdits", "bypassPermissions"] as const) {
    for (const [tool, args] of calls) {
      assert.equal(shouldRequestSakiApproval(runtime("watch", mode), tool, args), true, `${mode}: ${tool}`);
    }
  }
});

test("Watch reads remain available while diagnose-only mode blocks writes", () => {
  const watch = runtime("watch");
  assert.equal(shouldRequestSakiApproval(watch, "readFile", { path: "service.json" }), false);
  watch.watchMode = "diagnose_only";
  assert.throws(() => assertWatchToolAllowed(watch, "replaceInFile", { path: "service.json" }), /diagnose-only/);
});

test("ordinary Agent config edits keep their existing permission behavior", () => {
  assert.equal(shouldRequestSakiApproval(runtime("chat"), "replaceInFile", { path: "service.json", oldText: "70000", newText: "16541" }), false);
});
