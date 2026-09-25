#!/usr/bin/env node
/**
 * Create an on-node, checksum-recorded archive of a Paper world's files.
 *
 * The script has no package dependencies and does not include world data. It
 * expects a system tar implementation (available on normal Linux hosts and
 * current Windows Server/Windows installations) and is intentionally explicit
 * about live-world consistency.
 *
 * Safe sequence for a running Paper instance:
 *   console: save-all flush
 *   console: save-off
 *   node backup-world.mjs --allow-live
 *   console: save-on
 */
import { createHash } from "node:crypto";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function usage() {
  console.log(`Usage: node backup-world.mjs [options]

Archives world, world_nether and world_the_end beneath the current directory.
The script never uploads the archive. It deletes only older archives it created
inside the selected backup directory.

Options:
  --world <name>             Primary world directory (default: world)
  --backup-dir <relative>    Destination below server root (default: backups)
  --keep <count>             Retain this many Saki backups (default: 7, 1-3650)
  --allow-live               Acknowledge that save-all flush/save-off was run,
                             or that the server is stopped
  --dry-run                  Show selected world directories without archiving
  --help                     Show this help`);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = { world: "world", backupDir: "backups", keep: 7, allowLive: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--world":
        options.world = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--backup-dir":
        options.backupDir = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--keep": {
        const value = Number(takeValue(argv, index, arg));
        if (!Number.isInteger(value) || value < 1 || value > 3650) {
          throw new Error("--keep must be an integer from 1 to 3650.");
        }
        options.keep = value;
        index += 1;
        break;
      }
      case "--allow-live":
        options.allowLive = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(options.world) || options.world === "." || options.world === "..") {
    throw new Error("--world must be one safe directory name, without path separators.");
  }
  return options;
}

function resolveInside(root, candidate, label) {
  if (!candidate || path.isAbsolute(candidate)) throw new Error(`${label} must be a non-empty relative path.`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside ${resolvedRoot}.`);
  }
  return resolved;
}

async function isDirectory(candidate) {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr = `${stderr}${data}`.slice(-8_000); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`tar failed (${signal || code || "unknown"}): ${stderr.trim() || "no diagnostic output"}`));
    });
  });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const source = createReadStream(filePath);
    source.on("data", (chunk) => hash.update(chunk));
    source.on("error", reject);
    source.on("end", resolve);
  });
  return hash.digest("hex");
}

function backupStamp(now) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function pruneBackups(backupDir, keep) {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^saki-minecraft-\d{8}T\d{6}Z\.tar\.gz$/.test(entry.name)) continue;
    const filePath = path.join(backupDir, entry.name);
    const info = await fs.stat(filePath);
    backups.push({ filePath, mtimeMs: info.mtimeMs });
  }
  backups.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const deleted = [];
  for (const stale of backups.slice(keep)) {
    await fs.rm(stale.filePath, { force: true });
    await fs.rm(`${stale.filePath}.json`, { force: true });
    deleted.push(path.basename(stale.filePath));
  }
  return deleted;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.allowLive) {
    throw new Error("Refusing a potentially inconsistent live backup. Stop the server, or run save-all flush then save-off and pass --allow-live.");
  }
  const root = process.cwd();
  const backupDir = resolveInside(root, options.backupDir, "--backup-dir");
  const requestedWorlds = [options.world, `${options.world}_nether`, `${options.world}_the_end`];
  const worlds = [];
  for (const name of requestedWorlds) {
    const candidate = resolveInside(root, name, "world directory");
    if (await isDirectory(candidate)) worlds.push(name);
  }
  if (worlds.length === 0) {
    throw new Error(`No world directories found. Expected ${requestedWorlds.join(", ")} below ${root}.`);
  }

  if (options.dryRun) {
    console.log(JSON.stringify({ action: "backup-plan", root, backupDir: path.relative(root, backupDir), worlds, keep: options.keep }, null, 2));
    return;
  }
  const tarProbe = spawnSync("tar", ["--version"], { encoding: "utf8", timeout: 8_000 });
  if (tarProbe.error || tarProbe.status !== 0) {
    throw new Error("This backup helper requires a working 'tar' command on the node. Install bsdtar/libarchive or run the documented backup procedure manually.");
  }

  await fs.mkdir(backupDir, { recursive: true });
  const archiveName = `saki-minecraft-${backupStamp(new Date())}.tar.gz`;
  const archivePath = path.join(backupDir, archiveName);
  // '--' ensures a world name can never be interpreted as an option by tar.
  await run("tar", ["-czf", archivePath, "-C", root, "--", ...worlds], { cwd: root });
  const info = await fs.stat(archivePath);
  const digest = await sha256(archivePath);
  const receipt = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    archive: archiveName,
    sha256: digest,
    sizeBytes: info.size,
    worlds,
    consistency: "operator acknowledged --allow-live; use save-all flush/save-off before this command when Paper is running"
  };
  await fs.writeFile(`${archivePath}.json`, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const deleted = await pruneBackups(backupDir, options.keep);
  console.log(JSON.stringify({ action: "backed-up", ...receipt, deleted }, null, 2));
}

main().catch((error) => {
  console.error(`Minecraft backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
