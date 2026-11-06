export type SakiReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type SakiExplicitReasoningEffort = Exclude<SakiReasoningEffort, "auto">;

export interface SakiReasoningProfile {
  levels: readonly SakiExplicitReasoningEffort[];
  defaultLevel: SakiExplicitReasoningEffort;
}

const L3: readonly SakiExplicitReasoningEffort[] = ["low", "medium", "high"];
const L4: readonly SakiExplicitReasoningEffort[] = ["low", "medium", "high", "xhigh"];

/** Only advertise effort values that the selected model actually accepts. */
export function sakiReasoningProfile(model: string, provider = ""): SakiReasoningProfile {
  const id = model.trim().toLowerCase().split("/").pop() ?? "";
  const p = provider.toLowerCase();
  // These transports expose no reasoning knob of their own.
  if (["copilot", "antigravity"].includes(p)) return { levels: [], defaultLevel: "high" };
  if (/^glm-5\.3(?:$|[-:])/.test(id)) return { levels: ["low", "high", "max"], defaultLevel: "max" };
  if (/^glm-5\.2(?:$|[-:])/.test(id)) return { levels: ["high", "max"], defaultLevel: "max" };
  if (/^deepseek-(?:chat|reasoner|flash|pro|v4)(?:$|[-.:])/.test(id)) return { levels: ["low", "high", "max"], defaultLevel: "high" };
  // Anthropic: adaptive thinking + output_config.effort on 4.6+/5.x, budget_tokens on older thinking models.
  if (/^claude-(?:opus|sonnet|haiku|fable|mythos)-(?:4-[6-9]|[5-9])/.test(id)) {
    return { levels: ["low", "medium", "high", "xhigh", "max"], defaultLevel: /^claude-opus-5-5/.test(id) ? "medium" : "high" };
  }
  if (/^claude-(?:3-7|sonnet-4|opus-4|haiku-4)/.test(id)) return { levels: L3, defaultLevel: "medium" };
  // OpenAI
  if (/^gpt-oss/.test(id)) return { levels: L3, defaultLevel: "medium" };
  if (/^gpt-(?:5[.-][1-9]|[6-9])/.test(id) && !/chat|codex|image/.test(id)) return { levels: L4, defaultLevel: "medium" };
  if (/^(?:gpt-5|o[134])(?:$|[-.])/.test(id) && !/chat|pro|codex/.test(id)) return { levels: L3, defaultLevel: "medium" };
  // Google Gemini (OpenAI-compatible reasoning_effort -> thinking_level / thinking_budget)
  if (/^gemini-(?:2\.5|[3-9])/.test(id) && !/image|embedding|tts|live/.test(id)) return { levels: L3, defaultLevel: "high" };
  // Volcengine Ark / Doubao Seed
  if (/^doubao-seed-2-[01]/.test(id) || (p === "doubao" && /^doubao-seed-/.test(id))) return { levels: L3, defaultLevel: /^doubao-seed-2-0/.test(id) ? "medium" : "high" };
  // xAI Grok
  if (/^grok-4\.[67]/.test(id)) return { levels: L4, defaultLevel: "high" };
  if (/^grok-4\.5/.test(id)) return { levels: L3, defaultLevel: "high" };
  if (/^grok-4\.3/.test(id)) return { levels: L3, defaultLevel: "low" };
  // Alibaba Qwen (DashScope): reasoning_effort on 3.8, thinking_budget on 3.5-3.7
  if (/^qwen3\.8-/.test(id)) return { levels: ["low", "medium", "xhigh"], defaultLevel: "xhigh" };
  if (/^qwen3\.[5-7]-/.test(id)) return { levels: L3, defaultLevel: "high" };
  // MiniMax M3.1 Flash
  if (/^minimax-m3\.1/.test(id)) return { levels: ["low", "medium", "high", "max"], defaultLevel: "high" };
  return { levels: [], defaultLevel: "high" };
}

/** Token budget used for providers that only expose thinking_budget (Qwen 3.5-3.7, legacy Claude). */
export function sakiReasoningBudgetTokens(effort: SakiReasoningEffort, family: "qwen" | "claude"): number | undefined {
  if (effort === "auto") return undefined;
  const table = family === "qwen"
    ? { low: 1024, medium: 8192, high: 32768 }
    : { low: 2048, medium: 8192, high: 16384 };
  return (table as Record<string, number>)[effort];
}
export function normalizeSakiReasoningEffort(value: unknown, model: string, provider = ""): SakiReasoningEffort {
  return sakiReasoningProfile(model, provider).levels.includes(value as SakiExplicitReasoningEffort)
    ? value as SakiExplicitReasoningEffort : "auto";
}

export function sakiReasoningEffortLabel(effort: SakiReasoningEffort): string {
  return { auto: "默认", low: "低", medium: "中", high: "高", xhigh: "Ultra", max: "Ultra" }[effort];
}
