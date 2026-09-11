import { useEffect, useState } from "react";
import type { InstalledPlugin } from "@webops/shared";
import {
  applySkinAssetOverrides,
  defaultSakiArtAssets,
  getSkinRevision,
  resetSkinAssetOverrides,
  subscribeSkinChange
} from "../constants.js";

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function pluginAssetUrl(pluginId: string, rel: string, version: string): string {
  return `/api/plugins/${encodeURIComponent(pluginId)}/assets/${normalizeRel(rel)}?v=${encodeURIComponent(version)}`;
}

export function useSkinRevision(): number {
  const [rev, setRev] = useState(getSkinRevision);
  useEffect(() => subscribeSkinChange(() => setRev(getSkinRevision())), []);
  return rev;
}

export function applyPluginSkin(plugin: InstalledPlugin | null, availableRelPaths?: Set<string>): void {
  if (!plugin || !plugin.enabled || !plugin.manifest.skin) {
    resetSkinAssetOverrides();
    return;
  }

  const skin = plugin.manifest.skin;
  const fileSet = new Set<string>();
  if (availableRelPaths) {
    for (const file of availableRelPaths) fileSet.add(normalizeRel(file));
  }
  if (Array.isArray(skin.files)) {
    for (const file of skin.files) fileSet.add(normalizeRel(file));
  }

  const assetRoot = normalizeRel(skin.assetRoot ?? "").replace(/\/+$/, "");
  const overrides: Record<string, string> = {};

  const hasFile = (rel: string): boolean => fileSet.has(normalizeRel(rel));

  const resolveRelForOriginal = (originalAssetPath: string): string | null => {
    if (!originalAssetPath.startsWith("/assets/")) return null;
    const relFromAssets = originalAssetPath.slice("/assets/".length);
    const candidates = [
      assetRoot ? `${assetRoot}/${relFromAssets}` : relFromAssets,
      relFromAssets
    ];
    for (const candidate of candidates) {
      // 无文件清单时（files API 失败且 manifest 未声明 skin.files），
      // 不猜测覆盖，避免把全站默认素材错指向不存在的路径
      if (fileSet.size === 0) return null;
      const n = normalizeRel(candidate);
      if (hasFile(n)) return n;
    }
    return null;
  };

  const version = plugin.manifest.version ?? "0";

  for (const [key, path] of Object.entries(defaultSakiArtAssets)) {
    const rel = resolveRelForOriginal(path);
    if (rel) overrides[key] = pluginAssetUrl(plugin.id, rel, version);
  }

  if (skin.mapping) {
    for (const [key, subPath] of Object.entries(skin.mapping)) {
      const rel = normalizeRel(subPath);
      if (fileSet.size > 0 && !hasFile(rel)) continue;
      overrides[key] = pluginAssetUrl(plugin.id, rel, version);
    }
  }

  applySkinAssetOverrides(overrides, (originalPath) => {
    const rel = resolveRelForOriginal(originalPath);
    return rel ? pluginAssetUrl(plugin.id, rel, version) : null;
  });
}
