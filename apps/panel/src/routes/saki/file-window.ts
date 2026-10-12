import { splitEditableLines } from "./types.js";

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
