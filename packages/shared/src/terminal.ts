export type AgentShellKind = "powershell" | "cmd" | "posix";

/** Quote one literal argument; file names must never become shell instructions. */
export function quoteAgentShellArgument(kind: AgentShellKind, value: string): string {
  if (/[\x00\r\n]/.test(value)) throw new Error("Shell arguments cannot contain NUL or newlines.");
  if (kind === "powershell") return `'${value.replace(/'/g, "''")}'`;
  if (kind === "posix") return `'${value.replace(/'/g, "'\\''")}'`;
  if (/["%!]/.test(value)) throw new Error("This argument requires a PowerShell terminal.");
  return `"${value}"`;
}

/** Reset cwd before the entire command, including when a terminal is reused. */
export function wrapSakiCommandWithCwd(kind: AgentShellKind, directory: string, command: string): string {
  if (kind === "cmd") {
    if (/["%!\r\n]/.test(directory)) throw new Error("This workspace path requires a PowerShell terminal.");
    return `cd /d "${directory}" && (${command}\n)`;
  }
  if (kind === "powershell") {
    return `$global:LASTEXITCODE = $null; & { Set-Location -LiteralPath '${directory.replace(/'/g, "''")}' -ErrorAction Stop; ${command}\n}`;
  }
  return `cd '${directory.replace(/'/g, "'\\''")}' && { ${command}\n}`;
}
