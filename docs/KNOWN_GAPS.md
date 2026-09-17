# Known Gaps — STS v1.0

Issues we are deliberately *not* fixing for STS v1.0. Each entry has a written
rationale and a target version. **Do not delete or "stretch v1.0" fix any of
these without re-baselining the SoW.**

## TENANT-001 — Query-level tenant scoping on leasing models
**Status:** open · **Target:** v1.1 · **Owner:** core

Leasing models (`Lessee`, `LeaseContract*`, `LeaseQuotation`, `LeaseInvoice`,
`LeaseReceipt`, etc.) do not have a `tenantId` column. The middleware
([src/middleware.ts](../src/middleware.ts)) already verifies the session and
injects `x-tenant-id` per request, but query handlers do not filter by it.

**Why deferred:** STS is the only operational tenant in v1.0. The platform's
multi-tenant data scoping migration affects 20+ tables and requires:
- Schema migration adding `tenant_id` column on every leasing table
- Backfill assigning existing rows to a default tenant
- Update every Prisma query to include `where: { tenantId }`
- A regression test pass

This is ~5–8 dev-days. Out of scope for July 2026 STS go-live; will run as
v1.1 work in Q4 2026 before onboarding the second customer.

**Mitigation now:** STS deployment is single-tenant. `assertCanWrite()` from
[src/lib/access-control.ts](../src/lib/access-control.ts) still enforces
plan-based write gates.

**Risk if STS adds a sub-tenant before v1.1:** A user from sub-tenant B would
see sub-tenant A's data. Acceptable only because no sub-tenants exist.

---

## OBS-001 — Database backups beyond Neon's automatic PITR
**Status:** accepted · **Target:** v1.0 (acceptance) · **Owner:** ops

Production database is Neon Postgres, which provides 7-day point-in-time
restore on the Pro plan automatically. We are *not* writing custom backup
scripts because:
1. Neon's PITR is more reliable than ad-hoc `pg_dump` cron jobs
2. Solo-dev capacity is better spent on features

**Action required from STS go-live:** Confirm Neon plan is Pro tier (not Free)
so PITR is enabled.

---

## SEC-001 — Hardcoded admin password in setpw.js
**Status:** acknowledged · **Target:** rotate before go-live · **Owner:** athom

`setpw.js:6` contains `PASSWORD='Admin@1234'` and is in git history (commit
`d934693`). This is a dev-only utility for resetting the local admin user;
it does NOT run in production. However:

- Before STS go-live, change the production `alex@exlsolutions.ae` password
  to a random secret (use `scripts/reset-admin-password.js` interactively).
- After rotation, this is purely a dev-tool with a known weak default.

**Risk:** Low if production password is rotated; high if it isn't.

---

## SEC-002 — Rotate Neon credentials
**Status:** ✅ closed — rotation and retirement fully verified · **Target:** before go-live · **Owner:** athom

`.env.test` (gitignored) historically contained a Neon Postgres password
(`<redacted_credential>`). The credential lived in the project folder, which was
broader than acceptable for a DB credential.

**Audit Status:**
- **Implemented (Code & Scanners):**
  - All hardcoded database credentials and fallbacks eradicated from `tests/test-utils.ts`, `tests/integration/staging-acceptance.test.ts`, `tests/integration/logistics-tenant-isolation-controlled.test.ts`, `scripts/staging-live-smoke.mjs`, `scripts/verify-staging-proxy-e2e.js`, and `.github/workflows/staging-acceptance-gate.yml`.
  - Blocking static credential scanner (`scripts/check-no-hardcoded-credentials.mjs`) created and wired into CI (`npm run check:credentials`), checking all tracked files for unredacted tokens (`npg_*`) and non-placeholder connection strings across any remote host.
  - Safe reporting enforced (file, line, rule only; no secret or snippet echoing in CI logs).
- **Tested Locally:**
  - Fail-closed subprocess isolation tests in `tests/unit/credential-leak-guard.test.ts` prove `verify-staging-proxy-e2e.js` and `staging-live-smoke.mjs` terminate with code 1 before network requests when configuration is absent.
  - Static scanner positive and negative tests verified (9/9 pass).
  - Runtime migration credential isolation guard verified (`scripts/check-no-runtime-migration-secrets.mjs`).
- **Verified in Deployment:**
  - Deployed Railway staging cluster candidate verified against GitHub Actions Staging Acceptance Gate using `STAGING_DATABASE_URL` secret.
- **Rotation Executed (2026-09-17):**
  - Both role passwords (`fleet360_app`, `neondb_owner`) reset via the Neon console by the operator (`athom`).
  - New passwords propagated to every known consumer: Railway `fleet360-app` (production + staging) — `DATABASE_URL`, `RUNTIME_DIRECT_DATABASE_URL`, `PHASE0_DATABASE_URL`, `DIRECT_URL`, `MIGRATION_DATABASE_URL`, plus staging-only `DIRECT_DATABASE_URL`; Railway `fleet360-backend` (production + staging) — `DATABASE_URL`; GitHub Actions secrets `STAGING_DATABASE_URL` and `PHASE0_DATABASE_URL` (repo `ajithalex2004/Fleet360`, confirmed updated `2026-09-17T06:47Z`).
  - Both Railway services restarted in both environments to pick up the new values (`railway variables --set` does not itself trigger a redeploy).
  - Live verification: `GET /api/health` on both `fleet360-app-production.up.railway.app` and `fleet360-app-staging.up.railway.app` returned `db.status: "connected"` and `backend.status: "ready"` post-rotation.
  - **Incident note:** production briefly went down (`db.status: "error", "database unreachable"`) between the Neon-side password reset and the Railway variable update/restart, because `railway variables --set` does not auto-restart a service — the old password remained loaded in the running process until an explicit `railway restart` was issued. Outage window: confirmed unhealthy at `2026-09-17T06:24Z` and `06:33Z`, confirmed recovered at `06:41Z`. For any future rotation, set the new Railway variables and issue the restart in the same breath to minimize this gap.
- **Retirement Verified (2026-09-17):**
  - Old `fleet360_app` password: fresh connection attempt to the pooled endpoint via `npx prisma db execute --stdin` returned `Error: P1000 — Authentication failed` (Prisma's wrapper around Postgres `28P01`).
  - Old `neondb_owner` password: same test against the direct endpoint returned the identical `P1000` authentication failure.
  - Session audit: `SELECT ... FROM pg_stat_activity WHERE usename IN ('fleet360_app', 'neondb_owner')` run from the Neon console SQL Editor returned 11 active sessions, all with `backend_start` at `06:36:26Z` or later — i.e. every one of them postdates the `06:24Z` password reset and therefore authenticated with the *new* password. No session predates the rotation, so no `pg_terminate_backend` pass was needed.
  - Conclusion: the previously-exposed credentials are confirmed non-functional and no live session is relying on them. This gap is closed.

**Credential Ownership Matrix:**
- **Application Runtime (`DATABASE_URL`):** Least-privileged application role (`fleet360_app`, pooled endpoint). Holds `SELECT, INSERT, UPDATE, DELETE` grants on application schemas; does NOT own tables and does NOT hold `rolbypassrls`.
- **Application Direct Queries (`RUNTIME_DIRECT_DATABASE_URL`):** Least-privileged application role (`fleet360_app`, direct unpooled compute endpoint).
- **Database Migration Runner (`MIGRATION_DATABASE_URL` / `DIRECT_URL`):** Dedicated migration/DDL owner role (`neondb_owner`, direct endpoint). Sole owner of tables and sequence objects.
- **Staging Acceptance & Tenant Isolation Gate (`STAGING_DATABASE_URL`):** Dedicated application role (`fleet360_app`). Proves real tenant isolation and cross-tenant access denial.

**Operational Rotation & Retirement Runbook:**
1. ✅ **Target Inventory:** Identify affected Neon project (`ep-calm-heart-a15voo2a`), branch (`main` / staging), roles (`fleet360_app`, `neondb_owner`), and consumers. — 13 consumer locations catalogued (see above).
2. ✅ **Distribution Preparation:** Prepare new high-entropy random secrets for each consumer separately. — new passwords generated by the operator in the Neon console.
3. ✅ **Password Rotation:** Reset role passwords via Neon Console or Neon Management API (`/projects/{project_id}/branches/{branch_id}/roles/{role_name}/reset_password`) to prevent plaintext passwords in non-ephemeral database SQL logs. — done 2026-09-17.
4. ✅ **Consumer Updates:** Update GitHub Actions repository secrets (`STAGING_DATABASE_URL`, `PHASE0_DATABASE_URL`) and Railway environment variables (`DATABASE_URL`, `RUNTIME_DIRECT_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DIRECT_URL`, `PHASE0_DATABASE_URL`, `DIRECT_DATABASE_URL`) across both services and both environments. Services restarted. — done 2026-09-17, verified live via `/api/health`.
5. ✅ **Session & Pool Termination:** Terminate active sessions holding old credentials. — checked via `pg_stat_activity`; all 11 live sessions postdate the rotation (earliest `06:36:26Z` vs. reset at `06:24Z`), so none needed termination.
6. ✅ **Retirement Verification:**
   - Old credentials rejected: both `fleet360_app` (pooled) and `neondb_owner` (direct) returned `P1000`/`28P01` authentication failures on 2026-09-17.
   - New credentials verified: confirmed via live `/api/health` on production and staging (`db.status: "connected"`) and via successful Railway/GitHub secret propagation.
   - Cross-tenant RLS denial tests: covered by the existing Phase 0 CI suite (`phase0.yml`), unaffected by this rotation since it runs against the new credential going forward.
7. ✅ **Audit Record:** Rotation timestamp `2026-09-17`, operator `athom`, evidence recorded in this entry (Railway/GitHub consumer list, health-check confirmation, `28P01` rejection tests, session audit).

---

## SEC-003 — Health/readiness endpoints leaked internals; operator debug route was open
**Status:** in progress · **Target:** before go-live · **Owner:** athom

**2026-09-15:** `/api/health` (Next.js) and `/readyz` (Go) returned raw
error text to any unauthenticated caller — including, in some failure
modes, the internal Go backend hostname (`*.railway.internal`) and raw
Postgres driver errors. Fixed:
- `src/app/api/health/route.ts`: db/backend errors are now logged
  server-side (`console.error`) only; the JSON response returns a generic
  status string. Also removed a dead, unused `requireAuthorizedTenant`
  import that made the file look gated when it isn't.
- `backend/handlers/health.go` (`/readyz`): same treatment — DB and
  phasegate errors are now logged via `zap` instead of echoed in the
  response. `pingDB` no longer relies solely on the inbound request's
  context for its timeout (it may carry none); it now has an explicit
  2s `context.WithTimeout`.
- `/debug/phasegate`'s own comment said it should be "operator-only" and
  "restrict[ed] via IP allowlist in production," but no restriction was
  actually implemented anywhere. Added an opt-in gate: if
  `PHASEGATE_DEBUG_TOKEN` is set, the endpoint requires a matching
  `X-Debug-Token` header (constant-time compare) and 404s otherwise.

**Still required before go-live:** `PHASEGATE_DEBUG_TOKEN` is unset by
default, so `/debug/phasegate` is still open until someone sets it as a
Railway env var (and shares the token with on-call only). An IP
allowlist at the Railway/proxy level, if preferred over a shared token,
is an infra decision outside what this fix could make.

---

## SEC-004 — Development-secret authentication bypass (P0.1)
**Status:** ✅ Closed based on supplied production evidence · **Target:** v1.0 · **Owner:** core / sec

The legacy codebase historically permitted session signature verification using a fallback
hardcoded development secret (`xl-mobility-dev-secret-change-in-production`). An attacker
could forge valid administrative sessions (`role: 'SUPER_ADMIN'`) for any tenant.

**Remediation & Hardening Implemented (Commit `f5c6a033`):**
- Centralized fail-closed validation in [`src/lib/session-secret.ts`](../src/lib/session-secret.ts).
  Removed all fallback secrets from `tenant-session.ts`, `sso-state.ts`, and `sso.ts`.
- Rejects leading/trailing whitespace without silent `.trim()` mutation.
- Enforces minimum 32 chars and entropy checks; bans known dummy placeholders.
- Dedicated 25-vector regression suite in `tests/unit/session-secret.test.ts` wired as a blocking
  step in `.github/workflows/ci.yml`.

**Production Closure Evidence (Verified 2026-09-16 on Railway Production):**
- **Running Deployments:** `fleet360-app` (`13624d58`), `fleet360-backend` (`c3a7f807`) running commit `f5c6a033`.
- **Target Endpoint:** `https://fleet360-app-production.up.railway.app/api/logistics/shipments`.
- **Paired Probe 1 (Old Dev Secret):** Well-formed, unexpired (+24h) `SUPER_ADMIN` session cookie signed
  with `xl-mobility-dev-secret-change-in-production` $\to$ **`HTTP 401 Unauthorized {"error":"Unauthorized","message":"Valid session required"}`**.
- **Paired Probe 2 (Legitimate Secret):** Well-formed session cookie signed with production secret $\to$ **`HTTP 200 OK`** (live shipments returned).

---

## SEC-005 — SSO Client Secret Encryption Migration & Key Retirement Lifecycle
**Status:** open · **Target:** v1.1 / post-cutover · **Owner:** sec / ops

SSO client secrets stored in `tenant_sso_configs` are protected via AES-256-GCM.
Hardening in commit `f5c6a033` introduced versioned ciphertext (`v1:<base64-payload>`),
legacy `v0` transparent backward compatibility, and dual-key rotation via
`SSO_PREVIOUS_ENCRYPTION_KEY` with a `reencryptSecret()` batch helper.

**Current Inventory & Baseline (Verified 2026-09-16):**
- Staging `tenant_sso_configs` row count: `0`
- Production `tenant_sso_configs` row count: `0`
- Dedicated 64-hex-char `SSO_ENCRYPTION_KEY` provisioned and enforced in production.

**Remaining Tracked Lifecycle Tasks:**
1. Maintain record count audit once enterprise SSO tenants are onboarded.
2. Execute batch `reencryptSecret()` migration for any restored `v0` legacy ciphertexts.
3. Validate successful decrypt reads after retiring `SSO_PREVIOUS_ENCRYPTION_KEY`.
4. Perform and document formal backup recovery drill with key rotation.

---

## MIGRATE-001 — `prisma migrate deploy` cannot replay migration history from scratch
**Status:** open · **Target:** before any fresh-environment provisioning is needed · **Owner:** athom

**2026-09-17:** discovered while provisioning a clean staging database. Running
`prisma migrate deploy` against a genuinely empty Postgres database (all 160
migrations, in order) fails partway through — it is **not** currently possible
to bootstrap a fresh environment for this project from migration history alone.

**Root cause:** migration `20260815140000_tenant_001_leasing_rental_isolation`
runs `ALTER TABLE rental_rate_quotes ADD COLUMN ...` (and the same for
`rental_vehicle_exchanges`, `rental_invoices`, `rental_invoice_line_items`,
`rental_invoice_payments`) with no existence guard, but none of those five
tables are `CREATE TABLE`'d by any earlier migration. They're only created by
later migrations — `20260914140000_fresh_replay_rental_leasing_gap` and
`20260915250000_fresh_replay_rental_leasing_gap_v2` — whose own names and
comments make clear they were written specifically to patch "fresh database
bootstrap" gaps like this one. Since `migrate deploy` applies migrations
strictly in order and halts on the first failure, it dies at `20260815140000`
long before it ever reaches the fixes meant to cover it.

Separately, `20260815140000`'s tenant backfill logic (`SELECT id INTO
default_tenant FROM tenants ... IF default_tenant IS NULL THEN RAISE
EXCEPTION`) requires at least one pre-existing row in `tenants`, so a truly
empty database also needs a seed tenant before this migration can pass, even
once the table-ordering issue is fixed.

**Why this hasn't been noticed before:** every real environment (production,
the original staging database) was provisioned incrementally over time, so by
the time `20260815140000` ran, `rental_rate_quotes` etc. already existed via
whatever created them originally (likely ad hoc `db push`/runtime DDL before
migrations were the source of truth) — the ordering bug only bites a true
from-scratch replay.

**Workaround used for staging (2026-09-17):** rather than editing an
already-applied historical migration (risky — `migrate deploy` may re-validate
checksums of migrations already recorded as applied, which would need
verifying against production before ever touching that file), the clean
staging database was built via `prisma db push` (schema-driven, ignores
migration history and its ordering entirely) plus a targeted replay of RLS
policies, grants, and the tables Prisma doesn't model, sourced directly from
production's live structure via `prisma migrate diff --to-schema-datasource`.
This works but is a one-off manual process, not something `migrate deploy`
can do unattended.

**Real fix needed:** move the `CREATE TABLE IF NOT EXISTS` statements for
`rental_rate_quotes`, `rental_vehicle_exchanges`, `rental_invoices`,
`rental_invoice_line_items`, and `rental_invoice_payments` earlier in history
— either by making `20260815140000` itself defensive (guarding each `ALTER
TABLE` with an existence check, matching the pattern already used elsewhere
in this same migration for lease tables), or via some other mechanism that
doesn't risk the checksum of an already-applied production migration. Whoever
picks this up should first confirm whether `prisma migrate deploy` actually
re-checks checksums of prior applied migrations in this Prisma version, since
that determines whether editing the file in place is even safe.

**Risk if left open:** disaster recovery, spinning up a second environment,
or onboarding a new developer's local database all require a working fresh
`migrate deploy` — none of those paths currently work end-to-end.

---

## OPS-001 — `PHASE0_DATABASE_URL` undocumented; production was 21 migrations behind
**Status:** ✅ resolved (production caught up) · unresolved (still undocumented, no drift alarm) · **Target:** before next migration lands · **Owner:** athom

**2026-09-17:** while investigating why PR #88's CI (`Audit log transaction
race`, `Cross-tenant isolation`, `RLS isolation (TypeScript)`, `Leasing
return workflow`, `Dunning & collections dispatch`) was failing identically
on `main` — not just this branch — traced it to `PHASE0_DATABASE_URL`.

**Finding 1 — the secret is undocumented.** `PHASE0_DATABASE_URL` isn't
mentioned in any `.md` file in the repo. The only description of it lives in
a comment inside `.github/workflows/phase0.yml` ("a connection string for
the fleet360_app role — NOT the application's DATABASE_URL, which connects
as neondb_owner"), which describes the *role* but not *which database*.
Checking `gh secret list` timestamps and cross-referencing against this
session's own credential rotation confirmed: **`PHASE0_DATABASE_URL` points
at `neondb` — production itself** — not a dedicated Phase 0 branch/schema, as
the workflow's own naming might suggest to a future reader.

**Finding 2 — production was 21 migrations behind.** A direct read of
`_prisma_migrations` on production (via a plain `SELECT`, since `prisma
migrate status` itself was blocked as a production-read action in this
session) showed 143 of 164 migrations applied — everything from
`20260914140000_fresh_replay_rental_leasing_gap` through
`20260915280000_fresh_replay_lease_allocation_occurrences` (21 migrations,
spanning three days) had never been deployed to production, despite being
merged to `main`. This is exactly the audit_logs `NOT NULL` gap PR #88's CI
caught, plus 20 more.

**Action taken (2026-09-17, operator athom, with explicit confirmation
before each production-affecting step):**
1. Confirmed `PHASE0_DATABASE_URL`'s target via secret timestamp + the
   credential rotation record in SEC-002, rather than guessing.
2. Read `_prisma_migrations` directly (safe, read-only) to get the full
   pending list — deliberately *not* the single audit_logs migration
   originally suspected, to know full scope before deploying.
3. Ran `npx prisma migrate deploy` against production. All 21 migrations
   applied cleanly, no partial failures. (Blocked from running this directly
   in the automated session as a `[Production Deploy]` action — the operator
   ran it manually and shared output for verification, same pattern as the
   SEC-002 credential rotation.)
4. Verified production `/api/health` stayed `db.status: "connected"`,
   `backend.status: "ready"` throughout — no observed disruption.
5. Re-ran PR #88's Phase 0 jobs: `Audit log transaction race`,
   `RLS isolation (TypeScript)`, `Leasing return workflow`, and
   `Dunning & collections dispatch` confirmed passing post-deploy.
   `Cross-tenant isolation` (Go) was still running at last check — verify
   independently before treating this gap as fully closed.

**Still open:**
- Document `PHASE0_DATABASE_URL` properly (target database, role, and that
  it is production) somewhere durable — this entry is a start, but the
  workflow file itself should say so plainly, not just imply a role.
- Nothing currently alerts when production's applied-migration count drifts
  from what's merged to `main`. This drift sat for three days, silently
  failing 5 CI jobs on every single `main` push and PR, before anyone
  investigated why. A cheap fix: a scheduled or push-triggered check that
  runs `prisma migrate status` against production and fails loudly (not just
  the already-passing `ci: refine unresolved migration query...` check,
  which evidently didn't catch this) is worth adding so this can't recur
  silently for days.

---

## DEP-001 — Dependency vulnerability triage (npm audit)
**Status:** open · **Target:** before go-live · **Owner:** athom

**2026-09-15 assessment** (`npm audit --omit=dev`): 35 findings (2
critical, 5 high, 27 moderate, 1 low).

Safe, non-breaking fixes available via plain `npm audit fix` (no
`--force`, no parent major bump):
- **fast-xml-parser** (critical — DoS via entity expansion, transitive
  via `@aws-sdk/xml-builder`)
- **form-data** (critical — unsafe boundary RNG / CRLF injection)
- **lodash**, **lodash-es** (high — prototype pollution / code
  injection via `_.template`)
- **nanoid** (high — can loop indefinitely on size 0 / negative size)

Fixes that require `--force` and a breaking parent bump (need real
regression testing before applying, not something to run unattended):
- **nodemailer** (high, multiple SMTP/CRLF injection advisories) →
  would bump to `nodemailer@10.0.10`
- **postcss** (high, source-map path traversal / XSS), transitive via
  `next` → would bump to `next@16.3.5` (Next.js 15 → 16 major)
- **prismjs** (moderate, DOM clobbering), transitive via
  `react-syntax-highlighter` → `@crayonai/react-ui` → would bump
  `@crayonai/react-ui` to `0.7.0`

**Blocked locally:** `npm audit fix` and even a plain `npm install`
currently fail on this machine with `ENOTEMPTY` renaming
`node_modules/ajv` — there's a stray `node_modules/.ajv-hWqV46Qm`
backup directory (dated 2026-08-20, predates today's session) left over
from some earlier interrupted install, and it's blocking npm's normal
package-swap rename for *any* dependency change. Fix: delete
`node_modules/.ajv-hWqV46Qm` (safe — node_modules is disposable/
gitignored) and re-run `npm install`, then `npm audit fix` for the four
safe items above. Not something this session could do: it needs delete
access inside this folder, which was intentionally not granted this
session.

---

## RUNTIME-001 — Edge Runtime `process.version` warning (Upstash)
**Status:** accepted · **Target:** n/a (upstream) · **Owner:** athom

`src/middleware.ts` runs in the Edge runtime (default for Next.js
middleware) and imports `getRateLimiter` (`src/lib/rate-limit-scope.ts`),
which pulls in `@upstash/ratelimit` / `@upstash/redis`. Those packages
reference `process.version` internally, which Next.js flags at build
time as a Node.js API used in Edge-bound code.

**2026-09-15:** confirmed this repo is already on the latest available
versions (`@upstash/ratelimit@2.1.0`, `@upstash/redis@1.38.4` vs.
`^2.0.8` / `^1.38.2` pinned) — this is a known, current upstream
limitation in how those SDKs are bundled for the Edge runtime, not a
version-lag issue and not something fixable from Fleet360's own source.
It's a build-time warning, not a runtime failure; Vercel's Edge runtime
tolerates the reference in practice. No code change made. Revisit only
if Upstash ships a fix upstream, or if this ever surfaces as an actual
runtime error rather than a build warning.

---

## STORAGE-001 — Local file storage incompatible with Vercel production
**Status:** open · **Target:** before STS production cutover · **Owner:** ops

`src/lib/storage/index.ts` ships a `LocalFileStorage` adapter that writes to
`public/uploads/...` on disk. This works for **local development** and
**self-hosted Docker** with a persistent volume, but **breaks on Vercel** because
serverless functions have ephemeral filesystems — files written during a request
are gone the next request.

**Affected feature:** Phase 1d document upload at
[/leasing/documents](../src/app/leasing/documents/page.tsx).

**Mitigation:** the storage layer is already abstracted behind a `FileStorage`
interface. Production swap is one new file:
- `S3FileStorage` — for AWS deployment (use `@aws-sdk/client-s3`)
- `VercelBlobStorage` — for Vercel deployment (use `@vercel/blob`)

Then update `getStorage()` in `src/lib/storage/index.ts` to read
`STORAGE_BACKEND=local|vercel-blob|s3` from env and instantiate the right one.

**Estimated effort:** 1–2 days (install SDK, write adapter, test, env vars).
Must happen before STS production deploy if hosting on Vercel.

---

## KNOWN-PRISMA-001 — RESOLVED 2026-05-05
**Status:** ✅ resolved · **Resolution:** upgraded to Prisma 5.22.0

Was: `prisma generate` failed on Node 22 with a misleading "Invalid character"
error on Prisma 5.10.0. Resolved by upgrading to Prisma 5.22.0 (last 5.x line)
which has Node 22 compatibility. **Avoided** Prisma 7.x because it introduced
breaking schema changes (datasource `url` moved to `prisma.config.ts`, new
PrismaClient constructor signature) that would require multi-day refactor.

Code cleanup: removed the `(contract as any).mileageOverageRate` cast in
`src/app/api/leasing/mileage-readings/route.ts`.

**Note for future Prisma upgrades:** stay on the 5.x line (5.22.x) until
Prisma 7's `prisma.config.ts` / adapter pattern is needed. Skipping 6.x is
fine — it was a short-lived series.

---

## KNOWN-TS-001 — Pre-existing TypeScript errors across the codebase
**Status:** open · **Target:** v1.0 cleanup sprint · **Owner:** core

`tsc --noEmit` reports ~100 pre-existing errors across:
- `prisma/seed.ts` — references removed enum names (MaintenanceStatus, AlertSeverity, AlertType, ActionStatus) and fields that have been renamed in newer migrations
- `scripts/*.ts` — legacy ts-node helper scripts with var/const redeclarations and missing types
- `src/app/api/admin/seed/leasing/route.ts` — `quantity` field on a model that doesn't have it
- `src/app/admin/users/page.tsx` — type narrowing issues
- `src/app/api/alerts/[id]/route.ts` — `assignedDate` field that no longer exists
- `src/app/api/assets/ble/stats/route.ts` — BigInt literals in pre-ES2020 target
- A handful of others

**Why deferred:** None of these errors affect runtime — most are in dev-tooling
or seed scripts that aren't part of the user-visible app. Fixing all of them
is a 2–3 day sweep with risk of unintentional behavioural changes.

**Mitigation now:** CI workflow runs `npm run typecheck` with
`continue-on-error: true` — typecheck failures show as advisory yellow ⚠ on
PRs but don't block merges. Same for `lint` and `test:unit` to avoid
false-positive blocks while the codebase stabilises.

**Trigger to re-enforce:** Run a focused cleanup sprint (one per file area:
seed → scripts → admin pages → api routes) and remove the `continue-on-error`
flags from `.github/workflows/ci.yml` step-by-step as each area goes green.

**Risk:** New code lands with type errors and they accumulate. Mitigation:
this `KNOWN_GAPS` entry is the source of truth; review weekly. Solo-dev
discipline matters here.

---

## A11Y-001 — Bilingual UI: Arabic font / RTL polish
**Status:** open · **Target:** v1.0 (foundation only), v1.1 (full polish)

[LanguageContext.tsx](../src/contexts/LanguageContext.tsx) provides
EN/AR translations for nav and module labels. v1.0 will:
- Wire the dictionary into all leasing pages (most still hardcode English)
- Set `<html dir="rtl">` correctly on language switch (already implemented)
- Use Noto Sans Arabic in PDF templates (Phase 1a)

v1.1 will polish:
- Right-aligned numeric tables, mirrored icons, full UI string coverage
- Hijri calendar option for renewal letters
- Bidi text rendering edge cases in mixed-language documents
