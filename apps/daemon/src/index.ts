import fs from "node:fs/promises";
import { daemonConfig, daemonPaths } from "./config.js";
import { createDaemonServer } from "./server.js";
import { sendHeartbeat } from "./panel-client.js";
import { instanceManager } from "./instance-manager.js";

function startHeartbeatLoop(): NodeJS.Timeout {
  const run = async () => {
    try {
      await sendHeartbeat();
    } catch (error) {
      console.error("Heartbeat failed:", error instanceof Error ? error.message : error);
    }
  };

  void run();
  return setInterval(() => {
    void run();
  }, daemonConfig.heartbeatSeconds * 1000);
}

async function main(): Promise<void> {
  await fs.mkdir(daemonPaths.dataDir, { recursive: true });

  await instanceManager.restorePersistedState();

  const app = await createDaemonServer();
  await app.listen({
    host: daemonConfig.host,
    port: daemonConfig.port
  });

  const heartbeatTimer = startHeartbeatLoop();

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "Shutting down daemon");
    clearInterval(heartbeatTimer);
    await instanceManager.shutdown();
    await app.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
