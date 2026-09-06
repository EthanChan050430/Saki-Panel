import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import type {
  ArchiveInstancePathsRequest,
  ArchiveInstancePathsResponse,
  DeleteInstanceFileRequest,
  DownloadInstanceArchiveRequest,
  DownloadInstanceFileResponse,
  ExtractArchiveConflict,
  ExtractConflictAction,
  ExtractInstanceArchiveRequest,
  ExtractInstanceArchiveResponse,
  GlobInstanceFilesRequest,
  GlobInstanceFilesResponse,
  GrepInstanceFilesRequest,
  GrepInstanceFilesResponse,
  InstanceFileContentResponse,
  InstanceFileEntry,
  InstanceFileListResponse,
  MakeInstanceDirectoryRequest,
  RenameInstanceFileRequest,
  UploadInstanceFileRequest,
  WriteInstanceFileRequest
} from "@webops/shared";
import { daemonPaths, daemonConfig } from "../config.js";
import { authenticatePanelRequest } from "../daemon-auth.js";
import { assertSafeRegex } from "../regex-utils.js";

const maxEditableFileBytes = 1024 * 1024;
const outlinePatterns = [
  /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/,
  /^\s*(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/,
  /^\s*(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/,
  /^\s*(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*=/,
  /^\s*(?:export\s+)?enum\s+([a-zA-Z0-9_$]+)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
  /^\s*(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/,
  /^\s*class\s+([a-zA-Z0-9_]+)\s*[:\(]/,
  /^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/,
  /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([a-zA-Z0-9_]+)/
];

function extractFileOutline(lines: string[]): string {
  const symbols: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? "";
    const trimmed = lineText.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;
    if (outlinePatterns.some((pattern) => pattern.test(lineText))) {
      symbols.push(`L${i + 1}: ${trimmed.slice(0, 120)}`);
    }
  }
  if (symbols.length === 0) {
    return `(${lines.length} lines, no top-level definitions detected)`;
  }
  return `${symbols.length} definitions in ${lines.length} lines\n${symbols.join("\n")}`;
}
const maxTransferBytes = daemonConfig.maxTransferBytes;
const maxArchiveEntries = daemonConfig.maxArchiveEntries;
const maxExtractedBytes = daemonConfig.maxExtractedBytes;
const maxArchiveOutputBytes = 128 * 1024 * 1024;
const maxArchiveSources = 10000;

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
  startLine?: string;
  lineCount?: string;
  outline?: string;
  stat?: string;
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

interface ExtractedFileEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
}

interface ExtractArchiveOptions {
  preview?: boolean;
  conflictPolicy?: ExtractConflictAction;
  conflictResolutions?: Record<string, ExtractConflictAction>;
}

interface ExtractArchiveResult extends ArchiveScanResult {
  skippedCount: number;
  overwrittenCount: number;
  conflicts: ExtractArchiveConflict[];
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

function isCrossDeviceRenameError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EXDEV"
  );
}

async function moveEntry(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
    return;
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }
  }

  const stats = await fs.lstat(source);
  if (stats.isDirectory()) {
    await fs.cp(source, destination, { recursive: true });
    await fs.rm(source, { force: true, recursive: true });
    return;
  }

  await fs.copyFile(source, destination);
  await fs.unlink(source);
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

async function countFileLines(filePath: string, maxBytes: number): Promise<number | undefined> {
  const stats = await fs.lstat(filePath);
  if (!stats.isFile()) return undefined;
  if (stats.size === 0) return 0;
  if (stats.size > maxBytes) return undefined;
  const stream = fsSync.createReadStream(filePath);
  let lines = 0;
  let endedWithNewline = false;
  try {
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      for (let i = 0; i < buf.length; i += 1) {
        if (buf[i] === 10) {
          lines += 1;
          endedWithNewline = true;
        } else {
          endedWithNewline = false;
        }
      }
    }
  } finally {
    stream.destroy();
  }
  return endedWithNewline ? lines : lines + 1;
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
    throw new Error(`File transfer size exceeds the ${Math.round(maxTransferBytes / (1024 * 1024))} MB limit`);
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
        throw new Error(`Archive expands beyond the ${Math.round(maxExtractedBytes / (1024 * 1024))} MB online extraction limit`);
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

let sevenZipPermissionEnsured = false;

async function ensureSevenZipPermission(): Promise<void> {
  if (sevenZipPermissionEnsured) return;
  sevenZipPermissionEnsured = true;
  try {
    await fs.chmod(path7za, 0o755);
  } catch {
    // chmod may fail on Windows or read-only filesystems; ignore
  }
}

async function runSevenZip(args: string[], options: { cwd?: string } = {}): Promise<string> {
  try {
    await ensureSevenZipPermission();
    const { stdout } = await execFileAsync(path7za, args, {
      cwd: options.cwd,
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
  const listing = await runSevenZip(["l", "-slt", "-bsp0", archivePath]);
  const entries = parseSevenZipListOutput(listing);
  validateArchiveEntries(entries);
  await runSevenZip(["x", "-y", "-bso0", "-bsp0", `-o${targetDirectory}`, archivePath]);
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

function destinationFromRelativePath(targetRoot: string, relativePath: string): string {
  return path.join(targetRoot, ...relativePath.split("/"));
}

async function listExtractedFiles(root: string): Promise<ExtractedFileEntry[]> {
  const realRoot = await fs.realpath(root);
  const files: ExtractedFileEntry[] = [];

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

      if (stats.isDirectory()) {
        await walk(target);
      } else if (stats.isFile()) {
        files.push({
          relativePath: toClientPath(realRoot, target),
          absolutePath: target,
          size: stats.size
        });
      }
    }
  }

  await walk(root);
  return files;
}

async function scanExtractedTree(root: string): Promise<ArchiveScanResult> {
  const files = await listExtractedFiles(root);
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    if (totalBytes > maxExtractedBytes) {
      throw new Error(`Archive expands beyond the ${Math.round(maxExtractedBytes / (1024 * 1024))} MB online extraction limit`);
    }
  }
  if (files.length > maxArchiveEntries) {
    throw new Error(`Archive has too many entries; the limit is ${maxArchiveEntries}`);
  }
  return { count: files.length, totalBytes };
}

async function detectExtractConflicts(
  sourceRoot: string,
  targetRoot: string
): Promise<ExtractArchiveConflict[]> {
  const files = await listExtractedFiles(sourceRoot);
  const conflicts: ExtractArchiveConflict[] = [];

  for (const file of files) {
    const destination = destinationFromRelativePath(targetRoot, file.relativePath);
    if (!(await pathExists(destination))) continue;

    const destinationStats = await fs.lstat(destination);
    const existingType = destinationStats.isDirectory() ? "directory" : "file";
    const conflict: ExtractArchiveConflict = {
      path: file.relativePath,
      archiveType: "file",
      existingType,
      archiveSize: file.size,
      canOverwrite: existingType === "file"
    };
    if (destinationStats.isFile()) {
      conflict.existingSize = destinationStats.size;
    }
    conflicts.push(conflict);
  }

  return conflicts;
}

function resolveExtractConflictAction(
  relativePath: string,
  canOverwrite: boolean,
  options: Pick<ExtractArchiveOptions, "conflictPolicy" | "conflictResolutions">
): ExtractConflictAction {
  const explicit = options.conflictResolutions?.[relativePath];
  if (explicit) {
    return explicit === "overwrite" && !canOverwrite ? "skip" : explicit;
  }
  if (options.conflictPolicy) {
    return options.conflictPolicy === "overwrite" && !canOverwrite ? "skip" : options.conflictPolicy;
  }
  return "skip";
}

async function mergeExtractedTree(
  sourceRoot: string,
  targetRoot: string,
  options: Pick<ExtractArchiveOptions, "conflictPolicy" | "conflictResolutions">
): Promise<ArchiveScanResult & { skippedCount: number; overwrittenCount: number }> {
  const files = await listExtractedFiles(sourceRoot);
  let count = 0;
  let totalBytes = 0;
  let skippedCount = 0;
  let overwrittenCount = 0;

  await fs.mkdir(targetRoot, { recursive: true });

  for (const file of files) {
    const destination = destinationFromRelativePath(targetRoot, file.relativePath);
    const exists = await pathExists(destination);
    const canOverwrite = exists ? (await fs.lstat(destination)).isFile() : true;
    const action = exists
      ? resolveExtractConflictAction(file.relativePath, canOverwrite, options)
      : "overwrite";

    if (exists && action === "skip") {
      skippedCount += 1;
      continue;
    }
    if (exists && action === "overwrite") {
      overwrittenCount += 1;
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(file.absolutePath, destination);
    count += 1;
    totalBytes += file.size;
  }

  return { count, totalBytes, skippedCount, overwrittenCount };
}

async function extractArchiveToTarget(
  archivePath: string,
  targetDirectory: string,
  kind: "zip" | "rar" | "7z",
  options: ExtractArchiveOptions = {}
): Promise<ExtractArchiveResult> {
  const tempDirectory = path.join(path.dirname(targetDirectory), `.webops-extract-${randomUUID()}`);
  let moved = false;

  await fs.mkdir(tempDirectory, { recursive: true });

  try {
    if (kind === "rar") {
      await extractRarArchive(archivePath, tempDirectory);
    } else {
      await extractSevenZipArchive(archivePath, tempDirectory);
    }

    await scanExtractedTree(tempDirectory);

    const targetExists = await pathExists(targetDirectory);
    if (targetExists) {
      const targetStats = await fs.lstat(targetDirectory);
      if (!targetStats.isDirectory()) {
        throw new Error("Extraction target already exists and is not a directory");
      }
    }

    const conflicts = targetExists ? await detectExtractConflicts(tempDirectory, targetDirectory) : [];
    if (options.preview) {
      return {
        count: 0,
        totalBytes: 0,
        skippedCount: 0,
        overwrittenCount: 0,
        conflicts
      };
    }

    if (!targetExists) {
      const scan = await scanExtractedTree(tempDirectory);
      await moveEntry(tempDirectory, targetDirectory);
      moved = true;
      return {
        ...scan,
        skippedCount: 0,
        overwrittenCount: 0,
        conflicts: []
      };
    }

    const merged = await mergeExtractedTree(tempDirectory, targetDirectory, options);
    return {
      ...merged,
      conflicts: []
    };
  } finally {
    if (!moved) {
      await fs.rm(tempDirectory, { force: true, recursive: true });
    }
  }
}

interface ArchiveSource {
  root: string;
  target: string;
  relativePath: string;
}

interface ResolvedArchiveSources {
  root: string;
  sources: ArchiveSource[];
}

interface TemporaryZipArchive {
  tempDirectory: string;
  archivePath: string;
}

function normalizeArchivePathList(paths: string[] | undefined): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths are required");
  }
  if (paths.length > maxArchiveSources) {
    throw new Error(`Too many paths selected; the limit is ${maxArchiveSources}`);
  }

  const seen = new Set<string>();
  const normalizedPaths: string[] = [];
  for (const value of paths) {
    const normalized = normalizeRelativePath(value);
    if (!normalized) {
      throw new Error("Instance working directory cannot be archived directly");
    }
    if (/[\r\n]/.test(normalized)) {
      throw new Error("Archive paths cannot contain line breaks");
    }
    const key = normalized.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalizedPaths.push(normalized);
    }
  }
  return normalizedPaths;
}

function clientPathParent(value: string): string {
  const pieces = value.split("/").filter(Boolean);
  pieces.pop();
  return pieces.join("/");
}

function clientPathBaseName(value: string): string {
  return value.split("/").filter(Boolean).pop() ?? "archive";
}

function archiveFileNameForClientPath(value: string): string {
  const baseName = clientPathBaseName(value).replace(/\.(zip|rar|7z)$/i, "") || "archive";
  return `${baseName}.zip`;
}

function defaultArchiveCreationOutputPath(sources: ArchiveSource[]): string {
  if (sources.length === 1) {
    const source = sources[0]!;
    return joinClientPath(clientPathParent(source.relativePath), archiveFileNameForClientPath(source.relativePath));
  }
  const basePath = commonArchiveBaseRelative(sources.map((source) => source.relativePath));
  return joinClientPath(basePath, "archive.zip");
}

function normalizeArchiveFileName(value: string | undefined, fallback: string): string {
  const candidate = (value ?? fallback).replace(/\\/g, "/").split("/").pop()?.trim() || fallback;
  if (!candidate || candidate === "." || candidate === ".." || candidate.includes("\0") || /[\r\n]/.test(candidate)) {
    throw new Error("Archive file name is invalid");
  }
  return candidate.toLowerCase().endsWith(".zip") ? candidate : `${candidate}.zip`;
}

function commonArchiveBaseRelative(paths: string[]): string {
  const parents = paths.map((value) => clientPathParent(value).split("/").filter(Boolean));
  const first = parents[0] ?? [];
  const prefix: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const piece = first[index]!;
    if (parents.every((parent) => parent[index] === piece)) {
      prefix.push(piece);
    } else {
      break;
    }
  }
  return prefix.join("/");
}

async function resolveArchiveSources(
  workingDirectory: string | undefined,
  paths: string[] | undefined
): Promise<ResolvedArchiveSources> {
  const root = await resolveInstanceRoot(workingDirectory);
  const normalizedPaths = normalizeArchivePathList(paths);
  const sources: ArchiveSource[] = [];

  for (const requestedPath of normalizedPaths) {
    const target = path.resolve(root, requestedPath);
    if (!isInside(root, target)) {
      throw new Error("Path escapes the instance working directory");
    }
    if (!(await pathExists(target))) {
      throw new Error(`Archive source does not exist: ${requestedPath}`);
    }
    await ensureRealPathInside(root, target, true);
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symbolic links cannot be archived online: ${requestedPath}`);
    }
    if (!stats.isFile() && !stats.isDirectory()) {
      throw new Error(`Only files and directories can be archived online: ${requestedPath}`);
    }
    sources.push({
      root,
      target,
      relativePath: toClientPath(root, target)
    });
  }

  return { root, sources };
}

async function createTemporaryZipArchive(
  root: string,
  sources: ArchiveSource[],
  tempParentDirectory?: string
): Promise<TemporaryZipArchive> {
  const baseRelative = commonArchiveBaseRelative(sources.map((source) => source.relativePath));
  const baseDirectory = path.resolve(root, baseRelative);
  await ensureRealPathInside(root, baseDirectory, true);

  const archiveArguments = sources.map((source) => {
    const relative = path.relative(baseDirectory, source.target).split(path.sep).join("/");
    if (!relative || relative.startsWith("../") || relative === ".." || /[\r\n]/.test(relative)) {
      throw new Error(`Archive source path is invalid: ${source.relativePath}`);
    }
    return relative;
  });

  const parentDir = tempParentDirectory || root;
  await ensureRealPathInside(root, parentDir, true);
  const tempDirectory = await fs.mkdtemp(path.join(parentDir, "webops-archive-"));
  const archivePath = path.join(tempDirectory, "archive.zip");
  const listPath = path.join(tempDirectory, "sources.txt");

  try {
    await fs.writeFile(listPath, archiveArguments.join("\n"), "utf8");
    await runSevenZip(["a", "-tzip", "-mx=3", "-scsUTF-8", "-bso0", "-bsp0", archivePath, `@${listPath}`], {
      cwd: baseDirectory
    });
    return { tempDirectory, archivePath };
  } catch (error) {
    await fs.rm(tempDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function archivePathsToOutput(
  id: string,
  workingDirectory: string | undefined,
  body: FileBody & Partial<ArchiveInstancePathsRequest>
): Promise<ArchiveInstancePathsResponse> {
  const resolvedSources = await resolveArchiveSources(workingDirectory, body.paths);
  const outputPath = body.outputPath?.trim() || defaultArchiveCreationOutputPath(resolvedSources.sources);
  const output = await resolveTarget(workingDirectory, outputPath);
  if (output.relativePath === "") {
    throw new Error("Archive output cannot be the instance working directory");
  }
  if (path.extname(output.target).toLowerCase() !== ".zip") {
    throw new Error("Archive output must be a .zip file");
  }
  if (await pathExists(output.target)) {
    throw new Error("Archive output already exists");
  }

  const temporary = await createTemporaryZipArchive(
    resolvedSources.root,
    resolvedSources.sources,
    path.dirname(output.target)
  );
  let moved = false;
  try {
    await moveEntry(temporary.archivePath, output.target);
    moved = true;
    const stats = await fs.lstat(output.target);
    const entry = await toFileEntry(output.root, output.target, path.basename(output.target));
    return {
      instanceId: id,
      paths: resolvedSources.sources.map((source) => source.relativePath),
      outputPath: output.relativePath,
      entry,
      archivedCount: resolvedSources.sources.length,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  } finally {
    await fs.rm(temporary.tempDirectory, { force: true, recursive: true });
    if (!moved) {
      await fs.rm(output.target, { force: true });
    }
  }
}

async function archivePathsForDownload(
  id: string,
  workingDirectory: string | undefined,
  body: FileBody & Partial<DownloadInstanceArchiveRequest>
): Promise<DownloadInstanceFileResponse> {
  const resolvedSources = await resolveArchiveSources(workingDirectory, body.paths);
  const defaultFileName =
    resolvedSources.sources.length === 1
      ? archiveFileNameForClientPath(resolvedSources.sources[0]!.relativePath)
      : "selection.zip";
  const fileName = normalizeArchiveFileName(body.fileName, defaultFileName);
  const temporary = await createTemporaryZipArchive(resolvedSources.root, resolvedSources.sources);
  try {
    const stats = await fs.lstat(temporary.archivePath);
    const buffer = await fs.readFile(temporary.archivePath);
    return {
      instanceId: id,
      path: fileName,
      fileName,
      contentBase64: buffer.toString("base64"),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  } finally {
    await fs.rm(temporary.tempDirectory, { force: true, recursive: true });
  }
}

const skipDirNames = new Set([
  "node_modules", ".git", "__pycache__", ".svn", ".hg", ".DS_Store",
  "dist", "build", ".next", ".nuxt", "target", "vendor", ".idea", ".vscode",
  ".cache", ".parcel-cache", ".turbo", "coverage", ".tox", "eggs", "*.egg-info"
]);

const maxSearchFileSize = 1024 * 1024;
const binaryCheckBytes = 8192;

function shouldSkipDir(name: string): boolean {
  return skipDirNames.has(name) || name.startsWith(".");
}

function matchGlobPattern(fileName: string, pattern: string): boolean {
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
    .replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(",").join("|")})`);
  try {
    return new RegExp(`^${regexStr}$`).test(fileName);
  } catch {
    return fileName === pattern;
  }
}

function matchIncludePattern(fileName: string, include?: string): boolean {
  if (!include) return true;
  return matchGlobPattern(fileName, include) || matchGlobPattern(fileName, "**/" + include);
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(binaryCheckBytes);
    const { bytesRead } = await handle.read(buffer, 0, binaryCheckBytes, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } finally {
    await handle.close();
  }
}

async function* walkFiles(root: string, subPath: string): AsyncGenerator<string> {
  const dir = subPath ? path.resolve(root, subPath) : root;
  if (!isInside(root, dir)) return;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
    const fullPath = path.resolve(dir, entry.name);
    if (!isInside(root, fullPath)) continue;
    if (entry.isDirectory()) {
      yield* walkFiles(root, path.relative(root, fullPath).replace(/\\/g, "/"));
    } else if (entry.isFile()) {
      yield fullPath;
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
    const wantStat = query.stat === "1" || query.stat === "true";
    if (wantStat) {
      if (stats.isDirectory()) {
        return {
          instanceId: id,
          path: resolved.relativePath,
          content: "",
          encoding: "utf8",
          size: 0,
          modifiedAt: stats.mtime.toISOString(),
          isDirectory: true,
          stat: true
        } satisfies InstanceFileContentResponse;
      }
      if (stats.isSymbolicLink()) {
        return {
          instanceId: id,
          path: resolved.relativePath,
          content: "",
          encoding: "utf8",
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          isDirectory: false,
          stat: true
        } satisfies InstanceFileContentResponse;
      }
      if (!stats.isFile()) {
        throw new Error("Path is not a file or directory");
      }
      const totalLines = await countFileLines(resolved.target, maxEditableFileBytes);
      return {
        instanceId: id,
        path: resolved.relativePath,
        content: "",
        encoding: "utf8",
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        ...(totalLines !== undefined ? { totalLines } : {}),
        isDirectory: false,
        stat: true
      } satisfies InstanceFileContentResponse;
    }

    assertRegularFile(stats);
    if (stats.size > maxEditableFileBytes) {
      throw new Error("File is too large to edit online");
    }

    const buffer = await fs.readFile(resolved.target);
    assertTextBuffer(buffer);
    const text = buffer.toString("utf8");
    const lines = text.length === 0 ? [] : text.split(/\r?\n/);
    const totalLines = lines.length;
    const startLine = Math.max(1, Number(query.startLine) || 0);
    const lineCount = Math.max(0, Number(query.lineCount) || 0);
    const wantOutline = query.outline === "1" || query.outline === "true";

    if (wantOutline) {
      return {
        instanceId: id,
        path: resolved.relativePath,
        content: extractFileOutline(lines),
        encoding: "utf8",
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        totalLines,
        outline: true
      } satisfies InstanceFileContentResponse;
    }

    if (startLine >= 1 && lineCount >= 1) {
      const slice = lines.slice(startLine - 1, startLine - 1 + lineCount);
      const endLine = Math.min(totalLines, startLine + slice.length - 1);
      return {
        instanceId: id,
        path: resolved.relativePath,
        content: slice.join("\n"),
        encoding: "utf8",
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        totalLines,
        startLine,
        endLine,
        truncated: endLine < totalLines
      } satisfies InstanceFileContentResponse;
    }

    return {
      instanceId: id,
      path: resolved.relativePath,
      content: text,
      encoding: "utf8",
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      totalLines
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
        throw new Error(`File transfer size exceeds the ${Math.round(maxTransferBytes / (1024 * 1024))} MB limit`);
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

  app.get("/api/instances/:id/files/download", { preHandler: authenticatePanelRequest }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as FileQuery;
    const resolved = await resolveTarget(query.workingDirectory, query.path);
    const stats = await fs.lstat(resolved.target);
    assertRegularFile(stats);

    const rawFlag = String(
      (query as Record<string, unknown>).raw ??
        request.headers["x-raw-download"] ??
        ""
    )
      .toLowerCase()
      .trim();
    const wantsRaw = rawFlag === "1" || rawFlag === "true" || rawFlag === "yes";

    const fileName = path.basename(resolved.target);

    if (wantsRaw) {
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      reply.header("Content-Length", String(stats.size));
      return reply.send(fsSync.createReadStream(resolved.target));
    }

    if (stats.size > maxTransferBytes) {
      throw new Error(`File transfer size exceeds the ${Math.round(maxTransferBytes / (1024 * 1024))} MB limit`);
    }

    const buffer = await fs.readFile(resolved.target);
    return {
      instanceId: id,
      path: resolved.relativePath,
      fileName,
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

    const extractOptions: ExtractArchiveOptions = {
      preview: body.preview === true
    };
    if (body.conflictPolicy) {
      extractOptions.conflictPolicy = body.conflictPolicy;
    } else if (body.overwrite) {
      extractOptions.conflictPolicy = "overwrite";
    }
    if (body.conflictResolutions) {
      extractOptions.conflictResolutions = body.conflictResolutions;
    }

    const result = await extractArchiveToTarget(archive.target, output.target, kind, extractOptions);

    const entry = (await pathExists(output.target))
      ? await toFileEntry(output.root, output.target, path.basename(output.target))
      : {
          name: path.basename(output.target),
          path: output.relativePath,
          type: "directory" as const,
          size: 0,
          modifiedAt: new Date().toISOString()
        };

    return {
      instanceId: id,
      archivePath: archive.relativePath,
      outputPath: output.relativePath,
      entry,
      extractedCount: result.count,
      totalBytes: result.totalBytes,
      skippedCount: result.skippedCount,
      overwrittenCount: result.overwrittenCount,
      ...(body.preview ? { preview: true, conflicts: result.conflicts } : {})
    } satisfies ExtractInstanceArchiveResponse;
  });

  app.post("/api/instances/:id/files/archive", { preHandler: authenticatePanelRequest }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as FileBody & Partial<ArchiveInstancePathsRequest>;
    return archivePathsToOutput(id, body.workingDirectory, body);
  });

  app.post("/api/instances/:id/files/archive/download", { preHandler: authenticatePanelRequest }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as FileBody & Partial<DownloadInstanceArchiveRequest>;

    const rawFlag = String(
      (request.query as Record<string, unknown> | undefined)?.raw ??
        request.headers["x-raw-download"] ??
        ""
    )
      .toLowerCase()
      .trim();
    const wantsRaw = rawFlag === "1" || rawFlag === "true" || rawFlag === "yes";

    if (wantsRaw) {
      const resolvedSources = await resolveArchiveSources(body.workingDirectory, body.paths);
      const defaultFileName =
        resolvedSources.sources.length === 1
          ? archiveFileNameForClientPath(resolvedSources.sources[0]!.relativePath)
          : "selection.zip";
      const fileName = normalizeArchiveFileName(body.fileName, defaultFileName);
      const temporary = await createTemporaryZipArchive(resolvedSources.root, resolvedSources.sources);
      try {
        const stats = await fs.lstat(temporary.archivePath);
        reply.header("Content-Type", "application/zip");
        reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        reply.header("Content-Length", String(stats.size));
        const stream = fsSync.createReadStream(temporary.archivePath);
        const cleanup = () => {
          fs.rm(temporary.tempDirectory, { force: true, recursive: true }).catch(() => {});
        };
        stream.on("close", cleanup);
        stream.on("error", cleanup);
        return reply.send(stream);
      } catch (err) {
        await fs.rm(temporary.tempDirectory, { force: true, recursive: true });
        throw err;
      }
    }

    return archivePathsForDownload(id, body.workingDirectory, body);
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

    await moveEntry(from.target, to.target);
    return toFileEntry(to.root, to.target, path.basename(to.target));
  });

  app.post("/api/instances/:id/files/copy", { preHandler: authenticatePanelRequest }, async (request) => {
    const body = request.body as FileBody & { fromPath: string; toPath: string };
    if (!body.fromPath || !body.toPath) {
      throw new Error("fromPath and toPath are required");
    }

    const from = await resolveTarget(body.workingDirectory, body.fromPath);
    const to = await resolveTarget(body.workingDirectory, body.toPath);
    if (await pathExists(to.target)) {
      throw new Error("Target path already exists");
    }

    await fs.cp(from.target, to.target, { recursive: true });
    return toFileEntry(to.root, to.target, path.basename(to.target));
  });

  app.post("/api/instances/:instanceId/files/grep", { preHandler: authenticatePanelRequest }, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    const body = request.body as GrepInstanceFilesRequest;
    if (!body.pattern) {
      throw new Error("pattern is required");
    }

    const root = await resolveInstanceRoot(body.workingDirectory);
    const maxResults = Math.min(Math.max(1, body.maxResults ?? 100), 500);
    const contextLines = Math.min(Math.max(0, body.contextLines ?? 2), 3);
    const isCaseInsensitive = body.pattern === body.pattern.toLowerCase();
    const flags = isCaseInsensitive ? "i" : "";
    assertSafeRegex(body.pattern, flags);
    const regex = new RegExp(body.pattern, flags);

    const matches: GrepInstanceFilesResponse["matches"] = [];
    let totalMatches = 0;
    let filesSearched = 0;
    let truncated = false;

    for await (const filePath of walkFiles(root, body.path ?? "")) {
      if (truncated) break;
      try {
        const stats = await fs.stat(filePath);
        if (stats.size > maxSearchFileSize) continue;
        if (await isBinaryFile(filePath)) continue;

        filesSearched++;
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/);
        const relativePath = toClientPath(root, filePath);

        if (!matchIncludePattern(path.basename(filePath), body.include)) continue;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const lineText = lines[lineIndex]!;
          const match = regex.exec(lineText);
          if (!match) continue;

          totalMatches++;
          if (matches.length < maxResults) {
            const before =
              contextLines > 0 ? lines.slice(Math.max(0, lineIndex - contextLines), lineIndex) : undefined;
            const after =
              contextLines > 0 ? lines.slice(lineIndex + 1, lineIndex + 1 + contextLines) : undefined;
            matches.push({
              file: relativePath,
              line: lineIndex + 1,
              column: match.index + 1,
              text: lineText,
              ...(before && before.length ? { before } : {}),
              ...(after && after.length ? { after } : {})
            });
          } else {
            truncated = true;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    return {
      instanceId,
      matches,
      totalMatches,
      truncated,
      filesSearched
    } satisfies GrepInstanceFilesResponse;
  });

  app.post("/api/instances/:instanceId/files/glob", { preHandler: authenticatePanelRequest }, async (request) => {
    const { instanceId } = request.params as { instanceId: string };
    const body = request.body as GlobInstanceFilesRequest;
    if (!body.pattern) {
      throw new Error("pattern is required");
    }

    const root = await resolveInstanceRoot(body.workingDirectory);
    const maxResults = Math.min(Math.max(1, body.maxResults ?? 200), 1000);
    const resultPaths: string[] = [];
    let totalMatches = 0;
    let truncated = false;

    for await (const filePath of walkFiles(root, body.path ?? "")) {
      const relativePath = toClientPath(root, filePath);
      if (matchGlobPattern(relativePath, body.pattern)) {
        totalMatches++;
        if (resultPaths.length < maxResults) {
          resultPaths.push(relativePath);
        } else {
          truncated = true;
          break;
        }
      }
    }

    return {
      instanceId,
      paths: resultPaths,
      totalMatches,
      truncated
    } satisfies GlobInstanceFilesResponse;
  });
}
