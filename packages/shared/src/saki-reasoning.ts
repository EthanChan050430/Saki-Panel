export type SakiReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type SakiExplicitReasoningEffort = Exclude<SakiReasoningEffort, "auto">;

export interface SakiReasoningProfile {
  levels: readonly SakiExplicitReasoningEffort[];
  defaultLevel: SakiExplicitReasoningEffort;
}

/** Only advertise effort values that the selected model actually accepts. */
export function sakiReasoningProfile(model: string, provider = ""): SakiReasoningProfile {
  const id = model.trim().toLowerCase().split("/").pop() ?? "";
  // These transports have their own reasoning protocol. Do not advertise an
  // OpenAI-format knob until that transport implements the corresponding field.
  if (["copilot", "ollama", "anthropic", "antigravity"].includes(provider.toLowerCase())) return { levels: [], defaultLevel: "high" };
  if (/^glm-5\.3(?:$|[-:])/.test(id)) return { levels: ["low", "high", "max"], defaultLevel: "max" };
  if (/^glm-5\.2(?:$|[-:])/.test(id)) return { levels: ["high", "max"], defaultLevel: "max" };
  if (/^deepseek-(?:chat|reasoner|flash|pro|v4)(?:$|[-.:])/.test(id)) return { levels: ["low", "high", "max"], defaultLevel: "high" };
  if (/^gpt-5[.-][1-9]/.test(id) && !/chat|codex/.test(id)) return { levels: ["low", "medium", "high", "xhigh"], defaultLevel: "medium" };
  if (/^(?:gpt-5|o[134])(?:$|[-.])/.test(id) && !/chat|pro|codex/.test(id)) return { levels: ["low", "medium", "high"], defaultLevel: "medium" };
  return { levels: [], defaultLevel: "high" };
}

export function normalizeSakiReasoningEffort(value: unknown, model: string, provider = ""): SakiReasoningEffort {
  return sakiReasoningProfile(model, provider).levels.includes(value as SakiExplicitReasoningEffort)
    ? value as SakiExplicitReasoningEffort : "auto";
}

export function sakiReasoningEffortLabel(effort: SakiReasoningEffort): string {
  return { auto: "默认", low: "低", medium: "中", high: "高", xhigh: "Ultra", max: "Ultra" }[effort];
}
