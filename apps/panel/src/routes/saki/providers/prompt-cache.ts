/** Enable automatic caching for growing Agent conversations on the Claude API.
 * Custom gateways retain their existing wire format; support is not assumed.
 */
export function anthropicAgentCacheOptions(baseUrl: string, agentConversation: boolean): Record<string, unknown> {
  if (!agentConversation) return {};
  try {
    if (new URL(baseUrl).hostname === "api.anthropic.com") return { cache_control: { type: "ephemeral" } };
  } catch { /* Invalid URLs are handled by the request layer. */ }
  return {};
}

/** The standard GLM endpoint clears old reasoning by default. Keep the exact
 * reasoning history for Agent requests, as Coding Plan already does. */
export function glmPreservedThinkingOptions(baseUrl: string): Record<string, unknown> {
  try {
    if (["open.bigmodel.cn", "api.z.ai"].includes(new URL(baseUrl).hostname)) {
      return { thinking: { type: "enabled", clear_thinking: false } };
    }
  } catch { /* Invalid URLs are handled by the request layer. */ }
  return {};
}
