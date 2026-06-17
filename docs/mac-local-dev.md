# Mac Local Development

This guide sets up a Mac mini as the main development and build machine while PostgreSQL and production data stay on the Linux VPS.

## Architecture

- Run frontend, backend, and optional workers on the Mac.
- Keep PostgreSQL on Linux.
- Connect from the Mac through an SSH tunnel:

```bash
ssh -L 5433:127.0.0.1:5432 root@<your-vps-ip>
```

- Use GitHub as the code synchronization point.
- Keep `.env` and `.env.local` local only. Do not commit secrets.

## 1. Clone On The Mac

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/Jiongoh/wealth.git
cd wealth
```

## 2. Create Local Environment

Use the Mac template:

```bash
cp .env.mac.example .env
```

Then edit `.env` locally. Copy only the variables you need from the Linux production environment by hand. Do not paste secrets into Git, chat, docs, tickets, or commit messages.

The Mac database URL should point at the local tunnel:

```text
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5433/DB_NAME
```

For normal Mac development, keep automatic jobs disabled:

```text
ENABLE_SYNC_SCHEDULER=false
MARKET_DATA_PROVIDER=
YAHOO_FALLBACK_WRITE_CANDLES=false
```

## 3. Start The SSH Tunnel

Run this in a dedicated terminal and keep it open:

```bash
ssh -L 5433:127.0.0.1:5432 root@<your-vps-ip>
```

This maps:

```text
Mac 127.0.0.1:5433 -> Linux 127.0.0.1:5432
```

Do not run database reset, rebuild, or volume deletion commands against this connection.

## 4. Native Backend

```bash
cd ~/Projects/wealth/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
set -a
source ../.env
set +a
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Confirm the backend is alive:

```bash
curl -fsS http://127.0.0.1:8000/api/health
```

Confirm it can read through the database connection with a safe read-only endpoint:

```bash
curl -fsS http://127.0.0.1:8000/api/version
curl -fsS http://127.0.0.1:8000/api/portfolio/summary
```

`/api/version` does not require the database. `/api/portfolio/summary` is a read endpoint and is a better database connectivity check.

## 5. Native Frontend

In another terminal:

```bash
cd ~/Projects/wealth/frontend
npm install
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## 6. Optional Docker Development

The production `docker-compose.yml` starts PostgreSQL and workers, so do not use it for Mac development against the production database.

Use the dev compose file only after `.env` exists and the SSH tunnel is running:

```bash
docker compose -f docker-compose.dev.yml up --build backend frontend
```

The dev compose file does not start PostgreSQL. It also sets `ENABLE_SYNC_SCHEDULER=false` by default and places `market-data-worker` behind the `workers` profile.

On Docker Desktop for Mac, containers may not be able to reach a host tunnel through `127.0.0.1`. If the native flow works but Docker backend cannot connect to PostgreSQL, set a private local-only override in `.env`:

```text
DATABASE_URL=postgresql://USER:PASSWORD@host.docker.internal:5433/DB_NAME
```

Do not commit that file.

Only enable the worker manually when you explicitly intend to write market data:

```bash
docker compose -f docker-compose.dev.yml --profile workers up --build market-data-worker
```

## 7. Commit And Push From The Mac

Before committing:

```bash
git status --short
git diff
```

Make sure no `.env`, `.env.local`, database data, logs, raw storage, `.next`, `node_modules`, or virtualenv files are staged.

Then:

```bash
git add README.md docs .env.example .env.mac.example docker-compose.dev.yml backend/app backend/tests .gitignore
git commit -m "Add Mac local development setup"
git push origin main
```

Use the current branch name instead of `main` if you are working on a feature branch.

## 8. Pull And Redeploy On Linux

On Linux, after reviewing the pushed changes:

```bash
cd /root/wealth
git status --short
git pull --ff-only
docker compose build backend frontend
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/api/health
```

Run migrations only when a reviewed migration file requires it:

```bash
docker compose exec backend alembic upgrade head
```

## Safety Rules

- Do not commit `.env`, `.env.local`, secrets, API keys, tokens, or passwords.
- Do not run `docker compose down -v` against production or a compose project using production data.
- Do not run commands that drop, truncate, recreate, or backfill production tables unless that operation has been reviewed and explicitly approved.
- Do not edit `data/postgres` directly.
- Prefer read-only API checks during Mac development.
- Keep worker and scheduler processes disabled by default when connected to production PostgreSQL.
