#!/bin/bash
# Monitoring system health check
# Usage: bash scripts/health-check.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

check_url() {
  local name="$1"
  local url="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    ok "$name is reachable ($url)"
    return 0
  fi
  fail "$name is unreachable ($url)"
  return 1
}

echo "=== Service check ==="
check_url "Node Exporter" "http://localhost:9100/metrics" || true
check_url "Prometheus" "http://localhost:9090/-/healthy" || true
check_url "Alertmanager" "http://localhost:9093/-/healthy" || true
check_url "Grafana" "http://localhost:3000/api/health" || true

echo ""
echo "=== Prometheus targets ==="
if curl -fsS "http://localhost:9090/api/v1/targets" 2>/dev/null | grep -q '"health":"up"'; then
  ok "Prometheus has active (UP) targets"
else
  warn "Check targets manually: http://localhost:9090/targets"
fi

echo ""
echo "=== Prometheus alert rules ==="
if curl -fsS "http://localhost:9090/api/v1/rules" 2>/dev/null | grep -q 'HighCPUUsage'; then
  ok "Prometheus alert rules loaded"
else
  warn "Alert rules not found — check alert_rules.yml"
fi

echo ""
echo "=== Grafana ==="
echo "  UI: http://localhost:3000"
echo "  Node Exporter Full dashboard: Dashboards → Server Monitoring"
echo "  Contact point: Alerting → Contact points → telegram-notifications"
echo ""
echo "To test Telegram in Grafana: Alerting → Contact points → Test"
