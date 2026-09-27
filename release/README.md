# Saki Panel 4.0 发行包

此版本提供 Windows x64 便携包和 Linux x64 发行包。`saki-panel-windows-amd64.exe` 与 `saki-panel-linux-amd64` 是单独提供的启动器；**运行面板需要对应压缩包中的 Web、Panel、Daemon 和依赖文件**。

## Windows x64

1. 下载并解压 `saki-panel-v4.0-windows-x64.zip`。
2. 在解压目录运行 `saki-panel.exe`。
3. 打开 <http://localhost:5478>。

Windows 便携包包含 Node.js 运行时及所需依赖，无需另外安装 Node.js。请在首次对外开放服务前更换默认管理员密码，以及 `JWT_SECRET` 和 `DAEMON_REGISTRATION_TOKEN`。

## Linux x64

Linux 包含原生启动器和已编译的应用代码，需要在目标 Linux 机器安装 Node.js ≥ 22.13、npm ≥ 9，并联网安装与该系统匹配的依赖：

~~~bash
mkdir saki-panel-v4.0
tar -xzf saki-panel-v4.0-linux-x64.tar.gz -C saki-panel-v4.0
cd saki-panel-v4.0
npm ci
chmod +x saki-panel
./saki-panel
~~~

Linux 包不包含预装的 `node_modules`。运行后打开 <http://localhost:5478>。可在启动前通过环境变量配置端口、密码和密钥；常用配置项见 `.env.example`。

## 首次使用

开发默认账号为 `admin` / `admin123456`。面板、Daemon 和 Web 默认端口分别为 `5479`、`5480` 和 `5478`。跨主机或公网部署时，请设置强密码与随机密钥，配置 HTTPS，并限制可访问端口。运行数据保存在解压目录的 `data/` 下。

模板页中的 Minecraft Paper 与 Docker Compose 运维包按需下载并验证 SHA-256 与文件大小。下载和导入不会自动执行脚本或修改实例。

可用 `SHA256SUMS-v4.0.txt` 核对下载文件的 SHA-256。项目文档见仓库 [README](https://github.com/EthanChan050430/Saki-Panel/blob/main/README.zh-CN.md)。
