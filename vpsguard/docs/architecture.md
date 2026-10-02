# VPSGuard Architecture

How the four VPSGuard components fit together, where data lives, how alerts are
evaluated, and what it takes to run the platform at fleet scale.

Related documents: [Agent installation](agent-installation.md) ·
[Server deployment](server-deployment.md) · [API reference](api.md) ·
[Developer guide](developer-guide.md)

---

## 1. Components

| Component | Technology | Runs on | Responsibility |
|---|---|---|---|
| `agent/` | Python 3 (`psutil`, `requests`) | Every monitored VPS, under systemd or Docker | Samples system metrics, buffers to SQLite when offline (24 h), executes remote commands |
| `server/` | NestJS 10 | Central host | REST API, Socket.IO gateway, alert engine, notifications, scheduler, reports |
| `dashboard/` | Next.js 14 App Router, TypeScript, Tailwind, Recharts, xterm.js | Central host | Operator UI, live charts, web terminal |
| `deploy/` | Docker Compose + Nginx | Central host | Orchestrates the stack, terminates TLS |

### Data stores

| Store | Version | Purpose |
|---|---|---|
| PostgreSQL | 16 | Metadata: users, servers, groups, alert rules, alerts, commands, audit logs, integrations |
| InfluxDB | 2.x | Time series: every numeric metric the agent reports |
| Redis | 7 | Cache, queues and shared state between server replicas |

### Network ports

| Port | Service | Exposure |
|---|---|---|
| 3000 | Dashboard (Next.js) | Internal; proxied by Nginx |
| 4000 | REST API + Socket.IO | Internal; proxied by Nginx |
| 5432 | PostgreSQL | Internal only |
| 6379 | Redis | Internal only |
| 8086 | InfluxDB | Internal only |
| 80 / 443 | Nginx | Public — the only ports that need to be reachable |

---

## 2. Data flow

```
   Monitored VPS #1..#N                     Central host
 ┌──────────────────────┐
 │ VPSGuard Agent       │
 │                      │   POST /api/v1/ingest
 │  cpu   memory  disk  │   X-API-Key: vg_...        ┌───────────────────────────┐
 │  net   procs   docker├───────── HTTPS ───────────▶│  Nginx  :443              │
 │  temps smart   ssl   │◀──── commands[] in ────────│  TLS 1.2+ termination     │
 │  security      logs  │      the same response     └────────────┬──────────────┘
 │         │            │                                         │
 │  SQLite buffer       │                            ┌────────────▼──────────────┐
 │  (24 h offline)      │                            │  VPSGuard Server  :4000   │
 └──────────────────────┘                            │  (NestJS)                 │
                                                     │                           │
                                                     │  IngestController         │
                                                     │   ├─ ApiKeyGuard          │
                                                     │   ├─ ValidationPipe       │
                                                     │   ├─ InfluxService.write  │
                                                     │   ├─ servers.update       │
                                                     │   ├─ RealtimeGateway      │
                                                     │   ├─ AlertEngineService   │
                                                     │   └─ CommandsService      │
                                                     └──┬────────┬─────────┬─────┘
                                                        │        │         │
                                        ┌───────────────▼─┐ ┌────▼─────┐ ┌─▼──────┐
                                        │ InfluxDB :8086  │ │ Postgres │ │ Redis  │
                                        │ time series     │ │  :5432   │ │ :6379  │
                                        └─────────────────┘ └──────────┘ └────────┘
                                                        │
                        ┌───────────────────────────────┼───────────────────────┐
                        │                               │                       │
                 ┌──────▼───────┐              ┌────────▼────────┐    ┌─────────▼─────────┐
                 │  Dashboard   │              │  Notifications  │    │  Reports          │
                 │  :3000       │◀── Socket.IO │  Telegram       │    │  JSON / CSV / PDF │
                 │  Next.js 14  │   /socket.io │  Slack          │    └───────────────────┘
                 │  + xterm.js  │──── REST ───▶│  Email (SMTP)   │
                 └──────────────┘              │  Webhook        │
                        │                      └─────────────────┘
                        │  terminal:* events (SSH relayed by the server)
                        └────────────────────────────────────────────▶ monitored VPS :22
```

---

## 3. The ingest request lifecycle

Everything the platform does is triggered by one endpoint. A single
`POST /api/v1/ingest` call moves through the following steps.

| # | Stage | Detail |
|---|---|---|
| 1 | Agent collects | Fast-tier collectors run every `interval` (30 s); slow-tier collectors every `slow_interval` (300 s) and are cached so that **every** packet is complete |
| 2 | Agent posts | `POST /api/v1/ingest` with `X-API-Key: vg_<48 hex>`. TLS 1.2+, connection reused, urllib3 retries at 1 s / 2 s / 4 s |
| 3 | Nginx | Terminates TLS, forwards to `server:4000`, adds `X-Real-IP` / `X-Forwarded-For` |
| 4 | `ApiKeyGuard` | Reads the key from `X-API-Key` (or `api_key` in the body), narrows candidates by the 11-character key prefix, then verifies with bcrypt. The resolved server entity is attached to the request |
| 5 | `ValidationPipe` | Validates the envelope (`timestamp` required, `server_id` must be a UUID when present). Unknown keys inside `metrics` are tolerated on purpose, so a newer agent can report new metrics to an older server |
| 6 | Throttler skipped | The endpoint carries `@SkipThrottle()`; agents are authenticated by API key and must never be rate limited |
| 7 | Write time series | `InfluxService.writeMetrics()` converts the payload into Influx points, tags them with `server_id`, and queues them on a batching writer (batch 1000, flush 2 s, 3 retries) |
| 8 | Refresh snapshot | The `servers` row is updated: `status = online`, `last_seen`, `hostname`, `agent_version`, `os_info`, `ip_address`, `uptime_seconds`, plus two JSONB columns — `latest_metrics` (flat numeric snapshot for list views) and `raw_snapshot` (document sections for the detail tabs) |
| 9 | Status transition | If the server was previously offline, `server:status` is broadcast over Socket.IO and the recovery is logged |
| 10 | Live push | `metrics` is emitted to the `server:<id>` Socket.IO room, so open dashboards update within 1–2 seconds |
| 11 | Evaluate alerts | `AlertEngineService.evaluate()` is called **without `await`** and its errors are swallowed into the log — alert evaluation can never slow down or fail an ingest |
| 12 | Claim commands | `CommandsService.claimPending()` pops up to five `pending` commands for this server and flips them to `dispatched` in the same transaction, so a command is never handed out twice |
| 13 | Respond | `{ "status": "ok", "server_id": "<uuid>", "commands": [...] }`. The agent persists `server_id` to `/var/lib/vpsguard/server_id` on first contact and executes the commands sandboxed |
| 14 | Report back | Each command result is posted to `POST /api/v1/agent/commands/:id/result`; `stdout`/`stderr` are truncated to 8 KiB on both sides |

If step 2 fails for any reason, the agent enqueues the serialised payload in its
SQLite buffer and replays it oldest-first (50 payloads per successful cycle) once
connectivity returns. See
[offline buffering](agent-installation.md#8-offline-buffering).

---

## 4. PostgreSQL schema

Eight tables, one per domain entity. All primary keys are UUIDs generated by the
database; `created_at` / `updated_at` are managed by TypeORM.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `email` | varchar(255) | Unique index, stored lower-case |
| `password_hash` | varchar(255) | bcrypt, cost 12 |
| `name` | varchar(120) | Nullable |
| `role` | enum | `admin` · `operator` · `viewer`, default `viewer` |
| `refresh_token_hash` | varchar(255) | bcrypt hash of the current refresh token; `NULL` revokes the session |
| `is_active` | boolean | Default `true`; inactive users cannot log in |
| `created_at` / `updated_at` | timestamptz | |

### `groups`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar(120) | Unique index (`production`, `staging`, …) |
| `description` | varchar(255) | Nullable |
| `color` | varchar(20) | Hex colour used by the UI, default `#3b82f6` |
| `created_at` | timestamptz | |

### `servers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Sent back to the agent as `server_id` |
| `name` | varchar(120) | Operator-chosen label |
| `hostname` | varchar(255) | Reported by the agent |
| `ip_address` | varchar(64) | Taken from the ingest connection, also used by the web terminal |
| `api_key_prefix` | varchar(16) | Indexed; first 11 characters (`vg_` + 8 hex) so lookups do not bcrypt every row |
| `api_key_hash` | varchar(255) | bcrypt hash of the full key — the plaintext key is unrecoverable |
| `group_id` | uuid FK → `groups` | `ON DELETE SET NULL` |
| `status` | enum | `online` · `offline` · `warning`, indexed |
| `last_seen` | timestamptz | Indexed; drives offline detection |
| `agent_version`, `os_info` | varchar | Reported by the agent |
| `uptime_seconds` | bigint | |
| `latest_metrics` | jsonb | Flat numeric snapshot: `cpuPercent`, `load1m`, `cpuTemperature`, `memoryUsedPercent`, `swapUsedPercent`, `diskUsedPercent`, `networkRxBps`, `networkTxBps`, `processCount`, `dockerCount` |
| `raw_snapshot` | jsonb | Latest `processes`, `process_summary`, `docker`, `services`, `temperatures`, `smart`, `security`, `ssl`, `logs`, `disk`, `network`, `connections` |
| `ssh_user`, `ssh_port` | varchar(64) / int | Web-terminal overrides; fall back to `SSH_DEFAULT_USER` / `SSH_DEFAULT_PORT` |
| `created_at` / `updated_at` | timestamptz | |

### `alert_rules`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar(160) | |
| `server_id` | uuid | Indexed, nullable — scope to one server |
| `group_id` | uuid | Nullable — scope to a group. Both `NULL` means the rule applies fleet-wide |
| `metric` | varchar(80) | Dot-notation key, e.g. `cpu.percent` |
| `condition` | enum | `>` · `<` · `==` · `!=` |
| `threshold` | double precision | |
| `duration_seconds` | int | Default 60; the condition must hold this long before firing |
| `severity` | enum | `info` · `warning` · `critical`, default `warning` |
| `channels` | jsonb | Array such as `["telegram","email"]`; empty falls back to Telegram |
| `enabled` | boolean | Default `true` |
| `auto_heal_command` | jsonb | Optional, e.g. `{"type":"restart_service","args":{"name":"nginx"}}` |
| `created_at` / `updated_at` | timestamptz | |

### `alerts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `rule_id` / `rule_name` | uuid (indexed) / varchar(160) | Rule name is denormalised so history survives rule deletion |
| `server_id` / `server_name` | uuid (indexed) / varchar(120) | Composite index on (`server_id`, `status`) |
| `metric` | varchar(80) | |
| `severity` | enum | `info` · `warning` · `critical` |
| `status` | enum | `firing` · `acknowledged` · `resolved`, indexed |
| `value` / `threshold` | double precision | Value that tripped the rule and the configured limit |
| `message` | text | Human-readable summary rendered into notifications |
| `dedup_key` | varchar(200) | Indexed, `"<ruleId>:<serverId>"` — prevents duplicate open alerts |
| `acknowledged_by` / `acknowledged_at` | uuid / timestamptz | |
| `resolved_at` | timestamptz | |
| `created_at` | timestamptz | |

### `commands`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `server_id` | uuid | Indexed; composite index on (`server_id`, `status`) |
| `type` | enum | `restart_service` · `stop_service` · `start_service` · `run_script` · `cleanup_logs` · `agent_update` · `ping` |
| `args` | jsonb | Command arguments, default `{}` |
| `status` | enum | `pending` · `dispatched` · `success` · `failed` · `timeout` · `rejected` |
| `exit_code` | int | |
| `stdout` / `stderr` | text | Capped at 8192 characters |
| `duration_ms` | int | |
| `timeout_seconds` | int | Default 60 |
| `created_by` | uuid | `NULL` when the self-healing engine queued it |
| `dispatched_at` / `completed_at` | timestamptz | Commands dispatched but unreported for 10 minutes become `timeout` |
| `created_at` | timestamptz | |

### `audit_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` / `user_email` | uuid (indexed) / varchar(255) | Email denormalised so entries survive user deletion |
| `action` | varchar(120) | Indexed, e.g. `server.create`, `alert.acknowledge`, `terminal.open` |
| `details` | jsonb | Action-specific context, default `{}` |
| `ip_address` | varchar(64) | |
| `created_at` | timestamptz | |

### `integrations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `type` | enum | `telegram` · `slack` · `email` · `webhook`, indexed |
| `name` | varchar(120) | |
| `enabled` | boolean | Default `true` |
| `config` | jsonb | Channel-specific settings; secret fields are masked on read and never returned raw |
| `created_at` / `updated_at` | timestamptz | |

---

## 5. InfluxDB layout

One bucket (`metrics` by default, 30-day retention). Every point is tagged with
`server_id`; measurements that describe multiple objects carry a second tag.

| Measurement | Extra tags | Key fields |
|---|---|---|
| `cpu` | — | `percent`, `percent_user`, `percent_system`, `percent_iowait`, `percent_idle`, `load_1m`, `load_5m`, `load_15m`, `core_count`, `frequency_mhz`, `temperature` |
| `cpu_core` | `core` | `percent` |
| `memory` | — | `total`, `used`, `free`, `available`, `used_percent`, `swap_total`, `swap_used`, `swap_used_percent` (MB) |
| `disk` | `mount`, `device`, `fstype` | `total_gb`, `used_gb`, `free_gb`, `used_percent`, `io_read_mb`, `io_write_mb`, `iops_read`, `iops_write` |
| `network` | `interface` | `rx_bytes`, `tx_bytes`, `rx_packets`, `tx_packets`, `rx_errors`, `tx_errors`, `rx_dropped`, `tx_dropped`, `rx_speed_bps`, `tx_speed_bps` |
| `connections` | — | `established`, `listen`, `time_wait`, `total` |
| `process_summary` | — | `total`, `running`, `sleeping`, `zombie` |
| `docker` | `container`, `image`, `container_id` | `cpu_percent`, `mem_percent`, `mem_usage_mb`, `net_rx_mb`, `net_tx_mb`, `block_read_mb`, `block_write_mb`, `uptime_seconds`, `status`, `health` |
| `temperature` | `sensor`, `label` | `current`, `high`, `critical` |
| `smart` | `device`, `model` | `temperature`, `power_on_hours`, `reallocated_sectors`, `wear_leveling`, `health` |
| `security` | — | `failed_ssh_attempts`, `failed_ssh_last_hour`, `open_ports_count`, `firewall_status`, `firewall_backend` |
| `ssl` | `domain` | `days_left`, `valid` |
| `service` | `name` | `up` (1/0), `state` |

Numeric values become float fields, booleans become boolean fields, and strings
become string fields truncated to 255 characters. A point with no usable field is
dropped rather than written empty.

### Querying

`GET /api/v1/servers/:id/metrics?metric=` maps a dot-notation key to a
measurement/field pair through `METRIC_MAP` in
`server/src/influx/influx.service.ts`, then aggregates with
`aggregateWindow(every: <interval>, fn: mean)`. Results are split into one series
per `mount` (disk), `interface` (network) or `domain` (ssl); every other metric
returns a single series.

### Why two databases

| Concern | PostgreSQL | InfluxDB |
|---|---|---|
| Access pattern | Point reads and relational joins (which servers are in this group?) | Range scans and downsampling over millions of samples |
| Write pattern | Low volume, transactional | High volume, append-only, batched |
| Retention | Kept indefinitely; deletion is an explicit action | Automatic expiry after the bucket retention period |
| Consistency needs | Strong — users, keys, RBAC, audit trail | Eventual is fine; a lost sample is a gap in a chart |
| Query language | SQL with foreign keys and unique constraints | Flux, built for time-window aggregation |

Storing time series in PostgreSQL would make retention enforcement and
window aggregation expensive; storing metadata in InfluxDB would give up
constraints, joins and transactions. The document-style sections
(`processes`, `docker`, `services`, …) are *not* numeric series, so the newest
copy is kept in the `servers.raw_snapshot` JSONB column and served from there.

---

## 6. Alert engine state machine

```
                     condition true for
   ┌──────────┐      < durationSeconds       ┌──────────┐
   │  (none)  │ ───────────────────────────▶ │ pending  │
   └──────────┘                              └────┬─────┘
        ▲                                          │ condition still true and
        │                                          │ heldFor >= durationSeconds
        │ condition false                          ▼
        │  (pending state dropped)           ┌──────────┐
        ├───────────────────────────────────  │  firing  │ ── notify channels
        │                                    └────┬─────┘ ── run autoHealCommand
        │                                         │
        │                      POST /alerts/:id/ack (admin, operator)
        │                                         ▼
        │                                 ┌────────────────┐
        │                                 │ acknowledged   │
        │                                 └────┬───────────┘
        │        condition clears              │ condition clears
        │                                      ▼
        │                                 ┌──────────┐
        └──────────────────────────────── │ resolved │ ── notify channels
                                          └──────────┘
```

| State | Where it lives | Transition trigger |
|---|---|---|
| `pending` | In-memory `Map` in the server process, keyed `<ruleId>:<serverId>` | The condition first evaluates true. No row is written and nothing is sent |
| `firing` | `alerts` row, `status = firing` | The condition has held continuously for `durationSeconds`. Deduplicated on `dedup_key`: while an open alert exists, re-firing is a no-op |
| `acknowledged` | Same row, `acknowledged_by` / `acknowledged_at` set | An operator or admin calls `POST /api/v1/alerts/:id/ack`. Acknowledging silences repeat noise without hiding the incident |
| `resolved` | Same row, `resolved_at` set | The metric no longer satisfies the condition. Both `firing` and `acknowledged` alerts resolve, and a resolution notice goes out on the rule's channels |

Rules are cached for 10 seconds so the ingest path does not query PostgreSQL for
every packet; the cache is invalidated when a rule is created, updated or
deleted.

### Metric extraction

Array-backed metrics collapse to the value most likely to matter:

| Metric | Collapse | Label attached to the alert |
|---|---|---|
| `disk.used_percent` | maximum across mounts | `mount` |
| `disk.free_gb` | minimum across mounts | `mount` |
| `network.rx_speed_bps` / `tx_speed_bps` | maximum across interfaces | `interface` |
| `ssl.days_left` | minimum across certificates | `domain` |

### Rules evaluated outside the ingest path

Two metric keys cannot be derived from a single packet, so the scheduler owns
them:

| Metric | Schedule | Behaviour |
|---|---|---|
| `agent.offline` | every 30 s | Servers whose `last_seen` is older than `AGENT_OFFLINE_AFTER_SECONDS` (120 s) are flagged `offline`, `server:status` is broadcast, and matching rules fire immediately |
| `disk.forecast_days` | hourly | Linear regression over 7 days of hourly `disk.used_percent` means projects the 100 % crossing; matching rules fire when the projection lands within 3 days |

The scheduler also broadcasts the fleet overview every 10 seconds and expires
stale commands every 5 minutes.

### Self-healing

When a firing rule carries `auto_heal_command`, the engine queues that command
for the affected server with `created_by = NULL`. The agent picks it up in the
next ingest response and executes it sandboxed (see
[Agent commands](api.md#7-agent-commands)). Failures to queue are logged and
never block the alert itself.

---

## 7. Horizontal scaling to 10 000 agents

### Sizing the write load

At the default 30-second interval, 10 000 agents produce roughly **333 ingest
requests per second**. A typical packet expands to 30–250 Influx points
(one per core, per mount, per interface, per container, per sensor), so plan for
**10 000–80 000 points per second**. Raising `interval` to 60 s on well-behaved
hosts halves that immediately and is the cheapest lever available.

### Stateless API behind a load balancer

The REST surface holds no request-scoped state: JWTs are verified from the
signing secret, agent keys are resolved from PostgreSQL, and the HTTP layer is
free of sticky data. Run *N* replicas of the server image behind the load
balancer and scale on CPU.

Two pieces of per-process state must move to Redis before replicas are safe:

| State | Today | At scale |
|---|---|---|
| Alert `pending` map | In-process `Map` | Redis keys with TTL, so a condition tracked by replica A still counts on replica B |
| Enabled-rules cache | 10-second in-process cache | Redis with pub/sub invalidation on rule change |
| Socket.IO rooms | Single-process adapter | `@socket.io/redis-adapter`, so `metrics`, `alert` and `overview` reach clients attached to any replica |
| Web-terminal sessions | Map in the owning process | Pin terminal sockets to their replica (sticky sessions); SSH streams cannot be shared |

Enable sticky sessions on the load balancer for `/socket.io/` regardless — the
handshake upgrade must land on the replica that answered it.

### Sharding the time series

| Strategy | When to use |
|---|---|
| One bucket, larger InfluxDB node | Up to a few thousand agents |
| Bucket per shard, agents mapped by `server_id` hash | Beyond that; the API resolves the bucket from the server record |
| Bucket per retention class (`metrics_raw` 7 d, `metrics_1h` 1 y) with a downsampling task | Long history without linear storage growth |
| InfluxDB Enterprise / Cloud with native sharding | When operating a manual shard map is not acceptable |

Because every point is tagged with `server_id`, and no query ever spans servers
without filtering on it, shard boundaries are natural and require no
cross-shard joins.

### Other scale-out notes

- **PostgreSQL** stays small (metadata only). Add read replicas for the
  dashboard's list queries long before considering sharding.
- **Ingest is the hot path.** Keep it exempt from rate limiting, keep alert
  evaluation off the response path (it already is), and keep the Influx write
  batched.
- **Notifications** should move to a BullMQ queue backed by Redis so a slow
  Telegram API call cannot back up alert processing.
- **Nginx** limits request bodies to 4 MB, which is far above the largest
  realistic payload (a busy host with 200 services and 100 containers stays
  under 500 KB).

---

## 8. Performance budget

| Target | Budget | How it is met |
|---|---|---|
| Agent CPU | < 1 % | `psutil.cpu_percent(interval=None)` is delta based and never sleeps; external tools (`systemctl`, `docker`, `smartctl`) are cached for `subprocess_refresh_seconds` (60 s); slow collectors run on `slow_interval` (300 s) |
| Agent memory | < 50 MB RSS | No metric history in memory — one payload at a time, overflow persisted to SQLite; process table truncated to `top_processes` (10) and services to 200 entries |
| Server throughput | > 1 000 metrics/sec per node | Batched Influx writes (1 000 points, 2 s flush), snapshot written with a single `UPDATE`, alert evaluation detached from the response |
| API latency | p95 < 200 ms | List views read the `latest_metrics` JSONB column instead of querying Influx; detail tabs read `raw_snapshot`; only chart requests hit Flux, and always with an `aggregateWindow` |
| Live update latency | 1–2 s | Metrics are emitted to the Socket.IO room in the same request that stores them |
| Offline resilience | 24 h | SQLite buffer bounded by `buffer_size` (1 000 payloads) and `buffer_retention_hours` (24), replayed 50 payloads per successful cycle |
| Alert delivery | Within `durationSeconds` + one interval | The condition is checked on every packet; firing happens on the first packet after the duration has elapsed |

Measure before tuning: `GET /api/v1/health` reports dependency state, and the
server logs a warning for every failed Influx write batch.
