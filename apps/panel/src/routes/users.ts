import type { FastifyInstance } from "fastify";
import type {
  CreateUserRequest,
  ManagedRole,
  ManagedUser,
  PermissionCode,
  UpdateRolePermissionsRequest,
  UpdateUserRequest
} from "@webops/shared";
import { permissions } from "@webops/shared";
import { prisma } from "../db.js";
import { requirePermission } from "../auth.js";
import { hashPassword } from "../security.js";
import { writeAuditLog } from "../audit.js";

function toManagedRole(role: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{ permission: { code: string } }>;
}): ManagedRole {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((item) => item.permission.code as PermissionCode).sort(),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString()
  };
}

function toManagedUser(user: {
  id: string;
  username: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{ role: { id: string; name: string } }>;
}): ManagedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    roleIds: user.roles.map((item) => item.role.id),
    roleNames: user.roles.map((item) => item.role.name),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function normalizeRoleIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizePermissions(value: string[]): PermissionCode[] {
  const allowed = new Set<string>(permissions);
  return value.filter((item): item is PermissionCode => allowed.has(item));
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/roles", { preHandler: requirePermission("role.view") }, async () => {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });
    return roles.map(toManagedRole);
  });

  app.put("/api/roles/:id/permissions", { preHandler: requirePermission("role.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<UpdateRolePermissionsRequest>;
    const codes = normalizePermissions(body.permissions ?? []);
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) {
      reply.code(404).send({ message: "Role not found" });
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

    const updated = await prisma.role.findUniqueOrThrow({
      where: { id },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });
    return toManagedRole(updated);
  });

  app.get("/api/users", { preHandler: requirePermission("user.view") }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        roles: {
          include: { role: true }
        }
      }
    });
    return users.map(toManagedUser);
  });

  app.post("/api/users", { preHandler: requirePermission("user.create") }, async (request, reply) => {
    const body = request.body as Partial<CreateUserRequest>;
    if (!body.username || !body.password || !body.displayName) {
      reply.code(400).send({ message: "username, password and displayName are required" });
      return;
    }

    const roleIds = normalizeRoleIds(body.roleIds);
    const user = await prisma.user.create({
      data: {
        username: body.username.trim(),
        displayName: body.displayName.trim(),
        passwordHash: await hashPassword(body.password),
        status: body.status ?? "ACTIVE",
        roles: {
          create: roleIds.map((roleId) => ({ roleId }))
        }
      },
      include: {
        roles: {
          include: { role: true }
        }
      }
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "user.create",
      resourceType: "user",
      resourceId: user.id,
      payload: { username: user.username, roleIds }
    });
    return toManagedUser(user);
  });

  app.put("/api/users/:id", { preHandler: requirePermission("user.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<UpdateUserRequest>;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      reply.code(404).send({ message: "User not found" });
      return;
    }

    const roleIds = body.roleIds === undefined ? undefined : normalizeRoleIds(body.roleIds);
    const data: {
      displayName?: string;
      status?: "ACTIVE" | "DISABLED";
      passwordHash?: string;
    } = {};
    if (body.displayName !== undefined) data.displayName = body.displayName.trim();
    if (body.status !== undefined) data.status = body.status;
    if (body.password) data.passwordHash = await hashPassword(body.password);

    const operations = [];
    operations.push(prisma.user.update({ where: { id }, data }));
    if (roleIds) {
      operations.push(prisma.userRole.deleteMany({ where: { userId: id } }));
      operations.push(...roleIds.map((roleId) => prisma.userRole.create({ data: { userId: id, roleId } })));
    }
    await prisma.$transaction(operations);

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "user.update",
      resourceType: "user",
      resourceId: id,
      payload: { roleIds }
    });

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: {
        roles: {
          include: { role: true }
        }
      }
    });
    return toManagedUser(updated);
  });
}
