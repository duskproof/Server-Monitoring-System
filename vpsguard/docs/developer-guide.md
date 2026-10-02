# VPSGuard Developer Guide

How to run the three components locally, where to put new code, and how to
ship a change.

Related documents: [Architecture](architecture.md) · [API reference](api.md)

---

## Repository layout

```
vpsguard/
├── agent/          Python 3 package `vpsguard_agent`
├── server/         NestJS 10 application (`src/` modules)
├── dashboard/      Next.js 14 App Router
├── deploy/         Docker Compose, Nginx, smoke-test.sh
├── docs/           This guide and the operator manuals
└── .github/        CI workflows
```

All user-facing strings, comments and documentation are in English.

---

## Local development

### Shared dependencies

```bash
cd vpsguard/deploy
cp .env.example .env
# fill POSTGRES_PASSWORD, INFLUX_*, JWT_* , ADMIN_PASSWORD
docker compose up -d postgres influxdb redis
```

The API then talks to `localhost:5432 / 8086 / 6379` using the values in
`server/.env`.

### Server

```bash
cd vpsguard/server
cp .env.example .env
npm install
npm run start:dev          # http://localhost:4000/api/v1
                           # Swagger: http://localhost:4000/api/v1/docs
npm test
```

`POSTGRES_SYNCHRONIZE=true` (the default in development) creates tables on
boot. Switch it off and use migrations before production.

### Dashboard

```bash
cd vpsguard/dashboard
cp .env.example .env.local
npm install
npm run dev                # http://localhost:3000
npm run typecheck
```

### Agent

```bash
cd vpsguard/agent
python -m venv .venv
.venv/bin/pip install -e ".[dev]"        # Windows: .venv\Scripts\pip
.venv/bin/python -m vpsguard_agent collect-once --config packaging/agent.conf
.venv/bin/pytest
```

`collect-once` works without a live server. `test-config` needs a reachable
ingest endpoint and a real API key.

---

## Adding a NestJS module

1. Create `server/src/<name>/` with a module, service and (if needed) controller.
2. Register the module in `app.module.ts`.
3. Protect routes by default (global `JwtAuthGuard` + `RolesGuard`). Mark
   public handlers with `@Public()` and restrict writes with `@Roles(...)`.
4. Record privileged actions through `AuditService.record(...)`.
5. Document the route in `docs/api.md` and add a Swagger decorator.

Keep ingest on the fast path: never `await` alert evaluation or notification
I/O in `IngestService.ingest`.

---

## Adding an agent collector

1. Subclass `BaseCollector` in `agent/vpsguard_agent/collectors/<name>.py`.
   Set `name` and `tier` (`fast` or `slow`). `collect()` must return a JSON-able
   value or raise — the scheduler catches exceptions and omits the key.
2. Register the class in `collectors/__init__.py`.
3. Add a `[metrics]` flag in `config.py` (`METRIC_KEYS`) and `packaging/agent.conf`.
4. If the value is numeric and should be alertable, add it to:
   - `server/src/alerts/metric-extractor.ts` (`extractMetric`)
   - `server/src/influx/influx.service.ts` (`METRIC_MAP` and `writeMetrics`)
   - the dashboard alert-rule metric dropdown (`lib/metrics.ts`)
5. Cover the collector with a mocked unit test in `agent/tests/test_collectors.py`.

Do not spawn subprocesses on the fast path. Cache `psutil` handles and compute
CPU / network rates from the previous sample.

---

## Dashboard conventions

- Server state lives in React Query (`hooks/queries.ts`); auth and theme live
  in Zustand (`store/`).
- All HTTP goes through `lib/api.ts` so 401 → refresh is handled once.
- Socket.IO is a singleton (`lib/socket.ts`). Subscribe in `hooks/useSocket.ts`.
- UI kit is in `components/ui/`; feature views own their tabs and modals.
- Verify UI changes in the browser (login, the touched page, a neighbouring
  page that shares the same state).

---

## Testing

| Area | Command | Notes |
|---|---|---|
| Agent | `pytest` | No Linux required; `psutil` / `subprocess` are mocked |
| Server | `npm test` | `metric-extractor.spec.ts` runs without Docker |
| Server + stack | `deploy/smoke-test.sh` | Needs a running Compose stack |
| Dashboard | `npm run typecheck` && `npm run lint` | No component test runner yet |

CI (`.github/workflows/ci.yml` at the repository root) runs the agent matrix, server lint/test/build,
dashboard typecheck/lint/build, then a Docker image build.

---

## Code style

- TypeScript: NestJS + Next.js defaults, no `any` on API boundaries.
- Python: 4-space indent, type hints on public functions, no bare `except`.
- Do not commit `.env`, keys, or `deploy/nginx/certs/`.
- Comments explain *why*, not what the next line does.

---

## Git / PR workflow

1. Branch from `main` (`feat/…`, `fix/…`).
2. Keep the diff scoped — agent, server and dashboard can land in one PR when
   the contract changes, otherwise split them.
3. CI must be green. Include a Test plan in the PR body (the smoke-test
   checklist is a good start).
4. Do not force-push `main`.

---

## Release checklist

- [ ] Version bump in `agent/pyproject.toml`, `server/package.json`, `dashboard/package.json`
- [ ] `INFLUX_RETENTION` still ≥ 30 days
- [ ] Default alert rules still cover CPU, memory, disk, agent offline, SSL
- [ ] `deploy/smoke-test.sh` passes against the candidate image
- [ ] `docs/api.md` matches Swagger at `/api/v1/docs`
- [ ] Agent install one-liner still serves `/install.sh`
- [ ] Secrets in `.env.example` have no real values
