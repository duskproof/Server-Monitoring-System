#!/bin/bash
# Install Node Exporter (systemd) — Option 2
# Usage: sudo bash scripts/install-node-exporter.sh

set -euo pipefail

NODE_EXPORTER_VERSION="${NODE_EXPORTER_VERSION:-1.8.0}"
ARCH="linux-amd64"
TARBALL="node_exporter-${NODE_EXPORTER_VERSION}.${ARCH}.tar.gz"
URL="https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/${TARBALL}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

if ! id node_exporter &>/dev/null; then
  useradd --system --shell /bin/false node_exporter
fi

cd /tmp
curl -fsSLO "$URL"
tar -xvf "$TARBALL"
install -o node_exporter -g node_exporter -m 755 \
  "node_exporter-${NODE_EXPORTER_VERSION}.${ARCH}/node_exporter" /usr/local/bin/node_exporter
rm -rf "node_exporter-${NODE_EXPORTER_VERSION}.${ARCH}" "$TARBALL"

cat > /etc/systemd/system/node_exporter.service <<'EOF'
[Unit]
Description=Node Exporter
After=network-online.target
Wants=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now node_exporter
systemctl status node_exporter --no-pager

echo ""
echo "Node Exporter is running at http://localhost:9100/metrics"
