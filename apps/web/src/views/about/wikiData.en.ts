import type { WikiChapter } from "./wikiData.js";

export const WIKI_CATEGORIES_EN: Array<{ key: WikiChapter["category"] | "all"; label: string }> = [
  { key: "all", label: "All topics" },
  { key: "saki", label: "Saki AI assistant" },
  { key: "instances", label: "Instances and terminal" },
  { key: "files", label: "Files and databases" },
  { key: "cluster", label: "Nodes and templates" },
  { key: "security", label: "Users, roles, and points" },
  { key: "system", label: "Automation and settings" }
];

export const WIKI_CHAPTERS_EN: WikiChapter[] = [
  {
    id: "wiki-start",
    title: "1. Login, main layout, and your account",
    shortTitle: "Login and layout",
    category: "system",
    categoryLabel: "Automation and settings",
    iconName: "LogIn",
    badge: "Start here",
    summary: "Learn login, the left menu, and the top bar first. Everything else opens from this screen.",
    keywords: [
      "login",
      "register",
      "sidebar",
      "top bar",
      "account",
      "avatar",
      "password",
      "dark",
      "light",
      "language",
      "points",
      "world clock",
      "Agent tasks",
      "lie down"
    ],
    subsections: [
      {
        id: "wiki-start-login",
        title: "1.1 Sign in and register",
        description: "The first screen is login. Top-right switches language (简体中文 / 繁體中文 / English) and light/dark theme.",
        bullets: [
          "Sign in: enter username and password, optionally check Remember username, then Log in. The eye icon shows or hides the password.",
          "No account yet: the line is “Don't have an account?” plus Register now. Registration needs username, display name, password (at least 8 characters), and confirm password. Confirm password can also be shown/hidden, and Remember username is available. Then tap Register and enter.",
          "Already have an account: “Already have an account?” plus Sign in now.",
          "The default role of a new account is set by an admin in Settings → System as registration identity: none, user, admin, or super admin.",
          "Saki hangs above the login card. The tooltip is “Poke Saki ~”. A tap makes her bounce and say a random greeting."
        ],
        callout: {
          type: "note",
          title: "Too many wrong passwords",
          text: "Repeated failures temporarily lock login. Wait a bit, or ask an admin to unlock or reset the password."
        },
        mockupKey: "login"
      },
      {
        id: "wiki-start-sidebar",
        title: "1.2 Left menu (shown by permission)",
        description: "After login, the left side is the main menu. Items you cannot use are hidden. If nothing is available you see Waiting for permissions.",
        table: {
          headers: ["Menu", "What it does"],
          rows: [
            ["Overview", "Cluster resources, recent instances, and node status"],
            ["Instances", "Create and start/stop services; open terminal, files, and databases"],
            ["Nodes", "Join more machines (admins)"],
            ["Templates", "One-click servers, or save your instance as a template"],
            ["Users", "Accounts, roles, instance assignment, and points"],
            ["Audit", "Who did what, and when (admins)"],
            ["Reliability", "Crashes and recoveries over a time window"],
            ["Settings", "Language, AI model, appearance, watch notifications"],
            ["About", "This manual, plus update check"]
          ]
        },
        bullets: [
          "The top of the sidebar can collapse the menu and switch dark / light.",
          "The bottom shows your avatar and name. Click it to open your account."
        ]
      },
      {
        id: "wiki-start-topbar",
        title: "1.3 Top bar: clock, bells, points, and lying Saki",
        description: "From left to right: where you are, tools, then Saki's companion slot.",
        bullets: [
          "Server time: synced clock. Tooltip: Server time (timezone), click to calibrate world time. The dialog title is Server time and world clock calibration.",
          "Refresh reloads the current page.",
          "Agent task bell: lights up while Saki works in the background. See 1.7.",
          "Watch bell: lights up on crash or alert. Opens the Saki Watch inbox.",
          "Points badge: a number plus Points, or ∞ plus Unlimited. Opens Points and usage statistics.",
          "Lying Saki: she starts on the top bar. Click to wake; hold about half a second to drag; drop her back into the empty slot to tuck her away. While dragging you see Drag here to hide Saki."
        ],
        mockupKey: "topbar-companion"
      },
      {
        id: "wiki-start-clock",
        title: "1.4 Server time and world clocks",
        description: "Click the top-bar clock. You can see latency in ms, the current zone, and drift versus the server.",
        bullets: [
          "Sync now realigns with the server. Restore server timezone clears a city you picked.",
          "World city clocks include Beijing / Shanghai, Tokyo, Singapore / Hong Kong, Dubai, London, Paris / Berlin, Moscow, New York, Los Angeles / San Francisco, Sydney, and UTC. Each card shows local time and how many hours faster/slower than the server. Calibrate to this timezone makes the top bar follow it.",
          "You can also Search any timezone.",
          "Bottom link Open appearance settings can turn off Show top-bar server time."
        ],
        mockupKey: "server-time"
      },
      {
        id: "wiki-start-points-modal",
        title: "1.5 Points and usage statistics",
        description: "Click the top-bar points badge, or Points & Usage in Saki's header.",
        bullets: [
          "Three cards: available points (or Unlimited points), tokens used in the past 14 days, points spent in the past 14 days.",
          "The middle chart is Usage trend (past 14 days) (Tokens).",
          "Recent usage lists time, description, tokens, point change, and balance after.",
          "Refresh is at the top right."
        ],
        mockupKey: "points-usage"
      },
      {
        id: "wiki-start-account",
        title: "1.6 Your account",
        description: "Click the avatar at the bottom of the sidebar.",
        bullets: [
          "Upload or remove an avatar (png / jpeg / webp / gif).",
          "Change display name. Badges such as SUPER or ACTIVE may appear.",
          "Change password: current password, new password, confirm (at least 8 characters, both must match).",
          "Saving with no edits shows Synced. Log out leaves this account."
        ]
      },
      {
        id: "wiki-start-agent",
        title: "1.7 Agent task bell",
        description: "Click the robot icon. Title Agent tasks. Pill shows N running or None running.",
        bullets: [
          "Statuses: running, completed, failed, cancelled, waiting for approval. May show an instance name or Global session.",
          "Stop all and Delete finished tasks.",
          "Each row can Stop, Rollback (revert all code), or Delete. Rollback asks whether to restore related files.",
          "Click a row to open Saki on that task. Empty list: No Agent tasks."
        ],
        mockupKey: "agent-monitor"
      }
    ]
  },
  {
    id: "wiki-saki-ai",
    title: "2. Chat with Saki and let her work",
    shortTitle: "Saki chat",
    category: "saki",
    categoryLabel: "Saki AI assistant",
    iconName: "Bot",
    badge: "Core",
    summary: "Saki stays on the workspace. Ask questions, or switch to agent mode so she can read logs and edit configs. You can require confirmation before files change.",
    keywords: ["Saki", "chat", "agent", "history", "voice", "screenshot", "attachment", "model", "approve", "rollback"],
    subsections: [
      {
        id: "wiki-saki-open",
        title: "2.1 Open and put away",
        description: "Saki is not a sidebar item. She stays on screen.",
        bullets: [
          "Click lying Saki on the top bar, or the floating character, to open chat.",
          "Default is collapsed: companion room on the left, input at the bottom, messages as a mini preview. Expand chat above the input to see the full thread.",
          "Maximize in the header goes fullscreen. Click again to Exit fullscreen.",
          "Close input closes the panel; Saki becomes a draggable character. Drag her back to the top bar to lie down again.",
          "Near the left or right edge she docks and shrinks.",
          "Ask Saki on the terminal, Watch bell, or Audit page also opens her."
        ],
        callout: {
          type: "tip",
          title: "No permission",
          text: "You need Chat or Agent permission. Without it the floating character is hidden, and you see The current account has no available Saki permissions."
        }
      },
      {
        id: "wiki-saki-modes",
        title: "2.2 Chat mode and Agent mode",
        description: "Switch with the two icons on the composer, not a large top pill.",
        bullets: [
          "Chat mode (bubble icon): explanations and how-to. She answers only; she will not edit files or run commands.",
          "Agent mode (wrench icon): she can act. Example: check why players cannot join, then propose a fix. She reads logs and files first.",
          "Agent permission (agent mode only), open Agent permission mode:",
          "Accept edits: safe file edits run automatically.",
          "Ask: every file edit asks you first.",
          "Plan only: a plan, no writes.",
          "Bypass: keep going within your account limits, fewer interrupts."
        ],
        table: {
          headers: ["You want to…", "Pick"],
          rows: [
            ["Ask what something means", "Chat mode"],
            ["Edit configs, read logs, run commands", "Agent + Ask"],
            ["See a plan first", "Agent + Plan only"],
            ["Fewer confirms once you trust it", "Agent + Accept edits"]
          ]
        },
        mockupKey: "saki-window"
      },
      {
        id: "wiki-saki-composer",
        title: "2.3 Composer: ask, attach, speak, send",
        description: "The bottom box is where you talk. Placeholder changes, e.g. Ask Saki or Ask Saki about the current instance.",
        bullets: [
          "Send with Ctrl + Enter. The button tooltip is also Ctrl+Enter to send.",
          "While she answers, the send button becomes Stop generation. If you typed more, you can Insert (after the current step) or Add to queue (after this turn).",
          "The + menu: paste image, upload file, page screenshot. Up to 6 attachments.",
          "@ only lists uploaded reference images, not instances or folders.",
          "Voice input: click the mic; speech becomes text.",
          "Annotate selection: select text on the page or terminal, release the mouse, and she analyzes it. Esc cancels.",
          "Ctrl+V pastes a screenshot. Drag a file-manager file onto Saki; the hint is Release to give to Saki.",
          "The model name is near the input. Expensive models show a multiplier such as 2.0x; free ones show Free. An eye icon means vision."
        ]
      },
      {
        id: "wiki-saki-history",
        title: "2.4 History, copy, rewind, retry",
        description: "Header buttons usually: Go to companion, History, Points & Usage, Maximize, New chat, Close.",
        bullets: [
          "History opens a drawer: New chat, pick an old thread, or delete one. Empty: No history yet.",
          "Your messages: Copy, or Rewind (return to this line and undo later edits).",
          "Saki's replies: Copy, Retry (rollback this change and regenerate), Delete.",
          "If she edited several files: N / M file changes can be rolled back and Rollback all.",
          "A reply may show tokens used, and points used if you are not unlimited.",
          "Thinking can expand/collapse as Deep thinking... or Thinking process."
        ]
      },
      {
        id: "wiki-saki-approve",
        title: "2.5 When she wants to edit a file",
        description: "In agent mode, changes show as a card first.",
        bullets: [
          "Pending: Approve or Reject.",
          "Expand Diff and Preview to see the lines.",
          "If it goes wrong after approve: Rollback this action.",
          "On Watch banners the button is often Approve and restart."
        ],
        callout: {
          type: "warning",
          title: "Read it before you approve",
          text: "Approve means yes, change files on the server. If unsure, Reject, or use Plan only."
        }
      }
    ]
  },
  {
    id: "wiki-saki-companion",
    title: "3. Companion room, affection, feeding, mini-game",
    shortTitle: "Affection",
    category: "saki",
    categoryLabel: "Saki AI assistant",
    iconName: "Heart",
    badge: "Companion",
    summary: "The left side of Saki is her room. Poke her, feed treats, decorate, or play the dessert game to raise affection.",
    keywords: [
      "affection",
      "feed",
      "daifuku",
      "boba",
      "bento",
      "dessert",
      "mini-game",
      "poke",
      "voice echo",
      "decorate",
      "companion"
    ],
    subsections: [
      {
        id: "wiki-saki-room",
        title: "3.1 What's in the room",
        description: "Left of chat (on phones, the Companion tab) is Saki's room.",
        bullets: [
          "Paintbrush: Decorate room (custom background). After a custom image, Restore default room appears.",
          "Heart: affection level. Hover for title, EXP, and a bar. On gain the heart pops and +N EXP floats up.",
          "Tap Saki to poke; hold to let her mimic your voice. Tooltip: Tap to poke, hold to speak.",
          "Bottom: mic, gamepad, utensils (feed), hang up. Phones also get Switch to chat.",
          "Phones have Companion / Chat island pills. When she finishes speaking, Chat shows a breathing light."
        ],
        mockupKey: "saki-companion"
      },
      {
        id: "wiki-saki-favorability",
        title: "3.2 Affection levels",
        description: "Affection follows your account. On level-up she says she reached a new level. At max: Max affection level reached!",
        table: {
          headers: ["Level", "Title", "EXP range"],
          rows: [
            ["Lv.1", "Acquaintance", "0 – 100"],
            ["Lv.2", "Rapport", "100 – 250"],
            ["Lv.3", "Intimate", "250 – 500"],
            ["Lv.4", "Best Friends", "500 – 900"],
            ["Lv.5", "Kindred Spirits", "900 – 1400"],
            ["Lv.6", "Incomparable", "1400 – 2000"],
            ["Lv.7", "Galaxy Vow", "2000 – 3000"],
            ["Lv.8", "Eternal Bond", "3000 – 5000 (max)"]
          ]
        },
        bullets: [
          "Hover the heart for Affection Lv.x · title, current EXP, and EXP to next level.",
          "About 50 seconds idle and she gets sleepy."
        ]
      },
      {
        id: "wiki-saki-feed",
        title: "3.3 Feeding: spend points for affection",
        description: "Utensils button: Feed Saki (spend points on treats). Drag onto her or tap.",
        table: {
          headers: ["Treat", "Cost", "Affection", "She says"],
          rows: [
            ["Strawberry Daifuku", "1 pt", "+10", "Nom nom～ The soft strawberry daifuku is so delicious!"],
            ["Boba Pearl Milk Tea", "2 pts", "+25", "A sip of sweet pearl milk tea fills me with energy!"],
            ["Kitty Heart Bento", "5 pts", "+60", "Is this cute kitty bento made specially for me?!"]
          ]
        },
        callout: {
          type: "note",
          title: "Not enough points",
          text: "Treats grey out. She asks you to chat more to earn points. Unlimited accounts are not blocked."
        }
      },
      {
        id: "wiki-saki-poke-voice",
        title: "3.4 Poke and voice echo",
        description: "First visit: Tap to poke me, hold to speak and I'll copy you ♪",
        bullets: [
          "Short tap: a random greeting.",
          "About 6 taps within 1.4 seconds: a tsundere easter egg.",
          "Hold over ~0.3s: voice echo. Bubbles say she will copy you after you release.",
          "No mic: Saki cannot copy your voice without a microphone.",
          "Echo engine is in Settings → Features: lightweight DSP (recommended) or on-device WebGPU AI."
        ]
      },
      {
        id: "wiki-saki-game",
        title: "3.5 Mini-game: Star Dream Dessert Drop",
        description: "Gamepad: Star Dream Dessert Drop (mini-game for affection). Move the basket, catch sweets, avoid bugs.",
        bullets: [
          "30 seconds. Header: countdown and score. Mute or Exit game.",
          "Combo 2+ shows COMBO; combo 5 enters FEVER 2X (dessert scores double).",
          "Catch ratings: NICE! / GREAT! / PERFECT! / FEVER!; bugs are MISS! and break combo.",
          "End screen: Challenge complete! with score, affection EXP, max combo. Claim reward and finish.",
          "Affection reward = score × 0.35, minimum 15.",
          "Ranks: ≥1000 SSS, ≥600 S, ≥300 A, otherwise B."
        ],
        table: {
          headers: ["Item", "Score"],
          rows: [
            ["Wish star", "+30"],
            ["Strawberry daifuku", "+25"],
            ["Pearl milk tea", "+25"],
            ["Donut", "+20"],
            ["Macaron", "+15"],
            ["Naughty bug", "−15 (breaks combo)"]
          ]
        },
        mockupKey: "saki-game"
      }
    ]
  },
  {
    id: "wiki-saki-watch",
    title: "4. Saki Watch: she calls you on crashes",
    shortTitle: "Saki Watch",
    category: "saki",
    categoryLabel: "Saki AI assistant",
    iconName: "Bell",
    badge: "Self-heal",
    summary: "On crash or alert the bell lights up. She diagnoses only after you confirm. File changes need Approve. Bad patches roll back.",
    keywords: ["watch", "incident", "crash", "diagnose", "approve", "rollback", "ignore", "silence", "Webhook", "DingTalk", "Telegram"],
    subsections: [
      {
        id: "wiki-saki-inbox",
        title: "4.1 Saki Watch inbox",
        description: "Click the top-bar bell. Title Saki Watch. Pill: N unresolved or All clear.",
        bullets: [
          "Categories: All, Process crash, Crash loop, Disk alert, Memory alert, External alert, Health check.",
          "Pending on top, recently finished below.",
          "Chips may show recurrence, flapping, auto-fix, escalated.",
          "Statuses: awaiting confirm, diagnosing, diagnosed, waiting for approval, applying, verifying, recovered ✓, rolled back, failed, ignored, rate limited.",
          "Empty: System is running normally ✨ and No unfinished crash or alert events."
        ],
        table: {
          headers: ["Button", "What it does"],
          rows: [
            ["Confirm diagnosis / Diagnose again", "Asks Confirm spend quota and start diagnosis?"],
            ["Approve / Approve and restart", "Accept the patch; the latter also restarts"],
            ["Rollback fix", "Restore the previous config"],
            ["Ignore 1 hour", "Quiet this item for an hour"],
            ["Silence forever", "Asks Confirm permanent silence?"],
            ["Ignore all", "Ignore all pending in this category for 1 hour"],
            ["Silence rules", "View or delete silences"]
          ]
        },
        mockupKey: "incident-inbox"
      },
      {
        id: "wiki-saki-heal",
        title: "4.2 From crash to fix",
        description: "She will not edit blindly.",
        bullets: [
          "On a bad exit the bell lights. Confirm before quota is spent.",
          "After Confirm diagnosis she only reads logs/files, then shows a patch.",
          "You review Diff, then Approve or Approve and restart.",
          "If it crashes again quickly, the previous config is restored.",
          "Per instance in Instance settings: diagnose and patch / diagnose only / turn watch off."
        ],
        mockupKey: "saki-patch"
      },
      {
        id: "wiki-saki-watch-settings",
        title: "4.3 Push to DingTalk, WeCom, Telegram",
        description: "Settings → Watch notifications.",
        bullets: [
          "Channel types: Generic webhook, DingTalk, WeCom, Telegram.",
          "Events: new, waiting for approval, recovered, failed/rollback, escalation.",
          "Enable/disable, Test, Delete. Recent deliveries listed below.",
          "Alert ingest tokens: pick a target instance, optional label, Create token. Copy token or URL for Prometheus or JSON ingest."
        ]
      }
    ]
  },
  {
    id: "wiki-instances",
    title: "5. Instances: start, stop, settings, create",
    shortTitle: "Instances",
    category: "instances",
    categoryLabel: "Instances and terminal",
    iconName: "Play",
    badge: "Core ops",
    summary: "An instance is a running service. Create, start/stop, edit the start command, set Watch and proxy here.",
    keywords: ["instance", "start", "restart", "stop", "kill", "autostart", "proxy", "Clash", "cards", "list", "graph", "sync"],
    subsections: [
      {
        id: "wiki-instances-list",
        title: "5.1 List: cards, list, graph",
        description: "Sidebar Instances. Heading Instances and databases.",
        bullets: [
          "Three views: Cards, List, Graph. Process instances and database visualizers share this page.",
          "Process cards: start command, node, working directory, updated time, exit code, autostart, restart policy, Watch on. Console opens the detail; you can also start / stop / restart / delete. Delete asks Delete instance name?",
          "Database cards: engine, path or host, owner. Open visualizer, Edit database config, Delete.",
          "List columns include name, command/address, node, directory, Type (actually the owner; hover shows creator and owner), updated, actions.",
          "Graph: nodes in the center, instances linked; sidebar counts nodes and instances. Empty: No instance topology. Click an instance for the console.",
          "Create instance and database opens the create dialog. The key icon opens Sync remote node user instances. Template management goes to Templates.",
          "Empty title: No instances or databases. Primary: Go to template center. You can also sync with a user key.",
          "On errors, the toast can Ask Saki."
        ]
      },
      {
        id: "wiki-instances-create",
        title: "5.2 Create an instance",
        description: "Two tabs. Title becomes Create standard instance or Add database visualizer.",
        bullets: [
          "Tab Standard command/process instance: node, name, working directory (placeholder Leave empty to auto-create), start command (star button AI analyze and fill start command after a directory is set), stop command, description, Autostart, restart policy, max retries. Footer Cancel / Create.",
          "Tab Database visualizer instance: the add-database wizard (see chapter 9)."
        ],
        mockupKey: "create-instance",
        table: {
          headers: ["Restart policy", "Meaning"],
          rows: [
            ["Never restart", "Stays stopped"],
            ["Restart on failure", "Restart only after a bad exit"],
            ["Always restart", "Come back up no matter how it stopped"]
          ]
        }
      },
      {
        id: "wiki-instances-actions",
        title: "5.3 Quick actions",
        description: "Inside an instance, eight large buttons on the right.",
        bullets: [
          "Start: run it. Status becomes Running.",
          "Restart: stop safely, then start.",
          "Stop: stop command or a normal signal, trying to save data.",
          "Kill: force quit when it hangs.",
          "Files: this instance's folder only.",
          "Instance settings: name, directory, start command, Watch policy.",
          "Scheduled tasks: timed restart or console commands.",
          "Proxy: for downloads that need a tunnel."
        ],
        mockupKey: "instance-actions"
      },
      {
        id: "wiki-instances-summary",
        title: "5.4 Summary card",
        description: "Same column shows basics.",
        mockupKey: "instance-summary",
        table: {
          headers: ["Field", "Meaning"],
          rows: [
            ["Status", "Running / stopped / error"],
            ["Generic console program", "Type badge for a process instance"],
            ["Node", "Which machine"],
            ["Working directory", "Where files and commands live"],
            ["Restart policy / autostart", "What happens after crash or reboot"],
            ["Creator / updated", "Who created it and when it changed"],
            ["Last exit code", "0 is usually a clean stop; see the next chapter"],
            ["Watch on", "Saki Watch is enabled"]
          ]
        }
      },
      {
        id: "wiki-instances-settings",
        title: "5.5 Instance settings",
        description: "Dialog Instance settings. Subtitle: start command and run policy.",
        bullets: [
          "Basics: name, working directory, start command (AI suggest), stop command, description, node.",
          "Restart policy, max retries, Start this instance when the system boots.",
          "Saki self-heal: diagnose and patch / diagnose only, do not edit files / turn watch off for this instance.",
          "Watch details: cooldown (seconds), diagnoses per hour, verify wait, health-check timeout, health-check URL (non-2xx/3xx during verify rolls back).",
          "Autonomy: Approve everything manually, Auto-run low risk, Auto-run low and medium risk. Confidence is editable only if not fully manual. Escalation minutes.",
          "Notify channels by name. Empty: No channels yet. Add them in Settings → Watch notifications.",
          "Cancel / Save settings."
        ]
      },
      {
        id: "wiki-instances-proxy",
        title: "5.6 Network proxy",
        description: "Dialog Network proxy settings. Per instance, not the whole PC.",
        bullets: [
          "Enable independent network proxy. Subtitle mentions Clash / v2rayN.",
          "Clash subscription: paste URL → Fetch nodes. Shows N nodes found and Selected. Cards show region, type, address, and In use. Filter by region or name. Empty: No matching nodes. Bypass list supported.",
          "App port: HTTP/HTTPS or SOCKS5, host, port, optional user/password. Hints: Clash mixed 7890, v2rayN SOCKS5 10808 / HTTP 10809. LAN proxies need a real IP. Button is Test connection.",
          "If the instance is running: Save and restart to apply."
        ]
      },
      {
        id: "wiki-instances-sync",
        title: "5.7 Sync remote node user instances",
        description: "Key icon. Title Sync remote node user instances.",
        bullets: [
          "Pick a node. After users are discovered: Import all, or Import this user.",
          "Or import by dedicated key: paste a saki_usr_ User access key, optional Remote panel URL.",
          "Keys are created under Nodes → Dedicated access keys, shown only once."
        ]
      }
    ]
  },
  {
    id: "wiki-probe",
    title: "6. Probe: CPU, memory, uptime",
    shortTitle: "Probe",
    category: "instances",
    categoryLabel: "Instances and terminal",
    iconName: "Cpu",
    badge: "Live glance",
    summary: "A probe card on the instance detail. While running it shows load and uptime.",
    keywords: ["probe", "CPU", "memory", "uptime", "PID", "chart", "exit code"],
    subsections: [
      {
        id: "wiki-probe-card",
        title: "6.1 Four numbers",
        description: "Updates about every 1.5s while running; sleeps when stopped.",
        bullets: [
          "CPU usage percent. Low is Steady; high uses a warning color.",
          "Physical memory size.",
          "Uptime from this start. Stopped shows Sleeping.",
          "PID, thread state, node scheduling.",
          "Chart title Load trend (rolling sample), with Sample: 1.5s/tick while running."
        ],
        mockupKey: "instance-probe"
      },
      {
        id: "wiki-probe-exit-codes",
        title: "6.2 Exit code cheat sheet",
        description: "After stop, the summary keeps Last exit code.",
        table: {
          headers: ["Code", "Usual meaning", "What to try"],
          rows: [
            ["0", "Clean stop", "Planned shutdown"],
            ["1", "General error", "Start command, busy port, missing runtime"],
            ["126", "Not executable", "chmod in a terminal, or change how you start it"],
            ["127", "Command not found", "Java / Python / Node missing, or bad path"],
            ["130", "Ctrl+C", "Interrupted on purpose"],
            ["137", "Killed for memory", "Fewer instances, a bigger machine, or lower -Xmx"],
            ["143", "Normal stop signal", "You clicked Stop, or a graceful shutdown"]
          ]
        }
      }
    ]
  },
  {
    id: "wiki-terminal",
    title: "7. Web terminal: logs and commands",
    shortTitle: "Terminal",
    category: "instances",
    categoryLabel: "Instances and terminal",
    iconName: "Terminal",
    badge: "Console",
    summary: "Left side of instance detail. Colored logs, commands, extra shells, mobile keys.",
    keywords: ["terminal", "console", "logs", "command", "shell", "Ask Saki", "history", "immersive"],
    subsections: [
      {
        id: "wiki-terminal-features",
        title: "7.1 Using the terminal",
        description: "This is the service's screen and keyboard.",
        bullets: [
          "Minecraft color codes (§a green, §c red, …) render as-is.",
          "Click in the terminal to pause auto-scroll; scroll to bottom to follow again.",
          "Connection states: disconnected / connecting / connected / reconnecting / disconnected / error. Reconnect tries to fill missed logs.",
          "Command box at the bottom. Enter sends. Tooltip: Send command (Enter).",
          "Selecting text shows a floating bar: count, copy, Ask Saki, Clear selection.",
          "Warnings in the log also show Ask Saki.",
          "Phone keys: Esc, Tab, Ctrl, arrows, backspace, C / D / L (with Ctrl), Enter; plus Text (Copy when there is a selection). There is no Clear key."
        ],
        mockupKey: "terminal-console"
      },
      {
        id: "wiki-terminal-actions",
        title: "7.2 Top buttons and extra shells",
        bullets: [
          "Clear: only the screen, not the real log.",
          "Reconnect.",
          "Copy terminal text / view logs: copies a selection, or opens View and copy terminal text with Copy all and a character count.",
          "Immersive terminal. Immersive header: text, clear, reconnect, Exit immersive.",
          "New terminal (Shell): extra sessions labeled shell1, shell2, each closable.",
          "Command history: clock icon. Click to fill, or Run now. Empty: No history commands.",
          "Tab completes; up/down walks history."
        ]
      }
    ]
  },
  {
    id: "wiki-filemanager",
    title: "8. Files: edit configs, upload, extract",
    shortTitle: "Files",
    category: "files",
    categoryLabel: "Files and databases",
    iconName: "FolderOpen",
    badge: "Configs",
    summary: "Each instance has its own folder. Browse, upload, edit, zip/unzip, or drag a file to Saki.",
    keywords: ["files", "upload", "download", "extract", "edit", "search", "multi-select", "zip", "conflict", "preview"],
    subsections: [
      {
        id: "wiki-filemanager-suite",
        title: "8.1 Toolbar",
        description: "Quick action Files.",
        bullets: [
          "Path bar: click crumbs, or type a path.",
          "Back / forward / up / refresh.",
          "New file, new folder, upload. Drag files or whole folders in.",
          "Search by name. Switch Explorer mode and Tree mode.",
          "Open text/config to edit; Ctrl+S saves. HTML / Markdown / images switch Source and Preview. Ctrl+F is Find in current file; Enter / Shift+Enter next/previous. Empty: Select a file to view or edit.",
          "Archives: Extract to current folder... or Compress as file.... Large jobs run in the background.",
          "Drag a file onto Saki for her to read.",
          "There is no chmod UI. If a script is not executable, chmod in a terminal or change how you start it."
        ],
        mockupKey: "file-manager"
      },
      {
        id: "wiki-filemanager-batch",
        title: "8.2 Multi-select, context menu, shortcuts",
        bullets: [
          "Multi-select (or swipe on mobile): select all/invert, copy to other side, move to other side, zip selected, download selected, delete selected. Drag a box on empty space.",
          "Desktop context menu: Open folder, Open / edit, Extract to current folder..., Compress as file..., Delete selected items, plus copy/cut/paste/rename/download.",
          "Name conflict dialog File already exists: Overwrite, Keep both (rename), Cancel — not Skip.",
          "Extract conflict: per-item overwrite or skip, or Overwrite all / Skip all, then Confirm extract. Folder conflicts can only skip.",
          "Phones use L/R panes: copy/move/extract to the other side, Compress as ZIP, Download to phone, Edit/view; multi-select and select all/none."
        ],
        table: {
          headers: ["Shortcut (desktop)", "Action"],
          rows: [
            ["Ctrl+C / Ctrl+X / Ctrl+V", "Copy / cut / paste"],
            ["Ctrl+A", "Select all"],
            ["Delete", "Delete"],
            ["F2", "Rename"],
            ["F5", "Refresh"],
            ["Enter", "Open"],
            ["Esc", "Clear selection"]
          ]
        }
      }
    ]
  },
  {
    id: "wiki-database",
    title: "9. Database console: tables, rows, import/export",
    shortTitle: "Databases",
    category: "files",
    categoryLabel: "Files and databases",
    iconName: "Database",
    badge: "No extra app",
    summary: "Add a connection from the instance page. SQLite, MySQL, PostgreSQL, Redis — browse, edit, run statements.",
    keywords: ["database", "SQLite", "MySQL", "MariaDB", "PostgreSQL", "Redis", "SQL", "import", "export", "discover"],
    subsections: [
      {
        id: "wiki-database-entry",
        title: "9.1 Where to open, which engines",
        bullets: [
          "Engines: SQLite, MySQL / MariaDB, PostgreSQL, Redis.",
          "Empty state lists those engines and Add database. Removing a visualizer says it will not delete the real database file or service.",
          "Add wizard tabs: Smart discover (Rescan then Configure and add) plus manual SQLite / MySQL / PostgreSQL / Redis.",
          "Manual add: name, host/port, user/password, database; Test connection, Finish add; Assign owner; Enable read-only protection. SQLite can Quick-fill panel system database (dev.db). Redis has database index."
        ],
        mockupKey: "database-probe"
      },
      {
        id: "wiki-database-workspace",
        title: "9.2 Workspace tabs and side actions",
        description: "Header shows engine chip, name, Ready, Back to instance list, and a switcher.",
        table: {
          headers: ["Tab (on screen)", "What you can do"],
          rows: [
            ["Data browse (Data) / Key browse (Keys)", "Search, insert row or key, edit/delete; non-Redis can truncate or drop (with confirm); sort by column; pager"],
            ["Schema", "Columns, indexes, DDL (not for Redis)"],
            ["SQL console / Redis CLI", "Run statements, time and rows affected, shortcut chips, history"],
            ["Import and export", "Whole DB or one table; CSV / JSON / SQL dump; import Append or Replace from paste or file"]
          ]
        },
        bullets: [
          "Create table: name, add fields, PK / NotNull, Create table now.",
          "New Redis key: String / Hash / List / Set, optional TTL (empty or -1 = forever).",
          "Side shortcuts: refresh, new table/key, console, import/export, config, add DB, remove. Summary shows Read-only protection or Read-write ready.",
          "Live health and connectivity probe about every 4s: latency, excellent/normal, engine version, latency wave.",
          "Edit connection in Database instance settings. On error: Edit connection config."
        ],
        mockupKey: "database-workspace"
      }
    ]
  },
  {
    id: "wiki-templates",
    title: "10. Templates: one-click servers",
    shortTitle: "Templates",
    category: "cluster",
    categoryLabel: "Nodes and templates",
    iconName: "LayoutTemplate",
    badge: "Deploy",
    summary: "Use a ready template, or save a tuned instance for next time.",
    keywords: ["template", "Minecraft", "one-click", "custom template", "Node.js", "Python", "Docker"],
    subsections: [
      {
        id: "wiki-templates-catalog",
        title: "10.1 Browse",
        description: "Sidebar Templates. Search; counts for built-in vs yours.",
        bullets: [
          "Built-in templates badge Built-in or System built-in and cannot be deleted. Types: generic command, Node.js, Python, Java Jar, Shell, Docker, Docker Compose, Minecraft, Steam game server, and more.",
          "Create from a template: node, name, working directory, start command (AI suggest), autostart, restart policy. Details may show preset ports."
        ]
      },
      {
        id: "wiki-templates-save",
        title: "10.2 Make your own",
        bullets: [
          "Save instance as template: pick a tuned instance, name, description, start/stop, directory prefix.",
          "Custom template opens New custom template: type, default command, autostart, restart policy, optional run-as user, Save custom template.",
          "Your templates can be edited or deleted. Esc closes; fullscreen is available."
        ]
      }
    ]
  },
  {
    id: "wiki-nodes",
    title: "11. Nodes: join more machines",
    shortTitle: "Nodes",
    category: "cluster",
    categoryLabel: "Nodes and templates",
    iconName: "Server",
    badge: "Fleet",
    summary: "One panel can drive many machines. Each runs a light node agent and joins with a key.",
    keywords: ["node", "key", "install", "Linux", "Windows", "Docker", "test connection", "group"],
    subsections: [
      {
        id: "wiki-nodes-join",
        title: "11.1 Three join methods",
        description: "Sidebar Nodes.",
        bullets: [
          "Segments: Connect by key, Install wizard, Manual.",
          "Connect by key: on the machine run npm run daemon:key, paste saki_node_.... Parsed host info appears. Optional name, group, host/domain override. Private IPs warn you to use a public address.",
          "Install wizard: Linux curl|bash, Windows irm|iex, Docker run with an enrollment token. Copy command. After install the terminal prints a Node Key; switch back to Connect by key.",
          "Manual: name, host, port, protocol, remarks, group, tags."
        ],
        mockupKey: "node-join"
      },
      {
        id: "wiki-nodes-manage",
        title: "11.2 List actions",
        bullets: [
          "Columns: name, address, online, OS, CPU/memory, group/owner, heartbeat.",
          "Test connection, edit, Node credentials and commands (ID, last-4 fingerprint, copy Linux/Windows/Docker reconnect, Rotate key — old key dies immediately).",
          "Delete warns that instances on it are removed too.",
          "Dedicated access keys: shown only once, list shows fingerprint. Revoke asks for confirm. Empty: No access keys yet. Use the key to sync your instances on the instance page."
        ],
        mockupKey: "node-cluster"
      }
    ]
  },
  {
    id: "wiki-rbac",
    title: "12. Users, roles, and points",
    shortTitle: "Roles and points",
    category: "security",
    categoryLabel: "Users, roles, and points",
    iconName: "Users",
    badge: "Team",
    summary: "Admins create accounts, assign work, and grant points. Regular users only see assigned instances. Talking to Saki spends points.",
    keywords: ["users", "roles", "permissions", "points", "assign", "unlimited", "switch user"],
    subsections: [
      {
        id: "wiki-rbac-users",
        title: "12.1 User list",
        description: "Sidebar Users. Search username / display name / role...",
        bullets: [
          "Columns also show points (or Unlimited), status, last login. Phones: Add user / Collapse.",
          "Create user: username, display name, password, role (including No role). Status is not on create.",
          "Edit user: username, display name, avatar, status (Active / Disabled), role, optional new password.",
          "Assign: dialog Assign instances. Check process instances and “×× database visualizer”, see selected count, Save assignment.",
          "Switch: super admins only; not yourself or another super admin; target must be Active. Used to see what they see.",
          "Points opens Manage user points.",
          "You cannot delete yourself."
        ],
        mockupKey: "rbac-quota"
      },
      {
        id: "wiki-rbac-roles",
        title: "12.2 Role permissions (super admin)",
        bullets: [
          "Left: System roles. Tools: Select all, Clear, Reset, Save permissions. Search Quickly filter permissions...",
          "Each group: Select this group / Clear this group. Unsaved: Unsaved changes (N).",
          "Groups: dashboard and system, nodes, instances and containers, remote terminal, files, scheduled tasks, templates, users and roles, Saki assistant.",
          "Typical identities: super admin, admin, user (assigned resources only), no role (no sidebar)."
        ]
      },
      {
        id: "wiki-rbac-points",
        title: "12.3 How points are spent and granted",
        description: "Top-bar badge, Saki Points & Usage, and the user-page points button share one ledger.",
        bullets: [
          "Chat/agent: about 1000 tokens = 1 point × model multiplier (rounded up). Models show Free or 2.0x. 0x is free. Unlimited shows ∞ and Unlimited.",
          "Feeding: daifuku 1, milk tea 2, bento 5.",
          "Not enough points blocks Saki; the UI asks you to contact an admin.",
          "Manage user points tabs: Point actions / Spend and change history. Three cards: Add / deduct (preview current → delta → estimate), Set value, Unlimited points (toggle Grant unlimited points). Optional note, Confirm save. History can Refresh records.",
          "The mini-game mainly grants affection EXP, not panel points."
        ]
      }
    ]
  },
  {
    id: "wiki-cron",
    title: "13. Scheduled tasks: timed restart or commands",
    shortTitle: "Scheduled tasks",
    category: "system",
    categoryLabel: "Automation and settings",
    iconName: "Clock",
    badge: "Timers",
    summary: "Alarms on one instance: restart, start, stop, or send a console command. Entry is instance quick actions, not the sidebar.",
    keywords: ["scheduled", "cron", "auto restart", "command"],
    subsections: [
      {
        id: "wiki-cron-scheduling",
        title: "13.1 Create",
        description: "Open an instance → Scheduled tasks.",
        bullets: [
          "Name (defaults include the instance name).",
          "Type: restart, start, stop, or run command (then type e.g. save-all).",
          "Schedule placeholder @every 30m or */5 * * * *. @every 30m means every 30 minutes; five-field cron works too.",
          "Enable checkbox. Then it appears in the list."
        ],
        mockupKey: "cron-tasks"
      },
      {
        id: "wiki-cron-runs",
        title: "13.2 List and run history",
        bullets: [
          "Each task: run now, enable/disable, delete.",
          "Select one for run history: start, end, status, output, error.",
          "Empty: No scheduled tasks, plus Saki is standing by asleep…. No runs yet: No run records."
        ],
        callout: {
          type: "tip",
          title: "Can't find the menu?",
          text: "There is no sidebar item. Open the instance, then Scheduled tasks on the right."
        }
      }
    ]
  },
  {
    id: "wiki-dashboard",
    title: "14. Overview: all machines at a glance",
    shortTitle: "Overview",
    category: "system",
    categoryLabel: "Automation and settings",
    iconName: "Activity",
    badge: "Home",
    summary: "First page after login. Node online count, CPU / memory / disk, recent instances.",
    keywords: ["overview", "dashboard", "CPU", "memory", "disk", "recent", "nodes"],
    subsections: [
      {
        id: "wiki-dashboard-metrics",
        title: "14.1 Four cards and the resource chart",
        description: "Sidebar Overview.",
        bullets: [
          "Online nodes: online/total. Opens Node details: online/offline/total, last heartbeat, per-node list.",
          "CPU / memory / disk open CPU details, Memory details, Disk details: current, peak, average, hottest node, Trend chart, Per node. Empty: No history curve, No nodes.",
          "Resource chart: CPU, memory, disk, with generated time.",
          "Refreshes about every 10 seconds."
        ],
        mockupKey: "dashboard"
      },
      {
        id: "wiki-dashboard-recent",
        title: "14.2 Recent instances and node table",
        bullets: [
          "Up to 8 recent instances: name, type, node, status, relative time. Click a row to open it. View all goes to Instances.",
          "Empty: No instances, or No instance permission.",
          "With node view permission: a node table (name, address, status, OS, resources, heartbeat). Admins can Test connection. Empty: No connected nodes, with a hint to add one."
        ]
      }
    ]
  },
  {
    id: "wiki-reliability",
    title: "15. Reliability report",
    shortTitle: "Reliability",
    category: "system",
    categoryLabel: "Automation and settings",
    iconName: "Shield",
    badge: "Watch stats",
    summary: "Last 7 / 14 / 30 days: how many crashes, how long to recover, auto-fix success.",
    keywords: ["reliability", "MTTR", "recurrence", "auto-fix", "trend"],
    subsections: [
      {
        id: "wiki-reliability-report",
        title: "15.1 What's in the report",
        description: "Sidebar Reliability (needs Saki permission). 7 / 14 / 30 days. Refresh about every 30s.",
        bullets: [
          "MTTR (minutes): average recover time, lower is better.",
          "Event total, with how many still active.",
          "Recovered / failed.",
          "Auto-fix success rate: attempts and successes.",
          "Recurrence rate.",
          "Event trend: opened vs recovered.",
          "TOP recurring fingerprints: fingerprint, instance, trigger, count, last seen. Empty: No recurring events. Trigger Webhook is the same as External alert in the Watch inbox.",
          "Instance reliability ranking: instance, events, recovered, failed, MTTR. Empty: No instance data. Updated at … is at the top right."
        ],
        callout: {
          type: "note",
          title: "No watch events in this window",
          text: "When things are calm you see a healthy illustration: no new Watch events in these days."
        },
        mockupKey: "reliability"
      }
    ]
  },
  {
    id: "wiki-audit",
    title: "16. Audit log: who did what",
    shortTitle: "Audit",
    category: "security",
    categoryLabel: "Users, roles, and points",
    iconName: "ClipboardList",
    badge: "Traceable",
    summary: "Admins see logins, instance starts, file edits, settings changes, and can hand a row to Saki.",
    keywords: ["audit", "log", "login", "Ask Saki"],
    subsections: [
      {
        id: "wiki-audit-list",
        title: "16.1 List",
        description: "Sidebar Audit.",
        bullets: [
          "Summary cards: Successes on this page, Failures on this page, Users involved, Latest record. List heading Signal matrix.",
          "Each card: action name, success/fail, actor, time, resource; Select checkbox.",
          "Toolbar Ask Saki. With delete permission: Select this page / Unselect this page, Delete selected, Delete current log, Clear all logs.",
          "Pager Previous / Next. Empty: No audit logs."
        ],
        table: {
          headers: ["Common action", "Example"],
          rows: [
            ["Login / rate limited / logout / register / update account", "Who signed in"],
            ["Start / stop / restart / kill / update / view logs", "Instance life"],
            ["Upload / download / extract / write / rename / archive", "Files"],
            ["Create / test / delete node", "Machines"],
            ["Create / run / update / delete task", "Schedules"],
            ["Create template / terminal input / Saki chat / update Saki settings", "Templates, terminal, assistant"],
            ["Create / delete user / switch account / update permissions", "Accounts"]
          ]
        }
      },
      {
        id: "wiki-audit-detail",
        title: "16.2 A single record",
        bullets: [
          "Result, time, user, resource, IP, payload. Empty payload: No payload.",
          "Saki chats split User question / Saki answer. Tools show name, args, result.",
          "Files: Quick preview current file.",
          "Hand to Saki for a risk read."
        ]
      }
    ]
  },
  {
    id: "wiki-settings",
    title: "17. Settings: language, model, appearance, skills",
    shortTitle: "Settings",
    category: "system",
    categoryLabel: "Automation and settings",
    iconName: "Settings",
    badge: "Admins",
    summary: "Sidebar Settings. Collapsible Settings directory: System, AI model, Features, Appearance, System prompt, Skills, Watch notifications. Save settings at the bottom except Skills and Watch.",
    keywords: ["settings", "language", "model", "Ollama", "appearance", "prompt", "Skills", "search", "MCP", "Copilot", "Antigravity", "ingest"],
    subsections: [
      {
        id: "wiki-settings-system",
        title: "17.1 System",
        description: "Basics.",
        bullets: [
          "Panel language: Simplified Chinese / Traditional Chinese / English.",
          "Registration identity: none, user, admin, or super admin for new sign-ups.",
          "Session timeout in minutes. 0 means never expire.",
          "Request timeout in ms, often 30000–120000."
        ]
      },
      {
        id: "wiki-settings-model",
        title: "17.2 AI model",
        description: "Which model Saki talks with.",
        bullets: [
          "Fields Provider and Model. List: Ollama, LM Studio, GitHub Copilot, Antigravity CLI, OpenAI Compatible, DeepSeek, Zhipu, Gemini, MiniMax, Anthropic, Moonshot, Tongyi, Doubao, Custom.",
          "Ollama / LM Studio need a URL; clouds need a base URL and key.",
          "With a list the button is Sync models, plus Enter a custom ID. Without a list: Detect.",
          "GitHub Copilot: GitHub Copilot auth status (authorized/not), Check status, Sign in to GitHub, maybe a device code and Open GitHub device verification.",
          "Antigravity: Sign in with Google, Check status, Sync latest models, Sign out; Add new account / click to switch. After the two-step wizard: Finish auth and connect. Mode: local reverse-proxy gateway or Official direct (Gemini API Key). An AIzaSy key switches to official. Shows today's/total tokens and quota.",
          "Model point multipliers: about 1000 tokens = 1 point × rate (rounded up); 0x is free. Search, paging, per-model rate."
        ]
      },
      {
        id: "wiki-settings-features",
        title: "17.3 Features",
        bullets: [
          "Web search and page extract: Saki may look up docs.",
          "Model Context Protocol (MCP): extra tools.",
          "Saki voice-echo engine: hold Saki in the companion room. Lightweight DSP enhance (recommended/default) or On-device WebGPU / WASM AI. Footer shows whether WebGPU was found; if not, AI mode falls back to DSP."
        ],
        mockupKey: "settings-nav"
      },
      {
        id: "wiki-settings-appearance",
        title: "17.4 Appearance",
        description: "Login page, icons, and wallpaper. Light/dark and desktop/phone are separate.",
        bullets: [
          "Sidebar title, login title, login subtitle.",
          "Cards: Login cover image, App icon (Favicon/Logo), Sidebar logo, Default user avatar. Path or Upload; reset to default if changed.",
          "Custom wallpaper and motion background: images or video (mp4 / webm / ogg), 50MB max. Tabs Light / Dark / Show all. Four slots: desktop light/dark, mobile portrait light/dark. Preview labels Static image or Motion video.",
          "Show top-bar server time: synced clock; click to calibrate world zones."
        ]
      },
      {
        id: "wiki-settings-prompt-skills",
        title: "17.5 System prompt and Skills",
        bullets: [
          "Label Global system prompt (System Prompt), with N characters. Placeholder: personality, tone, and constraints.",
          "Skills header: Import file, Add Skill. Filters All / Enabled / Disabled. Sidebar Install from URL + Install, and Import from file, Choose .md / .txt files.",
          "Add name, tags, description, SKILL.md, Enable this Skill. Built-in skills say Built-in: disable only, no delete. Detail: Save / Enable·Disable / Delete."
        ]
      },
      {
        id: "wiki-settings-watch-about",
        title: "17.6 Watch notifications and updates",
        bullets: [
          "Notification channels: name, type (generic webhook / DingTalk / WeCom / Telegram), webhook URL, optional Secret (DingTalk sign, Telegram chat_id), event checkboxes, Add channel. List Enable/Disable, Test (ok/fail), Delete. Recent deliveries below.",
          "Alert ingest tokens: generic JSON and Prometheus Alertmanager. Target instance, label, Create token. Copy token or URL, created/last used, delete. Empty: no tokens yet.",
          "This About page can Check for updates and open the release page.",
          "Repo: GitHub EthanChan050430/Saki-Panel, license Apache-2.0."
        ]
      }
    ]
  }
];
