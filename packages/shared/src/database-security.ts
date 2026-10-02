// A conservative preflight for raw commands. SQL engines must additionally
// execute approved commands with database-enforced read-only access.
const READ_ONLY_REDIS_COMMANDS = new Set([
  "PING", "ECHO", "GET", "MGET", "STRLEN", "GETRANGE", "EXISTS", "TYPE", "TTL", "PTTL",
  "KEYS", "SCAN", "DBSIZE", "INFO", "HGET", "HMGET", "HGETALL", "HEXISTS", "HLEN",
  "HKEYS", "HVALS", "HSCAN", "LLEN", "LINDEX", "LRANGE", "SCARD", "SISMEMBER",
  "SMISMEMBER", "SMEMBERS", "SSCAN", "SRANDMEMBER", "ZCARD", "ZCOUNT", "ZSCORE",
  "ZMSCORE", "ZRANGE", "ZREVRANGE", "ZRANK", "ZREVRANK", "ZSCAN", "XLEN", "XRANGE", "XREVRANGE"
]);

export function isReadOnlyDatabaseCommand(sql: string, engine: string): boolean {
  if (engine === "redis") {
    const command = sql.trim().match(/^([A-Za-z]+)(?:\s|$)/)?.[1]?.toUpperCase();
    return Boolean(command && READ_ONLY_REDIS_COMMANDS.has(command));
  }
  // Backslash escaping varies by dialect and server SQL mode. Fail closed.
  if (sql.includes("\\") || /\/\*(?:!|M!)/i.test(sql)) return false;
  let stripped = "";
  for (let i = 0; i < sql.length;) {
    const c = sql[i]!;
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0 || sql.slice(i + 2, end).includes("/*")) return false;
      stripped += " ";
      i = end + 2;
    } else if (sql.startsWith("--", i) || (c === "#" && (engine === "mysql" || engine === "mariadb"))) {
      // MySQL requires whitespace after --, unlike SQLite/PostgreSQL.
      if ((engine === "mysql" || engine === "mariadb") && c === "-" && !/\s/.test(sql[i + 2] ?? "")) return false;
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
      stripped += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          closed = true;
          break;
        }
      }
      if (!closed) return false;
      stripped += " quoted ";
    } else if (c === "$" && (engine === "postgres" || engine === "postgresql")) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (!tag) { stripped += c; i++; continue; }
      const end = sql.indexOf(tag, i + tag.length);
      if (end < 0) return false;
      stripped += " quoted ";
      i = end + tag.length;
    } else { stripped += c; i++; }
  }
  const statements = stripped.split(";").map(s => s.trim()).filter(Boolean);
  if (statements.length !== 1) return false;
  const statement = statements[0]!;
  if (engine === "sqlite" && /^PRAGMA\b/i.test(statement)) {
    // Metadata inspection only; PRAGMA user_version(7) is a write without '='.
    return /^PRAGMA\s+(?:\w+\.)?(?:(?:table_info|table_xinfo|index_info|index_xinfo|index_list|foreign_key_list)\s*\(\s*(?:quoted|\w+)\s*\)|(?:database_list|compile_options|pragma_list|collation_list|function_list|module_list|user_version|application_id|schema_version|page_count|freelist_count))\s*$/i.test(statement);
  }
  if (!/^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH|VALUES)\b/i.test(statement)) return false;
  return !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|RENAME|ATTACH|DETACH|CALL|LOAD|COPY|MERGE|UPSERT|VACUUM|REINDEX|HANDLER|LOCK|UNLOCK|INTO|LOAD_FILE|COMMIT|ROLLBACK|BEGIN|START|SET|RESET|PREPARE|EXECUTE|DEALLOCATE)\b/i.test(statement);
}
