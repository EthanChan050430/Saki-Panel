import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { TextDecoder } from "node:util";
import { randomUUID } from "node:crypto";
import * as nodePty from "@homebridge/node-pty-prebuilt-multiarch";
import type { IDisposable, IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import type { InstanceCommandResponse, InstanceLogLine, InstanceProxyConfig, InstanceStatus, InstanceType, RestartPolicy } from "@webops/shared";
import { daemonPaths } from "./config.js";
import { loadRuntimeState, saveRuntimeState, type PersistedInstance } from "./state-persist.js";
import { ensureInstanceClashProxy, stopInstanceClash } from "./clash-core.js";

export interface DaemonInstanceSpec {
  id: string;
  name: string;
  type: InstanceType;
  workingDirectory: string;
  startCommand: string;
  stopCommand?: string | null;
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  proxy?: InstanceProxyConfig | null;
}

export interface DaemonInstanceState {
  instanceId: string;
  status: InstanceStatus;
  exitCode?: number | null;
  logs: InstanceLogLine[];
}

interface RuntimeState {
  child: RuntimeChild | null;
  status: InstanceStatus;
  exitCode?: number | null;
  logs: InstanceLogLine[];
  nextLogId: number;
  cwd?: string;
  stopping: boolean;
  restartSpec?: DaemonInstanceSpec;
  restartAttempts: number;
  restartTimer?: NodeJS.Timeout;
}

type RuntimeExit = {
  code: number | null;
  signal?: NodeJS.Signals | string | number | null;
};

type RuntimeExitListener = (exit: RuntimeExit) => void;

interface ProcessRuntimeChild {
  type: "process";
  process: ChildProcess;
}

interface PtyRuntimeChild {
  type: "pty";
  pty: IPty;
  exited: boolean;
  exit?: RuntimeExit;
  exitListeners: Set<RuntimeExitListener>;
  dataSubscription: IDisposable;
  exitSubscription: IDisposable;
}

type RuntimeChild = ProcessRuntimeChild | PtyRuntimeChild;

const runtimes = new Map<string, RuntimeState>();
const instanceSpecs = new Map<string, DaemonInstanceSpec>();
const shellSessions = new Map<string, ShellSession>();
const maxLogLines = 1000;
const maxCommandCaptureChars = 80000;
const maxCommandInputChars = 100000;
const runtimeEvents = new EventEmitter();
runtimeEvents.setMaxListeners(1000);
const gbkDecoder = new TextDecoder("gbk");

interface ShellSession {
  id: string;
  instanceId: string;
  pty: IPty;
  exited: boolean;
  exit?: RuntimeExit | undefined;
  dataListeners: Set<(text: string) => void>;
  exitListeners: Set<RuntimeExitListener>;
  dataSubscription: IDisposable;
  exitSubscription: IDisposable;
}

function replacementCount(value: string): number {
  return value.match(/\uFFFD/g)?.length ?? 0;
}

function decodeProcessOutput(chunk: Buffer): string {
  const utf8 = chunk.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;

  try {
    const gbk = gbkDecoder.decode(chunk);
    return replacementCount(gbk) < replacementCount(utf8) ? gbk : utf8;
  } catch {
    return utf8;
  }
}

function commandEnvironment(spec?: DaemonInstanceSpec | null): NodeJS.ProcessEnv {
  const colorEnvironment =
    process.env.NO_COLOR === undefined
      ? {
          FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
          CLICOLOR: process.env.CLICOLOR ?? "1",
          CLICOLOR_FORCE: process.env.CLICOLOR_FORCE ?? "1"
        }
      : {};

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: process.env.TERM ?? "xterm-256color",
    COLORTERM: process.env.COLORTERM ?? "truecolor",
    ...colorEnvironment,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: process.env.PYTHONUNBUFFERED ?? "1"
  };

  if (spec?.proxy?.enabled && spec.proxy.server && spec.proxy.port) {
    const { type, server, port, username, password, bypass } = spec.proxy;
    let auth = "";
    if (username) {
      auth = password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : `${encodeURIComponent(username)}@`;
    }
    const proxyUrl = `${type}://${auth}${server}:${port}`;
    const noProxy = bypass?.trim() || "localhost,127.0.0.1,::1";

    baseEnv.HTTP_PROXY = proxyUrl;
    baseEnv.http_proxy = proxyUrl;
    baseEnv.HTTPS_PROXY = proxyUrl;
    baseEnv.https_proxy = proxyUrl;
    baseEnv.ALL_PROXY = proxyUrl;
    baseEnv.all_proxy = proxyUrl;
    baseEnv.NO_PROXY = noProxy;
    baseEnv.no_proxy = noProxy;
  }

  return baseEnv;
}

function getRuntime(instanceId: string): RuntimeState {
  const existing = runtimes.get(instanceId);
  if (existing) return existing;

  const runtime: RuntimeState = {
    status: "CREATED",
    child: null,
    exitCode: null,
    logs: [],
    nextLogId: 1,
    stopping: false,
    restartAttempts: 0
  };
  runtimes.set(instanceId, runtime);
  return runtime;
}

function appendLog(instanceId: string, runtime: RuntimeState, stream: InstanceLogLine["stream"], text: string): void {
  const normalizedText = text.replace(/\r/g, "");
  const pieces = normalizedText.split("\n").filter((line) => line.length > 0);

  for (const piece of pieces.length ? pieces : [normalizedText]) {
    const line: InstanceLogLine = {
      id: runtime.nextLogId,
      time: new Date().toISOString(),
      stream,
      text: piece
    };
    runtime.logs.push(line);
    runtime.nextLogId += 1;
    runtimeEvents.emit(`log:${instanceId}`, line);
  }

  if (runtime.logs.length > maxLogLines) {
    runtime.logs.splice(0, runtime.logs.length - maxLogLines);
  }
}

export interface InstanceStatusPush {
  instanceId: string;
  status: InstanceStatus;
  exitCode: number | null;
  logTail: InstanceLogLine[];
  restartPolicy: RestartPolicy;
  restartAttempts: number;
  willRetryByPolicy: boolean;
}

type InstanceStatusPushHandler = (event: InstanceStatusPush) => Promise<{ suppressRestartUntil?: string | null } | void>;

let instanceStatusPushHandler: InstanceStatusPushHandler | null = null;
const restartLeases = new Map<string, number>();

export function setInstanceStatusPushHandler(handler: InstanceStatusPushHandler | null): void {
  instanceStatusPushHandler = handler;
}

export function applyRestartLease(instanceId: string, suppressUntilIso: string | null | undefined): void {
  if (!instanceId) return;
  if (!suppressUntilIso) {
    restartLeases.delete(instanceId);
    return;
  }
  const until = Date.parse(suppressUntilIso);
  if (!Number.isFinite(until) || until <= Date.now()) {
    restartLeases.delete(instanceId);
    return;
  }
  restartLeases.set(instanceId, until);
}

export function applyRestartLeases(leases: Array<{ instanceId: string; suppressUntil: string }>): void {
  const seen = new Set<string>();
  for (const lease of leases) {
    seen.add(lease.instanceId);
    applyRestartLease(lease.instanceId, lease.suppressUntil);
  }
  for (const instanceId of restartLeases.keys()) {
    if (!seen.has(instanceId) && (restartLeases.get(instanceId) ?? 0) <= Date.now()) {
      restartLeases.delete(instanceId);
    }
  }
}

function isRestartSuppressed(instanceId: string): boolean {
  const until = restartLeases.get(instanceId);
  if (!until) return false;
  if (until <= Date.now()) {
    restartLeases.delete(instanceId);
    return false;
  }
  return true;
}

function emitStatus(instanceId: string, runtime: RuntimeState): void {
  runtimeEvents.emit(`status:${instanceId}`, {
    instanceId,
    status: runtime.status,
    exitCode: runtime.exitCode ?? null
  });
  runtimeEvents.emit("state-changed");
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function ensureInsideWorkspace(targetPath: string): Promise<string> {
  const workspaceRoot = path.resolve(daemonPaths.workspaceDir);
  await fs.mkdir(workspaceRoot, { recursive: true });
  const absoluteTarget = path.isAbsolute(targetPath);
  const resolved = absoluteTarget ? path.resolve(targetPath) : path.resolve(workspaceRoot, targetPath);
  const realWorkspaceRoot = absoluteTarget ? "" : await fs.realpath(workspaceRoot);

  const exists = await pathExists(resolved);
  if (exists) {
    const realTarget = await fs.realpath(resolved);
    if (!absoluteTarget && !isInsidePath(realWorkspaceRoot, realTarget)) {
      throw new Error("Path escapes the daemon workspace root");
    }
    return resolved;
  }

  await fs.mkdir(resolved, { recursive: true });
  if (!absoluteTarget) {
    const realParent = await fs.realpath(path.dirname(resolved));
    if (!isInsidePath(realWorkspaceRoot, realParent)) {
      throw new Error("Path escapes the daemon workspace root");
    }
  }
  return resolved;
}

const daemonCriticalCommandPatterns: RegExp[] = [
  /\brm\s+-rf\s+(\/|\*|~|\$HOME)\b/i,
  /\bdel\s+\/[sq]\s+(?:[a-z]:\\|\\|\*)/i,
  /\brmdir\s+\/[sq]\s+(?:[a-z]:\\|\\|\*)/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(?:\.|\s)/i,
  /\bdd\s+if=.*\s+of=\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
  /\breg\s+delete\b/i,
  /\bnet\s+user\s+.*\s+\/delete\b/i
];

function assertCommandAllowed(command: string): void {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("Command is required");
  }
  if (normalized.length > 4000) {
    throw new Error("Command is too long");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(command)) {
    throw new Error("Command contains control characters");
  }
  for (const pattern of daemonCriticalCommandPatterns) {
    if (pattern.test(normalized)) {
      throw new Error("Command was blocked by the daemon safety policy");
    }
  }
}

function commandLauncher(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const psPath = [
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "pwsh.exe")
    ].find((p) => {
      try { require("fs").accessSync(p); return true; } catch { return false; }
    });
    if (psPath) {
      return {
        file: psPath,
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
      };
    }
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command]
    };
  }

  const shell = process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : "/bin/sh";
  return {
    file: shell,
    args: ["-lc", command]
  };
}

function runtimeChildPid(child: RuntimeChild | null): number | undefined {
  if (!child) return undefined;
  return child.type === "pty" ? child.pty.pid : child.process.pid ?? undefined;
}

function runtimeChildExited(child: RuntimeChild): boolean {
  if (child.type === "pty") return child.exited;
  return child.process.exitCode !== null || child.process.killed;
}

function runtimeChildCanWrite(child: RuntimeChild): boolean {
  if (child.type === "pty") return !child.exited;
  const stdin = child.process.stdin;
  return Boolean(stdin && !stdin.destroyed && stdin.writable);
}

function writeRuntimeChild(child: RuntimeChild, data: string): void {
  if (child.type === "pty") {
    const ptyData = data.replace(/\r\n/g, "\r");
    child.pty.write(ptyData);
    return;
  }
  const pipeData = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  child.process.stdin?.write(pipeData);
}

function onRuntimeChildExit(child: RuntimeChild, listener: RuntimeExitListener): () => void {
  if (child.type === "pty") {
    if (child.exited) {
      queueMicrotask(() => listener(child.exit ?? { code: null }));
      return () => undefined;
    }
    child.exitListeners.add(listener);
    return () => child.exitListeners.delete(listener);
  }

  const handler = (code: number | null, signal: NodeJS.Signals | null) => listener(signal ? { code, signal } : { code });
  child.process.once("exit", handler);
  return () => child.process.off("exit", handler);
}

function disposeRuntimeChild(child: RuntimeChild): void {
  if (child.type !== "pty") return;
  child.dataSubscription.dispose();
  child.exitSubscription.dispose();
  child.exitListeners.clear();
}

function getShell(sessionId: string): ShellSession | undefined {
  return shellSessions.get(sessionId);
}

function createInteractiveShellPty(instanceId: string, cwd: string): ShellSession {
  const id = randomUUID();

  let shellCmd: string;
  let shellArgs: string[];
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "pwsh.exe")
    ];
    const ps = candidates.find((p) => {
      try {
        require("fs").accessSync(p);
        return true;
      } catch {
        return false;
      }
    });
    if (ps) {
      shellCmd = ps;
      shellArgs = ["-NoLogo", "-NoProfile", "-NoExit"];
    } else {
      shellCmd = process.env.ComSpec || "cmd.exe";
      shellArgs = [];
    }
  } else {
    shellCmd = process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : "/bin/bash";
    shellArgs = ["-i", "-l"];
  }

  const spec = instanceSpecs.get(instanceId);
  const pty = nodePty.spawn(shellCmd, shellArgs, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: commandEnvironment(spec),
    encoding: "utf8",
    useConpty: process.platform === "win32"
  });

  const dataListeners = new Set<(text: string) => void>();
  const exitListeners = new Set<RuntimeExitListener>();
  let exited = false;
  let exitInfo: RuntimeExit | undefined = undefined;

  const dataSubscription = pty.onData((data: string) => {
    for (const listener of dataListeners) {
      try {
        listener(data);
      } catch {}
    }
  });

  const exitSubscription = pty.onExit((event) => {
    exited = true;
    exitInfo = typeof event.signal === "number"
      ? { code: event.exitCode, signal: event.signal }
      : { code: event.exitCode };
    for (const listener of [...exitListeners]) {
      listener(exitInfo);
    }
    exitListeners.clear();
  });

  const session: ShellSession = {
    id,
    instanceId,
    pty,
    exited,
    exit: exitInfo,
    dataListeners,
    exitListeners,
    dataSubscription,
    exitSubscription
  };

  shellSessions.set(id, session);
  return session;
}

function writeToShell(sessionId: string, data: string): void {
  const session = shellSessions.get(sessionId);
  if (!session || session.exited) {
    throw new Error("Shell session is not available");
  }
  const ptyData = data.replace(/\r\n/g, "\r");
  session.pty.write(ptyData);
}

function subscribeToShell(
  sessionId: string,
  handlers: { onData?: (text: string) => void; onExit?: RuntimeExitListener }
): () => void {
  const session = shellSessions.get(sessionId);
  if (!session) {
    throw new Error("Shell session not found");
  }
  const unsubscribers: Array<() => void> = [];

  if (handlers.onData) {
    session.dataListeners.add(handlers.onData);
    unsubscribers.push(() => session.dataListeners.delete(handlers.onData!));
  }

  if (handlers.onExit) {
    if (session.exited && session.exit) {
      queueMicrotask(() => handlers.onExit!(session.exit!));
    } else {
      session.exitListeners.add(handlers.onExit);
      unsubscribers.push(() => session.exitListeners.delete(handlers.onExit!));
    }
  }

  return () => {
    unsubscribers.forEach((fn) => fn());
  };
}

function closeShellSession(sessionId: string): void {
  const session = shellSessions.get(sessionId);
  if (!session) return;
  try {
    session.pty.kill();
  } catch {}
  try {
    session.dataSubscription.dispose();
  } catch {}
  try {
    session.exitSubscription.dispose();
  } catch {}
  session.dataListeners.clear();
  session.exitListeners.clear();
  shellSessions.delete(sessionId);
}

function startPtyRuntimeChild(
  launcher: { file: string; args: string[] },
  cwd: string,
  spec: DaemonInstanceSpec,
  onData: (text: string) => void
): RuntimeChild {
  let managed: PtyRuntimeChild;
  const pty = nodePty.spawn(launcher.file, launcher.args, {
    name: "xterm-256color",
    cols: 160,
    rows: 40,
    cwd,
    env: commandEnvironment(spec),
    encoding: "utf8",
    useConpty: process.platform === "win32"
  });

  managed = {
    type: "pty",
    pty,
    exited: false,
    exitListeners: new Set<RuntimeExitListener>(),
    dataSubscription: pty.onData(onData),
    exitSubscription: pty.onExit((event) => {
      managed.exited = true;
      managed.exit = typeof event.signal === "number" ? { code: event.exitCode, signal: event.signal } : { code: event.exitCode };
      for (const listener of [...managed.exitListeners]) {
        listener(managed.exit);
      }
      managed.exitListeners.clear();
    })
  };

  return managed;
}

function startProcessRuntimeChild(
  launcher: { file: string; args: string[] },
  cwd: string,
  spec: DaemonInstanceSpec,
  onStdout: (chunk: Buffer) => void,
  onStderr: (chunk: Buffer) => void,
  onError: (error: Error) => void
): RuntimeChild {
  const child = spawn(launcher.file, launcher.args, {
    cwd,
    env: commandEnvironment(spec),
    detached: process.platform !== "win32",
    windowsHide: true
  });
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);
  child.on("error", onError);
  return { type: "process", process: child };
}

function appendCapturedText(current: string, next: string): string {
  if (current.length >= maxCommandCaptureChars) return current;
  const remaining = maxCommandCaptureChars - current.length;
  return current + next.slice(0, remaining);
}

function validateCommandInput(input: string): void {
  if (input.length > maxCommandInputChars) {
    throw new Error("Command input is too long");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input)) {
    throw new Error("Command input contains unsupported control characters");
  }
}

function validateTerminalInput(input: string): void {
  if (input.length > maxCommandInputChars) {
    throw new Error("Terminal input is too long");
  }
}

function waitForExit(runtime: RuntimeState, timeoutMs: number): Promise<boolean> {
  const child = runtime.child;
  if (!child) return Promise.resolve(true);
  if (runtimeChildExited(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    };
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(runtime.child !== child);
    }, timeoutMs);
    const unsubscribe = onRuntimeChildExit(child, finish);
  });
}

function runTaskkill(pid: number, force: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["/PID", String(pid), "/T"];
    if (force) {
      args.push("/F");
    }
    const killer = spawn("taskkill", args, {
      windowsHide: true
    });
    let stderr = "";
    killer.stderr?.on("data", (chunk: Buffer) => {
      stderr += decodeProcessOutput(chunk);
    });
    killer.once("exit", (code) => {
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `taskkill exited with ${code}`));
        return;
      }
      resolve();
    });
    killer.once("error", reject);
  });
}

async function signalProcessTree(
  child: RuntimeChild,
  signal: NodeJS.Signals,
  force: boolean,
  onError: (message: string) => void
): Promise<void> {
  if (child.type === "pty") {
    const pid = runtimeChildPid(child);
    if (process.platform === "win32" && pid) {
      try {
        await runTaskkill(pid, force);
        return;
      } catch (error) {
        onError(`PTY signal failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    try {
      child.pty.kill(process.platform === "win32" ? undefined : signal);
    } catch (error) {
      onError(`PTY signal failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    return;
  }

  const processChild = child.process;
  if (!processChild.pid) {
    processChild.kill(signal);
    return;
  }

  if (process.platform === "win32") {
    try {
      await runTaskkill(processChild.pid, true);
      return;
    } catch (error) {
      onError(`Process tree signal failed: ${error instanceof Error ? error.message : "unknown error"}`);
      processChild.kill(signal);
      return;
    }
  }

  try {
    process.kill(-processChild.pid, signal);
  } catch (error) {
    onError(`Process group signal failed: ${error instanceof Error ? error.message : "unknown error"}`);
    processChild.kill(signal);
  }
}

export class InstanceManager {
  private persistTimer: NodeJS.Timeout | null = null;
  private persistDebounceMs = 2000;

  constructor() {
    runtimeEvents.on("state-changed", () => {
      this.schedulePersist();
    });
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, this.persistDebounceMs);
  }

  private async persistNow(): Promise<void> {
    const instances: PersistedInstance[] = [];
    for (const [instanceId, runtime] of runtimes) {
      instances.push({
        instanceId,
        status: runtime.status,
        exitCode: runtime.exitCode ?? null,
        cwd: runtime.cwd,
        restartAttempts: runtime.restartAttempts,
        lastPid: runtimeChildPid(runtime.child)
      });
    }
    try {
      await saveRuntimeState(instances);
    } catch (error) {
      console.error("Failed to persist runtime state:", error instanceof Error ? error.message : error);
    }
  }

  async restorePersistedState(): Promise<void> {
    const persisted = await loadRuntimeState();
    for (const entry of persisted) {
      if (entry.status === "RUNNING" || entry.status === "STARTING") {
        const runtime = getRuntime(entry.instanceId);
        runtime.status = "CRASHED";
        runtime.exitCode = null;
        if (entry.cwd !== undefined) runtime.cwd = entry.cwd;
        runtime.restartAttempts = entry.restartAttempts;
        appendLog(entry.instanceId, runtime, "system", "Daemon restarted; previously running instance marked as CRASHED.");
        emitStatus(entry.instanceId, runtime);
        this.notifyCrash(entry.instanceId, runtime, false);
      } else if (entry.status === "STOPPING") {
        const runtime = getRuntime(entry.instanceId);
        runtime.status = "STOPPED";
        runtime.exitCode = entry.exitCode;
        if (entry.cwd !== undefined) runtime.cwd = entry.cwd;
        appendLog(entry.instanceId, runtime, "system", "Daemon restarted; stopping instance marked as STOPPED.");
        emitStatus(entry.instanceId, runtime);
      } else {
        const runtime = getRuntime(entry.instanceId);
        runtime.status = entry.status as InstanceStatus;
        runtime.exitCode = entry.exitCode;
        if (entry.cwd !== undefined) runtime.cwd = entry.cwd;
        runtime.restartAttempts = entry.restartAttempts;
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistNow();
  }

  private clearRestartTimer(runtime: RuntimeState): void {
    if (runtime.restartTimer) {
      clearTimeout(runtime.restartTimer);
      delete runtime.restartTimer;
    }
  }

  private wouldRestartByPolicy(runtime: RuntimeState, instanceId: string, exitCode: number | null): boolean {
    const spec = runtime.restartSpec;
    const policy = spec?.restartPolicy ?? "never";
    if (!spec || runtime.stopping || policy === "never") return false;
    if (policy === "on_failure" && exitCode === 0) return false;

    const maxRetries = Math.max(0, spec.restartMaxRetries ?? 0);
    if (maxRetries === 0) return false;
    return runtime.restartAttempts < maxRetries;
  }

  private shouldRestart(runtime: RuntimeState, instanceId: string, exitCode: number | null): boolean {
    if (isRestartSuppressed(instanceId)) return false;
    return this.wouldRestartByPolicy(runtime, instanceId, exitCode);
  }

  listSnapshots(): Array<{ instanceId: string; status: InstanceStatus; exitCode: number | null }> {
    const snapshots: Array<{ instanceId: string; status: InstanceStatus; exitCode: number | null }> = [];
    for (const [instanceId, runtime] of runtimes) {
      snapshots.push({
        instanceId,
        status: runtime.status,
        exitCode: runtime.exitCode ?? null
      });
    }
    return snapshots;
  }

  recentLogs(instanceId: string, limit = 40): InstanceLogLine[] {
    const runtime = runtimes.get(instanceId);
    if (!runtime) return [];
    return runtime.logs.slice(-Math.max(1, Math.min(limit, 200)));
  }

  private notifyCrash(instanceId: string, runtime: RuntimeState, willRetryByPolicy: boolean): void {
    if (!instanceStatusPushHandler || runtime.status !== "CRASHED") return;
    void instanceStatusPushHandler({
      instanceId,
      status: runtime.status,
      exitCode: runtime.exitCode ?? null,
      logTail: runtime.logs.slice(-40),
      restartPolicy: runtime.restartSpec?.restartPolicy ?? "never",
      restartAttempts: runtime.restartAttempts,
      willRetryByPolicy
    })
      .then((response) => {
        if (response?.suppressRestartUntil) {
          applyRestartLease(instanceId, response.suppressRestartUntil);
        }
      })
      .catch((error) => {
        appendLog(
          instanceId,
          runtime,
          "system",
          `Failed to notify panel of crash: ${error instanceof Error ? error.message : "unknown error"}`
        );
      });
  }

  private async startInternal(spec: DaemonInstanceSpec, resetRestartAttempts: boolean): Promise<DaemonInstanceState> {
    instanceSpecs.set(spec.id, spec);
    const runtime = getRuntime(spec.id);
    if (runtime.child && !runtimeChildExited(runtime.child) && runtime.status === "RUNNING") {
      appendLog(spec.id, runtime, "system", "Start requested while instance is already running.");
      return this.state(spec.id);
    }

    this.clearRestartTimer(runtime);
    if (resetRestartAttempts) {
      runtime.restartAttempts = 0;
    }

    const cwd = await ensureInsideWorkspace(spec.workingDirectory);
    await fs.mkdir(cwd, { recursive: true });
    assertCommandAllowed(spec.startCommand);

    let runtimeSpec = spec;
    if (spec.proxy?.enabled && spec.proxy.mode === "subscription") {
      const clash = await ensureInstanceClashProxy(spec.proxy, spec.id);
      runtimeSpec = {
        ...spec,
        proxy: {
          ...spec.proxy,
          type: "http",
          server: "127.0.0.1",
          port: clash.port
        }
      };
      instanceSpecs.set(spec.id, runtimeSpec);
    } else {
      await stopInstanceClash(spec.id);
    }

    runtime.status = "STARTING";
    runtime.exitCode = null;
    runtime.cwd = cwd;
    runtime.stopping = false;
    runtime.restartSpec = runtimeSpec;
    emitStatus(spec.id, runtime);
    appendLog(spec.id, runtime, "system", `Starting: ${spec.startCommand}`);
    if (runtimeSpec.proxy?.enabled && runtimeSpec.proxy.server && runtimeSpec.proxy.port) {
      const nodeLabel =
        runtimeSpec.proxy.mode === "subscription" && runtimeSpec.proxy.selectedProxy
          ? `Clash 节点 ${runtimeSpec.proxy.selectedProxy} → `
          : "";
      appendLog(
        spec.id,
        runtime,
        "system",
        `[Network Proxy] 代理已生效: ${nodeLabel}${runtimeSpec.proxy.type}://${runtimeSpec.proxy.server}:${runtimeSpec.proxy.port}`
      );
    }

    const launcher = commandLauncher(spec.startCommand);
    const handleProcessError = (error: Error) => {
      runtime.status = "CRASHED";
      runtime.exitCode = null;
      emitStatus(spec.id, runtime);
      appendLog(spec.id, runtime, `system`, `Process error: ${error.message}`);
      this.notifyCrash(spec.id, runtime, this.wouldRestartByPolicy(runtime, spec.id, null));
    };

    let child: RuntimeChild;
    try {
      child = startPtyRuntimeChild(launcher, cwd, runtimeSpec, (text) => {
        runtimeEvents.emit(`data:${spec.id}`, text);
        appendLog(spec.id, runtime, "stdout", text);
      });
    } catch (error) {
      appendLog(
        spec.id,
        runtime,
        "system",
        `PTY launch failed, falling back to pipe mode: ${error instanceof Error ? error.message : "unknown error"}`
      );
      child = startProcessRuntimeChild(
        launcher,
        cwd,
        runtimeSpec,
        (chunk) => {
          const text = decodeProcessOutput(chunk);
          runtimeEvents.emit(`data:${spec.id}`, text);
          appendLog(spec.id, runtime, "stdout", text);
        },
        (chunk) => {
          const text = decodeProcessOutput(chunk);
          runtimeEvents.emit(`data:${spec.id}`, text);
          appendLog(spec.id, runtime, "stderr", text);
        },
        handleProcessError
      );
    }

    runtime.child = child;
    runtime.status = "RUNNING";
    emitStatus(spec.id, runtime);
    appendLog(spec.id, runtime, "system", `Process started in ${child.type === "pty" ? "PTY" : "pipe"} mode with pid ${runtimeChildPid(child) ?? "unknown"}.`);

    onRuntimeChildExit(child, ({ code, signal }) => {
      if (runtime.child !== child) return;
      disposeRuntimeChild(child);
      runtime.child = null;
      runtime.exitCode = code;
      runtime.status = runtime.stopping || code === 0 ? "STOPPED" : "CRASHED";
      emitStatus(spec.id, runtime);
      appendLog(
        spec.id,
        runtime,
        "system",
        `Process exited with code ${code ?? "null"}${signal ? ` and signal ${signal}` : ""}.`
      );
      const crashed = runtime.status === "CRASHED";
      const willRetryByPolicy = this.wouldRestartByPolicy(runtime, spec.id, code);
      const scheduleRestartIfAllowed = () => {
        if (!this.shouldRestart(runtime, spec.id, code)) return;
        runtime.restartAttempts += 1;
        const attempt = runtime.restartAttempts;
        appendLog(
          spec.id,
          runtime,
          "system",
          `Restart policy ${runtime.restartSpec?.restartPolicy ?? "never"} scheduling restart attempt ${attempt}.`
        );
        runtime.restartTimer = setTimeout(() => {
          const restartSpec = runtime.restartSpec;
          if (!restartSpec) return;
          void this.startInternal(restartSpec, false).catch((error) => {
            appendLog(spec.id, runtime, "system", `Automatic restart failed: ${error.message}`);
          });
        }, 2000);
      };
      if (crashed && instanceStatusPushHandler) {
        void instanceStatusPushHandler({
          instanceId: spec.id,
          status: runtime.status,
          exitCode: code,
          logTail: runtime.logs.slice(-40),
          restartPolicy: runtime.restartSpec?.restartPolicy ?? "never",
          restartAttempts: runtime.restartAttempts,
          willRetryByPolicy
        })
          .then((response) => {
            if (response?.suppressRestartUntil) {
              applyRestartLease(spec.id, response.suppressRestartUntil);
              appendLog(spec.id, runtime, "system", "Panel watch is inspecting this crash; automatic restart is paused.");
            }
            scheduleRestartIfAllowed();
          })
          .catch((error) => {
            appendLog(
              spec.id,
              runtime,
              "system",
              `Failed to notify panel of crash: ${error instanceof Error ? error.message : "unknown error"}`
            );
            scheduleRestartIfAllowed();
          });
      } else {
        scheduleRestartIfAllowed();
      }
      runtime.stopping = false;
    });

    return this.state(spec.id);
  }

  async start(spec: DaemonInstanceSpec): Promise<DaemonInstanceState> {
    return this.startInternal(spec, true);
  }

  async stop(spec: { id: string; stopCommand?: string | null | undefined }): Promise<DaemonInstanceState> {
    const runtime = getRuntime(spec.id);
    if (!runtime.child || runtime.status !== "RUNNING") {
      runtime.status = runtime.status === "CREATED" ? "STOPPED" : runtime.status;
      emitStatus(spec.id, runtime);
      appendLog(spec.id, runtime, "system", "Stop requested while instance is not running.");
      return this.state(spec.id);
    }

    runtime.status = "STOPPING";
    runtime.stopping = true;
    this.clearRestartTimer(runtime);
    emitStatus(spec.id, runtime);
    appendLog(spec.id, runtime, "system", "Stopping instance.");

    const stopCommand = spec.stopCommand;
    if (stopCommand && runtime.cwd) {
      appendLog(spec.id, runtime, "system", `Running stop command: ${stopCommand}`);
      assertCommandAllowed(stopCommand);
      await new Promise<void>((resolve) => {
        const launcher = commandLauncher(stopCommand);
        const stopper = spawn(launcher.file, launcher.args, {
          cwd: runtime.cwd,
          env: commandEnvironment(),
          windowsHide: true
        });
        stopper.stdout?.on("data", (chunk: Buffer) => appendLog(spec.id, runtime, "stdout", decodeProcessOutput(chunk)));
        stopper.stderr?.on("data", (chunk: Buffer) => appendLog(spec.id, runtime, "stderr", decodeProcessOutput(chunk)));
        stopper.once("exit", () => resolve());
        stopper.once("error", (error: Error) => {
          appendLog(spec.id, runtime, "system", `Stop command error: ${error.message}`);
          resolve();
        });
      });
      await waitForExit(runtime, 3000);
    }

    if (runtime.child) {
      const child = runtime.child;
      await signalProcessTree(child, "SIGTERM", false, (message) => appendLog(spec.id, runtime, "system", message));
      await waitForExit(runtime, 3000);
    }

    if (runtime.child) {
      const child = runtime.child;
      await signalProcessTree(child, "SIGKILL", true, (message) => appendLog(spec.id, runtime, "system", message));
      await waitForExit(runtime, 1000);
    }

    return this.state(spec.id);
  }

  async kill(instanceId: string): Promise<DaemonInstanceState> {
    const runtime = getRuntime(instanceId);
    if (!runtime.child) {
      appendLog(instanceId, runtime, "system", "Kill requested while instance is not running.");
      return this.state(instanceId);
    }

    runtime.status = "STOPPING";
    runtime.stopping = true;
    this.clearRestartTimer(runtime);
    emitStatus(instanceId, runtime);
    appendLog(instanceId, runtime, "system", "Force killing instance.");
    await signalProcessTree(runtime.child, "SIGKILL", true, (message) => appendLog(instanceId, runtime, "system", message));
    await waitForExit(runtime, 1000);
    if (runtime.child) {
      appendLog(instanceId, runtime, "system", "Force kill signal was sent, but the process has not exited yet.");
    }
    return this.state(instanceId);
  }

  async restart(spec: DaemonInstanceSpec): Promise<DaemonInstanceState> {
    await this.stop({ id: spec.id, stopCommand: spec.stopCommand });
    return this.start(spec);
  }

  state(instanceId: string): DaemonInstanceState {
    const runtime = getRuntime(instanceId);
    return {
      instanceId,
      status: runtime.status,
      exitCode: runtime.exitCode ?? null,
      logs: runtime.logs
    };
  }

  async interrupt(instanceId: string): Promise<DaemonInstanceState> {
    const runtime = getRuntime(instanceId);
    if (!runtime.child || runtime.status !== "RUNNING") {
      appendLog(instanceId, runtime, "system", "Interrupt requested while instance is not running.");
      throw new Error("Instance is not accepting terminal input");
    }

    runtime.status = "STOPPING";
    runtime.stopping = true;
    this.clearRestartTimer(runtime);
    emitStatus(instanceId, runtime);
    appendLog(instanceId, runtime, "stdin", "^C");
    appendLog(instanceId, runtime, "system", "Sending interrupt signal.");
    if (runtime.child.type === "pty") {
      runtime.child.pty.write("\u0003");
    } else {
      await signalProcessTree(runtime.child, "SIGINT", false, (message) => appendLog(instanceId, runtime, "system", message));
    }
    let exited = await waitForExit(runtime, 5000);

    if (!exited && runtime.child && process.platform === "win32") {
      appendLog(instanceId, runtime, "system", "Interrupt did not stop the process tree; forcing it on Windows.");
      await signalProcessTree(runtime.child, "SIGKILL", true, (message) => appendLog(instanceId, runtime, "system", message));
      exited = await waitForExit(runtime, 1000);
    }

    if (!exited && runtime.child) {
      runtime.status = "RUNNING";
      runtime.stopping = false;
      emitStatus(instanceId, runtime);
      appendLog(instanceId, runtime, "system", "Interrupt signal was sent, but the process is still running.");
    }

    return this.state(instanceId);
  }

  async writeInput(
    instanceId: string,
    data: string,
    options: { logInput?: boolean } = {}
  ): Promise<DaemonInstanceState> {
    validateTerminalInput(data);

    const runtime = getRuntime(instanceId);
    if (!runtime.child || runtime.status !== "RUNNING" || !runtimeChildCanWrite(runtime.child)) {
      appendLog(instanceId, runtime, "system", "Terminal input rejected because the instance is not running.");
      throw new Error("Instance is not accepting terminal input");
    }

    writeRuntimeChild(runtime.child, data);
    const visibleInput = data.replace(/\r/g, "").replace(/\n$/, "");
    if (options.logInput !== false && visibleInput.length > 0 && !data.startsWith("\x1b")) {
      appendLog(instanceId, runtime, "stdin", visibleInput);
    }
    return this.state(instanceId);
  }

  resize(instanceId: string, cols: number, rows: number): void {
    const runtime = getRuntime(instanceId);
    if (runtime.child && runtime.child.type === "pty") {
      try {
        const safeCols = Math.max(10, Math.min(cols, 500));
        const safeRows = Math.max(5, Math.min(rows, 200));
        runtime.child.pty.resize?.(safeCols, safeRows);
      } catch {}
    }
  }

  resizeShell(instanceId: string, sessionId: string, cols: number, rows: number): void {
    const session = shellSessions.get(sessionId);
    if (session && !session.exited) {
      try {
        const safeCols = Math.max(10, Math.min(cols, 500));
        const safeRows = Math.max(5, Math.min(rows, 200));
        session.pty.resize?.(safeCols, safeRows);
      } catch {}
    }
  }

  registerSpec(spec: DaemonInstanceSpec): void {
    instanceSpecs.set(spec.id, spec);
  }

  async createShell(instanceId: string): Promise<{ sessionId: string }> {
    const spec = instanceSpecs.get(instanceId);
    if (!spec) {
      throw new Error("Instance spec not found. Start or register the instance first.");
    }
    const cwd = await ensureInsideWorkspace(spec.workingDirectory);
    await fs.mkdir(cwd, { recursive: true });
    const session = createInteractiveShellPty(instanceId, cwd);
    return { sessionId: session.id };
  }

  writeShellInput(instanceId: string, sessionId: string, data: string): void {
    validateTerminalInput(data);
    writeToShell(sessionId, data);
  }

  subscribeShell(
    sessionId: string,
    handlers: { onData?: (text: string) => void; onExit?: RuntimeExitListener }
  ): () => void {
    return subscribeToShell(sessionId, handlers);
  }

  closeShell(sessionId: string): void {
    closeShellSession(sessionId);
  }

  listShells(instanceId: string): string[] {
    const result: string[] = [];
    for (const [sid, sess] of shellSessions.entries()) {
      if (sess.instanceId === instanceId && !sess.exited) {
        result.push(sid);
      }
    }
    return result;
  }

  async runCommand(
    instanceId: string,
    command: string,
    options: { workingDirectory?: string; timeoutMs?: number; input?: string } = {}
  ): Promise<InstanceCommandResponse> {
    const runtime = getRuntime(instanceId);
    assertCommandAllowed(command);
    if (typeof options.input === "string") validateCommandInput(options.input);
    const cwd = await ensureInsideWorkspace(options.workingDirectory || runtime.cwd || ".");
    const timeoutMs = Math.max(1000, Math.min(Math.floor(options.timeoutMs ?? 30000), 120000));
    await fs.mkdir(cwd, { recursive: true });

    appendLog(instanceId, runtime, "system", `Agent command cwd: ${cwd}`);
    appendLog(instanceId, runtime, "stdin", `$ ${command}`);
    if (typeof options.input === "string") {
      appendLog(instanceId, runtime, "system", `Agent command stdin: ${options.input.length} chars supplied.`);
    }

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const spec = instanceSpecs.get(instanceId);
      const launcher = commandLauncher(command);
      const child = spawn(launcher.file, launcher.args, {
        cwd,
        env: commandEnvironment(spec),
        windowsHide: true
      });
      child.stdin?.on("error", (error) => {
        appendLog(instanceId, runtime, "system", `Agent command stdin failed: ${error instanceof Error ? error.message : "unknown error"}`);
      });
      child.stdin?.end(typeof options.input === "string" ? options.input : undefined);

      const timer = setTimeout(() => {
        timedOut = true;
        appendLog(instanceId, runtime, "system", `Agent command timed out after ${timeoutMs}ms; stopping it.`);
        void signalProcessTree({ type: "process", process: child }, "SIGKILL", true, (message) => appendLog(instanceId, runtime, "system", message)).catch((error) => {
          appendLog(instanceId, runtime, "system", `Agent command kill failed: ${error instanceof Error ? error.message : "unknown error"}`);
        });
      }, timeoutMs);

      function finish(exitCode: number | null, signal: NodeJS.Signals | string | null): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          command,
          workingDirectory: cwd,
          exitCode,
          signal: timedOut ? "TIMEOUT" : signal,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt
        });
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = decodeProcessOutput(chunk);
        stdout = appendCapturedText(stdout, text);
        appendLog(instanceId, runtime, "stdout", text);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = decodeProcessOutput(chunk);
        stderr = appendCapturedText(stderr, text);
        appendLog(instanceId, runtime, "stderr", text);
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        appendLog(instanceId, runtime, "system", `Agent command exited with code ${code ?? "null"}${signal ? ` and signal ${signal}` : ""}.`);
        finish(code, signal);
      });
    });
  }

  subscribe(
    instanceId: string,
    handlers: {
      onLog?: (line: InstanceLogLine) => void;
      onData?: (text: string) => void;
      onStatus?: (state: Omit<DaemonInstanceState, "logs">) => void;
    }
  ): () => void {
    const logEvent = `log:${instanceId}`;
    const dataEvent = `data:${instanceId}`;
    const statusEvent = `status:${instanceId}`;
    if (handlers.onLog) runtimeEvents.on(logEvent, handlers.onLog);
    if (handlers.onData) runtimeEvents.on(dataEvent, handlers.onData);
    if (handlers.onStatus) runtimeEvents.on(statusEvent, handlers.onStatus);
    return () => {
      if (handlers.onLog) runtimeEvents.off(logEvent, handlers.onLog);
      if (handlers.onData) runtimeEvents.off(dataEvent, handlers.onData);
      if (handlers.onStatus) runtimeEvents.off(statusEvent, handlers.onStatus);
    };
  }
}

export const instanceManager = new InstanceManager();
