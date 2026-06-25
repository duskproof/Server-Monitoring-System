#!/bin/bash
# Quick start for the Docker Compose stack
# Usage: bash scripts/start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo ".env file not found. Copying from .env.example..."
  cp .env.example .env
  echo ""
  echo "Edit .env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GRAFANA_ADMIN_PASSWORD)"
  echo "Then run again: bash scripts/start.sh"
  exit 1
fi

if grep -q "your_bot_token_here" .env || grep -q "your_chat_id_here" .env; then
  echo "WARNING: .env still contains placeholder Telegram values. Alerts will not work until configured."
fi

docker compose up -d

echo ""
echo "Stack started. Wait 30–60 seconds for Grafana to initialize."
echo ""
echo "  Grafana:       http://localhost:3000"
echo "  Prometheus:    http://localhost:9090"
echo "  Alertmanager:  http://localhost:9093"
echo "  Node Exporter: http://localhost:9100/metrics"
echo ""
echo "Health check: bash scripts/health-check.sh"
