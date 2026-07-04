#!/usr/bin/env bash

# Saki Panel Linux Release Package
# 简单的启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🌸 🌸 Saki Panel - Starting..."
echo ""

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js >= 18"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version is too old. Please install Node.js >= 18+"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"
echo ""

# 默认端口
PANEL_PORT=${PANEL_PORT:-5479}
DAEMON_PORT=${DAEMON_PORT:-5480}

# 检查端口是否被占用
check_port() {
    local port=$1
    if lsof -i :$port > /dev/null 2>&1; then
        echo "⚠️ Port $port is in use"
        return 1
    fi
    return 0
}

echo "📋 Checking ports..."
check_port $PANEL_PORT
check_port $DAEMON_PORT
echo ""

# 创建必要的目录
mkdir -p data/panel
mkdir -p data/daemon
mkdir -p workspace

echo "🔧 Starting Panel..."
node apps/panel/dist/index.js &
PANEL_PID=$!
echo "✅ Panel started (PID: $PANEL_PID)"
sleep 2

echo "🔧 Starting Daemon..."
node apps/daemon/dist/index.js &
DAEMON_PID=$!
echo "✅ Daemon started (PID: $DAEMON_PID)"

echo ""
echo "================================="
echo "🌸 Saki Panel is ready!"
echo "================================="
echo ""
echo "🌐 Web Interface: http://localhost:5478"
echo "📋 Panel API: http://localhost:5479"
echo "🔧 Daemon: http://localhost:5480"
echo ""
echo "👤 Default Admin: admin / admin123456"
echo ""
echo "Press Ctrl+C to stop all services..."
echo ""

# 等待用户停止
trap "echo ''; echo 'Stopping...'; kill $PANEL_PID $DAEMON_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait $PANEL_PID $DAEMON_PID