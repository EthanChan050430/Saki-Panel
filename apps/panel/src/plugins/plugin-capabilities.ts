import fs from "node:fs";
import path from "node:path";
import type {
  InstalledPlugin,
  SakiPluginCapabilitySummary,
  SakiPluginMentionSummary,
  SakiPluginMcpServer
} from "@webops/shared";
import { panelPaths } from "../config.js";
import { getMcpServerStatus, startMcpServer, stopMcpServer } from "../mcp-host.js";
import { sakiSkillDirectory, saveSakiSkill } from "../routes/saki/skills.js";

export interface PluginSkillFile {
  /** Saki skill id (`<pluginId>--<dir>`). */
  id: string;
  dirName: string;
  name: string;
  description: string;
  content: string;
}

export interface PluginMcpServerDef extends SakiPluginMcpServer {
  /** Globally unique MCP host id (`<pluginId>:<key>`). */
  id: string;
  key: string;
}

const PLUGIN_SKILL_SOURCE_PREFIX = "plugin:";

export function pluginSkillSourceType(pluginId: string): string {
  return `${PLUGIN_SKILL_SOURCE_PREFIX}${pluginId}`;
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function pluginSkillId(pluginId: string, dirName: string): string {
  const id = `${sanitizeSegment(pluginId)}--${sanitizeSegment(dirName)}`;
  return id.slice(0, 80).replace(/-+$/g, "") || "plugin-skill";
}

export function pluginMcpServerId(pluginId: string, key: string): string {
  return `${pluginId}:${key}`;
}

function parseSkillFrontmatter(raw: string): { name: string; description: string; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta: Record<string, string> = {};
  if (match) {
    for (const line of (match[1] ?? "").split(/\r?\n/)) {
      const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!pair) continue;
      meta[pair[1] ?? ""] = (pair[2] ?? "").trim().replace(/^["']([\s\S]*)["']$/, "$1");
    }
  }
  return {
    name: meta.name ?? "",
    description: meta.description ?? "",
    body: (match ? text.slice(match[0].length) : text).trim()
  };
}

function pluginDir(plugin: InstalledPlugin): string {
  return plugin.localPath || path.join(panelPaths.pluginsDir, plugin.id);
}

function resolveInside(root: string, relative: string): string | null {
  const resolved = path.resolve(root, relative);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) return null;
  return resolved;
}

export function readPluginSkillFiles(plugin: InstalledPlugin): PluginSkillFile[] {
  const root = pluginDir(plugin);
  const skillsRoot = resolveInside(root, plugin.manifest.skills || "skills");
  if (!skillsRoot || !fs.existsSync(skillsRoot)) return [];
  const result: PluginSkillFile[] = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsRoot, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = parseSkillFrontmatter(fs.readFileSync(file, "utf8"));
      if (!parsed.body) continue;
      result.push({
        id: pluginSkillId(plugin.id, entry.name),
        dirName: entry.name,
        name: parsed.name || entry.name,
        description: parsed.description,
        content: parsed.body
      });
    } catch {
      // skip unreadable skill
    }
  }
  return result;
}

function substitutePluginRoot(value: string, root: string): string {
  return value.replace(/\$\{(?:CODEX_PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT|SAKI_PLUGIN_ROOT)\}/g, root);
}

function normalizeMcpServer(raw: unknown, root: string): SakiPluginMcpServer | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.command !== "string" || !value.command.trim()) return null;
  const args = Array.isArray(value.args)
    ? value.args.filter((item): item is string => typeof item === "string").map((item) => substitutePluginRoot(item, root))
    : undefined;
  let env: Record<string, string> | undefined;
  if (value.env && typeof value.env === "object") {
    env = {};
    for (const [key, entry] of Object.entries(value.env as Record<string, unknown>)) {
      if (typeof entry === "string") env[key] = substitutePluginRoot(entry, root);
    }
  }
  return {
    command: substitutePluginRoot(value.command.trim(), root),
    args,
    env,
    description: typeof value.description === "string" ? value.description : undefined
  };
}

export function readPluginMcpServers(plugin: InstalledPlugin): PluginMcpServerDef[] {
  const root = pluginDir(plugin);
  const collected: Record<string, unknown> = {};

  const mcpFile = path.join(root, ".mcp.json");
  if (fs.existsSync(mcpFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpFile, "utf8")) as Record<string, unknown>;
      const map = (parsed.mcpServers ?? parsed.servers ?? parsed) as Record<string, unknown>;
      if (map && typeof map === "object") Object.assign(collected, map);
    } catch (error) {
      console.warn(`Invalid .mcp.json in plugin ${plugin.id}:`, error);
    }
  }
  if (plugin.manifest.mcp?.servers) Object.assign(collected, plugin.manifest.mcp.servers);

  const defs: PluginMcpServerDef[] = [];
  for (const [key, raw] of Object.entries(collected)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) continue;
    const server = normalizeMcpServer(raw, root);
    if (!server) continue;
    defs.push({ ...server, id: pluginMcpServerId(plugin.id, key), key });
  }
  return defs;
}

export function pluginHasCapabilities(plugin: InstalledPlugin): { skills: boolean; mcp: boolean } {
  return {
    skills: readPluginSkillFiles(plugin).length > 0,
    mcp: readPluginMcpServers(plugin).length > 0
  };
}

export async function removePluginSkills(plugin: InstalledPlugin): Promise<void> {
  const root = pluginDir(plugin);
  const skillsRoot = resolveInside(root, plugin.manifest.skills || "skills");
  const names = new Set<string>();
  if (skillsRoot && fs.existsSync(skillsRoot)) {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  }
  for (const name of names) {
    fs.rmSync(sakiSkillDirectory(pluginSkillId(plugin.id, name)), { recursive: true, force: true });
  }
  // Also clean up skills left behind by older versions of the plugin.
  const prefix = `${sanitizeSegment(plugin.id)}--`;
  if (fs.existsSync(panelPaths.sakiSkillsDir)) {
    for (const entry of fs.readdirSync(panelPaths.sakiSkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(prefix)) {
        const marker = path.join(panelPaths.sakiSkillsDir, entry.name, "SKILL.md");
        try {
          if (fs.readFileSync(marker, "utf8").includes(pluginSkillSourceType(plugin.id))) {
            fs.rmSync(path.join(panelPaths.sakiSkillsDir, entry.name), { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    }
  }
}

export async function syncPluginSkills(plugin: InstalledPlugin): Promise<void> {
  await removePluginSkills(plugin);
  for (const skill of readPluginSkillFiles(plugin)) {
    await saveSakiSkill({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      enabled: true,
      sourceType: pluginSkillSourceType(plugin.id),
      tags: ["plugin", plugin.id]
    });
  }
}

export async function stopPluginMcp(plugin: InstalledPlugin): Promise<void> {
  for (const server of readPluginMcpServers(plugin)) {
    await stopMcpServer(server.id).catch(() => undefined);
  }
}

export async function startPluginMcp(plugin: InstalledPlugin): Promise<void> {
  await stopPluginMcp(plugin);
  for (const server of readPluginMcpServers(plugin)) {
    try {
      await startMcpServer({
        id: server.id,
        name: `${plugin.manifest.displayName} / ${server.key}`,
        command: server.command,
        ...(server.args ? { args: server.args } : {}),
        ...(server.env ? { env: server.env } : {}),
        enabled: true
      });
    } catch (error) {
      console.warn(`MCP server ${server.id} failed to start:`, error instanceof Error ? error.message : error);
    }
  }
}

export function describePluginCapabilities(plugin: InstalledPlugin): SakiPluginCapabilitySummary {
  return {
    skills: readPluginSkillFiles(plugin).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description
    })),
    mcpServers: readPluginMcpServers(plugin).map((server) => {
      const status = getMcpServerStatus(server.id);
      return {
        id: server.id,
        name: server.key,
        command: [server.command, ...(server.args ?? [])].join(" "),
        description: server.description,
        running: status.running,
        toolCount: status.toolCount,
        error: status.error
      };
    })
  };
}

export async function applyPluginCapabilities(plugin: InstalledPlugin): Promise<void> {
  if (!plugin.enabled) {
    await removePluginCapabilities(plugin);
    return;
  }
  await syncPluginSkills(plugin);
  await startPluginMcp(plugin);
}

export async function removePluginCapabilities(plugin: InstalledPlugin): Promise<void> {
  await stopPluginMcp(plugin);
  await removePluginSkills(plugin);
}

export async function restorePluginCapabilities(plugins: InstalledPlugin[]): Promise<void> {
  for (const plugin of plugins) {
    if (!plugin.enabled || !pluginHasCapabilities(plugin).mcp) continue;
    await startPluginMcp(plugin);
  }
}

export function buildPluginMentionSummaries(plugins: InstalledPlugin[]): SakiPluginMentionSummary[] {
  const result: SakiPluginMentionSummary[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const skills = readPluginSkillFiles(plugin);
    const servers = readPluginMcpServers(plugin);
    if (skills.length === 0 && servers.length === 0) continue;
    result.push({
      id: plugin.id,
      name: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      description: plugin.manifest.description ?? "",
      ...(plugin.manifest.icon ? { icon: plugin.manifest.icon } : {}),
      ...(plugin.manifest.interface?.category ? { category: plugin.manifest.interface.category } : {}),
      skillCount: skills.length,
      mcpCount: servers.length,
      skillIds: skills.map((skill) => skill.id),
      mcpServerIds: servers.map((server) => server.id)
    });
  }
  return result;
}
