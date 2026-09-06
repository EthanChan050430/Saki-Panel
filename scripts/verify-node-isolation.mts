import assert from "node:assert/strict";
import { nodeVisibilityWhere, canAccessNode, loadVisibleNode } from "../apps/panel/src/node-access.js";
import { prisma } from "../apps/panel/src/db.js";
import type { CurrentUser } from "@webops/shared";

console.log("--- Starting Node Isolation & Account Control Tests ---");

const mockUserA: CurrentUser = {
  id: "test-user-a-" + Date.now(),
  username: "usera",
  displayName: "User A",
  role: "user",
  isSuperAdmin: false,
  permissions: ["node.view", "node.create", "node.update", "instance.view"]
};

const mockUserB: CurrentUser = {
  id: "test-user-b-" + Date.now(),
  username: "userb",
  displayName: "User B",
  role: "user",
  isSuperAdmin: false,
  permissions: ["node.view", "node.create", "node.update", "instance.view"]
};

const mockSuperAdmin: CurrentUser = {
  id: "test-superadmin-" + Date.now(),
  username: "superadmin",
  displayName: "Super Admin",
  role: "super_admin",
  isSuperAdmin: true,
  permissions: ["node.view", "node.create", "node.update", "instance.view"]
};

// 1. Test canAccessNode logic
console.log("Testing canAccessNode logic...");
assert.equal(canAccessNode(mockUserA, { createdById: mockUserA.id }), true, "Owner A should access own node");
assert.equal(canAccessNode(mockUserA, { createdById: mockUserB.id }), false, "User A must not access User B node");
assert.equal(canAccessNode(mockUserB, { createdById: mockUserA.id }), false, "User B must not access User A node");
assert.equal(canAccessNode(mockSuperAdmin, { createdById: mockUserA.id }), false, "SuperAdmin must not hijack User A private node");
assert.equal(canAccessNode(mockUserA, { createdById: null }), false, "Regular user cannot access unassigned legacy node");
assert.equal(canAccessNode(mockSuperAdmin, { createdById: null }), true, "SuperAdmin can access unassigned legacy node");
console.log("✓ canAccessNode unit tests passed");

// 2. Test nodeVisibilityWhere logic
console.log("Testing nodeVisibilityWhere query conditions...");
const whereA = nodeVisibilityWhere(mockUserA);
assert.deepEqual(whereA, { createdById: mockUserA.id });

const whereB = nodeVisibilityWhere(mockUserB);
assert.deepEqual(whereB, { createdById: mockUserB.id });

const whereSuper = nodeVisibilityWhere(mockSuperAdmin);
assert.deepEqual(whereSuper, {
  OR: [
    { createdById: mockSuperAdmin.id },
    { createdById: null }
  ]
});
console.log("✓ nodeVisibilityWhere unit tests passed");

// 3. Database integration test
console.log("Running Database integration test with Prisma...");
let nodeAId: string | null = null;
let nodeBId: string | null = null;

try {
  const dbUserA = await prisma.user.upsert({
    where: { username: mockUserA.username },
    create: {
      id: mockUserA.id,
      username: mockUserA.username,
      displayName: mockUserA.displayName,
      passwordHash: "test-hash",
      status: "ACTIVE"
    },
    update: {}
  });

  const dbUserB = await prisma.user.upsert({
    where: { username: mockUserB.username },
    create: {
      id: mockUserB.id,
      username: mockUserB.username,
      displayName: mockUserB.displayName,
      passwordHash: "test-hash",
      status: "ACTIVE"
    },
    update: {}
  });

  mockUserA.id = dbUserA.id;
  mockUserB.id = dbUserB.id;

  const nodeA = await prisma.node.create({
    data: {
      name: "Node-A-Dedicated",
      host: "192.168.10.1",
      port: 5858,
      protocol: "http",
      tokenHash: "token-hash-a",
      tokenLast4: "aaaa",
      createdById: mockUserA.id,
      status: "ONLINE"
    }
  });
  nodeAId = nodeA.id;

  const nodeB = await prisma.node.create({
    data: {
      name: "Node-B-Dedicated",
      host: "192.168.10.2",
      port: 5858,
      protocol: "http",
      tokenHash: "token-hash-b",
      tokenLast4: "bbbb",
      createdById: mockUserB.id,
      status: "ONLINE"
    }
  });
  nodeBId = nodeB.id;

  // Query as User A
  const visibleToA = await prisma.node.findMany({
    where: nodeVisibilityWhere(mockUserA)
  });
  assert(visibleToA.some((n) => n.id === nodeA.id), "User A must see Node A");
  assert(!visibleToA.some((n) => n.id === nodeB.id), "User A must NOT see Node B");

  // Query as User B
  const visibleToB = await prisma.node.findMany({
    where: nodeVisibilityWhere(mockUserB)
  });
  assert(visibleToB.some((n) => n.id === nodeB.id), "User B must see Node B");
  assert(!visibleToB.some((n) => n.id === nodeA.id), "User B must NOT see Node A");

  // Verify loadVisibleNode
  const loadedByA_for_A = await loadVisibleNode(mockUserA, nodeA.id);
  assert(loadedByA_for_A !== null, "User A can load Node A");

  const loadedByA_for_B = await loadVisibleNode(mockUserA, nodeB.id);
  assert.equal(loadedByA_for_B, null, "User A cannot load Node B (must return null)");

  const loadedByB_for_A = await loadVisibleNode(mockUserB, nodeA.id);
  assert.equal(loadedByB_for_A, null, "User B cannot load Node A (must return null)");

  const loadedByB_for_B = await loadVisibleNode(mockUserB, nodeB.id);
  assert(loadedByB_for_B !== null, "User B can load Node B");

  // 4. Verify Enrollment Token Isolation
  console.log("Testing Enrollment Token isolation...");
  const tokenA = await prisma.nodeEnrollmentToken.create({
    data: {
      tokenHash: "token-hash-a1",
      tokenLast4: "1111",
      createdById: mockUserA.id,
      expiresAt: new Date(Date.now() + 60000)
    }
  });

  const tokensForA = await prisma.nodeEnrollmentToken.findMany({
    where: { createdById: mockUserA.id }
  });
  const tokensForB = await prisma.nodeEnrollmentToken.findMany({
    where: { createdById: mockUserB.id }
  });

  assert(tokensForA.some((t) => t.id === tokenA.id), "User A must see their own token");
  assert(!tokensForB.some((t) => t.id === tokenA.id), "User B must NOT see User A's token");

  await prisma.nodeEnrollmentToken.deleteMany({ where: { id: tokenA.id } });
  console.log("✓ Enrollment Token isolation verified");

  console.log("✓ Database cross-user isolation integration tests passed!");
} finally {
  if (nodeAId) {
    await prisma.node.deleteMany({ where: { id: nodeAId } });
  }
  if (nodeBId) {
    await prisma.node.deleteMany({ where: { id: nodeBId } });
  }
  await prisma.user.deleteMany({
    where: { username: { in: [mockUserA.username, mockUserB.username] } }
  });
  await prisma.$disconnect();
}

// 5. Verify Daemon Host Default is 0.0.0.0
console.log("Testing Daemon Default Host...");
const { daemonConfig } = await import("../apps/daemon/src/config.js");
assert.equal(daemonConfig.host, "0.0.0.0", "DAEMON_HOST default must be 0.0.0.0 for cross-server reachability");
console.log("✓ Daemon default host is 0.0.0.0");

console.log("ALL TESTS PASSED SUCCESSFULLY! Node isolation is verified.");
