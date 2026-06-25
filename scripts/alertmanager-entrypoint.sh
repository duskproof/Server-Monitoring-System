#!/bin/sh
set -e

CONFIG_TEMPLATE="/etc/alertmanager/alertmanager.yml.template"
CONFIG_FILE="/etc/alertmanager/alertmanager.yml"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
  echo "WARNING: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Telegram alerts will not work."
fi

sed \
  -e "s|\${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN}|g" \
  -e "s|\${TELEGRAM_CHAT_ID}|${TELEGRAM_CHAT_ID}|g" \
  "$CONFIG_TEMPLATE" > "$CONFIG_FILE"

exec /bin/alertmanager \
  --config.file="$CONFIG_FILE" \
  --storage.path=/alertmanager
