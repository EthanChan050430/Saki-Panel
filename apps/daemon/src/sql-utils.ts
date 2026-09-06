// SQL helper functions shared across database engines.

import { DaemonErrorCode, throwDaemonError } from "./errors.js";

const ALLOWED_SQL_FUNCTIONS = new Set<string>([
  "current_timestamp",
  "current_date",
  "current_time",
  "now()",
  "uuid()",
  "gen_random_uuid()",
  "newid()",
  "rand()",
  "random()",
  "nextval",
  "sysdate",
  "localtime",
  "localtimestamp"
]);

function isAllowedFunction(expr: string): boolean {
  const normalized = expr.trim().toLowerCase();
  if (ALLOWED_SQL_FUNCTIONS.has(normalized)) return true;
  const match = normalized.match(/^([a-z_][a-z0-9_]*)\s*\(\s*\)$/);
  if (match && ALLOWED_SQL_FUNCTIONS.has(match[1]!)) return true;
  // nextval('seq') — validate the sequence name
  const nextvalMatch = normalized.match(/^nextval\s*\(\s*'([^']+)'\s*\)$/);
  if (nextvalMatch) {
    const seq = nextvalMatch[1]!;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seq)) return true;
  }
  return false;
}

// Escapes a DEFAULT value safely for DDL.
// - numeric / boolean types expect a literal (or a tiny whitelist of zero-arg SQL functions).
// - everything else is quoted as a SQL string literal.
export function escapeDefaultValue(raw: unknown, sqlType: string, dialect: "mysql" | "postgres" | "sqlite"): string {
  if (raw === null || raw === undefined) return "NULL";

  const upperType = (sqlType || "").toUpperCase();
  const isNumeric =
    upperType.includes("INT") ||
    upperType.includes("DECIMAL") ||
    upperType.includes("FLOAT") ||
    upperType.includes("DOUBLE") ||
    upperType.includes("REAL") ||
    upperType.includes("NUMERIC");
  const isBool = upperType.includes("BOOL") || upperType.includes("BIT") || upperType.includes("TINYINT(1)");
  const isJson = upperType.includes("JSON");

  if (isBool) {
    const trimmed = String(raw).trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1") return "TRUE";
    if (trimmed === "false" || trimmed === "0") return "FALSE";
    throwDaemonError(
      DaemonErrorCode.DB_INVALID_DEFAULT,
      `Unsupported boolean default: ${String(raw).slice(0, 64)}`,
      "Boolean defaults must be true/false or 1/0."
    );
  }

  if (isNumeric) {
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    const str = String(raw).trim();
    if (/^-?\d+(\.\d+)?$/.test(str)) return str;
    if (isAllowedFunction(str)) return str;
    throwDaemonError(
      DaemonErrorCode.DB_INVALID_DEFAULT,
      `Unsupported numeric default: ${str.slice(0, 64)}`,
      "Numeric defaults must be a number literal or a whitelisted SQL function (CURRENT_TIMESTAMP, NOW, etc.)."
    );
  }

  if (isJson) {
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (!looksLikeValidJsonExpression(str)) {
      throwDaemonError(
        DaemonErrorCode.DB_INVALID_DEFAULT,
        `Unsupported JSON default: ${str.slice(0, 64)}`,
        "JSON defaults must be valid JSON literals or safe expressions."
      );
    }
    return dialect === "mysql" ? `CAST(${escapeSqlString(str)} AS JSON)` : `'${escapeSqlString(str)}'::json`;
  }

  // String/text/blob fallback.
  const str = String(raw);
  const trimmed = str.trim();
  // Allow a handful of whitelisted zero-arg SQL functions.
  if (isAllowedFunction(trimmed)) return trimmed;
  return escapeSqlString(str);
}

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// Best-effort sanity check before we even cast. We are paranoid and reject
// anything that looks like embedded SQL operators or comment markers.
function looksLikeValidJsonExpression(s: string): boolean {
  if (s.length === 0) return false;
  // Reject obvious injection patterns.
  const bad = /(--|;|\/\*|\*\/|xp_|sp_|grant\s|drop\s|union\s|select\s.*from\s)/i;
  if (bad.test(s)) return false;
  return true;
}
