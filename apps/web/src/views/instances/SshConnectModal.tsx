import { useState, type FormEvent } from "react";
import { Loader2, Server, X } from "lucide-react";
import type { ConnectSshNodeRequest, ManagedNode, TestSshNodeResponse } from "@webops/shared";
import { api } from "../../api.js";

export function SshConnectModal({ token, onClose, onConnected }: { token: string; onClose: () => void; onConnected: (node: ManagedNode) => void }) {
  const [form, setForm] = useState<ConnectSshNodeRequest>({ name: "", host: "", port: 22, username: "", authType: "password", password: "", privateKey: "", passphrase: "" });
  const [tested, setTested] = useState<TestSshNodeResponse | null>(null);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [error, setError] = useState("");
  function update(patch: Partial<ConnectSshNodeRequest>) { setForm(current => ({ ...current, ...patch })); setTested(null); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(tested ? "connect" : "test");
    const credentials = form.authType === "password" ? { ...form, privateKey: undefined, passphrase: undefined } : { ...form, password: undefined };
    try {
      if (!tested) setTested(await api.testSshNode(token, credentials));
      else {
        const { node } = await api.connectSshNode(token, { ...credentials, hostFingerprint: tested.hostFingerprint });
        onConnected(node);
      }
    } catch (error) { setError(error instanceof Error ? error.message : "连接失败"); }
    finally { setBusy(null); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="ssh-connect-title">
      <div className="modal-header">
        <div className="modal-title-wrap"><Server size={18} /><h2 id="ssh-connect-title">连接远程 SSH 服务器</h2></div>
        <button className="icon-button mini" type="button" title="关闭" disabled={busy !== null} onClick={onClose}><X size={18} /></button>
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="muted">连接后可在服务器上创建实例，并在 SakiAgent 中选择这些实例。支持 Linux、Node.js 22.13+ 和 npm；首次连接会在 SSH 用户目录中安装运行组件，需要访问 npm 仓库。</p>
          <fieldset disabled={busy !== null} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="instance-form modal-form">
              <label>服务器名称<input value={form.name} placeholder="例如：生产服务器" onChange={e => update({ name: e.target.value })} maxLength={128} /></label>
              <label>主机地址<input required value={form.host} placeholder="IP 或域名" onChange={e => update({ host: e.target.value })} /></label>
              <label>SSH 端口<input required type="number" min={1} max={65535} value={form.port} onChange={e => update({ port: Number(e.target.value) })} /></label>
              <label>用户名<input required autoComplete="off" value={form.username} placeholder="例如：ubuntu" onChange={e => update({ username: e.target.value })} /></label>
              <label className="wide-field">认证方式<select value={form.authType} onChange={e => update({ authType: e.target.value as ConnectSshNodeRequest["authType"] })}><option value="password">密码</option><option value="privateKey">SSH 私钥</option></select></label>
              {form.authType === "password" ? <label className="wide-field">密码<input required type="password" autoComplete="new-password" value={form.password} onChange={e => update({ password: e.target.value })} /></label> : <>
                <label className="wide-field">私钥<textarea required rows={5} value={form.privateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" onChange={e => update({ privateKey: e.target.value })} /></label>
                <label className="wide-field">私钥口令（可选）<input type="password" autoComplete="new-password" value={form.passphrase} onChange={e => update({ passphrase: e.target.value })} /></label>
              </>}
            </div>
          </fieldset>
          {tested && <div role="status"><p>连接测试通过：{tested.runtime}</p><p>请核对服务器主机指纹，确认后连接并安装：</p><code style={{ overflowWrap: "anywhere" }}>SHA256:{btoa(String.fromCharCode(...tested.hostFingerprint.match(/../g)!.map(byte => parseInt(byte, 16)))).replace(/=+$/, "")}</code></div>}
          {busy === "connect" && <p role="status">正在安装远程组件并建立连接，首次安装可能需要几分钟…</p>}
          {error && <p role="alert" className="error-text">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="ghost-button" disabled={busy !== null} onClick={onClose}>取消</button>
          <button type="submit" className="primary-button" disabled={busy !== null}>{busy ? <Loader2 size={15} className="spin" /> : <Server size={15} />}{busy ? "正在处理…" : tested ? "连接并创建实例" : "测试 SSH 连接"}</button>
        </div>
      </form>
    </div>
  </div>;
}
