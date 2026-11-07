import path from "node:path";
import { quoteAgentShellArgument } from "@webops/shared";
import { classifyCommandRisk, literalPosixReadSegments } from "../../command-policy.js";
import { findCrossInstanceCommandEscape } from "../../security.js";
import { isAbsolutePathInsideWorkspace, isSensitiveWorkspacePath } from "../../workspace-path.js";
import { normalizeCommandRelativeCwd } from "./types.js";

const readUtilities = new Set(["cat", "cut", "grep", "head", "ls", "pwd", "sed", "stat", "tail", "wc"]);
const parentPath = /(?:^|\/)\.\.(?:\/|$)/;
const quote = (value: string) => quoteAgentShellArgument("posix", value);

/** A literal read can use '..' only when both lexical and execution-time checks agree. */
export function guardedWorkspaceRead(command: string, root: string | undefined, posix: boolean, cwd = "") {
  if (!posix || !root?.startsWith("/") || /[\u0000-\u001f\u007f]/.test(root) || !parentPath.test(command.replace(/["' \t]/g, "/"))) return null;
  if (classifyCommandRisk(command, root, true).risk === "critical") return null;
  const segments = literalPosixReadSegments(command);
  if (!segments) return null;
  const relativeCwd = normalizeCommandRelativeCwd(cwd, root);
  const inside = (value: string) => isAbsolutePathInsideWorkspace(value, root)
    && !isSensitiveWorkspacePath(path.posix.relative(root, value));
  let directory = path.posix.resolve(root, relativeCwd);
  if (!inside(directory)) return null;
  const relative = (value: string) => path.posix.relative(root, value) || ".";
  const setup = [`__saki_cd ${quote(directory)} ${quote(relative(directory))} || exit 126`];
  const review: string[] = [];
  const reads: string[] = [];
  let hasParent = false;

  for (const { words, paths, separator, globs, discardStderr } of segments) {
    const [program, ...args] = words;
    if (program === "cd") {
      const operand = args.length === 2 && args[0] === "--" ? args[1] : args.length === 1 ? args[0] : undefined;
      if (reads.length || discardStderr || !operand || operand.startsWith("-") || /[\\`$*?\[\]{}~]/.test(operand) || separator === "|") return null;
      const destination = path.posix.resolve(directory, operand);
      if (!inside(destination)) return null;
      hasParent ||= parentPath.test(operand);
      setup.push(`__saki_cd ${quote(operand)} ${quote(relative(destination))} || exit 126`);
      directory = destination;
      continue;
    }
    if (!program || !readUtilities.has(program) || globs?.has(0)) return null;
    if (program === "grep" && args.some(arg => /^-[^-]*R|^--dereference-recursive(?:=|$)/.test(arg))) return null;
    const reviewed = [...words];
    const submitted: string[] = [];
    for (const [index, arg] of args.entries()) {
      const expand = globs?.has(index + 1) ?? false;
      if (!expand && (!paths.includes(arg) || !parentPath.test(arg))) {
        submitted.push(`set -- "$@" ${quote(arg)}`);
        continue;
      }
      // Option assignments and indistinguishable pattern/file arguments
      // cannot be rewritten without changing their meaning.
      if (!paths.includes(arg) || arg.startsWith("-") || /[:\\`$?\[\]{}~]/.test(arg) || args.indexOf(arg) !== args.lastIndexOf(arg)) return null;
      hasParent ||= parentPath.test(arg);
      if (expand) {
        const slash = arg.lastIndexOf("/", arg.indexOf("*"));
        const prefix = path.posix.resolve(directory, slash < 0 ? "." : arg.slice(0, slash + 1));
        const pattern = arg.slice(slash + 1);
        // Expand from a verified anchor. Each match is checked before the utility sees it.
        if (!inside(prefix) || !/^[\p{L}\p{N}_ ./\-\*]+$/u.test(pattern) || pattern.includes("**")
          || pattern.split("/").some(part => !part || part.startsWith("."))) return null;
        reviewed[index + 1] = path.posix.join(prefix, pattern);
        const glob = pattern.split("*").map(quote).join("*");
        submitted.push(
          `__saki_prefix=$(__saki_resolve ${quote(prefix)} ${quote(relative(prefix))}) || exit 126`,
          `for __saki_match in "\${__saki_prefix%/}"/${glob}; do`,
          '  __saki_file=$(__saki_glob_file "$__saki_match") || exit 126',
          '  set -- "$@" "$__saki_file"',
          "done"
        );
        continue;
      }
      if (arg.includes("*")) return null;
      const destination = path.posix.resolve(directory, arg);
      if (!inside(destination)) return null;
      reviewed[index + 1] = destination;
      submitted.push(
        `__saki_file=$(__saki_resolve ${quote(arg)} ${quote(relative(destination))}) || exit 126`,
        'set -- "$@" "$__saki_file"'
      );
    }
    review.push(reviewed.map(quote).join(" "), separator ?? "");
    reads.push(["(", "set --", ...submitted, `command -p ${quote(program)} "$@"${discardStderr ? " 2>/dev/null" : ""}`, ")"].join("\n"), separator ?? "");
  }

  if (!hasParent) return null;
  const reviewedCommand = review.join(" ").trim();
  if (reviewedCommand && findCrossInstanceCommandEscape(reviewedCommand, root, true)) return null;
  const risk = reviewedCommand ? classifyCommandRisk(reviewedCommand, root, true) : classifyCommandRisk("pwd", root, true);
  if (!risk.readOnly || risk.risk !== "low") return null;

  // Validate physical paths on the execution host. Passing canonical file
  // operands to the utilities avoids reinterpreting '..' through a symlink.
  const guarded = [
    "(",
    `__saki_root=$(command -p realpath -e -- ${quote(root)}) || exit 126`,
    "__saki_resolve() {",
    '  __saki_actual=$(command -p realpath -e -- "$1") || return 126',
    '  __saki_expected=${__saki_root%/}/$2',
    '  if [ "$2" = "." ]; then __saki_expected=$__saki_root; fi',
    '  if [ "$__saki_actual" != "$__saki_expected" ]; then',
    "    printf '%s\\n' 'Workspace path resolves outside its verified location.' >&2",
    "    return 126",
    "  fi",
    '  printf \'%s\\n\' "$__saki_actual"',
    "}",
    '__saki_cd() { __saki_dir=$(__saki_resolve "$1" "$2") && command cd -P -- "$__saki_dir"; }',
    ...(segments.some(segment => segment.globs?.size) ? [
      "__saki_glob_file() {",
      '  [ -f "$1" ] || return 126',
      '  __saki_rel=${1#"$__saki_root"/}',
      '  case "/$__saki_rel/" in */.*/*|*/[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll][Ss]*/*|*/[Ss][Ee][Cc][Rr][Ee][Tt]*/*|*/[Tt][Oo][Kk][Ee][Nn]*/*|*/[Pp][Rr][Ii][Vv][Aa][Tt][Ee]*/*|*/[Ii][Dd]_[Rr][Ss][Aa]/*|*/[Ii][Dd]_[Ee][Dd]25519/*|*.[Pp][Ee][Mm]/*|*.[Kk][Ee][Yy]/*|*.[Pp][Ff][Xx]/*) return 126;; esac',
      '  __saki_resolve "$1" "$__saki_rel"',
      "}"
    ] : []),
    ...setup,
    ...(reads.length ? [reads.join(" ").trim()] : []),
    ")"
  ].join("\n");
  return guarded.length <= 4000 ? { command: guarded, risk } : null;
}

export function classifyWorkspaceCommand(command: string, root: string | undefined, posix: boolean, cwd = "") {
  return guardedWorkspaceRead(command, root, posix, cwd)?.risk ?? classifyCommandRisk(command, root, posix);
}
