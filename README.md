<div align="center">

<img src="apps/web/public/assets/saki-panel-icon.png" width="100" height="100" alt="Saki Panel Logo" />

# Saki Panel

**An AI-native server management panel that understands your infrastructure and automates operations through natural language.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000.svg)](https://fastify.dev/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933.svg)](https://nodejs.org/)

> "Restart the Node service on node-02 and tail the last 50 lines of logs."<br>
> "The disk is filling up on /var. Check what's taking space and ask before deleting anything."<br>
> "Update the Minecraft server to the latest build, but back up the world first."

[Saki Agent](#saki-agent) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Features](#features) · [Deployment](#deployment) · [中文说明](#中文说明)

</div>

---

## Why Saki Panel?

Most server management panels (like Baota, 1Panel, Pterodactyl, or MCSManager) are essentially web wrappers around system commands. They give you buttons to start processes and forms to edit configs, but when something breaks at midnight, you are still on your own: opening SSH, digging through log files, copying stack traces, and manually applying fixes.

Adding a generic chat window to an existing panel doesn't solve this. If the AI cannot inspect process states, parse live logs, read configuration files, or safely execute commands, it's just another tab you have to copy-paste into.

**Saki Panel takes a different approach:**

- **Context-first operations**: Saki sees the live state of your instances, recent stdout/stderr output, file trees, and system resource metrics. You talk about what is happening; Saki already has the context.
- **Action with safety gates**: Saki does not just give advice—it can edit files, restart processes, and run terminal commands. Crucially, every potentially disruptive action requires your explicit confirmation, and destructive commands are blocked at the daemon layer.
- **Saki Watch (Automated crash triage)**: When an instance crashes unexpectedly, Saki Watch captures the incident, groups it by error fingerprint, diagnoses the root cause, and can propose a minimal patch. Once you approve, it verifies the service state and rolls back automatically if the crash persists.
- **Skill system & MCP support**: Package recurring operational workflows into reusable Skills, or hook into external tools via the Model Context Protocol (MCP).
- **Run anywhere, pay nothing**: Works out of the box with local models via Ollama or LM Studio with zero API costs. Also supports OpenAI, Anthropic, DeepSeek, Qwen, Gemini, MiniMax, and GitHub Copilot.

---

## Saki Agent

Saki is built directly into the control panel's core rather than bolted on as a third-party plugin.

| Capability | Description |
|:---|:---|
| Context Awareness | Reads instance status, real-time log buffers, file trees, and CPU/memory/disk metrics without manual copy-pasting. |
| Real Execution | Starts, stops, and restarts instances, reads and edits files, and executes terminal commands within strict workspace boundaries. |
| Approval Flow | Four-tier risk system (low, medium, high, critical). High-risk operations require explicit human approval; critical commands are blocked automatically. |
| Crash Watch & Recovery | Instances that exit with non-zero status trigger an incident. Saki diagnoses the logs, proposes targeted fixes, and automatically rolls back if the service fails post-patch. |
| Tool Harness | Dynamic tool advertising keeps model context lean. File stats are metadata-only, code diagnostics run without side-effects, and environment probes are cached. |
| Multimodal Input | Accepts error screenshots, log files, and text attachments directly in chat. |
| Loop Protection | Built-in detection for repeated outputs, stuck tool calls, and runaway turns. Supports XML, Qwen, Hermes, and native JSON tool call formats. |
| Interactive UI | Integrated Live2D character, mini-games, and voice synthesis support for a friendly management experience. |

### Quick Configuration (Local & Free)

To run Saki completely offline at zero cost, point it to a local [Ollama](https://ollama.com/) instance:

```env
SAKI_PROVIDER=ollama
SAKI_MODEL=llama3.2
SAKI_OLLAMA_URL=http://localhost:11434
```

You can also switch to any cloud provider (DeepSeek, OpenAI, Anthropic, Qwen, Gemini) or use your GitHub Copilot subscription directly from the settings page.

### Saki Watch Workflow

When a monitored instance exits unexpectedly:

1. **Incident Created**: The daemon detects the exit code and logs an incident grouped by error fingerprint. No LLM tokens are spent automatically.
2. **User Confirmation**: Click "Confirm Diagnosis" in the incident banner or notification bell to initiate analysis.
3. **Restricted Agent Run**: A scoped agent analyzes the failure without shell access, delete permissions, or permission to modify startup commands.
4. **Patch Review**: If a fix is proposed, file diffs are shown for your review before writing.
5. **Verification & Rollback**: After applying an approved fix, Watch restarts the service and verifies its health. If it crashes in the same manner, all file changes are reverted to the pre-patch checkpoint.

---

## Features

- **Dashboard**: Real-time cluster overview, aggregated CPU/memory/disk usage, active node status, and audit summaries.
- **Instance Management**: Supports 9 instance types (Node.js, Python, Java JAR, Shell, Docker, Docker Compose, Minecraft, Steam game servers, and generic commands) with automatic restart policies.
- **Web Terminal**: Built-in xterm.js terminal with WebSocket streaming, automatic reconnection, and Minecraft formatting color code rendering.
- **File Manager**: Directory navigation, CodeMirror 6 code editor with syntax highlighting, file uploads/downloads, and background archive extraction (zip, tar, rar, 7z).
- **Database Visualizer**: Connect to MySQL/MariaDB instances, inspect database schemas, browse and edit table rows, and execute SQL queries without third-party desktop clients.
- **Node Clustering**: Multi-server architecture. Install a lightweight daemon on each server; the central panel manages all instances over secure token authentication.
- **Scheduled Tasks**: Cron-based scheduling for command execution, instance restarts, and maintenance jobs with full run history.
- **Security & Access Control**: Role-Based Access Control (RBAC) with 41 granular permission codes, session timeout controls, login brute-force rate limiting, and comprehensive audit logs.

---

## Architecture

```
┌────────────────┐        HTTP / WS         ┌────────────────┐        HTTP / WS         ┌────────────────┐
│                │  ◄─────────────────────► │                │  ◄─────────────────────► │                │
│    Web (SPA)   │           JWT            │  Panel Server  │       Node Token         │     Daemon     │
│   React 19     │                          │   Fastify 5    │                          │   Fastify 5    │
│   Vite 6       │                          │   Saki Agent   │                          │   Node Agent   │
│   Port: 5478   │                          │   Port: 5479   │                          │   Port: 5480   │
└────────────────┘                          └────────────────┘                          └───────┬────────┘
                                                                                                │ spawn
                                                                                                ▼
                                                                                        ┌────────────────┐
                                                                                        │   Instances    │
                                                                                        └────────────────┘
```

| Component | Role | Tech Stack |
|:---|:---|:---|
| **Web** | Frontend management interface and Saki chat UI | React 19, Vite 6, CodeMirror 6, xterm.js 6, Recharts |
| **Panel** | Central control server, authentication, database, and Saki Agent core | Fastify 5, Prisma 6, SQLite, JWT |
| **Daemon** | Node agent installed on target servers, executes process and file operations | Fastify 5, systeminformation, 7zip-bin |
| **Shared** | Shared TypeScript interfaces, types, and schema contracts | Pure TypeScript |

---

## Project Structure

A clean, modular npm workspace:

```text
Saki Panel/
├── apps/
│   ├── web/                  # React 19 frontend SPA
│   │   ├── src/
│   │   │   ├── components/   # Modular components (saki, terminal, file-manager, common)
│   │   │   ├── views/        # Main views (instances, dashboard, nodes, users, etc.)
│   │   │   ├── database/     # Database visualizer components & modals
│   │   │   ├── utils/        # Path, auth, route, and appearance helpers
│   │   │   └── i18n/         # Multi-language dictionary and DOM translator
│   ├── panel/                # Backend API service & Saki AI engine
│   │   └── src/routes/saki/  # Saki provider dispatchers (openai, anthropic, ollama, copilot)
│   └── daemon/               # Lightweight node agent process
├── packages/
│   └── shared/               # Shared types between panel, daemon, and web
├── prisma/
│   └── schema.prisma         # Database schema
├── scripts/                  # Development and systemd service scripts
├── docker-compose.yml
└── .env.example
```

---

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9

### Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/EthanChan050430/Saki-Panel.git
cd Saki-Panel

# 2. Install dependencies
npm install

# 3. Initialize the database
npx prisma db push --skip-generate

# 4. Start development mode (launches web, panel, and daemon concurrently)
npm run dev
```

### Platform Launch Scripts

Platform-specific startup scripts are provided in `scripts/` with automatic port conflict handling:

| Platform | Script |
|:---|:---|
| Windows | Run `scripts/windows/start-dev.ps1` in PowerShell |
| Linux | Run `bash scripts/linux/start-dev.sh` |
| macOS | Double-click `scripts/macos/start-dev.command` |

### Default Access Points

| Service | Address |
|:---|:---|
| Web Interface | http://localhost:5478 |
| Panel API | http://localhost:5479 |
| Daemon API | http://localhost:5480 |

### Default Administrator Credentials

| Field | Value |
|:---|:---|
| Username | `admin` |
| Password | `admin123456` |

*Note: For any production or public network deployment, immediately update `JWT_SECRET`, `ADMIN_PASSWORD`, and `DAEMON_REGISTRATION_TOKEN` in your environment configuration.*

---

## Supported Instance Types

- `generic_command`: Arbitrary command-line programs
- `nodejs`: Node.js applications with package scripts
- `python`: Python scripts and virtual environments
- `java_jar`: Java applications and Minecraft server jars
- `shell_script`: Bash and Shell scripts
- `docker_container`: Standalone Docker containers
- `docker_compose`: Docker Compose multi-service stacks
- `minecraft`: Minecraft dedicated servers with console parsing
- `steam_game_server`: Dedicated Steam game server processes

---

## Deployment

### Docker Compose (Recommended for Production)

```bash
# Build and run with default settings
docker compose build
docker compose up -d
```

Configure production environment variables in your `.env` file or export them before running:

```bash
export JWT_SECRET="your-secure-random-secret"
export ADMIN_PASSWORD="your-strong-admin-password"
export DAEMON_REGISTRATION_TOKEN="your-daemon-token"

docker compose up -d
```

If your web frontend and API are hosted on different public domains or IP addresses:

```bash
export PANEL_PUBLIC_URL="http://your-server-ip:5479"
export WEB_ORIGIN="http://your-server-ip:5478"
export PANEL_CORS_ORIGINS="*"
export VITE_API_BASE_URL="http://your-server-ip:5479"

docker compose build --no-cache panel web
docker compose up -d
```

### Linux systemd Service

```bash
sudo cp scripts/linux/saki-panel.service /etc/systemd/system/
sudo cp scripts/linux/saki-panel-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now saki-panel
sudo systemctl enable --now saki-panel-daemon
```

---

## 中文说明

Saki Panel 是一个原生深度融合 AI Agent 的现代化轻量服务器与实例运维面板。

不同于传统面板仅仅提供网页按钮或在网页边角堆砌聊天框，Saki Panel 让 AI 真正接入了系统上下文（实时日志、指标流、文件系统与进程生命周期），具备安全审批护栏（四级风险拦截与确认）与自动故障诊断回滚机制（Saki Watch）。

### 核心亮点

- **懂上下文的 Saki Agent**：无需手动复制粘贴错误日志，Saki 可直接感知当前实例运行状态、系统负载与错误堆栈。
- **带安全护栏的执行能力**：可读写配置文件、重启实例、执行运维脚本，高危操作强制需要人工二次确认，从守护进程底层拦截毁灭性命令。
- **Saki Watch 故障自愈**：进程异常退出时自动记录事故指纹，在用户确认后进行精准诊断，支持补丁预览应用与异常自动回滚，不额外浪费模型额度。
- **零成本本地大模型支持**：原生适配 Ollama / LM Studio 本地离线模型，同时也支持各大主流云端模型与 GitHub Copilot。
- **轻量集群与全栈工具箱**：内置多节点管理、Web 终端（支持 ANSI 与 MC 格式码）、CodeMirror 6 代码编辑、文件压缩解压、可视化数据库管理（MySQL/MariaDB）以及多角色权限管理（RBAC）。

---

## Development Commands

```bash
npm run dev          # Start all workspaces concurrently
npm run dev:panel    # Start backend panel only
npm run dev:daemon   # Start daemon agent only
npm run dev:web      # Start frontend web app only
npm run build        # Build all packages and applications
npm run check        # Run type checking across all workspaces
npm run db:push      # Push Prisma schema updates to SQLite
```

---

## License

```
Copyright 2024-2026 DreamStarryRobot Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

<div align="center">

Built with care for engineers who want automated, reliable infrastructure without the hassle. If you find Saki Panel helpful, stars and contributions are always welcome.

</div>
