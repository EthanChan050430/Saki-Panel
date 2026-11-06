// Zero means no fixed budget; completion, cancellation and stuck guards still stop a run.
function configuredBudget(name: string): number {
  const raw = process.env[name]?.trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a non-negative safe integer (0 disables the budget).`);
  }
  return value;
}

export const maxAgentLoops = 0;
export const agentContinuationCheckpointLoops = 100;

export function agentRunBudgets(requestedMaxLoops?: number) {
  const requested = requestedMaxLoops !== undefined && Number.isFinite(requestedMaxLoops)
    ? Math.max(1, Math.floor(requestedMaxLoops)) : 0;
  // Read after application configuration has loaded .env, not during module evaluation.
  const limits = [requested, configuredBudget("SAKI_AGENT_MAX_LOOPS") || maxAgentLoops].filter(value => value > 0);
  return {
    maxLoops: limits.length ? Math.min(...limits) : null,
    maxTokens: configuredBudget("SAKI_AGENT_MAX_TOKENS"),
    maxDurationMs: configuredBudget("SAKI_AGENT_MAX_DURATION_MS")
  };
}

export function agentBudgetStopMessage(budgets: ReturnType<typeof agentRunBudgets>, tokensUsed: number, elapsedMs: number): string | null {
  if (budgets.maxTokens > 0 && tokensUsed >= budgets.maxTokens) {
    return `本次执行已达到 ${budgets.maxTokens} Token 预算，任务尚未确认完成。已保留进度，可重试继续。`;
  }
  if (budgets.maxDurationMs > 0 && elapsedMs >= budgets.maxDurationMs) {
    return `本次执行已达到 ${Math.ceil(budgets.maxDurationMs / 1000)} 秒时长预算，任务尚未确认完成。已保留进度，可重试继续。`;
  }
  return null;
}
