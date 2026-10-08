# Deployment guide

Fleet360 runs on **Railway** with a **Neon** PostgreSQL database. (It used to
mention Vercel; Vercel is not used, and `vercel.json` was removed.)

## Services

Railway project `fleet360-railway`, environments `production` and `staging`:

| Service | What | Health |
|---|---|---|
| `fleet360-app` | Next.js web app and API (`/api/*`), plus the in-process job scheduler | `/api/health`, `/api/readyz` |
| `fleet360-backend` | Go API (`backend/`, routes under `/api/v1`), reachable only inside Railway | `/healthz` (Railway health check) |

Production: `https://fleet360-app-production.up.railway.app`. One replica of
each service.

## Deploying

1. Merge to `main`. Railway builds and deploys **both** services
   automatically; each posts a `fleet360-railway - <service>` status on the
   commit.
2. **Apply new migrations straight after the merge.** Deploys do **not** run
   migrations. From an up-to-date checkout of `main`:

   ```bash
   git pull origin main
   railway run --service fleet360-app --environment production npx prisma migrate deploy
   ```

   Until a migration is applied, `/api/readyz` answers 503 and **Admin →
   Schema status** lists the missing tables/columns (only objects the app
   checks; see `src/lib/db/schema-registry.ts`).
3. Confirm: `/api/health` shows the new `release` (the merge commit) for the
   app and for `backend.version`, `db.status: connected` and `schema.status: ok`.
   `status: degraded` with only `missingConfig` entries (Stripe, SendGrid,
   Sentry keys) is expected while those integrations are unset.

## Database

- Neon project `ep-calm-heart-a15voo2a`. Two roles:
  - `fleet360_app` — the runtime role for both services (`DATABASE_URL`). Not
    an owner, no `BYPASSRLS`, no DDL: row-level security applies, and the app
    cannot create tables.
  - `neondb_owner` — migrations only (`DIRECT_URL` / `MIGRATION_DATABASE_URL`).
- Schema changes go in `prisma/migrations/` only. The app runs no DDL in
  production (`scripts/check-no-runtime-ddl.mjs` guards it).
- Migrations are forward-only; write them additive and idempotent
  (`IF NOT EXISTS`) wherever possible.
- New, empty environment: `node scripts/fresh-install-migrate.cjs --fresh-install`
  (see `docs/FRESH_DATABASE_SETUP.md`), not a bare `migrate deploy`.

## Configuration

- Variables are set per service and environment in Railway.
- **`railway variables --set` does not restart the service.** The running
  process keeps the old value until it is redeployed:

  ```bash
  railway variables --service fleet360-app --environment production --set NAME=value
  railway redeploy --service fleet360-app --environment production
  ```

- `AUTHZ_MODE`: unset means **enforce** (role permissions answer 403). Set
  `report` only as a temporary rollback (denials are then logged and allowed).
- `DISABLE_JOB_SCHEDULER=true` stops the in-process scheduler on a replica
  (not needed for safety with several replicas: runs are claimed in `job_runs`).

## Scheduled jobs

Jobs run in the web process (`src/lib/jobs/scheduler.ts`, Asia/Dubai time),
each by POSTing `/api/jobs/run?job=<name>&occurrence=<minute>` with
`CRON_SECRET`. There is no external cron.

Every run is claimed first in the `job_runs` table (`src/lib/jobs/job-runs.ts`):
one run per scheduled minute across all web replicas, never two runs of the
same job at once, and an abandoned run (process stopped mid-run) is closed when
its lease expires. Adding web replicas is therefore safe. **Admin → Job runs**
shows the history (30 days). A tick missed while no process was running is not
replayed; the job runs at its next scheduled time.

## Rolling back

- **Code:** in the Railway dashboard, open the service → Deployments and
  redeploy the previous successful deployment; or revert the commit on `main`.
- **Migrations** are not rolled back automatically. Because they are additive,
  older code runs against the newer schema; fix forward with a new migration.
- **Authorization:** `AUTHZ_MODE=report` and a redeploy, as above.

## Before merging

CI (GitHub Actions) is the intended gate: production build, unit tests,
tenant-RLS checks. When it cannot run, run the relevant checks locally:

```bash
npx tsc --noEmit -p .
npx vitest run tests/unit
node scripts/check-no-runtime-ddl.mjs
(cd backend && go build ./... && go test ./...)
```
