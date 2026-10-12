import { isAuthDisabled, loadAuthDisabledCurrentUser, loadCurrentUser } from "../../auth.js";
import type { CurrentUser, PermissionCode } from "@webops/shared";
import { isInstanceAssignablePermission } from "@webops/shared";
import { instanceAssignedUserIds, instancePermissionOverride, loadVisibleInstance, type InstanceWithAccess } from "../../instance-access.js";
import { RouteError, type SakiActiveTask } from "./types.js";
import { assertSakiWorkspaceBinding } from "./workspace-binding.js";

// Agent authority is explicit even when the panel grants an ordinary admin
// management visibility over other users' instances.
export function hasSakiProjectAccess(user: Pick<CurrentUser, "id" | "isSuperAdmin">, instance: InstanceWithAccess): boolean {
  return user.isSuperAdmin || instance.createdById === user.id || instanceAssignedUserIds(instance).includes(user.id);
}

export function sakiProjectPermissions(user: CurrentUser, instance: InstanceWithAccess | null, credentialPermissions: readonly PermissionCode[] = user.permissions): PermissionCode[] {
  const permissions = credentialPermissions.filter((permission) => user.permissions.includes(permission));
  if (!instance) return permissions;
  if (!hasSakiProjectAccess(user, instance)) return [];
  const profile = { userId: user.id, role: user.isSuperAdmin ? "super_admin" as const : user.isAdmin ? "admin" as const : "user" as const, roleNames: user.roleNames };
  const override = instancePermissionOverride(profile, instance, permissions);
  return override === null ? permissions : permissions.filter((permission) => !isInstanceAssignablePermission(permission) || override.includes(permission));
}

/** Replayed output and resumed model context require current authority too. */
export async function assertSakiSessionAccess(userId: string, instanceId: string | null, mode: "agent" | "chat" = "agent") {
  const user = isAuthDisabled() ? await loadAuthDisabledCurrentUser() : await loadCurrentUser(userId);
  const permission = mode === "chat" ? "saki.chat" : "saki.agent";
  if (!user || user.status !== "ACTIVE" || !user.permissions.includes(permission)) throw new RouteError("Forbidden.", 403);
  if (!instanceId) return { user, instance: null, permissions: user.permissions };
  const instance = await loadVisibleInstance(user.id, instanceId);
  const permissions = instance ? sakiProjectPermissions(user, instance) : [];
  if (!instance || !permissions.includes(permission) || !permissions.includes("instance.view")) throw new RouteError("Instance not found.", 404);
  return { user, instance, permissions };
}

export async function assertSakiTaskAccess(userId: string, task: SakiActiveTask | null | undefined): Promise<void> {
  if (!task || task.userId !== userId) throw new RouteError("Task not found.", 404);
  const { instance } = await assertSakiSessionAccess(userId, task.instanceId, task.input.mode === "chat" ? "chat" : "agent");
  if (instance && task.workspaceBinding) assertSakiWorkspaceBinding(instance, task.workspaceBinding);
}
