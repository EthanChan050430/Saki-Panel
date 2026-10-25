import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { isAbsoluteCommandPathInsideWorkspace } from "./workspace-path.js";
import { commandPathTokens } from "./command-policy.js";
export { classifyCommandRisk, findDangerousCommandReason, isPosixCommandPlatform } from "./command-policy.js";

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

/**
 * Detects command tokens that could reach outside the instance working
 * directory. Absolute paths inside the target workspace are allowed.
 */
export function findCrossInstanceCommandEscape(command: string, workingDirectory?: string, posixShell = false, additionalWorkingDirectories: readonly string[] = []): string | null {
  const tokens = commandPathTokens(command, posixShell);
  for (const rawToken of tokens) {
    let token = rawToken.replace(/^["']+|["']+$/g, "");
    if (!token) continue;
    token = token.replace(/^--?[a-zA-Z0-9_-]+[:=]|^--?/, "");
    if ([workingDirectory, ...additionalWorkingDirectories].some(root => isAbsoluteCommandPathInsideWorkspace(token, root))) continue;
    if (/^[A-Za-z]:[\\/]/.test(token)) return rawToken;
    if (token.startsWith("\\\\")) return rawToken;
    if (token.startsWith("/") && (token.length > 3 || token.slice(1).includes("/") || token.includes("\\"))) return rawToken;
    if (token.startsWith("\\") && (token.length > 3 || token.slice(1).includes("\\") || token.includes("/"))) return rawToken;
    if (token === ".." || /(?:^|[\\/:])\.\.(?:[\\/]|$)/.test(token)) return rawToken;
  }
  return null;
}
