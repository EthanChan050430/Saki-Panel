import type { ExtractArchiveConflict, ManagedNode, ExtractConflictAction, InstanceFileEntry } from "@webops/shared";

export const imageMimeTypesByExtension: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jepg: "image/jpeg",
  jfif: "image/jpeg",
  jpg: "image/jpeg",
  pjpeg: "image/jpeg",
  pjp: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp"
};

export function fileExtension(pathname: string): string {
  const fileName = pathname.split("/").pop()?.toLowerCase() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : "";
}

export function imageMimeTypeFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  return imageMimeTypesByExtension[fileExtension(pathname)] ?? null;
}

export function isImageFile(pathname: string | null | undefined): boolean {
  return Boolean(imageMimeTypeFromPath(pathname));
}

export function isArchiveFile(pathname: string): boolean {
  return ["zip", "rar", "7z"].includes(fileExtension(pathname));
}

export function joinFilePath(basePath: string, name: string): string {
  return [basePath, name].filter(Boolean).join("/");
}

export function parentFilePath(pathname: string): string {
  if (!pathname) return "";
  const pieces = pathname.split("/").filter(Boolean);
  pieces.pop();
  return pieces.join("/");
}

export function defaultExtractPath(pathname: string): string {
  const fileName = pathname.split("/").pop() ?? "archive";
  const baseName = fileName.replace(/\.(zip|rar|7z)$/i, "") || "archive";
  return joinFilePath(parentFilePath(pathname), baseName);
}

export function defaultArchiveFileName(pathname: string): string {
  const fileName = pathname.split("/").pop() ?? "archive";
  const baseName = fileName.replace(/\.(zip|rar|7z)$/i, "") || "archive";
  return `${baseName}.zip`;
}

export function splitNameForCopy(fileName: string): { stem: string; extension: string } {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: fileName, extension: "" };
  return {
    stem: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex)
  };
}

export function uniqueSiblingName(fileName: string, entries: InstanceFileEntry[]): string {
  const occupied = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
  const { stem, extension } = splitNameForCopy(fileName);
  let copyIndex = 1;
  let candidate = `${stem}${copyIndex}${extension}`;
  while (occupied.has(candidate.toLocaleLowerCase())) {
    copyIndex += 1;
    candidate = `${stem}${copyIndex}${extension}`;
  }
  return candidate;
}

export function filePreviewKindFromPath(pathname: string | null): "html" | "markdown" | "image" | null {
  if (!pathname) return null;
  if (isImageFile(pathname)) return "image";
  const extension = fileExtension(pathname);
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "md" || extension === "markdown" || extension === "mdx") return "markdown";
  return null;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round((value / 1024) * 10) / 10} KB`;
  return `${Math.round((value / 1024 / 1024) * 10) / 10} MB`;
}

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatNumber(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

export function compactContextText(value: string, maxLength = 1400): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...(已截断)` : value;
}

export function averageMetricValues(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export function resourcesFromNodes(nodes: ManagedNode[]): { cpuUsage: number; memoryUsage: number; diskUsage: number } {
  const metrics = nodes
    .filter((node) => node.status === "ONLINE" && node.latestMetric)
    .map((node) => node.latestMetric!);
  return {
    cpuUsage: averageMetricValues(metrics.map((metric) => metric.cpuUsage)),
    memoryUsage: averageMetricValues(metrics.map((metric) => metric.memoryUsage)),
    diskUsage: averageMetricValues(metrics.map((metric) => metric.diskUsage))
  };
}

export function collectFindMatches(content: string, query: string): Array<{ start: number; end: number }> {
  if (!query) return [];
  const matches: Array<{ start: number; end: number }> = [];
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = lowerContent.indexOf(lowerQuery);
  while (index !== -1) {
    matches.push({ start: index, end: index + query.length });
    index = lowerContent.indexOf(lowerQuery, index + query.length);
  }
  return matches;
}

export function base64ToBlob(contentBase64: string, type = ""): Blob {
  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

export const editorLanguageByExtension: Record<string, string> = {
  bash: "shell",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  env: "env",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  php: "php",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "css",
  sh: "shell",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  toml: "toml",
  xml: "html",
  yaml: "yaml",
  yml: "yaml"
};

export function editorLanguageFromPath(pathname: string | null): string {
  if (!pathname) return "text";
  if (isImageFile(pathname)) return "image";
  const fileName = pathname.split("/").pop()?.toLowerCase() ?? "";
  if (!fileName) return "text";
  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) return "dockerfile";
  if (fileName === ".env" || fileName.startsWith(".env.")) return "env";
  const extension = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";
  return editorLanguageByExtension[extension] ?? "text";
}
