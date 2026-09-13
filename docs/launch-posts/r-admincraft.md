# Reddit r/admincraft 发布文案

**Title:**

I got tired of reading crash logs at 3 AM, so I built a panel where an agent fingerprints the crash, drafts a patch, and rolls itself back if the fix doesn't hold

**Body:**

Hey r/admincraft,

Quick show of hands: who's had a server die overnight, auto-restart into the same crash five times, and then spent breakfast reading stack traces to find which plugin did it?

Yeah. That's the loop I built Saki Panel to break.

It's an open-source server panel (Apache 2.0) with first-class Minecraft support: dedicated instance type for MC jars, console parsing, color codes in the web terminal, the works. It also does java_jar, docker, steamcmd game servers and plain scripts if you run more than just MC.

The thing that makes it different from MCSManager/Pterodactyl is the built-in agent, Saki. It isn't a chatbot bolted onto the side. It reads your live console output, the file tree, and resource metrics directly, and when a watched server crashes:

1. The crash gets fingerprinted and filed as an incident. No LLM call, no 3 AM token burn.
2. When you're actually awake, you hit confirm.
3. The agent reads the logs and configs in a locked-down session (no shell access, no deletes, can't touch your start command).
4. It proposes a patch as a diff. Nothing gets written until you say yes.
5. Server restarts. If the same crash signature shows up again, it rolls the files back to the pre-patch checkpoint automatically.

You can also just talk to it in plain English: "update the server, but back up the world first" or "a player keeps dying at spawn, figure out why" and it goes and reads the actual logs instead of guessing.

Runs fully offline with a local model through Ollama or LM Studio if you don't want configs leaving your network. Cloud providers are optional.

GitHub: https://github.com/EthanChan050430/Saki-Panel

Fair warning: it's early days, I'm one dev, and it's been battle-tested on exactly my own servers. If you run a Paper/Spigot/modded setup and feel like breaking it, I'd really like to hear what happens, good or bad.
