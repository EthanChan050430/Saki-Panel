export const PANEL_VERSION = "0.3.0";

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
  points?: number;
  unlimitedPoints?: boolean;
  favorability?: number;
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
  points?: number;
  unlimitedPoints?: boolean;
  favorability?: number;
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

export interface PointRecordItem {
  id: string;
  userId: string;
  delta: number;
  balanceAfter: number | null;
  type: string;
  tokensUsed?: number | null;
  description?: string | null;
  createdAt: string;
}

export interface UserPointsSummary {
  points: number;
  unlimitedPoints: boolean;
  totalTokensUsed: number;
  totalPointsConsumed: number;
  dailyUsage: Array<{
    date: string;
    tokens: number;
    points: number;
  }>;
  recentRecords: PointRecordItem[];
}

export interface UpdateUserPointsRequest {
  action: "adjust" | "set" | "set_unlimited";
  amount?: number;
  unlimited?: boolean;
  note?: string;
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
  darkBackgroundSrc: string;
  mobileDarkBackgroundSrc: string;
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
  tokenLast4?: string | null | undefined;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
  latestMetric?: NodeMetricSnapshot | null;
  createdById?: string | null | undefined;
  createdBy?: { id: string; username: string; displayName: string } | null | undefined;
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

export interface DaemonInstanceSnapshot {
  instanceId: string;
  status: InstanceStatus;
  exitCode?: number | null;
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
  instances?: DaemonInstanceSnapshot[];
}

export interface DaemonRestartLease {
  instanceId: string;
  suppressUntil: string;
}

export interface HeartbeatResponse {
  ok: true;
  heartbeatSeconds: number;
  restartLeases?: DaemonRestartLease[];
}

export interface DaemonInstanceStatusEvent {
  type: "instance.status";
  instanceId: string;
  status: InstanceStatus;
  exitCode?: number | null;
  occurredAt: string;
  logTail?: Array<{ stream: string; text: string }>;
  restart?: {
    policy: RestartPolicy;
    attempts: number;
    willRetry: boolean;
  };
}

export interface DaemonEventResponse {
  ok: true;
  suppressRestartUntil?: string | null;
}

export const watchPolicyModes = ["off", "diagnose_only", "diagnose_and_patch"] as const;
export type WatchPolicyMode = (typeof watchPolicyModes)[number];

export const incidentTriggers = ["crash", "crash_loop", "disk", "memory", "webhook", "health"] as const;
export type IncidentTrigger = (typeof incidentTriggers)[number];

export const incidentStatuses = [
  "open",
  "diagnosing",
  "diagnosed",
  "awaiting_approval",
  "applying",
  "verifying",
  "resolved",
  "rolled_back",
  "failed",
  "ignored",
  "rate_limited"
] as const;
export type IncidentStatus = (typeof incidentStatuses)[number];

export interface WatchProposedChange {
  path: string;
  intent: string;
}

export interface WatchDiagnosis {
  summary: string;
  rootCause?: string;
  changes?: WatchProposedChange[];
  risk?: SakiAgentRiskLevel;
  needRestart?: boolean;
  confidence?: number;
}

// 诊断证据包：诊断发起时由 panel 自动收集，随事件持久化并注入诊断上下文
export interface WatchEvidence {
  collectedAt: string;
  logTail?: string;
  crashHistory?: Array<{ at: string; exitCode?: number | null; status: string }>;
  nodeMetrics?: { cpuPercent?: number; memoryPercent?: number; diskPercent?: number };
  recentChanges?: string[];
  notes?: string[];
}

// 风险分级自治阈值：none=全部人工批准；low=低风险自动执行；medium=中低风险自动执行
export const autoApproveRiskLevels = ["none", "low", "medium"] as const;
export type AutoApproveRiskLevel = (typeof autoApproveRiskLevels)[number];

export interface ManagedWatchPolicy {
  instanceId: string;
  enabled: boolean;
  mode: WatchPolicyMode;
  cooldownSeconds: number;
  maxRunsPerHour: number;
  verifyWaitSeconds: number;
  approverUserId?: string | null;
  autoApproveRisk: AutoApproveRiskLevel;
  autoApproveMinConfidence: number;
  healthCheckUrl?: string | null;
  healthCheckTimeoutSeconds: number;
  notifyChannelIds: string[];
  escalationMinutes: number;
}

export interface UpdateWatchPolicyRequest {
  enabled?: boolean;
  mode?: WatchPolicyMode;
  cooldownSeconds?: number;
  maxRunsPerHour?: number;
  verifyWaitSeconds?: number;
  approverUserId?: string | null;
  autoApproveRisk?: AutoApproveRiskLevel;
  autoApproveMinConfidence?: number;
  healthCheckUrl?: string | null;
  healthCheckTimeoutSeconds?: number;
  notifyChannelIds?: string[];
  escalationMinutes?: number;
}

export interface ManagedIncident {
  id: string;
  instanceId: string;
  instanceName: string;
  nodeId: string;
  nodeName?: string | null;
  fingerprint: string;
  trigger: IncidentTrigger;
  status: IncidentStatus;
  exitCode?: number | null;
  summary?: string | null;
  rootCause?: string | null;
  diagnosis?: WatchDiagnosis | null;
  logTail: string;
  rollbackSet: string[];
  taskId?: string | null;
  assigneeUserId?: string | null;
  occurrenceCount: number;
  lastOccurredAt: string;
  resolvedAt?: string | null;
  ignoredUntil?: string | null;
  groupKey?: string | null;
  recurrenceCount: number;
  flapping: boolean;
  autoApplied: boolean;
  evidence?: WatchEvidence | null;
  escalatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentListResponse {
  incidents: ManagedIncident[];
  openCount: number;
}

export interface IgnoreIncidentRequest {
  minutes?: number;
}

// ---- 静默规则 ----
export interface ManagedSilenceRule {
  id: string;
  instanceId?: string | null;
  instanceName?: string | null;
  fingerprint?: string | null;
  trigger?: IncidentTrigger | null;
  reason?: string | null;
  expiresAt?: string | null; // null = 永久
  createdAt: string;
}

export interface CreateSilenceRuleRequest {
  instanceId?: string;
  fingerprint?: string;
  trigger?: IncidentTrigger;
  reason?: string;
  minutes?: number; // 缺省 = 永久静默
}

// ---- 出站通知渠道 ----
export const notificationChannelTypes = ["webhook", "dingtalk", "wecom", "telegram"] as const;
export type NotificationChannelType = (typeof notificationChannelTypes)[number];

export const notificationEventKinds = ["opened", "awaiting", "resolved", "failed", "escalation"] as const;
export type NotificationEventKind = (typeof notificationEventKinds)[number];

export interface ManagedNotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  url: string;
  hasSecret: boolean;
  enabled: boolean;
  events: NotificationEventKind[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertNotificationChannelRequest {
  name: string;
  type: NotificationChannelType;
  url: string;
  secret?: string | null;
  enabled?: boolean;
  events?: NotificationEventKind[];
}

export interface ManagedNotificationDelivery {
  id: string;
  channelId: string;
  channelName?: string;
  incidentId?: string | null;
  kind: string;
  status: string;
  error?: string | null;
  createdAt: string;
}

// ---- 外部告警接入口令 ----
export interface ManagedIngestToken {
  id: string;
  instanceId: string;
  instanceName?: string;
  label: string;
  token: string;
  createdAt: string;
  lastUsedAt?: string | null;
}

export interface CreateIngestTokenRequest {
  instanceId: string;
  label?: string;
}

// ---- 可靠性报告 ----
export interface IncidentReport {
  days: number;
  generatedAt: string;
  totals: {
    opened: number;
    resolved: number;
    failed: number;
    ignored: number;
    activeNow: number;
  };
  mttrMinutes: number | null;
  autoFix: { attempted: number; succeeded: number; successRate: number | null };
  recurrenceRate: number | null; // 复发事件（recurrenceCount > 0）占比
  topRecurring: Array<{
    fingerprint: string;
    instanceId: string;
    instanceName: string;
    trigger: IncidentTrigger;
    count: number;
    lastOccurredAt: string;
  }>;
  perInstance: Array<{
    instanceId: string;
    instanceName: string;
    total: number;
    resolved: number;
    failed: number;
    mttrMinutes: number | null;
  }>;
  daily: Array<{ date: string; opened: number; resolved: number }>;
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

export interface NodeEnrollmentTokenInfo {
  id: string;
  tokenLast4: string;
  namePrefix?: string | null | undefined;
  groupName?: string | null | undefined;
  tags?: string | null | undefined;
  maxUsage: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
  isExpired: boolean;
  createdById?: string | null | undefined;
}

export interface CreateEnrollmentTokenRequest {
  namePrefix?: string | undefined;
  groupName?: string | undefined;
  tags?: string | undefined;
  expiresInMinutes?: number | undefined;
  maxUsage?: number | undefined;
}

export interface CreateEnrollmentTokenResponse {
  tokenInfo: NodeEnrollmentTokenInfo;
  token: string;
}

export interface RotateNodeTokenResponse {
  nodeId: string;
  nodeName: string;
  nodeToken: string;
}

export interface NodeJoinCommandResponse {
  nodeId?: string | undefined;
  panelUrl: string;
  token: string;
  linuxCommand: string;
  windowsCommand: string;
  dockerCommand: string;
}

export interface DaemonNodeKeyPayload {
  version: number;
  host: string;
  port: number;
  protocol: "http" | "https";
  token: string;
  nodeId?: string | undefined;
  name?: string | undefined;
}

export interface ConnectNodeByKeyRequest {
  key: string;
  name?: string | undefined;
  groupName?: string | undefined;
  tags?: string | undefined;
  hostOverride?: string | undefined;
  portOverride?: number | undefined;
}

export interface ConnectNodeByKeyResponse {
  ok: boolean;
  node?: ManagedNode | undefined;
  error?: string | undefined;
}

export interface LocalDaemonStatusResponse {
  running: boolean;
  port: number;
  connected: boolean;
  nodeId?: string | null | undefined;
  nodeName?: string | null | undefined;
  canConnect?: boolean | undefined;
}

export interface ConnectLocalNodeResponse {
  ok: boolean;
  node?: ManagedNode | undefined;
  message?: string | undefined;
  error?: string | undefined;
}

export interface UserAccessKeyInfo {
  id: string;
  name: string;
  keyLast4: string;
  createdAt: string;
  lastUsedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
}

export interface CreateUserAccessKeyResponse {
  keyInfo: UserAccessKeyInfo;
  rawKey: string;
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

export interface ClashSubscriptionProxy {
  name: string;
  type: string;
  server?: string;
  port?: number;
}

export interface InstanceProxyConfig {
  enabled: boolean;
  type: "http" | "https" | "socks5";
  server: string;
  port: number;
  username?: string | null | undefined;
  password?: string | null | undefined;
  bypass?: string | null | undefined;
  mode?: "manual" | "subscription" | undefined;
  subscriptionUrl?: string | null | undefined;
  selectedProxy?: string | null | undefined;
  proxies?: ClashSubscriptionProxy[] | null | undefined;
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
  proxyConfig?: InstanceProxyConfig | null | undefined;
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
  proxyConfig?: InstanceProxyConfig | null;
  autoStart?: boolean;
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  assignedToUserId?: string | null;
  assignedToUserIds?: string[] | null;
}

export interface RemoteNodeUserSummary {
  id: string;
  username: string;
  displayName: string | null;
  instanceCount: number;
  activeKeyLast4?: string | null;
}

export interface SyncInstancesByUserKeyRequest {
  nodeId: string;
  userKey?: string | undefined;
  targetUserId?: string | undefined;
  remotePanelUrl?: string | undefined;
}

export interface SyncInstancesByUserKeyResponse {
  ok: boolean;
  syncedCount: number;
  message?: string;
  instances?: ManagedInstance[];
  availableUsers?: RemoteNodeUserSummary[];
  error?: string;
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
  description: string | null;
  type: InstanceType;
  defaultStartCommand: string;
  defaultStopCommand: string | null;
  defaultWorkingDirectoryPrefix: string;
  ports: Array<{
    port: number;
    description: string;
  }>;
  envs: Array<{
    key: string;
    value: string;
  }>;
  autoStart: boolean;
  restartPolicy: RestartPolicy;
  restartMaxRetries: number;
  runAsUser: string | null;
  memoryLimit: number | null;
  cpuLimit: number | null;
  isBuiltin: boolean;
  fromInstanceId: string | null;
  createdById: string | null;
  createdByUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTemplateFromInstanceRequest {
  name: string;
  description?: string;
  /** override start command (defaults to instance.startCommand) */
  startCommand?: string;
  /** override stop command (defaults to instance.stopCommand) */
  stopCommand?: string | null;
  workingDirectoryPrefix?: string;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  defaultStartCommand?: string;
  defaultStopCommand?: string | null;
  defaultWorkingDirectoryPrefix?: string;
  ports?: Array<{ port: number; description: string }>;
  envs?: Array<{ key: string; value: string }>;
  autoStart?: boolean;
  restartPolicy?: RestartPolicy;
  restartMaxRetries?: number;
  runAsUser?: string | null;
  memoryLimit?: number | null;
  cpuLimit?: number | null;
}

export interface DeleteTemplateResponse {
  success: boolean;
  id: string;
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
  proxyConfig?: InstanceProxyConfig | null;
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
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  truncated?: boolean;
  outline?: boolean;
  isDirectory?: boolean;
  stat?: boolean;
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
  before?: string[];
  after?: string[];
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

export function isSakiImageAttachment(attachment: Pick<SakiInputAttachment, "kind">): boolean {
  return attachment.kind === "image" || attachment.kind === "screenshot";
}

export function sakiAttachmentMentionToken(attachment: Pick<SakiInputAttachment, "id" | "name">): string {
  const name = (attachment.name || "").trim() || attachment.id || "image";
  if (/[\s@"'\\]/.test(name)) {
    return `@"${name.replace(/"/g, "")}"`;
  }
  return `@${name}`;
}

export function parseSakiAttachmentMentionQueries(message: string): string[] {
  const queries: string[] = [];
  const pattern = /@(?:"([^"]+)"|([^\s@]+))/g;
  for (const match of message.matchAll(pattern)) {
    const token = (match[1] || match[2] || "").trim();
    if (token) queries.push(token);
  }
  return queries;
}

function sakiAttachmentMentionKeys(attachment: Pick<SakiInputAttachment, "id" | "name">): string[] {
  return [attachment.name?.trim(), attachment.id].filter((value): value is string => Boolean(value));
}

export function resolveSakiMentionedAttachments(
  message: string,
  attachments: SakiInputAttachment[]
): SakiInputAttachment[] {
  const queries = parseSakiAttachmentMentionQueries(message).map((query) => query.toLowerCase());
  if (queries.length === 0) return [];
  const resolved: SakiInputAttachment[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const found = attachments.find((attachment) => {
      const keys = sakiAttachmentMentionKeys(attachment).map((key) => key.toLowerCase());
      const token = sakiAttachmentMentionToken(attachment).replace(/^@/, "").replace(/^"|"$/g, "").toLowerCase();
      return keys.includes(query) || token === query;
    });
    if (!found) continue;
    const key = found.id ?? found.name;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(found);
  }
  return resolved;
}

export function sakiImageAttachmentsForMessage(
  message: string,
  attachments: SakiInputAttachment[]
): SakiInputAttachment[] {
  const images = attachments.filter(isSakiImageAttachment);
  const mentioned = resolveSakiMentionedAttachments(message, images);
  return mentioned.length > 0 ? mentioned : images;
}

export function sakiAttachmentsForMessage(
  message: string,
  attachments: SakiInputAttachment[]
): SakiInputAttachment[] {
  const mentionedImages = resolveSakiMentionedAttachments(message, attachments).filter(isSakiImageAttachment);
  if (mentionedImages.length === 0) return attachments;
  const mentionedKeys = new Set(mentionedImages.map((attachment) => attachment.id ?? attachment.name));
  return attachments.filter((attachment) => !isSakiImageAttachment(attachment) || mentionedKeys.has(attachment.id ?? attachment.name));
}

export function sakiModelSupportsVision(modelId: string, provider?: string): boolean {
  const haystack = `${provider ?? ""} ${modelId}`.toLowerCase();
  if (!modelId.trim()) return false;
  if (/(gpt-3\.5|o1-mini|o1-preview|text-embedding|whisper|\btts\b|[-_/]voice\b)/i.test(haystack)) return false;
  if (/(deepseek-(chat|reasoner|coder|v3)|deepseek-r1)/i.test(haystack) && !/(vl|vision|janus)/i.test(haystack)) {
    return false;
  }
  if (/(^|[^a-z0-9])(vl|vqa|vision|multimodal)([^a-z0-9]|$)/i.test(haystack)) return true;
  if (/(pixtral|llava|moondream|minicpm-v|internvl|cogvlm|visualglm|qvq)/i.test(haystack)) return true;
  if (
    /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-4\.5|gpt-5|chatgpt-|claude-3|claude-4|claude-sonnet|claude-opus|claude-haiku|gemini|gemma-3|grok-4|grok-2-vision|llama-?4)/i.test(
      haystack
    )
  ) {
    return true;
  }
  // GLM-4V / GLM-4.5V / GLM-5V / glm4v / qwen2.5-vl-style "4v"/"5v" suffixes
  if (/(^|[^a-z0-9])(?:glm[-_.]?)?\d+(?:\.\d+)*[-_]?v(\b|[^a-z0-9])/i.test(haystack)) return true;
  return false;
}

export function sakiListedModelSupportsVision(model: {
  id: string;
  provider?: string;
  name?: string;
  label?: string;
  supportsVision?: boolean;
}): boolean {
  if (model.supportsVision === true) return true;
  return [model.id, model.name, model.label].some(
    (value) => Boolean(value && typeof value === "string" && value.length > 0 && sakiModelSupportsVision(value, model.provider))
  );
}

export function activeSakiMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const match = before.match(/@([^\s@]*)$/);
  if (!match) return null;
  const start = before.length - match[0].length;
  if (start > 0 && /[\w.]/.test(before.charAt(start - 1))) return null;
  return { start, query: match[1] ?? "" };
}

export function insertSakiMention(
  text: string,
  caret: number,
  attachment: Pick<SakiInputAttachment, "id" | "name">
): { text: string; caret: number } {
  const active = activeSakiMentionQuery(text, caret);
  const token = `${sakiAttachmentMentionToken(attachment)} `;
  const start = active?.start ?? caret;
  const next = `${text.slice(0, start)}${token}${text.slice(caret)}`;
  return { text: next, caret: start + token.length };
}

export function filterSakiMentionCandidates(
  attachments: SakiInputAttachment[],
  query: string
): SakiInputAttachment[] {
  const images = attachments.filter(isSakiImageAttachment);
  const needle = query.trim().toLowerCase();
  if (!needle) return images;
  return images.filter((attachment) => `${attachment.name} ${attachment.id ?? ""}`.toLowerCase().includes(needle));
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
  relatedCheckpointIds?: string[];
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
  model?: string | null;
}

export interface SakiChatResponse {
  message: string;
  thinking?: string;
  source: "direct-model" | "local-fallback";
  workspace?: SakiWorkspaceContext | null;
  agentPermissionMode?: SakiAgentPermissionMode;
  skills?: SakiSkillSummary[];
  diagnostics?: string[];
  actions?: SakiAgentAction[];
  usage?: {
    tokensUsed: number;
    pointsUsed: number;
    isUnlimited: boolean;
    remainingPoints?: number;
  } | undefined;
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
  /**
   * Connection scheme for the "antigravity" provider only:
   * - "proxy": local/third-party reverse proxy gateway (default http://localhost:8080/v1),
   *   auth = optional custom Bearer token or locally stored Google OAuth credential.
   * - "direct": official Google endpoint (https://generativelanguage.googleapis.com/v1beta/openai),
   *   auth = Google AI Studio API key (AIzaSy...).
   * Ignored by all other providers.
   */
  mode?: "proxy" | "direct";
}

export interface SakiConfigResponse {
  requestTimeoutMs: number;
  provider: string;
  model: string;
  ollamaUrl: string;
  baseUrl: string;
  apiKey: string;
  providerConfigs: Record<string, SakiProviderConfig>;
  modelPointsMultipliers?: Record<string, number> | undefined;
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
  modelPointsMultipliers?: Record<string, number> | undefined;
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
  supportsVision?: boolean;
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

export interface SakiAntigravityUsageInfo {
  totalTokensUsed?: number | undefined;
  todayTokensUsed?: number | undefined;
  totalRequests?: number | undefined;
  proxyQuotaLimit?: string | number | undefined;
  proxyQuotaRemaining?: string | number | undefined;
  proxyQuotaUsed?: string | number | undefined;
  expiresAt?: string | undefined;
  tier?: string | undefined;
}

export interface SakiAntigravityAccountItem {
  email: string;
  name?: string | undefined;
  picture?: string | undefined;
  isActive?: boolean | undefined;
  hasToken?: boolean | undefined;
  addedAt?: string | undefined;
}

export interface SakiAntigravityAuthStatusResponse {
  available: boolean;
  authenticated: boolean;
  /** Resolved connection scheme for the antigravity provider. */
  mode?: "proxy" | "direct";
  isEndpointReachable?: boolean;
  hasLocalCredentials?: boolean;
  accountEmail?: string | undefined;
  accounts?: SakiAntigravityAccountItem[] | undefined;
  endpoint?: string;
  message?: string;
  usage?: SakiAntigravityUsageInfo | undefined;
  loginUrl?: string | undefined;
  verificationUri?: string | undefined;
}

export interface SakiAntigravityLoginUrlResponse {
  url: string;
  sessionId: string;
  verificationUri: string;
  secondaryUri?: string | undefined;
  expiresIn?: number | undefined;
  message: string;
}

export interface SakiAntigravityExchangeRequest {
  sessionId?: string | undefined;
  code: string;
  accountEmail?: string | undefined;
}

export interface SakiAntigravityLoginRequest {
  tokenOrKey: string;
  accountEmail?: string | undefined;
}

export interface SakiAntigravitySwitchAccountRequest {
  accountEmail: string;
}

export interface SakiAntigravityLogoutRequest {
  accountEmail?: string | undefined;
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
  createdByUserId?: string | null | undefined;
  createdByUsername?: string | null | undefined;
  createdByDisplayName?: string | null | undefined;
  createdByRole?: InstanceOwnerRole | null | undefined;
  assignedToUserId?: string | null | undefined;
  assignedToUsername?: string | null | undefined;
  assignedToDisplayName?: string | null | undefined;
  assignedToRole?: InstanceOwnerRole | null | undefined;
  assignees?: InstanceAssignedUser[] | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDatabaseVisualizerRequest {
  nodeId: string;
  name: string;
  engine?: DatabaseEngine | undefined;
  description?: string | null | undefined;
  config: DatabaseVisualizerConfig;
  assignedToUserId?: string | null | undefined;
  assignedToUserIds?: string[] | null | undefined;
}

export interface UpdateDatabaseVisualizerRequest {
  nodeId?: string | undefined;
  name?: string | undefined;
  engine?: DatabaseEngine | undefined;
  description?: string | null | undefined;
  config?: DatabaseVisualizerConfig | undefined;
  assignedToUserId?: string | null | undefined;
  assignedToUserIds?: string[] | null | undefined;
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

export interface SystemVersionCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  releaseNotes?: string | undefined;
  publishedAt?: string | undefined;
  checkedAt: string;
}

export function parseSemver(version: string): { major: number; minor: number; patch: number; pre?: string | undefined } | null {
  if (!version) return null;
  const cleaned = version.trim().replace(/^[vV]/, "");
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1] || "0", 10),
    minor: parseInt(match[2] || "0", 10),
    patch: parseInt(match[3] || "0", 10),
    pre: match[4] || undefined
  };
}

export function compareSemver(v1: string, v2: string): number {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  if (!p1 || !p2) {
    return v1.localeCompare(v2, undefined, { numeric: true, sensitivity: "base" });
  }
  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
  if (!p1.pre && p2.pre) return 1;
  if (p1.pre && !p2.pre) return -1;
  if (p1.pre && p2.pre) return p1.pre.localeCompare(p2.pre);
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

export function extractVersionString(raw: string): string {
  if (!raw) return "";
  const match = raw.match(/v?\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?/i);
  return match ? match[0] : raw.trim();
}

