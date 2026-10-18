import type { SakiAgentAction } from "@webops/shared";
import { classifyCommandRisk, isPosixCommandPlatform } from "../../command-policy.js";
import { isSakiReadOnlyAgentTool, normalizedAgentToolName } from "./tools.js";
import type { SakiAgentRuntime } from "./types.js";

type CacheEntries = Array<[string, SakiAgentAction]>;
const referenceTools = new Set(["searchweb", "browse", "crawl", "researchweb", "listskills", "searchskills", "readskill"]);
const fileTools = new Set(["writefile", "replaceinfile", "editlines", "deletepath", "mkdir", "renamepath", "uploadbase64", "writememory", "generateimage"]);
const fileReads = new Set(["readfile", "statfile", "outlinefile", "readsymbol", "readmemory"]);
const stateReads = new Set(["describeinstance", "getenvironmentinfo", "gitstatus", "gitdiff", "diagnosecode"]);

function relativePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (/^(?:\/|[a-z]:)/i.test(normalized) || normalized.split("/").includes("..")) return null;
  return normalized;
}

export function retainAgentToolCacheAfterAction(entries: CacheEntries, action: SakiAgentAction, runtime: Pick<SakiAgentRuntime, "context">): CacheEntries {
  const tool = normalizedAgentToolName(action.tool);
  if (["pending_approval", "pending_input", "rejected"].includes(action.status ?? "")) return entries;
  if (isSakiReadOnlyAgentTool(tool) || ["createshell", "closeshell", "requestexternalaccess"].includes(tool)) return entries;
  if (tool === "generateimage" && !action.args.path) return entries;

  const instances = runtime.context.instances ?? (runtime.context.instance ? [runtime.context.instance] : []);
  const resolveId = (lookup: unknown, fallback: string | null): string | null => {
    if (typeof lookup !== "string" || !lookup) return fallback;
    return instances.find((instance) => instance.id === lookup || instance.name === lookup)?.id ?? null;
  };
  const defaultId = runtime.context.instance?.id ?? null;
  const targetId = tool === "runtask" ? null : resolveId(action.terminal?.instanceId ?? action.args.instanceId, defaultId);
  const target = instances.find((instance) => instance.id === targetId);
  const terminal = tool === "runcommand" || tool === "runinshell";
  const inspection = terminal && !action.args.input && !action.args.stdin && typeof action.args.command === "string"
    && classifyCommandRisk(action.args.command, target?.workingDirectory, isPosixCommandPlatform(target?.node.os)).readOnly;
  if (inspection) return entries;
  const noFileChanges = terminal && action.approval?.reason === "Terminal command made no workspace file changes.";
  const changedPaths = tool === "writememory" ? ["SAKI.md"] : tool === "renamepath" ? [action.args.fromPath, action.args.toPath] : [action.args.path];
  const paths = changedPaths.map(relativePath);
  const exactPaths = fileTools.has(tool) && paths.every((path) => path !== null) ? paths as string[] : null;
  const overlaps = (left: string, right: string) => {
    left = left.toLowerCase(); right = right.toLowerCase();
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  };
  return entries.filter(([key, cached]) => {
    const cachedTool = normalizedAgentToolName(cached.tool);
    if (referenceTools.has(cachedTool)) return true;
    try {
      const parsed = JSON.parse(key) as { args?: Record<string, unknown>; activeInstanceId?: string | null };
      const cachedId = resolveId(parsed.args?.instanceId, parsed.activeInstanceId ?? null);
      if (targetId && cachedId && targetId !== cachedId) return true;
      if (noFileChanges) return !stateReads.has(cachedTool);
      if (exactPaths && fileReads.has(cachedTool)) {
        const path = cachedTool === "readmemory" ? "SAKI.md" : relativePath(parsed.args?.path);
        return path !== null && !exactPaths.some((changed) => overlaps(path, changed));
      }
      if (exactPaths && cachedTool === "listfiles") {
        const directory = relativePath(parsed.args?.path);
        return directory !== null && directory !== "." && !exactPaths.some((changed) => overlaps(directory, changed));
      }
    } catch {
      // ignore
    }
    return false;
  });
}
