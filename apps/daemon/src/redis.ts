import IORedis, { type Redis as RedisClient } from "ioredis";
const RedisClass: any = (IORedis as any).default || IORedis;

import type {
  DatabaseColumnInfo,
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

export interface RedisConnectionConfig {
  host: string;
  port?: number | undefined;
  password?: string | undefined;
  database?: number | string | undefined;
  username?: string | undefined;
}
const clients = new Map<string, RedisClient>();

function clientKey(cfg: RedisConnectionConfig): string {
  const db = typeof cfg.database === "number" ? cfg.database : parseInt(String(cfg.database || "0"), 10) || 0;
  return `${cfg.host}:${cfg.port ?? 6379}/${db}`;
}

export function getClient(cfg: RedisConnectionConfig): RedisClient {
  const key = clientKey(cfg);
  const existing = clients.get(key);
  if (existing && existing.status !== "end") return existing;

  const db = typeof cfg.database === "number" ? cfg.database : parseInt(String(cfg.database || "0"), 10) || 0;

  const client: RedisClient = new RedisClass({
    host: cfg.host,
    port: cfg.port ?? 6379,
    password: cfg.password || undefined,
    username: cfg.username || undefined,
    db,
    lazyConnect: false,
    connectTimeout: 5000,
    maxRetriesPerRequest: 2,
    retryStrategy(times: number) {
      if (times > 3) return null;
      return Math.min(times * 200, 1000);
    }
  });

  client.on("error", (err: Error) => {
    console.error(`[Redis Error ${key}]:`, err.message);
  });

  clients.set(key, client);
  return client;
}

export async function closeAllClients(): Promise<void> {
  await Promise.all(Array.from(clients.values()).map((c) => c.quit().catch(() => {})));
  clients.clear();
}
export async function testConnection(cfg: RedisConnectionConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const client = getClient(cfg);
    const pong = await client.ping();
    const info = await client.info("server");
    const verMatch = info.match(/redis_version:([^\r\n]+)/);
    const ver = verMatch ? verMatch[1] : "Redis";
    return { ok: true, message: `连接成功 (PONG, Redis v${ver})` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Redis 连接失败" };
  }
}
export async function getRedisStats(cfg: RedisConnectionConfig): Promise<{
  version: string;
  usedMemoryHuman: string;
  connectedClients: number;
  totalKeys: number;
  uptimeDays: number;
}> {
  const client = getClient(cfg);
  const [infoServer, infoMem, infoClients, dbsize] = await Promise.all([
    client.info("server"),
    client.info("memory"),
    client.info("clients"),
    client.dbsize()
  ]);

  const verMatch = infoServer.match(/redis_version:([^\r\n]+)/);
  const uptimeMatch = infoServer.match(/uptime_in_days:([^\r\n]+)/);
  const memMatch = infoMem.match(/used_memory_human:([^\r\n]+)/);
  const clientMatch = infoClients.match(/connected_clients:([^\r\n]+)/);

  return {
    version: verMatch ? verMatch[1]!.trim() : "unknown",
    usedMemoryHuman: memMatch ? memMatch[1]!.trim() : "0B",
    connectedClients: clientMatch ? parseInt(clientMatch[1]!, 10) : 0,
    totalKeys: dbsize,
    uptimeDays: uptimeMatch ? parseInt(uptimeMatch[1]!, 10) : 0
  };
}
export async function listTables(cfg: RedisConnectionConfig): Promise<DatabaseTableSummary[]> {
  const client = getClient(cfg);
  const totalKeys = await client.dbsize();

  return [
    { name: "全部键 (All Keys)", type: "table", rowCount: totalKeys, columnCount: 5 },
    { name: "字符串 (Strings)", type: "view", columnCount: 5 },
    { name: "哈希 (Hashes)", type: "view", columnCount: 5 },
    { name: "列表 (Lists)", type: "view", columnCount: 5 },
    { name: "集合 (Sets)", type: "view", columnCount: 5 },
    { name: "有序集合 (ZSets)", type: "view", columnCount: 5 }
  ];
}
const REDIS_COLUMNS: DatabaseColumnInfo[] = [
  { name: "key", type: "STRING", notNull: true, primaryKey: true },
  { name: "type", type: "KEY_TYPE", notNull: true, primaryKey: false },
  { name: "ttl", type: "TTL_SEC", notNull: true, primaryKey: false },
  { name: "size", type: "SIZE", notNull: false, primaryKey: false },
  { name: "value", type: "VALUE_CONTENT", notNull: false, primaryKey: false }
];

export async function getTableSchema(cfg: RedisConnectionConfig, tableName: string): Promise<DatabaseTableSchema> {
  return {
    tableName,
    columns: REDIS_COLUMNS,
    primaryKeys: ["key"],
    indexes: [],
    ddl: undefined
  };
}
export async function queryRows(cfg: RedisConnectionConfig, req: DatabaseRowsRequest): Promise<DatabaseRowsResponse> {
  const client = getClient(cfg);
  const { page = 1, pageSize = 50, search, filterColumn, filterValue, tableName } = req;
  const limit = Math.max(1, Math.min(pageSize, 200));

  // Determine type filter from tableName
  let targetType: string | null = null;
  if (tableName.includes("Strings") || tableName.includes("字符串")) targetType = "string";
  else if (tableName.includes("Hashes") || tableName.includes("哈希")) targetType = "hash";
  else if (tableName.includes("Lists") || tableName.includes("列表")) targetType = "list";
  else if (tableName.includes("Sets") && !tableName.includes("ZSets") || tableName.includes("集合") && !tableName.includes("有序")) targetType = "set";
  else if (tableName.includes("ZSets") || tableName.includes("有序集合")) targetType = "zset";

  // Build match pattern
  let pattern = "*";
  if (search?.trim()) {
    pattern = `*${search.trim()}*`;
  } else if (filterColumn === "key" && filterValue?.trim()) {
    pattern = `*${filterValue.trim()}*`;
  }

  // Scan keys
  let cursor = "0";
  const matchedKeys: string[] = [];
  const maxScan = 2000;
  let scanned = 0;

  do {
    const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = nextCursor;
    scanned += keys.length;

    for (const k of keys) {
      if (matchedKeys.length >= 1000) break;
      matchedKeys.push(k);
    }
    if (scanned >= maxScan || matchedKeys.length >= 1000) break;
  } while (cursor !== "0");

  // Sort keys alphabetically
  matchedKeys.sort();

  const total = matchedKeys.length;
  const offset = (page - 1) * limit;
  const pagedKeys = matchedKeys.slice(offset, offset + limit);

  // Fetch details for page
  const rows: Record<string, unknown>[] = [];

  for (const k of pagedKeys) {
    try {
      const keyType = await client.type(k);
      if (targetType && keyType !== targetType) {
        continue;
      }
      const ttl = await client.ttl(k);
      let size = 0;
      let valuePreview = "";

      if (keyType === "string") {
        const val = await client.get(k);
        size = val ? Buffer.byteLength(val) : 0;
        valuePreview = val ? (val.length > 300 ? val.slice(0, 300) + "..." : val) : "";
      } else if (keyType === "hash") {
        size = await client.hlen(k);
        const sample = await client.hgetall(k);
        valuePreview = JSON.stringify(sample);
        if (valuePreview.length > 300) valuePreview = valuePreview.slice(0, 300) + "...";
      } else if (keyType === "list") {
        size = await client.llen(k);
        const sample = await client.lrange(k, 0, 5);
        valuePreview = JSON.stringify(sample);
      } else if (keyType === "set") {
        size = await client.scard(k);
        const sample = await client.smembers(k);
        valuePreview = JSON.stringify(sample.slice(0, 5));
      } else if (keyType === "zset") {
        size = await client.zcard(k);
        const sample = await (client as any).zrange(k, 0, 5);
        valuePreview = JSON.stringify(sample);
      }

      rows.push({
        key: k,
        type: keyType,
        ttl,
        size,
        value: valuePreview
      });
    } catch {
      // Ignore single key error
    }
  }

  return {
    tableName,
    columns: REDIS_COLUMNS,
    rows,
    total,
    page,
    pageSize: limit,
    totalPages: Math.ceil(total / limit) || 1
  };
}
export async function insertRow(cfg: RedisConnectionConfig, req: DatabaseInsertRowRequest): Promise<{ ok: boolean; lastInsertRowId?: string; affectedRows?: number }> {
  const client = getClient(cfg);
  const { row } = req;
  const key = String(row.key || "").trim();
  if (!key) throw new Error("Key 不能为空");

  const type = String(row.type || "string").toLowerCase();
  const rawValue = row.value;
  const ttl = row.ttl !== undefined ? parseInt(String(row.ttl), 10) : -1;

  if (type === "string") {
    const val = typeof rawValue === "object" ? JSON.stringify(rawValue) : String(rawValue ?? "");
    await client.set(key, val);
  } else if (type === "hash") {
    let obj: Record<string, string> = {};
    if (typeof rawValue === "object" && rawValue !== null) {
      obj = rawValue as Record<string, string>;
    } else {
      try {
        obj = JSON.parse(String(rawValue));
      } catch {
        obj = { data: String(rawValue) };
      }
    }
    await client.hset(key, obj);
  } else if (type === "list") {
    let arr: string[] = [];
    if (Array.isArray(rawValue)) {
      arr = rawValue.map(String);
    } else {
      try {
        const p = JSON.parse(String(rawValue));
        arr = Array.isArray(p) ? p.map(String) : [String(rawValue)];
      } catch {
        arr = [String(rawValue)];
      }
    }
    if (arr.length > 0) {
      await client.rpush(key, ...arr);
    }
  } else if (type === "set") {
    let arr: string[] = [];
    if (Array.isArray(rawValue)) {
      arr = rawValue.map(String);
    } else {
      try {
        const p = JSON.parse(String(rawValue));
        arr = Array.isArray(p) ? p.map(String) : [String(rawValue)];
      } catch {
        arr = [String(rawValue)];
      }
    }
    if (arr.length > 0) {
      await client.sadd(key, ...arr);
    }
  }

  if (ttl > 0) {
    await client.expire(key, ttl);
  }

  return { ok: true, lastInsertRowId: key, affectedRows: 1 };
}
export async function updateRow(cfg: RedisConnectionConfig, req: DatabaseUpdateRowRequest): Promise<{ ok: boolean; affectedRows?: number }> {
  const client = getClient(cfg);
  const { primaryKeys, values } = req;
  const key = String(primaryKeys.key || "").trim();
  if (!key) throw new Error("Key 不能为空");

  if (values.value !== undefined) {
    const type = await client.type(key);
    if (type === "string") {
      await client.set(key, String(values.value));
    } else if (type === "hash") {
      try {
        const obj = JSON.parse(String(values.value));
        await client.del(key);
        await client.hset(key, obj);
      } catch {
        await client.hset(key, "data", String(values.value));
      }
    }
  }

  if (values.ttl !== undefined) {
    const ttl = parseInt(String(values.ttl), 10);
    if (ttl > 0) {
      await client.expire(key, ttl);
    } else if (ttl === -1) {
      await client.persist(key);
    }
  }

  return { ok: true, affectedRows: 1 };
}
export async function deleteRow(cfg: RedisConnectionConfig, req: DatabaseDeleteRowRequest): Promise<{ ok: boolean; affectedRows?: number }> {
  const client = getClient(cfg);
  const key = String(req.primaryKeys.key || "").trim();
  if (!key) throw new Error("Key 不能为空");

  const count = await client.del(key);
  return { ok: true, affectedRows: count };
}
export async function truncateTable(cfg: RedisConnectionConfig, _tableName: string): Promise<{ ok: boolean; affectedRows?: number }> {
  const client = getClient(cfg);
  await client.flushdb();
  return { ok: true, affectedRows: 0 };
}
function parseCommandLine(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

export async function executeCommand(cfg: RedisConnectionConfig, commandLine: string, _maxRows = 500): Promise<DatabaseQueryResult> {
  const client = getClient(cfg);
  const trimmed = commandLine.trim();
  if (!trimmed) throw new Error("Redis command is required");

  const tokens = parseCommandLine(trimmed);
  if (tokens.length === 0) throw new Error("Invalid command");

  const command = tokens[0]!.toLowerCase();
  const args = tokens.slice(1);

  const start = performance.now();
  try {
    const rawResult = await (client as any).call(command, ...args);
    const duration = Math.round((performance.now() - start) * 100) / 100;

    let rows: Record<string, unknown>[] = [];
    let columns: string[] = ["result"];

    if (rawResult === null || rawResult === undefined) {
      rows = [{ result: "(nil)" }];
    } else if (typeof rawResult === "string" || typeof rawResult === "number" || typeof rawResult === "boolean") {
      rows = [{ result: String(rawResult) }];
    } else if (Array.isArray(rawResult)) {
      columns = ["index", "value"];
      rows = rawResult.map((item, idx) => ({
        index: idx + 1,
        value: typeof item === "object" ? JSON.stringify(item) : String(item)
      }));
    } else if (typeof rawResult === "object") {
      columns = ["field", "value"];
      rows = Object.entries(rawResult).map(([k, v]) => ({
        field: k,
        value: typeof v === "object" ? JSON.stringify(v) : String(v)
      }));
    }

    return {
      columns,
      rows,
      totalRows: rows.length,
      executionTimeMs: duration,
      affectedRows: typeof rawResult === "number" ? rawResult : undefined
    };
  } catch (err) {
    const duration = Math.round((performance.now() - start) * 100) / 100;
    return {
      columns: [],
      rows: [],
      totalRows: 0,
      executionTimeMs: duration,
      error: err instanceof Error ? err.message : "Redis 命令执行失败"
    };
  }
}
export async function exportTable(
  cfg: RedisConnectionConfig,
  _tableName: string | undefined,
  format: "csv" | "json" | "sql"
): Promise<DatabaseExportResponse> {
  const client = getClient(cfg);
  const keys = await client.keys("*");
  const data: Array<{ key: string; type: string; ttl: number; value: unknown }> = [];

  for (const k of keys.slice(0, 1000)) {
    try {
      const type = await client.type(k);
      const ttl = await client.ttl(k);
      let value: unknown = null;
      if (type === "string") value = await client.get(k);
      else if (type === "hash") value = await client.hgetall(k);
      else if (type === "list") value = await client.lrange(k, 0, -1);
      else if (type === "set") value = await client.smembers(k);
      data.push({ key: k, type, ttl, value });
    } catch {}
  }

  if (format === "json") {
    return {
      ok: true,
      fileName: `export_redis_${Date.now()}.json`,
      contentType: "application/json",
      content: JSON.stringify(data, null, 2),
      totalRows: data.length
    };
  }
  const headers = ["key", "type", "ttl", "value"];
  const lines = [headers.join(",")];
  for (const item of data) {
    const valStr = typeof item.value === "object" ? JSON.stringify(item.value) : String(item.value ?? "");
    lines.push(`"${item.key}","${item.type}",${item.ttl},"${valStr.replace(/"/g, '""')}"`);
  }

  return {
    ok: true,
    fileName: `export_redis_${Date.now()}.csv`,
    contentType: "text/csv",
    content: lines.join("\n"),
    totalRows: data.length
  };
}
export async function importTable(
  cfg: RedisConnectionConfig,
  _tableName: string,
  format: "csv" | "json" | "sql",
  content: string,
  _mode = "append"
): Promise<DatabaseImportResponse> {
  const client = getClient(cfg);
  try {
    let items: Array<{ key: string; type?: string; value: unknown; ttl?: number }> = [];
    if (format === "json") {
      const parsed = JSON.parse(content);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i]!.split(",");
        if (parts[0]) {
          items.push({
            key: parts[0].replace(/^"|"$/g, ""),
            type: (parts[1] || "string").replace(/^"|"$/g, ""),
            value: (parts[3] || parts[2] || "").replace(/^"|"$/g, "")
          });
        }
      }
    }

    let count = 0;
    for (const item of items) {
      if (!item.key) continue;
      await insertRow(cfg, { tableName: "All Keys", row: item });
      count++;
    }

    return { success: true, importedRows: count, message: `成功导入 ${count} 个 Redis 键` };
  } catch (err) {
    return { success: false, importedRows: 0, message: err instanceof Error ? err.message : "导入失败" };
  }
}
