import type { SakiPluginMentionSummary } from "@webops/shared";
import { getMcpServerStatus, getMcpTools } from "../../mcp-host.js";

function summarizeSchema(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "";
  const record = schema as { properties?: Record<string, { type?: unknown }>; required?: unknown };
  const required = new Set(Array.isArray(record.required) ? record.required.map(String) : []);
  const props = record.properties ?? {};
  const parts = Object.entries(props)
    .slice(0, 12)
    .map(([key, value]) => {
      const type = typeof value?.type === "string" ? value.type : "any";
      return `${key}${required.has(key) ? "*" : ""}:${type}`;
    });
  return parts.join(", ");
}

/** Context injected when the user references plugins with @plugin:<id>. */
export function buildMentionedPluginContext(plugins: SakiPluginMentionSummary[]): string {
  if (plugins.length === 0) return "";
  const allTools = getMcpTools();
  const blocks = plugins.slice(0, 5).map((plugin) => {
    const lines = [`[Referenced Plugin: ${plugin.displayName} (${plugin.id})]`];
    if (plugin.description) lines.push(plugin.description);
    if (plugin.skillIds.length > 0) {
      lines.push(`Skills applied from this plugin: ${plugin.skillIds.join(", ")}`);
    }
    for (const serverId of plugin.mcpServerIds) {
      const status = getMcpServerStatus(serverId);
      if (!status.running) {
        lines.push(`MCP server ${serverId}: not running${status.error ? ` (${status.error})` : ""}`);
        continue;
      }
      const tools = allTools.filter((entry) => entry.serverId === serverId);
      lines.push(`MCP server ${serverId}: ${tools.length} tool(s). Call with callMcpTool {serverId, toolName, arguments}.`);
      for (const { tool } of tools.slice(0, 30)) {
        const args = summarizeSchema(tool.inputSchema);
        lines.push(`- ${tool.name}${args ? `(${args})` : ""}${tool.description ? `: ${tool.description.slice(0, 200)}` : ""}`);
      }
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}
