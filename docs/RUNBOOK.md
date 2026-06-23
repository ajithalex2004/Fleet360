# XL AI Smart Mobility — Production Runbook

Operational guide for the platform. Solo-dev focused; assumes one engineer
on-call. Update this file when production behaviour changes.

## Quick reference

| Need | Where |
|------|-------|
| Production app | (set after deployment) |
| Production DB | Neon — https://console.neon.tech (project: my-c1-project) |
| Error tracking | Sentry — set NEXT_PUBLIC_SENTRY_DSN + SENTRY_DSN to enable |
| Repo | https://github.com/ajithalex2004/my-c1-project |
| Active branch | `feat/leasing-sts` (STS v1.0 work) |
| Trunk | `main` |
| Baseline tag | `v0.0.0-baseline-2026-05-05` |

## First-time setup (developer machine)

```bash
git clone https://github.com/ajithalex2004/my-c1-project.git
cd my-c1-project
git checkout feat/leasing-sts

cp .env.example .env           # fill in real values; .env is gitignored
npm install
npm run setup-hooks            # enable pre-commit lint+typecheck

npx prisma generate
npx prisma migrate dev          # against local Postgres OR Neon dev branch

npm run dev                     # http://localhost:3000
```

## Environment variables (production)

See `.env.example` for the full list. Production-mandatory:

- `DATABASE_URL` — Neon production branch URL with pooler
- `SESSION_SECRET` — ≥32 random chars
- `OPENAI_API_KEY` — required for AI co-pilot features
- `THESYS_API_KEY` — required for C1 GenUI
- `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` (or `SENDGRID_API_KEY`)
- `NEXT_PUBLIC_APP_URL` — full production URL
- `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` — strongly recommended

`src/lib/env.ts` validates all of these at boot. Missing required vars in
production will throw immediately on first request — fail-fast.

## Deployment

(Deployment target TBD — Vercel, AWS, or self-hosted Docker. Update once
chosen.)

For now, the recommended path is **Vercel**:
- Connect the GitHub repo → Vercel project
- Set env vars in Vercel dashboard
- Production deploys auto-trigger on `main` push
- Preview deploys auto-trigger on PRs

If self-hosted, see `Dockerfile` + `docker-compose.yml`.

### Release gate

Before promoting a build, run:

```bash
npm run check:prod
npm run check:deploy
```

For browser-backed smoke validation against a running local or preview app:

```bash
npm run check:deploy:e2e
```

Required failures block release. Recommended warnings are allowed only when
they are explicitly accepted in release notes. Current recommended gates:

- Stripe configured for billing checkout/portal.
- Email configured for invitations and notifications.
- Sentry configured for production exception telemetry.
- `UPTIME_MONITOR_URL` recorded for the external `/api/health` monitor.
- `NEON_BACKUP_POLICY_CONFIRMED=true` after PITR/backup policy is verified.

## Database operations

### Backups
- **Primary:** Neon Pro plan PITR (7-day point-in-time recovery, automatic).
  No custom cron jobs — confirm Neon plan is Pro before STS go-live.
- **Disaster recovery test:** Run a full restore from PITR to a staging
  branch monthly. Verify schema and row counts match production.

Backup release gate:

- Confirm the active Neon plan provides the required PITR/recovery window.
- Set `NEON_BACKUP_POLICY_CONFIRMED=true` only after the target environment is verified.
- Restore production to a staging branch monthly and verify row counts.

Minimum DR verification:

```sql
SELECT COUNT(*) FROM tenants;
SELECT COUNT(*) FROM "User";
SELECT COUNT(*) FROM user_tenants;
SELECT COUNT(*) FROM tenant_modules;
SELECT COUNT(*) FROM admin_change_history;
```

### Migrations
```bash
# Edit prisma/schema.prisma
npx prisma migrate dev --name describe_change   # creates + applies migration
git add prisma/migrations/* prisma/schema.prisma
git commit
# Production: deploy applies via `npx prisma migrate deploy` in build step
```

**Never run `prisma db push` or `migrate dev` against production.**

Release checklist for migrations:

- Migration exists under `prisma/migrations`.
- `npx prisma migrate status` shows no pending local drift.
- Migration has been applied to a Neon preview/staging branch first.
- Rollback approach is written in release notes. Prefer forward-fix migration.
- Any data backfill has row-count verification and is idempotent.

### Connection pooling
The Neon URL format must include `?sslmode=require` and use the *pooler*
endpoint (`-pooler` in hostname) for Next.js serverless. The non-pooler URL
is for migration/seed scripts only.

## Observability

### Errors → Sentry
Set `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` to enable. Sentry captures
unhandled rejections, uncaught exceptions, and explicit
`captureException()` calls. The fetch-based adapter
([src/lib/sentry.ts](../src/lib/sentry.ts)) has a 2-second timeout and
swallows network failures so telemetry never crashes a request.

### Audit log
All financial mutations should be wrapped with `withAudit()`
([src/lib/with-audit.ts](../src/lib/with-audit.ts)). Audit records land in
the `audit_logs` Postgres table with tenant/user/entity/action/details.
Query examples:

```sql
-- Last 100 lease contract creations
SELECT * FROM audit_logs
WHERE entity_type = 'LeaseContract' AND action = 'CREATE'
ORDER BY created_at DESC LIMIT 100;

-- Specific user's actions today
SELECT * FROM audit_logs
WHERE user_id = '...' AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Health probe
`GET /api/health` returns:

- `200 status=ok` when DB and required production config are healthy.
- `200 status=degraded` when DB is healthy but required config is missing.
- `503 status=unhealthy` when DB is unreachable.

Wire an external monitor to `/api/health` for 1-5 minute checks and record the
monitor URL in `UPTIME_MONITOR_URL`. Alert routing:

- Primary: on-call engineer.
- Secondary: operations owner.
- Escalate immediately if status is `503` for two consecutive checks.
- Create an incident note if degradation lasts more than 30 minutes.

## Incident response

### Production is down
1. Check `https://status.neon.tech` — Neon outage is the most common cause
2. Check Sentry → Issues → newest, filter env=production
3. If app is up but DB is slow, check Neon console → Compute → metrics
4. If app is down: re-deploy last known good commit
   ```bash
   git checkout main
   git revert <bad-commit>
   git push
   ```

### Rollback procedure
```bash
# Identify last good commit on main
git log --oneline -10 main

# Hard rollback (only with explicit user authorization)
# Prefer: revert + redeploy
git revert <bad-commit-sha>
git push origin main
```

### Database hot-fix
Apply schema changes via migrations only. **Never run raw SQL against
production unless rolling back a migration.** If absolutely required:
```bash
psql "$DATABASE_URL" -c "..."
# Document the change immediately in a new migration file with
# the same effect, so other environments stay in sync.
```

### Credential rotation
- **Neon DB:** Console → Settings → Reset password → update DATABASE_URL
  in deployment env → redeploy.
- **OpenAI:** Platform → API Keys → revoke + create → update env.
- **Session secret:** Generate new value with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
  update env. **All active sessions invalidate immediately.**

## Bus factor mitigation

Solo dev = bus factor of 1. Mandatory before STS go-live:
- [ ] At least one trusted person can SSH into the deployment platform
- [ ] At least one trusted person has Neon read-only access
- [ ] Contact info documented for: hosting, Neon, OpenAI, Twilio, SMTP
- [ ] DR test (PITR restore) done at least once
- [ ] This runbook reviewed and printable
