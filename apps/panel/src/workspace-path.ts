import path from "node:path";

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
