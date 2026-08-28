import type { SakiChatRequest } from "@webops/shared";
import type { InstanceWithNode, ResolvedSakiContext } from "./types.js";
import { relevantLogLines } from "./prompt.js";

export function buildWatchUserMessage(input: {
  instance: InstanceWithNode;
  context: ResolvedSakiContext;
  exitCode?: number | null;
  logTail: string;
  trigger: string;
  mode: "diagnose_only" | "diagnose_and_patch";
  willRetry: boolean;
}): string {
  const logs = input.logTail.trim()
    || relevantLogLines(input.context.logs).map((line) => `[${line.stream}] ${line.text}`).join("\n")
    || "(no recent logs available)";
  return `[WATCH] Instance "${input.instance.name}" ${input.trigger === "crash_loop" ? "is crash-looping" : "crashed"}.
Trigger: ${input.trigger}
Status: ${input.instance.status}
Exit code: ${input.exitCode ?? input.instance.lastExitCode ?? "unknown"}
Start command: ${input.instance.startCommand}
Working directory: ${input.instance.workingDirectory}
Restart policy: ${input.instance.restartPolicy} (willRetry=${input.willRetry ? "true" : "false"})
Watch mode: ${input.mode}

Recent logs:
${logs}

Diagnose the smallest safe fix. Do not use a shell. Do not change the start command. ${
    input.mode === "diagnose_only"
      ? "Report only; do not edit files."
      : "If a one-line config fix is clear, propose the file edit and wait for approval. Do not restart the instance yourself."
  }`;
}

export function buildWatchSystemPrompt(mode: "diagnose_only" | "diagnose_and_patch"): string {
  return `You are Saki Watch, the on-call operator inside Saki Panel. You were woken by a crash event. The user did not type a message.

Rules:
- Read logs, the start command, and relevant config files before proposing a change.
- Call searchSkills / readSkill early. Follow diagnose-runtime when it matches.
- Only do the smallest fix: one config value, one missing path, one obvious typo. Never refactor.
- Never use shell tools, never delete files, never change instance start/stop commands.
- Do not call instanceAction. After an approved file edit, the panel restarts and verifies.
- If confidence is below 0.5, report only and stop.
- ${mode === "diagnose_only" ? "Do not edit files." : "To edit a file, call the write tool once and wait for approval."}
- Final respond() must be a JSON object:
{"summary":"...","rootCause":"...","changes":[{"path":"relative/path","intent":"..."}],"risk":"low|medium|high","needRestart":true,"confidence":0.0}
Answer in the user's language for summary/rootCause, but keep the JSON keys in English.`;
}

export function watchChatRequest(message: string, instanceId: string): SakiChatRequest {
  return {
    message,
    history: [],
    instanceId,
    mode: "agent",
    agentPermissionMode: "ask"
  };
}
