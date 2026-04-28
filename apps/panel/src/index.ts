import path from "node:path";
import url from "node:url";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ensureBootstrapData } from "./bootstrap.js";
import { panelConfig } from "./config.js";
import { prisma } from "./db.js";
import { createPanelServer } from "./server.js";
import { startTaskScheduler } from "./tasks.js";

const execAsync = promisify(exec);

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../../prisma/schema.prisma");

async function runSchemaSync(): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(
      `npx prisma db push --accept-data-loss --skip-generate --schema "${schemaPath}"`,
      { timeout: 30000, windowsHide: true }
    );
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error("Prisma schema sync failed:", error instanceof Error ? error.message : error);
    throw error;
  }
}

async function main(): Promise<void> {
  await runSchemaSync();
  await ensureBootstrapData();
  const app = await createPanelServer();
  await app.listen({
    host: panelConfig.host,
    port: panelConfig.port
  });
  const stopSchedulers = startTaskScheduler(app.log);

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "Shutting down panel");
    stopSchedulers();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
