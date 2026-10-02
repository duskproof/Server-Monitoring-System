# VPSGuard Dashboard

Next.js 14 (App Router) operator UI for the VPSGuard monitoring platform.
Dark-first, responsive, installable as a PWA. Talks to the NestJS API over REST
and Socket.IO.

---

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Opens on http://localhost:3000. Point `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_WS_URL` at a running [server](../server/README.md) (default
`http://localhost:4000`).

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server on port 3000 |
| `npm run build` | Production build (`output: 'standalone'`) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

---

## Environment

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | REST API origin (no trailing slash) |
| `NEXT_PUBLIC_WS_URL` | `http://localhost:4000` | Socket.IO origin |

Public variables are inlined at **build** time. When building the Docker image,
pass them as `--build-arg`.

---

## Pages

| Route | Contents |
|---|---|
| `/login`, `/register` | Authentication |
| `/` | Fleet overview, gauges, recent alerts, per-server sparklines |
| `/servers` | Filterable server table, add-server modal with one-time API key |
| `/servers/[id]` | Detail tabs: Overview, Processes, Docker, Logs, Services, Temperatures, SSL, Terminal |
| `/alerts` | Active / acknowledged / history plus alert-rule CRUD |
| `/settings` | Profile, users, groups, integrations, audit log |

Unauthenticated visitors are redirected to `/login` by `middleware.ts`.

---

## Project structure

```
app/                 App Router pages and layouts
components/          Feature views and reusable UI kit
hooks/               React Query hooks and Socket.IO subscriptions
lib/                 API client, types, formatters, socket singleton
store/               Zustand stores (auth, UI/theme)
public/              PWA icons and manifest
```

---

## Docker

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://monitor.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=https://monitor.example.com \
  -t vpsguard/dashboard:1.0.0 .
```

The image uses Next.js standalone output and runs as a non-root user on port 3000.

See [docs/user-guide.md](../docs/user-guide.md) for operator documentation.
