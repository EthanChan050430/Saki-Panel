import type { PermissionCode } from "@webops/shared";
import { readEffectiveSakiConfig } from "./config.js";
import { resolveSakiContext } from "./chat.js";
import { authorizeSakiTool } from "./authorization.js";
import { executeSakiAgentTool } from "./executor.js";
import { requireUserPermission, RouteError, type SakiAgentRuntime } from "./types.js";

/** A user's explicit New terminal click follows the same Agent resource ACL. */
export async function createSakiTerminal(userId: string, permissions: PermissionCode[], instanceId: string) {
  if (!instanceId) throw new RouteError("请先选择一个已授权项目。", 400);
  const context = await resolveSakiContext(userId, instanceId);
  const runtime: SakiAgentRuntime = {
    userId, permissions, context, skills: [], config: await readEffectiveSakiConfig(),
    input: { message: "用户新建终端", instanceId, mode: "agent", terminalSandbox: true, agentPermissionMode: "acceptEdits" }
  };
  const call = { name: "createShell", args: { instanceId } };
  const authorized = await authorizeSakiTool(runtime, call, call.args);
  requireUserPermission(authorized.permissions, "terminal.input");
  const action = await executeSakiAgentTool(authorized, call, { approved: true });
  if (!action.ok || !action.terminal) throw new RouteError(action.observation || "终端创建失败。", 502);
  return { action };
}
