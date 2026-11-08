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
  const header = /^File: ([^\r\n]+)\r?\nSize: [^\r\n]+?\| Total lines: (\d+)\r?\nShowing lines: (\d+)-(\d+)\r?\n\r?\n/.exec(observation);
  if (!header) return;
  const total = Number(header[2]);
  const start = Number(header[3]);
  const lines: string[] = [];
  for (const line of observation.slice(header[0].length).split(/\r?\n/)) {
    const numbered = /^ *(\d+) \| (.*)$/.exec(line);
    if (!numbered || Number(numbered[1]) !== start + lines.length) break;
    lines.push(numbered[2]!);
  }
  if (lines.length) return { path: header[1]!, start, total, lines };
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

/** Repetition follows real executions and evidence, independently of the read cache. */
export class AgentToolLoopGuard {
  private lastAttempt: { signature: string; outcome: string; repeats: number; ok: boolean } | undefined;
  private readonly observations = new Map<string, string>();
  private readonly verifications = new Set<string>();
  private readonly fileReads = new Map<string, { lines: Map<number, string>; total: number; readAt: number }>();
  private readonly fileWindows = new Map<string, string>();
  private readonly searchEvidence = new Set<string>();

  constructor(private readonly duplicateLimit: number) {}

  reset(): void {
    this.lastAttempt = undefined;
    this.observations.clear();
    this.verifications.clear();
    this.fileReads.clear();
    this.fileWindows.clear();
    this.searchEvidence.clear();
  }

  clearFileReads(): void {
    this.fileReads.clear();
  }

  blockedAttempts(signature: string, readOnly: boolean): number {
    const last = this.lastAttempt;
    // Successful reads may be polling changing state. Judge their returned
    // evidence instead of blocking the next refresh before it can run.
    return last?.signature === signature && last.repeats >= this.duplicateLimit && (!readOnly || !last.ok) ? last.repeats : 0;
  }

  hasRecentFileRange(scope: string, path: string, start: number, count: number): boolean {
    const previous = this.fileReads.get(JSON.stringify([scope, path]));
    if (!previous || start > previous.total || Date.now() - previous.readAt >= 5 * 60 * 1000) return false;
    const end = Math.min(start + count - 1, previous.total);
    for (let line = start; line <= end; line++) {
      if (!previous.lines.has(line)) return false;
    }
    return true;
  }

  record(signature: string, action: SakiAgentAction, options: { readOnly: boolean; bookkeeping: boolean; verification?: string | undefined; fileReadScope?: string | undefined; searchScope?: string | undefined; searchPath?: string | undefined; metadataScope?: string | undefined }): boolean {
    if (options.bookkeeping || action.status === "pending_approval" || action.status === "pending_input" || action.status === "rejected") return false;
    const observation = action.terminal ? action.observation.replace(/^terminal=independent-shell\n[\s\S]*?\nstdout:\n/,
      header => header.replace(/^(?:shellId|label|durationMs)=.*\n/gm, "")) : action.observation;
    const outcome = createHash("sha256").update(JSON.stringify(stableValue({ ok: action.ok, status: action.status,
      observation, attachments: action.attachments }))).digest("hex");
    const last = this.lastAttempt;
    this.lastAttempt = { signature, outcome, ok: action.ok,
      repeats: last?.signature === signature && last.outcome === outcome ? last.repeats + 1 : 1 };
    if (!action.ok) return false;
    if (options.verification) {
      const known = this.verifications.delete(options.verification);
      this.verifications.add(options.verification);
      if (this.verifications.size > 200) this.verifications.delete(this.verifications.values().next().value!);
      return !known;
    }
    if (options.searchScope !== undefined) {
      let file = "";
      let fresh = false;
      for (const line of observation.split("\n")) {
        if (line.startsWith("File: ")) file = line.slice(6);
        if (!file || !/^  > L\d+: /.test(line)) continue;
        const key = createHash("sha256").update(JSON.stringify([options.searchScope, file, line])).digest("hex");
        if (!this.searchEvidence.delete(key)) fresh = true;
        this.searchEvidence.add(key);
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
      const key = JSON.stringify([options.fileReadScope, file.path]);
      const previous = this.fileReads.get(key);
      const windowKey = JSON.stringify([key, file.start, file.lines.length]);
      const windowOutcome = createHash("sha256").update(JSON.stringify([file.total, file.lines])).digest("hex");
      const knownWindow = this.fileWindows.get(windowKey) === windowOutcome;
      this.fileWindows.delete(windowKey);
      this.fileWindows.set(windowKey, windowOutcome);
      if (this.fileWindows.size > 512) this.fileWindows.delete(this.fileWindows.keys().next().value!);
      const seen = previous?.total === file.total ? previous.lines : new Map<number, string>();
      let newLines = false;
      for (const [offset, text] of file.lines.entries()) {
        const line = file.start + offset;
        const digest = createHash("sha256").update(text).digest("base64url").slice(0, 16);
        if (seen.get(line) !== digest) newLines = true;
        seen.delete(line);
        seen.set(line, digest);
      }
      while (seen.size > 4000) seen.delete(seen.keys().next().value!);
      this.fileReads.delete(key);
      this.fileReads.set(key, { lines: seen, total: file.total, readAt: Date.now() });
      if (this.fileReads.size > 8) this.fileReads.delete(this.fileReads.keys().next().value!);
      // Exact windows remain recognizable after the recent per-line cache evicts a file.
      return newLines && (previous !== undefined || !knownWindow);
    }
    // Changing a list limit or symbol query is useful only when the observed
    // workspace result changes. Keep separate nodes/workspaces independent.
    const metadataTool = normalizedAgentToolName(action.tool);
    let evidence = outcome;
    if (options.metadataScope !== undefined && metadataTool === "findsymbols") {
      const definitions = observation.split(/\r?\n/).filter(line => /^.+:\d+: /.test(line));
      evidence = definitions.length ? createHash("sha256").update(definitions.join("\n")).digest("hex") : "no-definitions";
    }
    const evidenceKey = options.metadataScope === undefined ? signature
      : JSON.stringify([options.metadataScope, metadataTool, evidencePath(options.searchPath), evidence]);
    const newEvidence = this.observations.get(evidenceKey) !== evidence;
    // A confirmed new mutation can change earlier observations, even when
    // there were no cached reads to invalidate. Repeated no-ops do not reset it.
    if (newEvidence && !options.readOnly) {
      this.observations.clear();
      this.verifications.clear();
      this.fileReads.clear();
      this.fileWindows.clear();
      this.searchEvidence.clear();
    }
    this.observations.delete(evidenceKey);
    this.observations.set(evidenceKey, evidence);
    if (this.observations.size > 200) this.observations.delete(this.observations.keys().next().value!);
    return newEvidence;
  }
}
