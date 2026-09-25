#!/usr/bin/env node
/**
 * Downloads a pinned Paper stable build directly from PaperMC's Fill service.
 *
 * This file deliberately contains no server JAR. It is a small, auditable
 * bootstrapper that is downloaded by the Saki Minecraft operations pack only
 * when an operator requests it.
 *
 * Examples:
 *   node install-paper.mjs --minecraft-version 1.21.11 --dry-run
 *   node install-paper.mjs --minecraft-version 1.21.11 --target paper.jar
 *   node install-paper.mjs --minecraft-version 1.21.11 --replace --accept-eula
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const fillApiHost = "fill.papermc.io";
const fillDownloadHosts = new Set(["fill-data.papermc.io"]);
const userAgent = "Saki-Panel-Minecraft-Pack/1.0 (https://github.com/EthanChan050430/Saki-Panel)";
const sha256Pattern = /^[a-f0-9]{64}$/;

function usage() {
  console.log(`Usage: node install-paper.mjs [options]

Downloads one explicitly requested Paper STABLE build from PaperMC. Existing
server JARs are never overwritten unless --replace is supplied.

Options:
  --minecraft-version <version|latest>  Explicit Minecraft version to resolve
  --target <relative-path>               JAR output path (default: paper.jar)
  --replace                              Replace an existing target after verification
  --accept-eula                          Write eula=true after the operator accepts Mojang's EULA
  --dry-run                              Resolve and verify metadata without downloading a JAR
  --help                                 Show this help

The installer intentionally does not auto-update a running server. A version
is required; use 'latest' only when you explicitly intend to resolve it. Run
again with a pinned version and --replace only during an approved upgrade.`);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArgs(argv) {
  const options = {
    minecraftVersion: "",
    target: "paper.jar",
    replace: false,
    acceptEula: false,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--minecraft-version":
        options.minecraftVersion = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--target":
        options.target = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--replace":
        options.replace = true;
        break;
      case "--accept-eula":
        options.acceptEula = true;
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

  if (options.help) return options;
  if (!options.minecraftVersion) {
    throw new Error("--minecraft-version is required. Use a pinned version such as 1.21.11; pass 'latest' only deliberately.");
  }
  if (options.minecraftVersion !== "latest" && !/^\d+(?:\.\d+){1,2}$/.test(options.minecraftVersion)) {
    throw new Error("--minecraft-version must be a released version such as 1.21.11 or 26.2, or 'latest'.");
  }
  return options;
}

function resolveInside(root, candidate, label) {
  if (!candidate || path.isAbsolute(candidate)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside ${resolvedRoot}.`);
  }
  return resolved;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function collectVersions(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((group) => collectVersions(group));
}

function assertUrl(url, allowedHosts, label) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error(`${label} must use an approved HTTPS PaperMC host.`);
  }
  return parsed;
}

async function fetchJson(url) {
  assertUrl(url, new Set([fillApiHost]), "PaperMC API URL");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    redirect: "error",
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`PaperMC API returned HTTP ${response.status}.`);
  return response.json();
}

function buildNumber(build) {
  const raw = build && typeof build === "object" ? build.id ?? build.number : null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : -1;
}

async function resolveStablePaperBuild(requestedVersion) {
  const project = await fetchJson(`https://${fillApiHost}/v3/projects/paper`);
  const versions = collectVersions(project?.versions).filter((version) => /^\d+(?:\.\d+){1,2}$/.test(version));
  const minecraftVersion = requestedVersion === "latest"
    ? [...new Set(versions)].sort((left, right) => compareVersions(right, left))[0]
    : requestedVersion;
  if (!minecraftVersion) throw new Error("PaperMC did not return a supported Minecraft version.");
  if (requestedVersion !== "latest" && !versions.includes(minecraftVersion)) {
    throw new Error(`Paper does not publish Minecraft ${minecraftVersion} through the current Fill catalog.`);
  }

  const builds = await fetchJson(
    `https://${fillApiHost}/v3/projects/paper/versions/${encodeURIComponent(minecraftVersion)}/builds`
  );
  if (!Array.isArray(builds)) throw new Error("PaperMC returned an unexpected build catalog.");
  const stable = builds
    .filter((build) => build && typeof build === "object" && build.channel === "STABLE")
    .sort((left, right) => buildNumber(right) - buildNumber(left))[0];
  if (!stable) throw new Error(`Paper has no stable build for Minecraft ${minecraftVersion}. Choose a different version.`);

  const download = stable.downloads?.["server:default"];
  const url = typeof download?.url === "string" ? download.url : "";
  const sha256 = typeof download?.checksums?.sha256 === "string" ? download.checksums.sha256.toLowerCase() : "";
  if (!url || !sha256Pattern.test(sha256)) {
    throw new Error("PaperMC did not provide a verifiable server download.");
  }
  const parsedUrl = assertUrl(url, fillDownloadHosts, "Paper server download URL");

  return {
    minecraftVersion,
    build: buildNumber(stable),
    fileName: typeof download.name === "string" ? download.name : "paper.jar",
    url: parsedUrl.toString(),
    sha256,
    size: typeof download.size === "number" && Number.isSafeInteger(download.size) && download.size > 0 ? download.size : null
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  const handle = await readFile(filePath);
  hash.update(handle);
  return hash.digest("hex");
}

function recommendedJavaMajor(version) {
  const parts = version.split(".").map((part) => Number(part));
  if (parts[0] >= 26) return 25;
  if (parts[0] === 1 && parts[1] >= 20) return 21;
  if (parts[0] === 1 && parts[1] >= 17) return 17;
  if (version === "1.16.5") return 16;
  if (parts[0] === 1 && parts[1] >= 12) return 11;
  return 8;
}

function installedJavaMajor() {
  const result = spawnSync("java", ["-version"], { encoding: "utf8", timeout: 8_000 });
  if (result.error || result.status !== 0) return null;
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = text.match(/version\s+"(?:1\.)?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function uniquePreviousPath(targetPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${targetPath}.saki-previous-${stamp}`;
}

async function downloadVerified(url, expectedSha256, expectedSize, targetPath) {
  assertUrl(url, fillDownloadHosts, "Paper server download URL");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    redirect: "error",
    signal: AbortSignal.timeout(10 * 60_000)
  });
  if (!response.ok || !response.body) throw new Error(`Paper download returned HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (expectedSize !== null && Number.isSafeInteger(declaredSize) && declaredSize !== expectedSize) {
    await response.body.cancel().catch(() => undefined);
    throw new Error(`Paper download size mismatch before writing: expected ${expectedSize}, got ${declaredSize}.`);
  }
  const tempPath = `${targetPath}.saki-part-${process.pid}-${Date.now()}`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath, { flags: "wx", mode: 0o644 }));
    const writtenSize = (await stat(tempPath)).size;
    if (expectedSize !== null && writtenSize !== expectedSize) {
      throw new Error(`Paper download size mismatch: expected ${expectedSize}, got ${writtenSize}.`);
    }
    const actualSha256 = await hashFile(tempPath);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actualSha256}.`);
    }
    return tempPath;
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeEula(root) {
  const eulaPath = resolveInside(root, "eula.txt", "EULA file");
  const content = [
    "# This file was written only after an operator passed --accept-eula.",
    "# By setting eula=true, you indicate your agreement to https://aka.ms/MinecraftEULA.",
    "eula=true",
    ""
  ].join("\n");
  await writeFile(eulaPath, content, "utf8");
  return eulaPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const root = process.cwd();
  const targetPath = resolveInside(root, options.target, "--target");
  const metadata = await resolveStablePaperBuild(options.minecraftVersion);
  const requiredJava = recommendedJavaMajor(metadata.minecraftVersion);
  const actualJava = installedJavaMajor();
  const result = {
    action: options.dryRun ? "resolved" : "installed",
    minecraftVersion: metadata.minecraftVersion,
    build: metadata.build,
    sourceFile: metadata.fileName,
    target: path.relative(root, targetPath) || path.basename(targetPath),
    sha256: metadata.sha256,
    sizeBytes: metadata.size,
    recommendedJavaMajor: requiredJava,
    installedJavaMajor: actualJava,
    eulaAccepted: options.acceptEula
  };

  if (actualJava === null) {
    console.warn(`Warning: java was not found. Paper ${metadata.minecraftVersion} needs Java ${requiredJava} or newer.`);
  } else if (actualJava < requiredJava) {
    console.warn(`Warning: detected Java ${actualJava}; Paper ${metadata.minecraftVersion} needs Java ${requiredJava} or newer.`);
  }

  if (options.dryRun) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (await exists(targetPath) && !options.replace) {
    throw new Error(`${options.target} already exists. Refusing to overwrite it; pass --replace after a backup and approved upgrade.`);
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  const downloadedPath = await downloadVerified(metadata.url, metadata.sha256, metadata.size, targetPath);
  let previousPath = null;
  try {
    if (await exists(targetPath)) {
      previousPath = uniquePreviousPath(targetPath);
      await rename(targetPath, previousPath);
    }
    await rename(downloadedPath, targetPath);
  } catch (error) {
    await rm(downloadedPath, { force: true }).catch(() => undefined);
    if (previousPath && await exists(previousPath) && !(await exists(targetPath))) {
      await rename(previousPath, targetPath).catch(() => undefined);
    }
    throw error;
  }

  const receiptPath = resolveInside(root, "saki-paper-install.json", "install receipt");
  await writeFile(receiptPath, `${JSON.stringify({
    ...result,
    downloadedAt: new Date().toISOString(),
    sourceUrl: metadata.url,
    previousJar: previousPath ? path.relative(root, previousPath) : null
  }, null, 2)}\n`, "utf8");
  const eulaPath = options.acceptEula ? await writeEula(root) : null;
  const targetStats = await stat(targetPath);
  console.log(JSON.stringify({
    ...result,
    action: "installed",
    writtenBytes: targetStats.size,
    previousJar: previousPath ? path.relative(root, previousPath) : null,
    receipt: path.relative(root, receiptPath),
    eula: eulaPath ? path.relative(root, eulaPath) : "not changed"
  }, null, 2));
}

main().catch((error) => {
  console.error(`Paper install failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
