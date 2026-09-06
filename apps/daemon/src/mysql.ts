import mysql, { type RowDataPacket, type ResultSetHeader, type FieldPacket } from "mysql2/promise";
import { PoolCache } from "./pool-cache.js";
import { escapeDefaultValue } from "./sql-utils.js";
import type {
  DatabaseColumnInfo,
  DatabaseCreateTableRequest,
  DatabaseDeleteRowRequest,
  DatabaseExportResponse,
  DatabaseInsertRowRequest,
  DatabaseQueryResult,
  DatabaseRowsRequest,
  DatabaseRowsResponse,
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseTruncateTableRequest,
  DatabaseUpdateRowRequest
} from "@webops/shared";

export interface MySQLConnectionConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
}
type PoolInstance = ReturnType<typeof mysql.createPool>;

const poolCache = new PoolCache<PoolInstance>();

function poolKey(cfg: MySQLConnectionConfig): string {
  return `${cfg.host}:${cfg.port ?? 3306}/${cfg.database}/${cfg.user}`;
}

export function evictPool(cfg: MySQLConnectionConfig): void {
  poolCache.invalidate(poolKey(cfg));
}

export function formatMySQLError(err: unknown, cfg?: MySQLConnectionConfig): string {
  if (!(err instanceof Error)) return String(err);
  const message = err.message || "";
  const code = (err as { code?: string }).code || "";

  if (code === "ER_ACCESS_DENIED_ERROR" || message.includes("Access denied for user")) {
    const userStr = cfg ? `'${cfg.user}'@'${cfg.host}'` : "指定用户";
    return `MySQL 认证失败：用户 ${userStr} 密码错误，或该用户未被授予从当前主机访问此数据库的权限。`;
  }
  if (code === "ER_BAD_DB_ERROR" || message.includes("Unknown database")) {
    return `MySQL 数据库不存在：未找到名为「${cfg?.database || ""}」的数据库。`;
  }
  if (code === "ECONNREFUSED") {
    return `无法连接到 MySQL 服务 (${cfg?.host || "127.0.0.1"}:${cfg?.port || 3306})：连接被拒绝，请确认服务已启动且端口开放。`;
  }
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return `连接 MySQL 服务超时 (${cfg?.host || "127.0.0.1"}:${cfg?.port || 3306})，请检查网络与防火墙配置。`;
  }
  if (code === "ENOTFOUND") {
    return `未找到 MySQL 主机地址 (${cfg?.host || ""})，域名解析失败。`;
  }
  return message || "MySQL 操作失败";
}

export async function withPool<T>(
  cfg: MySQLConnectionConfig,
  fn: (pool: PoolInstance) => Promise<T>
): Promise<T> {
  const pool = getPool(cfg);
  try {
    return await fn(pool);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const msg = err instanceof Error ? err.message : "";
    if (code === "ER_ACCESS_DENIED_ERROR" || code === "ECONNREFUSED" || msg.includes("Access denied")) {
      evictPool(cfg);
    }
    throw new Error(formatMySQLError(err, cfg));
  }
}

export function getPool(cfg: MySQLConnectionConfig): PoolInstance {
  const key = poolKey(cfg);
  return poolCache.getOrCreate(
    key,
    () =>
      mysql.createPool({
        host: cfg.host,
        port: cfg.port ?? 3306,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        charset: "utf8mb4"
      }),
    undefined,
    async (pool) => {
      try {
        await pool.end();
      } catch {}
    }
  );
}

export async function closeAllPools(): Promise<void> {
  await poolCache.closeAll();
}
function escapeTable(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function escapeColumn(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function toMySQLValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return val;
  return String(val);
}
export async function listTables(cfg: MySQLConnectionConfig): Promise<DatabaseTableSummary[]> {
  const pool = getPool(cfg);

  const [tables] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_TYPE ASC, TABLE_NAME ASC`,
    [cfg.database]
  );

  const result: DatabaseTableSummary[] = [];

  for (const t of tables) {
    const tableName = t.TABLE_NAME as string;
    const tableType = (t.TABLE_TYPE === "BASE TABLE" ? "table" : "view") as "table" | "view";

    // Get column count
    const [cols] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [cfg.database, tableName]
    );
    const columnCount = (cols[0]?.cnt as number) ?? 0;

    // Get row count (approximate for InnoDB, exact after ANALYZE)
    let rowCount = (t.TABLE_ROWS as number) ?? 0;
    if (tableType === "table") {
      try {
        const [countRes] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM ${escapeTable(tableName)}`
        );
        rowCount = (countRes[0]?.cnt as number) ?? 0;
      } catch {
        // fall back to estimated row count
      }
    }

    result.push({
      name: tableName,
      type: tableType,
      rowCount,
      columnCount
    });
  }

  return result;
}
export async function getTableSchema(cfg: MySQLConnectionConfig, tableName: string): Promise<DatabaseTableSchema> {
  const pool = getPool(cfg);
  const [cols] = await pool.query<RowDataPacket[]>(
    `SELECT
       COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
       COLUMN_KEY, EXTRA, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [cfg.database, tableName]
  );

  const columns: DatabaseColumnInfo[] = cols.map((c: RowDataPacket) => ({
    name: c.COLUMN_NAME as string,
    type: c.COLUMN_TYPE || c.DATA_TYPE as string,
    notNull: c.IS_NULLABLE === "NO",
    defaultValue: c.COLUMN_DEFAULT as string | null,
    primaryKey: c.COLUMN_KEY === "PRI",
    autoIncrement: (c.EXTRA as string | undefined)?.includes("auto_increment") ?? false
  }));

  const primaryKeys = columns.filter((c) => c.primaryKey).map((c) => c.name);
  const [indexes] = await pool.query<RowDataPacket[]>(
    `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [cfg.database, tableName]
  );

  const indexMap = new Map<string, { name: string; unique: boolean; columns: string[] }>();
  for (const idx of indexes) {
    const idxName = idx.INDEX_NAME as string;
    if (idxName === "PRIMARY") continue;
    if (!indexMap.has(idxName)) {
      indexMap.set(idxName, {
        name: idxName,
        unique: idx.NON_UNIQUE === 0,
        columns: []
      });
    }
    indexMap.get(idxName)!.columns.push(idx.COLUMN_NAME as string);
  }
  const [fkRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
     WHERE kcu.TABLE_SCHEMA = ?
       AND kcu.TABLE_NAME = ?
       AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
    [cfg.database, tableName]
  );

  const foreignKeys = fkRows.map((fk: RowDataPacket) => ({
    column: fk.COLUMN_NAME as string,
    targetTable: fk.REFERENCED_TABLE_NAME as string,
    targetColumn: fk.REFERENCED_COLUMN_NAME as string
  }));

  // DDL (SHOW CREATE TABLE)
  let ddl: string | undefined;
  try {
    const [createRes] = await pool.query<RowDataPacket[]>(
      `SHOW CREATE TABLE ${escapeTable(tableName)}`
    );
    ddl = createRes[0]?.["Create Table"] as string | undefined;
  } catch {
    // view won't have CREATE TABLE
  }

  return {
    tableName,
    columns,
    primaryKeys,
    foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined,
    indexes: Array.from(indexMap.values()),
    ddl: ddl ?? null
  };
}
export async function queryRows(
  cfg: MySQLConnectionConfig,
  req: DatabaseRowsRequest
): Promise<DatabaseRowsResponse> {
  const pool = getPool(cfg);
  const tableName = req.tableName;
  const page = Math.max(1, req.page ?? 1);
  const pageSize = Math.max(1, Math.min(req.pageSize ?? 50, 500));
  const offset = (page - 1) * pageSize;

  // Get column info first
  const [colRows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [cfg.database, tableName]
  );

  const columns: DatabaseColumnInfo[] = colRows.map((c: RowDataPacket) => ({
    name: c.COLUMN_NAME as string,
    type: c.COLUMN_TYPE as string,
    notNull: c.IS_NULLABLE === "NO",
    defaultValue: c.COLUMN_DEFAULT as string | null,
    primaryKey: c.COLUMN_KEY === "PRI",
    autoIncrement: (c.EXTRA as string | undefined)?.includes("auto_increment") ?? false
  }));

  // Build WHERE clause
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (req.filterColumn && req.filterValue !== undefined && req.filterValue !== "") {
    whereClauses.push(`${escapeColumn(req.filterColumn)} LIKE ?`);
    params.push(`%${req.filterValue}%`);
  }

  if (req.search?.trim()) {
    const searchPattern = `%${req.search.trim()}%`;
    const searchClauses = columns.map((col) => `${escapeColumn(col.name)} LIKE ?`);
    if (searchClauses.length > 0) {
      whereClauses.push(`(${searchClauses.join(" OR ")})`);
      columns.forEach(() => params.push(searchPattern));
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Count total
  const [countRes] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ${escapeTable(tableName)} ${whereSql}`,
    params
  );
  const total = (countRes[0]?.total as number) ?? 0;

  // Sorting
  let orderSql = "";
  if (req.sortBy) {
    const sortCol = columns.find((c) => c.name === req.sortBy);
    if (sortCol) {
      const sortDir = (req.sortOrder ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
      orderSql = `ORDER BY ${escapeColumn(req.sortBy)} ${sortDir}`;
    }
  } else {
    const pks = columns.filter((c) => c.primaryKey).map((c) => `${escapeColumn(c.name)} ASC`);
    if (pks.length > 0) {
      orderSql = `ORDER BY ${pks.join(", ")}`;
    }
  }

  // Query rows
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${escapeTable(tableName)} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    tableName,
    columns,
    rows: rows as Record<string, unknown>[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1
  };
}
export async function insertRow(
  cfg: MySQLConnectionConfig,
  req: DatabaseInsertRowRequest
): Promise<{ lastInsertRowId?: string; affectedRows: number }> {
  const pool = getPool(cfg);
  const tableName = req.tableName;
  const row = req.row;

  const keys = Object.keys(row);
  if (keys.length === 0) {
    throw new Error("No fields provided for insert");
  }

  const cols = keys.map((k) => escapeColumn(k)).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const values = keys.map((k) => toMySQLValue(row[k]));

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO ${escapeTable(tableName)} (${cols}) VALUES (${placeholders})`,
    values
  );

  const ret: { lastInsertRowId?: string; affectedRows: number } = {
    affectedRows: result.affectedRows
  };
  if (result.insertId) {
    ret.lastInsertRowId = String(result.insertId);
  }
  return ret;
}
export async function updateRow(
  cfg: MySQLConnectionConfig,
  req: DatabaseUpdateRowRequest
): Promise<{ affectedRows: number }> {
  const pool = getPool(cfg);
  const tableName = req.tableName;
  const { primaryKeys, values } = req;

  const valKeys = Object.keys(values);
  const pkKeys = Object.keys(primaryKeys);

  if (valKeys.length === 0 || pkKeys.length === 0) {
    throw new Error("At least one value and one primary key are required");
  }

  const setClauses = valKeys.map((k) => `${escapeColumn(k)} = ?`).join(", ");
  const whereClauses = pkKeys.map((k) => `${escapeColumn(k)} = ?`).join(" AND ");

  const sqlParams = [
    ...valKeys.map((k) => toMySQLValue(values[k])),
    ...pkKeys.map((k) => toMySQLValue(primaryKeys[k]))
  ];

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE ${escapeTable(tableName)} SET ${setClauses} WHERE ${whereClauses}`,
    sqlParams
  );

  return { affectedRows: result.affectedRows };
}
export async function deleteRow(
  cfg: MySQLConnectionConfig,
  req: DatabaseDeleteRowRequest
): Promise<{ affectedRows: number }> {
  const pool = getPool(cfg);
  const tableName = req.tableName;
  const { primaryKeys } = req;

  const pkKeys = Object.keys(primaryKeys);
  if (pkKeys.length === 0) {
    throw new Error("Primary keys are required to delete a row");
  }

  const whereClauses = pkKeys.map((k) => `${escapeColumn(k)} = ?`).join(" AND ");
  const params = pkKeys.map((k) => toMySQLValue(primaryKeys[k]));

  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM ${escapeTable(tableName)} WHERE ${whereClauses}`,
    params
  );

  return { affectedRows: result.affectedRows };
}
export async function createTable(
  cfg: MySQLConnectionConfig,
  req: DatabaseCreateTableRequest
): Promise<{ ddl: string }> {
  const pool = getPool(cfg);
  const tableName = req.tableName;
  const columns = req.columns;

  const colDefs = columns.map((col) => {
    let def = `${escapeColumn(col.name)} ${col.type || "VARCHAR(255)"}`;
    if (col.primaryKey) {
      def += " PRIMARY KEY";
      if (col.autoIncrement && (col.type || "").toUpperCase().includes("INT")) {
        def += " AUTO_INCREMENT";
      }
    }
    if (col.notNull && !col.primaryKey) {
      def += " NOT NULL";
    }
    if (col.defaultValue !== undefined && col.defaultValue !== null && col.defaultValue !== "") {
      def += ` DEFAULT ${escapeDefaultValue(col.defaultValue, col.type || "VARCHAR(255)", "mysql")}`;
    }
    return def;
  });

  const ddl = `CREATE TABLE ${escapeTable(tableName)} (\n  ${colDefs.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

  await pool.query(ddl);
  return { ddl };
}
export async function dropTable(cfg: MySQLConnectionConfig, tableName: string): Promise<void> {
  const pool = getPool(cfg);
  await pool.query(`DROP TABLE IF EXISTS ${escapeTable(tableName)}`);
}
export async function truncateTable(cfg: MySQLConnectionConfig, tableName: string): Promise<{ affectedRows: number }> {
  const pool = getPool(cfg);
  // TRUNCATE is DDL in MySQL and doesn't return affected rows, so we count first
  const [countRes] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM ${escapeTable(tableName)}`
  );
  const count = (countRes[0]?.cnt as number) ?? 0;
  await pool.query(`TRUNCATE TABLE ${escapeTable(tableName)}`);
  return { affectedRows: count };
}
export async function executeQuery(
  cfg: MySQLConnectionConfig,
  sql: string,
  maxRows: number
): Promise<DatabaseQueryResult> {
  const pool = getPool(cfg);
  const startTime = performance.now();

  const isSelectLike = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b/i.test(sql);

  try {
    if (isSelectLike) {
      const [rows, fields] = await pool.query<RowDataPacket[]>(sql);
      const duration = Math.round((performance.now() - startTime) * 100) / 100;
      const totalRows = rows.length;
      const limitedRows = rows.slice(0, maxRows);
      const columns = limitedRows.length > 0
        ? Object.keys(limitedRows[0]!)
        : (fields as FieldPacket[] | undefined)?.map((f) => f.name) ?? [];

      return {
        columns,
        rows: limitedRows as Record<string, unknown>[],
        totalRows,
        executionTimeMs: duration,
        affectedRows: 0
      };
    } else {
      const [result] = await pool.query<ResultSetHeader>(sql);
      const duration = Math.round((performance.now() - startTime) * 100) / 100;

      return {
        columns: [],
        rows: [],
        totalRows: 0,
        executionTimeMs: duration,
        affectedRows: result.affectedRows
      };
    }
  } catch (err) {
    const duration = Math.round((performance.now() - startTime) * 100) / 100;
    const errorMsg = err instanceof Error ? err.message : "SQL execution failed";
    return {
      columns: [],
      rows: [],
      totalRows: 0,
      executionTimeMs: duration,
      error: errorMsg
    };
  }
}
export async function exportTable(
  cfg: MySQLConnectionConfig,
  tableName?: string,
  format: "csv" | "json" | "sql" = "csv"
): Promise<DatabaseExportResponse> {
  const pool = getPool(cfg);

  if (!tableName) {
    // Export whole database
    const [tables] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [cfg.database]
    );

    let sqlDump = `-- MySQL Database Export\n-- Database: ${cfg.database}\n-- Generated at: ${new Date().toISOString()}\n\n`;

    for (const t of tables) {
      const tName = t.TABLE_NAME as string;
      // Get CREATE TABLE
      const [createRes] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${escapeTable(tName)}`);
      const createSql = createRes[0]?.["Create Table"] as string;
      if (createSql) {
        sqlDump += `${createSql};\n\n`;
      }
      // Get data
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${escapeTable(tName)}`);
      for (const r of rows) {
        const cols = Object.keys(r);
        const vals = cols.map((c) => {
          const v = r[c];
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          if (v instanceof Date) return `'${v.toISOString().replace("T", " ").slice(0, 19)}'`;
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        sqlDump += `INSERT INTO ${escapeTable(tName)} (${cols.map((c) => escapeColumn(c)).join(", ")}) VALUES (${vals.join(", ")});\n`;
      }
      sqlDump += "\n";
    }

    return {
      ok: true,
      fileName: `export_database_${Date.now()}.sql`,
      contentType: "application/sql",
      content: sqlDump
    };
  }

  // Export single table
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${escapeTable(tableName)}`);
  const count = rows.length;

  if (format === "json") {
    return {
      ok: true,
      fileName: `${tableName}_${Date.now()}.json`,
      contentType: "application/json",
      content: JSON.stringify(rows, null, 2),
      totalRows: count
    };
  }

  if (format === "sql") {
    let dump = `-- Table export: ${tableName}\n-- Database: ${cfg.database}\n-- Date: ${new Date().toISOString()}\n\n`;
    for (const r of rows) {
      const cols = Object.keys(r);
      const vals = cols.map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "number") return String(v);
        if (v instanceof Date) return `'${v.toISOString().replace("T", " ").slice(0, 19)}'`;
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      dump += `INSERT INTO ${escapeTable(tableName)} (${cols.map((c) => escapeColumn(c)).join(", ")}) VALUES (${vals.join(", ")});\n`;
    }
    return {
      ok: true,
      fileName: `${tableName}_${Date.now()}.sql`,
      contentType: "application/sql",
      content: dump,
      totalRows: count
    };
  }
  if (rows.length === 0) {
    const [colRows] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [cfg.database, tableName]
    );
    const headers = colRows.map((c: RowDataPacket) => `"${String(c.COLUMN_NAME).replace(/"/g, '""')}"`).join(",");
    return {
      ok: true,
      fileName: `${tableName}_${Date.now()}.csv`,
      contentType: "text/csv",
      content: `${headers}\n`,
      totalRows: 0
    };
  }

  const headers = Object.keys(rows[0]!);
  const csvLines = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",")];
  for (const row of rows) {
    const line = headers
      .map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        const str = val instanceof Date ? val.toISOString() : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(",");
    csvLines.push(line);
  }

  return {
    ok: true,
    fileName: `${tableName}_${Date.now()}.csv`,
    contentType: "text/csv",
    content: csvLines.join("\n"),
    totalRows: count
  };
}
export async function importTable(
  cfg: MySQLConnectionConfig,
  tableName: string,
  format: "csv" | "json" | "sql",
  content: string,
  mode: "append" | "replace"
): Promise<{ importedRows: number; message: string }> {
  const pool = getPool(cfg);

  if (format === "sql") {
    await pool.query(content);
    return { importedRows: 0, message: "SQL 脚本执行成功" };
  }

  if (!tableName) {
    throw new Error("tableName is required for CSV / JSON import");
  }

  if (mode === "replace") {
    await pool.query(`DELETE FROM ${escapeTable(tableName)}`);
  }

  let records: Array<Record<string, unknown>> = [];
  if (format === "json") {
    const parsed = JSON.parse(content);
    records = Array.isArray(parsed) ? parsed : [parsed];
  } else {
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) {
      return { importedRows: 0, message: "CSV 文件无有效数据行" };
    }

    const parseCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === "," && !inQuotes) {
          result.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current);
      return result;
    };

    const headers = parseCsvLine(lines[0]!).map((h) => h.trim().replace(/^"(.*)"$/, "$1"));
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]!).map((v) => v.trim().replace(/^"(.*)"$/, "$1"));
      const rowObj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        rowObj[h] = values[idx] === "" ? null : values[idx];
      });
      records.push(rowObj);
    }
  }

  let count = 0;
  for (const row of records) {
    const keys = Object.keys(row);
    if (keys.length === 0) continue;
    const cols = keys.map((k) => escapeColumn(k)).join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const vals: unknown[] = keys.map((k) => toMySQLValue(row[k]));
    await pool.query(
      `INSERT INTO ${escapeTable(tableName)} (${cols}) VALUES (${placeholders})`,
      vals
    );
    count++;
  }

  return { importedRows: count, message: `成功导入 ${count} 条记录` };
}
export async function testConnection(cfg: MySQLConnectionConfig): Promise<{ ok: boolean; message?: string }> {
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port ?? 3306,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      connectTimeout: 4000
    });
    await conn.query("SELECT 1 AS test");
    return { ok: true, message: "MySQL 连接成功" };
  } catch (err) {
    evictPool(cfg);
    return { ok: false, message: formatMySQLError(err, cfg) };
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {}
    }
  }
}
