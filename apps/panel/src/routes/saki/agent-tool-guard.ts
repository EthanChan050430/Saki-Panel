import { createHash } from "node:crypto";
import type { SakiAgentAction } from "@webops/shared";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stableValue(item)]));
  return value;
}

export function agentToolExecutionSignature(tool: string, args: Record<string, unknown> | unknown[], instanceId: string | null): string {
  const semanticArgs = Array.isArray(args) ? args : Object.fromEntries(Object.entries(args).filter(([key]) => key !== "note" && key !== "refresh"));
  return JSON.stringify(stableValue({ tool, args: semanticArgs, instanceId }));
}

/** Null means malformed/unknown: never replay a checklist that was not confirmed. */
export function agentChecklistSignature(args: Record<string, unknown>): string | null {
  const text = typeof args.todos === "string" ? args.todos : typeof args.list === "string" ? args.list : "";
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 20) return null;
  const items = [];
  for (const line of lines) {
    const match = /^- \[([ xX-])\] (.+)$/.exec(line);
    if (!match?.[2]?.trim() || match[2].trim().length > 200) return null;
    items.push({ text: match[2].trim(), completed: match[1]!.toLowerCase() === "x", inProgress: match[1] === "-" });
  }
  return JSON.stringify(items);
}

export function isAgentChecklistTool(name: string): boolean {
  return /^(?:managetodos|settodos|todos|updatetodos|manage_todos|todotool|tasklist)$/i.test(name);
}

/** Repetition follows real executions and evidence, independently of the read cache. */
export class AgentToolLoopGuard {
  private lastAttempt: { signature: string; outcome: string; repeats: number; ok: boolean } | undefined;
  private readonly observations = new Map<string, string>();

  constructor(private readonly duplicateLimit: number) {}

  reset(): void {
    this.lastAttempt = undefined;
    this.observations.clear();
  }

  blockedAttempts(signature: string, readOnly: boolean): number {
    const last = this.lastAttempt;
    // Successful reads may be polling changing state. Judge their returned
    // evidence instead of blocking the next refresh before it can run.
    return last?.signature === signature && last.repeats >= this.duplicateLimit && (!readOnly || !last.ok) ? last.repeats : 0;
  }

  record(signature: string, action: SakiAgentAction, options: { readOnly: boolean; bookkeeping: boolean }): boolean {
    if (options.bookkeeping || action.status === "pending_approval" || action.status === "pending_input" || action.status === "rejected") return false;
    const outcome = createHash("sha256").update(JSON.stringify(stableValue({ ok: action.ok, status: action.status,
      observation: action.observation, attachments: action.attachments }))).digest("hex");
    const last = this.lastAttempt;
    this.lastAttempt = { signature, outcome, ok: action.ok,
      repeats: last?.signature === signature && last.outcome === outcome ? last.repeats + 1 : 1 };
    if (!action.ok) return false;
    const newEvidence = this.observations.get(signature) !== outcome;
    // A confirmed new mutation can change earlier observations, even when
    // there were no cached reads to invalidate. Repeated no-ops do not reset it.
    if (newEvidence && !options.readOnly) this.observations.clear();
    this.observations.delete(signature);
    this.observations.set(signature, outcome);
    if (this.observations.size > 200) this.observations.delete(this.observations.keys().next().value!);
    return newEvidence;
  }
}
