param(
  [int]$WebPort = 5478,
  [int]$PanelPort = 5479,
  [int]$DaemonPort = 5480,
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
  param(
    [int]$PreferredPort,
    [int[]]$ReservedPorts = @()
  )

  $port = $PreferredPort
  while ((Test-PortInUse -Port $port) -or ($ReservedPorts -contains $port)) {
    Write-Host "Port $port is occupied or reserved, trying $($port + 1)..."
    $port += 1
  }
  return $port
}

function Test-SslAvailable {
  param([string]$RootPath)

  $sslPath = Join-Path $RootPath "ssl"
  if (-not (Test-Path $sslPath -PathType Container)) {
    return $false
  }

  $hasCert = $false
  $hasKey = $false
  foreach ($file in Get-ChildItem -Path $sslPath -File) {
    if ($file.Extension -notmatch '^\.(pem|crt|cer|key)$') {
      continue
    }

    $text = Get-Content -Raw -LiteralPath $file.FullName -ErrorAction SilentlyContinue
    if ($text -match "-----BEGIN CERTIFICATE-----") {
      $hasCert = $true
    }
    if ($text -match "-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----") {
      $hasKey = $true
    }
  }

  return ($hasCert -and $hasKey)
}

function Set-ProjectEnv {
  param(
    [int]$ChosenWebPort,
    [int]$ChosenPanelPort,
    [int]$ChosenDaemonPort,
    [string]$Scheme,
    [string]$RootPath
  )

  $env:VITE_PORT = "$ChosenWebPort"

  $env:PANEL_HOST = "0.0.0.0"
  $env:PANEL_PORT = "$ChosenPanelPort"

  $env:DAEMON_HOST = "127.0.0.1"
  $env:DAEMON_PORT = "$ChosenDaemonPort"
  $env:DAEMON_PROTOCOL = "$Scheme"
  $env:DAEMON_IDENTITY_FILE = Join-Path $RootPath "data\daemon\identity-$ChosenDaemonPort.json"

  if ($Scheme -eq "https") {
    Remove-Item Env:WEB_ORIGIN -ErrorAction SilentlyContinue
    Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:PANEL_PUBLIC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:DAEMON_PANEL_URL -ErrorAction SilentlyContinue
  } else {
    $env:WEB_ORIGIN = "http://localhost:$ChosenWebPort"
    $env:VITE_API_BASE_URL = "http://localhost:$ChosenPanelPort"
    $env:PANEL_PUBLIC_URL = "http://localhost:$ChosenPanelPort"
    $env:DAEMON_PANEL_URL = "http://127.0.0.1:$ChosenPanelPort"
  }
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$ChosenWebPort = Find-FreePort -PreferredPort $WebPort
$ChosenPanelPort = Find-FreePort -PreferredPort $PanelPort -ReservedPorts @($ChosenWebPort)
$ChosenDaemonPort = Find-FreePort -PreferredPort $DaemonPort -ReservedPorts @($ChosenWebPort, $ChosenPanelPort)
$Scheme = if (Test-SslAvailable -RootPath $Root) { "https" } else { "http" }

Set-ProjectEnv -ChosenWebPort $ChosenWebPort -ChosenPanelPort $ChosenPanelPort -ChosenDaemonPort $ChosenDaemonPort -Scheme $Scheme -RootPath $Root

Write-Host ""
Write-Host "Saki Panel development ports:"
Write-Host "  Web    : ${Scheme}://localhost:$ChosenWebPort"
Write-Host "  Panel  : ${Scheme}://localhost:$ChosenPanelPort"
Write-Host "  Daemon : ${Scheme}://localhost:$ChosenDaemonPort"
if ($Scheme -eq "https") {
  Write-Host "  TLS    : enabled from ssl folder"
}
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
