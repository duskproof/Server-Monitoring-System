#!/usr/bin/env bash
#
# VPSGuard acceptance smoke test.
#
# Verifies the deployment against the acceptance criteria: the API is healthy,
# authentication works, a server can be registered, an agent packet is ingested
# and visible within 60 seconds, and a CPU breach raises a Telegram-capable alert.
#
# Usage: ./smoke-test.sh [--url http://localhost:4000] [--email admin@vpsguard.local] [--password ChangeMe123!]

set -euo pipefail

API_URL="http://localhost:4000"
EMAIL="admin@vpsguard.local"
PASSWORD="ChangeMe123!"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) API_URL="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

API="${API_URL%/}/api/v1"
PASSED=0
FAILED=0

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m==> %s\033[0m\n' "$1"; }

check() {
  local name="$1" condition="$2"
  if [[ "$condition" == "true" ]]; then
    green "  PASS  $name"; PASSED=$((PASSED + 1))
  else
    red   "  FAIL  $name"; FAILED=$((FAILED + 1))
  fi
}

require() {
  command -v "$1" >/dev/null 2>&1 || { red "Missing required tool: $1"; exit 1; }
}

require curl
require jq

# ---------------------------------------------------------------- 1. health
info "Checking API health"
HEALTH=$(curl -fsS "${API}/health" 2>/dev/null || echo '{}')
check "API is reachable and healthy" "$([[ $(jq -r '.status // "down"' <<<"$HEALTH") == "ok" ]] && echo true || echo false)"
check "PostgreSQL connection is up" "$([[ $(jq -r '.dependencies.database // "down"' <<<"$HEALTH") == "up" ]] && echo true || echo false)"

# ------------------------------------------------------------------ 2. auth
info "Authenticating"
LOGIN=$(curl -fsS -X POST "${API}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')" 2>/dev/null || echo '{}')
TOKEN=$(jq -r '.accessToken // empty' <<<"$LOGIN")
check "Login returns an access token" "$([[ -n "$TOKEN" ]] && echo true || echo false)"
[[ -z "$TOKEN" ]] && { red "Cannot continue without a token."; exit 1; }
AUTH=(-H "Authorization: Bearer ${TOKEN}")

check "Refresh token issued" "$([[ -n $(jq -r '.refreshToken // empty' <<<"$LOGIN") ]] && echo true || echo false)"

# -------------------------------------------------------- 3. server registry
info "Registering a temporary test server"
SERVER=$(curl -fsS -X POST "${API}/servers" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke-test-server"}' 2>/dev/null || echo '{}')
SERVER_ID=$(jq -r '.id // empty' <<<"$SERVER")
API_KEY=$(jq -r '.apiKey // empty' <<<"$SERVER")
check "Server created" "$([[ -n "$SERVER_ID" ]] && echo true || echo false)"
check "Agent API key generated" "$([[ "$API_KEY" == vg_* ]] && echo true || echo false)"
[[ -z "$SERVER_ID" ]] && { red "Cannot continue without a server."; exit 1; }

cleanup() {
  curl -fsS -X DELETE "${API}/servers/${SERVER_ID}" "${AUTH[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ------------------------------------------------------------- 4. ingestion
info "Sending a synthetic metrics packet with CPU at 99%"
send_packet() {
  curl -fsS -X POST "${API}/ingest" \
    -H 'Content-Type: application/json' \
    -H "X-API-Key: ${API_KEY}" \
    -d "$(jq -nc --arg id "$SERVER_ID" --argjson ts "$(date +%s)" '{
      api_key: null,
      server_id: $id,
      hostname: "smoke-test",
      agent_version: "1.0.0",
      timestamp: $ts,
      uptime_seconds: 3600,
      metrics: {
        cpu: {load_1m:4.0, load_5m:3.8, load_15m:3.5, percent:99.0, percent_user:80.0, percent_system:19.0, core_count:2},
        memory: {total:2048, used:1900, free:148, available:148, used_percent:92.8, swap_total:1024, swap_used:0, swap_used_percent:0},
        disk: [{mount:"/", device:"/dev/vda1", fstype:"ext4", total_gb:40, used_gb:36, free_gb:4, used_percent:90.0}],
        network: {eth0: {rx_bytes:123456, tx_bytes:654321, rx_packets:1000, tx_packets:1200, rx_errors:0, tx_errors:0}},
        process_summary: {total:120, running:2, sleeping:118, zombie:0},
        processes: [{pid:123, name:"stress", user:"root", cpu_percent:95.0, mem_percent:1.4}]
      }
    }')" 2>/dev/null || echo '{}'
}

INGEST=$(send_packet)
check "Ingest accepts the packet" "$([[ $(jq -r '.status // "error"' <<<"$INGEST") == "ok" ]] && echo true || echo false)"

info "Waiting for the server to appear as online (acceptance limit: 60s)"
ONLINE=false
for _ in $(seq 1 12); do
  STATUS=$(curl -fsS "${API}/servers/${SERVER_ID}" "${AUTH[@]}" 2>/dev/null | jq -r '.status // "offline"')
  [[ "$STATUS" == "online" ]] && { ONLINE=true; break; }
  sleep 5
done
check "Metrics visible within 60 seconds" "$ONLINE"

SNAPSHOT=$(curl -fsS "${API}/servers/${SERVER_ID}" "${AUTH[@]}" 2>/dev/null | jq -r '.latestMetrics.cpuPercent // 0')
check "CPU snapshot stored correctly" "$([[ "${SNAPSHOT%.*}" -ge 98 ]] && echo true || echo false)"

# ---------------------------------------------------------------- 5. alerts
info "Holding CPU above 90% to trigger the default alert rule (needs 60s)"
for _ in $(seq 1 8); do
  send_packet >/dev/null
  sleep 10
done

ALERTS=$(curl -fsS "${API}/alerts?status=firing&serverId=${SERVER_ID}" "${AUTH[@]}" 2>/dev/null || echo '[]')
CPU_ALERT=$(jq -r '[.[] | select(.metric == "cpu.percent")] | length' <<<"$ALERTS")
check "CPU alert fires above 90% for 1 minute" "$([[ "${CPU_ALERT:-0}" -ge 1 ]] && echo true || echo false)"

# ------------------------------------------------------------- 6. reporting
info "Checking metrics query and reporting"
SERIES=$(curl -fsS "${API}/servers/${SERVER_ID}/metrics?metric=cpu.percent&from=-1h" "${AUTH[@]}" 2>/dev/null || echo '{}')
check "Time series query returns data" "$([[ $(jq -r '[.series[]?.points[]?] | length' <<<"$SERIES") -gt 0 ]] && echo true || echo false)"

REPORT=$(curl -fsS "${API}/reports?from=-1h&format=json" "${AUTH[@]}" 2>/dev/null || echo '{}')
check "Report generation works" "$([[ $(jq -r '.rows | length' <<<"$REPORT") -ge 1 ]] && echo true || echo false)"

# ----------------------------------------------------------------- summary
echo
info "Summary: ${PASSED} passed, ${FAILED} failed"
[[ "$FAILED" -eq 0 ]] || exit 1
green "All acceptance checks passed."
