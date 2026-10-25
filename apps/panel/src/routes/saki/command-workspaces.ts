import { commandPathTokens, isPosixCommandPlatform } from "../../command-policy.js";
import { findCrossInstanceCommandEscape } from "../../security.js";
import { isAbsoluteCommandPathInsideWorkspace, isAbsolutePathInsideWorkspace } from "../../workspace-path.js";
import { nodeIdentity } from "./workspace-binding.js";
import type { InstanceWithNode, ResolvedSakiContext, SakiCheckpoint } from "./types.js";

/** Only server-authorized, attached roots on the execution node share a scope. */
export function commandWorkspaceScope(context: ResolvedSakiContext, target: InstanceWithNode): InstanceWithNode[] {
  // Host execution requires a super administrator. Do not broaden file-tool
  // or legacy single-project authority merely because other instances exist.
  if (context.access?.isSuperAdmin !== true || !context.instances) return [target];
  const identity = nodeIdentity(target.node);
  return [target, ...context.instances.filter(instance => instance.id !== target.id
    && instance.nodeId === target.nodeId && nodeIdentity(instance.node) === identity)];
}

export function commandWorkspaceEscape(context: ResolvedSakiContext, target: InstanceWithNode, command: string): string | null {
  return findCrossInstanceCommandEscape(command, target.workingDirectory, isPosixCommandPlatform(target.node.os),
    commandWorkspaceScope(context, target).slice(1).map(instance => instance.workingDirectory));
}

/** Include the execution root plus attached roots explicitly named by the command. */
export function referencedCommandWorkspaces(context: ResolvedSakiContext, target: InstanceWithNode, command: string): InstanceWithNode[] {
  const tokens = commandPathTokens(command, isPosixCommandPlatform(target.node.os))
    .map(token => token.replace(/^["']+|["']+$/g, "").replace(/^--?[a-zA-Z0-9_-]+[:=]|^--?/, ""));
  return commandWorkspaceScope(context, target).filter(instance => instance.id === target.id
    || tokens.some(token => isAbsoluteCommandPathInsideWorkspace(token, instance.workingDirectory)));
}

/** One outer snapshot covers nested roots; overlapping snapshots cannot undo independently. */
export function commandCheckpointWorkspaces(workspaces: readonly InstanceWithNode[]): InstanceWithNode[] {
  return workspaces.filter((workspace, index) => !workspaces.some((other, otherIndex) => otherIndex !== index
    && isAbsolutePathInsideWorkspace(workspace.workingDirectory, other.workingDirectory)
    && (!isAbsolutePathInsideWorkspace(other.workingDirectory, workspace.workingDirectory) || otherIndex < index)));
}

/** The destination checkpoint belongs to the same recorded terminal action. */
export function isCommandCheckpointForWorkspace(checkpoint: SakiCheckpoint, actionId: string, instanceId: string | null | undefined): boolean {
  return typeof instanceId === "string" && instanceId.length > 0
    && checkpoint.type === "workspace" && checkpoint.actionId === actionId && checkpoint.commandInstanceId === instanceId;
}
