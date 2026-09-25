---
id: minecraft-paper-watch
name: Minecraft Paper 值班与变更 Runbook
schemaVersion: 1
---

# Minecraft Paper 值班与变更 Runbook

这个运维包只按需下载小型脚本和说明；Paper 服务端 JAR、插件、模组、世界和备份都不随 Saki Panel 镜像或发行包分发。`install-paper.mjs` 会在你明确运行它时，从 PaperMC Fill 的 **STABLE** 渠道下载一个可校验 SHA-256 的 JAR。

## 1. 首次部署：先解析，再安装

在实例工作目录中运行已从运维包下载的脚本：

```sh
node install-paper.mjs --minecraft-version 1.21.11 --dry-run
```

确认输出的 Minecraft 版本、Paper build、SHA-256 和 Java 提示符合预期后，再安装：

```sh
node install-paper.mjs --minecraft-version 1.21.11
```

只有实例负责人已经阅读并接受 [Mojang EULA](https://aka.ms/MinecraftEULA) 时，才追加 `--accept-eula`。脚本不会默认写 `eula=true`。

默认启动模板为：

```sh
java -Xms1024M -Xmx2048M -jar paper.jar --nogui
```

`Xmx` 不是越大越好。应为操作系统、原生内存、文件缓存和其他实例预留余量。Paper 对 Java 的要求会随 Minecraft 版本变化；部署前以 [Paper 官方要求](https://docs.papermc.io/paper/getting-started/) 和脚本输出为准。

停止 Paper 时，先在服务器**控制台**发送 `stop` 并等待保存完成。不要把 `stop` 误填为 Panel 的“停止命令”：该字段会作为宿主机 shell 命令运行，不能向 Java 进程标准输入发送 Minecraft 控制台指令。模板故意将它留空，避免把错误的 shell 命令伪装成优雅停服。

## 2. Watch 的安全默认值

为 Paper 实例推荐以下初始 Watch 策略：

| 设置 | 初始值 | 原因 |
| --- | --- | --- |
| 模式 | `diagnose_and_patch` | 允许收集证据和提出最小配置修复。 |
| 自动批准 | `none` | 世界、EULA、插件、Java 与内存修改都可能有较大影响。 |
| 冷却时间 | 900 秒 | 避免单次崩溃循环反复触发模型和重启。 |
| 每小时最大运行次数 | 3 | 保留人工接手空间，避免噪声放大。 |
| 验证等待 | 30 秒 | 给 Java 启动、世界加载和插件启用留出合理窗口。 |

当前 Panel 的 HTTP 健康检查只适用于你已部署的 HTTP exporter 或 sidecar；不要把 Minecraft 的 TCP 端口伪装成 HTTP URL。可用 `check-minecraft-port.mjs` 做低风险 TCP 就绪探测：

```sh
node check-minecraft-port.mjs --host 127.0.0.1 --port 25565
```

这只能确认端口可连接，不能证明登录链路、白名单、插件业务或玩家体验正确。

## 3. 日志事件的处置边界

下载 `paper-log-signatures.json` 后，可将它作为 Watch 的诊断参考。以下事件默认只能诊断，不能自动修复：

- `eula=false`：展示 EULA 并等待明确确认，绝不自动接受。
- Java 版本不匹配：读取 `java -version`、Paper 版本和插件版本；不自动安装或切换宿主机 Java。
- 端口冲突：识别监听者和 `server.properties`；不自动终止未知进程或开放公网端口。
- `OutOfMemoryError`：收集 JVM 参数、节点内存、在线人数和近期插件变化；不自动调大 `Xmx`。
- 磁盘满：列出日志/备份/世界占用，先提出保留计划；不删除世界或唯一备份。
- 世界损坏：停止自动修复，保留当前目录和备份，转人工处理。

## 4. 一致的世界备份

运行中的 Minecraft 世界不能假设文件复制天然一致。推荐顺序：

1. 在服务器控制台发送 `save-all flush`。
2. 发送 `save-off`，并确认命令已执行。
3. 在实例工作目录执行：

   ```sh
   node backup-world.mjs --allow-live --keep 7
   ```

4. 无论结果成功或失败，都在控制台发送 `save-on`。
5. 记录输出中的 archive、SHA-256、大小和保留策略；将至少一份已验证备份复制到独立存储。

`backup-world.mjs` 只会删除其自身在 `backups/` 中创建的、超过 `--keep` 数量的 `saki-minecraft-*.tar.gz` 文件。它不会上传备份，也不会删除世界目录。没有 `--allow-live` 时脚本会拒绝创建可能不一致的在线备份。

## 5. 升级和回滚

不要使用“latest”做无人值守生产自动更新。一次升级应是可解释、可回滚的变更：

1. 固定目标 Minecraft 版本，运行 `--dry-run` 并审阅稳定 build 与 SHA-256。
2. 完成并验证世界备份；记录当前 `paper.jar` 的哈希和插件清单。
3. 停止实例，执行带 `--replace` 的安装命令。
4. 脚本只会在新 JAR 已下载且 SHA-256 校验通过后，才把旧 JAR 改名为 `paper.jar.saki-previous-*`。
5. 启动实例，验证启动日志、端口、核心插件和实际玩家链路。
6. 失败时先停止实例，再把保留的旧 JAR 恢复为 `paper.jar`；不要在仍运行时替换 JAR。

在升级 Paper、Minecraft 或插件前，检查各插件的兼容版本。没有兼容性证据时，Saki 应提出计划并等待批准，而不是批量下载或删除插件。
