import type {
  DeleteInstanceFileRequest,
  DownloadInstanceFileResponse,
  ExtractInstanceArchiveRequest,
  ExtractInstanceArchiveResponse,
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

export interface DaemonNodeCredentials {
  id: string;
  protocol: string;
  host: string;
  port: number;
  tokenHash: string;
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

async function requestDaemon<T>(
  node: DaemonNodeCredentials,
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${node.protocol}://${node.host}:${node.port}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-node-id": node.id,
        "x-panel-token": node.tokenHash,
        ...options.headers
      }
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text.trim();
      try {
        const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
        message =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.error === "string"
              ? payload.error
              : message;
      } catch {
        // Keep raw text for non-JSON daemon errors.
      }
      throw new Error(`Daemon request failed (${response.status}): ${message || response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
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
