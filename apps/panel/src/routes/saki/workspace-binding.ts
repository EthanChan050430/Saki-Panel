import { createHash } from "node:crypto";
import type { DaemonNodeCredentials } from "../../daemon-client.js";
import { loadVisibleInstance, type InstanceWithAccess } from "../../instance-access.js";
import { RouteError } from "./types.js";

export interface SakiWorkspaceBinding {
  instanceId: string;
  workingDirectory: string;
  nodeIdentity: string;
}

export function nodeIdentity(node: DaemonNodeCredentials): string {
  return createHash("sha256").update(JSON.stringify([node.id, node.protocol, node.host, node.port, node.tokenHash])).digest("hex");
}

export function bindSakiWorkspace(instance: InstanceWithAccess): SakiWorkspaceBinding {
  return { instanceId: instance.id, workingDirectory: instance.workingDirectory, nodeIdentity: nodeIdentity(instance.node) };
}

export function assertSakiWorkspaceBinding(instance: InstanceWithAccess, expected: SakiWorkspaceBinding): void {
  const actual = bindSakiWorkspace(instance);
  if (actual.instanceId !== expected.instanceId || actual.workingDirectory !== expected.workingDirectory || actual.nodeIdentity !== expected.nodeIdentity) {
    throw new RouteError("Workspace or node changed. Start a new request and approval.", 409);
  }
}

export async function assertSakiApprovalBindings(userId: string, bindings: SakiWorkspaceBinding[] | undefined): Promise<void> {
  if (!bindings) throw new RouteError("This approval predates workspace binding. Request approval again.", 409);
  for (const expected of bindings) {
    const instance = await loadVisibleInstance(userId, expected.instanceId);
    if (!instance) throw new RouteError("Instance not found.", 404);
    assertSakiWorkspaceBinding(instance, expected);
  }
}
