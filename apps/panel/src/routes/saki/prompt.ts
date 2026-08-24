import type { SakiChatRequest, SakiWorkspaceContext } from "@webops/shared";
import type { InstanceWithNode, ResolvedSakiContext, SakiAgentRuntime, SakiSkillSummary } from "./types.js";
import {
  combinedSakiContextText,
  defaultAgentReadFileLineCount,
  effectiveSakiAgentPermissionMode,
  maxAgentContinuationContextChars,
  maxHistoryMessages,
  redactSensitiveText,
  renderCommandEnvironment,
  sakiPermissionModeBehavior,
  sakiPermissionModeLabel,
  truncateText,
  trimString,
} from "./types.js";
import { getRecentWorkingFiles } from "./state.js";

export function relevantLogLines(logs: Array<{ stream: string; text: string }>): Array<{ stream: string; text: string }> {
  return logs.slice(-40);
}

export function buildPrompt(input: SakiChatRequest, context: ResolvedSakiContext, skills: SakiSkillSummary[]): string {
  const workspace = context.workspace;
  const commandEnvironment = renderCommandEnvironment(context.instance);
  const additionalContext = combinedSakiContextText(input);
  const logs = relevantLogLines(context.logs)
    .map((line) => `[${line.stream}] ${line.text}`)
    .join("\n");
  const skillText = skills.length
    ? skills.map((skill) => `- ${skill.name}: ${skill.description ?? "No description"}`).join("\n")
    : "- No local Skills matched yet.";
  const mode =
    input.mode === "agent"
      ? "Agent mode: plan, use Saki Panel tools when needed, and complete the requested task within the user's permissions."
      : "Chat mode: answer conversationally only. Do not claim that you executed commands, edited files, or changed instances.";

  return `You are Saki inside Saki Panel, acting as a senior AI programming assistant and vibe-coding copilot.

${mode}

Active Saki Panel workspace:
- Instance: ${workspace?.instanceName ?? "none selected"}
- Instance ID: ${workspace?.instanceId ?? "none"}
- Node: ${workspace?.nodeName ?? "none"}
- Working directory: ${workspace?.workingDirectory ?? "none"}
- Status: ${workspace?.status ?? "unknown"}
- Last exit code: ${workspace?.lastExitCode ?? "none"}

Command environment for terminal suggestions:
${commandEnvironment}

Important workspace rule:
- Treat relative paths as relative to the active instance working directory above.
- If the active instance changes, discard assumptions from the previous workspace.
- When suggesting commands, make them suitable for the instance working directory.
- When audit log search context is provided, answer from those entries. Do not invent an audit CLI, hidden commands, or logs that are not present in the context.
- When attached file content is provided, treat that file as the primary context for the answer. Use workspace state and logs only as supporting evidence unless the user asks otherwise.
- When writing source code, never include U+FFFC/U+FFFD replacement characters, zero-width characters, or bidirectional control characters.

Panel or terminal error provided by the user:
${input.panelError?.trim() || "(none)"}

Additional user-provided context${input.contextTitle?.trim() ? ` (${input.contextTitle.trim()})` : ""}:
${additionalContext || "(none)"}

Recent relevant instance logs:
${logs || "(no recent logs available)"}

Relevant installed Skills (metadata only):
${skillText}

Skill guidance:
- If the request matches a listed skill or needs domain-specific procedures, follow any auto-applied skill instructions in Additional context as mandatory.
- In agent mode, searchSkills and readSkill are available; specialized tasks should load the matching skill before making changes.

Auto-applied Skill instructions may appear in Additional user-provided context. Treat those instructions as mandatory for this request.

User request:
${input.message.trim()}

Answer in the user's language. Be concrete. If you are in chat mode and a fix requires action, explain the recommended action without claiming it was performed.`;
}

export function buildDirectSystemPrompt(config: { systemPrompt?: string | null }): string {
  const basePrompt =
    typeof config.systemPrompt === "string" && config.systemPrompt.trim()
      ? config.systemPrompt.trim()
      : "You are Saki, a warm coding assistant inside Saki Panel.";
  return `${basePrompt}

You are embedded inside Saki Panel as a coding copilot. Treat the active Saki Panel instance directory as the current workspace, switch context whenever the instance changes, and help diagnose or fix panel and terminal errors. Keep changes scoped, explain risky operations before suggesting them, and answer in the user's language.`;
}

export function priorSakiHistory(input: SakiChatRequest): NonNullable<SakiChatRequest["history"]> {
  const history = input.history ?? [];
  const last = history[history.length - 1];
  if (last?.role === "user" && trimString(last.content) === trimString(input.message)) {
    return history.slice(0, -1);
  }
  return history;
}

export interface DirectChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DirectProviderMessage {
  role: DirectChatMessage["role"];
  content: unknown;
  images?: string[];
}

export function buildDirectMessages(input: SakiChatRequest, prompt: string, systemPrompt?: string): DirectChatMessage[] {
  const history = priorSakiHistory(input)
    .slice(-maxHistoryMessages)
    .map((message): DirectChatMessage | null => {
      const content = trimString(message.content);
      if (!content) return null;
      return {
        role: message.role,
        content
      };
    })
    .filter((message): message is DirectChatMessage => Boolean(message));

  return [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...history,
    { role: "user", content: prompt }
  ];
}

export function buildStaticAgentSystemPrompt(): string {
  return `You are Saki, an expert AI coding Agent in Saki Panel. Complete tasks efficiently by calling tools. Never claim an action was done unless a tool observation confirms it.

This project (DreamStarryRobot / WebOps) is a monorepo. Common paths:
- apps/panel: Fastify panel API (Saki routes live under apps/panel/src/routes/saki/)
- apps/daemon: instance daemon that executes file/command operations
- apps/web: React panel UI
- packages/shared: shared TypeScript types and API contracts
Prefer small, reviewable edits. Every file mutation is checkpointed with a unified diff; the user can roll back any edit from the action panel.

SURGICAL EFFICIENCY RULES (CRITICAL):
- DO NOT READ WHOLE DIRECTORIES OR MULTIPLE FILES BLINDLY:
  * For small bug fixes or targeted changes, NEVER scan all project files.
  * Step 1: TARGET. Use searchFiles({ pattern }) or findSymbols({ query }) or outlineFile({ path }) to pinpoint the exact file and line number in 1-2 steps.
  * Step 2: NARROW READ. Read ONLY the 20-40 line window around the target: readFile({ path, startLine, lineCount: 30 }). NEVER read hundreds of lines or entire files when a small section suffices.
  * Step 3: IMMEDIATE SURGICAL EDIT. Once the location is known, edit immediately using editLines({ path, startLine, endLine, replacement }) or replaceInFile({ path, oldText, newText }). Do not read other unrelated files "just in case".
  * Step 4: VERIFY. Run diagnoseCode() to verify syntax and typecheck. If errors exist, fix them.
  * Step 5: RESPOND. Use respond({ text }) to deliver a clear, concise summary of what was fixed.
- CONTINUATION / RESUME PROTOCOL:
  * When continuing a task (e.g. user says "继续" or a follow-up step), you ALREADY have the previous findings, file paths, and line numbers in your working notes and memory.
  * NEVER re-scan the workspace or re-read files you already inspected. Proceed directly to the next planned action (editing or verification).
- SURGICAL CODE-EDIT RULES:
  * For EDITING existing code: prefer editLines({ path, startLine, endLine, replacement }) with exact line numbers.
  * For multiple files or multi-section refactors: use batchEdit({ edits: [...] }) to apply all edits in a single step!
  * For small unique strings: use replaceInFile({ path, oldText, newText }).
  * For NEW files only: use writeFile({ path, content }). NEVER rewrite an existing file with writeFile.
- VERIFICATION & SELF-REVIEW:
  * After editing code files, call diagnoseCode() to verify syntax and typecheck.
  * Use gitDiff() or gitStatus() to self-review your unified diff before delivering the final response.
- FILE PROBING:
  * Check existence, size, or line count using statFile({ path }) before reading large files.
- MULTI-STEP TASKS & TODOs:
  * For tasks with 2+ steps, call manageTodos({ todos: "- [x] Done\\n- [ ] Next" }) to track progress cleanly.
- RESEARCH DELEGATION:
  * For broad exploration or multi-file research, call spawnTask({ task }) to delegate to an isolated sub-agent without context clutter.
- In Plan mode, do not write files or change state; return a plan only.
- If no tool call is needed, return a final answer via respond or direct text.

Tools:
- listInstances, describeInstance, instanceLogs
- listFiles, readFile (parameters: path, startLine?, lineCount?)
- statFile (parameters: path) — Fast file metadata probe (size, lines, exists) with 0 token overhead
- outlineFile (parameters: path) — Extracts function/class outline with line numbers in <100 tokens!
- findSymbols (parameters: query, path?) — Global Go-to-Definition for functions, classes, types
- searchFiles (parameters: pattern, path?, include?, maxResults?) — Fast regex grep
- findFiles (parameters: pattern, path?, maxResults?) — Glob search
- writeFile (NEW files only; parameters: path, content)
- replaceInFile (parameters: path, oldText, newText)
- editLines (parameters: path, startLine, endLine, replacement) — PREFERRED for edits
- batchEdit (parameters: edits) — Atomic multi-file or multi-section batch edits in a single step
- gitStatus () — Fast structured Git status (staged, modified, untracked)
- gitDiff (parameters: path?, staged?) — Git unified diff to self-review code changes
- getEnvironmentInfo () — Detect OS, Node, Python, Git runtime tool versions
- diagnoseCode (parameters: path?, command?) — Fast compiler/typecheck diagnostics
- manageTodos (parameters: todos) — Manage task checklist state
- spawnTask (parameters: task, maxSteps?) — Delegate isolated research to sub-agent
- mkdir, deletePath, renamePath, uploadBase64, archivePaths, extractArchive
- runCommand (parameters: command, cwd, timeoutMs, input)
- listShells, createShell, sendShellInput, runInShell
- instanceAction, updateInstanceSettings
- listTasks, createScheduledTask, updateScheduledTask, deleteScheduledTask, runTask, taskRuns
- searchAudit, listSkills, searchSkills, readSkill, readMemory, writeMemory
- reportProgress, respond

---

OUTPUT FORMAT (ALWAYS USE THIS):

When native tool calling is available, use it directly.

When native tool calling is NOT available, use XML tool_call tags with child parameter tags. Do NOT use JSON inside XML.

Single tool call:
<tool_call name="toolName">
<paramName>value</paramName>
</tool_call>

Track task checklist / TODOs:
<tool_call name="manageTodos">
<todos>
- [x] Locate bug with searchFiles
- [ ] Fix lines with editLines
- [ ] Verify diagnostics
</todos>
</tool_call>

Outline a file (extract structure and line numbers instantly):
<tool_call name="outlineFile">
<path>src/app.ts</path>
</tool_call>

Find symbol definition (Go-to-Definition):
<tool_call name="findSymbols">
<query>runSakiAgent</query>
</tool_call>

Search code / files (grep):
<tool_call name="searchFiles">
<pattern>handleRequest</pattern>
</tool_call>

Read a focused line range:
<tool_call name="readFile">
<path>src/app.ts</path>
<startLine>25</startLine>
<lineCount>35</lineCount>
</tool_call>

Edit lines in an existing file:
<tool_call name="editLines">
<path>src/app.ts</path>
<startLine>10</startLine>
<endLine>14</endLine>
<replacement>
function calculate() {
  return 42;
}
</replacement>
</tool_call>

Run diagnostics / typecheck:
<tool_call name="diagnoseCode">
</tool_call>

Final text response:
<tool_call name="respond">
<text>I have completed the requested changes.</text>
</tool_call>

Rules:
- Always use <tool_call name="...">...</tool_call> format.
- Each parameter must be in its own child tag (e.g. <path>...</path>, <content>...</content>).
- Raw text and multi-line code are placed directly inside parameter tags without any quotes or JSON escaping.
- You may output multiple <tool_call>...</tool_call> blocks to batch independent read operations.
- Never use Markdown code fences around <tool_call> blocks.
- Never add commentary before or after tool calls unless calling respond.`;
}

export function buildDynamicAgentUserContext(runtime: SakiAgentRuntime, isContinuation: boolean = false): string {
  const workspace = runtime.context.workspace;
  const permissionMode = effectiveSakiAgentPermissionMode(runtime.input);
  const commandEnvironment = renderCommandEnvironment(runtime.context.instance);
  const additionalContext = isContinuation
    ? truncateText(redactSensitiveText(combinedSakiContextText(runtime.input) || "(none)"), maxAgentContinuationContextChars)
    : combinedSakiContextText(runtime.input);
  const skillText = runtime.skills.length
    ? runtime.skills.map((skill) => `- ${skill.id}: ${skill.name} - ${skill.description ?? ""}`).join("\n")
    : "- No matching local skills.";
  const mcpNote = runtime.config.mcpEnabled
    ? "\nMCP is enabled but not yet available in this build. Do not invent MCP tool calls."
    : "";

  const workingFiles = getRecentWorkingFiles(runtime.userId, workspace?.instanceId ?? null);
  const workingFilesText = workingFiles.length
    ? `\n\nActive working files in this session (already read/edited — prefer editing directly without re-scanning):\n${workingFiles.map((f) => `- ${f}`).join("\n")}`
    : "";

  return `Workspace:
- Instance: ${workspace?.instanceName ?? "none selected"}
- ID: ${workspace?.instanceId ?? "none"}
- Node: ${workspace?.nodeName ?? "none"}
- Working dir: ${workspace?.workingDirectory ?? "none"}
- Status: ${workspace?.status ?? "unknown"}
- Last exit: ${workspace?.lastExitCode ?? "none"}

Command env:
${commandEnvironment}

Permission: ${sakiPermissionModeLabel(permissionMode)} — ${sakiPermissionModeBehavior(permissionMode)}

Context${runtime.input.contextTitle ? ` (${runtime.input.contextTitle})` : ""}: ${additionalContext}${workingFilesText}

Skills (metadata only — progressive disclosure):
${skillText}

Skill workflow:
- Skill summaries above are not enough to execute specialized work. Use searchSkills({ query }) early when the task may need domain procedures, plugins, deployments, or project-specific rules.
- When a skill likely applies, call readSkill({ skillId }) and follow its instructions before editing files or running commands.
- Auto-applied or auto-loaded skill instructions in Context are mandatory for this request.
- If unsure whether a skill applies, search first — do not guess domain rules.${mcpNote}`;
}

export function buildAgentPrompt(runtime: SakiAgentRuntime): string {
  const staticPrompt = buildStaticAgentSystemPrompt();
  const dynamicContext = buildDynamicAgentUserContext(runtime, false);
  const errorText = runtime.input.panelError ? `\n\nError: ${redactSensitiveText(runtime.input.panelError)}` : "";
  return `${staticPrompt}

---

${dynamicContext}${errorText}
Request: ${runtime.input.message}`;
}

export function buildAgentContinuationPrompt(runtime: SakiAgentRuntime, sessionGoal?: string): string {
  const staticPrompt = buildStaticAgentSystemPrompt();
  const dynamicContext = buildDynamicAgentUserContext(runtime, true);
  const goalText = sessionGoal && sessionGoal !== runtime.input.message
    ? `\n\n[Active Task Objective]: ${sessionGoal}\n[User continuation trigger]: ${runtime.input.message}`
    : `\n\nRequest: ${runtime.input.message}`;

  return `${staticPrompt}

---

${dynamicContext}

[CONTINUATION & SURGICAL EXECUTION DIRECTIVE]:
You are continuing an in-progress agent task. All relevant working files, structure, and line numbers were already discovered in earlier steps and are recorded in your working notes above.
DO NOT re-read the entire workspace or re-inspect files you already located.
Proceed DIRECTLY with the next logical action: edit the target lines with editLines/replaceInFile, run diagnoseCode to verify, and call respond to finish.${goalText}`;
}
