import test from "node:test";
import assert from "node:assert/strict";
import { createDaemonServer } from "../src/server.js";

test("daemon registers every Git endpoint and protects it with authentication", async () => {
  const app = await createDaemonServer();
  try {
    for (const [method, action] of [
      ["GET", "status"],
      ["GET", "history"],
      ["GET", "diff"],
      ["POST", "init"],
      ["POST", "ignore"],
      ["POST", "commit"],
    ] as const) {
      assert.equal(
        app.hasRoute({ method, url: `/api/instances/:id/git/${action}` }),
        true,
        `${method} git/${action} must be registered on the production server`,
      );
      const response = await app.inject({
        method,
        url: `/api/instances/test-instance/git/${action}?workingDirectory=%2Ftest`,
      });
      assert.equal(response.statusCode, 401, `${action} must require credentials`);
      assert.equal(response.json().message, "Missing daemon credentials");
    }
  } finally {
    await app.close();
  }
});
