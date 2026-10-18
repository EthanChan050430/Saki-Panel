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

export function findDangerousCommandReason(command: string, workingDirectory?: string, posixShell = false): string | null {
  const matches = (text: string) => dangerousCommandPatterns.some((pattern) => pattern.test(text.replace(/\s+/g, " ").trim()));
  if (!matches(command)) return null;
  const segments = splitCommands(posixShell ? commandWithoutNullOutputRedirects(command) : command.trim(), posixShell);
  if (segments && segments.every((tokens) => classifySegment(tokens, workingDirectory).readOnly || !matches(tokens.join(" ")))) return null;
  return "Command was blocked by the panel safety policy";
}

function result(risk: CommandRisk["risk"], reason: string, readOnly = false, autoApprove = false): CommandRisk {
  return { risk, reason, readOnly, autoApprove };
}

export function commandWithoutNullOutputRedirects(command: string): string {
  let result = "";
  let quote = "";
  for (let index = 0; index < command.length;) {
    const char = command[index]!;
    if (quote) {
      result += char;
      if (char === "\\" && quote === '"' && index + 1 < command.length) {
        result += command[index + 1]!;
        index += 2;
        continue;
      }
      if (char === quote) quote = "";
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      result += char;
      index++;
      continue;
    }
    if (char === "\\") {
      result += command.slice(index, index + 2);
      index += 2;
      continue;
    }
    const boundary = index === 0 || /[\s;&|]/.test(command[index - 1]!);
    const rest = command.slice(index);
    const redirected = (boundary
      ? /^(?:[12]?>>?|&>>?)[ \t]*(?:\/dev\/null|'\/dev\/null'|"\/dev\/null")(?=$|[\s;&|])/
      : /^>>?[ \t]*(?:\/dev\/null|'\/dev\/null'|"\/dev\/null")(?=$|[\s;&|])/).exec(rest);
    const merged = boundary ? /^2>&1(?=$|[\s;&|])/.exec(rest) : null;
    const match = char === ">" && command[index - 1] === "<" ? null : redirected ?? merged;
    if (match) {
      result += " ";
      index += match[0].length;
    } else {
      result += char;
      index++;
    }
  }
  return result;
}

interface CommandTokens extends Array<string> { unquotedGlobs?: Set<number> }

function splitCommands(command: string, posixShell = false): CommandTokens[] | null {
  const segments: CommandTokens[] = [];
  let tokens: CommandTokens = [];
  let token = "";
  let tokenStarted = false;
  let unquotedGlob = false;
  let quote = "";
  const flushToken = () => {
    if (tokenStarted && unquotedGlob) (tokens.unquotedGlobs ??= new Set()).add(tokens.length);
    if (tokenStarted) tokens.push(token);
    token = "";
    tokenStarted = false;
    unquotedGlob = false;
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
    if (!(posixShell && quote === "'") && (/[`%^!]/.test(char) || (char === "$" && quote !== "'"))) return null;
    if (quote) {
      // cmd.exe does not treat single quotes as quoting. Keep metacharacters
      // conservative even inside quotes rather than assume the remote shell.
      if (!posixShell && /[;&|<>\r\n]/.test(char)) return null;
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
      if (/[*?\[\]]/.test(char)) unquotedGlob = true;
      token += char;
      tokenStarted = true;
    }
  }
  if (quote || !flushSegment()) return null;
  return segments;
}

const readCommands = new Set([
  "pwd", "ls", "dir", "cat", "type", "head", "tail", "rg", "grep", "find", "findstr", "stat", "wc", "which", "where", "whoami",
  "get-location", "get-childitem", "gci", "get-content", "gc", "get-item", "get-filehash", "select-string", "select-object",
  "measure-object", "format-list", "format-table", "out-string", "hostname", "uname", "cut",
  "ps", "df", "du", "free", "uptime", "lscpu", "lsblk", "vmstat", "id", "who", "ss", "netstat",
  "get-process", "get-service", "get-date", "get-computerinfo"
]);
const windowsReadSwitches: Record<string, Set<string>> = {
  dir: new Set(["/a", "/a:d", "/a:-d", "/b", "/s", "/o", "/o:n", "/o:-n", "/o:d", "/o:-d", "/o:s", "/o:-s", "/q", "/n", "/w", "/d", "/t:w", "/t:c", "/t:a", "/-c"]),
  findstr: new Set(["/b", "/e", "/l", "/r", "/s", "/i", "/x", "/v", "/n", "/m", "/o", "/p"]),
  where: new Set(["/r", "/q", "/f", "/t"])
};
const projectCommands = new Set(["tsc", "eslint", "prettier", "vitest", "jest", "pytest", "ruff"]);
const projectScripts = /^(?:build|check|typecheck|type-check|lint|test|format|dev|start)(?::[\w.-]+)?$/i;
const packageManagers = new Set(["npm", "pnpm", "yarn", "pip", "pip3", "uv"]);
const socketReadOptions = new Set(["--all", "--listening", "--tcp", "--udp", "--unix", "--raw", "--numeric", "--processes", "--summary", "--memory", "--info", "--ipv4", "--ipv6", "--extended", "--oneline", "--no-header", "--options", "--version", "--help", "--timer", "--cgroup", "--events", "--sctp", "--packet", "--vsock"]);
const sortReadOptions = new Set(["--reverse", "--numeric-sort", "--general-numeric-sort", "--human-numeric-sort", "--version-sort", "--month-sort", "--check", "--unique", "--stable", "--ignore-case", "--dictionary-order", "--ignore-leading-blanks", "--ignore-nonprinting", "--merge", "--zero-terminated", "--key", "--field-separator", "--parallel", "--buffer-size", "--help", "--version"]);

function commandPathArguments(tokens: CommandTokens): string[] {
  const executable = tokens[0]!.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");
  const args = tokens.slice(1);
  if (["echo", "write-output"].includes(executable)) return tokens.filter((_, index) => index === 0 || tokens.unquotedGlobs?.has(index));
  const candidates = [tokens[0]!];
  const positional: Array<{ index: number; glob: boolean }> = [];
  let explicitPattern = false;
  let noPattern = false;
  let optionsEnded = false;
  let positionalPatternKnown = true;
  const preserveExpansion = (index: number, value: string | undefined) => {
    if (value !== undefined && tokens.unquotedGlobs?.has(index + 1)) candidates.push(value);
  };
  const search = executable === "rg" || executable === "grep";
  const textOptions = new Set(search ? ["-e", "--regexp", "-A", "-B", "-C", "-m", "--after-context", "--before-context", "--context", "--max-count",
    ...(executable === "rg" ? ["-g", "--glob", "--iglob", "-t", "-T", "--type", "--type-not", "--type-add", "--type-clear", "-r", "--replace", "-E", "--encoding", "-j", "--threads", "-M", "--max-columns", "--color", "--colors", "--sort", "--sortr", "--max-depth", "--max-filesize", "--path-separator"]
      : ["--include", "--exclude", "--exclude-dir", "--label", "-d", "--directories", "-D", "--devices", "--binary-files"])] : []);
  const fileOptions = new Set(search ? ["-f", "--file", ...(executable === "rg" ? ["--ignore-file"] : ["--exclude-from"])] : []);
  const booleanShortOptions = executable === "rg" ? "nNivwxlLcHhFoqaSsuUPzbI0123456789" : "nNivwxlLcHhFoqaIsUVrREGPzbZ0123456789";
  const booleanLongOptions = new Set(["--line-number", "--no-line-number", "--ignore-case", "--case-sensitive", "--smart-case", "--word-regexp", "--line-regexp", "--invert-match", "--fixed-strings", "--extended-regexp", "--basic-regexp", "--perl-regexp", "--pcre2", "--count", "--count-matches", "--files-with-matches", "--files-without-match", "--only-matching", "--quiet", "--silent", "--no-messages", "--text", "--binary", "--with-filename", "--no-filename", "--null", "--null-data", "--recursive", "--dereference-recursive", "--hidden", "--no-ignore", "--follow", "--multiline", "--multiline-dotall", "--no-heading", "--heading", "--json", "--stats", "--files", "--type-list", "--help", "--version"]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const lower = arg.toLowerCase();
    if (!optionsEnded && windowsReadSwitches[executable]?.has(lower)) continue;
    if (!optionsEnded && arg === "--") { optionsEnded = true; continue; }
    if (search && !optionsEnded) {
      if (executable === "rg" && ["--files", "--type-list", "--help", "--version"].includes(arg)) noPattern = true;
      let option = arg.split("=")[0]!;
      let value = arg.includes("=") ? arg.slice(option.length + 1) : undefined;
      if (/^-[^-]/.test(arg)) {
        for (let offset = 1; offset < arg.length; offset++) {
          const shortOption = `-${arg[offset]}`;
          if (textOptions.has(shortOption) || fileOptions.has(shortOption)) {
            option = shortOption;
            value = arg.slice(offset + 1) || undefined;
            break;
          }
          if (!booleanShortOptions.includes(arg[offset]!)) { positionalPatternKnown = false; break; }
        }
      }
      if (textOptions.has(option) || fileOptions.has(option)) {
        value ??= args[++index];
        if (option === "-e" || option === "--regexp" || option === "-f" || option === "--file") explicitPattern = true;
        if (fileOptions.has(option) && value !== undefined) candidates.push(value);
        else preserveExpansion(index, value);
        continue;
      }
      if (arg.startsWith("--") && !booleanLongOptions.has(arg)) positionalPatternKnown = false;
    }
    if (executable === "findstr" && !optionsEnded) {
      if (/^\/c:/i.test(arg)) { explicitPattern = true; preserveExpansion(index, arg.slice(3)); continue; }
      if (/^\/[fgd]:/i.test(arg)) {
        if (/^\/g:/i.test(arg)) explicitPattern = true;
        candidates.push(...arg.slice(3).split(";"));
        continue;
      }
    }
    if (executable === "select-string" && !optionsEnded && ["-pattern", "-inputobject"].includes(lower)) {
      if (lower === "-pattern") explicitPattern = true;
      preserveExpansion(++index, args[index]);
      continue;
    }
    if (executable === "select-string" && !optionsEnded && ["-path", "-literalpath"].includes(lower)) {
      const value = args[++index];
      if (value !== undefined) candidates.push(value);
      continue;
    }
    if (executable === "select-string" && !optionsEnded && arg.startsWith("-")
      && !["-casesensitive", "-simplematch", "-allmatches", "-quiet", "-list", "-notmatch", "-noemphasis", "-raw"].includes(lower)) positionalPatternKnown = false;
    if (executable === "findstr" && !optionsEnded && arg.startsWith("/")) positionalPatternKnown = false;
    if (executable === "find" && /^-(?:i?(?:name|path|regex|lname)|printf)$/.test(arg)) { preserveExpansion(++index, args[index]); continue; }
    if (!arg.startsWith("-") || optionsEnded) positional.push({ index: candidates.length, glob: tokens.unquotedGlobs?.has(index + 1) ?? false });
    candidates.push(arg);
  }
  if ((search || executable === "findstr" || executable === "select-string") && !explicitPattern && !noPattern && positionalPatternKnown && positional.length) {
    if (!positional[0]!.glob) candidates.splice(positional[0]!.index, 1);
  }
  return candidates;
}

export function commandPathTokens(command: string, posixShell = false): string[] {
  const inspected = posixShell ? commandWithoutNullOutputRedirects(command) : command;
  const segments = splitCommands(inspected.trim(), posixShell);
  if (segments) return segments.flatMap(commandPathArguments);
  return (inspected.match(/"[^"]*"|'[^']*'|[^\s"'|&;<>()]+/g) ?? []).map((token) => token.replace(/^["']+|["']+$/g, ""));
}

function classifySegment(tokens: string[], workingDirectory?: string): CommandRisk {
  // A path-qualified binary may be a local executable with the name of a trusted utility.
  const executable = tokens[0]!.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "");
  const args = tokens.slice(1);
  const lower = args.map((arg) => arg.toLowerCase());
  const pathArguments = commandPathArguments(tokens);
  const inspectedArgs = pathArguments.slice(1).map((arg) => arg.toLowerCase());
  const verb = lower[0] ?? "";
  if (executable === "find" && inspectedArgs.some((arg) => /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)(?:=|$)/.test(arg))) {
    return result("high", "Find actions can execute commands, delete files, or write output files");
  }
  if (executable === "ss" && args.some((arg) => /^-[^-]*[KD]/.test(arg) || (arg.startsWith("--") && !socketReadOptions.has(arg)))) {
    return result("high", "Socket options can terminate connections or write diagnostic files");
  }
  if (executable === "sort" && args.some((arg) => /^-(?!-)\S*o/.test(arg) || (arg.startsWith("--") && !sortReadOptions.has(arg.split("=")[0]!)))) {
    return result("high", "Sort output options can overwrite a file");
  }
  if ((packageManagers.has(executable) || executable === "npx") && lower.some((arg) => /^(?:-g|--global|--prefix|--user|--target|--root|--registry|--index-url|--extra-index-url)(?:=|$)/.test(arg))) {
    return result("high", "Package command changes global/external locations or registry settings");
  }
  if (/^(?:sudo|su|doas|runas|remove-item|ri|rm|del|erase|rmdir|rd|move-item|copy-item|mv|move|cp|copy|chmod|chown|icacls|takeown|kill|pkill|taskkill|stop-process|stop-computer|restart-computer|set-executionpolicy|reg|net|docker|docker-compose|podman|kubectl|systemctl|service|pm2|ssh|scp|sftp|rsync)$/i.test(executable)) {
    return result("high", "Command can delete data, change permissions, affect processes/services, or access another machine");
  }
  if (executable === "git" && ["--no-pager", "-C"].includes(args[0] ?? "")) {
    if (args[0] === "--no-pager") return classifySegment(["git", ...args.slice(1)], workingDirectory);
    const directory = args[1];
    if (!directory || classifySegment(["cd", directory], workingDirectory).risk !== "low") return result("high", "Git directory must stay inside the workspace");
    return classifySegment(["git", ...args.slice(2)], workingDirectory);
  }
  if (executable === "git" && !["status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse", "branch", "--version"].includes(verb)) {
    return result("high", "Git command can change history, workspace contents, configuration, or remote state");
  }
  if (executable === "git" && (lower.some((arg) => /^(?:--output(?:=|$)|--ext-diff$|--textconv$|--no-index$|-c$)/.test(arg)) || (verb === "branch" && args.length > 1 && !lower.slice(1).every((arg) => ["--list", "-l", "-a", "--all", "-r", "--remotes", "--show-current", "-v", "-vv"].includes(arg))))) {
    return result("high", "Git options can write files, execute external helpers, or change branches");
  }
  if (inspectedArgs.some((arg) => /^(?:--pre(?:=|$)|--hostname-bin(?:=|$)|--config(?:=|$)|--exec(?:=|$)|--eval(?:=|$))/.test(arg)) && !projectCommands.has(executable) && !packageManagers.has(executable)) {
    return result("high", "Command options may execute a helper, load executable configuration, or send data");
  }
  const pathValue = (token: string) => token.replace(/^--?[\w-]+[:=]/, "");
  if (pathArguments.slice(1).some((arg) => /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|credentials|id_rsa|id_ed25519)(?:$|[\\/])|\.(?:pem|pfx|key)$/i.test(pathValue(arg)))) {
    return result("high", "Command may access credentials or other sensitive files");
  }
  const external = pathArguments.find((token) => {
    const value = pathValue(token);
    if (windowsReadSwitches[executable]?.has(token.toLowerCase())) return false;
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
  if (!readCommands.has(executable) && args.some((arg) => /^(?:ftp|file|ssh|git\+\w+):|^https?:\/\//i.test(arg))) {
    // Only a plain, unauthenticated HTTP GET is eligible for automatic risk review.
    if (executable === "curl" && args.filter((arg) => !arg.startsWith("-")).length === 1 && args.every((arg) => /^https?:\/\//i.test(arg) || ["-f", "-s", "-sS", "-fsSL", "-fsS", "-L", "--fail", "--silent", "--show-error", "--location", "-I", "--head"].includes(arg)) && !args.some((arg) => /https?:\/\/[^/]*@|[?&](?:token|key|secret|password)=/i.test(arg))) {
      return result("medium", "Command makes an unauthenticated web request; request approval mode asks before terminal network access", false, true);
    }
    return result("high", "Command uses a remote URL, upload, custom registry, or downloaded executable content");
  }
  if (readCommands.has(executable)) return result("low", "Workspace inspection command", true, true);
  if (executable === "sort") return result("low", "Sorts text to standard output without writing a file", true, true);
  if (executable === "sed") {
    const expressionIndex = ["-e", "--expression"].includes(args[1] ?? "") ? 2 : 1;
    if (["-n", "--quiet", "--silent"].includes(args[0] ?? "") && /^\d+(?:,(?:\d+|\$))?p$/.test(args[expressionIndex] ?? "")
      && args.slice(expressionIndex + 1).every((arg) => !arg.startsWith("-"))) {
      return result("low", "Prints a line range from a workspace file without editing it", true, true);
    }
    return result("high", "Sed scripts other than a simple read-only line range require review");
  }
  if (executable === "git") return result("low", "Read-only Git inspection", true, true);
  if (executable === "echo" || executable === "write-output") return result("low", "Prints literal output", true, true);
  if (projectCommands.has(executable)) return result("low", "Common workspace check, test, or formatter", false, true);
  if (executable === "npx") {
    if (verb === "--no-install" && projectCommands.has(lower[1] ?? "")) return result("low", "Runs an installed workspace check/test tool without downloading it", false, true);
    if (projectCommands.has(verb)) return result("medium", "Runs a standard check/test package and may download it from the configured registry", false, true);
  }
  if (args.length === 1 && ["node", "python", "python3", "ruby", "go", "cargo", "dotnet", "java"].includes(executable) && (["--version", "-V", "version", "-version", "--help"].includes(args[0] ?? "") || (executable === "node" && verb === "-v"))) {
    return result("low", "Runtime version inspection", true, true);
  }
  if (executable === "node" && ["--check", "-c"].includes(verb) && args.length === 2 && !args[1]!.startsWith("-")) return result("low", "Checks JavaScript syntax in a workspace file", true, true);
  if (["python", "python3"].includes(executable) && verb === "-m" && ["pytest", "unittest", "compileall", "ruff"].includes(lower[1] ?? "")) return result("low", "Workspace Python checks/tests", false, true);
  if ((executable === "cargo" && ["check", "build", "test", "fmt", "clippy"].includes(verb)) || (executable === "go" && ["build", "test", "vet", "fmt"].includes(verb)) || (executable === "dotnet" && ["build", "test", "format"].includes(verb))) return result("low", "Common workspace build or test", false, true);
  if (packageManagers.has(executable)) {
    if (["--version", "-v"].includes(verb) || ["list", "ls", "why"].includes(verb)) return result("low", "Local package inspection", true, true);
    if (["npm", "pnpm", "yarn"].includes(executable) && verb === "run" && args.length === 1) return result("low", "Lists available workspace scripts without executing them", true, true);
    if (["npm", "pnpm", "yarn"].includes(executable) && ((verb === "run" && projectScripts.test(args[1] ?? "")) || projectScripts.test(verb))) return result("low", "Common workspace build, test, or development script", false, true);
    if (["npm", "pnpm", "yarn"].includes(executable) && ["install", "ci", "add"].includes(verb) && args.slice(1).every((arg) => ["--save", "--save-dev", "-D", "--no-audit", "--no-fund", "--ignore-scripts", "--frozen-lockfile", "--immutable"].includes(arg) || /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9.^~*<>=|+-]+)?$/i.test(arg))) {
      return result("medium", "Installs workspace dependencies from the configured package registry; package lifecycle scripts may run", false, true);
    }
  }
  return result("high", "Unrecognized command or executable script requires review before execution");
}

export function isPosixCommandPlatform(os: string | null | undefined): boolean {
  return /^(?:linux|darwin|freebsd|openbsd|netbsd|sunos|aix)(?:\b|_)/i.test(os ?? "");
}

export function classifyCommandRisk(command: string, workingDirectory?: string, posixShell = false): CommandRisk {
  if (!command.trim()) return result("critical", "Command is required");
  const blocked = findDangerousCommandReason(command, workingDirectory, posixShell);
  if (blocked || command.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(command)) return result("critical", blocked ?? "Command was blocked by the panel safety policy");
  const segments = splitCommands(posixShell ? commandWithoutNullOutputRedirects(command) : command, posixShell);
  if (!segments) return result("high", "Shell expansion, redirection, executable syntax, or ambiguous composition requires review");
  const risks = segments.map((segment) => classifySegment(segment, workingDirectory));
  const highest = risks.find((risk) => risk.risk === "high") ?? risks.find((risk) => risk.risk === "medium") ?? risks[0]!;
  return { ...highest, readOnly: risks.every((risk) => risk.readOnly), autoApprove: risks.every((risk) => risk.autoApprove) };
}
