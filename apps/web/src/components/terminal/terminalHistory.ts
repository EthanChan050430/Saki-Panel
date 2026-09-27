export const terminalInputHistoryLimit = 100;

const historyKey = (instanceId: string) => `webops.terminalHistory.v1.${instanceId}`;
const memoryHistory = new Map<string, string[]>();

export function readTerminalInputHistory(instanceId: string | null): string[] {
  if (!instanceId) return [];
  try {
    const saved = window.localStorage.getItem(historyKey(instanceId));
    if (saved === null) return memoryHistory.get(instanceId) ?? [];
    const parsed: unknown = JSON.parse(saved);
    const history = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .slice(-terminalInputHistoryLimit)
      : [];
    memoryHistory.set(instanceId, history);
    return history;
  } catch {
    return memoryHistory.get(instanceId) ?? [];
  }
}

export function appendTerminalInputHistory(instanceId: string | null, value: string): string[] {
  if (!instanceId) return [];
  const command = value.trim();
  const history = readTerminalInputHistory(instanceId);
  if (!command || history[history.length - 1] === command) return history;
  const next = [...history, command].slice(-terminalInputHistoryLimit);
  memoryHistory.set(instanceId, next);
  try {
    window.localStorage.setItem(historyKey(instanceId), JSON.stringify(next));
  } catch {
    // Keep history available for this tab when browser storage is unavailable.
  }
  return next;
}

export type TerminalInputDraft = {
  text: string;
  cursor: number;
  escape: string;
};

export function emptyTerminalInputDraft(): TerminalInputDraft {
  return { text: "", cursor: 0, escape: "" };
}

// xterm sends one or more characters at a time. Keep only completed input lines
// and ignore terminal control sequences, so the history contains usable commands.
export function collectTerminalInputCommands(
  previous: TerminalInputDraft,
  data: string
): { draft: TerminalInputDraft; commands: string[] } {
  const characters = Array.from(previous.text);
  let cursor = Math.min(previous.cursor, characters.length);
  let escape = previous.escape;
  const commands: string[] = [];

  for (const character of data) {
    if (escape) {
      escape += character;
      if (escape === "\x1b[" || escape === "\x1bO" || (/^\x1b\[[\d;?]*$/.test(escape) && escape.length < 32)) {
        continue;
      }
      if (escape === "\x1b[D") cursor = Math.max(0, cursor - 1);
      else if (escape === "\x1b[C") cursor = Math.min(characters.length, cursor + 1);
      else if (escape === "\x1b[H" || escape === "\x1bOH") cursor = 0;
      else if (escape === "\x1b[F" || escape === "\x1bOF") cursor = characters.length;
      else if (escape === "\x1b[3~") characters.splice(cursor, 1);
      else if (escape === "\x1b[A" || escape === "\x1b[B") {
        // The server owns shell history; its recalled command cannot be read here.
        characters.length = 0;
        cursor = 0;
      }
      escape = "";
      continue;
    }

    if (character === "\x1b") {
      escape = character;
    } else if (character === "\r" || character === "\n") {
      const command = characters.join("").trim();
      if (command) commands.push(command);
      characters.length = 0;
      cursor = 0;
    } else if (character === "\x7f" || character === "\b") {
      if (cursor > 0) characters.splice(--cursor, 1);
    } else if (character === "\x03" || character === "\x04" || character === "\x15") {
      characters.length = 0;
      cursor = 0;
    } else if (character === "\x01") {
      cursor = 0;
    } else if (character === "\x05") {
      cursor = characters.length;
    } else if (character === "\x0b") {
      characters.splice(cursor);
    } else if (character === "\x17") {
      while (cursor > 0 && /\s/.test(characters[cursor - 1] ?? "")) characters.splice(--cursor, 1);
      while (cursor > 0 && !/\s/.test(characters[cursor - 1] ?? "")) characters.splice(--cursor, 1);
    } else if (character !== "\t" && character.codePointAt(0)! >= 32) {
      characters.splice(cursor++, 0, character);
    }
  }

  return { draft: { text: characters.join(""), cursor, escape }, commands };
}
