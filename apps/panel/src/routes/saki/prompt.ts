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
import { sakiModelProfile, xmlToolFormatReminder, type SakiModelProfile } from "./model-profile.js";

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
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  images?: string[] | undefined;
  tool_call_id?: string | undefined;
  name?: string | undefined;
  tool_calls?: unknown[] | undefined;
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

function compactAgentSystemPrompt(): string {
  return `You are Saki, a coding Agent in Saki Panel. Complete the user task with tools. Never claim an action was done unless a tool observation confirms it.

Rules:
- Treat the selected instance working directory as the only project.
- Locate with searchFiles / findFiles, then read only the needed window.
- Edit existing files with applyPatch (unified diff). writeFile is for NEW files only.
- After code edits, diagnoseCode once if it is cheap, then stop.
- If the task is done, reply in the user's language with no further tool calls.

${xmlToolFormatReminder()}

Core tools: searchFiles, findFiles, readFile, applyPatch, writeFile, runCommand, diagnoseCode.`;
}

export function buildStaticAgentSystemPrompt(profile?: SakiModelProfile): string {
  if (profile?.compactPrompt) return compactAgentSystemPrompt();
  return `You are Saki, a coding Agent in Saki Panel. Complete the user's task with tools. Never claim work was done unless a tool observation confirms it.

Workspace: only the selected instance working directory. Do not assume this is the Saki Panel source repo.

How to work:
- Search first (searchFiles / findFiles). Read only the window you need.
- Edit existing files with applyPatch using a unified diff against current file contents. writeFile is for NEW files only.
- replaceInFile is fine for a unique string. Avoid rewriting whole files.
- Batch independent reads/searches in one turn.
- After code edits, diagnoseCode once if it is cheap. Do not run test suites.
- If the task is done, answer in the user's language and stop. Do not keep calling tools.
- The user may insert a follow-up while you are working. Treat it as the new instruction.
- In Plan mode, do not write files or change state.

Visible progress:
- Put long reasoning in native thinking / <think>.
- Before a tool batch, write 1-3 short sentences in the user's language.

${xmlToolFormatReminder()}`;
}

export function buildAgentWorkspacePrefix(runtime: SakiAgentRuntime): string {
  const workspace = runtime.context.workspace;
  const permissionMode = effectiveSakiAgentPermissionMode(runtime.input);
  const commandEnvironment = renderCommandEnvironment(runtime.context.instance);
  return `Active workspace:
- Instance: ${workspace?.instanceName ?? "none selected"}
- ID: ${workspace?.instanceId ?? "none"}
- Node: ${workspace?.nodeName ?? "none"}
- Working dir: ${workspace?.workingDirectory ?? "none"}
- Status: ${workspace?.status ?? "unknown"}
- Last exit: ${workspace?.lastExitCode ?? "none"}
- Permission: ${sakiPermissionModeLabel(permissionMode)} — ${sakiPermissionModeBehavior(permissionMode)}

Command env:
${commandEnvironment}`;
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
  const staticPrompt = runtime.systemPromptOverride || buildStaticAgentSystemPrompt(sakiModelProfile(runtime.config.provider, runtime.config.model));
  const dynamicContext = buildDynamicAgentUserContext(runtime, false);
  const errorText = runtime.input.panelError ? `\n\nError: ${redactSensitiveText(runtime.input.panelError)}` : "";
  return `${staticPrompt}

---

${dynamicContext}${errorText}
Request: ${runtime.input.message}`;
}

export function buildAgentUserTurn(runtime: SakiAgentRuntime): string {
  const additionalContext = combinedSakiContextText(runtime.input);
  const errorText = runtime.input.panelError ? `\n\nError: ${redactSensitiveText(runtime.input.panelError)}` : "";
  const skillText = runtime.skills.length
    ? runtime.skills.map((skill) => `- ${skill.id}: ${skill.name} - ${skill.description ?? ""}`).join("\n")
    : "";
  const workingFiles = getRecentWorkingFiles(runtime.userId, runtime.context.workspace?.instanceId ?? null);
  const workingFilesText = workingFiles.length
    ? `\nActive working files:\n${workingFiles.map((file) => `- ${file}`).join("\n")}`
    : "";
  const contextBlock = additionalContext ? `\n\nContext${runtime.input.contextTitle ? ` (${runtime.input.contextTitle})` : ""}:\n${additionalContext}` : "";
  const skillsBlock = skillText ? `\n\nSkills:\n${skillText}` : "";
  return `${contextBlock}${workingFilesText}${skillsBlock}${errorText}

Request: ${runtime.input.message}`.trim();
}

export function buildAgentGitNote(gitSummary: string): string {
  return `Current git status (ephemeral snapshot, not part of the cached workspace prefix):\n${gitSummary.trim()}`;
}

export function buildAgentContinuationPrompt(runtime: SakiAgentRuntime, sessionGoal?: string): string {
  const staticPrompt = runtime.systemPromptOverride || buildStaticAgentSystemPrompt(sakiModelProfile(runtime.config.provider, runtime.config.model));
  const dynamicContext = buildDynamicAgentUserContext(runtime, true);
  const goalText = sessionGoal && sessionGoal !== runtime.input.message
    ? `\n\n[Active Task Objective]: ${sessionGoal}\n[User continuation trigger]: ${runtime.input.message}`
    : `\n\nRequest: ${runtime.input.message}`;

  return `${staticPrompt}

---

${dynamicContext}

[CONTINUATION]:
Prior tool results already contain paths and current file contents. Do not re-search or re-read whole files.
If the user is asking a question, answer it. If work remains, applyPatch or verify next. When done, reply in plain text and stop.${goalText}`;
}
