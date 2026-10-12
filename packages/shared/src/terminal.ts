export type AgentShellKind = "powershell" | "cmd" | "posix";

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
