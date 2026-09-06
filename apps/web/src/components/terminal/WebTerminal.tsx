import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Copy,
  CornerDownLeft,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  Move,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  Terminal as TerminalIcon,
  Trash2,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import type { InstanceLogLine, InstanceStatus, ManagedInstance, TerminalServerMessage } from "@webops/shared";
import type { SakiPromptSeed } from "../../types/app.js";
import { api, ApiError } from "../../api.js";
import { sakiArtAssets } from "../../constants.js";

export function isTerminalIssue(line: InstanceLogLine): boolean {
  return (
    line.stream === "stderr" ||
    /error|exception|failed|failure|traceback|fatal|panic|enoent|eaddrinuse|eacces|refused|timeout/i.test(line.text)
  );
}
export let latestSakiTerminalSelectionText = "";

export function normalizeSakiSelectionText(value: string): string {
  if (!value) return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function countSelectionCharacters(text: string): number {
  if (!text) return 0;
  return Array.from(text).length;
}

export function rememberSakiTerminalSelection(value: string): void {
  latestSakiTerminalSelectionText = normalizeSakiSelectionText(value);
}

export function clearRememberedSakiTerminalSelection(): void {
  latestSakiTerminalSelectionText = "";
}

export function isTerminalCopyShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "c";
}

export function readAllTerminalBufferText(terminal: XTerm | null): string {
  if (!terminal) return "";
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  const total = buffer.length;
  for (let i = 0; i < total; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  return lines.join("\n").trimEnd();
}

export function readTerminalClipboardText(terminal: XTerm | null | undefined): string {
  if (!terminal) return "";
  const raw = terminal.getSelection();
  if (!raw) return "";
  return normalizeSakiSelectionText(raw);
}

export function targetIsInsideSelector(target: EventTarget | null, selector: string): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest(selector));
}

export type TerminalConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

export function terminalStateLabel(state: TerminalConnectionState): string {
  const labels: Record<TerminalConnectionState, string> = {
    idle: "未连接",
    connecting: "连接中",
    connected: "已连接",
    reconnecting: "重连中",
    closed: "已断开",
    error: "连接异常"
  };
  return labels[state];
}

export type TerminalShortcutKey =
  | {
      type: "modifier";
      id: "ctrl";
      label: string;
      title: string;
    }
  | {
      type: "key";
      id: string;
      label: string;
      title: string;
      data?: string;
      ctrlData?: string;
      viaBufferedInput?: boolean;
      wide?: boolean;
    };

export const terminalShortcutKeys: TerminalShortcutKey[] = [
  { type: "key", id: "escape", label: "Esc", title: "Esc", data: "\x1b", ctrlData: "\x1b", wide: true },
  { type: "key", id: "tab", label: "Tab", title: "Tab", data: "\t", viaBufferedInput: true, wide: true },
  { type: "modifier", id: "ctrl", label: "Ctrl", title: "Ctrl" },
  { type: "key", id: "up", label: "↑", title: "上", data: "\x1b[A", ctrlData: "\x1b[1;5A" },
  { type: "key", id: "down", label: "↓", title: "下", data: "\x1b[B", ctrlData: "\x1b[1;5B" },
  { type: "key", id: "left", label: "←", title: "左", data: "\x1b[D", ctrlData: "\x1b[1;5D" },
  { type: "key", id: "right", label: "→", title: "右", data: "\x1b[C", ctrlData: "\x1b[1;5C" },
  { type: "key", id: "backspace", label: "⌫", title: "退格", data: "\b", ctrlData: "\u0017", viaBufferedInput: true },
  { type: "key", id: "c", label: "C", title: "C / Ctrl+C", data: "c", ctrlData: "\u0003", viaBufferedInput: true },
  { type: "key", id: "d", label: "D", title: "D / Ctrl+D", data: "d", ctrlData: "\u0004", viaBufferedInput: true },
  { type: "key", id: "l", label: "L", title: "L / Ctrl+L", data: "l", ctrlData: "\u000c", viaBufferedInput: true },
  { type: "key", id: "enter", label: "Enter", title: "Enter", data: "\r", viaBufferedInput: true, wide: true }
];

export const terminalInputHistoryLimit = 100;

export type TerminalAutocompleteState = {
  candidates: string[];
  index: number;
};

export const terminalCommandAutocompleteWords = [
  "agy",
  "bun",
  "cargo",
  "cat",
  "cd",
  "clear",
  "claude",
  "codex",
  "cls",
  "copy",
  "curl",
  "del",
  "dir",
  "docker",
  "echo",
  "env",
  "erase",
  "export",
  "find",
  "findstr",
  "git",
  "go",
  "grep",
  "java",
  "journalctl",
  "less",
  "mkdir",
  "more",
  "move",
  "node",
  "npm",
  "npx",
  "pip",
  "pip3",
  "pm2",
  "pnpm",
  "powershell",
  "pwd",
  "python",
  "python3",
  "rm",
  "rmdir",
  "set",
  "sh",
  "sudo",
  "systemctl",
  "tail",
  "tar",
  "touch",
  "type",
  "where",
  "which",
  "xcopy",
  "yarn"
];

export function uniqueTerminalAutocompleteValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function commonTerminalAutocompletePrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    while (prefix && !value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

export const COMMON_TERMINAL_SUBCOMMAND_COMPLETIONS = [
  "npm run dev",
  "npm run build",
  "npm start",
  "npm test",
  "npm install",
  "pnpm dev",
  "pnpm build",
  "pnpm install",
  "yarn dev",
  "yarn build",
  "yarn start",
  "git status",
  "git pull",
  "git push",
  "git checkout ",
  "git branch",
  "git diff",
  "git log -n 10",
  "docker ps",
  "docker compose up -d",
  "docker compose logs -f",
  "docker compose down",
  "pm2 status",
  "pm2 restart all",
  "pm2 logs",
  "systemctl status",
  "systemctl restart"
];

export function terminalAutocompleteCandidates(value: string, history: string[]): string[] {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? "";
  const withoutLeadingWhitespace = value.slice(leadingWhitespace.length);
  const completingCommandName = !/\s/.test(withoutLeadingWhitespace);
  const normalizedPrefix = withoutLeadingWhitespace.toLowerCase();

  if (completingCommandName) {
    if (!withoutLeadingWhitespace) return [];
    const historyCommands = history
      .slice()
      .reverse()
      .map((item) => item.trim().split(/\s+/)[0] ?? "");
    return uniqueTerminalAutocompleteValues([...historyCommands, ...terminalCommandAutocompleteWords])
      .filter((candidate) => candidate.toLowerCase().startsWith(normalizedPrefix))
      .map((candidate) => `${leadingWhitespace}${candidate} `);
  }

  const historyMatches = history
    .slice()
    .reverse()
    .filter((item) => item.toLowerCase().startsWith(value.toLowerCase()) && item !== value);

  const commonMatches = COMMON_TERMINAL_SUBCOMMAND_COMPLETIONS.filter(
    (c) => c.toLowerCase().startsWith(value.toLowerCase()) && c !== value
  );

  return uniqueTerminalAutocompleteValues([...historyMatches, ...commonMatches]);
}

export function nextTerminalAutocompleteValue(
  value: string,
  history: string[],
  state: TerminalAutocompleteState | null
): { value: string; state: TerminalAutocompleteState } | null {
  if (state && state.candidates.length > 1 && state.candidates[state.index] === value) {
    const index = (state.index + 1) % state.candidates.length;
    return { value: state.candidates[index] ?? value, state: { candidates: state.candidates, index } };
  }

  const candidates = terminalAutocompleteCandidates(value, history);
  if (candidates.length === 0) return null;

  const commonPrefix = commonTerminalAutocompletePrefix(candidates);
  const nextValue = commonPrefix.length > value.length ? commonPrefix : candidates[0] ?? value;
  const index = Math.max(0, candidates.indexOf(nextValue));
  return { value: nextValue, state: { candidates, index } };
}

export const terminalAnsiReset = "\x1b[0m";
export const minecraftColorMarker = "\u00a7";

export function terminalAnsiRgb(red: number, green: number, blue: number): string {
  return `\x1b[38;2;${red};${green};${blue}m`;
}

export const minecraftTerminalColors: Record<string, string> = {
  "0": terminalAnsiRgb(0, 0, 0),
  "1": terminalAnsiRgb(0, 0, 170),
  "2": terminalAnsiRgb(0, 170, 0),
  "3": terminalAnsiRgb(0, 170, 170),
  "4": terminalAnsiRgb(170, 0, 0),
  "5": terminalAnsiRgb(170, 0, 170),
  "6": terminalAnsiRgb(255, 170, 0),
  "7": terminalAnsiRgb(170, 170, 170),
  "8": terminalAnsiRgb(85, 85, 85),
  "9": terminalAnsiRgb(85, 85, 255),
  a: terminalAnsiRgb(85, 255, 85),
  b: terminalAnsiRgb(85, 255, 255),
  c: terminalAnsiRgb(255, 85, 85),
  d: terminalAnsiRgb(255, 85, 255),
  e: terminalAnsiRgb(255, 255, 85),
  f: terminalAnsiRgb(255, 255, 255),
  g: terminalAnsiRgb(221, 214, 5),
  h: terminalAnsiRgb(227, 212, 209),
  i: terminalAnsiRgb(206, 202, 202),
  j: terminalAnsiRgb(68, 58, 59),
  p: terminalAnsiRgb(222, 177, 45),
  q: terminalAnsiRgb(17, 160, 54),
  s: terminalAnsiRgb(44, 186, 168),
  t: terminalAnsiRgb(33, 73, 123),
  u: terminalAnsiRgb(154, 92, 198),
  v: terminalAnsiRgb(235, 114, 20)
};

export const minecraftTerminalFormats: Record<string, string> = {
  l: "\x1b[1m",
  m: "\x1b[9m",
  n: "\x1b[4m",
  o: "\x1b[3m"
};

export function readMinecraftHexColor(value: string, markerIndex: number): { sequence: string; endIndex: number } | null {
  const digits: string[] = [];
  let endIndex = markerIndex;
  for (let offset = 0; offset < 6; offset += 1) {
    const nextMarkerIndex = markerIndex + 2 + offset * 2;
    const digitIndex = nextMarkerIndex + 1;
    const digit = value[digitIndex];
    if (value[nextMarkerIndex] !== minecraftColorMarker || !digit || !/^[0-9a-f]$/i.test(digit)) {
      return null;
    }
    digits.push(digit);
    endIndex = digitIndex;
  }

  const hex = digits.join("");
  return {
    sequence: `${terminalAnsiReset}${terminalAnsiRgb(
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16)
    )}`,
    endIndex
  };
}

export function readMinecraftCompactHexColor(value: string, markerIndex: number): { sequence: string; endIndex: number } | null {
  const hex = value.slice(markerIndex + 2, markerIndex + 8);
  if (value[markerIndex + 1] !== "#" || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    sequence: `${terminalAnsiReset}${terminalAnsiRgb(
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16)
    )}`,
    endIndex: markerIndex + 7
  };
}

export function minecraftFormattingToAnsi(value: string): string {
  if (!value.includes(minecraftColorMarker)) return value;

  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index] ?? "";
    if (current !== minecraftColorMarker || index + 1 >= value.length) {
      result += current;
      continue;
    }

    const code = (value[index + 1] ?? "").toLowerCase();
    if (code === "x") {
      const hexColor = readMinecraftHexColor(value, index);
      if (hexColor) {
        result += hexColor.sequence;
        index = hexColor.endIndex;
        continue;
      }
    }
    if (code === "#") {
      const hexColor = readMinecraftCompactHexColor(value, index);
      if (hexColor) {
        result += hexColor.sequence;
        index = hexColor.endIndex;
        continue;
      }
    }

    const color = minecraftTerminalColors[code];
    if (color) {
      result += `${terminalAnsiReset}${color}`;
      index += 1;
      continue;
    }

    if (code === "r") {
      result += terminalAnsiReset;
      index += 1;
      continue;
    }

    const format = minecraftTerminalFormats[code];
    if (format) {
      result += format;
      index += 1;
      continue;
    }

    if (code === "k") {
      index += 1;
      continue;
    }

    result += current;
  }

  return result;
}

export function terminalDisplayText(value: string): string {
  return minecraftFormattingToAnsi(value)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[(?![0-9;:]*m)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()#][0-?]*[ -/]*./g, "")
    .replace(/\x1b[=>78]/g, "");
}

interface TerminalTextStyleState {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export const terminalAnsiCssColors: Record<number, string> = {
  30: "#000000",
  31: "#aa0000",
  32: "#00aa00",
  33: "#ffaa00",
  34: "#5555ff",
  35: "#aa00aa",
  36: "#00aaaa",
  37: "#aaaaaa",
  90: "#555555",
  91: "#ff5555",
  92: "#55ff55",
  93: "#ffff55",
  94: "#5555ff",
  95: "#ff55ff",
  96: "#55ffff",
  97: "#ffffff"
};

export function terminalAnsiBasicCssColor(code: number): string | undefined {
  if (terminalAnsiCssColors[code]) return terminalAnsiCssColors[code];
  if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
    return terminalAnsiCssColors[code - 10];
  }
  return undefined;
}

export function terminalAnsi256CssColor(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 255) return undefined;
  const basic = terminalAnsiCssColors[value < 8 ? value + 30 : value < 16 ? value + 82 : -1];
  if (basic) return basic;
  if (value >= 16 && value <= 231) {
    const index = value - 16;
    const red = Math.floor(index / 36);
    const green = Math.floor((index % 36) / 6);
    const blue = index % 6;
    const component = (level: number) => (level === 0 ? 0 : 55 + level * 40);
    return `rgb(${component(red)}, ${component(green)}, ${component(blue)})`;
  }
  const gray = 8 + (value - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

export function terminalTextCssStyle(state: TerminalTextStyleState): React.CSSProperties | undefined {
  const style: React.CSSProperties = {};
  if (state.color) style.color = state.color;
  if (state.backgroundColor) style.backgroundColor = state.backgroundColor;
  if (state.bold) style.fontWeight = 700;
  if (state.italic) style.fontStyle = "italic";
  const decorations = [state.underline ? "underline" : "", state.strike ? "line-through" : ""].filter(Boolean);
  if (decorations.length > 0) style.textDecorationLine = decorations.join(" ");
  return Object.keys(style).length > 0 ? style : undefined;
}

export function applyTerminalSgr(state: TerminalTextStyleState, rawParams: string): TerminalTextStyleState {
  const params = rawParams
    .split(/[;:]/)
    .filter((value) => value.length > 0)
    .map((value) => Number.parseInt(value, 10));
  const codes = params.length > 0 ? params : [0];
  let next = { ...state };

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0;
    if (code === 0) {
      next = {};
    } else if (code === 1) {
      next.bold = true;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 9) {
      next.strike = true;
    } else if (code === 22) {
      delete next.bold;
    } else if (code === 23) {
      delete next.italic;
    } else if (code === 24) {
      delete next.underline;
    } else if (code === 29) {
      delete next.strike;
    } else if (code === 39) {
      delete next.color;
    } else if (code === 49) {
      delete next.backgroundColor;
    } else if (code >= 30 && code <= 37) {
      const color = terminalAnsiBasicCssColor(code);
      if (color) next.color = color;
    } else if (code >= 90 && code <= 97) {
      const color = terminalAnsiBasicCssColor(code);
      if (color) next.color = color;
    } else if (code >= 40 && code <= 47) {
      const color = terminalAnsiBasicCssColor(code);
      if (color) next.backgroundColor = color;
    } else if (code >= 100 && code <= 107) {
      const color = terminalAnsiBasicCssColor(code);
      if (color) next.backgroundColor = color;
    } else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
      const red = codes[index + 2];
      const green = codes[index + 3];
      const blue = codes[index + 4];
      if (red !== undefined && green !== undefined && blue !== undefined) {
        const value = `rgb(${red}, ${green}, ${blue})`;
        if (code === 38) next.color = value;
        else next.backgroundColor = value;
        index += 4;
      }
    } else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
      const color = terminalAnsi256CssColor(codes[index + 2] ?? -1);
      if (color) {
        if (code === 38) next.color = color;
        else next.backgroundColor = color;
        index += 2;
      }
    }
  }

  return next;
}

export function renderTerminalLogText(value: string): React.ReactNode {
  const text = terminalDisplayText(value);
  const ansiPattern = /\x1b\[([0-9;:]*)m/g;
  const nodes: React.ReactNode[] = [];
  let style: TerminalTextStyleState = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (piece: string) => {
    if (!piece) return;
    const cssStyle = terminalTextCssStyle(style);
    nodes.push(
      cssStyle ? (
        <span key={nodes.length} style={cssStyle}>
          {piece}
        </span>
      ) : (
        piece
      )
    );
  };

  while ((match = ansiPattern.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index));
    style = applyTerminalSgr(style, match[1] ?? "");
    lastIndex = ansiPattern.lastIndex;
  }
  pushText(text.slice(lastIndex));

  return nodes.length > 0 ? nodes : text;
}

export function formatTerminalLine(line: InstanceLogLine): string {
  if (line.stream === "stdout") {
    return `${line.text}\r\n`;
  }
  const prefix =
    line.stream === "stdin"
      ? "\x1b[32m>\x1b[0m "
      : line.stream === "stderr"
        ? "\x1b[31mERR\x1b[0m "
        : line.stream === "system"
          ? "\x1b[33mSYS\x1b[0m "
          : "";
  return `${prefix}${line.text}${terminalAnsiReset}\r\n`;
}

export function terminalTouchRowHeight(terminalHost: HTMLElement, terminal: XTerm): number {
  const screen = terminal.element?.querySelector(".xterm-screen") as HTMLElement | null;
  const measuredHeight = screen?.getBoundingClientRect().height || terminalHost.clientHeight;
  return Math.max(8, measuredHeight / Math.max(1, terminal.rows));
}

export function WebTerminal({
  token,
  instance,
  onStatus,
  onAskSaki,
  shellSessionId,
  isActive = true,
  onMountTerminalActions
}: {
  token: string;
  instance: ManagedInstance | null;
  onStatus: (instanceId: string, status: InstanceStatus, exitCode?: number | null) => void;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  shellSessionId?: string;
  isActive?: boolean;
  onMountTerminalActions?: (actions: {
    clear: () => void;
    reconnect: () => void;
    toggleImmersive: () => void;
    isImmersive: boolean;
    connectionState: TerminalConnectionState;
    sendCommand: (cmd: string) => void;
    getHistory: () => string[];
    extractOrCopyLogs?: () => void;
  }) => void;
}) {
  const [terminalHost, setTerminalHost] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const fitTerminalSafeRef = useRef<(() => void) | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const inputHistoryRef = useRef<string[]>([]);
  const inputHistoryInstanceIdRef = useRef<string | null>(null);
  const commandHistoryIndexRef = useRef<number | null>(null);
  const commandHistoryDraftRef = useRef("");
  const commandCompletionStateRef = useRef<TerminalAutocompleteState | null>(null);
  const terminalDataHandlerRef = useRef<(data: string) => void>(() => {});
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {});
  const [terminalReady, setTerminalReady] = useState(false);
  const [connectionState, setConnectionState] = useState<TerminalConnectionState>("idle");
  const [command, setCommand] = useState("");
  const [selectedTerminalText, setSelectedTerminalText] = useState("");
  const [copyToast, setCopyToast] = useState("");
  const [showLogExtractModal, setShowLogExtractModal] = useState(false);
  const [extractedLogContent, setExtractedLogContent] = useState("");

  const copyTextToClipboard = async (text: string, successMsg = "已复制到剪贴板") => {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyToast(successMsg);
      setTimeout(() => setCopyToast(""), 2200);
    } catch {
      setCopyToast("复制失败");
      setTimeout(() => setCopyToast(""), 2000);
    }
  };
  const [error, setError] = useState("");
  const [lastIssue, setLastIssue] = useState("");
  const [reconnectTick, setReconnectTick] = useState(0);
  const [terminalMountKey, setTerminalMountKey] = useState(0);
  const [terminalActionBusy, setTerminalActionBusy] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [mobileCtrlActive, setMobileCtrlActive] = useState(false);
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 3500);
    return () => window.clearTimeout(timer);
  }, [error]);
  const instanceId = instance?.id ?? null;
  const instanceName = instance?.name ?? "";

  const sendResize = useCallback((cols: number, rows: number) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const payload: any = { type: "resize", cols, rows };
    if (shellSessionId) payload.sessionId = shellSessionId;
    socket.send(JSON.stringify(payload));
  }, [shellSessionId]);

  useEffect(() => {
    sendResizeRef.current = sendResize;
  }, [sendResize]);

  const handleTerminalHostRef = useCallback((node: HTMLDivElement | null) => {
    setTerminalHost(node);
  }, []);

  function resetCommandHistoryNavigation() {
    commandHistoryIndexRef.current = null;
    commandHistoryDraftRef.current = "";
  }

  function resetCommandCompletion() {
    commandCompletionStateRef.current = null;
  }

  function resetCommandInputNavigation() {
    resetCommandHistoryNavigation();
    resetCommandCompletion();
  }

  function rememberInputHistory(value: string) {
    if (!value.trim()) return;

    const history = inputHistoryRef.current;
    if (history[history.length - 1] === value) {
      resetCommandInputNavigation();
      return;
    }

    inputHistoryRef.current = [...history, value].slice(-terminalInputHistoryLimit);
    resetCommandInputNavigation();
  }

  function autocompleteCommandInput() {
    const completion = nextTerminalAutocompleteValue(command, inputHistoryRef.current, commandCompletionStateRef.current);
    if (!completion) return false;

    resetCommandHistoryNavigation();
    commandCompletionStateRef.current = completion.state;
    setCommand(completion.value);
    return true;
  }

  function navigateCommandHistory(direction: "previous" | "next") {
    const history = inputHistoryRef.current;
    if (history.length === 0) return;

    resetCommandCompletion();

    if (direction === "previous") {
      if (commandHistoryIndexRef.current === null) {
        commandHistoryDraftRef.current = command;
        commandHistoryIndexRef.current = history.length - 1;
      } else {
        commandHistoryIndexRef.current = Math.max(0, commandHistoryIndexRef.current - 1);
      }
      setCommand(history[commandHistoryIndexRef.current] ?? "");
      return;
    }

    if (commandHistoryIndexRef.current === null) return;
    const nextIndex = commandHistoryIndexRef.current + 1;
    if (nextIndex >= history.length) {
      commandHistoryIndexRef.current = null;
      setCommand(commandHistoryDraftRef.current);
      commandHistoryDraftRef.current = "";
      return;
    }

    commandHistoryIndexRef.current = nextIndex;
    setCommand(history[nextIndex] ?? "");
  }

  function handleCommandChange(event: React.ChangeEvent<HTMLInputElement>) {
    resetCommandInputNavigation();
    setCommand(event.target.value);
  }

  function handleCommandKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      autocompleteCommandInput();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (inputHistoryRef.current.length === 0) return;

    event.preventDefault();
    navigateCommandHistory(event.key === "ArrowUp" ? "previous" : "next");
  }

  useEffect(() => {
    if (inputHistoryInstanceIdRef.current === instanceId) return;
    inputHistoryInstanceIdRef.current = instanceId;
    inputHistoryRef.current = [];
    resetCommandInputNavigation();
    setCommand("");
  }, [instanceId]);

  useEffect(() => {
    if (!terminalHost || terminalRef.current) return;

    const finalShellNavyTheme = {
      background: "#162c4b",
      foreground: "#f1f5f9",
      black: "#162c4b",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#38bdf8",
      white: "#f1f5f9",
      brightBlack: "#475569",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#eab308",
      brightBlue: "#3b82f6",
      brightMagenta: "#a855f7",
      brightCyan: "#0ea5e9",
      brightWhite: "#ffffff",
      cursor: "#38bdf8",
      cursorAccent: "#162c4b",
      selectionBackground: "rgba(56, 189, 248, 0.3)"
    };

    const originalBlackTheme = {
      background: "#0e0f17",
      foreground: "#e5edf5",
      black: "#000000",
      red: "#aa0000",
      green: "#00aa00",
      yellow: "#ffaa00",
      blue: "#5555ff",
      magenta: "#aa00aa",
      cyan: "#00aaaa",
      white: "#aaaaaa",
      brightBlack: "#555555",
      brightRed: "#ff5555",
      brightGreen: "#55ff55",
      brightYellow: "#ffff55",
      brightBlue: "#5555ff",
      brightMagenta: "#ff55ff",
      brightCyan: "#55ffff",
      brightWhite: "#ffffff",
      cursor: "#a7f3d0",
      cursorAccent: "#0e0f17",
      selectionBackground: "#31505f"
    };

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const initialTheme = isDark ? originalBlackTheme : finalShellNavyTheme;

    const terminal = new XTerm({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: 'Consolas, "SFMono-Regular", "Menlo", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.28,
      letterSpacing: 0,
      scrollback: 8000,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      rescaleOverlappingGlyphs: true,
      allowTransparency: false,
      theme: initialTheme,
      ...(typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
        ? { windowsPty: { backend: "conpty" as const, buildNumber: 22621 } }
        : {})
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHost);

    const themeObserver = new MutationObserver(() => {
      const isDarkNow = document.documentElement.getAttribute("data-theme") === "dark";
      terminal.options.theme = isDarkNow ? originalBlackTheme : finalShellNavyTheme;
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const inputSubscription = terminal.onData((data) => {
      terminalDataHandlerRef.current(data);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      sendResizeRef.current(cols, rows);
    });
    const selectionSubscription = terminal.onSelectionChange(() => {
      const selected = readTerminalClipboardText(terminal);
      setSelectedTerminalText(selected);
      rememberSakiTerminalSelection(selected);
      if (selected && selected.trim().length > 0) {
        if (window.matchMedia("(pointer: coarse)").matches || 'ontouchstart' in window) {
          try {
            const activeEl = document.activeElement as HTMLElement | null;
            if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
              activeEl.blur();
            }
          } catch {}
        }
      }
    });
    const handleTerminalCopy = (event: ClipboardEvent) => {
      const termSelection = readTerminalClipboardText(terminal);
      const domSelection = window.getSelection()?.toString();
      const selectedText = termSelection || normalizeSakiSelectionText(domSelection || "");
      if (!selectedText || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", selectedText);
      event.preventDefault();
      rememberSakiTerminalSelection(selectedText);
      setCopyToast("已复制到剪贴板");
      setTimeout(() => setCopyToast(""), 2000);
    };
    terminalHost.addEventListener("copy", handleTerminalCopy, true);

    const handleDomSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        if (!terminal.hasSelection()) {
          setSelectedTerminalText("");
        }
        return;
      }
      if (terminalHost.contains(sel.anchorNode) && !terminal.hasSelection()) {
        const text = normalizeSakiSelectionText(sel.toString());
        if (text) {
          setSelectedTerminalText(text);
          rememberSakiTerminalSelection(text);
        }
      }
    };
    document.addEventListener("selectionchange", handleDomSelectionChange);

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && isTerminalCopyShortcut(event) && terminal.hasSelection()) {
        return false;
      }
      return true;
    });
    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastY = 0;
    let touchRemainder = 0;
    let touchActive = false;
    let touchScrolling = false;
    let touchSelecting = false;
    let longPressTimer: any = null;
    let selectStartRow = 0;

    const handleTerminalTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchActive = false;
        touchScrolling = false;
        touchSelecting = false;
        touchRemainder = 0;
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        return;
      }
      touchActive = true;
      touchScrolling = false;
      touchSelecting = false;
      touchRemainder = 0;
      const touch = event.touches[0]!;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchLastY = touch.clientY;

      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(() => {
        if (!touchActive || touchScrolling) return;
        touchSelecting = true;
        try {
          const rect = terminalHost.getBoundingClientRect();
          const core = (terminal as any)._core;
          const charHeight = core?._renderService?.dimensions?.actualCellHeight || 16;
          const relativeY = touchStartY - rect.top;
          const rowInViewport = Math.max(0, Math.min(terminal.rows - 1, Math.floor(relativeY / charHeight)));
          selectStartRow = rowInViewport;
          terminal.selectLines(rowInViewport, rowInViewport);
          if (navigator.vibrate) navigator.vibrate(30);
        } catch {}
      }, 350);
    };

    const handleTerminalTouchMove = (event: TouchEvent) => {
      if (!touchActive || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const currentX = touch.clientX;
      const currentY = touch.clientY;

      if (!touchSelecting && (Math.abs(currentX - touchStartX) > 8 || Math.abs(currentY - touchStartY) > 8)) {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }

      if (touchSelecting) {
        try {
          const rect = terminalHost.getBoundingClientRect();
          const core = (terminal as any)._core;
          const charHeight = core?._renderService?.dimensions?.actualCellHeight || 16;
          const relativeY = currentY - rect.top;
          const currentRow = Math.max(0, Math.min(terminal.rows - 1, Math.floor(relativeY / charHeight)));
          const minRow = Math.min(selectStartRow, currentRow);
          const maxRow = Math.max(selectStartRow, currentRow);
          terminal.selectLines(minRow, maxRow);
        } catch {}
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }

      const nextY = currentY;
      touchRemainder += touchLastY - nextY;
      touchLastY = nextY;

      const rowHeight = terminalTouchRowHeight(terminalHost, terminal);
      const lines = Math.trunc(touchRemainder / rowHeight);
      if (lines !== 0) {
        terminal.scrollLines(lines);
        touchRemainder -= lines * rowHeight;
        touchScrolling = true;
      }

      if (touchScrolling || Math.abs(touchRemainder) > 4) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleTerminalTouchEnd = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      touchActive = false;
      touchScrolling = false;
      touchSelecting = false;
      touchRemainder = 0;
    };
    terminalHost.addEventListener("touchstart", handleTerminalTouchStart, { passive: true });
    terminalHost.addEventListener("touchmove", handleTerminalTouchMove, { passive: false });
    terminalHost.addEventListener("touchend", handleTerminalTouchEnd);
    terminalHost.addEventListener("touchcancel", handleTerminalTouchEnd);

    const fitTerminalSafe = () => {
      if (!isActiveRef.current || !terminalHost) return;
      try {
        fitAddon.fit();
        sendResizeRef.current(terminal.cols, terminal.rows);
      } catch {}
    };
    fitTerminalSafeRef.current = fitTerminalSafe;

    fitTerminalSafe();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);
    setTerminalMountKey((value) => value + 1);

    const resize = () => fitTerminalSafe();
    window.addEventListener("resize", resize);
    const resizeObserver = new ResizeObserver(() => fitTerminalSafe());
    resizeObserver.observe(terminalHost);

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      terminalHost.removeEventListener("copy", handleTerminalCopy, true);
      document.removeEventListener("selectionchange", handleDomSelectionChange);
      terminalHost.removeEventListener("touchstart", handleTerminalTouchStart);
      terminalHost.removeEventListener("touchmove", handleTerminalTouchMove);
      terminalHost.removeEventListener("touchend", handleTerminalTouchEnd);
      terminalHost.removeEventListener("touchcancel", handleTerminalTouchEnd);
      inputSubscription.dispose();
      resizeSubscription.dispose();
      selectionSubscription.dispose();
      clearRememberedSakiTerminalSelection();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminalReady(false);
    };
  }, [terminalHost]);

  useEffect(() => {
    if (!immersive) {
      setMobileCtrlActive(false);
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      fitTerminalSafeRef.current?.();
      terminalRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      window.requestAnimationFrame(() => fitTerminalSafeRef.current?.());
    };
  }, [immersive]);

  useEffect(() => {
    if (!isActive) return;
    const frame = window.requestAnimationFrame(() => fitTerminalSafeRef.current?.());
    return () => window.cancelAnimationFrame(frame);
  }, [terminalReady, immersive, error, lastIssue, isActive]);

  // Refit and focus when this shell tab becomes active (while component stays mounted via display:none toggle).
  // Use double-raf to ensure the element has layout size after display change.
  useEffect(() => {
    if (!isActive) return;
    const raf1 = window.requestAnimationFrame(() => {
      const raf2 = window.requestAnimationFrame(() => {
        const fit = fitAddonRef.current;
        const term = terminalRef.current;
        if (fitTerminalSafeRef.current) fitTerminalSafeRef.current();
        if (term) {
          term.focus();
          // Re-render whatever is in the buffer (scrollback preserved in XTerm instance)
          try {
            const len = term.buffer.active.length || 2000;
            term.refresh(0, len);
          } catch {}
        }
      });
      // store for cleanup if needed, but simple cancel outer is ok
      (window as any).__termRaf2 = raf2;
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      const r2 = (window as any).__termRaf2;
      if (r2) window.cancelAnimationFrame(r2);
    };
  }, [isActive]);

  useEffect(() => {
    setLastIssue("");
    clearRememberedSakiTerminalSelection();
    if (!terminalReady || !instanceId) {
      setConnectionState("idle");
      socketRef.current?.close(1000, "No instance selected");
      return;
    }

    let disposed = false;
    const terminal = terminalRef.current;
    if (!terminal) return;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      clearReconnectTimer();
      setError("");
      setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      const socket = new WebSocket(api.terminalUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionState("connected");
        const authPayload: any = { type: "auth", token, instanceId };
        if (shellSessionId) authPayload.sessionId = shellSessionId;
        socket.send(JSON.stringify(authPayload));
        if (terminal) {
          sendResizeRef.current(terminal.cols, terminal.rows);
        }
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as any;
          if (payload.type === "data") {
            terminal.write(payload.data || "");
            return;
          }
          if (payload.type === "hello") {
            const isShell = !!shellSessionId;
            // For shells: never clear on hello (history lives in XTerm; server sends no lines).
            // Only main terminal replays its log buffer.
            if (!isShell) {
              terminal.clear();
              for (const line of payload.lines || []) {
                terminal.write(formatTerminalLine(line));
              }
            }
            if (payload.instanceId && !isShell) {
              onStatus(payload.instanceId, payload.status, payload.exitCode);
            }
            return;
          }
          if (payload.type === "line") {
            terminal.write(formatTerminalLine(payload.line));
            if (isTerminalIssue(payload.line)) {
              setLastIssue(payload.line.text);
            }
            return;
          }
          if (payload.type === "status") {
            onStatus(payload.instanceId, payload.status, payload.exitCode);
            return;
          }
          if (payload.type === "error") {
            setError(payload.message);
            terminal.write(`\x1b[31m${terminalDisplayText(payload.message)}${terminalAnsiReset}\r\n`);
          }
        } catch {
          terminal.write(terminalDisplayText(String(event.data)));
        }
      };

      socket.onerror = () => {
        if (!disposed) {
          setConnectionState("error");
          setError("终端连接异常");
        }
      };

      socket.onclose = (event) => {
        if (disposed) {
          setConnectionState("closed");
          return;
        }
        // 1008 = policy violation (unauthorized / permission denied). Reconnecting
        // with the same credentials would loop forever, so stop and show the error.
        if (event.code === 1008) {
          setConnectionState("error");
          setError(event.reason || "终端会话未授权");
          return;
        }
        reconnectAttemptRef.current += 1;
        setConnectionState("reconnecting");
        const delay = Math.min(5000, reconnectAttemptRef.current * 1200);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    terminal.clear();
    if (!shellSessionId) {
      terminal.write(`\x1b[33mConnecting to ${instanceName}...\x1b[0m\r\n`);
    }
    reconnectAttemptRef.current = 0;
    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearRememberedSakiTerminalSelection();
      socketRef.current?.close(1000, "Terminal view changed");
      socketRef.current = null;
    };
  }, [instanceId, instanceName, onStatus, reconnectTick, terminalMountKey, terminalReady, token, shellSessionId]);

  function sendInput(data: string, echo = true): boolean {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("终端未连接");
      return false;
    }
    if (!data) return true;
    const chunkSize = 16 * 1024;
    for (let index = 0; index < data.length; ) {
      let end = Math.min(index + chunkSize, data.length);
      const last = data.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff && end < data.length) {
        end += 1;
      }
      const payload: Record<string, unknown> = { type: "input", data: data.slice(index, end), echo };
      if (shellSessionId) payload.sessionId = shellSessionId;
      socket.send(JSON.stringify(payload));
      index = end;
    }
    return true;
  }

  function submitCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    if (sendInput(`${value}\r`)) {
      rememberInputHistory(value);
      setCommand("");
    }
  }

  async function toggleTerminalProcess() {
    if (!instance || terminalActionBusy) return;
    if (running) {
      sendInput("\u0003");
      return;
    }

    setTerminalActionBusy(true);
    setError("");
    try {
      const response = await api.startInstance(token, instance.id);
      onStatus(response.instance.id, response.instance.status, response.instance.lastExitCode);
      setReconnectTick((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "实例启动失败");
    } finally {
      setTerminalActionBusy(false);
    }
  }

  const running = instance?.status === "RUNNING";
  const starting = instance?.status === "STARTING";
  const stopping = instance?.status === "STOPPING";
  const connected = connectionState === "connected";
  const terminalActionDisabled = running ? !connected || terminalActionBusy : !instance || starting || stopping || terminalActionBusy;
  const terminalActionTitle = running ? "中断" : starting ? "启动中" : "启动";

  // Raw passthrough for all terminal sessions (main and shells) - direct PTY interactive raw mode
  terminalDataHandlerRef.current = (data: string) => {
    if (!connected || (!shellSessionId && !running)) {
      return;
    }
    sendInput(data, false);
  };

  function sendTerminalShortcut(shortcut: TerminalShortcutKey) {
    terminalRef.current?.focus();

    if (shortcut.type === "modifier") {
      setMobileCtrlActive((active) => !active);
      return;
    }

    if (!connected || (!shellSessionId && !running)) {
      setMobileCtrlActive(false);
      return;
    }

    const data = mobileCtrlActive ? (shortcut.ctrlData ?? shortcut.data) : shortcut.data;
    if (!data) {
      setMobileCtrlActive(false);
      return;
    }

    sendInput(data, false);
    setMobileCtrlActive(false);
  }

  useEffect(() => {
    if (!isActive) return;
    onMountTerminalActions?.({
      clear: () => {
        terminalRef.current?.clear();
        clearRememberedSakiTerminalSelection();
      },
      reconnect: () => setReconnectTick((value) => value + 1),
      toggleImmersive: () => setImmersive((value) => !value),
      isImmersive: immersive,
      connectionState,
      sendCommand: (cmd: string) => {
        const trimmed = cmd.trim();
        if (!trimmed) return;
        rememberInputHistory(trimmed);
        sendInput(`${trimmed}\r`, true);
      },
      getHistory: () => inputHistoryRef.current,
      extractOrCopyLogs: () => {
        const term = terminalRef.current;
        if (!term) return;
        const sel = readTerminalClipboardText(term);
        if (sel && sel.trim().length > 0) {
          copyTextToClipboard(sel, "选中文本已复制");
          return;
        }
        const full = readAllTerminalBufferText(term);
        if (!full) {
          setCopyToast("终端暂无文本");
          setTimeout(() => setCopyToast(""), 2000);
          return;
        }
        setExtractedLogContent(full);
        setShowLogExtractModal(true);
      }
    });
  }, [isActive, immersive, connectionState, onMountTerminalActions]);

  const terminalPanel = (
    <div
      className={`terminal-panel ${immersive ? "terminal-panel-immersive" : ""}`}
      role={immersive ? "dialog" : undefined}
      aria-modal={immersive ? true : undefined}
      aria-label={immersive ? `${instanceName || "实例"} 沉浸式终端` : undefined}
    >
      {immersive && (
        <div className="terminal-immersive-header">
          <div className="immersive-header-left">
            <span className="immersive-status-dot" data-status={connectionState} />
            <span className="immersive-title">
              {instanceName || "实例"} {shellSessionId ? "· 独立终端 (Shell)" : "· 主终端"}
            </span>
            <span className="immersive-hint">全屏沉浸模式</span>
          </div>
          <div className="immersive-header-right">
            <button
              type="button"
              className="immersive-action-btn"
              title="提取全部文本 / 复制日志"
              onClick={() => {
                const full = readAllTerminalBufferText(terminalRef.current);
                setExtractedLogContent(full);
                setShowLogExtractModal(true);
              }}
            >
              <FileText size={14} />
              <span>文本</span>
            </button>
            <button
              type="button"
              className="immersive-action-btn"
              title="清空终端"
              onClick={() => {
                terminalRef.current?.clear();
                clearRememberedSakiTerminalSelection();
              }}
            >
              <Trash2 size={14} />
              <span>清空</span>
            </button>
            <button
              type="button"
              className="immersive-action-btn"
              title="重新连接"
              onClick={() => setReconnectTick((v) => v + 1)}
            >
              <RefreshCw size={14} />
              <span>重连</span>
            </button>
            <button
              type="button"
              className="immersive-action-btn immersive-exit-btn"
              title="退出沉浸终端 (恢复窗口)"
              onClick={() => setImmersive(false)}
            >
              <Minimize2 size={15} />
              <span>退出沉浸</span>
            </button>
          </div>
        </div>
      )}
      <div
        className="xterm-host"
        ref={handleTerminalHostRef}
        onClick={() => {
          if (window.matchMedia("(pointer: fine)").matches) {
            terminalRef.current?.focus();
          }
        }}
      />

      {copyToast && <div className="terminal-copy-toast">{copyToast}</div>}

      {selectedTerminalText && (
        <div className="terminal-mobile-selection-bar">
          <div className="selection-info">
            <strong>{countSelectionCharacters(selectedTerminalText)}</strong> 字
          </div>
          <div className="selection-actions">
            <button
              type="button"
              className="selection-action-btn primary"
              title="复制选中文本"
              aria-label="复制"
              onClick={() => {
                copyTextToClipboard(selectedTerminalText, "选中文本已复制");
                terminalRef.current?.clearSelection();
                setSelectedTerminalText("");
              }}
            >
              <Copy size={14} />
            </button>
            {onAskSaki && (
              <button
                type="button"
                className="selection-action-btn saki"
                title="问 Saki"
                aria-label="问 Saki"
                onClick={() => {
                  onAskSaki({
                    message: `请分析以下终端选中的内容：\n\`\`\`\n${selectedTerminalText}\n\`\`\``,
                    mode: "agent"
                  });
                }}
              >
                <Sparkles size={14} />
              </button>
            )}
            <button
              type="button"
              className="selection-action-btn close"
              title="取消选择"
              aria-label="取消"
              onClick={() => {
                terminalRef.current?.clearSelection();
                setSelectedTerminalText("");
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      <div className="terminal-mobile-keys" role="toolbar" aria-label="终端快捷按键">
        <button
          key="copy-action-key"
          className={`terminal-key-button ${selectedTerminalText ? "active active-copy" : ""}`}
          type="button"
          title={selectedTerminalText ? "复制选中文本" : "提取并复制日志文本"}
          onClick={() => {
            if (selectedTerminalText) {
              copyTextToClipboard(selectedTerminalText, "选中文本已复制");
              terminalRef.current?.clearSelection();
              setSelectedTerminalText("");
            } else {
              const full = readAllTerminalBufferText(terminalRef.current);
              if (!full) {
                setCopyToast("终端暂无文本");
                setTimeout(() => setCopyToast(""), 2000);
                return;
              }
              setExtractedLogContent(full);
              setShowLogExtractModal(true);
            }
          }}
        >
          <Copy size={13} style={{ marginRight: 3, verticalAlign: "middle" }} />
          {selectedTerminalText ? "复制" : "文本"}
        </button>
        {terminalShortcutKeys.map((shortcut) => {
          const active = shortcut.type === "modifier" && mobileCtrlActive;
          return (
            <button
              key={shortcut.id}
              className={`terminal-key-button ${shortcut.type === "modifier" ? "terminal-key-modifier" : ""} ${shortcut.type === "key" && shortcut.wide ? "wide" : ""} ${active ? "active" : ""}`}
              type="button"
              title={shortcut.title}
              aria-pressed={shortcut.type === "modifier" ? active : undefined}
              onClick={() => sendTerminalShortcut(shortcut)}
            >
              {shortcut.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <div className="terminal-error">
          <span>{error}</span>
          <button
            type="button"
            className="terminal-error-close"
            onClick={() => setError("")}
            title="关闭提示"
          >
            ×
          </button>
        </div>
      ) : null}
      {showLogExtractModal && (
        <div className="modal-backdrop terminal-extract-backdrop" onClick={() => setShowLogExtractModal(false)}>
          <div className="glass-panel terminal-extract-modal" onClick={(e) => e.stopPropagation()}>
            <div className="terminal-extract-header">
              <div className="terminal-extract-title">
                <FileText size={16} />
                <span>终端文本查看与复制</span>
              </div>
              <button
                type="button"
                className="icon-button mini"
                onClick={() => setShowLogExtractModal(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="terminal-extract-body">
              <textarea
                className="terminal-extract-textarea"
                readOnly
                value={extractedLogContent || "终端暂无输出内容"}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
            <div className="terminal-extract-footer">
              <span className="terminal-extract-count">共 {extractedLogContent.length} 字符</span>
              <div className="terminal-extract-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowLogExtractModal(false)}
                >
                  关闭
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    copyTextToClipboard(extractedLogContent, "全部日志已复制");
                    setShowLogExtractModal(false);
                  }}
                >
                  <Copy size={14} />
                  <span>复制全部</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {lastIssue ? (
        <div className="terminal-issue">
          <span>{lastIssue}</span>
          {onAskSaki ? (
            <button
              className="small-button"
              type="button"
              onClick={() =>
                onAskSaki({
                  message: `请解释这个终端报错，并基于当前实例工作区给出修复方案：\n${lastIssue}`,
                  panelError: lastIssue,
                  mode: "agent"
                })
              }
            >
              <Sparkles size={14} />
              问 Saki
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return immersive ? createPortal(terminalPanel, document.body) : terminalPanel;
}

