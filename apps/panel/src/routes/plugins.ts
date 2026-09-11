import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { loadCurrentUser } from "../auth.js";
import { pluginManager } from "../plugins/plugin-manager.js";
import { testAllMirrors } from "../plugins/github-mirror.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  // Public: active theme metadata so the login page can restyle before auth.
  app.get("/api/plugins/active-theme", async () => {
    const state = pluginManager.getState();
    const plugin = state.installed.find(
      (p) => p.id === state.activeThemeId && p.enabled && p.manifest.type === "theme"
    );
    const theme = plugin?.manifest.theme;
    if (!plugin || !theme?.css) {
      return { ok: true, theme: null };
    }
    return {
      ok: true,
      theme: {
        id: plugin.id,
        version: plugin.manifest.version,
        css: theme.css,
        htmlClass: theme.htmlClass,
        backgrounds: theme.backgrounds
      }
    };
  });

  app.get("/api/plugins", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    return {
      ok: true,
      state: pluginManager.getState()
    };
  });

  app.get("/api/plugins/registry", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    return {
      ok: true,
      items: await pluginManager.getCuratedRegistry()
    };
  });

  app.get("/api/plugins/:id/files", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    const { id } = request.params as { id: string };
    const files = pluginManager.listPluginFiles(id);
    return { ok: true, files };
  });

  app.post("/api/plugins/install", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!user.isAdmin) {
      reply.code(403).send({ message: "Only administrators can install plugins" });
      return;
    }

    const body = (request.body ?? {}) as {
      repoOrUrl?: string;
      mirrorId?: string;
      customMirrorUrl?: string;
      ref?: string;
      pluginName?: string;
    };

    if (!body.repoOrUrl) {
      reply.code(400).send({ message: "Missing repoOrUrl parameter" });
      return;
    }

    try {
      const plugins = await pluginManager.installFromGithub({
        repoOrUrl: body.repoOrUrl,
        mirrorId: body.mirrorId,
        customMirrorUrl: body.customMirrorUrl,
        ref: body.ref,
        pluginName: body.pluginName
      });
      return {
        ok: true,
        plugins,
        message: `成功安装插件: ${plugins.map((p) => p.manifest.displayName).join("、")}`
      };
    } catch (err) {
      reply.code(400).send({
        message: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.post("/api/plugins/:id/toggle", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!user.isAdmin) {
      reply.code(403).send({ message: "Only administrators can toggle plugins" });
      return;
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { enabled?: boolean };

    const plugin = pluginManager.togglePlugin(id, body.enabled);
    if (!plugin) {
      reply.code(404).send({ message: "Plugin not found" });
      return;
    }

    return {
      ok: true,
      plugin
    };
  });

  app.post("/api/plugins/:id/active", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { type: "theme" | "skin"; active: boolean };

    if (body.type === "theme") {
      const ok = pluginManager.setActiveTheme(body.active ? id : null);
      if (!ok) {
        reply.code(400).send({ message: "Failed to set active theme" });
        return;
      }
    } else if (body.type === "skin") {
      const ok = pluginManager.setActiveSkin(body.active ? id : null);
      if (!ok) {
        reply.code(400).send({ message: "Failed to set active skin" });
        return;
      }
    }

    return { ok: true, state: pluginManager.getState() };
  });

  app.delete("/api/plugins/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!user.isAdmin) {
      reply.code(403).send({ message: "Only administrators can uninstall plugins" });
      return;
    }

    const { id } = request.params as { id: string };
    const ok = pluginManager.uninstallPlugin(id);
    if (!ok) {
      reply.code(404).send({ message: "Plugin not found or deletion failed" });
      return;
    }

    return { ok: true, message: "Plugin successfully uninstalled" };
  });

  app.post("/api/plugins/mirror-test", { preHandler: [app.authenticate] }, async (request) => {
    const body = (request.body ?? {}) as { customMirrorUrl?: string };
    const results = await testAllMirrors(body.customMirrorUrl);
    return { ok: true, results };
  });

  app.post("/api/plugins/mirror-config", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!user.isAdmin) {
      reply.code(403).send({ message: "Only administrators can configure global mirrors" });
      return;
    }

    const body = (request.body ?? {}) as { mirrorId: string; customMirrorUrl?: string };
    if (!body.mirrorId) {
      reply.code(400).send({ message: "Missing mirrorId" });
      return;
    }

    pluginManager.setMirrorConfig(body.mirrorId, body.customMirrorUrl);
    return { ok: true, state: pluginManager.getState() };
  });

  app.post("/api/plugins/check-updates", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!user.isAdmin) {
      reply.code(403).send({ message: "Only administrators can check for updates" });
      return;
    }

    const body = (request.body ?? {}) as {
      ids?: string[];
      mirrorId?: string;
      customMirrorUrl?: string;
    };

    try {
      const statuses = await pluginManager.checkForUpdates(body.ids, {
        ...(body.mirrorId ? { mirrorId: body.mirrorId } : {}),
        ...(body.customMirrorUrl ? { customMirrorUrl: body.customMirrorUrl } : {})
      });
      return { ok: true, statuses };
    } catch (err) {
      reply.code(500).send({
        message: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.post("/api/plugins/:id/update", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user) {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    if (!user.isAdmin) {
      reply.code(403).send({ message: "Only administrators can update plugins" });
      return;
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { mirrorId?: string; customMirrorUrl?: string };

    try {
      const plugin = await pluginManager.updatePlugin(id, {
        ...(body.mirrorId ? { mirrorId: body.mirrorId } : {}),
        ...(body.customMirrorUrl ? { customMirrorUrl: body.customMirrorUrl } : {})
      });
      return {
        ok: true,
        plugin,
        message: `扩展「${plugin.manifest.displayName}」已更新至最新版本`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ message: msg });
    }
  });

  app.get("/api/plugins/:id/assets/*", async (request, reply) => {
    const { id } = request.params as { id: string };
    const wildcard = (request.params as { "*": string })["*"] ?? "";

    const filePath = pluginManager.getAssetPath(id, wildcard);
    if (!filePath) {
      reply.code(404).send({ message: "Plugin asset not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";

    reply.header("Cache-Control", "public, max-age=3600");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type(mime);

    // If HTML, set sandbox-friendly frame options
    if (ext === ".html") {
      reply.header("X-Frame-Options", "SAMEORIGIN");
    }

    return reply.send(fs.createReadStream(filePath));
  });
}
