import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import * as net from "node:net";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import type {
  DatabaseColumnInfo,
  DatabaseCreateTableRequest,
  DatabaseDeleteRowRequest,
  DatabaseEngine,
  DatabaseExportRequest,
  DatabaseExportResponse,
  DatabaseImportRequest,
  DatabaseImportResponse,
  DatabaseInsertRowRequest,
  DatabaseQueryResult,
  DatabaseRowsRequest,
  DatabaseRowsResponse,
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseTruncateTableRequest,
  DatabaseUpdateRowRequest,
  DiscoveredDatabase
} from "@webops/shared";
import { daemonPaths } from "../config.js";
import { authenticatePanelRequest } from "../daemon-auth.js";
import * as mysql from "../mysql.js";
import * as postgres from "../postgres.js";
import * as redis from "../redis.js";

type SQLiteParam = null | number | bigint | string | Uint8Array;

function toSqlParam(val: unknown): SQLiteParam {
  if (val === null || val === undefined) return null;
  if (typeof val === "number" || typeof val === "bigint" || typeof val === "string") return val;
  if (val instanceof Uint8Array) return val;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (val instanceof Date) return val.toISOString();
  return JSON.stringify(val);
}

function resolveDbPath(inputPath: string): string {
  const normalized = inputPath.trim();
  if (path.isAbsolute(normalized)) {
    return path.normalize(normalized);
  }
  // Try relative to workspace dir, then cwd
  const fromWorkspace = path.resolve(daemonPaths.workspaceDir, normalized);
  if (fsSync.existsSync(fromWorkspace)) {
    return fromWorkspace;
  }
  return path.resolve(process.cwd(), normalized);
}

function probePort(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

function isSqliteHeader(filePath: string): boolean {
  try {
    const fd = fsSync.openSync(filePath, "r");
    const buffer = Buffer.alloc(16);
    fsSync.readSync(fd, buffer, 0, 16, 0);
    fsSync.closeSync(fd);
    return buffer.toString("utf8", 0, 15) === "SQLite format 3";
  } catch {
    return false;
  }
}

// Engine helpers
function isRedisEngine(body: { engine?: DatabaseEngine; host?: string; port?: number; path?: string }): boolean {
  if (body.engine === "redis") return true;
  if (body.port === 6379) return true;
  return false;
}

function extractRedisConfig(body: {
  host?: string;
  port?: number;
  password?: string;
  database?: number | string;
  user?: string;
}): redis.RedisConnectionConfig {
  const host = body.host?.trim() || "127.0.0.1";
  const port = body.port ?? 6379;
  const database = body.database ?? 0;
  const cfg: redis.RedisConnectionConfig = { host, port, database };
  if (body.password) cfg.password = body.password;
  if (body.user) cfg.username = body.user;
  return cfg;
}

function isPostgreSQLEngine(body: { engine?: DatabaseEngine; host?: string; port?: number; path?: string }): boolean {
  if (body.engine === "postgres") return true;
  if (body.port === 5432) return true;
  return false;
}

function extractPostgreSQLConfig(body: {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}): postgres.PostgreSQLConnectionConfig {
  const host = body.host?.trim() || "127.0.0.1";
  const port = body.port ?? 5432;
  const user = body.user?.trim() || "postgres";
  const password = body.password ?? "";
  const database = body.database?.trim() || "postgres";
  return { host, port, user, password, database };
}

function isMySQLEngine(body: { engine?: DatabaseEngine; host?: string; port?: number; path?: string }): boolean {
  if (body.engine === "mysql" || body.engine === "mariadb") return true;
  if (isRedisEngine(body) || isPostgreSQLEngine(body)) return false;
  // If no path but has host, treat as MySQL
  if (!body.path && body.host) return true;
  return false;
}

function extractMySQLConfig(body: {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}): mysql.MySQLConnectionConfig {
  const host = body.host?.trim() || "127.0.0.1";
  const port = body.port ?? 3306;
  const user = body.user?.trim() || "";
  const password = body.password ?? "";
  const database = body.database?.trim() || "";

  if (!user) throw new Error("MySQL 连接需要用户名");
  if (!database) throw new Error("MySQL 连接需要指定数据库名");

  return { host, port, user, password, database };
}

async function findSqliteFilesInDir(
  dir: string,
  maxDepth = 4,
  currentDepth = 0,
  results: DiscoveredDatabase[] = []
): Promise<DiscoveredDatabase[]> {
  if (currentDepth > maxDepth || results.length >= 100) return results;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await findSqliteFilesInDir(fullPath, maxDepth, currentDepth + 1, results);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isDbExt = [".db", ".sqlite", ".sqlite3", ".db3", ".s3db", ".sl3"].includes(ext);
        if (isDbExt || isSqliteHeader(fullPath)) {
          try {
            const stats = await fs.stat(fullPath);
            let tableCount = 0;
            try {
              const db = new DatabaseSync(fullPath, { readOnly: true });
              const rows = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ count: number }>;
              tableCount = rows[0]?.count ?? 0;
              db.close();
            } catch {
            }

            const relativeToRoot = path.relative(process.cwd(), fullPath);
            const source = relativeToRoot.includes("workspace") ? "工作区实例" : relativeToRoot.includes("panel") ? "面板系统存储" : "本地文件系统";

            results.push({
              engine: "sqlite",
              name: entry.name,
              path: fullPath,
              sizeBytes: stats.size,
              tableCount,
              modifiedAt: stats.mtime.toISOString(),
              source,
              status: "ready",
              isSystem: entry.name === "dev.db"
            });
          } catch {
          }
        }
      }
    }
  } catch {
  }
  return results;
}

export async function registerDatabaseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/databases/discover", { preHandler: authenticatePanelRequest }, async () => {
    const discovered: DiscoveredDatabase[] = [];

    // Search workspace, data, and current directories for SQLite files
    const searchPaths = [
      daemonPaths.workspaceDir,
      path.resolve(process.cwd(), "data"),
      path.resolve(process.cwd(), "..", "data"),
      process.cwd()
    ].filter((p, index, self) => fsSync.existsSync(p) && self.indexOf(p) === index);

    for (const searchDir of searchPaths) {
      await findSqliteFilesInDir(searchDir, 4, 0, discovered);
    }

    // Deduplicate by path
    const uniqueMap = new Map<string, DiscoveredDatabase>();
    for (const item of discovered) {
      if (item.path && !uniqueMap.has(item.path)) {
        uniqueMap.set(item.path, item);
      }
    }
    const finalSqlite = Array.from(uniqueMap.values());

    // Probe common database services
    const serviceProbes = [
      { engine: "mysql" as DatabaseEngine, name: "MySQL / MariaDB", port: 3306, defaultHost: "127.0.0.1" },
      { engine: "postgres" as DatabaseEngine, name: "PostgreSQL", port: 5432, defaultHost: "127.0.0.1" },
      { engine: "redis" as DatabaseEngine, name: "Redis", port: 6379, defaultHost: "127.0.0.1" },
      { engine: "generic" as DatabaseEngine, name: "MongoDB", port: 27017, defaultHost: "127.0.0.1" }
    ];

    const serviceResults: DiscoveredDatabase[] = [];
    await Promise.all(
      serviceProbes.map(async (svc) => {
        const isOnline = await probePort(svc.defaultHost, svc.port);
        if (isOnline) {
          serviceResults.push({
            engine: svc.engine,
            name: `${svc.name} (${svc.port})`,
            host: svc.defaultHost,
            port: svc.port,
            source: `端口 ${svc.port} 监听中`,
            status: "online"
          });
        }
      })
    );

    return {
      ok: true,
      databases: [...finalSqlite, ...serviceResults]
    };
  });
  app.post("/api/databases/tables", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string };

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      const tables = await redis.listTables(cfg);
      return { ok: true, tables };
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      const tables = await postgres.listTables(cfg);
      return { ok: true, tables };
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      const tables = await mysql.listTables(cfg);
      return { ok: true, tables };
    }
    const rawPath = body.path?.trim();
    if (!rawPath) {
      throw new Error("Database path is required for SQLite");
    }
    const dbPath = resolveDbPath(rawPath);
    if (!fsSync.existsSync(dbPath)) {
      throw new Error(`Database file not found: ${dbPath}`);
    }

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tablesRaw = db.prepare(
        "SELECT name, type FROM sqlite_master WHERE (type='table' OR type='view') AND name NOT LIKE 'sqlite_%' ORDER BY type ASC, name ASC"
      ).all() as Array<{ name: string; type: "table" | "view" }>;

      const tables: DatabaseTableSummary[] = [];
      for (const t of tablesRaw) {
        let rowCount = 0;
        let columnCount = 0;
        try {
          const safeName = `"${t.name.replace(/"/g, '""')}"`;
          const countRow = db.prepare(`SELECT count(*) as count FROM ${safeName}`).all() as Array<{ count: number }>;
          rowCount = countRow[0]?.count ?? 0;
          const colRows = db.prepare(`PRAGMA table_info(${safeName})`).all();
          columnCount = colRows.length;
        } catch {
        }

        tables.push({
          name: t.name,
          type: t.type,
          rowCount,
          columnCount
        });
      }

      return { ok: true, tables };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/schema", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; tableName: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string };
    const tableName = body.tableName?.trim();
    if (!tableName) {
      throw new Error("tableName is required");
    }

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      const schema = await redis.getTableSchema(cfg, tableName);
      return { ok: true, schema };
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      const schema = await postgres.getTableSchema(cfg, tableName);
      return { ok: true, schema };
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      const schema = await mysql.getTableSchema(cfg, tableName);
      return { ok: true, schema };
    }

    const rawPath = body.path?.trim();
    if (!rawPath) {
      throw new Error("Database path is required for SQLite");
    }
    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const safeName = `"${tableName.replace(/"/g, '""')}"`;
      const colRows = db.prepare(`PRAGMA table_info(${safeName})`).all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;

      const columns: DatabaseColumnInfo[] = colRows.map((col) => ({
        name: col.name,
        type: col.type || "TEXT",
        notNull: Boolean(col.notnull),
        defaultValue: col.dflt_value,
        primaryKey: Boolean(col.pk),
        autoIncrement: Boolean(col.pk) && (col.type || "").toUpperCase().includes("INT")
      }));

      const primaryKeys = colRows.filter((col) => col.pk > 0).map((col) => col.name);
      const indexRows = db.prepare(`PRAGMA index_list(${safeName})`).all() as Array<{
        name: string;
        unique: number;
      }>;

      const indexes = indexRows.map((idx) => {
        let indexCols: string[] = [];
        try {
          const cols = db.prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`).all() as Array<{ name: string }>;
          indexCols = cols.map((c) => c.name);
        } catch {}
        return {
          name: idx.name,
          unique: Boolean(idx.unique),
          columns: indexCols
        };
      });

      // DDL statement from sqlite_master
      const ddlRow = db.prepare("SELECT sql FROM sqlite_master WHERE (type='table' OR type='view') AND name = ?").all(tableName) as Array<{ sql: string }>;
      const ddl = ddlRow[0]?.sql ?? undefined;

      const schema: DatabaseTableSchema = {
        tableName,
        columns,
        primaryKeys,
        indexes,
        ddl
      };

      return { ok: true, schema };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/rows", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string } & DatabaseRowsRequest;

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      const response = await redis.queryRows(cfg, body);
      return { ok: true, ...response };
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      const response = await postgres.queryRows(cfg, body);
      return { ok: true, ...response };
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      const response = await mysql.queryRows(cfg, body);
      return { ok: true, ...response };
    }

    const rawPath = body.path?.trim();
    const tableName = body.tableName?.trim();
    if (!rawPath || !tableName) {
      throw new Error("Database path and tableName are required");
    }
    const page = Math.max(1, body.page ?? 1);
    const pageSize = Math.max(1, Math.min(body.pageSize ?? 50, 500));
    const offset = (page - 1) * pageSize;

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const safeName = `"${tableName.replace(/"/g, '""')}"`;
      const colRows = db.prepare(`PRAGMA table_info(${safeName})`).all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;

      const columns: DatabaseColumnInfo[] = colRows.map((col) => ({
        name: col.name,
        type: col.type || "TEXT",
        notNull: Boolean(col.notnull),
        defaultValue: col.dflt_value,
        primaryKey: Boolean(col.pk),
        autoIncrement: Boolean(col.pk) && (col.type || "").toUpperCase().includes("INT")
      }));

      const whereClauses: string[] = [];
      const params: SQLiteParam[] = [];

      if (body.filterColumn && body.filterValue !== undefined && body.filterValue !== "") {
        const safeCol = `"${body.filterColumn.replace(/"/g, '""')}"`;
        whereClauses.push(`${safeCol} LIKE ?`);
        params.push(toSqlParam(`%${body.filterValue}%`));
      }

      if (body.search?.trim()) {
        const searchPattern = `%${body.search.trim()}%`;
        const searchClauses = columns.map((col) => `"${col.name.replace(/"/g, '""')}" LIKE ?`);
        if (searchClauses.length > 0) {
          whereClauses.push(`(${searchClauses.join(" OR ")})`);
          columns.forEach(() => params.push(toSqlParam(searchPattern)));
        }
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      // Count total matching rows
      const countSql = `SELECT count(*) as total FROM ${safeName} ${whereSql}`;
      const countRow = db.prepare(countSql).all(...params) as Array<{ total: number }>;
      const total = countRow[0]?.total ?? 0;

      // Sorting
      let orderSql = "";
      if (body.sortBy) {
        const safeSortCol = `"${body.sortBy.replace(/"/g, '""')}"`;
        const sortDir = (body.sortOrder ?? "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
        orderSql = `ORDER BY ${safeSortCol} ${sortDir}`;
      } else {
        const pks = colRows.filter((c) => c.pk > 0).map((c) => `"${c.name.replace(/"/g, '""')}" ASC`);
        if (pks.length > 0) {
          orderSql = `ORDER BY ${pks.join(", ")}`;
        }
      }

      // Query rows
      const rowsSql = `SELECT * FROM ${safeName} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;
      const rows = db.prepare(rowsSql).all(...params, pageSize, offset) as Record<string, unknown>[];

      const response: DatabaseRowsResponse = {
        tableName,
        columns,
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize) || 1
      };

      return { ok: true, ...response };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/insert", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string } & DatabaseInsertRowRequest;

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      return redis.insertRow(cfg, body);
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      return postgres.insertRow(cfg, body);
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      return mysql.insertRow(cfg, body);
    }

    const rawPath = body.path?.trim();
    const tableName = body.tableName?.trim();
    const row = body.row;
    if (!rawPath || !tableName || !row) {
      throw new Error("path, tableName, and row data are required");
    }

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    try {
      const keys = Object.keys(row);
      if (keys.length === 0) {
        throw new Error("No fields provided for insert");
      }
      const safeCols = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(", ");
      const placeholders = keys.map(() => "?").join(", ");
      const values: SQLiteParam[] = keys.map((k) => toSqlParam(row[k]));

      const sql = `INSERT INTO "${tableName.replace(/"/g, '""')}" (${safeCols}) VALUES (${placeholders})`;
      const result = db.prepare(sql).run(...values);

      return {
        ok: true,
        lastInsertRowId: result.lastInsertRowid ? String(result.lastInsertRowid) : undefined,
        affectedRows: result.changes
      };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/update", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string } & DatabaseUpdateRowRequest;

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      return redis.updateRow(cfg, body);
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      return postgres.updateRow(cfg, body);
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      return mysql.updateRow(cfg, body);
    }

    const rawPath = body.path?.trim();
    const tableName = body.tableName?.trim();
    const { primaryKeys, values } = body;
    if (!rawPath || !tableName || !primaryKeys || !values) {
      throw new Error("path, tableName, primaryKeys, and values are required");
    }

    const valKeys = Object.keys(values);
    const pkKeys = Object.keys(primaryKeys);
    if (valKeys.length === 0 || pkKeys.length === 0) {
      throw new Error("At least one value and one primary key are required");
    }

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    try {
      const setClauses = valKeys.map((k) => `"${k.replace(/"/g, '""')}" = ?`).join(", ");
      const whereClauses = pkKeys.map((k) => `"${k.replace(/"/g, '""')}" = ?`).join(" AND ");

      const sqlParams: SQLiteParam[] = [
        ...valKeys.map((k) => toSqlParam(values[k])),
        ...pkKeys.map((k) => toSqlParam(primaryKeys[k]))
      ];

      const sql = `UPDATE "${tableName.replace(/"/g, '""')}" SET ${setClauses} WHERE ${whereClauses}`;
      const result = db.prepare(sql).run(...sqlParams);

      return {
        ok: true,
        affectedRows: result.changes
      };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/delete", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string } & DatabaseDeleteRowRequest;

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      return redis.deleteRow(cfg, body);
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      return postgres.deleteRow(cfg, body);
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      return mysql.deleteRow(cfg, body);
    }

    const rawPath = body.path?.trim();
    const tableName = body.tableName?.trim();
    const { primaryKeys } = body;
    if (!rawPath || !tableName || !primaryKeys) {
      throw new Error("path, tableName, and primaryKeys are required");
    }

    const pkKeys = Object.keys(primaryKeys);
    if (pkKeys.length === 0) {
      throw new Error("Primary keys are required to delete a row");
    }

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    try {
      const whereClauses = pkKeys.map((k) => `"${k.replace(/"/g, '""')}" = ?`).join(" AND ");
      const params: SQLiteParam[] = pkKeys.map((k) => toSqlParam(primaryKeys[k]));

      const sql = `DELETE FROM "${tableName.replace(/"/g, '""')}" WHERE ${whereClauses}`;
      const result = db.prepare(sql).run(...params);

      return {
        ok: true,
        affectedRows: result.changes
      };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/create", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string } & DatabaseCreateTableRequest;

    if (isRedisEngine(body)) {
      return { ok: true };
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      return postgres.createTable(cfg, body);
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      return mysql.createTable(cfg, body);
    }

    const rawPath = body.path?.trim();
    const tableName = body.tableName?.trim();
    const columns = body.columns;
    if (!rawPath || !tableName || !columns || columns.length === 0) {
      throw new Error("path, tableName, and at least one column are required");
    }

    const colDefs = columns.map((col) => {
      let def = `"${col.name.replace(/"/g, '""')}" ${col.type || "TEXT"}`;
      if (col.primaryKey) {
        def += " PRIMARY KEY";
        if (col.autoIncrement && (col.type || "").toUpperCase().includes("INT")) {
          def += " AUTOINCREMENT";
        }
      }
      if (col.notNull && !col.primaryKey) {
        def += " NOT NULL";
      }
      if (col.defaultValue !== undefined && col.defaultValue !== null && col.defaultValue !== "") {
        def += ` DEFAULT ${col.defaultValue}`;
      }
      return def;
    });

    const ddl = `CREATE TABLE "${tableName.replace(/"/g, '""')}" (\n  ${colDefs.join(",\n  ")}\n);`;

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(ddl);
      return { ok: true, ddl };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/drop", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; tableName: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string };
    const tableName = body.tableName?.trim();
    if (!tableName) {
      throw new Error("tableName is required");
    }

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      await redis.truncateTable(cfg, tableName);
      return { ok: true };
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      await postgres.dropTable(cfg, tableName);
      return { ok: true };
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      await mysql.dropTable(cfg, tableName);
      return { ok: true };
    }

    const rawPath = body.path?.trim();
    if (!rawPath) {
      throw new Error("path is required for SQLite");
    }
    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`DROP TABLE IF EXISTS "${tableName.replace(/"/g, '""')}"`);
      return { ok: true };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/tables/truncate", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; tableName: string; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string };
    const tableName = body.tableName?.trim();
    if (!tableName) {
      throw new Error("tableName is required");
    }

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      return redis.truncateTable(cfg, tableName);
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      return postgres.truncateTable(cfg, tableName);
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      return mysql.truncateTable(cfg, tableName);
    }

    const rawPath = body.path?.trim();
    if (!rawPath) {
      throw new Error("path is required for SQLite");
    }
    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    try {
      const result = db.prepare(`DELETE FROM "${tableName.replace(/"/g, '""')}"`).run();
      return { ok: true, affectedRows: result.changes };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/query", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; sql: string; maxRows?: number; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string };
    const sql = body.sql?.trim();
    if (!sql) {
      throw new Error("sql / command is required");
    }

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      const result = await redis.executeCommand(cfg, sql, body.maxRows);
      return { ok: true, result };
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      const maxRows = Math.max(1, Math.min(body.maxRows ?? 500, 2000));
      const result = await postgres.executeQuery(cfg, sql, maxRows);
      return { ok: true, result };
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      const maxRows = Math.max(1, Math.min(body.maxRows ?? 500, 2000));
      const result = await mysql.executeQuery(cfg, sql, maxRows);
      return { ok: true, result };
    }

    const rawPath = body.path?.trim();
    if (!rawPath) {
      throw new Error("path is required for SQLite");
    }
    const maxRows = Math.max(1, Math.min(body.maxRows ?? 500, 2000));

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    const start = performance.now();
    try {
      const isSelectOrPragma = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(sql);

      if (isSelectOrPragma) {
        const stmt = db.prepare(sql);
        const allRows = stmt.all() as Record<string, unknown>[];
        const duration = Math.round((performance.now() - start) * 100) / 100;
        const totalRows = allRows.length;
        const rows = allRows.slice(0, maxRows);
        const columns = rows.length > 0 ? Object.keys(rows[0]!) : stmt.sourceSQL ? [] : [];

        const result: DatabaseQueryResult = {
          columns,
          rows,
          totalRows,
          executionTimeMs: duration,
          affectedRows: 0
        };
        return { ok: true, result };
      } else {
        db.exec(sql);
        const duration = Math.round((performance.now() - start) * 100) / 100;

        const result: DatabaseQueryResult = {
          columns: [],
          rows: [],
          totalRows: 0,
          executionTimeMs: duration,
          affectedRows: 1
        };
        return { ok: true, result };
      }
    } catch (err) {
      const duration = Math.round((performance.now() - start) * 100) / 100;
      const errorMsg = err instanceof Error ? err.message : "SQL execution failed";
      return {
        ok: false,
        result: {
          columns: [],
          rows: [],
          totalRows: 0,
          executionTimeMs: duration,
          error: errorMsg
        }
      };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/export", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; tableName?: string; format: "csv" | "json" | "sql"; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string };
    const tableName = body.tableName?.trim();
    const format = body.format || "csv";

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      const result = await redis.exportTable(cfg, tableName, format);
      return result;
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      const result = await postgres.exportTable(cfg, tableName, format);
      return result;
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      const result = await mysql.exportTable(cfg, tableName, format);
      return result;
    }

    const rawPath = body.path?.trim();
    if (!rawPath) {
      throw new Error("Database path is required");
    }

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      if (!tableName) {
        // Export whole database schema & inserts
        const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string; sql: string }>;
        let sqlDump = `-- SQLite Database Export\n-- Generated at: ${new Date().toISOString()}\n\n`;
        for (const t of tables) {
          sqlDump += `${t.sql};\n\n`;
          const rows = db.prepare(`SELECT * FROM "${t.name.replace(/"/g, '""')}"`).all() as Record<string, unknown>[];
          for (const r of rows) {
            const cols = Object.keys(r);
            const vals = cols.map((c) => {
              const v = r[c];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number") return String(v);
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")});\n`;
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
      const safeName = `"${tableName.replace(/"/g, '""')}"`;
      const rows = db.prepare(`SELECT * FROM ${safeName}`).all() as Record<string, unknown>[];
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
        let dump = `-- Table export: ${tableName}\n-- Date: ${new Date().toISOString()}\n\n`;
        for (const r of rows) {
          const cols = Object.keys(r);
          const vals = cols.map((c) => {
            const v = r[c];
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "number") return String(v);
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          dump += `INSERT INTO "${tableName}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")});\n`;
        }
        return {
          ok: true,
          fileName: `${tableName}_${Date.now()}.sql`,
          contentType: "application/sql",
          content: dump,
          totalRows: count
        };
      }

      // Default CSV format
      if (rows.length === 0) {
        const colRows = db.prepare(`PRAGMA table_info(${safeName})`).all() as Array<{ name: string }>;
        const headers = colRows.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(",");
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
            const str = String(val);
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
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/import", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { path?: string; tableName?: string; format: "csv" | "json" | "sql"; content: string; mode?: "append" | "replace"; host?: string; port?: number; engine?: DatabaseEngine; user?: string; password?: string; database?: string };
    const tableName = body.tableName?.trim();
    const format = body.format || "csv";
    const content = body.content?.trim();
    const mode = body.mode || "append";

    if (!content) {
      throw new Error("content is required for import");
    }

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      return redis.importTable(cfg, tableName || "", format, content, mode);
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      return postgres.importTable(cfg, tableName || "", format, content, mode);
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      return mysql.importTable(cfg, tableName || "", format, content, mode);
    }

    const rawPath = body.path?.trim();
    if (!rawPath) {
      throw new Error("path is required for import");
    }

    const dbPath = resolveDbPath(rawPath);
    const db = new DatabaseSync(dbPath);
    try {
      if (format === "sql") {
        db.exec(content);
        return { ok: true, importedRows: 0, message: "SQL 脚本执行成功" };
      }

      if (!tableName) {
        throw new Error("tableName is required for CSV / JSON import");
      }

      const safeName = `"${tableName.replace(/"/g, '""')}"`;

      if (mode === "replace") {
        db.exec(`DELETE FROM ${safeName}`);
      }

      let records: Array<Record<string, unknown>> = [];
      if (format === "json") {
        const parsed = JSON.parse(content);
        records = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length <= 1) {
          return { ok: true, importedRows: 0, message: "CSV 文件无有效数据行" };
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

      // Batch insert in transaction
      let count = 0;
      db.exec("BEGIN TRANSACTION");
      try {
        for (const row of records) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const cols = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(", ");
          const placeholders = keys.map(() => "?").join(", ");
          const vals: SQLiteParam[] = keys.map((k) => toSqlParam(row[k]));
          const insertSql = `INSERT INTO ${safeName} (${cols}) VALUES (${placeholders})`;
          db.prepare(insertSql).run(...vals);
          count++;
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      return {
        ok: true,
        importedRows: count,
        message: `成功导入 ${count} 条记录`
      };
    } finally {
      db.close();
    }
  });
  app.post("/api/databases/test-connection", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { host?: string; port?: number; user?: string; password?: string; database?: string; engine?: DatabaseEngine; path?: string };

    if (isRedisEngine(body)) {
      const cfg = extractRedisConfig(body);
      const result = await redis.testConnection(cfg);
      return { ok: result.ok, message: result.message };
    }

    if (isPostgreSQLEngine(body)) {
      const cfg = extractPostgreSQLConfig(body);
      const result = await postgres.testConnection(cfg);
      return { ok: result.ok, message: result.message };
    }

    if (isMySQLEngine(body)) {
      const cfg = extractMySQLConfig(body);
      const result = await mysql.testConnection(cfg);
      return { ok: result.ok, message: result.message };
    }
    const p = body.path ? resolveDbPath(body.path) : "";
    if (p && fsSync.existsSync(p)) {
      return { ok: true, message: `SQLite 文件已就绪 (${path.basename(p)})` };
    }
    return { ok: false, message: `未找到指定路径的数据库文件: ${body.path || "未填路径"}` };
  });
  app.post("/api/databases/stats", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as { host?: string; port?: number; user?: string; password?: string; database?: string; engine?: DatabaseEngine; path?: string };
    const start = performance.now();

    if (isRedisEngine(body)) {
      try {
        const cfg = extractRedisConfig(body);
        const stats = await redis.getRedisStats(cfg);
        const latency = Math.round((performance.now() - start) * 10) / 10;
        return {
          ok: true,
          latencyMs: latency,
          version: stats.version,
          totalKeys: stats.totalKeys,
          memory: stats.usedMemoryHuman,
          clients: stats.connectedClients,
          uptimeDays: stats.uptimeDays
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Redis 状态获取失败" };
      }
    }

    if (isPostgreSQLEngine(body)) {
      try {
        const cfg = extractPostgreSQLConfig(body);
        const pool = postgres.getPool(cfg);
        const client = await pool.connect();
        try {
          const res = await client.query("SELECT version() as ver");
          const countRes = await client.query(
            "SELECT count(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
          );
          const latency = Math.round((performance.now() - start) * 10) / 10;
          return {
            ok: true,
            latencyMs: latency,
            version: (res.rows[0]?.ver as string || "").split(" on ")[0] || "PostgreSQL",
            tableCount: parseInt(countRes.rows[0]?.count ?? "0", 10)
          };
        } finally {
          client.release();
        }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "PostgreSQL 状态获取失败" };
      }
    }

    if (isMySQLEngine(body)) {
      try {
        const cfg = extractMySQLConfig(body);
        const pool = mysql.getPool(cfg);
        const [rows] = await pool.query("SELECT VERSION() as ver");
        const [tableRows] = await pool.query(
          "SELECT count(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
          [cfg.database]
        );
        const latency = Math.round((performance.now() - start) * 10) / 10;
        const ver = (rows as Array<{ ver: string }>)[0]?.ver || "MySQL";
        const tCount = (tableRows as Array<{ count: number }>)[0]?.count || 0;
        return {
          ok: true,
          latencyMs: latency,
          version: `MySQL ${ver}`,
          tableCount: tCount
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "MySQL 状态获取失败" };
      }
    }
    const rawPath = body.path?.trim();
    if (rawPath) {
      const dbPath = resolveDbPath(rawPath);
      if (fsSync.existsSync(dbPath)) {
        const stats = fsSync.statSync(dbPath);
        const latency = Math.round((performance.now() - start) * 10) / 10;
        return {
          ok: true,
          latencyMs: latency,
          version: "SQLite 3",
          sizeBytes: stats.size
        };
      }
    }

    return { ok: false, message: "数据库未就绪" };
  });
}
