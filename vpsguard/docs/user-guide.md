# VPSGuard User Guide

Day-to-day operator documentation for the web dashboard. For installation see
[Agent installation](agent-installation.md) and
[Server deployment](server-deployment.md).

---

## First login

1. Open the dashboard URL (http://localhost:3000 in a default Compose stack).
2. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `deploy/.env`.
3. Open **Settings → Profile** and change the password immediately.

The first registered account is always an admin. Later accounts default to
`viewer` unless an admin creates them with a different role.

| Role | Can |
|---|---|
| Viewer | Read dashboards, metrics, alerts |
| Operator | Everything a viewer can, plus add servers, edit rules, run commands, open the terminal, acknowledge alerts |
| Admin | Everything, plus users, API-key rotation, deletions and the audit log |

---

## Add a server and install the agent

1. **Servers → Add server**. Give it a name and optional group.
2. Copy the API key (it is shown **once**) and the install command.
3. On the VPS, run:

```bash
curl -fsSL https://your-vpsguard-host/install.sh | sudo bash -s -- \
  --url https://your-vpsguard-host \
  --api-key vg_your_generated_key
```

4. Within about 60 seconds the row turns **online** and CPU / RAM / disk fill in.

If the host stays offline, run `sudo python3 -m vpsguard_agent test-config` on
it and check that outbound HTTPS to the server is allowed.

---

## Overview

The home page shows fleet counts (total / online / offline), firing alerts,
average CPU / RAM / disk gauges, a live alert feed and a sparkline per server.
Numbers update over WebSocket; a full refresh is not required.

Use **Export report** in the top bar for a CSV or PDF of the current period.

---

## Servers list

Columns: name, IP, status, CPU %, RAM %, disk %, group, last seen.

- Search and filter by group or status.
- **Details** opens the server page.
- **Terminal** jumps straight to the web SSH tab (operator/admin).
- **Delete** is admin-only and cannot be undone.

---

## Server detail

Header: status, hostname, uptime, agent version.

| Tab | What you see | What you can do |
|---|---|---|
| Overview | CPU, RAM, network, disk I/O charts | 1 h / 6 h / 24 h / 7 d / 30 d range, drag-zoom, PNG/CSV export |
| Processes | Top processes by CPU and memory | Sort columns |
| Docker | Container cards with CPU, RAM, net, block I/O | Restart a container (queues `restart_service` / Docker command) |
| Logs | Latest pattern matches | Filter by file and pattern |
| Services | systemd units | Start / stop / restart (queued to the agent) |
| Temperatures | Sensor gauges | — |
| SSL | Certificates with days-left badges | — |
| Terminal | xterm.js over WebSocket → SSH | Typed commands are written to the audit log |

Charts append live samples from Socket.IO instead of refetching the whole series.

---

## Alerts

Three lists: **Active** (firing), **Acknowledged**, **History** (resolved).

- Filter by severity and server.
- **Acknowledge** silences repeats for operators who are already looking at it.
  The alert still auto-resolves when the condition clears.
- **Alert rules** at the bottom of the page: create, edit, disable, delete.

### Worked examples

CPU > 90 % for one minute, Telegram, restart nginx if it keeps firing:

| Field | Value |
|---|---|
| Metric | `cpu.percent` |
| Condition | `>` |
| Threshold | `90` |
| Duration | `60` seconds |
| Severity | `critical` |
| Channels | `telegram` |
| Self-heal | `{ "type": "restart_service", "args": { "name": "nginx" } }` |

Disk projected to fill within 3 days (seeded by default as
`disk.forecast_days < 3`).

SSL: `ssl.days_left < 30` (also seeded). Tighten to 14 / 7 / 1 with extra rules.

Agent down: `agent.offline == 1` (heartbeat miss, default 120 seconds).

---

## Notifications

**Settings → Integrations**. Each channel has a **Send test** button.

| Channel | What you need |
|---|---|
| Telegram | Bot token from [@BotFather](https://t.me/BotFather) and a chat ID |
| Slack | Incoming webhook URL |
| Email | SMTP host, port, credentials, from, recipients |
| Webhook | Any HTTPS URL; VPSGuard POSTs the alert JSON |

Environment variables in `deploy/.env` (`TELEGRAM_BOT_TOKEN`, …) work as
fallback when no integration row is saved.

---

## Users, groups, roles

**Settings → Users** (admin): create accounts, change roles, deactivate.
Changing a password or role revokes that user's refresh token.

**Settings → Groups**: `prod`, `staging`, `dev`, or anything else. Servers
inherit the group; alert rules can target a group instead of a single host.

---

## Reports

From the overview (or `GET /api/v1/reports`) export JSON, CSV or PDF covering
average CPU / RAM, peak disk and alert counts per server for a chosen window
(`-1h`, `-24h`, `-7d`).

---

## Web terminal

Requires operator or admin, a known server IP, and `SSH_PRIVATE_KEY` on the
API process. VPSGuard never stores SSH passwords. Close the tab (or navigate
away) to tear the session down; input is audited.

---

## Common tasks

| Task | Where |
|---|---|
| Add a VPS | Servers → Add server, then run the install command |
| Mute a noisy alert | Alerts → Acknowledge, or disable the rule |
| Restart nginx on a host | Server detail → Services → Restart, or Alerts → self-heal |
| Rotate a leaked agent key | Server detail (admin) → rotate key, then update `agent.conf` |
| Invite a colleague | Settings → Users → create, pick a role |
| Dark / light theme | Settings → Profile, or the sun/moon control |
| Check “did anyone run a command?” | Settings → Audit log |
