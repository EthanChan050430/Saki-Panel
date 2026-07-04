#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_PREFIX="${SERVICE_PREFIX:-saki}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script only supports Linux." >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run with sudo: sudo bash scripts/linux/update-services.sh" >&2
  exit 1
fi

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required but was not found in PATH." >&2
    exit 1
  fi
}

need_command npm
need_command systemctl

SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-$(id -un)}}"

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

echo "Project root: ${ROOT}"
echo "Building workspaces..."
run_as_service_user "cd '${ROOT}' && NODE_ENV=development npm install && npm run db:generate && npm run build"

for artifact in \
  "packages/shared/dist/index.d.ts" \
  "apps/panel/dist/index.js" \
  "apps/daemon/dist/index.js" \
  "apps/web/dist/index.html"; do
  if [[ ! -f "${ROOT}/${artifact}" ]]; then
    echo "Build finished but expected artifact is missing: ${ROOT}/${artifact}" >&2
    exit 1
  fi
done

echo "Restarting services..."
systemctl restart "${SERVICE_PREFIX}-panel.service" "${SERVICE_PREFIX}-daemon.service" "${SERVICE_PREFIX}-web.service"
systemctl --no-pager --full status "${SERVICE_PREFIX}-panel.service" "${SERVICE_PREFIX}-daemon.service" "${SERVICE_PREFIX}-web.service" || true

echo
echo "Update complete. Daemon is now running compiled code from apps/*/dist."