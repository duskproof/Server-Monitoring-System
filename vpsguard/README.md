# VPSGuard — VPS/VDS Monitoring System

VPSGuard is a self-hosted monitoring platform for virtual servers. A lightweight agent
collects deep system metrics from each machine, a central server stores and analyses them,
and a real-time dashboard visualises the fleet, raises alerts and lets operators act on
incidents without leaving the browser.

---

## What it does

| Capability | Details |
|---|---|
| **Deep metrics** | CPU (per core, frequency, temperature), memory and swap, disk usage and I/O, SMART health, network throughput and errors, processes, systemd services, Docker containers, sensor temperatures |
| **Security monitoring** | Failed SSH attempts, brute-force detection, firewall state, open ports, recent logins |
| **SSL monitoring** | Certificate expiry tracking with alerts at 30 / 14 / 7 / 1 days |
| **Alerting** | Threshold, duration and trend rules with `firing → acknowledged → resolved` lifecycle, deduplication and grouping |
| **Notifications** | Telegram, Slack, Email (SMTP) and generic Webhook |
| **Prediction** | Linear-regression forecasting warns about disk exhaustion days in advance |
| **Self-healing** | Rules can auto-restart a failed service or clean up logs when a threshold is breached |
| **Web terminal** | Browser SSH via xterm.js with full command auditing |
| **Reports** | On-demand JSON, CSV and PDF infrastructure reports |

---

## Architecture

```
┌──────────────┐   HTTPS/JSON    ┌──────────────────────────────┐   WebSocket   ┌───────────────┐
│ VPSGuard     │ ──────────────▶ │      VPSGuard Server         │ ────────────▶ │   Dashboard   │
│ Agent        │                 │        (NestJS)              │               │  (Next.js)    │
│ (Python 3)   │ ◀────────────── │                              │ ◀──────────── │               │
└──────────────┘  commands       └──────────────────────────────┘   REST API    └───────────────┘
       │                            │            │           │
   collects                    PostgreSQL   InfluxDB 2.x    Redis
   psutil/systemd/docker       (metadata)   (time series)   (cache/queues)
       │                                          │
       └── SQLite buffer (24 h offline retention) │
                                                  ▼
                              Telegram · Slack · Email · Webhook
```

Data flow: the agent samples metrics → ships them over HTTPS → the server validates,
writes the time series to InfluxDB, updates the server snapshot in PostgreSQL and evaluates
alert rules → alerts fan out to notification channels → the dashboard updates live over
WebSocket.

---

## Repository layout

```
vpsguard/
├── agent/          Python 3 monitoring agent (systemd or Docker)
├── server/         NestJS central server — REST API, WebSocket, alert engine
├── dashboard/      Next.js 14 web dashboard
├── deploy/         Docker Compose stack, Nginx TLS termination, env template
└── docs/           Architecture, installation, API and user guides
```

---

## Quick start

### 1. Bring up the central server

```bash
cd vpsguard/deploy
cp .env.example .env

# Generate strong secrets
openssl rand -hex 32   # -> INFLUX_TOKEN
openssl rand -hex 48   # -> JWT_ACCESS_SECRET
openssl rand -hex 48   # -> JWT_REFRESH_SECRET

# Edit .env, then start everything
docker compose up -d
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| REST API | http://localhost:4000/api/v1 |
| Swagger UI | http://localhost:4000/api/v1/docs |
| InfluxDB | http://localhost:8086 |

Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env`, then change the password.

### 2. Register a server and install the agent

In the dashboard go to **Servers → Add server**. Copy the generated API key (it is shown
exactly once), then on the machine you want to monitor:

```bash
curl -fsSL https://your-vpsguard-host/install.sh | sudo bash -s -- \
  --url https://your-vpsguard-host \
  --api-key vg_your_generated_key
```

Metrics appear on the dashboard within about 60 seconds.

### 3. Wire up Telegram alerts

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Get your chat ID from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. In the dashboard: **Settings → Integrations → Telegram**, paste both values and press
   **Test**.

Default rules ship enabled for CPU > 90 %, memory > 90 %, disk > 85 %, agent offline and
SSL expiry, so alerts start flowing immediately.

---

## Requirements

**Central server** — Docker and Docker Compose, 2 vCPU, 4 GB RAM, 20 GB disk (with 30-day
retention for roughly 50 agents).

**Monitored servers** — Ubuntu 20.04+, Debian 11+, CentOS 8+, AlmaLinux, Rocky Linux or
Alpine (partial). Python 3.8+. The agent stays under 1 % CPU and 50 MB RAM.

**Ports** — 3000 (dashboard), 4000 (API + WebSocket), 5432 (PostgreSQL), 6379 (Redis),
8086 (InfluxDB). Only 80/443 need to be public when running behind the bundled Nginx.

---

## Documentation

| Guide | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Components, data flow, schema, scaling |
| [`docs/agent-installation.md`](docs/agent-installation.md) | Installing and configuring the agent |
| [`docs/server-deployment.md`](docs/server-deployment.md) | Production deployment, TLS, backups |
| [`docs/api.md`](docs/api.md) | REST and WebSocket reference |
| [`docs/user-guide.md`](docs/user-guide.md) | Using the dashboard day to day |
| [`docs/developer-guide.md`](docs/developer-guide.md) | Local development and contributing |

Interactive API docs are generated from the code at `/api/v1/docs` (OpenAPI 3).

---

## Security

- TLS 1.2+ everywhere, terminated by Nginx
- Passwords hashed with bcrypt (cost 12); agent API keys stored only as hashes
- Short-lived JWT access tokens (15 min) plus revocable refresh tokens (7 days)
- Role-based access control: `admin`, `operator`, `viewer`
- Rate limiting on all API routes; the ingest path is exempt and authenticated by API key
- Agents execute remote commands sandboxed via `systemd-run` as an unprivileged user
- Every privileged action is written to the audit log

---

## Development

```bash
# Server
cd server && npm install && npm run start:dev     # http://localhost:4000

# Dashboard
cd dashboard && npm install && npm run dev        # http://localhost:3000

# Agent
cd agent && pip install -e ".[dev]"
python -m vpsguard_agent collect-once --config ./packaging/agent.conf
```

Tests: `npm test` in `server/` and `dashboard/`, `pytest` in `agent/`.

---

## License

MIT
