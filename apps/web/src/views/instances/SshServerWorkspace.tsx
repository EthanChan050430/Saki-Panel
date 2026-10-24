import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowRight,
  ChevronLeft,
  Copy,
  FolderOpen,
  History,
  Maximize2,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  X
} from "lucide-react";
import type { ManagedNode, ManagedInstance } from "@webops/shared";
import { SshTerminal, type SshTerminalActions } from "../../components/terminal/SshTerminal.js";
import { ServerProcessProbeCard } from "./ServerProcessProbeCard.js";
import { SshServerSettingsModal } from "./SshServerSettingsModal.js";
import { SshSystemInfoModal } from "./SshSystemInfoModal.js";
import { FileManager } from "../../components/file-manager/FileManager.js";
import { LiquidGlassContainer } from "../../components/common/LiquidGlass.js";
import { formatDate } from "../../utils/path.js";
import {
  readTerminalInputHistory,
  appendTerminalInputHistory
} from "../../components/terminal/terminalHistory.js";
import {
  nextTerminalAutocompleteValue,
  type TerminalAutocompleteState
} from "../../components/terminal/WebTerminal.js";
import { NodeStatusPill } from "../../components/common/CommonUI.js";

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
  const [showSystemInfoModal, setShowSystemInfoModal] = useState(false);
  const [activeTerminalActions, setActiveTerminalActions] = useState<SshTerminalActions | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<"connecting" | "connected" | "closed" | "error">("connecting");
  const [terminalReadOnly, setTerminalReadOnly] = useState(false);

  const [terminalCmd, setTerminalCmd] = useState("");
  const [terminalHistoryIndex, setTerminalHistoryIndex] = useState<number | null>(null);
  const [terminalHistoryDraft, setTerminalHistoryDraft] = useState("");
  const [terminalAutocompleteState, setTerminalAutocompleteState] = useState<TerminalAutocompleteState | null>(null);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  const [historyMenuPos, setHistoryMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const historyBtnRef = useRef<HTMLButtonElement | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 640
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const historyNodeKey = `node:${node.id}`;
  const historyList = readTerminalInputHistory(historyNodeKey);

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

  const toggleHistoryMenu = useCallback((e?: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setShowHistoryMenu((prev) => {
      const next = !prev;
      if (next && historyBtnRef.current) {
        const rect = historyBtnRef.current.getBoundingClientRect();
        const isMobile = window.innerWidth <= 768;
        const popoverWidth = Math.min(340, window.innerWidth - 24);
        setHistoryMenuPos({
          left: isMobile
            ? Math.max(12, Math.round((window.innerWidth - popoverWidth) / 2))
            : Math.max(12, Math.min(window.innerWidth - 352, rect.left - 6)),
          bottom: Math.max(12, window.innerHeight - rect.top + 8),
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!showHistoryMenu) return;
    const handlePointerDown = (event: MouseEvent | PointerEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        (target as Element).closest?.(".terminal-history-btn") ||
        (target as Element).closest?.(".terminal-history-wrap") ||
        (target as Element).closest?.(".terminal-history-popover")
      ) {
        return;
      }
      setShowHistoryMenu(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showHistoryMenu]);

  const handleSendCommand = (cmdToSend?: string) => {
    const cmd = (cmdToSend ?? terminalCmd).trim();
    if (!cmd) return;
    if (!activeTerminalActions?.sendCommand(cmd)) return;
    appendTerminalInputHistory(historyNodeKey, cmd);
    setTerminalCmd("");
    setTerminalHistoryIndex(null);
    setTerminalHistoryDraft("");
    setTerminalAutocompleteState(null);
    setShowHistoryMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
      return;
    }
    const history = readTerminalInputHistory(historyNodeKey);

    if (e.key === "Tab") {
      e.preventDefault();
      const next = nextTerminalAutocompleteValue(terminalCmd, history, terminalAutocompleteState);
      if (next) {
        setTerminalCmd(next.value);
        setTerminalAutocompleteState(next.state);
      }
      return;
    }

    setTerminalAutocompleteState(null);

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      if (terminalHistoryIndex === null) {
        setTerminalHistoryDraft(terminalCmd);
        const nextIdx = history.length - 1;
        setTerminalHistoryIndex(nextIdx);
        setTerminalCmd(history[nextIdx] ?? "");
      } else if (terminalHistoryIndex > 0) {
        const nextIdx = terminalHistoryIndex - 1;
        setTerminalHistoryIndex(nextIdx);
        setTerminalCmd(history[nextIdx] ?? "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (terminalHistoryIndex === null) return;
      if (terminalHistoryIndex < history.length - 1) {
        const nextIdx = terminalHistoryIndex + 1;
        setTerminalHistoryIndex(nextIdx);
        setTerminalCmd(history[nextIdx] ?? "");
      } else {
        setTerminalHistoryIndex(null);
        setTerminalCmd(terminalHistoryDraft);
      }
    }
  };

  const syntheticInstance = createNodeSyntheticInstance(node);
  const activeTabItem = tabs.find((t) => t.id === activeTab);

  return (
    <div className="ssh-server-workspace">
      {/* 主布局 (Instance Master Layout) */}
      <div className="instance-master-layout">
        {/* 左侧：终端栏 (Terminal Column) */}
        <section className="instance-terminal-col">
          <div className="glass-panel instance-terminal-box">
            {/* 顶栏 (Topbar matching instance terminal topbar) */}
            <div className="instance-terminal-topbar">
              <div className="terminal-topbar-left">
                <button
                  type="button"
                  className="glass-back-button"
                  title="返回服务器与实例列表"
                  aria-label="返回服务器与实例列表"
                  onClick={onBack}
                >
                  <ChevronLeft size={16} />
                  <span className="back-btn-label">返回列表</span>
                </button>
                <div className="ssh-topbar-node-badge">
                  <Server size={14} className="ssh-topbar-icon" />
                  <span className="ssh-topbar-name" title={node.name}>{node.name}</span>
                  <NodeStatusPill status={node.status} />
                </div>
              </div>
              <div className="terminal-topbar-right">
                <div className="terminal-topbar-actions">
                  <button
                    className="icon-button mini"
                    title="清空终端"
                    type="button"
                    onClick={() => activeTerminalActions?.clear()}
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    className="icon-button mini"
                    title="重新连接 SSH"
                    type="button"
                    onClick={() => activeTerminalActions?.reconnect()}
                  >
                    <RefreshCw size={15} />
                  </button>
                  <button
                    className="icon-button mini"
                    title="复制终端选中文本 / 日志"
                    type="button"
                    onClick={() => {
                      if (activeTerminalActions?.extractOrCopyLogs) {
                        activeTerminalActions.extractOrCopyLogs();
                      } else {
                        activeTerminalActions?.copySelection();
                      }
                    }}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-button mini terminal-expand-btn"
                    title="全屏终端"
                    type="button"
                    onClick={() => activeTerminalActions?.toggleFullscreen()}
                  >
                    <Maximize2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button mini new-shell-btn"
                    title="新建 SSH 终端"
                    onClick={addTab}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="mac-dots">
                  <span className="dot red" />
                  <span className="dot yellow" />
                  <span className="dot green" />
                </div>
              </div>
            </div>

            {/* 标签栏 (Tabstrip matching instance terminal tabstrip) */}
            {tabs.length > 1 && (
              <div className="terminal-tabstrip" role="tablist">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTab;
                  return (
                    <div
                      key={tab.id}
                      role="tab"
                      aria-selected={isActive}
                      className={`terminal-tab ${isActive ? "active" : ""}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <Terminal size={13} />
                      <span className="tab-label">{tab.label}</span>
                      {tabs.length > 1 && (
                        <button
                          type="button"
                          className="tab-close"
                          title={`关闭${tab.label}`}
                          aria-label={`关闭${tab.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 终端展示容器 (Terminal Screen Container) */}
            <div className="terminal-container">
              {!canViewTerminal ? (
                <div className="terminal-no-permission">
                  当前账号没有终端访问权限，请联系管理员分配终端权限。
                </div>
              ) : (
                tabs.map((tab) => (
                  <div
                    key={tab.id}
                    id={`ssh-terminal-${tab.id}`}
                    role="tabpanel"
                    className={`terminal-wrapper ${activeTab === tab.id ? "active" : ""}`}
                    style={{
                      display: activeTab === tab.id ? "flex" : "none",
                      height: "100%",
                      flexDirection: "column"
                    }}
                  >
                    <SshTerminal
                      token={token}
                      nodeId={node.id}
                      active={activeTab === tab.id}
                      hideToolbar={true}
                      onAskSaki={onAskSaki}
                      onMountTerminalActions={activeTab === tab.id ? setActiveTerminalActions : undefined}
                      onStatusChange={
                        activeTab === tab.id
                          ? (s, ro) => {
                              setTerminalStatus(s);
                              setTerminalReadOnly(ro);
                            }
                          : undefined
                      }
                    />
                  </div>
                ))
              )}

              {!tabs.length && (
                <div style={{ margin: "auto", padding: 24, textAlign: "center" }}>
                  <p>终端已关闭，服务器连接仍保存在列表中。</p>
                  <button type="button" className="primary-button" onClick={addTab}>
                    <Terminal size={15} />
                    打开终端
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 实例风格的底部输入框 (Terminal Bottom Command Row matching instance) */}
          {canViewTerminal ? (
            <form
              className="terminal-command-row"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCommand();
              }}
            >
              <LiquidGlassContainer
                className="terminal-input-wrap"
                displacementScale={100}
                zoom={1.20}
                refractionIntensity={1.2}
                blurAmount={0}
                saturation={108}
                cornerRadius={24}
                mode="shader"
              >
                <div className="terminal-history-wrap">
                  <button
                    ref={historyBtnRef}
                    className="terminal-history-btn"
                    type="button"
                    title="历史命令"
                    onClick={toggleHistoryMenu}
                  >
                    <History size={17} />
                  </button>

                  {showHistoryMenu && historyMenuPos && typeof document !== "undefined" && createPortal(
                    <div
                      className="glass-panel terminal-history-popover"
                      style={{
                        left: historyMenuPos.left,
                        bottom: historyMenuPos.bottom,
                      }}
                    >
                      <div className="terminal-history-header">
                        <span>历史命令</span>
                        <span className="terminal-history-count">
                          {historyList.length} 条
                        </span>
                      </div>
                      <div className="terminal-history-list">
                        {historyList.length === 0 ? (
                          <div className="terminal-history-empty">暂无历史命令</div>
                        ) : (
                          historyList.slice().reverse().map((hCmd, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className="terminal-history-item"
                              title={hCmd}
                              onClick={() => {
                                setTerminalCmd(hCmd);
                                setShowHistoryMenu(false);
                              }}
                            >
                              <span className="history-cmd-text">{hCmd}</span>
                              <span
                                className="history-send-tag"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSendCommand(hCmd);
                                }}
                                title="直接执行"
                              >
                                执行 ↵
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>

                <input
                  className="terminal-cmd-input"
                  style={{
                    background: "transparent",
                    backgroundColor: "transparent",
                    backdropFilter: "none",
                    WebkitBackdropFilter: "none",
                    border: "none",
                    boxShadow: "none",
                    outline: "none",
                  }}
                  value={terminalCmd}
                  onChange={(e) => {
                    setTerminalCmd(e.target.value);
                    setTerminalHistoryIndex(null);
                    setTerminalAutocompleteState(null);
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={!canViewTerminal}
                  placeholder={
                    !canViewTerminal
                      ? "无终端访问权限"
                      : isMobile
                      ? `发送命令到 ${activeTabItem?.label || "终端"}…`
                      : `输入命令按回车发送到 ${activeTabItem?.label || "终端"}，按 Tab 键自动补全，上下键切换历史`
                  }
                />

                <button
                  className="terminal-send-btn"
                  type="submit"
                  title="发送命令 (Enter)"
                  disabled={!canViewTerminal || !terminalCmd.trim()}
                >
                  <ArrowRight size={18} strokeWidth={2.4} />
                </button>
              </LiquidGlassContainer>
            </form>
          ) : null}
        </section>

        {/* 右侧边栏卡片组 (Master Sidebar Cards Column) */}
        <aside className="instance-sidebar-col">
          {/* 1. 服务器概要卡片 (Instance summary card) */}
          <div className="glass-panel instance-side-card instance-summary-card">
            <div className="instance-summary-header">
              <div className="summary-title-row">
                <h3 title={node.name}>{node.name}</h3>
              </div>
              <div className="summary-status-row">
                <span className={`status-badge mini ${node.status === "ONLINE" ? "online" : "offline"}`}>
                  {node.status === "ONLINE" ? "探针在线" : "离线"}
                </span>
                <span className="instance-program-badge">SSH 远程服务器</span>
              </div>
            </div>
            <div className="instance-summary-table">
              <div className="summary-row">
                <span className="summary-label">主机地址</span>
                <span className="summary-value" title={`${node.host}:${node.port}`}>
                  {node.host}:{node.port}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">系统架构</span>
                <span className="summary-value" title={`${node.os || "Linux"} (${node.arch || "x64"})`}>
                  {node.os || "Linux"} ({node.arch || "x64"})
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">连接端口</span>
                <span className="summary-value">{node.port}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">协议</span>
                <span className="summary-value">SSH</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">默认目录</span>
                <span className="summary-value" title="登录账号家目录 (~) 或根目录 (/)">
                  /
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">接入时间</span>
                <span className="summary-value">{formatDate(node.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* 2. 快捷操作卡片 (Instance actions panel card) */}
          <div className="glass-panel instance-side-card instance-actions-panel-card">
            <div className="quick-actions-square-grid">
              <button
                type="button"
                className="quick-action-square-btn action-files"
                title="管理远程服务器文件"
                onClick={() => setShowFileManagerModal(true)}
              >
                <div className="action-icon-circle files">
                  <FolderOpen size={18} />
                </div>
                <span className="action-text">文件管理</span>
              </button>

              <button
                type="button"
                className="quick-action-square-btn action-settings"
                title="远程服务器配置"
                onClick={() => setShowSettingsModal(true)}
              >
                <div className="action-icon-circle settings">
                  <Settings size={18} />
                </div>
                <span className="action-text">服务器设置</span>
              </button>

              <button
                type="button"
                className="quick-action-square-btn action-sysinfo"
                title="查看系统详情与硬件规格"
                onClick={() => setShowSystemInfoModal(true)}
              >
                <div className="action-icon-circle sysinfo">
                  <Activity size={18} />
                </div>
                <span className="action-text">系统信息</span>
              </button>

              {onAskSaki && (
                <button
                  type="button"
                  className="quick-action-square-btn action-saki"
                  title="向 Saki 咨询或诊断当前服务器"
                  onClick={() => onAskSaki(`请帮我分析或诊断远程服务器「${node.name}」(${node.host}) 的运行状况。`)}
                >
                  <div className="action-icon-circle saki">
                    <Sparkles size={18} />
                  </div>
                  <span className="action-text">问 Saki</span>
                </button>
              )}

              {onCreateInstance && (
                <button
                  type="button"
                  className="quick-action-square-btn action-start"
                  title="在此服务器上创建托管实例"
                  onClick={onCreateInstance}
                >
                  <div className="action-icon-circle start">
                    <Plus size={18} />
                  </div>
                  <span className="action-text">创建实例</span>
                </button>
              )}
            </div>
          </div>

          {/* 3. 实时性能与探针卡片 */}
          <ServerProcessProbeCard node={node} token={token} />
        </aside>
      </div>

      {/* Fullscreen File Manager Modal */}
      {showFileManagerModal && typeof document !== "undefined"
        ? createPortal(
            <div
              className="glass-modal-overlay"
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
      {showSettingsModal && typeof document !== "undefined" ? createPortal(
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
        />,
        document.body
      ) : null}

      {/* System Information Modal */}
      {showSystemInfoModal && typeof document !== "undefined" ? createPortal(
        <SshSystemInfoModal
          open={showSystemInfoModal}
          node={node}
          token={token}
          onClose={() => setShowSystemInfoModal(false)}
        />,
        document.body
      ) : null}
    </div>
  );
}
