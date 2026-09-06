import fs from "node:fs/promises";
import { daemonConfig, daemonPaths } from "./config.js";
import { createDaemonServer } from "./server.js";
import { sendHeartbeat, sendInstanceStatusEvent } from "./panel-client.js";
import { instanceManager, setInstanceStatusPushHandler } from "./instance-manager.js";
import { getOrCreateDaemonNodeKey } from "./identity.js";

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

  setInstanceStatusPushHandler(async (event) => {
    try {
      return await sendInstanceStatusEvent(event);
    } catch (error) {
      console.error("Failed to push instance status to panel:", error instanceof Error ? error.message : error);
      return undefined;
    }
  });

  await instanceManager.restorePersistedState();

  const app = await createDaemonServer();
  await app.listen({
    host: daemonConfig.host,
    port: daemonConfig.port
  });

  // Attempt initial panel sync so node token matches panel database
  try {
    await sendHeartbeat();
  } catch {
    // Panel might not be running yet; heartbeat loop will keep retrying
  }

  const { key: nodeKey } = await getOrCreateDaemonNodeKey();
  console.log(`[+] Saki-Daemon listening at ${daemonConfig.protocol}://${daemonConfig.host}:${daemonConfig.port}`);
  console.log(`[+] 机器专属接入密钥 (Node Key): ${nodeKey}`);

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

// A stray rejection (websocket races, pty callbacks, panel push failures) must not
// kill the daemon and every managed instance with it. Log and keep running.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error instanceof Error ? error.stack ?? error.message : error);
});
