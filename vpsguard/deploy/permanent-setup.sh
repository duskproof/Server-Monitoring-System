#!/usr/bin/env bash
# Permanent VPSGuard deploy on the same Ubuntu host that runs the agent.
# Usage (as root):
#   PUBLIC_IP=213.5.196.34 bash permanent-setup.sh
# Or from a copied tree:
#   cd /opt/vpsguard-src/deploy && PUBLIC_IP=213.5.196.34 bash permanent-setup.sh
set -euo pipefail

PUBLIC_IP="${PUBLIC_IP:-213.5.196.34}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3010}"
SERVER_PORT="${SERVER_PORT:-4000}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/vpsguard-src}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '==> %s\n' "$*"; }
ok() { printf '[ok] %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo)"
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker Compose already available: $(docker compose version --short 2>/dev/null || true)"
    return
  fi
  log "Installing Docker Engine + Compose plugin"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  ok "Docker installed"
}

ensure_tree() {
  if [[ -f "${SCRIPT_DIR}/docker-compose.yml" ]]; then
    DEPLOY_DIR="${SCRIPT_DIR}"
    return
  fi
  [[ -f "${INSTALL_ROOT}/deploy/docker-compose.yml" ]] \
    || die "Cannot find deploy/docker-compose.yml (set INSTALL_ROOT or run from deploy/)"
  DEPLOY_DIR="${INSTALL_ROOT}/deploy"
}

write_env() {
  local env_file="${DEPLOY_DIR}/.env"
  if [[ -f "${env_file}" ]]; then
    ok ".env already exists at ${env_file} (leaving secrets intact)"
    # Always refresh public URLs for this host
    sed -i \
      -e "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=http://${PUBLIC_IP}:${SERVER_PORT}|" \
      -e "s|^PUBLIC_WS_URL=.*|PUBLIC_WS_URL=http://${PUBLIC_IP}:${SERVER_PORT}|" \
      -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://${PUBLIC_IP}:${DASHBOARD_PORT}|" \
      -e "s|^DASHBOARD_PORT=.*|DASHBOARD_PORT=${DASHBOARD_PORT}|" \
      -e "s|^SERVER_PORT=.*|SERVER_PORT=${SERVER_PORT}|" \
      "${env_file}"
    return
  fi

  log "Creating production .env"
  local influx_token jwt_access jwt_refresh pg_pass influx_pass redis_pass
  influx_token="$(openssl rand -hex 32)"
  jwt_access="$(openssl rand -hex 48)"
  jwt_refresh="$(openssl rand -hex 48)"
  pg_pass="$(openssl rand -base64 32 | tr -d '=+/')"
  influx_pass="$(openssl rand -base64 32 | tr -d '=+/')"
  redis_pass="$(openssl rand -base64 32 | tr -d '=+/')"

  cat > "${env_file}" <<EOF
POSTGRES_USER=vpsguard
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=vpsguard
POSTGRES_SYNCHRONIZE=true

INFLUX_USER=vpsguard
INFLUX_PASSWORD=${influx_pass}
INFLUX_ORG=vpsguard
INFLUX_BUCKET=metrics
INFLUX_RETENTION=30d
INFLUX_TOKEN=${influx_token}

REDIS_PASSWORD=${redis_pass}

JWT_ACCESS_SECRET=${jwt_access}
JWT_REFRESH_SECRET=${jwt_refresh}

ADMIN_EMAIL=${ADMIN_EMAIL:-admin@vpsguard.local}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-ChangeMe123!}

SERVER_PORT=${SERVER_PORT}
DASHBOARD_PORT=${DASHBOARD_PORT}
PUBLIC_API_URL=http://${PUBLIC_IP}:${SERVER_PORT}
PUBLIC_WS_URL=http://${PUBLIC_IP}:${SERVER_PORT}
CORS_ORIGINS=http://${PUBLIC_IP}:${DASHBOARD_PORT}

AGENT_OFFLINE_AFTER_SECONDS=120
ALLOW_PUBLIC_REGISTRATION=true

TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
SLACK_WEBHOOK_URL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=vpsguard@example.com
EOF
  chmod 600 "${env_file}"
  ok "Wrote ${env_file}"
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    ufw allow "${SERVER_PORT}/tcp" >/dev/null 2>&1 || true
    ufw allow "${DASHBOARD_PORT}/tcp" >/dev/null 2>&1 || true
    ok "ufw rules for ${SERVER_PORT} and ${DASHBOARD_PORT} (if ufw active)"
  fi
}

compose_up() {
  log "Building and starting Docker Compose stack"
  cd "${DEPLOY_DIR}"
  docker compose up -d --build
  local i=0
  until curl -fsS "http://127.0.0.1:${SERVER_PORT}/api/v1/health" >/dev/null 2>&1; do
    i=$((i + 1))
    [[ "${i}" -lt 60 ]] || die "API health check failed after ~2 minutes"
    sleep 2
  done
  ok "API healthy: $(curl -fsS "http://127.0.0.1:${SERVER_PORT}/api/v1/health")"
}

retarget_agent() {
  local conf="/etc/vpsguard/agent.conf"
  if [[ ! -f "${conf}" ]]; then
    log "No agent.conf yet — register the server in the dashboard and install the agent against http://127.0.0.1:${SERVER_PORT}"
    return
  fi
  log "Pointing agent at local API http://127.0.0.1:${SERVER_PORT}"
  if grep -qE '^[[:space:]]*url[[:space:]]*=' "${conf}"; then
    sed -i -E "s|^[[:space:]]*url[[:space:]]*=.*|url = http://127.0.0.1:${SERVER_PORT}|" "${conf}"
  else
    printf '\n[server]\nurl = http://127.0.0.1:%s\n' "${SERVER_PORT}" >> "${conf}"
  fi

  # Refresh agent package from the local stack when available
  if curl -fsS "http://127.0.0.1:${SERVER_PORT}/download/vpsguard-agent.tar.gz" -o /tmp/vpsguard-agent.tar.gz; then
    if [[ -x /opt/vpsguard/bin/pip ]]; then
      /opt/vpsguard/bin/pip install --upgrade /tmp/vpsguard-agent.tar.gz || true
    fi
    rm -f /tmp/vpsguard-agent.tar.gz
  fi

  systemctl daemon-reload 2>/dev/null || true
  systemctl restart vpsguard-agent 2>/dev/null || true
  ok "Agent retargeted (if installed)"
}

hardware_pkgs() {
  log "Installing lm-sensors and smartmontools"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y lm-sensors smartmontools
  sensors-detect --auto >/dev/null 2>&1 || true
  ok "Hardware packages installed"
}

main() {
  need_root
  install_docker
  ensure_tree
  write_env
  open_firewall
  compose_up
  retarget_agent
  hardware_pkgs
  cat <<EOF

Permanent VPSGuard is up.

  Dashboard: http://${PUBLIC_IP}:${DASHBOARD_PORT}
  API:       http://${PUBLIC_IP}:${SERVER_PORT}
  Health:    http://${PUBLIC_IP}:${SERVER_PORT}/api/v1/health
  Admin:     ${ADMIN_EMAIL:-admin@vpsguard.local} (see deploy/.env)

Default alert rules seed on first API boot (CPU/RAM/disk/temp/SSH/offline/SSL).
Optional Telegram: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in deploy/.env and
  docker compose up -d server

EOF
}

main "$@"
