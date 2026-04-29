#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_PREFIX="${SERVICE_PREFIX:-saki}"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-$(id -un)}}"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn "${SERVICE_USER}" 2>/dev/null || echo "${SERVICE_USER}")}"
PANEL_PORT="${PANEL_PORT:-5479}"
WEB_PORT="${WEB_PORT:-5478}"
DAEMON_PORT="${DAEMON_PORT:-5480}"
SERVICE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer only supports Linux." >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run with sudo: sudo bash scripts/linux/install-systemd.sh" >&2
  exit 1
fi

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required but was not found in PATH." >&2
    exit 1
  fi
}

need_command systemctl
need_command node
need_command npm
need_command npx

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
NPX_BIN="$(command -v npx)"
NODE_DIR="$(dirname "${NODE_BIN}")"
NPM_DIR="$(dirname "${NPM_BIN}")"
NPX_DIR="$(dirname "${NPX_BIN}")"
SERVICE_PATH="${NODE_DIR}:${NPM_DIR}:${NPX_DIR}:${SERVICE_PATH}"

run_as_service_user() {
  local command="$1"
  if [[ "${SERVICE_USER}" == "root" ]]; then
    bash -lc "$command"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u "${SERVICE_USER}" -- bash -lc "$command"
  else
    sudo -u "${SERVICE_USER}" bash -lc "$command"
  fi
}

write_service() {
  local name="$1"
  local content="$2"
  local path="/etc/systemd/system/${name}.service"
  printf '%s\n' "${content}" > "${path}"
  chmod 0644 "${path}"
  echo "Wrote ${path}"
}

set_env_var() {
  local key="$1"
  local value="$2"
  local file="${ROOT}/.env"

  touch "${file}"
  if grep -qE "^${key}=" "${file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

port_is_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" 2>/dev/null | grep -q ":${port}"
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  return 1
}

wait_for_port() {
  local service="$1"
  local port="$2"

  for _ in $(seq 1 20); do
    if port_is_listening "${port}"; then
      echo "${service} is listening on ${port}"
      return 0
    fi
    sleep 1
  done

  echo "${service} did not start listening on ${port}." >&2
  systemctl status "${service}.service" --no-pager || true
  journalctl -u "${service}.service" -n 80 --no-pager || true
  return 1
}

echo "Project root: ${ROOT}"
echo "Service user: ${SERVICE_USER}"
echo "Service group: ${SERVICE_GROUP}"

mkdir -p "${ROOT}/data/panel" "${ROOT}/data/daemon" "${ROOT}/data/daemon/workspace"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${ROOT}/data" || true

if [[ ! -f "${ROOT}/.env" && -f "${ROOT}/.env.example" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${ROOT}/.env" || true
  echo "Created ${ROOT}/.env from .env.example. Change secrets before exposing this server."
fi

set_env_var "PANEL_PORT" "${PANEL_PORT}"
set_env_var "WEB_ORIGIN" "http://127.0.0.1:${WEB_PORT}"
set_env_var "DAEMON_PORT" "${DAEMON_PORT}"
set_env_var "DAEMON_PANEL_URL" "http://127.0.0.1:${PANEL_PORT}"
set_env_var "DAEMON_IDENTITY_FILE" "${ROOT}/data/daemon/identity-${DAEMON_PORT}.json"
chown "${SERVICE_USER}:${SERVICE_GROUP}" "${ROOT}/.env" || true

echo "Installing dependencies and building..."
run_as_service_user "cd '${ROOT}' && ${NPM_BIN} install && ${NPM_BIN} run db:generate && ${NPM_BIN} run build"

write_service "${SERVICE_PREFIX}-panel" "[Unit]
Description=Saki Panel API
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
EnvironmentFile=-${ROOT}/.env
Environment=NODE_ENV=production
Environment=PATH=${SERVICE_PATH}
Environment=PANEL_HOST=0.0.0.0
Environment=PANEL_PORT=${PANEL_PORT}
ExecStart=${NODE_BIN} apps/panel/dist/index.js
Restart=always
RestartSec=5
StartLimitIntervalSec=0
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target"

write_service "${SERVICE_PREFIX}-daemon" "[Unit]
Description=Saki Panel Daemon
Wants=network-online.target ${SERVICE_PREFIX}-panel.service
After=network-online.target ${SERVICE_PREFIX}-panel.service

[Service]
Type=simple
WorkingDirectory=${ROOT}
EnvironmentFile=-${ROOT}/.env
Environment=NODE_ENV=production
Environment=PATH=${SERVICE_PATH}
Environment=DAEMON_HOST=127.0.0.1
Environment=DAEMON_PORT=${DAEMON_PORT}
Environment=DAEMON_PANEL_URL=http://127.0.0.1:${PANEL_PORT}
Environment=DAEMON_IDENTITY_FILE=${ROOT}/data/daemon/identity-${DAEMON_PORT}.json
ExecStart=${NODE_BIN} apps/daemon/dist/index.js
Restart=always
RestartSec=5
StartLimitIntervalSec=0
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target"

write_service "${SERVICE_PREFIX}-web" "[Unit]
Description=Saki Panel Web
Wants=network-online.target ${SERVICE_PREFIX}-panel.service
After=network-online.target ${SERVICE_PREFIX}-panel.service

[Service]
Type=simple
WorkingDirectory=${ROOT}
EnvironmentFile=-${ROOT}/.env
Environment=NODE_ENV=production
Environment=PATH=${SERVICE_PATH}
Environment=VITE_HOST=0.0.0.0
ExecStart=${NPM_BIN} run preview -w @webops/web -- --host 0.0.0.0 --port ${WEB_PORT}
Restart=always
RestartSec=5
StartLimitIntervalSec=0
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target"

systemctl daemon-reload
systemctl enable --now "${SERVICE_PREFIX}-panel.service" "${SERVICE_PREFIX}-daemon.service" "${SERVICE_PREFIX}-web.service"

wait_for_port "${SERVICE_PREFIX}-panel" "${PANEL_PORT}"
wait_for_port "${SERVICE_PREFIX}-daemon" "${DAEMON_PORT}"
wait_for_port "${SERVICE_PREFIX}-web" "${WEB_PORT}"

echo
echo "Done. Services are enabled and started."
echo "Panel API: http://127.0.0.1:${PANEL_PORT}"
echo "Web UI:    http://127.0.0.1:${WEB_PORT}"
echo "Daemon:    http://127.0.0.1:${DAEMON_PORT}"
echo
echo "Useful commands:"
echo "  sudo systemctl status ${SERVICE_PREFIX}-panel ${SERVICE_PREFIX}-daemon ${SERVICE_PREFIX}-web"
echo "  sudo journalctl -u ${SERVICE_PREFIX}-panel -u ${SERVICE_PREFIX}-daemon -u ${SERVICE_PREFIX}-web -f"
echo "  sudo systemctl restart ${SERVICE_PREFIX}-panel ${SERVICE_PREFIX}-daemon ${SERVICE_PREFIX}-web"
