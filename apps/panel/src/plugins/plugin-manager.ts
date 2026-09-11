import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  InstalledPlugin,
  PluginRegistryItem,
  PluginStoreState,
  PluginUpdateStatus,
  SakiPluginManifest
} from "@webops/shared";
import {
  BUILTIN_GITHUB_MIRRORS,
  resolveMirrorUrl
} from "./github-mirror.js";
import { panelPaths } from "../config.js";

const execFileAsync = promisify(execFile);
const SAFE_PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const SAFE_GIT_REF = /^[A-Za-z0-9._/\-]+$/;

function isSafePluginId(id: string): boolean {
  return SAFE_PLUGIN_ID.test(id);
}

interface PluginSystemStore {
  installed: InstalledPlugin[];
  activeThemeId: string | null;
  activeSkinId: string | null;
  selectedMirrorId: string;
  customMirrorUrl?: string;
}

export class PluginManager {
  private baseDir: string;
  private stateFile: string;
  private store: PluginSystemStore = {
    installed: [],
    activeThemeId: null,
    activeSkinId: null,
    selectedMirrorId: "ghfast"
  };

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? panelPaths.pluginsDir;
    this.stateFile = path.join(this.baseDir, "plugins.json");
    this.ensureDir();
    this.loadState();
  }

  private ensureDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = fs.readFileSync(this.stateFile, "utf-8");
        const parsed = JSON.parse(raw);
        this.store = {
          installed: Array.isArray(parsed.installed) ? parsed.installed : [],
          activeThemeId: parsed.activeThemeId ?? null,
          activeSkinId: parsed.activeSkinId ?? null,
          selectedMirrorId: parsed.selectedMirrorId ?? "ghfast",
          customMirrorUrl: parsed.customMirrorUrl ?? ""
        };
      } else {
        this.saveState();
      }
    } catch (e) {
      console.error("Failed to load plugins state:", e);
    }
  }

  private saveState() {
    this.ensureDir();
    fs.writeFileSync(this.stateFile, JSON.stringify(this.store, null, 2), "utf-8");
  }

  public getState(): PluginStoreState {
    this.syncInstalledFromDisk();
    return {
      installed: this.store.installed,
      activeThemeId: this.store.activeThemeId,
      activeSkinId: this.store.activeSkinId,
      selectedMirrorId: this.store.selectedMirrorId,
      customMirrorUrl: this.store.customMirrorUrl,
      mirrors: BUILTIN_GITHUB_MIRRORS
    };
  }

  public setMirrorConfig(mirrorId: string, customUrl?: string) {
    this.store.selectedMirrorId = mirrorId;
    if (customUrl !== undefined) {
      this.store.customMirrorUrl = customUrl;
    }
    this.saveState();
  }

  /**
   * Scans local plugin directories in data/plugins and ensures manifests are synced.
   */
  public syncInstalledFromDisk() {
    if (!fs.existsSync(this.baseDir)) return;
    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    const updatedList: InstalledPlugin[] = [];

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const pluginId = ent.name;
      if (!isSafePluginId(pluginId)) continue;
      const pluginDir = path.join(this.baseDir, pluginId);
      const manifestPath = path.join(pluginDir, "saki-plugin.json");

      if (fs.existsSync(manifestPath)) {
        try {
          const raw = fs.readFileSync(manifestPath, "utf-8");
          const manifest = JSON.parse(raw) as SakiPluginManifest;
          const existing = this.store.installed.find((p) => p.id === pluginId);

          updatedList.push({
            id: pluginId,
            manifest,
            enabled: existing ? existing.enabled : true,
            installedAt: existing?.installedAt ?? new Date().toISOString(),
            sourceRepo: existing?.sourceRepo,
            sourceRef: existing?.sourceRef,
            localPath: pluginDir
          });
        } catch (err) {
          console.warn(`Skipping invalid plugin manifest in ${pluginDir}:`, err);
        }
      }
    }

    this.store.installed = updatedList;
    this.saveState();
  }

  public togglePlugin(id: string, enabled?: boolean): InstalledPlugin | null {
    if (!isSafePluginId(id)) return null;
    const plugin = this.store.installed.find((p) => p.id === id);
    if (!plugin) return null;

    plugin.enabled = enabled !== undefined ? enabled : !plugin.enabled;

    // If disabled and was active theme/skin, deactivate
    if (!plugin.enabled) {
      if (this.store.activeThemeId === id) this.store.activeThemeId = null;
      if (this.store.activeSkinId === id) this.store.activeSkinId = null;
    }

    this.saveState();
    return plugin;
  }

  public setActiveTheme(themeId: string | null): boolean {
    if (themeId === null) {
      this.store.activeThemeId = null;
      this.saveState();
      return true;
    }
    if (!isSafePluginId(themeId)) return false;
    const found = this.store.installed.find((p) => p.id === themeId && p.manifest.type === "theme");
    if (!found) return false;
    found.enabled = true;
    this.store.activeThemeId = themeId;
    this.saveState();
    return true;
  }

  public setActiveSkin(skinId: string | null): boolean {
    if (skinId === null) {
      this.store.activeSkinId = null;
      this.saveState();
      return true;
    }
    if (!isSafePluginId(skinId)) return false;
    const found = this.store.installed.find((p) => p.id === skinId && p.manifest.type === "skin");
    if (!found) return false;
    found.enabled = true;
    this.store.activeSkinId = skinId;
    this.saveState();
    return true;
  }

  public uninstallPlugin(id: string): boolean {
    if (!isSafePluginId(id)) return false;
    const idx = this.store.installed.findIndex((p) => p.id === id);
    if (idx === -1) return false;

    const targetDir = path.join(this.baseDir, id);
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(`Failed to remove plugin folder ${targetDir}:`, e);
      return false;
    }

    if (this.store.activeThemeId === id) this.store.activeThemeId = null;
    if (this.store.activeSkinId === id) this.store.activeSkinId = null;

    this.store.installed.splice(idx, 1);
    this.saveState();
    return true;
  }

  /**
   * Check whether installed plugins that came from a GitHub source have
   * updates available upstream. Skips plugins without sourceRepo.
   *
   * For each eligible plugin we first try `git ls-remote` against the
   * mirrored clone URL — comparing the remote HEAD hash with the locally
   * recorded sourceCommit. If ls-remote fails (network, mirror does not
   * support git protocol, etc.), we fall back to fetching the upstream
   * saki-plugin.json via raw.githubusercontent.com (mirrored) and
   * comparing the manifest version string.
   */
  public async checkForUpdates(
    ids?: string[],
    options?: { mirrorId?: string; customMirrorUrl?: string }
  ): Promise<PluginUpdateStatus[]> {
    const mirrorId = options?.mirrorId ?? this.store.selectedMirrorId;
    const customMirrorUrl = options?.customMirrorUrl ?? this.store.customMirrorUrl;

    const targets = this.store.installed
      .filter((p) => p.sourceRepo)
      .filter((p) => (ids && ids.length > 0 ? ids.includes(p.id) : true));

    return Promise.all(targets.map((p) => this.checkSingleUpdate(p, mirrorId, customMirrorUrl)));
  }

  private async checkSingleUpdate(
    plugin: InstalledPlugin,
    mirrorId: string,
    customMirrorUrl: string | undefined
  ): Promise<PluginUpdateStatus> {
    const status: PluginUpdateStatus = {
      pluginId: plugin.id,
      checksAvailable: true,
      updatesAvailable: false,
      localVersion: plugin.manifest.version,
      lastCheckedAt: new Date().toISOString()
    };
    if (plugin.sourceCommit) status.localCommit = plugin.sourceCommit;

    const ref = plugin.sourceRef ?? "main";
    const originalCloneUrl = `https://github.com/${plugin.sourceRepo}.git`;
    const mirroredCloneUrl = resolveMirrorUrl(originalCloneUrl, mirrorId, customMirrorUrl);

    // 1) Primary path: git ls-remote
    if (plugin.sourceCommit) {
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["ls-remote", mirroredCloneUrl, ref],
          { timeout: 10000, windowsHide: true }
        );
        // stdout format: "<hash>\t<refname>" — we only need the first line's hash
        const firstLine = stdout.split(/\r?\n/).find((l) => l.trim()) ?? "";
        const remoteHash = firstLine.split("\t")[0]?.trim();
        if (remoteHash && remoteHash !== plugin.sourceCommit) {
          status.updatesAvailable = true;
          status.remoteCommit = remoteHash;
        }
        return status;
      } catch (gitErr) {
        // fall through to raw manifest fallback
        const msg = gitErr instanceof Error ? gitErr.message : String(gitErr);
        status.error = `git ls-remote failed: ${msg}`;
      }
    }

    // 2) Fallback: fetch upstream manifest via raw URL
    const candidatePaths = [
      `plugins/${plugin.id}/saki-plugin.json`,
      `${plugin.id}/saki-plugin.json`,
      "saki-plugin.json"
    ];
    const refsToTry = Array.from(new Set([ref, "main", "master"]));

    let resolved = false;
    for (const r of refsToTry) {
      if (resolved) break;
      for (const subpath of candidatePaths) {
        try {
          const manifestUrl = `https://raw.githubusercontent.com/${plugin.sourceRepo}/${r}/${subpath}`;
          const mirroredUrl = resolveMirrorUrl(manifestUrl, mirrorId, customMirrorUrl);

          const res = await fetch(mirroredUrl, {
            headers: { "User-Agent": "Saki-Panel-Plugin-Updater/1.0" },
            signal: AbortSignal.timeout(6000)
          });

          if (res.ok) {
            const remoteManifest = (await res.json()) as SakiPluginManifest;
            if (remoteManifest.version) {
              status.remoteVersion = remoteManifest.version;
              if (remoteManifest.version !== plugin.manifest.version) {
                status.updatesAvailable = true;
              }
            }
            delete status.error;
            resolved = true;
            break;
          }
        } catch {
          // try next path
        }
      }
    }

    if (!resolved) {
      // Also try registry.json in repo root
      for (const r of refsToTry) {
        if (resolved) break;
        try {
          const registryUrl = `https://raw.githubusercontent.com/${plugin.sourceRepo}/${r}/registry.json`;
          const mirroredUrl = resolveMirrorUrl(registryUrl, mirrorId, customMirrorUrl);
          const res = await fetch(mirroredUrl, {
            headers: { "User-Agent": "Saki-Panel-Plugin-Updater/1.0" },
            signal: AbortSignal.timeout(6000)
          });
          if (res.ok) {
            const items = (await res.json()) as Array<{ name?: string; version?: string }>;
            const match = Array.isArray(items) ? items.find((it) => it.name === plugin.id) : null;
            if (match && match.version) {
              status.remoteVersion = match.version;
              if (match.version !== plugin.manifest.version) {
                status.updatesAvailable = true;
              }
              delete status.error;
              resolved = true;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (!resolved && !status.error) {
      status.error = "无法从上游仓库获取插件清单";
    }

    return status;
  }

  /**
   * Reinstall a plugin from its recorded GitHub source, clearing the old
   * directory first so the new clone drops cleanly.
   */
  public async updatePlugin(
    id: string,
    options?: { mirrorId?: string; customMirrorUrl?: string }
  ): Promise<InstalledPlugin> {
    if (!isSafePluginId(id)) {
      throw new Error("无效的插件标识");
    }
    const existing = this.store.installed.find((p) => p.id === id);
    if (!existing) {
      throw new Error(`未找到插件: ${id}`);
    }
    if (!existing.sourceRepo) {
      throw new Error("该插件非 GitHub 来源，无法自动更新");
    }

    // Wipe the old install so installFromGithub can re-clone fresh
    const localDir = path.join(this.baseDir, id);
    if (fs.existsSync(localDir)) {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
    const idx = this.store.installed.findIndex((p) => p.id === id);
    if (idx !== -1) this.store.installed.splice(idx, 1);
    this.saveState();

    const mirrorId = options?.mirrorId ?? this.store.selectedMirrorId;
    const customMirrorUrl = options?.customMirrorUrl ?? this.store.customMirrorUrl;

    return this.installFromGithub({
      repoOrUrl: existing.sourceRepo,
      ref: existing.sourceRef,
      mirrorId,
      customMirrorUrl
    }).then((installed) => installed.find((p) => p.id === id) ?? installed[0]!);
  }

  /**
   * Lists relative file paths inside a plugin directory (for skin overlay matching).
   */
  public listPluginFiles(pluginId: string): string[] {
    if (!isSafePluginId(pluginId)) return [];
    const pluginDir = path.join(this.baseDir, pluginId);
    if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) return [];

    const files: string[] = [];
    const walk = (dir: string, prefix: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name.startsWith(".tmp")) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
        } else {
          files.push(rel.replace(/\\/g, "/"));
        }
      }
    };
    walk(pluginDir, "");
    return files;
  }

  /**
   * Resolves safe local asset path for a plugin
   */
  public getAssetPath(pluginId: string, assetSubPath: string): string | null {
    if (!isSafePluginId(pluginId)) return null;
    const pluginDir = path.join(this.baseDir, pluginId);
    if (!fs.existsSync(pluginDir)) return null;

    // Normalize and clean path
    const sanitized = assetSubPath.replace(/^[/\\]+/, "");
    const resolved = path.resolve(pluginDir, sanitized);

    // Prevent path traversal
    if (!resolved.startsWith(pluginDir + path.sep) && resolved !== pluginDir) {
      return null;
    }

    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return null;
    }

    return resolved;
  }

  /**
   * Install plugin from GitHub repo or direct URL with mirror acceleration
   */
  public async installFromGithub(options: {
    repoOrUrl: string;
    mirrorId?: string | undefined;
    customMirrorUrl?: string | undefined;
    ref?: string | undefined;
    pluginName?: string | undefined;
  }): Promise<InstalledPlugin[]> {
    const { repoOrUrl, mirrorId = this.store.selectedMirrorId, customMirrorUrl } = options;
    const trimmed = repoOrUrl.trim();
    if (!trimmed) {
      throw new Error("请输入有效的 GitHub 仓库或链接 (例如: owner/repo)");
    }

    let githubUrl = trimmed;
    let targetSubPathOrName = "";

    // Support owner/repo:subpath or owner/repo#pluginName syntax
    if (githubUrl.includes(":") && !githubUrl.startsWith("http://") && !githubUrl.startsWith("https://")) {
      const parts = githubUrl.split(":");
      githubUrl = parts[0]!;
      targetSubPathOrName = parts.slice(1).join(":");
    }

    if (!githubUrl.startsWith("http://") && !githubUrl.startsWith("https://")) {
      githubUrl = `https://github.com/${githubUrl.replace(/^\/+/, "")}`;
    }

    // Match github.com/owner/repo with optional tree/branch/subpath
    const githubMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/.]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/i);
    if (!githubMatch) {
      throw new Error("无法解析 GitHub 仓库地址，请确认为 github.com/用户名/仓库名 格式");
    }

    const owner = githubMatch[1]!;
    const repo = githubMatch[2]!.replace(/\.git$/i, "");
    const repoIdentifier = `${owner}/${repo}`;
    const branchInUrl = githubMatch[3];
    const subPathInUrl = githubMatch[4];

    if (subPathInUrl && !targetSubPathOrName) {
      targetSubPathOrName = subPathInUrl;
    }

    const targetRef = options.ref?.trim() || branchInUrl?.trim() || "main";
    if (!SAFE_GIT_REF.test(targetRef)) {
      throw new Error("分支或 Tag 名称包含非法字符");
    }

    const tempDir = path.join(this.baseDir, `.tmp_install_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // Resolve clone/download URL through mirror
      const originalCloneUrl = `https://github.com/${owner}/${repo}.git`;
      const mirroredCloneUrl = resolveMirrorUrl(originalCloneUrl, mirrorId, customMirrorUrl);

      let cloneSuccess = false;
      let cloneError = "";

      // 先用 git clone 浅克隆，execFile 不走 shell 注入安全
      try {
        await execFileAsync("git", ["clone", "--depth", "1", "-b", targetRef, mirroredCloneUrl, tempDir], {
          timeout: 45000,
          windowsHide: true
        });
        cloneSuccess = true;
      } catch (err) {
        cloneError = err instanceof Error ? err.message : String(err);
        try {
          await execFileAsync("git", ["clone", "--depth", "1", mirroredCloneUrl, tempDir], {
            timeout: 45000,
            windowsHide: true
          });
          cloneSuccess = true;
        } catch (e) {
          cloneError = e instanceof Error ? e.message : String(e);
        }
      }

      // git 不行就降级走镜像下载 zip 包
      if (!cloneSuccess) {
        const archiveUrls = [
          `https://github.com/${owner}/${repo}/archive/refs/heads/${targetRef}.zip`,
          `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`,
          `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`
        ];

        let downloaded = false;
        const zipFile = path.join(tempDir, "repo.zip");

        for (const rawUrl of archiveUrls) {
          const mirrorZipUrl = resolveMirrorUrl(rawUrl, mirrorId, customMirrorUrl);
          try {
            const resp = await fetch(mirrorZipUrl, {
              headers: { "User-Agent": "Saki-Panel-Plugin-Installer/1.0" }
            });
            if (resp.ok) {
              const arrayBuffer = await resp.arrayBuffer();
              fs.writeFileSync(zipFile, Buffer.from(arrayBuffer));
              await execFileAsync("tar", ["-xf", zipFile, "-C", tempDir], { windowsHide: true });
              fs.unlinkSync(zipFile);
              downloaded = true;
              break;
            }
          } catch {
            // try next
          }
        }

        if (!downloaded && !cloneSuccess) {
          throw new Error(`连接 GitHub 失败，请切换加速镜像线路重试。\n错误详情: ${cloneError}`);
        }
      }

      // 记录当前 commit 号，zip 解压的没有 .git 元数据，跳过就好
      let currentCommit: string | undefined;
      if (cloneSuccess) {
        try {
          const revRes = await execFileAsync("git", ["-C", tempDir, "rev-parse", "HEAD"], {
            timeout: 5000,
            windowsHide: true
          });
          currentCommit = revRes.stdout.trim();
        } catch {
          // non-fatal — zip fallback or weird clone layout; just skip
        }
      }

      // 递归搜 saki-plugin.json，支持 monorepo 和多层嵌套
      const allManifests = this.findAllPluginManifests(tempDir);
      if (allManifests.length === 0) {
        throw new Error(
          "在该仓库中未找到有效的 saki-plugin.json 清单文件！请确认该仓库是合规的 Saki Panel 插件。"
        );
      }

      // Determine which plugin(s) to install
      let targetManifests: Array<{ manifest: SakiPluginManifest; sourceDir: string }> = [];
      const targetPluginIdentifier = options.pluginName?.trim() || targetSubPathOrName?.trim();

      if (targetPluginIdentifier) {
        const match = allManifests.find(
          (m) =>
            m.manifest.name.toLowerCase() === targetPluginIdentifier.toLowerCase() ||
            path.basename(m.sourceDir).toLowerCase() === targetPluginIdentifier.toLowerCase() ||
            m.sourceDir.replace(/\\/g, "/").toLowerCase().includes(targetPluginIdentifier.toLowerCase())
        );
        if (match) {
          targetManifests = [match];
        } else {
          const available = allManifests.map((m) => m.manifest.displayName || m.manifest.name).join("、");
          throw new Error(`在仓库中未找到名为「${targetPluginIdentifier}」的插件清单。仓库内发现的可用插件为: ${available}`);
        }
      } else if (allManifests.length === 1) {
        targetManifests = [allManifests[0]!];
      } else {
        // Multiple plugins found in monorepo, install all of them
        targetManifests = allManifests;
      }

      const installedItems: InstalledPlugin[] = [];

      for (const item of targetManifests) {
        const { manifest, sourceDir } = item;
        if (!manifest.name || !manifest.type || !manifest.displayName) {
          continue;
        }

        const pluginId = manifest.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
        if (!isSafePluginId(pluginId)) continue;
        const targetDir = path.join(this.baseDir, pluginId);

        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }

        fs.cpSync(sourceDir, targetDir, { recursive: true });

        const gitMetaDir = path.join(targetDir, ".git");
        if (fs.existsSync(gitMetaDir)) {
          fs.rmSync(gitMetaDir, { recursive: true, force: true });
        }

        const installedItem: InstalledPlugin = {
          id: pluginId,
          manifest,
          enabled: true,
          installedAt: new Date().toISOString(),
          sourceRepo: repoIdentifier,
          sourceRef: targetRef,
          sourceCommit: currentCommit,
          localPath: targetDir
        };

        const existingIdx = this.store.installed.findIndex((p) => p.id === pluginId);
        if (existingIdx !== -1) {
          this.store.installed[existingIdx] = installedItem;
        } else {
          this.store.installed.push(installedItem);
        }
        installedItems.push(installedItem);
      }

      if (installedItems.length === 0) {
        throw new Error("saki-plugin.json 缺少必要字段 (name, type, displayName)");
      }

      this.saveState();
      return installedItems;
    } finally {
      // Clean tempDir
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }

  /**
   * Recursively search for all valid saki-plugin.json manifests within a directory
   */
  private findAllPluginManifests(
    dir: string,
    depth = 0,
    maxDepth = 5
  ): Array<{ manifest: SakiPluginManifest; sourceDir: string }> {
    const results: Array<{ manifest: SakiPluginManifest; sourceDir: string }> = [];
    if (depth > maxDepth || !fs.existsSync(dir)) return results;

    const manifestPath = path.join(dir, "saki-plugin.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const parsed = JSON.parse(raw) as SakiPluginManifest;
        if (parsed && typeof parsed === "object" && parsed.name && parsed.type) {
          results.push({ manifest: parsed, sourceDir: dir });
          // Valid plugin root found; do not search further inside this plugin's assets
          return results;
        }
      } catch {
        // Skip invalid JSON
      }
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const name = entry.name;
          if (name === ".git" || name === "node_modules" || name.startsWith(".tmp")) {
            continue;
          }
          const subResults = this.findAllPluginManifests(path.join(dir, name), depth + 1, maxDepth);
          results.push(...subResults);
        }
      }
    } catch {
      // Ignore read errors
    }

    return results;
  }

  /**
   * Curated registry: live `registry.json` from the official sample repo, with a local fallback.
   * Icon URLs are resolved here (with mirror rewriting) so the frontend never needs to know
   * how to reach GitHub raw assets.
   */
  private resolveRegistryIconUrl(
    repo: string,
    ref: string,
    name: string,
    icon: string | undefined
  ): string | undefined {
    if (!icon) return undefined;
    // Accept either a bare filename like "preview.webp" (lives in plugins/<name>/)
    // or a full relative path like "assets/preview.webp"
    const cleaned = icon.replace(/^[/\\]+/, "");
    const subPath = cleaned.includes("/") || cleaned.includes("\\")
      ? cleaned
      : `plugins/${name}/${cleaned}`;
    const raw = `https://raw.githubusercontent.com/${repo}/${ref}/${subPath}`;
    return resolveMirrorUrl(raw, this.store.selectedMirrorId, this.store.customMirrorUrl);
  }

  public getBuiltinRegistry(): PluginRegistryItem[] {
    const items: PluginRegistryItem[] = [
      {
        name: "saki-skin-maid",
        displayName: "女仆装",
        description: "Saki 形象扩展：全站表情、桌宠、启动器与空状态插画统一换上经典法式女仆装。",
        author: "DreamStarry",
        type: "skin",
        version: "1.0.0",
        repo: "EthanChan050430/saki-plugins",
        ref: "master",
        icon: "preview.webp",
        featured: true
      },
      {
        name: "saki-theme-geo",
        displayName: "简约几何",
        description: "主题配色：切角几何按钮与模态框、炭黑/米白/钴蓝配色，去掉圆角与毛玻璃。",
        author: "DreamStarry",
        type: "theme",
        version: "1.0.0",
        repo: "EthanChan050430/saki-plugins",
        ref: "master",
        icon: "preview.webp",
        featured: true
      },
      {
        name: "saki-game-fruit-slice",
        displayName: "切水果",
        description: "街机切水果：滑动切开飞来的水果，避开炸弹，连击越高分越高。",
        author: "DreamStarry",
        type: "game",
        version: "1.0.3",
        repo: "EthanChan050430/saki-plugins",
        ref: "master",
        featured: true
      },
      {
        name: "saki-locale-ja",
        displayName: "日本語",
        description: "UI を日本語にローカライズ。メニュー、ボタン、通知、エラーメッセージなどを一括翻訳。",
        author: "DreamStarry",
        type: "locale",
        version: "1.0.0",
        repo: "EthanChan050430/saki-plugins",
        ref: "master",
        featured: true
      }
    ];

    // Resolve icon URLs now — the frontend just consumes a ready-to-use URL
    return items.map((it) => ({
      ...it,
      iconUrl: this.resolveRegistryIconUrl(it.repo, it.ref ?? "main", it.name, it.icon)
    }));
  }

  public async getCuratedRegistry(): Promise<PluginRegistryItem[]> {
    const rawUrl = "https://raw.githubusercontent.com/EthanChan050430/saki-plugins/master/registry.json";
    const mirrored = resolveMirrorUrl(rawUrl, this.store.selectedMirrorId, this.store.customMirrorUrl);
    try {
      const resp = await fetch(mirrored, {
        headers: { "User-Agent": "Saki-Panel-Plugin-Registry/1.0" },
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const parsed = (await resp.json()) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const items = parsed.filter(
            (item): item is PluginRegistryItem =>
              Boolean(item && typeof item === "object" && typeof (item as PluginRegistryItem).name === "string")
          );
          return items.map((it) => ({
            ...it,
            ref: it.ref ?? "master",
            iconUrl:
              it.iconUrl ??
              this.resolveRegistryIconUrl(it.repo, it.ref ?? "master", it.name, it.icon)
          }));
        }
      }
    } catch {
      // fall through to builtin
    }
    return this.getBuiltinRegistry();
  }
}

export const pluginManager = new PluginManager();
