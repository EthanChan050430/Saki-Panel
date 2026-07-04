import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedTypes = path.join(rootDir, "packages", "shared", "dist", "index.d.ts");

async function main() {
  try {
    await access(sharedTypes);
    return;
  } catch {
    // Build the shared workspace package before panel/daemon/web compile.
  }

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

  try {
    await access(sharedTypes);
  } catch {
    console.error(`@webops/shared build did not produce ${sharedTypes}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});