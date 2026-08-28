import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { classifyCommandRisk, findDangerousCommandReason } from "../../security.js";
import { sakiModelProfile } from "./model-profile.js";
import type { InstanceWithNode, JsonSchema, ParsedToolCall, SakiAgentRuntime, SakiToolSchema } from "./types.js";
import {
  booleanArg,
  effectiveSakiAgentPermissionMode,
  nullableStringArg,
  numericArg,
  objectValue,
  RouteError,
  stringArg,
  stripThinking,
  trimString
} from "./types.js";

const instanceLookupSchema = { type: "string", description: "Instance id or name. Omit to use the active instance." };
const relativePathSchema = { type: "string", description: "Path relative to the selected instance working directory." };
const visibleToolNoteSchema = {
  type: "string",
  description: "Optional short user-visible status. No hidden chain-of-thought."
};

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return {
    type: "object",
    properties: {
      note: visibleToolNoteSchema,
      ...properties
    },
    ...(required.length ? { required } : {}),
    additionalProperties: false
  };
}

export const sakiToolSchemas: SakiToolSchema[] = [
  { name: "listInstances", description: "List managed instances.", parameters: objectSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }) },
  { name: "describeInstance", description: "Show one instance configuration.", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["getInstance"] },
  { name: "instanceLogs", description: "Read recent instance logs.", parameters: objectSchema({ instanceId: instanceLookupSchema, lines: { type: "integer", minimum: 1, maximum: 500 } }) },
  { name: "listFiles", description: "List a directory. Use limit on large folders.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, limit: { type: "integer", minimum: 1, maximum: 1000 } }) },
  { name: "readFile", description: "Read a line window. Always pass startLine. Max 80 lines. Prefer searchFiles, outlineFile, or readSymbol first.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, lineCount: { type: "integer", minimum: 1, maximum: 80 } }, ["path"]), aliases: ["view_file", "viewFile", "read_file", "cat"] },
  { name: "writeFile", description: "Create a NEW file only. Do not overwrite existing files. Checkpointed.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, content: { type: "string" } }, ["path", "content"]), aliases: ["write_file", "write_to_file", "saveFile", "createFile"] },
  { name: "replaceInFile", description: "Replace one exact string. Prefer editLines when you have line numbers.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, oldText: { type: "string" }, newText: { type: "string" } }, ["path", "oldText", "newText"]), aliases: ["str_replace", "replace_file_content", "replace_in_file", "strReplace", "edit_file", "patch"] },
  { name: "editLines", description: "Replace a 1-based line range. Preferred edit tool. Checkpointed.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 0 }, replacement: { type: "string" } }, ["path", "startLine", "endLine", "replacement"]), aliases: ["editFileLines", "replaceLines", "edit_lines", "patchLines"] },
  { name: "mkdir", description: "Create a directory.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]) },
  { name: "deletePath", description: "Delete a path after approval. Checkpointed.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]), aliases: ["delete_path", "removeFile", "rm"] },
  { name: "renamePath", description: "Rename or move a path.", parameters: objectSchema({ instanceId: instanceLookupSchema, fromPath: relativePathSchema, toPath: relativePathSchema }, ["fromPath", "toPath"]), aliases: ["movePath", "mv", "rename_path"] },
  { name: "uploadBase64", description: "Upload a base64 file.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, contentBase64: { type: "string" } }, ["path", "contentBase64"]) },
  { name: "archivePaths", description: "Zip workspace paths. Prefer this over shell zip.", parameters: objectSchema({ instanceId: instanceLookupSchema, paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200, description: "Relative paths to compress." }, outputPath: { type: "string", description: "Optional output .zip path." } }, ["paths"]), aliases: ["archive", "compressPaths", "zipPaths"] },
  { name: "extractArchive", description: "Extract zip/rar/7z. Prefer this over shell unzip.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, outputPath: { type: "string", description: "Optional output directory." }, conflictPolicy: { type: "string", enum: ["overwrite", "skip"] } }, ["path"]), aliases: ["extract", "unzipArchive", "decompressArchive"] },
  { name: "runCommand", description: "Run a shell command in an isolated tab (reuses last shell). Medium/high risk needs approval. Not for live process stdin.", parameters: objectSchema({ instanceId: instanceLookupSchema, command: { type: "string" }, cwd: { type: "string" }, workingDirectory: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }, input: { type: "string" }, stdin: { type: "string" } }, ["command"]), aliases: ["executeCommand", "terminal", "shell", "run_command", "bash", "bashTool", "cmd", "exec"] },
  { name: "sendInput", description: "Type into the live instance process stdin (app prompts only). For shell commands use runCommand.", parameters: objectSchema({ instanceId: instanceLookupSchema, text: { type: "string" }, pressEnter: { type: "boolean" }, echo: { type: "boolean" } }, ["text"]), aliases: ["typeConsole", "consoleInput", "terminalInput", "sendStdin"] },
  { name: "sendCommand", description: "Alias of sendInput for the live process console. Prefer runCommand for shell work.", parameters: objectSchema({ instanceId: instanceLookupSchema, command: { type: "string" } }, ["command"]) },
  { name: "listShells", description: "List persistent shell tabs.", parameters: objectSchema({ instanceId: instanceLookupSchema }) },
  { name: "createShell", description: "Open a persistent shell tab. Returns shellId.", parameters: objectSchema({ instanceId: instanceLookupSchema, workingDirectory: { type: "string" } }) },
  { name: "sendShellInput", description: "Raw keystrokes to a persistent shell. Prefer runInShell for full commands.", parameters: objectSchema({ instanceId: instanceLookupSchema, shellId: { type: "string" }, text: { type: "string" }, pressEnter: { type: "boolean" } }, ["shellId", "text"]) },
  { name: "runInShell", description: "Run a command in a persistent shell by shellId.", parameters: objectSchema({ instanceId: instanceLookupSchema, shellId: { type: "string" }, command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 } }, ["shellId", "command"]) },
  { name: "instanceAction", description: "start/stop/restart/kill an instance. stop/restart/kill need approval.", parameters: objectSchema({ instanceId: instanceLookupSchema, action: { type: "string", enum: ["start", "stop", "restart", "kill"] } }, ["action"]) },
  { name: "updateInstanceSettings", description: "Update instance settings after approval.", parameters: objectSchema({ instanceId: instanceLookupSchema, name: { type: "string" }, workingDirectory: { type: "string" }, startCommand: { type: "string" }, stopCommand: { type: ["string", "null"] }, description: { type: ["string", "null"] }, autoStart: { type: "boolean" }, restartPolicy: { type: "string", enum: ["never", "on_failure", "always", "fixed_interval"] }, restartMaxRetries: { type: "integer", minimum: 0, maximum: 99 } }), aliases: ["setInstanceSettings", "updateInstance"] },
  { name: "searchAudit", description: "Search audit logs.", parameters: objectSchema({ query: { type: "string" } }, ["query"]) },
  { name: "listTasks", description: "List scheduled tasks.", parameters: objectSchema({ instanceId: instanceLookupSchema }) },
  { name: "createScheduledTask", description: "Create a scheduled task after approval.", parameters: objectSchema({ name: { type: "string" }, type: { type: "string", enum: ["run_command", "restart_instance", "stop_instance", "start_instance"] }, cron: { type: "string" }, instanceId: instanceLookupSchema, command: { type: "string" }, enabled: { type: "boolean" } }, ["name", "type", "cron"]), aliases: ["createTask", "setInstanceSchedule"] },
  { name: "updateScheduledTask", description: "Update a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["run_command", "restart_instance", "stop_instance", "start_instance"] }, cron: { type: "string" }, instanceId: instanceLookupSchema, command: { type: "string" }, enabled: { type: "boolean" } }, ["taskId"]), aliases: ["updateTask"] },
  { name: "deleteScheduledTask", description: "Delete a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]), aliases: ["deleteTask"] },
  { name: "runTask", description: "Run a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]) },
  { name: "taskRuns", description: "List recent scheduled task runs.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]) },
  { name: "searchFiles", description: "Regex search. Returns matches with 2 lines of context and line numbers.", parameters: objectSchema({ instanceId: instanceLookupSchema, pattern: { type: "string" }, path: { type: "string" }, include: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 80 } }, ["pattern"]), aliases: ["grep", "grepFiles", "searchCode", "codeSearch", "grep_search", "ripgrep", "grepTool"] },
  { name: "findFiles", description: "Glob file names. Skips node_modules.", parameters: objectSchema({ instanceId: instanceLookupSchema, pattern: { type: "string" }, path: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 1000 } }, ["pattern"]), aliases: ["glob", "globFiles", "findByName", "find_by_name", "globTool", "locateFiles"] },
  { name: "outlineFile", description: "File structure with line numbers. Do not read the whole file first.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]), aliases: ["fileOutline", "outline", "inspectStructure"] },
  { name: "findSymbols", description: "Go-to-definition by symbol name.", parameters: objectSchema({ instanceId: instanceLookupSchema, query: { type: "string" }, path: { type: "string" } }, ["query"]), aliases: ["findDefinition", "findSymbol", "gotoDefinition", "symbolSearch"] },
  { name: "searchWeb", description: "Search the public web.", parameters: objectSchema({ query: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 8 } }, ["query"]), aliases: ["webSearch"] },
  { name: "browse", description: "Fetch one public web page.", parameters: objectSchema({ url: { type: "string" } }, ["url"]), aliases: ["browseUrl", "readUrl", "fetchPage"] },
  { name: "crawl", description: "Crawl same-site pages. Prefer searchWeb + browse unless you need multiple pages.", parameters: objectSchema({ url: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 6 }, maxDepth: { type: "integer", minimum: 0, maximum: 2 } }, ["url"]), aliases: ["crawlWeb", "crawlSite"] },
  { name: "researchWeb", description: "Search and fetch top pages. Prefer searchWeb + browse for 1-2 URLs.", parameters: objectSchema({ query: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 4 } }, ["query"]), aliases: ["webResearch"] },
  { name: "listSkills", description: "Prefer searchSkills. Lists skill ids only.", parameters: objectSchema({}) },
  { name: "searchSkills", description: "Search skills by task keywords. Call early for domain procedures.", parameters: objectSchema({ query: { type: "string" } }, ["query"]), aliases: ["findSkills", "matchSkills"] },
  { name: "readSkill", description: "Load full skill instructions by id after searchSkills.", parameters: objectSchema({ skillId: { type: "string" } }, ["skillId"]), aliases: ["loadSkill", "useSkill", "getSkill", "applySkill"] },
  { name: "readMemory", description: "Read SAKI.md project memory.", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["getMemory", "loadMemory"] },
  { name: "writeMemory", description: "Overwrite SAKI.md project memory with full file content.", parameters: objectSchema({ instanceId: instanceLookupSchema, content: { type: "string" } }, ["content"]), aliases: ["updateMemory", "saveMemory"] },
  { name: "reportProgress", description: "Short user-visible status. Not hidden chain-of-thought.", parameters: objectSchema({ text: { type: "string" } }, ["text"]), aliases: ["progress", "statusUpdate"] },
  { name: "diagnoseCode", description: "Fast syntax/typecheck. Call after edits before respond. Never uses npm test.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, command: { type: "string" } }), aliases: ["diagnostics", "checkTypes", "typecheck", "lintCode", "diagnose_code", "lint"] },
  { name: "manageTodos", description: "Markdown TODO list with [x]/[ ] for multi-step work.", parameters: objectSchema({ todos: { type: "string" } }, ["todos"]), aliases: ["setTodos", "todos", "updateTodos", "manage_todos", "todoTool", "taskList"] },
  { name: "spawnTask", description: "Research-only sub-agent. Inspect, do not edit. Use only for broad multi-file exploration.", parameters: objectSchema({ instanceId: instanceLookupSchema, task: { type: "string" }, maxSteps: { type: "integer", minimum: 1, maximum: 10 } }, ["task"]), aliases: ["subAgent", "delegate", "runSubTask"] },
  { name: "batchEdit", description: "Apply multiple file edits in one step. Checkpointed.", parameters: objectSchema({ instanceId: instanceLookupSchema, edits: { type: "array", items: { type: "object", properties: { path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 0 }, replacement: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path"] } } }, ["edits"]), aliases: ["batch_edit", "applyPatches", "multiFileEdit", "batch_patch"] },
  { name: "statFile", description: "Metadata only: exists, size, line count, mtime. Does not load file content.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]), aliases: ["fileInfo", "stat_file", "file_info", "inspectPath", "stat"] },
  { name: "gitStatus", description: "Git status (branch, staged, modified, untracked).", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["git_status", "gitStatusTool"] },
  { name: "gitDiff", description: "Git unified diff of uncommitted changes.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, staged: { type: "boolean" } }), aliases: ["git_diff", "gitDiffTool", "diff"] },
  { name: "getEnvironmentInfo", description: "Cached OS and runtime versions. Call only when you need them.", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["envInfo", "get_environment_info", "systemInfo", "env_info"] },
  { name: "readSymbol", description: "Read one function/class/type body by name.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, symbol: { type: "string" } }, ["path", "symbol"]), aliases: ["viewSymbol", "getSymbol", "inspectSymbol", "viewFunction", "read_symbol", "extractSymbol"] },
  { name: "plan", description: "Present a step plan before executing a complex task.", parameters: objectSchema({ steps: { type: "string" }, summary: { type: "string" } }, ["steps", "summary"]) },
  { name: "respond", description: "Return the final user-facing answer.", parameters: objectSchema({ text: { type: "string" } }, ["text"]) }
];

export const sakiToolRegistry = new Map<string, SakiToolSchema>();
for (const schema of sakiToolSchemas) {
  sakiToolRegistry.set(schema.name.toLowerCase(), schema);
  for (const alias of schema.aliases ?? []) {
    sakiToolRegistry.set(alias.toLowerCase(), schema);
  }
}

export function canonicalToolSchema(name: string): SakiToolSchema | null {
  return sakiToolRegistry.get(name.trim().toLowerCase()) ?? null;
}

const advertisedToolSchemaStore = new AsyncLocalStorage<SakiToolSchema[]>();

export function withAdvertisedSakiToolSchemas<T>(schemas: SakiToolSchema[], fn: () => T): T {
  return advertisedToolSchemaStore.run(schemas, fn);
}

export function advertisedSakiToolSchemas(): SakiToolSchema[] {
  return advertisedToolSchemaStore.getStore() ?? sakiToolSchemas;
}

export function openAiToolSchemas(): Array<{ type: "function"; function: { name: string; description: string; parameters: JsonSchema } }> {
  return advertisedSakiToolSchemas().map((schema) => ({
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters
    }
  }));
}

export function anthropicToolSchemas(): Array<{ name: string; description: string; input_schema: JsonSchema }> {
  return advertisedSakiToolSchemas().map((schema) => ({
    name: schema.name,
    description: schema.description,
    input_schema: schema.parameters
  }));
}

const sakiToolSchemaByName = new Map(sakiToolSchemas.map((schema) => [schema.name, schema]));

const sakiCoreToolNames = [
  "listFiles",
  "readFile",
  "writeFile",
  "replaceInFile",
  "editLines",
  "mkdir",
  "deletePath",
  "renamePath",
  "searchFiles",
  "findFiles",
  "outlineFile",
  "findSymbols",
  "readSymbol",
  "statFile",
  "runCommand",
  "diagnoseCode",
  "searchSkills",
  "readSkill",
  "batchEdit",
  "reportProgress",
  "respond",
  "gitStatus",
  "gitDiff",
  "manageTodos",
  "instanceLogs",
  "plan"
] as const;

const sakiResearchToolNames = new Set([
  "listfiles",
  "readfile",
  "searchfiles",
  "findfiles",
  "outlinefile",
  "findsymbols",
  "readsymbol",
  "statfile",
  "searchskills",
  "readskill",
  "reportprogress",
  "respond",
  "searchweb",
  "browse",
  "instancelogs",
  "describeinstance"
]);

type SakiToolGroupId = "instances" | "liveTerminal" | "schedule" | "web" | "webDeep" | "archive" | "memory" | "audit" | "env" | "research";

const sakiToolGroups: Record<SakiToolGroupId, { names: string[]; hint: RegExp }> = {
  instances: {
    names: ["listInstances", "describeInstance", "instanceAction", "updateInstanceSettings"],
    hint: /\b(instance|start command|stop command|kill instance)\b|实例|节点|启动|停止|重启|杀死|listInstances|instanceAction/i
  },
  liveTerminal: {
    names: ["sendInput", "sendCommand", "listShells", "createShell", "sendShellInput", "runInShell"],
    hint: /\b(stdin|pty|interactive|password|console prompt|shell tab|sendInput|createShell|runInShell)\b|交互|密码|终端输入|进程控制台/
  },
  schedule: {
    names: ["listTasks", "createScheduledTask", "updateScheduledTask", "deleteScheduledTask", "runTask", "taskRuns"],
    hint: /\b(cron|schedule|scheduled task)\b|定时|计划任务/
  },
  web: {
    names: ["searchWeb", "browse"],
    hint: /\bhttps?:\/\/|www\.|\b(web search|search the web|browse|docs?)\b|官网|文档|搜索网页/
  },
  webDeep: {
    names: ["crawl", "researchWeb"],
    hint: /\b(crawl|research web|site crawl)\b|爬取|调研网站/
  },
  archive: {
    names: ["archivePaths", "extractArchive", "uploadBase64"],
    hint: /\b(zip|unzip|rar|7z|archive|compress|base64)\b|解压|压缩|上传文件/
  },
  memory: {
    names: ["readMemory", "writeMemory"],
    hint: /\bSAKI\.md\b|\b(memory|remember|preference)\b|记住|记忆|偏好/
  },
  audit: {
    names: ["searchAudit"],
    hint: /\baudit\b|审计/
  },
  env: {
    names: ["getEnvironmentInfo"],
    hint: /\b(uname|runtime version|node -v|python --version|environment info|system info)\b|系统信息|环境信息/
  },
  research: {
    names: ["spawnTask"],
    hint: /\b(spawnTask|sub-agent|subagent|delegate|parallel explor|explore the (code|repo|codebase)|broad (search|explor)|entire (codebase|repo))\b|子代理|并行探索|探索代码|整个代码库|全库/
  }
};

function schemasNamed(names: Iterable<string>): SakiToolSchema[] {
  const seen = new Set<string>();
  const schemas: SakiToolSchema[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    const schema = sakiToolSchemaByName.get(name);
    if (!schema) continue;
    seen.add(name);
    schemas.push(schema);
  }
  return schemas;
}

export function toolSchemasForRuntime(runtime: SakiAgentRuntime): SakiToolSchema[] {
  if (runtime.toolProfile === "research") {
    const research = schemasNamed([...sakiResearchToolNames].map((name) => canonicalToolSchema(name)?.name ?? name)).filter((schema) => {
      if (!runtime.config.searchEnabled && (schema.name === "searchWeb" || schema.name === "browse")) return false;
      return true;
    });
    return capAdvertisedToolSchemas(research, sakiModelProfile(runtime.config.provider, runtime.config.model));
  }

  const hint = [
    runtime.input.message,
    runtime.input.contextTitle,
    runtime.input.panelError,
    ...(runtime.usedToolNames ?? [])
  ]
    .filter(Boolean)
    .join("\n");

  const names = new Set<string>(sakiCoreToolNames);
  if (runtime.config.searchEnabled) {
    names.add("searchWeb");
    names.add("browse");
  }

  for (const group of Object.values(sakiToolGroups)) {
    const usedInGroup = (runtime.usedToolNames ?? []).some((used) => {
      const canonical = canonicalToolSchema(used)?.name;
      return Boolean(canonical && group.names.includes(canonical));
    });
    if (usedInGroup || group.hint.test(hint)) {
      for (const name of group.names) names.add(name);
    }
  }

  if (!runtime.config.searchEnabled) {
    names.delete("searchWeb");
    names.delete("browse");
    names.delete("crawl");
    names.delete("researchWeb");
  }

  const permissionMode = effectiveSakiAgentPermissionMode(runtime.input);
  if (permissionMode === "plan") {
    for (const blocked of sakiPlanBlockedToolNames) {
      const canonical = canonicalToolSchema(blocked)?.name;
      if (canonical && canonical !== "runCommand") names.delete(canonical);
    }
    for (const auto of sakiAutoAcceptedFileToolNames) {
      const canonical = canonicalToolSchema(auto)?.name;
      if (canonical) names.delete(canonical);
    }
  }

  if (runtime.kind === "watch") {
    for (const name of [...names]) {
      if (!watchAgentToolAllowlist.has(name.toLowerCase())) names.delete(name);
    }
    if (runtime.watchMode === "diagnose_only") {
      for (const mutating of watchMutatingToolNames) {
        const canonical = canonicalToolSchema(mutating)?.name;
        if (canonical) names.delete(canonical);
      }
    }
  }

  names.add("respond");
  names.add("reportProgress");
  return capAdvertisedToolSchemas(schemasNamed(names), sakiModelProfile(runtime.config.provider, runtime.config.model));
}

function capAdvertisedToolSchemas(schemas: SakiToolSchema[], maxTools: ReturnType<typeof sakiModelProfile>): SakiToolSchema[] {
  if (schemas.length <= maxTools.maxAdvertisedTools) return schemas;
  const essential = new Set(["respond", "reportProgress", "readFile", "searchFiles", "findFiles", "editLines", "replaceInFile", "writeFile", "diagnoseCode", "runCommand", "listFiles"]);
  const kept: SakiToolSchema[] = [];
  const rest: SakiToolSchema[] = [];
  for (const schema of schemas) {
    if (essential.has(schema.name)) kept.push(schema);
    else rest.push(schema);
  }
  const room = Math.max(0, maxTools.maxAdvertisedTools - kept.length);
  return [...kept, ...rest.slice(0, room)];
}

export function assertToolProfileAllowsTool(runtime: SakiAgentRuntime, toolName: string): void {
  if (runtime.toolProfile !== "research") return;
  const lower = normalizedAgentToolName(toolName);
  if (!sakiResearchToolNames.has(lower)) {
    throw new RouteError("Research sub-agents can only inspect. They cannot edit, diagnose, or spawn further agents.", 403);
  }
}

export function escapeBareControlCharsInJsonStrings(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }
    if (char === "\n") {
      output += "\\n";
      continue;
    }
    if (char === "\r") {
      output += "\\r";
      continue;
    }
    if (char === "\t") {
      output += "\\t";
      continue;
    }
    const code = char.charCodeAt(0);
    output += code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
  }
  return output;
}

export function parseJsonTolerant(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (firstError) {
    const repaired = escapeBareControlCharsInJsonStrings(text);
    if (repaired !== text) {
      try {
        return JSON.parse(repaired) as unknown;
      } catch {
        // Fall through to the original parse error for a clearer failure path.
      }
    }
    throw firstError;
  }
}

export function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return {};
  try {
    return parseJsonTolerant(text);
  } catch {
    throw new RouteError("Tool arguments must be valid JSON.", 400);
  }
}

const parameterAliases: Record<string, Record<string, string>> = {
  writefile: { text: "content", body: "content", data: "content", fileContent: "content", file_content: "content", source: "content" },
  replaceinfile: { find: "oldText", search: "oldText", match: "oldText", replace: "newText", with: "newText", replacement: "newText" },
  editlines: { lines: "replacement", content: "replacement", text: "replacement", newContent: "replacement", new_content: "replacement" },
  readfile: { file: "path", filename: "path", filepath: "path" },
  runcommand: { cmd: "command", shell: "command", script: "command" },
  sendinput: { value: "text", input: "text", content: "text" },
  listfiles: { dir: "path", directory: "path", folder: "path" },
  mkdir: { dir: "path", directory: "path", folder: "path" },
  deletepath: { file: "path", filepath: "path" },
  renamepath: { source: "fromPath", src: "fromPath", dest: "toPath", destination: "toPath" },
};

function applyParameterAliases(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const aliases = parameterAliases[toolName.toLowerCase()];
  if (!aliases) return args;
  const result = { ...args };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in result && !(canonical in result)) {
      result[canonical] = result[alias];
      delete result[alias];
    }
  }
  return result;
}

export function normalizeStructuredToolCall(raw: unknown): ParsedToolCall {
  const item = objectValue(raw);
  if (!item) throw new RouteError("Tool call must be an object.", 400);
  const fn = objectValue(item.function);
  const name = trimString(item.name) || trimString(item.tool) || trimString(fn?.name);
  const schema = canonicalToolSchema(name);
  if (!schema) throw new RouteError(`Unknown tool '${name || "(missing)"}'.`, 400);
  const rawArgs = parseJsonMaybe(item.arguments ?? item.args ?? item.input ?? fn?.arguments ?? {});
  let args = objectValue(rawArgs);
  if (!args) throw new RouteError(`Arguments for ${schema.name} must be a JSON object.`, 400);
  args = applyParameterAliases(schema.name, args);
  const parameterObject = objectValue(schema.parameters);
  const required = Array.isArray(parameterObject?.required) ? parameterObject.required.map(trimString).filter(Boolean) : [];
  const allowEmptyRequired = new Set(["content", "newText", "replacement", "text"]);
  for (const key of required) {
    if (!(key in args) || args[key] === undefined || args[key] === null || (args[key] === "" && !allowEmptyRequired.has(key))) {
      throw new RouteError(`${schema.name} requires '${key}'.`, 400);
    }
  }
  const id = trimString(item.id);
  return { ...(id ? { id } : {}), name: schema.name, args };
}

export function shorthandPrimaryArgumentKey(toolName: string): string | null {
  const lower = toolName.toLowerCase();
  if (lower === "listinstances") return "query";
  if (lower === "describeinstance" || lower === "instancelogs" || lower === "listtasks") return "instanceId";
  if (lower === "listfiles" || lower === "readfile" || lower === "mkdir" || lower === "deletepath" || lower === "statfile" || lower === "fileinfo" || lower === "inspectpath" || lower === "gitdiff" || lower === "diff") return "path";
  if (lower === "batchedit" || lower === "applypatches" || lower === "multifileedit") return "edits";
  if (lower === "runcommand") return "command";
  if (lower === "sendinput" || lower === "reportprogress" || lower === "respond") return "text";
  if (lower === "sendcommand") return "command";
  if (lower === "instanceaction") return "action";
  if (lower === "searchaudit" || lower === "searchweb" || lower === "researchweb" || lower === "searchskills") return "query";
  if (lower === "browse" || lower === "crawl") return "url";
  if (lower === "readskill") return "skillId";
  if (lower === "deletescheduledtask" || lower === "runtask" || lower === "taskruns" || lower === "updatescheduledtask") return "taskId";
  return null;
}

export function shorthandPositionalArguments(toolName: string, values: unknown[]): Record<string, unknown> | null {
  const lower = toolName.toLowerCase();
  if (lower === "readfile") return { path: values[0], startLine: values[1], lineCount: values[2] };
  if (lower === "listfiles") return { path: values[0], limit: values[1] };
  if (lower === "instancelogs") return { instanceId: values[0], lines: values[1] };
  if (lower === "runcommand") return { command: values[0], timeoutMs: values[1], input: values[2], cwd: values[3] };
  if (lower === "sendinput") return { text: values[0], pressEnter: values[1], echo: values[2] };
  if (lower === "readsymbol" || lower === "viewsymbol" || lower === "getsymbol") return { path: values[0], symbol: values[1] };
  if (lower === "searchweb") return { query: values[0], maxResults: values[1] };
  if (lower === "crawl") return { url: values[0], maxPages: values[1], maxDepth: values[2] };
  if (lower === "researchweb") return { query: values[0], maxPages: values[1] };
  const primary = shorthandPrimaryArgumentKey(toolName);
  return primary ? { [primary]: values[0] } : null;
}

export function compactShorthandArgs(args: Record<string, unknown>, note: string): Record<string, unknown> {
  const result = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
  if (note && !("note" in result)) result.note = note;
  return result;
}

export function shorthandToolArguments(toolName: string, value: unknown, note: string): Record<string, unknown>[] {
  const primary = shorthandPrimaryArgumentKey(toolName);
  if (Array.isArray(value)) {
    if (value.every((item) => objectValue(item) && !Array.isArray(item))) {
      return value.map((item) => compactShorthandArgs(objectValue(item) ?? {}, note));
    }
    if (primary && value.length > 1 && value.every((item) => typeof item === "string")) {
      return value.map((item) => compactShorthandArgs({ [primary]: item }, note));
    }
    const positional = shorthandPositionalArguments(toolName, value);
    return positional ? [compactShorthandArgs(positional, note)] : [];
  }

  const objectArgs = objectValue(value);
  if (objectArgs && !Array.isArray(value)) {
    if (primary && Array.isArray(objectArgs[primary])) {
      const values = objectArgs[primary];
      const base = { ...objectArgs };
      delete base[primary];
      return values.map((item) => compactShorthandArgs({ ...base, [primary]: item }, note));
    }
    return [compactShorthandArgs(objectArgs, note)];
  }

  if (primary) return [compactShorthandArgs({ [primary]: value }, note)];
  return [];
}

export function parseShorthandToolCalls(root: Record<string, unknown>): ParsedToolCall[] {
  const note = stringArg(root, "note") || stringArg(root, "message");
  const calls: ParsedToolCall[] = [];
  for (const [key, value] of Object.entries(root)) {
    const schema = canonicalToolSchema(key);
    if (!schema) continue;
    for (const args of shorthandToolArguments(schema.name, value, note)) {
      calls.push(normalizeStructuredToolCall({ name: schema.name, arguments: args }));
    }
  }
  return calls;
}

export function extractAllBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          results.push(text.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return results;
}

export function repairTruncatedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const slice = text.slice(start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const char = slice[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { depth += 1; stack.push("}"); }
    if (char === "[") { depth += 1; stack.push("]"); }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (stack.length > 0) stack.pop();
    }
  }
  if (depth <= 0) return null;
  let result = slice;
  if (inString) result += '"';
  while (stack.length > 0) {
    result += stack.pop();
  }
  return result;
}

function cleanXmlParamValue(raw: string): string {
  let val = raw;
  const cdataMatch = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch) return cdataMatch[1] ?? "";
  if (val.includes("&")) {
    val = val
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return val.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function parseQwenArgPairs(inner: string): Record<string, unknown> | null {
  const pairs = [...inner.matchAll(/<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi)];
  if (pairs.length === 0) return null;
  const args: Record<string, unknown> = {};
  for (const match of pairs) {
    const key = match[1]?.trim();
    if (key) args[key] = cleanXmlParamValue(match[2] ?? "");
  }
  return args;
}

function parseXmlParameters(inner: string): Record<string, unknown> {
  const qwenArgs = parseQwenArgPairs(inner);
  if (qwenArgs) return qwenArgs;

  const args: Record<string, unknown> = {};

  const paramAttrRe = /<(?:parameter|arg|argument)\s+name=["']([^"']+)["']>([\s\S]*?)<\/(?:parameter|arg|argument)>/gi;
  let hasParamAttr = false;
  for (const match of inner.matchAll(paramAttrRe)) {
    hasParamAttr = true;
    const key = match[1]?.trim();
    if (key) {
      args[key] = cleanXmlParamValue(match[2] ?? "");
    }
  }
  if (hasParamAttr) return args;

  const tagRe = /<([a-zA-Z0-9_-]+)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/gi;
  for (const match of inner.matchAll(tagRe)) {
    const key = match[1]?.trim();
    if (!key) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey === "name" || lowerKey === "tool" || lowerKey === "function" || lowerKey === "tool_call" || lowerKey === "invoke") {
      continue;
    }
    args[key] = cleanXmlParamValue(match[2] ?? "");
  }
  return args;
}

export function parseXmlToolCalls(source: string): ParsedToolCall[] | null {
  const stripped = stripThinking(source).trim();
  const toolTagRe = /<(tool_call|invoke)(?:\s+([^>]*))?>([\s\S]*?)<\/\1>/gi;
  const matches = [...stripped.matchAll(toolTagRe)];
  if (matches.length === 0) return null;

  const calls: ParsedToolCall[] = [];

  for (const match of matches) {
    const attrs = match[2] ?? "";
    const inner = (match[3] ?? "").trim();
    if (!inner && !attrs) continue;

    let toolName = "";
    const nameAttrMatch = attrs.match(/\b(?:name|tool|function)=["']([^"']+)["']/i);
    if (nameAttrMatch) {
      toolName = nameAttrMatch[1]?.trim() ?? "";
    }
    if (!toolName) {
      const nameTagMatch = inner.match(/<(?:name|tool|function)>([\s\S]*?)<\/(?:name|tool|function)>/i);
      if (nameTagMatch) {
        toolName = nameTagMatch[1]?.trim() ?? "";
      }
    }
    if (!toolName) {
      const firstLine = inner.split(/\r?\n/, 1)[0]?.trim() ?? "";
      if (firstLine && !firstLine.startsWith("<") && !firstLine.startsWith("{") && canonicalToolSchema(firstLine)) {
        toolName = firstLine;
      }
    }

    if (inner.startsWith("{")) {
      try {
        const parsed = parseJsonTolerant(inner);
        const item = objectValue(parsed);
        if (item && ("name" in item || "tool" in item || "function" in item)) {
          calls.push(normalizeStructuredToolCall(item));
          continue;
        }
      } catch {
        // Fall back to XML parameter parsing
      }
    }

    if (toolName) {
      const xmlArgs = parseXmlParameters(inner);
      try {
        calls.push(normalizeStructuredToolCall({ name: toolName, arguments: xmlArgs }));
        continue;
      } catch {
        // Fall back to JSON extraction inside inner
      }
    }

    try {
      const balanced = extractBalancedJsonObject(inner);
      if (balanced) {
        const parsed = parseJsonTolerant(balanced);
        const item = objectValue(parsed);
        if (item && ("name" in item || "tool" in item || "function" in item)) {
          calls.push(normalizeStructuredToolCall(item));
          continue;
        }
      }
    } catch {}

    try {
      const balancedList = extractAllBalancedJsonObjects(inner);
      for (const balanced of balancedList) {
        try {
          const parsed = parseJsonTolerant(balanced);
          const item = objectValue(parsed);
          if (item && ("name" in item || "tool" in item || "function" in item)) {
            calls.push(normalizeStructuredToolCall(item));
            break;
          }
        } catch {
          continue;
        }
      }
    } catch {}
  }

  return calls.length > 0 ? calls : null;
}

export function stripJsonFences(value: string): string {
  const trimmed = stripThinking(value).trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export function extractBalancedJsonObject(text: string): string | null {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function extractJsonPayload(source: string): unknown {
  const text = stripJsonFences(source);
  try {
    return parseJsonTolerant(text);
  } catch {
    const balanced = extractBalancedJsonObject(text);
    if (balanced) {
      return parseJsonTolerant(balanced);
    }
    throw new RouteError("Model response did not contain strict JSON tool calls.", 400);
  }
}

function stripAllCodeFences(source: string): string {
  return stripThinking(source).replace(/```(?:xml|json|tool|txt|typescript)?\s*([\s\S]*?)```/gi, "$1");
}

function parseHermesFunctionCalls(source: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const tagRe = /<function=([^>\s]+)>([\s\S]*?)<\/function>/gi;
  for (const match of source.matchAll(tagRe)) {
    const toolName = match[1]?.trim() ?? "";
    if (!toolName || !canonicalToolSchema(toolName)) continue;
    const inner = match[2] ?? "";
    const paramRe = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi;
    const args: Record<string, unknown> = {};
    for (const param of inner.matchAll(paramRe)) {
      const key = param[1]?.trim();
      if (key) args[key] = cleanXmlParamValue(param[2] ?? "");
    }
    try {
      calls.push(normalizeStructuredToolCall({ name: toolName, arguments: Object.keys(args).length ? args : parseXmlParameters(inner) }));
    } catch {
      // Skip malformed Hermes blocks.
    }
  }
  return calls;
}

function parseSpecialTokenToolCalls(source: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const qwenRe = /(?:✿FUNCTION✿|<\|tool_call\|>)\s*([A-Za-z0-9_]+)\s*(?:✿ARGS✿|<\|tool_call_argument\|>)?\s*([\s\S]*?)(?=(?:✿FUNCTION✿|<\|tool_call\|>|$))/gi;
  for (const match of source.matchAll(qwenRe)) {
    const toolName = match[1]?.trim() ?? "";
    if (!canonicalToolSchema(toolName)) continue;
    const rawArgs = (match[2] ?? "").replace(/<\|tool_call\|>/g, "").trim();
    let args: unknown = {};
    if (rawArgs.startsWith("{")) {
      try {
        args = parseJsonTolerant(extractBalancedJsonObject(rawArgs) || rawArgs);
      } catch {
        args = {};
      }
    }
    try {
      calls.push(normalizeStructuredToolCall({ name: toolName, arguments: args }));
    } catch {
      // Skip malformed special-token blocks.
    }
  }
  return calls;
}

export function parseAnyToolCalls(source: string): ParsedToolCall[] {
  const prepared = stripAllCodeFences(source);
  try {
    const xmlCalls = parseXmlToolCalls(prepared);
    if (xmlCalls?.length) return xmlCalls;
  } catch {
    // Continue with looser parsers.
  }

  const hermes = parseHermesFunctionCalls(prepared);
  if (hermes.length) return hermes;

  const special = parseSpecialTokenToolCalls(prepared);
  if (special.length) return special;

  const jsonCalls: ParsedToolCall[] = [];
  for (const block of extractAllBalancedJsonObjects(prepared)) {
    try {
      const parsed = parseJsonTolerant(block);
      const item = objectValue(parsed);
      if (!item) continue;
      const fn = objectValue(item.function);
      const name = trimString(item.name) || trimString(item.tool) || trimString(fn?.name);
      if (!name || !canonicalToolSchema(name)) continue;
      jsonCalls.push(normalizeStructuredToolCall(item));
    } catch {
      continue;
    }
  }
  if (jsonCalls.length) return jsonCalls;

  try {
    return parseStructuredToolCalls(prepared);
  } catch {
    const repaired = repairTruncatedJson(prepared);
    if (repaired) {
      try {
        return parseStructuredToolCalls(repaired);
      } catch {
        return [];
      }
    }
    return [];
  }
}

export function parseStructuredToolCalls(source: string): ParsedToolCall[] {
  const xmlCalls = parseXmlToolCalls(source);
  if (xmlCalls) return xmlCalls;

  const payload = extractJsonPayload(source);
  const root = objectValue(payload);
  if (!root) throw new RouteError("Model response must contain tool calls in XML or JSON format.", 400);
  const calls =
    Array.isArray(root.tool_calls)
      ? root.tool_calls
      : Array.isArray(root.toolCalls)
        ? root.toolCalls
        : Array.isArray(root.tools)
          ? root.tools
          : null;
  if (calls) return calls.map(normalizeStructuredToolCall);
  if ("name" in root || "tool" in root || "function" in root) return [normalizeStructuredToolCall(root)];
  const shorthandCalls = parseShorthandToolCalls(root);
  if (shorthandCalls.length) return shorthandCalls;
  throw new RouteError("Model response must contain tool calls in XML or JSON format.", 400);
}

export function toolArgs(call: ParsedToolCall): Record<string, unknown> {
  if (Array.isArray(call.args)) {
    throw new RouteError("Legacy text tool calls are no longer accepted. Return tool calls in XML or JSON format.", 400);
  }
  return call.args;
}

export const sakiReadOnlyToolNames = new Set([
  "listinstances",
  "describeinstance",
  "instancelogs",
  "listfiles",
  "readfile",
  "findfiles",
  "searchfiles",
  "outlinefile",
  "fileoutline",
  "outline",
  "findsymbols",
  "finddefinition",
  "findsymbol",
  "gotodefinition",
  "symbolsearch",
  "diagnosecode",
  "diagnostics",
  "checktypes",
  "typecheck",
  "lintcode",
  "managetodos",
  "settodos",
  "todos",
  "updatetodos",
  "searchaudit",
  "listtasks",
  "plan",
  "taskruns",
  "searchweb",
  "spawntask",
  "browse",
  "crawl",
  "researchweb",
  "listskills",
  "searchskills",
  "findskills",
  "matchskills",
  "readskill",
  "loadskill",
  "useskill",
  "getskill",
  "applyskill",
  "readmemory",
  "statfile",
  "fileinfo",
  "stat",
  "inspectpath",
  "gitstatus",
  "gitdiff",
  "diff",
  "getenvironmentinfo",
  "readsymbol",
  "viewsymbol",
  "getsymbol",
  "inspectsymbol",
  "viewfunction",
  "reportprogress",
  "respond"
]);

export const sakiAutoAcceptedFileToolNames = new Set([
  "writefile",
  "replaceinfile",
  "editlines",
  "batchedit",
  "applypatches",
  "multifileedit",
  "mkdir",
  "renamepath",
  "uploadbase64",
  "archivepaths",
  "extractarchive",
  "writememory"
]);

export const sakiPlanBlockedToolNames = new Set([
  ...sakiAutoAcceptedFileToolNames,
  "deletepath",
  "sendinput",
  "sendcommand",
  "instanceaction",
  "updateinstancesettings",
  "createscheduledtask",
  "updatescheduledtask",
  "deletescheduledtask",
  "runtask"
]);

export function normalizedAgentToolName(toolName: string): string {
  return (canonicalToolSchema(toolName)?.name ?? toolName).toLowerCase();
}

export function isSakiReadOnlyAgentTool(toolName: string): boolean {
  return sakiReadOnlyToolNames.has(normalizedAgentToolName(toolName));
}

export const watchAgentToolAllowlist = new Set([
  "describeinstance",
  "instancelogs",
  "listfiles",
  "readfile",
  "searchfiles",
  "findfiles",
  "outlinefile",
  "findsymbols",
  "readsymbol",
  "statfile",
  "getenvironmentinfo",
  "listskills",
  "searchskills",
  "readskill",
  "readmemory",
  "reportprogress",
  "managetodos",
  "plan",
  "respond",
  "writefile",
  "replaceinfile",
  "editlines"
]);

export const watchMutatingToolNames = new Set([
  "writefile",
  "replaceinfile",
  "editlines",
  "batchedit"
]);

export function assertWatchToolAllowed(runtime: SakiAgentRuntime, toolName: string, args: Record<string, unknown>): void {
  if (runtime.kind !== "watch") return;
  const lower = normalizedAgentToolName(toolName);
  if (!watchAgentToolAllowlist.has(lower)) {
    throw new RouteError("Watch mode cannot use this tool. Shell, deletes, and instance lifecycle changes are blocked.", 403);
  }
  if (runtime.watchMode === "diagnose_only" && watchMutatingToolNames.has(lower)) {
    throw new RouteError("Watch policy is diagnose-only. File edits are blocked for this incident.", 403);
  }
  void args;
}

export function assertSakiPermissionModeAllowsTool(
  runtime: SakiAgentRuntime,
  toolName: string,
  args: Record<string, unknown>
): void {
  const lower = normalizedAgentToolName(toolName);
  const permissionMode = effectiveSakiAgentPermissionMode(runtime.input);
  if (permissionMode !== "plan") return;

  if (sakiPlanBlockedToolNames.has(lower)) {
    throw new RouteError("Plan mode can inspect the workspace and propose a plan, but it cannot change files, settings, tasks, or instance state. Switch to Auto accept edits, Ask, or Bypass to execute changes.", 403);
  }

  if (lower === "runcommand") {
    const commandRisk = classifyCommandRisk(stringArg(args, "command"));
    if (commandRisk.risk !== "low") {
      throw new RouteError("Plan mode only permits low-risk inspection commands. Switch permission mode before running commands that can modify state.", 403);
    }
  }
}

export function isApprovalTool(toolName: string, args: Record<string, unknown>): boolean {
  const lower = normalizedAgentToolName(toolName);
  if (["deletepath", "updateinstancesettings", "createscheduledtask", "updatescheduledtask", "deletescheduledtask", "runtask"].includes(lower)) {
    return true;
  }
  if (lower === "runcommand") {
    return classifyCommandRisk(stringArg(args, "command")).risk !== "low";
  }
  if (lower === "instanceaction") {
    const action = stringArg(args, "action").toLowerCase();
    return action === "stop" || action === "restart" || action === "kill";
  }
  return false;
}

export function shouldRequestSakiApproval(runtime: SakiAgentRuntime, toolName: string, args: Record<string, unknown>): boolean {
  const lower = normalizedAgentToolName(toolName);
  const permissionMode = effectiveSakiAgentPermissionMode(runtime.input);

  if (permissionMode === "bypassPermissions" || permissionMode === "plan" || isSakiReadOnlyAgentTool(lower)) {
    return false;
  }

  if (permissionMode === "ask") {
    return lower !== "respond" && lower !== "reportprogress";
  }

  if (permissionMode === "acceptEdits") {
    if (sakiAutoAcceptedFileToolNames.has(lower)) return false;
    if (lower === "runcommand" || lower === "sendinput" || lower === "sendcommand" || lower === "instanceaction") {
      return true;
    }
  }

  return isApprovalTool(lower, args);
}

export function instanceSettingsSnapshot(instance: InstanceWithNode): Prisma.InstanceUpdateInput {
  return {
    name: instance.name,
    workingDirectory: instance.workingDirectory,
    startCommand: instance.startCommand,
    stopCommand: instance.stopCommand,
    description: instance.description,
    autoStart: instance.autoStart,
    restartPolicy: instance.restartPolicy,
    restartMaxRetries: instance.restartMaxRetries
  };
}

export function normalizeWorkingDirectoryForAgent(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) throw new RouteError("workingDirectory cannot be empty.", 400);
  if (path.isAbsolute(normalized) || normalized.split("/").some((part) => part === "..")) {
    throw new RouteError("Saki can only set instance working directories inside the daemon workspace.", 400);
  }
  return normalized;
}

export function buildInstanceSettingsPatch(instance: InstanceWithNode, args: Record<string, unknown>): { patch: Prisma.InstanceUpdateInput; preview: Record<string, unknown> } {
  const patch: Prisma.InstanceUpdateInput = {};
  const preview: Record<string, unknown> = {};
  const set = (key: keyof Prisma.InstanceUpdateInput, value: unknown) => {
    patch[key] = value as never;
    preview[String(key)] = value;
  };

  if ("name" in args) {
    const name = stringArg(args, "name", instance.name);
    if (!name) throw new RouteError("name cannot be empty.", 400);
    set("name", name);
  }
  if ("workingDirectory" in args) set("workingDirectory", normalizeWorkingDirectoryForAgent(stringArg(args, "workingDirectory")));
  if ("startCommand" in args) {
    const startCommand = stringArg(args, "startCommand");
    if (!startCommand) throw new RouteError("startCommand cannot be empty.", 400);
    const blocked = findDangerousCommandReason(startCommand);
    if (blocked) throw new RouteError(blocked, 400);
    set("startCommand", startCommand);
  }
  if ("stopCommand" in args) {
    const stopCommand = nullableStringArg(args, "stopCommand");
    if (stopCommand !== undefined && stopCommand !== null) {
      const blocked = findDangerousCommandReason(stopCommand);
      if (blocked) throw new RouteError(blocked, 400);
    }
    set("stopCommand", stopCommand ?? null);
  }
  if ("description" in args) set("description", nullableStringArg(args, "description") ?? null);
  if ("autoStart" in args) set("autoStart", booleanArg(args, "autoStart", instance.autoStart));
  if ("restartPolicy" in args) {
    const policy = stringArg(args, "restartPolicy");
    if (!["never", "on_failure", "always", "fixed_interval"].includes(policy)) {
      throw new RouteError("restartPolicy must be one of: never, on_failure, always, fixed_interval.", 400);
    }
    set("restartPolicy", policy);
  }
  if ("restartMaxRetries" in args) set("restartMaxRetries", numericArg(args.restartMaxRetries, instance.restartMaxRetries, 0, 99));

  return { patch, preview };
}
