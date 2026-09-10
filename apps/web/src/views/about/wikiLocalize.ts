import type { PanelLanguage } from "../../i18n/translations.js";
import { toTraditionalChinese, translateDomText } from "../../i18n/index.js";
import {
  WIKI_CATEGORIES,
  WIKI_CHAPTERS,
  type WikiChapter
} from "./wikiData.js";
import { WIKI_CATEGORIES_EN, WIKI_CHAPTERS_EN } from "./wikiData.en.js";

const KEEP_KEYS = new Set(["id", "category", "iconName", "mockupKey", "type"]);

function mapWikiValue<T>(value: T, fn: (text: string) => string, key?: string): T {
  if (key && KEEP_KEYS.has(key)) return value;
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => mapWikiValue(item, fn)) as T;
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      next[childKey] = mapWikiValue(childValue, fn, childKey);
    }
    return next as T;
  }
  return value;
}

const WIKI_UI_EN: Record<string, string> = {
  "界面图例 · 静态展示": "UI legend · static preview",
  "图例": "Legend",
  "实例快捷操作面板 (instance-actions-panel-card)": "Instance quick actions",
  "集成启动、重启、停机、强杀、在线文件、参数配置、计划任务及网络代理等核心管理入口": "Start, restart, stop, kill, files, settings, scheduled tasks, and proxy.",
  "实例核心概要卡片 (instance-summary-card)": "Instance summary card",
  "清晰呈现当前实例的实时状态、运行节点、工作目录、进程策略与端口映射": "Status, node, working directory, restart policy, and creator.",
  "进程实时性能探针卡片 (instance-probe-card)": "Process probe card",
  "实时采样实例 CPU / 物理内存占用比，绘制动态波动折线并记录稳定运行时长": "CPU, memory, uptime, and a rolling load trend.",
  "Web 终端控制台 (instance-terminal-box)": "Web terminal",
  "基于 xterm.js 与 PTY，支持多终端 Tab、Minecraft 专属颜色代码、快捷软键盘与命令发送栏": "Logs, command bar, extra shells, and Ask Saki.",
  "在线文件管理器 (File Manager & Monaco/CodeMirror)": "Online file manager",
  "树状目录层级浏览、大文件秒传分片、后台无损解压缩与配置文件即改即用": "Browse, upload, edit configs, compress and extract.",
  "Saki AI 故障现场自愈与 Git Diff 补丁审核": "Saki crash recovery and patch review",
  "Saki Watch 自动提取异常退出指纹，AI 原生沙盒诊断生成配置文件比对，必须经由人工审核授权后方可执行应用": "You confirm diagnosis, then approve or reject the patch.",
  "分布式节点监控卡片 (Distributed Nodes & Daemon)": "Node cluster cards",
  "主控 (Panel) 与远程轻量守护 (Daemon) 密钥加密握手，毫秒级心跳与跨机资源调度": "Online status, ping, CPU, memory, and hosted instances.",
  "内置数据库管家 (SQLite, MySQL, PostgreSQL, Redis)": "Built-in database console",
  "无需单独安装第三方数据库管理工具，直接在面板内检视数据表、结构与执行 SQL 查询": "Browse tables, run SQL, and watch the connection.",
  "多角色权限分配与用户积分配额": "Roles and point quota",
  "细粒度实例授权协作，并配备用户算力/内存上限积分兑换体系": "Role, points, and instance assignment.",
  "Saki AI 智能体工作区 (Saki Floating Chat & Agent Workspace)": "Saki chat workspace",
  "支持上下文自动注入、@智能实例与文件引用、40+ 运维工具自主执行、多模态截图诊断与躺平模式": "Chat or agent mode, attachments, and Ctrl+Enter to send.",
  "Saki 陪伴房间 · 好感度与投喂": "Saki companion room · affection and feeding",
  "左上角装修房间，右上角爱心看等级；底部麦克风、小游戏、投喂、挂断。点心可点选或拖到她身上。": "Decorate, check affection, feed treats, or start the mini-game.",
  "星梦甜点接接乐": "Star Dream Dessert Drop",
  "30 秒内左右移动篮子接甜点、躲虫子。连击 5 次进入 FEVER 2X。结束后领取好感经验。": "Move the basket for 30 seconds. Combo 5 enters FEVER 2X.",
  "顶栏陪伴区": "Top bar companion area",
  "左边积分徽章可点开明细；右边躺平的 Saki 单击唤醒，长按可拖走，拖回空位即可收纳。": "Points badge on the left; click or long-press lying Saki on the right.",
  "概览指标卡": "Overview metric cards",
  "点开任意一张可看详情。在线节点显示在线数/总数，CPU / 内存 / 磁盘显示当前占用。": "Click a card for details. Nodes show online/total.",
  "设置 · 功能开关": "Settings · Features",
  "联网搜索、MCP 扩展、以及长按 Saki 时用的学说话变声引擎。": "Web search, MCP, and the voice-echo engine.",
  "Saki 值班收件箱": "Saki Watch inbox",
  "顶栏铃铛点开后就是这里。先确认诊断才会消耗额度；改文件仍需你点批准。": "Confirm diagnosis first. File changes still need Approve.",
  "登录页": "Login page",
  "右上角切换语言和深浅色。可记住用户名。还没有账号就点立即注册。": "Switch language and theme. Remember username, or register.",
  "可靠性报告": "Reliability report",
  "可选最近 7 / 14 / 30 天。没有事件时会显示「窗口期内没有值班事件」。": "Pick 7 / 14 / 30 days. Empty window shows no watch events.",
  "实例计划任务": "Instance scheduled tasks",
  "入口在实例快捷面板，不在左侧菜单。可定时重启、启动、停止或向控制台发命令。": "Open from instance quick actions, not the sidebar.",
  "服务器时间与世界时钟校准": "Server time and world clocks",
  "点顶栏时钟打开。选一座城市后，顶栏就会按这个时区走。": "Click the top-bar clock, then pick a city.",
  "积分与使用量统计": "Points and usage",
  "点顶栏积分徽章打开。可看余额、近 14 天 Token 和扣分趋势。": "Click the points badge for balance and 14-day usage.",
  "新建实例与数据库": "Create instance or database",
  "两个页签：标准命令/进程实例，或数据库可视化实例。": "Two tabs: process instance, or database visualizer.",
  "接入节点三种方式": "Three ways to join a node",
  "密钥直连、部署向导、手动配置。装完把 Node Key 贴回来即可上线。": "Key, install wizard, or manual host/port.",
  "数据库工作区页签": "Database workspace tabs",
  "按引擎显示：数据浏览或键值浏览、表结构、SQL 控制台或 Redis CLI、导入与导出。": "Data/Keys, Schema, SQL or Redis CLI, Import/Export.",
  "Agent 任务铃铛": "Agent task bell",
  "顶栏机器人图标。可全部停止、删除已完成；单条可停止、撤销、删除。": "Stop all, clear finished, or stop/rollback one task."
};

export function wikiUi(language: PanelLanguage, text: string): string {
  if (!text) return text;
  if (language === "zh-CN") return text;
  if (language === "zh-TW") return toTraditionalChinese(text);
  return WIKI_UI_EN[text] ?? translateDomText(text, "en-US");
}

export function getWikiCategories(language: PanelLanguage) {
  if (language === "en-US") return WIKI_CATEGORIES_EN;
  if (language === "zh-TW") return mapWikiValue(WIKI_CATEGORIES, toTraditionalChinese);
  return WIKI_CATEGORIES;
}

export function getWikiChapters(language: PanelLanguage): WikiChapter[] {
  if (language === "en-US") return WIKI_CHAPTERS_EN;
  if (language === "zh-TW") return mapWikiValue(WIKI_CHAPTERS, toTraditionalChinese);
  return WIKI_CHAPTERS;
}
