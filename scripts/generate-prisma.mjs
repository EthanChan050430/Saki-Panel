import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const schemaPath = path.join(rootDir, "prisma", "schema.prisma");
const prismaBin = "prisma";
const invocationDir = path.resolve(process.cwd());

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function removeWorkspacePrismaClient(target) {
  const resolved = path.resolve(target);
  const workspaceNodeModules = path.join(invocationDir, "node_modules");
  if (!isInside(rootDir, resolved) || !isInside(workspaceNodeModules, resolved)) {
    throw new Error(`Refusing to remove path outside the workspace node_modules: ${resolved}`);
  }

  try {
    await stat(resolved);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }

  await rm(resolved, { recursive: true, force: true });
  console.log(`Removed stale workspace-local Prisma client: ${path.relative(rootDir, resolved)}`);
}

if (invocationDir !== rootDir && isInside(rootDir, invocationDir)) {
  await removeWorkspacePrismaClient(path.join(invocationDir, "node_modules", "@prisma", "client"));
  await removeWorkspacePrismaClient(path.join(invocationDir, "node_modules", ".prisma"));
}

const child = spawn(prismaBin, ["generate", "--schema", schemaPath], {
  cwd: rootDir,
  env: process.env,
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
let stdout = "";

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("close", async (code) => {
  const isLockedWindowsEngine =
    process.platform === "win32" &&
    stderr.includes("EPERM") &&
    stderr.includes("query_engine-windows.dll.node");

  if (stdout) process.stdout.write(stdout);

  if (code === 0) {
    if (stderr) process.stderr.write(stderr);
    await validateGeneratedClient();
    return;
  }

  if (isLockedWindowsEngine) {
    console.log("Prisma generate could not replace the locked Windows query engine; continuing with the existing client.");
    await validateGeneratedClient();
    return;
  } else {
    if (stderr) process.stderr.write(stderr);
    process.exit(code ?? 1);
  }
});

async function validateGeneratedClient() {
  const generatedTypesPath = path.join(rootDir, "node_modules", ".prisma", "client", "index.d.ts");
  let generatedTypes = "";
  try {
    generatedTypes = await readFile(generatedTypesPath, "utf8");
  } catch {
    console.error(`Could not read generated Prisma types at ${generatedTypesPath}`);
    process.exit(1);
  }

  if (!generatedTypes.includes("instanceAssignment") || !generatedTypes.includes("assignedUsers")) {
    console.error(
      "Generated Prisma client does not include InstanceAssignment. Check that prisma/schema.prisma includes the InstanceAssignment model before building."
    );
    process.exit(1);
  }
}
