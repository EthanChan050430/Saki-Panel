import path from "node:path";

/** Protect credential files rather than every source filename mentioning tokens or secrets. */
export function isSensitiveWorkspacePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  if (normalized.split("/").some(part => [".git", ".ssh", ".aws", ".azure"].includes(part))) return true;
  const name = normalized.split("/").pop() ?? "";
  if (/^\.env\.(?:example|sample|template)$/.test(name)) return false;
  return [
    /(^|\/)\.env(?:\.|$)/,
    /(^|\/)(?:\.npmrc|\.netrc|id_rsa|id_ed25519)(?:$|\/)/,
    /(^|\/)(?:tokens?|secrets?|credentials?|private[_-]?keys?)(?:$|\/|(?:[._-][^/]*)?\.(?:json|ya?ml|toml|ini|conf|txt)$)/,
    /\.(?:pem|key|pfx)$/
  ].some(pattern => pattern.test(normalized));
}

/** Compare remote paths using the workspace OS, rather than the panel host OS. */
export function isAbsolutePathInsideWorkspace(value: string, workingDirectory?: string): boolean {
  if (!workingDirectory) return false;
  const windows = /^[A-Za-z]:[\\/]/.test(workingDirectory) || workingDirectory.startsWith("\\\\");
  const paths = windows ? path.win32 : path.posix;
  if (!paths.isAbsolute(workingDirectory) || !paths.isAbsolute(value)) return false;
  if (!windows && value.includes("\\")) return false;
  if (/[`$*?\[\]{}~]/.test(value)) return false;
  const relative = paths.relative(paths.resolve(workingDirectory), paths.resolve(value));
  return !paths.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${paths.sep}`);
}
