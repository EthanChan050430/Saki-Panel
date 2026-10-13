import { RouteError, type ResolvedSakiContext, type InstanceWithNode } from "./types.js";

export function selectedWorkspaceTarget(context: ResolvedSakiContext, lookup: string): InstanceWithNode | null {
  if (!context.instances) return null;
  if (!lookup) return context.instance;
  const exact = context.instances.find(instance => instance.id === lookup);
  if (exact) return exact;
  const named = context.instances.filter(instance => instance.name === lookup);
  const matches = named.length ? named : context.instances.filter(instance => instance.name.toLowerCase().includes(lookup.toLowerCase()));
  if (matches.length > 1) throw new RouteError("多个工作区名称匹配，请使用明确的 instanceId。", 400);
  if (!matches[0]) throw new RouteError("该工作区未添加到当前对话，请先添加工作区。", 403);
  return matches[0];
}
