# ibkr-sync

`ibkr-sync` is a personal IBKR wealth dashboard. It downloads IBKR Flex XML, archives the
unchanged source files, parses portfolio data into PostgreSQL, exposes the data through
FastAPI, and renders a warm Next.js dashboard.

This project intentionally does **not** use Grafana anymore. PostgreSQL is the primary
database, while raw XML remains the reconstructable source of truth. The Web frontend reads
data only through FastAPI. A future iOS app should follow the same boundary and use FastAPI
instead of connecting directly to PostgreSQL.

## Tech Stack

- Backend: FastAPI, SQLAlchemy, Alembic, APScheduler
- Database: PostgreSQL 17
- Frontend: Next.js App Router, React, TypeScript, plain CSS, Recharts
- Runtime: Docker Compose
- Reverse proxy: Nginx, same-origin `/api` routing
- Data source: IBKR Flex Web Service v3

No Grafana, SQLite, Kubernetes, Celery, Redis, Kafka, or TimescaleDB is required for the
current architecture.

## Directory Structure

```text
backend/                 FastAPI application
  app/
    api/                 HTTP routes
    core/                settings, logging, error handling
    db/                  SQLAlchemy base and session management
    models/              database models
    schemas/             API response schemas
    services/            IBKR client, XML archive, parser, sync, analysis
  alembic/               database migrations
frontend/                Next.js App Router frontend
  app/                   routes and global styles
  components/            dashboard views and shared UI components
  lib/api.ts             browser API client, default base URL is /api
deploy/nginx/            reverse-proxy configuration
storage/raw_xml/         archived raw IBKR Flex XML files
storage/logs/            reserved application logs
data/postgres/           local PostgreSQL data volume, created at runtime
docker-compose.yml       postgres, backend, frontend, reverse-proxy
.env.example             non-secret environment template
```

## Environment Variables

Create local configuration from the template:

```bash
cp .env.example .env
```

Required for the stack:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB` | PostgreSQL database name. |
| `POSTGRES_USER` | PostgreSQL user. |
| `POSTGRES_PASSWORD` | PostgreSQL password. Keep private. |
| `DATABASE_URL` | SQLAlchemy URL used by FastAPI, for example pointing at Compose service `postgres`. |

Application settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `ibkr-sync` | FastAPI app name. |
| `APP_VERSION` | `0.1.0` | Version returned by `/api/version`. |
| `LOG_LEVEL` | `INFO` | Backend logging level. |
| `CORS_ORIGINS` | local Next.js origins | Only needed for separate local frontend dev. Production uses same-origin `/api`. |
| `APP_TIMEZONE` | `Asia/Taipei` | Timezone for scheduled sync. |
| `SYNC_CRON_HOUR` | `8` | Daily sync hour in `APP_TIMEZONE`. |
| `SYNC_CRON_MINUTE` | `30` | Daily sync minute in `APP_TIMEZONE`. |
| `RAW_XML_DIR` | `/app/storage/raw_xml` | Container path for archived raw XML. |
| `NEXT_PUBLIC_API_BASE_URL` | `/api` | Frontend API base URL. Keep `/api` for same-origin deployment. |

Market data settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARKET_DATA_PROVIDER` | empty | Set to `alpaca` when enabling the future market data worker. |
| `ALPACA_API_KEY_ID` | empty | Alpaca market data API key ID. Keep only in private `.env`; do not commit. |
| `ALPACA_API_SECRET_KEY` | empty | Alpaca market data API secret. Keep only in private `.env`; do not commit. |
| `ALPACA_FEED_MODE` | `auto` | Alpaca feed selection for future market data use: `auto`, `iex`, or `overnight`. |
| `ALPACA_MAX_SYMBOLS` | `30` | Maximum watchlist symbols for future market data subscriptions. |

IBKR Flex settings:

| Variable | Purpose |
| --- | --- |
| `IBKR_FLEX_URL` | IBKR Flex Web Service base URL or SendRequest endpoint. |
| `IBKR_FLEX_VERSION` | Flex Web Service version, currently `3`. |
| `IBKR_REQUEST_TIMEOUT_SECONDS` | HTTP request timeout. |
| `IBKR_STATEMENT_POLL_SECONDS` | Poll interval while IBKR generates a statement. |
| `IBKR_STATEMENT_POLL_ATTEMPTS` | Maximum statement polling attempts. |
| `IBKR_TOKEN` | Real Flex Web Service token. Keep only in private `.env`; do not commit. |
| `IBKR_QUERY_ID` | Real Flex Query ID. Keep only in private `.env`; do not commit. |

`.env.example` intentionally does not include real credentials or passwords.

## Docker Compose Startup

Start or rebuild the stack:

```bash
docker compose up --build -d
```

Check services:

```bash
docker compose ps
```

The default deployment exposes only the reverse proxy on host loopback:

```text
http://127.0.0.1:8080
```

`backend:8000`, `frontend:3000`, and `postgres:5432` are internal Docker services. They are
not published directly to the public network.

Stop the stack:

```bash
docker compose down
```

PostgreSQL data remains in `./data/postgres` unless that directory is manually removed.

## Database Migrations

FastAPI startup does not create or migrate tables automatically. Apply migrations explicitly:

```bash
docker compose exec backend alembic upgrade head
```

Check the current revision:

```bash
docker compose exec backend alembic current
```

Create a new migration after model changes:

```bash
docker compose exec backend alembic revision --autogenerate -m "describe change"
```

Then review the generated file before applying it.

## IBKR Flex Query Sections

The Flex Query must include these sections so the parser can populate the current dashboard:

| IBKR Flex section | Parsed into |
| --- | --- |
| `OpenPositions/OpenPosition` with `levelOfDetail="LOT"` | `positions_lot` and lot analysis |
| `Trades/Trade` | `trades` |
| `CashReport/CashReportCurrency` | `cash_report` |
| `CashTransactions/CashTransaction` and Deposits & Withdrawals details | `cash_activities` |
| `EquitySummaryInBase/EquitySummaryByReportDateInBase` | `nav_daily` |

Recommended Flex Query behavior:

- Enable open positions at lot detail, not only summary detail.
- Include trades with enough detail for executions, closed lots, commissions, and realized P&L.
- Include cash report by currency.
- Include Cash Transactions / Deposits & Withdrawals details for real cash movement rows.
  Without this section, deposits and withdrawals cannot be reconstructed from balance snapshots;
  the Cash page can still show FX conversions derived from Forex/Cash trades and non-zero
  CashReport summary movements.
- Include NAV/equity summary in base currency.
- Use Flex Web Service v3 and keep the token/query ID private.

Blank optional values are stored as `null`; numeric values are stored as fixed-precision
PostgreSQL `NUMERIC(28, 10)`.

## Manual Sync

Manual sync uses the real configured IBKR Flex service:

```bash
curl -X POST http://127.0.0.1:8080/api/sync/run
```

The endpoint performs:

1. SendRequest to IBKR.
2. Poll GetStatement until the report is ready.
3. Archive the raw XML under `storage/raw_xml/`.
4. Deduplicate by SHA-256.
5. Parse supported sections.
6. Replace rows belonging to that source report.
7. Rebuild lot analysis.
8. Record the sync run.

Possible run statuses:

| Status | Meaning |
| --- | --- |
| `success` | New XML was archived and ingested. |
| `duplicate` | XML already existed; source rows are safely rebuilt without duplicate raw archive rows. |
| `failed` | Download, parse, ingestion, or analysis failed; the error is recorded in `sync_runs`. |
| HTTP `409` | Another sync is already running. The frontend shows `同步正在进行中`. |

The Sync page at `/sync` calls the same endpoints:

- `GET /api/sync/status`
- `POST /api/sync/run`

The frontend must not display the IBKR token. Backend logging also redacts token values.

## API Access

Health check:

```bash
curl http://127.0.0.1:8080/api/health
```

Version:

```bash
curl http://127.0.0.1:8080/api/version
```

Main API endpoints:

| Endpoint | Description |
| --- | --- |
| `GET /api/portfolio/summary` | Latest portfolio summary. |
| `GET /api/portfolio/nav/history?start_date=&end_date=` | NAV history. |
| `GET /api/positions/current` | Current positions. |
| `GET /api/positions/lots?symbol=` | Open lots, optionally filtered by symbol. |
| `GET /api/positions/lots/analysis` | Lot analysis. |
| `GET /api/trades?symbol=&start_date=&end_date=` | Security trades with total/buy/sell counts. FX conversions are excluded. |
| `GET /api/cash/history?start_date=&end_date=&currency=` | Cash history by date range and optional currency. |
| `GET /api/cash/balances/timeseries?start_date=&end_date=&currency=` | Normalized daily cash balance series, one line per currency. |
| `GET /api/cash/activities?start_date=&end_date=&currency=&activity_type=` | Non-zero cash movements such as deposits, withdrawals, FX conversions, dividends, interest, fees, and taxes. |
| `GET /api/sync/status` | Latest sync and raw report metadata. |
| `POST /api/sync/run` | Trigger manual sync. |

List endpoints return `[]` when there is no matching data. `GET /api/portfolio/summary`
returns `null` when no NAV data exists. Date ranges are inclusive. Reversed date ranges return
HTTP `422`.

FastAPI OpenAPI is available inside the backend service. To print it without exposing backend
ports:

```bash
docker compose exec backend python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=2))"
```

The public/reverse-proxy path intentionally exposes application API under `/api/*`; it does
not expose a separate public backend port.

## Frontend Access

Integrated local or tunnel-backed access:

```text
http://127.0.0.1:8080
https://your-domain.example.com
```

The frontend routes are:

- `/` Dashboard
- `/positions`
- `/lots`
- `/trades`
- `/cash`
- `/sync`

The frontend API client is `frontend/lib/api.ts`. Its default base URL is `/api`, so browser
requests stay same-origin and pass through Nginx to FastAPI. Do not set it to
`localhost:8000` for production builds.

For local Next.js-only development:

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE_URL=/api npm run dev
```

Use the full Compose entrypoint `http://127.0.0.1:8080` for integrated verification.

## Reverse Proxy And Public Deployment

The intended production routing model is a single public origin:

```text
https://your-domain.example.com        -> reverse-proxy -> frontend:3000
https://your-domain.example.com/api/*  -> reverse-proxy -> backend:8000/api/*
```

When `cloudflared` runs on the host, route it to:

```text
http://127.0.0.1:8080
```

If `cloudflared` is later moved into the Compose network, route it to:

```text
http://reverse-proxy:80
```

Do not expose PostgreSQL, backend, or frontend service ports directly to the public internet.
Cloudflare Access is recommended for the public hostname.

## Raw XML Archive

Raw XML files are archived under:

```text
storage/raw_xml/
```

Inside the backend container this is:

```text
/app/storage/raw_xml
```

Every first-seen XML payload is stored unchanged and indexed by SHA-256 in
`raw_flex_reports`. Duplicate XML does not create a second raw archive row. Because raw XML is
the reconstructable source data, preserve `storage/raw_xml/` before any cleanup, migration, or
database rebuild.

Business tables are derived from raw XML:

- `positions_lot`
- `trades`
- `cash_report`
- `nav_daily`
- `lot_analysis_daily`

If derived data needs to be rebuilt, use the archived XML as the source rather than inventing
manual database rows.

## Troubleshooting

### Frontend loads but API calls fail

Check the reverse proxy health endpoint:

```bash
curl -i http://127.0.0.1:8080/api/health
```

Confirm frontend builds use same-origin API:

```bash
rg -n "NEXT_PUBLIC_API_BASE_URL|localhost:8000" frontend .env docker-compose.yml
```

For production, `NEXT_PUBLIC_API_BASE_URL` should be `/api`.

### Public domain still shows an old page

Rebuild and restart the frontend and reverse proxy:

```bash
docker compose up --build -d frontend reverse-proxy
```

Then verify:

```bash
curl -i https://your-domain.example.com/
```

### Database tables are missing

Run migrations:

```bash
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current
```

### Manual sync returns missing IBKR configuration

Add the private Flex Web Service token and query ID to local `.env`, then restart backend:

```bash
docker compose up -d backend
```

Do not commit the token, query ID, database password, or tunnel credentials.

### Manual sync returns busy

Another manual or scheduled sync is holding the in-process lock. Wait and retry:

```bash
curl http://127.0.0.1:8080/api/sync/status
```

The frontend shows `同步正在进行中` for this case.

### IBKR says the statement cannot be generated

This is an upstream IBKR Flex response. Wait a few minutes and run manual sync again. Also
verify the Flex Query is active and includes the required sections.

### Sync succeeds but dashboard is empty

Check that the Flex Query includes the required sections and that rows exist:

```bash
curl http://127.0.0.1:8080/api/portfolio/summary
curl http://127.0.0.1:8080/api/positions/current
curl http://127.0.0.1:8080/api/cash/balances/timeseries
```

If raw XML exists but derived tables are empty, inspect backend logs:

```bash
docker compose logs --tail=120 backend
```

### Token leakage concern

IBKR uses token-bearing query parameters. Backend code suppresses noisy HTTP client URL logs
and redacts the configured token from failure messages. Do not enable verbose HTTP client logs
in production.

### Need to preserve or move the system

Back up at least:

```text
.env
data/postgres/
storage/raw_xml/
```

`storage/raw_xml/` is especially important because it is the raw source needed to reconstruct
derived portfolio data.
