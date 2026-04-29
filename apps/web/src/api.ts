import type {
  CurrentUser,
  DashboardOverview,
  DeleteAuditLogsRequest,
  DeleteAuditLogsResponse,
  DownloadInstanceFileResponse,
  ExtractInstanceArchiveResponse,
  AuditLogEntry,
  CreateNodeRequest,
  CreateNodeResponse,
  CreateInstanceRequest,
  CreateInstanceFromTemplateRequest,
  CreateUserRequest,
  InstanceAssignee,
  InstanceActionResponse,
  InstanceFileContentResponse,
  InstanceFileEntry,
  InstanceFileListResponse,
  InstanceTemplate,
  InstanceLogsResponse,
  LoginRequest,
  LoginResponse,
  ManagedInstance,
  ManagedNode,
  ManagedRole,
  ManagedScheduledTask,
  ManagedTaskRun,
  ManagedUser,
  PanelAppearanceSettings,
  PanelSessionSettings,
  SakiChatRequest,
  SakiChatResponse,
  SakiConfigResponse,
  SakiModelListResponse,
  SakiAgentAction,
  SakiActionDecisionResponse,
  SakiSkillDetail,
  SakiSkillSummary,
  SakiStatusResponse,
  CreateSakiSkillRequest,
  DownloadSakiSkillRequest,
  UpdateSakiConfigRequest,
  UpdateSakiSkillRequest,
  UpdateRolePermissionsRequest,
  UpdateCurrentUserRequest,
  UpdatePanelSessionSettingsRequest,
  UpdateUserRequest,
  UpdateInstanceRequest,
  UpdateNodeRequest,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest
} from "@webops/shared";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function defaultApiBase(): string {
  return `${window.location.protocol}//${window.location.hostname}:5479`;
}

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!configured) return defaultApiBase();

  try {
    const url = new URL(configured, window.location.origin);
    if (isLoopbackHostname(url.hostname) && !isLoopbackHostname(window.location.hostname)) {
      return defaultApiBase();
    }
    return url.toString();
  } catch {
    return defaultApiBase();
  }
}

const API_BASE = resolveApiBase();

function webSocketUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function pathWithQuery(pathname: string, params: Record<string, string | undefined>): string {
  const url = new URL(pathname, API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

function normalizeApiErrorMessage(message: string, status: number): string {
  if (status === 403 && message.trim().toLowerCase() === "forbidden") {
    return "当前账号没有权限访问该功能";
  }
  return message;
}

async function requestJson<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(new URL(path, API_BASE), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message ?? message;
    } catch {
      // Keep the generic message when the response has no JSON body.
    }
    throw new ApiError(normalizeApiErrorMessage(message, response.status), response.status);
  }

  return (await response.json()) as T;
}

export type SakiChatWorkflowStatus = "running" | "completed" | "failed" | "pending";

export interface SakiChatWorkflowUpdate {
  id: string;
  stage: string;
  message: string;
  status: SakiChatWorkflowStatus;
  tool?: string;
  call?: string;
  actionId?: string;
  detail?: string;
}

export type SakiChatStreamEvent =
  | {
      type: "meta";
      source: SakiChatResponse["source"];
      mode?: SakiChatRequest["mode"];
      workspace?: SakiChatResponse["workspace"];
      skills?: SakiSkillSummary[];
    }
  | ({ type: "workflow" } & SakiChatWorkflowUpdate)
  | { type: "delta"; text: string }
  | { type: "action"; action: SakiAgentAction }
  | { type: "done"; response: SakiChatResponse };

function parseSakiStreamFrame(frame: string): SakiChatStreamEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  return JSON.parse(data) as SakiChatStreamEvent;
}

async function responseErrorMessage(response: Response): Promise<string> {
  let message = `Request failed with ${response.status}`;
  try {
    const payload = (await response.json()) as { message?: string };
    message = payload.message ?? message;
  } catch {
    // Keep the generic message when the response has no JSON body.
  }
  return normalizeApiErrorMessage(message, response.status);
}

async function requestSakiChatStream(
  token: string,
  input: SakiChatRequest,
  onEvent: (event: SakiChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<SakiChatResponse> {
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(input)
  };
  if (signal) {
    requestInit.signal = signal;
  }
  const response = await fetch(new URL("/api/saki/chat/stream", API_BASE), requestInit);

  if (!response.ok) {
    throw new ApiError(await responseErrorMessage(response), response.status);
  }
  if (!response.body) {
    throw new ApiError("Saki stream response is not readable", 0);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: SakiChatResponse | null = null;

  const dispatch = (frame: string) => {
    const event = parseSakiStreamFrame(frame);
    if (!event) return;
    onEvent(event);
    if (event.type === "done") {
      finalResponse = event.response;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    const tail = decoder.decode();
    if (tail) buffer += tail.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (buffer.trim()) dispatch(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!finalResponse) {
    throw new ApiError("Saki stream ended before completion", 0);
  }
  return finalResponse;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UploadProgressUpdate {
  percent: number;
  label: string;
}

function xhrJson<T>(
  path: string,
  body: string,
  token: string,
  onUploadProgress?: (progress: UploadProgressUpdate) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", new URL(path, API_BASE).toString());
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader("authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        onUploadProgress?.({ percent: 45, label: "上传中" });
        return;
      }
      const uploadedPercent = Math.round((event.loaded / event.total) * 58);
      onUploadProgress?.({ percent: Math.min(94, 36 + uploadedPercent), label: "上传中" });
    };

    xhr.onerror = () => reject(new ApiError("网络连接失败，上传未完成", 0));
    xhr.onabort = () => reject(new ApiError("上传已取消", 0));
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        // Keep payload null when the daemon returns non-JSON text.
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof payload.message === "string"
            ? payload.message
            : `Request failed with ${xhr.status}`;
        reject(new ApiError(message, xhr.status));
        return;
      }

      onUploadProgress?.({ percent: 100, label: "完成" });
      resolve(payload as T);
    };

    onUploadProgress?.({ percent: 35, label: "准备上传" });
    xhr.send(body);
  });
}

function readFileAsBase64(file: File, onProgress?: (progress: UploadProgressUpdate) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (!event.lengthComputable) {
        onProgress?.({ percent: 12, label: "读取文件" });
        return;
      }
      onProgress?.({ percent: Math.max(2, Math.round((event.loaded / event.total) * 32)), label: "读取文件" });
    };
    reader.onerror = () => reject(new ApiError("文件读取失败", 0));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      onProgress?.({ percent: 34, label: "读取完成" });
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    onProgress?.({ percent: 1, label: "读取文件" });
    reader.readAsDataURL(file);
  });
}

export const api = {
  login(input: LoginRequest) {
    return requestJson<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  me(token: string) {
    return requestJson<CurrentUser>("/api/auth/me", {}, token);
  },
  updateProfile(token: string, input: UpdateCurrentUserRequest) {
    return requestJson<CurrentUser>("/api/auth/profile", { method: "PUT", body: JSON.stringify(input) }, token);
  },
  refreshSession(token: string) {
    return requestJson<LoginResponse>("/api/auth/refresh", { method: "POST", body: JSON.stringify({}) }, token);
  },
  sessionSettings(token: string) {
    return requestJson<PanelSessionSettings>("/api/system/session-settings", {}, token);
  },
  updateSessionSettings(token: string, input: UpdatePanelSessionSettingsRequest) {
    return requestJson<PanelSessionSettings>(
      "/api/system/session-settings",
      { method: "PUT", body: JSON.stringify(input) },
      token
    );
  },
  dashboard(token: string) {
    return requestJson<DashboardOverview>("/api/dashboard/overview", {}, token);
  },
  nodes(token: string) {
    return requestJson<ManagedNode[]>("/api/nodes", {}, token);
  },
  createNode(token: string, input: CreateNodeRequest) {
    return requestJson<CreateNodeResponse>(
      "/api/nodes",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  updateNode(token: string, id: string, input: UpdateNodeRequest) {
    return requestJson<ManagedNode>(
      `/api/nodes/${id}`,
      { method: "PUT", body: JSON.stringify(input) },
      token
    );
  },
  deleteNode(token: string, id: string) {
    return requestJson<{ ok: boolean }>(
      `/api/nodes/${id}`,
      { method: "DELETE", body: JSON.stringify({}) },
      token
    );
  },
  instances(token: string) {
    return requestJson<ManagedInstance[]>("/api/instances", {}, token);
  },
  instanceAssignees(token: string) {
    return requestJson<InstanceAssignee[]>("/api/instances/assignees", {}, token);
  },
  createInstance(token: string, input: CreateInstanceRequest) {
    return requestJson<ManagedInstance>(
      "/api/instances",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  updateInstance(token: string, id: string, input: UpdateInstanceRequest) {
    return requestJson<ManagedInstance>(
      `/api/instances/${id}`,
      { method: "PUT", body: JSON.stringify(input) },
      token
    );
  },
  deleteInstance(token: string, id: string) {
    return requestJson<{ ok: boolean }>(
      `/api/instances/${id}`,
      { method: "DELETE", body: JSON.stringify({}) },
      token
    );
  },
  startInstance(token: string, id: string) {
    return requestJson<InstanceActionResponse>(
      `/api/instances/${id}/start`,
      { method: "POST", body: JSON.stringify({}) },
      token
    );
  },
  stopInstance(token: string, id: string) {
    return requestJson<InstanceActionResponse>(
      `/api/instances/${id}/stop`,
      { method: "POST", body: JSON.stringify({}) },
      token
    );
  },
  restartInstance(token: string, id: string) {
    return requestJson<InstanceActionResponse>(
      `/api/instances/${id}/restart`,
      { method: "POST", body: JSON.stringify({}) },
      token
    );
  },
  killInstance(token: string, id: string) {
    return requestJson<InstanceActionResponse>(
      `/api/instances/${id}/kill`,
      { method: "POST", body: JSON.stringify({}) },
      token
    );
  },
  instanceLogs(token: string, id: string) {
    return requestJson<InstanceLogsResponse>(`/api/instances/${id}/logs?lines=300`, {}, token);
  },
  listInstanceFiles(token: string, id: string, path: string) {
    return requestJson<InstanceFileListResponse>(
      pathWithQuery(`/api/instances/${id}/files`, { path }),
      {},
      token
    );
  },
  readInstanceFile(token: string, id: string, path: string) {
    return requestJson<InstanceFileContentResponse>(
      pathWithQuery(`/api/instances/${id}/files/content`, { path }),
      {},
      token
    );
  },
  writeInstanceFile(token: string, id: string, path: string, content: string) {
    return requestJson<InstanceFileContentResponse>(
      `/api/instances/${id}/files/content`,
      {
        method: "PUT",
        body: JSON.stringify({ path, content })
      },
      token
    );
  },
  uploadInstanceFile(token: string, id: string, path: string, contentBase64: string, overwrite = true) {
    return requestJson<InstanceFileEntry>(
      `/api/instances/${id}/files/upload`,
      {
        method: "POST",
        body: JSON.stringify({ path, contentBase64, overwrite })
      },
      token
    );
  },
  async uploadInstanceFileMultipart(
    token: string,
    id: string,
    path: string,
    file: File,
    overwrite: boolean,
    onProgress?: (progress: UploadProgressUpdate) => void
  ) {
    const formData = new FormData();
    formData.append("path", path);
    formData.append("overwrite", String(overwrite));
    formData.append("file", file);

    return new Promise<InstanceFileEntry>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", new URL(`/api/instances/${id}/files/upload`, API_BASE).toString());
      xhr.setRequestHeader("authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          onProgress?.({ percent: 50, label: "上传中" });
          return;
        }
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress?.({ percent, label: "上传中" });
      };

      xhr.onerror = () => reject(new ApiError("网络连接失败，上传未完成", 0));
      xhr.onabort = () => reject(new ApiError("上传已取消", 0));
      xhr.onload = () => {
        let payload: unknown = null;
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          // Keep payload null for non-JSON responses.
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "message" in payload &&
            typeof payload.message === "string"
              ? payload.message
              : `Request failed with ${xhr.status}`;
          reject(new ApiError(normalizeApiErrorMessage(message, xhr.status), xhr.status));
          return;
        }

        onProgress?.({ percent: 100, label: "完成" });
        resolve(payload as InstanceFileEntry);
      };

      onProgress?.({ percent: 0, label: "准备上传" });
      xhr.send(formData);
    });
  },
  async uploadInstanceFileWithProgress(
    token: string,
    id: string,
    path: string,
    file: File,
    overwrite: boolean,
    onProgress?: (progress: UploadProgressUpdate) => void
  ) {
    return this.uploadInstanceFileMultipart(token, id, path, file, overwrite, onProgress);
  },
  downloadInstanceFile(token: string, id: string, path: string) {
    return requestJson<DownloadInstanceFileResponse>(
      pathWithQuery(`/api/instances/${id}/files/download`, { path }),
      {},
      token
    );
  },
  makeInstanceDirectory(token: string, id: string, path: string) {
    return requestJson<InstanceFileEntry>(
      `/api/instances/${id}/files/mkdir`,
      { method: "POST", body: JSON.stringify({ path }) },
      token
    );
  },
  deleteInstancePath(token: string, id: string, path: string) {
    return requestJson<{ ok: boolean }>(
      `/api/instances/${id}/files`,
      { method: "DELETE", body: JSON.stringify({ path }) },
      token
    );
  },
  renameInstancePath(token: string, id: string, fromPath: string, toPath: string) {
    return requestJson<InstanceFileEntry>(
      `/api/instances/${id}/files/rename`,
      { method: "POST", body: JSON.stringify({ fromPath, toPath }) },
      token
    );
  },
  extractInstanceArchive(token: string, id: string, path: string, outputPath?: string) {
    return requestJson<ExtractInstanceArchiveResponse>(
      `/api/instances/${id}/files/extract`,
      {
        method: "POST",
        body: JSON.stringify({ path, ...(outputPath ? { outputPath } : {}) })
      },
      token
    );
  },
  tasks(token: string, instanceId?: string) {
    return requestJson<ManagedScheduledTask[]>(
      pathWithQuery("/api/tasks", { instanceId }),
      {},
      token
    );
  },
  createTask(token: string, input: CreateScheduledTaskRequest) {
    return requestJson<ManagedScheduledTask>(
      "/api/tasks",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  updateTask(token: string, id: string, input: UpdateScheduledTaskRequest) {
    return requestJson<ManagedScheduledTask>(
      `/api/tasks/${id}`,
      { method: "PUT", body: JSON.stringify(input) },
      token
    );
  },
  deleteTask(token: string, id: string) {
    return requestJson<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE", body: JSON.stringify({}) }, token);
  },
  runTask(token: string, id: string) {
    return requestJson<ManagedTaskRun>(`/api/tasks/${id}/run`, { method: "POST", body: JSON.stringify({}) }, token);
  },
  taskRuns(token: string, id: string) {
    return requestJson<ManagedTaskRun[]>(`/api/tasks/${id}/runs`, {}, token);
  },
  auditLogs(token: string, page: number = 1, limit: number = 20) {
    return requestJson<PaginatedResult<AuditLogEntry>>(`/api/audit/logs?page=${page}&limit=${limit}`, {}, token);
  },
  deleteAuditLog(token: string, id: string) {
    return requestJson<DeleteAuditLogsResponse>(`/api/audit/logs/${id}`, { method: "DELETE" }, token);
  },
  deleteAuditLogs(token: string, ids: string[]) {
    const input: DeleteAuditLogsRequest = { ids };
    return requestJson<DeleteAuditLogsResponse>(
      "/api/audit/logs/delete",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  clearAuditLogs(token: string) {
    return requestJson<DeleteAuditLogsResponse>("/api/audit/logs", { method: "DELETE" }, token);
  },
  users(token: string) {
    return requestJson<ManagedUser[]>("/api/users", {}, token);
  },
  createUser(token: string, input: CreateUserRequest) {
    return requestJson<ManagedUser>("/api/users", { method: "POST", body: JSON.stringify(input) }, token);
  },
  updateUser(token: string, id: string, input: UpdateUserRequest) {
    return requestJson<ManagedUser>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(input) }, token);
  },
  switchUser(token: string, id: string) {
    return requestJson<LoginResponse>(`/api/users/${id}/switch`, { method: "POST", body: JSON.stringify({}) }, token);
  },
  roles(token: string) {
    return requestJson<ManagedRole[]>("/api/roles", {}, token);
  },
  updateRolePermissions(token: string, id: string, input: UpdateRolePermissionsRequest) {
    return requestJson<ManagedRole>(
      `/api/roles/${id}/permissions`,
      { method: "PUT", body: JSON.stringify(input) },
      token
    );
  },
  templates(token: string) {
    return requestJson<InstanceTemplate[]>("/api/templates", {}, token);
  },
  createInstanceFromTemplate(token: string, templateId: string, input: CreateInstanceFromTemplateRequest) {
    return requestJson<ManagedInstance>(
      `/api/templates/${templateId}/instances`,
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  terminalUrl() {
    return webSocketUrl("/ws/terminal", {});
  },
  sakiStatus(token: string) {
    return requestJson<SakiStatusResponse>("/api/saki/status", {}, token);
  },
  sakiAppearance() {
    return requestJson<PanelAppearanceSettings>("/api/saki/appearance");
  },
  sakiSkills(token: string, query = "") {
    return requestJson<SakiSkillSummary[]>(pathWithQuery("/api/saki/skills", { q: query || undefined }), {}, token);
  },
  sakiAllSkills(token: string) {
    return requestJson<SakiSkillSummary[]>(pathWithQuery("/api/saki/skills", { all: "1" }), {}, token);
  },
  sakiSkill(token: string, id: string) {
    return requestJson<SakiSkillDetail>(`/api/saki/skills/${id}`, {}, token);
  },
  createSakiSkill(token: string, input: CreateSakiSkillRequest) {
    return requestJson<SakiSkillDetail>(
      "/api/saki/skills",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  updateSakiSkill(token: string, id: string, input: UpdateSakiSkillRequest) {
    return requestJson<SakiSkillDetail>(
      `/api/saki/skills/${id}`,
      { method: "PUT", body: JSON.stringify(input) },
      token
    );
  },
  deleteSakiSkill(token: string, id: string) {
    return requestJson<{ ok: boolean }>(
      `/api/saki/skills/${id}`,
      { method: "DELETE", body: JSON.stringify({}) },
      token
    );
  },
  downloadSakiSkill(token: string, input: DownloadSakiSkillRequest) {
    return requestJson<SakiSkillDetail>(
      "/api/saki/skills/download",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  sakiChat(token: string, input: SakiChatRequest) {
    return requestJson<SakiChatResponse>(
      "/api/saki/chat",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  sakiChatStream(token: string, input: SakiChatRequest, onEvent: (event: SakiChatStreamEvent) => void, signal?: AbortSignal) {
    return requestSakiChatStream(token, input, onEvent, signal);
  },
  sakiAction(token: string, id: string, decision: "approve" | "reject" | "rollback") {
    return requestJson<SakiActionDecisionResponse>(
      `/api/saki/actions/${id}/${decision}`,
      { method: "POST", body: JSON.stringify({}) },
      token
    );
  },
  sakiConfig(token: string) {
    return requestJson<SakiConfigResponse>("/api/saki/config", {}, token);
  },
  updateSakiConfig(token: string, input: UpdateSakiConfigRequest) {
    return requestJson<SakiConfigResponse>(
      "/api/saki/config",
      { method: "PUT", body: JSON.stringify(input) },
      token
    );
  },
  sakiModels(token: string, input: UpdateSakiConfigRequest) {
    return requestJson<SakiModelListResponse>(
      "/api/saki/models",
      { method: "POST", body: JSON.stringify(input) },
      token
    );
  },
  testNode(token: string, id: string) {
    return requestJson<{ ok: boolean; statusCode?: number; error?: string }>(
      `/api/nodes/${id}/test`,
      { method: "POST", body: JSON.stringify({}) },
      token
    );
  },
  logout(token: string) {
    return requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }, token);
  }
};
