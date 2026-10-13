import { listVisibleInstances, loadVisibleInstance } from "../../instance-access.js";
import { assertScheduledTaskAccess } from "../../task-access.js";
import { getScheduledTask } from "../../tasks.js";
import { assertSakiWorkspaceBinding, bindSakiWorkspace } from "./workspace-binding.js";
import { canonicalToolSchema, normalizedAgentToolName } from "./tools.js";
import type { ParsedToolCall, SakiAgentRuntime } from "./types.js";
import { effectiveSakiTerminalSandbox, requireUserPermission, RouteError, stringArg } from "./types.js";
import { assertSakiSessionAccess, assertSakiSelectedWorkspaces, sakiProjectPermissions } from "./session-access.js";
import { selectedWorkspaceTarget } from "./selected-workspaces.js";
import { requiredSakiToolPermissions, sakiHostExecutionTools, sakiToolPermissions } from "./resource-policy.js";

export async function authorizeSakiTool(runtime: SakiAgentRuntime, call: ParsedToolCall, args: Record<string, unknown>): Promise<SakiAgentRuntime> {
  const mode = runtime.toolProfile === "chat" ? "chat" : "agent";
  const contextId = runtime.context.instance?.id;
  const { user, instance: context } = await assertSakiSessionAccess(runtime.userId, contextId ?? null, mode);
  const instances = await assertSakiSelectedWorkspaces(runtime.userId, contextId, runtime.input.workspaceInstanceIds, mode);
  for (const previous of runtime.context.instances ?? []) {
    const current = instances?.find(instance => instance.id === previous.id);
    if (!current) throw new RouteError("Workspace selection changed.", 409);
    assertSakiWorkspaceBinding(current, bindSakiWorkspace(previous));
  }
  const selectedContext = { ...runtime.context, instance: context, ...(instances ? { instances } : {}) };
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
  if (instances) {
    target = selectedWorkspaceTarget(selectedContext, lookup);
  } else if (lookup) {
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
      if (instances && (!nextId || !instances.some(item => item.id === nextId))) throw new RouteError("不能把任务移出已选工作区。", 403);
      if (!instances && restrictToContext && context && nextId !== context.id) throw new RouteError("不能把任务移出当前项目。", 403);
    }
    target = task.instanceId ? await loadVisibleInstance(user.id, task.instanceId) : null;
    if (instances && !instances.some(item => item.id === task.instanceId)) throw new RouteError("只能操作已选工作区的任务。", 403);
    if (!instances && restrictToContext && context && task.instanceId !== context.id) throw new RouteError("只能操作当前项目的任务。", 403);
  }
  if (!instances && target && context && restrictToContext && target.id !== context.id) throw new RouteError("禁止跨项目访问；读取已授权的外部项目文件请使用 requestExternalAccess。", 403);
  if (!user.isSuperAdmin && sakiHostExecutionTools.has(lower)) throw new RouteError("HOST_EXECUTION_REQUIRES_ISOLATION: 非超级管理员不能通过 Agent 在未配置操作系统沙箱的宿主机执行代码或输入终端。文件工具仍可在已授权项目内使用。", 403);
  if (lower === "updateinstancesettings" && !user.isSuperAdmin && ["workingDirectory", "startCommand", "stopCommand"].some((key) => key in args)) throw new RouteError("Only global administrators can change instance execution paths or commands.", 403);
  let scoped = permissions;
  if (target) {
    scoped = sakiProjectPermissions(user, target, instances ? runtime.permissions : permissions);
    requireUserPermission(scoped, runtime.toolProfile === "chat" ? "saki.chat" : "saki.agent");
    requireUserPermission(scoped, "instance.view");
    for (const permission of required) requireUserPermission(scoped, permission);
  }
  for (const permission of required) requireUserPermission(scoped, permission);
  return { ...runtime, permissions: scoped, context: { ...selectedContext, access: { isSuperAdmin: user.isSuperAdmin, permissions: scoped } } };
}
