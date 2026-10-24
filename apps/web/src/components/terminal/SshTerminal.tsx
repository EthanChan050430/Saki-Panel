import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Copy, Maximize2, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import type { SshTerminalClientMessage, SshTerminalServerMessage } from "@webops/shared";
import { api } from "../../api.js";
import {
  countSelectionCharacters,
  normalizeSakiSelectionText,
  readAllTerminalBufferText,
  type TerminalShortcutKey
} from "./WebTerminal.js";
import "@xterm/xterm/css/xterm.css";

export const sshTerminalShortcutKeys: TerminalShortcutKey[] = [
  { type: "key", id: "sigint", label: "^C", title: "中断当前程序 (SIGINT / Ctrl+C)", data: "\u0003", ctrlData: "\u0003", wide: true },
  { type: "key", id: "tab", label: "Tab", title: "Tab 自动补全", data: "\t", ctrlData: "\t", wide: true },
  { type: "key", id: "escape", label: "Esc", title: "Esc", data: "\x1b", ctrlData: "\x1b" },
  { type: "modifier", id: "ctrl", label: "Ctrl", title: "Ctrl 组合键修饰符" },
  { type: "key", id: "up", label: "↑", title: "上一条命令", data: "\x1b[A", ctrlData: "\x1b[1;5A" },
  { type: "key", id: "down", label: "↓", title: "下一条命令", data: "\x1b[B", ctrlData: "\x1b[1;5B" },
  { type: "key", id: "left", label: "←", title: "光标左移", data: "\x1b[D", ctrlData: "\x1b[1;5D" },
  { type: "key", id: "right", label: "→", title: "光标右移", data: "\x1b[C", ctrlData: "\x1b[1;5C" },
  { type: "key", id: "backspace", label: "⌫", title: "退格", data: "\b", ctrlData: "\u0017" },
  { type: "key", id: "c", label: "C", title: "C / Ctrl+C", data: "c", ctrlData: "\u0003" },
  { type: "key", id: "d", label: "D", title: "D / Ctrl+D (退出终端)", data: "d", ctrlData: "\u0004" },
  { type: "key", id: "l", label: "L", title: "L / Ctrl+L (清屏)", data: "l", ctrlData: "\u000c" },
  { type: "key", id: "enter", label: "Enter", title: "回车", data: "\r", ctrlData: "\r", wide: true }
];

export interface SshTerminalActions {
  sendCommand: (cmd: string) => boolean;
  clear: () => void;
  reconnect: () => void;
  toggleFullscreen: () => void;
  copySelection: () => void;
  extractOrCopyLogs?: () => void;
}

export function SshTerminal({
  token,
  nodeId,
  active,
  hideToolbar = false,
  onMountTerminalActions,
  onStatusChange,
  onAskSaki,
}: {
  token: string;
  nodeId: string;
  active: boolean;
  hideToolbar?: boolean | undefined;
  onMountTerminalActions?: ((actions: SshTerminalActions | null) => void) | undefined;
  onStatusChange?: ((status: "connecting" | "connected" | "closed" | "error", readOnly: boolean) => void) | undefined;
  onAskSaki?: ((prompt?: string) => void) | undefined;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);
  const writableRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<"connecting" | "connected" | "closed" | "error">("connecting");
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [mobileCtrlActive, setMobileCtrlActive] = useState(false);
  const [selectedTerminalText, setSelectedTerminalText] = useState("");
  const [copyToast, setCopyToast] = useState("");

  const copyTextToClipboard = async (text: string, successMsg = "已复制到剪贴板") => {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyToast(successMsg);
      window.setTimeout(() => setCopyToast(""), 2000);
    } catch {
      setError("无法访问剪贴板，请长按文本复制");
      window.setTimeout(() => setError(""), 2500);
    }
  };

  const sendTerminalShortcut = (shortcut: TerminalShortcutKey) => {
    terminalRef.current?.focus();

    if (shortcut.type === "modifier") {
      setMobileCtrlActive((active) => !active);
      return;
    }

    if (!connectedRef.current || !writableRef.current || !socketRef.current) {
      setMobileCtrlActive(false);
      return;
    }

    const data = mobileCtrlActive ? (shortcut.ctrlData ?? shortcut.data) : shortcut.data;
    if (!data) {
      setMobileCtrlActive(false);
      return;
    }

    if (socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "input", data }));
    }
    setMobileCtrlActive(false);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let connected = false;
    let writable = false;
    connectedRef.current = false;
    writableRef.current = false;
    setStatus("connecting");
    setError("");
    onStatusChange?.("connecting", false);

    const isMobileInit = typeof window !== "undefined" && window.innerWidth <= 600;
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: isMobileInit ? 12 : 13.5,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      scrollback: 10000,
      theme: { background: "#111820", foreground: "#d9e3ee", cursor: "#83c5ff", selectionBackground: "#385576" }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const socket = new WebSocket(api.sshTerminalUrl());
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    const send = (message: SshTerminalClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const resize = () => {
      if (!containerRef.current?.clientWidth || !containerRef.current.clientHeight) return;
      const mobileNow = window.innerWidth <= 600;
      const targetFontSize = mobileNow ? 12 : 13.5;
      if (terminal.options.fontSize !== targetFontSize) {
        terminal.options.fontSize = targetFontSize;
      }
      fit.fit();
      if (connected) send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);

    socket.onopen = () => {
      send({ type: "auth", token, nodeId, cols: terminal.cols, rows: terminal.rows });
    };

    socket.onmessage = (event) => {
      if (disposed) return;
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
        return;
      }
      let message: SshTerminalServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "ready") {
        connected = true;
        writable = message.canInput;
        connectedRef.current = true;
        writableRef.current = writable;
        setReadOnly(!writable);
        setStatus("connected");
        onStatusChange?.("connected", !writable);
        resize();
        if (activeRef.current) terminal.focus();
      } else if (message.type === "error") {
        setError(message.message);
        setStatus("error");
        onStatusChange?.("error", false);
      } else if (message.type === "exit") {
        connected = false;
        connectedRef.current = false;
        setStatus("closed");
        onStatusChange?.("closed", false);
      }
    };

    socket.onerror = () => {
      if (!disposed) {
        setStatus("error");
        setError("SSH 终端连接失败，请检查服务器与网络后重连。");
        onStatusChange?.("error", false);
      }
    };

    socket.onclose = () => {
      connected = false;
      connectedRef.current = false;
      if (!disposed) {
        setStatus((current) => (current === "error" ? current : "closed"));
        onStatusChange?.("closed", false);
      }
    };

    const input = terminal.onData((data) => {
      if (!connected || !writable) return;
      // Keep paste frames bounded without splitting a Unicode surrogate pair.
      for (let offset = 0; offset < data.length; ) {
        let end = Math.min(data.length, offset + 8192);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]!)) end--;
        send({ type: "input", data: data.slice(offset, end) });
        offset = end;
      }
    });

    const selectionSub = terminal.onSelectionChange(() => {
      const sel = terminal.getSelection();
      setSelectedTerminalText(sel ? normalizeSakiSelectionText(sel) : "");
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyC") {
        if (event.type === "keydown" && terminal.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {});
        return false;
      }
      return true;
    });

    const ping = window.setInterval(() => {
      if (connected) send({ type: "ping" });
    }, 20000);

    return () => {
      disposed = true;
      connected = false;
      connectedRef.current = false;
      socketRef.current = null;
      observer.disconnect();
      window.clearInterval(ping);
      input.dispose();
      selectionSub.dispose();
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [token, nodeId, generation]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    onMountTerminalActions?.({
      sendCommand: (cmd: string) => {
        const trimmed = cmd.trim();
        if (!trimmed) return false;
        if (!connectedRef.current || !writableRef.current || !socketRef.current) return false;
        if (socketRef.current.readyState !== WebSocket.OPEN) return false;
        socketRef.current.send(JSON.stringify({ type: "input", data: `${trimmed}\r` }));
        return true;
      },
      clear: () => {
        terminalRef.current?.clear();
      },
      reconnect: () => {
        setGeneration((current) => current + 1);
      },
      toggleFullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void panelRef.current?.requestFullscreen().catch(() => setError("当前浏览器不支持终端全屏。"));
      },
      copySelection: () => {
        const selection = terminalRef.current?.getSelection();
        if (selection && selection.trim().length > 0) {
          void copyTextToClipboard(selection, "选中文本已复制");
        } else {
          setError("请先在终端中选择要复制的文本。");
          window.setTimeout(() => setError(""), 2500);
        }
      },
      extractOrCopyLogs: () => {
        const term = terminalRef.current;
        if (!term) return;
        const sel = term.getSelection();
        if (sel && sel.trim().length > 0) {
          void copyTextToClipboard(sel, "选中文本已复制");
          return;
        }
        const full = readAllTerminalBufferText(term);
        if (!full) {
          setCopyToast("终端暂无文本");
          window.setTimeout(() => setCopyToast(""), 2000);
          return;
        }
        void copyTextToClipboard(full, "全量终端日志已复制");
      }
    });
    return () => {
      onMountTerminalActions?.(null);
    };
  }, [active, onMountTerminalActions, generation]);

  return (
    <div className="ssh-terminal" ref={panelRef}>
      {!hideToolbar && (
        <div className="ssh-terminal-toolbar">
          <span role="status" className={`ssh-terminal-status is-${status}`}>
            {({ connecting: "正在连接 SSH…", connected: "SSH 已连接", closed: "连接已断开", error: "连接失败" })[status]}
            {readOnly && status === "connected" ? " · 只读" : ""}
          </span>
          <div className="ssh-terminal-actions">
            <button
              type="button"
              className="icon-button mini"
              title="复制选中内容"
              onClick={() => {
                const selection = terminalRef.current?.getSelection();
                if (selection && selection.trim().length > 0) {
                  void copyTextToClipboard(selection, "选中文本已复制");
                } else {
                  setError("请先在终端中选择要复制的文本。");
                  window.setTimeout(() => setError(""), 2500);
                }
              }}
            >
              <Copy size={15} />
            </button>
            <button type="button" className="icon-button mini" title="清空终端显示" onClick={() => terminalRef.current?.clear()}><Trash2 size={15} /></button>
            <button type="button" className="icon-button mini" title="重新连接 SSH" onClick={() => setGeneration((current) => current + 1)}><RefreshCw size={15} /></button>
            <button type="button" className="icon-button mini" title="终端全屏" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void panelRef.current?.requestFullscreen().catch(() => setError("当前浏览器不支持终端全屏。")); }}><Maximize2 size={15} /></button>
          </div>
        </div>
      )}

      {selectedTerminalText && (
        <div className="terminal-mobile-selection-bar">
          <div className="selection-info">
            <strong>{countSelectionCharacters(selectedTerminalText)}</strong> 字
          </div>
          <div className="selection-actions">
            <button
              type="button"
              className="selection-action-btn primary"
              title="复制选中文本"
              aria-label="复制"
              onClick={() => {
                void copyTextToClipboard(selectedTerminalText, "选中文本已复制");
                terminalRef.current?.clearSelection();
                setSelectedTerminalText("");
              }}
            >
              <Copy size={14} />
            </button>
            {onAskSaki && (
              <button
                type="button"
                className="selection-action-btn saki"
                title="问 Saki"
                aria-label="问 Saki"
                onClick={() => {
                  onAskSaki(
                    `请分析以下远程服务器终端选中的内容：\n\`\`\`\n${selectedTerminalText}\n\`\`\``
                  );
                }}
              >
                <Sparkles size={14} />
              </button>
            )}
            <button
              type="button"
              className="selection-action-btn close"
              title="取消选择"
              aria-label="取消"
              onClick={() => {
                terminalRef.current?.clearSelection();
                setSelectedTerminalText("");
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {error && <p className="ssh-terminal-error" role="alert">{error}</p>}
      <div className="ssh-terminal-screen" ref={containerRef} aria-label="远程服务器交互终端" />

      {/* 移动端终端快捷按键栏 (Tab / Esc / Ctrl / 方向键 / Ctrl+C) */}
      <div className="terminal-mobile-keys" role="toolbar" aria-label="SSH 终端快捷按键">
        <button
          key="copy-action-key"
          className={`terminal-key-button ${selectedTerminalText ? "active active-copy" : ""}`}
          type="button"
          title={selectedTerminalText ? "复制选中文本" : "提取并复制日志文本"}
          onClick={() => {
            if (selectedTerminalText) {
              void copyTextToClipboard(selectedTerminalText, "选中文本已复制");
              terminalRef.current?.clearSelection();
              setSelectedTerminalText("");
            } else {
              const full = readAllTerminalBufferText(terminalRef.current);
              if (!full) {
                setCopyToast("终端暂无文本");
                window.setTimeout(() => setCopyToast(""), 2000);
                return;
              }
              void copyTextToClipboard(full, "全量终端日志已复制");
            }
          }}
        >
          <Copy size={13} style={{ marginRight: 3, verticalAlign: "middle" }} />
          {selectedTerminalText ? "复制" : "复制日志"}
        </button>
        {sshTerminalShortcutKeys.map((shortcut) => {
          const active = shortcut.type === "modifier" && mobileCtrlActive;
          return (
            <button
              key={shortcut.id}
              className={`terminal-key-button ${shortcut.type === "modifier" ? "terminal-key-modifier" : ""} ${shortcut.type === "key" && shortcut.wide ? "wide" : ""} ${active ? "active" : ""}`}
              type="button"
              title={shortcut.title}
              aria-pressed={shortcut.type === "modifier" ? active : undefined}
              onClick={() => sendTerminalShortcut(shortcut)}
            >
              {shortcut.label}
            </button>
          );
        })}
      </div>

      {copyToast && <div className="terminal-copy-toast">{copyToast}</div>}
    </div>
  );
}
