export const PANEL_VERSION = "0.1.0";

export const noRolePermissionRoleName = "__no_role__";

export const registrationIdentities = ["none", "user", "admin", "super_admin"] as const;

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
  "user.delete",
  "role.view",
  "role.update",
  "audit.view",
  "saki.use",
  "saki.chat",
  "saki.agent",
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
export type RegistrationIdentity = (typeof registrationIdentities)[number];
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
  avatarDataUrl?: string | null | undefined;
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
  username?: string;
  displayName?: string;
  avatarDataUrl?: string | null;
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

export interface RegisterRequest {
  username: string;
  password: string;
  displayName: string;
}

export interface LoginResponse {
  token: string;
  user: CurrentUser;
  sessionTimeoutMinutes: number;
}

export interface PanelSessionSettings {
  sessionTimeoutMinutes: number;
  registrationIdentity: RegistrationIdentity;
}

export interface UpdatePanelSessionSettingsRequest {
  sessionTimeoutMinutes?: number;
  registrationIdentity?: RegistrationIdentity;
}

export interface PanelAppearanceSettings {
  appTitle: string;
  sidebarTitle: string;
  appSubtitle: string;
  appLogoSrc: string;
  sidebarLogoSrc: string;
  loginCoverSrc: string;
  backgroundSrc: string;
  mobileBackgroundSrc: string;
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
  host?: string;
  port?: number;
  protocol?: string;
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

export interface InstanceAssignedUser {
  userId: string;
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
  assignees: InstanceAssignedUser[];
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
  assignedToUserIds?: string[] | null;
}

export interface SuggestInstanceStartCommandRequest {
  nodeId: string;
  workingDirectory: string;
  instanceType?: InstanceType;
}

export interface SuggestInstanceStartCommandResponse {
  startCommand: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  detected: string[];
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
  assignedToUserIds?: string[] | null;
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
  assignedToUserIds?: string[] | null;
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
  totalEntries?: number;
  truncated?: boolean;
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

export type ExtractConflictAction = "overwrite" | "skip";

export interface ExtractArchiveConflict {
  path: string;
  existingType: "file" | "directory";
  archiveType: "file";
  existingSize?: number;
  archiveSize?: number;
  canOverwrite: boolean;
}

export interface ExtractInstanceArchiveRequest {
  path: string;
  outputPath?: string;
  /** @deprecated Use conflictPolicy instead. */
  overwrite?: boolean;
  preview?: boolean;
  conflictPolicy?: ExtractConflictAction;
  conflictResolutions?: Record<string, ExtractConflictAction>;
}

export interface ExtractInstanceArchiveResponse {
  instanceId: string;
  archivePath: string;
  outputPath: string;
  entry: InstanceFileEntry;
  extractedCount: number;
  totalBytes: number;
  skippedCount: number;
  overwrittenCount: number;
  preview?: boolean;
  conflicts?: ExtractArchiveConflict[];
}

export interface ArchiveInstancePathsRequest {
  paths: string[];
  outputPath?: string;
}

export interface ArchiveInstancePathsResponse {
  instanceId: string;
  paths: string[];
  outputPath: string;
  entry: InstanceFileEntry;
  archivedCount: number;
  size: number;
  modifiedAt: string;
}

export interface DownloadInstanceArchiveRequest {
  paths: string[];
  fileName?: string;
}

export interface GrepMatchLine {
  file: string;
  line: number;
  column?: number;
  text: string;
}

export interface GrepInstanceFilesRequest {
  workingDirectory: string;
  pattern: string;
  path?: string;
  include?: string;
  maxResults?: number;
  contextLines?: number;
}

export interface GrepInstanceFilesResponse {
  instanceId: string;
  matches: GrepMatchLine[];
  totalMatches: number;
  truncated: boolean;
  filesSearched: number;
}

export interface GlobInstanceFilesRequest {
  workingDirectory: string;
  pattern: string;
  path?: string;
  maxResults?: number;
}

export interface GlobInstanceFilesResponse {
  instanceId: string;
  paths: string[];
  totalMatches: number;
  truncated: boolean;
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
      sessionId?: string;
    }
  | {
      type: "input";
      data: string;
      echo?: boolean;
      sessionId?: string;
    }
  | {
      type: "resize";
      cols: number;
      rows: number;
      sessionId?: string;
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
      type: "data";
      data: string;
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
export type SakiAgentPermissionMode = "ask" | "acceptEdits" | "plan" | "bypassPermissions";
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
  response?: SakiChatResponse;
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
  agentPermissionMode?: SakiAgentPermissionMode;
  selectedSkillIds?: string[];
  attachments?: SakiInputAttachment[];
}

export interface SakiChatResponse {
  message: string;
  source: "direct-model" | "local-fallback";
  workspace?: SakiWorkspaceContext | null;
  agentPermissionMode?: SakiAgentPermissionMode;
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
  memoryEnabled?: boolean;
  systemPrompt?: string | null;
  appearance: PanelAppearanceSettings;
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
  memoryEnabled?: boolean;
  systemPrompt?: string | null;
  appearance?: Partial<PanelAppearanceSettings>;
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

export interface SakiCopilotAuthStatusResponse {
  available: boolean;
  authenticated: boolean;
  authType?: string;
  host?: string;
  login?: string;
  message?: string;
}

export interface SakiCopilotLoginResponse {
  status: "idle" | "running" | "completed" | "failed";
  command: string;
  startedAt?: string;
  finishedAt?: string;
  verificationUri?: string;
  userCode?: string;
  message?: string;
  output?: string;
}

export type DatabaseEngine = "sqlite" | "mysql" | "postgres" | "redis" | "mariadb" | "generic";

export interface DiscoveredDatabase {
  engine: DatabaseEngine;
  name: string;
  path?: string;
  host?: string;
  port?: number;
  sizeBytes?: number;
  tableCount?: number | undefined;
  modifiedAt?: string | undefined;
  source: string;
  status?: "online" | "available" | "ready" | undefined;
  isSystem?: boolean | undefined;
}

export interface DatabaseVisualizerConfig {
  path?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  database?: string | undefined;
  isReadOnly?: boolean | undefined;
}

export interface DatabaseVisualizerInstance {
  id: string;
  nodeId: string;
  nodeName?: string | null | undefined;
  name: string;
  engine: DatabaseEngine;
  description?: string | null | undefined;
  config: DatabaseVisualizerConfig;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDatabaseVisualizerRequest {
  nodeId: string;
  name: string;
  engine?: DatabaseEngine | undefined;
  description?: string | null | undefined;
  config: DatabaseVisualizerConfig;
}

export interface UpdateDatabaseVisualizerRequest {
  nodeId?: string | undefined;
  name?: string | undefined;
  engine?: DatabaseEngine | undefined;
  description?: string | null | undefined;
  config?: DatabaseVisualizerConfig | undefined;
}

export interface DatabaseTableSummary {
  name: string;
  type: "table" | "view";
  rowCount?: number | undefined;
  columnCount?: number | undefined;
  sizeBytes?: number | undefined;
}

export interface DatabaseColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue?: string | null | undefined;
  primaryKey: boolean;
  autoIncrement?: boolean | undefined;
}

export interface DatabaseTableSchema {
  tableName: string;
  columns: DatabaseColumnInfo[];
  primaryKeys: string[];
  foreignKeys?: Array<{
    column: string;
    targetTable: string;
    targetColumn: string;
  }> | undefined;
  indexes?: Array<{
    name: string;
    unique: boolean;
    columns: string[];
  }> | undefined;
  ddl?: string | null | undefined;
}

export interface DatabaseRowsRequest {
  tableName: string;
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
  sortBy?: string | undefined;
  sortOrder?: "asc" | "desc" | undefined;
  filterColumn?: string | undefined;
  filterValue?: string | undefined;
}

export interface DatabaseRowsResponse {
  tableName: string;
  columns: DatabaseColumnInfo[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DatabaseInsertRowRequest {
  tableName: string;
  row: Record<string, unknown>;
}

export interface DatabaseUpdateRowRequest {
  tableName: string;
  primaryKeys: Record<string, unknown>;
  values: Record<string, unknown>;
}

export interface DatabaseDeleteRowRequest {
  tableName: string;
  primaryKeys: Record<string, unknown>;
}

export interface DatabaseCreateTableRequest {
  tableName: string;
  columns: DatabaseColumnInfo[];
}

export interface DatabaseDropTableRequest {
  tableName: string;
}

export interface DatabaseTruncateTableRequest {
  tableName: string;
}

export interface DatabaseExecuteQueryRequest {
  sql: string;
  maxRows?: number | undefined;
}

export interface DatabaseQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows?: number | undefined;
  executionTimeMs: number;
  affectedRows?: number | undefined;
  lastInsertRowId?: number | string | undefined;
  error?: string | undefined;
}

export interface DatabaseExportRequest {
  tableName?: string | undefined;
  format: "csv" | "json" | "sql";
}

export interface DatabaseExportResponse {
  ok?: boolean | undefined;
  fileName: string;
  contentType: string;
  content: string;
  totalRows?: number | undefined;
}

export interface DatabaseImportRequest {
  tableName?: string | undefined;
  format: "csv" | "json" | "sql";
  content: string;
  mode?: "append" | "replace" | undefined;
}

export interface DatabaseImportResponse {
  success: boolean;
  importedRows: number;
  message?: string | undefined;
}

