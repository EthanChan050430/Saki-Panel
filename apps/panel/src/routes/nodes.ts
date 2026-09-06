import type { FastifyInstance } from "fastify";
import type {
  ConnectNodeByKeyRequest,
  ConnectNodeByKeyResponse,
  CreateEnrollmentTokenRequest,
  CreateEnrollmentTokenResponse,
  CreateNodeRequest,
  DaemonNodeKeyPayload,
  ManagedNode,
  NodeEnrollmentTokenInfo,
  NodeJoinCommandResponse,
  NodeMetricSnapshot,
  RotateNodeTokenResponse,
  UpdateNodeRequest
} from "@webops/shared";
import type { Prisma } from "@prisma/client";
import { panelConfig } from "../config.js";
import { prisma } from "../db.js";
import { loadCurrentUser, requirePermission } from "../auth.js";
import { fetchDaemonStatus, testDaemonHealth } from "../daemon-client.js";
import { generateSecretToken, hashToken, tokenLast4 } from "../security.js";
import { writeAuditLog } from "../audit.js";
import { canAccessNode, nodeVisibilityWhere } from "../node-access.js";

function normalizeProtocol(value: unknown): "http" | "https" | null {
  return value === "http" || value === "https" ? value : null;
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isOffline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return true;
  const ageSeconds = (Date.now() - lastSeenAt.getTime()) / 1000;
  return ageSeconds > panelConfig.heartbeatOfflineSeconds;
}

function toMetricSnapshot(metric: {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  totalMemoryMb: number | null;
  usedMemoryMb: number | null;
  totalDiskGb: number | null;
  usedDiskGb: number | null;
  uptimeSeconds: number | null;
  loadAverage1m: number | null;
  createdAt: Date;
}): NodeMetricSnapshot {
  return {
    cpuUsage: metric.cpuUsage,
    memoryUsage: metric.memoryUsage,
    diskUsage: metric.diskUsage,
    totalMemoryMb: metric.totalMemoryMb ?? undefined,
    usedMemoryMb: metric.usedMemoryMb ?? undefined,
    totalDiskGb: metric.totalDiskGb ?? undefined,
    usedDiskGb: metric.usedDiskGb ?? undefined,
    uptimeSeconds: metric.uptimeSeconds ?? undefined,
    loadAverage1m: metric.loadAverage1m ?? undefined,
    createdAt: metric.createdAt.toISOString()
  };
}

export function toManagedNode(node: {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  status: "UNKNOWN" | "ONLINE" | "OFFLINE";
  os: string | null;
  arch: string | null;
  version: string | null;
  remarks: string | null;
  groupName: string | null;
  tags: string | null;
  tokenLast4?: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById?: string | null;
  createdBy?: { id: string; username: string; displayName: string } | null;
  metrics?: Array<Parameters<typeof toMetricSnapshot>[0]>;
}): ManagedNode {
  const derivedStatus = isOffline(node.lastSeenAt) ? "OFFLINE" : node.status;
  return {
    id: node.id,
    name: node.name,
    host: node.host,
    port: node.port,
    protocol: node.protocol,
    status: derivedStatus,
    os: node.os,
    arch: node.arch,
    version: node.version,
    remarks: node.remarks,
    groupName: node.groupName,
    tags: node.tags,
    tokenLast4: node.tokenLast4 ?? null,
    lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    latestMetric: node.metrics?.[0] ? toMetricSnapshot(node.metrics[0]) : null,
    createdById: node.createdById ?? null,
    createdBy: node.createdBy
      ? {
          id: node.createdBy.id,
          username: node.createdBy.username,
          displayName: node.createdBy.displayName
        }
      : null
  };
}

export async function registerNodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/nodes", { preHandler: requirePermission("node.view") }, async (request) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) return [];

    const query = request.query as { all?: string };
    const showAll = query.all === "true" || query.all === "1";
    const where = nodeVisibilityWhere(user, showAll);

    const nodes = await prisma.node.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: { id: true, username: true, displayName: true }
        },
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });
    return nodes.map(toManagedNode);
  });

  app.post("/api/nodes", { preHandler: requirePermission("node.create") }, async (request) => {
    const body = request.body as Partial<CreateNodeRequest>;
    const protocol = normalizeProtocol(body.protocol);
    if (
      !body.name?.trim() ||
      !body.host?.trim() ||
      !body.port ||
      !Number.isInteger(body.port) ||
      body.port <= 0 ||
      body.port > 65535 ||
      !protocol
    ) {
      throw Object.assign(new Error("name, host, port and protocol are required"), { statusCode: 400 });
    }

    const nodeToken = generateSecretToken();
    const node = await prisma.node.create({
      data: {
        name: body.name.trim(),
        host: body.host.trim(),
        port: body.port,
        protocol,
        remarks: normalizeOptionalText(body.remarks) ?? null,
        groupName: normalizeOptionalText(body.groupName) ?? null,
        tags: normalizeOptionalText(body.tags) ?? null,
        tokenHash: hashToken(nodeToken),
        tokenLast4: tokenLast4(nodeToken),
        status: "UNKNOWN",
        createdById: request.user.sub
      },
      include: {
        createdBy: {
          select: { id: true, username: true, displayName: true }
        },
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.create",
      resourceType: "node",
      resourceId: node.id,
      payload: { name: node.name, host: node.host, port: node.port }
    });

    return {
      node: toManagedNode(node),
      nodeToken
    };
  });

  app.put("/api/nodes/:id", { preHandler: requirePermission("node.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    const existing = await prisma.node.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, username: true, displayName: true }
        },
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });
    if (!existing || !canAccessNode(user, existing)) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    const body = request.body as UpdateNodeRequest;
    const protocol = body.protocol === undefined ? undefined : normalizeProtocol(body.protocol);
    if (body.protocol !== undefined && !protocol) {
      reply.code(400).send({ message: "protocol must be http or https" });
      return;
    }
    if (body.name !== undefined && !body.name.trim()) {
      reply.code(400).send({ message: "name cannot be empty" });
      return;
    }
    if (body.host !== undefined && !body.host.trim()) {
      reply.code(400).send({ message: "host cannot be empty" });
      return;
    }
    if (body.port !== undefined && (!Number.isInteger(body.port) || body.port <= 0 || body.port > 65535)) {
      reply.code(400).send({ message: "port must be an integer between 1 and 65535" });
      return;
    }

    const node = await prisma.node.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.host !== undefined ? { host: body.host.trim() } : {}),
        ...(body.port !== undefined ? { port: body.port } : {}),
        ...(protocol ? { protocol } : {}),
        ...(body.remarks !== undefined ? { remarks: normalizeOptionalText(body.remarks) ?? null } : {}),
        ...(body.groupName !== undefined ? { groupName: normalizeOptionalText(body.groupName) ?? null } : {}),
        ...(body.tags !== undefined ? { tags: normalizeOptionalText(body.tags) ?? null } : {})
      },
      include: {
        createdBy: {
          select: { id: true, username: true, displayName: true }
        },
        metrics: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.update",
      resourceType: "node",
      resourceId: node.id,
      payload: { name: node.name, host: node.host, port: node.port }
    });

    return toManagedNode(node);
  });

  app.delete("/api/nodes/:id", { preHandler: requirePermission("node.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    const node = await prisma.node.findUnique({ where: { id } });
    if (!node || !canAccessNode(user, node)) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    const instanceCount = await prisma.instance.count({ where: { nodeId: id } });
    if (instanceCount > 0) {
      reply.code(409).send({
        message: `Cannot delete this node because ${instanceCount} instance${instanceCount === 1 ? "" : "s"} still belong to it. Move or delete those instances first.`
      });
      return;
    }

    await prisma.node.delete({ where: { id } });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.delete",
      resourceType: "node",
      resourceId: id,
      payload: { name: node.name, host: node.host, port: node.port }
    });

    return { ok: true };
  });

  app.post("/api/nodes/:id/test", { preHandler: requirePermission("node.test") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    const node = await prisma.node.findUnique({ where: { id } });
    if (!node || !canAccessNode(user, node)) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    try {
      const response = await testDaemonHealth(node);
      const ok = response.ok;
      await prisma.node.update({
        where: { id: node.id },
        data: {
          status: ok ? "ONLINE" : "OFFLINE",
          lastSeenAt: ok ? new Date() : node.lastSeenAt
        }
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "node.test",
        resourceType: "node",
        resourceId: node.id,
        result: ok ? "SUCCESS" : "FAILURE",
        payload: response.error ? { error: response.error } : undefined
      });
      return { ok, statusCode: response.statusCode, error: response.error };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      await prisma.node.update({
        where: { id: node.id },
        data: { status: "OFFLINE" }
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "node.test",
        resourceType: "node",
        resourceId: node.id,
        payload: { error: errMsg },
        result: "FAILURE"
      });
      return { ok: false, error: errMsg };
    }
  });
  // Enrollment Tokens (Join Tokens)
  app.get("/api/nodes/enrollment-tokens", { preHandler: requirePermission("node.view") }, async (request): Promise<NodeEnrollmentTokenInfo[]> => {
    const user = await loadCurrentUser(request.user.sub);
    const where: Prisma.NodeEnrollmentTokenWhereInput = user?.isSuperAdmin
      ? {
          OR: [
            { createdById: request.user.sub },
            { createdById: null }
          ]
        }
      : { createdById: request.user.sub };
    const tokens = await prisma.nodeEnrollmentToken.findMany({
      where,
      orderBy: { createdAt: "desc" }
    });
    const now = Date.now();
    return tokens.map((t) => ({
      id: t.id,
      tokenLast4: t.tokenLast4,
      namePrefix: t.namePrefix,
      groupName: t.groupName,
      tags: t.tags,
      maxUsage: t.maxUsage,
      usedCount: t.usedCount,
      expiresAt: t.expiresAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      isExpired: t.expiresAt.getTime() < now || t.usedCount >= t.maxUsage,
      createdById: t.createdById
    }));
  });

  app.post("/api/nodes/enrollment-tokens", { preHandler: requirePermission("node.create") }, async (request): Promise<CreateEnrollmentTokenResponse> => {
    const body = request.body as Partial<CreateEnrollmentTokenRequest>;
    const rawToken = generateSecretToken();
    const expiresInMinutes = body.expiresInMinutes && body.expiresInMinutes > 0 ? body.expiresInMinutes : 60;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const maxUsage = body.maxUsage && body.maxUsage > 0 ? body.maxUsage : 1;

    const created = await prisma.nodeEnrollmentToken.create({
      data: {
        tokenHash: hashToken(rawToken),
        tokenLast4: tokenLast4(rawToken),
        namePrefix: normalizeOptionalText(body.namePrefix) ?? null,
        groupName: normalizeOptionalText(body.groupName) ?? null,
        tags: normalizeOptionalText(body.tags) ?? null,
        maxUsage,
        usedCount: 0,
        expiresAt,
        createdById: request.user.sub
      }
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.enrollment_create",
      resourceType: "node",
      resourceId: created.id,
      payload: { maxUsage, expiresInMinutes }
    });

    return {
      token: rawToken,
      tokenInfo: {
        id: created.id,
        tokenLast4: created.tokenLast4,
        namePrefix: created.namePrefix,
        groupName: created.groupName,
        tags: created.tags,
        maxUsage: created.maxUsage,
        usedCount: created.usedCount,
        expiresAt: created.expiresAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
        isExpired: false,
        createdById: created.createdById
      }
    };
  });

  app.delete("/api/nodes/enrollment-tokens/:id", { preHandler: requirePermission("node.create") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await loadCurrentUser(request.user.sub);
    const tokenRecord = await prisma.nodeEnrollmentToken.findUnique({ where: { id } });
    if (!tokenRecord || (tokenRecord.createdById ? tokenRecord.createdById !== request.user.sub : !user?.isSuperAdmin)) {
      reply.code(404).send({ message: "Token not found" });
      return;
    }

    await prisma.nodeEnrollmentToken.deleteMany({ where: { id } });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.enrollment_delete",
      resourceType: "node",
      resourceId: id
    });
    return { ok: true };
  });

  // Node Secret Rotation & Join Commands
  app.post("/api/nodes/:id/token/rotate", { preHandler: requirePermission("node.update") }, async (request, reply): Promise<RotateNodeTokenResponse | void> => {
    const { id } = request.params as { id: string };
    const user = await loadCurrentUser(request.user.sub);
    const node = await prisma.node.findUnique({ where: { id } });
    if (!node || !user || !canAccessNode(user, node)) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    const newToken = generateSecretToken();
    await prisma.node.update({
      where: { id },
      data: {
        tokenHash: hashToken(newToken),
        tokenLast4: tokenLast4(newToken)
      }
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.token_rotate",
      resourceType: "node",
      resourceId: id,
      payload: { nodeName: node.name }
    });

    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeToken: newToken
    };
  });

  app.get("/api/nodes/:id/join-command", { preHandler: requirePermission("node.view") }, async (request, reply): Promise<NodeJoinCommandResponse | void> => {
    const { id } = request.params as { id: string };
    const user = await loadCurrentUser(request.user.sub);
    const node = await prisma.node.findUnique({ where: { id } });
    if (!node || !user || !canAccessNode(user, node)) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    const defaultUrl = panelConfig.publicUrl || `http://${request.hostname}:${panelConfig.port}`;
    const tempToken = generateSecretToken();
    await prisma.nodeEnrollmentToken.create({
      data: {
        tokenHash: hashToken(tempToken),
        tokenLast4: tokenLast4(tempToken),
        namePrefix: node.name,
        groupName: node.groupName,
        tags: node.tags,
        maxUsage: 1,
        usedCount: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdById: request.user.sub
      }
    });

    const linuxCommand = `curl -fsSL "${defaultUrl}/api/nodes/join.sh?token=${tempToken}&name=${encodeURIComponent(node.name)}&port=${node.port}" | bash`;
    const windowsCommand = `irm "${defaultUrl}/api/nodes/join.ps1?token=${tempToken}&name=${encodeURIComponent(node.name)}&port=${node.port}" | iex`;
    const dockerCommand = `docker run -d --name saki-daemon --restart always --net=host -e DAEMON_PANEL_URL="${defaultUrl}" -e DAEMON_REGISTRATION_TOKEN="${tempToken}" -e DAEMON_NAME="${node.name}" -e DAEMON_PORT=${node.port} ghcr.io/saki-panel/daemon:latest`;

    return {
      nodeId: node.id,
      panelUrl: defaultUrl,
      token: tempToken,
      linuxCommand,
      windowsCommand,
      dockerCommand
    };
  });

  // Connect Node By Key (Daemon Pairing Key)
  app.post("/api/nodes/connect-key", { preHandler: requirePermission("node.create") }, async (request, reply): Promise<ConnectNodeByKeyResponse | void> => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    const body = request.body as ConnectNodeByKeyRequest;
    if (!body?.key?.trim()) {
      reply.code(400).send({ message: "请提供节点机器专属密钥 (Node Key)" });
      return;
    }

    let payload: DaemonNodeKeyPayload;
    try {
      const rawKey = body.key.trim();
      let b64 = rawKey;
      if (b64.startsWith("saki_node_")) {
        b64 = b64.slice("saki_node_".length);
      }
      const jsonStr = Buffer.from(b64, "base64url").toString("utf8");
      payload = JSON.parse(jsonStr) as DaemonNodeKeyPayload;
      if (!payload.host || !payload.port || !payload.token) {
        throw new Error("密钥信息不完整");
      }
    } catch {
      reply.code(400).send({ message: "无效的节点密钥格式，请确保复制了完整的 saki_node_ 密钥" });
      return;
    }

    // Allow hostOverride and portOverride in case the machines are on different networks / cross-internet
    const effectiveHost = body.hostOverride?.trim() || payload.host;
    const effectivePort = body.portOverride || payload.port;

    // Ping the daemon to ensure it is actually running and credentials match!
    const testResult = await fetchDaemonStatus({
      id: payload.nodeId || "temp",
      protocol: payload.protocol || "http",
      host: effectiveHost,
      port: effectivePort,
      tokenHash: hashToken(payload.token)
    }, 6000);

    if (!testResult.ok) {
      let diagnosticHelp = "";
      const errLower = (testResult.error || "").toLowerCase();
      if (errLower.includes("econnrefused")) {
        diagnosticHelp = "（连接被拒绝：目标机器可能未启动 saki-daemon，或云服务器防火墙/安全组未放行 5480 端口）";
      } else if (errLower.includes("etimedout") || errLower.includes("timed out")) {
        diagnosticHelp = "（连接超时：请确认目标机器公网 IP 是否正确，以及安全组入方向是否放行对应端口）";
      } else if (errLower.includes("enotfound")) {
        diagnosticHelp = "（无法解析域名或主机名：请检查 IP 或域名拼写）";
      }
      reply.code(400).send({
        message: `无法连接到目标机器 Daemon (${effectiveHost}:${effectivePort})：${testResult.error || "连接失败"}${diagnosticHelp}。若跨服务器/跨公网连接，请在“连接 IP / 域名”中填写该机器的公网 IP。`
      });
      return;
    }

    const nodeStatusData = testResult.statusData ?? {};
    const nodeName = body.name?.trim() || payload.name?.trim() || `Node-${effectiveHost}`;
    const tokenHashValue = hashToken(payload.token);
    const tokenLast4Value = tokenLast4(payload.token);

    // Check if node already exists for this host:port or nodeId
    let existingNode = payload.nodeId ? await prisma.node.findUnique({ where: { id: payload.nodeId } }) : null;
    if (!existingNode) {
      existingNode = await prisma.node.findFirst({
        where: { host: effectiveHost, port: effectivePort }
      });
    }

    if (existingNode && existingNode.createdById && existingNode.createdById !== request.user.sub) {
      reply.code(409).send({
        message: `该节点已由其他账号（${existingNode.name}）连接绑定。每个账号的节点面板完全隔离，如需重新绑定请先在原账号移除该节点。`
      });
      return;
    }

    let savedNode;
    if (existingNode) {
      savedNode = await prisma.node.update({
        where: { id: existingNode.id },
        data: {
          name: nodeName,
          host: effectiveHost,
          port: effectivePort,
          protocol: testResult.effectiveProtocol,
          tokenHash: tokenHashValue,
          tokenLast4: tokenLast4Value,
          status: "ONLINE",
          lastSeenAt: new Date(),
          createdById: request.user.sub,
          groupName: normalizeOptionalText(body.groupName) ?? existingNode.groupName,
          tags: normalizeOptionalText(body.tags) ?? existingNode.tags,
          os: nodeStatusData.os ?? existingNode.os,
          arch: nodeStatusData.arch ?? existingNode.arch,
          version: nodeStatusData.version ?? existingNode.version
        },
        include: {
          createdBy: {
            select: { id: true, username: true, displayName: true }
          },
          metrics: {
            take: 1,
            orderBy: { createdAt: "desc" }
          }
        }
      });
    } else {
      const createData: Prisma.NodeUncheckedCreateInput = {
        name: nodeName,
        host: effectiveHost,
        port: effectivePort,
        protocol: testResult.effectiveProtocol,
        tokenHash: tokenHashValue,
        tokenLast4: tokenLast4Value,
        status: "ONLINE",
        lastSeenAt: new Date(),
        createdById: request.user.sub,
        groupName: normalizeOptionalText(body.groupName) ?? null,
        tags: normalizeOptionalText(body.tags) ?? null,
        os: nodeStatusData.os ?? null,
        arch: nodeStatusData.arch ?? null,
        version: nodeStatusData.version ?? null
      };
      if (payload.nodeId) {
        createData.id = payload.nodeId;
      }
      savedNode = await prisma.node.create({
        data: createData,
        include: {
          createdBy: {
            select: { id: true, username: true, displayName: true }
          },
          metrics: {
            take: 1,
            orderBy: { createdAt: "desc" }
          }
        }
      });
    }

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "node.connect_by_key",
      resourceType: "node",
      resourceId: savedNode.id,
      payload: { nodeName: savedNode.name, host: savedNode.host, port: savedNode.port }
    });

    return {
      ok: true,
      node: toManagedNode(savedNode)
    };
  });
}
