import { grepDaemonInstanceFiles, readDaemonInstanceFile, statDaemonInstancePath } from "../../daemon-client.js";
import { RouteError, splitEditableLines, type InstanceWithNode } from "./types.js";

/** Keep the generated pattern within the Daemon's regex safety rules. */
export function agentSymbolDefinitionPattern(symbol: string, declarations: string): string {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `\\b(?:${declarations})\\s+${escaped}\\b|\\b${escaped}\\s*=\\s*(?:async\\s+function\\b|async\\s+\\(|function\\b|\\()`;
}

export function agentScopedFileGlob(pattern: string, directory: string): string {
  const scope = directory.replace(/\/+$/, "");
  return scope && !pattern.includes("/") ? `${scope}/${pattern}` : pattern;
}

export async function locateAgentSymbols(instance: InstanceWithNode, filePath: string, pattern: string, maxResults: number) {
  const { node, id, workingDirectory } = instance;
  if (pattern.length > 512) throw new RouteError("Symbol name is too long. Search for a shorter name.", 400);
  if (filePath) {
    const stat = await statDaemonInstancePath(node, id, workingDirectory, filePath).catch(() => null);
    if (stat && !stat.isDirectory) {
      if (stat.size > 1024 * 1024) throw new RouteError("File is too large for symbol search. Use outlineFile or a targeted read.", 400);
      const file = await readDaemonInstanceFile(node, id, workingDirectory, filePath);
      const regex = new RegExp(pattern, pattern === pattern.toLowerCase() ? "i" : "");
      const matches: Awaited<ReturnType<typeof grepDaemonInstanceFiles>>["matches"] = [];
      for (const [index, text] of file.content.split(/\r?\n/).entries()) {
        const match = regex.exec(text);
        if (!match) continue;
        matches.push({ file: filePath, line: index + 1, column: match.index + 1, text });
        if (matches.length >= maxResults) break;
      }
      return matches;
    }
  }
  const result = await grepDaemonInstanceFiles(node, id, workingDirectory, {
    workingDirectory, pattern, ...(filePath ? { path: filePath } : {}), maxResults, contextLines: 0
  });
  return result.matches;
}

// Keep continuation metadata aligned with the lines actually returned.
export function renderAgentFileWindow(path: string, file: { content: string; size: number; totalLines?: number; endLine?: number }, startLine: number, maxChars = 24000): string {
  // A daemon window has no final newline; do not discard its last empty line.
  const lines = file.content.length ? file.content.split(/\r?\n/) : (file.endLine ?? 0) >= startLine ? [""] : [];
  const totalLines = file.totalLines ?? splitEditableLines(file.content).lines.length;
  const shown: string[] = [];
  let length = 0;
  for (const [offset, line] of lines.entries()) {
    const numbered = `${String(startLine + offset).padStart(String(totalLines).length, " ")} | ${line}`;
    if (length + numbered.length + 1 > maxChars) {
      if (!shown.length) shown.push(`${numbered.slice(0, maxChars)} ... [line truncated; use searchFiles for this long line]`);
      break;
    }
    shown.push(numbered);
    length += numbered.length + 1;
  }
  const endLine = shown.length ? startLine + shown.length - 1 : startLine - 1;
  return [
    `File: ${path}`,
    `Size: ${file.size} bytes | Total lines: ${totalLines}`,
    shown.length ? `Showing lines: ${startLine}-${endLine}` : `No lines at startLine=${startLine}.`,
    "",
    shown.join("\n") || "(empty window)",
    ...(endLine < totalLines ? ["", `More content available: readFile({ path: ${JSON.stringify(path)}, startLine: ${endLine + 1} }).`] : [])
  ].join("\n");
}
