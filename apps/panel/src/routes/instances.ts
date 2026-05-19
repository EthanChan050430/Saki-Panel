import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import type {
  CreateInstanceRequest,
  InstanceAssignee,
  InstanceActionResponse,
  InstanceCommandResponse,
  InstanceFileEntry,
  InstanceLogsResponse,
  InstanceStatus,
  InstanceType,
  ManagedInstance,
  RestartPolicy,
  SuggestInstanceStartCommandRequest,
  SuggestInstanceStartCommandResponse,
  UpdateInstanceRequest
} from "@webops/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { requireAnyPermission, requirePermission } from "../auth.js";
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
import { findDangerousCommandReason } from "../security.js";
import {
  killDaemonInstance,
  listDaemonInstanceFiles,
  readDaemonInstanceFile,
  readDaemonInstanceLogs,
  readDaemonInstanceStatus,
  restartDaemonInstance,
  runDaemonInstanceCommand,
  startDaemonInstance,
  stopDaemonInstance,
  type DaemonInstanceSpec
} from "../daemon-client.js";

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
    restartMaxRetries: instance.restartMaxRetries
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

export async function registerInstanceRoutes(app: FastifyInstance): Promise<void> {
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

      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (!node) {
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

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
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
        const node = await prisma.node.findUnique({ where: { id: trimmedNodeId } });
        if (!node) {
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
          : {})
      }
    });

    return toManagedInstance(instance);
  });

  app.delete("/api/instances/:id", { preHandler: requirePermission("instance.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await loadInstance(request, id);
    if (!existing) {
      await sendNotFound(reply);
      return;
    }

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
}
