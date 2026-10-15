import { isAbsolutePathInsideWorkspace } from "./workspace-path.js";

export interface CommandRisk {
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
  /** Low risk builds/tests still execute project code and may write files. */
  readOnly: boolean;
  autoApprove: boolean;
}

const dangerousCommandPatterns = [
  /\brm\s+-rf\s+(\/|\*|~)/i,
  /\bdel\s+\/[sq]\b/i,
  /\brmdir\s+\/[sq]\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(\.| )/i,
  /\bdd\s+if=.*\s+of=\/dev\//i,
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,
  /\breg\s+delete\b/i,
  /\bnet\s+user\s+.*\s+\/delete\b/i
];

export function findDangerousCommandReason(command: string): string | null {
  return dangerousCommandPatterns.some((pattern) => pattern.test(command.replace(/\s+/g, " ").trim()))
    ? "Command was blocked by the panel safety policy"
    : null;
}

function result(risk: CommandRisk["risk"], reason: string, readOnly = false, autoApprove = false): CommandRisk {
  return { risk, reason, readOnly, autoApprove };
}

/** This is a conservative interaction policy, not an OS sandbox or a shell parser.
 * Only recognized commands and simple, fully inspected compositions run automatically.
 * Shell expansion, executable scripts, and unrecognized syntax go to human review.
 */
function splitCommands(command: string): string[][] | null {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote = "";
  const flushToken = () => {
    if (tokenStarted) tokens.push(token);
    token = "";
    tokenStarted = false;
  };
  const flushSegment = () => {
    flushToken();
    if (!tokens.length) return false;
    segments.push(tokens);
    tokens = [];
    return true;
  };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    // Expansions and escape syntax have different semantics across cmd, sh and PowerShell.
    // Never infer safety from the first word when the shell can construct more commands.
    if (/[`%^!]/.test(char) || (char === "$" && quote !== "'")) return null;
    if (quote) {
      // cmd.exe does not treat single quotes as quoting. Keep metacharacters
      // conservative even inside quotes rather than assume the remote shell.
      if (/[;&|<>\r\n]/.test(char)) return null;
      if (char === "\\" && command[i + 1] === quote) return null;
      if (char === quote) quote = "";
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
    } else if (char === "\\" && /[\s'";&|<>]/.test(command[i + 1] ?? "")) {
      return null;
    } else if (/[<>(){}%]/.test(char)) {
      return null;
    } else if (/[;&|\r\n]/.test(char)) {
      if (!flushSegment()) return null;
      if (char === "&") {
        if (command[i + 1] !== "&") return null;
        i += 1;
      } else if (char === "|" && command[i + 1] === "|") {
        i += 1;
      } else if (char === "\r" && command[i + 1] === "\n") {
        i += 1;
      }
    } else if (/\s/.test(char)) {
      flushToken();
    } else {
      token += char;
      tokenStarted = true;
    }
  }
  if (quote || !flushSegment()) return null;
  return segments;
}

const readCommands = new Set([
  "pwd", "ls", "dir", "cat", "type", "head", "tail", "rg", "grep", "findstr", "stat", "wc", "which", "where", "whoami",
  "get-location", "get-childitem", "gci", "get-content", "gc", "get-item", "get-filehash", "select-string", "select-object",
  "measure-object", "format-list", "format-table", "out-string", "hostname", "uname"
]);
const projectCommands = new Set(["tsc", "eslint", "prettier", "vitest", "jest", "pytest", "ruff"]);
const projectScripts = /^(?:build|check|typecheck|type-check|lint|test|format|dev|start)(?::[\w.-]+)?$/i;
const packageManagers = new Set(["npm", "pnpm", "yarn", "pip", "pip3", "uv"]);

function classifySegment(tokens: string[], workingDirectory?: string): CommandRisk {
  // A path-qualified binary may be a local executable with the name of a trusted utility.
  const executable = tokens[0]!.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");
  const args = tokens.slice(1);
  const lower = args.map((arg) => arg.toLowerCase());
  const verb = lower[0] ?? "";
  if (executable === "find" && lower.some((arg) => /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)(?:=|$)/.test(arg))) {
    return result("high", "Find actions can execute commands, delete files, or write output files");
  }
  if ((packageManagers.has(executable) || executable === "npx") && lower.some((arg) => /^(?:-g|--global|--prefix|--user|--target|--root|--registry|--index-url|--extra-index-url)(?:=|$)/.test(arg))) {
    return result("high", "Package command changes global/external locations or registry settings");
  }
  if (/^(?:sudo|su|doas|runas|remove-item|ri|rm|del|erase|rmdir|rd|move-item|copy-item|mv|move|cp|copy|chmod|chown|icacls|takeown|kill|pkill|taskkill|stop-process|stop-computer|restart-computer|set-executionpolicy|reg|net|docker|docker-compose|podman|kubectl|systemctl|service|pm2|ssh|scp|sftp|rsync)$/i.test(executable)) {
    return result("high", "Command can delete data, change permissions, affect processes/services, or access another machine");
  }
  if (executable === "git" && !["status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse", "branch", "--version"].includes(verb)) {
    return result("high", "Git command can change history, workspace contents, configuration, or remote state");
  }
  if (executable === "git" && (lower.some((arg) => /^(?:--output(?:=|$)|--ext-diff$|--textconv$|--no-index$|-c$)/.test(arg)) || (verb === "branch" && args.length > 1 && !lower.slice(1).every((arg) => ["--list", "-l", "-a", "--all", "-r", "--remotes", "--show-current", "-v", "-vv"].includes(arg))))) {
    return result("high", "Git options can write files, execute external helpers, or change branches");
  }
  if (lower.some((arg) => /^(?:--pre(?:=|$)|--hostname-bin(?:=|$)|--upload-file(?:=|$)|-t$|--data(?:-\w+)?(?:=|$)|-d$|--request(?:=|$)|-x$|--config(?:=|$)|--exec(?:=|$)|--eval(?:=|$))/.test(arg)) && !projectCommands.has(executable) && !packageManagers.has(executable)) {
    return result("high", "Command options may execute a helper, load executable configuration, or send data");
  }
  const pathValue = (token: string) => token.replace(/^--?[\w-]+[:=]/, "");
  if (args.some((arg) => /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|credentials|id_rsa|id_ed25519)(?:$|[\\/])|\.(?:pem|pfx|key)$/i.test(pathValue(arg)))) {
    return result("high", "Command may access credentials or other sensitive files");
  }
  const external = tokens.find((token) => {
    const value = pathValue(token);
    if (/^https?:\/\//i.test(value)) return false;
    if (isAbsolutePathInsideWorkspace(value, workingDirectory)) return false;
    return /^(?:[a-z]:|\\\\|~|\/)|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(value);
  });
  if (external) return result("high", "Command references an absolute, home, or parent path outside the relative workspace boundary");
  if (/[\\/]/.test(executable)) return result("high", "Path-qualified programs and workspace scripts require review");
  if (["cd", "set-location", "sl"].includes(executable)) {
    if ((args.length === 1 && args[0] && !args[0].startsWith("-")) || (args.length === 2 && ["-literalpath", "-path"].includes(verb) && args[1] && !args[1].startsWith("-"))) return result("low", "Changes to a relative workspace directory; each tool execution resets its starting directory", true, true);
    return result("high", "Directory changes to implicit or previously used locations require review");
  }
  if (args.some((arg) => /^(?:ftp|file|ssh|git\+\w+):|^https?:\/\//i.test(arg))) {
    // Only a plain, unauthenticated HTTP GET is eligible for automatic risk review.
    if (executable === "curl" && args.filter((arg) => !arg.startsWith("-")).length === 1 && args.every((arg) => /^https?:\/\//i.test(arg) || ["-f", "-s", "-sS", "-fsSL", "-fsS", "-L", "--fail", "--silent", "--show-error", "--location", "-I", "--head"].includes(arg)) && !args.some((arg) => /https?:\/\/[^/]*@|[?&](?:token|key|secret|password)=/i.test(arg))) {
      return result("medium", "Command makes an unauthenticated web request; request approval mode asks before terminal network access", false, true);
    }
    return result("high", "Command uses a remote URL, upload, custom registry, or downloaded executable content");
  }
  if (readCommands.has(executable)) return result("low", "Workspace inspection command", true, true);
  if (executable === "git") return result("low", "Read-only Git inspection", true, true);
  if (executable === "echo" || executable === "write-output") return result("low", "Prints literal output", true, true);
  if (projectCommands.has(executable)) return result("low", "Common workspace check, test, or formatter", false, true);
  if (executable === "npx") {
    if (verb === "--no-install" && projectCommands.has(lower[1] ?? "")) return result("low", "Runs an installed workspace check/test tool without downloading it", false, true);
    if (projectCommands.has(verb)) return result("medium", "Runs a standard check/test package and may download it from the configured registry", false, true);
  }
  if (args.length === 1 && ["node", "python", "python3", "ruby", "go", "cargo", "dotnet", "java"].includes(executable) && (["--version", "-V", "version", "-version"].includes(args[0] ?? "") || (executable === "node" && verb === "-v"))) {
    return result("low", "Runtime version inspection", true, true);
  }
  if (executable === "node" && ["--check", "-c"].includes(verb) && args.length === 2 && !args[1]!.startsWith("-")) return result("low", "Checks JavaScript syntax in a workspace file", true, true);
  if (["python", "python3"].includes(executable) && verb === "-m" && ["pytest", "unittest", "compileall", "ruff"].includes(lower[1] ?? "")) return result("low", "Workspace Python checks/tests", false, true);
  if ((executable === "cargo" && ["check", "build", "test", "fmt", "clippy"].includes(verb)) || (executable === "go" && ["build", "test", "vet", "fmt"].includes(verb)) || (executable === "dotnet" && ["build", "test", "format"].includes(verb))) return result("low", "Common workspace build or test", false, true);
  if (packageManagers.has(executable)) {
    if (["--version", "-v"].includes(verb) || ["list", "ls", "why"].includes(verb)) return result("low", "Local package inspection", true, true);
    if (["npm", "pnpm", "yarn"].includes(executable) && ((verb === "run" && projectScripts.test(args[1] ?? "")) || projectScripts.test(verb))) return result("low", "Common workspace build, test, or development script", false, true);
    if (["npm", "pnpm", "yarn"].includes(executable) && ["install", "ci", "add"].includes(verb) && args.slice(1).every((arg) => ["--save", "--save-dev", "-D", "--no-audit", "--no-fund", "--ignore-scripts", "--frozen-lockfile", "--immutable"].includes(arg) || /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9.^~*<>=|+-]+)?$/i.test(arg))) {
      return result("medium", "Installs workspace dependencies from the configured package registry; package lifecycle scripts may run", false, true);
    }
  }
  return result("high", "Unrecognized command or executable script requires review before execution");
}

export function classifyCommandRisk(command: string, workingDirectory?: string): CommandRisk {
  if (!command.trim()) return result("critical", "Command is required");
  const blocked = findDangerousCommandReason(command);
  if (blocked || command.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(command)) return result("critical", blocked ?? "Command was blocked by the panel safety policy");
  const segments = splitCommands(command);
  if (!segments) return result("high", "Shell expansion, redirection, executable syntax, or ambiguous composition requires review");
  const risks = segments.map((segment) => classifySegment(segment, workingDirectory));
  const highest = risks.find((risk) => risk.risk === "high") ?? risks.find((risk) => risk.risk === "medium") ?? risks[0]!;
  return { ...highest, readOnly: risks.every((risk) => risk.readOnly), autoApprove: risks.every((risk) => risk.autoApprove) };
}
