import { listVisibleInstances, loadVisibleInstance } from "../../instance-access.js";
import { assertScheduledTaskAccess } from "../../task-access.js";
import { getScheduledTask } from "../../tasks.js";
import { assertSakiWorkspaceBinding, bindSakiWorkspace } from "./workspace-binding.js";
import { canonicalToolSchema, normalizedAgentToolName } from "./tools.js";
import type { ParsedToolCall, SakiAgentRuntime } from "./types.js";
import { effectiveSakiTerminalSandbox, requireUserPermission, RouteError, stringArg } from "./types.js";
import { assertSakiSessionAccess, sakiProjectPermissions } from "./session-access.js";
import { requiredSakiToolPermissions, sakiHostExecutionTools, sakiToolPermissions } from "./resource-policy.js";

export async function authorizeSakiTool(runtime: SakiAgentRuntime, call: ParsedToolCall, args: Record<string, unknown>): Promise<SakiAgentRuntime> {
  const mode = runtime.toolProfile === "chat" ? "chat" : "agent";
  const contextId = runtime.context.instance?.id;
  const { user, instance: context } = await assertSakiSessionAccess(runtime.userId, contextId ?? null, mode);
  const lower = normalizedAgentToolName(call.name);
  const permissions = sakiProjectPermissions(user, context, runtime.permissions);
  requireUserPermission(permissions, mode === "chat" ? "saki.chat" : "saki.agent");
  if (context) requireUserPermission(permissions, "instance.view");
  const required = requiredSakiToolPermissions(lower, args);
  const properties = canonicalToolSchema(call.name)?.parameters.properties as Record<string, unknown> | undefined;
  const hasInstanceParameter = Boolean(properties?.instanceId) && !(lower === "generateimage" && !stringArg(args, "path"));
  if (!context && (required.length || hasInstanceParameter) && lower !== "listinstances" && !user.isSuperAdmin) throw new RouteError("无项目：请先选择一个已授权项目，再使用项目工具。", 403);
  const restrictToContext = !user.isSuperAdmin || effectiveSakiTerminalSandbox(runtime.input, runtime.config);
  if (context && context.workingDirectory !== runtime.context.instance?.workingDirectory) throw new RouteError("Workspace changed. Start a new request.", 409);
  if (context && runtime.context.instance) assertSakiWorkspaceBinding(context, bindSakiWorkspace(runtime.context.instance));
  let target = context;
  const lookup = stringArg(args, "instanceId") || stringArg(args, "instance") || stringArg(args, "id");
  if (lookup) {
    target = await loadVisibleInstance(user.id, lookup);
    if (!target) target = (await listVisibleInstances(user.id)).find((item) => item.name === lookup || item.name.toLowerCase().includes(lookup.toLowerCase())) ?? null;
    if (!target) throw new RouteError("Instance not found.", 404);
  }
  if (["updatescheduledtask", "deletescheduledtask", "runtask", "taskruns"].includes(lower)) {
    const task = await getScheduledTask(stringArg(args, "taskId"));
    if (!task) throw new RouteError("Task not found.", 404);
    await assertScheduledTaskAccess(user.id, task, sakiToolPermissions[lower]!);
    if (lower === "updatescheduledtask" && "instanceId" in args) {
      const nextId = stringArg(args, "instanceId") || null;
      await assertScheduledTaskAccess(user.id, { instanceId: nextId, createdBy: task.createdBy }, "task.update");
      if (restrictToContext && context && nextId !== context.id) throw new RouteError("不能把任务移出当前项目。", 403);
    }
    target = task.instanceId ? await loadVisibleInstance(user.id, task.instanceId) : null;
    if (restrictToContext && context && task.instanceId !== context.id) throw new RouteError("只能操作当前项目的任务。", 403);
  }
  if (target && context && restrictToContext && target.id !== context.id) throw new RouteError("禁止跨项目访问；读取已授权的外部项目文件请使用 requestExternalAccess。", 403);
  for (const permission of required) requireUserPermission(permissions, permission);
  if (!user.isSuperAdmin && sakiHostExecutionTools.has(lower)) throw new RouteError("HOST_EXECUTION_REQUIRES_ISOLATION: 非超级管理员不能通过 Agent 在未配置操作系统沙箱的宿主机执行代码或输入终端。文件工具仍可在已授权项目内使用。", 403);
  if (lower === "updateinstancesettings" && !user.isSuperAdmin && ["workingDirectory", "startCommand", "stopCommand"].some((key) => key in args)) throw new RouteError("Only global administrators can change instance execution paths or commands.", 403);
  let scoped = permissions;
  if (target) {
    scoped = sakiProjectPermissions(user, target, permissions);
    requireUserPermission(scoped, runtime.toolProfile === "chat" ? "saki.chat" : "saki.agent");
    requireUserPermission(scoped, "instance.view");
    for (const permission of required) requireUserPermission(scoped, permission);
  }
  return { ...runtime, permissions: scoped, context: { ...runtime.context, instance: context, access: { isSuperAdmin: user.isSuperAdmin, permissions: scoped } } };
}
