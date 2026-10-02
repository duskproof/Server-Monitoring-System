#!/usr/bin/env bash
# One-shot permanent VPSGuard install. Run on the Ubuntu host as root:
#   curl -fsSL "$BASE_URL/install-permanent.sh" | sudo BASE_URL="$BASE_URL" bash
set -euo pipefail

PUBLIC_IP="${PUBLIC_IP:-213.5.196.34}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3010}"
SERVER_PORT="${SERVER_PORT:-4000}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/vpsguard-src}"

if [[ -z "${BASE_URL:-}" ]]; then
  # Derive from the script URL when curl|bash sets BASH_SOURCE oddly — require explicit BASE_URL.
  echo "ERROR: set BASE_URL to the host serving this bootstrap (no trailing slash)" >&2
  echo "Example: curl -fsSL https://xxx.lhr.life/install-permanent.sh | sudo BASE_URL=https://xxx.lhr.life bash" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "==> Downloading VPSGuard source tree"
mkdir -p /tmp/vpsguard-bootstrap
curl -fsSL "${BASE_URL}/vpsguard-src.tar.gz" -o /tmp/vpsguard-bootstrap/vpsguard-src.tar.gz

echo "==> Extracting to ${INSTALL_ROOT}"
rm -rf "${INSTALL_ROOT}"
mkdir -p "${INSTALL_ROOT}"
tar -xzf /tmp/vpsguard-bootstrap/vpsguard-src.tar.gz -C "${INSTALL_ROOT}" --strip-components=1

cd "${INSTALL_ROOT}/deploy"
chmod +x permanent-setup.sh
PUBLIC_IP="${PUBLIC_IP}" \
  DASHBOARD_PORT="${DASHBOARD_PORT}" \
  SERVER_PORT="${SERVER_PORT}" \
  INSTALL_ROOT="${INSTALL_ROOT}" \
  bash permanent-setup.sh
