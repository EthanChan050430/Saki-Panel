import { noRolePermissionRoleName, permissions } from "@webops/shared";
import { panelConfig } from "./config.js";
import { panelPaths } from "./config.js";
import { prisma } from "./db.js";
import { ensureLegacyInstanceAssignments } from "./instance-access.js";
import { hashPassword } from "./security.js";
import fs from "node:fs/promises";

export async function ensureBootstrapData(): Promise<void> {
  await fs.mkdir(panelPaths.dataDir, { recursive: true });

  for (const code of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: {
        code,
        description: code
      }
    });
  }

  const superAdminRole = await prisma.role.upsert({
    where: { name: "super_admin" },
    update: {
      description: "Full access to the panel"
    },
    create: {
      name: "super_admin",
      description: "Full access to the panel"
    }
  });

  await prisma.role.upsert({
    where: { name: noRolePermissionRoleName },
    update: {
      description: "Permissions applied to users without any assigned role"
    },
    create: {
      name: noRolePermissionRoleName,
      description: "Permissions applied to users without any assigned role"
    }
  });

  const allPermissions = await prisma.permission.findMany({
    where: {
      code: {
        in: [...permissions]
      }
    }
  });

  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdminRole.id,
          permissionId: permission.id
        }
      },
      update: {},
      create: {
        roleId: superAdminRole.id,
        permissionId: permission.id
      }
    });
  }

  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {
      description: "Administrator access for regular operations"
    },
    create: {
      name: "admin",
      description: "Administrator access for regular operations"
    }
  });
  const userRole = await prisma.role.upsert({
    where: { name: "user" },
    update: {
      description: "Standard user access"
    },
    create: {
      name: "user",
      description: "Standard user access"
    }
  });
  const operatorRole = await prisma.role.upsert({
    where: { name: "operator" },
    update: {
      description: "Instance, terminal, file and task operations"
    },
    create: {
      name: "operator",
      description: "Instance, terminal, file and task operations"
    }
  });
  const readonlyRole = await prisma.role.upsert({
    where: { name: "readonly" },
    update: {
      description: "Read-only panel access"
    },
    create: {
      name: "readonly",
      description: "Read-only panel access"
    }
  });

  const operatorPermissions = new Set([
    "dashboard.view",
    "node.view",
    "node.test",
    "instance.view",
    "instance.create",
    "instance.update",
    "instance.start",
    "instance.stop",
    "instance.restart",
    "instance.kill",
    "instance.logs",
    "terminal.view",
    "terminal.input",
    "file.view",
    "file.read",
    "file.write",
    "file.delete",
    "task.view",
    "task.create",
    "task.update",
    "task.delete",
    "task.run",
    "template.view",
    "template.create",
    "user.view",
    "user.update",
    "role.view",
    "saki.use",
    "saki.chat",
    "saki.agent",
    "saki.skills",
    "audit.view"
  ]);
  const readonlyPermissions = new Set([
    "dashboard.view",
    "node.view",
    "instance.view",
    "instance.logs",
    "terminal.view",
    "file.view",
    "file.read",
    "task.view",
    "template.view",
    "saki.use",
    "saki.chat",
    "saki.agent",
    "saki.skills",
    "audit.view"
  ]);

  for (const role of [
    { id: adminRole.id, allowed: operatorPermissions },
    { id: userRole.id, allowed: readonlyPermissions },
    { id: operatorRole.id, allowed: operatorPermissions },
    { id: readonlyRole.id, allowed: readonlyPermissions }
  ]) {
    const targetPermissions = allPermissions.filter((permission) => role.allowed.has(permission.code));
    for (const permission of targetPermissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }

  const passwordHash = await hashPassword(panelConfig.adminPassword);
  const adminUser = await prisma.user.upsert({
    where: { username: panelConfig.adminUsername },
    update: {
      displayName: "Administrator",
      status: "ACTIVE"
    },
    create: {
      username: panelConfig.adminUsername,
      displayName: "Administrator",
      passwordHash,
      status: "ACTIVE"
    }
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: superAdminRole.id
      }
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: superAdminRole.id
    }
  });

  await ensureLegacyInstanceAssignments();
}
