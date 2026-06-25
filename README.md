# Server Monitoring System with Telegram Alerts

A complete server monitoring stack built on **Grafana + Prometheus + Node Exporter + Alertmanager** with automatic **Telegram** notifications.

Operators receive instant alerts for critical issues (high CPU load, low memory, disk space) without having to watch dashboards constantly.

---

## Architecture

```
[Server] → [Node Exporter] → [Prometheus] → [Grafana] → [Alertmanager] → [Telegram Bot] → [Your chat]
     ↓              ↓               ↓             ↓             ↓               ↓              ↓
  Metrics       Expose          Store        Visualize     Route         Deliver        Receive
  collection    metrics         metrics      & alerts      alerts        notifications  notifications
```

| Component | Version | Purpose |
|-----------|---------|---------|
| Node Exporter | v1.8.0 | Collect system metrics (CPU, RAM, Disk, Network) |
| Prometheus | v2.42.0 | Store metrics and evaluate queries |
| Grafana | v9.3.6 | Visualize data and configure alerts |
| Alertmanager | v0.25.0 | Route and manage notifications |
| Docker Compose | Latest | Containerize all services |

---

## System Requirements

### Server

- **Ubuntu** 20.04 / 22.04 / 24.04 LTS (recommended)
- or **CentOS / RHEL 9** Stream
- Minimum: **1 CPU**, **2–3 GB RAM**, **5–10 GB** disk

### Ports

| Port | Service |
|------|---------|
| 3000 | Grafana |
| 9090 | Prometheus |
| 9093 | Alertmanager |
| 9100 | Node Exporter |

### Dependencies

- **Option 1 (Docker):** Docker and Docker Compose
- **Option 2 (manual):** systemd, curl, wget

---

## Quick Start (Docker Compose)

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd Grafana_alerts
```

### 2. Configure environment variables

```bash
cp .env.example .env
nano .env   # or any editor
```

Fill in `.env`:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890
GRAFANA_ADMIN_PASSWORD=MySecurePassword123
```

### 3. Start the stack

```bash
bash scripts/start.sh
# or
docker compose up -d
```

### 4. Verify

```bash
bash scripts/health-check.sh
```

Open in your browser:

- **Grafana:** http://localhost:3000 (login: `admin`, password from `.env`)
- **Prometheus:** http://localhost:9090
- **Targets:** http://localhost:9090/targets — `node_exporter` should be **UP**

---

## Telegram Bot Setup

### Step 1: Create a bot

1. Open Telegram and find **@BotFather**
2. Send `/newbot`
3. Choose a name and username (must end with `bot` or `_bot`)
4. Save the **API Token** → `TELEGRAM_BOT_TOKEN`

### Step 2: Get Chat ID

**Option A — via Telegram Web:**

1. Add the bot to a group (or message it directly)
2. Open [web.telegram.org](https://web.telegram.org)
3. Copy the number from the URL after `#`, e.g. `https://web.telegram.org/a/#-4266674385` → Chat ID: `-4266674385`

**Option B — via API:**

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
```

Find `"chat":{"id": ...}` in the response.

> **Note:** Telegram messages are limited to **4096 characters** (UTF-8).

### Step 3: Grafana configuration (automatic + manual check)

When the Docker stack starts, the `telegram-notifications` contact point is created automatically from `.env`.

**Manual verification:**

1. Log in to Grafana → **Alerting** → **Contact points**
2. Find `telegram-notifications`
3. Click **Test** — a test message should arrive in Telegram
4. **Alerting** → **Notification policies** — ensure the Default policy uses `telegram-notifications`

---

## Node Exporter Full Dashboard (ID: 1860)

The dashboard is downloaded automatically on first Grafana startup.

**Manual import (if needed):**

1. Grafana → **Dashboards** → **New** → **Import**
2. Enter ID: **1860**
3. Select datasource: **Prometheus**
4. Click **Import**

The dashboard shows CPU, RAM, Disk, and Network metrics from Node Exporter.

---

## Alert Rules

The system configures **two alerting channels**:

### Prometheus + Alertmanager → Telegram

File: `prometheus/alert_rules.yml`

| Alert | Condition | Severity | For |
|-------|-----------|----------|-----|
| **HighCPUUsage** | CPU > 90% | critical | 5m |
| **HighMemoryUsage** | RAM > 95% | warning | 5m |
| **LowDiskSpace** | Free space < 15% | warning | 5m |
| **NodeExporterDown** | Target unreachable | critical | 1m |

Check: http://localhost:9090/alerts

### Grafana Unified Alerting → Telegram

File: `grafana/provisioning/alerting/rules.yml`

The same 3 core alerts (CPU, RAM, Disk) delivered via the `telegram-notifications` contact point.

Check: Grafana → **Alerting** → **Alert rules** → folder **Server Monitoring**

### Expression reference

**CPU:**
```promql
(100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)) > 90
```
Computes average CPU usage over 5 minutes (100% minus idle time).

**RAM:**
```promql
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 95
```
Percentage of used memory.

**Disk:**
```promql
(node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100 < 15
```
Percentage of free space on filesystems (excluding tmpfs/overlay).

---

## Option 2: Manual Installation (without Docker)

### Step 1: Node Exporter

```bash
sudo bash scripts/install-node-exporter.sh
curl http://localhost:9100/metrics | head
```

### Step 2: Prometheus

```bash
sudo bash scripts/install-prometheus.sh
```

Check targets: http://localhost:9090/targets

### Step 3: Grafana (Ubuntu/Debian)

```bash
sudo apt-get install -y adduser libfontconfig1 musl
wget https://dl.grafana.com/enterprise/release/grafana-enterprise_9.3.6_amd64.deb
sudo dpkg -i grafana-enterprise_9.3.6_amd64.deb
sudo systemctl enable --now grafana-server
```

### Step 4: Configure Grafana manually

1. Open http://localhost:3000
2. **Connections** → **Data sources** → **Add** → Prometheus → URL: `http://localhost:9090`
3. Import dashboard **1860**
4. **Alerting** → **Contact points** → add Telegram (token + chat ID)
5. **Notification policies** → set `telegram-notifications`
6. Create alert rules (see **Alert Rules** section)

### Step 5: Alertmanager (optional for Prometheus alerts)

```bash
# Download alertmanager v0.25.0 from GitHub releases
# Copy alertmanager/alertmanager.yml.template → /etc/alertmanager/alertmanager.yml
# Substitute TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
```

Add an `alerting` section to `prometheus.yml` with target `localhost:9093`.

---

## Testing

### 1. Check metrics

```bash
# Node Exporter
curl -s http://localhost:9100/metrics | grep node_cpu

# Prometheus targets
curl -s http://localhost:9090/api/v1/targets | grep -o '"health":"[^"]*"'
```

### 2. Test Telegram via Grafana

Grafana → Alerting → Contact points → `telegram-notifications` → **Test**

### 3. Test Prometheus alerts

Alertmanager UI: http://localhost:9093

To force a test, temporarily lower a threshold in `alert_rules.yml` (e.g. CPU > 1%) and reload Prometheus:

```bash
docker compose restart prometheus
# or for systemd:
curl -X POST http://localhost:9090/-/reload
```

### 4. Full health check

```bash
bash scripts/health-check.sh
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Target `node_exporter` DOWN | Check `docker compose ps`, port 9100, firewall |
| Grafana won't open | `docker compose logs grafana`, check port 3000 |
| Telegram Test fails | Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`, restart: `docker compose restart grafana alertmanager` |
| Bot doesn't post to group | Add bot to group, grant permission to send messages |
| Negative Chat ID | Group IDs are always negative, e.g. `-1001234567890` |
| Dashboard 1860 is empty | Check Prometheus datasource, targets UP, wait 1–2 min |
| Prometheus alerts not in Telegram | Check Alertmanager logs: `docker compose logs alertmanager` |
| `permission denied` on Node Exporter | Linux Docker needs access to `/proc`, `/sys` — volumes are configured in compose |
| Messages truncated | Telegram 4096 char limit — Alertmanager uses a short HTML template |

### Useful commands

```bash
# Container status
docker compose ps

# Logs
docker compose logs -f grafana
docker compose logs -f prometheus
docker compose logs -f alertmanager

# Restart after .env changes
docker compose down && docker compose up -d

# Stop
docker compose down
```

---

## Project Structure

```
Grafana_alerts/
├── docker-compose.yml          # Docker Compose stack
├── .env.example                # Environment variables template
├── prometheus/
│   ├── prometheus.yml          # Prometheus configuration
│   └── alert_rules.yml         # Alert rules
├── alertmanager/
│   └── alertmanager.yml.template
├── grafana/provisioning/
│   ├── datasources/            # Prometheus datasource
│   ├── dashboards/             # Node Exporter Full (1860)
│   └── alerting/               # Contact points, policies, rules
└── scripts/
    ├── start.sh                # Quick start
    ├── health-check.sh         # Health check
    ├── install-node-exporter.sh
    └── install-prometheus.sh
```

---

## Acceptance Criteria

- [x] Node Exporter runs and exposes metrics on port 9100
- [x] Prometheus scrapes Node Exporter (target UP in `/targets`)
- [x] Grafana connected to Prometheus as a data source
- [x] Node Exporter Full dashboard (ID 1860) imported automatically
- [x] Telegram contact point configured via `.env`
- [x] Minimum 3 alerts: CPU, RAM, Disk (Prometheus + Grafana)
- [x] Alertmanager routes Prometheus alerts to Telegram
- [x] Documentation with step-by-step instructions

---

## Optional Enhancements

- **cAdvisor** — monitor Docker containers
- **Blackbox Exporter** — check external service availability
- **Watchtower** — automatic image updates
- **Authentication** — reverse proxy (nginx + basic auth / OAuth)
- **Backups** — backup volumes `prometheus_data`, `grafana_data`

---

## License

MIT — free to use and modify.
