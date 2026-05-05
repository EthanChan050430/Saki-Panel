<div align="center">

<img src="apps/web/public/assets/saki-panel-icon.png" width="120" height="120" alt="Saki Panel Logo" />

# 🌸 Saki Panel

**The First AI-Powered Server Management Panel · Manage Servers with Natural Language**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000.svg)](https://fastify.dev/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933.svg)](https://nodejs.org/)

> "Hey, restart that Node service for me."<br>
> "The disk is almost full again, check which logs can be deleted."<br>
> "Update the MC server to the latest version, and don't you dare break it."

**—— Just tell it what you want, Saki gets it done.**

[🤖 Saki Agent](#-saki-agent--not-a-chatbot-real-automation) · [🚀 Quick Start](#-quick-start-up-and-running-in-3-minutes) · [🏗️ Architecture](#️-architecture) · [✨ Features](#-features-ridiculously-powerful) · [🐳 Deploy](#-deployment) · [⚖️ License](#️-license)

</div>

---

## Yet Another Ops Panel? Why?

Look, there are plenty of panels out there: **BaoTa**, **1Panel**, **Pterodactyl**, **MCSManager**. Sure, they work. They do the job. They're solid.

But here's the problem:

> **You tell it what to do → it does it → you babysit the whole thing → boom, done. You're basically the operator and it's just a glorified button-pusher. That's the game. That's always been the game. Cringe, bro.**

Saki Panel? Completely different beast.

This isn't just another "bolt a chatbox onto a traditional panel and call it AI" (gross). Instead, **AI is woven into the actual DNA of the architecture**—it's not an afterthought, it's the foundation:

- **True Context Awareness**: It automatically grabs instance state, real-time logs, file trees, CPU/memory/disk metrics. You don't have to manually copy-paste walls of text anymore—Saki sees it all.
- **Real Execution**: Actually starts/stops/restarts services, reads/writes files, runs commands. It's not just chatting at you—it *does the work*.
- **Approval Safeguards**: When it comes to dangerous stuff (think `rm -rf` territory), it asks for your sign-off before proceeding. High-risk ops get human approval, critical stuff is straight-up blocked. No surprise data loss.
- **Skill System**: Bundle your common ops workflows into reusable Skills, share them with your team, deploy with one click. Collective ops knowledge, packaged and shared.
- **MCP Protocol Support**: Hook up external tools whenever you need them. Theoretically unlimited capability expansion—the door's wide open.

**This isn't just software. This is your ops teammate working 24/7.**

No more waking up to "server is down" alerts at 3 AM. The era of intelligent automation is already here. 🗿

---

## 🤖 Saki Agent — Not a Chatbot. Real Automation.

Here's the difference:

```text
Traditional Panel AI:  You ask → it talks at you → you manually execute → it watches → ???  → 🤡
Saki Agent:           You speak → it thinks → it executes → asks for sign-off on risky stuff → done → 😎
```

| Core Capability | Description |
|:---------|:-----|
| 🧠 **Context Awareness** | Sees the full picture: instance state, real-time logs, file structure, CPU/memory/disk metrics. No manual data gathering. It just *knows*. |
| 🎬 **Real Execution** | Starts/stops/restarts instances, reads/writes files, runs terminal commands. It doesn't just talk—it actually *does*. |
| 🛡️ **Risk Approval** | 4-tier risk levels (low / medium / high / critical). High-risk ops need your thumbs-up. Critical stuff? Auto-blocked. You're protected. |
| 🎯 **Skill System** | Bundle your ops patterns into reusable Skills, share across teams, deploy instantly. Collective knowledge, distributed. |
| 📎 **Multimodal Input** | Paste error screenshots, dump log files, ramble about what's wrong. Saki parses it all. |
| 🔌 **MCP Support** | Model Context Protocol = plug in external tools as needed. Limitless expansion, your rules. |
| 🎭 **Live2D Interaction** | Mix drinks, dance, greet—productivity meets personality. Ops work doesn't have to be boring. |


### Ultra-Simple Configuration (Totally Free Locally)

```env
SAKI_PROVIDER=ollama
SAKI_MODEL=llama3.2
SAKI_OLLAMA_URL=http://localhost:11434
```

That's literally it. Spin up [Ollama](https://ollama.com/) on your machine—**completely free**. Also works with OpenAI, DeepSeek, Alibaba Qwen, Gemini, or any compatible LLM interface. **Zero lock-in**, pick whatever model you want. Weak hardware? No sweat, just throw an API key at it.

---

## ✨ Features (Ridiculously Powerful)

<table>
<tr>
<td width="50%">

### 🤖 Saki Agent
Context-aware · Real execution · Approval gates · Skills · MCP extensions · Multimodal · Live2D

</td>
<td width="50%">

### 📊 Dashboard
Node status · Real-time CPU/memory/disk graphs · Recent actions & logins

</td>
</tr>
<tr>
<td width="50%">

### ⚙️ Instance Management
9 instance types · Start/stop/restart/kill · Real-time logs · Auto-restart on crash · **Agent-controlled**

</td>
<td width="50%">

### 💻 Web Terminal
xterm.js + WebSocket · Auto-reconnect · **Agent can execute commands**

</td>
</tr>
<tr>
<td width="50%">

### 📁 File Manager
Browse directories · CodeMirror editor · Upload/download · Smart decompression (zip/rar/7z) · **Agent can read/write**

</td>
<td width="50%">

### ⏰ Scheduled Tasks
Cron scheduling · Manual triggers · Run history · Auto-start + crash recovery policies

</td>
</tr>
<tr>
<td width="50%">

### 🖥️ Node Management
Auto daemon registration · Heartbeat keep-alive · Connectivity testing · System metrics collection

</td>
<td width="50%">

### 🔒 Security & Access Control
RBAC (41 permission codes) · Audit logs · Login rate limits · Dangerous command blocks

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌──────────────┐       HTTP/WS        ┌──────────────┐       HTTP/WS        ┌──────────────┐
│              │  ◄─────────────────►  │              │  ◄─────────────────►  │              │
│   🌐 Web     │       JWT            │   📋 Panel   │     Node Token       │   🔧 Daemon  │
│   React SPA  │                      │   Fastify    │                      │   Fastify    │
│   + Saki UI  │                      │   + Saki AI  │                      │              │
│   :5478      │                      │   + SQLite   │                      │   :24444     │
│              │                      │   :5479      │                      │              │
└──────────────┘                      └──────────────┘                      └──────┬───────┘
                                                                                   │ spawn
                                                                                   ▼
                                                                            ┌──────────────┐
                                                                            │   📦 Instance Processes │
                                                                            └──────────────┘
```

| Component | Responsibility | Tech Stack |
|:-----|:-----|:-------|
| **Web** | Frontend admin panel + Saki interaction UI | React 19 · Vite 6 · CodeMirror 6 · xterm.js 6 · Recharts |
| **Panel** | Central control hub + Saki Agent engine | Fastify 5 · Prisma 6 · SQLite · JWT · LLM APIs |
| **Daemon** | Node proxy, executes real operations | Fastify 5 · systeminformation · 7zip-bin |
| **Shared** | Shared types for frontend and backend | Pure TypeScript, zero dependencies |

> 💡 **In one sentence:** Panel is the brain (Saki lives here), Daemon is the hands, Web is the face, Shared is the common language.

---

## 🗂️ Project Structure

Clean monorepo setup. Everything you need, nothing you don't:

```
Saki Panel/
├── apps/
│   ├── web/                  # Frontend SPA (React 19 + Vite 6)
│   ├── panel/                # Backend control panel + Saki Agent engine
│   └── daemon/               # Node daemon process
├── packages/
│   └── shared/               # Shared type definitions
├── prisma/
│   └── schema.prisma         # Database models (9 tables)
├── scripts/
│   ├── windows/              # Windows one-click startup (PowerShell)
│   ├── linux/                # Linux startup + systemd services
│   └── macos/                # macOS one-click startup (double-click to run)
├── docker-compose.yml
└── .env.example
```

---

## 🚀 Quick Start (3 Minutes)

### Prerequisites

- Node.js >= 18
- npm >= 9
- (Strongly Recommended) [Ollama](https://ollama.com/) for local Saki Agent execution

### Local Development

```bash
# 1. Clone repository + install dependencies
git clone https://github.com/EthanChan050430/Saki-Panel.git && cd Saki-Panel
npm install

# 2. Initialize database
npx prisma db push --skip-generate

# 3. Start development mode (one command)
npm run dev
```

### One-Click Startup Scripts (Auto Port Management)

| Platform | Command | Details |
|:-----|:-----|:-----|
| 🪟 Windows | Double-click `scripts/windows/start-dev.ps1` | PowerShell automatically manages port conflicts |
| 🐧 Linux | `bash scripts/linux/start-dev.sh` | Same intelligent port management |
| 🍎 macOS | Double-click `scripts/macos/start-dev.command` | Double-click to run |

### Default Access

| Service | URL |
|:-----|:-----|
| Web Interface | http://localhost:5478 |
| Panel API | http://localhost:5479 |
| Daemon | http://localhost:24444 |

### Default Administrator

| Field | Value |
|:-----|:---|
| Username | `admin` |
| Password | `admin123456` |

> ⚠️ **Production Requirements:** Always change `JWT_SECRET`, `ADMIN_PASSWORD`, and `DAEMON_REGISTRATION_TOKEN`. Security comes first.

---

## 🎯 Supported Instance Types

| Type | Description |
|:-----|:-----|
| `generic_command` | Generic command-line |
| `nodejs` | Node.js applications |
| `python` | Python scripts |
| `java_jar` | Java JAR packages |
| `shell_script` | Shell scripts |
| `docker_container` | Docker containers |
| `docker_compose` | Docker Compose orchestration |
| `minecraft` | Minecraft servers |
| `steam_game_server` | Steam game servers |

---

## 🔐 Security

| Mechanism | Details |
|:-----|:-----|
| Authentication | JWT Token + bcrypt password hashing |
| Authorization | RBAC with 41 permission codes, 5 built-in roles + custom role targets |
| Rate Limiting | Account lockout after 5 failed login attempts in 10 minutes |
| Command Interception | 4-tier risk levels (low → critical), critical operations blocked automatically |
| Agent Approval | High-risk operations require manual approval, with reject and rollback support |
| Audit | Comprehensive operation logs (user/IP/action/result) |
| Path Isolation | File operations restricted to workspace, preventing path traversal |
| Extraction Protection | Max 5,000 items, max extraction size 512MB |

---

## 🖥️ Tech Stack

| Layer | Technology |
|:---|:-----|
| Language | TypeScript (full-stack, no JavaScript anywhere) |
| Monorepo | npm workspaces |
| Frontend | React 19 · Vite 6 · CodeMirror 6 · xterm.js 6 · Recharts · Lucide |
| Backend | Fastify 5 · Prisma 6 · SQLite |
| AI Agent | LLM APIs (Ollama / OpenAI-compatible) · MCP · Skill System · Approval Flow |
| Terminal | xterm.js + WebSocket proxy |
| Deployment | Docker Compose · systemd |

---

## 📋 Development Commands

```bash
npm run dev          # Start all services (panel + daemon + web)
npm run dev:panel    # Start Panel only
npm run dev:daemon   # Start Daemon only
npm run dev:web      # Start Web only
npm run build        # Build all
npm run check        # Type check all
npm run db:push      # Sync database schema
```

---

## 🐳 Deployment

### Docker Compose (Recommended for Production)

```bash
# Build and start
docker compose build
docker compose up -d
```

For production, set environment variables:

```bash
export JWT_SECRET="your-secret-here"
export ADMIN_PASSWORD="your-password-here"
export DAEMON_REGISTRATION_TOKEN="your-token-here"

docker compose up -d
```

If frontend and API are accessed via different public IPs/ports/domains, configure the browser-visible addresses and rebuild the Web image:

```bash
export PANEL_PUBLIC_URL="http://XX.XX.XX.XX:5479"
export WEB_ORIGIN="http://XX.XX.XX.XX:5478"
export PANEL_CORS_ORIGINS="*"
export VITE_API_BASE_URL="http://XX.XX.XX.XX:5479"

docker compose build --no-cache panel web
docker compose up -d
```

If the browser console still shows requests to `http://localhost:5479`, remove or update `VITE_API_BASE_URL` in `.env` to your public API address, then rebuild:

```bash
docker compose build --no-cache web && docker compose up -d
```

For temporary troubleshooting, set `DISABLE_AUTH=1` to disable panel authentication. This should only be used for short-term debugging on public networks; revert to `DISABLE_AUTH=0` when done.

### systemd (Linux)

```bash
sudo cp scripts/linux/saki-panel.service /etc/systemd/system/
sudo cp scripts/linux/saki-panel-daemon.service /etc/systemd/system/
sudo systemctl enable --now saki-panel
sudo systemctl enable --now saki-panel-daemon
```

---

## 🔍 Why Saki Panel is the Move?

**AI Server Management Panel** · **AI Agent Operations** · **Intelligent DevOps** · **Ollama-Powered Ops** · **LLM Server Management**<br>
**MCP for Automation** · **Natural Language DevOps** · **Smart Server Control** · **No More Manual Ops** · **Autonomous Workflows**

---

Say goodbye to manual ops with traditional panels. The **Smart Ops**​ era is here! Zero API cost with local Ollama deployment. Dangerous command blocking prevents data disasters. Skill system + MCP for limitless expansion. Multimodal input understands your screenshots and files.

Whether you're searching for a **BT Panel alternative, 1Panel alternative, Pterodactyl alternative, MCSManager alternative**, or searching for an **AI Ops Panel, AI Agent Server Management, Ollama Panel**, Saki Panel is your best choice.

The thing is built different, bro. What more could you ask for from a traditional panel? Hop on the Saki Panel train and start ops-ing with your AI Agent! 🚀

---

## ⚖️ License

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

Damn, this thing cost me 12 straight hours of intense vibe coding. A star would heal my soul, bros! 🙏

</div>
