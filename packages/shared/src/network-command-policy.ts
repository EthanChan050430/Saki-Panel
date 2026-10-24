import type { CommandRisk } from "./command-policy.js";
import { isAbsolutePathInsideWorkspace, isSensitiveWorkspacePath } from "./workspace-path.js";

/** Expose attached output paths to the separate, mandatory workspace boundary check. */
export function networkCommandPathArguments(executable: string, args: string[]): string[] {
  const curl = executable === "curl";
  const shortValues = curl ? "oDmAXHKuexbFcCT" : "OPTtUoeia";
  const longPaths = new Set(curl
    ? ["--output", "--dump-header", "--config", "--upload-file", "--cookie-jar", "--cacert", "--cert", "--key"]
    : ["--output-document", "--directory-prefix", "--output-file", "--append-output", "--input-file", "--config", "--load-cookies", "--save-cookies"]);
  const paths: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith("--")) {
      const [option] = arg.split("=");
      if (longPaths.has(option!)) {
        const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++index];
        if (value && value !== "-") paths.push(value);
      } else paths.push(arg);
    } else if (arg.startsWith("-") && arg !== "-") {
      for (let offset = 1; offset < arg.length; offset++) {
        const flag = arg[offset]!;
        if (!shortValues.includes(flag)) continue;
        const value = arg.slice(offset + 1) || args[++index];
        if (value && value !== "-") paths.push(value);
        break;
      }
    } else paths.push(arg);
  }
  return paths;
}

/** Recognize download options by their actual argument roles, including bundled short flags. */
export function classifyNetworkCommand(executable: string, args: string[], workingDirectory?: string): CommandRisk {
  const high = (reason: string): CommandRisk => ({ risk: "high", reason, readOnly: false, autoApprove: false });
  if (args.length === 1 && ["--version", "--help", "-V", "-h"].includes(args[0]!)) {
    return { risk: "low", reason: "Download tool version/help inspection", readOnly: true, autoApprove: true };
  }
  const curl = executable === "curl";
  const booleans = new Set(curl
    ? ["--fail", "--fail-with-body", "--silent", "--show-error", "--location", "--head", "--compressed", "--remote-name", "--no-progress-meter", "--disable", "--ipv4", "--ipv6"]
    : ["--quiet", "--verbose", "--no-verbose", "--continue", "--timestamping", "--server-response", "--spider", "--no-config", "--ipv4-only", "--ipv6-only"]);
  const values: Record<string, "output" | "number" | "text" | "method" | "header" | "url"> = curl
    ? { "--output": "output", "--dump-header": "output", "--max-time": "number", "--connect-timeout": "number", "--retry": "number", "--retry-delay": "number", "--user-agent": "text", "--request": "method", "--header": "header", "--url": "url" }
    : { "--output-document": "output", "--directory-prefix": "output", "--timeout": "number", "--connect-timeout": "number", "--read-timeout": "number", "--tries": "number", "--waitretry": "number", "--user-agent": "text", "--header": "header" };
  const short: Record<string, string> = curl
    ? { f: "--fail", s: "--silent", S: "--show-error", L: "--location", I: "--head", O: "--remote-name", q: "--disable", "4": "--ipv4", "6": "--ipv6", o: "--output", D: "--dump-header", m: "--max-time", A: "--user-agent", X: "--request", H: "--header" }
    : { q: "--quiet", v: "--verbose", c: "--continue", N: "--timestamping", S: "--server-response", "4": "--ipv4-only", "6": "--ipv6-only", O: "--output-document", P: "--directory-prefix", T: "--timeout", t: "--tries", U: "--user-agent" };
  let writes = false, spider = false, stdout = false, remoteName = false;
  const urls: URL[] = [];
  const safeOutput = (value: string) => !value.startsWith("-") && !/[*?\[\]]/.test(value)
    && !value.replace(/\\/g, "/").split("/").includes("..") && !isSensitiveWorkspacePath(value)
    && (!/^(?:[a-z]:|[\\/]|~)/i.test(value) || isAbsolutePathInsideWorkspace(value, workingDirectory));
  const checkUrl = (value: string) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || [...url.searchParams.keys()].some((key) => /^(?:access[_-]?token|api[_-]?key|token|key|secret|password|signature|credential|x-amz-credential|x-amz-signature)$/i.test(key))) return false;
      urls.push(url);
      return true;
    } catch { return false; }
  };
  const consume = (option: string, value?: string): boolean => {
    if (booleans.has(option)) {
      if (value !== undefined) return false;
      if (option === "--remote-name") { writes = true; remoteName = true; }
      if (option === "--spider") spider = true;
      return true;
    }
    const kind = values[option];
    if (!kind || !value) return false;
    if (kind === "url") return checkUrl(value);
    if (kind === "number") return /^\d+(?:\.\d+)?$/.test(value);
    if (kind === "method") return ["GET", "HEAD"].includes(value.toUpperCase());
    if (kind === "header") return /^(?:Accept|Accept-Language|User-Agent|Content-Type):[^\r\n]*$/i.test(value);
    if (kind === "output") {
      if (value === "-" && option !== "--directory-prefix") { stdout = true; return true; }
      if (!safeOutput(value)) return false;
      writes = true;
    }
    return !/[\r\n]/.test(value);
  };
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!positional && arg === "--") { positional = true; continue; }
    if (positional || !arg.startsWith("-")) {
      if (!checkUrl(arg)) return high("Download URL or credentials require review");
    } else if (!curl && arg === "-nv") {
      continue;
    } else if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const option = equals < 0 ? arg : arg.slice(0, equals);
      const value = equals >= 0 ? arg.slice(equals + 1) : values[option] ? args[++index] : undefined;
      if (!consume(option, value)) return high("Download option, output path, upload or authentication requires review");
    } else {
      for (let offset = 1; offset < arg.length; offset++) {
        const option = short[arg[offset]!] ?? "";
        const value = values[option] ? arg.slice(offset + 1) || args[++index] : undefined;
        if (!consume(option, value)) return high("Download option, output path, upload or authentication requires review");
        if (values[option]) break;
      }
    }
  }
  if (!urls.length) return high("Download requires an HTTP or HTTPS URL");
  if (remoteName || (!curl && !stdout && !spider)) {
    for (const url of urls) {
      try {
        if (!safeOutput(decodeURIComponent(url.pathname.split("/").pop() || "index.html"))) return high("Download filename requires review");
      } catch { return high("Download filename requires review"); }
    }
  }
  return { risk: "medium", reason: "HTTP download or web inspection; request approval mode asks before terminal network access", readOnly: !writes && (curl || spider || stdout), autoApprove: true };
}
