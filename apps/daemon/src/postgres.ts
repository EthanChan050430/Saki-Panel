import pg from "pg";
const { Pool } = pg;
import type {
  DatabaseColumnInfo,
  DatabaseCreateTableRequest,
  DatabaseDeleteRowRequest,
  DatabaseExportResponse,
  DatabaseImportResponse,
  DatabaseInsertRowRequest,
  DatabaseQueryResult,
  DatabaseRowsRequest,
  DatabaseRowsResponse,
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseUpdateRowRequest
} from "@webops/shared";

export interface PostgreSQLConnectionConfig {
  host: string;
  port?: number;
  user: string;
  password?: string;
  database: string;
}

// ── Connection pool management ────────────────────────────────────────

const pools = new Map<string, pg.Pool>();

function poolKey(cfg: PostgreSQLConnectionConfig): string {
  return `${cfg.host}:${cfg.port ?? 5432}/${cfg.database}/${cfg.user}`;
}

export function getPool(cfg: PostgreSQLConnectionConfig): pg.Pool {
  const key = poolKey(cfg);
  const existing = pools.get(key);
  if (existing) return existing;

  const pool = new Pool({
    host: cfg.host,
    port: cfg.port ?? 5432,
    user: cfg.user,
    password: cfg.password || "",
    database: cfg.database,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  // Prevent unhandled errors from crashing the daemon
  pool.on("error", (err) => {
    console.error(`[PostgreSQL Pool Error ${key}]:`, err.message);
  });

  pools.set(key, pool);
  return pool;
}

export async function closeAllPools(): Promise<void> {
  await Promise.all(Array.from(pools.values()).map((p) => p.end()));
  pools.clear();
}

// ── Helpers ───────────────────────────────────────────────────────────

function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// ── 1. Test connection ────────────────────────────────────────────────

export async function testConnection(cfg: PostgreSQLConnectionConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const pool = getPool(cfg);
    const client = await pool.connect();
    try {
      const res = await client.query("SELECT version() as ver");
      const ver = (res.rows[0]?.ver as string) || "PostgreSQL";
      return { ok: true, message: `连接成功 (${ver.split(" on ")[0]})` };
    } finally {
      client.release();
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "连接失败" };
  }
}

// ── 2. List tables ────────────────────────────────────────────────────

export async function listTables(cfg: PostgreSQLConnectionConfig): Promise<DatabaseTableSummary[]> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    const sql = `
      SELECT 
        table_name,
        table_type
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_type ASC, table_name ASC
    `;
    const res = await client.query(sql);

    const summaries: DatabaseTableSummary[] = [];
    for (const row of res.rows) {
      const name = row.table_name as string;
      const type = (row.table_type === "BASE TABLE" ? "table" : "view") as "table" | "view";

      let columnCount = 0;
      let rowCount = 0;

      try {
        const colRes = await client.query(
          "SELECT count(*) as count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
          [name]
        );
        columnCount = parseInt(colRes.rows[0]?.count ?? "0", 10);

        if (type === "table") {
          const countRes = await client.query(`SELECT count(*) as count FROM ${escapeIdentifier(name)}`);
          rowCount = parseInt(countRes.rows[0]?.count ?? "0", 10);
        }
      } catch {
        // ignore count errors
      }

      summaries.push({
        name,
        type,
        rowCount,
        columnCount
      });
    }

    return summaries;
  } finally {
    client.release();
  }
}

// ── 3. Table schema & columns ─────────────────────────────────────────

export async function getTableSchema(cfg: PostgreSQLConnectionConfig, tableName: string): Promise<DatabaseTableSchema> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    // 1. Column info
    const colSql = `
      SELECT 
        column_name, 
        data_type, 
        udt_name,
        is_nullable, 
        column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position ASC
    `;
    const colRes = await client.query(colSql, [tableName]);

    // 2. Primary keys
    const pkSql = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
      ORDER BY kcu.ordinal_position ASC
    `;
    const pkRes = await client.query(pkSql, [tableName]);
    const primaryKeys = pkRes.rows.map((r) => r.column_name as string);

    const columns: DatabaseColumnInfo[] = colRes.rows.map((c) => {
      const colName = c.column_name as string;
      const isPk = primaryKeys.includes(colName);
      const isAuto = Boolean(c.column_default && c.column_default.includes("nextval("));
      return {
        name: colName,
        type: (c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type).toUpperCase(),
        notNull: c.is_nullable === "NO",
        defaultValue: c.column_default,
        primaryKey: isPk,
        autoIncrement: isAuto
      };
    });

    // 3. Indexes
    const idxSql = `
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE schemaname = 'public' AND tablename = $1
    `;
    const idxRes = await client.query(idxSql, [tableName]);
    const indexes = idxRes.rows.map((idx) => {
      const isUnique = idx.indexdef.toUpperCase().includes("UNIQUE INDEX");
      // Extract column names roughly from indexdef
      const match = idx.indexdef.match(/\((.*?)\)$/);
      const cols = match ? match[1].split(",").map((s: string) => s.trim().replace(/"/g, "")) : [];
      return {
        name: idx.indexname as string,
        unique: isUnique,
        columns: cols
      };
    });

    return {
      tableName,
      columns,
      primaryKeys,
      indexes,
      ddl: undefined
    };
  } finally {
    client.release();
  }
}

// ── 4. Query paginated rows ───────────────────────────────────────────

export async function queryRows(cfg: PostgreSQLConnectionConfig, req: DatabaseRowsRequest): Promise<DatabaseRowsResponse> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    const { tableName, page = 1, pageSize = 50, filterColumn, filterValue, search, sortBy, sortOrder = "asc" } = req;
    const safeTable = escapeIdentifier(tableName);
    const limit = Math.max(1, Math.min(pageSize, 500));
    const offset = Math.max(0, (page - 1) * limit);

    // Get table schema for column names
    const schema = await getTableSchema(cfg, tableName);
    const { columns } = schema;

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let pIndex = 1;

    if (filterColumn && filterValue !== undefined && filterValue !== "") {
      whereClauses.push(`${escapeIdentifier(filterColumn)}::text ILIKE $${pIndex}`);
      params.push(`%${filterValue}%`);
      pIndex++;
    }

    if (search?.trim()) {
      const searchPattern = `%${search.trim()}%`;
      const searchParts: string[] = [];
      for (const col of columns) {
        searchParts.push(`${escapeIdentifier(col.name)}::text ILIKE $${pIndex}`);
      }
      if (searchParts.length > 0) {
        whereClauses.push(`(${searchParts.join(" OR ")})`);
        params.push(searchPattern);
        pIndex++;
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Count
    const countSql = `SELECT count(*) as total FROM ${safeTable} ${whereSql}`;
    const countRes = await client.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total ?? "0", 10);

    // Order
    let orderSql = "";
    if (sortBy) {
      const dir = sortOrder.toLowerCase() === "desc" ? "DESC" : "ASC";
      orderSql = `ORDER BY ${escapeIdentifier(sortBy)} ${dir}`;
    } else if (schema.primaryKeys.length > 0) {
      orderSql = `ORDER BY ${schema.primaryKeys.map((pk) => `${escapeIdentifier(pk)} ASC`).join(", ")}`;
    }

    // Rows
    const rowsSql = `SELECT * FROM ${safeTable} ${whereSql} ${orderSql} LIMIT $${pIndex} OFFSET $${pIndex + 1}`;
    const rowsRes = await client.query(rowsSql, [...params, limit, offset]);

    return {
      tableName,
      columns,
      rows: rowsRes.rows,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  } finally {
    client.release();
  }
}

// ── 5. Insert row ─────────────────────────────────────────────────────

export async function insertRow(cfg: PostgreSQLConnectionConfig, req: DatabaseInsertRowRequest): Promise<{ ok: boolean; lastInsertRowId?: string; affectedRows?: number }> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    const { tableName, row } = req;
    const keys = Object.keys(row);
    if (keys.length === 0) throw new Error("No fields provided to insert");

    const safeCols = keys.map(escapeIdentifier).join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const values = keys.map((k) => row[k]);

    const sql = `INSERT INTO ${escapeIdentifier(tableName)} (${safeCols}) VALUES (${placeholders}) RETURNING *`;
    const res = await client.query(sql, values);

    const firstRow = res.rows[0];
    const firstPkVal = firstRow ? Object.values(firstRow)[0] : undefined;

    const ret: { ok: boolean; lastInsertRowId?: string; affectedRows?: number } = {
      ok: true,
      affectedRows: res.rowCount ?? 1
    };
    if (firstPkVal !== undefined) {
      ret.lastInsertRowId = String(firstPkVal);
    }
    return ret;
  } finally {
    client.release();
  }
}

// ── 6. Update row ─────────────────────────────────────────────────────

export async function updateRow(cfg: PostgreSQLConnectionConfig, req: DatabaseUpdateRowRequest): Promise<{ ok: boolean; affectedRows?: number }> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    const { tableName, primaryKeys, values } = req;
    const valKeys = Object.keys(values);
    const pkKeys = Object.keys(primaryKeys);
    if (valKeys.length === 0 || pkKeys.length === 0) {
      throw new Error("Values and primaryKeys are required");
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;

    for (const k of valKeys) {
      setClauses.push(`${escapeIdentifier(k)} = $${pIdx}`);
      params.push(values[k]);
      pIdx++;
    }

    const whereClauses: string[] = [];
    for (const k of pkKeys) {
      whereClauses.push(`${escapeIdentifier(k)} = $${pIdx}`);
      params.push(primaryKeys[k]);
      pIdx++;
    }

    const sql = `UPDATE ${escapeIdentifier(tableName)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
    const res = await client.query(sql, params);

    return {
      ok: true,
      affectedRows: res.rowCount ?? 0
    };
  } finally {
    client.release();
  }
}

// ── 7. Delete row ─────────────────────────────────────────────────────

export async function deleteRow(cfg: PostgreSQLConnectionConfig, req: DatabaseDeleteRowRequest): Promise<{ ok: boolean; affectedRows?: number }> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    const { tableName, primaryKeys } = req;
    const pkKeys = Object.keys(primaryKeys);
    if (pkKeys.length === 0) throw new Error("primaryKeys are required");

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;

    for (const k of pkKeys) {
      whereClauses.push(`${escapeIdentifier(k)} = $${pIdx}`);
      params.push(primaryKeys[k]);
      pIdx++;
    }

    const sql = `DELETE FROM ${escapeIdentifier(tableName)} WHERE ${whereClauses.join(" AND ")}`;
    const res = await client.query(sql, params);

    return {
      ok: true,
      affectedRows: res.rowCount ?? 0
    };
  } finally {
    client.release();
  }
}

// ── 8. Create table ───────────────────────────────────────────────────

export async function createTable(cfg: PostgreSQLConnectionConfig, req: DatabaseCreateTableRequest): Promise<{ ok: boolean; ddl?: string }> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    const { tableName, columns } = req;
    if (!columns || columns.length === 0) throw new Error("At least one column is required");

    const colDefs = columns.map((col) => {
      let def = `${escapeIdentifier(col.name)} ${col.type || "TEXT"}`;
      if (col.primaryKey) {
        def += " PRIMARY KEY";
      }
      if (col.notNull && !col.primaryKey) {
        def += " NOT NULL";
      }
      if (col.defaultValue !== undefined && col.defaultValue !== null && col.defaultValue !== "") {
        def += ` DEFAULT ${col.defaultValue}`;
      }
      return def;
    });

    const ddl = `CREATE TABLE ${escapeIdentifier(tableName)} (\n  ${colDefs.join(",\n  ")}\n);`;
    await client.query(ddl);

    return { ok: true, ddl };
  } finally {
    client.release();
  }
}

// ── 9. Drop table ─────────────────────────────────────────────────────

export async function dropTable(cfg: PostgreSQLConnectionConfig, tableName: string): Promise<{ ok: boolean }> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS ${escapeIdentifier(tableName)} CASCADE`);
    return { ok: true };
  } finally {
    client.release();
  }
}

// ── 10. Truncate table ────────────────────────────────────────────────

export async function truncateTable(cfg: PostgreSQLConnectionConfig, tableName: string): Promise<{ ok: boolean; affectedRows?: number }> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    await client.query(`TRUNCATE TABLE ${escapeIdentifier(tableName)} RESTART IDENTITY CASCADE`);
    return { ok: true, affectedRows: 0 };
  } finally {
    client.release();
  }
}

// ── 11. Execute raw SQL query (Console) ────────────────────────────────

export async function executeQuery(cfg: PostgreSQLConnectionConfig, sql: string, maxRows = 500): Promise<DatabaseQueryResult> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  const start = performance.now();
  try {
    const res = await client.query(sql);
    const duration = Math.round((performance.now() - start) * 100) / 100;

    if (Array.isArray(res)) {
      // Multi-statement result: take the last one
      const last = res[res.length - 1]!;
      const rows = (last.rows || []).slice(0, maxRows);
      const columns = last.fields ? last.fields.map((f: { name: string }) => f.name) : (rows[0] ? Object.keys(rows[0]) : []);
      return {
        columns,
        rows,
        totalRows: last.rows?.length ?? 0,
        executionTimeMs: duration,
        affectedRows: last.rowCount ?? undefined
      };
    }

    const rows = (res.rows || []).slice(0, maxRows);
    const columns = res.fields ? res.fields.map((f: { name: string }) => f.name) : (rows[0] ? Object.keys(rows[0]) : []);

    return {
      columns,
      rows,
      totalRows: res.rows?.length ?? 0,
      executionTimeMs: duration,
      affectedRows: res.rowCount ?? undefined
    };
  } catch (err) {
    const duration = Math.round((performance.now() - start) * 100) / 100;
    return {
      columns: [],
      rows: [],
      totalRows: 0,
      executionTimeMs: duration,
      error: err instanceof Error ? err.message : "PostgreSQL 执行失败"
    };
  } finally {
    client.release();
  }
}

// ── 12. Export table ──────────────────────────────────────────────────

export async function exportTable(
  cfg: PostgreSQLConnectionConfig,
  tableName: string | undefined,
  format: "csv" | "json" | "sql"
): Promise<DatabaseExportResponse> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    if (!tableName) {
      // Export all tables
      const tablesRes = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
      );
      let sqlDump = `-- PostgreSQL Database Export\n-- Generated at: ${new Date().toISOString()}\n\n`;

      for (const t of tablesRes.rows) {
        const tName = t.table_name as string;
        const rowsRes = await client.query(`SELECT * FROM ${escapeIdentifier(tName)}`);
        const rows = rowsRes.rows;
        if (rows.length > 0) {
          const cols = Object.keys(rows[0]!);
          for (const r of rows) {
            const vals = cols.map((c) => {
              const v = r[c];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number" || typeof v === "boolean") return String(v);
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO ${escapeIdentifier(tName)} (${cols.map(escapeIdentifier).join(", ")}) VALUES (${vals.join(", ")});\n`;
          }
          sqlDump += "\n";
        }
      }

      return {
        ok: true,
        fileName: `export_postgres_${Date.now()}.sql`,
        contentType: "application/sql",
        content: sqlDump
      };
    }

    const res = await client.query(`SELECT * FROM ${escapeIdentifier(tableName)}`);
    const rows = res.rows;
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
      let dump = `-- PostgreSQL Table Export: ${tableName}\n-- Date: ${new Date().toISOString()}\n\n`;
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]!);
        for (const r of rows) {
          const vals = cols.map((c) => {
            const v = r[c];
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "number" || typeof v === "boolean") return String(v);
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          dump += `INSERT INTO ${escapeIdentifier(tableName)} (${cols.map(escapeIdentifier).join(", ")}) VALUES (${vals.join(", ")});\n`;
        }
      }
      return {
        ok: true,
        fileName: `${tableName}_${Date.now()}.sql`,
        contentType: "application/sql",
        content: dump,
        totalRows: count
      };
    }

    // Default CSV
    if (rows.length === 0) {
      const colRes = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [tableName]
      );
      const headers = colRes.rows.map((c) => `"${c.column_name.replace(/"/g, '""')}"`).join(",");
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
          return `"${String(val).replace(/"/g, '""')}"`;
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
  } finally {
    client.release();
  }
}

// ── 13. Import table ──────────────────────────────────────────────────

export async function importTable(
  cfg: PostgreSQLConnectionConfig,
  tableName: string,
  format: "csv" | "json" | "sql",
  content: string,
  mode: "append" | "replace" = "append"
): Promise<DatabaseImportResponse> {
  const pool = getPool(cfg);
  const client = await pool.connect();
  try {
    if (format === "sql") {
      await client.query(content);
      return { success: true, importedRows: 0, message: "PostgreSQL 脚本执行成功" };
    }

    if (!tableName) throw new Error("tableName is required for CSV/JSON import");

    await client.query("BEGIN");
    try {
      if (mode === "replace") {
        await client.query(`TRUNCATE TABLE ${escapeIdentifier(tableName)} RESTART IDENTITY CASCADE`);
      }

      let records: Array<Record<string, unknown>> = [];
      if (format === "json") {
        const parsed = JSON.parse(content);
        records = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        // Parse CSV
        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length <= 1) {
          await client.query("ROLLBACK");
          return { success: true, importedRows: 0, message: "CSV 文件无有效数据行" };
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
        const safeCols = keys.map(escapeIdentifier).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const values = keys.map((k) => row[k]);

        await client.query(
          `INSERT INTO ${escapeIdentifier(tableName)} (${safeCols}) VALUES (${placeholders})`,
          values
        );
        count++;
      }

      await client.query("COMMIT");
      return {
        success: true,
        importedRows: count,
        message: `成功导入 ${count} 条记录到 PostgreSQL`
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
