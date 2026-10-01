import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import Fastify from "fastify";
import { prisma } from "../src/db.js";
import { panelConfig } from "../src/config.js";
import { registerGitRoutes } from "../src/routes/git.js";

test("legacy daemon route 404 reports a node update, without masking other failures", async (t) => {
  let daemonMessage: string | null = null;
  const daemon = http.createServer((request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({
      message: daemonMessage ?? `Route GET:${request.url} not found`,
    }));
  });
  daemon.listen(0, "127.0.0.1");
  await once(daemon, "listening");
  t.after(() => new Promise<void>((resolve) => daemon.close(() => resolve())));
  const address = daemon.address();
  assert.ok(address && typeof address === "object");

  const user = { id: "test-user", username: "tester", roles: [
    { role: { name: "super_admin", permissions: [] } },
  ] };
  let visible = true;
  const instance = {
    id: "test-instance",
    workingDirectory: "/test repo",
    createdById: user.id,
    assignedUsers: [],
    node: {
      id: "test-node", name: "旧节点", protocol: "http", host: "127.0.0.1",
      port: address.port, tokenHash: "test-token",
    },
  };
  // Prisma 代理的属性描述符没有方法值，需通过 setter 替换。
  const replace = (model: object, method: string, replacement: () => Promise<unknown>) => {
    const delegate = model as Record<string, unknown>;
    const original = delegate[method];
    delegate[method] = replacement;
    assert.equal(delegate[method], replacement);
    t.after(() => { delegate[method] = original; });
  };
  replace(prisma.user, "findFirst", async () => user);
  replace(prisma.user, "findUnique", async () => user);
  replace(prisma.instance, "findUnique", async () => visible ? instance : null);
  const originalDisableAuth = panelConfig.disableAuth;
  panelConfig.disableAuth = true;
  t.after(() => { panelConfig.disableAuth = originalDisableAuth; });
  const app = Fastify();
  t.after(() => app.close());
  await registerGitRoutes(app);

  const legacy = await app.inject("/api/instances/test-instance/git/status");
  assert.equal(legacy.statusCode, 503);
  assert.equal(legacy.json().code, "GIT_DAEMON_UPDATE_REQUIRED");
  assert.match(legacy.json().message, /旧节点/);
  assert.match(legacy.json().message, /重启守护进程/);

  daemonMessage = "Instance directory not found";
  const missingDirectory = await app.inject("/api/instances/test-instance/git/status");
  assert.equal(missingDirectory.statusCode, 502);
  assert.equal(missingDirectory.json().message, daemonMessage);
  assert.equal(missingDirectory.json().code, undefined);

  visible = false;
  const missingInstance = await app.inject("/api/instances/test-instance/git/status");
  assert.equal(missingInstance.statusCode, 404);
  assert.equal(missingInstance.json().code, undefined);
});
