import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  AlertCircle,
  Database,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X,
  Zap
} from "lucide-react";
import type {
  DatabaseVisualizerInstance,
  ManagedNode
} from "@webops/shared";
import { api, ApiError } from "./api.js";
import "./db_visualizer.css";
import type { DatabaseVisualizerProps } from "./database/types.js";
import { DatabaseActiveWorkspace } from "./database/DatabaseActiveWorkspace.js";
import { AddDatabaseModal } from "./database/modals/AddDatabaseModal.js";
import { EditDatabaseModal } from "./database/modals/EditDatabaseModal.js";

export { AddDatabaseModal, EditDatabaseModal };
export type { DatabaseVisualizerProps };

export function DatabaseVisualizer({
  token,
  nodes,
  selectedDatabaseId,
  onClose,
  onSelectDatabase,
  darkMode
}: DatabaseVisualizerProps) {
  const [databases, setDatabases] = useState<DatabaseVisualizerInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeDbId, setActiveDbId] = useState<string | null>(selectedDatabaseId ?? null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    if (selectedDatabaseId !== undefined && selectedDatabaseId !== null) {
      setActiveDbId(selectedDatabaseId);
    }
  }, [selectedDatabaseId]);

  const loadDatabases = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.listDatabases(token);
      setDatabases(res.databases || []);
      if (!activeDbId && res.databases && res.databases.length > 0) {
        const first = res.databases[0]!.id;
        setActiveDbId(first);
        onSelectDatabase?.(first);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取数据库实例失败");
    } finally {
      setLoading(false);
    }
  }, [token, activeDbId, onSelectDatabase]);

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  const activeDatabase = useMemo(
    () => databases.find((d) => d.id === activeDbId) ?? databases[0] ?? null,
    [databases, activeDbId]
  );

  const handleDeleteDatabase = async (id: string, name: string) => {
    if (!window.confirm(`确定要移除数据库可视化实例「${name}」吗？（不会删除物理数据库文件或服务）`)) return;
    try {
      await api.deleteDatabase(token, id);
      const remaining = databases.filter((d) => d.id !== id);
      setDatabases(remaining);
      if (activeDbId === id) {
        const nextId = remaining[0]?.id ?? null;
        setActiveDbId(nextId);
        onSelectDatabase?.(nextId);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  if (loading && databases.length === 0) {
    return (
      <div className="database-master-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#86868b" }}>
          <Loader2 size={36} className="status-spinner" style={{ margin: "0 auto 12px" }} />
          <p>正在载入数据库可视化环境...</p>
        </div>
      </div>
    );
  }

  if (databases.length === 0) {
    return (
      <div className="database-master-layout" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="glass-panel" style={{ padding: 40, borderRadius: 24, textAlign: "center", maxWidth: 520 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(99, 102, 241, 0.12)", color: "#6366f1", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <Database size={32} />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>尚未配置任何数据库实例</h3>
          <p style={{ color: "#86868b", fontSize: 14, margin: "0 0 24px", lineHeight: 1.5 }}>
            Saki-Panel 支持直连与管理 SQLite 本地文件、MySQL / MariaDB、PostgreSQL 关系库以及 Redis 键值缓存服务。
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            {onClose && (
              <button className="ghost-button" type="button" onClick={onClose}>
                返回实例列表
              </button>
            )}
            <button className="primary-button" type="button" onClick={() => setShowAddModal(true)}>
              <Plus size={16} />
              <span>添加数据库</span>
            </button>
          </div>
        </div>

        {showAddModal && (
          <AddDatabaseModal
            token={token}
            nodes={nodes}
            onClose={() => setShowAddModal(false)}
            onCreated={(newDb) => {
              setShowAddModal(false);
              setDatabases((prev) => [newDb, ...prev]);
              setActiveDbId(newDb.id);
              onSelectDatabase?.(newDb.id);
            }}
          />
        )}
      </div>
    );
  }

  if (!activeDatabase) return null;

  return (
    <>
      <DatabaseActiveWorkspace
        token={token}
        database={activeDatabase}
        databases={databases}
        activeDbId={activeDbId}
        onSelectDatabase={(id) => {
          setActiveDbId(id);
          onSelectDatabase?.(id);
        }}
        onAddDatabase={() => setShowAddModal(true)}
        onEditDatabase={() => setShowEditModal(true)}
        onDelete={() => handleDeleteDatabase(activeDatabase.id, activeDatabase.name)}
        onRefresh={loadDatabases}
        onClose={onClose}
        darkMode={darkMode}
      />

      {showAddModal && (
        <AddDatabaseModal
          token={token}
          nodes={nodes}
          onClose={() => setShowAddModal(false)}
          onCreated={(newDb) => {
            setShowAddModal(false);
            setDatabases((prev) => [newDb, ...prev]);
            setActiveDbId(newDb.id);
            onSelectDatabase?.(newDb.id);
          }}
        />
      )}

      {showEditModal && (
        <EditDatabaseModal
          token={token}
          database={activeDatabase}
          nodes={nodes}
          onClose={() => setShowEditModal(false)}
          onUpdated={(updated) => {
            setShowEditModal(false);
            setDatabases((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          }}
        />
      )}
    </>
  );
}
