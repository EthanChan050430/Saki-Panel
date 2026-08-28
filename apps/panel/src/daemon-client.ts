import * as http from "node:http";
import * as https from "node:https";
import type {
  ArchiveInstancePathsRequest,
  ArchiveInstancePathsResponse,
  DatabaseCreateTableRequest,
  DatabaseDeleteRowRequest,
  DatabaseInsertRowRequest,
  DatabaseQueryResult,
  DatabaseRowsRequest,
  DatabaseRowsResponse,
  DatabaseTableSchema,
  DatabaseTableSummary,
  DatabaseTruncateTableRequest,
  DatabaseUpdateRowRequest,
  DeleteInstanceFileRequest,
  DiscoveredDatabase,
  DownloadInstanceArchiveRequest,
  DownloadInstanceFileResponse,
  ExtractInstanceArchiveRequest,
  ExtractInstanceArchiveResponse,
  GlobInstanceFilesRequest,
  GlobInstanceFilesResponse,
  GrepInstanceFilesRequest,
  GrepInstanceFilesResponse,
  GrepMatchLine,
  InstanceCommandRequest,
  InstanceCommandResponse,
  InstanceFileContentResponse,
  InstanceFileEntry,
  InstanceFileListResponse,
  InstanceLogsResponse,
  InstanceStatus,
  InstanceProxyConfig,
  ClashSubscriptionProxy,
  MakeInstanceDirectoryRequest,
  RenameInstanceFileRequest,
  UploadInstanceFileRequest,
  RestartPolicy,
  WriteInstanceFileRequest
} from "@webops/shared";
import { panelConfig } from "./config.js";

export interface DaemonNodeCredentials {
  id: string;
  protocol: string;
  host: string;
  port: number;
  tokenHash: string;
  os?: string | null;
}

export interface DaemonInstanceSpec {
  id: string;
  name: string;
  type: string;
  workingDirectory: string;
  startCommand: string;
  stopCommand?: string | null;
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  proxy?: InstanceProxyConfig | null;
}

export interface DaemonInstanceState {
  instanceId: string;
  status: InstanceStatus;
  exitCode?: number | null;
}

interface DaemonHttpResponse {
  statusCode: number;
  statusMessage: string;
  body: string;
}

function requestBodyToString(body: BodyInit | null | undefined): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error("Unsupported daemon request body");
}

function withProtocol(node: DaemonNodeCredentials, protocol: string): DaemonNodeCredentials {
  return node.protocol === protocol ? node : { ...node, protocol };
}

function withHost(node: DaemonNodeCredentials, host: string): DaemonNodeCredentials {
  return node.host === host ? node : { ...node, host };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function hostnameFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isPanelPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const candidates = [
    hostnameFromUrl(panelConfig.publicUrl),
    hostnameFromUrl(panelConfig.webOrigin),
    panelConfig.ssl?.hostname
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => candidate.toLowerCase());
  return candidates.includes(normalized);
}

function shouldRetryDaemonRequestAsHttps(error: unknown, node: DaemonNodeCredentials): boolean {
  if (node.protocol === "https") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /Expected HTTP|HPE_INVALID_CONSTANT|wrong version number|EPROTO|socket hang up/i.test(message);
}

function shouldRetryDaemonRequestAsHttp(error: unknown, node: DaemonNodeCredentials): boolean {
  if (node.protocol !== "https") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /wrong version number|EPROTO|socket hang up|ECONNRESET/i.test(message);
}

function shouldRetryDaemonRequestOnLoopback(error: unknown, node: DaemonNodeCredentials): boolean {
  if (isLoopbackHostname(node.host) || !isPanelPublicHostname(node.host)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EPROTO|Expected HTTP|wrong version number|socket hang up/i.test(message);
}

function requestDaemonRaw(
  node: DaemonNodeCredentials,
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<DaemonHttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${node.protocol}://${node.host}:${node.port}${path}`);
    const body = requestBodyToString(options.body);
    const headers: http.OutgoingHttpHeaders = {
      "content-type": "application/json",
      "x-node-id": node.id,
      "x-panel-token": node.tokenHash,
      ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
      ...(options.headers as http.OutgoingHttpHeaders | undefined)
    };
    const requestOptions: https.RequestOptions = {
      method: options.method ?? "GET",
      hostname: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: timeoutMs,
      ...(url.protocol === "https:" ? { rejectUnauthorized: false } : {})
    };

    const request = (url.protocol === "https:" ? https : http).request(requestOptions, (response) => {
      response.setEncoding("utf8");
      let responseBody = "";
      response.on("data", (chunk: string) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          statusMessage: response.statusMessage ?? "",
          body: responseBody
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Daemon request timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);

    if (body) request.write(body);
    request.end();
  });
}

async function requestDaemonRawWithFallback(
  node: DaemonNodeCredentials,
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<DaemonHttpResponse> {
  try {
    return await requestDaemonRaw(node, path, options, timeoutMs);
  } catch (error) {
    if (shouldRetryDaemonRequestAsHttp(error, node)) {
      return requestDaemonRaw(withProtocol(node, "http"), path, options, timeoutMs);
    }
    if (shouldRetryDaemonRequestAsHttps(error, node)) {
      return requestDaemonRaw(withProtocol(node, "https"), path, options, timeoutMs);
    }
    if (shouldRetryDaemonRequestOnLoopback(error, node)) {
      const loopbackNode = withHost(node, "127.0.0.1");
      try {
        return await requestDaemonRaw(loopbackNode, path, options, timeoutMs);
      } catch (loopbackError) {
        if (shouldRetryDaemonRequestAsHttp(loopbackError, loopbackNode)) {
          return requestDaemonRaw(withProtocol(loopbackNode, "http"), path, options, timeoutMs);
        }
        if (shouldRetryDaemonRequestAsHttps(loopbackError, loopbackNode)) {
          return requestDaemonRaw(withProtocol(loopbackNode, "https"), path, options, timeoutMs);
        }
        throw loopbackError;
      }
    }
    throw error;
  }
}

function requestDaemonRawBinary(
  node: DaemonNodeCredentials,
  path: string,
  options: RequestInit = {},
  timeoutMs = 0
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${node.protocol}://${node.host}:${node.port}${path}`);
    const body = requestBodyToString(options.body);
    const headers: http.OutgoingHttpHeaders = {
      "x-node-id": node.id,
      "x-panel-token": node.tokenHash,
      ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
      ...(options.headers as http.OutgoingHttpHeaders | undefined)
    };
    const requestOptions: https.RequestOptions = {
      method: options.method ?? "GET",
      hostname: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: timeoutMs,
      ...(url.protocol === "https:" ? { rejectUnauthorized: false } : {})
    };

    const request = (url.protocol === "https:" ? https : http).request(requestOptions, (response) => {
      resolve(response);
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Daemon request timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);

    if (body) request.write(body);
    request.end();
  });
}

async function requestDaemonRawBinaryWithFallback(
  node: DaemonNodeCredentials,
  path: string,
  options: RequestInit = {},
  timeoutMs = 0
): Promise<http.IncomingMessage> {
  try {
    return await requestDaemonRawBinary(node, path, options, timeoutMs);
  } catch (error) {
    if (shouldRetryDaemonRequestAsHttp(error, node)) {
      return requestDaemonRawBinary(withProtocol(node, "http"), path, options, timeoutMs);
    }
    if (shouldRetryDaemonRequestAsHttps(error, node)) {
      return requestDaemonRawBinary(withProtocol(node, "https"), path, options, timeoutMs);
    }
    if (shouldRetryDaemonRequestOnLoopback(error, node)) {
      const loopbackNode = withHost(node, "127.0.0.1");
      try {
        return await requestDaemonRawBinary(loopbackNode, path, options, timeoutMs);
      } catch (loopbackError) {
        if (shouldRetryDaemonRequestAsHttp(loopbackError, loopbackNode)) {
          return requestDaemonRawBinary(withProtocol(loopbackNode, "http"), path, options, timeoutMs);
        }
        if (shouldRetryDaemonRequestAsHttps(loopbackError, loopbackNode)) {
          return requestDaemonRawBinary(withProtocol(loopbackNode, "https"), path, options, timeoutMs);
        }
        throw loopbackError;
      }
    }
    throw error;
  }
}

export async function requestDaemon<T>(
  node: DaemonNodeCredentials,
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<T> {
  const response = await requestDaemonRawWithFallback(node, path, options, timeoutMs);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    let message = response.body.trim();
    try {
      const payload = JSON.parse(response.body) as { message?: unknown; error?: unknown };
      message =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.error === "string"
            ? payload.error
            : message;
    } catch {
      // Keep raw text for non-JSON daemon errors.
    }
    throw new Error(`Daemon request failed (${response.statusCode}): ${message || response.statusMessage}`);
  }

  return (response.body ? JSON.parse(response.body) : undefined) as T;
}

function pathWithQuery(pathname: string, query: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const queryString = search.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function fetchDaemonClashSubscription(node: DaemonNodeCredentials, instanceId: string, url: string) {
  return requestDaemon<{ proxies: ClashSubscriptionProxy[] }>(
    node,
    `/api/instances/${instanceId}/proxy/subscription`,
    { method: "POST", body: JSON.stringify({ url }) },
    45000
  );
}

export function applyDaemonClashSubscription(
  node: DaemonNodeCredentials,
  instanceId: string,
  input: { url: string; selectedProxy: string }
) {
  return requestDaemon<{ port: number; selectedProxy: string; proxies: ClashSubscriptionProxy[] }>(
    node,
    `/api/instances/${instanceId}/proxy/subscription/apply`,
    { method: "POST", body: JSON.stringify(input) },
    90000
  );
}

export function stopDaemonClashSubscription(node: DaemonNodeCredentials, instanceId: string) {
  return requestDaemon<{ ok: boolean }>(
    node,
    `/api/instances/${instanceId}/proxy/subscription/stop`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function startDaemonInstance(node: DaemonNodeCredentials, spec: DaemonInstanceSpec) {
  return requestDaemon<DaemonInstanceState>(node, `/api/instances/${spec.id}/start`, {
    method: "POST",
    body: JSON.stringify(spec)
  });
}

export function stopDaemonInstance(node: DaemonNodeCredentials, spec: Pick<DaemonInstanceSpec, "id" | "stopCommand">) {
  return requestDaemon<DaemonInstanceState>(node, `/api/instances/${spec.id}/stop`, {
    method: "POST",
    body: JSON.stringify(spec)
  });
}

export function restartDaemonInstance(node: DaemonNodeCredentials, spec: DaemonInstanceSpec) {
  return requestDaemon<DaemonInstanceState>(node, `/api/instances/${spec.id}/restart`, {
    method: "POST",
    body: JSON.stringify(spec)
  });
}

export function killDaemonInstance(node: DaemonNodeCredentials, instanceId: string) {
  return requestDaemon<DaemonInstanceState>(node, `/api/instances/${instanceId}/kill`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function sendDaemonInstanceInput(
  node: DaemonNodeCredentials,
  instanceId: string,
  data: string,
  options: { echo?: boolean } = {}
) {
  return requestDaemon<DaemonInstanceState>(node, `/api/instances/${instanceId}/input`, {
    method: "POST",
    body: JSON.stringify({ data, echo: options.echo })
  });
}

export function runDaemonInstanceCommand(node: DaemonNodeCredentials, instanceId: string, input: InstanceCommandRequest) {
  return requestDaemon<InstanceCommandResponse>(node, `/api/instances/${instanceId}/command`, {
    method: "POST",
    body: JSON.stringify(input)
  }, Math.max(10000, (input.timeoutMs ?? 30000) + 5000));
}

export function readDaemonInstanceLogs(node: DaemonNodeCredentials, instanceId: string, lines = 200) {
  return requestDaemon<InstanceLogsResponse>(node, `/api/instances/${instanceId}/logs?lines=${lines}`);
}

export function readDaemonInstanceStatus(node: DaemonNodeCredentials, instanceId: string, timeoutMs = 2500) {
  return requestDaemon<DaemonInstanceState>(node, `/api/instances/${instanceId}/status`, {}, timeoutMs);
}

export async function testDaemonHealth(node: DaemonNodeCredentials, timeoutMs = 5000) {
  const response = await requestDaemonRawWithFallback(node, "/health", {}, timeoutMs);
  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    statusCode: response.statusCode
  };
}

export function listDaemonInstanceFiles(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  relativePath: string,
  options: { limit?: number } = {}
) {
  return requestDaemon<InstanceFileListResponse>(
    node,
    pathWithQuery(`/api/instances/${instanceId}/files`, {
      workingDirectory,
      path: relativePath,
      limit: options.limit
    })
  );
}

export function readDaemonInstanceFile(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  relativePath: string,
  options: { startLine?: number; lineCount?: number; outline?: boolean; stat?: boolean } = {}
) {
  return requestDaemon<InstanceFileContentResponse>(
    node,
    pathWithQuery(`/api/instances/${instanceId}/files/content`, {
      workingDirectory,
      path: relativePath,
      ...(options.startLine ? { startLine: options.startLine } : {}),
      ...(options.lineCount ? { lineCount: options.lineCount } : {}),
      ...(options.outline ? { outline: 1 } : {}),
      ...(options.stat ? { stat: 1 } : {})
    })
  );
}

export function statDaemonInstancePath(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  relativePath: string
) {
  return readDaemonInstanceFile(node, instanceId, workingDirectory, relativePath, { stat: true });
}

export function writeDaemonInstanceFile(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: WriteInstanceFileRequest
) {
  return requestDaemon<InstanceFileContentResponse>(node, `/api/instances/${instanceId}/files/content`, {
    method: "PUT",
    body: JSON.stringify({
      workingDirectory,
      ...input
    })
  });
}

export function uploadDaemonInstanceFile(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: UploadInstanceFileRequest
) {
  return requestDaemon<InstanceFileEntry>(node, `/api/instances/${instanceId}/files/upload`, {
    method: "POST",
    body: JSON.stringify({
      workingDirectory,
      ...input
    })
  });
}

export function downloadDaemonInstanceFile(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  relativePath: string
) {
  return requestDaemon<DownloadInstanceFileResponse>(
    node,
    pathWithQuery(`/api/instances/${instanceId}/files/download`, {
      workingDirectory,
      path: relativePath
    })
  );
}

export function makeDaemonInstanceDirectory(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: MakeInstanceDirectoryRequest
) {
  return requestDaemon<InstanceFileEntry>(node, `/api/instances/${instanceId}/files/mkdir`, {
    method: "POST",
    body: JSON.stringify({
      workingDirectory,
      ...input
    })
  });
}

export function deleteDaemonInstancePath(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: DeleteInstanceFileRequest
) {
  return requestDaemon<{ ok: boolean }>(node, `/api/instances/${instanceId}/files`, {
    method: "DELETE",
    body: JSON.stringify({
      workingDirectory,
      ...input
    })
  });
}

export function renameDaemonInstancePath(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: RenameInstanceFileRequest
) {
  return requestDaemon<InstanceFileEntry>(node, `/api/instances/${instanceId}/files/rename`, {
    method: "POST",
    body: JSON.stringify({
      workingDirectory,
      ...input
    })
  });
}

export function copyDaemonInstancePath(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: { fromPath: string; toPath: string }
) {
  return requestDaemon<InstanceFileEntry>(node, `/api/instances/${instanceId}/files/copy`, {
    method: "POST",
    body: JSON.stringify({
      workingDirectory,
      ...input
    })
  });
}

export function extractDaemonInstanceArchive(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: ExtractInstanceArchiveRequest
) {
  return requestDaemon<ExtractInstanceArchiveResponse>(
    node,
    `/api/instances/${instanceId}/files/extract`,
    {
      method: "POST",
      body: JSON.stringify({
        workingDirectory,
        ...input
      })
    },
    900000
  );
}

export function archiveDaemonInstancePaths(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: ArchiveInstancePathsRequest
) {
  return requestDaemon<ArchiveInstancePathsResponse>(
    node,
    `/api/instances/${instanceId}/files/archive`,
    {
      method: "POST",
      body: JSON.stringify({
        workingDirectory,
        ...input
      })
    },
    900000
  );
}

export function downloadDaemonInstanceArchive(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: DownloadInstanceArchiveRequest
) {
  return requestDaemon<DownloadInstanceFileResponse>(
    node,
    `/api/instances/${instanceId}/files/archive/download`,
    {
      method: "POST",
      body: JSON.stringify({
        workingDirectory,
        ...input
      })
    },
    900000
  );
}

export function grepDaemonInstanceFiles(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: GrepInstanceFilesRequest
) {
  return requestDaemon<GrepInstanceFilesResponse>(node, `/api/instances/${instanceId}/files/grep`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      workingDirectory
    })
  }, 30000);
}

export function globDaemonInstanceFiles(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: GlobInstanceFilesRequest
) {
  return requestDaemon<GlobInstanceFilesResponse>(node, `/api/instances/${instanceId}/files/glob`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      workingDirectory
    })
  }, 30000);
}

export async function getDaemonFileDownloadStream(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  relativePath: string
): Promise<http.IncomingMessage> {
  const downloadPath = pathWithQuery(`/api/instances/${instanceId}/files/download`, {
    workingDirectory,
    path: relativePath,
    raw: "1"
  });
  const headers = { "x-raw-download": "1" };
  return requestDaemonRawBinaryWithFallback(node, downloadPath, { headers }, 0);
}

export async function getDaemonArchiveDownloadStream(
  node: DaemonNodeCredentials,
  instanceId: string,
  workingDirectory: string,
  input: DownloadInstanceArchiveRequest
): Promise<http.IncomingMessage> {
  const archivePath = `/api/instances/${instanceId}/files/archive/download`;
  const headers = { "x-raw-download": "1" };
  return requestDaemonRawBinaryWithFallback(
    node,
    archivePath,
    {
      method: "POST",
      body: JSON.stringify({ workingDirectory, ...input }),
      headers
    },
    0
  );
}

export function createDaemonInstanceShell(node: DaemonNodeCredentials, instanceId: string, workingDirectory?: string) {
  return requestDaemon<{ sessionId: string }>(node, `/api/instances/${instanceId}/shells`, {
    method: "POST",
    body: workingDirectory ? JSON.stringify({ workingDirectory }) : JSON.stringify({})
  });
}

export function listDaemonInstanceShells(node: DaemonNodeCredentials, instanceId: string) {
  return requestDaemon<{ instanceId: string; sessions: string[] }>(node, `/api/instances/${instanceId}/shells`);
}

export function sendDaemonShellInput(node: DaemonNodeCredentials, instanceId: string, shellId: string, data: string, options: { echo?: boolean } = {}) {
  return requestDaemon<{ ok: boolean }>(node, `/api/instances/${instanceId}/shells/${shellId}/input`, {
    method: "POST",
    body: JSON.stringify({ data, echo: options.echo })
  });
}

export function discoverDaemonDatabases(node: DaemonNodeCredentials) {
  return requestDaemon<{ ok: boolean; databases: DiscoveredDatabase[] }>(
    node,
    "/api/databases/discover",
    { method: "GET" }
  );
}

// Common connection payload for both SQLite and MySQL
export interface DaemonDatabaseConnPayload {
  path?: string | null | undefined;
  host?: string | null | undefined;
  port?: number | null | undefined;
  engine?: string | null | undefined;
  user?: string | null | undefined;
  password?: string | null | undefined;
  database?: string | null | undefined;
}

export function listDaemonDatabaseTables(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload) {
  return requestDaemon<{ ok: boolean; tables: DatabaseTableSummary[] }>(
    node,
    "/api/databases/tables",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function getDaemonDatabaseTableSchema(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & { tableName: string }) {
  return requestDaemon<{ ok: boolean; schema: DatabaseTableSchema }>(
    node,
    "/api/databases/tables/schema",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function queryDaemonDatabaseTableRows(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & DatabaseRowsRequest) {
  return requestDaemon<{ ok: boolean } & DatabaseRowsResponse>(
    node,
    "/api/databases/tables/rows",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function insertDaemonDatabaseTableRow(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & DatabaseInsertRowRequest) {
  return requestDaemon<{ ok: boolean; lastInsertRowId?: string | undefined; affectedRows?: number | undefined }>(
    node,
    "/api/databases/tables/insert",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function updateDaemonDatabaseTableRow(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & DatabaseUpdateRowRequest) {
  return requestDaemon<{ ok: boolean; affectedRows?: number | undefined }>(
    node,
    "/api/databases/tables/update",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function deleteDaemonDatabaseTableRow(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & DatabaseDeleteRowRequest) {
  return requestDaemon<{ ok: boolean; affectedRows?: number | undefined }>(
    node,
    "/api/databases/tables/delete",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function createDaemonDatabaseTable(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & DatabaseCreateTableRequest) {
  return requestDaemon<{ ok: boolean; ddl?: string | undefined }>(
    node,
    "/api/databases/tables/create",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function dropDaemonDatabaseTable(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & { tableName: string }) {
  return requestDaemon<{ ok: boolean }>(
    node,
    "/api/databases/tables/drop",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function truncateDaemonDatabaseTable(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & DatabaseTruncateTableRequest) {
  return requestDaemon<{ ok: boolean; affectedRows?: number | undefined }>(
    node,
    "/api/databases/tables/truncate",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function executeDaemonDatabaseQuery(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & { sql: string; maxRows?: number | undefined }) {
  return requestDaemon<{ ok: boolean; result: DatabaseQueryResult }>(
    node,
    "/api/databases/query",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function exportDaemonDatabaseData(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & { tableName?: string | null | undefined; format: "csv" | "json" | "sql" }) {
  return requestDaemon<{ ok: boolean; fileName: string; contentType: string; content: string; totalRows?: number | undefined }>(
    node,
    "/api/databases/export",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function importDaemonDatabaseData(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload & { tableName?: string | null | undefined; format: "csv" | "json" | "sql"; content: string; mode?: "append" | "replace" | undefined }) {
  return requestDaemon<{ ok: boolean; importedRows: number; message?: string | undefined }>(
    node,
    "/api/databases/import",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function getDaemonDatabaseStats(node: DaemonNodeCredentials, payload: DaemonDatabaseConnPayload) {
  return requestDaemon<{
    ok: boolean;
    latencyMs?: number;
    version?: string;
    tableCount?: number;
    sizeBytes?: number;
    totalKeys?: number;
    memory?: string;
    clients?: number;
    uptimeDays?: number;
    message?: string;
  }>(
    node,
    "/api/databases/stats",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

