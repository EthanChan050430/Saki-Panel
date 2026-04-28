import type { FastifyReply, FastifyRequest } from "fastify";
import type { PermissionCode, CurrentUser } from "@webops/shared";
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
  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.code as PermissionCode);
    }
  }
  const roleNames = roleNamesFromUser(user);
  const instanceRole = classifyInstanceUser(user);

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
