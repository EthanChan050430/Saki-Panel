import { diffLines } from "diff";

export interface AuditDiffLine {
  type: "add" | "del" | "same";
  text: string;
  oldNum?: number;
  newNum?: number;
}

export function firstAuditText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

export function computeAuditDiff(oldText: string, newText: string) {
  const preview = (text: string) => {
    const clipped = text.slice(0, 100000);
    const rows = clipped.split("\n");
    if (rows.length <= 1000 || (rows.length === 1001 && rows[1000] === "")) return clipped;
    return rows.slice(0, 1000).join("\n");
  };
  const oldPreview = preview(oldText);
  const newPreview = preview(newText);
  const changes = diffLines(oldPreview, newPreview, { timeout: 100, ignoreNewlineAtEof: true });
  const chunks = changes ?? [
    { value: oldPreview, added: false, removed: true },
    { value: newPreview, added: true, removed: false },
  ];
  const lines: AuditDiffLine[] = [];
  let oldNum = 1;
  let newNum = 1;
  for (const chunk of chunks) {
    if (!chunk.value) continue;
    const rows = chunk.value.split("\n");
    if (rows[rows.length - 1] === "") rows.pop();
    for (const text of rows) {
      lines.push({
        type: chunk.added ? "add" : chunk.removed ? "del" : "same",
        text,
        ...(!chunk.added ? { oldNum: oldNum++ } : {}),
        ...(!chunk.removed ? { newNum: newNum++ } : {}),
      });
    }
  }
  return { lines, truncated: oldPreview !== oldText || newPreview !== newText, approximate: !changes };
}
