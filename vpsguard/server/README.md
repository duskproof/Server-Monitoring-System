# VPSGuard Server

Central server for the VPSGuard monitoring platform: metrics ingestion, storage, alert
evaluation, notifications, remote command dispatch and the realtime WebSocket channel.

Built with NestJS 10, PostgreSQL, InfluxDB 2.x, Redis and Socket.IO.

---

## Running locally

```bash
npm install
cp .env.example .env      # then fill in the values
npm run start:dev
```

The API listens on `http://localhost:4000/api/v1` and Swagger UI is served at
`http://localhost:4000/api/v1/docs`.

Dependencies can be started on their own while you develop the server natively:

```bash
cd ../deploy
docker compose up -d postgres influxdb redis
```

On first boot the server bootstraps an admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
(defaults `admin@vpsguard.local` / `ChangeMe123!`) and seeds the default alert rules.

---

## Module map

| Module | Responsibility |
|---|---|
| `auth` | Login, registration, JWT access/refresh tokens, revocation |
| `users` | User CRUD and role assignment (admin only) |
| `servers` | Server registry, API key generation and rotation, fleet overview |
| `groups` | Server grouping (prod / staging / dev) |
| `ingest` | `POST /ingest` — validates agent packets, writes metrics, returns pending commands |
| `influx` | InfluxDB write batching, Flux queries, linear-regression forecasting |
| `metrics` | Time-series queries and the document-style detail tabs |
| `alerts` | Alert rules, alert lifecycle, and the evaluation engine |
| `notifications` | Telegram, Slack, Email and Webhook delivery |
| `commands` | Queueing, claiming and result recording for agent commands |
| `realtime` | Socket.IO gateway for live metrics, alerts and the SSH web terminal |
| `scheduler` | Heartbeat/offline detection, command expiry, predictive disk alerts |
| `reports` | JSON, CSV and PDF infrastructure reports |
| `audit` | Audit trail for every privileged action |

---

## Request lifecycle for ingestion

1. `ApiKeyGuard` resolves `X-API-Key` (or `api_key` in the body) to a server. Candidates are
   narrowed by key prefix before the bcrypt comparison, so the lookup stays cheap.
2. `IngestService` writes the packet to InfluxDB through a batched writer.
3. The server row is updated with a flattened numeric snapshot (`latest_metrics`) for fast
   list rendering, plus the document-style sections (`raw_snapshot`) used by the detail tabs.
4. Metrics are broadcast to every dashboard subscribed to that server.
5. Alert rules are evaluated off the critical path — a failure there can never fail ingestion.
6. Any pending commands are claimed and returned to the agent in the response.

---

## Security

- Access tokens expire after 15 minutes; refresh tokens are stored hashed and revoked on
  logout, password change, role change or deactivation.
- Agent API keys are never stored in plaintext and are displayed only once at creation.
- All routes are guarded by default (`JwtAuthGuard` + `RolesGuard`); public routes opt out
  explicitly with `@Public()`.
- Rate limiting defaults to 300 requests per minute; `/ingest` opts out via `@SkipThrottle()`
  because agents poll on a fixed schedule and are already authenticated.
- Helmet sets the standard security headers, and validation strips unknown properties
  everywhere except the free-form `metrics` object.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run start:dev` | Development server with hot reload |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled server |
| `npm test` | Unit tests |
| `npm run lint` | ESLint with autofix |
| `npm run migration:generate -- src/database/migrations/Name` | Generate a migration |
| `npm run migration:run` | Apply pending migrations |

`POSTGRES_SYNCHRONIZE=true` is convenient for development. Set it to `false` in production
and manage the schema with migrations instead.
