import type { FastifyReply, FastifyRequest } from "fastify";
import type { PermissionCode, CurrentUser } from "@webops/shared";
import { noRolePermissionRoleName } from "@webops/shared";
import { prisma } from "./db.js";
import { classifyInstanceUser, roleNamesFromUser } from "./instance-access.js";

export interface JwtUser {
  sub: string;
  username: string;
  permissions: PermissionCode[];
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ message: "Unauthorized" });
  }
}

export function requirePermission(permission: PermissionCode) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (reply.sent) return;
    if (!request.user.permissions.includes(permission)) {
      reply.code(403).send({ message: "Forbidden" });
    }
  };
}

export function requireAnyPermission(allowedPermissions: readonly PermissionCode[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (reply.sent) return;
    if (!allowedPermissions.some((permission) => request.user.permissions.includes(permission))) {
      reply.code(403).send({ message: "Forbidden" });
    }
  };
}

export function requireSuperAdmin() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (reply.sent) return;

    const user = await loadCurrentUser(request.user.sub);
    if (!user || user.status !== "ACTIVE" || !user.isSuperAdmin) {
      reply.code(403).send({ message: "Super administrator privileges are required" });
    }
  };
}

export async function loadCurrentUser(userId: string): Promise<CurrentUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
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
    }
  });

  if (!user) return null;

  const permissions = new Set<PermissionCode>();
  const effectiveClassificationUser = {
    roles: user.roles.map((userRole) => ({
      role: {
        name: userRole.role.name,
        permissions: userRole.role.permissions
      }
    }))
  };
  for (const userRole of user.roles) {
    if (userRole.role.name === noRolePermissionRoleName) continue;
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.code as PermissionCode);
    }
  }
  const roleNames = roleNamesFromUser(user);
  if (roleNames.length === 0) {
    const noRolePermissions = await prisma.role.findUnique({
      where: { name: noRolePermissionRoleName },
      include: {
        permissions: {
          include: {
            permission: true
          }
        }
      }
    });
    for (const rolePermission of noRolePermissions?.permissions ?? []) {
      permissions.add(rolePermission.permission.code as PermissionCode);
    }
    if (noRolePermissions) {
      effectiveClassificationUser.roles.push({
        role: {
          name: noRolePermissionRoleName,
          permissions: noRolePermissions.permissions
        }
      });
    }
  }
  const instanceRole = classifyInstanceUser(effectiveClassificationUser);

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarDataUrl: user.avatarDataUrl,
    status: user.status,
    permissions: [...permissions].sort(),
    roleNames,
    isAdmin: instanceRole === "admin" || instanceRole === "super_admin",
    isSuperAdmin: instanceRole === "super_admin"
  };
}
