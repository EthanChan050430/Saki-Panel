export const PANEL_VERSION = "0.1.0";

export const permissions = [
  "dashboard.view",
  "node.view",
  "node.create",
  "node.update",
  "node.delete",
  "node.test",
  "instance.view",
  "instance.create",
  "instance.update",
  "instance.delete",
  "instance.start",
  "instance.stop",
  "instance.restart",
  "instance.kill",
  "instance.logs",
  "terminal.view",
  "terminal.input",
  "file.view",
  "file.read",
  "file.write",
  "file.delete",
  "task.view",
  "task.create",
  "task.update",
  "task.delete",
  "task.run",
  "template.view",
  "template.create",
  "user.view",
  "user.create",
  "user.update",
  "role.view",
  "role.update",
  "audit.view",
  "saki.use",
  "saki.skills",
  "saki.configure",
  "system.view"
] as const;

export type PermissionCode = (typeof permissions)[number];

export type UserStatus = "ACTIVE" | "DISABLED";
export type NodeStatus = "UNKNOWN" | "ONLINE" | "OFFLINE";
export type InstanceStatus = "CREATED" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "CRASHED" | "UNKNOWN";
export type RestartPolicy = "never" | "on_failure" | "always" | "fixed_interval";
export type InstanceOwnerRole = "super_admin" | "admin" | "user";
export type InstanceType =
  | "generic_command"
  | "nodejs"
  | "python"
  | "java_jar"
  | "shell_script"
  | "docker_container"
  | "docker_compose"
  | "minecraft"
  | "steam_game_server";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarDataUrl?: string | null | undefined;
  status: UserStatus;
  permissions: PermissionCode[];
  roleNames: string[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface ManagedRole {
  id: string;
  name: string;
  description?: string | null | undefined;
  permissions: PermissionCode[];
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  status: UserStatus;
  roleIds: string[];
  roleNames: string[];
  lastLoginAt?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  displayName: string;
  roleIds?: string[];
  status?: UserStatus;
}

export interface UpdateUserRequest {
  displayName?: string;
  password?: string;
  status?: UserStatus;
  roleIds?: string[];
}

export interface UpdateCurrentUserRequest {
  displayName?: string;
  avatarDataUrl?: string | null;
  currentPassword?: string;
  newPassword?: string;
}

export interface UpdateRolePermissionsRequest {
  permissions: PermissionCode[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: CurrentUser;
}

export interface NodeMetricSnapshot {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  totalMemoryMb?: number | undefined;
  usedMemoryMb?: number | undefined;
  totalDiskGb?: number | undefined;
  usedDiskGb?: number | undefined;
  uptimeSeconds?: number | undefined;
  loadAverage1m?: number | undefined;
  createdAt: string;
}

export interface ManagedNode {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  status: NodeStatus;
  os?: string | null;
  arch?: string | null;
  version?: string | null;
  remarks?: string | null;
  groupName?: string | null;
  tags?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
  latestMetric?: NodeMetricSnapshot | null;
}

export interface RegisterDaemonRequest {
  name: string;
  host: string;
  port: number;
  protocol: string;
  os?: string;
  arch?: string;
  version?: string;
}

export interface RegisterDaemonResponse {
  nodeId: string;
  nodeToken: string;
  heartbeatSeconds: number;
}

export interface HeartbeatRequest {
  status: "ONLINE";
  metrics: Omit<NodeMetricSnapshot, "createdAt">;
  os?: string;
  arch?: string;
  version?: string;
}

export interface DashboardOverview {
  version: string;
  generatedAt: string;
  nodes: {
    online: number;
    offline: number;
    total: number;
  };
  resources: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  };
  history: Array<{
    time: string;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  }>;
  recentOperations: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId?: string | null | undefined;
    result: "SUCCESS" | "FAILURE";
    createdAt: string;
    username?: string | null | undefined;
  }>;
  recentLogins: Array<{
    id: string;
    username?: string | null | undefined;
    result: "SUCCESS" | "FAILURE";
    createdAt: string;
    ip?: string | null | undefined;
  }>;
}

export interface CreateNodeRequest {
  name: string;
  host: string;
  port: number;
  protocol: "http" | "https";
  remarks?: string;
  groupName?: string;
  tags?: string;
}

export interface UpdateNodeRequest {
  name?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "https";
  remarks?: string | null;
  groupName?: string | null;
  tags?: string | null;
}

export interface CreateNodeResponse {
  node: ManagedNode;
  nodeToken: string;
}

export interface InstanceAssignee {
  id: string;
  username: string;
  displayName: string;
  role: InstanceOwnerRole;
}

export interface ManagedInstance {
  id: string;
  nodeId: string;
  nodeName?: string | null | undefined;
  name: string;
  type: InstanceType;
  workingDirectory: string;
  startCommand: string;
  stopCommand?: string | null | undefined;
  status: InstanceStatus;
  autoStart: boolean;
  restartPolicy: RestartPolicy;
  restartMaxRetries: number;
  runAsUser?: string | null | undefined;
  memoryLimit?: number | null | undefined;
  cpuLimit?: number | null | undefined;
  description?: string | null | undefined;
  createdByUserId?: string | null | undefined;
  createdByUsername?: string | null | undefined;
  createdByDisplayName?: string | null | undefined;
  createdByRole?: InstanceOwnerRole | null | undefined;
  assignedToUserId?: string | null | undefined;
  assignedToUsername?: string | null | undefined;
  assignedToDisplayName?: string | null | undefined;
  assignedToRole?: InstanceOwnerRole | null | undefined;
  lastStartedAt?: string | null | undefined;
  lastStoppedAt?: string | null | undefined;
  lastExitCode?: number | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstanceRequest {
  nodeId: string;
  name: string;
  type?: InstanceType;
  workingDirectory?: string;
  startCommand: string;
  stopCommand?: string;
  description?: string;
  autoStart?: boolean;
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  assignedToUserId?: string | null;
}

export interface InstanceTemplate {
  id: string;
  name: string;
  description: string;
  type: InstanceType;
  defaultStartCommand: string;
  defaultStopCommand?: string | null | undefined;
  defaultWorkingDirectoryPrefix: string;
  ports: Array<{
    port: number;
    description: string;
  }>;
  envs: Array<{
    key: string;
    value: string;
  }>;
}

export interface CreateInstanceFromTemplateRequest {
  nodeId: string;
  name: string;
  workingDirectory?: string;
  startCommand?: string;
  stopCommand?: string | null;
  description?: string;
  autoStart?: boolean;
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  assignedToUserId?: string | null;
}

export interface UpdateInstanceRequest {
  nodeId?: string;
  name?: string;
  workingDirectory?: string;
  startCommand?: string;
  stopCommand?: string | null;
  description?: string | null;
  autoStart?: boolean;
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  assignedToUserId?: string | null;
}

export interface InstanceLogLine {
  id: number;
  time: string;
  stream: "stdout" | "stderr" | "stdin" | "system";
  text: string;
}

export interface InstanceLogsResponse {
  instanceId: string;
  status: InstanceStatus;
  exitCode?: number | null | undefined;
  lines: InstanceLogLine[];
}

export interface InstanceActionResponse {
  instance: ManagedInstance;
  logs?: InstanceLogLine[];
}

export interface InstanceCommandRequest {
  command: string;
  workingDirectory?: string;
  timeoutMs?: number;
  input?: string;
}

export interface InstanceCommandResponse {
  command: string;
  workingDirectory: string;
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type InstanceFileType = "file" | "directory" | "symlink" | "other";

export interface InstanceFileEntry {
  name: string;
  path: string;
  type: InstanceFileType;
  size: number;
  modifiedAt: string;
}

export interface InstanceFileListResponse {
  instanceId: string;
  path: string;
  entries: InstanceFileEntry[];
}

export interface InstanceFileContentResponse {
  instanceId: string;
  path: string;
  content: string;
  encoding: "utf8";
  size: number;
  modifiedAt: string;
}

export interface WriteInstanceFileRequest {
  path: string;
  content: string;
}

export interface UploadInstanceFileRequest {
  path: string;
  contentBase64: string;
  overwrite?: boolean;
}

export interface DownloadInstanceFileResponse {
  instanceId: string;
  path: string;
  fileName: string;
  contentBase64: string;
  size: number;
  modifiedAt: string;
}

export interface MakeInstanceDirectoryRequest {
  path: string;
}

export interface DeleteInstanceFileRequest {
  path: string;
}

export interface RenameInstanceFileRequest {
  fromPath: string;
  toPath: string;
}

export interface ExtractInstanceArchiveRequest {
  path: string;
  outputPath?: string;
}

export interface ExtractInstanceArchiveResponse {
  instanceId: string;
  archivePath: string;
  outputPath: string;
  entry: InstanceFileEntry;
  extractedCount: number;
  totalBytes: number;
}

export type ScheduledTaskType = "run_command" | "restart_instance" | "stop_instance" | "start_instance";
export type TaskRunStatus = "RUNNING" | "SUCCESS" | "FAILURE";

export interface ScheduledTaskPayload {
  command?: string;
}

export interface ManagedScheduledTask {
  id: string;
  nodeId?: string | null | undefined;
  instanceId?: string | null | undefined;
  instanceName?: string | null | undefined;
  name: string;
  type: ScheduledTaskType;
  cron: string;
  payload: ScheduledTaskPayload;
  enabled: boolean;
  lastRunAt?: string | null | undefined;
  nextRunAt?: string | null | undefined;
  createdBy?: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTaskRequest {
  name: string;
  type: ScheduledTaskType;
  cron: string;
  instanceId?: string | null;
  payload?: ScheduledTaskPayload;
  enabled?: boolean;
}

export interface UpdateScheduledTaskRequest {
  name?: string;
  type?: ScheduledTaskType;
  cron?: string;
  instanceId?: string | null;
  payload?: ScheduledTaskPayload;
  enabled?: boolean;
}

export interface ManagedTaskRun {
  id: string;
  taskId: string;
  status: TaskRunStatus;
  output?: string | null | undefined;
  error?: string | null | undefined;
  startedAt: string;
  finishedAt?: string | null | undefined;
}

export interface AuditLogEntry {
  id: string;
  userId?: string | null | undefined;
  username?: string | null | undefined;
  action: string;
  resourceType: string;
  resourceId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  payload?: string | null | undefined;
  result: "SUCCESS" | "FAILURE";
  createdAt: string;
}

export interface DeleteAuditLogsRequest {
  ids: string[];
}

export interface DeleteAuditLogsResponse {
  ok: true;
  deleted: number;
}

export type TerminalClientMessage =
  | {
      type: "auth";
      token: string;
      instanceId: string;
    }
  | {
      type: "input";
      data: string;
      echo?: boolean;
    }
  | {
      type: "ping";
    };

export type TerminalServerMessage =
  | {
      type: "hello";
      instanceId: string;
      status: InstanceStatus;
      exitCode?: number | null | undefined;
      lines: InstanceLogLine[];
    }
  | {
      type: "line";
      line: InstanceLogLine;
    }
  | {
      type: "status";
      instanceId: string;
      status: InstanceStatus;
      exitCode?: number | null | undefined;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "pong";
      time: string;
    };

export interface SakiWorkspaceContext {
  instanceId?: string | null;
  instanceName?: string | null;
  nodeName?: string | null;
  workingDirectory?: string | null;
  status?: InstanceStatus | null;
  lastExitCode?: number | null;
}

export interface SakiSkillSummary {
  id: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  sourceType?: string | null;
  tags?: string[];
  sourceUrl?: string | null;
  updatedAt?: string | null;
  tokenEstimate?: number;
  builtin?: boolean;
}

export interface SakiSkillDetail extends SakiSkillSummary {
  content: string;
  path?: string | null;
}

export interface CreateSakiSkillRequest {
  name: string;
  description?: string;
  content: string;
  tags?: string[];
  enabled?: boolean;
}

export interface UpdateSakiSkillRequest {
  name?: string;
  description?: string;
  content?: string;
  tags?: string[];
  enabled?: boolean;
}

export interface DownloadSakiSkillRequest {
  url: string;
  id?: string;
  enabled?: boolean;
}

export interface SakiChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

export type SakiChatMode = "chat" | "agent";
export type SakiInputAttachmentKind = "image" | "file" | "screenshot";

export interface SakiInputAttachment {
  id?: string;
  kind: SakiInputAttachmentKind;
  name: string;
  mimeType?: string;
  size?: number;
  text?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  capturedAt?: string;
}

export type SakiAgentActionStatus = "completed" | "failed" | "pending_approval" | "rejected" | "rolled_back";
export type SakiAgentRiskLevel = "low" | "medium" | "high" | "critical";

export interface SakiAgentActionApproval {
  required: boolean;
  reason: string;
  risk: SakiAgentRiskLevel;
  preview?: string;
  diff?: string;
  checkpointId?: string;
  rollbackAvailable?: boolean;
}

export interface SakiAgentAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  observation: string;
  ok: boolean;
  status?: SakiAgentActionStatus;
  approval?: SakiAgentActionApproval;
  createdAt: string;
}

export interface SakiActionDecisionResponse {
  action: SakiAgentAction;
  message: string;
}

export interface SakiChatRequest {
  message: string;
  history?: SakiChatMessage[];
  instanceId?: string | null;
  panelError?: string | null;
  contextTitle?: string | null;
  contextText?: string | null;
  auditSearch?: string | null;
  mode?: SakiChatMode;
  selectedSkillIds?: string[];
  attachments?: SakiInputAttachment[];
}

export interface SakiChatResponse {
  message: string;
  source: "direct-model" | "local-fallback";
  workspace?: SakiWorkspaceContext | null;
  skills?: SakiSkillSummary[];
  diagnostics?: string[];
  actions?: SakiAgentAction[];
}

export interface SakiStatusResponse {
  reachable: boolean;
  configured: boolean;
  skills: SakiSkillSummary[];
  provider?: string;
  model?: string;
  message?: string;
}

export interface SakiProviderConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  ollamaUrl?: string;
}

export interface SakiConfigResponse {
  requestTimeoutMs: number;
  provider: string;
  model: string;
  ollamaUrl: string;
  baseUrl: string;
  apiKey: string;
  providerConfigs: Record<string, SakiProviderConfig>;
  searchEnabled: boolean;
  mcpEnabled: boolean;
  systemPrompt?: string | null;
  configPath: string;
  globalConfigPath: string;
}

export interface UpdateSakiConfigRequest {
  requestTimeoutMs?: number;
  provider?: string;
  model?: string;
  ollamaUrl?: string;
  baseUrl?: string;
  apiKey?: string;
  providerConfigs?: Record<string, SakiProviderConfig>;
  searchEnabled?: boolean;
  mcpEnabled?: boolean;
  systemPrompt?: string | null;
}

export interface SakiModelOption {
  provider: string;
  id: string;
  name: string;
  label: string;
  vendor?: string;
}

export interface SakiModelListResponse {
  provider: string;
  models: SakiModelOption[];
  warnings: Array<{
    provider: string;
    message: string;
  }>;
  message?: string;
}
