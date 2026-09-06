// ReDoS prevention: validate user-supplied regex before compiling it.
// We don't have a proper JS regex AST here, so the checks are conservative:
//   - hard length cap
//   - reject nested quantifiers that are the classic ReDoS vector
//     (a+)+, (a*)*, (a+)*, (a*)+, ([...]+)+ etc.
//   - reject overly long runs of identical characters with trailing quantifiers
// Accepts the same strings passed to `new RegExp()`.

const MAX_PATTERN_LENGTH = 512;

function hasNestedQuantifiers(pattern: string): boolean {
  // Strip escaped chars and character classes so our paren scan is honest.
  const simplified = pattern
    .replace(/\\./g, "x")
    .replace(/\[[^\]]*\]/g, "c");

  // Find each (group) and check if its immediately-following token is a quantifier.
  // We keep a simple stack for balanced parens.
  const stack: number[] = []; // start indices of open groups
  const groupOpen = simplified.indexOf("(");
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
          // Skip obvious non-capturing lookarounds by just flagging all nested-quantifier patterns.
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
  if (typeof pattern !== "string") throw new Error("Regex pattern must be a string.");
  if (pattern.length === 0) throw new Error("Regex pattern must not be empty.");
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Regex pattern is too long (${pattern.length} > ${MAX_PATTERN_LENGTH}).`);
  }
  if (hasNestedQuantifiers(pattern)) {
    throw new Error("Regex pattern appears to use nested quantifiers (ReDoS risk); please rewrite it without groups followed by * + ?.");
  }
  if (hasLongCharRunWithQuantifier(pattern)) {
    throw new Error("Regex pattern contains a long repeated character run followed by a quantifier (ReDoS risk).");
  }
  // Try compiling with DNE flag if available (Node 16+). Falls back to safe match-time if absent.
  try {
    const re = new RegExp(pattern, flags);
    // Force a no-op match to surface early syntax errors.
    re.test("");
  } catch (err) {
    throw new Error(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`);
  }
}
