import type { ResolvedSakiContext, InstanceWithNode } from "./types.js";
import { RouteError } from "./types.js";

/** A node connection never grants access to other projects hosted on that node. */
export function serverToolWorkspace(context: ResolvedSakiContext, nodeId: string): InstanceWithNode {
  if (context.instance?.nodeId === nodeId) return context.instance;
  const matches = (context.instances ?? []).filter(instance => instance.nodeId === nodeId);
  if (matches.length === 1) return matches[0]!;
  throw new RouteError(matches.length ? "多个工作区位于该节点，请使用带 instanceId 的文件或终端工具。" : "该节点没有当前已选工作区；请先选择项目。", 403);
}
