import path from "node:path";
import { wrapSakiCommandWithCwd, type AgentShellKind } from "@webops/shared";

export function resolveShellCommandCwd(workspaceRoot: string, root: string, relativeCwd = ""): string {
  const parts = relativeCwd.replace(/\\/g, "/").split("/");
  if (/^[\\/]/.test(relativeCwd) || path.isAbsolute(relativeCwd) || /^[A-Za-z]:/.test(relativeCwd) || parts.includes("..") || /[\0\r\n]/.test(relativeCwd)) {
    throw new Error("Terminal cwd must be relative to the instance workspace.");
  }
  return path.resolve(workspaceRoot, root, ...parts.filter(Boolean));
}

export function stripTerminalText(value: string): string {
  return value
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[PX^_][\s\S]*?\u001b\\/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F]/g, "");
}

/** One complete record, including its terminator, is required across PTY chunks. */
export function parseShellMarker(captured: string, marker: string): { exitCode: number; stdout: string } | null {
  const plain = stripTerminalText(captured).replace(/\r/g, "");
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}:(-?\\d+):END\\n`).exec(plain);
  if (!match) return null;
  const exitCode = Number(match[1]);
  if (!Number.isSafeInteger(exitCode)) return null;
  const before = plain.slice(0, match.index);
  const start = new RegExp(`(?:^|\\n)${escaped}:BEGIN\\n`).exec(before);
  // Strip the submitted command's echo, especially long PowerShell base64 lines.
  // A large output may have evicted BEGIN from the bounded capture buffer.
  return { exitCode, stdout: before.slice(start ? start.index + start[0].length : 0).trim() };
}

/** PowerShell's interactive editor must receive a single physical input line. */
export function shellCommandSubmission(kind: AgentShellKind, cwd: string, command: string, marker: string): string {
  // Capture cmdlet status inside the script block: invoking an outer block can
  // otherwise reset $? to true after a non-terminating error such as Write-Error.
  const body = kind === "powershell" ? `${command}\n$global:__saki_command_ok = $?` : command;
  const wrapped = wrapSakiCommandWithCwd(kind, cwd, body);
  if (kind === "powershell") {
    const encoded = Buffer.from(wrapped, "utf8").toString("base64");
    return `Write-Host (\"\x60n\" + '${marker}:BEGIN'); $global:LASTEXITCODE = $null; $global:__saki_command_ok = $false; try { & ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))); $__saki_exit = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($global:__saki_command_ok) { 0 } else { 1 } } catch { Write-Error $_; $__saki_exit = 1 }; Write-Host (\"\x60n\" + '${marker}:' + $__saki_exit + ':END')\r`;
  }
  if (kind === "cmd") {
    return `echo. & echo ${marker}:BEGIN\r${wrapped.replace(/\r?\n/g, "\r")}\recho. & echo ${marker}:%ERRORLEVEL%:END\r`;
  }
  const quoted = `'${wrapped.replace(/'/g, "'\\''")}'`;
  return `printf '\\n%s:BEGIN\\n' '${marker}'; eval ${quoted}; __saki_exit=$?; printf '\\n%s:%s:END\\n' '${marker}' "$__saki_exit"\n`;
}
