import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, FolderOpen, Plus, Server, Settings, Sparkles, Terminal, X, ShieldCheck } from "lucide-react";
import type { ManagedNode, ManagedInstance } from "@webops/shared";
import { SshTerminal } from "../../components/terminal/SshTerminal.js";
import { ServerProcessProbeCard } from "./ServerProcessProbeCard.js";
import { SshServerSettingsModal } from "./SshServerSettingsModal.js";
import { FileManager } from "../../components/file-manager/FileManager.js";

export function createNodeSyntheticInstance(node: ManagedNode): ManagedInstance {
  return {
    id: `node:${node.id}`,
    name: node.name,
    nodeId: node.id,
    workingDirectory: "/",
    status: node.status === "ONLINE" ? "RUNNING" : "STOPPED",
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    processId: null,
    startCommand: "",
    stopCommand: "",
    autoRestart: false,
    autoStart: false,
    environmentVariables: {},
    tags: ["ssh-server"],
    protocol: "ssh",
    type: "custom" as any,
    restartPolicy: "never",
    restartMaxRetries: 3
  } as unknown as ManagedInstance;
}

export function SshServerWorkspace({
  token,
  node,
  canViewTerminal,
  darkMode = false,
  onBack,
  onCreateInstance,
  onAskSaki,
  onUpdateNode,
  onDeleteNode,
  onSakiFileDragChange = () => {},
  handleSakiInstanceFileDrop
}: {
  token: string;
  node: ManagedNode;
  canViewTerminal: boolean;
  darkMode?: boolean;
  onBack: () => void;
  onCreateInstance?: (() => void) | undefined;
  onAskSaki?: ((prompt?: string) => void) | undefined;
  onUpdateNode?: ((node: ManagedNode) => void) | undefined;
  onDeleteNode?: ((nodeId: string) => void) | undefined;
  onSakiFileDragChange?: (active: boolean) => void;
  handleSakiInstanceFileDrop?: (payload: any) => void;
}) {
  const counter = useRef(1);
  const [tabs, setTabs] = useState([{ id: 1, label: "终端 1" }]);
  const [activeTab, setActiveTab] = useState(1);
  const [showFileManagerModal, setShowFileManagerModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const addTab = () => {
    const id = ++counter.current;
    setTabs((current) => [...current, { id, label: `终端 ${id}` }]);
    setActiveTab(id);
  };

  const closeTab = (id: number) => {
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (activeTab === id) setActiveTab(next.at(-1)?.id ?? 0);
  };

  const syntheticInstance = createNodeSyntheticInstance(node);

  return (
    <section className="ssh-server-workspace">
      <header className="ssh-server-header">
        <button
          type="button"
          className="icon-button"
          title="返回服务器与实例列表"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <Server size={20} />
        <div className="ssh-server-title">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2>{node.name}</h2>
            <span className={`status-badge mini ${node.status === "ONLINE" ? "online" : "offline"}`}>
              {node.status === "ONLINE" ? "探针在线" : "离线"}
            </span>
          </div>
          <span>
            {node.host}:{node.port} · SSH 远程服务器 · {node.os || "Linux"} ({node.arch || "x64"})
          </span>
        </div>

        <div className="ssh-header-actions">
          <button
            type="button"
            className="secondary-button"
            title="管理远程服务器文件"
            onClick={() => setShowFileManagerModal(true)}
          >
            <FolderOpen size={15} />
            文件管理
          </button>

          <button
            type="button"
            className="secondary-button"
            title="远程服务器配置"
            onClick={() => setShowSettingsModal(true)}
          >
            <Settings size={15} />
            设置
          </button>

          {onAskSaki && (
            <button
              type="button"
              className="secondary-button saki-gradient-btn"
              title="请求 Saki 分析与巡检远程服务器"
              onClick={() =>
                onAskSaki(
                  `请帮我巡检并分析远程服务器「${node.name}」(${node.host}:${node.port}) 的健康状态、系统负载及根目录文件结构。`
                )
              }
            >
              <Sparkles size={15} />
              问 Saki
            </button>
          )}

          {onCreateInstance && (
            <button type="button" className="primary-button" onClick={onCreateInstance}>
              <Plus size={15} />
              创建托管实例
            </button>
          )}
        </div>
      </header>

      <p className="ssh-server-description">
        直接操作远程服务器，使用 SSH 登录账号的权限和默认目录。内置 Linux 实时性能监控探针及文件浏览器。
      </p>

      <div className="ssh-workspace-body">
        {/* Left main area: Multi-tab SSH Terminals */}
        <div className="ssh-workspace-main">
          {!canViewTerminal ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <p role="status">当前账号没有终端访问权限，请联系管理员分配终端权限。</p>
            </div>
          ) : (
            <>
              <div className="ssh-server-tabs" role="tablist" aria-label="SSH 终端">
                {tabs.map((tab) => (
                  <div
                    className={`ssh-server-tab ${activeTab === tab.id ? "is-active" : ""}`}
                    key={tab.id}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      aria-controls={`ssh-terminal-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <Terminal size={14} />
                      {tab.label}
                    </button>
                    <button
                      type="button"
                      title={`关闭${tab.label}`}
                      aria-label={`关闭${tab.label}`}
                      onClick={() => closeTab(tab.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="icon-button mini"
                  title="新建 SSH 终端"
                  onClick={addTab}
                >
                  <Plus size={16} />
                </button>
              </div>

              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  id={`ssh-terminal-${tab.id}`}
                  role="tabpanel"
                  className="ssh-server-terminal-panel"
                  hidden={activeTab !== tab.id}
                >
                  <SshTerminal token={token} nodeId={node.id} active={activeTab === tab.id} />
                </div>
              ))}

              {!tabs.length && (
                <div style={{ margin: "auto", padding: 24, textAlign: "center" }}>
                  <p>终端已关闭，服务器连接仍保存在列表中。</p>
                  <button type="button" className="primary-button" onClick={addTab}>
                    <Terminal size={15} />
                    打开终端
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right sidebar: Real-time Telemetry & Probe Card */}
        <div className="ssh-workspace-sidebar">
          <ServerProcessProbeCard node={node} token={token} />
        </div>
      </div>

      {/* Fullscreen File Manager Modal */}
      {showFileManagerModal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="glass-modal-backdrop"
              onClick={() => setShowFileManagerModal(false)}
            >
              <div
                className="glass-modal-container file-manager-fullscreen-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="glass-modal-header">
                  <div className="modal-title-wrap">
                    <div className="modal-title-icon-badge">
                      <FolderOpen size={20} />
                    </div>
                    <div>
                      <h3 className="modal-title">服务器文件管理</h3>
                      <span className="modal-subtitle">
                        {node.name} · {node.host} · /
                      </span>
                    </div>
                  </div>
                  <button
                    className="icon-button mini modal-close-btn"
                    type="button"
                    onClick={() => setShowFileManagerModal(false)}
                    title="关闭"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="glass-modal-body file-manager-fullscreen-body">
                  <FileManager
                    token={token}
                    instance={syntheticInstance}
                    onSakiFileDragChange={onSakiFileDragChange}
                    onSakiInstanceFileDrop={handleSakiInstanceFileDrop}
                    darkMode={darkMode}
                    onClose={() => setShowFileManagerModal(false)}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* Server Settings Modal */}
      {showSettingsModal && typeof document !== "undefined" ? (
        <SshServerSettingsModal
          open={showSettingsModal}
          node={node}
          token={token}
          onClose={() => setShowSettingsModal(false)}
          onUpdated={(updated) => {
            onUpdateNode?.(updated);
          }}
          onDeleted={(id) => {
            onDeleteNode?.(id);
          }}
        />
      ) : null}
    </section>
  );
}
