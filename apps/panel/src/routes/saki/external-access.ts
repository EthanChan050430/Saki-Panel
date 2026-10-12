import type { SakiExternalFileSnapshot, InstanceFileContentResponse } from "@webops/shared";
import { isAuthDisabled, loadAuthDisabledCurrentUser, loadCurrentUser } from "../../auth.js";
import { assertSakiSessionAccess, sakiProjectPermissions } from "./session-access.js";
import { requestDaemon } from "../../daemon-client.js";
import { nodeIdentity } from "./workspace-binding.js";
import type { SakiAgentRuntime } from "./types.js";
import { numericArg, requireUserPermission, RouteError, safeRelativePath, stringArg } from "./types.js";

export interface PreparedExternalRead {
  userId: string;
  contextInstanceId: string;
  sourceInstanceId: string | null;
  sourceWorkingDirectory: string;
  nodeId: string;
  nodeIdentity: string;
  requestedPath: string;
  label: string;
  reason: string;
  startLine: number;
  lineCount: number;
  expiresAt: number;
  snapshot: SakiExternalFileSnapshot;
}

async function resolveSource(runtime: SakiAgentRuntime, args: Record<string, unknown>) {
  const user = isAuthDisabled() ? await loadAuthDisabledCurrentUser() : await loadCurrentUser(runtime.userId);
  if (!user || user.status !== "ACTIVE") throw new RouteError("Forbidden.", 403);
  requireUserPermission(user.permissions, "saki.agent");
  requireUserPermission(user.permissions, "file.read");
  const contextId = runtime.context.instance?.id;
  if (!contextId) throw new RouteError("Select an authorized instance before requesting external files.", 403);
  const { instance: context } = await assertSakiSessionAccess(user.id, contextId);
  if (!context) throw new RouteError("Instance not found.", 404);
  const sourceId = stringArg(args, "sourceInstanceId");
  const source = sourceId ? (await assertSakiSessionAccess(user.id, sourceId)).instance : null;
  if (sourceId && !source) throw new RouteError("Instance not found.", 404);
  if (!sakiProjectPermissions(user, context, runtime.permissions).includes("file.read")
    || (source && !sakiProjectPermissions(user, source, runtime.permissions).includes("file.read"))) {
    throw new RouteError("Resource not found.", 404);
  }
  if (!source && !user.isSuperAdmin) {
    throw new RouteError("Host files require the explicit super_admin role. Other users must specify an authorized sourceInstanceId.", 403);
  }
  const requestedPath = source ? safeRelativePath(args.path) : stringArg(args, "path");
  if (!requestedPath) throw new RouteError("requestExternalAccess requires a file path.", 400);
  const reason = stringArg(args, "reason");
  if (!reason || reason.length > 500) throw new RouteError("Provide an access reason of at most 500 characters.", 400);
  return { context, source, requestedPath, reason, node: (source ?? context).node };
}

export async function prepareExternalRead(runtime: SakiAgentRuntime, args: Record<string, unknown>): Promise<PreparedExternalRead> {
  const { context, source, requestedPath, reason, node } = await resolveSource(runtime, args);
  const snapshot = await requestDaemon<SakiExternalFileSnapshot>(node, "/api/agent/external-files/inspect", {
    method: "POST", body: JSON.stringify({ path: requestedPath, ...(source ? { workingDirectory: source.workingDirectory } : {}) })
  });
  return { userId: runtime.userId, contextInstanceId: context.id, sourceInstanceId: source?.id ?? null,
    sourceWorkingDirectory: (source ?? context).workingDirectory, nodeId: node.id, nodeIdentity: nodeIdentity(node), requestedPath,
    label: `${node.name} / ${source?.name ?? "宿主机文件"}`, reason,
    startLine: numericArg(args.startLine, 1, 1, 10000000), lineCount: numericArg(args.lineCount, 200, 1, 2000),
    expiresAt: Date.now() + 15 * 60 * 1000, snapshot };
}

export async function executeExternalRead(runtime: SakiAgentRuntime, args: Record<string, unknown>, prepared: PreparedExternalRead | undefined) {
  if (!prepared || prepared.userId !== runtime.userId || prepared.expiresAt <= Date.now()) throw new RouteError("External-read approval is missing or expired. Request access again.", 403);
  const { context, source, requestedPath, reason, node } = await resolveSource(runtime, args);
  if (context.id !== prepared.contextInstanceId || (source?.id ?? null) !== prepared.sourceInstanceId || node.id !== prepared.nodeId || nodeIdentity(node) !== prepared.nodeIdentity
    || (source ?? context).workingDirectory !== prepared.sourceWorkingDirectory || requestedPath !== prepared.requestedPath || reason !== prepared.reason
    || numericArg(args.startLine, 1, 1, 10000000) !== prepared.startLine || numericArg(args.lineCount, 200, 1, 2000) !== prepared.lineCount) {
    throw new RouteError("External-read target changed. Request access again.", 403);
  }
  return requestDaemon<InstanceFileContentResponse>(node, "/api/agent/external-files/read", {
    method: "POST", body: JSON.stringify({ snapshot: prepared.snapshot, startLine: prepared.startLine, lineCount: prepared.lineCount })
  });
}
