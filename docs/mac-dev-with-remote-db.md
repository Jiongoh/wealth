# Mac Development With Remote PostgreSQL

This project supports a split setup where the Linux VPS keeps the production
PostgreSQL data directory and the Mac runs local development services from a
fresh GitHub clone.

## Target Shape

- Linux VPS keeps `./data/postgres` and can still run the production Docker
  Compose deployment.
- Mac runs `frontend`, `backend`, and optional workers locally.
- Mac connects to PostgreSQL through an SSH tunnel, not a public database port.
- Linux `.env` and Mac `.env` are separate private files. Do not commit either
  file or copy secrets into Git.

## Linux PostgreSQL

The production `docker-compose.yml` does not publish PostgreSQL to the host. It
keeps the database internal to the Compose network, while the reverse proxy is
the only published application entrypoint.

For a future database-only VPS mode, use `docker-compose.db.yml`:

```bash
docker compose -f docker-compose.db.yml up -d postgres
```

This file reuses the existing bind mount:

```text
./data/postgres:/var/lib/postgresql/data
```

It also binds PostgreSQL only to loopback by default:

```text
127.0.0.1:5432
```

Do not run the full stack and the database-only compose file as separate
database instances at the same time. Use the database-only file when the VPS is
meant to keep PostgreSQL available for SSH tunnel access without running the
full application stack.

If port `5432` is already used on the VPS, choose another loopback port:

```bash
POSTGRES_HOST_PORT=15432 docker compose -f docker-compose.db.yml up -d postgres
```

## SSH Tunnel From Mac

Create a local tunnel from the Mac to the VPS:

```bash
ssh -L 5433:127.0.0.1:5432 root@server
```

Keep this SSH session open while the Mac backend or migration commands are
using the remote database. Replace `server` with the VPS hostname or IP.

If the VPS uses `POSTGRES_HOST_PORT=15432`, tunnel to that port instead:

```bash
ssh -L 5433:127.0.0.1:15432 root@server
```

## Mac `.env`

Create a Mac-local `.env` from `.env.example`, then set `DATABASE_URL` to the
local tunnel endpoint:

```text
DATABASE_URL=postgresql+psycopg://<db-user>:<db-password>@127.0.0.1:5433/<db-name>
```

Use the same database name, user, and password that the VPS PostgreSQL expects,
but keep those values only in the private Mac `.env`.

For local frontend development, keep same-origin API behavior unless you
intentionally run frontend and backend separately:

```text
NEXT_PUBLIC_API_BASE_URL=/api
```

## Schema Changes

Do not edit PostgreSQL physical files under `data/postgres`, including `pg_wal`.
Schema changes should be represented in Alembic migrations under
`backend/alembic/versions/`, reviewed in Git, and applied with `alembic upgrade
head`.

When working from the Mac against the tunneled remote database, be especially
careful with migration commands because they affect the VPS database.

## Production Deployments

Production deployment remains Linux-side:

```bash
git pull
docker compose up -d --build
docker compose exec backend alembic upgrade head
```

Run the migration command only after reviewing the migration files being
deployed. Do not use `docker compose down -v` for this project because that
would remove Docker-managed volumes in other configurations, and it is not
needed for normal deployment.
