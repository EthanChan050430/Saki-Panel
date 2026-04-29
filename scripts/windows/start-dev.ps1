param(
  [int]$WebPort = 5478,
  [int]$PanelPort = 5479,
  [int]$DaemonPort = 24444,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Test-PortInUse {
  param([int]$Port)

  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    $listener.Stop()
    return $false
  } catch {
    return $true
  }
}

function Find-FreePort {
  param([int]$PreferredPort)

  $port = $PreferredPort
  while (Test-PortInUse -Port $port) {
    Write-Host "Port $port is occupied, trying $($port + 1)..."
    $port += 1
  }
  return $port
}

function Set-ProjectEnv {
  param(
    [int]$ChosenWebPort,
    [int]$ChosenPanelPort,
    [int]$ChosenDaemonPort,
    [string]$RootPath
  )

  $env:WEB_ORIGIN = "http://localhost:$ChosenWebPort"
  $env:VITE_PORT = "$ChosenWebPort"
  $env:VITE_API_BASE_URL = "http://localhost:$ChosenPanelPort"

  $env:PANEL_HOST = "0.0.0.0"
  $env:PANEL_PORT = "$ChosenPanelPort"
  $env:PANEL_PUBLIC_URL = "http://localhost:$ChosenPanelPort"

  $env:DAEMON_HOST = "127.0.0.1"
  $env:DAEMON_PORT = "$ChosenDaemonPort"
  $env:DAEMON_PROTOCOL = "http"
  $env:DAEMON_PANEL_URL = "http://127.0.0.1:$ChosenPanelPort"
  $env:DAEMON_IDENTITY_FILE = Join-Path $RootPath "data\daemon\identity-$ChosenDaemonPort.json"
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$ChosenWebPort = Find-FreePort -PreferredPort $WebPort
$ChosenPanelPort = Find-FreePort -PreferredPort $PanelPort
$ChosenDaemonPort = Find-FreePort -PreferredPort $DaemonPort

Set-ProjectEnv -ChosenWebPort $ChosenWebPort -ChosenPanelPort $ChosenPanelPort -ChosenDaemonPort $ChosenDaemonPort -RootPath $Root

Write-Host ""
Write-Host "Saki Panel development ports:"
Write-Host "  Web    : http://localhost:$ChosenWebPort"
Write-Host "  Panel  : http://localhost:$ChosenPanelPort"
Write-Host "  Daemon : http://localhost:$ChosenDaemonPort"
Write-Host ""

if ($DryRun) {
  Write-Host "Dry run complete. Services were not started."
  exit 0
}

New-Item -ItemType Directory -Force -Path "data\panel", "data\daemon", "data\daemon\workspace" | Out-Null

if (-not $SkipInstall) {
  Write-Host "Installing dependencies..."
  npm install
}

if (-not (Test-Path "node_modules\.prisma\client\index.d.ts")) {
  Write-Host "Generating Prisma client..."
  npx prisma generate
}

Write-Host "Synchronizing database schema..."
npx prisma db push --skip-generate

if (-not $SkipBuild) {
  Write-Host "Building shared package..."
  npm run build -w @webops/shared
}

Write-Host ""
Write-Host "Starting Panel, Daemon and Web. Press Ctrl+C to stop."
Write-Host ""

npx concurrently `
  -n "panel,daemon,web" `
  -c "cyan,green,magenta" `
  "npm run dev -w @webops/panel" `
  "npm run dev -w @webops/daemon" `
  "npm run dev -w @webops/web"
