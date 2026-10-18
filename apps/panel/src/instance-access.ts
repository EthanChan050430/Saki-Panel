import type { Prisma } from "@prisma/client";
import type { InstanceAssignedUser, InstanceAssignee, InstanceOwnerRole, PermissionCode } from "@webops/shared";
import { noRolePermissionRoleName, isInstanceAssignablePermission } from "@webops/shared";
import { prisma } from "./db.js";
import { panelConfig } from "./config.js";

// Administrative authority must be explicit. Functional permissions (including
// instance.update) and an operator role must never imply cross-user access.
const adminRoleNames = new Set(["admin", "administrator"]);

export const instanceUserInclude = {
  roles: {
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true
            }
          }
        }
      }
    }
  }
} as const;

export const instanceAccessInclude = {
  node: true,
  watchPolicy: { select: { enabled: true } },
  createdBy: {
    include: instanceUserInclude
  },
  assignedTo: {
    include: instanceUserInclude
  },
  assignedUsers: {
    orderBy: {
      assignedAt: "asc"
    },
    include: {
      user: {
        include: instanceUserInclude
      }
    }
  }
} as const;

export type InstanceUserWithRoles = Prisma.UserGetPayload<{ include: typeof instanceUserInclude }>;
export type InstanceWithAccess = Prisma.InstanceGetPayload<{ include: typeof instanceAccessInclude }>;

export interface InstanceAccessProfile {
  userId: string;
  role: InstanceOwnerRole;
  roleNames: string[];
}

export function roleNamesFromUser(user: { roles: Array<{ role: { name: string } }> }): string[] {
  return user.roles
    .map((item) => item.role.name)
    .filter((name) => name !== noRolePermissionRoleName)
    .sort();
}

export function classifyInstanceUser(user: {
  roles: Array<{ role: { name: string; permissions?: Array<{ permission: { code: string } }> } }>;
}): InstanceOwnerRole {
  const roleNames = roleNamesFromUser(user);
  if (roleNames.includes("super_admin")) return "super_admin";
  if (roleNames.some((name) => adminRoleNames.has(name))) return "admin";
  return "user";
}

export function instanceAssignedUsers(instance: InstanceWithAccess): InstanceUserWithRoles[] {
  const assigned = new Map<string, InstanceUserWithRoles>();
  for (const assignment of instance.assignedUsers ?? []) {
    assigned.set(assignment.user.id, assignment.user);
  }
  if (instance.assignedTo) {
    assigned.set(instance.assignedTo.id, instance.assignedTo);
  }
  return [...assigned.values()];
}

export function parseAssignmentPermissions(json: string | null | undefined): PermissionCode[] | null {
  if (json == null) return null;
  try {
    const value = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PermissionCode => typeof item === "string" && isInstanceAssignablePermission(item));
  } catch {
    return [];
  }
}

export function serializeAssignmentPermissions(permissions: PermissionCode[] | null | undefined): string | null {
  if (!permissions) return null;
  return JSON.stringify([...new Set(permissions)].sort());
}

export function assignmentPermissionsFor(instance: InstanceWithAccess, userId: string): PermissionCode[] | null {
  for (const assignment of instance.assignedUsers ?? []) {
    if (assignment.userId === userId) {
      return parseAssignmentPermissions((assignment as { permissionsJson?: string | null }).permissionsJson);
    }
  }
  return null;
}

export function instanceAssignedUserIds(instance: InstanceWithAccess): string[] {
  return instanceAssignedUsers(instance).map((user) => user.id);
}

export function instanceAssignedUserSummaries(instance: InstanceWithAccess): InstanceAssignedUser[] {
  return instanceAssignedUsers(instance).map((user) => ({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: classifyInstanceUser(user),
    permissions: assignmentPermissionsFor(instance, user.id)
  }));
}

function instanceAccessUserIds(instance: InstanceWithAccess): { createdById: string | null } {
  const value = instance as InstanceWithAccess & {
    createdById?: string | null;
  };
  return {
    createdById: value.createdById ?? null
  };
}

export async function loadInstanceAccessProfile(userId: string): Promise<InstanceAccessProfile | null> {
  if (panelConfig.disableAuth) return { userId, role: "super_admin", roleNames: ["auth-disabled"] };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: instanceUserInclude
  });
  if (!user || user.status !== "ACTIVE") return null;
  return {
    userId: user.id,
    role: classifyInstanceUser(user),
    roleNames: roleNamesFromUser(user)
  };
}

export function canAccessInstance(profile: InstanceAccessProfile, instance: InstanceWithAccess): boolean {
  const { createdById } = instanceAccessUserIds(instance);
  const assignees = instanceAssignedUsers(instance);
  if (createdById === profile.userId || assignees.some((user) => user.id === profile.userId)) {
    return true;
  }

  if (profile.role === "super_admin") {
    return true;
  }

  if (profile.role === "admin") {
    const creatorRole = instance.createdBy ? classifyInstanceUser(instance.createdBy) : null;
    return creatorRole === "user";
  }

  return false;
}

export function filterVisibleInstances(
  profile: InstanceAccessProfile | null,
  instances: InstanceWithAccess[]
): InstanceWithAccess[] {
  if (!profile) return [];
  return instances.filter((instance) => canAccessInstance(profile, instance));
}

export async function loadVisibleInstance(userId: string, instanceId: string): Promise<InstanceWithAccess | null> {
  if (instanceId.startsWith("node:")) {
    const nodeId = instanceId.slice(5);
    const [profile, node] = await Promise.all([
      loadInstanceAccessProfile(userId),
      prisma.node.findUnique({
        where: { id: nodeId },
        include: {
          createdBy: {
            include: instanceUserInclude
          }
        }
      })
    ]);
    if (!profile || !node) return null;
    if (profile.role !== "super_admin" && node.createdById && node.createdById !== profile.userId) {
      return null;
    }
    const synthetic = {
      id: `node:${node.id}`,
      name: node.name,
      nodeId: node.id,
      node: node as any,
      workingDirectory: "/",
      status: (node.status === "ONLINE" ? "RUNNING" : "STOPPED") as any,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      processId: null,
      startCommand: "",
      stopCommand: null,
      autoRestart: false,
      autoStart: false,
      runAsUser: null,
      memoryLimit: null,
      cpuLimit: null,
      description: null,
      proxyConfig: null,
      lastStartedAt: null,
      lastStoppedAt: null,
      lastExitCode: null,
      type: "custom",
      restartPolicy: "never",
      restartMaxRetries: 3,
      createdById: node.createdById,
      createdBy: node.createdBy as any,
      assignedTo: null,
      assignedToId: null,
      assignedUsers: []
    } as unknown as InstanceWithAccess;
    return synthetic;
  }

  const [profile, instance] = await Promise.all([
    loadInstanceAccessProfile(userId),
    prisma.instance.findUnique({
      where: { id: instanceId },
      include: instanceAccessInclude
    })
  ]);
  if (!profile || !instance || !canAccessInstance(profile, instance)) return null;
  return instance;
}

// null 表示没有实例级限制；显式空数组表示禁止所有可分配权限。
export function instancePermissionOverride(
  profile: InstanceAccessProfile,
  instance: InstanceWithAccess,
  userPermissions: readonly PermissionCode[]
): PermissionCode[] | null {
  if (!canAccessInstance(profile, instance)) return [];
  if (profile.role === "super_admin") return null;
  if (instanceAccessUserIds(instance).createdById === profile.userId) return null;
  const override = assignmentPermissionsFor(instance, profile.userId);
  if (!override) return null;
  const global = new Set(userPermissions);
  return override.filter((permission) => global.has(permission));
}

export function hasInstancePermission(
  profile: InstanceAccessProfile,
  instance: InstanceWithAccess,
  userPermissions: readonly PermissionCode[],
  permission: PermissionCode
): boolean {
  if (!userPermissions.includes(permission)) return false;
  const effective = instancePermissionOverride(profile, instance, userPermissions);
  if (effective === null) return true;
  return effective.includes(permission);
}

export async function listVisibleInstances(userId: string, take?: number): Promise<InstanceWithAccess[]> {
  const [profile, instances] = await Promise.all([
    loadInstanceAccessProfile(userId),
    prisma.instance.findMany({
      orderBy: { createdAt: "desc" },
      include: instanceAccessInclude
    })
  ]);
  const visible = filterVisibleInstances(profile, instances);
  return take ? visible.slice(0, take) : visible;
}

export async function listInstanceAssignees(userId: string): Promise<InstanceAssignee[]> {
  const profile = await loadInstanceAccessProfile(userId);
  if (!profile || profile.role === "user") return [];

  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ displayName: "asc" }, { username: "asc" }],
    include: instanceUserInclude
  });

  return users
    .map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: classifyInstanceUser(user)
    }))
    .filter((user) => user.role !== "super_admin");
}

export async function resolveAssignableUserId(
  actorUserId: string,
  value: string | null | undefined
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  const userIds = await resolveAssignableUserIds(actorUserId, value ? [value] : []);
  if (userIds === undefined) return undefined;
  return userIds[0] ?? null;
}

export async function resolveAssignableUserIds(
  actorUserId: string,
  value: unknown
): Promise<string[] | undefined> {
  if (value === undefined) return undefined;
  if (value !== null && !Array.isArray(value)) {
    throw Object.assign(new Error("assignedToUserIds must be an array"), { statusCode: 400 });
  }
  const userIds = Array.isArray(value)
    ? [...new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean))]
    : [];

  const [profile, targets] = await Promise.all([
    loadInstanceAccessProfile(actorUserId),
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          include: instanceUserInclude
        })
      : Promise.resolve([])
  ]);

  if (!profile || profile.role === "user") {
    throw Object.assign(new Error("Instance assignment requires administrator privileges"), { statusCode: 403 });
  }
  if (targets.length !== userIds.length) {
    throw Object.assign(new Error("Assignee not found"), { statusCode: 404 });
  }

  const targetsById = new Map(
    targets.map((target) => [
      target.id,
      target
    ])
  );
  for (const userId of userIds) {
    const target = targetsById.get(userId);
    if (!target || target.status !== "ACTIVE") {
      throw Object.assign(new Error("Assignee not found"), { statusCode: 404 });
    }
    if (classifyInstanceUser(target) === "super_admin") {
      throw Object.assign(new Error("Instances can only be assigned to administrators or users"), { statusCode: 400 });
    }
  }

  return userIds;
}

export async function ensureLegacyInstanceAssignments(): Promise<void> {
  const legacyAssignments = await prisma.instance.findMany({
    where: {
      assignedToId: {
        not: null
      }
    },
    select: {
      id: true,
      assignedToId: true
    }
  });

  for (const assignment of legacyAssignments) {
    if (!assignment.assignedToId) continue;
    await prisma.instanceAssignment.upsert({
      where: {
        instanceId_userId: {
          instanceId: assignment.id,
          userId: assignment.assignedToId
        }
      },
      update: {},
      create: {
        instanceId: assignment.id,
        userId: assignment.assignedToId
      }
    });
  }
}
