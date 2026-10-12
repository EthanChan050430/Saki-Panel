import { applyPatch as applyJsPatch, parsePatch } from "diff";
import { RouteError, splitEditableLines } from "./types.js";

export interface ParsedWorkspacePatch {
  path: string;
  kind: "add" | "update" | "delete";
  unified: string;
}

function normalizePatchPath(value: string | undefined, gitPrefix = false): string {
  const raw = (value ?? "").trim().replace(/\\/g, "/");
  const stripped = gitPrefix ? raw.replace(/^[ab]\//, "") : raw;
  if (!stripped || stripped === "/dev/null") return "";
  if (/^(?:\/|[a-z]:)/i.test(stripped) || stripped.split("/").includes("..")) {
    throw new RouteError("Patch paths must be relative to the workspace without '..'.", 400);
  }
  return stripped;
}

function parseBlockPatch(raw: string): ParsedWorkspacePatch[] {
  const lines = raw.split("\n");
  const files: ParsedWorkspacePatch[] = [];
  let index = lines[0] === "*** Begin Patch" ? 1 : 0;
  for (; index < lines.length;) {
    const header = lines[index]!;
    if (header === "*** End Patch" && index === lines.length - 1) break;
    const match = header.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (!match) throw new RouteError(`Invalid patch header: ${header}`, 400);
    const path = normalizePatchPath(match[2]);
    if (!path) throw new RouteError("Patch requires a file path.", 400);
    const kind = match[1]!.toLowerCase() as ParsedWorkspacePatch["kind"];
    const body: string[] = [];
    index += 1;
    while (index < lines.length && !/^\*\*\* (?:(?:Add|Update|Delete) File:|End Patch$)/.test(lines[index]!)) {
      body.push(lines[index++]!);
    }
    if (kind === "add" && body.some((line) => !line.startsWith("+"))) {
      throw new RouteError(`Every added line in ${path} must start with '+'.`, 400);
    }
    if (kind === "delete" && body.length) throw new RouteError(`Delete File must not contain hunks: ${path}`, 400);
    if (kind === "update" && !body.length) throw new RouteError(`Update File requires a hunk: ${path}`, 400);
    files.push({ path, kind, unified: [header, ...body].join("\n") });
  }
  return files;
}

export function parseWorkspacePatch(patchText: string): ParsedWorkspacePatch[] {
  const raw = patchText.replace(/\r\n/g, "\n").trimStart().replace(/\n+$/, "");
  if (!raw.trim()) throw new RouteError("applyPatch requires a non-empty patch.", 400);
  if (raw.startsWith("*** ")) {
    if (raw.startsWith("*** Begin Patch") && !raw.endsWith("*** End Patch")) {
      throw new RouteError("Incomplete patch: missing *** End Patch. Send the complete patch again.", 400);
    }
    const files = parseBlockPatch(raw);
    if (!files.length) throw new RouteError("Patch did not contain any file changes.", 400);
    return files;
  }
  try {
    const parsed = parsePatch(raw);
    if (!parsed.length) throw new Error("No file changes found");
    return parsed.map((file) => {
      const add = file.oldFileName === "/dev/null";
      const del = file.newFileName === "/dev/null";
      const path = normalizePatchPath(del ? file.oldFileName : file.newFileName || file.oldFileName, true);
      if (!path || !file.hunks?.length) throw new Error("Missing file path or hunks");
      return {
        path,
        kind: add ? "add" : del ? "delete" : "update",
        unified: [
          `--- ${add ? "/dev/null" : `a/${path}`}`,
          `+++ ${del ? "/dev/null" : `b/${path}`}`,
          ...file.hunks.flatMap((hunk) => [
            `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
            ...hunk.lines
          ])
        ].join("\n")
      };
    });
  } catch (error) {
    throw new RouteError(`Could not parse patch: ${error instanceof Error ? error.message : String(error)}. Use a complete unified diff or *** Begin Patch format.`, 400);
  }
}

function applyBlockUpdate(original: string, patch: string, path: string): string {
  const { lines: source, newline, hasFinalNewline } = splitEditableLines(original);
  const body = patch.split("\n").slice(1);
  let cursor = 0;
  let index = 0;
  while (index < body.length) {
    const header = body[index++]!;
    if (header !== "@@" && !header.startsWith("@@ ")) {
      throw new RouteError(`Expected @@ hunk in ${path}; use renamePath separately for moves.`, 400);
    }
    const anchor = header.slice(3);
    if (anchor) {
      const found = source.findIndex((line, at) => at >= cursor && line === anchor);
      if (found < 0) throw new RouteError(`Patch anchor not found in ${path}: ${anchor}`, 400);
      cursor = found + 1;
    }
    const oldLines: string[] = [];
    const newLines: string[] = [];
    let atEnd = false;
    while (index < body.length && body[index] !== "@@" && !body[index]!.startsWith("@@ ")) {
      const line = body[index++]!;
      if (line === "*** End of File") {
        atEnd = true;
        break;
      }
      const operation = line[0];
      if (operation !== " " && operation !== "+" && operation !== "-") {
        throw new RouteError(`Invalid hunk line in ${path}. Prefix context with a space and changes with +/- .`, 400);
      }
      if (operation !== "+") oldLines.push(line.slice(1));
      if (operation !== "-") newLines.push(line.slice(1));
    }
    if (!oldLines.length && !newLines.length) throw new RouteError(`Empty patch hunk in ${path}.`, 400);
    const matches: number[] = [];
    for (let at = cursor; at <= source.length - oldLines.length; at += 1) {
      if (atEnd && at + oldLines.length !== source.length) continue;
      if (oldLines.every((line, offset) => source[at + offset] === line)) matches.push(at);
    }
    // Never silently edit the first of several identical blocks.
    if (matches.length !== 1) {
      throw new RouteError(`Patch context ${matches.length ? "is ambiguous" : "was not found"} in ${path}. Read the current file and include more unique context.`, 400);
    }
    const start = matches[0]!;
    source.splice(start, oldLines.length, ...newLines);
    cursor = start + newLines.length;
  }
  return source.join(newline) + (source.length && hasFinalNewline ? newline : "");
}

export function applyPatchToContent(original: string, unified: string, path: string): string {
  const patch = unified.replace(/\r\n/g, "\n");
  if (patch.startsWith("*** Add File:")) {
    const lines = patch.split("\n").slice(1).map((line) => line.slice(1));
    return lines.length ? `${lines.join("\n")}\n` : "";
  }
  if (patch.startsWith("*** Update File:")) return applyBlockUpdate(original, patch, path);
  const source = original.replace(/\r\n/g, "\n");
  const next = applyJsPatch(source, patch);
  if (next !== false) return original.includes("\r\n") ? next.replace(/\n/g, "\r\n") : next;
  throw new RouteError(`Patch did not apply to ${path}. Read the current file and emit a fresh patch with exact context.`, 400);
}

export function patchHunkStartLine(unified: string): number {
  const match = unified.match(/@@ -(\d+)/);
  const parsed = match ? Number(match[1]) : 1;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
