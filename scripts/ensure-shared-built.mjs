import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedTypes = path.join(rootDir, "packages", "shared", "dist", "index.d.ts");
const sharedSource = path.join(rootDir, "packages", "shared", "src", "index.ts");

// Key exports the consuming workspaces rely on. If the built type
// definitions are missing any of them, the shared package on this
// machine is outdated and every downstream build will fail with
// confusing "has no exported member" errors.
const REQUIRED_EXPORTS = [
  "TerminalClientMessage",
  "TerminalServerMessage",
  "DiscoveredDatabase",
  "DatabaseVisualizerInstance",
  "DatabaseVisualizerConfig",
  "DatabaseEngine",
  "CreateDatabaseVisualizerRequest",
  "UpdateDatabaseVisualizerRequest",
  "DatabaseTableSummary",
  "DatabaseTableSchema",
  "DatabaseRowsRequest",
  "DatabaseRowsResponse",
  "DatabaseQueryResult",
  "DatabaseInsertRowRequest",
  "DatabaseUpdateRowRequest",
  "DatabaseDeleteRowRequest",
  "DatabaseCreateTableRequest",
  "DatabaseExportRequest",
  "DatabaseImportRequest",
  "InstanceStatus",
  "RestartPolicy",
  "CurrentUser"
];

function findMissingExports(distContent) {
  const missing = [];
  for (const name of REQUIRED_EXPORTS) {
    const pattern = new RegExp(`export (type|interface|declare (const|function|class)) ${name}[\\s<{]`);
    if (!pattern.test(distContent)) {
      missing.push(name);
    }
  }
  return missing;
}

async function readDistTypes() {
  try {
    return await readFile(sharedTypes, "utf8");
  } catch {
    return null;
  }
}

async function sourceIsNewerThanDist() {
  try {
    const [srcStat, distStat] = await Promise.all([stat(sharedSource), stat(sharedTypes)]);
    return srcStat.mtimeMs > distStat.mtimeMs;
  } catch {
    return true;
  }
}

function buildShared() {
  console.log("Building @webops/shared...");
  const result = spawnSync("npm", ["run", "build", "-w", "@webops/shared"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  let distContent = await readDistTypes();
  const needsBuild =
    distContent === null ||
    (await sourceIsNewerThanDist()) ||
    findMissingExports(distContent).length > 0;

  if (needsBuild) {
    buildShared();
    distContent = await readDistTypes();
  }

  if (distContent === null) {
    console.error(`@webops/shared build did not produce ${sharedTypes}`);
    process.exit(1);
  }

  const missing = findMissingExports(distContent);
  if (missing.length > 0) {
    console.error("");
    console.error("ERROR: @webops/shared type definitions are incomplete even after a fresh build.");
    console.error(`Missing exports: ${missing.join(", ")}`);
    console.error("");
    console.error(`This means ${path.relative(rootDir, sharedSource)} on this machine is OUTDATED:`);
    console.error("it does not contain types required by apps/panel, apps/daemon and apps/web.");
    console.error("");
    console.error("Fix: sync the COMPLETE project from your development machine to this server");
    console.error("(especially packages/shared/src/index.ts), then re-run the install script.");
    console.error("Do not sync apps/* only - packages/shared must be synced as well.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
