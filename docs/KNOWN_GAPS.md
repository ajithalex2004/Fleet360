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
**Status:** in progress · **Target:** before go-live · **Owner:** athom

`.env.test` (gitignored) contains a real Neon Postgres password
(`npg_7ndWFKRYEOt6`). The credential has lived in the OneDrive-synced project
folder for 4+ months, which is not the same threat model as plain text on the
network but is broader than acceptable for a production DB credential.

**2026-09-15 update:** the same class of exposure was also committed to
source (not just the gitignored `.env.test`), in three places, and has been
removed:
- `tests/test-utils.ts`, `tests/integration/staging-acceptance.test.ts`, and
  `tests/integration/logistics-tenant-isolation-controlled.test.ts` all had
  the `fleet360_app` staging connection string hard-coded as a fallback
  default. They now require `STAGING_DATABASE_URL` /
  `RUNTIME_DIRECT_DATABASE_URL` to be set explicitly and skip (or fail
  loudly) instead of silently using a baked-in credential.
- `.github/workflows/staging-acceptance-gate.yml` had a *second*, more
  privileged credential (`neondb_owner`) hard-coded as the fallback when the
  `STAGING_DATABASE_URL` repo secret wasn't set. That fallback is removed;
  the workflow now fails fast with a clear error if the secret is missing.

**Still required before go-live:** regenerate both Neon credentials
(`fleet360_app` and `neondb_owner`) in the Neon console, then update
`.env.test` (and any other local `.env*` files) and the `STAGING_DATABASE_URL`
GitHub secret with the new values. Removing the hard-coded fallbacks does not
rotate the credentials themselves — both strings are still valid until
rotated, and both were sitting in this repo's history, so treat them as
compromised.

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
