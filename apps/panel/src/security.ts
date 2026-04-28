import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

export function verifyToken(token: string, hash: string): boolean {
  return safeEqual(hashToken(token), hash);
}

const dangerousCommandPatterns: RegExp[] = [
  /\brm\s+-rf\s+(\/|\*|~)/i,
  /\bdel\s+\/[sq]\b/i,
  /\brmdir\s+\/[sq]\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(\.| )/i,
  /\bdd\s+if=.*\s+of=\/dev\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
  /\breg\s+delete\b/i,
  /\bnet\s+user\s+.*\s+\/delete\b/i
];

const approvalCommandPatterns: RegExp[] = [
  /\b(?:rm|del|rmdir|erase)\b/i,
  /\b(?:mv|move|cp|copy)\b/i,
  /\b(?:chmod|chown|icacls|takeown)\b/i,
  /\b(?:kill|pkill|taskkill)\b/i,
  /\b(?:docker|docker-compose|podman|kubectl|systemctl|service|pm2)\b/i,
  /\b(?:npm|pnpm|yarn|pip|pip3|cargo|go|mvn|gradle)\s+(?:install|add|remove|uninstall|update|upgrade|publish|deploy)\b/i,
  /\bgit\s+(?:reset|clean|checkout|switch|restore|rebase|push|tag|branch\s+-d|branch\s+-D)\b/i,
  /(?:^|[^>])>{1,2}[^>]/,
  /\|\s*(?:sh|bash|cmd|powershell|pwsh)\b/i
];

export function findDangerousCommandReason(command: string): string | null {
  const normalized = command.replace(/\s+/g, " ").trim();
  for (const pattern of dangerousCommandPatterns) {
    if (pattern.test(normalized)) {
      return "Command was blocked by the panel safety policy";
    }
  }
  return null;
}

export function classifyCommandRisk(command: string): { risk: "low" | "medium" | "high" | "critical"; reason: string } {
  const blocked = findDangerousCommandReason(command);
  if (blocked) {
    return { risk: "critical", reason: blocked };
  }

  const normalized = command.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { risk: "critical", reason: "Command is required" };
  }
  if (normalized.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(command)) {
    return { risk: "critical", reason: "Command was blocked by the panel safety policy" };
  }
  if (approvalCommandPatterns.some((pattern) => pattern.test(normalized))) {
    return { risk: "high", reason: "Command can modify files, packages, processes, services, or deployment state" };
  }
  if (/[;&|`$()]/.test(normalized)) {
    return { risk: "medium", reason: "Command uses shell composition and should be reviewed" };
  }
  return { risk: "low", reason: "Read-only or low-risk command" };
}
