import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  InstallOperationPackRequest,
  InstalledOperationPack,
  OperationPackCategory,
  OperationPackDownloadedResource,
  OperationPackManifest,
  OperationPackRegistry,
  OperationPackRegistryItem,
  OperationPackRegistryResponse,
  OperationPackRemoteFile,
  OperationPackResource,
  SakiAgentRiskLevel
} from "@webops/shared";
import { operationPackCategories, operationPackResourceKinds } from "@webops/shared";
import { panelConfig, panelPaths } from "../config.js";
import { assertPublicHttpUrl } from "../routes/saki/web.js";
import { fetchWithTimeout } from "../routes/saki/types.js";

const SAFE_PACK_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SAFE_RESOURCE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REDIRECTS = 4;
const PACK_CACHE_SCHEMA_VERSION = 1;
const capabilityKinds = ["preflight", "health_check", "backup", "rollback", "diagnostic", "deployment"] as const;
const riskLevels = new Set<SakiAgentRiskLevel>(["low", "medium", "high", "critical"]);

type OperationPackCapability = NonNullable<OperationPackManifest["capabilities"]>[number];

interface OperationPackRegistryCache {
  schemaVersion: typeof PACK_CACHE_SCHEMA_VERSION;
  sourceUrl: string;
  fetchedAt: string;
  registry: OperationPackRegistry;
}

interface OperationPackStateFile {
  schemaVersion: typeof PACK_CACHE_SCHEMA_VERSION;
  packs: InstalledOperationPack[];
}

interface LoadedRegistry {
  registry: OperationPackRegistry;
  sourceUrl: string;
  fetchedAt: string;
  stale: boolean;
  warning?: string;
}

interface ResolvedManifest {
  manifest: OperationPackManifest;
  manifestUrl: string;
  manifestSha256: string;
}

interface DownloadResult {
  sizeBytes: number;
  cached: boolean;
}

/** A verified local resource, exposed only to explicit import actions. */
export interface InstalledOperationPackResourceContent {
  pack: InstalledOperationPack;
  resource: OperationPackDownloadedResource;
  content: Uint8Array;
}

/** A user-facing error that Fastify can safely map to a precise HTTP status. */
export class OperationPackError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "OperationPackError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown, label: string, maxLength = 300): string {
  if (typeof value !== "string") throw new OperationPackError(`${label} 必须是字符串。`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new OperationPackError(`${label} 不能为空且长度不能超过 ${maxLength}。`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength = 300): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return asText(value, label, maxLength);
}

function optionalStringList(value: unknown, label: string, maxItems = 32, maxLength = 80): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new OperationPackError(`${label} 必须是最多 ${maxItems} 项的字符串数组。`);
  }
  const items = value.map((item, index) => asText(item, `${label}[${index}]`, maxLength));
  return [...new Set(items)];
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new OperationPackError(`${label} 必须是非负安全整数。`);
  }
  return value;
}

function parseRemoteFile(value: unknown, label: string): OperationPackRemoteFile {
  if (!isRecord(value)) throw new OperationPackError(`${label} 必须是对象。`);
  const sha256 = asText(value.sha256, `${label}.sha256`, 64).toLowerCase();
  if (!SHA256.test(sha256)) {
    throw new OperationPackError(`${label}.sha256 必须是 64 位十六进制 SHA-256。`);
  }
  const sizeBytes = optionalPositiveInteger(value.sizeBytes, `${label}.sizeBytes`);
  if (sizeBytes !== undefined && sizeBytes > panelConfig.operationsPackMaxResourceBytes) {
    throw new OperationPackError(`${label}.sizeBytes 超过当前运维包下载上限。`);
  }
  const contentType = optionalText(value.contentType, `${label}.contentType`, 160);
  return {
    url: asText(value.url, `${label}.url`, 2048),
    sha256,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(contentType ? { contentType } : {})
  };
}

function parsePackId(value: unknown, label: string): string {
  const id = asText(value, label, 64).toLowerCase();
  if (!SAFE_PACK_ID.test(id)) {
    throw new OperationPackError(`${label} 只能包含小写字母、数字、点、连字符和下划线。`);
  }
  return id;
}

function parseResourceId(value: unknown, label: string): string {
  const id = asText(value, label, 64).toLowerCase();
  if (!SAFE_RESOURCE_ID.test(id)) {
    throw new OperationPackError(`${label} 只能包含小写字母、数字、点、连字符和下划线。`);
  }
  return id;
}

function parseCategory(value: unknown, label: string): OperationPackCategory {
  if (typeof value !== "string" || !operationPackCategories.includes(value as OperationPackCategory)) {
    throw new OperationPackError(`${label} 不是受支持的运维包分类。`);
  }
  return value as OperationPackCategory;
}

function normalizeResourcePath(value: unknown, label: string): string {
  const raw = asText(value, label, 240);
  if (raw.includes("\\")) throw new OperationPackError(`${label} 必须使用正斜杠。`);
  const normalized = path.posix.normalize(raw);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new OperationPackError(`${label} 不是安全的相对路径。`);
  }
  return normalized;
}

function parseRisk(value: unknown, label: string): SakiAgentRiskLevel | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !riskLevels.has(value as SakiAgentRiskLevel)) {
    throw new OperationPackError(`${label} 不是受支持的风险等级。`);
  }
  return value as SakiAgentRiskLevel;
}

function parseRegistryItem(value: unknown, index: number): OperationPackRegistryItem {
  const label = `packs[${index}]`;
  if (!isRecord(value)) throw new OperationPackError(`${label} 必须是对象。`);
  const description = optionalText(value.description, `${label}.description`, 2000);
  const tags = optionalStringList(value.tags, `${label}.tags`);
  const iconUrl = optionalText(value.iconUrl, `${label}.iconUrl`, 2048);
  const minPanelVersion = optionalText(value.minPanelVersion, `${label}.minPanelVersion`, 80);
  return {
    id: parsePackId(value.id, `${label}.id`),
    name: asText(value.name, `${label}.name`, 120),
    summary: asText(value.summary, `${label}.summary`, 500),
    category: parseCategory(value.category, `${label}.category`),
    version: asText(value.version, `${label}.version`, 80),
    manifest: parseRemoteFile(value.manifest, `${label}.manifest`),
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(minPanelVersion ? { minPanelVersion } : {})
  };
}

function parseRegistry(value: unknown): OperationPackRegistry {
  if (!isRecord(value)) throw new OperationPackError("运维包注册表必须是 JSON 对象。", 502);
  if (value.schemaVersion !== 1) {
    throw new OperationPackError("不支持的运维包注册表版本。", 502);
  }
  if (!Array.isArray(value.packs) || value.packs.length > panelConfig.operationsPackMaxResourcesPerPack) {
    throw new OperationPackError("运维包注册表 packs 字段无效或过大。", 502);
  }
  const packs = value.packs.map(parseRegistryItem);
  const ids = new Set<string>();
  for (const pack of packs) {
    if (ids.has(pack.id)) throw new OperationPackError(`运维包注册表包含重复 id：${pack.id}。`, 502);
    ids.add(pack.id);
  }
  const generatedAt = optionalText(value.generatedAt, "generatedAt", 80);
  return {
    schemaVersion: 1,
    packs,
    ...(generatedAt ? { generatedAt } : {})
  };
}

function parseCapabilities(value: unknown): OperationPackCapability[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 32) {
    throw new OperationPackError("capabilities 必须是最多 32 项的数组。", 502);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const label = `capabilities[${index}]`;
    if (!isRecord(item)) throw new OperationPackError(`${label} 必须是对象。`, 502);
    const id = parseResourceId(item.id, `${label}.id`);
    if (seen.has(id)) throw new OperationPackError(`capabilities 包含重复 id：${id}。`, 502);
    seen.add(id);
    const kind = item.kind;
    if (typeof kind !== "string" || !capabilityKinds.includes(kind as (typeof capabilityKinds)[number])) {
      throw new OperationPackError(`${label}.kind 不是受支持的能力类型。`, 502);
    }
    const risk = parseRisk(item.risk, `${label}.risk`);
    return {
      id,
      name: asText(item.name, `${label}.name`, 120),
      description: asText(item.description, `${label}.description`, 1000),
      kind: kind as OperationPackCapability["kind"],
      ...(risk ? { risk } : {})
    };
  });
}

function parseManifestResource(value: unknown, index: number): OperationPackResource {
  const label = `resources[${index}]`;
  if (!isRecord(value)) throw new OperationPackError(`${label} 必须是对象。`, 502);
  const kind = value.kind;
  if (typeof kind !== "string" || !operationPackResourceKinds.includes(kind as OperationPackResource["kind"])) {
    throw new OperationPackError(`${label}.kind 不是受支持的资源类型。`, 502);
  }
  const description = optionalText(value.description, `${label}.description`, 2000);
  const risk = parseRisk(value.risk, `${label}.risk`);
  const remote = parseRemoteFile(value, label);
  return {
    ...remote,
    id: parseResourceId(value.id, `${label}.id`),
    kind: kind as OperationPackResource["kind"],
    path: normalizeResourcePath(value.path, `${label}.path`),
    name: asText(value.name, `${label}.name`, 120),
    ...(description ? { description } : {}),
    ...(value.required === undefined ? {} : { required: Boolean(value.required) }),
    ...(risk ? { risk } : {})
  };
}

function parseManifest(value: unknown, registryItem: OperationPackRegistryItem): OperationPackManifest {
  if (!isRecord(value)) throw new OperationPackError("运维包清单必须是 JSON 对象。", 502);
  if (value.schemaVersion !== 1) throw new OperationPackError("不支持的运维包清单版本。", 502);
  const id = parsePackId(value.id, "manifest.id");
  const version = asText(value.version, "manifest.version", 80);
  const category = parseCategory(value.category, "manifest.category");
  if (id !== registryItem.id || version !== registryItem.version || category !== registryItem.category) {
    throw new OperationPackError("运维包清单与注册表的 id、版本或分类不匹配。", 502);
  }
  if (!Array.isArray(value.resources) || value.resources.length === 0 || value.resources.length > panelConfig.operationsPackMaxResourcesPerPack) {
    throw new OperationPackError("运维包清单 resources 字段无效或过大。", 502);
  }
  const resources = value.resources.map(parseManifestResource);
  const resourceIds = new Set<string>();
  const resourcePaths = new Set<string>();
  for (const resource of resources) {
    if (resourceIds.has(resource.id)) throw new OperationPackError(`运维包清单包含重复资源 id：${resource.id}。`, 502);
    if (resourcePaths.has(resource.path)) throw new OperationPackError(`运维包清单包含重复资源路径：${resource.path}。`, 502);
    resourceIds.add(resource.id);
    resourcePaths.add(resource.path);
  }
  const defaultResourceIds = optionalStringList(value.defaultResourceIds, "defaultResourceIds", panelConfig.operationsPackMaxResourcesPerPack, 64)
    ?.map((resourceId) => parseResourceId(resourceId, "defaultResourceIds[]"));
  if (defaultResourceIds?.some((resourceId) => !resourceIds.has(resourceId))) {
    throw new OperationPackError("defaultResourceIds 包含不存在的资源。", 502);
  }
  const description = optionalText(value.description, "manifest.description", 6000);
  const tags = optionalStringList(value.tags, "manifest.tags");
  const minPanelVersion = optionalText(value.minPanelVersion, "manifest.minPanelVersion", 80);
  const capabilities = parseCapabilities(value.capabilities);
  return {
    schemaVersion: 1,
    id,
    name: asText(value.name, "manifest.name", 120),
    summary: asText(value.summary, "manifest.summary", 500),
    category,
    version,
    resources,
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
    ...(minPanelVersion ? { minPanelVersion } : {}),
    ...(defaultResourceIds?.length ? { defaultResourceIds } : {}),
    ...(capabilities?.length ? { capabilities } : {})
  };
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export class OperationPackManager {
  private readonly baseDir = panelPaths.operationsPacksDir;
  private readonly registryCacheFile = path.join(this.baseDir, "registry-cache.json");
  private readonly stateFile = path.join(this.baseDir, "installed.json");

  async getRegistry(options: { refresh?: boolean } = {}): Promise<OperationPackRegistryResponse> {
    const loaded = await this.loadRegistry(options.refresh ?? false);
    return {
      items: loaded.registry.packs,
      sourceUrl: loaded.sourceUrl,
      fetchedAt: loaded.fetchedAt,
      stale: loaded.stale,
      ...(loaded.warning ? { warning: loaded.warning } : {})
    };
  }

  async listInstalled(): Promise<InstalledOperationPack[]> {
    const state = await this.readState();
    return [...state.packs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * Read an already-downloaded resource without reaching the network. This is
   * intentionally the only path used by import/activation routes, so a later
   * panel action cannot accidentally replace reviewed cached content.
   */
  async readInstalledResources(
    packId: string,
    resourceIds: readonly string[]
  ): Promise<InstalledOperationPackResourceContent[]> {
    const requestedId = parsePackId(packId, "pack id");
    if (!Array.isArray(resourceIds) || resourceIds.length === 0 || resourceIds.length > panelConfig.operationsPackMaxResourcesPerPack) {
      throw new OperationPackError("请至少选择一个已下载的运维包资源。", 400);
    }
    const requestedResourceIds = [...new Set(resourceIds.map((id) => parseResourceId(id, "resourceIds[]")))];
    const state = await this.readState();
    const pack = state.packs
      .filter((item) => item.id === requestedId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!pack) throw new OperationPackError("该运维包尚未下载；请先完成校验下载。", 409);

    const expectedRoot = path.resolve(this.packRoot(pack.id, pack.version));
    if (path.resolve(pack.localPath) !== expectedRoot) {
      throw new OperationPackError("运维包本地缓存路径无效，拒绝导入。", 409);
    }

    const resourcesById = new Map(pack.resources.map((resource) => [resource.id, resource]));
    const results: InstalledOperationPackResourceContent[] = [];
    for (const resourceId of requestedResourceIds) {
      const resource = resourcesById.get(resourceId);
      if (!resource) throw new OperationPackError(`资源「${resourceId}」尚未下载。`, 409);
      if (
        !SHA256.test(resource.sha256) ||
        !operationPackResourceKinds.includes(resource.kind) ||
        !Number.isSafeInteger(resource.sizeBytes) ||
        resource.sizeBytes < 1
      ) {
        throw new OperationPackError(`资源「${resourceId}」的本地元数据无效。`, 409);
      }
      const targetPath = this.resolveTargetPath(expectedRoot, normalizeResourcePath(resource.path, `resource ${resourceId} path`));
      const content = await this.readVerifiedCachedFile(targetPath, resource.sha256);
      if (!content || content.length !== resource.sizeBytes) {
        throw new OperationPackError(`资源「${resourceId}」的缓存已失效；请重新下载后再导入。`, 409);
      }
      results.push({ pack, resource, content });
    }
    return results;
  }

  async install(
    packId: string,
    request: InstallOperationPackRequest = {}
  ): Promise<{ pack: InstalledOperationPack; manifest: OperationPackManifest; downloaded: OperationPackDownloadedResource[] }> {
    const requestedId = parsePackId(packId, "pack id");
    const registry = await this.loadRegistry(false);
    const registryItem = registry.registry.packs.find((item) => item.id === requestedId);
    if (!registryItem) throw new OperationPackError("未找到该运维包。", 404);

    const resolved = await this.loadManifest(registryItem, registry.sourceUrl);
    const selectedResources = this.selectResources(resolved.manifest, request.resourceIds);
    const packRoot = this.packRoot(resolved.manifest.id, resolved.manifest.version);
    const downloaded: OperationPackDownloadedResource[] = [];
    for (const resource of selectedResources) {
      const targetPath = this.resolveTargetPath(packRoot, resource.path);
      const result = await this.downloadResource(
        resource,
        targetPath,
        resolved.manifestUrl,
        Boolean(request.force)
      );
      downloaded.push({
        id: resource.id,
        kind: resource.kind,
        path: resource.path,
        sha256: resource.sha256,
        sizeBytes: result.sizeBytes,
        cached: result.cached
      });
    }

    const state = await this.readState();
    const now = new Date().toISOString();
    const existing = state.packs.find(
      (item) => item.id === resolved.manifest.id && item.version === resolved.manifest.version
    );
    const resourceMap = new Map((existing?.resources ?? []).map((item) => [item.id, item]));
    for (const item of downloaded) resourceMap.set(item.id, item);
    const installed: InstalledOperationPack = {
      id: resolved.manifest.id,
      name: resolved.manifest.name,
      category: resolved.manifest.category,
      version: resolved.manifest.version,
      manifestSha256: resolved.manifestSha256,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      localPath: packRoot,
      resources: [...resourceMap.values()].sort((left, right) => left.path.localeCompare(right.path))
    };
    state.packs = state.packs.filter(
      (item) => item.id !== installed.id || item.version !== installed.version
    );
    state.packs.push(installed);
    await this.writeJsonAtomic(this.stateFile, state);
    return { pack: installed, manifest: resolved.manifest, downloaded };
  }

  private async loadRegistry(forceRefresh: boolean): Promise<LoadedRegistry> {
    const cached = await this.readRegistryCache();
    const configuredSource = panelConfig.operationsPackRegistryUrl;
    const cacheMatchesSource = cached?.sourceUrl === configuredSource;
    if (!forceRefresh && cached && cacheMatchesSource && this.isFresh(cached.fetchedAt)) {
      return {
        registry: cached.registry,
        sourceUrl: cached.sourceUrl,
        fetchedAt: cached.fetchedAt,
        stale: false
      };
    }

    try {
      const { body, finalUrl } = await this.downloadText(configuredSource, undefined, panelConfig.operationsPackMaxRegistryBytes);
      const parsed = parseRegistry(JSON.parse(body) as unknown);
      const fetchedAt = new Date().toISOString();
      const next: OperationPackRegistryCache = {
        schemaVersion: PACK_CACHE_SCHEMA_VERSION,
        sourceUrl: finalUrl,
        fetchedAt,
        registry: parsed
      };
      await this.writeJsonAtomic(this.registryCacheFile, next);
      return { registry: parsed, sourceUrl: finalUrl, fetchedAt, stale: false };
    } catch (error) {
      if (cached) {
        return {
          registry: cached.registry,
          sourceUrl: cached.sourceUrl,
          fetchedAt: cached.fetchedAt,
          stale: true,
          warning: `在线注册表暂不可用，正在使用 ${cached.fetchedAt} 的已验证缓存。`
        };
      }
      if (error instanceof OperationPackError) throw error;
      throw new OperationPackError(`无法下载运维包注册表：${errorMessage(error)}`, 502);
    }
  }

  private async loadManifest(item: OperationPackRegistryItem, registryUrl: string): Promise<ResolvedManifest> {
    const manifestUrl = await this.resolvePublicUrl(item.manifest.url, registryUrl);
    const cachePath = path.join(this.baseDir, "manifests", `${item.id}-${item.version}-${item.manifest.sha256}.json`);
    let bytes = await this.readVerifiedCachedFile(cachePath, item.manifest.sha256);
    if (!bytes) {
      const downloaded = await this.downloadBytes(manifestUrl, panelConfig.operationsPackMaxManifestBytes);
      if (item.manifest.sizeBytes !== undefined && downloaded.length !== item.manifest.sizeBytes) {
        throw new OperationPackError("运维包清单实际大小与注册表不匹配。", 502);
      }
      if (digest(downloaded) !== item.manifest.sha256) {
        throw new OperationPackError("运维包清单的 SHA-256 校验失败。", 502);
      }
      await this.writeFileAtomic(cachePath, downloaded);
      bytes = downloaded;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    } catch {
      throw new OperationPackError("运维包清单不是有效 JSON。", 502);
    }
    return {
      manifest: parseManifest(parsed, item),
      manifestUrl,
      manifestSha256: item.manifest.sha256
    };
  }

  private selectResources(manifest: OperationPackManifest, requestedIds: string[] | undefined): OperationPackResource[] {
    const allById = new Map(manifest.resources.map((resource) => [resource.id, resource]));
    const desired = new Set<string>();
    for (const resource of manifest.resources) {
      if (resource.required) desired.add(resource.id);
    }
    if (requestedIds === undefined) {
      for (const resourceId of manifest.defaultResourceIds ?? []) desired.add(resourceId);
    } else {
      if (!Array.isArray(requestedIds) || requestedIds.length > panelConfig.operationsPackMaxResourcesPerPack) {
        throw new OperationPackError("resourceIds 无效或过多。", 400);
      }
      for (const rawId of requestedIds) {
        const resourceId = parseResourceId(rawId, "resourceIds[]");
        if (!allById.has(resourceId)) throw new OperationPackError(`未找到资源：${resourceId}。`, 400);
        desired.add(resourceId);
      }
    }
    if (desired.size === 0) {
      throw new OperationPackError("该运维包没有需要下载的默认资源；请显式选择资源。", 400);
    }
    return manifest.resources.filter((resource) => desired.has(resource.id));
  }

  private async downloadResource(
    resource: OperationPackResource,
    targetPath: string,
    manifestUrl: string,
    force: boolean
  ): Promise<DownloadResult> {
    if (!force) {
      const existing = await this.readVerifiedCachedFile(targetPath, resource.sha256);
      if (existing) return { sizeBytes: existing.length, cached: true };
    }

    const sourceUrl = await this.resolvePublicUrl(resource.url, manifestUrl);
    const { response } = await this.fetchPublic(sourceUrl);
    if (!response.ok) {
      throw new OperationPackError(`资源「${resource.name}」下载失败（HTTP ${response.status}）。`, 502);
    }
    const declaredLength = this.contentLength(response);
    if (declaredLength !== undefined && declaredLength > panelConfig.operationsPackMaxResourceBytes) {
      throw new OperationPackError(`资源「${resource.name}」超过当前下载上限。`, 413);
    }
    if (resource.sizeBytes !== undefined && declaredLength !== undefined && declaredLength !== resource.sizeBytes) {
      throw new OperationPackError(`资源「${resource.name}」声明大小与清单不匹配。`, 502);
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.partial-${randomUUID()}`;
    let handle: fs.FileHandle | undefined;
    const hasher = createHash("sha256");
    let sizeBytes = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new OperationPackError(`资源「${resource.name}」响应为空。`, 502);
    try {
      handle = await fs.open(temporaryPath, "wx");
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const value = next.value;
        sizeBytes += value.byteLength;
        if (sizeBytes > panelConfig.operationsPackMaxResourceBytes) {
          throw new OperationPackError(`资源「${resource.name}」超过当前下载上限。`, 413);
        }
        hasher.update(value);
        await handle.write(value);
      }
      if (resource.sizeBytes !== undefined && sizeBytes !== resource.sizeBytes) {
        throw new OperationPackError(`资源「${resource.name}」实际大小与清单不匹配。`, 502);
      }
      if (hasher.digest("hex") !== resource.sha256) {
        throw new OperationPackError(`资源「${resource.name}」的 SHA-256 校验失败。`, 502);
      }
      await handle.close();
      handle = undefined;
      await fs.rm(targetPath, { force: true });
      await fs.rename(temporaryPath, targetPath);
      return { sizeBytes, cached: false };
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
      reader.releaseLock();
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async downloadText(rawUrl: string, baseUrl: string | undefined, maxBytes: number): Promise<{ body: string; finalUrl: string }> {
    const sourceUrl = await this.resolvePublicUrl(rawUrl, baseUrl);
    const bytes = await this.downloadBytes(sourceUrl, maxBytes);
    return { body: Buffer.from(bytes).toString("utf8"), finalUrl: sourceUrl };
  }

  private async downloadBytes(url: string, maxBytes: number): Promise<Uint8Array> {
    const { response } = await this.fetchPublic(url);
    if (!response.ok) throw new OperationPackError(`远程文件下载失败（HTTP ${response.status}）。`, 502);
    const declaredLength = this.contentLength(response);
    if (declaredLength !== undefined && declaredLength > maxBytes) {
      throw new OperationPackError("远程文件超过允许的下载上限。", 413);
    }
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        sizeBytes += next.value.byteLength;
        if (sizeBytes > maxBytes) throw new OperationPackError("远程文件超过允许的下载上限。", 413);
        chunks.push(next.value);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async fetchPublic(sourceUrl: string): Promise<{ response: Response; finalUrl: string }> {
    let current = await this.resolvePublicUrl(sourceUrl, undefined);
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetchWithTimeout(
        current,
        {
          method: "GET",
          redirect: "manual",
          headers: {
            accept: "application/json, text/plain, text/markdown, application/octet-stream;q=0.9, */*;q=0.1",
            "user-agent": "Saki-Panel-Operations-Pack/1.0"
          }
        },
        panelConfig.operationsPackRequestTimeoutMs
      );
      if (!isRedirect(response.status)) return { response, finalUrl: current };
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new OperationPackError("远程文件重定向缺少 Location 响应头。", 502);
      if (redirectCount === MAX_REDIRECTS) throw new OperationPackError("远程文件重定向次数过多。", 502);
      current = await this.resolvePublicUrl(location, current);
    }
    throw new OperationPackError("远程文件重定向次数过多。", 502);
  }

  private async resolvePublicUrl(rawUrl: string, baseUrl: string | undefined): Promise<string> {
    let resolved: URL;
    try {
      resolved = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    } catch {
      throw new OperationPackError("运维包包含无效的远程 URL。", 502);
    }
    const publicUrl = await assertPublicHttpUrl(resolved.toString());
    return publicUrl.toString();
  }

  private contentLength(response: Response): number | undefined {
    const raw = response.headers.get("content-length");
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private async readRegistryCache(): Promise<OperationPackRegistryCache | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.registryCacheFile, "utf8")) as unknown;
      if (!isRecord(raw) || raw.schemaVersion !== PACK_CACHE_SCHEMA_VERSION) return null;
      const sourceUrl = asText(raw.sourceUrl, "cache.sourceUrl", 2048);
      const fetchedAt = asText(raw.fetchedAt, "cache.fetchedAt", 80);
      if (!Number.isFinite(Date.parse(fetchedAt))) return null;
      return { schemaVersion: PACK_CACHE_SCHEMA_VERSION, sourceUrl, fetchedAt, registry: parseRegistry(raw.registry) };
    } catch {
      return null;
    }
  }

  private async readState(): Promise<OperationPackStateFile> {
    try {
      const raw = JSON.parse(await fs.readFile(this.stateFile, "utf8")) as unknown;
      if (!isRecord(raw) || raw.schemaVersion !== PACK_CACHE_SCHEMA_VERSION || !Array.isArray(raw.packs)) {
        return { schemaVersion: PACK_CACHE_SCHEMA_VERSION, packs: [] };
      }
      const packs = raw.packs.filter((item): item is InstalledOperationPack => this.isInstalledPack(item));
      return { schemaVersion: PACK_CACHE_SCHEMA_VERSION, packs };
    } catch {
      return { schemaVersion: PACK_CACHE_SCHEMA_VERSION, packs: [] };
    }
  }

  private isInstalledPack(value: unknown): value is InstalledOperationPack {
    if (!isRecord(value) || !SAFE_PACK_ID.test(String(value.id)) || !Array.isArray(value.resources)) return false;
    return (
      typeof value.name === "string" &&
      typeof value.version === "string" &&
      typeof value.manifestSha256 === "string" &&
      SHA256.test(value.manifestSha256) &&
      typeof value.installedAt === "string" &&
      typeof value.updatedAt === "string" &&
      typeof value.localPath === "string" &&
      operationPackCategories.includes(value.category as OperationPackCategory)
    );
  }

  private isFresh(fetchedAt: string): boolean {
    const stamp = Date.parse(fetchedAt);
    return Number.isFinite(stamp) && Date.now() - stamp >= 0 && Date.now() - stamp < panelConfig.operationsPackRegistryTtlMs;
  }

  private packRoot(id: string, version: string): string {
    const safeVersion = version.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
    if (!safeVersion) throw new OperationPackError("运维包版本无效。", 502);
    return path.join(this.baseDir, "packs", id, safeVersion);
  }

  private resolveTargetPath(packRoot: string, resourcePath: string): string {
    const resolved = path.resolve(packRoot, ...resourcePath.split("/"));
    if (!resolved.startsWith(packRoot + path.sep)) {
      throw new OperationPackError("运维包资源路径越界。", 502);
    }
    return resolved;
  }

  private async readVerifiedCachedFile(filePath: string, expectedSha256: string): Promise<Uint8Array | null> {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || stats.size > panelConfig.operationsPackMaxResourceBytes) return null;
      const bytes = await fs.readFile(filePath);
      return digest(bytes) === expectedSha256 ? bytes : null;
    } catch {
      return null;
    }
  }

  private async writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
    await this.writeFileAtomic(filePath, Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"));
  }

  private async writeFileAtomic(filePath: string, content: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.partial-${randomUUID()}`;
    try {
      await fs.writeFile(temporaryPath, content, { flag: "wx" });
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export const operationPackManager = new OperationPackManager();
