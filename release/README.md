# Saki Panel v3.2.0 Release

🌸 **Saki Panel** - The First AI-Powered Server Management Panel

## 快速开始

### 方式一：原生可执行文件（推荐，开箱即用）

#### Windows 用户
解压 `saki-panel-v3.2-windows-x64.zip`，直接双击运行：
```bash
saki-panel.exe
```
内置独立运行时与静态服务，无需额外安装或配置任何环境，双击即可直接启动全部服务。

#### Linux 用户
解压 `saki-panel-v3.2-linux-x64.tar.gz`，赋予权限并运行：
```bash
chmod +x saki-panel
./saki-panel
```

---

### 方式二：手动源码运行

#### 前置要求
- Node.js >= 22.13
- npm >= 9

#### 安装依赖与启动
```bash
npm install --omit=dev
npx prisma db push --skip-generate
./start.sh
```

或者手动启动各微服务：
```bash
# 启动 Panel (端口 5479)
npm start

# 启动 Daemon (端口 5480)
npm run start:daemon

# 启动 Web (端口 5478)
npm run start:web
```

---

## 默认访问地址与凭据
- 🌐 Web 界面: http://localhost:5478 (或 http://localhost:5479)
- 📋 Panel API: http://localhost:5479
- 🔧 Daemon 守护服务: http://localhost:5480
- 默认管理员账号: `admin`
- 默认管理员密码: `admin123456`

## 环境变量（可选自定义）
```bash
export JWT_SECRET="your-secret-here"
export ADMIN_PASSWORD="your-password-here"
export DAEMON_REGISTRATION_TOKEN="your-token-here"
export PANEL_PORT=5479
export DAEMON_PORT=5480
export WEB_PORT=5478
```

## 项目结构
```
.
├── saki-panel.exe / saki-panel  # 原生高性能启动器
├── apps/
│   ├── panel/dist/    # Panel 后端
│   ├── daemon/dist/   # Daemon 守护进程
│   └── web/dist/      # Web 前端
├── packages/
│   └── shared/dist/   # 共享类型与工具库
├── prisma/            # 数据库 Schema
└── data/              # 持久化数据与 SQLite 数据库
```

## License
Apache License 2.0
