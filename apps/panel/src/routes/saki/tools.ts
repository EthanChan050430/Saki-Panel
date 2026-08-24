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
  { name: "readFile", description: "Read a UTF-8 text file.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, lineCount: { type: "integer", minimum: 1, maximum: 800 } }, ["path"]), aliases: ["view_file", "viewFile", "read_file", "cat"] },
  { name: "writeFile", description: "Create or overwrite a UTF-8 text file. Saki creates a rollback checkpoint before writing.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, content: { type: "string" } }, ["path", "content"]), aliases: ["write_file", "write_to_file", "saveFile", "createFile"] },
  { name: "replaceInFile", description: "Replace one exact text occurrence. Saki creates a rollback checkpoint before writing.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, oldText: { type: "string" }, newText: { type: "string" } }, ["path", "oldText", "newText"]), aliases: ["str_replace", "replace_file_content", "replace_in_file", "strReplace", "edit_file", "patch"] },
  { name: "editLines", description: "Replace a 1-based line range. Saki creates a rollback checkpoint before writing.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 0 }, replacement: { type: "string" } }, ["path", "startLine", "endLine", "replacement"]), aliases: ["editFileLines", "replaceLines", "edit_lines", "patchLines"] },
  { name: "mkdir", description: "Create a directory.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]) },
  { name: "deletePath", description: "Delete a path after approval, using a rollback checkpoint where possible.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]), aliases: ["delete_path", "removeFile", "rm"] },
  { name: "renamePath", description: "Rename or move a path.", parameters: objectSchema({ instanceId: instanceLookupSchema, fromPath: relativePathSchema, toPath: relativePathSchema }, ["fromPath", "toPath"]), aliases: ["movePath", "mv", "rename_path"] },
  { name: "uploadBase64", description: "Upload a base64 file.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, contentBase64: { type: "string" } }, ["path", "contentBase64"]) },
  { name: "archivePaths", description: "Compress one or more files or directories into a .zip archive in the instance workspace. Prefer this over shell zip commands.", parameters: objectSchema({ instanceId: instanceLookupSchema, paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200, description: "Relative paths to compress." }, outputPath: { type: "string", description: "Optional output .zip path relative to the instance working directory." } }, ["paths"]), aliases: ["archive", "compressPaths", "zipPaths"] },
  { name: "extractArchive", description: "Extract a .zip, .rar, or .7z archive into the instance workspace. Prefer this over shell unzip commands. Use conflictPolicy=overwrite or skip when files already exist in the output directory.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, outputPath: { type: "string", description: "Optional output directory relative to the instance working directory." }, conflictPolicy: { type: "string", enum: ["overwrite", "skip"], description: "How to handle files that already exist at the destination." } }, ["path"]), aliases: ["extract", "unzipArchive", "decompressArchive"] },
  { name: "runCommand", description: "Run a terminal command. DEFAULT: reuses the most recently created persistent independent shell (if any exist). Auto-creates a new one only if no shells are open. Equivalent to working in the latest terminal tab (like + button behavior but reuse-first). Isolates from main instance console. Use createShell + runInShell for explicit control. Medium/high risk commands require approval. Supports 'input' for interactive prompts.", parameters: objectSchema({ instanceId: instanceLookupSchema, command: { type: "string" }, cwd: { type: "string", description: "Optional subdirectory relative to the selected instance working directory." }, workingDirectory: { type: "string", description: "Alias for cwd; must be relative to the selected instance working directory." }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }, input: { type: "string" }, stdin: { type: "string" } }, ["command"]), aliases: ["executeCommand", "terminal", "shell", "run_command", "bash", "bashTool", "cmd", "exec"] },
  { name: "sendInput", description: "Type raw text into the RUNNING instance process console/stdin (the main attached terminal). Use ONLY for live process interaction (prompts, passwords, etc from the started app). For regular shell commands (ls, npm, etc), ALWAYS use runCommand which will execute in a brand new independent shell (like + button).", parameters: objectSchema({ instanceId: instanceLookupSchema, text: { type: "string" }, pressEnter: { type: "boolean", description: "Append Enter/newline after the text. Defaults to true." }, echo: { type: "boolean", description: "Whether to record the typed text in instance logs. Set false for secrets." } }, ["text"]), aliases: ["typeConsole", "consoleInput", "terminalInput", "sendStdin"] },
  { name: "sendCommand", description: "Send one line directly to the RUNNING instance process stdin (the main console, not a shell). ONLY for interacting with the live process (e.g. answering prompts from the started app). For normal shell/terminal commands, ALWAYS use runCommand (which creates a fresh new shell like the + button).", parameters: objectSchema({ instanceId: instanceLookupSchema, command: { type: "string" } }, ["command"]) },
  { name: "listShells", description: "List active persistent shell sessions/tabs. Use to discover shellIds for runInShell or sendShellInput. These survive across agent turns unlike runCommand temps.", parameters: objectSchema({ instanceId: instanceLookupSchema }) },
  { name: "createShell", description: "Open a new persistent shell (equivalent to + button). Returns shellId. Ideal for stateful sessions (cd, env vars, long-running servers). Output visible in UI tab.", parameters: objectSchema({ instanceId: instanceLookupSchema, workingDirectory: { type: "string", description: "Optional relative cwd for the new shell." } }) },
  { name: "sendShellInput", description: "Raw keystrokes to a persistent shell (use \\n for enter). For full commands with observation, use runInShell.", parameters: objectSchema({ instanceId: instanceLookupSchema, shellId: { type: "string" }, text: { type: "string" }, pressEnter: { type: "boolean", description: "Append newline (default true)." } }, ["shellId", "text"]) },
  { name: "runInShell", description: "Run command in a persistent shell by ID (from listShells/createShell). Much better than repeated runCommand for multi-command or stateful work. Output appears in the matching UI shell tab.", parameters: objectSchema({ instanceId: instanceLookupSchema, shellId: { type: "string" }, command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 } }, ["shellId", "command"]) },
  { name: "instanceAction", description: "Start, stop, restart, or kill an instance. Stop, restart, and kill require approval.", parameters: objectSchema({ instanceId: instanceLookupSchema, action: { type: "string", enum: ["start", "stop", "restart", "kill"] } }, ["action"]) },
  { name: "updateInstanceSettings", description: "Modify instance settings after approval. Omit instanceId to update the active instance.", parameters: objectSchema({ instanceId: instanceLookupSchema, name: { type: "string" }, workingDirectory: { type: "string" }, startCommand: { type: "string" }, stopCommand: { type: ["string", "null"] }, description: { type: ["string", "null"] }, autoStart: { type: "boolean" }, restartPolicy: { type: "string", enum: ["never", "on_failure", "always", "fixed_interval"] }, restartMaxRetries: { type: "integer", minimum: 0, maximum: 99 } }), aliases: ["setInstanceSettings", "updateInstance"] },
  { name: "searchAudit", description: "Search audit logs.", parameters: objectSchema({ query: { type: "string" } }, ["query"]) },
  { name: "listTasks", description: "List scheduled tasks.", parameters: objectSchema({ instanceId: instanceLookupSchema }) },
  { name: "createScheduledTask", description: "Create a scheduled task after approval.", parameters: objectSchema({ name: { type: "string" }, type: { type: "string", enum: ["run_command", "restart_instance", "stop_instance", "start_instance"] }, cron: { type: "string" }, instanceId: instanceLookupSchema, command: { type: "string" }, enabled: { type: "boolean" } }, ["name", "type", "cron"]), aliases: ["createTask", "setInstanceSchedule"] },
  { name: "updateScheduledTask", description: "Update a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["run_command", "restart_instance", "stop_instance", "start_instance"] }, cron: { type: "string" }, instanceId: instanceLookupSchema, command: { type: "string" }, enabled: { type: "boolean" } }, ["taskId"]), aliases: ["updateTask"] },
  { name: "deleteScheduledTask", description: "Delete a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]), aliases: ["deleteTask"] },
  { name: "runTask", description: "Run a scheduled task after approval.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]) },
  { name: "taskRuns", description: "List recent scheduled task runs.", parameters: objectSchema({ taskId: { type: "string" } }, ["taskId"]) },
  { name: "searchFiles", description: "Search file contents using a regex pattern. Returns matching lines with file paths, line numbers, and text. Supports include patterns like '*.ts' or '*.{js,ts}'. Skips binary files and common non-code directories (node_modules, .git, etc).", parameters: objectSchema({ instanceId: instanceLookupSchema, pattern: { type: "string", description: "Regular expression pattern to search for." }, path: { type: "string", description: "Optional relative subdirectory to search in." }, include: { type: "string", description: "Optional glob pattern for file names, e.g. '*.ts' or '*.{js,ts}'." }, maxResults: { type: "integer", minimum: 1, maximum: 500 } }, ["pattern"]), aliases: ["grep", "grepFiles", "searchCode", "codeSearch", "grep_search", "ripgrep", "grepTool"] },
  { name: "findFiles", description: "Find files by name pattern using glob syntax. Supports **, *, ? and {a,b} patterns. Skips common non-code directories. Returns relative file paths.", parameters: objectSchema({ instanceId: instanceLookupSchema, pattern: { type: "string", description: "Glob pattern for file names, e.g. '**/*.ts', 'src/**/*.js', '*.json'." }, path: { type: "string", description: "Optional relative subdirectory to search in." }, maxResults: { type: "integer", minimum: 1, maximum: 1000 } }, ["pattern"]), aliases: ["glob", "globFiles", "findByName", "find_by_name", "globTool", "locateFiles"] },
  { name: "outlineFile", description: "Extract functions, classes, interfaces, types, and definitions from a code file with their exact line numbers. Extremely fast way to inspect file structure in <100 tokens without reading full code.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]), aliases: ["fileOutline", "outline", "inspectStructure"] },
  { name: "findSymbols", description: "Search for function, class, type, interface, or variable definitions across workspace files (Go-to-Definition). Returns matching files and exact definition line numbers.", parameters: objectSchema({ instanceId: instanceLookupSchema, query: { type: "string", description: "Symbol name to find definition for (e.g. functionName, ClassName, InterfaceName)." }, path: { type: "string", description: "Optional relative subdirectory to search in." } }, ["query"]), aliases: ["findDefinition", "findSymbol", "gotoDefinition", "symbolSearch"] },
  { name: "searchWeb", description: "Search the public web.", parameters: objectSchema({ query: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 8 } }, ["query"]), aliases: ["webSearch"] },
  { name: "browse", description: "Fetch one public web page.", parameters: objectSchema({ url: { type: "string" } }, ["url"]), aliases: ["browseUrl", "readUrl", "fetchPage"] },
  { name: "crawl", description: "Crawl same-site public pages.", parameters: objectSchema({ url: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 6 }, maxDepth: { type: "integer", minimum: 0, maximum: 2 } }, ["url"]), aliases: ["crawlWeb", "crawlSite"] },
  { name: "researchWeb", description: "Search the web and fetch top result pages.", parameters: objectSchema({ query: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 4 } }, ["query"]), aliases: ["webResearch"] },
  { name: "listSkills", description: "List installed Saki skill summaries (metadata only). Use searchSkills for task-specific matching.", parameters: objectSchema({}) },
  { name: "searchSkills", description: "Search installed skills by task keywords. Call early when the task may need domain-specific procedures, plugins, deployments, or project rules. Returns skill ids with relevance scores.", parameters: objectSchema({ query: { type: "string", description: "Task keywords, e.g. 'ToolDelta plugin', 'start command', 'panel error'." } }, ["query"]), aliases: ["findSkills", "matchSkills"] },
  { name: "readSkill", description: "Load the full instructions for one skill by id. Call after searchSkills when a skill likely applies, then follow the loaded instructions before editing files or running commands.", parameters: objectSchema({ skillId: { type: "string", description: "Skill id from listSkills or searchSkills." } }, ["skillId"]), aliases: ["loadSkill", "useSkill", "getSkill", "applySkill"] },
  { name: "readMemory", description: "Read the project memory file (SAKI.md) which contains project conventions, user preferences, and important notes persisted across conversations. Use this at the start of a conversation to recall context.", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["getMemory", "loadMemory"] },
  { name: "writeMemory", description: "Write or update the project memory file (SAKI.md). Use this to save project conventions, user preferences, or important notes that should persist across conversations. Content is appended or replaced entirely.", parameters: objectSchema({ instanceId: instanceLookupSchema, content: { type: "string", description: "Full content to write to the memory file. Write the complete file content, not just additions." } }, ["content"]), aliases: ["updateMemory", "saveMemory"] },
  { name: "reportProgress", description: "Show a short user-visible progress update in your own words. This is not hidden chain-of-thought; use it for concise status or rationale summaries before or between tool batches.", parameters: objectSchema({ text: { type: "string" } }, ["text"]), aliases: ["progress", "statusUpdate"] },
  { name: "diagnoseCode", description: "Run fast compiler or linter diagnostics on the workspace (e.g. tsc --noEmit or python syntax check). Returns error lines and messages so you can self-correct any issues.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, command: { type: "string", description: "Optional custom check command (defaults to auto-detected tsc or python check)." } }), aliases: ["diagnostics", "checkTypes", "typecheck", "lintCode", "diagnose_code", "lint"] },
  { name: "manageTodos", description: "Manage the structured task/TODO checklist for multi-step goals. Keep track of what is completed, in progress, and pending.", parameters: objectSchema({ todos: { type: "string", description: "Markdown task list with [x] and [ ] checkboxes, e.g. '- [x] Step 1\\n- [ ] Step 2'." } }, ["todos"]), aliases: ["setTodos", "todos", "updateTodos", "manage_todos", "todoTool", "taskList"] },
  { name: "spawnTask", description: "Spawn an isolated research sub-agent to independently inspect or explore a specific sub-task. The sub-agent runs in its own loop and returns a synthesized summary without cluttering your context.", parameters: objectSchema({ instanceId: instanceLookupSchema, task: { type: "string", description: "Clear description of the sub-task for the sub-agent to complete." }, maxSteps: { type: "integer", description: "Maximum tool calls the sub-agent may make.", minimum: 1, maximum: 15 } }, ["task"]), aliases: ["subAgent", "delegate", "runSubTask"] },
  { name: "batchEdit", description: "Apply edits across one or multiple files in a single atomic step. Each edit specifies a file path and either line replacements (startLine, endLine, replacement) or exact text replacement (oldText, newText). Rollback checkpoints are created for all modified files.", parameters: objectSchema({ instanceId: instanceLookupSchema, edits: { type: "array", description: "List of file edit operations to perform.", items: { type: "object", properties: { path: relativePathSchema, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 0 }, replacement: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path"] } } }, ["edits"]), aliases: ["batch_edit", "applyPatches", "multiFileEdit", "batch_patch"] },
  { name: "statFile", description: "Quickly inspect metadata of a file or directory (existence, file size, line count, modified time, isDirectory) without loading its full content into context. Zero-token overhead file probing.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema }, ["path"]), aliases: ["fileInfo", "stat_file", "file_info", "inspectPath", "stat"] },
  { name: "gitStatus", description: "Inspect the current Git repository status in the workspace (current branch, staged changes, modified files, untracked files). Fast structured inspection for self-reviewing changes.", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["git_status", "gitStatusTool"] },
  { name: "gitDiff", description: "Inspect the Git unified diff of uncommitted changes in the workspace or for a specific file. Use this to review and verify your code changes before completing the task.", parameters: objectSchema({ instanceId: instanceLookupSchema, path: relativePathSchema, staged: { type: "boolean", description: "Whether to show staged changes only (defaults to false, showing working tree diff)." } }), aliases: ["git_diff", "gitDiffTool", "diff"] },
  { name: "getEnvironmentInfo", description: "Detect the operating system, CPU architecture, and installed developer runtime tool versions (Node.js, npm, Python, Git, Cargo, Go, Docker) in the instance workspace.", parameters: objectSchema({ instanceId: instanceLookupSchema }), aliases: ["envInfo", "get_environment_info", "systemInfo", "env_info"] },
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

function parseXmlParameters(inner: string): Record<string, unknown> {
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
  "envinfo",
  "systeminfo",
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
