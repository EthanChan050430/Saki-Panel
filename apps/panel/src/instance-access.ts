import type { Prisma } from "@prisma/client";
import type { InstanceAssignedUser, InstanceAssignee, InstanceOwnerRole, PermissionCode } from "@webops/shared";
import { noRolePermissionRoleName } from "@webops/shared";
import { prisma } from "./db.js";

const adminRoleNames = new Set(["admin", "administrator", "operator"]);
const adminPermissionHints = new Set<PermissionCode>([
  "instance.update",
  "instance.delete",
  "node.create",
  "node.update",
  "user.view",
  "user.delete",
  "role.update"
]);

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

function permissionCodesFromUser(user: {
  roles: Array<{ role: { permissions?: Array<{ permission: { code: string } }> } }>;
}): PermissionCode[] {
  const permissions = new Set<PermissionCode>();
  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions ?? []) {
      permissions.add(rolePermission.permission.code as PermissionCode);
    }
  }
  return [...permissions].sort();
}

export function classifyInstanceUser(user: {
  roles: Array<{ role: { name: string; permissions?: Array<{ permission: { code: string } }> } }>;
}): InstanceOwnerRole {
  const roleNames = roleNamesFromUser(user);
  if (roleNames.includes("super_admin")) return "super_admin";
  if (roleNames.some((name) => adminRoleNames.has(name))) return "admin";
  if (permissionCodesFromUser(user).some((permission) => adminPermissionHints.has(permission))) return "admin";
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

export function instanceAssignedUserIds(instance: InstanceWithAccess): string[] {
  return instanceAssignedUsers(instance).map((user) => user.id);
}

export function instanceAssignedUserSummaries(instance: InstanceWithAccess): InstanceAssignedUser[] {
  return instanceAssignedUsers(instance).map((user) => ({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: classifyInstanceUser(user)
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: instanceUserInclude
  });
  if (!user) return null;
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
    const creatorRole = instance.createdBy ? classifyInstanceUser(instance.createdBy) : null;
    const hasAdminAssignee = assignees.some((user) => classifyInstanceUser(user) === "admin");
    return creatorRole === "super_admin" || creatorRole === "admin" || hasAdminAssignee;
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
