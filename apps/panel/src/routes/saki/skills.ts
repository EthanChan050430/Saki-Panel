import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CreateSakiSkillRequest,
  DownloadSakiSkillRequest,
  SakiSkillDetail,
  SakiSkillSummary,
  UpdateSakiSkillRequest
} from "@webops/shared";
import { panelPaths } from "../../config.js";
import {
  autoApplySkillScoreThreshold,
  fetchWithTimeout,
  maxAgentSkillContentChars,
  maxAutoAppliedSakiSkills,
  maxAutoAppliedSkillContextChars,
  maxSakiSkillContentChars,
  RouteError,
  sakiSkillFileName,
  uniqueSkills,
  trimString,
  webUserAgent,
  type BuiltinSakiSkill,
  type SakiSkillDocument
} from "./types.js";
import { assertPublicHttpUrl, normalizeHttpUrl } from "./web.js";

const toolDeltaPluginSkillContent = `# ToolDelta 插件作者 Skill

当用户要编写、修复、迁移或审查 ToolDelta 插件时，必须先应用本 Skill。目标是产出能被 ToolDelta 正确识别、加载、运行，并便于维护的类式插件。除非用户明确只要解释，不要只给片段、伪代码或“省略其余代码”；应交付完整、可加载的 \`__init__.py\`。

## 触发词

ToolDelta、ToolDelta 插件、td 插件、类式插件、租赁服插件、Minecraft 插件、plugin_entry、entry = plugin_entry、ListenActive、ListenChat、ListenPacket、插件文件、插件数据文件、配置文件、tempjson。

## 不可省略的硬性规则

- 类式插件必须位于 \`插件文件/ToolDelta类式插件/<插件目录名>/__init__.py\`，其中 \`<插件目录名>\` 会被 ToolDelta 当成 Python 包导入。目录名可以中文，但不能包含空格、连字符、点号、斜杠等不可作为包名导入的字符；不要只在根目录写孤立 \`.py\` 文件。
- \`__init__.py\` 必须导入 \`plugin_entry\` 和 \`Plugin\`，插件主类必须继承 \`Plugin\`，并且 \`__init__\` 第一行必须先 \`super().__init__(frame)\`。
- 模块最外层最后必须注册入口：\`entry = plugin_entry(你的插件类)\`。这是 ToolDelta 加载器查找的变量，不是可选项。
- \`entry = plugin_entry(...)\` 不能写进类、函数、\`if __name__ == "__main__"\`、回调或注释里；不能写成 \`entry = 插件类\`、\`entry = 插件类()\`、\`plugin_entry(插件类)\` 无赋值，也不能遗漏。
- 只有当插件明确要作为 API 前置插件暴露接口时，才使用 \`entry = plugin_entry(你的插件类, api_name="接口名", api_version=(0, 0, 1))\` 或 \`api_name=[...]\`；普通插件只写 \`entry = plugin_entry(你的插件类)\`。
- 监听注册必须集中放在 \`__init__\` 的 \`super().__init__(frame)\` 之后，例如 \`self.ListenActive(self.on_active)\`；不要只定义 \`on_active\`/\`on_chat\` 却忘记注册。
- 使用 \`ListenPacket\` 时回调必须返回 \`bool\`：\`True\` 表示拦截，\`False\` 表示放行；不要漏掉 \`return False\`。
- 最终回复需要主动说明插件文件路径，并明确说已在文件末尾写入 \`entry = plugin_entry(插件类)\`。如果是审查/修复任务，必须把入口是否存在作为首要检查项之一。

## 工作流程

1. 先确认当前实例工作目录是不是 ToolDelta 根目录。优先用 listFiles 查看根目录，查找 \`插件文件\`、\`插件数据文件\`、\`ToolDelta类式插件\` 等目录。
2. 新建插件时使用类式插件目录：\`插件文件/ToolDelta类式插件/<插件名>/__init__.py\`。不要放到项目根目录，也不要只写一个孤立 py 文件。
3. 插件数据统一通过 \`self.data_path\` 或 \`self.format_data_path(...)\` 放在 \`插件数据文件/<Plugin.name>/\`，不要把运行期数据写进插件代码目录。
4. 写代码前明确插件名、作者、版本、触发事件、命令/聊天格式、数据结构和配置默认值。
5. 修改已有插件前先 readFile。新增插件则先 mkdir 插件目录，再 writeFile 完整的 \`__init__.py\`，不要留下 \`...\`、伪代码或未实现的关键路径。
6. 完成后检查：导入是否存在、类是否继承 \`Plugin\`、监听是否在 \`__init__\` 注册、模块最外层末尾是否有 \`entry = plugin_entry(插件类)\`、数据路径是否规范。

## 最小目录结构

\`\`\`text
插件文件/
  ToolDelta类式插件/
    示例插件/
      __init__.py
插件数据文件/
  示例插件/
    config.json
    data.json
\`\`\`

ToolDelta 官方文档明确类式插件应在 \`插件文件/ToolDelta类式插件\` 下以文件夹形式存在，文件夹内的 \`__init__.py\` 是主插件模块文件。

## 标准代码骨架

\`\`\`python
from tooldelta import plugin_entry, Plugin, ToolDelta, Player, Chat, FrameExit
from tooldelta.constants import PacketIDS


class ExamplePlugin(Plugin):
    name = "示例插件"
    author = "作者名"
    version = (0, 0, 1)

    def __init__(self, frame: ToolDelta):
        super().__init__(frame)
        self.ListenPreload(self.on_preload)
        self.ListenActive(self.on_active)
        self.ListenPlayerJoin(self.on_player_join)
        self.ListenPlayerLeave(self.on_player_leave)
        self.ListenChat(self.on_chat)
        self.ListenPacket(PacketIDS.Text, self.on_pkt_text)
        self.ListenFrameExit(self.on_frame_exit)

    def on_preload(self):
        # GetPluginAPI 必须放在 preload 或更晚，不能放在 __init__。
        pass

    def on_active(self):
        print(f"{self.name} 已启动")

    def on_chat(self, chat: Chat):
        player = chat.player
        msg = chat.msg.strip()
        if msg == "/hello":
            player.show("Hello from ToolDelta")

    def on_player_join(self, player: Player):
        self.game_ctrl.say_to("@a", f"欢迎 {player.name}")

    def on_player_leave(self, player: Player):
        pass

    def on_frame_exit(self, evt: FrameExit):
        print(f"框架退出或插件重载: signal={evt.signal}, reason={evt.reason}")

    def on_pkt_text(self, packet: dict):
        # ListenPacket 回调应返回 bool；True 表示拦截，False 表示不拦截。
        return False


entry = plugin_entry(ExamplePlugin)
\`\`\`

## 入口与生命周期规则

- 必须导入并使用 \`plugin_entry\`，末尾写 \`entry = plugin_entry(你的插件类)\`。
- ToolDelta 加载类式插件后会读取模块最外层变量 \`entry\`，并检查它是不是 \`Plugin\` 实例；缺失或写错会报“没有在最外层代码使用 entry = plugin_entry(YourPlugin) 语句注册插件”。
- \`plugin_entry(插件类)\` 会实例化插件主类，所以不要手动实例化插件，也不要把 \`entry\` 指向类对象本身。
- 插件类必须继承 \`Plugin\`。
- \`name\` 必须设置，\`author\` 可选，\`version\` 推荐使用三元整数元组，如 \`(0, 0, 1)\`。
- \`__init__(self, frame: ToolDelta)\` 中必须先 \`super().__init__(frame)\`，然后注册监听。
- \`GetPluginAPI\` 不要写在 \`__init__\`，应写在 \`on_preload\` 或之后，避免加载顺序问题。
- \`ListenPacket\` 可能早于 \`ListenActive\` 被执行；不要在数据包回调里假设服务器已完全初始化。
- \`ListenFrameExit\` 在异常退出或插件重载时也可能执行，只做清理和落盘，不做复杂依赖调用。
- 所有监听方法都支持可选 \`priority\` 参数；除非用户要求控制执行顺序，否则保持默认值即可。

## 常用监听

- \`ListenPreload(self.on_preload)\`: 插件读取完成、进入租赁服前。
- \`ListenActive(self.on_active)\`: 初始化完成并接入服务器后。
- \`ListenPlayerJoin(self.on_player_join)\`: 玩家加入，参数 \`Player\`。
- \`ListenPlayerLeave(self.on_player_leave)\`: 玩家退出，参数 \`Player\`。
- \`ListenChat(self.on_chat)\`: 玩家聊天，参数 \`Chat\`，常用 \`chat.player\` 和 \`chat.msg\`。
- \`ListenPacket(PacketIDS.Text, self.on_pkt_text)\`: 监听数据包，回调返回 bool。
- \`ListenBytesPacket(PacketIDS.Xxx, self.on_bytes_pkt)\`: 监听二进制数据包；不要用 \`ListenPacket\` 监听二进制包。
- \`ListenInternalBroadcast("事件名", self.on_broadcast)\`: 监听插件内部广播，需要跨插件通信时再使用。
- \`ListenFrameExit(self.on_frame_exit)\`: 系统退出或重载，参数 \`FrameExit\`。

## 配置文件规范

简单配置推荐使用 \`tooldelta.cfg\`，让 ToolDelta 自动创建、校验并给出可读错误。

\`\`\`python
from tooldelta import cfg

DEFAULT_CONFIG = {
    "启用": True,
    "冷却秒数": 5,
    "管理员": ["Steve"],
}

CONFIG_SCHEMA = {
    "启用": bool,
    "冷却秒数": cfg.NNInt,
    "管理员": cfg.JsonList(str),
}

config, config_version = cfg.get_plugin_config_and_version(
    ExamplePlugin.name,
    CONFIG_SCHEMA,
    DEFAULT_CONFIG,
    (0, 0, 1),
)
\`\`\`

在插件类内部也可以用 \`self.get_config_and_version(CONFIG_SCHEMA, DEFAULT_CONFIG)\`，它会自动使用 \`self.name\` 和 \`self.version\`。

可用校验类型包括 \`int\`、\`str\`、\`bool\`、\`dict\`、\`None\`、元组多类型，以及 \`cfg.PInt\`、\`cfg.NNInt\`、\`cfg.PFloat\`、\`cfg.NNFloat\`、\`cfg.Number\`、\`cfg.PNumber\`、\`cfg.NNNumber\`、\`cfg.JsonList(type)\`、\`cfg.AnyKeyValue(type)\`。

ToolDelta 1.2.4+ 可用配置模板类：

\`\`\`python
from tooldelta.utils.cfg_meta import JsonSchema, field, get_plugin_config_and_version


class ConfigSchema(JsonSchema):
    enabled: bool = field("启用", True)
    cooldown: int = field("冷却秒数", 5)
    admins: list[str] = field("管理员", ["Steve"])


config, version = get_plugin_config_and_version(
    ExamplePlugin.name,
    ConfigSchema,
    ConfigSchema(),
    (0, 0, 1),
)
\`\`\`

不要把类型注解写成字符串，例如 \`list["JobSchema"]\`，运行时 ToolDelta 无法解析。

## 数据文件规范

\`Plugin\` 提供数据目录工具：

- \`self.data_path\`: 获取并自动创建 \`插件数据文件/<插件名>\`。新版 ToolDelta 中它是 \`pathlib.Path\`，优先写 \`self.data_path / "data.json"\`。
- \`self.format_data_path("data.json")\`: 拼出 \`插件数据文件/<插件名>/data.json\`；旧插件常见，仍可读写，但新代码优先使用 \`self.data_path / ...\`。
- \`self.make_data_path()\`: 旧写法，创建 \`插件数据文件/<插件名>/\`；通常直接访问 \`self.data_path\` 即可。

频繁读写 JSON 用 \`tooldelta.utils.tempjson\`：

\`\`\`python
from tooldelta.utils import tempjson

path = self.format_data_path("players.json")
players = tempjson.load_and_read(path, need_file_exists=False, default={})
players[player.name] = players.get(player.name, 0) + 1
tempjson.load_and_write(path, players, need_file_exists=False)
\`\`\`

如果使用 \`Path\` 写法而 API 需要字符串，传入 \`str(self.data_path / "players.json")\`。

如果整个运行周期频繁访问同一文件，可以 \`tempjson.load(path, need_file_exists=False, default={})\`，之后用 \`tempjson.read(path)\` 和 \`tempjson.write(path, obj)\`，需要立刻落盘时 \`tempjson.flush(path)\` 或卸载时 \`tempjson.unload(path)\`。

## 格式与质量要求

- Python 代码使用 4 空格缩进，类名 PascalCase，函数/变量 snake_case。
- 插件目录名可以中文，但必须能作为 Python 包名被导入；Python 类名必须是合法标识符。
- 所有用户输入都要 \`strip()\`，命令解析要处理空参数。
- 给玩家输出用 \`player.show(...)\` 或 \`self.game_ctrl.say_to(...)\`；执行 MC 指令用 \`self.game_ctrl.sendcmd(...)\`；插件日志优先用 \`self.print(...)\`、\`self.print_suc(...)\`、\`self.print_war(...)\`、\`self.print_err(...)\`。
- 不要吞异常后静默失败。必要时 \`print\` 清晰上下文。
- 不要硬编码绝对路径、服务器账号、token、API key。
- 不要在聊天/数据包回调里做长时间阻塞任务；需要耗时操作时考虑异步或缓存。
- 不要使用已移除或不存在的“监听所有数据包”能力；只监听明确需要的 \`PacketIDS\`。

## 交付检查清单

- 路径正确：\`插件文件/ToolDelta类式插件/<插件名>/__init__.py\`。
- 类正确：继承 \`Plugin\`，有 \`name\`，有 \`version\`。
- 初始化正确：\`super().__init__(frame)\`，监听注册完整。
- 入口正确：模块最外层末尾存在且仅存在正确的 \`entry = plugin_entry(插件类)\`；API 插件才带 \`api_name\`/\`api_version\`。
- 配置正确：默认值、schema、版本号一致。
- 数据正确：写到 \`插件数据文件/<Plugin.name>/\`，不污染插件源码目录。
- 安全正确：没有硬编码敏感信息，没有不必要的危险命令。
- 交付正确：最终说明写明插件路径、入口已注册、是否需要重启/重载 ToolDelta。

资料来源：
- https://wiki.tooldelta.top/plugin-dev/
- https://wiki.tooldelta.top/plugin-dev/class-plugin/创建插件
- https://wiki.tooldelta.top/plugin-dev/class-plugin/插件主体
- https://wiki.tooldelta.top/plugin-dev/class-plugin/插件数据
- https://wiki.tooldelta.top/plugin-dev/api/配置文件
- https://wiki.tooldelta.top/plugin-dev/api/缓存式json文件
`;

const builtinSakiSkills: BuiltinSakiSkill[] = [
  {
    id: "diagnose-runtime",
    name: "Runtime diagnosis",
    description: "Inspect recent stderr, exit codes, ports, paths, and dependency failures.",
    tags: ["runtime", "logs", "diagnostics", "terminal"],
    content: "Use recent logs, exit codes, working directory, start command, ports, dependency files, and permission errors to identify the smallest concrete fix. Read relevant files or logs before proposing changes."
  },
  {
    id: "fix-start-command",
    name: "Start command",
    description: "Repair instance start commands, working directories, and restart settings.",
    tags: ["instance", "start", "command", "restart"],
    content: "When fixing a start command, inspect the active instance settings, list the working directory, confirm the entrypoint file exists, then suggest or apply the smallest setting update. Do not change unrelated instance settings."
  },
  {
    id: "explain-panel-error",
    name: "Panel error",
    description: "Explain Saki Panel, terminal, and daemon errors in concrete next steps.",
    tags: ["panel", "daemon", "error"],
    content: "Translate panel, daemon, terminal, and API errors into concrete causes and next steps. Prefer evidence from logs, request context, and current permissions."
  },
  {
    id: "safe-change",
    name: "Safe change",
    description: "Prefer small scoped edits and call out risky operations before suggesting them.",
    tags: ["safety", "edits", "review"],
    content: "Before editing, inspect existing files. Prefer line edits. Avoid destructive commands. Keep changes scoped to the user's request and explain any approval-required action."
  },
  {
    id: "tooldelta-plugin-author",
    name: "ToolDelta plugin author",
    description: "Write fully compliant ToolDelta class plugins with correct folders, plugin_entry, listeners, config, and data files.",
    tags: ["tooldelta", "plugin", "minecraft", "python", "类式插件", "插件开发"],
    content: toolDeltaPluginSkillContent
  }
];

function normalizeSkillTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => trimString(tag)).filter(Boolean).slice(0, 16);
  }
  const raw = trimString(value);
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => trimString(tag)).filter(Boolean).slice(0, 16);
      }
    } catch {
      // Fall back to comma/space splitting below.
    }
  }
  return raw
    .split(/[,，;；\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function sanitizeSkillId(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || `skill-${randomUUID().slice(0, 8)}`;
}

function requireSkillId(value: string): string {
  const id = trimString(value);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id)) {
    throw new RouteError("Skill id must use letters, numbers, hyphens, or underscores.", 400);
  }
  return id.toLowerCase();
}

export function sakiSkillDirectory(id: string): string {
  return path.join(panelPaths.sakiSkillsDir, requireSkillId(id));
}

function sakiSkillPath(id: string): string {
  return path.join(sakiSkillDirectory(id), sakiSkillFileName);
}

function parseFrontmatterValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  const quoted = trimmed.match(/^["']([\s\S]*)["']$/);
  return quoted ? quoted[1] : trimmed;
}

function parseSkillMarkdown(raw: string): { metadata: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { metadata: {}, content: raw.trim() };
  const metadata: Record<string, unknown> = {};
  const lines = (match[1] ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1] ?? "";
    const value = pair[2] ?? "";
    if (!value && lines[index + 1]?.trim().startsWith("- ")) {
      const items: string[] = [];
      while (lines[index + 1]?.trim().startsWith("- ")) {
        index += 1;
        items.push(lines[index]?.trim().replace(/^-\s*/, "") ?? "");
      }
      metadata[key] = items;
    } else {
      metadata[key] = parseFrontmatterValue(value);
    }
  }
  return { metadata, content: raw.slice(match[0].length).trim() };
}

function frontmatterLine(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return `${key}: ${JSON.stringify(value)}`;
  if (typeof value === "boolean" || typeof value === "number") return `${key}: ${String(value)}`;
  return `${key}: ${JSON.stringify(String(value))}`;
}

function serializeSkillMarkdown(skill: SakiSkillDetail): string {
  const lines = [
    frontmatterLine("id", skill.id),
    frontmatterLine("name", skill.name),
    frontmatterLine("description", skill.description ?? ""),
    frontmatterLine("enabled", skill.enabled !== false),
    frontmatterLine("sourceType", skill.sourceType ?? "local"),
    frontmatterLine("sourceUrl", skill.sourceUrl ?? ""),
    frontmatterLine("tags", skill.tags ?? [])
  ].filter((line): line is string => Boolean(line));
  return `---\n${lines.join("\n")}\n---\n\n${skill.content.trim()}\n`;
}

function mapSkillDocumentFromFile(id: string, filePath: string, raw: string, statsUpdatedAt?: Date): SakiSkillDocument | null {
  const { metadata, content } = parseSkillMarkdown(raw);
  const name = trimString(metadata.name) || trimString(metadata.title) || id;
  if (!name || !content) return null;
  const description = trimString(metadata.description);
  const sourceType = trimString(metadata.sourceType) || trimString(metadata.source) || "local";
  const sourceUrl = trimString(metadata.sourceUrl) || trimString(metadata.url);
  const tags = normalizeSkillTags(metadata.tags);
  const enabled = typeof metadata.enabled === "boolean" ? metadata.enabled : true;
  return {
    id,
    name,
    content: content.slice(0, maxSakiSkillContentChars),
    filePath,
    enabled,
    sourceType,
    ...(description ? { description } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(tags.length ? { tags } : {}),
    updatedAt: statsUpdatedAt?.toISOString() ?? null,
    tokenEstimate: Math.ceil(content.length / 4),
    builtin: sourceType === "builtin"
  };
}

export function toSkillSummary(skill: SakiSkillDocument): SakiSkillSummary {
  const summary: SakiSkillSummary = {
    id: skill.id,
    name: skill.name,
    description: skill.description ?? null,
    enabled: skill.enabled !== false,
    sourceType: skill.sourceType ?? "local",
    tags: skill.tags ?? [],
    sourceUrl: skill.sourceUrl ?? null,
    updatedAt: skill.updatedAt ?? null
  };
  if (skill.tokenEstimate !== undefined) summary.tokenEstimate = skill.tokenEstimate;
  if (skill.builtin !== undefined) summary.builtin = skill.builtin;
  return summary;
}

export async function ensureBuiltinSakiSkills(): Promise<void> {
  await fs.mkdir(panelPaths.sakiSkillsDir, { recursive: true });
  for (const skill of builtinSakiSkills) {
    const filePath = sakiSkillPath(skill.id);
    try {
      await fs.access(filePath);
      continue;
    } catch {
      const detail: SakiSkillDetail = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        enabled: true,
        sourceType: "builtin",
        tags: skill.tags,
        content: skill.content
      };
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, serializeSkillMarkdown(detail), "utf8");
    }
  }
}

async function readAllSakiSkillDocuments(includeDisabled = false): Promise<SakiSkillDocument[]> {
  await ensureBuiltinSakiSkills();
  const entries = await fs.readdir(panelPaths.sakiSkillsDir, { withFileTypes: true }).catch(() => []);
  const documents: SakiSkillDocument[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let id: string;
    try {
      id = requireSkillId(entry.name);
    } catch {
      continue;
    }
    const filePath = sakiSkillPath(id);
    try {
      const [raw, stats] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
      const document = mapSkillDocumentFromFile(id, filePath, raw, stats.mtime);
      if (document && (includeDisabled || document.enabled !== false)) documents.push(document);
    } catch {
      // Skip malformed or missing skill folders.
    }
  }
  return uniqueSkills(documents.map(toSkillSummary))
    .map((summary) => documents.find((document) => document.id === summary.id))
    .filter((document): document is SakiSkillDocument => Boolean(document));
}

function scoreSkill(skill: SakiSkillDocument, terms: string[]): number {
  if (terms.length === 0) return skill.sourceType === "builtin" ? 2 : 1;
  const name = skill.name.toLowerCase();
  const id = skill.id.toLowerCase();
  const description = (skill.description ?? "").toLowerCase();
  const tags = (skill.tags ?? []).join(" ").toLowerCase();
  const contentHead = skill.content.slice(0, 2400).toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (id.includes(term)) score += 8;
    if (name.includes(term)) score += 7;
    if (tags.includes(term)) score += 5;
    if (description.includes(term)) score += 3;
    if (contentHead.includes(term)) score += 1;
  }
  return score;
}

function skillQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,，。；;:：/\\|]+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function expandedSkillQueryTerms(query: string): string[] {
  const normalized = query.toLowerCase();
  const terms: string[] = [];
  const addTerm = (value: string) => {
    const term = value.trim().replace(/^[._-]+|[._-]+$/g, "");
    if (term.length < 2 || terms.includes(term)) return;
    terms.push(term);
  };

  skillQueryTerms(query).forEach(addTerm);
  (normalized.match(/[a-z0-9][a-z0-9_.-]{1,}/g) ?? []).forEach(addTerm);
  for (const phrase of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    addTerm(phrase);
    for (let index = 0; index < phrase.length - 1 && terms.length < 48; index += 1) {
      addTerm(phrase.slice(index, index + 2));
    }
  }

  return terms.slice(0, 48);
}

export async function loadSakiSkills(query = "", includeDisabled = false): Promise<{ skills: SakiSkillSummary[]; online: boolean }> {
  const documents = await readAllSakiSkillDocuments(includeDisabled);
  const terms = expandedSkillQueryTerms(query);
  const ranked = documents
    .map((skill) => ({ skill, score: scoreSkill(skill, terms) }))
    .filter((item) => terms.length === 0 || item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name));
  const selected = (ranked.length ? ranked.map((item) => item.skill) : documents).slice(0, includeDisabled ? 200 : 12);
  return { skills: selected.map(toSkillSummary), online: true };
}

export async function buildAutoAppliedSakiSkillContext(
  skills: SakiSkillSummary[],
  query: string,
  selectedSkillIds: readonly string[] = []
): Promise<string> {
  const availableIds = new Set(skills.map((skill) => skill.id));
  const selectedIds = new Set(selectedSkillIds.map(trimString).filter(Boolean));
  if (availableIds.size === 0 && selectedIds.size === 0) return "";

  const terms = expandedSkillQueryTerms(query);
  const documents = await readAllSakiSkillDocuments(false);
  const candidates = documents
    .filter((skill) => availableIds.has(skill.id) || selectedIds.has(skill.id))
    .map((skill) => ({
      skill,
      selected: selectedIds.has(skill.id),
      score: scoreSkill(skill, terms)
    }))
    .filter((item) => item.selected || item.score >= autoApplySkillScoreThreshold)
    .sort((left, right) => Number(right.selected) - Number(left.selected) || right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, maxAutoAppliedSakiSkills);

  if (candidates.length === 0) return "";

  const sections: string[] = [
    "Auto-applied Saki Skill instructions:",
    "These instructions are mandatory for this request. Follow them before general behavior rules when they match the task."
  ];
  let used = sections.join("\n").length;
  for (const candidate of candidates) {
    const formatted = formatSkillForAgent(candidate.skill);
    const remaining = maxAutoAppliedSkillContextChars - used - 120;
    if (remaining <= 0) break;
    const content = formatted.length > remaining ? `${formatted.slice(0, remaining)}\n\n[Auto-applied Skill truncated to keep the agent fast.]` : formatted;
    sections.push(`\n---\n${content}`);
    used += content.length + 5;
  }
  return sections.join("\n");
}

export async function readSakiSkill(skillId: string, includeDisabled = false): Promise<SakiSkillDocument> {
  const id = requireSkillId(skillId);
  const documents = await readAllSakiSkillDocuments(includeDisabled);
  const skill = documents.find((document) => document.id === id);
  if (!skill) throw new RouteError("Skill not found.", 404);
  return skill;
}

export async function readSakiSkillsByIds(skillIds: readonly string[]): Promise<SakiSkillSummary[]> {
  const documents = await readAllSakiSkillDocuments(true);
  const wanted = new Set(skillIds.map((id) => id.toLowerCase()));
  return documents.filter((document) => wanted.has(document.id) && document.enabled !== false).map(toSkillSummary);
}

export function normalizeSkillInput(input: CreateSakiSkillRequest | UpdateSakiSkillRequest, current?: SakiSkillDocument): SakiSkillDetail {
  const name = trimString(input.name ?? current?.name);
  if (!name) throw new RouteError("Skill name is required.", 400);
  const content = input.content !== undefined ? trimString(input.content) : current?.content ?? "";
  if (!content) throw new RouteError("Skill content is required.", 400);
  if (content.length > maxSakiSkillContentChars) {
    throw new RouteError(`Skill content is too large; limit is ${maxSakiSkillContentChars} characters.`, 400);
  }
  const description = input.description !== undefined ? trimString(input.description) : current?.description ?? "";
  return {
    id: current?.id ?? sanitizeSkillId(name),
    name,
    description,
    content,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : current?.enabled !== false,
    sourceType: current?.sourceType === "builtin" ? "builtin" : current?.sourceType ?? "local",
    sourceUrl: current?.sourceUrl ?? null,
    tags: input.tags !== undefined ? normalizeSkillTags(input.tags) : current?.tags ?? []
  };
}

export async function saveSakiSkill(skill: SakiSkillDetail): Promise<SakiSkillDocument> {
  const id = requireSkillId(skill.id);
  const filePath = sakiSkillPath(id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeSkillMarkdown({ ...skill, id }), "utf8");
  return readSakiSkill(id, true);
}

function githubRawSkillUrl(inputUrl: string): string {
  const url = normalizeHttpUrl(inputUrl);
  const host = url.hostname.toLowerCase();
  if (host === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const [owner, repo, kind, branch, ...rest] = parts;
    if (owner && repo && (kind === "blob" || kind === "tree") && branch) {
      const targetPath = rest.length ? rest.join("/") : sakiSkillFileName;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${targetPath}`;
    }
  }
  if (!url.pathname.toLowerCase().endsWith(".md") && !url.pathname.toLowerCase().endsWith("skill.md")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${sakiSkillFileName}`;
  }
  return url.toString();
}

export async function downloadSakiSkill(input: DownloadSakiSkillRequest): Promise<SakiSkillDocument> {
  const sourceUrl = githubRawSkillUrl(input.url);
  const url = await assertPublicHttpUrl(sourceUrl);
  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        "accept": "text/markdown, text/plain, application/octet-stream;q=0.8, */*;q=0.2",
        "user-agent": webUserAgent
      }
    },
    15000
  );
  if (!response.ok) {
    throw new RouteError(`Skill download failed with ${response.status}: ${response.statusText}`, 502);
  }
  const raw = (await response.text()).trim();
  if (!raw || raw.length > maxSakiSkillContentChars) {
    throw new RouteError("Downloaded Skill is empty or too large.", 400);
  }
  const parsed = parseSkillMarkdown(raw);
  const nameFromPath = decodeURIComponent(path.basename(url.pathname).replace(/\.md$/i, "")) || "Downloaded Skill";
  const id = requireSkillId(input.id ? sanitizeSkillId(input.id) : sanitizeSkillId(trimString(parsed.metadata.id) || trimString(parsed.metadata.name) || nameFromPath));
  const detail: SakiSkillDetail = {
    id,
    name: trimString(parsed.metadata.name) || nameFromPath,
    description: trimString(parsed.metadata.description),
    enabled: input.enabled !== false,
    sourceType: "openclaw",
    sourceUrl: sourceUrl,
    tags: normalizeSkillTags(parsed.metadata.tags),
    content: parsed.content || raw
  };
  return saveSakiSkill(detail);
}

export function formatSkillForAgent(skill: SakiSkillDocument): string {
  return [
    `Skill: ${skill.id} | ${skill.name}`,
    skill.description ? `Description: ${skill.description}` : "",
    skill.tags?.length ? `Tags: ${skill.tags.join(", ")}` : "",
    skill.sourceUrl ? `Source: ${skill.sourceUrl}` : "",
    "",
    skill.content.length > maxAgentSkillContentChars
      ? `${skill.content.slice(0, maxAgentSkillContentChars)}\n\n[Skill truncated; ask the user to narrow the task or open the source URL for more detail.]`
      : skill.content
  ]
    .filter(Boolean)
    .join("\n");
}
