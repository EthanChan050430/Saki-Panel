#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_command() {
  if ! command -v "$1" &>/dev/null; then
    log_error "$1 is not installed. Please install it first."
    if [[ "$1" == "node" ]]; then
      echo "  → https://nodejs.org/  or  brew install node"
    elif [[ "$1" == "npm" ]]; then
      echo "  → Comes with Node.js"
    fi
    exit 1
  fi
}

find_free_port() {
  local port=$1
  while lsof -i ":$port" &>/dev/null; do
    log_warn "Port $port is occupied, trying $((port + 1))..."
    port=$((port + 1))
  done
  echo "$port"
}

WEB_PORT=${WEB_PORT:-5173}
PANEL_PORT=${PANEL_PORT:-23333}
DAEMON_PORT=${DAEMON_PORT:-24444}

echo ""
echo -e "${MAGENTA}🌸 Saki Panel — macOS Development Launcher${NC}"
echo ""

log_info "Checking prerequisites..."
check_command node
check_command npm

NODE_VERSION=$(node -v)
NPM_VERSION=$(npm -v)
log_ok "Node.js $NODE_VERSION / npm $NPM_VERSION"

log_info "Detecting available ports..."
WEB_PORT=$(find_free_port "$WEB_PORT")
PANEL_PORT=$(find_free_port "$PANEL_PORT")
DAEMON_PORT=$(find_free_port "$DAEMON_PORT")

export WEB_ORIGIN="http://localhost:$WEB_PORT"
export VITE_PORT="$WEB_PORT"
export VITE_API_BASE_URL="http://localhost:$PANEL_PORT"

export PANEL_HOST="0.0.0.0"
export PANEL_PORT="$PANEL_PORT"
export PANEL_PUBLIC_URL="http://localhost:$PANEL_PORT"

export DAEMON_HOST="127.0.0.1"
export DAEMON_PORT="$DAEMON_PORT"
export DAEMON_PROTOCOL="http"
export DAEMON_PANEL_URL="http://127.0.0.1:$PANEL_PORT"
export DAEMON_IDENTITY_FILE="$ROOT/data/daemon/identity-$DAEMON_PORT.json"

if [[ ! -f "$ROOT/.env" ]]; then
  log_warn ".env file not found, creating from .env.example..."
  cp "$ROOT/.env.example" "$ROOT/.env"
  log_ok ".env created with default values"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  🌐 Web     : ${CYAN}http://localhost:$WEB_PORT${NC}"
echo -e "  📋 Panel   : ${CYAN}http://localhost:$PANEL_PORT${NC}"
echo -e "  🔧 Daemon  : ${CYAN}http://localhost:$DAEMON_PORT${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

mkdir -p "$ROOT/data/panel" "$ROOT/data/daemon" "$ROOT/data/daemon/workspace"

if [[ ! -d "$ROOT/node_modules" ]]; then
  log_info "Installing dependencies..."
  npm install
  log_ok "Dependencies installed"
fi

if [[ ! -d "$ROOT/node_modules/.prisma/client" ]]; then
  log_info "Generating Prisma client..."
  npx prisma generate
  log_ok "Prisma client generated"
fi

log_info "Synchronizing database schema..."
npx prisma db push --skip-generate
log_ok "Database schema synchronized"

log_info "Building shared package..."
npm run build -w @webops/shared
log_ok "Shared package built"

echo ""
log_info "Starting Panel, Daemon and Web..."
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop all services."
echo ""

npx concurrently \
  -n "panel,daemon,web" \
  -c "cyan,green,magenta" \
  "npm run dev -w @webops/panel" \
  "npm run dev -w @webops/daemon" \
  "npm run dev -w @webops/web"
