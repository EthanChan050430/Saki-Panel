import { applyPatchToContent, parseWorkspacePatch } from "../apps/panel/src/routes/saki/patch.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const unified = `--- a/hello.ts
+++ b/hello.ts
@@ -1,3 +1,3 @@
 export function hello() {
-  return "hi";
+  return "hello";
 }
`;

const files = parseWorkspacePatch(unified);
assert(files.length === 1 && files[0]?.path === "hello.ts" && files[0]?.kind === "update", "parses unified update");
const next = applyPatchToContent(`export function hello() {\n  return "hi";\n}\n`, files[0]!.unified, "hello.ts");
assert(next.includes('return "hello"'), "applies unified hunk");

const addPatch = `*** Begin Patch
*** Add File: src/new.ts
+export const n = 1;
*** End Patch`;
const added = parseWorkspacePatch(addPatch);
assert(added.length === 1 && added[0]?.kind === "add" && added[0]?.path === "src/new.ts", "parses Codex add file");
const created = applyPatchToContent("", added[0]!.unified, "src/new.ts");
assert(created.includes("export const n = 1"), "applies add-file patch");

const trailing = applyPatchToContent(
  `export function hello() {\n  return "hi";  \n}\n`,
  files[0]!.unified,
  "hello.ts"
);
assert(trailing.includes('return "hello"'), "applies when context line has trailing whitespace");

const crlf = applyPatchToContent(
  `export function hello() {\r\n  return "hi";\r\n}\r\n`,
  files[0]!.unified,
  "hello.ts"
);
assert(crlf.includes("\r\n") && crlf.includes('return "hello"'), "preserves CRLF after fuzzy apply");

let rejected = false;
try {
  applyPatchToContent(`export function other() {\n  return 1;\n}\n`, files[0]!.unified, "hello.ts");
} catch {
  rejected = true;
}
assert(rejected, "still rejects a patch that does not match the file");

if (process.exitCode) {
  console.error("agent patch tests failed");
  process.exit(1);
}
console.log("agent patch tests passed");
