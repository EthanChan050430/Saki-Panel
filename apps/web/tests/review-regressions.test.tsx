import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeAuditDiff, firstAuditText } from "../src/components/audit/auditDiff.js";
import { SparklineRibbon } from "../src/components/common/SparklineRibbon.js";
import { SpotlightCommandPalette } from "../src/components/common/SpotlightCommandPalette.js";
import { parseSmartLogBlocks } from "../src/components/terminal/SmartLogCollapser.js";
import { writeSakiPetScale } from "../src/components/saki/pet/sakiPetState.js";

test("audit diffs preserve unchanged lines across long insertions and empty replacements", () => {
  const inserted = Array.from({ length: 20 }, (_, i) => `new ${i}`).join("\n");
  const result = computeAuditDiff("before\nafter\n", `before\n${inserted}\nafter\n`);
  assert.equal(result.lines.filter((line) => line.type === "add").length, 20);
  assert.equal(result.lines.filter((line) => line.type === "del").length, 0);
  assert.equal(computeAuditDiff("old\n", "").lines.length, 1);
  assert.equal(firstAuditText({}, null, "", "fallback"), "");
  assert.equal(computeAuditDiff("", "").lines.length, 0);
  assert.equal(computeAuditDiff("", "line\n".repeat(5000)).truncated, true);
  assert.equal(computeAuditDiff("", "line\n".repeat(1000)).truncated, false);
});

test("command palette hides inaccessible pages and unavailable Saki actions", () => {
  const html = renderToStaticMarkup(<SpotlightCommandPalette open onClose={() => {}} onNavigate={() => {}} darkMode={false} onToggleDarkMode={() => {}} availableViews={["instances"]} />);
  assert.match(html, /应用实例/);
  assert.doesNotMatch(html, /审计与合规|用户与权限|全站风险与健康研判|集群节点/);
});

test("multiple ribbons use unique SVG resources and tolerate non-finite values", () => {
  const html = renderToStaticMarkup(<><SparklineRibbon data={[1, NaN, 2]} /><SparklineRibbon data={[Infinity, 5]} /></>);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("a final error stack collapses consistently and includes unparenthesized frames", () => {
  const log = ["ReferenceError: missing", ...Array.from({ length: 8 }, (_, i) => `    at file.js:${i + 1}:2`)].join("\n");
  const blocks = parseSmartLogBlocks(log);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "error_stack");
  assert.equal(blocks[0]?.defaultCollapsed, true);
});

test("pet scaling recovers corrupt storage and broadcasts changes even when storage fails", (t) => {
  let raw = "null";
  const target = new EventTarget();
  let emitted: number | undefined;
  target.addEventListener("saki:set_pet_scale", (event) => { emitted = (event as CustomEvent<number>).detail; });
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(writeSakiPetScale(1.25), 1.25);
  assert.equal(JSON.parse(raw).scale, 1.25);
  assert.equal(emitted, 1.25);
  raw = "invalid json";
  assert.equal(writeSakiPetScale(NaN), 1);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
  assert.equal(writeSakiPetScale(0.8), 0.8);
  assert.equal(emitted, 0.8);
});
