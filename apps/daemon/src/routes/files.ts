import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import type {
  DeleteInstanceFileRequest,
  DownloadInstanceFileResponse,
  ExtractInstanceArchiveRequest,
  ExtractInstanceArchiveResponse,
  InstanceFileContentResponse,
  InstanceFileEntry,
  InstanceFileListResponse,
  MakeInstanceDirectoryRequest,
  RenameInstanceFileRequest,
  UploadInstanceFileRequest,
  WriteInstanceFileRequest
} from "@webops/shared";
import { daemonPaths } from "../config.js";
import { authenticatePanelRequest } from "../daemon-auth.js";

const maxEditableFileBytes = 1024 * 1024;
const maxTransferBytes = 10 * 1024 * 1024;
const maxArchiveEntries = 5000;
const maxExtractedBytes = 512 * 1024 * 1024;
const maxArchiveOutputBytes = 20 * 1024 * 1024;

const require = createRequire(import.meta.url);
const { path7za } = require("7zip-bin") as { path7za: string };
const { createExtractorFromFile } = require("node-unrar-js") as {
  createExtractorFromFile(options: {
    filepath: string;
    targetPath?: string;
    password?: string;
    filenameTransform?: (filename: string) => string;
  }): Promise<RarExtractor>;
};
const execFileAsync = promisify(execFile);

interface FileQuery {
  workingDirectory?: string;
  path?: string;
  limit?: string;
}

interface FileBody {
  workingDirectory?: string;
}

interface ResolvedTarget {
  root: string;
  target: string;
  relativePath: string;
}

interface ArchiveListEntry {
  path: string;
  directory: boolean;
  size: number;
}

interface ArchiveScanResult {
  count: number;
  totalBytes: number;
}

interface RarFileHeader {
  name: string;
  unpSize?: number;
  flags?: {
    directory?: boolean;
    encrypted?: boolean;
  };
}

interface RarExtractor {
  getFileList(): {
    arcHeader?: {
      flags?: {
        headerEncrypted?: boolean;
      };
    };
    fileHeaders: Iterable<RarFileHeader>;
  };
  extract(options?: unknown): {
    files: Iterable<unknown>;
  };
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRelativePath(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\\/g, "/").trim();
  if (!normalized || normalized === ".") return "";
  if (path.isAbsolute(normalized)) {
    throw new Error("Absolute paths are not allowed");
  }
  return normalized;
}

function toClientPath(root: string, target: string): string {
  const relative = path.relative(root, target);
  return relative === "" ? "" : relative.split(path.sep).join("/");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function ensureRealPathInside(root: string, target: string, targetExists: boolean): Promise<void> {
  const realRoot = await fs.realpath(root);
  if (targetExists) {
    const realTarget = await fs.realpath(target);
    if (!isInside(realRoot, realTarget)) {
      throw new Error("Path escapes the instance working directory");
    }
    return;
  }

  const parent = path.dirname(target);
  const parentExists = await pathExists(parent);
  if (!parentExists) {
    await fs.mkdir(parent, { recursive: true });
  }
  const realParent = await fs.realpath(parent);
  if (!isInside(realRoot, realParent)) {
    throw new Error("Path escapes the instance working directory");
  }
}

async function resolveInstanceRoot(workingDirectory: string | undefined): Promise<string> {
  const value = (workingDirectory ?? "").replace(/\\/g, "/").trim();
  if (!value) {
    throw new Error("workingDirectory is required");
  }

  const workspaceRoot = path.resolve(daemonPaths.workspaceDir);
  await fs.mkdir(workspaceRoot, { recursive: true });

  const root = path.isAbsolute(workingDirectory!) 
    ? path.resolve(workingDirectory!) 
    : path.resolve(workspaceRoot, value);

  await fs.mkdir(root, { recursive: true });
  return root;
}

async function resolveTarget(workingDirectory: string | undefined, requestedPath: string | undefined): Promise<ResolvedTarget> {
  const root = await resolveInstanceRoot(workingDirectory);
  const relativePath = normalizeRelativePath(requestedPath);
  const target = path.resolve(root, relativePath);
  if (!isInside(root, target)) {
    throw new Error("Path escapes the instance working directory");
  }

  await ensureRealPathInside(root, target, await pathExists(target));
  return { root, target, relativePath: toClientPath(root, target) };
}

function fileTypeFromStats(stats: Stats): InstanceFileEntry["type"] {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  if (stats.isSymbolicLink()) return "symlink";
  return "other";
}

async function toFileEntry(root: string, target: string, name: string): Promise<InstanceFileEntry> {
  const stats = await fs.lstat(target);
  return {
    name,
    path: toClientPath(root, target),
    type: fileTypeFromStats(stats),
    size: stats.isFile() ? stats.size : 0,
    modifiedAt: stats.mtime.toISOString()
  };
}

function parseDirectoryListLimit(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(Math.floor(parsed), 1000));
}

function direntTypeWeight(dirent: Dirent): number {
  if (dirent.isDirectory()) return 0;
  if (dirent.isFile()) return 1;
  if (dirent.isSymbolicLink()) return 2;
  return 3;
}

function compareDirents(left: Dirent, right: Dirent): number {
  const typeDelta = direntTypeWeight(left) - direntTypeWeight(right);
  if (typeDelta !== 0) return typeDelta;
  return left.name.localeCompare(right.name, "zh-CN");
}

async function mapWithConcurrency<T, TResult>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function assertRegularFile(stats: Stats): void {
  if (!stats.isFile()) {
    throw new Error("Path is not a regular file");
  }
}

function assertTextBuffer(buffer: Buffer): void {
  if (buffer.includes(0)) {
    throw new Error("Binary files cannot be edited online");
  }
}

function decodeBase64Content(contentBase64: string): Buffer {
  const buffer = Buffer.from(contentBase64, "base64");
  if (buffer.byteLength > maxTransferBytes) {
    throw new Error("File transfer size exceeds the 10 MB limit");
  }
  return buffer;
}

function archiveKindFromPath(target: string): "zip" | "rar" | "7z" | null {
  const extension = path.extname(target).toLowerCase();
  if (extension === ".zip") return "zip";
  if (extension === ".rar") return "rar";
  if (extension === ".7z") return "7z";
  return null;
}

function joinClientPath(basePath: string, name: string): string {
  return [basePath, name].filter(Boolean).join("/");
}

function parentClientPath(value: string): string {
  const pieces = value.split("/").filter(Boolean);
  pieces.pop();
  return pieces.join("/");
}

function defaultArchiveOutputPath(archivePath: string): string {
  const fileName = archivePath.split("/").pop() ?? "archive";
  const baseName = fileName.replace(/\.(zip|rar|7z)$/i, "") || "archive";
  return joinClientPath(parentClientPath(archivePath), baseName);
}

function safeArchiveEntryPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\0/g, "");
  if (!normalized || normalized === ".") {
    throw new Error("Archive contains an empty entry path");
  }
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Archive entry uses an absolute path: ${value}`);
  }

  const pieces = normalized.split("/").filter((piece) => piece && piece !== ".");
  if (pieces.length === 0 || pieces.some((piece) => piece === "..")) {
    throw new Error(`Archive entry escapes the target directory: ${value}`);
  }
  return pieces.join("/");
}

function validateArchiveEntries(entries: ArchiveListEntry[]): ArchiveScanResult {
  let count = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    safeArchiveEntryPath(entry.path);
    count += 1;
    if (count > maxArchiveEntries) {
      throw new Error(`Archive has too many entries; the limit is ${maxArchiveEntries}`);
    }
    if (!entry.directory) {
      totalBytes += Math.max(0, entry.size);
      if (totalBytes > maxExtractedBytes) {
        throw new Error("Archive expands beyond the 512 MB online extraction limit");
      }
    }
  }

  return { count, totalBytes };
}

function parseSevenZipListOutput(stdout: string): ArchiveListEntry[] {
  const entries: ArchiveListEntry[] = [];
  let inEntries = false;
  let current: Partial<ArchiveListEntry> = {};

  function flush(): void {
    if (!current.path) return;
    entries.push({
      path: current.path,
      directory: current.directory ?? false,
      size: current.size ?? 0
    });
    current = {};
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("----------")) {
      flush();
      inEntries = true;
      current = {};
      continue;
    }
    if (!inEntries) continue;
    if (!line.trim()) {
      flush();
      continue;
    }

    const separatorIndex = line.indexOf(" = ");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 3);
    if (key === "Path") {
      flush();
      current.path = value;
    } else if (key === "Folder") {
      current.directory = value === "+";
    } else if (key === "Size") {
      const size = Number(value);
      current.size = Number.isFinite(size) ? size : 0;
    }
  }

  flush();
  return entries;
}

async function runSevenZip(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(path7za, args, {
      maxBuffer: maxArchiveOutputBytes,
      windowsHide: true
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "7-Zip failed";
    throw new Error(message);
  }
}

async function extractSevenZipArchive(archivePath: string, targetDirectory: string): Promise<void> {
  const listing = await runSevenZip(["l", "-slt", archivePath]);
  const entries = parseSevenZipListOutput(listing);
  validateArchiveEntries(entries);
  await runSevenZip(["x", "-y", `-o${targetDirectory}`, archivePath]);
}

async function extractRarArchive(archivePath: string, targetDirectory: string): Promise<void> {
  const extractor = await createExtractorFromFile({
    filepath: archivePath,
    targetPath: targetDirectory,
    filenameTransform: safeArchiveEntryPath
  });
  const list = extractor.getFileList();
  if (list.arcHeader?.flags?.headerEncrypted) {
    throw new Error("Encrypted RAR headers are not supported for online extraction");
  }
  const entries = Array.from(list.fileHeaders, (header) => {
    if (header.flags?.encrypted) {
      throw new Error(`Encrypted RAR entry is not supported: ${header.name}`);
    }
    return {
      path: header.name,
      directory: header.flags?.directory ?? false,
      size: header.unpSize ?? 0
    } satisfies ArchiveListEntry;
  });
  validateArchiveEntries(entries);

  for (const _file of extractor.extract().files) {
    // Exhaust the lazy iterator so node-unrar-js completes extraction and releases native state.
  }
}

async function scanExtractedTree(root: string): Promise<ArchiveScanResult> {
  const realRoot = await fs.realpath(root);
  let count = 0;
  let totalBytes = 0;

  async function walk(directory: string): Promise<void> {
    const dirents = await fs.readdir(directory, { withFileTypes: true });
    for (const dirent of dirents) {
      const target = path.join(directory, dirent.name);
      const stats = await fs.lstat(target);
      if (stats.isSymbolicLink()) {
        throw new Error("Archive entries containing symlinks are not supported");
      }
      const realTarget = await fs.realpath(target);
      if (!isInside(realRoot, realTarget)) {
        throw new Error("Archive entry escapes the target directory");
      }

      count += 1;
      if (count > maxArchiveEntries) {
        throw new Error(`Archive has too many entries; the limit is ${maxArchiveEntries}`);
      }
      if (stats.isDirectory()) {
        await walk(target);
      } else if (stats.isFile()) {
        totalBytes += stats.size;
        if (totalBytes > maxExtractedBytes) {
          throw new Error("Archive expands beyond the 512 MB online extraction limit");
        }
      }
    }
  }

  await walk(root);
  return { count, totalBytes };
}

async function extractArchiveToDirectory(
  archivePath: string,
  targetDirectory: string,
  kind: "zip" | "rar" | "7z"
): Promise<ArchiveScanResult> {
  const tempDirectory = path.join(path.dirname(targetDirectory), `.webops-extract-${randomUUID()}`);
  let moved = false;
  await fs.mkdir(tempDirectory);

  try {
    if (kind === "rar") {
      await extractRarArchive(archivePath, tempDirectory);
    } else {
      await extractSevenZipArchive(archivePath, tempDirectory);
    }

    const scan = await scanExtractedTree(tempDirectory);
    await fs.rename(tempDirectory, targetDirectory);
    moved = true;
    return scan;
  } finally {
    if (!moved) {
      await fs.rm(tempDirectory, { force: true, recursive: true });
    }
  }
}

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/instances/:id/files", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as FileQuery;
    const resolved = await resolveTarget(query.workingDirectory, query.path);
    const stats = await fs.lstat(resolved.target);
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    const limit = parseDirectoryListLimit(query.limit);
    const dirents = (await fs.readdir(resolved.target, { withFileTypes: true })).sort(compareDirents);
    const visibleDirents = limit ? dirents.slice(0, limit) : dirents;
    const entries = await mapWithConcurrency(visibleDirents, 32, (dirent) =>
      toFileEntry(resolved.root, path.join(resolved.target, dirent.name), dirent.name)
    );

    return {
      instanceId: id,
      path: resolved.relativePath,
      entries,
      totalEntries: dirents.length,
      truncated: visibleDirents.length < dirents.length
    } satisfies InstanceFileListResponse;
  });

  app.get("/api/instances/:id/files/content", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as FileQuery;
    const resolved = await resolveTarget(query.workingDirectory, query.path);
    const stats = await fs.lstat(resolved.target);
    assertRegularFile(stats);
    if (stats.size > maxEditableFileBytes) {
      throw new Error("File is too large to edit online");
    }

    const buffer = await fs.readFile(resolved.target);
    assertTextBuffer(buffer);

    return {
      instanceId: id,
      path: resolved.relativePath,
      content: buffer.toString("utf8"),
      encoding: "utf8",
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    } satisfies InstanceFileContentResponse;
  });

  app.put("/api/instances/:id/files/content", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as FileBody & Partial<WriteInstanceFileRequest>;
    if (!body.path || body.content === undefined) {
      throw new Error("path and content are required");
    }

    const buffer = Buffer.from(body.content, "utf8");
    if (buffer.byteLength > maxEditableFileBytes) {
      throw new Error("File is too large to edit online");
    }

    const resolved = await resolveTarget(body.workingDirectory, body.path);
    await fs.writeFile(resolved.target, buffer);
    const stats = await fs.lstat(resolved.target);

    return {
      instanceId: id,
      path: resolved.relativePath,
      content: body.content,
      encoding: "utf8",
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    } satisfies InstanceFileContentResponse;
  });

  app.post("/api/instances/:id/files/upload", { preHandler: authenticatePanelRequest }, async (request) => {
    const contentType = request.headers["content-type"] ?? "";

    if (contentType.includes("multipart/form-data")) {
      const data = await (request as unknown as { file: () => Promise<MultipartFile> }).file();
      const fields = data.fields;
      const pathField = fields.path;
      const overwriteField = fields.overwrite;
      const workingDirectoryField = fields.workingDirectory;

      const filePath = typeof pathField === "object" && "value" in pathField ? String(pathField.value) : String(pathField ?? "");
      const overwrite = overwriteField ? String(typeof overwriteField === "object" && "value" in overwriteField ? overwriteField.value : overwriteField) !== "false" : true;
      const workingDirectory = workingDirectoryField ? String(typeof workingDirectoryField === "object" && "value" in workingDirectoryField ? workingDirectoryField.value : workingDirectoryField) : undefined;

      if (!filePath) {
        throw new Error("path is required");
      }

      const resolved = await resolveTarget(workingDirectory, filePath);
      if (!overwrite && (await pathExists(resolved.target))) {
        throw new Error("Target file already exists");
      }

      const buffer = await data.toBuffer();
      if (buffer.byteLength > maxTransferBytes) {
        throw new Error("File transfer size exceeds the 10 MB limit");
      }
      await fs.writeFile(resolved.target, buffer);
      return toFileEntry(resolved.root, resolved.target, path.basename(resolved.target));
    }

    const body = request.body as FileBody & Partial<UploadInstanceFileRequest>;
    if (!body.path || body.contentBase64 === undefined) {
      throw new Error("path and contentBase64 are required");
    }

    const resolved = await resolveTarget(body.workingDirectory, body.path);
    if (!body.overwrite && (await pathExists(resolved.target))) {
      throw new Error("Target file already exists");
    }

    const buffer = decodeBase64Content(body.contentBase64);
    await fs.writeFile(resolved.target, buffer);
    return toFileEntry(resolved.root, resolved.target, path.basename(resolved.target));
  });

  app.get("/api/instances/:id/files/download", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as FileQuery;
    const resolved = await resolveTarget(query.workingDirectory, query.path);
    const stats = await fs.lstat(resolved.target);
    assertRegularFile(stats);
    if (stats.size > maxTransferBytes) {
      throw new Error("File transfer size exceeds the 10 MB limit");
    }

    const buffer = await fs.readFile(resolved.target);
    return {
      instanceId: id,
      path: resolved.relativePath,
      fileName: path.basename(resolved.target),
      contentBase64: buffer.toString("base64"),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    } satisfies DownloadInstanceFileResponse;
  });

  app.post("/api/instances/:id/files/extract", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as FileBody & Partial<ExtractInstanceArchiveRequest>;
    if (!body.path) {
      throw new Error("path is required");
    }

    const archive = await resolveTarget(body.workingDirectory, body.path);
    const archiveStats = await fs.lstat(archive.target);
    assertRegularFile(archiveStats);

    const kind = archiveKindFromPath(archive.target);
    if (!kind) {
      throw new Error("Only .zip, .rar and .7z archives can be extracted online");
    }

    const outputPath = body.outputPath?.trim() || defaultArchiveOutputPath(archive.relativePath);
    const output = await resolveTarget(body.workingDirectory, outputPath);
    if (output.relativePath === "") {
      throw new Error("Extraction target cannot be the instance working directory");
    }
    if (await pathExists(output.target)) {
      throw new Error("Extraction target already exists");
    }

    const result = await extractArchiveToDirectory(archive.target, output.target, kind);
    const entry = await toFileEntry(output.root, output.target, path.basename(output.target));

    return {
      instanceId: id,
      archivePath: archive.relativePath,
      outputPath: output.relativePath,
      entry,
      extractedCount: result.count,
      totalBytes: result.totalBytes
    } satisfies ExtractInstanceArchiveResponse;
  });

  app.post("/api/instances/:id/files/mkdir", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as FileBody & Partial<MakeInstanceDirectoryRequest>;
    if (!body.path) {
      throw new Error("path is required");
    }

    const resolved = await resolveTarget(body.workingDirectory, body.path);
    await fs.mkdir(resolved.target, { recursive: true });
    return toFileEntry(resolved.root, resolved.target, path.basename(resolved.target));
  });

  app.delete("/api/instances/:id/files", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as FileBody & Partial<DeleteInstanceFileRequest>;
    if (!body.path) {
      throw new Error("path is required");
    }

    const resolved = await resolveTarget(body.workingDirectory, body.path);
    if (resolved.relativePath === "") {
      throw new Error("Instance working directory cannot be deleted");
    }

    await fs.rm(resolved.target, { force: true, recursive: true });
    return { ok: true };
  });

  app.post("/api/instances/:id/files/rename", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as FileBody & Partial<RenameInstanceFileRequest>;
    if (!body.fromPath || !body.toPath) {
      throw new Error("fromPath and toPath are required");
    }

    const from = await resolveTarget(body.workingDirectory, body.fromPath);
    const to = await resolveTarget(body.workingDirectory, body.toPath);
    if (await pathExists(to.target)) {
      throw new Error("Target path already exists");
    }

    await fs.rename(from.target, to.target);
    return toFileEntry(to.root, to.target, path.basename(to.target));
  });
}
