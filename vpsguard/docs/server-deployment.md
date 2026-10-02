# VPSGuard Server Deployment

Deploying the central VPSGuard stack — API, dashboard, PostgreSQL, InfluxDB,
Redis and optional Nginx TLS termination — with Docker Compose.

Related documents: [Architecture](architecture.md) ·
[Agent installation](agent-installation.md) · [API reference](api.md) ·
[Developer guide](developer-guide.md)

---

## 1. Prerequisites and sizing

| Requirement | Minimum |
|---|---|
| Docker Engine | 24.0+ |
| Docker Compose | v2 (`docker compose`, not `docker-compose`) |
| Operating system | Any Linux with a current kernel; the images are Alpine based |
| Open ports | 80 and 443 inbound when running behind the bundled Nginx |
| DNS | An A/AAAA record pointing at the host, required for Let's Encrypt |

### Sizing

Figures assume the default 30-second agent interval and 30-day retention.

| Fleet size | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|
| 1–10 agents | 2 | 2 GB | 20 GB | Comfortable for a homelab or a single project |
| 10–50 agents | 2 | 4 GB | 20–40 GB | The reference configuration |
| 50–200 agents | 4 | 8 GB | 100 GB | Consider raising the agent interval to 60 s |
| 200–1 000 agents | 8 | 16 GB | 250 GB+ | Move InfluxDB to its own host; put PostgreSQL on fast storage |
| 1 000+ agents | Multiple nodes | — | — | See [horizontal scaling](#8-horizontal-scaling) |

Storage grows roughly linearly with `agents × points-per-packet × retention`.
Budget about 400 MB per agent per 30 days at a 30-second interval, and reduce it
by raising `interval` or lowering `INFLUX_RETENTION`.

---

## 2. Deploy with Docker Compose

### Step 1 — get the code

```bash
git clone https://github.com/your-org/vpsguard.git
cd vpsguard/deploy
```

### Step 2 — create the environment file

```bash
cp .env.example .env
```

### Step 3 — generate secrets

```bash
openssl rand -hex 32   # -> INFLUX_TOKEN
openssl rand -hex 48   # -> JWT_ACCESS_SECRET
openssl rand -hex 48   # -> JWT_REFRESH_SECRET
openssl rand -base64 32   # -> POSTGRES_PASSWORD
openssl rand -base64 32   # -> INFLUX_PASSWORD
openssl rand -base64 32   # -> REDIS_PASSWORD
```

Write them straight into `.env` in one pass:

```bash
cd vpsguard/deploy
{
  echo "INFLUX_TOKEN=$(openssl rand -hex 32)"
  echo "JWT_ACCESS_SECRET=$(openssl rand -hex 48)"
  echo "JWT_REFRESH_SECRET=$(openssl rand -hex 48)"
  echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/')"
  echo "INFLUX_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/')"
  echo "REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/')"
} >> .env
chmod 600 .env
```

Then remove the placeholder lines that `.env.example` shipped for those keys, so
each variable appears exactly once, and set `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`PUBLIC_API_URL`, `PUBLIC_WS_URL` and `CORS_ORIGINS` for your host.

> `POSTGRES_PASSWORD`, `INFLUX_PASSWORD`, `INFLUX_TOKEN`, `JWT_ACCESS_SECRET`,
> `JWT_REFRESH_SECRET` and `ADMIN_PASSWORD` are mandatory. Compose refuses to
> start without them.

### Step 4 — start the stack

```bash
docker compose up -d
docker compose ps
```

The `server` container waits for PostgreSQL, InfluxDB and Redis to report
healthy before it starts. On first boot it creates the schema
(`POSTGRES_SYNCHRONIZE=true`) and bootstraps the admin account from
`ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Step 5 — verify

```bash
curl -fsS http://localhost:4000/api/v1/health | jq
docker compose logs -f server
```

A healthy response looks like:

```json
{
  "status": "ok",
  "uptimeSeconds": 42,
  "version": "1.0.0",
  "dependencies": { "database": "up" },
  "timestamp": "2026-09-03T12:00:00.000Z"
}
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| REST API | http://localhost:4000/api/v1 |
| Swagger UI | http://localhost:4000/api/v1/docs |
| InfluxDB UI | http://localhost:8086 |

### Step 6 — first login and hardening

1. Sign in at the dashboard with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Change the admin password immediately (**Settings → Users**).
3. Register your first server (**Servers → Add server**) and install the agent
   with the [one-line installer](agent-installation.md#2-one-line-install).
4. Configure at least one notification channel
   (**Settings → Integrations**) and press **Test**.
5. Switch `POSTGRES_SYNCHRONIZE` to `false` and manage schema changes with
   migrations — see [section 7](#7-upgrading).

---

## 3. `.env` reference

### PostgreSQL

| Variable | Default | Required | Description |
|---|---|---|---|
| `POSTGRES_USER` | `vpsguard` | no | Database role |
| `POSTGRES_PASSWORD` | — | **yes** | Database password |
| `POSTGRES_DB` | `vpsguard` | no | Database name |
| `POSTGRES_SYNCHRONIZE` | `true` | no | TypeORM auto-schema. Convenient for the first boot, **set to `false` in production** and use migrations |

### InfluxDB

| Variable | Default | Required | Description |
|---|---|---|---|
| `INFLUX_USER` | `vpsguard` | no | Initial admin user for the Influx UI |
| `INFLUX_PASSWORD` | — | **yes** | Initial admin password |
| `INFLUX_ORG` | `vpsguard` | no | Organisation name |
| `INFLUX_BUCKET` | `metrics` | no | Bucket that holds every measurement |
| `INFLUX_RETENTION` | `30d` | no | Bucket retention, applied at first initialisation only |
| `INFLUX_TOKEN` | — | **yes** | All-access token, used by the server. Generate with `openssl rand -hex 32` |

### Redis

| Variable | Default | Required | Description |
|---|---|---|---|
| `REDIS_PASSWORD` | *(empty)* | no | When set, Redis starts with `--requirepass` and the server authenticates. Strongly recommended |

### Authentication

| Variable | Default | Required | Description |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | — | **yes** | Signing key for 15-minute access tokens. `openssl rand -hex 48` |
| `JWT_REFRESH_SECRET` | — | **yes** | Signing key for 7-day refresh tokens. Must differ from the access secret |
| `ADMIN_EMAIL` | `admin@vpsguard.local` | no | Bootstrap admin, created only when the `users` table is empty |
| `ADMIN_PASSWORD` | — | **yes** | Bootstrap admin password. Change it after first login |

Token lifetimes are fixed by the compose file at `JWT_ACCESS_TTL=15m` and
`JWT_REFRESH_TTL=7d`. Override them in the `server` service environment if your
policy differs.

### Endpoints

| Variable | Default | Description |
|---|---|---|
| `SERVER_PORT` | `4000` | Host port mapped to the API container |
| `DASHBOARD_PORT` | `3000` | Host port mapped to the dashboard container |
| `PUBLIC_API_URL` | `http://localhost:4000` | Base API URL **baked into the dashboard bundle at build time**. Changing it requires a dashboard rebuild |
| `PUBLIC_WS_URL` | `http://localhost:4000` | Socket.IO URL, likewise baked in at build time |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated list of browser origins allowed to call the API |

Behind Nginx on `https://monitor.example.com`, all three become the same origin:

```ini
PUBLIC_API_URL=https://monitor.example.com
PUBLIC_WS_URL=https://monitor.example.com
CORS_ORIGINS=https://monitor.example.com
```

### Agents

| Variable | Default | Description |
|---|---|---|
| `AGENT_OFFLINE_AFTER_SECONDS` | `120` | Seconds without a heartbeat before a server is marked offline. Keep it at 3–4× the agent `interval` |

### Notifications

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | *(empty)* | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | *(empty)* | Target chat or channel ID |
| `SLACK_WEBHOOK_URL` | *(empty)* | Incoming-webhook URL |
| `SMTP_HOST` | *(empty)* | SMTP relay hostname |
| `SMTP_PORT` | `587` | SMTP port; `465` switches to implicit TLS |
| `SMTP_USER` | *(empty)* | SMTP username; leave empty for an unauthenticated relay |
| `SMTP_PASSWORD` | *(empty)* | SMTP password |
| `SMTP_FROM` | `vpsguard@example.com` | Envelope sender |

These are fallbacks. Values configured in **Settings → Integrations** are stored
in the `integrations` table and take precedence. The email recipient (`to`) can
only be set through the integration, not through `.env`.

### Web terminal (optional, set on the `server` service)

| Variable | Default | Description |
|---|---|---|
| `SSH_PRIVATE_KEY` | *(empty)* | PEM private key used for browser SSH. VPSGuard never stores passwords, so key auth is the only option |
| `SSH_DEFAULT_USER` | `root` | Fallback SSH user when the server record has none |
| `SSH_DEFAULT_PORT` | `22` | Fallback SSH port |

Mount the key rather than inlining it:

```yaml
services:
  server:
    environment:
      SSH_PRIVATE_KEY_FILE: /run/secrets/vpsguard_ssh_key
    volumes:
      - ./secrets/id_ed25519:/run/secrets/vpsguard_ssh_key:ro
```

---

## 4. TLS

### Bring up Nginx

The `nginx` service sits behind the `tls` Compose profile, so it only starts
when you ask for it:

```bash
docker compose --profile tls up -d
```

It publishes 80 and 443, proxies `/api/` and `/socket.io/` to the API and
everything else to the dashboard, and enforces TLS 1.2/1.3 with HSTS,
`X-Content-Type-Options`, `X-Frame-Options` and a strict referrer policy.
WebSocket connections get a 24-hour read/send timeout so terminals and metric
streams stay open.

Certificates are read from:

| Path in container | Source |
|---|---|
| `/etc/nginx/certs/fullchain.pem` | `deploy/nginx/certs/fullchain.pem` |
| `/etc/nginx/certs/privkey.pem` | `deploy/nginx/certs/privkey.pem` |

### Let's Encrypt

Issue the certificate with the HTTP-01 challenge, which Nginx already routes to
`/var/www/certbot`:

```bash
cd vpsguard/deploy
mkdir -p nginx/certs certbot/www

# 1. Stop Nginx so certbot can bind port 80 for the first issuance
docker compose --profile tls stop nginx

# 2. Issue
docker run --rm \
  -p 80:80 \
  -v "$PWD/certbot/etc:/etc/letsencrypt" \
  -v "$PWD/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --standalone \
  -d monitor.example.com \
  --email admin@example.com --agree-tos --no-eff-email

# 3. Publish the certificate where Nginx expects it
sudo cp certbot/etc/live/monitor.example.com/fullchain.pem nginx/certs/fullchain.pem
sudo cp certbot/etc/live/monitor.example.com/privkey.pem   nginx/certs/privkey.pem

# 4. Start Nginx
docker compose --profile tls up -d nginx
```

Renew from cron. Subsequent renewals use the webroot, so Nginx keeps running:

```bash
sudo crontab -e
```

```cron
0 3 * * 1 cd /opt/vpsguard/deploy && docker run --rm -v "$PWD/certbot/etc:/etc/letsencrypt" -v "$PWD/certbot/www:/var/www/certbot" certbot/certbot renew --webroot -w /var/www/certbot --quiet && cp certbot/etc/live/monitor.example.com/*.pem nginx/certs/ && docker compose --profile tls exec -T nginx nginx -s reload
```

Mount the webroot into Nginx so renewals can be served:

```yaml
services:
  nginx:
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
      - ./certbot/www:/var/www/certbot:ro
```

### After enabling TLS

1. Update `.env`:
   ```ini
   PUBLIC_API_URL=https://monitor.example.com
   PUBLIC_WS_URL=https://monitor.example.com
   CORS_ORIGINS=https://monitor.example.com
   ```
2. Rebuild the dashboard — these values are inlined at build time:
   ```bash
   docker compose build dashboard && docker compose up -d dashboard
   ```
3. Stop publishing 3000 and 4000 to the internet. Either remove the `ports`
   entries for `server` and `dashboard`, or bind them to loopback:
   ```yaml
   ports:
     - "127.0.0.1:4000:4000"
   ```
4. Point agents at the HTTPS URL and restart them.

### Verify

```bash
curl -fsS https://monitor.example.com/api/v1/health | jq
curl -I http://monitor.example.com                      # expect 301 to https
openssl s_client -connect monitor.example.com:443 -tls1_1 </dev/null   # must fail
```

---

## 5. Backup

Both databases must be captured. PostgreSQL holds the metadata that makes the
time series meaningful; losing it means losing users, agent keys and alert
rules.

### PostgreSQL

```bash
cd vpsguard/deploy
mkdir -p backups

docker compose exec -T postgres \
  pg_dump -U vpsguard -d vpsguard --clean --if-exists \
  | gzip > "backups/postgres-$(date +%F-%H%M).sql.gz"
```

### InfluxDB

```bash
cd vpsguard/deploy

# Snapshot inside the container, then copy it out
docker compose exec -T influxdb \
  influx backup /tmp/influx-backup -t "$INFLUX_TOKEN"

docker compose cp influxdb:/tmp/influx-backup "backups/influx-$(date +%F-%H%M)"
docker compose exec -T influxdb rm -rf /tmp/influx-backup
```

### Nightly script

```bash
sudo tee /usr/local/bin/vpsguard-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR=/opt/vpsguard/deploy
BACKUP_DIR=/var/backups/vpsguard
STAMP=$(date +%F-%H%M)
RETAIN_DAYS=14

cd "$DEPLOY_DIR"
# shellcheck disable=SC1091
set -a && . ./.env && set +a
mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-vpsguard}" -d "${POSTGRES_DB:-vpsguard}" --clean --if-exists \
  | gzip > "$BACKUP_DIR/postgres-$STAMP.sql.gz"

docker compose exec -T influxdb influx backup /tmp/influx-backup -t "$INFLUX_TOKEN"
docker compose cp influxdb:/tmp/influx-backup "$BACKUP_DIR/influx-$STAMP"
docker compose exec -T influxdb rm -rf /tmp/influx-backup
tar -C "$BACKUP_DIR" -czf "$BACKUP_DIR/influx-$STAMP.tar.gz" "influx-$STAMP"
rm -rf "$BACKUP_DIR/influx-$STAMP"

cp "$DEPLOY_DIR/.env" "$BACKUP_DIR/env-$STAMP"
chmod 600 "$BACKUP_DIR/env-$STAMP"

find "$BACKUP_DIR" -type f -mtime "+$RETAIN_DAYS" -delete
echo "Backup completed: $STAMP"
EOF

sudo chmod 700 /usr/local/bin/vpsguard-backup.sh
```

```cron
30 2 * * * /usr/local/bin/vpsguard-backup.sh >> /var/log/vpsguard-backup.log 2>&1
```

| Artefact | Why it matters |
|---|---|
| PostgreSQL dump | Users, servers, hashed agent keys, groups, alert rules, alert history, commands, audit logs, integrations |
| InfluxDB backup | All metric history |
| `.env` | `JWT_*` secrets (without them every session is invalidated) and `INFLUX_TOKEN` (without it the Influx data is unreadable) |

Copy backups off the host. A backup on the machine you are protecting is not a
backup.

---

## 6. Restore

### PostgreSQL

```bash
cd vpsguard/deploy

docker compose stop server dashboard

gunzip -c /var/backups/vpsguard/postgres-2026-09-03-0230.sql.gz \
  | docker compose exec -T postgres psql -U vpsguard -d vpsguard

docker compose up -d server dashboard
docker compose logs -f server
```

The dump is taken with `--clean --if-exists`, so it drops and recreates its own
objects and can be applied over an existing database.

### InfluxDB

```bash
cd vpsguard/deploy

tar -xzf /var/backups/vpsguard/influx-2026-09-03-0230.tar.gz -C /tmp
docker compose cp /tmp/influx-2026-09-03-0230 influxdb:/tmp/influx-restore

# Replace the existing bucket
docker compose exec -T influxdb \
  influx restore /tmp/influx-restore -t "$INFLUX_TOKEN" --full

docker compose restart server
```

To restore into a fresh bucket instead of overwriting:

```bash
docker compose exec -T influxdb influx restore /tmp/influx-restore \
  -t "$INFLUX_TOKEN" \
  --org vpsguard --bucket metrics_restored
```

### Full disaster recovery

```bash
git clone https://github.com/your-org/vpsguard.git /opt/vpsguard
cd /opt/vpsguard/deploy
cp /var/backups/vpsguard/env-2026-09-03-0230 .env    # same JWT and Influx secrets
chmod 600 .env
docker compose up -d postgres influxdb redis
# wait for healthy, then restore both databases as above
docker compose up -d
```

Because the restored `.env` carries the original `JWT_*` secrets and
`INFLUX_TOKEN`, existing sessions and all metric history keep working. Agent API
keys are unaffected — their hashes came back with the PostgreSQL dump.

### Verify a restore

```bash
curl -fsS http://localhost:4000/api/v1/health | jq
docker compose exec -T postgres psql -U vpsguard -d vpsguard \
  -c 'SELECT count(*) FROM servers; SELECT count(*) FROM users;'
docker compose exec -T influxdb influx query \
  'from(bucket:"metrics") |> range(start:-1h) |> limit(n:1)' -t "$INFLUX_TOKEN"
```

---

## 7. Upgrading

```bash
cd vpsguard/deploy

# 1. Back up first — always
/usr/local/bin/vpsguard-backup.sh

# 2. Fetch the new revision
git fetch --tags
git checkout v1.1.0

# 3. Review the release notes for breaking changes and new .env keys
#    Add any new variables to .env before continuing

# 4. Rebuild and recreate
docker compose build server dashboard
docker compose up -d

# 5. Verify
docker compose ps
curl -fsS http://localhost:4000/api/v1/health | jq
docker compose logs --since 5m server
```

### Database migrations

Once `POSTGRES_SYNCHRONIZE=false`, schema changes are applied explicitly:

```bash
docker compose exec server npm run migration:run
```

Run migrations after the new image is in place but before directing traffic at
it. Keep the pre-upgrade dump until the new version has run cleanly for a day.

### Rollback

```bash
cd vpsguard/deploy
git checkout v1.0.0
docker compose build server dashboard
docker compose up -d
# restore the pre-upgrade PostgreSQL dump if the upgrade migrated the schema
```

Agents need no coordination during a server upgrade: while the API is down they
buffer locally and replay afterwards.

---

## 8. Horizontal scaling

The API is stateless over HTTP, so replicas are straightforward; the real work
is moving per-process state into Redis. See
[Architecture § 7](architecture.md#7-horizontal-scaling-to-10000-agents) for the
reasoning.

### Multiple API replicas

```bash
docker compose up -d --scale server=4
```

Remove the fixed `ports` mapping from the `server` service first (four
containers cannot share host port 4000) and let Nginx or an external load
balancer address them by service name.

| Requirement | Why |
|---|---|
| Sticky sessions for `/socket.io/` | The Socket.IO upgrade must return to the replica that answered the handshake |
| Redis adapter for Socket.IO | Otherwise `metrics`, `alert` and `overview` only reach clients attached to the emitting replica |
| Redis-backed alert `pending` state | Otherwise a condition tracked by one replica is not counted by another and `durationSeconds` never elapses |
| Single scheduler owner | `agent.offline` detection, disk forecasting and command expiry must not run on every replica. Elect a leader through Redis or run one replica with the scheduler enabled |

### Externalising the databases

For anything above a few hundred agents, move the stateful services off the API
host:

```ini
POSTGRES_HOST=pg.internal
POSTGRES_PORT=5432
INFLUX_URL=http://influx.internal:8086
REDIS_HOST=redis.internal
```

Then remove `postgres`, `influxdb` and `redis` from the Compose file and drop
the `depends_on` conditions.

### Reducing load without adding hardware

| Lever | Effect |
|---|---|
| Agent `interval` 30 s → 60 s | Halves ingest rate and storage growth |
| Disable unused collectors in `[metrics]` | Fewer points per packet; `processes`, `services` and `docker` are the heaviest |
| Lower `INFLUX_RETENTION` | Directly reduces disk usage |
| Add an Influx downsampling task | Keep 7 days raw and a year of hourly means |
| Raise `top_processes` only where needed | Every extra process is another row in `raw_snapshot` |

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `POSTGRES_PASSWORD is required` on `up` | Variable missing from `.env` | Compose interpolates `.env` from the current directory — run from `deploy/` and confirm the key exists |
| `server` container restarts in a loop | Cannot reach a dependency | `docker compose logs server`; check `docker compose ps` for unhealthy `postgres`/`influxdb`/`redis` |
| `/api/v1/health` returns `"database": "down"` | PostgreSQL unreachable or credentials wrong | `docker compose exec postgres pg_isready -U vpsguard`; verify `POSTGRES_*` |
| `Influx write failed: unauthorized` in the logs | `INFLUX_TOKEN` does not match the initialised instance | The token is only applied on **first** initialisation. Either restore the original token or wipe `influx_data` and re-initialise (destroys history) |
| Charts are empty but metrics arrive | Metric key not in `METRIC_MAP`, or the range has no data | Confirm the key against [Architecture § 5](architecture.md#5-influxdb-layout); widen `from`/`to` |
| Dashboard shows *Network Error* | `NEXT_PUBLIC_API_URL` was changed without rebuilding | `docker compose build dashboard && docker compose up -d dashboard` |
| Browser console shows a CORS error | Origin missing from `CORS_ORIGINS` | Add the exact scheme+host+port and recreate the `server` container |
| Login succeeds, then every call returns 401 | `JWT_ACCESS_SECRET` changed, or clock skew | Keep secrets stable across restarts; sync time with NTP |
| Cannot log in with `ADMIN_EMAIL` | The bootstrap only runs while `users` is empty | Reset the password directly: `docker compose exec postgres psql -U vpsguard -d vpsguard` and update `password_hash` with a bcrypt hash |
| WebSocket disconnects every 60 seconds | A proxy is not forwarding the upgrade or is timing the connection out | Use the bundled Nginx config, which sets `Upgrade`/`Connection` and an 86 400 s timeout |
| Web terminal reports *Server IP address is unknown* | No packet received yet, so `ip_address` is null | Wait for the first ingest, or set the address by editing the server |
| Web terminal reports *All configured authentication methods failed* | `SSH_PRIVATE_KEY` missing or the key is not authorised on the target | Provide the key and add its public half to the target's `authorized_keys` |
| Web terminal reports *Insufficient permissions* | The user is a `viewer` | Terminals require `admin` or `operator` |
| Agents show offline in bursts | `AGENT_OFFLINE_AFTER_SECONDS` too close to the agent `interval` | Keep it at 3–4× the interval (120 s for a 30 s interval) |
| `429 Too Many Requests` from the dashboard | Default limit is 300 requests/min per client | Reduce polling, or raise the limit in `ThrottlerModule.forRoot` |
| Agents get 429 | Ingest should be exempt | Confirm agents post to `/api/v1/ingest`; that route carries `@SkipThrottle()` |
| Disk filling on the central host | Influx retention too long, or Docker logs unbounded | Lower `INFLUX_RETENTION`; set a `max-size` log driver; `docker system prune` |
| `docker compose up` cannot bind port 80 | Another web server owns it | Stop it, or change the Nginx port mapping |
| Certbot HTTP-01 fails | Port 80 unreachable, or DNS not propagated | `dig +short monitor.example.com`; open 80 inbound; retry |

Useful one-liners:

```bash
docker compose ps
docker compose logs --tail=200 server
docker compose logs --tail=100 nginx
docker compose exec postgres psql -U vpsguard -d vpsguard -c '\dt'
docker compose exec redis redis-cli ping
docker compose exec influxdb influx ping
docker stats --no-stream
```
