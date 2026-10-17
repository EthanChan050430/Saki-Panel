import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { loadModule, loadFunctions } from "./regression-support.mjs";

function fixture(archive = { "config.txt": "archive" }, options = {}) {
  const tree = new Map();
  const commands = [];
  const missing = () => Object.assign(new Error("No such file"), { code: 2 });
  const mkdir = target => {
    if (target !== "/") mkdir(path.posix.dirname(target));
    if (!tree.has(target)) tree.set(target, { kind: "directory" });
  };
  const put = (target, data, kind = "file") => {
    mkdir(path.posix.dirname(target));
    tree.set(target, { kind, data: Buffer.from(data) });
  };
  const stats = target => {
    const entry = tree.get(target);
    return { size: entry.data?.length ?? 0, mode: 0o100644, mtime: 1,
      isFile: () => entry.kind === "file", isDirectory: () => entry.kind === "directory",
      isSymbolicLink: () => entry.kind === "symlink" };
  };
  mkdir("/home/review");
  mkdir("/out");
  const rename = (from, to, callback, overwrite) => {
    if (!overwrite && tree.has(to)) return callback(new Error("exists"));
    tree.set(to, tree.get(from)); tree.delete(from); callback();
  };
  const sftp = {
    realpath: (target, callback) => callback(null, "/home/review"),
    lstat: (target, callback) => tree.has(target) ? callback(null, stats(target)) : callback(missing()),
    stat: (target, callback) => tree.has(target) ? callback(null, stats(target)) : callback(missing()),
    readdir: (target, callback) => {
      if (options.scanFail) return callback(new Error("scan failed"));
      callback(null, [...tree.keys()].filter(key => key !== target && path.posix.dirname(key) === target)
        .map(key => ({ filename: path.posix.basename(key), attrs: stats(key) })));
    },
    readFile: (target, callback) => tree.has(target) ? callback(null, tree.get(target).data) : callback(missing()),
    writeFile: (target, data, flags, callback) => {
      if (flags.flag === "wx" && tree.has(target)) return callback(new Error("exists"));
      put(target, data); callback();
    },
    mkdir: (target, callback) => { mkdir(target); callback(); },
    unlink: (target, callback) => { tree.delete(target); callback(); },
    rename: (from, to, callback) => rename(from, to, callback, false),
    ext_openssh_rename: (from, to, callback) => rename(from, to, callback, true),
    createReadStream: target => Readable.from([tree.get(target).data]),
    createWriteStream: (target, flags) => {
      const chunks = [];
      return new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); },
        final(callback) {
          if (flags.flags === "wx" && tree.has(target)) return callback(new Error("exists"));
          put(target, Buffer.concat(chunks)); callback();
        } });
    }
  };
  const client = { sftp: callback => callback(null, sftp), end() {} };
  const ssh = {
    readSettings: async () => ({}), connect: async () => ({ client }),
    shellQuote: value => `'${value.replace(/'/g, `'\\''`)}'`,
    execSsh: async (client, command) => {
      commands.push(command);
      if (command.startsWith("mktemp")) { mkdir("/tmp/webops-extract-TEST"); return "/tmp/webops-extract-TEST"; }
      if (command.startsWith("unzip") || command.startsWith("tar")) {
        if (options.extractFail) throw new Error("corrupt archive");
        for (const [relative, data] of Object.entries(archive)) {
          put(`/tmp/webops-extract-TEST/${relative}`, typeof data === "string" ? data : data.data ?? "", typeof data === "string" ? "file" : data.kind);
        }
      }
      if (command.includes("zip -rq")) {
        if (options.zipFail) throw new Error("zip unavailable");
        const output = command.match(/zip -rq '([^']+)' --/)[1];
        put(output, "PK archive");
      }
      if (command.startsWith("rm -rf")) {
        for (const key of tree.keys()) if (key.startsWith("/tmp/webops-extract-TEST")) tree.delete(key);
      }
      if (command.startsWith("rm -f")) tree.delete(command.match(/'([^']+)'/)[1]);
      return "";
    }
  };
  const config = { maxArchiveEntries: 200000, maxExtractedBytes: 1024 ** 3, ...options.config };
  const api = loadModule("apps/panel/src/ssh-files.ts", { "./ssh-nodes.js": ssh, "./config.js": { panelConfig: config } });
  return { api, tree, commands, put, text: target => tree.get(target)?.data?.toString() };
}

test("preview scans every file, finds late conflicts, and leaves the target unchanged", async () => {
  const archive = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`file${i}.txt`, "new"]));
  const f = fixture(archive);
  f.put("/out/file149.txt", "keep");
  const response = await f.api.extractSshArchive("node", "archive.zip", { outputPath: "/out", preview: true });
  assert.equal(response.conflicts.length, 1);
  assert.equal(response.conflicts[0].path, "file149.txt");
  assert.equal(f.text("/out/file149.txt"), "keep");
  assert.equal(f.tree.has("/out/file0.txt"), false);
  assert.equal([...f.tree.keys()].some(key => key.startsWith("/tmp/webops-extract-")), false);
});

test("mixed per-file decisions preserve skipped files and overwrite only approved files", async () => {
  const f = fixture({ "keep.txt": "bad", "replace.txt": "replacement", "new.txt": "new" });
  f.put("/out/keep.txt", "original"); f.put("/out/replace.txt", "original");
  const response = await f.api.extractSshArchive("node", "archive.zip", { outputPath: "/out",
    conflictResolutions: { "keep.txt": "skip", "replace.txt": "overwrite" } });
  assert.equal(f.text("/out/keep.txt"), "original");
  assert.equal(f.text("/out/replace.txt"), "replacement");
  assert.equal(f.text("/out/new.txt"), "new");
  assert.equal(response.skippedCount, 1); assert.equal(response.overwrittenCount, 1); assert.equal(response.extractedCount, 2);
});

test("tar skip policy preserves existing files without a weaker fallback command", async () => {
  const f = fixture(); f.put("/out/config.txt", "keep");
  await f.api.extractSshArchive("node", "archive.tar.gz", { outputPath: "/out", conflictPolicy: "skip" });
  assert.equal(f.text("/out/config.txt"), "keep");
  assert.equal(f.commands.some(command => command.includes("||")), false);
});

test("archive extraction and scan failures fail closed and clean temporary files", async () => {
  for (const options of [{ extractFail: true }, { scanFail: true }]) {
    const f = fixture(undefined, options); f.put("/out/config.txt", "keep");
    await assert.rejects(f.api.extractSshArchive("node", "archive.zip", { outputPath: "/out", preview: true }));
    assert.equal(f.text("/out/config.txt"), "keep");
    assert.equal([...f.tree.keys()].some(key => key.startsWith("/tmp/webops-extract-")), false);
  }
});

test("symlinks and entry limits abort before target writes", async () => {
  for (const f of [fixture({ link: { kind: "symlink" } }), fixture({ a: "1", b: "2" }, { config: { maxArchiveEntries: 1 } })]) {
    await assert.rejects(f.api.extractSshArchive("node", "archive.zip", { outputPath: "/out" }));
    assert.equal([...f.tree.keys()].some(key => key.startsWith("/out/")), false);
  }
});

test("a file blocking an archive subdirectory cannot be overwritten", async () => {
  const f = fixture({ "folder/file.txt": "new" }); f.put("/out/folder", "keep");
  const preview = await f.api.extractSshArchive("node", "archive.zip", { outputPath: "/out", preview: true });
  assert.equal(preview.conflicts[0].canOverwrite, false);
  const result = await f.api.extractSshArchive("node", "archive.zip", { outputPath: "/out", conflictPolicy: "overwrite" });
  assert.equal(result.skippedCount, 1);
  assert.equal(f.text("/out/folder"), "keep");
});

test("archive downloads use ZIP argument order, relative sources and no tar fallback", async () => {
  const f = fixture();
  const result = await f.api.getSshArchiveDownloadStream("node", ["/home/review/folder"], "download");
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString().startsWith("PK"), true);
  assert.equal(result.name, "download.zip");
  const command = f.commands.find(command => command.includes("zip -rq"));
  assert.match(command, /^cd -- '\/home\/review' && zip -rq '[^']+\.zip' -- 'folder'$/);
  assert.equal(command.includes("tar"), false);
});

test("ZIP creation failures propagate rather than returning a mislabeled tar archive", async () => {
  const f = fixture(undefined, { zipFail: true });
  await assert.rejects(f.api.getSshArchiveDownloadStream("node", ["/home/review/folder"]), /zip unavailable/);
  assert.equal(f.commands.some(command => command.startsWith("tar")), false);
});

test("SSH undo restores full content and rejects manual edits", async () => {
  const f = fixture(); f.put("/out/file.txt", "agent edit");
  const afterHash = createHash("sha256").update("agent edit").digest("hex");
  await f.api.restoreSshFileCheckpoint("node", "/out/file.txt", { existed: true, content: "original", afterHash });
  assert.equal(f.text("/out/file.txt"), "original");
  f.put("/out/file.txt", "manual edit");
  await assert.rejects(f.api.restoreSshFileCheckpoint("node", "/out/file.txt", { existed: true, content: "original", afterHash }));
  assert.equal(f.text("/out/file.txt"), "manual edit");
});

test("SSH undo removes created files and preserves files recreated after deletion", async () => {
  const f = fixture(); f.put("/out/file.txt", "agent edit");
  const afterHash = createHash("sha256").update("agent edit").digest("hex");
  await f.api.restoreSshFileCheckpoint("node", "/out/file.txt", { existed: false, content: "", afterHash });
  assert.equal(f.tree.has("/out/file.txt"), false);
  f.put("/out/file.txt", "recreated");
  await assert.rejects(f.api.restoreSshFileCheckpoint("node", "/out/file.txt", { existed: true, content: "original", afterExisted: false }));
  assert.equal(f.text("/out/file.txt"), "recreated");
});

test("large checkpoints preserve trailing content and SSH rollback never calls Daemon", async () => {
  const f = fixture();
  const original = Array.from({ length: 12000 }, (_, i) => `line ${i}`).join("\r\n") + "\r\n";
  f.put("/out/file.txt", original);
  const instance = { id: "node:test", nodeId: "test", workingDirectory: "/out", node: { protocol: "ssh" } };
  const executor = loadFunctions("apps/panel/src/routes/saki/executor.ts", ["resolveSshInstancePath", "readFileForCheckpoint", "rollbackCheckpoint"], {
    path, readSshFile: f.api.readSshFile, restoreSshFileCheckpoint: f.api.restoreSshFileCheckpoint,
    assertCheckpointRollbackAccess: async () => {}, loadVisibleInstance: async () => instance,
    invalidateInstanceFileCache() {}, writeDaemonInstanceFile: () => { throw new Error("Daemon must not be called"); }
  });
  const checkpoint = await executor.readFileForCheckpoint(instance, "file.txt");
  assert.equal(checkpoint.content, original);
  f.put("/out/file.txt", original + "appended");
  await executor.rollbackCheckpoint("user", { type: "file", instanceId: instance.id, path: "file.txt", existed: true,
    content: checkpoint.content, afterHash: createHash("sha256").update(original + "appended").digest("hex") });
  assert.equal(f.text("/out/file.txt"), original);
});
