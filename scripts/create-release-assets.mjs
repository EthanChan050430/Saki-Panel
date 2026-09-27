import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releasesDir = path.join(rootDir, "releases");
const packageInfo = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = packageInfo.version;
const releaseVersion = version.replace(/\.0$/, "");
const sevenZip = path.join(rootDir, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
const windowsStage = path.join(releasesDir, ".stage-windows-" + releaseVersion);
const linuxStage = path.join(releasesDir, ".stage-linux-" + releaseVersion);
const windowsExe = path.join(releasesDir, "saki-panel-windows-amd64.exe");
const linuxExe = path.join(releasesDir, "saki-panel-linux-amd64");
const windowsZip = path.join(releasesDir, "saki-panel-v" + releaseVersion + "-windows-x64.zip");
const linuxTar = path.join(releasesDir, "saki-panel-v" + releaseVersion + "-linux-x64.tar.gz");

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit", ...options });
}

function assertStagePath(target) {
  const relative = path.relative(releasesDir, path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to clean outside releases/: " + target);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error("Refusing to clean a symlinked staging directory: " + target);
  }
}

function resetStage(target) {
  assertStagePath(target);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function copyInto(stage, sourceRelative, destinationRelative = sourceRelative) {
  const source = path.join(rootDir, sourceRelative);
  const destination = path.join(stage, destinationRelative);
  if (!fs.existsSync(source)) throw new Error("Missing release input: " + sourceRelative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function sha256(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

if (process.platform !== "win32") throw new Error("Build this portable Windows package on Windows.");
if (!fs.existsSync(sevenZip)) throw new Error("7zip-bin is missing. Run npm install first.");

fs.mkdirSync(releasesDir, { recursive: true });
const goCache = path.join(releasesDir, ".go-cache");
fs.mkdirSync(goCache, { recursive: true });
console.log("Building native launchers for Saki Panel " + version);
run("go", ["build", "-ldflags=-s -w -X main.version=" + version, "-o", windowsExe, "."], {
  cwd: path.join(rootDir, "cmd", "launcher"),
  env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0", GOCACHE: goCache }
});
run("go", ["build", "-ldflags=-s -w -X main.version=" + version, "-o", linuxExe, "."], {
  cwd: path.join(rootDir, "cmd", "launcher"),
  env: { ...process.env, GOOS: "linux", GOARCH: "amd64", CGO_ENABLED: "0", GOCACHE: goCache }
});

resetStage(windowsStage);
try {
  for (const item of [
    "apps/panel/dist",
    "apps/daemon/dist",
    "apps/web/dist",
    "packages/shared/dist",
    "packages/shared/package.json",
    "prisma/schema.prisma",
    "package.json",
    "package-lock.json",
    "release/README.md",
    ".env.example",
    "LICENSE"
  ]) copyInto(windowsStage, item);
  copyInto(windowsStage, "release/README.md", "README-release.md");
  fs.copyFileSync(windowsExe, path.join(windowsStage, "saki-panel.exe"));
  const nodeExe = path.join(path.dirname(process.execPath), "node.exe");
  if (!fs.existsSync(nodeExe)) throw new Error("Node.js executable not found: " + nodeExe);
  fs.mkdirSync(path.join(windowsStage, "bin"), { recursive: true });
  fs.copyFileSync(nodeExe, path.join(windowsStage, "bin", "node.exe"));

  const sourceModules = path.join(rootDir, "node_modules");
  const targetModules = path.join(windowsStage, "node_modules");
  fs.mkdirSync(targetModules, { recursive: true });
  const devExcludes = new Set([
    ".bin", "typescript", "vite", "tsx", "concurrently", "recharts", "lucide-react",
    "victory-vendor", "@types", "@vitejs", "@codemirror", "@xterm"
  ]);
  let copiedModules = 0;
  for (const entry of fs.readdirSync(sourceModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || devExcludes.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".prisma") continue;
    const source = path.join(sourceModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const sub of fs.readdirSync(source, { withFileTypes: true })) {
        if (!sub.isDirectory() || sub.isSymbolicLink()) continue;
        const name = entry.name + "/" + sub.name;
        if (entry.name === "@webops" || devExcludes.has(name)) continue;
        fs.cpSync(path.join(source, sub.name), path.join(targetModules, name), {
          recursive: true, force: true
        });
        copiedModules++;
      }
    } else {
      fs.cpSync(source, path.join(targetModules, entry.name), {
        recursive: true,
        force: true,
        filter: item => !/\.tmp\d+$/.test(path.basename(item))
      });
      copiedModules++;
    }
  }
  copyInto(windowsStage, "packages/shared/package.json", "node_modules/@webops/shared/package.json");
  copyInto(windowsStage, "packages/shared/dist", "node_modules/@webops/shared/dist");
  for (const required of [
    "node_modules/prisma/build/index.js",
    "node_modules/.prisma/client/index.js",
    "node_modules/@prisma/client/package.json",
    "node_modules/@webops/shared/dist/index.js"
  ]) {
    if (!fs.existsSync(path.join(windowsStage, required))) {
      throw new Error("Missing Windows runtime dependency: " + required);
    }
  }
  console.log("Bundled " + copiedModules + " dependency directories.");
  if (fs.existsSync(windowsZip)) fs.unlinkSync(windowsZip);
  const entries = fs.readdirSync(windowsStage);
  run(sevenZip, ["a", "-tzip", windowsZip, ...entries, "-mx=3"], { cwd: windowsStage });
} finally {
  assertStagePath(windowsStage);
  fs.rmSync(windowsStage, { recursive: true, force: true });
}

resetStage(linuxStage);
try {
  for (const item of [
    "apps/panel/dist",
    "apps/daemon/dist",
    "apps/web/dist",
    "apps/panel/package.json",
    "apps/daemon/package.json",
    "apps/web/package.json",
    "packages/shared/dist",
    "packages/shared/package.json",
    "prisma/schema.prisma",
    "package.json",
    "package-lock.json",
    "release/README.md",
    ".env.example",
    "LICENSE"
  ]) copyInto(linuxStage, item);
  copyInto(linuxStage, "release/README.md", "README-release.md");
  copyInto(linuxStage, "release/start.sh", "start.sh");
  fs.copyFileSync(linuxExe, path.join(linuxStage, "saki-panel"));
  if (fs.existsSync(linuxTar)) fs.unlinkSync(linuxTar);
  run("tar", ["-czf", linuxTar, ...fs.readdirSync(linuxStage)], { cwd: linuxStage });
} finally {
  assertStagePath(linuxStage);
  fs.rmSync(linuxStage, { recursive: true, force: true });
}

const files = [windowsExe, windowsZip, linuxExe, linuxTar];
const checksumText = files.map(file => sha256(file) + "  " + path.basename(file)).join("\n") + "\n";
fs.writeFileSync(path.join(releasesDir, "SHA256SUMS-v" + releaseVersion + ".txt"), checksumText);
for (const file of files) {
  const mb = (fs.statSync(file).size / (1024 * 1024)).toFixed(1);
  console.log(path.basename(file) + ": " + mb + " MiB");
}
console.log("Release checksums written.");
