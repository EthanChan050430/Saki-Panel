import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type {
  ActivateOperationPackRequest,
  ActivatedOperationPackResource,
  CreateCustomTemplateRequest,
  InstanceType,
  InstallOperationPackRequest,
  RestartPolicy,
  SakiSkillDetail
} from "@webops/shared";
import { loadCurrentUser, requireAnyPermission, requirePermission } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { prisma } from "../db.js";
import { findDangerousCommandReason } from "../security.js";
import {
  OperationPackError,
  operationPackManager,
  type InstalledOperationPackResourceContent
} from "../operations-packs/manager.js";
import { readSakiSkill, saveSakiSkill } from "./saki/skills.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRefresh(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

function parseInstallRequest(value: unknown): InstallOperationPackRequest {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new OperationPackError("安装请求必须是 JSON 对象。", 400);
  const resourceIds = value.resourceIds;
  if (resourceIds !== undefined && (!Array.isArray(resourceIds) || resourceIds.some((item) => typeof item !== "string"))) {
    throw new OperationPackError("resourceIds 必须是字符串数组。", 400);
  }
  if (value.force !== undefined && typeof value.force !== "boolean") {
    throw new OperationPackError("force 必须是布尔值。", 400);
  }
  return {
    ...(resourceIds === undefined ? {} : { resourceIds: [...resourceIds] }),
    ...(value.force === undefined ? {} : { force: value.force })
  };
}

function parseActivateRequest(value: unknown): ActivateOperationPackRequest {
  if (!isRecord(value)) throw new OperationPackError("导入请求必须是 JSON 对象。", 400);
  const resourceIds = value.resourceIds;
  if (!Array.isArray(resourceIds) || resourceIds.length === 0 || resourceIds.some((item) => typeof item !== "string" || !item.trim())) {
    throw new OperationPackError("resourceIds 必须是非空字符串数组。", 400);
  }
  return { resourceIds: [...new Set(resourceIds.map((item) => item.trim()))] };
}

function asText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new OperationPackError(`${label} 必须是字符串。`, 422);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new OperationPackError(`${label} 不能为空且不能超过 ${maxLength} 个字符。`, 422);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return asText(value, label, maxLength);
}

const importedInstanceTypes = new Set<InstanceType>([
  "generic_command",
  "nodejs",
  "python",
  "java_jar",
  "shell_script",
  "docker_container",
  "docker_compose",
  "minecraft",
  "steam_game_server"
]);
const importedRestartPolicies = new Set<RestartPolicy>(["never", "on_failure", "always", "fixed_interval"]);

function parseImportedTemplate(content: Uint8Array): CreateCustomTemplateRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(content).toString("utf8")) as unknown;
  } catch {
    throw new OperationPackError("模板资源不是有效 JSON。", 422);
  }
  if (!isRecord(raw) || raw.schemaVersion !== 1 || raw.kind !== "instance-template" || !isRecord(raw.template)) {
    throw new OperationPackError("模板资源不是受支持的 instance-template 格式。", 422);
  }
  const item = raw.template;
  const type = item.type;
  if (typeof type !== "string" || !importedInstanceTypes.has(type as InstanceType)) {
    throw new OperationPackError("模板资源包含不支持的实例类型。", 422);
  }
  const defaultStartCommand = asText(item.defaultStartCommand ?? item.startCommandTemplate, "模板启动命令", 2000);
  const blocked = findDangerousCommandReason(defaultStartCommand);
  if (blocked) throw new OperationPackError(`模板启动命令被安全策略拒绝：${blocked}`, 422);

  const rawPrefix = optionalText(item.defaultWorkingDirectoryPrefix ?? item.workingDirectory, "模板工作目录前缀", 160) ?? "instances";
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(rawPrefix) || rawPrefix.split(/[\\/]+/).some((part) => part === "..")) {
    throw new OperationPackError("模板工作目录前缀必须是安全的相对路径。", 422);
  }

  const ports = Array.isArray(item.ports)
    ? item.ports.map((port, index) => {
        const portNumber = isRecord(port) ? port.port : undefined;
        if (typeof portNumber !== "number" || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
          throw new OperationPackError(`模板 ports[${index}] 无效。`, 422);
        }
        return { port: portNumber, description: optionalText(port?.description, `模板 ports[${index}].description`, 200) ?? "服务端口" };
      })
    : [];
  const envs = Array.isArray(item.envs)
    ? item.envs.map((env, index) => {
        if (!isRecord(env)) throw new OperationPackError(`模板 envs[${index}] 无效。`, 422);
        return {
          key: asText(env.key, `模板 envs[${index}].key`, 120),
          value: typeof env.value === "string" ? env.value : ""
        };
      })
    : [];
  const policy = item.restartPolicy ?? "never";
  if (typeof policy !== "string" || !importedRestartPolicies.has(policy as RestartPolicy)) {
    throw new OperationPackError("模板重启策略无效。", 422);
  }
  const rawRetries = item.restartMaxRetries;
  const retries = rawRetries === undefined ? 3 : typeof rawRetries === "number" ? rawRetries : Number.NaN;
  if (!Number.isInteger(retries) || retries < 0 || retries > 99) {
    throw new OperationPackError("模板最大重试次数无效。", 422);
  }
  const stopCommand = item.defaultStopCommand ?? item.stopCommand;
  if (stopCommand !== undefined && stopCommand !== null && typeof stopCommand !== "string") {
    throw new OperationPackError("模板停止命令无效。", 422);
  }
  const description = optionalText(item.description, "模板描述", 2000);
  return {
    name: asText(item.name, "模板名称", 120),
    ...(description ? { description } : {}),
    type: type as InstanceType,
    defaultStartCommand,
    defaultStopCommand: typeof stopCommand === "string" ? stopCommand.trim() || null : null,
    defaultWorkingDirectoryPrefix: rawPrefix,
    ports,
    envs,
    autoStart: item.autoStart === true,
    restartPolicy: policy as RestartPolicy,
    restartMaxRetries: retries
  };
}

function parsePackSkill(content: Uint8Array, fallbackName: string): { name: string; description: string; tags: string[]; content: string } {
  const raw = Buffer.from(content).toString("utf8").trim();
  if (!raw) throw new OperationPackError("Skill / Runbook 资源为空。", 422);
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const metadata: Record<string, string> = {};
  if (frontmatter) {
    for (const line of (frontmatter[1] ?? "").split(/\r?\n/)) {
      const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (pair) metadata[pair[1] ?? ""] = (pair[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
    }
  }
  const skillContent = (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim();
  if (!skillContent) throw new OperationPackError("Skill / Runbook 缺少正文。", 422);
  const tags = (metadata.tags ?? "")
    .replace(/^\[|\]$/g, "")
    .split(/[,，]/)
    .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .slice(0, 16);
  return {
    name: metadata.name?.slice(0, 120) || fallbackName,
    description: metadata.description?.slice(0, 500) || "从已校验的运维包导入的值班 Runbook。",
    tags,
    content: skillContent
  };
}

function activationTarget(kind: string): "template" | "saki_skill" | null {
  if (kind === "template") return "template";
  if (kind === "skill" || kind === "runbook") return "saki_skill";
  return null;
}

async function importTemplateResource(
  userId: string,
  item: InstalledOperationPackResourceContent
): Promise<ActivatedOperationPackResource> {
  const template = parseImportedTemplate(item.content);
  const sourceMarker = `来源：运维包 ${item.pack.id} v${item.pack.version} / ${item.resource.id}`;
  const existing = await prisma.template.findFirst({
    where: { createdById: userId, description: { contains: sourceMarker } },
    select: { id: true, name: true }
  });
  if (existing) {
    return {
      resourceId: item.resource.id,
      kind: item.resource.kind,
      target: "template",
      targetId: existing.id,
      name: existing.name,
      created: false
    };
  }
  const created = await prisma.template.create({
    data: {
      id: randomUUID(),
      name: template.name,
      description: [template.description, `[${sourceMarker}]`].filter(Boolean).join("\n\n"),
      type: template.type ?? "generic_command",
      defaultStartCommand: template.defaultStartCommand ?? "",
      defaultStopCommand: template.defaultStopCommand ?? null,
      defaultWorkingDirectoryPrefix: template.defaultWorkingDirectoryPrefix ?? "instances",
      portsJson: JSON.stringify(template.ports ?? []),
      envsJson: JSON.stringify(template.envs ?? []),
      autoStart: Boolean(template.autoStart),
      restartPolicy: template.restartPolicy ?? "never",
      restartMaxRetries: template.restartMaxRetries ?? 3,
      runAsUser: template.runAsUser ?? null,
      memoryLimit: template.memoryLimit ?? null,
      cpuLimit: template.cpuLimit ?? null,
      fromInstanceId: null,
      isBuiltin: false,
      createdById: userId
    },
    select: { id: true, name: true }
  });
  return {
    resourceId: item.resource.id,
    kind: item.resource.kind,
    target: "template",
    targetId: created.id,
    name: created.name,
    created: true
  };
}

async function importSkillResource(item: InstalledOperationPackResourceContent): Promise<ActivatedOperationPackResource> {
  const parsed = parsePackSkill(item.content, `${item.pack.name} ${item.resource.id}`);
  const id = `pack-${item.pack.id}-${item.resource.id}`.slice(0, 80);
  const sourceUrl = `operations-pack://${item.pack.id}/${item.pack.version}/${item.resource.id}`;
  let created = true;
  try {
    const existing = await readSakiSkill(id, true);
    if (existing.sourceType && existing.sourceType !== "operation-pack") {
      throw new OperationPackError(`Skill id「${id}」已被本地内容占用，拒绝覆盖。`, 409);
    }
    created = false;
  } catch (error) {
    if (error instanceof OperationPackError) throw error;
  }
  const skill: SakiSkillDetail = {
    id,
    name: parsed.name,
    description: parsed.description,
    enabled: true,
    sourceType: "operation-pack",
    sourceUrl,
    tags: [...new Set(["operations-pack", item.pack.category, ...parsed.tags])].slice(0, 16),
    content: parsed.content
  };
  const saved = await saveSakiSkill(skill);
  return {
    resourceId: item.resource.id,
    kind: item.resource.kind,
    target: "saki_skill",
    targetId: saved.id,
    name: saved.name,
    created
  };
}

function statusCodeFor(error: unknown): number {
  if (error instanceof OperationPackError) return error.statusCode;
  return 500;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "运维包操作失败。";
}

export async function registerOperationPackRoutes(app: FastifyInstance): Promise<void> {
  const registryHandler = async (request: { query: unknown }) => {
    const query = isRecord(request.query) ? request.query : {};
    return operationPackManager.getRegistry({ refresh: parseRefresh(query.refresh) });
  };

  // The compact path is intended for the templates/vertical-pack UI. Keep the
  // explicit /registry alias so integrations have a self-documenting endpoint.
  app.get("/api/operations-packs", { preHandler: requirePermission("template.view") }, registryHandler);
  app.get("/api/operations-packs/registry", { preHandler: requirePermission("template.view") }, registryHandler);

  app.get("/api/operations-packs/installed", { preHandler: requirePermission("template.view") }, async () => ({
    items: await operationPackManager.listInstalled()
  }));

  app.post(
    "/api/operations-packs/:id/install",
    { preHandler: requirePermission("template.create") },
    async (request, reply) => {
      const user = await loadCurrentUser(request.user.sub);
      if (!user) {
        reply.code(401).send({ message: "Unauthorized" });
        return;
      }
      const { id } = request.params as { id: string };
      let input: InstallOperationPackRequest = {};
      try {
        input = parseInstallRequest(request.body);
        const result = await operationPackManager.install(id, input);
        await writeAuditLog({
          request,
          userId: user.id,
          action: "operations_pack.install",
          resourceType: "operations_pack",
          resourceId: result.pack.id,
          payload: {
            version: result.pack.version,
            resourceIds: result.downloaded.map((resource) => resource.id),
            force: input.force ?? false,
            executed: false
          }
        });
        return {
          ...result,
          // Downloading a pack is never command execution or a mutation of an
          // instance. Activation/import is a deliberately separate user action.
          executed: false as const
        };
      } catch (error) {
        await writeAuditLog({
          request,
          userId: user.id,
          action: "operations_pack.install",
          resourceType: "operations_pack",
          resourceId: id || null,
          payload: { force: input?.force ?? false },
          result: "FAILURE"
        }).catch(() => undefined);
        reply.code(statusCodeFor(error)).send({ message: messageFor(error) });
      }
    }
  );

  app.post(
    "/api/operations-packs/:id/activate",
    { preHandler: requireAnyPermission(["template.create", "saki.skills"]) },
    async (request, reply) => {
      const user = await loadCurrentUser(request.user.sub);
      if (!user) {
        reply.code(401).send({ message: "Unauthorized" });
        return;
      }
      const { id } = request.params as { id: string };
      let input: ActivateOperationPackRequest | null = null;
      try {
        input = parseActivateRequest(request.body);
        const resources = await operationPackManager.readInstalledResources(id, input.resourceIds);
        const permissions = new Set(request.user.permissions ?? user.permissions);
        for (const item of resources) {
          const target = activationTarget(item.resource.kind);
          if (!target) {
            throw new OperationPackError(`资源「${item.resource.id}」只能保留为已校验缓存，不能导入到面板。`, 422);
          }
          if (target === "template" && !permissions.has("template.create")) {
            throw new OperationPackError("导入模板需要 template.create 权限。", 403);
          }
          if (target === "saki_skill" && !permissions.has("saki.skills")) {
            throw new OperationPackError("导入 Saki Skill 需要 saki.skills 权限。", 403);
          }
        }

        const activated: ActivatedOperationPackResource[] = [];
        for (const item of resources) {
          if (item.resource.kind === "template") {
            activated.push(await importTemplateResource(user.id, item));
          } else {
            activated.push(await importSkillResource(item));
          }
        }
        await writeAuditLog({
          request,
          userId: user.id,
          action: "operations_pack.activate",
          resourceType: "operations_pack",
          resourceId: resources[0]?.pack.id ?? id,
          payload: {
            version: resources[0]?.pack.version ?? null,
            activated: activated.map((item) => ({
              resourceId: item.resourceId,
              target: item.target,
              targetId: item.targetId,
              created: item.created
            })),
            executed: false
          }
        });
        return {
          packId: resources[0]?.pack.id ?? id,
          packVersion: resources[0]?.pack.version ?? "",
          activated,
          // Import writes only Panel metadata/Skill text. Pack scripts are not executed.
          executed: false as const
        };
      } catch (error) {
        await writeAuditLog({
          request,
          userId: user.id,
          action: "operations_pack.activate",
          resourceType: "operations_pack",
          resourceId: id || null,
          payload: { resourceIds: input?.resourceIds ?? [], executed: false },
          result: "FAILURE"
        }).catch(() => undefined);
        reply.code(statusCodeFor(error)).send({ message: messageFor(error) });
      }
    }
  );
}
