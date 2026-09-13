# V2EX 发布文案（建议节点：分享创造）

**标题:**

[开源] 做了个带 AI 运维的服务器面板：凌晨崩服自动抓现场、打补丁前先问你、修坏了自动回滚

**正文:**

各位 V 友好，来分享一个自己做了挺久的开源项目：Saki Panel。

起因很简单。我自己跑着几个游戏服务器和杂七杂八的小项目，市面上主流面板（1Panel、Pterodactyl、MCSManager）都用了一圈。它们管服务器都没问题，但有一个共同的盲区：凌晨三点服务挂了，它们只会无脑重启，日志还是得你自己早上爬起来翻。挂一次翻一次，翻了几年，烦了，就自己动手做了一个。

面板本身的功能就不细说了，该有的都有：实例管理（9 种类型，含 Minecraft、Docker、Steam 游戏服）、文件管理、Web 终端、数据库（SQLite/MySQL/PostgreSQL/Redis）、定时任务、RBAC 权限和完整审计日志。

真正花心思的是内置的 Agent，叫 Saki。它不是侧边栏聊天机器人，而是直接在面板工作区里干活的：能实时读日志、文件树、CPU/内存指标，也能动手执行重启、改文件、跑命令。高风险操作会先停下来等你确认，真正危险的命令在守护进程里直接禁掉。

核心功能叫 Saki Watch，专门对付半夜崩服：

1. 被监控的实例异常退出时，守护进程按错误指纹记录成事件。这一步不调模型，不产生费用。
2. 你睡醒了，点一下确认，诊断才开始。
3. Agent 在受限会话里读日志和文件：没有 shell、不能删东西、不能改启动命令。
4. 给出的修复方案以 diff 形式摆着，你点头才写入。
5. 服务重启。如果同一个崩溃再次发生，文件自动回滚到打补丁前的检查点。

不想用云端 API 的话，接 Ollama 或 LM Studio 跑本地模型就能完全离线用，零 API key。OpenAI、Anthropic、DeepSeek、Qwen、Gemini 这些也支持，设置里切一下就行。

技术栈：全 TypeScript，React 19 + Vite 前端，Fastify 5 + Prisma/SQLite 后端，每台机器跑一个轻量 daemon。Apache 2.0 协议。有 GHCR 预构建镜像，docker compose 拉起来就能用，不用自己编译。

GitHub: https://github.com/EthanChan050430/Saki-Panel

说实话，项目还早期，目前主要就在我自己的 Windows 机器和一台 Ubuntu VPS 上跑过。欢迎各位试用、挑刺、提 issue。觉得有用的话点个 star，先谢过了。
