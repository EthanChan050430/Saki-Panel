import type { Prisma } from "@prisma/client";
import type { InstanceAssignee, InstanceOwnerRole, PermissionCode } from "@webops/shared";
import { prisma } from "./db.js";

const adminRoleNames = new Set(["admin", "administrator", "operator"]);
const adminPermissionHints = new Set<PermissionCode>([
  "instance.update",
  "instance.delete",
  "node.create",
  "node.update",
  "user.view",
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
  return user.roles.map((item) => item.role.name).sort();
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

function instanceAccessUserIds(instance: InstanceWithAccess): { createdById: string | null; assignedToId: string | null } {
  const value = instance as InstanceWithAccess & {
    createdById?: string | null;
    assignedToId?: string | null;
  };
  return {
    createdById: value.createdById ?? null,
    assignedToId: value.assignedToId ?? null
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
  const { createdById, assignedToId } = instanceAccessUserIds(instance);
  if (createdById === profile.userId || assignedToId === profile.userId) {
    return true;
  }

  if (profile.role === "super_admin") {
    const creatorRole = instance.createdBy ? classifyInstanceUser(instance.createdBy) : null;
    const assigneeRole = instance.assignedTo ? classifyInstanceUser(instance.assignedTo) : null;
    return creatorRole === "super_admin" || creatorRole === "admin" || assigneeRole === "admin";
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
  const userId = value?.trim() || null;
  if (!userId) return null;

  const [profile, target] = await Promise.all([
    loadInstanceAccessProfile(actorUserId),
    prisma.user.findUnique({
      where: { id: userId },
      include: instanceUserInclude
    })
  ]);

  if (!profile || profile.role === "user") {
    throw Object.assign(new Error("Instance assignment requires administrator privileges"), { statusCode: 403 });
  }
  if (!target || target.status !== "ACTIVE") {
    throw Object.assign(new Error("Assignee not found"), { statusCode: 404 });
  }
  if (classifyInstanceUser(target) === "super_admin") {
    throw Object.assign(new Error("Instances can only be assigned to administrators or users"), { statusCode: 400 });
  }

  return target.id;
}
