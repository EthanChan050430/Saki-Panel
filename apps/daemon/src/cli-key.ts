import { getOrCreateDaemonNodeKey } from "./identity.js";

async function main() {
  const args = process.argv.slice(2);
  let customHost: string | undefined;
  let customPort: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === "--host" && args[i + 1]) {
      customHost = args[i + 1];
      i++;
    } else if (arg === "--port" && args[i + 1]) {
      customPort = Number(args[i + 1]);
      i++;
    } else if (!arg.startsWith("-") && !customHost) {
      customHost = arg;
    }
  }

  const { key, payload } = await getOrCreateDaemonNodeKey(customHost, customPort);

  console.log("\n================================================================================");
  console.log("🔑 Saki-Daemon 机器专属接入密钥 (Node Key)");
  console.log("================================================================================");
  console.log(`\n${key}\n`);
  console.log("================================================================================");
  console.log(`机器信息: ${payload.name} (${payload.protocol}://${payload.host}:${payload.port})`);
  console.log(`节点编号: ${payload.nodeId}`);
  if (customHost) {
    console.log(`指定地址: ${customHost}`);
  }
  console.log("\n👉 使用方法：复制上方整串密钥（以 saki_node_ 开头），在 Saki-Panel 面板中粘贴即可连接！");
  console.log("💡 提示：若机器位于外网/跨网络，可执行 npm run daemon:key -- <公网IP或域名> 生成指定 IP 的密钥。");
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error("生成节点密钥失败:", err);
  process.exit(1);
});
