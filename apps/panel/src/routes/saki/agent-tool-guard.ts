import { createHash } from "node:crypto";
import path from "node:path";
import type { SakiAgentAction } from "@webops/shared";
import { classifyCommandRisk, literalPosixReadSegments } from "../../command-policy.js";
import { normalizedAgentToolName } from "./tools.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stableValue(item)]));
  return value;
}

export function agentToolExecutionSignature(tool: string, args: Record<string, unknown> | unknown[], instanceId: string | null): string {
  const semanticArgs = Array.isArray(args) ? args : Object.fromEntries(Object.entries(args).filter(([key]) => key !== "note" && key !== "refresh"));
  return JSON.stringify(stableValue({ tool, args: semanticArgs, instanceId }));
}

const jsonLoad = String.raw`json\.load\(open\(['"][\w./-]+\.json['"]\)\)`;
const pythonJsonRead = new RegExp(String.raw`^import json\s*;\s*(?:${jsonLoad}(?:\s*;\s*print\(['"][\w -]+['"]\))?|print\(${jsonLoad}(?:\[['"][\w-]+['"]\])?\))\s*;?$`);

export function isAgentVerificationCommand(command: string): boolean {
  const segments = literalPosixReadSegments(command);
  if (!segments?.length) return false;
  return segments.some(({ words }, index) => {
    // A later command must not be able to hide a failing check's exit code.
    if (segments.slice(index, -1).some(segment => segment.separator !== "&&")) return false;
    const [raw, ...args] = words;
    let program = raw?.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");
    if (program === "npx" || program === "bunx") program = args.shift()?.toLowerCase();
    if (["tsc", "vue-tsc", "eslint", "pytest", "jest", "vitest"].includes(program ?? "")) {
      return !args.some(arg => /^(?:-h|-v|--help|--version|--watch|--listTests|--collect-only)$/.test(arg));
    }
    if (/^(?:python(?:3(?:\.\d+)?)?|py)$/.test(program ?? "")) {
      const module = args.indexOf("-m");
      return module >= 0 && /^(?:py_compile|compileall|pytest|unittest)$/.test(args[module + 1] ?? "");
    }
    if (program === "node") return args[0] === "--check" || args[0] === "-c"
      || args[0] === "-e" && args[1] === "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))";
    if (["npm", "pnpm", "yarn", "bun"].includes(program ?? "")) {
      const script = args[0] === "run" ? args[1] : args[0];
      return /^(?:test|check|typecheck|type-check|build|lint)(?::[\w.-]+)?$/i.test(script ?? "");
    }
    if (program === "go") return /^(?:test|vet|build)$/.test(args[0] ?? "");
    if (program === "cargo") return /^(?:check|test|clippy|build)$/.test(args[0] ?? "");
    return false;
  });
}

/** Identify a syntax check even when its command includes extra inspection and cache cleanup. */
export function agentPythonVerificationTarget(command: string, root: string, cwd: string): string | undefined {
  const segments = literalPosixReadSegments(command);
  if (!segments?.length) return;
  const resolvedRoot = path.posix.resolve(root.replace(/\\/g, "/"));
  const rootPrefix = resolvedRoot === "/" ? "/" : `${resolvedRoot}/`;
  const withinRoot = (candidate: string) => candidate === resolvedRoot || candidate.startsWith(rootPrefix);
  let directory = path.posix.resolve(resolvedRoot, (cwd || ".").replace(/\\/g, "/"));
  if (!withinRoot(directory)) return;
  const targets = new Set<string>();
  for (const { words, separator, globs } of segments) {
    const [program, ...args] = words;
    if (program === "cd" && args.length === 1 && args[0] && !args[0].startsWith("-") && !globs?.size && separator !== "|") {
      directory = path.posix.resolve(directory, args[0]);
      if (!withinRoot(directory)) return;
      continue;
    }
    if (/^python(?:3(?:\.\d+)?)?$/.test(program ?? "")) {
      const moduleIndex = args.indexOf("-m");
      if (moduleIndex >= 0 && args.slice(0, moduleIndex).every(arg => /^-[IEBsS]+$/.test(arg)) && args[moduleIndex + 1] === "py_compile") {
        const files = args.slice(moduleIndex + 2);
        if (!files.length || globs?.size || files.some(file => file.startsWith("-") || !file.endsWith(".py"))) return;
        for (const file of files) {
          const resolved = path.posix.resolve(directory, file);
          if (!withinRoot(resolved)) return;
          targets.add(resolved);
        }
        continue;
      }
      if (args.length === 2 && args[0] === "-c" && !globs?.size && pythonJsonRead.test(args[1]!.trim())) {
        const jsonMatch = /open\(['"]([\w./-]+\.json)['"]\)/.exec(args[1]!);
        if (!jsonMatch?.[1] || !withinRoot(path.posix.resolve(directory, jsonMatch[1]))) return;
        continue;
      }
      return;
    }
    if (program === "rm" && args.length === 2 && /^-(?:rf|fr|r|f)$/.test(args[0]!) && !globs?.size) {
      const cache = path.posix.resolve(directory, args[1]!);
      if (withinRoot(cache) && [...targets].some(target => cache === path.posix.join(path.posix.dirname(target), "__pycache__"))) continue;
    }
    if (globs?.size || !["cat", "cut", "echo", "grep", "head", "ls", "pwd", "rg", "sed", "stat", "tail", "wc"].includes(program ?? "")) return;
    const quoted = words.map(word => "'" + word.replaceAll("'", "'\\''") + "'").join(" ");
    if (!classifyCommandRisk(quoted, root, true).readOnly) return;
  }
  if (targets.size) return JSON.stringify([...targets].sort());
}

/** Null means malformed/unknown: never replay a checklist that was not confirmed. */
export function agentChecklistSignature(args: Record<string, unknown>): string | null {
  const text = typeof args.todos === "string" ? args.todos : typeof args.list === "string" ? args.list : "";
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 20) return null;
  const items = [];
  for (const line of lines) {
    const match = /^- \[([ xX-])\] (.+)$/.exec(line);
    if (!match?.[2]?.trim() || match[2].trim().length > 200) return null;
    items.push({ text: match[2].trim(), completed: match[1]!.toLowerCase() === "x", inProgress: match[1] === "-" });
  }
  return JSON.stringify(items);
}

export function isAgentChecklistTool(name: string): boolean {
  return /^(?:managetodos|settodos|todos|updatetodos|manage_todos|todotool|tasklist)$/i.test(name);
}

export function agentFileReadWindow(observation: string) {
  const header = /^(?:status=[^\r\n]+\r?\nok=[^\r\n]+\r?\n)?File: ([^\r\n]+)\r?\nSize: [^\r\n]+?\| Total lines: (\d+)\r?\nShowing lines: (\d+)-(\d+)\r?\n\r?\n/.exec(observation);
  if (!header) return;
  const total = Number(header[2]);
  const start = Number(header[3]);
  const body = observation.slice(header[0].length);
  const marker = /\r?\n\.\.\. \[(?:truncated \d+ chars|output truncated for context budget)\](?: \.\.\.)?/.exec(body);
  const cleanedBody = marker ? body.slice(0, marker.index) : body;
  const rawLines = cleanedBody.split(/\r?\n/);
  // Character truncation can leave a partial numbered line immediately before
  // the marker. Only complete lines can satisfy a later range request.
  if (marker && !cleanedBody.endsWith("\n")) rawLines.pop();
  const lines: string[] = [];
  for (const line of rawLines) {
    const numbered = /^ *(\d+) \| (.*)$/.exec(line);
    if (!numbered || Number(numbered[1]) !== start + lines.length) break;
    lines.push(numbered[2]!);
  }
  if (lines.length) return { path: header[1]!, start, total, lines };
}

export function turnMessagesHaveFileRange(
  messages: ReadonlyArray<{ role: string; name?: string | undefined; content: string; toolCallId?: string | undefined; toolCalls?: Array<{ id?: string | undefined; args: Record<string, unknown> | unknown[] }> | undefined }>,
  file: string,
  startLine: number,
  lineCount: number,
  scope: string,
  defaultScope: string,
  expectedLines?: readonly string[]
): boolean {
  const targetPath = evidencePath(file);
  if (!targetPath) return false;
  const callScopes = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (!call.id) continue;
        const args = Array.isArray(call.args) ? {} : call.args;
        callScopes.set(call.id, typeof args.instanceId === "string" && args.instanceId ? args.instanceId : defaultScope);
      }
    }
    if (message.role !== "tool" || normalizedAgentToolName(message.name ?? "") !== "readfile") continue;
    if (!message.toolCallId || callScopes.get(message.toolCallId) !== scope) continue;
    if (message.content.includes("... [compacted ") || message.content.startsWith("Cached result unchanged.")) continue;
    const window = agentFileReadWindow(message.content);
    if (!window || evidencePath(window.path) !== targetPath || window.total <= 0) continue;
    if (startLine > window.total) continue;
    const requestedEnd = Math.min(window.total, startLine + lineCount - 1);
    const visibleEnd = window.start + window.lines.length - 1;
    if (window.start <= startLine && visibleEnd >= requestedEnd) {
      const offset = startLine - window.start;
      if (!expectedLines || expectedLines.every((text, index) => window.lines[offset + index] === text)) return true;
    }
  }
  return false;
}

/** Recover the widest cached read that agrees with the latest successful window. */
export function agentFileReadRecovery(latest: SakiAgentAction, cached: Iterable<SakiAgentAction>): SakiAgentAction {
  const current = agentFileReadWindow(latest.observation);
  if (!current) return latest;
  let best = latest;
  let lineCount = current.lines.length;
  for (const candidate of cached) {
    if (candidate.args.instanceId !== latest.args.instanceId
      || candidate.observation.length <= best.observation.length) continue;
    const window = agentFileReadWindow(candidate.observation);
    if (!window || window.path !== current.path || window.lines.length <= lineCount) continue;
    const offset = current.start - window.start;
    if (offset < 0 || !current.lines.every((text, index) => text === window.lines[offset + index])) continue;
    best = candidate;
    lineCount = window.lines.length;
  }
  return best;
}

function evidencePath(value: string | undefined): string {
  return path.posix.normalize((value ?? "").replace(/\\/g, "/")).replace(/\/$/, "").replace(/^\.$/, "");
}

type TerminalEvidence = { scope: string; command: string; root: string; posix: boolean };

function terminalLines(observation: string, terminal: TerminalEvidence): string[] {
  const stdout = /(?:^|\r?\n)stdout:\r?\n([\s\S]*?)(?=\r?\nstderr:|$)/.exec(observation)?.[1];
  const stderr = /(?:^|\r?\n)stderr:\r?\n([\s\S]*?)(?=\r?\nhint:|$)/.exec(observation)?.[1];
  const output = stdout || stderr;
  if (!output) return [];
  const labels = new Set((terminal.posix ? literalPosixReadSegments(terminal.command) : null)
    ?.filter(({ words }) => words[0] === "echo" || words[0] === "printf")
    .map(({ words }) => words.slice(1).join(" ").trim()) ?? []);
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => line && !labels.has(line)
    && !(/^[\-=|*#_]{2}/.test(line) && /[\-=|*#_]{2}$/.test(line))
    && !/^(?:\[?output truncated|total \d+$|File undo is unavailable)/i.test(line));
}

function terminalSourceLocation(line: string, root: string) {
  const match = /^((?:[^:]+[\\/])?[^:/\\]+\.[\w-]+)[:-](\d+)[:-](.*)$/.exec(line);
  if (!match) return;
  const normalized = evidencePath(match[1]);
  const base = evidencePath(root);
  const file = base && normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized;
  if (file.startsWith("/") || file.startsWith("../")) return;
  return { file, number: Number(match[2]), text: match[3]! };
}

function rememberEvidence<K, V>(items: Map<K, V>, key: K, value: V, limit: number): boolean {
  const fresh = items.get(key) !== value;
  items.delete(key);
  items.set(key, value);
  if (items.size > limit) items.delete(items.keys().next().value!);
  return fresh;
}

/** Repetition follows real executions and evidence, independently of the read cache. */
export class AgentToolLoopGuard {
  private lastAttempt: { signature: string; outcome: string; repeats: number; ok: boolean } | undefined;
  private readonly observations = new Map<string, string>();
  private readonly verifications = new Set<string>();
  private readonly fileReads = new Map<string, { lines: Map<number, string>; total: number; readAt: number }>();
  private readonly fileWindows = new Map<string, string>();
  private readonly searchEvidence = new Set<string>();
  private readonly sourceLines = new Map<string, string>();
  private readonly terminalText = new Map<string, true>();

  constructor(private readonly duplicateLimit: number) {}

  reset(): void {
    this.lastAttempt = undefined;
    this.observations.clear();
    this.verifications.clear();
    this.fileReads.clear();
    this.fileWindows.clear();
    this.searchEvidence.clear();
    this.sourceLines.clear();
    this.terminalText.clear();
  }

  invalidateFileReadFreshness(): void {
    for (const read of this.fileReads.values()) read.readAt = 0;
  }

  private rememberSource(scope: string, text: string, file?: string, line?: number): boolean {
    const content = text.trim();
    if (!content && (file === undefined || line === undefined)) return false;
    const digest = createHash("sha256").update(content).digest("base64url").slice(0, 16);
    const freshText = Boolean(content) && rememberEvidence(this.terminalText, JSON.stringify([scope, digest]), true, 12000);
    if (file === undefined || line === undefined) return freshText;
    return rememberEvidence(this.sourceLines, JSON.stringify([scope, evidencePath(file), line]), digest, 24000);
  }

  blockedAttempts(signature: string, readOnly: boolean): number {
    const last = this.lastAttempt;
    // Successful reads may be polling changing state. Judge their returned
    // evidence instead of blocking the next refresh before it can run.
    return last?.signature === signature && last.repeats >= this.duplicateLimit && (!readOnly || !last.ok) ? last.repeats : 0;
  }

  hasRecentFileRange(scope: string, path: string, start: number, count: number): boolean {
    const previous = this.fileReads.get(JSON.stringify([scope, evidencePath(path)]));
    if (!previous || start > previous.total || Date.now() - previous.readAt >= 5 * 60 * 1000) return false;
    const end = Math.min(start + count - 1, previous.total);
    for (let line = start; line <= end; line++) {
      if (!previous.lines.has(line)) return false;
    }
    return true;
  }

  record(signature: string, action: SakiAgentAction, options: { readOnly: boolean; bookkeeping: boolean; verification?: string | undefined; fileReadScope?: string | undefined; searchScope?: string | undefined; searchPath?: string | undefined; metadataScope?: string | undefined; terminal?: TerminalEvidence | undefined }): boolean {
    if (options.bookkeeping || action.status === "pending_approval" || action.status === "pending_input" || action.status === "rejected") return false;
    const rawObservation = action.observation.replace(/^status=[^\r\n]+\r?\nok=[^\r\n]+\r?\n/, "");
    const observation = action.terminal ? rawObservation.replace(/^terminal=independent-shell\n[\s\S]*?\nstdout:\n/,
      header => header.replace(/^(?:shellId|label|durationMs)=.*\n/gm, "")) : rawObservation;
    const outcome = createHash("sha256").update(JSON.stringify(stableValue({ ok: action.ok, status: action.status,
      observation, attachments: action.attachments }))).digest("hex");
    const last = this.lastAttempt;
    this.lastAttempt = { signature, outcome, ok: action.ok,
      repeats: last?.signature === signature && last.outcome === outcome ? last.repeats + 1 : 1 };
    const checkpoint = action.approval?.checkpointId;
    if (checkpoint) {
      // A retained terminal checkpoint means the daemon observed file changes,
      // even if the command ultimately failed. A command's exit code alone cannot tell us this.
      const changed = rememberEvidence(this.observations, `checkpoint:${checkpoint}`, outcome, 200);
      if (changed) {
        this.verifications.clear();
        this.invalidateFileReadFreshness();
      }
      if (options.terminal && changed) return true;
    }
    if (!action.ok) return false;
    if (options.verification) {
      const known = this.verifications.delete(options.verification);
      this.verifications.add(options.verification);
      if (this.verifications.size > 200) this.verifications.delete(this.verifications.values().next().value!);
      return !known;
    }
    if (options.terminal) {
      let freshLocated = false;
      let freshUnlocated = 0;
      const lines = terminalLines(observation, options.terminal);
      for (const line of lines) {
        const location = terminalSourceLocation(line, options.terminal.root);
        if (location) {
          if (this.rememberSource(options.terminal.scope, location.text, location.file, location.number)) freshLocated = true;
        } else if (this.rememberSource(options.terminal.scope, line.replace(/^(?:\d+[:|\-]\s*)+/, ""))) {
          freshUnlocated += 1;
        }
      }
      // Output with no file/line attribution is weak evidence when nearly all
      // of it repeats known material. Use a structured read for exact findings.
      return freshLocated || freshUnlocated >= Math.max(1, Math.ceil(lines.length / 6));
    }
    if (options.searchScope !== undefined) {
      let file = "";
      let fresh = false;
      for (const line of observation.split("\n")) {
        if (line.startsWith("File: ")) file = line.slice(6);
        const match = /^  > L(\d+): (.*)$/.exec(line);
        if (file && match && this.rememberSource(options.searchScope, match[2]!, file, Number(match[1]))) fresh = true;
      }
      if (!file && /Searched [1-9]\d* files?, 0 matches\./.test(observation)) {
        const key = JSON.stringify([options.searchScope, "searched-location", evidencePath(options.searchPath)]);
        if (!this.searchEvidence.delete(key)) fresh = true;
        this.searchEvidence.add(key);
      }
      while (this.searchEvidence.size > 1024) this.searchEvidence.delete(this.searchEvidence.values().next().value!);
      return fresh;
    }
    const file = options.fileReadScope === undefined ? undefined : agentFileReadWindow(observation);
    if (file) {
      const key = JSON.stringify([options.fileReadScope, evidencePath(file.path)]);
      const previous = this.fileReads.get(key);
      const windowKey = JSON.stringify([key, file.start, file.lines.length]);
      const windowOutcome = createHash("sha256").update(JSON.stringify([file.total, file.lines])).digest("hex");
      const knownWindow = !rememberEvidence(this.fileWindows, windowKey, windowOutcome, 512);
      const seen = previous?.total === file.total ? previous.lines : new Map<number, string>();
      let newLineCount = 0;
      for (const [offset, text] of file.lines.entries()) {
        const line = file.start + offset;
        const digest = createHash("sha256").update(text).digest("base64url").slice(0, 16);
        const newSource = this.rememberSource(options.fileReadScope!, text, file.path, line);
        if (seen.get(line) !== digest && (newSource || seen.has(line))) newLineCount += 1;
        seen.delete(line);
        seen.set(line, digest);
      }
      while (seen.size > 4000) seen.delete(seen.keys().next().value!);
      this.fileReads.delete(key);
      this.fileReads.set(key, { lines: seen, total: file.total, readAt: Date.now() });
      if (this.fileReads.size > 8) this.fileReads.delete(this.fileReads.keys().next().value!);
      // Exact windows remain recognizable after the recent per-line cache evicts a file.
      return newLineCount > 0 && (previous !== undefined || !knownWindow);
    }
    // Changing a list limit or symbol query is useful only when the observed
    // workspace result changes. Keep separate nodes/workspaces independent.
    const metadataTool = normalizedAgentToolName(action.tool);
    const targetPath = evidencePath(options.searchPath);
    if (options.metadataScope !== undefined) {
      if (metadataTool === "readsymbol") {
        const headerFile = /^Symbol: [^\r\n]+\r?\nFile: ([^\r\n]+?) \(Lines \d+ - \d+, \d+ lines\)/m.exec(observation)?.[1];
        const symbolFile = evidencePath(headerFile || targetPath);
        let parsedLines = 0;
        let freshLines = 0;
        for (const line of observation.split(/\r?\n/)) {
          const numbered = /^ *(\d+): (.*)$/.exec(line);
          if (!numbered || !symbolFile) continue;
          parsedLines += 1;
          if (this.rememberSource(options.metadataScope, numbered[2]!, symbolFile, Number(numbered[1]))) freshLines += 1;
        }
        if (parsedLines > 0) {
          const evidenceKey = JSON.stringify([options.metadataScope, metadataTool, symbolFile, outcome]);
          const firstObservation = rememberEvidence(this.observations, evidenceKey, outcome, 200);
          return freshLines > 0 && firstObservation;
        }
      } else if (metadataTool === "outlinefile" && targetPath) {
        const read = this.fileReads.get(JSON.stringify([options.metadataScope, targetPath]));
        const outlineLines: Array<{ line: number; text: string }> = [];
        for (const raw of observation.split(/\r?\n/)) {
          const match = /^\s*(?:L)?(\d+)\s*[:|]\s*(.*)$/.exec(raw);
          if (match) outlineLines.push({ line: Number(match[1]), text: match[2]! });
        }
        let freshOutline = !read;
        for (const item of outlineLines) {
          if (this.rememberSource(options.metadataScope, item.text, targetPath, item.line)) freshOutline = true;
          else if (!read?.lines.has(item.line)) freshOutline = true;
        }
        const evidenceKey = JSON.stringify([options.metadataScope, metadataTool, targetPath, outcome]);
        const firstObservation = rememberEvidence(this.observations, evidenceKey, outcome, 200);
        return freshOutline && firstObservation;
      } else if (metadataTool === "statfile" && targetPath) {
        if (this.fileReads.has(JSON.stringify([options.metadataScope, targetPath]))) return false;
      }
    }
    let evidence = outcome;
    if (options.metadataScope !== undefined && metadataTool === "findsymbols") {
      const definitions = observation.split(/\r?\n/).filter(line => /^.+:\d+: /.test(line));
      let freshDefinition = definitions.length === 0;
      for (const def of definitions) {
        const match = /^(.+):(\d+): (.*)$/.exec(def);
        if (match && this.rememberSource(options.metadataScope, match[3]!, match[1]!, Number(match[2]))) {
          freshDefinition = true;
        }
      }
      evidence = definitions.length ? createHash("sha256").update(definitions.join("\n")).digest("hex") : "no-definitions";
      const evidenceKey = JSON.stringify([options.metadataScope, metadataTool, targetPath, evidence]);
      const firstObservation = rememberEvidence(this.observations, evidenceKey, evidence, 200);
      return freshDefinition && firstObservation;
    }
    const evidenceKey = options.metadataScope === undefined ? signature
      : JSON.stringify([options.metadataScope, metadataTool, targetPath, evidence]);
    return rememberEvidence(this.observations, evidenceKey, evidence, 200);
  }
}
