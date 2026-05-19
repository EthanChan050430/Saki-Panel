import * as http from "node:http";
import * as https from "node:https";
import type {
  ArchiveInstancePathsRequest,
  ArchiveInstancePathsResponse,
  DeleteInstanceFileRequest,
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

async function requestDaemon<T>(
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
  relativePath: string
) {
  return requestDaemon<InstanceFileContentResponse>(
    node,
    pathWithQuery(`/api/instances/${instanceId}/files/content`, {
      workingDirectory,
      path: relativePath
    })
  );
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
    300000
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
    300000
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
    300000
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
