import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Copy, Maximize2, RefreshCw, Trash2 } from "lucide-react";
import type { SshTerminalClientMessage, SshTerminalServerMessage } from "@webops/shared";
import { api } from "../../api.js";
import "@xterm/xterm/css/xterm.css";

export function SshTerminal({ token, nodeId, active }: { token: string; nodeId: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<"connecting" | "connected" | "closed" | "error">("connecting");
  const [error, setError] = useState("");
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let connected = false;
    let writable = false;
    setStatus("connecting"); setError("");
    const terminal = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: '"Cascadia Mono", Consolas, monospace', scrollback: 10000,
      theme: { background: "#111820", foreground: "#d9e3ee", cursor: "#83c5ff", selectionBackground: "#385576" } });
    const fit = new FitAddon(); terminal.loadAddon(fit);
    terminal.open(containerRef.current); terminalRef.current = terminal; fitRef.current = fit;
    const socket = new WebSocket(api.sshTerminalUrl()); socket.binaryType = "arraybuffer";
    const send = (message: SshTerminalClientMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
    const resize = () => {
      if (!containerRef.current?.clientWidth || !containerRef.current.clientHeight) return;
      fit.fit();
      if (connected) send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(containerRef.current);
    socket.onopen = () => { send({ type: "auth", token, nodeId, cols: terminal.cols, rows: terminal.rows }); };
    socket.onmessage = event => {
      if (disposed) return;
      if (event.data instanceof ArrayBuffer) { terminal.write(new Uint8Array(event.data)); return; }
      let message: SshTerminalServerMessage;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "ready") {
        connected = true; writable = message.canInput; setReadOnly(!writable); setStatus("connected"); resize(); if (activeRef.current) terminal.focus();
      } else if (message.type === "error") { setError(message.message); setStatus("error"); }
      else if (message.type === "exit") { connected = false; setStatus("closed"); }
    };
    socket.onerror = () => { if (!disposed) { setStatus("error"); setError("SSH 终端连接失败，请检查服务器与网络后重连。"); } };
    socket.onclose = () => { connected = false; if (!disposed) setStatus(current => current === "error" ? current : "closed"); };
    const input = terminal.onData(data => {
      if (!connected || !writable) return;
      // Keep paste frames bounded without splitting a Unicode surrogate pair.
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(data.length, offset + 8192);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]!)) end--;
        send({ type: "input", data: data.slice(offset, end) }); offset = end;
      }
    });
    terminal.attachCustomKeyEventHandler(event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyC") {
        if (event.type === "keydown" && terminal.hasSelection()) void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {});
        return false;
      }
      return true;
    });
    const ping = window.setInterval(() => { if (connected) send({ type: "ping" }); }, 20000);
    return () => {
      disposed = true; connected = false; observer.disconnect(); window.clearInterval(ping); input.dispose();
      socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.close(); terminal.dispose();
      terminalRef.current = null; fitRef.current = null;
    };
  }, [token, nodeId, generation]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => { fitRef.current?.fit(); terminalRef.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <div className="ssh-terminal" ref={panelRef}>
    <div className="ssh-terminal-toolbar">
      <span role="status" className={`ssh-terminal-status is-${status}`}>{({ connecting: "正在连接 SSH…", connected: "SSH 已连接", closed: "连接已断开", error: "连接失败" })[status]}{readOnly && status === "connected" ? " · 只读" : ""}</span>
      <div className="ssh-terminal-actions">
        <button type="button" className="icon-button mini" title="复制选中内容" onClick={() => { const selection = terminalRef.current?.getSelection(); if (selection) void navigator.clipboard.writeText(selection).catch(() => setError("无法访问剪贴板，请使用浏览器复制菜单。")); }}><Copy size={15} /></button>
        <button type="button" className="icon-button mini" title="清空终端显示" onClick={() => terminalRef.current?.clear()}><Trash2 size={15} /></button>
        <button type="button" className="icon-button mini" title="重新连接 SSH" onClick={() => setGeneration(current => current + 1)}><RefreshCw size={15} /></button>
        <button type="button" className="icon-button mini" title="终端全屏" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void panelRef.current?.requestFullscreen().catch(() => setError("当前浏览器不支持终端全屏。")); }}><Maximize2 size={15} /></button>
      </div>
    </div>
    {error && <p className="ssh-terminal-error" role="alert">{error}</p>}
    <div className="ssh-terminal-screen" ref={containerRef} aria-label="远程服务器交互终端" />
  </div>;
}
