# Saki Panel - Linux Release

🌸 **Saki Panel** - The First AI-Powered Server Management Panel

## 快速开始

### 前置要求
- Node.js >= 18
- npm >= 9

### 安装依赖
```bash
npm install --omit=dev
```

### 初始化数据库
```bash
npx prisma db push --skip-generate
```

### 启动服务
```bash
./start.sh
```

或者手动启动：
```bash
# 启动 Panel (端口 5479)
npm start

# 启动 Daemon (端口 5480)
npm run start:daemon

# 启动 Web (端口 5478)
npm run start:web
```

## 默认访问
- 🌐 Web 界面: http://localhost:5478
- 📋 Panel API: http://localhost:5479
- 🔧 Daemon: http://localhost:5480

## 默认管理员
- 用户名: `admin`
- 密码: `admin123456`

## 环境变量
```bash
export JWT_SECRET="your-secret-here"
export ADMIN_PASSWORD="your-password-here"
export DAEMON_REGISTRATION_TOKEN="your-token-here"
```

## 项目结构
```
.
├── apps/
│   ├── panel/dist/    # Panel 后端
│   ├── daemon/dist/   # Daemon 守护进程
│   └── web/dist/      # Web 前端
├── packages/
│   └── shared/dist/   # 共享类型
├── prisma/            # 数据库 Schema
├── start.sh           # 启动脚本
└── package.json
```

## License
Apache License 2.0
