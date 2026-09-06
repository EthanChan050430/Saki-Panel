import type { Prisma } from "@prisma/client";
import type { CurrentUser } from "@webops/shared";
import { prisma } from "./db.js";

export const nodeCreatorSelect = {
  id: true,
  username: true,
  displayName: true
} as const;

export const nodeIncludeWithAccess = {
  createdBy: {
    select: nodeCreatorSelect
  },
  metrics: {
    orderBy: { createdAt: "desc" as const },
    take: 1
  }
} as const;

export function nodeVisibilityWhere(user: CurrentUser, includeAll = false): Prisma.NodeWhereInput {
  if (includeAll && user.isSuperAdmin) {
    return {};
  }
  if (user.isSuperAdmin) {
    return {
      OR: [
        { createdById: user.id },
        { createdById: null }
      ]
    };
  }
  return {
    createdById: user.id
  };
}

export function canAccessNode(user: CurrentUser, node: { createdById?: string | null }): boolean {
  if (!node.createdById) {
    return user.isSuperAdmin;
  }
  return node.createdById === user.id;
}

export async function loadVisibleNode(user: CurrentUser, nodeId: string) {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    include: nodeIncludeWithAccess
  });
  if (!node || !canAccessNode(user, node)) {
    return null;
  }
  return node;
}
