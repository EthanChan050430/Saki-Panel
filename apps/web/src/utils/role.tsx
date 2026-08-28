import React from "react";
import type { ManagedRole, PermissionCode } from "@webops/shared";
import { noRolePermissionRoleName } from "@webops/shared";
import { panelT, type PanelTextKey } from "../i18n/index.js";
import {
  Activity,
  Clock,
  Cpu,
  FileArchive,
  FolderTree,
  Server,
  Sparkles,
  Terminal as TerminalIcon,
  UserCog
} from "lucide-react";

export const PERMISSION_GROUPS: { groupKey: PanelTextKey; items: { code: PermissionCode; labelKey: PanelTextKey }[] }[] = [
  {
    groupKey: "permissions.group.dashboard",
    items: [
      { code: "dashboard.view", labelKey: "permissions.dashboard.view" },
      { code: "system.view", labelKey: "permissions.system.view" },
      { code: "audit.view", labelKey: "permissions.audit.view" }
    ]
  },
  {
    groupKey: "permissions.group.nodes",
    items: [
      { code: "node.view", labelKey: "permissions.node.view" },
      { code: "node.create", labelKey: "permissions.node.create" },
      { code: "node.update", labelKey: "permissions.node.update" },
      { code: "node.delete", labelKey: "permissions.node.delete" },
      { code: "node.test", labelKey: "permissions.node.test" }
    ]
  },
  {
    groupKey: "permissions.group.instances",
    items: [
      { code: "instance.view", labelKey: "permissions.instance.view" },
      { code: "instance.create", labelKey: "permissions.instance.create" },
      { code: "instance.update", labelKey: "permissions.instance.update" },
      { code: "instance.delete", labelKey: "permissions.instance.delete" },
      { code: "instance.start", labelKey: "permissions.instance.start" },
      { code: "instance.stop", labelKey: "permissions.instance.stop" },
      { code: "instance.restart", labelKey: "permissions.instance.restart" },
      { code: "instance.kill", labelKey: "permissions.instance.kill" },
      { code: "instance.logs", labelKey: "permissions.instance.logs" }
    ]
  },
  {
    groupKey: "permissions.group.terminal",
    items: [
      { code: "terminal.view", labelKey: "permissions.terminal.view" },
      { code: "terminal.input", labelKey: "permissions.terminal.input" }
    ]
  },
  {
    groupKey: "permissions.group.files",
    items: [
      { code: "file.view", labelKey: "permissions.file.view" },
      { code: "file.read", labelKey: "permissions.file.read" },
      { code: "file.write", labelKey: "permissions.file.write" },
      { code: "file.delete", labelKey: "permissions.file.delete" }
    ]
  },
  {
    groupKey: "permissions.group.tasks",
    items: [
      { code: "task.view", labelKey: "permissions.task.view" },
      { code: "task.create", labelKey: "permissions.task.create" },
      { code: "task.update", labelKey: "permissions.task.update" },
      { code: "task.delete", labelKey: "permissions.task.delete" },
      { code: "task.run", labelKey: "permissions.task.run" }
    ]
  },
  {
    groupKey: "permissions.group.templates",
    items: [
      { code: "template.view", labelKey: "permissions.template.view" },
      { code: "template.create", labelKey: "permissions.template.create" }
    ]
  },
  {
    groupKey: "permissions.group.users",
    items: [
      { code: "user.view", labelKey: "permissions.user.view" },
      { code: "user.create", labelKey: "permissions.user.create" },
      { code: "user.update", labelKey: "permissions.user.update" },
      { code: "user.delete", labelKey: "permissions.user.delete" },
      { code: "role.view", labelKey: "permissions.role.view" },
      { code: "role.update", labelKey: "permissions.role.update" }
    ]
  },
  {
    groupKey: "permissions.group.saki",
    items: [
      { code: "saki.chat", labelKey: "permissions.saki.chat" },
      { code: "saki.agent", labelKey: "permissions.saki.agent" },
      { code: "saki.skills", labelKey: "permissions.saki.skills" },
      { code: "saki.configure", labelKey: "permissions.saki.configure" }
    ]
  }
];

export const PERM_GROUP_ICONS: Record<string, React.ReactNode> = {
  "permissions.group.dashboard": <Activity size={14} />,
  "permissions.group.nodes": <Server size={14} />,
  "permissions.group.instances": <Cpu size={14} />,
  "permissions.group.terminal": <TerminalIcon size={14} />,
  "permissions.group.files": <FolderTree size={14} />,
  "permissions.group.tasks": <Clock size={14} />,
  "permissions.group.templates": <FileArchive size={14} />,
  "permissions.group.users": <UserCog size={14} />,
  "permissions.group.saki": <Sparkles size={14} />
};

export const elevatedRoleNamesForUi = new Set(["super_admin", "admin", "administrator", "operator"]);
export const elevatedRolePermissionHintsForUi = new Set<PermissionCode>([
  "instance.update",
  "instance.delete",
  "node.create",
  "node.update",
  "node.delete",
  "user.view",
  "user.create",
  "user.update",
  "user.delete",
  "role.view",
  "role.update",
  "system.view"
]);

export function isNoRolePermissionRole(role: ManagedRole): boolean {
  return role.name === noRolePermissionRoleName;
}

export function roleNameDisplayName(roleName: string, t: (key: PanelTextKey) => string = (key) => panelT("zh-CN", key)): string {
  const labels: Record<string, PanelTextKey> = {
    super_admin: "roles.super_admin",
    admin: "roles.admin",
    user: "roles.user",
    operator: "roles.operator",
    readonly: "roles.readonly"
  };
  const key = labels[roleName];
  return key ? t(key) : roleName;
}

export function roleDisplayName(role: ManagedRole, t: (key: PanelTextKey) => string = (key) => panelT("zh-CN", key)): string {
  return isNoRolePermissionRole(role) ? t("users.noRole") : roleNameDisplayName(role.name, t);
}

export function roleNamesDisplay(roleNames: readonly string[], t: (key: PanelTextKey) => string = (key) => panelT("zh-CN", key)): string {
  return roleNames.length > 0 ? roleNames.map((roleName) => roleNameDisplayName(roleName, t)).join(", ") : t("users.noRole");
}

export function isElevatedManagedRole(role: ManagedRole): boolean {
  if (isNoRolePermissionRole(role)) return false;
  return elevatedRoleNamesForUi.has(role.name) || role.permissions.some((permission) => elevatedRolePermissionHintsForUi.has(permission));
}

