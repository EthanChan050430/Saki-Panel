import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { PANEL_VERSION } from "@webops/shared";

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpServerProcess {
  config: McpServerConfig;
  process: ChildProcess | null;
  tools: McpTool[];
  resources: McpResource[];
  requestId: number;
  pendingRequests: Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>;
  buffer: string;
  initialized: boolean;
  lastError: string;
}

const mcpServers = new Map<string, McpServerProcess>();
const MCP_REQUEST_TIMEOUT_MS = 30000;

function parseJsonRpcMessages(buffer: string): { messages: JsonRpcResponse[]; remaining: string } {
  const messages: JsonRpcResponse[] = [];
  let remaining = buffer;
  while (remaining.length > 0) {
    const start = remaining.indexOf("{");
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < remaining.length; i++) {
      const char = remaining[i];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    try {
      const json = JSON.parse(remaining.slice(start, end + 1));
      if (json.jsonrpc === "2.0" && json.id !== undefined && json.method === undefined) {
        messages.push(json as JsonRpcResponse);
      }
    } catch { /* skip malformed */ }
    remaining = remaining.slice(end + 1);
  }
  return { messages, remaining };
}

async function sendMcpRequest(server: McpServerProcess, method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (!server.process) throw new Error(`MCP server "${server.config.name}" is not running`);
  const id = ++server.requestId;
  const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.pendingRequests.delete(id);
      reject(new Error(`MCP request timed out: ${method}`));
    }, MCP_REQUEST_TIMEOUT_MS);
    server.pendingRequests.set(id, { resolve, reject, timeout });
    const stdin = server.process?.stdin;
    if (stdin) {
      const data = JSON.stringify(request) + "\n";
      stdin.write(data);
    }
  });
}

function sendMcpNotification(server: McpServerProcess, method: string, params?: Record<string, unknown>): void {
  const stdin = server.process?.stdin;
  if (!stdin || stdin.destroyed) return;
  const notification = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
  stdin.write(JSON.stringify(notification) + "\n");
}

async function initializeMcpServer(server: McpServerProcess): Promise<void> {
  const result = await sendMcpRequest(server, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "saki-panel", version: PANEL_VERSION }
  }) as { capabilities?: Record<string, unknown> };
  sendMcpNotification(server, "notifications/initialized");
  server.initialized = true;
  await refreshMcpServerTools(server);
}

async function refreshMcpServerTools(server: McpServerProcess): Promise<void> {
  try {
    const result = await sendMcpRequest(server, "tools/list") as { tools?: McpTool[] };
    server.tools = result.tools ?? [];
  } catch {
    server.tools = [];
  }
  try {
    const result = await sendMcpRequest(server, "resources/list") as { resources?: McpResource[] };
    server.resources = result.resources ?? [];
  } catch {
    server.resources = [];
  }
}

export async function startMcpServer(config: McpServerConfig): Promise<void> {
  if (mcpServers.has(config.id)) {
    await stopMcpServer(config.id);
  }
  const server: McpServerProcess = {
    config,
    process: null,
    tools: [],
    resources: [],
    requestId: 0,
    pendingRequests: new Map(),
    buffer: "",
    initialized: false,
    lastError: ""
  };

  try {
    server.process = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      // npx/uvx are .cmd shims on Windows and need a shell to resolve.
      shell: process.platform === "win32",
      windowsHide: true
    });
  } catch (error) {
    throw new Error(`Failed to start MCP server "${config.name}": ${error instanceof Error ? error.message : String(error)}`);
  }

  const failPending = (reason: string) => {
    server.initialized = false;
    for (const [, pending] of server.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    server.pendingRequests.clear();
  };
  server.process.on("error", (error) => {
    server.lastError = error.message;
    failPending(`MCP server "${config.name}" failed: ${error.message}`);
  });
  server.process.on("close", (code) => {
    failPending(`MCP server "${config.name}" exited (code ${code ?? "null"})${server.lastError ? `: ${server.lastError}` : ""}`);
    if (mcpServers.get(config.id) === server) mcpServers.delete(config.id);
  });
  server.process.stderr?.on("data", (chunk: Buffer) => {
    server.lastError = (server.lastError + chunk.toString()).slice(-600);
  });
  server.process.stdin?.on("error", () => { /* surfaced through request failures */ });
  mcpServers.set(config.id, server);

  if (server.process.stdout) {
    server.process.stdout.on("data", (chunk: Buffer) => {
      server.buffer += chunk.toString();
      const { messages, remaining } = parseJsonRpcMessages(server.buffer);
      server.buffer = remaining;
      for (const message of messages) {
        const pending = server.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          server.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      }
    });
  }

  try {
    await initializeMcpServer(server);
  } catch (error) {
    const detail = server.lastError.trim();
    await stopMcpServer(config.id);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? ` | ${detail.slice(-300)}` : ""}`);
  }
}

export async function stopMcpServer(serverId: string): Promise<void> {
  const server = mcpServers.get(serverId);
  if (!server) return;
  try {
    if (server.process) {
      server.process.kill();
      await new Promise<void>((resolve) => {
        server.process?.on("close", () => resolve());
        setTimeout(resolve, 5000);
      });
    }
  } catch {}
  for (const [, pending] of server.pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("Server stopped"));
  }
  server.pendingRequests.clear();
  mcpServers.delete(serverId);
}

export async function stopAllMcpServers(): Promise<void> {
  const ids = Array.from(mcpServers.keys());
  await Promise.all(ids.map(stopMcpServer));
}

export async function callMcpTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const server = mcpServers.get(serverId);
  if (!server || !server.initialized) throw new Error(`MCP server "${serverId}" is not available`);
  return sendMcpRequest(server, "tools/call", { name: toolName, arguments: args });
}

export function getMcpTools(): Array<{ serverId: string; serverName: string; tool: McpTool }> {
  const result: Array<{ serverId: string; serverName: string; tool: McpTool }> = [];
  for (const [serverId, server] of mcpServers) {
    if (!server.initialized) continue;
    for (const tool of server.tools) {
      result.push({ serverId, serverName: server.config.name, tool });
    }
  }
  return result;
}

export function getMcpResources(): Array<{ serverId: string; serverName: string; resource: McpResource }> {
  const result: Array<{ serverId: string; serverName: string; resource: McpResource }> = [];
  for (const [serverId, server] of mcpServers) {
    if (!server.initialized) continue;
    for (const resource of server.resources) {
      result.push({ serverId, serverName: server.config.name, resource });
    }
  }
  return result;
}

export function getMcpServerStatus(serverId: string): { running: boolean; toolCount: number; error?: string } {
  const server = mcpServers.get(serverId);
  if (!server) return { running: false, toolCount: 0 };
  return {
    running: server.initialized,
    toolCount: server.tools.length,
    ...(server.lastError ? { error: server.lastError.slice(-300) } : {})
  };
}

export function getActiveMcpServers(): Array<{ id: string; name: string; toolCount: number; resourceCount: number }> {
  return Array.from(mcpServers.entries())
    .filter(([, server]) => server.initialized)
    .map(([id, server]) => ({
      id,
      name: server.config.name,
      toolCount: server.tools.length,
      resourceCount: server.resources.length
    }));
}
