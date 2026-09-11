import React from "react";
import {
  Activity,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Coins,
  Copy,
  CornerDownLeft,
  Cpu,
  Database,
  Download,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Gamepad2,
  Globe,
  HardDrive,
  Heart,
  History,
  Maximize2,
  MemoryStick,
  MicOff,
  Paintbrush,
  PhoneOff,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  UtensilsCrossed,
  Volume2,
  Wrench,
  X,
  XOctagon,
  Zap
} from "lucide-react";
import { sakiArtAssets } from "../../constants.js";
import { MetricTile } from "../../components/common/CommonUI.js";
import { SakiCharacterArt, getLocalizedFoodMenu } from "../../components/saki/SakiComponents.js";
import { usePanelLanguage } from "../../i18n/index.js";
import { wikiUi } from "./wikiLocalize.js";

/**
 * 通用图例包装器（带有专属的“图例演示 · 静态不可点击”标签与毛玻璃外框）
 */
export function WikiLegendWrapper({
  title,
  description,
  children,
  badgeText = "界面图例 · 静态展示"
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  badgeText?: string;
}) {
  const { language } = usePanelLanguage();
  const localizedTitle = wikiUi(language, title);
  const localizedDescription = description ? wikiUi(language, description) : undefined;
  const localizedBadge = wikiUi(language, badgeText);
  return (
    <figure className="wiki-legend-figure" aria-label={`${wikiUi(language, "图例")}: ${localizedTitle}`}>
      <div className="wiki-legend-header">
        <div className="wiki-legend-title-box">
          <span className="wiki-legend-badge">
            <span className="wiki-legend-badge-dot" />
            {localizedBadge}
          </span>
          <strong className="wiki-legend-title">{localizedTitle}</strong>
        </div>
        {localizedDescription && <p className="wiki-legend-desc">{localizedDescription}</p>}
      </div>

      {/* 核心演示容器：彻底禁用点击、鼠标交互与文本误选，保持纯静态图例体验 */}
      <div className="wiki-legend-stage pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
    </figure>
  );
}

/**
 * 实例快捷操作面板图例 (glass-panel instance-side-card instance-actions-panel-card)
 */
export function InstanceActionsMockup() {
  return (
    <WikiLegendWrapper
      title="实例快捷操作面板 (instance-actions-panel-card)"
      description="集成启动、重启、停机、强杀、在线文件、参数配置、计划任务及网络代理等核心管理入口"
    >
      <div className="glass-panel instance-side-card instance-actions-panel-card wiki-mock-card">
        <div className="quick-actions-square-grid">
          <button className="quick-action-square-btn action-start" type="button" tabIndex={-1}>
            <div className="action-icon-circle start">
              <Play size={18} />
            </div>
            <span className="action-text">启动</span>
          </button>

          <button className="quick-action-square-btn action-restart" type="button" tabIndex={-1}>
            <div className="action-icon-circle restart">
              <RotateCw size={18} />
            </div>
            <span className="action-text">重启</span>
          </button>

          <button className="quick-action-square-btn action-stop" type="button" tabIndex={-1}>
            <div className="action-icon-circle stop">
              <Square size={18} />
            </div>
            <span className="action-text">停止</span>
          </button>

          <button className="quick-action-square-btn action-kill" type="button" tabIndex={-1}>
            <div className="action-icon-circle kill">
              <XOctagon size={18} />
            </div>
            <span className="action-text">强杀</span>
          </button>

          <button className="quick-action-square-btn action-files" type="button" tabIndex={-1}>
            <div className="action-icon-circle files">
              <FolderOpen size={18} />
            </div>
            <span className="action-text">文件管理</span>
          </button>

          <button className="quick-action-square-btn action-settings" type="button" tabIndex={-1}>
            <div className="action-icon-circle settings">
              <Settings size={18} />
            </div>
            <span className="action-text">实例设置</span>
          </button>

          <button className="quick-action-square-btn action-tasks" type="button" tabIndex={-1}>
            <div className="action-icon-circle tasks">
              <Clock size={18} />
            </div>
            <span className="action-text">计划任务</span>
          </button>

          <button className="quick-action-square-btn action-proxy proxy-active" type="button" tabIndex={-1}>
            <div className="action-icon-circle proxy">
              <Globe size={18} />
              <span className="proxy-active-badge-dot" />
            </div>
            <span className="action-text">网络代理</span>
          </button>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 实例核心概要卡片图例 (instance-summary-card)
 */
export function InstanceSummaryMockup() {
  return (
    <WikiLegendWrapper
      title="实例核心概要卡片 (instance-summary-card)"
      description="清晰呈现当前实例的实时状态、运行节点、工作目录、进程策略与端口映射"
    >
      <div className="glass-panel instance-side-card instance-summary-card wiki-mock-card">
        <div className="instance-summary-header">
          <div className="summary-title-row">
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>Minecraft-Paper-1.20</h3>
          </div>
          <div className="summary-status-row" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} />
              运行中 (Online)
            </span>
            <span className="instance-program-badge">Minecraft 游戏服</span>
            <span className="instance-program-badge watch-on" style={{ background: "rgba(255,117,172,0.15)", color: "#ff75ac", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
              Saki 值班中
            </span>
          </div>
        </div>

        <div className="instance-summary-table" style={{ display: "grid", gap: "8px", fontSize: "13px" }}>
          <div className="summary-row" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="summary-label" style={{ color: "var(--text-muted, #64748b)" }}>所属节点</span>
            <span className="summary-value" style={{ fontWeight: 600 }}>node-shanghai-01 (主节点)</span>
          </div>
          <div className="summary-row" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="summary-label" style={{ color: "var(--text-muted, #64748b)" }}>工作目录</span>
            <span className="summary-value" style={{ fontFamily: "monospace", fontSize: "12px" }}>/data/servers/minecraft/paper-1.20</span>
          </div>
          <div className="summary-row" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="summary-label" style={{ color: "var(--text-muted, #64748b)" }}>重启策略</span>
            <span className="summary-value" style={{ color: "#3b82f6", fontWeight: 600 }}>故障时自动重启 (On Failure)</span>
          </div>
          <div className="summary-row" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="summary-label" style={{ color: "var(--text-muted, #64748b)" }}>开机自启</span>
            <span className="summary-value" style={{ color: "#10b981", fontWeight: 600 }}>已开启</span>
          </div>
          <div className="summary-row" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="summary-label" style={{ color: "var(--text-muted, #64748b)" }}>端口映射</span>
            <span className="summary-value" style={{ fontFamily: "monospace" }}>25565 : 25565</span>
          </div>
          <div className="summary-row" style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="summary-label" style={{ color: "var(--text-muted, #64748b)" }}>上次退出码</span>
            <span className="summary-value" style={{ color: "#10b981" }}>0 (正常)</span>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 进程实时性能探针图例 (instance-probe-card)
 */
export function InstanceProbeMockup() {
  return (
    <WikiLegendWrapper
      title="进程实时性能探针卡片 (instance-probe-card)"
      description="实时采样实例 CPU / 物理内存占用比，绘制动态波动折线并记录稳定运行时长"
    >
      <div className="glass-panel instance-side-card instance-probe-card wiki-mock-card">
        <div className="probe-card-body">
          <div className="probe-kpi-grid">
            <div className="probe-kpi-tile">
              <div className="kpi-label">
                <Cpu size={12} />
                <span>CPU 占用</span>
              </div>
              <div className="kpi-value-row">
                <strong className="kpi-number">18.4%</strong>
                <span className="kpi-badge good">平稳</span>
              </div>
              <div className="probe-progress-bar">
                <div className="probe-progress-fill cpu-fill" style={{ width: "28%" }} />
              </div>
            </div>

            <div className="probe-kpi-tile">
              <div className="kpi-label">
                <HardDrive size={12} />
                <span>物理内存</span>
              </div>
              <div className="kpi-value-row">
                <strong className="kpi-number">2.18 GB</strong>
                <span className="kpi-badge good">健康</span>
              </div>
              <div className="probe-progress-bar">
                <div className="probe-progress-fill memory-fill" style={{ width: "54%" }} />
              </div>
            </div>

            <div className="probe-kpi-tile">
              <div className="kpi-label">
                <Clock size={12} />
                <span>连续运行时长</span>
              </div>
              <div className="kpi-value-row">
                <strong className="kpi-number">48:15:32</strong>
                <span className="kpi-badge good">守护中</span>
              </div>
            </div>

            <div className="probe-kpi-tile">
              <div className="kpi-label">
                <Zap size={12} />
                <span>进程 PID</span>
              </div>
              <div className="kpi-value-row">
                <strong className="kpi-number">#14209</strong>
                <span className="kpi-badge good">Active</span>
              </div>
            </div>
          </div>

          {/* 仿真折线图 */}
          <div style={{ marginTop: "14px", position: "relative", height: "46px", width: "100%" }}>
            <svg
              viewBox="0 0 280 44"
              style={{ width: "100%", height: "100%", overflow: "visible" }}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="mockProbeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff75ac" stopOpacity="0.38" />
                  <stop offset="100%" stopColor="#ff75ac" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d="M 0,44 L 0,28 L 24,24 L 48,32 L 72,18 L 96,22 L 120,15 L 144,20 L 168,14 L 192,26 L 216,18 L 240,12 L 264,16 L 280,14 L 280,44 Z"
                fill="url(#mockProbeGradient)"
              />
              <path
                d="M 0,28 L 24,24 L 48,32 L 72,18 L 96,22 L 120,15 L 144,20 L 168,14 L 192,26 L 216,18 L 240,12 L 264,16 L 280,14"
                fill="none"
                stroke="#ff75ac"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 网页终端控制台图例 (TerminalConsoleMockup)
 */
export function TerminalConsoleMockup() {
  return (
    <WikiLegendWrapper
      title="Web 终端控制台 (instance-terminal-box)"
      description="基于 xterm.js 与 PTY，支持多终端 Tab、Minecraft 专属颜色代码、快捷软键盘与命令发送栏"
    >
      <div className="glass-panel instance-terminal-box wiki-mock-card">
        {/* Topbar */}
        <div className="instance-terminal-topbar">
          <div className="terminal-topbar-left">
            <button className="glass-back-button" type="button" tabIndex={-1} aria-label="实例列表">
              <ChevronLeft size={16} />
              <span className="back-btn-label">实例列表</span>
            </button>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(16,185,129,0.15)",
                color: "#10b981",
                fontSize: 11,
                fontWeight: 700
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
              运行中 (Online)
            </span>
          </div>
          <div className="terminal-topbar-right">
            <div className="terminal-topbar-actions">
              <button className="icon-button mini" title="清空" type="button" tabIndex={-1}>
                <Trash2 size={15} />
              </button>
              <button className="icon-button mini" title="重连" type="button" tabIndex={-1}>
                <RefreshCw size={15} />
              </button>
              <button className="icon-button mini" title="复制终端文本 / 查看日志" type="button" tabIndex={-1}>
                <Copy size={15} />
              </button>
              <button className="icon-button mini" title="沉浸终端" type="button" tabIndex={-1}>
                <Maximize2 size={15} />
              </button>
              <button className="icon-button mini new-shell-btn" title="新建终端 (Shell)" type="button" tabIndex={-1}>
                <Plus size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Terminal Tab Strip */}
        <div className="terminal-tabs-strip" style={{ display: "flex", gap: "4px", padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.12)" }}>
          <div className="terminal-tab active" style={{ padding: "4px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.1)", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="tab-label">终端 (主进程)</span>
          </div>
          <div className="terminal-tab" style={{ padding: "4px 12px", borderRadius: "6px", background: "transparent", fontSize: "12px", color: "var(--text-muted, #64748b)", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="tab-label">Shell 1</span>
            <span style={{ opacity: 0.6, fontSize: "11px" }}>×</span>
          </div>
        </div>

        {/* Terminal Container & Output */}
        <div className="terminal-container">
          <div className="terminal-wrapper active" style={{ display: "block" }}>
            <div className="terminal-panel">
              <div
                className="xterm-host"
                style={{
                  padding: "12px 14px",
                  fontFamily: "Consolas, Monaco, monospace",
                  fontSize: "12.5px",
                  lineHeight: 1.6,
                  background: "rgba(10, 14, 26, 0.95)",
                  color: "#e2e8f0",
                  minHeight: "180px",
                  borderRadius: "8px"
                }}
              >
                <div style={{ color: "#64748b" }}>[14:20:00 INFO]: Loading libraries, please wait...</div>
                <div style={{ color: "#64748b" }}>[14:20:02 INFO]: Starting minecraft server version 1.20.4</div>
                <div style={{ color: "#10b981" }}>[14:20:03 INFO]: Loading properties from server.properties</div>
                <div style={{ color: "#38bdf8" }}>[14:20:04 INFO]: Default game type: SURVIVAL</div>
                <div style={{ color: "#facc15" }}>[14:20:06 INFO]: Preparing level "world" ... 100% [Spawn Ready]</div>
                <div style={{ color: "#ff75ac" }}>[14:20:07 INFO] [Saki Watch]: 🛡️ Native crash watchdog attached (PID 14209)</div>
                <div style={{ color: "#4ade80", fontWeight: 700 }}>[14:20:08 INFO]: Done (5.621s)! For help, type "help"</div>
                <div style={{ color: "#f87171" }}>[14:20:25 WARN]: Can't keep up! Is the server overloaded? Running 2150ms behind</div>
              </div>

              {/* Mobile Shortcut Keys */}
              <div className="terminal-mobile-keys" role="toolbar" style={{ display: "flex", gap: "4px", padding: "6px 8px", background: "rgba(0,0,0,0.18)", flexWrap: "wrap" }}>
                <button className="terminal-key-button" type="button" tabIndex={-1}>
                  <Copy size={12} style={{ marginRight: 3, verticalAlign: "middle" }} /> 文本
                </button>
                <button className="terminal-key-button" type="button" tabIndex={-1}>Tab</button>
                <button className="terminal-key-button terminal-key-modifier" type="button" tabIndex={-1}>Ctrl</button>
                <button className="terminal-key-button" type="button" tabIndex={-1}>Esc</button>
                <button className="terminal-key-button" type="button" tabIndex={-1}>↑</button>
                <button className="terminal-key-button" type="button" tabIndex={-1}>↓</button>
                <button className="terminal-key-button" type="button" tabIndex={-1}>←</button>
                <button className="terminal-key-button" type="button" tabIndex={-1}>→</button>
                <button className="terminal-key-button wide" type="button" tabIndex={-1}>Clear</button>
              </div>

              {/* Error Issue Alert with Saki Action */}
              <div
                className="terminal-issue"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "rgba(245, 158, 11, 0.12)",
                  borderTop: "1px solid rgba(245, 158, 11, 0.25)",
                  fontSize: "12px",
                  color: "#f59e0b"
                }}
              >
                <span>[Server thread/WARN]: Can't keep up! Is the server overloaded?</span>
                <span
                  className="small-button"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "rgba(255, 117, 172, 0.2)",
                    color: "#ff75ac",
                    fontWeight: 700,
                    fontSize: "11px"
                  }}
                >
                  <Sparkles size={12} />
                  问 Saki
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Command Input Row */}
        <form className="terminal-command-row" style={{ marginTop: 10 }}>
          <div className="terminal-input-wrap">
            <div className="terminal-history-wrap">
              <button
                className="terminal-history-btn"
                type="button"
                tabIndex={-1}
                title="历史命令"
                style={{ background: "transparent", border: "none", color: "var(--text-muted, #94a3b8)", display: "flex", alignItems: "center" }}
              >
                <History size={16} />
              </button>
            </div>
            <input
              className="terminal-command-input"
              value="say [公告] 服务器将于今晚例行维护"
              readOnly
              tabIndex={-1}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                color: "inherit",
                fontSize: "13px",
                padding: "0 8px"
              }}
            />
            <button
              className="terminal-send-btn"
              type="button"
              tabIndex={-1}
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "#ff75ac",
                border: "none",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              <CornerDownLeft size={14} />
            </button>
          </div>
        </form>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 在线文件管理器图例 (FileManagerMockup)
 */
export function FileManagerMockup() {
  return (
    <WikiLegendWrapper
      title="在线文件管理器 (File Manager & Monaco/CodeMirror)"
      description="树状目录层级浏览、大文件秒传分片、后台无损解压缩与配置文件即改即用"
    >
      <div className="wiki-mock-filemanager-card">
        {/* Breadcrumb path bar */}
        <div className="wiki-mock-fm-pathbar">
          <div className="fm-path-chips">
            <span className="fm-chip">/</span>
            <span className="fm-chip">instances</span>
            <span className="fm-chip">mc-paper-1.20</span>
            <span className="fm-chip active">plugins</span>
          </div>
          <div className="fm-quick-actions">
            <button type="button" className="fm-mini-btn" tabIndex={-1}>新建文件</button>
            <button type="button" className="fm-mini-btn" tabIndex={-1}>新建文件夹</button>
            <button type="button" className="fm-mini-btn primary" tabIndex={-1}>上传文件</button>
          </div>
        </div>

        {/* File table */}
        <div className="wiki-mock-fm-table">
          <div className="fm-row header">
            <span className="col-name">名称</span>
            <span className="col-size">大小</span>
            <span className="col-perms">权限</span>
            <span className="col-date">修改时间</span>
            <span className="col-ops">操作</span>
          </div>

          <div className="fm-row">
            <span className="col-name"><Folder size={14} className="folder-icon" /> EssentialsX</span>
            <span className="col-size">24 项</span>
            <span className="col-perms">drwxr-xr-x</span>
            <span className="col-date">2026-09-08 14:20</span>
            <span className="col-ops"><span className="op-tag">进入</span></span>
          </div>

          <div className="fm-row">
            <span className="col-name"><Folder size={14} className="folder-icon" /> CoreProtect</span>
            <span className="col-size">12 项</span>
            <span className="col-perms">drwxr-xr-x</span>
            <span className="col-date">2026-09-08 15:10</span>
            <span className="col-ops"><span className="op-tag">进入</span></span>
          </div>

          <div className="fm-row highlight">
            <span className="col-name"><FileCode size={14} className="file-icon" /> config.yml</span>
            <span className="col-size">8.42 KB</span>
            <span className="col-perms">-rw-r--r--</span>
            <span className="col-date">2026-09-09 11:32</span>
            <span className="col-ops">
              <span className="op-tag edit">在线编辑</span>
              <span className="op-tag">下载</span>
            </span>
          </div>

          <div className="fm-row">
            <span className="col-name"><FileText size={14} className="file-icon" /> server.properties</span>
            <span className="col-size">1.85 KB</span>
            <span className="col-perms">-rw-r--r--</span>
            <span className="col-date">2026-09-09 16:45</span>
            <span className="col-ops">
              <span className="op-tag edit">在线编辑</span>
            </span>
          </div>

          <div className="fm-row">
            <span className="col-name"><Download size={14} className="zip-icon" /> backup-snapshot.zip</span>
            <span className="col-size">245.8 MB</span>
            <span className="col-perms">-rw-r--r--</span>
            <span className="col-date">2026-09-10 03:00</span>
            <span className="col-ops">
              <span className="op-tag unzip">一键解压</span>
            </span>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * Saki AI 故障诊断与 Git Diff 补丁审核图例 (SakiPatchDiffMockup)
 */
export function SakiPatchDiffMockup() {
  return (
    <WikiLegendWrapper
      title="Saki AI 故障现场自愈与 Git Diff 补丁审核"
      description="Saki Watch 自动提取异常退出指纹，AI 原生沙盒诊断生成配置文件比对，必须经由人工审核授权后方可执行应用"
    >
      <div className="wiki-mock-saki-card">
        <div className="wiki-mock-saki-header">
          <div className="saki-avatar-bubble">
            <Bot size={18} className="saki-bot-icon" />
          </div>
          <div>
            <div className="saki-name-row">
              <strong>Saki 智能体 · 崩溃自愈现场</strong>
              <span className="saki-badge-incident">事故已锁定 (Exit Code: 1)</span>
            </div>
            <p className="saki-diagnose-summary">
              “服主别慌，我抓取了崩溃最后 20 行日志：发现端口 <code>25565</code> 已被外部进程占用导致绑定失败。我已拟定端口修改补丁，请您核实：”
            </p>
          </div>
        </div>

        {/* Diff Container */}
        <div className="wiki-mock-diff-box">
          <div className="diff-header">
            <FileCode size={13} />
            <span>patch: server.properties (两行变更)</span>
          </div>
          <div className="diff-body">
            <div className="diff-line diff-context">
              <span className="diff-no">24</span>
              <span className="diff-sign"> </span>
              <span className="diff-text">motd=Welcome to Saki Panel Server</span>
            </div>
            <div className="diff-line diff-deleted">
              <span className="diff-no">25</span>
              <span className="diff-sign">-</span>
              <span className="diff-text">server-port=25565</span>
            </div>
            <div className="diff-line diff-added">
              <span className="diff-no">25</span>
              <span className="diff-sign">+</span>
              <span className="diff-text">server-port=25566</span>
            </div>
            <div className="diff-line diff-context">
              <span className="diff-no">26</span>
              <span className="diff-sign"> </span>
              <span className="diff-text">difficulty=normal</span>
            </div>
          </div>
        </div>

        {/* Action confirmation bar */}
        <div className="wiki-mock-saki-actions">
          <span className="saki-risk-level">
            <ShieldCheck size={14} />
            4 级安全防逃逸机制：人工审批后方生效，若重启再崩将自动回滚快照
          </span>
          <div className="saki-action-buttons">
            <button type="button" className="saki-btn-dismiss" tabIndex={-1}>
              拒绝
            </button>
            <button type="button" className="saki-btn-apply" tabIndex={-1}>
              <Check size={14} />
              批准并重启
            </button>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 分布式节点集群状态卡片图例 (NodeClusterMockup)
 */
export function NodeClusterMockup() {
  return (
    <WikiLegendWrapper
      title="分布式节点监控卡片 (Distributed Nodes & Daemon)"
      description="主控 (Panel) 与远程轻量守护 (Daemon) 密钥加密握手，毫秒级心跳与跨机资源调度"
    >
      <div className="wiki-mock-node-grid">
        <div className="wiki-mock-node-card">
          <div className="node-card-top">
            <div className="node-title-group">
              <Server size={18} className="node-icon" />
              <div>
                <strong>node-shanghai-master</strong>
                <span className="node-sub">192.168.1.100 · 本地主控节点</span>
              </div>
            </div>
            <span className="node-status-beacon online">
              <span className="beacon-ping" />
              在线 正常
            </span>
          </div>

          <div className="node-metrics-row">
            <div className="metric-item">
              <span className="label">心跳延迟</span>
              <strong className="val val-green">1.2 ms</strong>
            </div>
            <div className="metric-item">
              <span className="label">CPU 负载</span>
              <strong className="val">24.5% (8核)</strong>
            </div>
            <div className="metric-item">
              <span className="label">物理内存</span>
              <strong className="val">6.8G / 32G</strong>
            </div>
            <div className="metric-item">
              <span className="label">托管实例</span>
              <strong className="val val-accent">12 个</strong>
            </div>
          </div>
        </div>

        <div className="wiki-mock-node-card">
          <div className="node-card-top">
            <div className="node-title-group">
              <Server size={18} className="node-icon" />
              <div>
                <strong>node-hongkong-edge</strong>
                <span className="node-sub">47.242.xx.xx · 亚太边缘节点</span>
              </div>
            </div>
            <span className="node-status-beacon online">
              <span className="beacon-ping" />
              在线 正常
            </span>
          </div>

          <div className="node-metrics-row">
            <div className="metric-item">
              <span className="label">心跳延迟</span>
              <strong className="val val-green">26 ms</strong>
            </div>
            <div className="metric-item">
              <span className="label">CPU 负载</span>
              <strong className="val">14.1% (4核)</strong>
            </div>
            <div className="metric-item">
              <span className="label">物理内存</span>
              <strong className="val">3.2G / 16G</strong>
            </div>
            <div className="metric-item">
              <span className="label">托管实例</span>
              <strong className="val val-accent">5 个</strong>
            </div>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 内置数据库管家图例 (DatabaseProbeMockup)
 */
export function DatabaseProbeMockup() {
  return (
    <WikiLegendWrapper
      title="内置数据库管家 (SQLite, MySQL, PostgreSQL, Redis)"
      description="无需单独安装第三方数据库管理工具，直接在面板内检视数据表、结构与执行 SQL 查询"
    >
      <div className="wiki-mock-db-card">
        <div className="db-header-row">
          <div className="db-title-box">
            <Database size={16} className="db-icon" />
            <strong>Production MySQL Database</strong>
            <span className="db-engine-badge">MySQL 8.0</span>
          </div>
          <span className="db-conn-status">连接池正常 (5/20)</span>
        </div>

        <div className="db-tables-strip">
          <span className="db-table-pill active">saki_instances (8 记录)</span>
          <span className="db-table-pill">saki_users (14 记录)</span>
          <span className="db-table-pill">saki_audit_events (1,240 记录)</span>
          <span className="db-table-pill">saki_incidents (3 记录)</span>
        </div>

        <div className="db-query-mock">
          <code>SELECT id, name, status, cpu_limit, memory_limit FROM saki_instances WHERE status = 'running';</code>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 用户角色 RBAC 与积分配额图例 (RbacQuotaMockup)
 */
export function RbacQuotaMockup() {
  return (
    <WikiLegendWrapper
      title="多角色权限分配与用户积分配额"
      description="细粒度实例授权协作，并配备用户算力/内存上限积分兑换体系"
    >
      <div className="wiki-mock-rbac-card">
        <div className="rbac-profile-row">
          <div className="rbac-user-info">
            <div className="rbac-avatar">U</div>
            <div>
              <strong>developer_ethan</strong>
              <span className="rbac-role-pill admin">管理员 (Admin)</span>
            </div>
          </div>
          <div className="rbac-points-badge">
            <Coins size={14} />
            <span>可用积分: <strong>2,450</strong> 点</span>
          </div>
        </div>

        <div className="rbac-limits-grid">
          <div className="limit-box">
            <span className="limit-title">允许创建实例数</span>
            <span className="limit-num">8 / 10 个</span>
          </div>
          <div className="limit-box">
            <span className="limit-title">最大内存分配上限</span>
            <span className="limit-num">16.0 GB</span>
          </div>
          <div className="limit-box">
            <span className="limit-title">终端操作权限</span>
            <span className="limit-num ok">已授权</span>
          </div>
          <div className="limit-box">
            <span className="limit-title">文件写权限</span>
            <span className="limit-num ok">已授权</span>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * Saki AI 智能体悬浮交互与多模态工作区图例 (SakiAssistantWindowMockup)
 */
export function SakiAssistantWindowMockup() {
  return (
    <WikiLegendWrapper
      title="Saki AI 智能体工作区 (Saki Floating Chat & Agent Workspace)"
      description="支持上下文自动注入、@智能实例与文件引用、40+ 运维工具自主执行、多模态截图诊断与躺平模式"
    >
      <div className="wiki-mock-saki-window">
        {/* Saki Window Header */}
        <div className="saki-win-header">
          <div className="saki-win-title-box">
            <div className="saki-avatar-bubble">
              <Bot size={17} />
            </div>
            <div>
              <div className="saki-win-name-row">
                <strong>Saki</strong>
                <span className="saki-win-mode-badge">智能体模式</span>
                <span className="saki-win-lie-badge">询问确认</span>
              </div>
              <span className="saki-win-sub">当前实例 · 已附加上下文</span>
            </div>
          </div>
          <div className="saki-win-meta">
            <span className="saki-model-pill">llama3.2 (本地 Ollama 零花费)</span>
            <span className="saki-token-counter">1,840 tokens</span>
          </div>
        </div>

        {/* Context bar */}
        <div className="saki-win-context-bar">
          <span className="ctx-dot" />
          <span className="ctx-text">已附加上下文 · Minecraft-Paper-1.20 · 输入 @ 可引用已上传的参考图</span>
        </div>

        {/* Chat message bubbles */}
        <div className="saki-win-messages">
          <div className="msg-user">
            <div className="msg-bubble user">
              @mc-paper-1.20 帮我排查下为什么玩家进服会偶发超时掉线？顺便给我一套高并发启动参数。
            </div>
          </div>

          <div className="msg-saki">
            <div className="saki-tool-call-banner">
              <span className="tool-tag">工具调用</span>
              <code>searchFiles("latest.log", "timed out")</code>
              <span className="tool-status">✓ 命中 4 处 GC 停顿记录</span>
            </div>

            <div className="saki-tool-call-banner">
              <span className="tool-tag">技能匹配</span>
              <code>readSkill("minecraft-aikar-jvm-flags")</code>
              <span className="tool-status">✓ 载入官方性能参数规范</span>
            </div>

            <div className="msg-bubble saki">
              <p style={{ margin: "0 0 8px" }}>
                服主，分析完成！日志显示进服超时是因为默认的 ParallelGC 触发了 <strong>1.8 秒的 Full GC 全局停顿</strong>，心跳包超时导致客户端断连。
              </p>
              <p style={{ margin: "0 0 8px" }}>
                建议采用我为您调优的 <strong>Aikar's G1GC 旗舰参数</strong>，大幅消除停顿：
              </p>
              <div className="saki-code-quote">
                <code>-XX:+UseG1GC -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50</code>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--text-muted, #64748b)" }}>
                💡 提示：点击下方推荐快捷指令，我可自动为您修改并备份原启动脚本。
              </p>
            </div>

            {/* Quick Action Prompt Chips */}
            <div className="saki-prompt-chips-row">
              <span className="saki-prompt-chip">批准这次修改</span>
              <span className="saki-prompt-chip">先只给计划</span>
              <span className="saki-prompt-chip">去陪伴房间看看她</span>
            </div>
          </div>
        </div>

        {/* Composer Bar */}
        <div className="saki-win-composer">
          <div className="composer-mention-hint">
            <span>输入 <code>@</code> 引用已上传的参考图 · Ctrl+Enter 发送</span>
          </div>
          <div className="composer-input-row">
            <div className="composer-text-area">
              <span className="placeholder-text">问 Saki 当前实例里的问题</span>
            </div>
            <div className="composer-actions">
              <span className="composer-btn" title="语音输入">🎙️</span>
              <span className="composer-btn" title="网页截图">🖼️</span>
              <button type="button" className="composer-send-btn" tabIndex={-1}>发送</button>
            </div>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 陪伴房间 + 好感度 + 投喂（原版 saki-video-pane 样式）
 */
export function SakiCompanionMockup() {
  const { language } = usePanelLanguage();
  const foodMenu = getLocalizedFoodMenu(language);
  const favTitle =
    language === "en-US" ? "Affection Lv.3 · Intimate" : language === "zh-TW" ? "好感度 Lv.3 · 親密" : language === "ja-JP" ? "親密度 Lv.3 · 親密" : "好感度 Lv.3 · 亲密";
  const pokeHint =
    language === "en-US"
      ? "Tap to poke me, hold to speak and I'll copy you ♪"
      : language === "zh-TW"
        ? "點按戳戳我，長按說話我會學你～ ♪"
        : language === "ja-JP"
        ? "タップでつついて、長押しで話すと真似するよ～ ♪"
        : "点按戳戳我，长按说话我会学你～ ♪";
  const costUnit = language === "en-US" ? "pt" : language === "zh-TW" ? "點" : language === "ja-JP" ? "pt" : "分";
  return (
    <WikiLegendWrapper
      title="Saki 陪伴房间 · 好感度与投喂"
      description="左上角装修房间，右上角爱心看等级；底部麦克风、小游戏、投喂、挂断。点心可点选或拖到她身上。"
    >
      <div className="wiki-companion-stage">
        <div className="saki-video-pane wiki-saki-video-pane">
          <div className="saki-video-header">
            <div className="saki-video-header-left">
              <button className="saki-video-settings-btn" type="button" tabIndex={-1} title="装修房间 (自定义背景图)">
                <Paintbrush size={15} />
              </button>
            </div>
            <div className="saki-video-header-right">
              <div className="saki-video-favorability-badge wiki-fav-badge-open" title="好感度详情">
                <div className="saki-favorability-heart-wrap">
                  <Heart size={32} className="saki-favorability-heart fill-rose-500 text-rose-400" />
                  <span className="saki-favorability-heart-level">3</span>
                </div>
                <div className="saki-favorability-tooltip" role="tooltip">
                  <div className="tooltip-title">{favTitle}</div>
                  <div className="tooltip-exp-bar">
                    <div className="tooltip-exp-fill" style={{ width: "47%" }} />
                  </div>
                  <div className="tooltip-exp-nums">
                    <span>320 / 500 EXP</span>
                    <span>47%</span>
                  </div>
                </div>
                <span className="saki-favorability-gain-float">+25 EXP</span>
              </div>
              <button className="saki-video-close-btn" type="button" tabIndex={-1} title="关闭 Saki">
                <X size={15} />
              </button>
            </div>
          </div>

          <div className="saki-video-stage">
            <div className="saki-video-character-wrap mood-normal">
              <div className="saki-video-bubble">
                <div className="saki-video-bubble-content">
                  <span>{pokeHint}</span>
                </div>
              </div>
              <SakiCharacterArt mood="normal" activityMood="happy" />
              <div className="saki-video-carpet-shadow" aria-hidden="true" />
            </div>
          </div>

          <div className="saki-feed-drawer">
            <div className="saki-feed-items">
              {foodMenu.map((food) => (
                <button key={food.id} className="saki-feed-card" type="button" tabIndex={-1} title={`${food.name} (${food.cost} ${costUnit})`}>
                  <div className="saki-feed-card-img-wrap">
                    <img src={food.image} alt={food.name} draggable={false} />
                  </div>
                  <div className="saki-feed-card-info">
                    <span className="food-name">{food.name}</span>
                    <div className="food-meta">
                      <span className="food-cost">{food.cost}{costUnit}</span>
                      <span className="food-fav">+{food.favorability}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="saki-video-controls" role="toolbar">
            <button className="saki-video-btn" type="button" tabIndex={-1} title="开启麦克风 (语音输入)">
              <MicOff size={17} />
            </button>
            <button className="saki-video-btn" type="button" tabIndex={-1} title="星梦甜点接接乐 (小游戏赚取好感度与积分)">
              <Gamepad2 size={17} />
            </button>
            <button className="saki-video-btn active" type="button" tabIndex={-1} title="投喂 Saki (花费积分买食物提升好感度)">
              <UtensilsCrossed size={17} />
            </button>
            <button className="saki-video-btn hangup" type="button" tabIndex={-1} title="挂断视频通话">
              <PhoneOff size={17} />
            </button>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 星梦甜点接接乐（原版 saki-mini-game-overlay 样式）
 */
export function SakiMiniGameMockup() {
  return (
    <WikiLegendWrapper
      title="星梦甜点接接乐"
      description="30 秒内左右移动篮子接甜点、躲虫子。连击 5 次进入 FEVER 2X。结束后领取好感经验。"
    >
      <div className="wiki-companion-stage">
        <div className="saki-video-pane wiki-saki-video-pane">
          <div
            className="saki-mini-game-overlay wiki-game-overlay-static fever-active"
            style={{ backgroundImage: 'url("/assets/game/game_bg.webp")', position: "relative" }}
          >
            <div className="saki-game-fever-border" aria-hidden="true" />
            <div className="saki-game-header">
              <div className="saki-game-stat">
                <span className="stat-label">倒计时</span>
                <span className="stat-value timer">18s</span>
              </div>
              <div className="saki-game-stat">
                <span className="stat-label">得分</span>
                <span className="stat-value score">240</span>
              </div>
              <div className="saki-game-header-actions">
                <button className="saki-game-sound-btn" type="button" tabIndex={-1} title="静音">
                  <Volume2 size={15} />
                </button>
                <button className="saki-game-close-btn" type="button" tabIndex={-1} title="退出游戏">
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="saki-stage-combo-text fever">
              <span className="combo-fever-badge">FEVER 2X</span>
              <div className="combo-line">
                <span className="combo-num">6</span>
                <span className="combo-txt">COMBO</span>
              </div>
            </div>

            <div className="saki-game-item sweet" style={{ left: "18%", top: "28%" }}>
              <img src="/assets/game/star.webp" alt="心愿星" draggable={false} />
            </div>
            <div className="saki-game-item sweet" style={{ left: "48%", top: "22%" }}>
              <img src="/assets/game/caomeidafu.webp" alt="草莓大福" draggable={false} />
            </div>
            <div className="saki-game-item bug" style={{ left: "72%", top: "36%" }}>
              <img src="/assets/game/bug.webp" alt="调皮Bug" draggable={false} />
            </div>
            <div className="saki-game-item sweet" style={{ left: "34%", top: "52%" }}>
              <img src="/assets/game/donut.webp" alt="甜甜圈" draggable={false} />
            </div>

            <div className="saki-game-basket fever-glow" style={{ left: "46%", transform: "translateX(-50%)" }}>
              <img src="/assets/game/basket.webp" alt="接物盘" draggable={false} />
              <div className="saki-basket-glow-aura" />
            </div>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 顶栏积分 + 躺平的 Saki（原版 topbar 样式）
 */
export function TopbarCompanionMockup() {
  return (
    <WikiLegendWrapper
      title="顶栏陪伴区"
      description="左边积分徽章可点开明细；右边躺平的 Saki 单击唤醒，长按可拖走，拖回空位即可收纳。"
    >
      <div className="wiki-topbar-stage">
        <div className="topbar-inner topbar-companion-panel has-lie">
          <div className="topbar-points-badge" title="点击查看积分使用量与消耗明细">
            <Sparkles size={14} className="topbar-points-icon" />
            <span className="topbar-points-value">128</span>
            <span className="topbar-points-label">积分</span>
          </div>
          <div className="topbar-lie-slot">
            <button type="button" className="topbar-lie-character" tabIndex={-1} title="点击唤醒，长按拖到任意位置">
              <img src={sakiArtAssets.lie} alt="Saki" className="topbar-lie-image" draggable={false} />
            </button>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 概览四张指标卡（原版 metric-tile）
 */
export function DashboardMockup() {
  return (
    <WikiLegendWrapper
      title="概览指标卡"
      description="点开任意一张可看详情。在线节点显示在线数/总数，CPU / 内存 / 磁盘显示当前占用。"
    >
      <section className="metrics-grid wiki-metrics-grid">
        <MetricTile icon={<Server size={22} />} label="在线节点" value="2/2" tone="teal" />
        <MetricTile icon={<Cpu size={22} />} label="CPU" value="24%" tone="blue" />
        <MetricTile icon={<MemoryStick size={22} />} label="内存" value="41%" tone="amber" />
        <MetricTile icon={<HardDrive size={22} />} label="磁盘" value="63%" tone="gray" />
      </section>
    </WikiLegendWrapper>
  );
}

/**
 * 功能开关（原版 settings-switch-card）
 */
export function SettingsNavMockup() {
  return (
    <WikiLegendWrapper
      title="设置 · 功能开关"
      description="联网搜索、MCP 扩展、以及长按 Saki 时用的学说话变声引擎。"
    >
      <div className="settings-group active wiki-settings-mock">
        <div className="settings-group-title">
          <div className="settings-group-icon">
            <Wrench size={20} />
          </div>
          <div>
            <h3>功能开关</h3>
            <span>扩展能力</span>
          </div>
        </div>
        <div className="settings-group-content">
          <div className="settings-switch-card">
            <div className="settings-switch-info">
              <div className="settings-switch-title">
                <Globe size={18} className="settings-switch-icon" />
                <strong>联网搜索与网页内容提取</strong>
              </div>
              <span>允许 Saki 在回答技术问题或排查故障时自主检索最新互联网资料与官方文档。</span>
            </div>
            <label className="settings-switch-toggle">
              <input type="checkbox" defaultChecked readOnly tabIndex={-1} />
              <span className="settings-switch-slider" />
            </label>
          </div>
          <div className="settings-switch-card">
            <div className="settings-switch-info">
              <div className="settings-switch-title">
                <Zap size={18} className="settings-switch-icon" />
                <strong>Model Context Protocol (MCP)</strong>
              </div>
              <span>启用标准化 MCP 扩展工具与外部上下文集成协议，为 Saki 提供深度工具交互。</span>
            </div>
            <label className="settings-switch-toggle">
              <input type="checkbox" readOnly tabIndex={-1} />
              <span className="settings-switch-slider" />
            </label>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * Saki 值班收件箱（原版 incident-popover）
 */
export function IncidentInboxMockup() {
  return (
    <WikiLegendWrapper
      title="Saki 值班收件箱"
      description="顶栏铃铛点开后就是这里。先确认诊断才会消耗额度；改文件仍需你点批准。"
    >
      <div className="wiki-incident-stage">
        <div className="incident-popover wiki-incident-popover">
          <div className="incident-popover-header">
            <div className="incident-popover-title-wrap">
              <strong>Saki 值班</strong>
              <span className="incident-popover-pill">2 条未完成</span>
            </div>
            <div className="incident-popover-header-actions">
              <button type="button" className="incident-ignore-all-btn" tabIndex={-1} title="忽略当前分类下全部待处理事件（1 小时）">
                <CheckCheck size={12} />
                全部忽略
              </button>
              <button type="button" className="incident-popover-close" tabIndex={-1} title="关闭">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="incident-popover-main">
            <nav className="incident-category-nav">
              <button type="button" className="incident-category-item is-active" tabIndex={-1}>
                <span>全部</span>
                <span className="incident-category-count">2</span>
              </button>
              <button type="button" className="incident-category-item" tabIndex={-1}>
                <span>进程崩溃</span>
                <span className="incident-category-count">1</span>
              </button>
              <button type="button" className="incident-category-item" tabIndex={-1}>
                <span>磁盘告警</span>
                <span className="incident-category-count">1</span>
              </button>
            </nav>
            <div className="incident-popover-body">
              <div className="incident-section-label">待处理</div>
              <ul className="incident-list">
                <li className="incident-item">
                  <div className="incident-item-main">
                    <div className="incident-item-header-row">
                      <span className="incident-item-title">Minecraft-Paper-1.20</span>
                      <span className="incident-item-badges">
                        <span className="incident-badge-meta status-open">待确认</span>
                      </span>
                    </div>
                    <span className="incident-item-summary">等待你确认后才会消耗额度开始诊断。</span>
                  </div>
                  <div className="incident-item-actions">
                    <button type="button" className="incident-action-btn incident-approve-btn" tabIndex={-1} title="确认后才会调用模型，会消耗额度">
                      <Sparkles size={12} />
                      确认诊断
                    </button>
                    <button type="button" className="incident-action-btn incident-ignore-btn" tabIndex={-1}>
                      忽略 1 小时
                    </button>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 登录页（原版 login-panel）
 */
export function LoginScreenMockup() {
  return (
    <WikiLegendWrapper
      title="登录页"
      description="右上角切换语言和深浅色。可记住用户名。还没有账号就点立即注册。"
    >
      <div className="wiki-login-stage">
        <form className="login-panel wiki-login-panel" onSubmit={(e) => e.preventDefault()}>
          <div className="login-saki-hang">
            <img src={sakiArtAssets.hang} alt="Saki" className="login-saki-hang-img" draggable={false} />
          </div>
          <div className="login-header">
            <div className="brand-mark" aria-hidden="true">
              <img className="app-logo-img" src="/assets/saki-panel-icon.webp" alt="" draggable={false} />
            </div>
            <div>
              <h1>Saki Panel</h1>
              <p>System Administration</p>
            </div>
          </div>
          <div className="form-group">
            <label>
              <span className="label-text">用户名</span>
              <div className="input-with-icon">
                <input value="admin" readOnly tabIndex={-1} />
              </div>
            </label>
          </div>
          <div className="form-group">
            <label>
              <span className="label-text">密码</span>
              <div className="input-with-icon">
                <input type="password" value="••••••••" readOnly tabIndex={-1} />
              </div>
            </label>
          </div>
          <label className="remember-password">
            <input type="checkbox" defaultChecked readOnly tabIndex={-1} />
            <span>记住用户名</span>
          </label>
          <button className="primary-button login-btn" type="button" tabIndex={-1}>
            登录系统
          </button>
          <div className="auth-switch-prompt">
            <span>还没有账号？</span>
            <button type="button" className="auth-switch-link" tabIndex={-1}>立即注册</button>
          </div>
        </form>
      </div>
    </WikiLegendWrapper>
  );
}

/**
 * 可靠性报告指标（原版 metric-tile）
 */
export function ReliabilityMockup() {
  return (
    <WikiLegendWrapper
      title="可靠性报告"
      description="可选最近 7 / 14 / 30 天。没有事件时会显示「窗口期内没有值班事件」。"
    >
      <div className="wiki-reliability-toolbar">
        <div className="reliability-days">
          <button type="button" className="active" tabIndex={-1}>7 天</button>
          <button type="button" tabIndex={-1}>14 天</button>
          <button type="button" tabIndex={-1}>30 天</button>
        </div>
      </div>
      <section className="metrics-grid reliability-metrics wiki-metrics-grid">
        <div className="metric-tile metric-teal">
          <div className="metric-icon"><Clock size={22} /></div>
          <div>
            <span>MTTR（分钟）</span>
            <strong>4.2</strong>
            <small className="metric-sub">平均恢复时间</small>
          </div>
        </div>
        <div className="metric-tile metric-blue">
          <div className="metric-icon"><Activity size={22} /></div>
          <div>
            <span>事件总数</span>
            <strong>6</strong>
            <small className="metric-sub">1 进行中</small>
          </div>
        </div>
        <div className="metric-tile metric-amber">
          <div className="metric-icon"><CheckCircle2 size={22} /></div>
          <div>
            <span>已恢复 / 失败</span>
            <strong>5 / 0</strong>
            <small className="metric-sub">已解决 / 修复失败</small>
          </div>
        </div>
        <div className="metric-tile metric-teal">
          <div className="metric-icon"><Wrench size={22} /></div>
          <div>
            <span>自动修复成功率</span>
            <strong>80%</strong>
            <small className="metric-sub">尝试 5 次 · 成功 4 次</small>
          </div>
        </div>
      </section>
    </WikiLegendWrapper>
  );
}

/**
 * 计划任务（沿用实例侧栏卡片风格）
 */
export function CronTasksMockup() {
  return (
    <WikiLegendWrapper
      title="实例计划任务"
      description="入口在实例快捷面板，不在左侧菜单。可定时重启、启动、停止或向控制台发命令。"
    >
      <div className="glass-panel instance-side-card wiki-mock-card wiki-cron-card">
        <div className="wiki-cron-form">
          <label>
            <span>名称</span>
            <input value="paper-1.20-restart" readOnly tabIndex={-1} />
          </label>
          <label>
            <span>类型</span>
            <select defaultValue="restart_instance" tabIndex={-1}>
              <option value="restart_instance">重启实例</option>
              <option value="start_instance">启动实例</option>
              <option value="stop_instance">停止实例</option>
              <option value="run_command">执行命令</option>
            </select>
          </label>
          <label>
            <span>计划</span>
            <input value="@every 30m" readOnly tabIndex={-1} />
          </label>
        </div>
        <button className="primary-button" type="button" tabIndex={-1}>
          <Plus size={14} />
          创建任务
        </button>
        <div className="wiki-cron-run">
          <span className="wiki-cron-run-ok">最近一次：成功 · 3 分钟前</span>
          <span className="wiki-cron-run-meta">耗时 1.2 秒 · 已发送 restart</span>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

export function ServerTimeMockup() {
  return (
    <WikiLegendWrapper
      title="服务器时间与世界时钟校准"
      description="点顶栏时钟打开。选一座城市后，顶栏就会按这个时区走。"
    >
      <div className="wiki-city-grid">
        {[
          { flag: "🇨🇳", name: "北京 / 上海", tz: "Asia/Shanghai", badge: "UTC+8", time: "13:20:08", diff: "与服务器相同", active: true },
          { flag: "🇯🇵", name: "东京", tz: "Asia/Tokyo", badge: "UTC+9", time: "14:20:08", diff: "快 1 小时", active: false },
          { flag: "🇺🇸", name: "纽约", tz: "America/New_York", badge: "UTC-5/-4", time: "01:20:08", diff: "慢 12 小时", active: false }
        ].map((city) => (
          <button key={city.name} type="button" className={`world-city-card ${city.active ? "active" : ""}`} tabIndex={-1}>
            <div className="city-card-top">
              <div className="city-info-col">
                <span className="city-flag">{city.flag}</span>
                <div className="city-names">
                  <strong className="city-title">{city.name}</strong>
                  <small className="city-tz-name">{city.tz}</small>
                </div>
              </div>
              <span className="city-tz-badge">{city.badge}</span>
            </div>
            <div className="city-card-middle">
              <span className="city-time-digits">{city.time}</span>
              <div className="city-submeta">
                <span className="city-date">2026-09-10</span>
                <span className="city-diff">{city.diff}</span>
              </div>
            </div>
            <div className="city-card-bottom">
              {city.active ? (
                <div className="city-active-tag">
                  <Check size={13} />
                  <span>当前顶栏显示</span>
                </div>
              ) : (
                <span>校准到此时区</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </WikiLegendWrapper>
  );
}

export function PointsUsageMockup() {
  return (
    <WikiLegendWrapper
      title="积分与使用量统计"
      description="点顶栏积分徽章打开。可看余额、近 14 天 Token 和扣分趋势。"
    >
      <div className="points-stats-grid wiki-points-grid">
        <div className="points-stat-card">
          <div className="points-stat-icon-wrap points-icon-amber">
            <Coins size={18} />
          </div>
          <div className="points-stat-info">
            <span className="points-stat-label">当前可用积分</span>
            <strong className="points-stat-value">128<small> 积分</small></strong>
          </div>
        </div>
        <div className="points-stat-card">
          <div className="points-stat-icon-wrap points-icon-blue">
            <Activity size={18} />
          </div>
          <div className="points-stat-info">
            <span className="points-stat-label">近 14 天总消耗 Token</span>
            <strong className="points-stat-value">86,400<small> Tokens</small></strong>
          </div>
        </div>
        <div className="points-stat-card">
          <div className="points-stat-icon-wrap points-icon-amber">
            <Sparkles size={18} />
          </div>
          <div className="points-stat-info">
            <span className="points-stat-label">近 14 天总扣减积分</span>
            <strong className="points-stat-value">87<small> 积分</small></strong>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

export function CreateInstanceMockup() {
  return (
    <WikiLegendWrapper
      title="新建实例与数据库"
      description="两个页签：标准命令/进程实例，或数据库可视化实例。"
    >
      <div className="wiki-create-stage">
        <div className="unified-create-tabs">
          <button type="button" className="create-type-tab active" tabIndex={-1}>
            <TerminalIcon size={15} />
            <span>标准命令/进程实例</span>
          </button>
          <button type="button" className="create-type-tab" tabIndex={-1}>
            <Database size={15} />
            <span>数据库可视化实例</span>
          </button>
        </div>
        <div className="wiki-create-fields">
          <label>
            <span>节点</span>
            <input value="node-shanghai-01" readOnly tabIndex={-1} />
          </label>
          <label>
            <span>名称</span>
            <input value="Minecraft-Paper-1.20" readOnly tabIndex={-1} />
          </label>
          <label>
            <span>工作目录</span>
            <input value="留空自动创建" readOnly tabIndex={-1} />
          </label>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

export function NodeJoinMockup() {
  return (
    <WikiLegendWrapper
      title="接入节点三种方式"
      description="密钥直连、部署向导、手动配置。装完把 Node Key 贴回来即可上线。"
    >
      <div className="wiki-node-join">
        <div className="segmented-nav">
          <button type="button" className="segmented-nav-btn active" tabIndex={-1}>
            <span>密钥直连</span>
          </button>
          <button type="button" className="segmented-nav-btn" tabIndex={-1}>
            <span>部署向导</span>
          </button>
          <button type="button" className="segmented-nav-btn" tabIndex={-1}>
            <span>手动配置</span>
          </button>
        </div>
        <label className="wiki-node-key-field">
          <span>Node Key</span>
          <textarea readOnly tabIndex={-1} value="saki_node_xxxxxxxxxxxxxxxx" />
          <small>在目标机器终端执行 npm run daemon:key</small>
        </label>
      </div>
    </WikiLegendWrapper>
  );
}

export function DatabaseWorkspaceMockup() {
  return (
    <WikiLegendWrapper
      title="数据库工作区页签"
      description="按引擎显示：数据浏览或键值浏览、表结构、SQL 控制台或 Redis CLI、导入与导出。"
    >
      <div className="glass-panel instance-terminal-box wiki-db-workspace">
        <div className="instance-terminal-topbar">
          <div className="terminal-topbar-left">
            <span className="db-engine-chip mysql">MYSQL</span>
            <span className="database-title-label">生产库</span>
            <span className="status-pill green db-ready-pill">
              <CheckCircle2 size={12} />
              <span>就绪</span>
            </span>
          </div>
        </div>
        <div className="terminal-tabs-strip wiki-db-tabs">
          <div className="terminal-tab active">
            <span className="tab-label">数据浏览 (Data)</span>
          </div>
          <div className="terminal-tab">
            <span className="tab-label">表结构 (Schema)</span>
          </div>
          <div className="terminal-tab">
            <span className="tab-label">SQL 控制台</span>
          </div>
          <div className="terminal-tab">
            <span className="tab-label">导入与导出</span>
          </div>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}

export function AgentMonitorMockup() {
  return (
    <WikiLegendWrapper
      title="Agent 任务铃铛"
      description="顶栏机器人图标。可全部停止、删除已完成；单条可停止、撤销、删除。"
    >
      <div className="wiki-incident-stage">
        <div className="incident-popover agent-monitor-popover wiki-incident-popover">
          <div className="incident-popover-header">
            <div className="incident-popover-title-wrap">
              <strong>Agent 任务</strong>
              <span className="incident-popover-pill">1 个运行中</span>
            </div>
            <button type="button" className="incident-popover-close" tabIndex={-1} title="关闭">
              <X size={14} />
            </button>
          </div>
          <div className="agent-monitor-toolbar">
            <button type="button" className="agent-monitor-quick-btn danger" tabIndex={-1}>
              <Square size={12} />
              <span>全部停止</span>
              <span className="quick-btn-badge">1</span>
            </button>
            <button type="button" className="agent-monitor-quick-btn" tabIndex={-1}>
              <Trash2 size={12} />
              <span>删除已完成任务</span>
            </button>
          </div>
          <ul className="incident-list wiki-agent-list">
            <li className="incident-item">
              <div className="incident-item-main">
                <div className="incident-item-header-row">
                  <span className="incident-item-title">Minecraft-Paper-1.20</span>
                  <span className="incident-badge-meta status-open">运行中</span>
                </div>
                <span className="incident-item-summary">正在读取 latest.log 并核对端口占用</span>
              </div>
              <div className="agent-task-item-actions">
                <button type="button" className="agent-task-action-btn btn-stop" tabIndex={-1}>停止</button>
                <button type="button" className="agent-task-action-btn btn-rollback" tabIndex={-1}>撤销</button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </WikiLegendWrapper>
  );
}
