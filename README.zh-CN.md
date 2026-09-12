<div align="center">

<img src="apps/web/public/assets/saki-panel-icon.webp" width="88" height="88" alt="Saki Panel" />

# Saki Panel

**一个真正懂你服务器的 AI 运维面板。**  
不是右下角的玩具聊天窗，它能直接看日志、查状态、改配置、跑命令。  
危险操作必须你点头才跑；服务崩了自动抓报错、提补丁，再崩还会自动滚回上个快照。

<video src="https://github.com/EthanChan050430/Saki-Panel/releases/download/intro/saki-panel-intro.mp4" width="800" controls muted playsinline></video>

![Saki Panel 宣传片](https://github.com/EthanChan050430/Saki-Panel/releases/download/intro/saki-panel-intro.mp4)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![check](https://github.com/EthanChan050430/Saki-Panel/actions/workflows/check.yml/badge.svg)](https://github.com/EthanChan050430/Saki-Panel/actions/workflows/check.yml)
[![Release](https://img.shields.io/github/v/release/EthanChan050430/Saki-Panel)](https://github.com/EthanChan050430/Saki-Panel/releases/latest)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000.svg)](https://fastify.dev/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.13-339933.svg)](https://nodejs.org/)
[![Plugins](https://img.shields.io/badge/plugins-saki--plugins-FF75AC.svg)](https://github.com/EthanChan050430/saki-plugins)

<p>
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

[为什么做 Saki?](#为什么做-saki-panel和其他面板有什么区别) · [界面长啥样](#界面长啥样) · [AI 助手 Saki](#ai-助手-saki) · [Saki Watch 崩溃自愈](#saki-watch-故障自愈机制) · [作为面板它能干啥](#作为面板它能干啥) · [插件工坊](#插件工坊) · [快速上手](#快速上手) · [系统架构](#系统架构) · [部署到生产环境](#部署到生产环境)

</div>

---

用过传统面板的朋友都懂：面板只能帮你点点按钮，排查问题还是得自己开终端敲 `journalctl`、翻几百行 log，再手工复制到网页版 ChatGPT 里问“帮我看下这是什么报错”。

**Saki Panel 的核心区别是：AI 不是外挂的聊天框，而是直接坐在你的服务器工作区里。**  
它能实时看进程日志、翻配置文件、看内存占用，然后直接帮你把活干了。

比如你可以随时跟它说：

- “*node-02 上的服务重启一下，顺便盯着最后 50 行日志看有没有报红。*”
- “*`/var` 磁盘快满了，把占空间的大文件找出来列给我，删任何东西前必须我确认。*”
- “*把我的 Minecraft 核心升到新版，动手前先把 world 存档整包备份一份。*”

**本地模型完全免费跑**：直接连你本机跑的 [Ollama](https://ollama.com/) 或 [LM Studio](https://lmstudio.ai/)，不需要充值任何 API Key，私密配置和日志一个字节都不出局域网。当然，想用 DeepSeek、OpenAI、Claude、通义千问、Gemini 等云端模型，去设置里点选填个 Key 就能用。

---

## 为什么做 Saki Panel？（核心同类面板横向对比）

MCSManager、1Panel、Pterodactyl（翼龙）、宝塔各有各的好，但它们都有一个共同点：**纯手工、被动**。半夜服务挂了，只能无脑重启，翻日志的活儿还是得你自己来。

| 别人怎么做 | **Saki Panel** |
|:---|:---|
| 没有 AI，日志全靠自己看 | **原生驻守工作区：直接读实时日志、文件和指标，再用受限工具动手修复** |
| 无脑循环重启，人工排查 | **Saki Watch：提取错误指纹、起草补丁、等你确认、再崩自动回滚** |
| AI 只能上云，配置出内网 | **本地直连 Ollama & LM Studio，零成本断网可用，隐私不出内网** |

商用多租户开服，Pterodactyl 依然是工业标准；传统 Linux 建站，1Panel 也很稳。想要一台自带 24 小时 AI SRE 的下一代面板，**选 Saki Panel 就对了**。

---

## 界面长啥样

**集群看板** — 所有节点一览无余，CPU / 内存 / 磁盘使用曲线、节点健康状态、最新操作审计都在这：

![Dashboard](.github/assets/screenshot-dashboard.png)

**Saki 现场排障** — 智能体直接在当前工作区里干活：背景是滚动的实时流式日志，前台是 Saki 对话框，直接帮服主分析为什么玩家进游戏会一直暴毙：

![Saki reading instance logs](.github/assets/screenshot-saki-logs.png)

**Saki Watch 事故响应** — 监控中的实例以退出码 1 异常挂掉，Daemon 瞬间捕获崩溃指纹，顶部通知条亮起，等你一键排查：

![Saki Watch incident](.github/assets/screenshot-watch-incident.png)

---

## AI 助手 Saki

| 能力 | 它能帮你做什么 |
|:---|:---|
| **自带上下文** | 实例状态、标准输出/报错流缓冲、文件目录、CPU/内存负载直接喂给模型，不用你当“复制粘贴工具人”。 |
| **能动手动脚** | 在限定的工作区里启动/停止/重启实例、读写修改配置文件、执行排查命令。 |
| **懂分寸，不乱来** | 4 级操作风险控制。普通查状态直接回，高危写操作必须弹窗等你点【确认】；格式化、危险死命令在 Daemon 底层直接硬编码干掉。 |
| **技能与外部生态 (MCP)** | 常用运维巡检动作可以存成 Skills 重复用；还可以通过 MCP 协议挂接外部工具。 |
| **带眼睛的多模态** | 终端报了诡异花屏或网页报红？直接在聊天框里截图、贴日志文件丢给它看。 |
| **防死循环机制** | 内置输出检测、防卡死、防无限重复调工具。兼容 XML、Qwen、Hermes 以及原生 JSON tool calls。 |

### 白嫖本地大模型，断网也能跑

只需要本地起一个 Ollama，在配置里填上：

```env
SAKI_PROVIDER=ollama
SAKI_MODEL=llama3.2
SAKI_OLLAMA_URL=http://localhost:11434
```

如果手里有 API Key，系统设置里也支持一键切换：DeepSeek、OpenAI、Claude (Anthropic)、通义千问 (Qwen)、Gemini、MiniMax、智谱清言、月之暗面 (Kimi)、豆包，甚至连 GitHub Copilot 都能接。

---

## Saki Watch 故障自愈机制

最让人头疼的是服务半夜挂掉。Saki Watch 不是简单的“死循环重启”，而是一整套有人兜底的自愈链路：

1. **案发现场取证**：实例意外退出了，Daemon 记录退出码并提取错误指纹（**此时不消耗任何 token**）。
2. **等你敲定**：你在顶部横幅或通知铃铛里点一下【开始诊断】，AI 才进场。
3. **戴着镣铐排查**：排查模式下的 Agent 受到严格权限沙盒限制，只能看日志和查文件，**禁止偷跑 Shell 命令、禁止删文件、禁止擅改启动项**。
4. **人工过目补丁**：定位到哪行配置写错了，Saki 会给出类似 Git Diff 的直观对比图，**必须你亲眼看完点同意**，文件才会真正改写。
5. **不行自动撤回**：打完补丁重启，要是同样的报错再次崩掉，系统立马把文件还原到修改前的快照镜像，绝对不把小故障改瘫成大事故。

---

## 作为面板，它能干啥？

除了 AI，它本身也是一个五脏俱全、用起来很顺手的服务器面板：

- **大盘监控**：整个集群有几台机器、吃了多少 CPU/内存/磁盘、谁什么时候做过什么操作，清清楚楚。
- **9 种实例统一管**：不管是用 pm2 跑的 Node、Python 脚本、Java jar 包、Shell 脚本，还是单个 Docker 容器、一整套 Docker Compose，甚至专用的 **Minecraft / Steam 游戏服务器**，通通在一个列表里启停、改配置。
- **网页终端 (xterm.js)**：随时随地掏出手机或浏览器敲命令。断网自动重连，连 Minecraft 的彩色控制台代码都能原汁原味还原。
- **在线文件管理**：左边树状目录，右边基于 CodeMirror 6 的代码编辑器。大文件上传下载、后台静默解压常见压缩包（zip、tar、rar、7z）。
- **内置数据库管家**：SQLite、MySQL / MariaDB、PostgreSQL、Redis 直接在面板里查看数据表、查改数据，省掉单独装 Navicat 或 phpMyAdmin 的麻烦。
- **分布式多节点**：一台做主控（Panel），其他机器只要跑一个轻量的 Node 守护进程（Daemon），用密钥一对一加密通信，不用繁琐的 VPN 组网。
- **定时任务 (Cron)**：定时跑脚本、定时做冷备份、定时清理日志，每一次跑的输出日志全部存留可查。
- **权限与模板**：RBAC 多角色分权，会话防暴力破解；常用启动命令和环境变量存为模板，下次建新实例一键套用。

---

## 插件工坊

不满足于默认界面？Saki Panel 内置了**插件工坊**——主题、形象、游戏、组件、语言包一键安装，不用重新构建、不用重启服务。精选插件都放在 [saki-plugins](https://github.com/EthanChan050430/saki-plugins) 仓库里。

<p align="center">
  <a href="https://github.com/EthanChan050430/saki-plugins">
    <img alt="saki-plugins repository" src="https://img.shields.io/badge/plugin%20repository-saki--plugins-FF75AC?style=for-the-badge&logo=github" />
  </a>
</p>

| 插件 | 类型 | 它给你带来什么 |
|:---|:---:|:---|
| **简约几何** · `saki-theme-geo` | ![theme](https://img.shields.io/badge/type-theme-FF75AC) | 把整站从液态玻璃换成构成主义几何：炭黑侧栏、米白纸面、钴蓝强调、切角硬边。 |
| **女仆装** · `saki-skin-maid` | ![skin](https://img.shields.io/badge/type-skin-8B5CF6) | 把 Saki 全套表情立绘和 6 帧循环动画换成法式女仆装。 |
| **切水果** · `saki-game-fruit-slice` | ![game](https://img.shields.io/badge/type-game-10B981) | 街机切水果：滑动切开飞来的水果，躲开炸弹，连击越高分越高。 |
| **日本語** · `saki-locale-ja` | ![locale](https://img.shields.io/badge/type-locale-3B82F6) | 面板界面整体日语本地化。 |

支持主题、形象、游戏、组件、语言包五种插件类型。想自己写一个？[插件开发指南](https://github.com/EthanChan050430/saki-plugins#readme) 手把手带你从一个空文件夹写起。

---

## 快速上手

### 环境准备
- Node.js ≥ 22.13
- npm ≥ 9

### 4 步本地跑起来

```bash
# 1. 克隆代码到本地
git clone https://github.com/EthanChan050430/Saki-Panel.git
cd Saki-Panel

# 2. 装依赖
npm install

# 3. 初始化并同步 SQLite 数据库
npx prisma db push --skip-generate

# 4. 一键起飞 (Panel 后端 + Web 前端 + Daemon 节点一次全开)
npm run dev
```

如果你是在不同平台上折腾，`scripts/` 目录下准备了帮你自动干掉端口冲突的脚本：

| 系统平台 | 执行命令 |
|:---|:---|
| Windows | `scripts/windows/start-dev.ps1` |
| Linux | `bash scripts/linux/start-dev.sh` |
| macOS | `scripts/macos/start-dev.command` |

启动完成后打开浏览器：

| 服务 | 访问地址 |
|:---|:---|
| Web 前端界面 | http://localhost:5478 |
| Panel 后端 API | http://localhost:5479 |
| Daemon 节点 | http://localhost:5480 |

默认管理员账号：`admin` / 默认密码：`admin123456`

> [!WARNING]
> 一旦准备对外暴露端口或挂到公网，**务必第一时间**在环境变量里改掉 `JWT_SECRET`、`ADMIN_PASSWORD` 和 `DAEMON_REGISTRATION_TOKEN`！

---

## 系统架构

```
┌──────────────┐   HTTP / WS + JWT    ┌──────────────┐   HTTP / WS + Token   ┌──────────────┐
│     Web      │ ◄──────────────────► │    Panel     │ ◄───────────────────► │    Daemon    │
│  React 19    │                      │  Fastify 5   │                       │  Fastify 5   │
│  Vite 6      │                      │  Saki 智能体  │                       │  节点守护进程 │
│  :5478       │                      │  :5479       │                       │  :5480       │
└──────────────┘                      └──────────────┘                       └──────┬───────┘
                                                                                    │ 孵化进程
                                                                                    ▼
                                                                             ┌──────────────┐
                                                                             │  各种服务实例  │
                                                                             └──────────────┘
```

代码目录一览：
```text
apps/web        前端 Web 控制台 (React 19 + Tailwind)
apps/panel      主控后端 API 与 Saki 智能体引擎 (Fastify 5 + Prisma)
apps/daemon     挂在各台机器上的轻量守护进程
packages/shared 前后端共享的 TS 类型与协议
prisma/         SQLite 数据库 schema
```

---

## 部署到生产环境

### Docker Compose 容器化一键拉起

```bash
export JWT_SECRET="换成你自己的强随机密钥"
export ADMIN_PASSWORD="换成你的强密码"
export DAEMON_REGISTRATION_TOKEN="换成节点注册Token"

docker compose build
docker compose up -d
```

如果是前端与后端分开部署、或绑定到公网 IP：

```bash
export PANEL_PUBLIC_URL="http://你的服务器IP:5479"
export WEB_ORIGIN="http://你的服务器IP:5478"
export PANEL_CORS_ORIGINS="*"
export VITE_API_BASE_URL="http://你的服务器IP:5479"

docker compose build --no-cache panel web
docker compose up -d
```

### Linux systemd 守护进程托管

```bash
sudo cp scripts/linux/saki-panel.service /etc/systemd/system/
sudo cp scripts/linux/saki-panel-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now saki-panel
sudo systemctl enable --now saki-panel-daemon
```

---

## 常用开发命令

```bash
npm run dev          # 同时跑 panel + daemon + web
npm run dev:panel    # 只跑后端 panel
npm run dev:daemon   # 只跑节点 daemon
npm run dev:web      # 只跑前端 web
npm run build        # 全项目打包编译
npm run check        # 全局 TypeScript 类型检查
npm run db:push      # 数据库结构改动后推送到 SQLite
```

---

## 开源协议

基于 Apache License 2.0 协议开源，详见 [LICENSE](LICENSE)。

```
Copyright 2024-2026 DreamStarryRobot Contributors
```
