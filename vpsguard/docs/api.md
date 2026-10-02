# VPSGuard REST and WebSocket API

Interactive OpenAPI UI is generated from the NestJS controllers and served at
`/api/v1/docs` on a running server.

Related documents: [Architecture](architecture.md) ·
[User guide](user-guide.md) · [Developer guide](developer-guide.md)

Base URL: `{origin}/api/v1`. All timestamps are ISO-8601 UTC unless noted.

---

## 1. Authentication

User sessions use a short-lived JWT access token (15 minutes) plus a refresh
token (7 days). Send the access token on every request:

```
Authorization: Bearer <accessToken>
```

Agents authenticate separately with:

```
X-API-Key: vg_<48 hex characters>
```

The key is also accepted in the ingest body as `api_key` so the wire format from
the specification stays valid. Keys are stored as bcrypt hashes and displayed
to the operator exactly once.

### Refresh cycle

1. `POST /auth/login` returns `{ accessToken, refreshToken, user }`.
2. On HTTP 401 the dashboard calls `POST /auth/refresh` with `{ refreshToken }`.
3. `POST /auth/logout` hashes-compares and then drops the stored refresh token.

Roles: `admin`, `operator`, `viewer`. Missing role metadata on a route means
any authenticated user may call it.

---

## 2. Endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Register a user (first account becomes admin) |
| POST | `/auth/login` | public | Issue a JWT pair |
| POST | `/auth/refresh` | public | Rotate the JWT pair |
| POST | `/auth/logout` | any | Revoke the current refresh token |
| GET | `/auth/me` | any | Current user |
| PATCH | `/auth/me` | any | Update name, email or password |
| POST | `/ingest` | agent key | Accept a metrics packet, return pending commands |
| POST | `/agent/commands/:id/result` | agent key | Report command outcome |
| GET | `/health` | public | Liveness and PostgreSQL probe |
| GET | `/overview` | any | Fleet counters |
| GET | `/servers` | any | List servers (`?group=&status=&search=`) |
| POST | `/servers` | admin, operator | Create a server and generate its API key |
| GET | `/servers/:id` | any | Server detail plus latest metrics snapshot |
| PATCH | `/servers/:id` | admin, operator | Update metadata |
| DELETE | `/servers/:id` | admin | Delete a server |
| POST | `/servers/:id/rotate-key` | admin | Rotate the agent API key |
| GET | `/servers/:id/metrics` | any | Time series (`metric`, `from`, `to`, `interval`) |
| GET | `/servers/:id/forecast` | any | Hours until a metric hits a target |
| GET | `/servers/:id/processes` | any | Latest process snapshot |
| GET | `/servers/:id/docker` | any | Latest container snapshot |
| GET | `/servers/:id/services` | any | systemd statuses |
| GET | `/servers/:id/temperatures` | any | Sensor readings |
| GET | `/servers/:id/ssl` | any | Certificate checks |
| GET | `/servers/:id/smart` | any | SMART health |
| GET | `/servers/:id/security` | any | Security posture |
| GET | `/servers/:id/logs` | any | Log scan (`?file=&pattern=`) |
| GET | `/groups` | any | List groups |
| POST | `/groups` | admin, operator | Create a group |
| DELETE | `/groups/:id` | admin | Delete a group |
| GET | `/alerts` | any | `?status=firing\|acknowledged\|resolved&serverId=` |
| POST | `/alerts/:id/ack` | admin, operator | Acknowledge a firing alert |
| GET | `/alert-rules` | any | List rules |
| POST | `/alert-rules` | admin, operator | Create a rule |
| PATCH | `/alert-rules/:id` | admin, operator | Update a rule |
| DELETE | `/alert-rules/:id` | admin | Delete a rule |
| GET | `/commands` | any | History (`?serverId=`) |
| POST | `/commands` | admin, operator | Queue a command for an agent |
| GET | `/reports` | any | `?from=&to=&format=json\|csv\|pdf&serverId=` |
| GET | `/integrations` | any | Notification channels (secrets masked) |
| POST | `/integrations` | admin | Create or update a channel |
| POST | `/integrations/test/:channel` | admin, operator | Send a test notification |
| DELETE | `/integrations/:id` | admin | Delete a channel |
| GET | `/users` | admin | List users |
| POST | `/users` | admin | Create a user |
| PATCH | `/users/:id` | admin | Update a user |
| DELETE | `/users/:id` | admin | Delete a user |
| GET | `/audit-logs` | admin | Privileged-action trail |

---

## 3. Examples

### Login

```bash
curl -sS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@vpsguard.local","password":"ChangeMe123!"}'
```

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": "...", "email": "admin@vpsguard.local", "name": "Administrator", "role": "admin" }
}
```

### Create a server

```bash
curl -sS -X POST "$API/servers" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"web-01","groupId":null}'
```

The response includes `apiKey` and `installCommand`. The key is never returned
again.

### Ingest

```bash
curl -sS -X POST "$API/ingest" \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d @payload.json
```

```json
{ "status": "ok", "server_id": "uuid", "commands": [] }
```

### Query CPU for the last hour

```bash
curl -sS "$API/servers/$ID/metrics?metric=cpu.percent&from=-1h&interval=1m" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "metric": "cpu.percent",
  "from": "-1h",
  "to": "now()",
  "interval": "1m",
  "series": [{ "name": "cpu.percent", "points": [{ "t": "2026-09-03T12:00:00Z", "v": 12.4 }] }]
}
```

### Create an alert rule

```json
{
  "name": "High CPU usage",
  "metric": "cpu.percent",
  "condition": ">",
  "threshold": 90,
  "durationSeconds": 60,
  "severity": "critical",
  "channels": ["telegram"],
  "autoHealCommand": { "type": "restart_service", "args": { "name": "nginx" } }
}
```

### Queue a command

```json
{ "serverId": "uuid", "type": "restart_service", "args": { "name": "nginx" }, "timeoutSeconds": 60 }
```

Supported command types: `restart_service`, `stop_service`, `start_service`,
`run_script`, `cleanup_logs`, `agent_update`, `ping`.

---

## 4. Ingest payload

Posted to `POST /ingest`. `timestamp` is Unix seconds. Memory sizes are **MB**,
disk sizes are **GB**, network counters are **bytes**, derived speeds are
**bytes/sec**.

| Field | Type | Notes |
|---|---|---|
| `api_key` | string | Optional when `X-API-Key` is set |
| `server_id` | uuid \| null | `null` on the agent's first packet; the response assigns it |
| `hostname` | string | |
| `agent_version` | string | |
| `os_info` | string | Optional |
| `timestamp` | int | Unix seconds |
| `uptime_seconds` | int | |
| `metrics.cpu` | object | `percent`, `load_1m/5m/15m`, `cores[]`, `temperature`, … |
| `metrics.memory` | object | `total`, `used`, `used_percent`, swap fields |
| `metrics.disk` | array | One entry per mount (`used_percent`, `io_read_mb`, …) |
| `metrics.network` | object | Keyed by interface name |
| `metrics.connections` | object | `established`, `listen`, `time_wait`, `total` |
| `metrics.processes` | array | Top 10 by CPU then memory |
| `metrics.process_summary` | object | `total`, `running`, `sleeping`, `zombie` |
| `metrics.services` | array | systemd units |
| `metrics.docker` | array | Containers |
| `metrics.temperatures` | array | Sensors |
| `metrics.smart` | array | Disks |
| `metrics.security` | object | Failed SSH, firewall, open ports, last logins |
| `metrics.ssl` | array | Certificates |
| `metrics.logs` | array | Pattern matches |

A collector that fails or whose tool is missing is **omitted** from `metrics`.

---

## 5. WebSocket (Socket.IO)

Path: `/socket.io`. Auth payload: `{ token: "<accessToken>" }`. Unauthenticated
sockets are disconnected.

### Client → server

| Event | Payload |
|---|---|
| `subscribe:server` | `{ serverId }` |
| `unsubscribe:server` | `{ serverId }` |
| `subscribe:overview` | — |
| `terminal:start` | `{ serverId }` |
| `terminal:input` | `{ sessionId, data }` |
| `terminal:resize` | `{ sessionId, cols, rows }` |
| `terminal:close` | `{ sessionId }` |

### Server → client

| Event | Payload |
|---|---|
| `metrics` | `{ serverId, timestamp, metrics }` |
| `alert` | `{ alert }` |
| `server:status` | `{ serverId, status }` |
| `overview` | fleet counters |
| `terminal:ready` | `{ sessionId }` |
| `terminal:output` | `{ sessionId, data }` |
| `terminal:exit` | `{ sessionId }` |
| `terminal:error` | `{ message }` |

The web terminal is admin/operator only. SSH uses the server's stored IP,
`sshUser` / `sshPort` and `SSH_PRIVATE_KEY`. Every session is written to the
audit log.

---

## 6. Errors and rate limits

```json
{
  "statusCode": 400,
  "path": "/api/v1/servers",
  "timestamp": "2026-09-03T12:00:00.000Z",
  "message": ["name must be a string"]
}
```

Default limit: **300 requests per minute** per IP (`@nestjs/throttler`). Login
and register are tighter (10 and 5 / min). `/ingest` and command-result posts
are exempt (`@SkipThrottle`) because agents poll on a fixed schedule and are
already authenticated by API key.

---

## 7. Alert metric keys

`cpu.percent`, `cpu.load_1m`, `cpu.temperature`, `memory.used_percent`,
`memory.swap_used_percent`, `disk.used_percent`, `disk.free_gb`,
`network.rx_speed_bps`, `network.tx_speed_bps`, `security.failed_ssh_attempts`,
`ssl.days_left`, `agent.offline`, `disk.forecast_days`.

Conditions: `>`, `<`, `==`, `!=`. Severities: `info`, `warning`, `critical`.
Channels: `telegram`, `slack`, `email`, `webhook`.

A rule fires only after the condition has held for `durationSeconds`, and
auto-resolves when the condition clears. Optional `autoHealCommand` queues a
sandboxed agent command (self-healing).
