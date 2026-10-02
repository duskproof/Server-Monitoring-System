# Quick permanent setup on Ubuntu (`213.5.196.34`)

Run the full VPSGuard stack on the same Ubuntu host as the agent (no
`localhost.run` tunnel). Dashboard: `http://213.5.196.34:3010`, API:
`http://213.5.196.34:4000`.

## One-shot (already copied tree)

```bash
cd /opt/vpsguard-src/deploy   # or wherever you placed vpsguard/deploy
sudo PUBLIC_IP=213.5.196.34 DASHBOARD_PORT=3010 bash permanent-setup.sh
```

The script:

1. Installs Docker + Compose if missing  
2. Writes `deploy/.env` with `PUBLIC_API_URL=http://213.5.196.34:4000` and strong secrets  
3. Runs `docker compose up -d --build` and waits for `/api/v1/health`  
4. Points `/etc/vpsguard/agent.conf` at `http://127.0.0.1:4000` and restarts the agent  
5. Installs `lm-sensors` + `smartmontools`

## Copy code from your PC

From Windows (PowerShell), with SSH working:

```powershell
scp -r .\vpsguard root@213.5.196.34:/opt/vpsguard-src
ssh root@213.5.196.34 "cd /opt/vpsguard-src/deploy && PUBLIC_IP=213.5.196.34 DASHBOARD_PORT=3010 bash permanent-setup.sh"
```

Or with rsync/WSL:

```bash
rsync -avz --exclude node_modules --exclude .venv --exclude dist \
  ./vpsguard/ root@213.5.196.34:/opt/vpsguard-src/
```

## After first boot

1. Open `http://213.5.196.34:3010` — login `admin@vpsguard.local` / password from `.env`  
2. Confirm default alerts under **Alerts** (CPU, RAM, disk, temp, SSH, offline, SSL)  
3. Optional: set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `deploy/.env`, then  
   `docker compose up -d server`  
4. Stop the temporary Windows Docker stack — the Ubuntu host is the source of truth  

## Firewall

Open TCP `4000` and `3010` (or only `80`/`443` once you enable the nginx TLS profile).

## Agent on this host

```ini
[server]
url = http://127.0.0.1:4000
```

Other VPS agents should use `http://213.5.196.34:4000` (or HTTPS after TLS).
