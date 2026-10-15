import { useRef, useState } from "react";
import { ArrowLeft, Plus, Server, Terminal, X } from "lucide-react";
import type { ManagedNode } from "@webops/shared";
import { SshTerminal } from "../../components/terminal/SshTerminal.js";

export function SshServerWorkspace({ token, node, canViewTerminal, onBack, onCreateInstance }: {
  token: string; node: ManagedNode; canViewTerminal: boolean; onBack: () => void; onCreateInstance?: (() => void) | undefined;
}) {
  const counter = useRef(1);
  const [tabs, setTabs] = useState([{ id: 1, label: "终端 1" }]);
  const [activeTab, setActiveTab] = useState(1);
  const addTab = () => { const id = ++counter.current; setTabs(current => [...current, { id, label: `终端 ${id}` }]); setActiveTab(id); };
  const closeTab = (id: number) => {
    const next = tabs.filter(tab => tab.id !== id);
    setTabs(next);
    if (activeTab === id) setActiveTab(next.at(-1)?.id ?? 0);
  };
  return <section className="ssh-server-workspace">
    <header className="ssh-server-header">
      <button type="button" className="icon-button" title="返回服务器与实例列表" onClick={onBack}><ArrowLeft size={18} /></button>
      <Server size={20} />
      <div className="ssh-server-title"><h2>{node.name}</h2><span>{node.host}:{node.port} · SSH 服务器</span></div>
      {onCreateInstance && <button type="button" className="secondary-button" onClick={onCreateInstance}><Plus size={15} />创建托管实例</button>}
    </header>
    <p className="ssh-server-description">直接操作远程服务器，使用 SSH 登录账号的权限和默认目录。</p>
    {!canViewTerminal ? <p role="status">当前账号没有终端访问权限，请联系管理员分配终端权限。</p> : <>
      <div className="ssh-server-tabs" role="tablist" aria-label="SSH 终端">
        {tabs.map(tab => <div className={`ssh-server-tab ${activeTab === tab.id ? "is-active" : ""}`} key={tab.id}>
          <button type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`ssh-terminal-${tab.id}`} onClick={() => setActiveTab(tab.id)}><Terminal size={14} />{tab.label}</button>
          <button type="button" title={`关闭${tab.label}`} aria-label={`关闭${tab.label}`} onClick={() => closeTab(tab.id)}><X size={13} /></button>
        </div>)}
        <button type="button" className="icon-button mini" title="新建 SSH 终端" onClick={addTab}><Plus size={16} /></button>
      </div>
      {tabs.map(tab => <div key={tab.id} id={`ssh-terminal-${tab.id}`} role="tabpanel" className="ssh-server-terminal-panel" hidden={activeTab !== tab.id}>
        <SshTerminal token={token} nodeId={node.id} active={activeTab === tab.id} />
      </div>)}
      {!tabs.length && <div className="ssh-server-empty"><p>终端已关闭，服务器连接仍保存在列表中。</p><button type="button" className="primary-button" onClick={addTab}><Terminal size={15} />打开终端</button></div>}
    </>}
  </section>;
}
