import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SFTPWrapper, Stats, FileEntryWithStats } from "ssh2";
import type {
  ArchiveInstancePathsResponse,
  ExtractArchiveConflict,
  ExtractInstanceArchiveResponse,
  InstanceFileEntry,
  InstanceFileListResponse,
  InstanceFileContentResponse
} from "@webops/shared";
import { connect, readSettings, execSsh, shellQuote } from "./ssh-nodes.js";
import { panelConfig } from "./config.js";

function lstatSftp(sftp: SFTPWrapper, target: string): Promise<Stats | null> {
  return new Promise((resolve, reject) => sftp.lstat(target, (error, stats) => {
    if (error && (error as Error & { code?: number }).code === 2) resolve(null);
    else if (error) reject(error);
    else resolve(stats);
  }));
}

function readDirectory(sftp: SFTPWrapper, target: string): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => sftp.readdir(target, (error, entries) => error ? reject(error) : resolve(entries)));
}

async function ensureSftpDirectory(sftp: SFTPWrapper, target: string): Promise<void> {
  if (target === "/") return;
  const stats = await lstatSftp(sftp, target);
  if (stats) {
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`解压路径不是普通目录：${target}`);
    return;
  }
  await ensureSftpDirectory(sftp, path.posix.dirname(target));
  await new Promise<void>((resolve, reject) => sftp.mkdir(target, error => error ? reject(error) : resolve()));
}

async function inspectExtractDestination(sftp: SFTPWrapper, root: string, relative: string): Promise<{ stats: Stats; blocked: boolean } | null> {
  // Check every parent so a file or symlink cannot redirect extraction outside the target.
  const destination = path.posix.join(root, relative);
  const segments = destination.split("/").filter(Boolean);
  let current = "/";
  for (let index = 0; index < segments.length; index++) {
    current = path.posix.join(current, segments[index]!);
    const stats = await lstatSftp(sftp, current);
    if (!stats) return null;
    if (index === segments.length - 1) return { stats, blocked: false };
    if (!stats.isDirectory() || stats.isSymbolicLink()) return { stats, blocked: true };
  }
  return null;
}

function zipCommand(targets: string[], output: string): string {
  if (!targets.length) throw new Error("请选择需要压缩的文件");
  let base = path.posix.dirname(targets[0]!);
  while (!targets.every(target => {
    const relative = path.posix.relative(base, target);
    return relative !== ".." && !relative.startsWith("../");
  })) {
    base = path.posix.dirname(base);
  }
  const sources = targets.map(target => shellQuote(path.posix.relative(base, target) || "."));
  return `cd -- ${shellQuote(base)} && zip -rq ${shellQuote(output)} -- ${sources.join(" ")}`;
}

function sftpSession(client: any): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) =>
    client.sftp((err: any, sftp: SFTPWrapper) => (err ? reject(err) : resolve(sftp)))
  );
}

async function resolveSftpBasePath(
  sftp: SFTPWrapper,
  targetPath: string
): Promise<{ resolved: string; relativePath: string }> {
  const home = await new Promise<string>((resolve, reject) =>
    sftp.realpath(".", (err, res) => (err ? reject(err) : resolve(res || "/")))
  );
  const trimmed = (targetPath || "").trim();
  if (!trimmed || trimmed === ".") {
    return { resolved: home, relativePath: "" };
  }
  if (trimmed.startsWith("/")) {
    const normalized = path.posix.normalize(trimmed);
    return { resolved: normalized, relativePath: normalized };
  }
  const resolved = path.posix.resolve(home, trimmed);
  return { resolved, relativePath: trimmed };
}

export async function listSshFiles(
  nodeId: string,
  queryPath = "",
  options: { limit?: number } = {}
): Promise<InstanceFileListResponse> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved, relativePath } = await resolveSftpBasePath(sftp, queryPath);

    const list = await new Promise<any[]>((resolve, reject) => {
      sftp.readdir(resolved, (err, entries) => {
        if (err) {
          if ((err as any).code === 2 || /no such file/i.test(err.message)) {
            return reject(new Error(`PATH_NOT_FOUND: 目录不存在 (${resolved})`));
          }
          return reject(err);
        }
        resolve(entries || []);
      });
    });

    const entries: InstanceFileEntry[] = list
      .filter((item) => item.filename !== "." && item.filename !== "..")
      .map((item) => {
        const isDir = typeof item.attrs.isDirectory === "function" ? item.attrs.isDirectory() : false;
        const isSym = typeof item.attrs.isSymbolicLink === "function" ? item.attrs.isSymbolicLink() : false;
        const entryPath = relativePath ? `${relativePath}/${item.filename}` : item.filename;
        return {
          name: item.filename,
          path: entryPath,
          type: (isDir ? "directory" : isSym ? "symlink" : "file") as InstanceFileEntry["type"],
          size: item.attrs.size || 0,
          modifiedAt: new Date((item.attrs.mtime || 0) * 1000).toISOString()
        };
      })
      .sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1;
        if (a.type !== "directory" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });

    const limit = options.limit ?? 500;
    const truncated = entries.length > limit;
    const sliced = truncated ? entries.slice(0, limit) : entries;

    return {
      instanceId: nodeId,
      path: relativePath,
      entries: sliced,
      totalEntries: entries.length,
      truncated
    };
  } finally {
    client.end();
  }
}

export async function readSshFile(
  nodeId: string,
  filePath: string,
  options: { startLine?: number; lineCount?: number } = {}
): Promise<InstanceFileContentResponse> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved, relativePath } = await resolveSftpBasePath(sftp, filePath);

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(resolved, (err, data) => {
        if (err) {
          if ((err as any).code === 2 || /no such file/i.test(err.message)) {
            return reject(new Error(`PATH_NOT_FOUND: 文件不存在 (${resolved})`));
          }
          return reject(err);
        }
        resolve(data);
      });
    });

    const rawContent = buffer.toString("utf8");
    const allLines = rawContent.length === 0 ? [] : rawContent.split(/\r?\n/);
    const totalLines = allLines.length;
    let content = rawContent;
    if (options.startLine !== undefined || options.lineCount !== undefined) {
      const start = Math.max(1, options.startLine ?? 1);
      const count = Math.max(1, options.lineCount ?? 200);
      content = allLines.slice(start - 1, start - 1 + count).join("\n");
    }

    return {
      instanceId: nodeId,
      path: relativePath,
      content,
      encoding: "utf8",
      size: buffer.length,
      modifiedAt: new Date().toISOString(),
      totalLines
    };
  } finally {
    client.end();
  }
}

export async function writeSshFile(
  nodeId: string,
  filePath: string,
  content: string,
  options: { append?: boolean; createOnly?: boolean } = {}
): Promise<InstanceFileEntry> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved, relativePath } = await resolveSftpBasePath(sftp, filePath);

    const flag = options.append ? "a" : options.createOnly ? "wx" : "w";
    const buffer = Buffer.from(content, "utf8");

    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(resolved, buffer, { flag, mode: 0o644 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    return {
      name: path.posix.basename(resolved),
      path: relativePath,
      type: "file",
      size: buffer.length,
      modifiedAt: new Date().toISOString()
    };
  } finally {
    client.end();
  }
}

/** Undo a text edit without requiring the optional remote Daemon. */
export async function restoreSshFileCheckpoint(nodeId: string, filePath: string, checkpoint: {
  existed: boolean; content: string; afterHash?: string; afterExisted?: boolean;
}): Promise<void> {
  const { client } = await connect(await readSettings(nodeId));
  try {
    const sftp = await sftpSession(client);
    const { resolved } = await resolveSftpBasePath(sftp, filePath);
    const stats = await lstatSftp(sftp, resolved);
    if (stats && (!stats.isFile() || stats.isSymbolicLink())) throw new Error("撤销失败：目标不再是普通文件");
    if (checkpoint.afterExisted === false && stats) throw new Error("文件已更改，不能撤销覆盖后续修改");
    if (checkpoint.afterHash) {
      if (!stats) throw new Error("文件已更改，不能撤销覆盖后续修改");
      const current = await new Promise<Buffer>((resolve, reject) => sftp.readFile(resolved, (error, data) => error ? reject(error) : resolve(data)));
      if (createHash("sha256").update(current).digest("hex") !== checkpoint.afterHash) {
        throw new Error("文件已更改，不能撤销覆盖后续修改");
      }
    }
    if (checkpoint.existed) {
      await new Promise<void>((resolve, reject) => sftp.writeFile(resolved, Buffer.from(checkpoint.content, "utf8"),
        { flag: stats ? "w" : "wx", mode: stats ? stats.mode & 0o777 : 0o644 }, error => error ? reject(error) : resolve()));
    } else if (stats) {
      await new Promise<void>((resolve, reject) => sftp.unlink(resolved, error => error ? reject(error) : resolve()));
    }
  } finally {
    client.end();
  }
}

export async function makeSshDirectory(nodeId: string, dirPath: string): Promise<InstanceFileEntry> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved, relativePath } = await resolveSftpBasePath(sftp, dirPath);
    await execSsh(client, `mkdir -p -- ${shellQuote(resolved)}`);
    return {
      name: path.posix.basename(resolved),
      path: relativePath,
      type: "directory",
      size: 0,
      modifiedAt: new Date().toISOString()
    };
  } finally {
    client.end();
  }
}

export async function deleteSshPath(nodeId: string, targetPath: string): Promise<void> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved } = await resolveSftpBasePath(sftp, targetPath);
    if (!resolved || resolved === "/" || resolved === "/root" || resolved === "/home") {
      throw new Error("安全拦截：禁止删除系统关键根目录");
    }
    await execSsh(client, `rm -rf -- ${shellQuote(resolved)}`);
  } finally {
    client.end();
  }
}

export async function renameSshPath(nodeId: string, fromPath: string, toPath: string): Promise<void> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved: fromResolved } = await resolveSftpBasePath(sftp, fromPath);
    const { resolved: toResolved } = await resolveSftpBasePath(sftp, toPath);
    await execSsh(client, `mv -f -- ${shellQuote(fromResolved)} ${shellQuote(toResolved)}`);
  } finally {
    client.end();
  }
}

export async function copySshPath(nodeId: string, fromPath: string, toPath: string): Promise<void> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved: fromResolved } = await resolveSftpBasePath(sftp, fromPath);
    const { resolved: toResolved } = await resolveSftpBasePath(sftp, toPath);
    await execSsh(client, `cp -r -- ${shellQuote(fromResolved)} ${shellQuote(toResolved)}`);
  } finally {
    client.end();
  }
}

export async function archiveSshPaths(
  nodeId: string,
  paths: string[],
  outputPath?: string
): Promise<ArchiveInstancePathsResponse> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const resolvedTargets: string[] = [];
    for (const p of paths) {
      const { resolved } = await resolveSftpBasePath(sftp, p);
      resolvedTargets.push(resolved);
    }
    const outName = outputPath || `archive_${Date.now()}.zip`;
    const { resolved: resolvedOut } = await resolveSftpBasePath(sftp, outName);
    const outDir = path.posix.dirname(resolvedOut);
    await execSsh(client, `mkdir -p -- ${shellQuote(outDir)}`);

    const command = zipCommand(resolvedTargets, resolvedOut);
    await execSsh(client, command, 60000);

    const stats = await new Promise<any>((resolve, reject) => {
      sftp.stat(resolvedOut, (err, res) => (err ? reject(err) : resolve(res)));
    });

    return {
      instanceId: nodeId,
      paths,
      outputPath: outName,
      entry: {
        name: path.posix.basename(resolvedOut),
        path: outName,
        type: "file",
        size: stats.size || 0,
        modifiedAt: new Date().toISOString()
      },
      archivedCount: paths.length,
      size: stats.size || 0,
      modifiedAt: new Date().toISOString()
    };
  } finally {
    client.end();
  }
}

export interface ExtractSshArchiveOptions {
  outputPath?: string | undefined;
  preview?: boolean | undefined;
  conflictPolicy?: "skip" | "overwrite" | "prompt" | undefined;
  conflictResolutions?: Record<string, "skip" | "overwrite"> | undefined;
  overwrite?: boolean | undefined;
}

export async function extractSshArchive(
  nodeId: string,
  archivePath: string,
  optionsInput?: string | ExtractSshArchiveOptions
): Promise<ExtractInstanceArchiveResponse> {
  const options = typeof optionsInput === "string" ? { outputPath: optionsInput } : (optionsInput || {});
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved: resolvedArchive } = await resolveSftpBasePath(sftp, archivePath);
    const targetOut = options.outputPath || path.posix.dirname(resolvedArchive);
    const { resolved: resolvedOut } = await resolveSftpBasePath(sftp, targetOut);

    const targetStats = await lstatSftp(sftp, resolvedOut);
    if (targetStats && (!targetStats.isDirectory() || targetStats.isSymbolicLink())) {
      throw new Error("解压目标必须是目录，且不能是符号链接");
    }
    const temporary = await execSsh(client, "mktemp -d /tmp/webops-extract-XXXXXXXXXX");
    if (!/^\/tmp\/webops-extract-[a-zA-Z0-9]+$/.test(temporary)) {
      throw new Error("无法创建解压临时目录");
    }
    try {
      // Expand only into an isolated directory. Never retry with weaker overwrite flags.
      const command = /\.(tar\.gz|tgz|tar)$/i.test(resolvedArchive)
        ? `tar -xf ${shellQuote(resolvedArchive)} -C ${shellQuote(temporary)} --no-same-owner --no-same-permissions`
        : `unzip -q -- ${shellQuote(resolvedArchive)} -d ${shellQuote(temporary)}`;
      await execSsh(client, command, 60000);
      const files: Array<{ path: string; source: string; size: number; mode: number }> = [];
      const directories: string[] = [];
      let entryCount = 0;
      let expandedBytes = 0;
      const pending = [""];
      while (pending.length) {
        const relative = pending.pop()!;
        const entries = await readDirectory(sftp, path.posix.join(temporary, relative));
        for (const entry of entries) {
          if (entry.filename === "." || entry.filename === "..") continue;
          if (entry.filename.includes("/") || entry.filename.includes("\0")) throw new Error("压缩包包含无效路径");
          if (++entryCount > panelConfig.maxArchiveEntries) throw new Error("压缩包条目超过解压限制");
          const relativePath = path.posix.join(relative, entry.filename);
          if (entry.attrs.isSymbolicLink()) throw new Error(`不能解压符号链接：${relativePath}`);
          if (entry.attrs.isDirectory()) {
            directories.push(relativePath);
            pending.push(relativePath);
          } else if (entry.attrs.isFile()) {
            expandedBytes += entry.attrs.size;
            if (expandedBytes > panelConfig.maxExtractedBytes) throw new Error("解压内容超过大小限制");
            files.push({ path: relativePath, source: path.posix.join(temporary, relativePath), size: entry.attrs.size, mode: entry.attrs.mode });
          } else throw new Error(`不能解压特殊文件：${relativePath}`);
        }
      }

      const conflicts: ExtractArchiveConflict[] = [];
      for (const file of files) {
        const existing = await inspectExtractDestination(sftp, resolvedOut, file.path);
        if (existing) conflicts.push({
          path: file.path,
          existingType: existing.stats.isDirectory() ? "directory" : "file",
          archiveType: "file",
          existingSize: existing.stats.size,
          archiveSize: file.size,
          canOverwrite: !existing.blocked && existing.stats.isFile() && !existing.stats.isSymbolicLink()
        });
      }
      let extractedCount = 0;
      let totalBytes = 0;
      let skippedCount = 0;
      let overwrittenCount = 0;
      if (!options.preview) {
        for (const file of files) {
          // Check again: files can change after the preview or while the archive is expanded.
          const existing = await inspectExtractDestination(sftp, resolvedOut, file.path);
          const action = options.conflictResolutions?.[file.path]
            ?? options.conflictPolicy ?? (options.overwrite ? "overwrite" : "skip");
          if (existing && (action !== "overwrite" || existing.blocked || !existing.stats.isFile() || existing.stats.isSymbolicLink())) {
            skippedCount++;
            continue;
          }
          const destination = path.posix.join(resolvedOut, file.path);
          await ensureSftpDirectory(sftp, path.posix.dirname(destination));
          const temporaryFile = path.posix.join(path.posix.dirname(destination), `.webops-${randomUUID()}.tmp`);
          try {
            await pipeline(sftp.createReadStream(file.source), sftp.createWriteStream(temporaryFile, {
              flags: "wx", mode: (existing?.stats.mode ?? file.mode) & 0o777
            }));
            const current = await lstatSftp(sftp, destination);
            if (current && (!existing || !current.isFile() || current.isSymbolicLink()
              || current.size !== existing.stats.size || current.mtime !== existing.stats.mtime)) {
              throw new Error(`解压目标已更改，请重新预览：${file.path}`);
            }
            await new Promise<void>((resolve, reject) => {
              const callback = (error?: Error | null) => error ? reject(error) : resolve();
              if (current) sftp.ext_openssh_rename(temporaryFile, destination, callback);
              else sftp.rename(temporaryFile, destination, callback);
            });
          } finally {
            await new Promise<void>(resolve => sftp.unlink(temporaryFile, () => resolve()));
          }
          extractedCount++;
          totalBytes += file.size;
          if (existing) overwrittenCount++;
        }
        for (const directory of directories) {
          const destination = path.posix.join(resolvedOut, directory);
          const blocked = await inspectExtractDestination(sftp, resolvedOut, path.posix.join(directory, ".webops-directory-check"));
          if (!blocked) await ensureSftpDirectory(sftp, destination);
        }
        await ensureSftpDirectory(sftp, resolvedOut);
      }
      return {
        instanceId: nodeId, archivePath, outputPath: targetOut,
        entry: { name: path.posix.basename(resolvedArchive), path: archivePath, type: "file", size: 0, modifiedAt: new Date().toISOString() },
        extractedCount, totalBytes, skippedCount, overwrittenCount,
        ...(options.preview ? { preview: true, conflicts } : {})
      };
    } finally {
      await execSsh(client, `rm -rf -- ${shellQuote(temporary)}`).catch(() => undefined);
    }
  } finally {
    client.end();
  }
}

export async function getSshArchiveDownloadStream(
  nodeId: string,
  paths: string[],
  fileName?: string
): Promise<{ stream: Readable; size: number; name: string }> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  const tempZip = `/tmp/webops-dl-${randomUUID()}.zip`;
  try {
    const sftp = await sftpSession(client);
    const resolvedTargets: string[] = [];
    for (const p of paths) {
      const { resolved } = await resolveSftpBasePath(sftp, p);
      resolvedTargets.push(resolved);
    }
    const command = zipCommand(resolvedTargets, tempZip);
    await execSsh(client, command, 60000);

    const stats = await new Promise<any>((resolve, reject) => {
      sftp.stat(tempZip, (err, res) => (err ? reject(err) : resolve(res)));
    });
    const readStream = sftp.createReadStream(tempZip);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void execSsh(client, `rm -f -- ${shellQuote(tempZip)}`).catch(() => undefined).finally(() => client.end());
    };
    readStream.once("close", cleanup);
    readStream.once("error", cleanup);
    const defaultName = paths.length === 1 ? `${path.posix.basename(paths[0] || "download")}.zip` : `archive_${Date.now()}.zip`;
    return {
      stream: readStream as unknown as Readable,
      size: stats.size || 0,
      name: (fileName || defaultName).toLowerCase().endsWith(".zip") ? (fileName || defaultName) : `${fileName || defaultName}.zip`
    };
  } catch (err) {
    await execSsh(client, `rm -f -- ${shellQuote(tempZip)}`).catch(() => undefined);
    client.end();
    throw err;
  }
}

export async function uploadSshFile(
  nodeId: string,
  targetPath: string,
  buffer: Buffer
): Promise<InstanceFileEntry> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved, relativePath } = await resolveSftpBasePath(sftp, targetPath);
    const dir = path.posix.dirname(resolved);
    await execSsh(client, `mkdir -p -- ${shellQuote(dir)}`);

    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(resolved, buffer, { mode: 0o644 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    return {
      name: path.posix.basename(resolved),
      path: relativePath,
      type: "file",
      size: buffer.length,
      modifiedAt: new Date().toISOString()
    };
  } finally {
    client.end();
  }
}

export async function getSshFileDownloadStream(
  nodeId: string,
  filePath: string
): Promise<{ stream: Readable; size: number; name: string }> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved } = await resolveSftpBasePath(sftp, filePath);
    const stats = await new Promise<any>((resolve, reject) => {
      sftp.stat(resolved, (err, res) => (err ? reject(err) : resolve(res)));
    });
    const readStream = sftp.createReadStream(resolved);
    const cleanup = () => {
      client.end();
    };
    readStream.once("close", cleanup);
    readStream.once("error", cleanup);
    return {
      stream: readStream as unknown as Readable,
      size: stats.size || 0,
      name: path.posix.basename(resolved)
    };
  } catch (err) {
    client.end();
    throw err;
  }
}

export async function statSshPath(
  nodeId: string,
  targetPath: string
): Promise<{ isDirectory: boolean; size: number; modifiedAt?: string }> {
  const settings = await readSettings(nodeId);
  const { client } = await connect(settings);
  try {
    const sftp = await sftpSession(client);
    const { resolved } = await resolveSftpBasePath(sftp, targetPath);
    const stats = await new Promise<any>((resolve, reject) => {
      sftp.stat(resolved, (err, res) => {
        if (err) {
          if ((err as any).code === 2 || /no such file/i.test(err.message)) {
            return reject(new Error(`PATH_NOT_FOUND: 路径不存在 (${resolved})`));
          }
          return reject(err);
        }
        resolve(res);
      });
    });
    return {
      isDirectory: typeof stats.isDirectory === "function" ? stats.isDirectory() : false,
      size: stats.size || 0,
      ...(stats.mtime ? { modifiedAt: new Date(stats.mtime * 1000).toISOString() } : {})
    };
  } finally {
    client.end();
  }
}

