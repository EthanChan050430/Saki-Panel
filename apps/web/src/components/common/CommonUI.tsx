import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bug,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  UserRound,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import type {
  CurrentUser,
  DatabaseVisualizerInstance,
  InstanceAssignedUser,
  InstanceAssignee,
  InstanceOwnerRole,
  InstanceStatus,
  ManagedInstance,
  ManagedNode,
  ManagedUser
} from "@webops/shared";
import { panelT, type PanelTextKey } from "../../i18n/index.js";
import { sakiArtAssets } from "../../constants.js";
import { roleNamesDisplay } from "../../utils/role.js";

function MetricTile({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "teal" | "amber" | "blue" | "gray";
}) {
  return (
    <div className={`metric-tile metric-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function NodeStatusPill({ status }: { status: ManagedNode["status"] }) {
  const online = status === "ONLINE";
  return (
    <span className={`status-pill ${online ? "online" : "offline"}`}>
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      {online ? "在线" : "离线"}
    </span>
  );
}

function instanceStatusMeta(status: InstanceStatus) {
  const meta: Record<
    InstanceStatus,
    {
      className: string;
      label: string;
      shortLabel: string;
      hint: string;
      rank: number;
    }
  > = {
    RUNNING: {
      className: "running",
      label: "运行中",
      shortLabel: "在线",
      hint: "进程正在运行",
      rank: 1
    },
    STARTING: {
      className: "transition",
      label: "启动中",
      shortLabel: "启动",
      hint: "进程正在启动",
      rank: 2
    },
    CRASHED: {
      className: "crashed",
      label: "异常",
      shortLabel: "异常",
      hint: "上次运行异常退出",
      rank: 3
    },
    UNKNOWN: {
      className: "unknown",
      label: "未知",
      shortLabel: "未知",
      hint: "暂时无法确认状态",
      rank: 4
    },
    STOPPING: {
      className: "transition",
      label: "停止中",
      shortLabel: "停止",
      hint: "正在停止进程",
      rank: 5
    },
    STOPPED: {
      className: "idle",
      label: "已停止",
      shortLabel: "休眠",
      hint: "进程已停止",
      rank: 6
    },
    CREATED: {
      className: "created",
      label: "待启动",
      shortLabel: "待命",
      hint: "实例已创建，尚未启动",
      rank: 7
    }
  };
  return meta[status];
}

function InstanceStatusIcon({ status, size = 14 }: { status: InstanceStatus; size?: number }) {
  if (status === "RUNNING") return <Activity size={size} />;
  if (status === "STARTING" || status === "STOPPING") return <RefreshCw size={size} />;
  if (status === "CRASHED") return <Bug size={size} />;
  if (status === "UNKNOWN") return <WifiOff size={size} />;
  if (status === "STOPPED") return <Square size={size} />;
  return <TerminalIcon size={size} />;
}

function InstanceStatusBadge({ status, compact = false }: { status: InstanceStatus; compact?: boolean }) {
  const meta = instanceStatusMeta(status);
  return (
    <span className={`status-pill instance-status ${meta.className} ${compact ? "compact" : ""}`} title={meta.hint}>
      <InstanceStatusIcon status={status} size={compact ? 13 : 14} />
      <span style={{ whiteSpace: "nowrap" }}>{compact ? meta.shortLabel : meta.label}</span>
    </span>
  );
}

function instanceTypeLabel(type: ManagedInstance["type"]): string {
  const labels: Record<ManagedInstance["type"], string> = {
    generic_command: "CMD",
    nodejs: "Node",
    python: "Python",
    java_jar: "Java",
    shell_script: "Shell",
    docker_container: "Docker",
    docker_compose: "Compose",
    minecraft: "MC",
    steam_game_server: "Steam"
  };
  return labels[type] ?? type;
}

function ownerRoleLabel(role?: InstanceAssignee["role"] | null, t: (key: PanelTextKey) => string = (key) => panelT("zh-CN", key)): string {
  if (role === "super_admin") return t("roles.owner.super_admin");
  if (role === "admin") return t("roles.owner.admin");
  return t("roles.owner.user");
}

function managedUserOwnerRole(user: ManagedUser): InstanceAssignee["role"] {
  if (user.roleNames.includes("super_admin")) return "super_admin";
  if (user.roleNames.some((role) => role === "admin" || role === "administrator" || role === "operator")) {
    return "admin";
  }
  return "user";
}

function managedUserAssignee(user: ManagedUser): InstanceAssignee | null {
  const role = managedUserOwnerRole(user);
  if (role === "super_admin") return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role
  };
}

function userDisplayLabel(displayName?: string | null, username?: string | null): string {
  return displayName || username || "未设置";
}

type AssignableEntity = ManagedInstance | DatabaseVisualizerInstance;

function instanceCreatorLabel(instance: AssignableEntity): string {
  return userDisplayLabel(instance.createdByDisplayName, instance.createdByUsername);
}

function instanceAssignedUsers(instance: AssignableEntity): InstanceAssignedUser[] {
  if (instance.assignees?.length) return instance.assignees;
  if (!instance.assignedToUserId) return [];
  return [
    {
      userId: instance.assignedToUserId,
      username: instance.assignedToUsername ?? "",
      displayName: instance.assignedToDisplayName ?? "",
      role: instance.assignedToRole ?? "user"
    }
  ];
}

function primaryAssigneeFields(
  assignees: InstanceAssignedUser[]
): {
  assignedToUserId: string | null;
  assignedToUsername: string | null;
  assignedToDisplayName: string | null;
  assignedToRole: InstanceOwnerRole | null;
} {
  const primary = assignees[0] ?? null;
  return {
    assignedToUserId: primary?.userId ?? null,
    assignedToUsername: primary?.username ?? null,
    assignedToDisplayName: primary?.displayName ?? null,
    assignedToRole: primary?.role ?? null
  };
}

function isInstanceAssignedTo(instance: AssignableEntity, userId: string): boolean {
  return instanceAssignedUsers(instance).some((user) => user.userId === userId);
}

function instanceAssigneeLabel(instance: AssignableEntity): string {
  const assignees = instanceAssignedUsers(instance);
  if (assignees.length === 0) return userDisplayLabel(null, null);
  if (assignees.length <= 2) {
    return assignees.map((user) => userDisplayLabel(user.displayName, user.username)).join(", ");
  }
  return `${userDisplayLabel(assignees[0]?.displayName, assignees[0]?.username)} +${assignees.length - 1}`;
}

function instanceAssigneeTitle(instance: AssignableEntity): string {
  const assignees = instanceAssignedUsers(instance);
  if (assignees.length === 0) return `负责人 · ${ownerRoleLabel(instance.assignedToRole)}`;
  return assignees
    .map((user) => `${userDisplayLabel(user.displayName, user.username)} · ${ownerRoleLabel(user.role)}`)
    .join(", ");
}

function compactCommand(command: string, maxLength = 92): string {
  const compact = command.trim().replace(/\s+/g, " ");
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function compactPathLabel(pathname: string): string {
  if (!pathname) return "-";
  const normalized = pathname.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return pathname;
  return `.../${parts.slice(-2).join("/")}`;
}

function PageErrorToast({
  error,
  onDismiss,
  action,
  autoDismissMs = 12000
}: {
  error: string | null | undefined;
  onDismiss?: () => void;
  action?: React.ReactNode;
  autoDismissMs?: number;
}) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!error || !onDismiss || autoDismissMs <= 0 || hovered) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [error, onDismiss, autoDismissMs, hovered]);

  if (!error) return null;

  return (
    <div
      className="page-error"
      role="alert"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="page-error-icon" aria-hidden="true">
        <AlertTriangle size={15} />
      </div>
      <span className="page-error-text">{error}</span>
      {action ? <div className="page-error-action">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          className="page-error-close"
          onClick={onDismiss}
          title="关闭提示"
          aria-label="关闭错误提示"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

function AccessEmptyView({ user, onOpenAccount }: { user: CurrentUser; onOpenAccount: () => void }) {
  const hasNoPermissions = user.permissions.length === 0;
  const roleLabel = roleNamesDisplay(user.roleNames);

  return (
    <section className="panel-block access-empty-panel">
      <div className="saki-empty-illustration-wrap">
        <img
          src={sakiArtAssets.page404}
          alt="Access denied"
          className="saki-empty-illustration"
          style={{ width: "136px", height: "136px" }}
          draggable={false}
        />
      </div>
      <div className="access-empty-copy">
        <span className="access-empty-kicker">{roleLabel}</span>
        <h2>{hasNoPermissions ? "暂无可用权限" : "暂无可打开的控制台模块"}</h2>
        <p>
          {hasNoPermissions
            ? `当前账号 @${user.username} 还没有被分配任何权限。`
            : `当前账号 @${user.username} 的权限暂时没有对应的侧边栏入口。`}
          请联系管理员调整角色或权限后再回来。
        </p>
      </div>
      <button className="primary-button access-empty-action" type="button" onClick={onOpenAccount}>
        <UserRound size={18} />
        账号设置
      </button>
    </section>
  );
}

function taskTypeLabel(type: import("@webops/shared").ScheduledTaskType): string {
  const labels: Record<import("@webops/shared").ScheduledTaskType, string> = {
    run_command: "执行命令",
    restart_instance: "重启实例",
    stop_instance: "停止实例",
    start_instance: "启动实例"
  };
  return labels[type];
}

function restartPolicyLabel(policy: import("@webops/shared").RestartPolicy): string {
  const labels: Record<import("@webops/shared").RestartPolicy, string> = {
    never: "不自动重启",
    on_failure: "异常退出重启",
    always: "总是重启",
    fixed_interval: "固定间隔重启"
  };
  return labels[policy];
}

function nodeEndpointLabel(node?: ManagedNode | null): string {
  if (!node) return "";
  return `${node.name} · ${node.protocol}://${node.host}:${node.port}`;
}

export {
  taskTypeLabel,
  restartPolicyLabel,
  nodeEndpointLabel,
  MetricTile,
  NodeStatusPill,
  instanceStatusMeta,
  InstanceStatusIcon,
  InstanceStatusBadge,
  instanceTypeLabel,
  ownerRoleLabel,
  managedUserOwnerRole,
  managedUserAssignee,
  userDisplayLabel,
  instanceCreatorLabel,
  instanceAssignedUsers,
  primaryAssigneeFields,
  isInstanceAssignedTo,
  instanceAssigneeLabel,
  instanceAssigneeTitle,
  compactCommand,
  compactPathLabel,
  PageErrorToast,
  AccessEmptyView
};
