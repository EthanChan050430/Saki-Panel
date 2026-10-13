import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import ssh2, { type Client, type SFTPWrapper } from "ssh2";
import type { ConnectSshNodeRequest } from "@webops/shared";
import { panelPaths } from "./config.js";

interface SshSettings extends ConnectSshNodeRequest {
  hostFingerprint: string;
  remoteRoot: string;
  daemonPort: number;
}
interface Tunnel { client: Client; server: net.Server; port: number; close: () => void }
const tunnels = new Map<string, Promise<Tunnel>>();
const settingsDir = path.join(panelPaths.dataDir, "ssh-nodes");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let keyPending: Promise<Buffer> | undefined;

function settingsPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid SSH node id");
  return path.join(settingsDir, `${id}.json`);
}

async function loadEncryptionKey(): Promise<Buffer> {
  await fs.mkdir(settingsDir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(settingsDir, "credentials.key");
  try { await fs.writeFile(keyFile, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const key = await fs.readFile(keyFile);
  if (key.length !== 32) throw new Error("SSH credential encryption key is invalid");
  return key;
}

function encryptionKey(): Promise<Buffer> {
  keyPending ??= loadEncryptionKey().catch(error => { keyPending = undefined; throw error; });
  return keyPending;
}

async function saveSettings(id: string, settings: SshSettings): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(JSON.stringify(settings), "utf8"), cipher.final()]);
  await fs.writeFile(settingsPath(id), JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600, flag: "wx" });
}

async function readSettings(id: string): Promise<SshSettings> {
  const saved = JSON.parse(await fs.readFile(settingsPath(id), "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(), Buffer.from(saved.iv, "base64"));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(Buffer.from(saved.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.data, "base64")), decipher.final()]).toString("utf8"));
}

export function validateSshInput(input: ConnectSshNodeRequest): void {
  if (!input || typeof input.host !== "string" || !input.host.trim() || /[\s/\\\x00]/.test(input.host) || input.host.length > 253) throw new Error("请输入有效的 SSH 主机地址（不包含协议或路径）");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("SSH 端口必须为 1–65535");
  if (typeof input.username !== "string" || !input.username.trim() || input.username.length > 128) throw new Error("请输入 SSH 用户名");
  if (input.authType !== "password" && input.authType !== "privateKey") throw new Error("请选择密码或私钥认证");
  const credential = input.authType === "password" ? input.password : input.privateKey;
  if (typeof credential !== "string" || !credential || credential.length > 65536) throw new Error("请输入有效的 SSH 密码或私钥");
  if (input.passphrase !== undefined && typeof input.passphrase !== "string") throw new Error("私钥口令无效");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 128)) throw new Error("服务器名称过长");
  if (input.hostFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(input.hostFingerprint)) throw new Error("SSH 主机指纹无效，请重新测试连接");
}

async function connect(input: ConnectSshNodeRequest): Promise<{ client: Client; fingerprint: string }> {
  validateSshInput(input);
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client();
    let fingerprint = "";
    client.on("error", (error) => { client.destroy(); reject(error); });
    client.once("close", () => reject(new Error("SSH connection closed")));
    client.once("ready", () => resolve({ client, fingerprint }));
    client.connect({
      host: input.host.trim(), port: input.port, username: input.username.trim(),
      ...(input.authType === "password" ? { password: input.password! } : { privateKey: input.privateKey!, ...(input.passphrase ? { passphrase: input.passphrase } : {}) }),
      readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostHash: "sha256",
      hostVerifier: (hash: string) => { fingerprint = hash; return !input.hostFingerprint || hash === input.hostFingerprint; }
    });
  });
}

export function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }

export function execSsh(client: Client, command: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.destroy(); reject(new Error("远程操作超时，请检查服务器网络和 npm 镜像配置")); }, timeoutMs);
    client.exec(command, (error, stream) => {
      if (error) { clearTimeout(timer); reject(error); return; }
      let output = "";
      let stderr = "";
      stream.on("data", (chunk: Buffer) => { output = (output + chunk).slice(-16000); });
      stream.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk).slice(-16000); });
      stream.on("error", (error: Error) => { clearTimeout(timer); reject(error); });
      stream.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error((stderr || output || "远程命令失败").slice(-2000)));
        else resolve(output.trim());
      });
    });
  });
}

const runtimeCheck = `node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(process.platform!=="linux" || major<22 || (major===22 && minor<13)) { console.error("需要 Linux 和 Node.js 22.13 或更新版本"); process.exit(1); } console.log(process.platform+" / "+process.arch+" / Node "+process.versions.node)' && npm --version`;

export async function testSshConnection(input: ConnectSshNodeRequest) {
  const { client, fingerprint } = await connect(input);
  try { return { hostFingerprint: fingerprint, runtime: await execSsh(client, runtimeCheck) }; }
  finally { client.end(); }
}

function sftpSession(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}
function writeRemote(sftp: SFTPWrapper, target: string, content: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => sftp.writeFile(target, content, { mode: 0o600 }, (error) => error ? reject(error) : resolve()));
}
async function uploadTree(client: Client, sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  await execSsh(client, `mkdir -p -- ${shellQuote(remote)}`);
  for (const entry of await fs.readdir(local, { withFileTypes: true })) {
    if (entry.isDirectory()) await uploadTree(client, sftp, path.join(local, entry.name), `${remote}/${entry.name}`);
    else if (entry.isFile() && /\.(?:js|mjs|json)$/.test(entry.name)) await writeRemote(sftp, `${remote}/${entry.name}`, await fs.readFile(path.join(local, entry.name)));
  }
}

// Runs independently of the SSH connection. Existing daemon/workspace state survives Panel restarts.
const launcher = `const fs=require('node:fs'), http=require('node:http'), {spawn}=require('node:child_process');
const root=__dirname, config=JSON.parse(fs.readFileSync(root+'/runtime.json','utf8'));
const start=()=>{ const log=fs.openSync(root+'/daemon.log','a'); const child=spawn(process.execPath,[root+'/apps/daemon/dist/index.js'],{cwd:root,env:{...process.env,...config},detached:true,stdio:['ignore',log,log]}); child.unref(); fs.closeSync(log); };
const req=http.get({host:'127.0.0.1',port:Number(config.DAEMON_PORT),path:'/health',timeout:2000},res=>{res.resume(); if(res.statusCode!==200) {console.error('Remote daemon port is occupied');process.exitCode=1;} });
req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',error=>{if(error.code==='ECONNREFUSED')start();else {console.error(error.message);process.exitCode=1;}});
`;

export async function provisionSshNode(id: string, token: string, input: ConnectSshNodeRequest): Promise<void> {
  if (!input.hostFingerprint) throw new Error("请先测试 SSH 连接并核对主机指纹");
  // Verify build assets before changing the remote server.
  await fs.access(path.join(projectRoot, "apps/daemon/dist/index.js")).catch(() => { throw new Error("缺少远程运行组件，请先构建 Daemon（npm run build -w @webops/daemon）"); });
  const daemonPackage = JSON.parse(await fs.readFile(path.join(projectRoot, "apps/daemon/package.json"), "utf8"));
  const sharedPackage = JSON.parse(await fs.readFile(path.join(projectRoot, "packages/shared/package.json"), "utf8"));
  await fs.access(path.join(projectRoot, "packages/shared/dist/index.mjs"));
  const { client } = await connect(input);
  let sftp: SFTPWrapper | undefined;
  try {
    await execSsh(client, runtimeCheck);
    sftp = await sftpSession(client);
    const home = await new Promise<string>((resolve, reject) => sftp!.realpath(".", (error, value) => error ? reject(error) : resolve(value)));
    const remoteRoot = path.posix.join(home, ".saki-panel", "nodes", id);
    await execSsh(client, `umask 077; mkdir -p -- ${shellQuote(remoteRoot + "/apps/daemon")} ${shellQuote(remoteRoot + "/packages/shared")} ${shellQuote(remoteRoot + "/data/daemon")}`);
    await uploadTree(client, sftp, path.join(projectRoot, "apps/daemon/dist"), remoteRoot + "/apps/daemon/dist");
    await uploadTree(client, sftp, path.join(projectRoot, "packages/shared/dist"), remoteRoot + "/packages/shared/dist");
    delete daemonPackage.scripts; delete daemonPackage.devDependencies; delete sharedPackage.scripts;
    await writeRemote(sftp, remoteRoot + "/apps/daemon/package.json", JSON.stringify(daemonPackage));
    await writeRemote(sftp, remoteRoot + "/packages/shared/package.json", JSON.stringify(sharedPackage));
    await writeRemote(sftp, remoteRoot + "/package.json", JSON.stringify({ private: true, workspaces: ["apps/daemon", "packages/shared"] }));
    await execSsh(client, `cd ${shellQuote(remoteRoot)} && npm install --omit=dev --no-audit --no-fund`, 240000);
    const daemonPort = Number(await execSsh(client, `node -e ${shellQuote("const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")}`));
    if (!Number.isInteger(daemonPort) || daemonPort < 1 || daemonPort > 65535) throw new Error("无法分配远程运行组件端口");
    await writeRemote(sftp, remoteRoot + "/data/daemon/identity.json", JSON.stringify({ nodeId: id, nodeToken: token }));
    await writeRemote(sftp, remoteRoot + "/runtime.json", JSON.stringify({ DAEMON_HOST: "127.0.0.1", DAEMON_PORT: String(daemonPort), DAEMON_DATA_DIR: remoteRoot + "/data/daemon", DAEMON_IDENTITY_FILE: remoteRoot + "/data/daemon/identity.json", DAEMON_WORKSPACE_ROOT: remoteRoot + "/workspace", DAEMON_SSH_MANAGED: "1" }));
    await writeRemote(sftp, remoteRoot + "/launch.cjs", launcher);
    await execSsh(client, `node ${shellQuote(remoteRoot + "/launch.cjs")}`);
    await saveSettings(id, { ...input, hostFingerprint: input.hostFingerprint, remoteRoot, daemonPort });
  } finally { sftp?.end(); client.end(); }
}

async function openTunnel(id: string): Promise<Tunnel> {
  const settings = await readSettings(id);
  const { client } = await connect(settings);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    client.forwardOut("127.0.0.1", 0, "127.0.0.1", settings.daemonPort, (error, channel) => {
      if (error) { socket.destroy(); return; }
      channel.on("error", () => socket.destroy());
      socket.on("close", () => channel.destroy());
      channel.on("close", () => socket.destroy());
      socket.pipe(channel).pipe(socket);
    });
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const socket of sockets) socket.destroy();
    server.close(); client.end(); tunnels.delete(id);
  };
  client.once("close", close);
  try {
    await execSsh(client, `node ${shellQuote(settings.remoteRoot + "/launch.cjs")}`);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    server.on("error", close);
    server.unref();
    return { client, server, port: (server.address() as net.AddressInfo).port, close };
  } catch (error) { close(); throw error; }
}

export async function resolveDaemonEndpoint<T extends { id: string; protocol: string; host: string; port: number }>(node: T): Promise<T> {
  if (node.protocol !== "ssh") return node;
  let pending = tunnels.get(node.id);
  if (!pending) { pending = openTunnel(node.id); tunnels.set(node.id, pending); }
  try { const tunnel = await pending; return { ...node, protocol: "http", host: "127.0.0.1", port: tunnel.port }; }
  catch (error) { if (tunnels.get(node.id) === pending) tunnels.delete(node.id); throw error; }
}

export async function removeSshNode(id: string): Promise<void> {
  const pending = tunnels.get(id);
  if (pending) { try { (await pending).close(); } catch { /* Already disconnected. */ } }
  await fs.rm(settingsPath(id), { force: true });
}

export async function sshInstanceDirectory(id: string, directory: string): Promise<string> {
  if (/^[a-zA-Z]:|\\/.test(directory)) throw new Error("远程 Linux 实例请使用 Linux 路径，例如 /home/ubuntu/app");
  const settings = await readSettings(id);
  return path.posix.resolve(settings.remoteRoot, "workspace", directory);
}

export async function closeSshTunnels(): Promise<void> {
  await Promise.allSettled([...tunnels.values()].map(async (pending) => (await pending).close()));
}
