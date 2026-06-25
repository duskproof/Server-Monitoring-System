#!/bin/bash
# Install Prometheus (systemd) — Option 2
# Usage: sudo bash scripts/install-prometheus.sh

set -euo pipefail

PROMETHEUS_VERSION="${PROMETHEUS_VERSION:-2.42.0}"
ARCH="linux-amd64"
TARBALL="prometheus-${PROMETHEUS_VERSION}.${ARCH}.tar.gz"
URL="https://github.com/prometheus/prometheus/releases/download/v${PROMETHEUS_VERSION}/${TARBALL}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

if ! id prometheus &>/dev/null; then
  useradd --system --shell /bin/false prometheus
fi

cd /tmp
curl -fsSLO "$URL"
tar -xvf "$TARBALL"
install -m 755 "prometheus-${PROMETHEUS_VERSION}.${ARCH}/prometheus" /usr/local/bin/prometheus
install -m 755 "prometheus-${PROMETHEUS_VERSION}.${ARCH}/promtool" /usr/local/bin/promtool

mkdir -p /etc/prometheus /var/lib/prometheus
cp -r "prometheus-${PROMETHEUS_VERSION}.${ARCH}/consoles" /etc/prometheus/
cp -r "prometheus-${PROMETHEUS_VERSION}.${ARCH}/console_libraries" /etc/prometheus/
cp "$REPO_DIR/prometheus/prometheus.yml" /etc/prometheus/prometheus.yml
cp "$REPO_DIR/prometheus/alert_rules.yml" /etc/prometheus/alert_rules.yml

# For manual install with Node Exporter on localhost
sed -i 's/node-exporter:9100/localhost:9100/g' /etc/prometheus/prometheus.yml
sed -i '/alertmanager:9093/d' /etc/prometheus/prometheus.yml || true

rm -rf "prometheus-${PROMETHEUS_VERSION}.${ARCH}" "$TARBALL"

cat > /etc/systemd/system/prometheus.service <<'EOF'
[Unit]
Description=Prometheus
After=network-online.target
Wants=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus/ \
  --web.console.templates=/etc/prometheus/consoles \
  --web.console.libraries=/etc/prometheus/console_libraries \
  --web.enable-lifecycle
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus
systemctl daemon-reload
systemctl enable --now prometheus
systemctl status prometheus --no-pager

echo ""
echo "Prometheus UI: http://localhost:9090"
