import { applyPatch as applyJsPatch, parsePatch } from "diff";
import { RouteError } from "./types.js";

export interface ParsedWorkspacePatch {
  path: string;
  kind: "add" | "update" | "delete";
  unified: string;
}

function normalizePatchPath(value: string | undefined): string {
  const raw = (value ?? "").trim().replace(/\\/g, "/");
  const stripped = raw.replace(/^[ab]\//, "").replace(/^\/dev\/null$/, "");
  if (stripped.startsWith("/")) return stripped.replace(/^\/+/, "");
  return stripped;
}

function isDevNull(value: string | undefined): boolean {
  return !value || /\/dev\/null$/.test(value.trim());
}

function convertCodexPatch(source: string): string {
  if (!/\*\*\*\s+Begin Patch/i.test(source) && !/\*\*\*\s+(?:Add|Update|Delete) File:/i.test(source)) {
    return source;
  }
  const files: string[] = [];
  const blocks = source.split(/\*\*\*\s+(?:Add|Update|Delete) File:/i).slice(1);
  const headers = [...source.matchAll(/\*\*\*\s+(Add|Update|Delete) File:\s*(.+)/gi)];
  for (let index = 0; index < headers.length; index += 1) {
    const kind = (headers[index]?.[1] ?? "Update").toLowerCase();
    const path = normalizePatchPath(headers[index]?.[2]);
    if (!path) continue;
    let body = (blocks[index] ?? "").replace(/\*\*\*\s+End Patch[\s\S]*$/i, "").trimEnd();
    const nextHeader = body.search(/\n\*\*\*\s+(?:Add|Update|Delete) File:/i);
    if (nextHeader >= 0) body = body.slice(0, nextHeader);
    body = body.replace(/^\s*\n/, "");
    if (kind === "add") {
      const lines = body
        .split("\n")
        .map((line) => (line.startsWith("+") ? line.slice(1) : line));
      files.push(
        [
          `--- /dev/null`,
          `+++ b/${path}`,
          `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
          ...lines.map((line) => `+${line}`)
        ].join("\n")
      );
      continue;
    }
    if (kind === "delete") {
      files.push(`--- a/${path}\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-`);
      continue;
    }
    if (!/^@@/m.test(body)) {
      body = `@@\n${body}`;
    }
    files.push(`--- a/${path}\n+++ b/${path}\n${body.trimEnd()}`);
  }
  return files.join("\n");
}

export function parseWorkspacePatch(patchText: string): ParsedWorkspacePatch[] {
  const raw = patchText.trim();
  if (!raw) throw new RouteError("applyPatch requires a non-empty patch.", 400);
  const unified = convertCodexPatch(raw);
  let parsed = parsePatch(unified);
  if (parsed.length === 0 && unified !== raw) {
    parsed = parsePatch(raw);
  }
  if (parsed.length === 0) {
    throw new RouteError("Could not parse patch. Use a unified diff or Codex apply_patch format.", 400);
  }
  const files: ParsedWorkspacePatch[] = [];
  for (const file of parsed) {
    const oldPath = normalizePatchPath(file.oldFileName);
    const newPath = normalizePatchPath(file.newFileName);
    const add = isDevNull(file.oldFileName) || file.oldFileName === "/dev/null";
    const del = isDevNull(file.newFileName) || file.newFileName === "/dev/null";
    const path = del ? oldPath : newPath || oldPath;
    if (!path) continue;
    files.push({
      path,
      kind: add ? "add" : del ? "delete" : "update",
      unified: [
        `--- ${add ? "/dev/null" : `a/${path}`}`,
        `+++ ${del ? "/dev/null" : `b/${path}`}`,
        ...(file.hunks ?? []).flatMap((hunk) => {
          const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
          return [header, ...(hunk.lines ?? [])];
        })
      ].join("\n")
    });
  }
  if (files.length === 0) {
    throw new RouteError("Patch did not contain any file changes.", 400);
  }
  return files;
}

function comparePatchLine(_lineNumber: number, line: string, _operation: string, patchContent: string): boolean {
  return line.replace(/[ \t]+$/g, "") === patchContent.replace(/[ \t]+$/g, "");
}

function applyOnce(source: string, unified: string, fuzzFactor: number): string | false {
  return applyJsPatch(source, unified, {
    compareLine: comparePatchLine,
    ...(fuzzFactor > 0 ? { fuzzFactor } : {})
  });
}

export function applyPatchToContent(original: string, unified: string, path: string): string {
  const usesCrlf = original.includes("\r\n");
  const source = original.replace(/\r\n/g, "\n");
  const patch = unified.replace(/\r\n/g, "\n");
  for (const fuzz of [0, 1, 2]) {
    const next = applyOnce(source, patch, fuzz);
    if (next !== false) {
      return usesCrlf ? next.replace(/\n/g, "\r\n") : next;
    }
  }
  throw new RouteError(
    `Patch did not apply to ${path}. Re-read the file and emit a fresh unified diff against the current contents.`,
    400
  );
}

export function patchHunkStartLine(unified: string): number {
  const match = unified.match(/@@ -(\d+)/);
  const parsed = match ? Number(match[1]) : 1;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
