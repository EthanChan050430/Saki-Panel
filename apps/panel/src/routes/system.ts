import type { FastifyInstance } from "fastify";
import {
  PANEL_VERSION,
  isNewerVersion,
  extractVersionString,
  type SystemVersionCheckResult,
  type UpdatePanelSessionSettingsRequest
} from "@webops/shared";
import { loadCurrentUser } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { readPanelSessionSettings, savePanelSessionSettings } from "../session.js";

let cachedCheck: { result: SystemVersionCheckResult; timestamp: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

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
        checkedAt: new Date().toISOString()
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
