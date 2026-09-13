# Reddit r/selfhosted 发布文案

**Title:**

Saki Panel: an open-source server panel where the AI agent actually diagnoses crashes, not just restarts them (runs fully offline with Ollama)

**Body:**

Hey r/selfhosted,

I've run game servers and random side-project boxes for a few years now, and every panel I've tried (1Panel, Pterodactyl, MCSManager) has the same blind spot: when something dies at 3 AM, they restart it on a loop and you still get to dig through logs over morning coffee.

So I built my own. It's called Saki Panel.

The panel part covers the usual ground: instances, files, terminal over WebSocket, databases (SQLite/MySQL/Postgres/Redis), cron tasks, RBAC with a full audit log. Nothing revolutionary there.

The part I actually built it for is Saki, an agent that lives inside the workspace. It reads live logs, file trees and metrics directly, and it can act: restart services, edit files, run commands. Risky stuff waits for your confirm first, and genuinely dangerous commands are blocked in the daemon outright.

The feature I'm happiest with is Saki Watch. When a watched instance crashes:

1. The daemon fingerprints the error and files an incident. No model call, no noise.
2. You confirm the diagnosis when you wake up.
3. The agent reads logs and files in a scoped run (no shell, no deletes).
4. Proposed patches sit as diffs until you approve them.
5. Service restarts. If the same crash comes back, files roll back to the pre-patch checkpoint on their own.

It runs 100% offline with Ollama or LM Studio, no API key needed. OpenAI/Anthropic/DeepSeek/Qwen/Gemini and a few others work too if you want them.

Stack is TypeScript end to end: React 19 + Vite on the front, Fastify 5 + Prisma/SQLite on the back, one small daemon per machine. Apache 2.0. Prebuilt images on GHCR, so `docker compose pull && up -d` gets you running without building anything.

GitHub: https://github.com/EthanChan050430/Saki-Panel

Honest caveat: it's early. I've tested it on my own Windows box and one Ubuntu VPS, and that's about it. If a few of you want to kick the tires and tell me what breaks, that would genuinely help more than a star would.

Happy to answer anything.
