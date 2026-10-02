#!/usr/bin/env bash
#
# VPSGuard agent installer.
#
#   curl -fsSL https://monitor.example.com/install.sh | sudo bash -s -- \
#       --url https://monitor.example.com --api-key YOUR_API_KEY
#
# Supported: Ubuntu 20.04+, Debian 11+, CentOS 8+, AlmaLinux 8+, Rocky 8+,
#            Fedora, openSUSE (anything with apt-get, dnf, yum or zypper).
#
set -euo pipefail

AGENT_USER="vpsguard"
AGENT_GROUP="vpsguard"
CONFIG_DIR="/etc/vpsguard"
CONFIG_FILE="${CONFIG_DIR}/agent.conf"
STATE_DIR="/var/lib/vpsguard"
LOG_DIR="/var/log/vpsguard"
VENV_DIR="/opt/vpsguard"
SERVICE_NAME="vpsguard-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PACKAGE_NAME="vpsguard-agent"

SERVER_URL=""
API_KEY=""
INTERVAL="30"
SLOW_INTERVAL="300"
LOG_LEVEL="info"
ALLOW_COMMANDS="true"
VERIFY_TLS="true"
SOURCE=""
DO_UNINSTALL="false"
DO_PURGE="false"
ASSUME_YES="false"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

if [ -t 1 ]; then
    C_RED="$(printf '\033[0;31m')"
    C_GREEN="$(printf '\033[0;32m')"
    C_YELLOW="$(printf '\033[0;33m')"
    C_BLUE="$(printf '\033[0;34m')"
    C_BOLD="$(printf '\033[1m')"
    C_RESET="$(printf '\033[0m')"
else
    C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

info()  { printf '%s==>%s %s\n' "${C_BLUE}" "${C_RESET}" "$*"; }
ok()    { printf '%s[ok]%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn()  { printf '%s[warn]%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
error() { printf '%s[error]%s %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; }
die()   { error "$*"; exit 1; }

usage() {
    cat <<'EOF'
VPSGuard agent installer

Usage:
  install.sh --url URL --api-key KEY [options]
  install.sh --uninstall [--purge]

Options:
  --url URL                 VPSGuard server base URL (required for install)
  --api-key KEY             API key issued by the server (required for install)
  --interval SECONDS        Fast tier interval (default: 30)
  --slow-interval SECONDS   Slow tier interval (default: 300)
  --log-level LEVEL         debug|info|warning|error|critical (default: info)
  --no-commands             Disable remote command execution
  --no-verify-tls           Disable TLS verification (testing only)
  --source SPEC             pip requirement, local path or URL of the agent
                            package (default: local source tree, then PyPI)
  --uninstall               Remove the agent (keeps config and data)
  --purge                   With --uninstall: also remove config and data
  --yes                     Do not ask for confirmation
  -h, --help                Show this help
EOF
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --url)            SERVER_URL="${2:-}"; shift 2 ;;
            --api-key)        API_KEY="${2:-}"; shift 2 ;;
            --interval)       INTERVAL="${2:-}"; shift 2 ;;
            --slow-interval)  SLOW_INTERVAL="${2:-}"; shift 2 ;;
            --log-level)      LOG_LEVEL="${2:-}"; shift 2 ;;
            --source)         SOURCE="${2:-}"; shift 2 ;;
            --no-commands)    ALLOW_COMMANDS="false"; shift ;;
            --no-verify-tls)  VERIFY_TLS="false"; shift ;;
            --uninstall)      DO_UNINSTALL="true"; shift ;;
            --purge)          DO_PURGE="true"; shift ;;
            --yes|-y)         ASSUME_YES="true"; shift ;;
            -h|--help)        usage; exit 0 ;;
            *)                usage; die "Unknown argument: $1" ;;
        esac
    done
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        die "This installer must run as root (use sudo)."
    fi
}

detect_os() {
    OS_NAME="unknown"; OS_VERSION="unknown"
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS_NAME="${ID:-unknown}"
        OS_VERSION="${VERSION_ID:-unknown}"
    fi
    info "Detected OS: ${OS_NAME} ${OS_VERSION} ($(uname -m))"
}

detect_pkg_manager() {
    if command -v apt-get >/dev/null 2>&1; then
        PKG_MANAGER="apt"
    elif command -v dnf >/dev/null 2>&1; then
        PKG_MANAGER="dnf"
    elif command -v yum >/dev/null 2>&1; then
        PKG_MANAGER="yum"
    elif command -v zypper >/dev/null 2>&1; then
        PKG_MANAGER="zypper"
    else
        die "No supported package manager found (apt-get, dnf, yum, zypper)."
    fi
    info "Using package manager: ${PKG_MANAGER}"
}

install_dependencies() {
    info "Installing system dependencies"
    case "${PKG_MANAGER}" in
        apt)
            export DEBIAN_FRONTEND=noninteractive
            apt-get update -qq
            apt-get install -y -qq python3 python3-venv python3-pip ca-certificates >/dev/null
            ;;
        dnf)
            dnf install -y -q python3 python3-pip ca-certificates >/dev/null
            ;;
        yum)
            yum install -y -q python3 python3-pip ca-certificates >/dev/null
            ;;
        zypper)
            zypper --non-interactive --quiet install python3 python3-pip ca-certificates >/dev/null
            ;;
    esac

    command -v python3 >/dev/null 2>&1 || die "python3 is still missing after installation."
    local py_version
    py_version="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
    ok "python3 ${py_version} available"
    python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' \
        || die "Python 3.8 or newer is required (found ${py_version})."
}

create_user() {
    if id "${AGENT_USER}" >/dev/null 2>&1; then
        ok "System user ${AGENT_USER} already exists"
    else
        info "Creating system user ${AGENT_USER}"
        if command -v useradd >/dev/null 2>&1; then
            useradd --system --no-create-home --shell /usr/sbin/nologin \
                    --home-dir "${STATE_DIR}" "${AGENT_USER}" 2>/dev/null \
                || useradd --system --no-create-home --shell /sbin/nologin \
                           --home-dir "${STATE_DIR}" "${AGENT_USER}"
        else
            die "useradd is not available; create the ${AGENT_USER} user manually."
        fi
        ok "Created system user ${AGENT_USER}"
    fi

    # Optional collectors: logs / journal / docker
    local groups=()
    getent group adm >/dev/null 2>&1 && groups+=("adm")
    getent group systemd-journal >/dev/null 2>&1 && groups+=("systemd-journal")
    getent group docker >/dev/null 2>&1 && groups+=("docker")
    if [ "${#groups[@]}" -gt 0 ] && command -v usermod >/dev/null 2>&1; then
        usermod -aG "$(IFS=,; echo "${groups[*]}")" "${AGENT_USER}" 2>/dev/null \
            && ok "Added ${AGENT_USER} to groups: ${groups[*]}" \
            || warn "Could not add supplementary groups (${groups[*]})"
    fi
}

create_directories() {
    info "Creating directories"
    install -d -m 0750 -o root -g "${AGENT_GROUP}" "${CONFIG_DIR}"
    install -d -m 0750 -o "${AGENT_USER}" -g "${AGENT_GROUP}" "${STATE_DIR}"
    install -d -m 0750 -o "${AGENT_USER}" -g "${AGENT_GROUP}" "${LOG_DIR}"
    ok "Directories ready: ${CONFIG_DIR}, ${STATE_DIR}, ${LOG_DIR}"
}

# test-config / collect-once often run as root during install and can leave
# root-owned SQLite files that the service user cannot open.
fix_runtime_permissions() {
    chown -R "${AGENT_USER}:${AGENT_GROUP}" "${STATE_DIR}" "${LOG_DIR}"
    chmod 0750 "${STATE_DIR}" "${LOG_DIR}"
    # Config must stay readable by the agent; keep mode 600.
    if [ -f "${CONFIG_FILE}" ]; then
        chown "${AGENT_USER}:${AGENT_GROUP}" "${CONFIG_FILE}"
        chmod 600 "${CONFIG_FILE}"
    fi
}

resolve_source() {
    if [ -n "${SOURCE}" ]; then
        echo "${SOURCE}"
        return
    fi
    # Remote install: prefer the package served by the VPSGuard API.
    if [ -n "${SERVER_URL}" ]; then
        echo "${SERVER_URL%/}/download/vpsguard-agent.tar.gz"
        return
    fi
    if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/../pyproject.toml" ]; then
        (cd "${SCRIPT_DIR}/.." && pwd)
        return
    fi
    echo "${PACKAGE_NAME}"
}

install_agent() {
    local source
    source="$(resolve_source)"
    info "Installing the agent into ${VENV_DIR} (source: ${source})"

    python3 -m venv "${VENV_DIR}" 2>/dev/null || {
        warn "python3 -m venv failed, retrying with --without-pip + get-pip"
        python3 -m venv --without-pip "${VENV_DIR}"
        curl -fsSL https://bootstrap.pypa.io/get-pip.py | "${VENV_DIR}/bin/python"
    }

    "${VENV_DIR}/bin/python" -m pip install --quiet --upgrade pip setuptools wheel

    if ! "${VENV_DIR}/bin/python" -m pip install --quiet "${source}"; then
        if [ -n "${SERVER_URL}" ] && [[ "${source}" != */download/vpsguard-agent.tar.gz ]]; then
            local fallback="${SERVER_URL%/}/download/vpsguard-agent.tar.gz"
            warn "Install from '${source}' failed, trying ${fallback}"
            "${VENV_DIR}/bin/python" -m pip install --quiet "${fallback}" \
                || die "Could not install the agent package."
        else
            die "Could not install the agent package from '${source}'."
        fi
    fi

    chown -R root:root "${VENV_DIR}"
    local version
    version="$("${VENV_DIR}/bin/python" -m vpsguard_agent version)"
    ok "Installed ${version}"
}

write_config() {
    if [ -f "${CONFIG_FILE}" ]; then
        local backup="${CONFIG_FILE}.$(date +%Y%m%d%H%M%S).bak"
        cp -p "${CONFIG_FILE}" "${backup}"
        warn "Existing configuration backed up to ${backup}"
    fi

    info "Writing ${CONFIG_FILE}"
    umask 077
    cat > "${CONFIG_FILE}" <<EOF
# Generated by the VPSGuard installer on $(date -Is)
[server]
url = ${SERVER_URL}
api_key = ${API_KEY}

[agent]
interval = ${INTERVAL}
slow_interval = ${SLOW_INTERVAL}
log_level = ${LOG_LEVEL}
buffer_size = 1000
buffer_retention_hours = 24
allow_commands = ${ALLOW_COMMANDS}
command_user = ${AGENT_USER}
command_timeout = 60
verify_tls = ${VERIFY_TLS}
state_dir = ${STATE_DIR}

[metrics]
cpu = true
memory = true
disk = true
network = true
processes = true
docker = true
security = true
ssl = true
logs = true
services = true
temperature = true
smart = true

[logs]
files = $(default_log_files)
patterns = error,critical,failed,denied
max_lines = 2000

[ssl]
domains =
EOF
    # The agent runs as ${AGENT_USER} and must be able to read its own config.
    chown "${AGENT_USER}":"${AGENT_GROUP}" "${CONFIG_FILE}"
    chmod 600 "${CONFIG_FILE}"
    ok "Configuration written with mode 600"
}

default_log_files() {
    local files=""
    for candidate in /var/log/syslog /var/log/messages /var/log/auth.log /var/log/secure; do
        if [ -f "${candidate}" ]; then
            files="${files:+${files},}${candidate}"
        fi
    done
    echo "${files:-/var/log/syslog,/var/log/auth.log}"
}

install_service() {
    info "Installing the systemd unit"
    # Prefer downloading the unit from the API (curl|bash has no local packaging/).
    local unit_src=""
    if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/${SERVICE_NAME}.service" ]; then
        unit_src="${SCRIPT_DIR}/${SERVICE_NAME}.service"
    elif [ -n "${SERVER_URL}" ]; then
        local tmp_unit
        tmp_unit="$(mktemp)"
        if curl -fsSL "${SERVER_URL%/}/download/${SERVICE_NAME}.service" -o "${tmp_unit}" 2>/dev/null; then
            unit_src="${tmp_unit}"
        else
            rm -f "${tmp_unit}"
        fi
    fi

    if [ -n "${unit_src}" ]; then
        install -m 0644 "${unit_src}" "${SERVICE_FILE}"
        [[ "${unit_src}" == /tmp/* ]] && rm -f "${unit_src}"
    else
        cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=VPSGuard monitoring agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${AGENT_USER}
Group=${AGENT_GROUP}
ExecStart=${VENV_DIR}/bin/python -m vpsguard_agent run --config ${CONFIG_FILE}
Restart=always
RestartSec=10
StateDirectory=vpsguard
LogsDirectory=vpsguard
ConfigurationDirectory=vpsguard
MemoryMax=128M
CPUQuota=20%
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=${STATE_DIR} ${LOG_DIR}
PrivateTmp=yes
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
        chmod 0644 "${SERVICE_FILE}"
    fi

    if ! command -v systemctl >/dev/null 2>&1; then
        warn "systemd not detected; start the agent manually:"
        warn "  ${VENV_DIR}/bin/python -m vpsguard_agent run --config ${CONFIG_FILE}"
        return
    fi
    systemctl daemon-reload
    systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1 || warn "Could not enable the unit"
    ok "Unit installed and enabled"
}

verify_config() {
    info "Validating the configuration and server connectivity"
    # Run as the service user so we do not create root-owned buffer.db.
    local runner=( "${VENV_DIR}/bin/python" -m vpsguard_agent test-config --config "${CONFIG_FILE}" )
    if command -v runuser >/dev/null 2>&1; then
        runner=( runuser -u "${AGENT_USER}" -- "${runner[@]}" )
    elif command -v su >/dev/null 2>&1; then
        runner=( su -s /bin/sh "${AGENT_USER}" -c "${VENV_DIR}/bin/python -m vpsguard_agent test-config --config ${CONFIG_FILE}" )
    fi
    if "${runner[@]}"; then
        ok "test-config passed"
        return 0
    fi
    warn "test-config reported problems (see the output above)."
    warn "The agent is installed; fix ${CONFIG_FILE} and run:"
    warn "  systemctl restart ${SERVICE_NAME}"
    return 1
}

start_service() {
    command -v systemctl >/dev/null 2>&1 || return 0
    fix_runtime_permissions
    info "Starting ${SERVICE_NAME}"
    systemctl restart "${SERVICE_NAME}"
    sleep 2
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
        ok "Service is running"
    else
        warn "Service is not active. Recent log output:"
        journalctl -u "${SERVICE_NAME}" -n 20 --no-pager || true
    fi
}

print_summary() {
    printf '\n%s%s VPSGuard agent installed %s\n\n' "${C_BOLD}" "${C_GREEN}" "${C_RESET}"
    printf '  Server URL     : %s\n' "${SERVER_URL}"
    printf '  Interval       : %ss (slow tier: %ss)\n' "${INTERVAL}" "${SLOW_INTERVAL}"
    printf '  Config file    : %s (mode 600)\n' "${CONFIG_FILE}"
    printf '  Install prefix : %s\n' "${VENV_DIR}"
    printf '  State / logs   : %s , %s\n' "${STATE_DIR}" "${LOG_DIR}"
    printf '  Runs as user   : %s\n' "${AGENT_USER}"
    printf '\n  Useful commands:\n'
    printf '    systemctl status %s\n' "${SERVICE_NAME}"
    printf '    journalctl -u %s -f\n' "${SERVICE_NAME}"
    printf '    %s/bin/python -m vpsguard_agent collect-once\n' "${VENV_DIR}"
    printf '    %s/bin/python -m vpsguard_agent test-config\n' "${VENV_DIR}"
    printf '\n  Uninstall: curl -fsSL <install.sh> | sudo bash -s -- --uninstall\n\n'
}

do_install() {
    [ -n "${SERVER_URL}" ] || { usage; die "--url is required."; }
    [ -n "${API_KEY}" ] || { usage; die "--api-key is required."; }
    case "${SERVER_URL}" in
        http://*|https://*) ;;
        *) die "--url must start with http:// or https://" ;;
    esac

    require_root
    detect_os
    detect_pkg_manager
    install_dependencies
    create_user
    create_directories
    install_agent
    write_config
    install_service
    verify_config || true
    start_service
    print_summary
}

do_uninstall() {
    require_root
    if [ "${DO_PURGE}" = "true" ] && [ "${ASSUME_YES}" != "true" ] && [ -t 0 ]; then
        printf 'This removes %s, %s and %s permanently. Continue? [y/N] ' \
            "${CONFIG_DIR}" "${STATE_DIR}" "${LOG_DIR}"
        read -r reply
        case "${reply}" in
            y|Y|yes|YES) ;;
            *) die "Aborted." ;;
        esac
    fi
    info "Uninstalling the VPSGuard agent"

    if command -v systemctl >/dev/null 2>&1; then
        systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
        systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    fi
    rm -f "${SERVICE_FILE}"
    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload || true
    fi
    rm -rf "${VENV_DIR}"
    ok "Service and program files removed"

    if [ "${DO_PURGE}" = "true" ]; then
        rm -rf "${CONFIG_DIR}" "${STATE_DIR}" "${LOG_DIR}"
        if id "${AGENT_USER}" >/dev/null 2>&1 && command -v userdel >/dev/null 2>&1; then
            userdel "${AGENT_USER}" 2>/dev/null || warn "Could not delete user ${AGENT_USER}"
        fi
        ok "Configuration, state, logs and the ${AGENT_USER} user removed"
    else
        ok "Kept ${CONFIG_DIR}, ${STATE_DIR} and ${LOG_DIR} (use --purge to remove them)"
    fi
    printf '\n%sVPSGuard agent uninstalled.%s\n\n' "${C_GREEN}" "${C_RESET}"
}

main() {
    parse_args "$@"
    if [ "${DO_UNINSTALL}" = "true" ]; then
        do_uninstall
    else
        do_install
    fi
}

main "$@"
