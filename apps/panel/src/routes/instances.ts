import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import type {
  CreateInstanceRequest,
  InstanceAssignee,
  InstanceActionResponse,
  InstanceCommandResponse,
  InstanceFileEntry,
  InstanceLogsResponse,
  InstanceProxyConfig,
  InstanceStatus,
  InstanceType,
  ManagedInstance,
  RestartPolicy,
  SuggestInstanceStartCommandRequest,
  SuggestInstanceStartCommandResponse,
  SyncInstancesByUserKeyRequest,
  SyncInstancesByUserKeyResponse,
  RemoteNodeUserSummary,
  UpdateInstanceRequest
} from "@webops/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { loadCurrentUser, requireAnyPermission, requirePermission } from "../auth.js";
import { canAccessNode } from "../node-access.js";
import {
  classifyInstanceUser,
  instanceAssignedUserIds,
  instanceAssignedUserSummaries,
  instanceAccessInclude,
  listInstanceAssignees,
  listVisibleInstances,
  loadVisibleInstance,
  resolveAssignableUserId,
  resolveAssignableUserIds,
  type InstanceWithAccess
} from "../instance-access.js";
import { writeAuditLog } from "../audit.js";
import { findDangerousCommandReason, hashToken } from "../security.js";
import {
  applyDaemonClashSubscription,
  createDaemonInstanceShell,
  discoverDaemonDatabases,
  executeDaemonDatabaseQuery,
  deleteDaemonInstanceShell,
  fetchDaemonClashSubscription,
  killDaemonInstance,
  listDaemonInstanceFiles,
  listDaemonInstanceShells,
  readDaemonInstanceFile,
  readDaemonInstanceLogs,
  readDaemonInstanceStatus,
  restartDaemonInstance,
  runDaemonInstanceCommand,
  sendDaemonShellInput,
  startDaemonInstance,
  stopDaemonClashSubscription,
  stopDaemonInstance,
  type DaemonInstanceSpec
} from "../daemon-client.js";
import { fetchClashSubscriptionProxies } from "../clash-subscription.js";

function parseProxyConfig(raw: string | null | undefined): InstanceProxyConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InstanceProxyConfig>;
    if (typeof parsed !== "object" || !parsed) return null;
    const proxies = Array.isArray(parsed.proxies)
      ? parsed.proxies
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const name = String(item.name || "").trim();
            if (!name) return null;
            const summary: { name: string; type: string; server?: string; port?: number } = {
              name,
              type: String(item.type || "unknown")
            };
            if (item.server) summary.server = String(item.server);
            if (Number(item.port)) summary.port = Number(item.port);
            return summary;
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : null;
    return {
      enabled: Boolean(parsed.enabled),
      type: parsed.type === "socks5" ? "socks5" : parsed.type === "https" ? "https" : "http",
      server: String(parsed.server || "").trim(),
      port: Number(parsed.port) || 7890,
      username: parsed.username ? String(parsed.username).trim() : null,
      password: parsed.password ? String(parsed.password) : null,
      bypass: parsed.bypass ? String(parsed.bypass).trim() : null,
      mode: parsed.mode === "subscription" ? "subscription" : "manual",
      subscriptionUrl: parsed.subscriptionUrl ? String(parsed.subscriptionUrl).trim() : null,
      selectedProxy: parsed.selectedProxy ? String(parsed.selectedProxy).trim() : null,
      proxies
    };
  } catch {
    return null;
  }
}

function testTcpConnectivity(
  host: string,
  port: number,
  timeoutMs = 2500
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      const latencyMs = Date.now() - startTime;
      socket.destroy();
      resolve({ ok: true, latencyMs });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, error: `连接超时 (${timeoutMs}ms)` });
    });

    socket.on("error", (err) => {
      socket.destroy();
      resolve({ ok: false, error: err.message || "连接被拒绝" });
    });

    socket.connect(port, host);
  });
}

function toManagedInstance(instance: InstanceWithAccess): ManagedInstance {
  const assignees = instanceAssignedUserSummaries(instance);
  const primaryAssignee = assignees[0] ?? null;
  return {
    id: instance.id,
    nodeId: instance.nodeId,
    nodeName: instance.node.name,
    name: instance.name,
    type: instance.type as InstanceType,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    stopCommand: instance.stopCommand,
    status: instance.status,
    autoStart: instance.autoStart,
    restartPolicy: instance.restartPolicy as RestartPolicy,
    restartMaxRetries: instance.restartMaxRetries,
    runAsUser: instance.runAsUser,
    memoryLimit: instance.memoryLimit,
    cpuLimit: instance.cpuLimit,
    description: instance.description,
    proxyConfig: parseProxyConfig((instance as any).proxyConfig),
    createdByUserId: instance.createdById,
    createdByUsername: instance.createdBy?.username ?? null,
    createdByDisplayName: instance.createdBy?.displayName ?? null,
    createdByRole: instance.createdBy ? classifyInstanceUser(instance.createdBy) : null,
    assignedToUserId: primaryAssignee?.userId ?? null,
    assignedToUsername: primaryAssignee?.username ?? null,
    assignedToDisplayName: primaryAssignee?.displayName ?? null,
    assignedToRole: primaryAssignee?.role ?? null,
    assignees,
    lastStartedAt: instance.lastStartedAt?.toISOString() ?? null,
    lastStoppedAt: instance.lastStoppedAt?.toISOString() ?? null,
    lastExitCode: instance.lastExitCode,
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString()
  };
}

async function loadInstance(request: FastifyRequest, id: string): Promise<InstanceWithAccess | null> {
  return loadVisibleInstance(request.user.sub, id);
}

function specFromInstance(instance: InstanceWithAccess): DaemonInstanceSpec {
  return {
    id: instance.id,
    name: instance.name,
    type: instance.type,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    stopCommand: instance.stopCommand,
    restartPolicy: instance.restartPolicy as RestartPolicy,
    restartMaxRetries: instance.restartMaxRetries,
    proxy: parseProxyConfig((instance as any).proxyConfig)
  };
}

function normalizeRestartPolicy(value: unknown, fallback: RestartPolicy): RestartPolicy {
  if (value === "never" || value === "on_failure" || value === "always" || value === "fixed_interval") {
    return value;
  }
  return fallback;
}

function normalizeRetryCount(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.floor(value), 99));
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function statusPatch(status: InstanceStatus, exitCode?: number | null): Prisma.InstanceUpdateInput {
  const now = new Date();
  const data: Prisma.InstanceUpdateInput = {
    status,
    lastExitCode: exitCode ?? null
  };
  if (status === "RUNNING") {
    data.lastStartedAt = now;
  }
  if (status === "STOPPED" || status === "CRASHED") {
    data.lastStoppedAt = now;
  }
  return data;
}

const startCommandProbeInstanceId = "start-command-probe";
const rootProbeFileLimit = 200;

interface StartCommandCandidate {
  startCommand: string;
  confidence: SuggestInstanceStartCommandResponse["confidence"];
  reason: string;
  detected: string[];
}

interface DirectoryProbe {
  entries: InstanceFileEntry[];
  entryByName: Map<string, InstanceFileEntry>;
  files: Map<string, string>;
  isWindows: boolean;
  workingDirectory: string;
}

function isWindowsNode(node: { os?: string | null }): boolean {
  return /\bwin(?:dows|32)?\b/i.test(node.os ?? "");
}

function entryKey(name: string): string {
  return name.toLowerCase();
}

function makeEntryMap(entries: InstanceFileEntry[]): Map<string, InstanceFileEntry> {
  return new Map(entries.map((entry) => [entryKey(entry.name), entry]));
}

function findEntry(probe: DirectoryProbe, name: string): InstanceFileEntry | null {
  return probe.entryByName.get(entryKey(name)) ?? null;
}

function hasFile(probe: DirectoryProbe, name: string): boolean {
  return findEntry(probe, name)?.type === "file";
}

function hasDirectory(probe: DirectoryProbe, name: string): boolean {
  return findEntry(probe, name)?.type === "directory";
}

function firstFileByName(probe: DirectoryProbe, names: string[]): InstanceFileEntry | null {
  for (const name of names) {
    const entry = findEntry(probe, name);
    if (entry?.type === "file") return entry;
  }
  return null;
}

function firstFileByExtension(probe: DirectoryProbe, extension: string, reject: RegExp[] = []): InstanceFileEntry | null {
  const lowerExtension = extension.toLowerCase();
  return (
    probe.entries.find((entry) => {
      const lowerName = entry.name.toLowerCase();
      return entry.type === "file" && lowerName.endsWith(lowerExtension) && !reject.some((pattern) => pattern.test(lowerName));
    }) ?? null
  );
}

function commandPath(value: string): string {
  return /^[a-z0-9_./@:-]+$/i.test(value) ? value : JSON.stringify(value);
}

function moduleNameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");
}

function safeDockerTag(workingDirectory: string): string {
  const rawName = workingDirectory.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || "saki-app";
  const normalized = rawName.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "saki-app";
}

function preferredPackageManager(probe: DirectoryProbe): "npm" | "pnpm" | "yarn" | "bun" {
  if (hasFile(probe, "pnpm-lock.yaml")) return "pnpm";
  if (hasFile(probe, "yarn.lock")) return "yarn";
  if (hasFile(probe, "bun.lockb") || hasFile(probe, "bun.lock")) return "bun";
  return "npm";
}

function packageRunCommand(packageManager: "npm" | "pnpm" | "yarn" | "bun", script: string): string {
  if (packageManager === "npm") return script === "start" ? "npm start" : `npm run ${script}`;
  if (packageManager === "yarn") return `yarn ${script}`;
  if (packageManager === "bun") return `bun run ${script}`;
  return `pnpm run ${script}`;
}

function packageJsonCandidate(probe: DirectoryProbe): StartCommandCandidate | null {
  const packageJson = probe.files.get("package.json");
  if (!packageJson) return null;

  try {
    const parsed = JSON.parse(packageJson) as {
      main?: unknown;
      scripts?: unknown;
      dependencies?: unknown;
      devDependencies?: unknown;
    };
    const scripts =
      typeof parsed.scripts === "object" && parsed.scripts !== null
        ? (parsed.scripts as Record<string, unknown>)
        : {};
    const manager = preferredPackageManager(probe);
    const scriptPreference = ["start", "serve", "dev", "preview"];
    for (const script of scriptPreference) {
      if (typeof scripts[script] === "string" && String(scripts[script]).trim()) {
        return {
          startCommand: packageRunCommand(manager, script),
          confidence: script === "start" ? "high" : "medium",
          reason: `Detected package.json script "${script}".`,
          detected: ["package.json", `${manager} scripts.${script}`]
        };
      }
    }

    const dependencies = {
      ...(typeof parsed.dependencies === "object" && parsed.dependencies !== null
        ? (parsed.dependencies as Record<string, unknown>)
        : {}),
      ...(typeof parsed.devDependencies === "object" && parsed.devDependencies !== null
        ? (parsed.devDependencies as Record<string, unknown>)
        : {})
    };
    if ("next" in dependencies) {
      return {
        startCommand: packageRunCommand(manager, "dev"),
        confidence: "medium",
        reason: "Detected Next.js dependency but no start script.",
        detected: ["package.json", "next"]
      };
    }
    if ("vite" in dependencies) {
      return {
        startCommand: packageRunCommand(manager, "dev"),
        confidence: "medium",
        reason: "Detected Vite dependency but no start script.",
        detected: ["package.json", "vite"]
      };
    }
    if (typeof parsed.main === "string" && parsed.main.trim()) {
      return {
        startCommand: `node ${commandPath(parsed.main.trim())}`,
        confidence: "medium",
        reason: "Detected package.json main entry.",
        detected: ["package.json", `main=${parsed.main.trim()}`]
      };
    }
  } catch {
    return null;
  }

  const entry = firstFileByName(probe, ["server.js", "app.js", "index.js", "main.js"]);
  if (!entry) return null;
  return {
    startCommand: `node ${commandPath(entry.name)}`,
    confidence: "medium",
    reason: "Detected JavaScript entry file beside package.json.",
    detected: ["package.json", entry.name]
  };
}

function dockerCandidate(probe: DirectoryProbe): StartCommandCandidate | null {
  const compose = firstFileByName(probe, [
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml"
  ]);
  if (compose) {
    return {
      startCommand: "docker compose up",
      confidence: "high",
      reason: `Detected ${compose.name}.`,
      detected: [compose.name]
    };
  }
  if (!hasFile(probe, "Dockerfile")) return null;
  const tag = safeDockerTag(probe.workingDirectory);
  return {
    startCommand: `docker build -t ${tag} . && docker run --rm ${tag}`,
    confidence: "medium",
    reason: "Detected Dockerfile.",
    detected: ["Dockerfile"]
  };
}

function pythonCandidate(probe: DirectoryProbe): StartCommandCandidate | null {
  if (hasFile(probe, "manage.py")) {
    return {
      startCommand: "python manage.py runserver 0.0.0.0:8000",
      confidence: "high",
      reason: "Detected Django manage.py.",
      detected: ["manage.py"]
    };
  }

  const pythonEntry = firstFileByName(probe, ["main.py", "app.py", "server.py", "run.py"]);
  const requirements = probe.files.get("requirements.txt") ?? "";
  if (pythonEntry) {
    const source = probe.files.get(pythonEntry.name) ?? "";
    const moduleName = moduleNameFromFile(pythonEntry.name);
    if (/\bFastAPI\s*\(|from\s+fastapi\s+import\s+FastAPI/i.test(source) || /\bfastapi\b/i.test(requirements)) {
      return {
        startCommand: `uvicorn ${moduleName}:app --host 0.0.0.0 --port 8000`,
        confidence: /\bFastAPI\s*\(|from\s+fastapi\s+import\s+FastAPI/i.test(source) ? "high" : "medium",
        reason: `Detected FastAPI signals in ${pythonEntry.name}.`,
        detected: [pythonEntry.name, requirements ? "requirements.txt" : ""].filter(Boolean)
      };
    }
    if (/\bstreamlit\b/i.test(requirements)) {
      return {
        startCommand: `streamlit run ${commandPath(pythonEntry.name)}`,
        confidence: "medium",
        reason: "Detected Streamlit dependency.",
        detected: [pythonEntry.name, "requirements.txt"]
      };
    }
    if (/\bFlask\s*\(|from\s+flask\s+import/i.test(source)) {
      const command = /\bapp\.run\s*\(/i.test(source)
        ? `python ${commandPath(pythonEntry.name)}`
        : `flask --app ${moduleName} run --host 0.0.0.0 --port 5000`;
      return {
        startCommand: command,
        confidence: "high",
        reason: `Detected Flask signals in ${pythonEntry.name}.`,
        detected: [pythonEntry.name]
      };
    }
    return {
      startCommand: `python ${commandPath(pythonEntry.name)}`,
      confidence: "medium",
      reason: `Detected Python entry file ${pythonEntry.name}.`,
      detected: [pythonEntry.name]
    };
  }

  const anyPythonFile = firstFileByExtension(probe, ".py");
  if (!anyPythonFile) return null;
  return {
    startCommand: `python ${commandPath(anyPythonFile.name)}`,
    confidence: "low",
    reason: `Detected Python file ${anyPythonFile.name}.`,
    detected: [anyPythonFile.name]
  };
}

function javaCandidate(probe: DirectoryProbe): StartCommandCandidate | null {
  const jar = firstFileByExtension(probe, ".jar", [/sources\.jar$/, /javadoc\.jar$/, /original-/]);
  if (jar && (hasFile(probe, "server.properties") || hasFile(probe, "eula.txt"))) {
    return {
      startCommand: `java -Xms1G -Xmx2G -jar ${commandPath(jar.name)} nogui`,
      confidence: "high",
      reason: "Detected Minecraft server files and a JAR.",
      detected: [jar.name, hasFile(probe, "server.properties") ? "server.properties" : "eula.txt"]
    };
  }
  if (jar) {
    return {
      startCommand: `java -jar ${commandPath(jar.name)}`,
      confidence: "high",
      reason: `Detected executable JAR ${jar.name}.`,
      detected: [jar.name]
    };
  }
  if (hasFile(probe, "pom.xml")) {
    const wrapper = probe.isWindows && hasFile(probe, "mvnw.cmd") ? "mvnw.cmd" : hasFile(probe, "mvnw") ? "./mvnw" : "mvn";
    return {
      startCommand: `${wrapper} spring-boot:run`,
      confidence: "medium",
      reason: "Detected Maven project.",
      detected: ["pom.xml"]
    };
  }
  if (hasFile(probe, "build.gradle") || hasFile(probe, "build.gradle.kts")) {
    const wrapper = probe.isWindows && hasFile(probe, "gradlew.bat") ? "gradlew.bat" : hasFile(probe, "gradlew") ? "./gradlew" : "gradle";
    return {
      startCommand: `${wrapper} bootRun`,
      confidence: "medium",
      reason: "Detected Gradle project.",
      detected: [hasFile(probe, "build.gradle.kts") ? "build.gradle.kts" : "build.gradle"]
    };
  }
  return null;
}

function scriptCandidate(probe: DirectoryProbe): StartCommandCandidate | null {
  const script = firstFileByName(probe, probe.isWindows ? ["start.bat", "start.cmd", "run.bat", "run.cmd"] : ["start.sh", "run.sh"]);
  if (!script) return null;
  return {
    startCommand: probe.isWindows ? commandPath(script.name) : `bash ${commandPath(script.name)}`,
    confidence: "medium",
    reason: `Detected startup script ${script.name}.`,
    detected: [script.name]
  };
}

function otherRuntimeCandidate(probe: DirectoryProbe): StartCommandCandidate | null {
  if (hasFile(probe, "go.mod")) {
    return {
      startCommand: "go run .",
      confidence: "medium",
      reason: "Detected Go module.",
      detected: ["go.mod"]
    };
  }
  if (hasFile(probe, "Cargo.toml")) {
    return {
      startCommand: "cargo run --release",
      confidence: "medium",
      reason: "Detected Rust Cargo project.",
      detected: ["Cargo.toml"]
    };
  }
  if (hasFile(probe, "artisan")) {
    return {
      startCommand: "php artisan serve --host=0.0.0.0 --port=8000",
      confidence: "medium",
      reason: "Detected Laravel artisan file.",
      detected: ["artisan"]
    };
  }
  const csproj = firstFileByExtension(probe, ".csproj");
  if (csproj) {
    return {
      startCommand: "dotnet run --urls http://0.0.0.0:5000",
      confidence: "medium",
      reason: `Detected .NET project ${csproj.name}.`,
      detected: [csproj.name]
    };
  }
  return null;
}

async function readProbeFile(
  node: Parameters<typeof listDaemonInstanceFiles>[0],
  workingDirectory: string,
  fileName: string
): Promise<string | null> {
  try {
    const file = await readDaemonInstanceFile(node, startCommandProbeInstanceId, workingDirectory, fileName);
    return file.content;
  } catch {
    return null;
  }
}

async function buildDirectoryProbe(
  node: Parameters<typeof listDaemonInstanceFiles>[0],
  workingDirectory: string,
  isWindows: boolean
): Promise<DirectoryProbe> {
  const listing = await listDaemonInstanceFiles(node, startCommandProbeInstanceId, workingDirectory, "", {
    limit: rootProbeFileLimit
  });
  const entryByName = makeEntryMap(listing.entries);
  const probe: DirectoryProbe = {
    entries: listing.entries,
    entryByName,
    files: new Map(),
    isWindows,
    workingDirectory
  };
  const interestingFiles = [
    "package.json",
    "requirements.txt",
    "main.py",
    "app.py",
    "server.py",
    "run.py"
  ].filter((fileName) => hasFile(probe, fileName));
  const filePairs = await Promise.all(
    interestingFiles.map(async (fileName) => [fileName, await readProbeFile(node, workingDirectory, fileName)] as const)
  );
  for (const [fileName, content] of filePairs) {
    if (content !== null) probe.files.set(fileName, content);
  }
  return probe;
}

function inferStartCommand(probe: DirectoryProbe): SuggestInstanceStartCommandResponse {
  const candidates = [
    packageJsonCandidate(probe),
    dockerCandidate(probe),
    pythonCandidate(probe),
    javaCandidate(probe),
    otherRuntimeCandidate(probe),
    scriptCandidate(probe)
  ].filter((candidate): candidate is StartCommandCandidate => Boolean(candidate));

  const best = candidates[0];
  if (best) {
    return best;
  }

  const detected = probe.entries.slice(0, 12).map((entry) => entry.name);
  return {
    startCommand: "",
    confidence: "low",
    reason: probe.entries.length
      ? "No known startup pattern was detected in the directory root."
      : "The directory is empty or no readable files were found.",
    detected
  };
}

async function suggestStartCommandForDirectory(
  node: Parameters<typeof listDaemonInstanceFiles>[0],
  workingDirectory: string
): Promise<SuggestInstanceStartCommandResponse> {
  const probe = await buildDirectoryProbe(node, workingDirectory, isWindowsNode(node));
  return inferStartCommand(probe);
}

async function updateStatus(id: string, status: InstanceStatus, exitCode?: number | null): Promise<InstanceWithAccess> {
  return prisma.instance.update({
    where: { id },
    data: statusPatch(status, exitCode),
    include: instanceAccessInclude
  });
}

const volatileStatuses = new Set<InstanceStatus>(["STARTING", "RUNNING", "STOPPING", "UNKNOWN"]);

function normalizeListedStatus(instance: InstanceWithAccess, status: InstanceStatus): InstanceStatus {
  if (status === "CREATED" && instance.status !== "CREATED") {
    return "STOPPED";
  }
  return status;
}

async function refreshVolatileStatus(instance: InstanceWithAccess): Promise<InstanceWithAccess> {
  if (!volatileStatuses.has(instance.status)) {
    return instance;
  }

  try {
    const state = await readDaemonInstanceStatus(instance.node, instance.id);
    const nextStatus = normalizeListedStatus(instance, state.status);
    const nextExitCode = state.exitCode ?? null;
    if (nextStatus === instance.status && nextExitCode === (instance.lastExitCode ?? null)) {
      return instance;
    }
    return updateStatus(instance.id, nextStatus, nextExitCode);
  } catch {
    if (instance.status === "UNKNOWN") {
      return instance;
    }
    return updateStatus(instance.id, "UNKNOWN", instance.lastExitCode);
  }
}

async function sendNotFound(reply: FastifyReply): Promise<void> {
  reply.code(404).send({ message: "Instance not found" });
}

async function runInstanceAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: "start" | "stop" | "restart" | "kill"
) {
  const { id } = request.params as { id: string };
  const instance = await loadInstance(request, id);
  if (!instance) {
    await sendNotFound(reply);
    return;
  }

  try {
    if (action === "start") {
      await prisma.instance.update({ where: { id }, data: { status: "STARTING" } });
      const state = await startDaemonInstance(instance.node, specFromInstance(instance));
      const updated = await updateStatus(id, state.status, state.exitCode);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.start",
        resourceType: "instance",
        resourceId: id
      });
      return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
    }

    if (action === "stop") {
      await prisma.instance.update({ where: { id }, data: { status: "STOPPING" } });
      const state = await stopDaemonInstance(instance.node, { id, stopCommand: instance.stopCommand });
      const updated = await updateStatus(id, state.status, state.exitCode);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.stop",
        resourceType: "instance",
        resourceId: id
      });
      return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
    }

    if (action === "restart") {
      await prisma.instance.update({ where: { id }, data: { status: "STOPPING" } });
      const state = await restartDaemonInstance(instance.node, specFromInstance(instance));
      const updated = await updateStatus(id, state.status, state.exitCode);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.restart",
        resourceType: "instance",
        resourceId: id
      });
      return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
    }

    await prisma.instance.update({ where: { id }, data: { status: "STOPPING" } });
    const state = await killDaemonInstance(instance.node, id);
    const updated = await updateStatus(id, state.status, state.exitCode);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.kill",
      resourceType: "instance",
      resourceId: id
    });
    return { instance: toManagedInstance(updated) } satisfies InstanceActionResponse;
  } catch (error) {
    await prisma.instance.update({
      where: { id },
      data: { status: "UNKNOWN" }
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: `instance.${action}`,
      resourceType: "instance",
      resourceId: id,
      payload: { error: error instanceof Error ? error.message : "Unknown error" },
      result: "FAILURE"
    });
    reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
  }
}


async function fetchRemoteUserInstances(
  remoteBaseUrl: string,
  userKey: string,
  timeoutMs = 8000
): Promise<{ ok: boolean; status: number; instances?: any[]; error?: string }> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      const base = remoteBaseUrl.startsWith("http://") || remoteBaseUrl.startsWith("https://")
        ? remoteBaseUrl
        : `https://${remoteBaseUrl}`;
      url = new URL("/api/instances", base);
    } catch {
      resolve({ ok: false, status: 0, error: `Invalid remote URL: ${remoteBaseUrl}` });
      return;
    }

    const isHttps = url.protocol === "https:";
    const client = isHttps ? https : http;
    const requestOptions: https.RequestOptions = {
      method: "GET",
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers: {
        "x-api-key": userKey.trim(),
        "accept": "application/json"
      },
      timeout: timeoutMs,
      ...(isHttps ? { rejectUnauthorized: false } : {})
    };

    const req = client.request(requestOptions, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
              resolve({ ok: true, status: res.statusCode, instances: parsed });
              return;
            }
            resolve({ ok: false, status: res.statusCode, error: "远程接口未返回实例数组格式" });
          } catch {
            resolve({ ok: false, status: res.statusCode, error: "无法解析远程面板返回的 JSON 数据" });
          }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({ ok: false, status: res.statusCode, error: "用户专属访问密钥无效或未通过验证 (401/403)" });
        } else {
          resolve({ ok: false, status: res.statusCode || 500, error: `远程面板响应异常 (${res.statusCode}): ${data.slice(0, 100)}` });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error(`连接远程面板超时 (${timeoutMs}ms)`));
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, error: err.message });
    });
    req.end();
  });
}


async function findNodePanelDatabasePath(node: any): Promise<string | null> {
  try {
    const res = await discoverDaemonDatabases(node);
    if (!res.ok || !Array.isArray(res.databases)) return null;
    const found = res.databases.find(
      (d) =>
        d.engine === "sqlite" &&
        d.path &&
        (d.isSystem ||
          d.name === "dev.db" ||
          d.name === "database.sqlite" ||
          d.path.includes("/panel/") ||
          d.path.includes("/data/dev.db"))
    );
    return found?.path ?? null;
  } catch {
    return null;
  }
}

interface NodeDatabaseFetchResult {
  ok: boolean;
  user?: { id: string; username: string; displayName: string | null } | undefined;
  instances?: any[] | undefined;
  availableUsers?: RemoteNodeUserSummary[] | undefined;
  mismatchReason?: string | undefined;
  error?: string | undefined;
}

async function fetchInstancesFromNodeDatabase(
  node: any,
  dbPath: string,
  filter: { userKey?: string | undefined; targetUserId?: string | undefined }
): Promise<NodeDatabaseFetchResult> {
  try {
    let targetUserId = filter.targetUserId?.trim();
    let matchedUser: { id: string; username: string; displayName: string | null } | undefined;

    if (filter.userKey?.trim()) {
      const rawKey = filter.userKey.trim();
      const keyHash = hashToken(rawKey);
      const keyQuery = await executeDaemonDatabaseQuery(node, {
        path: dbPath,
        sql: `SELECT uak.id, uak.userId, u.username, u.displayName FROM user_access_keys uak LEFT JOIN users u ON u.id = uak.userId WHERE uak.keyHash = '${keyHash}';`
      });

      const firstKeyRow = keyQuery.ok && keyQuery.result.rows ? keyQuery.result.rows[0] : undefined;
      if (firstKeyRow) {
        targetUserId = String((firstKeyRow as any).userId);
        matchedUser = {
          id: targetUserId,
          username: String((firstKeyRow as any).username || "user"),
          displayName: (firstKeyRow as any).displayName ? String((firstKeyRow as any).displayName) : null
        };
      } else {
        // Key hash didn't match! Query active keys and users for diagnosis
        const allKeysQuery = await executeDaemonDatabaseQuery(node, {
          path: dbPath,
          sql: `SELECT uak.keyLast4, u.id, u.username, u.displayName, count(i.id) as instanceCount
                FROM user_access_keys uak
                LEFT JOIN users u ON u.id = uak.userId
                LEFT JOIN instances i ON (i.createdById = u.id OR i.assignedToId = u.id)
                GROUP BY uak.id;`
        });

        const activeSummaries: RemoteNodeUserSummary[] = (allKeysQuery.ok && allKeysQuery.result.rows ? allKeysQuery.result.rows : []).map((r: any) => ({
          id: String(r.id),
          username: String(r.username || "user"),
          displayName: r.displayName ? String(r.displayName) : null,
          instanceCount: Number(r.instanceCount) || 0,
          activeKeyLast4: r.keyLast4 ? String(r.keyLast4) : null
        }));

        const inputLast4 = rawKey.slice(-4);
        let mismatchReason = `您输入的密钥（末尾指纹 ...${inputLast4}）在远程节点数据库中未匹配到有效记录。`;
        const matchingUser = activeSummaries.find((u) => u.instanceCount > 0);
        if (matchingUser && matchingUser.activeKeyLast4) {
          mismatchReason += `检测到远程用户「${matchingUser.displayName || matchingUser.username}」当前生效的密钥指纹为 ...${matchingUser.activeKeyLast4}。`;
        }

        return {
          ok: false,
          mismatchReason,
          availableUsers: activeSummaries
        };
      }
    }

    if (!targetUserId) {
      return { ok: false, error: "未指定用户专属访问密钥或目标用户 ID" };
    }

    const safeUserId = targetUserId.replace(/['"\\]/g, "");
    const instQuery = await executeDaemonDatabaseQuery(node, {
      path: dbPath,
      sql: `SELECT * FROM instances WHERE createdById = '${safeUserId}' OR assignedToId = '${safeUserId}';`
    });

    if (!instQuery.ok || !instQuery.result.rows) {
      return { ok: false, error: "查询节点数据库实例表失败" };
    }

    if (!matchedUser) {
      const uQuery = await executeDaemonDatabaseQuery(node, {
        path: dbPath,
        sql: `SELECT id, username, displayName FROM users WHERE id = '${safeUserId}';`
      });
      const firstURow = uQuery.ok && uQuery.result.rows ? uQuery.result.rows[0] : undefined;
      if (firstURow) {
        matchedUser = {
          id: safeUserId,
          username: String((firstURow as any).username || "user"),
          displayName: (firstURow as any).displayName ? String((firstURow as any).displayName) : null
        };
      }
    }

    const result: NodeDatabaseFetchResult = {
      ok: true,
      instances: instQuery.result.rows
    };
    if (matchedUser) {
      result.user = matchedUser;
    }
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function upsertSyncedInstances(node: any, remoteList: any[], currentUserId: string): Promise<ManagedInstance[]> {
  const syncedInstances: ManagedInstance[] = [];
  for (const remote of remoteList) {
    if (!remote || typeof remote !== "object") continue;
    const instanceId = remote.id || randomUUID();
    const instanceName = remote.name || `Remote-${instanceId.slice(0, 6)}`;
    const workingDirectory = remote.workingDirectory || `/var/saki/workspace/${instanceId}`;
    const startCommand = remote.startCommand || "npm start";

    const existing = await prisma.instance.findUnique({ where: { id: instanceId } });
    let saved;
    if (existing) {
      saved = await prisma.instance.update({
        where: { id: instanceId },
        data: {
          name: instanceName,
          type: remote.type || existing.type,
          nodeId: node.id,
          workingDirectory,
          startCommand,
          stopCommand: remote.stopCommand ?? existing.stopCommand,
          restartPolicy: remote.restartPolicy ?? existing.restartPolicy,
          restartMaxRetries: typeof remote.restartMaxRetries === "number" ? remote.restartMaxRetries : existing.restartMaxRetries,
          description: remote.description ?? existing.description,
          status: remote.status || existing.status,
          createdById: existing.createdById || currentUserId
        },
        include: instanceAccessInclude
      });
    } else {
      saved = await prisma.instance.create({
        data: {
          id: instanceId,
          name: instanceName,
          type: remote.type || "generic_command",
          nodeId: node.id,
          workingDirectory,
          startCommand,
          stopCommand: remote.stopCommand ?? null,
          restartPolicy: remote.restartPolicy ?? "never",
          restartMaxRetries: typeof remote.restartMaxRetries === "number" ? remote.restartMaxRetries : 0,
          description: remote.description ?? "通过专属访问密钥同步导入",
          status: remote.status || "UNKNOWN",
          createdById: currentUserId
        },
        include: instanceAccessInclude
      });
    }
    syncedInstances.push(toManagedInstance(saved));
  }
  return syncedInstances;
}

export async function registerInstanceRoutes(app: FastifyInstance): Promise<void> {
  
  // Get list of users with instances from a node's local panel database
  app.get(
    "/api/instances/node-remote-users/:nodeId",
    { preHandler: requirePermission("instance.create") },
    async (request, reply) => {
      const { nodeId } = request.params as { nodeId: string };
      const currentUser = await loadCurrentUser(request.user.sub);
      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (!node || !currentUser || !canAccessNode(currentUser, node)) {
        reply.code(404).send({ message: "未找到目标节点或无权访问" });
        return;
      }

      const dbPath = await findNodePanelDatabasePath(node);
      if (!dbPath) {
        return { ok: true, users: [] };
      }

      try {
        const q = await executeDaemonDatabaseQuery(node, {
          path: dbPath,
          sql: `SELECT u.id, u.username, u.displayName, count(i.id) as instanceCount,
                       (SELECT uak.keyLast4 FROM user_access_keys uak WHERE uak.userId = u.id ORDER BY uak.createdAt DESC LIMIT 1) as activeKeyLast4
                FROM users u
                LEFT JOIN instances i ON (i.createdById = u.id OR i.assignedToId = u.id)
                GROUP BY u.id
                HAVING instanceCount > 0 OR activeKeyLast4 IS NOT NULL
                ORDER BY instanceCount DESC;`
        });

        const users: RemoteNodeUserSummary[] = (q.ok && q.result.rows ? q.result.rows : []).map((r) => ({
          id: String(r.id),
          username: String(r.username || "user"),
          displayName: r.displayName ? String(r.displayName) : null,
          instanceCount: Number(r.instanceCount) || 0,
          activeKeyLast4: r.activeKeyLast4 ? String(r.activeKeyLast4) : null
        }));

        return { ok: true, users };
      } catch {
        return { ok: true, users: [] };
      }
    }
  );

  app.post(
    "/api/instances/sync-by-user-key",
    { preHandler: requirePermission("instance.create") },
    async (request, reply) => {
      const body = request.body as Partial<SyncInstancesByUserKeyRequest>;
      const nodeId = trimmedString(body.nodeId);
      const userKey = trimmedString(body.userKey);
      const targetUserId = trimmedString(body.targetUserId);

      if (!nodeId) {
        reply.code(400).send({ message: "请提供目标节点编号 (nodeId)" });
        return;
      }

      if (!userKey && !targetUserId) {
        reply.code(400).send({ message: "请提供用户专属访问密钥 (userKey) 或选择目标用户 ID" });
        return;
      }

      if (userKey && !userKey.startsWith("saki_usr_")) {
        reply.code(400).send({ message: "专属访问密钥格式无效，必须以 saki_usr_ 开头" });
        return;
      }

      const currentUser = await loadCurrentUser(request.user.sub);
      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (!node || !currentUser || !canAccessNode(currentUser, node)) {
        reply.code(404).send({ message: "未找到目标节点或无权访问该节点" });
        return;
      }

      let nodeDbDiagnostic: { mismatchReason?: string | undefined; availableUsers?: RemoteNodeUserSummary[] | undefined } | null = null;

      // 1. Direct Node Database Sync via connected Daemon
      const dbPath = await findNodePanelDatabasePath(node);
      if (dbPath) {
        const dbResult = await fetchInstancesFromNodeDatabase(node, dbPath, {
          userKey: userKey || undefined,
          targetUserId: targetUserId || undefined
        });

        if (dbResult.ok && dbResult.instances) {
          const syncedInstances = await upsertSyncedInstances(node, dbResult.instances, request.user.sub);
          const userName = dbResult.user ? (dbResult.user.displayName || dbResult.user.username) : "目标用户";

          await writeAuditLog({
            request,
            userId: request.user.sub,
            action: "instance.sync_by_user_key",
            resourceType: "instance",
            payload: {
              nodeId: node.id,
              nodeName: node.name,
              source: "node_database",
              dbPath,
              userId: dbResult.user?.id,
              syncedCount: syncedInstances.length
            }
          });

          return {
            ok: true,
            syncedCount: syncedInstances.length,
            message: syncedInstances.length > 0
              ? `成功通过节点本地数据库验证用户「${userName}」，并导入了 ${syncedInstances.length} 个实例！`
              : `已通过节点数据库验证用户「${userName}」，但该用户暂无可用的实例配置。`,
            instances: syncedInstances
          } satisfies SyncInstancesByUserKeyResponse;
        }

        // If targetUserId was selected and failed
        if (targetUserId && !userKey) {
          reply.code(400).send({
            ok: false,
            syncedCount: 0,
            message: `从节点数据库导入用户实例失败：${dbResult.error || "未能获取该用户实例"}`,
            availableUsers: dbResult.availableUsers
          });
          return;
        }

        nodeDbDiagnostic = {
          mismatchReason: dbResult.mismatchReason,
          availableUsers: dbResult.availableUsers
        };
      }

      // 2. HTTP API fallback (if userKey was provided)
      if (!userKey) {
        reply.code(400).send({
          ok: false,
          syncedCount: 0,
          message: "未找到该节点的面板数据库，且未提供专属密钥进行 HTTP 同步"
        });
        return;
      }

      const candidateUrls: string[] = [];
      if (body.remotePanelUrl?.trim()) {
        const raw = body.remotePanelUrl.trim();
        candidateUrls.push(raw);
        try {
          const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
          if (!parsed.port) {
            candidateUrls.push(`https://${parsed.hostname}:5479`);
            candidateUrls.push(`http://${parsed.hostname}:5479`);
          }
        } catch {}
      } else {
        const host = node.host;
        candidateUrls.push(`https://${host}:5479`);
        candidateUrls.push(`http://${host}:5479`);
        const isIp = /^[\d\.]+$|^\[[a-fA-F0-9:]+\]$/.test(host);
        if (!isIp && !host.includes("localhost")) {
          candidateUrls.push(`https://${host}`);
        }
        candidateUrls.push(`http://${host}`);
      }

      let fetchResult: { ok: boolean; status: number; instances?: any[]; error?: string } | null = null;
      let usedUrl = "";

      for (const targetUrl of candidateUrls) {
        const res = await fetchRemoteUserInstances(targetUrl, userKey);
        if (res.ok) {
          fetchResult = res;
          usedUrl = targetUrl;
          break;
        }
        if (res.status === 401 || res.status === 403) {
          fetchResult = res;
          usedUrl = targetUrl;
          break;
        }
        fetchResult = res;
      }

      if (!fetchResult || !fetchResult.ok || !fetchResult.instances) {
        let failureMsg = fetchResult?.error || "无法连接到远程服务器面板 API";
        if (nodeDbDiagnostic?.mismatchReason) {
          failureMsg = `${nodeDbDiagnostic.mismatchReason}（远程面板 API 也返回：${failureMsg}）。您可以直接选择下方用户一键导入，或在远程面板重新复制最新密钥。`;
        }

        reply.code(400).send({
          ok: false,
          syncedCount: 0,
          message: failureMsg,
          availableUsers: nodeDbDiagnostic?.availableUsers
        });
        return;
      }

      const syncedInstances = await upsertSyncedInstances(node, fetchResult.instances, request.user.sub);

      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.sync_by_user_key",
        resourceType: "instance",
        payload: {
          nodeId: node.id,
          nodeName: node.name,
          source: "http_api",
          remoteUrl: usedUrl,
          syncedCount: syncedInstances.length
        }
      });

      return {
        ok: true,
        syncedCount: syncedInstances.length,
        message: syncedInstances.length > 0
          ? `成功通过远程 API 同步并导入 ${syncedInstances.length} 个实例！`
          : "验证成功，但该用户在远程面板上暂无可用实例。",
        instances: syncedInstances
      } satisfies SyncInstancesByUserKeyResponse;
    }
  );

  app.get("/api/instances", { preHandler: requirePermission("instance.view") }, async (request) => {
    const instances = await listVisibleInstances(request.user.sub);
    const refreshed = await Promise.all(instances.map(refreshVolatileStatus));
    return refreshed.map(toManagedInstance);
  });

  app.get("/api/instances/assignees", { preHandler: requirePermission("instance.update") }, async (request) => {
    return listInstanceAssignees(request.user.sub) satisfies Promise<InstanceAssignee[]>;
  });

  app.post(
    "/api/instances/start-command/suggest",
    { preHandler: requireAnyPermission(["instance.create", "instance.update"]) },
    async (request, reply) => {
      const body = request.body as Partial<SuggestInstanceStartCommandRequest>;
      const nodeId = trimmedString(body.nodeId);
      const workingDirectory = trimmedString(body.workingDirectory);
      if (!nodeId || !workingDirectory) {
        reply.code(400).send({ message: "nodeId and workingDirectory are required" });
        return;
      }

      const currentUser = await loadCurrentUser(request.user.sub);
      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (!node || !currentUser || !canAccessNode(currentUser, node)) {
        reply.code(404).send({ message: "Node not found" });
        return;
      }

      try {
        const suggestion = await suggestStartCommandForDirectory(node, workingDirectory);
        await writeAuditLog({
          request,
          userId: request.user.sub,
          action: "instance.start_command.suggest",
          resourceType: "instance",
          payload: {
            nodeId,
            workingDirectory,
            confidence: suggestion.confidence,
            detected: suggestion.detected,
            startCommand: suggestion.startCommand
          }
        });
        return suggestion satisfies SuggestInstanceStartCommandResponse;
      } catch (error) {
        await writeAuditLog({
          request,
          userId: request.user.sub,
          action: "instance.start_command.suggest",
          resourceType: "instance",
          payload: {
            nodeId,
            workingDirectory,
            error: error instanceof Error ? error.message : "Unknown error"
          },
          result: "FAILURE"
        });
        reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
      }
    }
  );

  app.post("/api/instances", { preHandler: requirePermission("instance.create") }, async (request, reply) => {
    const body = request.body as Partial<CreateInstanceRequest>;
    const nodeId = trimmedString(body.nodeId);
    const name = trimmedString(body.name);
    const startCommand = trimmedString(body.startCommand);
    if (!nodeId || !name || !startCommand) {
      reply.code(400).send({ message: "nodeId, name and startCommand are required" });
      return;
    }
    const blocked = findDangerousCommandReason(startCommand);
    if (blocked) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "security.command_blocked",
        resourceType: "instance",
        payload: { commandPreview: startCommand.slice(0, 200), reason: blocked },
        result: "FAILURE"
      });
      reply.code(400).send({ message: blocked });
      return;
    }

    const currentUser = await loadCurrentUser(request.user.sub);
    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node || !currentUser || !canAccessNode(currentUser, node)) {
      reply.code(404).send({ message: "Node not found" });
      return;
    }

    let assignedUserIds: string[] | undefined;
    try {
      if (body.assignedToUserIds !== undefined) {
        assignedUserIds = await resolveAssignableUserIds(request.user.sub, body.assignedToUserIds);
      } else {
        const assignedToId = await resolveAssignableUserId(request.user.sub, body.assignedToUserId);
        assignedUserIds = assignedToId === undefined ? undefined : assignedToId ? [assignedToId] : [];
      }
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : 400;
      reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Invalid assignee" });
      return;
    }

    const id = randomUUID();
    const initialAssignedUserIds = assignedUserIds ?? [];
    const instance = await prisma.instance.create({
      data: {
        id,
        nodeId,
        name,
        type: body.type ?? "generic_command",
        workingDirectory: body.workingDirectory?.trim() || `instances/${id}`,
        startCommand,
        stopCommand: body.stopCommand?.trim() || null,
        description: body.description?.trim() || null,
        proxyConfig: body.proxyConfig ? JSON.stringify(body.proxyConfig) : null,
        autoStart: body.autoStart ?? false,
        restartPolicy: normalizeRestartPolicy(body.restartPolicy, "never"),
        restartMaxRetries: normalizeRetryCount(body.restartMaxRetries, 0),
        createdById: request.user.sub,
        assignedToId: initialAssignedUserIds[0] ?? null,
        ...(initialAssignedUserIds.length
          ? {
              assignedUsers: {
                create: initialAssignedUserIds.map((userId) => ({ userId }))
              }
            }
          : {}),
        status: "CREATED"
      },
      include: instanceAccessInclude
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.create",
      resourceType: "instance",
      resourceId: instance.id,
      payload: { name: instance.name, nodeId: instance.nodeId, assignedUserIds: instanceAssignedUserIds(instance) }
    });

    return toManagedInstance(instance);
  });

  app.put("/api/instances/:id", { preHandler: requirePermission("instance.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<UpdateInstanceRequest>;
    const existing = await loadInstance(request, id);
    if (!existing) {
      await sendNotFound(reply);
      return;
    }

    const nextName = body.name === undefined ? existing.name : trimmedString(body.name);
    if (!nextName) {
      reply.code(400).send({ message: "name cannot be empty" });
      return;
    }
    const nextWorkingDirectory =
      body.workingDirectory === undefined ? existing.workingDirectory : trimmedString(body.workingDirectory);
    if (!nextWorkingDirectory) {
      reply.code(400).send({ message: "workingDirectory cannot be empty" });
      return;
    }
    const nextStartCommand =
      body.startCommand === undefined ? existing.startCommand : trimmedString(body.startCommand);
    if (!nextStartCommand) {
      reply.code(400).send({ message: "startCommand cannot be empty" });
      return;
    }
    if (body.startCommand !== undefined) {
      const blocked = findDangerousCommandReason(nextStartCommand);
      if (blocked) {
        await writeAuditLog({
          request,
          userId: request.user.sub,
          action: "security.command_blocked",
          resourceType: "instance",
          resourceId: id,
          payload: { commandPreview: nextStartCommand.slice(0, 200), reason: blocked },
          result: "FAILURE"
        });
        reply.code(400).send({ message: blocked });
        return;
      }
    }

    let nextNodeId: string | undefined;
    if (body.nodeId !== undefined) {
      const trimmedNodeId = body.nodeId.trim();
      if (!trimmedNodeId) {
        reply.code(400).send({ message: "nodeId cannot be empty" });
        return;
      }
      if (trimmedNodeId !== existing.nodeId) {
        const currentUser = await loadCurrentUser(request.user.sub);
        const node = await prisma.node.findUnique({ where: { id: trimmedNodeId } });
        if (!node || !currentUser || !canAccessNode(currentUser, node)) {
          reply.code(404).send({ message: "Node not found" });
          return;
        }
        nextNodeId = trimmedNodeId;
      }
    }
    const nodeChanged = nextNodeId !== undefined;

    let assignedUserIds: string[] | undefined;
    try {
      if (body.assignedToUserIds !== undefined) {
        assignedUserIds = await resolveAssignableUserIds(request.user.sub, body.assignedToUserIds);
      } else {
        const assignedToId = await resolveAssignableUserId(request.user.sub, body.assignedToUserId);
        assignedUserIds = assignedToId === undefined ? undefined : assignedToId ? [assignedToId] : [];
      }
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : 400;
      reply.code(statusCode).send({ message: error instanceof Error ? error.message : "Invalid assignee" });
      return;
    }

    const updateData: Prisma.InstanceUpdateInput = {
      name: nextName,
      workingDirectory: nextWorkingDirectory,
      startCommand: nextStartCommand,
      stopCommand: body.stopCommand === undefined ? existing.stopCommand : body.stopCommand?.trim() || null,
      description: body.description === undefined ? existing.description : body.description?.trim() || null,
      autoStart: body.autoStart ?? existing.autoStart,
      restartPolicy: normalizeRestartPolicy(body.restartPolicy, existing.restartPolicy as RestartPolicy),
      restartMaxRetries: normalizeRetryCount(body.restartMaxRetries, existing.restartMaxRetries)
    };
    if (body.proxyConfig !== undefined) {
      updateData.proxyConfig = body.proxyConfig ? JSON.stringify(body.proxyConfig) : null;
    }
    if (assignedUserIds !== undefined) {
      updateData.assignedTo = assignedUserIds[0] ? { connect: { id: assignedUserIds[0] } } : { disconnect: true };
      updateData.assignedUsers = {
        deleteMany: {},
        create: assignedUserIds.map((userId) => ({ userId }))
      };
    }
    if (nodeChanged && nextNodeId) {
      updateData.node = { connect: { id: nextNodeId } };
      updateData.status = existing.status === "CREATED" ? "CREATED" : "STOPPED";
      updateData.lastExitCode = null;
      if (existing.status !== "CREATED") updateData.lastStoppedAt = new Date();
    }

    const instance = await prisma.instance.update({
      where: { id },
      data: updateData,
      include: instanceAccessInclude
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.update",
      resourceType: "instance",
      resourceId: id,
      payload: {
        ...(nodeChanged ? { previousNodeId: existing.nodeId, nodeId: instance.nodeId } : {}),
        ...(assignedUserIds !== undefined
          ? { previousAssignedUserIds: instanceAssignedUserIds(existing), assignedUserIds }
          : {}),
        ...(body.proxyConfig !== undefined ? { proxyConfigUpdated: true } : {})
      }
    });

    return toManagedInstance(instance);
  });

  app.put("/api/instances/:id/proxy", { preHandler: requirePermission("instance.update") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await loadInstance(request, id);
    if (!existing) {
      await sendNotFound(reply);
      return;
    }

    const proxyConfig = request.body as InstanceProxyConfig | null;
    if (!proxyConfig?.enabled || proxyConfig.mode !== "subscription") {
      await stopDaemonClashSubscription(existing.node, id).catch(() => {});
    }
    const instance = await prisma.instance.update({
      where: { id },
      data: {
        proxyConfig: proxyConfig ? JSON.stringify(proxyConfig) : null
      },
      include: instanceAccessInclude
    });

    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.proxy_update",
      resourceType: "instance",
      resourceId: id,
      payload: { proxyConfig }
    });

    return toManagedInstance(instance);
  });

  app.post(
    "/api/instances/:id/proxy/test",
    { preHandler: requirePermission("instance.view") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await loadInstance(request, id);
      if (!existing) {
        await sendNotFound(reply);
        return;
      }

      const body = request.body as Partial<InstanceProxyConfig>;
      const server = String(body.server || "127.0.0.1").trim();
      const port = Number(body.port) || 7890;

      if (!server || !port || port <= 0 || port > 65535) {
        reply.code(400).send({ success: false, message: "无效的代理主机或端口号" });
        return;
      }

      const result = await testTcpConnectivity(server, port);
      if (result.ok) {
        return {
          success: true,
          latencyMs: result.latencyMs,
          message: `代理端口连通正常 (${server}:${port}, ${result.latencyMs}ms)`
        };
      }

      return reply.code(400).send({
        success: false,
        message: `无法连接到 ${server}:${port} (${result.error})，请确认 Clash / 代理软件已启动且在监听该端口`
      });
    }
  );

  app.post(
    "/api/instances/:id/proxy/subscription",
    { preHandler: requirePermission("instance.update") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await loadInstance(request, id);
      if (!existing) {
        await sendNotFound(reply);
        return;
      }
      const body = request.body as { url?: string };
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) {
        reply.code(400).send({ message: "请输入机场订阅地址" });
        return;
      }
      try {
        return { proxies: await fetchClashSubscriptionProxies(url) };
      } catch (panelError) {
        try {
          return await fetchDaemonClashSubscription(existing.node, id, url);
        } catch (daemonError) {
          const panelMessage = panelError instanceof Error ? panelError.message : "拉取订阅失败";
          const daemonMessage = daemonError instanceof Error ? daemonError.message : String(daemonError);
          if (/401|Invalid daemon credentials|Missing daemon credentials/i.test(daemonMessage)) {
            reply.code(502).send({ message: panelMessage });
            return;
          }
          reply.code(502).send({
            message: `${panelMessage}；节点侧拉取也失败：${daemonMessage}`
          });
          return;
        }
      }
    }
  );

  app.post(
    "/api/instances/:id/proxy/subscription/apply",
    { preHandler: requirePermission("instance.update") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await loadInstance(request, id);
      if (!existing) {
        await sendNotFound(reply);
        return;
      }
      const body = request.body as { url?: string; selectedProxy?: string; bypass?: string | null };
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const selectedProxy = typeof body.selectedProxy === "string" ? body.selectedProxy.trim() : "";
      if (!url || !selectedProxy) {
        reply.code(400).send({ message: "请先拉取订阅并选择节点" });
        return;
      }
      const applied = await applyDaemonClashSubscription(existing.node, id, { url, selectedProxy });
      const proxyConfig: InstanceProxyConfig = {
        enabled: true,
        mode: "subscription",
        type: "http",
        server: "127.0.0.1",
        port: applied.port,
        username: null,
        password: null,
        bypass: body.bypass?.trim() || "localhost,127.0.0.1,::1",
        subscriptionUrl: url,
        selectedProxy: applied.selectedProxy,
        proxies: applied.proxies
      };
      const instance = await prisma.instance.update({
        where: { id },
        data: { proxyConfig: JSON.stringify(proxyConfig) },
        include: instanceAccessInclude
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.proxy_subscription_apply",
        resourceType: "instance",
        resourceId: id,
        payload: { selectedProxy: applied.selectedProxy, port: applied.port }
      });
      return { instance: toManagedInstance(instance), ...applied };
    }
  );

  app.post(
    "/api/instances/:id/proxy/subscription/stop",
    { preHandler: requirePermission("instance.update") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await loadInstance(request, id);
      if (!existing) {
        await sendNotFound(reply);
        return;
      }
      await stopDaemonClashSubscription(existing.node, id);
      return { ok: true };
    }
  );

  app.delete("/api/instances/:id", { preHandler: requirePermission("instance.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await loadInstance(request, id);
    if (!existing) {
      await sendNotFound(reply);
      return;
    }

    await stopDaemonClashSubscription(existing.node, id).catch(() => {});
    await prisma.instance.delete({ where: { id } });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "instance.delete",
      resourceType: "instance",
      resourceId: id
    });
    return { ok: true };
  });

  app.post("/api/instances/:id/start", { preHandler: requirePermission("instance.start") }, (request, reply) =>
    runInstanceAction(request, reply, "start")
  );

  app.post("/api/instances/:id/stop", { preHandler: requirePermission("instance.stop") }, (request, reply) =>
    runInstanceAction(request, reply, "stop")
  );

  app.post("/api/instances/:id/restart", { preHandler: requirePermission("instance.restart") }, (request, reply) =>
    runInstanceAction(request, reply, "restart")
  );

  app.post("/api/instances/:id/kill", { preHandler: requirePermission("instance.kill") }, (request, reply) =>
    runInstanceAction(request, reply, "kill")
  );

  app.get("/api/instances/:id/logs", { preHandler: requirePermission("instance.logs") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { lines?: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }

    try {
      const logs = await readDaemonInstanceLogs(instance.node, id, Number(query.lines ?? 200) || 200);
      await updateStatus(id, logs.status, logs.exitCode);
      return logs satisfies InstanceLogsResponse;
    } catch (error) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.logs",
        resourceType: "instance",
        resourceId: id,
        payload: { error: error instanceof Error ? error.message : "Unknown error" },
        result: "FAILURE"
      });
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });

  app.post("/api/instances/:id/command", { preHandler: requirePermission("terminal.input") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { command?: string; timeoutMs?: number; input?: string };
    const command = body.command?.trim();
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    if (!command) {
      reply.code(400).send({ message: "command is required" });
      return;
    }
    const blocked = findDangerousCommandReason(command);
    if (blocked) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "security.command_blocked",
        resourceType: "instance",
        resourceId: id,
        payload: { commandPreview: command.slice(0, 200), reason: blocked },
        result: "FAILURE"
      });
      reply.code(400).send({ message: blocked });
      return;
    }

    try {
      const result = await runDaemonInstanceCommand(instance.node, id, {
        command,
        workingDirectory: instance.workingDirectory,
        ...(typeof body.timeoutMs === "number" ? { timeoutMs: body.timeoutMs } : {}),
        ...(typeof body.input === "string" ? { input: body.input } : {})
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.command",
        resourceType: "instance",
        resourceId: id,
        payload: {
          preview: command.slice(0, 200),
          length: command.length,
          inputLength: typeof body.input === "string" ? body.input.length : 0,
          workingDirectory: result.workingDirectory,
          exitCode: result.exitCode,
          signal: result.signal ?? null,
          durationMs: result.durationMs
        },
        result: result.exitCode === 0 ? "SUCCESS" : "FAILURE"
      });
      return result satisfies InstanceCommandResponse;
    } catch (error) {
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "instance.command",
        resourceType: "instance",
        resourceId: id,
        payload: { error: error instanceof Error ? error.message : "Unknown error" },
        result: "FAILURE"
      });
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });

  app.post("/api/instances/:id/shells", { preHandler: requirePermission("terminal.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    try {
      const body = request.body as { workingDirectory?: string; label?: string } | undefined;
      const result = await createDaemonInstanceShell(instance.node, id, body?.workingDirectory, body?.label);
      return result;
    } catch (error) {
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });

  app.get("/api/instances/:id/shells", { preHandler: requirePermission("terminal.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    try {
      return await listDaemonInstanceShells(instance.node, id);
    } catch (error) {
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });

  app.delete("/api/instances/:id/shells/:sid", { preHandler: requirePermission("terminal.view") }, async (request, reply) => {
    const { id, sid } = request.params as { id: string; sid: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    try {
      return await deleteDaemonInstanceShell(instance.node, id, sid);
    } catch (error) {
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });

  app.post("/api/instances/:id/shells/:sid/input", { preHandler: requirePermission("terminal.input") }, async (request, reply) => {
    const { id, sid } = request.params as { id: string; sid: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    try {
      const body = request.body as { data?: string; echo?: boolean };
      if (typeof body.data !== "string") {
        reply.code(400).send({ message: "data is required" });
        return;
      }
      const shellInputOpts = body.echo !== undefined ? { echo: body.echo } : {};
      return await sendDaemonShellInput(instance.node, id, sid, body.data, shellInputOpts);
    } catch (error) {
      reply.code(502).send({ message: error instanceof Error ? error.message : "Daemon request failed" });
    }
  });
}
