# VPSGuard Agent

Lightweight Python 3 daemon that samples a Linux VPS and ships metrics to the
central VPSGuard server over HTTPS. When the server is unreachable, payloads are
buffered in SQLite (up to 24 hours) and replayed in order.

Typical footprint: under 1 % CPU and 50 MB RAM.

---

## One-line install (Ubuntu 20.04+ / Debian / CentOS / AlmaLinux / Rocky)

Register the host in the dashboard first (**Servers → Add server**) and copy the
API key — it is shown exactly once.

```bash
curl -fsSL https://your-vpsguard-host/install.sh | sudo bash -s -- \
  --url https://your-vpsguard-host \
  --api-key vg_your_generated_key
```

The installer creates the `vpsguard` system user, a venv at `/opt/vpsguard`,
writes `/etc/vpsguard/agent.conf` with mode `0600`, enables the systemd unit and
runs `test-config`.

Uninstall:

```bash
curl -fsSL https://your-vpsguard-host/install.sh | sudo bash -s -- --uninstall
```

---

## Manual install

```bash
sudo python3 -m venv /opt/vpsguard
sudo /opt/vpsguard/bin/pip install -e /path/to/vpsguard/agent
sudo mkdir -p /etc/vpsguard /var/lib/vpsguard /var/log/vpsguard
sudo cp packaging/agent.conf /etc/vpsguard/agent.conf
sudo chmod 600 /etc/vpsguard/agent.conf
# edit url + api_key
sudo cp packaging/vpsguard-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vpsguard-agent
```

---

## Docker

The agent reports whatever it can see, so the container needs host namespaces
and a few bind mounts:

```bash
docker build -t vpsguard/agent:1.0.0 .
docker run -d --name vpsguard-agent \
  --restart unless-stopped \
  --pid host \
  --network host \
  -e VPSGUARD_URL=https://monitor.example.com \
  -e VPSGUARD_API_KEY=vg_your_generated_key \
  -v /proc:/host/proc:ro \
  -v /sys:/host/sys:ro \
  -v /etc/os-release:/etc/os-release:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/log:/var/log:ro \
  -v vpsguard-state:/var/lib/vpsguard \
  -e PSUTIL_PROCFS_PATH=/host/proc \
  vpsguard/agent:1.0.0
```

Not available in a container without extra privileges: systemd services, SMART
and firewall state. Those collectors log a warning and are omitted.

---

## Configuration

Default path: `/etc/vpsguard/agent.conf`. Override with `--config` or
`VPSGUARD_CONFIG`. Full reference: [docs/agent-installation.md](../docs/agent-installation.md).

Environment overrides:

| Variable | Maps to |
|---|---|
| `VPSGUARD_URL` | `[server] url` |
| `VPSGUARD_API_KEY` | `[server] api_key` |
| `VPSGUARD_INTERVAL` | `[agent] interval` |
| `VPSGUARD_LOG_LEVEL` | `[agent] log_level` |
| `VPSGUARD_CONFIG` | config file path |

---

## CLI

```bash
python -m vpsguard_agent run                 # collection loop (default)
python -m vpsguard_agent collect-once        # print one payload as JSON
python -m vpsguard_agent test-config         # validate config + connectivity
python -m vpsguard_agent version
```

Global flags: `--config PATH`, `--log-level LEVEL`.

---

## Collection tiers

| Tier | Interval (default) | Collectors |
|---|---|---|
| Fast | 30 s | CPU, memory, disk, network, processes, connections, Docker, systemd, uptime |
| Slow | 300 s | temperatures, SMART, SSL, log patterns, security |

Slow-tier results are cached and merged into every outgoing packet.

---

## Development

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
```

Tests mock `psutil` and `subprocess`, so they pass on Windows.

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| `401/403` from ingest | Rotate the API key in the dashboard and update `agent.conf` |
| Metrics missing a section | The matching collector's tool is absent (`docker`, `smartctl`, `sensors`) — look for a warning in the journal |
| Buffer growing | Server URL, TLS, or outbound HTTPS is blocked |
| High CPU | Confirm `interval` is not set below 10 s |

Logs: `journalctl -u vpsguard-agent -f`
