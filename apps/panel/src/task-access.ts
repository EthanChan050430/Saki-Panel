import type { ManagedScheduledTask, PermissionCode } from "@webops/shared";
import { isAuthDisabled, loadAuthDisabledCurrentUser, loadCurrentUser } from "./auth.js";
import { hasInstancePermission, loadVisibleInstance } from "./instance-access.js";
import { classifyCommandRisk } from "./command-policy.js";
import { RouteError } from "./routes/saki/types.js";

type TaskResource = Pick<ManagedScheduledTask, "instanceId" | "createdBy">;

/** Shared by HTTP, Agent and scheduled execution; null instance is not public. */
export async function canAccessScheduledTask(userId: string, task: TaskResource, permission: PermissionCode): Promise<boolean> {
  const user = isAuthDisabled() ? await loadAuthDisabledCurrentUser() : await loadCurrentUser(userId);
  if (!user || user.status !== "ACTIVE" || !user.permissions.includes(permission)) return false;
  if (!task.instanceId) return user.isSuperAdmin || task.createdBy === userId;
  const instance = await loadVisibleInstance(userId, task.instanceId);
  return Boolean(instance && hasInstancePermission({ userId, role: user.isSuperAdmin ? "super_admin" : user.isAdmin ? "admin" : "user", roleNames: user.roleNames }, instance, user.permissions, permission));
}

export async function assertScheduledTaskAccess(userId: string, task: TaskResource, permission: PermissionCode): Promise<void> {
  if (!(await canAccessScheduledTask(userId, task, permission))) {
    throw new RouteError("Task not found.", 404);
  }
}

export async function assertTaskExecutionAllowed(userId: string, task: ManagedScheduledTask): Promise<void> {
  await assertScheduledTaskAccess(userId, task, "task.run");
  const user = isAuthDisabled() ? await loadAuthDisabledCurrentUser() : await loadCurrentUser(userId);
  if (!user?.isSuperAdmin) throw new RouteError("HOST_EXECUTION_REQUIRES_ISOLATION: Task execution requires a global administrator until OS process isolation is configured.", 403);
  const permission: PermissionCode = task.type === "run_command" ? "terminal.input" : task.type === "start_instance" ? "instance.start"
    : task.type === "stop_instance" ? "instance.stop" : "instance.restart";
  await assertScheduledTaskAccess(userId, task, permission);
  if (task.type === "run_command" && classifyCommandRisk(task.payload.command ?? "").risk === "critical") {
    throw new RouteError("Critical task command is blocked.", 403);
  }
}

export async function assertTaskDefinitionAuthority(userId: string | null): Promise<void> {
  const user = userId ? (isAuthDisabled() ? await loadAuthDisabledCurrentUser() : await loadCurrentUser(userId)) : null;
  if (!user || user.status !== "ACTIVE" || !user.isSuperAdmin) {
    throw new RouteError("HOST_EXECUTION_REQUIRES_ISOLATION: Only global administrators can define host-executed scheduled tasks.", 403);
  }
}

export async function filterAccessibleScheduledTasks(userId: string, tasks: ManagedScheduledTask[]): Promise<ManagedScheduledTask[]> {
  const decisions = await Promise.all(tasks.map((task) => canAccessScheduledTask(userId, task, "task.view")));
  return tasks.filter((_, index) => decisions[index]);
}
