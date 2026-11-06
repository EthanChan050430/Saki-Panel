import { callMcpTool, getMcpTools } from "../../mcp-host.js";

const maxMcpObservationChars = 12000;
const maxSchemaChars = 1200;

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function listMcpToolsForAgent(serverId: string): string {
  const all = getMcpTools().filter((entry) => !serverId || entry.serverId === serverId);
  if (!all.length) {
    return serverId
      ? `No running MCP tools found for server "${serverId}". The plugin may be disabled or its server failed to start.`
      : "No MCP servers are running. Enable a plugin that provides MCP servers in the extension marketplace.";
  }
  const blocks = new Map<string, string[]>();
  for (const { serverId: id, serverName, tool } of all) {
    const lines = blocks.get(id) ?? [`Server ${id} (${serverName})`];
    const schema = clip(JSON.stringify(tool.inputSchema ?? {}), maxSchemaChars);
    lines.push(`- ${tool.name}${tool.description ? `: ${tool.description}` : ""}\n  inputSchema: ${schema}`);
    blocks.set(id, lines);
  }
  return [...blocks.values()].map((lines) => lines.join("\n")).join("\n\n");
}

function formatMcpResult(result: unknown): string {
  if (!isPlainObject(result)) return typeof result === "string" ? result : JSON.stringify(result ?? null);
  const content = Array.isArray(result.content) ? result.content : null;
  if (!content) return JSON.stringify(result);
  const parts = content.map((item) => {
    if (!isPlainObject(item)) return String(item);
    if (item.type === "text" && typeof item.text === "string") return item.text;
    if (item.type === "image") return `[image ${String(item.mimeType ?? "")}]`;
    if (item.type === "resource" && isPlainObject(item.resource)) {
      const resource = item.resource;
      return typeof resource.text === "string" ? resource.text : `[resource ${String(resource.uri ?? "")}]`;
    }
    return JSON.stringify(item);
  });
  const text = parts.join("\n");
  return result.isError === true ? `MCP tool reported an error:\n${text}` : text;
}

export async function callMcpToolForAgent(serverId: string, toolName: string, rawArguments: unknown): Promise<string> {
  if (!serverId) throw new Error("serverId is required. Call listMcpTools first.");
  if (!toolName) throw new Error("toolName is required. Call listMcpTools first.");
  const args = rawArguments === undefined || rawArguments === null ? {} : rawArguments;
  if (!isPlainObject(args)) throw new Error("arguments must be a JSON object.");
  const known = getMcpTools().some((entry) => entry.serverId === serverId && entry.tool.name === toolName);
  if (!known) throw new Error(`MCP tool "${toolName}" is not available on server "${serverId}". Call listMcpTools to see running tools.`);
  const result = await callMcpTool(serverId, toolName, args);
  return clip(formatMcpResult(result), maxMcpObservationChars);
}
