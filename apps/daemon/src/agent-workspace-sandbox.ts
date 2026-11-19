import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { commandExecutionBlockReason } from "@webops/shared/command-policy";
import type { InstanceCommandResponse } from "@webops/shared";

function contained(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

interface SandboxRequest {
  command: string;
  workingDirectory: string;
  cwd?: string;
  input?: string;
  readOnly?: boolean;
  timeoutMs?: number;
}

export async function buildWorkspaceSandbox(request: SandboxRequest, signal?: AbortSignal): Promise<{ file: string; args: string[] }> {
  if (process.platform !== "linux" || process.env.DAEMON_AGENT_SANDBOX !== "1") {
    throw new Error("AGENT_SANDBOX_UNAVAILABLE: Enable the Linux workspace sandbox on this daemon.");
  }
  const command = request.command.trim();
  const blocked = commandExecutionBlockReason(command, request.workingDirectory, true);
  if (blocked) throw new Error(blocked);
  const binary = process.env.DAEMON_AGENT_SANDBOX_BIN?.trim() || "/usr/bin/bwrap";
  if (!path.isAbsolute(binary)) throw new Error("The bubblewrap executable must be an absolute path.");
  const roots = (process.env.DAEMON_AGENT_SANDBOX_ROOTS ?? "").split(path.delimiter).map(root => root.trim()).filter(path.isAbsolute);
  const allowedRoots = await Promise.all(roots.map(root => fs.realpath(root)));
  if (!path.isAbsolute(request.workingDirectory)) throw new Error("The isolated workspace must be absolute.");
  const workspace = await fs.realpath(request.workingDirectory);
  const systemRoots = ["/usr", "/bin", "/lib", "/lib64", "/etc", "/proc", "/sys", "/dev"];
  if (workspace === "/" || systemRoots.some(root => contained(root, workspace))
    || !allowedRoots.some(root => root !== "/" && contained(root, workspace))) {
    throw new Error("The project is outside the daemon's configured workspace sandbox roots.");
  }
  const cwd = request.cwd ?? "";
  if (path.isAbsolute(cwd) || /[\x00-\x1f\\]/.test(cwd) || cwd.split("/").includes("..")) throw new Error("Sandbox cwd must be a workspace subdirectory.");
  const resolvedCwd = await fs.realpath(path.join(workspace, cwd));
  if (!contained(workspace, resolvedCwd)) throw new Error("Sandbox cwd resolves outside the authorized workspace.");
  if (!(await fs.stat(resolvedCwd)).isDirectory()) throw new Error("Sandbox cwd must be a directory.");

  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp",
    "--setenv", "TMPDIR", "/tmp", "--setenv", "LANG", "C.UTF-8",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
  for (const runtimePath of ["/usr", "/bin", "/lib", "/lib64", "/etc/ld.so.cache"]) {
    const present = await fs.stat(runtimePath).then(() => true).catch(() => false);
    if (present) args.push("--ro-bind", runtimePath, runtimePath);
  }
  args.push(request.readOnly ? "--ro-bind" : "--bind", workspace, "/workspace",
    "--chdir", path.posix.join("/workspace", path.relative(workspace, resolvedCwd)), "--", "/bin/sh", "-c", command);
  signal?.throwIfAborted();
  return { file: binary, args };
}

export async function runWorkspaceSandbox(request: SandboxRequest, signal: AbortSignal): Promise<InstanceCommandResponse> {
  const spec = await buildWorkspaceSandbox(request, signal);
  const startedAt = Date.now();
  const timeout = Math.min(900000, Math.max(1000, Number.isFinite(request.timeoutMs) ? request.timeoutMs! : 30000));
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(spec.file, spec.args, { cwd: "/", detached: true, stdio: ["pipe", "pipe", "pipe"], env: {} });
    let stdout = "";
    let stderr = "";
    let reason: string | null = null;
    const kill = (cause: string) => {
      reason ??= cause;
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const abort = () => kill("ABORTED");
    const timer = setTimeout(() => kill("TIMEOUT"), timeout);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-80000); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-80000); });
    child.stdin.on("error", () => {});
    child.stdin.end(request.input?.slice(0, 100000));
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", (exitCode, processSignal) => {
      cleanup();
      resolve({ command: request.command, workingDirectory: request.workingDirectory, exitCode, signal: reason ?? processSignal,
        stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}
