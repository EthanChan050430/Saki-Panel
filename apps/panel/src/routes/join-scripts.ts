import type { FastifyInstance } from "fastify";
import { panelConfig } from "../config.js";

export async function registerJoinScriptRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/nodes/join.sh", async (request, reply) => {
    const query = request.query as { token?: string; name?: string; port?: string };
    const defaultUrl = panelConfig.publicUrl || `http://${request.hostname}`;
    const token = (query.token || "").replace(/["'\\]/g, "");
    const name = (query.name || "").replace(/["'\\]/g, "");
    const port = (query.port || "5480").replace(/[^0-9]/g, "") || "5480";

    const script = `#!/usr/bin/env bash
# ==========================================================
# Saki-Panel Daemon Node Join Script (Linux / macOS)
# ==========================================================
set -e

PANEL_URL="\${PANEL_URL:-${defaultUrl}}"
TOKEN="\${TOKEN:-${token}}"
NODE_NAME="\${NODE_NAME:-${name}}"
DAEMON_PORT="\${DAEMON_PORT:-${port}}"

# Parse command-line args if provided
while [[ $# -gt 0 ]]; do
  case $1 in
    --panel-url)
      PANEL_URL="$2"
      shift 2
      ;;
    --token)
      TOKEN="$2"
      shift 2
      ;;
    --name)
      NODE_NAME="$2"
      shift 2
      ;;
    --port)
      DAEMON_PORT="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [ -z "$PANEL_URL" ]; then
  echo "[-] Error: PANEL_URL is required."
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo "[-] Error: Enrollment TOKEN is required."
  exit 1
fi

if [ -z "$NODE_NAME" ]; then
  NODE_NAME="$(hostname)-$(uname -s)"
fi

echo "[+] =================================================="
echo "[+] Starting Saki-Panel Node Setup..."
echo "[+] Target Panel: $PANEL_URL"
echo "[+] Node Name:    $NODE_NAME"
echo "[+] Daemon Port:  $DAEMON_PORT"
echo "[+] =================================================="

# 1. Detect public/local IP
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' | head -n1 || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

# 2. Check curl
if ! command -v curl &>/dev/null; then
  echo "[+] Installing curl..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get update -y && sudo apt-get install -y curl
  elif command -v yum &>/dev/null; then
    sudo yum install -y curl
  fi
fi

# 3. Check Node.js
if ! command -v node &>/dev/null; then
  echo "[+] Node.js not detected. Installing Node.js..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  else
    echo "[-] Please install Node.js 18+ manually on this machine."
  fi
fi

echo "[+] Node.js version: $(node -v 2>/dev/null || echo 'not installed')"

# 4. Register node directly with Panel to verify connectivity
echo "[+] Contacting Saki-Panel to register node..."
REG_BODY=$(cat <<EOF
{
  "name": "$NODE_NAME",
  "host": "$LOCAL_IP",
  "port": $DAEMON_PORT,
  "protocol": "http",
  "os": "$(uname -s) $(uname -r)",
  "arch": "$(uname -m)",
  "version": "2.0.1"
}
EOF
)

REGISTER_RES=$(curl -fsSL -X POST "$PANEL_URL/api/daemon/register" \\
  -H "Content-Type: application/json" \\
  -H "x-registration-token: $TOKEN" \\
  -d "$REG_BODY" 2>&1 || true)

if echo "$REGISTER_RES" | grep -q "nodeId"; then
  echo "[+] Successfully registered with panel!"
  echo "[+] Response: $REGISTER_RES"
  echo ""
  echo "[+] Node has successfully joined Saki-Panel!"
  echo "[+] Check your Saki-Panel dashboard to verify the node is active."
else
  echo "[-] Registration warning or response: $REGISTER_RES"
  echo "[-] Please ensure Panel URL ($PANEL_URL) is reachable from this machine and the Token is valid."
fi
`;

    reply.type("text/x-shellscript; charset=utf-8").send(script);
  });

  app.get("/api/nodes/join.ps1", async (request, reply) => {
    const query = request.query as { token?: string; name?: string; port?: string };
    const defaultUrl = panelConfig.publicUrl || `http://${request.hostname}`;
    const token = (query.token || "").replace(/["'\\]/g, "");
    const name = (query.name || "").replace(/["'\\]/g, "");
    const port = (query.port || "5480").replace(/[^0-9]/g, "") || "5480";

    const script = `# ==========================================================
# Saki-Panel Daemon Node Join Script (Windows PowerShell)
# ==========================================================
param(
  [string]$PanelUrl = "${defaultUrl}",
  [string]$Token = "${token}",
  [string]$NodeName = "${name}",
  [int]$DaemonPort = ${port}
)

if (-not $PanelUrl) {
  Write-Error "PanelUrl is required."
  exit 1
}

if (-not $Token) {
  Write-Error "Enrollment Token is required."
  exit 1
}

if (-not $NodeName) {
  $NodeName = "$($env:COMPUTERNAME)-Windows"
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Starting Saki-Panel Node Setup (Windows)" -ForegroundColor Cyan
Write-Host " Target Panel: $PanelUrl" -ForegroundColor Gray
Write-Host " Node Name:    $NodeName" -ForegroundColor Gray
Write-Host " Daemon Port:  $DaemonPort" -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Detect Local IP
$LocalIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress
if (-not $LocalIp) { $LocalIp = "127.0.0.1" }

# 2. Check Node.js
$NodeInstalled = $false
try {
  $nodeVer = & node -v 2>$null
  if ($nodeVer) {
    Write-Host "[+] Detected Node.js: $nodeVer" -ForegroundColor Green
    $NodeInstalled = $true
  }
} catch {}

if (-not $NodeInstalled) {
  Write-Host "[!] Node.js not detected. Please install Node.js 18+ from https://nodejs.org/" -ForegroundColor Yellow
}

# 3. Register with Panel
Write-Host "[+] Contacting Saki-Panel to register node..." -ForegroundColor Cyan
$regBody = @{
  name = $NodeName
  host = $LocalIp
  port = $DaemonPort
  protocol = "http"
  os = "Windows $($([System.Environment]::OSVersion.Version))"
  arch = $env:PROCESSOR_ARCHITECTURE
  version = "2.0.1"
} | ConvertTo-Json

try {
  $headers = @{
    "Content-Type" = "application/json"
    "x-registration-token" = $Token
  }
  $response = Invoke-RestMethod -Uri "$PanelUrl/api/daemon/register" -Method Post -Headers $headers -Body $regBody
  Write-Host "[+] Successfully registered with panel!" -ForegroundColor Green
  Write-Host "[+] Node ID: $($response.nodeId)" -ForegroundColor Green
  Write-Host ""
  Write-Host "[+] Node has successfully joined Saki-Panel!" -ForegroundColor Cyan
  Write-Host "[+] Check your Saki-Panel dashboard to verify the node is active." -ForegroundColor Cyan
} catch {
  Write-Host "[-] Failed to register node: $_" -ForegroundColor Red
  Write-Host "[-] Please verify Panel URL ($PanelUrl) and Token validity." -ForegroundColor Red
}
`;

    reply.type("text/plain; charset=utf-8").send(script);
  });
}
