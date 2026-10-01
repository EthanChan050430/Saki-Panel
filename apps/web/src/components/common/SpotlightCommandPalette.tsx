import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  ClipboardList,
  Command,
  Compass,
  Cpu,
  Database,
  ExternalLink,
  FolderGit2,
  HardDrive,
  HelpCircle,
  KeyRound,
  LayoutGrid,
  Layers,
  Moon,
  Music,
  Play,
  Power,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Terminal as TerminalIcon,
  User,
  Users,
  X,
  Zap
} from "lucide-react";
import type { CurrentUser, ManagedInstance } from "@webops/shared";
import type { PanelRoute, SakiPromptSeed, ViewMode } from "../../types/app.js";

export interface SpotlightAction {
  id: string;
  title: string;
  subtitle?: string;
  category: "navigation" | "instances" | "saki" | "system" | "quick";
  icon: React.ReactNode;
  shortcut?: string;
  badge?: string;
  perform: () => void;
}

interface SpotlightCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  currentRoute?: PanelRoute | ViewMode | undefined;
  onNavigate: (route: PanelRoute | ViewMode) => void;
  instances?: ManagedInstance[] | undefined;
  onSelectInstance?: ((instanceId: string) => void) | undefined;
  onStartInstance?: ((instance: ManagedInstance) => void) | undefined;
  onStopInstance?: ((instance: ManagedInstance) => void) | undefined;
  onRestartInstance?: ((instance: ManagedInstance) => void) | undefined;
  onAskSaki?: ((seed: Omit<SakiPromptSeed, "nonce">) => void) | undefined;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  currentUser?: CurrentUser | null | undefined;
  availableViews: readonly ViewMode[];
}

export function SpotlightCommandPalette({
  open,
  onClose,
  currentRoute,
  onNavigate,
  instances = [],
  onSelectInstance,
  onStartInstance,
  onStopInstance,
  onRestartInstance,
  onAskSaki,
  darkMode,
  onToggleDarkMode,
  currentUser,
  availableViews
}: SpotlightCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      const previousFocus = document.activeElement;
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => {
        clearTimeout(timer);
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      };
    }
  }, [open]);

  const allActions = useMemo<SpotlightAction[]>(() => {
    const list: SpotlightAction[] = [];

    if (query.trim() && onAskSaki) {
      list.push({
        id: `saki-ask-${query}`,
        title: `向 Saki 提问: "${query.trim()}"`,
        subtitle: "呼叫 Saki AI 进行智能研判、运维诊断或直接执行",
        category: "saki",
        icon: <Sparkles size={16} className="spotlight-saki-icon" />,
        badge: "AI 助手",
        perform: () => {
          onAskSaki?.({
            message: query.trim(),
            mode: "agent",
            clearInstance: false
          });
          onClose();
        }
      });
    }

    list.push(
      {
        id: "nav-dashboard",
        title: "仪表盘 (Dashboard)",
        subtitle: "集群状态、资源负载与近期实例概览",
        category: "navigation",
        icon: <Activity size={16} />,
        perform: () => {
          onNavigate("dashboard");
          onClose();
        }
      },
      {
        id: "nav-instances",
        title: "应用实例 (Instances)",
        subtitle: "管理服务器进程、启动停止与控制台",
        category: "navigation",
        icon: <LayoutGrid size={16} />,
        perform: () => {
          onNavigate("instances");
          onClose();
        }
      },
      {
        id: "nav-audit",
        title: "审计与合规 (Audit Logs)",
        subtitle: "全局操作日志、安全追溯与 Saki 会话全景",
        category: "navigation",
        icon: <ClipboardList size={16} />,
        perform: () => {
          onNavigate("audit");
          onClose();
        }
      },
      {
        id: "nav-nodes",
        title: "集群节点 (Nodes & Daemons)",
        subtitle: "查看分布式守护进程、节点负载与网络状态",
        category: "navigation",
        icon: <Server size={16} />,
        perform: () => {
          onNavigate("nodes");
          onClose();
        }
      },
      {
        id: "nav-templates",
        title: "应用模板 (Templates)",
        subtitle: "预置应用模板与环境快速拉起",
        category: "navigation",
        icon: <FolderGit2 size={16} />,
        perform: () => {
          onNavigate("templates");
          onClose();
        }
      },
      {
        id: "nav-reliability",
        title: "高可用与监控 (Reliability)",
        subtitle: "集群探活、容灾告警与运维可靠性",
        category: "navigation",
        icon: <Shield size={16} />,
        perform: () => {
          onNavigate("reliability");
          onClose();
        }
      },
      {
        id: "nav-users",
        title: "用户与权限 (Users & RBAC)",
        subtitle: "账号管理、权限角色分配与密钥令牌",
        category: "navigation",
        icon: <Users size={16} />,
        perform: () => {
          onNavigate("users");
          onClose();
        }
      },
      {
        id: "nav-settings",
        title: "系统与外观设置 (Settings)",
        subtitle: "Saki 偏好、模型端点配置、主题与网络",
        category: "navigation",
        icon: <Settings size={16} />,
        perform: () => {
          onNavigate("settings");
          onClose();
        }
      }
    );

    for (const inst of availableViews.includes("instances") ? instances : []) {
      const isRunning = inst.status === "RUNNING";
      list.push({
        id: `instance-open-${inst.id}`,
        title: inst.name,
        subtitle: `状态: ${isRunning ? "运行中" : "已停止"} · 节点: ${inst.nodeName || inst.nodeId || "本地"} · 打开终端控制台`,
        category: "instances",
        icon: <TerminalIcon size={16} />,
        badge: isRunning ? "RUNNING" : "STOPPED",
        perform: () => {
          if (onSelectInstance) onSelectInstance(inst.id);
          else onNavigate("instances");
          onClose();
        }
      });

      if (isRunning && onRestartInstance) {
        list.push({
          id: `instance-restart-${inst.id}`,
          title: `重启实例: ${inst.name}`,
          subtitle: `安全重启服务进程并刷新连接`,
          category: "instances",
          icon: <RefreshCw size={16} />,
          badge: "RESTART",
          perform: () => {
            onRestartInstance(inst);
            onClose();
          }
        });
      }
    }

    list.push(
      {
        id: "sys-toggle-theme",
        title: darkMode ? "切换至浅色模式 (Light Theme)" : "切换至深色模式 (Dark Theme)",
        subtitle: "一键切换全站玻璃拟态主题调色板",
        category: "system",
        icon: darkMode ? <Sun size={16} /> : <Moon size={16} />,
        perform: () => {
          onToggleDarkMode();
          onClose();
        }
      },
      {
        id: "sys-audit-health",
        title: "Saki 全站风险与健康研判",
        subtitle: "自动检索近期异常事件、高频故障与安全警告",
        category: "saki",
        icon: <Sparkles size={16} />,
        badge: "AI 巡检",
        perform: () => {
          onAskSaki?.({
            message: "请对全站系统运行状态、实例异常、失败登录及高风险审计事件进行综合健康诊断并输出体检报告。",
            mode: "agent",
            clearInstance: true
          });
          onClose();
        }
      }
    );

    return list.filter((action) => {
      if (action.category === "saki") return Boolean(onAskSaki);
      if (action.category === "navigation") return availableViews.includes(action.id.slice(4) as ViewMode);
      return true;
    });
  }, [
    query,
    instances,
    darkMode,
    onNavigate,
    onSelectInstance,
    onRestartInstance,
    onAskSaki,
    onToggleDarkMode,
    onClose,
    availableViews
  ]);

  const filteredActions = useMemo(() => {
    if (!query.trim()) return allActions;
    const q = query.toLowerCase().trim();
    return allActions.filter((a) => {
      if (a.id.startsWith("saki-ask-")) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.subtitle && a.subtitle.toLowerCase().includes(q)) ||
        (a.badge && a.badge.toLowerCase().includes(q)) ||
        (a.shortcut && a.shortcut.toLowerCase().includes(q))
      );
    });
  }, [allActions, query]);
  const orderedActions = useMemo(() => {
    const categories = ["saki", "navigation", "instances", "system", "quick"];
    return [...filteredActions].sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category));
  }, [filteredActions]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filteredActions.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredActions.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredActions.length) % Math.max(1, filteredActions.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = orderedActions[selectedIndex];
        if (action) {
          action.perform();
        }
      }
    },
    [filteredActions, orderedActions, selectedIndex, onClose]
  );

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const activeEl = listEl.querySelector(".spotlight-item.selected") as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, query, open]);

  if (!open) return null;

  const grouped = orderedActions.reduce<Record<string, SpotlightAction[]>>((acc, item) => {
    const list = acc[item.category] ?? [];
    list.push(item);
    acc[item.category] = list;
    return acc;
  }, {});

  const categoryTitles: Record<string, string> = {
    saki: "✨ Saki 智能指令与巡检",
    navigation: "🧭 视图与功能导航",
    instances: "⚡ 应用实例与快速操作",
    system: "⚙️ 系统与偏好控制",
    quick: "🚀 快捷指令"
  };

  return (
    <div className="spotlight-overlay" onClick={onClose}>
      <div className="spotlight-container" role="dialog" aria-modal="true" aria-label="搜索与快捷操作" onClick={(e) => e.stopPropagation()} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input, button, [tabindex='0']"));
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="spotlight-search-header">
          <div className="spotlight-search-box">
            <Search size={16} className="spotlight-search-icon" />
            <input
              ref={inputRef}
              type="text"
              className="spotlight-input"
              placeholder="搜索实例、页面路由、输入指令或直接问 Saki... (↑↓ 选择，Enter 执行)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="spotlight-clear-btn"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                title="清空输入"
                aria-label="清空输入"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="spotlight-kbd-pill"
            onClick={onClose}
            title="点击或按 ESC 退出"
          >
            ESC 退出
          </button>
        </div>

        <div className="spotlight-list-body" ref={listRef}>
          {filteredActions.length === 0 ? (
            <div className="spotlight-empty">
              <Compass size={24} className="spotlight-empty-icon" />
              <p>未找到匹配的指令或实例</p>
              {onAskSaki && <small>输入任意内容可直接向 Saki 提问</small>}
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="spotlight-group">
                <div className="spotlight-group-title">{categoryTitles[category] || category}</div>
                {items.map((action) => {
                  const globalIdx = orderedActions.indexOf(action);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className={`spotlight-item ${isSelected ? "selected" : ""} cat-${action.category}`}
                      onClick={() => action.perform()}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <div className="spotlight-item-icon">{action.icon}</div>
                      <div className="spotlight-item-content">
                        <div className="spotlight-item-title-row">
                          <span className="spotlight-item-title">{action.title}</span>
                          {action.badge && <span className="spotlight-item-badge">{action.badge}</span>}
                        </div>
                        {action.subtitle && (
                          <div className="spotlight-item-subtitle">{action.subtitle}</div>
                        )}
                      </div>
                      {action.shortcut && (
                        <kbd className="spotlight-item-shortcut">{action.shortcut}</kbd>
                      )}
                      {isSelected && <ArrowRight size={14} className="spotlight-item-enter-hint" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="spotlight-footer">
          <div className="spotlight-footer-hint">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> 切换选项
            </span>
            <span>
              <kbd>Enter ↵</kbd> 执行
            </span>
            <span>
              <kbd>ESC</kbd> 关闭
            </span>
          </div>
          <span className="spotlight-footer-brand">
            <Sparkles size={11} />
            Saki Spotlight Hub
          </span>
        </div>
      </div>
    </div>
  );
}
