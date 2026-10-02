# VPSGuard Agent Installation

The agent is a small Python 3 daemon that samples the host, ships metrics to the
central server over HTTPS, and executes the commands the server hands back. It
runs under systemd (recommended) or in a container.

Related documents: [Architecture](architecture.md) ·
[Server deployment](server-deployment.md) · [API reference](api.md) ·
[User guide](user-guide.md)

---

## 1. Prerequisites

| Requirement | Detail |
|---|---|
| Operating system | Ubuntu 20.04+, Debian 11+, CentOS 8+, AlmaLinux, Rocky Linux, Alpine (partial) |
| Python | 3.8 or newer |
| Dependencies | `psutil >= 5.9`, `requests >= 2.31` |
| Privileges | `root` for installation; the daemon itself needs read access to `/proc`, `/sys` and the auth log |
| Outbound network | HTTPS to the VPSGuard server (port 443 through the bundled Nginx) |
| Footprint | Under 1 % CPU and 50 MB RAM |

Optional external tools unlock extra collectors. Each is detected at runtime and
skipped with a single warning when missing.

| Tool | Unlocks |
|---|---|
| `systemctl` | systemd service states |
| `docker` | container CPU, memory, network, block I/O, health |
| `smartctl` (smartmontools) | SMART disk health |
| `sensors` (lm-sensors), `nvidia-smi` | motherboard, CPU and GPU temperatures |
| `ufw`, `firewall-cmd`, `nft`, `iptables` | firewall state |
| `ss`, `last`, `journalctl` | listening ports, login history, SSH log fallback |

Before installing, register the server in the dashboard (**Servers → Add
server**) and copy the generated API key. It is displayed **exactly once** —
only a bcrypt hash is stored.

---

## 2. One-line install

```bash
curl -fsSL https://your-host/install.sh | sudo bash -s -- \
  --url https://your-host \
  --api-key vg_your_generated_key
```

The installer creates the `vpsguard` system user, installs the package into
`/opt/vpsguard`, writes `/etc/vpsguard/agent.conf` with mode `0600`, creates
`/var/lib/vpsguard` and `/var/log/vpsguard`, then enables and starts
`vpsguard-agent.service`.

Verify:

```bash
sudo systemctl status vpsguard-agent
sudo journalctl -u vpsguard-agent -n 50 --no-pager
```

Metrics appear on the dashboard within about 60 seconds.

---

## 3. Manual install

Use this when the one-liner is not appropriate — air-gapped hosts, custom
prefixes, or configuration management.

```bash
# 1. Unprivileged service account
sudo useradd --system --no-create-home --shell /usr/sbin/nologin vpsguard

# 2. Virtual environment and package
sudo python3 -m venv /opt/vpsguard
sudo /opt/vpsguard/bin/pip install --upgrade pip
sudo /opt/vpsguard/bin/pip install /path/to/vpsguard-agent   # or: pip install vpsguard-agent

# 3. Directories
sudo mkdir -p /etc/vpsguard /var/lib/vpsguard /var/log/vpsguard
sudo chown vpsguard:vpsguard /var/lib/vpsguard /var/log/vpsguard
```

Write the configuration:

```bash
sudo tee /etc/vpsguard/agent.conf >/dev/null <<'EOF'
[server]
url = https://your-host
api_key = vg_your_generated_key

[agent]
interval = 30
slow_interval = 300
log_level = info

[metrics]
cpu = true
memory = true
disk = true
network = true
processes = true
services = true
docker = true
temperature = true
smart = true
security = true
ssl = false
logs = true

[logs]
files = /var/log/syslog,/var/log/auth.log
patterns = error,critical,failed,denied

[ssl]
domains =
EOF

sudo chmod 600 /etc/vpsguard/agent.conf
sudo chown root:root /etc/vpsguard/agent.conf
```

Validate the configuration before starting anything:

```bash
sudo /opt/vpsguard/bin/vpsguard-agent test-config
```

Install the unit file:

```bash
sudo tee /etc/systemd/system/vpsguard-agent.service >/dev/null <<'EOF'
[Unit]
Description=VPSGuard monitoring agent
Documentation=https://github.com/your-org/vpsguard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/vpsguard/bin/vpsguard-agent run --config /etc/vpsguard/agent.conf
Restart=always
RestartSec=10
StateDirectory=vpsguard
LogsDirectory=vpsguard
NoNewPrivileges=yes
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now vpsguard-agent
```

> The agent runs as `root` by default so that it can read the auth log and
> control services. Remote `run_script` payloads are always dropped to the
> unprivileged `command_user` before execution — see
> [section 9](#9-remote-commands-and-sandboxing).

---

## 4. Docker install

Container monitoring needs host visibility, so the container must be given the
host namespaces and three bind mounts.

```bash
docker run -d \
  --name vpsguard-agent \
  --restart unless-stopped \
  --network host \
  --pid host \
  -e VPSGUARD_URL=https://your-host \
  -e VPSGUARD_API_KEY=vg_your_generated_key \
  -e VPSGUARD_INTERVAL=30 \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v vpsguard-state:/var/lib/vpsguard \
  -v /var/log:/var/log:ro \
  vpsguard/agent:1.0.0
```

Or with Compose:

```yaml
services:
  agent:
    image: vpsguard/agent:1.0.0
    container_name: vpsguard-agent
    restart: unless-stopped
    network_mode: host
    pid: host
    environment:
      VPSGUARD_URL: https://your-host
      VPSGUARD_API_KEY: vg_your_generated_key
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - vpsguard-state:/var/lib/vpsguard
      - /var/log:/var/log:ro

volumes:
  vpsguard-state:
```

### What each mount is for

| Mount | Mode | Why it is needed | If omitted |
|---|---|---|---|
| `/proc` → `/host/proc` | read-only | `psutil` reads CPU times, memory, the process table, network counters and the socket table from `/proc` | CPU, memory, process and network metrics describe the container, not the host |
| `/sys` → `/host/sys` | read-only | Hardware sensors (`/sys/class/hwmon`, `/sys/class/thermal`) and block-device attributes | No temperature metrics; SMART data is incomplete |
| `/var/run/docker.sock` | read-only | The Docker collector shells out to the `docker` CLI, which talks to this socket | The `docker` collector reports nothing |
| `/var/lib/vpsguard` (named volume) | read-write | Persists the SQLite offline buffer and the assigned `server_id` | Buffered metrics and the server identity are lost on every container restart |
| `/var/log` | read-only | Security collector (failed SSH attempts, logins) and the log-scan collector | `security.failed_ssh_attempts` and log scanning are unavailable |

`--network host` makes interface counters and listening ports reflect the host.
`--pid host` makes the process table the host's. Both are required for the
metrics to mean anything.

Set `PROC_ROOT=/host/proc` and `SYS_ROOT=/host/sys` (or run with
`--privileged`) if your image mounts the host paths under a prefix rather than
over the container's own `/proc` and `/sys`.

---

## 5. `agent.conf` reference

INI format, loaded from `/etc/vpsguard/agent.conf` unless overridden with
`--config` or `VPSGUARD_CONFIG`. Every option has a safe default, so a minimal
file only needs `[server] url` and `[server] api_key`.

### `[server]`

| Option | Default | Description |
|---|---|---|
| `url` | *(required)* | Base URL of the central server. Must start with `http://` or `https://`; trailing slashes are stripped. `/api/v1/ingest` is appended automatically |
| `api_key` | *(required)* | Agent key issued when the server was registered, format `vg_` + 48 hex characters |

### `[agent]`

| Option | Default | Description |
|---|---|---|
| `interval` | `30` | Seconds between fast-tier collections (CPU, memory, disk, network, processes, services, docker). Minimum 5 |
| `slow_interval` | `300` | Seconds between slow-tier collections (temperature, SMART, security, SSL, logs). Minimum 10, and must be ≥ `interval`. Cached results are merged into every payload |
| `log_level` | `info` | One of `debug`, `info`, `warning`, `error`, `critical` |
| `buffer_size` | `1000` | Maximum payloads held in the SQLite offline buffer. The oldest are dropped when exceeded |
| `buffer_retention_hours` | `24` | Buffered payloads older than this are purged |
| `allow_commands` | `false` | Set to `true` (or install with `--enable-commands`) to accept remote commands from the dashboard |
| `command_user` | `vpsguard` | Unprivileged account that `run_script` payloads are dropped to |
| `command_timeout` | `60` | Default command timeout in seconds. A server-supplied timeout is honoured, capped at 900 |
| `verify_tls` | `true` | TLS certificate verification. Disabling it logs a loud warning and allows interception — only for a private CA you cannot install |
| `state_dir` | `/var/lib/vpsguard` | Holds `buffer.db` and `server_id` |
| `log_dir` | `/var/log/vpsguard` | Log directory used when `log_file` is set |
| `log_file` | *(empty)* | Log file name. Empty means log to stdout/journal only |
| `top_processes` | `10` | Number of processes reported, ranked by CPU then memory |
| `subprocess_refresh_seconds` | `60` | Cache lifetime for collectors that shell out (`systemctl`, `docker`). `0` disables caching |
| `request_timeout` | `10` | HTTP timeout in seconds for ingest and command-result calls |

### `[metrics]`

Every key is a boolean, all `true` by default. Turning a collector off removes
the metric from the payload entirely.

| Option | Collects |
|---|---|
| `cpu` | Load average, utilisation breakdown, per-core usage, frequency, package temperature |
| `memory` | RAM and swap in MB, plus `used_percent` |
| `disk` | Per-mount capacity and per-device I/O and IOPS |
| `network` | Per-interface counters, derived bytes/second, TCP socket state counts |
| `processes` | Top `top_processes` consumers plus a `total`/`running`/`sleeping`/`zombie` summary |
| `services` | systemd service units (max 200, failed units first). Requires `systemctl` |
| `docker` | Container CPU, memory, network, block I/O, status, health, uptime. Requires `docker` |
| `temperature` | `sensors`, hwmon and `nvidia-smi` readings |
| `smart` | SMART health, temperature, power-on hours, reallocated sectors, wear levelling. Requires `smartctl` |
| `security` | Failed SSH attempts (total and last hour), firewall state and backend, listening ports, last logins |
| `ssl` | Certificate expiry for the endpoints in `[ssl] domains`. Disabled in effect until domains are configured |
| `logs` | Pattern match counts and sample lines from `[logs] files` |

### `[logs]`

| Option | Default | Description |
|---|---|---|
| `files` | `/var/log/syslog,/var/log/auth.log` | Comma-separated log files to scan |
| `patterns` | `error,critical,failed,denied` | Comma-separated case-insensitive substrings to count. Must not be empty while the `logs` collector is enabled |
| `max_lines` | `2000` | Lines read from the tail of each file per scan |

### `[ssl]`

| Option | Default | Description |
|---|---|---|
| `domains` | *(empty)* | Comma-separated `host` or `host:port` entries, e.g. `example.com,api.example.com:8443`. Port defaults to 443, maximum 25 endpoints |

### Example: a production web host

```ini
[server]
url = https://monitor.example.com
api_key = vg_4f3c1a9d6b2e8074c5a1f9d3e7b046a28c1d5f9e3a7b204c

[agent]
interval = 30
slow_interval = 300
log_level = info
top_processes = 15
allow_commands = false
command_user = vpsguard

[metrics]
cpu = true
memory = true
disk = true
network = true
processes = true
services = true
docker = true
temperature = true
smart = true
security = true
ssl = true
logs = true

[logs]
files = /var/log/syslog,/var/log/auth.log,/var/log/nginx/error.log
patterns = error,critical,failed,denied,segfault
max_lines = 4000

[ssl]
domains = example.com,www.example.com,api.example.com:8443
```

---

## 6. Environment-variable overrides

Applied after the file is read, so they win. Useful for containers and for
temporary debugging.

| Variable | Overrides | Example |
|---|---|---|
| `VPSGUARD_CONFIG` | Configuration file path | `/etc/vpsguard/staging.conf` |
| `VPSGUARD_URL` | `[server] url` | `https://monitor.example.com` |
| `VPSGUARD_API_KEY` | `[server] api_key` | `vg_...` |
| `VPSGUARD_INTERVAL` | `[agent] interval` | `60` |
| `VPSGUARD_LOG_LEVEL` | `[agent] log_level` | `debug` |

Empty values are ignored, so `VPSGUARD_URL=` does not blank out the file value.

```bash
# One-off debug run against a staging server, without touching agent.conf
sudo VPSGUARD_LOG_LEVEL=debug VPSGUARD_URL=https://staging.example.com \
  /opt/vpsguard/bin/vpsguard-agent collect-once
```

Add persistent overrides to the unit with a drop-in:

```bash
sudo systemctl edit vpsguard-agent
```

```ini
[Service]
Environment=VPSGUARD_LOG_LEVEL=debug
```

---

## 7. systemd operations

| Task | Command |
|---|---|
| Status | `sudo systemctl status vpsguard-agent` |
| Start / stop | `sudo systemctl start vpsguard-agent` / `sudo systemctl stop vpsguard-agent` |
| Restart after a config change | `sudo systemctl restart vpsguard-agent` |
| Enable at boot | `sudo systemctl enable vpsguard-agent` |
| Disable at boot | `sudo systemctl disable vpsguard-agent` |
| Live logs | `sudo journalctl -u vpsguard-agent -f` |
| Last 200 log lines | `sudo journalctl -u vpsguard-agent -n 200 --no-pager` |
| Errors from the last hour | `sudo journalctl -u vpsguard-agent --since -1h -p warning --no-pager` |
| Resource usage | `systemctl show vpsguard-agent -p MemoryCurrent,CPUUsageNSec` |
| Reload unit changes | `sudo systemctl daemon-reload` |

---

## 8. CLI usage

The console script is `vpsguard-agent` (equivalently
`python -m vpsguard_agent`). All subcommands accept `--config PATH`.

| Command | Purpose |
|---|---|
| `run` | Run the collection loop in the foreground. This is what the systemd unit executes |
| `collect-once` | Collect one payload and print it as JSON without sending it. The fastest way to see exactly what a host reports |
| `test-config` | Load and validate the configuration, then probe the ingest endpoint (DNS, TLS, API key). Exits non-zero on failure |
| `version` | Print the agent version |

```bash
# Foreground run with verbose logging
sudo /opt/vpsguard/bin/vpsguard-agent run --config /etc/vpsguard/agent.conf

# Inspect the payload this host would send
sudo /opt/vpsguard/bin/vpsguard-agent collect-once --pretty

# Just the disk section
sudo /opt/vpsguard/bin/vpsguard-agent collect-once | python3 -c \
  'import json,sys; print(json.dumps(json.load(sys.stdin)["metrics"]["disk"], indent=2))'

# Validate configuration and connectivity
sudo /opt/vpsguard/bin/vpsguard-agent test-config

# Version
/opt/vpsguard/bin/vpsguard-agent version
```

`test-config` reports the resolved configuration with the API key masked, the
list of enabled collectors, and the result of the connectivity probe. A `405
Method Not Allowed` from the probe is a success: it proves DNS, TLS and
authentication all worked.

---

## 9. Remote commands and sandboxing

Commands are returned in the ingest response and executed immediately. Results
are posted back to `POST /api/v1/agent/commands/:id/result`.

| Command | Implementation | Notes |
|---|---|---|
| `restart_service` / `stop_service` / `start_service` | `systemctl <action> <name>` | Unit name validated against `^[A-Za-z0-9][A-Za-z0-9@._-]{0,127}$`. Runs with the agent's own privileges, because service control is impossible from an unprivileged sandbox |
| `run_script` | Script written to a `0700` temp file, executed by the requested interpreter | Sandboxed via `systemd-run --uid=<command_user> --property=MemoryMax=256M --property=CPUQuota=50%`, falling back to `su -s /bin/sh -c`. Max 64 KiB, interpreter must be an absolute path that exists |
| `cleanup_logs` | Deletes rotated logs and optionally truncates active ones, then `journalctl --vacuum-time` | Restricted to paths under `/var/log`; symlinks and paths escaping the root are refused |
| `agent_update` | `pip install --upgrade` into the agent's interpreter, then a delayed `systemctl restart` | Package specifier validated; a custom `index_url` must be HTTPS |
| `ping` | Returns `pong` | Connectivity check |

Every invocation uses an argument list (never `shell=True`), is bounded by the
effective timeout, and has its output truncated to 8 KiB. Set
`allow_commands = false` to refuse all of them.

---

## 10. Offline buffering

When the server is unreachable, the agent keeps collecting and persists each
payload to SQLite at `<state_dir>/buffer.db`.

| Behaviour | Detail |
|---|---|
| Trigger | Any delivery failure: DNS, TCP, TLS, timeout, or HTTP ≥ 400 after retries |
| Retries before buffering | 3 attempts with exponential backoff (1 s, 2 s, 4 s), applied to 408, 425, 429, 500, 502, 503 and 504 |
| Storage | SQLite in WAL mode, `synchronous=NORMAL`, one row per payload, indexed by creation time |
| Ordering | Strict FIFO — the oldest payload is replayed first, so charts backfill in order |
| Replay rate | Up to 50 buffered payloads per successful cycle, on top of the live payload |
| Size bound | `buffer_size` payloads (default 1 000). Exceeding it drops the oldest rows and logs a warning |
| Age bound | `buffer_retention_hours` (default 24). Older payloads are purged with an informational log line |
| Auth failures | HTTP 401/403 is treated as a configuration error: the agent backs off instead of hammering the endpoint, and the reason is logged |

At the default 30-second interval, 1 000 payloads is roughly 8 hours of
history. Raise `buffer_size` to `2880` for a full 24 hours at that interval:

```ini
[agent]
buffer_size = 2880
buffer_retention_hours = 24
```

Inspect the buffer:

```bash
sudo sqlite3 /var/lib/vpsguard/buffer.db 'SELECT COUNT(*), datetime(MIN(created_at),"unixepoch") FROM payloads;'
```

Clear it (discards unsent metrics):

```bash
sudo systemctl stop vpsguard-agent
sudo sqlite3 /var/lib/vpsguard/buffer.db 'DELETE FROM payloads;'
sudo systemctl start vpsguard-agent
```

---

## 11. Upgrading

### Remotely from the dashboard

Queue an `agent_update` command (**Server detail → Commands → Agent update**, or
`POST /api/v1/commands`). The agent upgrades its own package and schedules a
service restart five seconds after reporting the result.

```bash
curl -X POST https://your-host/api/v1/commands \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"serverId":"<uuid>","type":"agent_update","args":{"restart":true}}'
```

### Locally

```bash
sudo /opt/vpsguard/bin/pip install --upgrade vpsguard-agent
sudo /opt/vpsguard/bin/vpsguard-agent test-config
sudo systemctl restart vpsguard-agent
/opt/vpsguard/bin/vpsguard-agent version
```

### In Docker

```bash
docker pull vpsguard/agent:latest
docker rm -f vpsguard-agent
# re-run the docker run command from section 4
```

Configuration and the `state_dir` are never touched by an upgrade, so the
`server_id`, the buffer and `agent.conf` survive. Read the release notes before
crossing a major version.

---

## 12. Uninstalling

```bash
sudo systemctl disable --now vpsguard-agent
sudo rm -f /etc/systemd/system/vpsguard-agent.service
sudo systemctl daemon-reload

sudo rm -rf /opt/vpsguard /etc/vpsguard /var/lib/vpsguard /var/log/vpsguard
sudo userdel vpsguard
```

Docker:

```bash
docker rm -f vpsguard-agent
docker volume rm vpsguard-state
```

Then delete the server in the dashboard (**Servers → … → Delete**) so it stops
raising `agent.offline` alerts. Deleting the server also invalidates its API
key.

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Configuration file not found: /etc/vpsguard/agent.conf` | Config missing or a different path is in use | Create it, or pass `--config /path/to/agent.conf` / set `VPSGUARD_CONFIG` |
| `[server] url is required` / `must start with http:// or https://` | Empty or malformed URL | Set the full base URL, e.g. `https://monitor.example.com` (no `/api/v1`) |
| `Server rejected the API key (HTTP 401)` | Wrong key, key rotated, or server deleted | Rotate the key (**Servers → … → Rotate key**), update `api_key`, restart |
| `Server rejected the API key (HTTP 403)` | Request blocked upstream (WAF, proxy) | Check the Nginx and proxy logs on the central host |
| `POST … failed: … certificate verify failed` | Private or expired CA on the server | Install the CA on this host; only as a last resort set `verify_tls = false` |
| Agent runs but the dashboard shows *offline* | Payloads are being buffered | `journalctl -u vpsguard-agent -n 100`; check `sqlite3 /var/lib/vpsguard/buffer.db 'SELECT COUNT(*) FROM payloads;'` and the outbound firewall |
| Server flips between online and offline | `interval` exceeds `AGENT_OFFLINE_AFTER_SECONDS` on the server (120 s) | Keep `interval` well below it, or raise the server-side value |
| `slow_interval must be greater than or equal to interval` | Misordered intervals | Set `slow_interval` ≥ `interval` |
| No `docker` section | `docker` CLI missing, daemon unreachable, or the socket is not mounted in the container | Install the CLI, add the agent user to the `docker` group, or mount `/var/run/docker.sock` |
| No `services` section | `systemctl` missing (containers, Alpine) | Expected — set `services = false` to silence the warning |
| No `temperature` section | Virtualised host without sensors | Expected on most VPS. Install `lm-sensors` on bare metal |
| No `smart` section | `smartctl` missing or virtual disks | `apt install smartmontools`; virtual disks expose no SMART data |
| `Connection table requires more privileges` | Agent is not running as root | Run as root, or accept missing `connections` and `security.open_ports` |
| `No authentication log found … journalctl is unavailable` | Non-standard log location | Ensure `/var/log/auth.log` or `/var/log/secure` is readable, or install `systemd-journald` |
| `'last' is not installed` | `util-linux` trimmed from the image | Install it, or ignore — only login history is affected |
| `Offline buffer full (1000 rows), dropped …` | Long outage | Fix connectivity; raise `buffer_size` if longer outages must survive |
| `Collector 'X' failed: …` repeatedly | Environment-specific failure inside one collector | Run `collect-once` with `VPSGUARD_LOG_LEVEL=debug` for the traceback, then disable that collector in `[metrics]` if needed |
| `Remote command execution is disabled on this host` | `allow_commands = false` | Set it to `true` and restart |
| Commands return `rejected` for a valid service | Unit name failed validation, or `systemctl` is absent | Use the exact unit name (`nginx.service`); confirm systemd is present |
| High agent CPU | Very short `interval`, or `subprocess_refresh_seconds = 0` with `docker`/`services` enabled | Restore `interval = 30` and `subprocess_refresh_seconds = 60` |

Attach these three outputs to any bug report:

```bash
/opt/vpsguard/bin/vpsguard-agent version
sudo /opt/vpsguard/bin/vpsguard-agent test-config
sudo journalctl -u vpsguard-agent --since -1h --no-pager
```
