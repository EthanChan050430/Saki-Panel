import path from "node:path";
import url from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { ensureBootstrapData } from "./bootstrap.js";
import { panelConfig } from "./config.js";
import { prisma } from "./db.js";
import { createPanelServer } from "./server.js";
import { startTaskScheduler } from "./tasks.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../../prisma/schema.prisma");
const prismaCliPath = path.resolve(__dirname, "../../../node_modules/prisma/build/index.js");
const databasePath = path.resolve(path.dirname(schemaPath), "../data/panel/dev.db");

async function runSchemaSync(): Promise<void> {
  try {
    if (!existsSync(prismaCliPath)) throw new Error(`Prisma CLI not found: ${prismaCliPath}`);
    mkdirSync(path.dirname(databasePath), { recursive: true });
    closeSync(openSync(databasePath, "a"));
    const { stdout, stderr } = await execFileAsync(process.execPath,
      [prismaCliPath, "db", "push", "--accept-data-loss", "--skip-generate", "--schema", schemaPath],
      { timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.warn("Prisma schema push skipped/failed:", error);
    try {
      await prisma.$queryRawUnsafe("SELECT 1 FROM permissions LIMIT 1;");
      console.log("Existing database verified, continuing startup.");
    } catch {
      console.error("Database is inaccessible and schema push failed.");
      throw error;
    }
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

// Keep the panel alive through stray async failures (websocket races, provider
// stream errors); log them instead of crashing every connected session.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error instanceof Error ? error.stack ?? error.message : error);
});
