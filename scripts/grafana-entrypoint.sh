#!/bin/sh
set -e

CONTACT_TEMPLATE="/etc/grafana/provisioning/alerting/contactpoints.yml.template"
CONTACT_FILE="/etc/grafana/provisioning/alerting/contactpoints.yml"
DASHBOARD_DIR="/etc/grafana/provisioning/dashboards"
DASHBOARD_FILE="$DASHBOARD_DIR/node-exporter-full.json"

if [ -f "$CONTACT_TEMPLATE" ]; then
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    sed \
      -e "s|\${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN}|g" \
      -e "s|\${TELEGRAM_CHAT_ID}|${TELEGRAM_CHAT_ID}|g" \
      "$CONTACT_TEMPLATE" > "$CONTACT_FILE"
    echo "Grafana: contact point telegram-notifications configured."
  else
    echo "WARNING: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Skipping Telegram contact point provisioning."
  fi
fi

if [ ! -f "$DASHBOARD_FILE" ]; then
  echo "Grafana: downloading Node Exporter Full dashboard (ID 1860)..."
  if curl -fsSL "https://grafana.com/api/dashboards/1860/revisions/latest/download" -o "$DASHBOARD_FILE.tmp"; then
    sed 's/"id": [0-9]\+/"id": null/g' "$DASHBOARD_FILE.tmp" > "$DASHBOARD_FILE" || cp "$DASHBOARD_FILE.tmp" "$DASHBOARD_FILE"
    rm -f "$DASHBOARD_FILE.tmp"
    echo "Grafana: Node Exporter Full dashboard downloaded."
  else
    echo "WARNING: failed to download dashboard 1860. Import manually via the UI."
    rm -f "$DASHBOARD_FILE.tmp"
  fi
fi
