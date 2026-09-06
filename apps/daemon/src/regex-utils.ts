// ReDoS prevention: validate user-supplied regex before compiling it.
// We don't have a proper JS regex AST here, so the checks are conservative:
//   - hard length cap
//   - reject nested quantifiers that are the classic ReDoS vector
//     (a+)+, (a*)*, (a+)*, (a*)+, ([...]+)+ etc.
//   - reject overly long runs of identical characters with trailing quantifiers
// Accepts the same strings passed to `new RegExp()`.

import { DaemonErrorCode, throwDaemonError } from "./errors.js";

const MAX_PATTERN_LENGTH = 512;

function hasNestedQuantifiers(pattern: string): boolean {
  // Strip escaped chars and character classes so our paren scan is honest.
  const simplified = pattern
    .replace(/\\./g, "x")
    .replace(/\[[^\]]*\]/g, "c");

  // Find each (group) and check if its immediately-following token is a quantifier.
  // We keep a simple stack for balanced parens.
  const stack: number[] = []; // start indices of open groups
  // Walk through simplified looking for `)<quantifier>` where quantifier is *,+,?, or {n,m}
  const quantifier = /^[*+?]|\{\d+,?\d*\}/;
  let i = 0;
  while (i < simplified.length) {
    const ch = simplified[i];
    if (ch === "(") {
      stack.push(i);
      i++;
      continue;
    }
    if (ch === ")") {
      const open = stack.pop();
      if (open === undefined) { i++; continue; }
      // Check what follows this group
      const after = simplified.slice(i + 1);
      const m = after.match(quantifier);
      if (m) {
        // Group has a quantifier. Now check recursively whether any substring INSIDE the group
        // has a trailing quantifier too — the classic nested case.
        const inside = simplified.slice(open + 1, i);
        if (/[*+?]|\{\d+,?\d*\}/.test(inside)) {
          return true;
        }
      }
      i++;
      continue;
    }
    i++;
  }
  return false;
}

function hasLongCharRunWithQuantifier(pattern: string): boolean {
  // 6+ of the same character followed by a quantifier — typical ReDoS trigger.
  return /(.)\1{5,}[*+?]/.test(pattern);
}

export function assertSafeRegex(pattern: string, flags: string): void {
  if (typeof pattern !== "string") {
    throwDaemonError(DaemonErrorCode.REGEX_REJECTED, "Regex pattern must be a string.");
  }
  if (pattern.length === 0) {
    throwDaemonError(DaemonErrorCode.REGEX_REJECTED, "Regex pattern must not be empty.");
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throwDaemonError(
      DaemonErrorCode.REGEX_REJECTED,
      `Regex pattern is too long (${pattern.length} > ${MAX_PATTERN_LENGTH}).`,
      "Shorten the pattern or narrow your search scope."
    );
  }
  if (hasNestedQuantifiers(pattern)) {
    throwDaemonError(
      DaemonErrorCode.REGEX_REJECTED,
      "Regex pattern appears to use nested quantifiers (ReDoS risk).",
      "Rewrite without groups followed by * + ? quantifiers."
    );
  }
  if (hasLongCharRunWithQuantifier(pattern)) {
    throwDaemonError(
      DaemonErrorCode.REGEX_REJECTED,
      "Regex pattern contains a long repeated character run followed by a quantifier (ReDoS risk)."
    );
  }
  // Try compiling to surface early syntax errors.
  try {
    const re = new RegExp(pattern, flags);
    re.test("");
  } catch (err) {
    throwDaemonError(
      DaemonErrorCode.REGEX_REJECTED,
      `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
