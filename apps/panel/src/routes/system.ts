import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  PANEL_VERSION,
  isNewerVersion,
  extractVersionString,
  type SystemVersionCheckResult,
  type SystemDeploymentMode,
  type SystemUpgradeResponse,
  type UpdatePanelSessionSettingsRequest
} from "@webops/shared";
import { loadCurrentUser } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { readPanelSessionSettings, savePanelSessionSettings } from "../session.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

let cachedCheck: { result: SystemVersionCheckResult; timestamp: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;
let upgradeInProgress = false;

function findProjectRootDir(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), "..")
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
  }
  return process.cwd();
}

function getSystemDeploymentMode(rootDir: string): SystemDeploymentMode {
  const override = process.env.SAKI_UPDATE_MODE?.trim().toLowerCase();
  if (override === "git") return "git";
  if (override === "release" || override === "binary") return "release";

  const hasGit = fs.existsSync(path.join(rootDir, ".git"));
  if (process.env.SAKI_IS_EXECUTABLE === "1" && !hasGit) {
    return "release";
  }

  if (hasGit) {
    return "git";
  }

  return "release";
}

async function checkGitUpdate(rootDir: string): Promise<{
  hasUpdate: boolean;
  commitsBehind: number;
  currentCommit?: string | undefined;
  remoteCommit?: string | undefined;
}> {
  try {
    const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: rootDir,
      timeout: 5000,
      encoding: "utf8"
    });
    const branch = branchOut.trim() || "main";

    const { stdout: headOut } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: rootDir,
      timeout: 5000,
      encoding: "utf8"
    });
    const currentCommit = headOut.trim();

    try {
      await execFileAsync("git", ["fetch", "origin", branch], {
        cwd: rootDir,
        timeout: 10000,
        encoding: "utf8"
      });
    } catch {
      try {
        await execFileAsync("git", ["fetch"], {
          cwd: rootDir,
          timeout: 10000,
          encoding: "utf8"
        });
      } catch {
        // network issue or offline
      }
    }

    let commitsBehind = 0;
    let remoteCommit: string | undefined;

    try {
      const { stdout: countOut } = await execFileAsync("git", ["rev-list", `HEAD..origin/${branch}`, "--count"], {
        cwd: rootDir,
        timeout: 5000,
        encoding: "utf8"
      });
      commitsBehind = parseInt(countOut.trim(), 10) || 0;
    } catch {
      try {
        const { stdout: countOut } = await execFileAsync("git", ["rev-list", "HEAD..@{u}", "--count"], {
          cwd: rootDir,
          timeout: 5000,
          encoding: "utf8"
        });
        commitsBehind = parseInt(countOut.trim(), 10) || 0;
      } catch {
        // count failed
      }
    }

    if (commitsBehind > 0) {
      try {
        const { stdout: remoteOut } = await execFileAsync("git", ["rev-parse", `origin/${branch}`], {
          cwd: rootDir,
          timeout: 5000,
          encoding: "utf8"
        });
        remoteCommit = remoteOut.trim();
      } catch {
        // ignore
      }
      return {
        hasUpdate: true,
        commitsBehind,
        currentCommit,
        remoteCommit
      };
    }

    return {
      hasUpdate: false,
      commitsBehind: 0,
      currentCommit
    };
  } catch {
    return {
      hasUpdate: false,
      commitsBehind: 0
    };
  }
}

async function executeUpgrade(rootDir: string): Promise<{ pullOutput: string; buildOutput: string }> {
  // Step 1: git pull
  const { stdout: pullOut, stderr: pullErr } = await execAsync("git pull", {
    cwd: rootDir,
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
    encoding: "utf8"
  });
  const pullCombined = [pullOut, pullErr].filter(Boolean).join("\n").trim();

  // Step 2: npm run build
  const { stdout: buildOut, stderr: buildErr } = await execAsync("npm run build", {
    cwd: rootDir,
    timeout: 300000,
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8"
  });
  const buildCombined = [buildOut, buildErr].filter(Boolean).join("\n").trim();

  return {
    pullOutput: pullCombined,
    buildOutput: buildCombined
  };
}

async function fetchLatestReleaseInfo(): Promise<{
  latestVersion: string;
  releaseUrl: string;
  releaseNotes?: string | undefined;
  publishedAt?: string | undefined;
}> {
  const sources = [
    "https://api.github.com/repos/EthanChan050430/Saki-Panel/releases/latest",
    "https://api.github.com/repos/EthanChan050430/Saki-Panel/releases?per_page=1",
    "https://api.github.com/repos/EthanChan050430/Saki-Panel/tags?per_page=1"
  ];

  for (const url of sources) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": `Saki-Panel/${PANEL_VERSION}`
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const data = await res.json();
      if (!data) continue;

      if (Array.isArray(data)) {
        if (data.length === 0) continue;
        const item = data[0] as { tag_name?: string; name?: string; html_url?: string; body?: string; published_at?: string };
        const rawVersion = item.tag_name || item.name || "";
        const version = extractVersionString(rawVersion) || rawVersion;
        if (version) {
          const normalized = version.startsWith("v") || version.startsWith("V") ? version : `v${version}`;
          return {
            latestVersion: normalized,
            releaseUrl: item.html_url || `https://github.com/EthanChan050430/Saki-Panel/releases/tag/${normalized}`,
            releaseNotes: item.body || undefined,
            publishedAt: item.published_at || undefined
          };
        }
      } else if (typeof data === "object" && data !== null) {
        const payload = data as { tag_name?: string; name?: string; html_url?: string; body?: string; published_at?: string };
        const rawVersion = payload.tag_name || payload.name || "";
        const version = extractVersionString(rawVersion) || rawVersion;
        if (version) {
          const normalized = version.startsWith("v") || version.startsWith("V") ? version : `v${version}`;
          return {
            latestVersion: normalized,
            releaseUrl: payload.html_url || `https://github.com/EthanChan050430/Saki-Panel/releases/tag/${normalized}`,
            releaseNotes: payload.body || undefined,
            publishedAt: payload.published_at || undefined
          };
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback: Check package.json from raw repository if GitHub API is blocked/rate-limited
  const rawSources = [
    "https://raw.githubusercontent.com/EthanChan050430/Saki-Panel/main/package.json",
    "https://mirror.ghproxy.com/https://raw.githubusercontent.com/EthanChan050430/Saki-Panel/main/package.json"
  ];

  for (const url of rawSources) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const pkg = await res.json() as { version?: string };
        if (pkg.version) {
          const normalized = `v${pkg.version}`;
          return {
            latestVersion: normalized,
            releaseUrl: "https://github.com/EthanChan050430/Saki-Panel/releases"
          };
        }
      }
    } catch {
      continue;
    }
  }

  throw new Error("Unable to fetch update information from GitHub or mirrors");
}

function errorStatus(error: unknown): number {
  return typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
}

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/system/time", async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      timezoneOffset: now.getTimezoneOffset()
    };
  });

  app.get("/api/system/session-settings", { preHandler: app.authenticate }, async () => {
    return readPanelSessionSettings();
  });

  app.get("/api/system/check-update", async (request, reply) => {
    const query = request.query as Record<string, string> | undefined;
    const force = query?.force === "true" || query?.force === "1";
    const now = Date.now();

    if (!force && cachedCheck && now - cachedCheck.timestamp < CACHE_TTL_MS) {
      return cachedCheck.result;
    }

    const rootDir = findProjectRootDir();
    const mode = getSystemDeploymentMode(rootDir);

    if (mode === "git") {
      try {
        const gitInfo = await checkGitUpdate(rootDir);
        let infoLatest: { latestVersion: string; releaseUrl: string; releaseNotes?: string | undefined; publishedAt?: string | undefined } | null = null;
        try {
          infoLatest = await fetchLatestReleaseInfo();
        } catch {
          // ignore remote release lookup failure in git mode
        }

        const currentVersion = `v${PANEL_VERSION}`;
        const latestVersion = infoLatest?.latestVersion || currentVersion;
        const versionHasUpdate = infoLatest ? isNewerVersion(infoLatest.latestVersion, currentVersion) : false;
        const hasUpdate = gitInfo.hasUpdate || versionHasUpdate;

        const result: SystemVersionCheckResult = {
          currentVersion,
          latestVersion,
          hasUpdate,
          releaseUrl: infoLatest?.releaseUrl || "https://github.com/EthanChan050430/Saki-Panel/releases",
          releaseNotes: infoLatest?.releaseNotes,
          publishedAt: infoLatest?.publishedAt,
          checkedAt: new Date().toISOString(),
          mode: "git",
          commitsBehind: gitInfo.commitsBehind,
          currentCommit: gitInfo.currentCommit,
          remoteCommit: gitInfo.remoteCommit
        };
        cachedCheck = { result, timestamp: now };
        return result;
      } catch (error) {
        if (cachedCheck) {
          return cachedCheck.result;
        }
        reply.code(502).send({
          message: error instanceof Error ? error.message : "Failed to check Git repository updates"
        });
        return;
      }
    }

    // Release executable mode
    try {
      const info = await fetchLatestReleaseInfo();
      const currentVersion = `v${PANEL_VERSION}`;
      const hasUpdate = isNewerVersion(info.latestVersion, currentVersion);
      const result: SystemVersionCheckResult = {
        currentVersion,
        latestVersion: info.latestVersion,
        hasUpdate,
        releaseUrl: info.releaseUrl,
        releaseNotes: info.releaseNotes,
        publishedAt: info.publishedAt,
        checkedAt: new Date().toISOString(),
        mode: "release"
      };
      cachedCheck = { result, timestamp: now };
      return result;
    } catch (error) {
      if (cachedCheck) {
        return cachedCheck.result;
      }
      reply.code(502).send({
        message: error instanceof Error ? error.message : "Failed to fetch version updates"
      });
    }
  });

  app.post("/api/system/upgrade-code", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user || user.status !== "ACTIVE" || !user.isAdmin) {
      reply.code(403).send({ message: "Administrator privileges are required to update and build system code" });
      return;
    }

    const rootDir = findProjectRootDir();
    const mode = getSystemDeploymentMode(rootDir);
    if (mode !== "git") {
      reply.code(400).send({
        message: "This instance is running as a precompiled executable. Please download releases directly."
      });
      return;
    }

    if (upgradeInProgress) {
      reply.code(409).send({ message: "System update is already in progress" });
      return;
    }

    upgradeInProgress = true;
    try {
      const { pullOutput, buildOutput } = await executeUpgrade(rootDir);
      cachedCheck = null;

      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "system.upgrade_code",
        resourceType: "system",
        payload: {
          pullOutput: pullOutput.slice(-1000),
          buildOutput: buildOutput.slice(-1000)
        }
      });

      const response: SystemUpgradeResponse = {
        success: true,
        message: "代码已更新并完成构建！请刷新页面以生效。",
        pullOutput,
        buildOutput
      };
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      reply.code(500).send({
        success: false,
        message: `更新构建失败: ${errorMessage}`,
        error: errorMessage
      });
    } finally {
      upgradeInProgress = false;
    }
  });

  app.put("/api/system/session-settings", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user || user.status !== "ACTIVE" || !user.isAdmin) {
      reply.code(403).send({ message: "Administrator privileges are required" });
      return;
    }

    try {
      const body = (request.body ?? {}) as UpdatePanelSessionSettingsRequest;
      if ((body.registrationIdentity === "admin" || body.registrationIdentity === "super_admin") && !user.isSuperAdmin) {
        reply.code(403).send({ message: "Super administrator privileges are required to set elevated registration identity" });
        return;
      }
      const saved = await savePanelSessionSettings(body);
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "system.session_settings.update",
        resourceType: "system",
        payload: {
          sessionTimeoutMinutes: saved.sessionTimeoutMinutes,
          registrationIdentity: saved.registrationIdentity
        }
      });
      return saved;
    } catch (error) {
      reply.code(errorStatus(error)).send({
        message: error instanceof Error ? error.message : "Session settings update failed"
      });
    }
  });
}
