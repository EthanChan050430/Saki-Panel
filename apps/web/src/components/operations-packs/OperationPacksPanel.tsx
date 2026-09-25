import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  CheckCircle2,
  CloudDownload,
  Download,
  FilePlus2,
  Gamepad2,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { InstalledOperationPack, OperationPackRegistryResponse } from "@webops/shared";
import { api, ApiError } from "../../api.js";
import { useNotificationCenter } from "../../NotificationCenter.js";

interface OperationPacksPanelProps {
  token: string;
  onLogout: () => void;
  refreshTick?: number;
  onImported?: () => void | Promise<void>;
}

function categoryMeta(category: "minecraft" | "docker_compose") {
  if (category === "minecraft") {
    return {
      label: "Minecraft",
      icon: <Gamepad2 size={18} aria-hidden="true" />,
      accentClass: "is-minecraft"
    };
  }
  return {
    label: "Docker Compose",
    icon: <Box size={18} aria-hidden="true" />,
    accentClass: "is-compose"
  };
}

function displayPackDate(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

/**
 * A deliberately small marketplace surface for operational knowledge.
 * Pack content is never imported into the browser bundle: the Panel verifies
 * and caches it only after the user explicitly chooses Install.
 */
export function OperationPacksPanel({ token, onLogout, refreshTick = 0, onImported }: OperationPacksPanelProps) {
  const [registry, setRegistry] = useState<OperationPackRegistryResponse | null>(null);
  const [installed, setInstalled] = useState<InstalledOperationPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [activatingPackId, setActivatingPackId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { pushNotification } = useNotificationCenter();

  const load = useCallback(async (manual = false) => {
    setError("");
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const [nextRegistry, nextInstalled] = await Promise.all([
        api.operationPackRegistry(token, manual),
        api.installedOperationPacks(token)
      ]);
      setRegistry(nextRegistry);
      setInstalled(nextInstalled);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "运维包目录读取失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onLogout, token]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const installedById = useMemo(() => {
    const latest = new Map<string, InstalledOperationPack>();
    for (const pack of installed) {
      const current = latest.get(pack.id);
      if (!current || pack.updatedAt > current.updatedAt) latest.set(pack.id, pack);
    }
    return latest;
  }, [installed]);

  async function installPack(packId: string, force: boolean) {
    setBusyPackId(packId);
    setError("");
    try {
      const result = await api.installOperationPack(token, packId, { force });
      setInstalled((current) => {
        const next = current.filter((item) => item.id !== result.pack.id);
        return [...next, result.pack];
      });
      pushNotification(
        "success",
        `已校验并缓存 ${result.downloaded.length} 个「${result.pack.name}」资源；它们尚未执行。`,
        { durationMs: 6000 }
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "运维包下载失败");
    } finally {
      setBusyPackId(null);
    }
  }

  async function activatePack(pack: InstalledOperationPack, target: "template" | "saki_skill") {
    const resourceIds = pack.resources
      .filter((resource) => target === "template" ? resource.kind === "template" : resource.kind === "skill" || resource.kind === "runbook")
      .map((resource) => resource.id);
    if (resourceIds.length === 0) return;
    setActivatingPackId(pack.id);
    setError("");
    try {
      const result = await api.activateOperationPack(token, pack.id, { resourceIds });
      // A list refresh is useful but must not turn a successful import into a
      // false failure when that follow-up request has a transient problem.
      await Promise.resolve(onImported?.()).catch(() => undefined);
      const targets = result.activated.map((item) => item.target === "template" ? "模板" : "Saki Skill");
      pushNotification(
        "success",
        `已导入 ${result.activated.length} 项 ${[...new Set(targets)].join("、")}；没有执行任何脚本。`,
        { durationMs: 6000 }
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "运维包导入失败");
    } finally {
      setActivatingPackId(null);
    }
  }

  const packs = registry?.items ?? [];

  return (
    <section className="operations-packs-panel" aria-labelledby="operations-packs-heading">
      <div className="operations-packs-heading">
        <div className="operations-packs-heading-copy">
          <span className="operations-packs-heading-icon"><Sparkles size={19} aria-hidden="true" /></span>
          <div>
            <div className="operations-packs-title-line">
              <h2 id="operations-packs-heading">垂直运维包</h2>
              <span className="operations-packs-online-tag"><CloudDownload size={13} /> 按需下载</span>
            </div>
            <p>Runbook、模板与策略建议不随安装包发布；选择后才会在线下载、SHA-256 校验并缓存。</p>
          </div>
        </div>
        <button
          className="ghost-button operations-packs-refresh"
          type="button"
          disabled={loading || refreshing}
          onClick={() => void load(true)}
          title="刷新在线运维包目录"
        >
          <RefreshCw size={15} className={refreshing ? "status-spinner" : ""} />
          刷新目录
        </button>
      </div>

      <div className="operations-packs-safety-note">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>安装只下载并验证资源，不会执行脚本、写入实例、拉取镜像或改动 Compose 文件。</span>
      </div>

      {registry?.warning ? <p className="operations-packs-warning">{registry.warning}</p> : null}
      {error ? <p className="operations-packs-error">{error}</p> : null}

      {loading ? (
        <div className="operations-packs-loading">
          <Loader2 size={20} className="status-spinner" />
          正在读取在线运维包目录…
        </div>
      ) : packs.length > 0 ? (
        <div className="operations-packs-grid">
          {packs.map((pack) => {
            const meta = categoryMeta(pack.category);
            const local = installedById.get(pack.id);
            const installedCurrent = local?.version === pack.version;
            const busy = busyPackId === pack.id;
            const hasTemplate = local?.resources.some((resource) => resource.kind === "template") ?? false;
            const hasSkill = local?.resources.some((resource) => resource.kind === "skill" || resource.kind === "runbook") ?? false;
            const activating = activatingPackId === pack.id;
            return (
              <article className={`operations-pack-card ${meta.accentClass}`} key={pack.id}>
                <div className="operations-pack-card-topline">
                  <span className="operations-pack-category-icon">{meta.icon}</span>
                  <span className="operations-pack-category-label">{meta.label}</span>
                  <span className="operations-pack-version">v{pack.version}</span>
                </div>
                <h3>{pack.name}</h3>
                <p>{pack.description || pack.summary}</p>
                {pack.tags?.length ? (
                  <div className="operations-pack-tags">
                    {pack.tags.slice(0, 5).map((tag) => <span key={`${pack.id}-${tag}`}>{tag}</span>)}
                  </div>
                ) : null}
                <div className="operations-pack-card-footer">
                  <div className="operations-pack-status">
                    {local ? (
                      <>
                        <PackageCheck size={15} aria-hidden="true" />
                        <span>
                          {installedCurrent ? "已校验缓存" : `已缓存 v${local.version}`}
                          {displayPackDate(local.updatedAt) ? ` · ${displayPackDate(local.updatedAt)}` : ""}
                        </span>
                      </>
                    ) : (
                      <><Download size={15} aria-hidden="true" /><span>尚未下载</span></>
                    )}
                  </div>
                  <div className="operations-pack-actions">
                    {local && hasTemplate ? (
                      <button
                        className="operations-pack-activate"
                        type="button"
                        disabled={busy || activating}
                        onClick={() => void activatePack(local, "template")}
                        title="将已校验模板显式导入模板库；不会执行脚本"
                      >
                        {activating ? <Loader2 size={15} className="status-spinner" /> : <FilePlus2 size={15} />}
                        {activating ? "导入中" : "导入模板"}
                      </button>
                    ) : null}
                    {local && hasSkill ? (
                      <button
                        className="operations-pack-activate"
                        type="button"
                        disabled={busy || activating}
                        onClick={() => void activatePack(local, "saki_skill")}
                        title="将已校验 Runbook 显式导入 Saki Skills；不会执行脚本"
                      >
                        {activating ? <Loader2 size={15} className="status-spinner" /> : <FilePlus2 size={15} />}
                        {activating ? "导入中" : "导入 Runbook"}
                      </button>
                    ) : null}
                    <button
                      className={`operations-pack-install ${installedCurrent ? "is-current" : ""}`}
                      type="button"
                      disabled={busy || activating}
                      onClick={() => void installPack(pack.id, Boolean(local))}
                    >
                      {busy ? <Loader2 size={15} className="status-spinner" /> : installedCurrent ? <CheckCircle2 size={15} /> : <CloudDownload size={15} />}
                      {busy ? "校验中" : installedCurrent ? "重新校验" : local ? "更新资源" : "下载运维包"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="operations-packs-empty">
          <CloudDownload size={24} aria-hidden="true" />
          <div>
            <strong>在线目录暂时没有可用运维包</strong>
            <p>检查网络，或由管理员配置 <code>OPERATIONS_PACK_REGISTRY_URL</code> 指向受信任的包目录。</p>
          </div>
        </div>
      )}
    </section>
  );
}
