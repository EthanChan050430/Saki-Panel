import path from "node:path";
import type { Prisma } from "@prisma/client";
import { classifyCommandRisk, findDangerousCommandReason } from "../../security.js";
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
  description: "Optional short user-visible note about what you are about to do. Do not include hidden chain-of-thought."
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
  { name: "listFiles", description: "List files in an instance workspace. Use limit for fast shallow inspection of large directories.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, limit: { type: "integer", minimum: 1, maximum: 1000 } }) },
  { name: "readFile", description: "Read a UTF-8 text file.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, lineCount: { type: "integer", minimum: 1, maximum: 800 } }, ["path"]) },
  { name: "writeFile", description: "Create or overwrite a UTF-8 text file. Saki creates a rollback checkpoint before writing.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, content: { type: "string" } }, ["path", "content"]) },
  { name: "replaceInFile", description: "Replace one exact text occurrence. Saki creates a rollback checkpoint before writing.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, oldText: { type: "string" }, newText: { type: "string" } }, ["path", "oldText", "newText"]) },
  { name: "editLines", description: "Replace a 1-based line range. Saki creates a rollback checkpoint before writing.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 0 }, replacement: { type: "string" } }, ["path", "startLine", "endLine", "replacement"]), aliases: ["editFileLines", "replaceLines"] },
  { name: "mkdir", description: "Create a directory.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]) },
  { name: "deletePath", description: "Delete a path after approval, using a rollback checkpoint where possible.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]) },
  { name: "renamePath", description: "Rename or move a path.", parameters: objectSchema({ instanceId: instanceLookupSchema, fromPath: relativePathSchema, toPath: relativePathSchema }, ["fromPath", "toPath"]) },
  { name: "uploadBase64", description: "Upload a base64 file.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, contentBase64: { type: "string" } }, ["path", "contentBase64"]) },
  { name: "archivePaths", description: "Compress one or more files or directories into a .zip archive in the instance workspace. Prefer this over shell zip commands.", parameters: objectSchema({ instanceId: instanceLookupSchema, paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200, description: "Relative paths to compress." }, outputPath: { type: "string", description: "Optional output .zip path relative to the instance working directory." } }, ["paths"]), aliases: ["archive", "compressPaths", "zipPaths"] },
  { name: "extractArchive", description: "Extract a .zip, .rar, or .7z archive into the instance workspace. Prefer this over shell unzip commands.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, outputPath: { type: "string", description: "Optional output directory relative to the instance working directory." } }, ["path"]), aliases: ["extract", "unzipArchive", "decompressArchive"] },
  { name: "runCommand", description: "Run a terminal command in an independent temporary shell, not in the running instance process stdin. Use this for normal shell commands, especially when the instance console cannot accept input. For programs that prompt for stdin, provide input with newline-separated answers. Medium and high risk commands require approval.", parameters: objectSchema({ instanceId: instanceLookupSchema, command: { type: "string" }, cwd: { type: "string", description: "Optional subdirectory relative to the selected instance working directory." }, workingDirectory: { type: "string", description: "Alias for cwd; must be relative to the selected instance working directory." }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }, input: { type: "string" }, stdin: { type: "string" } }, ["command"]), aliases: ["executeCommand", "terminal", "shell"] },
  { name: "sendInput", description: "Type raw text into a running instance console/stdin. Use this for interactive prompts, menu choices, chat text, passwords, or any console content. Set pressEnter=false to type without submitting.", parameters: objectSchema({ instanceId: instanceLookupSchema, text: { type: "string" }, pressEnter: { type: "boolean", description: "Append Enter/newline after the text. Defaults to true." }, echo: { type: "boolean", description: "Whether to record the typed text in instance logs. Set false for secrets." } }, ["text"]), aliases: ["typeConsole", "consoleInput", "terminalInput", "sendStdin"] },
  { name: "sendCommand", description: "Send one line to a running instance process stdin. This is not a shell command runner; use runCommand for normal terminal commands.", parameters: objectSchema({ instanceId: instanceLookupSchema, command: { type: "string" } }, ["command"]) },
  { name: "instanceAction", description: "Start, stop, restart, or kill an instance. Stop, restart, and kill require approval.", parameters: objectSchema({ instanceId: instanceLookupSchema, action: { type: "string", enum: ["start", "stop", "restart", "kill"] } }, ["action"]) },
  { name: "updateInstanceSettings", description: "Modify instance settings after approval. Omit instanceId to update the active instance.", parameters: objectSchema({ instanceId: instanceLookupSchema, name: { type: "string" }, workingDirectory: { type: "string" }, startCommand: { type: "string" }, stopCommand: { type: ["string", "null"] }, description: { type: ["string", "null"] }, autoStart: { type: "boolean" }, restartPolicy: { type: "string", enum: ["never", "on_failure", "always", "fixed_interval"] }, restartMaxRetries: { type: "integer", minimum: 0, maximum: 99 } }), aliases: ["setInstanceSettings", "updateInstance"] },
  { name: "searchAudit", description: "Search audit logs.", parameters: objectSchema({ query: { type: "string" } }, ["query"]) },
  { name: "listTasks", description: "List scheduled tasks.", parameters: objectSchema({ instanceId: instanceLookupSchema }) },
  { name: "createScheduledTask", description: "Create a scheduled task after approval.", parameters: objectSchema({ name: { type: "string" }, type: { type: "string", enum: ["run_command", "restart_instance", "stop_instance", "start_instance"] }, cron: { type: "string" }, instanceId: instanceLookupSchema, command: { type: "string" }, enabled: { type: "boolean" } }, ["name", "type", "cron"]), aliases: ["createTask", "setInstanceSchedule"] },
  { name: "updateScheduledTask", description: "Update a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["run_command", "restart_instance", "stop_instance", "start_instance"] }, cron: { type: "string" }, instanceId: instanceLookupSchema, command: { type: "string" }, enabled: { type: "boolean" } }, ["taskId"]), aliases: ["updateTask"] },
  { name: "deleteScheduledTask", description: "Delete a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]), aliases: ["deleteTask"] },
  { name: "runTask", description: "Run a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]) },
  { name: "taskRuns", description: "List recent scheduled task runs.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]) },
  { name: "searchFiles", description: "Search file contents using a regex pattern. Returns matching lines with file paths, line numbers, and text. Supports include patterns like '*.ts' or '*.{js,ts}'. Skips binary files and common non-code directories (node_modules, .git, etc).", parameters: objectSchema({ instanceId: instanceLookupSchema, pattern: { type: "string", description: "Regular expression pattern to search for." }, path: { type: "string", description: "Optional relative subdirectory to search in." }, include: { type: "string", description: "Optional glob pattern for file names, e.g. '*.ts' or '*.{js,ts}'." }, maxResults: { type: "integer", minimum: 1, maximum: 500 } }, ["pattern"]), aliases: ["grep", "grepFiles", "searchCode", "codeSearch"] },
  { name: "findFiles", description: "Find files by name pattern using glob syntax. Supports **, *, ? and {a,b} patterns. Skips common non-code directories. Returns relative file paths.", parameters: objectSchema({ instanceId: instanceLookupSchema, pattern: { type: "string", description: "Glob pattern for file names, e.g. '**/*.ts', 'src/**/*.js', '*.json'." }, path: { type: "string", description: "Optional relative subdirectory to search in." }, maxResults: { type: "integer", minimum: 1, maximum: 1000 } }, ["pattern"]), aliases: ["glob", "globFiles", "findByName"] },
  { name: "searchWeb", description: "Search the public web.", parameters: objectSchema({ query: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 8 } }, ["query"]), aliases: ["webSearch"] },
  { name: "browse", description: "Fetch one public web page.", parameters: objectSchema({ url: { type: "string" } }, ["url"]), aliases: ["browseUrl", "readUrl", "fetchPage"] },
  { name: "crawl", description: "Crawl same-site public pages.", parameters: objectSchema({ url: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 6 }, maxDepth: { type: "integer", minimum: 0, maximum: 2 } }, ["url"]), aliases: ["crawlWeb", "crawlSite"] },
  { name: "researchWeb", description: "Search the web and fetch top result pages.", parameters: objectSchema({ query: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 4 } }, ["query"]), aliases: ["webResearch"] },
  { name: "listSkills", description: "List relevant local Saki skills.", parameters: objectSchema({}) },
  { name: "searchSkills", description: "Search local Saki skills.", parameters: objectSchema({ query: { type: "string" } }, ["query"]) },
  { name: "readSkill", description: "Load one Saki skill's full instructions by id. Use this before applying a matched skill.", parameters: objectSchema({ skillId: { type: "string" } }, ["skillId"]), aliases: ["loadSkill", "useSkill", "getSkill"] },
  { name: "readMemory", description: "Read the project memory file (SAKI.md) which contains project conventions, user preferences, and important notes persisted across conversations. Use this at the start of a conversation to recall context.", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["getMemory", "loadMemory"] },
  { name: "writeMemory", description: "Write or update the project memory file (SAKI.md). Use this to save project conventions, user preferences, or important notes that should persist across conversations. Content is appended or replaced entirely.", parameters: objectSchema({ instanceId: instanceLookupSchema, content: { type: "string", description: "Full content to write to the memory file. Write the complete file content, not just additions." } }, ["content"]), aliases: ["updateMemory", "saveMemory"] },
  { name: "reportProgress", description: "Show a short user-visible progress update in your own words. This is not hidden chain-of-thought; use it for concise status or rationale summaries before or between tool batches.", parameters: objectSchema({ text: { type: "string" } }, ["text"]), aliases: ["progress", "statusUpdate"] },
  { name: "spawnTask", description: "Spawn a sub-agent to independently handle a specific sub-task. The sub-agent runs in its own loop with the same tools and workspace. Use this for parallelizable work or to isolate complex sub-tasks. Returns the sub-agent's final answer.", parameters: objectSchema({ instanceId: instanceLookupSchema, task: { type: "string", description: "Clear description of the sub-task for the sub-agent to complete." }, maxSteps: { type: "integer", description: "Maximum tool calls the sub-agent may make.", minimum: 1, maximum: 15 } }, ["task"]), aliases: ["subAgent", "delegate", "runSubTask"] },
  { name: "plan", description: "Present a structured plan to the user before executing a complex task. Use this for multi-step tasks to get user confirmation before proceeding. The plan should list the steps you will take.", parameters: objectSchema({ steps: { type: "string", description: "A numbered list of steps you plan to take, one per line." }, summary: { type: "string", description: "Brief one-line summary of what you plan to accomplish." } }, ["steps", "summary"]) },
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

export function openAiToolSchemas(): Array<{ type: "function"; function: { name: string; description: string; parameters: JsonSchema } }> {
  return sakiToolSchemas.map((schema) => ({
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters
    }
  }));
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
  writeFile: { text: "content", body: "content", data: "content", fileContent: "content", file_content: "content", source: "content" },
  replaceInFile: { find: "oldText", search: "oldText", match: "oldText", replace: "newText", with: "newText", replacement: "newText" },
  editLines: { lines: "replacement", content: "replacement", text: "replacement", newContent: "replacement", new_content: "replacement" },
  readFile: { file: "path", filename: "path", filepath: "path" },
  runCommand: { cmd: "command", shell: "command", script: "command" },
  sendInput: { value: "text", input: "text", content: "text" },
  listFiles: { dir: "path", directory: "path", folder: "path" },
  mkdir: { dir: "path", directory: "path", folder: "path" },
  deletePath: { file: "path", filepath: "path" },
  renamePath: { source: "fromPath", src: "fromPath", dest: "toPath", destination: "toPath" },
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
  if (lower === "listfiles" || lower === "readfile" || lower === "mkdir" || lower === "deletepath") return "path";
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

export function parseXmlToolCalls(source: string): ParsedToolCall[] | null {
  const stripped = stripThinking(source).trim();
  const OT = String.fromCharCode(60) + "tool_call" + String.fromCharCode(62);
  const CT = String.fromCharCode(60) + "/tool_call" + String.fromCharCode(62);
  const openRe = new RegExp(OT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  if (!openRe.test(stripped)) return null;

  const calls: ParsedToolCall[] = [];
  const closeRe = new RegExp(CT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const segments = stripped.split(closeRe);

  for (const segment of segments) {
    const match = segment.match(new RegExp(OT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([\\s\\S]*)", "i"));
    if (!match) continue;
    const inner = match[1]?.trim() ?? "";
    if (!inner) continue;
    try {
      const parsed = parseJsonTolerant(inner);
      const item = objectValue(parsed);
      if (item && ("name" in item || "tool" in item || "function" in item)) {
        calls.push(normalizeStructuredToolCall(item));
      }
    } catch {
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
      } catch { /* next fallback */ }
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
          } catch { continue; }
        }
      } catch { /* next fallback */ }
      try {
        const repaired = repairTruncatedJson(inner);
        if (repaired) {
          const parsed = parseJsonTolerant(repaired);
          const item = objectValue(parsed);
          if (item && ("name" in item || "tool" in item || "function" in item)) {
            calls.push(normalizeStructuredToolCall(item));
          }
        }
      } catch {
        // Skip malformed XML tool call blocks
      }
    }
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
  "readskill",
  "readmemory",
  "reportprogress",
  "respond"
]);

export const sakiAutoAcceptedFileToolNames = new Set([
  "writefile",
  "replaceinfile",
  "editlines",
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
