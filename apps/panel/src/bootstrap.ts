import { permissions } from "@webops/shared";
import { panelConfig } from "./config.js";
import { panelPaths } from "./config.js";
import { prisma } from "./db.js";
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

  const adminRole = await prisma.role.upsert({
    where: { name: "super_admin" },
    update: {
      description: "Full access to the panel"
    },
    create: {
      name: "super_admin",
      description: "Full access to the panel"
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
          roleId: adminRole.id,
          permissionId: permission.id
        }
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id
      }
    });
  }

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
    "saki.use",
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
    "saki.skills",
    "audit.view"
  ]);

  for (const role of [
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
        roleId: adminRole.id
      }
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id
    }
  });
}
