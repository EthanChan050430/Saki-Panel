import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import type {
  CreateUserRequest,
  ManagedRole,
  ManagedUser,
  PermissionCode,
  UpdateRolePermissionsRequest,
  UpdateUserRequest,
  UserStatus
} from "@webops/shared";
import { noRolePermissionRoleName, permissions } from "@webops/shared";
import { prisma } from "../db.js";
import { loadCurrentUser, requirePermission, requireSuperAdmin } from "../auth.js";
import { normalizeAvatarDataUrl } from "../avatar.js";
import { hashPassword } from "../security.js";
import { writeAuditLog } from "../audit.js";
import { classifyInstanceUser } from "../instance-access.js";
import { createLoginResponse } from "../session.js";

type RoleWithPermissions = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{ permission: { code: string } }>;
};

type UserWithRoles = {
  id: string;
  username: string;
  displayName: string;
  avatarDataUrl: string | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{
    role: {
      id: string;
      name: string;
      permissions?: Array<{ permission: { code: string } }>;
    };
  }>;
};

const elevatedRoleNames = new Set(["super_admin", "admin", "administrator", "operator"]);
const elevatedPermissionHints = new Set<PermissionCode>([
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

const userIncludeForManagement = {
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

const roleIncludeForManagement = {
  permissions: {
    include: {
      permission: true
    }
  }
} as const;

function toManagedRole(role: RoleWithPermissions): ManagedRole {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((item) => item.permission.code as PermissionCode).sort(),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString()
  };
}

function toManagedUser(user: UserWithRoles): ManagedUser {
  const roles = user.roles.filter((item) => item.role.name !== noRolePermissionRoleName);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarDataUrl: user.avatarDataUrl ?? null,
    status: user.status,
    roleIds: roles.map((item) => item.role.id),
    roleNames: roles.map((item) => item.role.name),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function normalizeRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function normalizePermissions(value: unknown): PermissionCode[] {
  const allowed = new Set<string>(permissions);
  return Array.isArray(value) ? value.filter((item): item is PermissionCode => typeof item === "string" && allowed.has(item)) : [];
}

function normalizeRequiredText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw httpError(`${label} is required`, 400);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw httpError(`${label} is required`, 400);
  }
  return trimmed;
}

function normalizeOptionalStatus(value: unknown): UserStatus | undefined {
  if (value === undefined) return undefined;
  if (value === "ACTIVE" || value === "DISABLED") return value;
  throw httpError("Invalid user status", 400);
}

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function errorStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function rolePermissionCodes(role: { permissions?: Array<{ permission: { code: string } }> }): PermissionCode[] {
  return (role.permissions ?? []).map((item) => item.permission.code as PermissionCode);
}

function containsElevatedPermissions(codes: readonly PermissionCode[]): boolean {
  return codes.some((permission) => elevatedPermissionHints.has(permission));
}

function isElevatedRole(role: { name: string; permissions?: Array<{ permission: { code: string } }> }): boolean {
  if (role.name === noRolePermissionRoleName) return false;
  return elevatedRoleNames.has(role.name) || containsElevatedPermissions(rolePermissionCodes(role));
}

function canManageTarget(actor: UserWithRoles, target: UserWithRoles): boolean {
  const actorRole = classifyInstanceUser(actor);
  if (actorRole === "super_admin") return true;
  if (actorRole !== "admin") return false;
  if (actor.id === target.id) return false;
  return classifyInstanceUser(target) === "user";
}

function canSwitchToTarget(target: UserWithRoles): boolean {
  return target.status === "ACTIVE" && classifyInstanceUser(target) !== "super_admin";
}

function canUpdateRolePermissions(
  actor: UserWithRoles,
  role: RoleWithPermissions,
  nextPermissions: readonly PermissionCode[]
): boolean {
  if (classifyInstanceUser(actor) === "super_admin") return true;
  if (isElevatedRole(role)) return false;
  return !containsElevatedPermissions(nextPermissions);
}

async function loadManagementUser(userId: string): Promise<UserWithRoles | null> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    include: userIncludeForManagement
  })) as UserWithRoles | null;
  return user ? withNoRolePermissions(user) : null;
}

async function withNoRolePermissions(user: UserWithRoles): Promise<UserWithRoles> {
  if (user.roles.some((item) => item.role.name !== noRolePermissionRoleName)) return user;
  const noRole = (await prisma.role.findUnique({
    where: { name: noRolePermissionRoleName },
    include: roleIncludeForManagement
  })) as RoleWithPermissions | null;
  if (!noRole || user.roles.some((item) => item.role.name === noRolePermissionRoleName)) return user;
  return {
    ...user,
    roles: [
      ...user.roles,
      {
        role: {
          id: noRole.id,
          name: noRole.name,
          permissions: noRole.permissions
        }
      }
    ]
  };
}

async function loadAssignableRoles(actor: UserWithRoles, roleIds: string[]): Promise<RoleWithPermissions[]> {
  if (roleIds.length === 0) return [];
  if (roleIds.includes(noRolePermissionRoleName)) {
    throw httpError("The no-role permission target cannot be assigned as a user role", 400);
  }

  const roles = (await prisma.role.findMany({
    where: { id: { in: roleIds } },
    include: roleIncludeForManagement
  })) as RoleWithPermissions[];
  if (roles.length !== roleIds.length) {
    throw httpError("One or more roles were not found", 400);
  }
  if (roles.some((role) => role.name === noRolePermissionRoleName)) {
    throw httpError("The no-role permission target cannot be assigned as a user role", 400);
  }

  if (classifyInstanceUser(actor) !== "super_admin" && roles.some(isElevatedRole)) {
    throw httpError("Administrators can only assign non-administrator roles", 403);
  }

  return roles;
}

async function editableRolesForActor(actor: UserWithRoles): Promise<RoleWithPermissions[]> {
  const roles = (await prisma.role.findMany({
    orderBy: { name: "asc" },
    include: roleIncludeForManagement
  })) as RoleWithPermissions[];
  if (classifyInstanceUser(actor) === "super_admin") return roles;
  return roles.filter((role) => role.name === noRolePermissionRoleName || !isElevatedRole(role));
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/roles", { preHandler: requirePermission("role.view") }, async (request) => {
    const actor = await loadManagementUser(request.user.sub);
    if (!actor) return [];
    const roles = await editableRolesForActor(actor);
    return roles.map(toManagedRole);
  });

  app.put("/api/roles/:id/permissions", { preHandler: requirePermission("role.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<UpdateRolePermissionsRequest>;
    const codes = normalizePermissions(body.permissions ?? []);
    const [actor, role] = await Promise.all([
      loadManagementUser(request.user.sub),
      prisma.role.findUnique({ where: { id }, include: roleIncludeForManagement }) as Promise<RoleWithPermissions | null>
    ]);
    if (!actor) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!role) {
      reply.code(404).send({ message: "Role not found" });
      return;
    }
    if (!canUpdateRolePermissions(actor, role, codes)) {
      reply.code(403).send({ message: "Cannot update permissions for this role" });
      return;
    }

    const permissionRows = await prisma.permission.findMany({
      where: { code: { in: codes } }
    });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      ...permissionRows.map((permission) =>
        prisma.rolePermission.create({
          data: {
            roleId: id,
            permissionId: permission.id
          }
        })
      )
    ]);

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "role.permissions.update",
      resourceType: "role",
      resourceId: id,
      payload: { permissions: codes }
    });

    const updated = (await prisma.role.findUniqueOrThrow({
      where: { id },
      include: roleIncludeForManagement
    })) as RoleWithPermissions;
    return toManagedRole(updated);
  });

  app.get("/api/users", { preHandler: requirePermission("user.view") }, async (request, reply) => {
    const actor = await loadManagementUser(request.user.sub);
    if (!actor || classifyInstanceUser(actor) === "user") {
      reply.code(403).send({ message: "Forbidden" });
      return;
    }

    const users = (await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: userIncludeForManagement
    })) as UserWithRoles[];
    const effectiveUsers = await Promise.all(users.map(withNoRolePermissions));
    return effectiveUsers.filter((user) => canManageTarget(actor, user)).map(toManagedUser);
  });

  app.post("/api/users", { preHandler: requirePermission("user.create") }, async (request, reply) => {
    const body = request.body as Partial<CreateUserRequest>;
    const actor = await loadManagementUser(request.user.sub);
    if (!actor || classifyInstanceUser(actor) === "user") {
      reply.code(403).send({ message: "Forbidden" });
      return;
    }

    let username: string;
    let displayName: string;
    let password: string;
    let status: UserStatus | undefined;
    let roleIds: string[];
    try {
      username = normalizeRequiredText(body.username, "Username");
      displayName = normalizeRequiredText(body.displayName, "Display name");
      password = normalizeRequiredText(body.password, "Password");
      status = normalizeOptionalStatus(body.status);
      roleIds = normalizeRoleIds(body.roleIds);
      await loadAssignableRoles(actor, roleIds);
    } catch (error) {
      reply.code(errorStatus(error)).send({ message: error instanceof Error ? error.message : "Invalid user" });
      return;
    }

    try {
      const user = (await prisma.user.create({
        data: {
          username,
          displayName,
          passwordHash: await hashPassword(password),
          status: status ?? "ACTIVE",
          roles: {
            create: roleIds.map((roleId) => ({ roleId }))
          }
        },
        include: userIncludeForManagement
      })) as UserWithRoles;

      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "user.create",
        resourceType: "user",
        resourceId: user.id,
        payload: { username: user.username, roleIds }
      });
      return toManagedUser(user);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        reply.code(409).send({ message: "Username is already in use" });
        return;
      }
      throw error;
    }
  });

  app.put("/api/users/:id", { preHandler: requirePermission("user.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<UpdateUserRequest>;
    const [actor, existingUser] = await Promise.all([
      loadManagementUser(request.user.sub),
      prisma.user.findUnique({ where: { id }, include: userIncludeForManagement }) as Promise<UserWithRoles | null>
    ]);
    if (!actor) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!existingUser) {
      reply.code(404).send({ message: "User not found" });
      return;
    }
    const existing = await withNoRolePermissions(existingUser);
    if (!canManageTarget(actor, existing)) {
      reply.code(403).send({ message: "Cannot edit this user" });
      return;
    }

    const roleIds = body.roleIds === undefined ? undefined : normalizeRoleIds(body.roleIds);
    const data: {
      username?: string;
      displayName?: string;
      avatarDataUrl?: string | null;
      status?: UserStatus;
      passwordHash?: string;
    } = {};
    try {
      if (body.username !== undefined) data.username = normalizeRequiredText(body.username, "Username");
      if (body.displayName !== undefined) data.displayName = normalizeRequiredText(body.displayName, "Display name");
      const avatarDataUrl = normalizeAvatarDataUrl(body.avatarDataUrl);
      if (avatarDataUrl !== undefined) data.avatarDataUrl = avatarDataUrl;
      if (body.status !== undefined) {
        const status = normalizeOptionalStatus(body.status);
        if (status !== undefined) data.status = status;
      }
      if (data.status === "DISABLED" && actor.id === existing.id) {
        throw httpError("You cannot disable your own account", 400);
      }
      if (body.password) data.passwordHash = await hashPassword(body.password);
      if (roleIds !== undefined) {
        if (actor.id === existing.id) {
          throw httpError("You cannot change your own roles", 400);
        }
        await loadAssignableRoles(actor, roleIds);
      }
    } catch (error) {
      reply.code(errorStatus(error)).send({ message: error instanceof Error ? error.message : "Invalid user update" });
      return;
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [prisma.user.update({ where: { id }, data })];
    if (roleIds !== undefined) {
      operations.push(prisma.userRole.deleteMany({ where: { userId: id } }));
      operations.push(...roleIds.map((roleId) => prisma.userRole.create({ data: { userId: id, roleId } })));
    }

    try {
      await prisma.$transaction(operations);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        reply.code(409).send({ message: "Username is already in use" });
        return;
      }
      throw error;
    }

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "user.update",
      resourceType: "user",
      resourceId: id,
      payload: {
        username: data.username !== undefined,
        displayName: data.displayName !== undefined,
        avatar: data.avatarDataUrl !== undefined,
        status: data.status,
        password: data.passwordHash !== undefined,
        roleIds
      }
    });

    const updated = (await prisma.user.findUniqueOrThrow({
      where: { id },
      include: userIncludeForManagement
    })) as UserWithRoles;
    return toManagedUser(updated);
  });

  app.delete("/api/users/:id", { preHandler: requirePermission("user.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [actor, existingUser] = await Promise.all([
      loadManagementUser(request.user.sub),
      prisma.user.findUnique({ where: { id }, include: userIncludeForManagement }) as Promise<UserWithRoles | null>
    ]);
    if (!actor) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!existingUser) {
      reply.code(404).send({ message: "User not found" });
      return;
    }

    const existing = await withNoRolePermissions(existingUser);
    if (actor.id === existing.id) {
      reply.code(400).send({ message: "You cannot delete your own account" });
      return;
    }
    if (!canManageTarget(actor, existing)) {
      reply.code(403).send({ message: "Cannot delete this user" });
      return;
    }

    const target = toManagedUser(existing);
    await prisma.user.delete({ where: { id } });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "user.delete",
      resourceType: "user",
      resourceId: id,
      payload: { username: target.username, roleNames: target.roleNames }
    });

    return { ok: true };
  });

  app.post("/api/users/:id/switch", { preHandler: requireSuperAdmin() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user.sub) {
      reply.code(400).send({ message: "You are already using this account" });
      return;
    }

    const targetUser = (await prisma.user.findUnique({
      where: { id },
      include: userIncludeForManagement
    })) as UserWithRoles | null;
    if (!targetUser) {
      reply.code(404).send({ message: "User not found" });
      return;
    }
    const target = await withNoRolePermissions(targetUser);
    if (!canSwitchToTarget(target)) {
      reply.code(403).send({ message: "Super administrators can switch only to active administrator or user accounts" });
      return;
    }

    const currentUser = await loadCurrentUser(target.id);
    if (!currentUser) {
      reply.code(500).send({ message: "Unable to load user" });
      return;
    }

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "user.switch",
      resourceType: "user",
      resourceId: target.id,
      payload: { username: target.username, roleNames: currentUser.roleNames }
    });

    return createLoginResponse(app, currentUser);
  });
}
