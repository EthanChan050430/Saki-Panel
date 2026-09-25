import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const packsDir = path.join(rootDir, "operations-packs");
const registryPath = path.join(packsDir, "registry.json");
const requiredPackIds = new Set(["minecraft-paper", "docker-compose-service-guardian"]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fail(message) {
  throw new Error(`[operations-packs] ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localResourcePath(basePath, rawUrl, label) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) fail(`${label} must have a local relative URL.`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) || rawUrl.startsWith("//")) {
    fail(`${label} must use a local relative URL in the publisher tree.`);
  }
  const resolved = path.resolve(path.dirname(basePath), rawUrl);
  const relative = path.relative(packsDir, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${label} escapes operations-packs/.`);
  }
  return resolved;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertFile(remote, filePath, label) {
  if (!isRecord(remote)) fail(`${label} must be an object.`);
  if (typeof remote.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(remote.sha256)) {
    fail(`${label} must have a lowercase SHA-256.`);
  }
  if (!Number.isSafeInteger(remote.sizeBytes) || remote.sizeBytes < 1) {
    fail(`${label} must have a positive exact sizeBytes.`);
  }
  const content = await fs.readFile(filePath);
  if (content.length !== remote.sizeBytes) {
    fail(`${label} size mismatch: expected ${remote.sizeBytes}, got ${content.length}.`);
  }
  const actualHash = sha256(content);
  if (actualHash !== remote.sha256) {
    fail(`${label} SHA-256 mismatch: expected ${remote.sha256}, got ${actualHash}.`);
  }
  if (content.includes("REPLACE_")) fail(`${label} still contains a placeholder.`);
  return content;
}

function parseResourceJson(resources, resourceId, label) {
  const content = resources.get(resourceId);
  if (!content) fail(`${label} is missing resource ${resourceId}.`);
  try {
    return JSON.parse(content.toString("utf8"));
  } catch (error) {
    fail(`${label}/${resourceId} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertTemplateShape(resources, resourceId, expectedType, label) {
  const template = parseResourceJson(resources, resourceId, label);
  if (
    !isRecord(template) ||
    template.schemaVersion !== 1 ||
    template.kind !== "instance-template" ||
    !isRecord(template.template) ||
    template.template.type !== expectedType ||
    typeof template.template.defaultStartCommand !== "string" ||
    !template.template.defaultStartCommand.trim()
  ) {
    fail(`${label}/${resourceId} must be a usable ${expectedType} instance-template.`);
  }
}

function assertLaunchPackShape(packId, resources) {
  if (packId === "minecraft-paper") {
    for (const id of [
      "paper-installer",
      "paper-instance-template",
      "paper-watch-runbook",
      "paper-log-signatures",
      "paper-world-backup-script",
      "paper-port-check-script"
    ]) {
      if (!resources.has(id)) fail(`minecraft-paper is missing its required published resource ${id}.`);
    }
    assertTemplateShape(resources, "paper-instance-template", "minecraft", "minecraft-paper");
    const detector = parseResourceJson(resources, "paper-log-signatures", "minecraft-paper");
    if (!isRecord(detector) || detector.engine !== "saki-watch" || detector.defaults?.mode !== "diagnose_only") {
      fail("minecraft-paper log signatures must remain diagnose_only.");
    }
    return;
  }
  if (packId === "docker-compose-service-guardian") {
    for (const id of ["compose-operations-skill", "compose-service-template", "compose-watch-profile", "compose-preflight-checklist"]) {
      if (!resources.has(id)) fail(`docker-compose-service-guardian is missing its required published resource ${id}.`);
    }
    assertTemplateShape(resources, "compose-service-template", "docker_compose", "docker-compose-service-guardian");
    const profile = parseResourceJson(resources, "compose-watch-profile", "docker-compose-service-guardian");
    if (!isRecord(profile) || !isRecord(profile.recommendedPolicy) || profile.recommendedPolicy.autoApproveRisk !== "none") {
      fail("docker-compose-service-guardian watch profile must retain no automatic risk approval.");
    }
  }
}

async function verifyPack(item) {
  if (!isRecord(item)) fail("registry packs entries must be objects.");
  if (typeof item.id !== "string" || !item.id) fail("registry pack is missing id.");
  if (typeof item.version !== "string" || !item.version) fail(`${item.id} is missing version.`);
  if (typeof item.category !== "string" || !item.category) fail(`${item.id} is missing category.`);
  const manifestPath = localResourcePath(registryPath, item.manifest?.url, `${item.id} manifest`);
  const manifestContent = await assertFile(item.manifest, manifestPath, `${item.id} manifest`);
  const manifest = JSON.parse(manifestContent.toString("utf8"));
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) fail(`${item.id} manifest must use schemaVersion 1.`);
  for (const field of ["id", "version", "category"]) {
    if (manifest[field] !== item[field]) fail(`${item.id} manifest ${field} does not match registry.`);
  }
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    fail(`${item.id} manifest has no resources.`);
  }
  const resourceIds = new Set();
  const resourcePaths = new Set();
  const resourceContents = new Map();
  for (const resource of manifest.resources) {
    if (!isRecord(resource) || typeof resource.id !== "string" || typeof resource.path !== "string") {
      fail(`${item.id} has an invalid resource entry.`);
    }
    if (resourceIds.has(resource.id) || resourcePaths.has(resource.path)) {
      fail(`${item.id} has duplicate resource id or path: ${resource.id}.`);
    }
    resourceIds.add(resource.id);
    resourcePaths.add(resource.path);
    const resourceFile = localResourcePath(manifestPath, resource.url, `${item.id}/${resource.id}`);
    resourceContents.set(resource.id, await assertFile(resource, resourceFile, `${item.id}/${resource.id}`));
  }
  for (const id of manifest.defaultResourceIds ?? []) {
    if (!resourceIds.has(id)) fail(`${item.id} defaultResourceIds references unknown resource ${id}.`);
  }
  assertLaunchPackShape(item.id, resourceContents);
  return manifest.resources.length;
}

const registry = await readJson(registryPath, "registry.json");
if (!isRecord(registry) || registry.schemaVersion !== 1 || !Array.isArray(registry.packs)) {
  fail("registry.json must contain schemaVersion 1 and a packs array.");
}

const packIds = new Set();
let resourceCount = 0;
for (const pack of registry.packs) {
  if (!isRecord(pack) || typeof pack.id !== "string") fail("registry contains an invalid pack entry.");
  if (packIds.has(pack.id)) fail(`registry contains duplicate pack id ${pack.id}.`);
  packIds.add(pack.id);
  resourceCount += await verifyPack(pack);
}
for (const id of requiredPackIds) {
  if (!packIds.has(id)) fail(`required vertical pack is missing: ${id}.`);
}

console.log(`Verified ${packIds.size} operations packs and ${resourceCount} resources with exact SHA-256 and size checks.`);
