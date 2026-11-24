# Fleet360 Production Release Evidence Document

---

## Latest Release Entry — 2026-11-20 (PR #253 Baseline & Driver-App Security Release)

**Ledger Updated:** 2026-11-20  
**Release Scope:** [PR #253](https://github.com/ajithalex2004/Fleet360/pull/253) (`claude/fix-main-ddl-driver-leak` @ `d933c2075dbc9b4bd912f607f5d1f8bd44d29769` → merged into `main` at **`997526a48e7dffc9923e64e050991287c5dee69d`**, `2026-11-20T11:48:24Z`) — **PRODUCTION RELEASE VERIFIED**  
**CI Gate Result:** **22/22 GitHub Actions jobs PASS** on `d933c207`, including isolated CI `Gate 2` (`5/5` phases / `21/21` Drayage & Driver App Playwright checks against a fresh Postgres 16 container + Next.js production build under `fleet360_app` with zero inline credentials).  
**Superseded PRs:** [PR #255](https://github.com/ajithalex2004/Fleet360/pull/255) closed as superseded after production verification.  
**Seven-Day Soak Window:** Started `2026-11-20` (monitor frontend/backend errors, DB connectivity, auth failures, tenant isolation, and unexpected restarts; manual authenticated login + driver/dispatch/finance sanity check recommended).

### A. Controlled Production Migration Rollout (`2026-11-20T11:47Z`, Executed Before Merge)

| Check | Verified Evidence |
| :--- | :--- |
| **Target Database** | Neon `production` branch (`br-delicate-dream-a1gtfy8e`), endpoint `ep-calm-heart-a15voo2a.ap-southeast-1.aws.neon.tech`, DB `neondb`, `PostgreSQL 17.11` |
| **Migration Applied** | `20261113090000_tenant_einvoice_columns_and_carrier_broadcast_tables` (`started_at: 2026-11-20T11:47:05.141Z`, `finished_at: 2026-11-20T11:47:05.650Z`, `509ms`, `applied_steps_count: 1`) |
| **WAL LSN Delta** | Pre-migrate `0/6A9B3CF0` → Post-migrate `0/6A9BDDE8` *(recovery branch `pre-af837401-20261119` / `br-morning-shadow-a17ch9ux` active through `2026-11-30 05:20 +04:00`)* |
| **`prisma migrate status`** | `242` local migration directories; `270` rows in `_prisma_migrations` (`245` finished, `25` rolled back, **`0` active unresolved**) — **`Database schema is up to date!`** |
| **Schema & Policy Verification** | `tenants` PEPPOL columns: `14/14` present; `esign_requests.failed_attempts`: `integer NOT NULL DEFAULT 0`; all 4 carrier/broadcast tables (`logistics_carrier_app_devices`, `logistics_carrier_presence`, `logistics_load_broadcasts`, `logistics_load_broadcast_offers`) verified with `ENABLE` + `FORCE ROW LEVEL SECURITY`, tightened `tenant_isolation` policies (no `IS NULL` escape), and `SELECT/INSERT/UPDATE/DELETE` granted to `fleet360_app` |
| **Effective RLS & Role Separation** | `node scripts/check-rls-effective.mjs --role fleet360_app`: **`exit 0`** across `410` tenant-owned tables (`409 SCOPED`, `1 DENIED`, `0` violations; `NULLABLE_ESCAPE_DEAD` reduced from `80` → `76`). `fleet360_app` verified `rolsuper=false`, `rolbypassrls=false`, and `INSERT/UPDATE/DELETE/TRUNCATE` all `false` on `_prisma_migrations` |

### B. Live Railway Production Deployment Verification (`2026-11-20T11:48–11:57Z`)

- **`fleet360-app` (`40e64e58-f468-4ebe-9412-99cd5af910aa`):**
  - Active Deployment: `acbed78a-225f-4331-950e-66e61916469f` (`SUCCESS`, `2026-11-20T11:48:26.453Z`, commit `997526a48e7dffc9923e64e050991287c5dee69d`)
  - Image Digest: `sha256:c5873e0bcb79b0ec6c106d983b000e4fb1dbe7f7c34e92e5c840a5557bd4384a` (`Ready in 1007ms`, zero startup/runtime errors)
  - Owner Credential Boundary: **CLOSED / PASS** — `DIRECT_URL`, `DIRECT_DATABASE_URL`, and `MIGRATION_DATABASE_URL` verified absent from production `fleet360-app`.
- **`fleet360-backend` (`6b454bef-fec5-4840-acc5-edd8473c8f03`):**
  - Active Deployment: `829b49ab-dd3a-41c7-bd93-f38471b48af6` (`SUCCESS`, `2026-11-20T11:48:26.454Z`, commit `997526a48e7dffc9923e64e050991287c5dee69d`)
  - Image Digest: `sha256:10d02d86fbd4536f880b60d35093b85b35aeda35f28295c9bf1fe375f2d05a1c` (`phasegate: cross-tenant isolation VERIFIED`, `object store ready`, `/healthz 200`, `/readyz 200`)
- **`staging` (`909ab1b4-55e8-4089-bdc3-29dd89ae4991`):** Both `fleet360-app` (`3e4582f0-6c81-4080-aa0d-b9da3d812f07`) and `fleet360-backend` (`ff98ccdf-5091-449a-a9e5-a6c57c94ee5e`) deployed `997526a4` with `SUCCESS`; post-deploy `railway config plan --detailed-exit-code` exited `0` (zero IaC drift).
- **Live Production Probes (`2026-11-20T11:57Z`):**
  - `GET /api/readyz` → **`200 OK`** (`status: "ready"`, `version: "997526a48e7dffc9923e64e050991287c5dee69d"`).
  - `GET /api/health` → **`200 OK`** (`status: "degraded"`, `release: "997526a48e7dffc9923e64e050991287c5dee69d"`, `db: { status: "connected", latencyMs: 6 }`, `schema: { status: "ok", missing: 0 }`, `storage: { backend: "s3", durable: true, ok: true }`, `services: { goBackend: "ok" }`, `backend: { status: "ready", version: "997526a48e7dffc9923e64e050991287c5dee69d" }`, `missingConfig: ["stripe", "sendgrid", "sentry"]`).
  - Unauthenticated API boundaries verified fail-closed (`/api/driver-app/auth/vehicle-login?list=true` → `200 {"hasSession":false}`, `/api/driver-app/today/assignments`, `/api/drivers`, `/api/logistics/drayage`, `/api/admin/company-profile`, `/api/finance/dashboard` → `401`, `/api/esign/verify` without token → `400 signingToken is required`).

### C. Re-Verified Pre-Cutover Production IaC Plan (`2026-11-20`, Read-Only — Gate 3 ON HOLD)

Re-captured on `chore/railway-iac-migration` rebased onto `997526a4` against `production` (`7dd6e11e-dae2-46c1-b4c6-6ee24441de4d`; no changes applied; CLI immediately re-linked to `staging`):

- **Plan Kind / CLI Version:** `railway.config.plan` v1 (`railway 5.62.1`), `destructive: false`, `claim: true`, `diagnostics: []`
- **Plan File SHA-256:** `A16D4F9E87EE2BEC047502364CBDDB9F684E558AB379DBD3A848EC89F0F69D3C` *(identical to pre-PR-#253 baseline plan)*
- **`configEtag`:** `b1323e003e4eb0f920518685a1802ed30072516aa274b05939f33fc31aa1d499` *(zero production config drift)*
- **`changeSetHash`:** `sha256:30f74e93871ba28d1e78f8de47dadbd268c07621905247e6cc711ed940cf3e88`
- **Proposed Non-Destructive Changes (`0 to add, 2 to change, 0 to destroy`):**
  1. `service.fleet360-app` (`resources.service.fleet360-app.deploy`, `severity: safe`, `deployEffect: deploy`): `deploy.startCommand (null → "npm start")`
  2. `service.fleet360-backend` (`resources.service.fleet360-backend.build`, `severity: safe`, `deployEffect: deploy`): `build.builder (null → "DOCKERFILE")`, `build.dockerfilePath (null → "/backend/Dockerfile")`
- **Deadlines:** Neon recovery branch `pre-af837401-20261119` expires **`2026-11-30 05:20 +04:00`**; Railway Config-as-Code (`railway.json`) deadline is **`2026-12-01`**.

---

## Previous Release Entry — 2026-11-19 (M5-R7 Production Release & Operational Follow-Ups)

**Ledger Updated:** 2026-11-19  
**Certification Scope:** Milestone M5-R7 (`af837401239a1d36cb3149e2f1ebc3a353b4d556`) — **VICTORY CONFIRMED (GO FOR PRODUCTION)** *(closed; operational follow-ups below do not reopen M5-R7 certification)*  
**Verification Method:** Live introspection of Railway `production` & `staging` environments (`railway status --json`, `railway environment config`), Git commit history, and live HTTP probes (`/api/health`, `/api/readyz`).

### A. Commit Chain & Live Production Alignment

| Role | Commit SHA | Timestamp (+04:00) | Subject |
| :--- | :--- | :--- | :--- |
| **M5-R7 Certified Baseline** | `af837401239a1d36cb3149e2f1ebc3a353b4d556` | `2026-11-18T16:02:46+04:00` | `fix(security,finance): remediate PG17 RLS/index isolation and financial transaction integrity (M5-R7)` |
| **Release Config Fix 1** | `9a825d801a4a88b2025219b96601b06b50f6203e` | `2026-11-19T05:12:12+04:00` | `chore(release): separate railway web startCommand from controlled prisma migrations` |
| **Live Production Release** | `b52e6060c7b49869769200ea5241089a23870bcd` | `2026-11-19T05:39:04+04:00` | `chore(release): use RAILPACK builder in railway.json for NODE_ENV=production builds` |

### B. Priority 1 — Neon Pre-Release Recovery Branch & Snapshot Ledger

> [!NOTE]
> **Retention Extended & Parent Branch Reconciled (`2026-11-19` via Neon Console):**
> - Recovery branch `pre-af837401-20261119` (`br-morning-shadow-a17ch9ux`) expiration was extended in Neon Console from `2026-11-20 05:20:42 +04:00` to **`2026-11-30 05:20 +04:00` (`2026-11-30T01:20Z`)**, covering the full 7-day production soak window.
> - **Parent-branch reconciliation resolved:** Neon Console confirms the actual default/parent production branch in project `Fleet360` (`ancient-cherry-30776376`) is **`production`** (`br-delicate-dream-a1gtfy8e`, `Expires: Never`, created `2025-04-22 07:23:51 +04:00`), superseding the stale 2026-09-10 baseline reference to `main` (`br-long-pine-a1b7tq46`).
> - *Optional final check:* Hover/click the `LSN` badge next to `Parent branch: production` on `pre-af837401-20261119` Overview to visually confirm `0/69A21EF0` matches the recorded value below.

| Field | Recorded Value | Verification / Notes |
| :--- | :--- | :--- |
| **Neon Project** | `Fleet360` (`ancient-cherry-30776376`) | `AWS Asia Pacific 1 (Singapore)`, `Launch plan`, `4` branches |
| **Recovery Branch Name** | `pre-af837401-20261119` | Pre-M5-R7 production recovery branch |
| **Actual Neon Branch ID** | `br-morning-shadow-a17ch9ux` | Verified `2026-11-19` via Neon Console Settings & Overview |
| **Parent / Default Branch Name & ID** | `production` (`br-delicate-dream-a1gtfy8e`) | **RECONCILED** (`Expires: Never`, created `2025-04-22 07:23:51 +04:00`, `6 databases, 1 compute`; supersedes stale 2026-09-10 `main` / `br-long-pine-a1b7tq46`) |
| **Live Production Neon Endpoint** | `ep-calm-heart-a15voo2a` (`ap-southeast-1.aws.neon.tech`, DB `neondb`, role `fleet360_app`) | Verified `2026-11-19` via production `DATABASE_URL` & `RUNTIME_DIRECT_DATABASE_URL` hostnames |
| **Original WAL LSN** | `0/69A21EF0` | Reported pre-migration WAL point on `production` (`LSN` indicator present on `pre-af837401-20261119` Overview; optional tooltip capture to double-confirm exact string) |
| **Subsequent Migrations Applied** | `20261118100000_m5_r7_rls_and_index_integrity`, `20261118120000_drop_legacy_customers_code_key` | `241` total local migration directories in `prisma/migrations/` |
| **Branch Created At** | `2026-11-19 05:20:45 +04:00` (`2026-11-19T01:20:45Z`) | Created by `Ajith Alex` (between commits `9a825d80` and `b52e6060`) |
| **Updated `expires_at` / Retention** | **`2026-11-30 05:20 +04:00` (`2026-11-30T01:20Z`)** *(extended from `2026-11-20 05:20:42 +04:00`)* | Verified `2026-11-19` in Neon Console Settings → General (`Not protected` while TTL is active) |
| **Post-Change Availability Check** | **ACTIVE** | Branch remains active in project `Fleet360` (`4` branches) after TTL extension |

### C. Live Railway Production Runtime Verification (`2026-11-19`)

- **Railway Project:** `fleet360-railway` (`ac5b8297-816b-44d3-bb61-41f079e92faa`)
- **Production Environment:** `production` (`7dd6e11e-dae2-46c1-b4c6-6ee24441de4d`, region `asia-southeast1-eqsg3a`)
- **`fleet360-app` (`40e64e58-f468-4ebe-9412-99cd5af910aa`):**
  - Active Deployment: `fdf2b1bd-22c1-45a3-a9d9-4a0f13395f12` (`SUCCESS`, `2026-11-19T01:39:15.030Z`, commit `b52e6060c7b49869769200ea5241089a23870bcd`)
  - Image Digest: `sha256:2dfdf07f4ed9de44e559c32f1e315ac427f877511c04cbae84a5d76dd6231a38` (Railpack `0.43.0`, Node `22.23.4`)
  - Owner Credential Boundary: **CLOSED / PASS** — `DIRECT_URL`, `DIRECT_DATABASE_URL`, and `MIGRATION_DATABASE_URL` verified absent from production `fleet360-app` environment variables (runtime uses restricted `fleet360_app` role via `DATABASE_URL` / `RUNTIME_DIRECT_DATABASE_URL`).
- **`fleet360-backend` (`6b454bef-fec5-4840-acc5-edd8473c8f03`):**
  - Active Deployment: `0d5c07fd-c18f-4495-8a1c-f0515d724837` (`SUCCESS`, `2026-11-19T01:39:15.030Z`, commit `b52e6060c7b49869769200ea5241089a23870bcd`)
  - Image Digest: `sha256:1c3922dab4dfc123f78ccaf5ccd3a3b30956b312f8254c6e4f9a84c8a0a7c417` (Dockerfile `/backend/Dockerfile`, healthcheck `/healthz`)
- **Live Production Probes (`2026-11-19T09:08–09:32Z`):**
  - `GET https://fleet360-app-production.up.railway.app/api/readyz` → **`200 OK`** (`status: "ready"`, `version: "b52e6060c7b49869769200ea5241089a23870bcd"`).
  - `GET https://fleet360-app-production.up.railway.app/api/health` → **`200 OK`** (`status: "degraded"`, `db: { status: "connected" }`, `schema: { status: "ok", missing: 0 }`, `storage: { backend: "s3", durable: true, ok: true }`, `services: { goBackend: "ok" }`, `backend: { status: "ready", version: "b52e6060c7b49869769200ea5241089a23870bcd" }`, `missingConfig: ["stripe", "sendgrid", "sentry"]`).

### D. Operational Follow-Up Track (Post-M5-R7)

| Priority | Initiative | Status | Evidence / Guardrail |
| :--- | :--- | :--- | :--- |
| **Priority 1** *(Immediate)* | Preserve Neon branch `pre-af837401-20261119`, reconcile parent branch & WAL LSN `0/69A21EF0` | **Retention Extended & Reconciled (`Expires 2026-11-30 05:20 +04:00`)** | Extended TTL by 10 days (`br-morning-shadow-a17ch9ux`, created `2026-11-19 05:20:45 +04:00`) and reconciled parent branch as `production` (`br-delicate-dream-a1gtfy8e`) in project `Fleet360` (`ancient-cherry-30776376`). Optional 5-second visual check on `LSN` tooltip to double-confirm `0/69A21EF0`. |
| **Priority 2** *(Before Dec 1)* | Railway IaC migration (`.railway/railway.ts`) via controlled PR | **Staging Verified / Production Cutover Held Pending Approval** | Isolated branch `chore/railway-iac-migration` (`package.json` + `package-lock.json` updated with `railway@3.17.0` devDependency and `@prisma/client` lockfile alignment; `railway.json` removed; `38/38` parity/governance unit tests passing). Staging (`909ab1b4-55e8-4089-bdc3-29dd89ae4991`) applied & deployed (`fleet360-app` `3d880519-2c46-4d56-994d-c15af0a92e97`, `fleet360-backend` `53246304-b7e6-499b-8661-89c222537560`, both `SUCCESS`; post-apply drift exit `0`). Verbatim production plan retained in §E below. |
| **Priority 3** *(Planned)* | Optional integrations (`stripe`, `sendgrid`, `sentry`) | **Planned / Failure Isolation Audited (Workflow Acceptance Pending)** | Zero placeholder credentials; `/api/health` explicitly reports `status: "degraded"` (`missingConfig: ["stripe", "sendgrid", "sentry"]`). Code audit confirms `/api/readyz` and core dispatch/fleet/finance routes do not require them (`src/lib/sentry.ts` no-ops/swallows on 2 s timeout; `src/lib/email.ts` falls back to platform SMTP or returns non-throwing `EmailSendResult`; `src/lib/billing.ts` is lazy-init with explicit `503`/`402` route guards). End-to-end workflow impact testing + Sentry prioritization remain tracked separately. |

### E. Retained Pre-Cutover Production IaC Plan Evidence (`2026-11-19`, Read-Only)

Captured via `railway config plan --verbose` against `production` (`7dd6e11e-dae2-46c1-b4c6-6ee24441de4d`) on branch `chore/railway-iac-migration` (no changes applied to production; CLI immediately re-linked to `staging`):

```text
Railway configuration
Using \\?\C:\Dev\Fleet360\.railway\railway.ts
Project fleet360-railway
Environment production
Project ID ac5b8297-816b-44d3-bb61-41f079e92faa

Plan: 0 to add, 2 to change, 0 to destroy
  ~ Update fleet360-app deploy.startCommand
    └ deploy.startCommand (null → "npm start")
  ~ Update fleet360-backend build.builder, build.dockerfilePath
    └ build.builder (null → "DOCKERFILE")
    └ build.dockerfilePath (null → "/backend/Dockerfile")
```

> [!WARNING]
> **Production Cutover Ordering (GitHub Auto-Deploy):** Both Railway `production` services track `ajithalex2004/Fleet360` branch `main`, so merging a PR to `main` automatically triggers production deployments. Do **not** merge `chore/railway-iac-migration` until the authorized production maintenance window; inside that window, apply the pinned production IaC plan (`railway config plan --out prod-plan.json` → `railway config apply --plan prod-plan.json`) immediately before merging so `fleet360-app.deploy.startCommand` and `fleet360-backend.build.dockerfilePath` are already persisted before `railway.json` is removed from `main`.

---

## Historical Baseline — 2026-09-10

**Execution Date:** 2026-09-10  
**Generated By:** Antigravity Production Gate Engine  
**Verification Method:** Live introspection of Railway production runtime, GitHub repository API/CLI, Neon PostgreSQL direct/pooled connections, and GitHub Actions telemetry. *(No Markdown status logs relied upon).*

---

## 1. Executive Summary & Acceptance Gate

| Acceptance Criterion | Verification Status | Exact Runtime Truth |
| :--- | :---: | :--- |
| **Production commit known** | **VERIFIED** | `e02eaa4fa8b834a9374acc0931f9e90fee754992` (Live active deployment `1f7939ab-b436-43ce-b02b-620a459484fe` serving from `origin/main`). Application code deployment remained unchanged. |
| **Database branch known** | **VERIFIED** | Neon Branch: `main` (`br-long-pine-a1b7tq46`), Endpoint: `ep-calm-heart-a15voo2a`. **Note: Production database changed via migration `20260910000038_service_case_costs_rls`**. |
| **Connected role known** | **VERIFIED** | Runtime Role: `fleet360_app` (`rolsuper=false`, `rolbypassrls=false`); Migration/DDL Role: `neondb_owner` (`rolsuper=false`, `rolbypassrls=true`) |
| **Migration state known** | **VERIFIED** | **133 finished successfully** (including `20260910000038_service_case_costs_rls`); **28 rolled back/resolved**; **0 active unresolved**; **38 zero-step records**; `prisma migrate status` clean (132 local directories; +1 consolidated in DB) |
| **Last scheduler execution known** | **VERIFIED** | **2026-09-10 07:41:19 UTC** (GitHub Actions scheduled cron run `34451208643` for Fleet Documents Sweep; succeeded in 3m 27s). *Complete Leasing automation coverage remains unverified pending job-by-job execution evidence.* |

---

## 2. Source Control & Deployment Alignment

### Git Commits
- **Production Commit SHA:** `e02eaa4fa8b834a9374acc0931f9e90fee754992`
  - **Branch:** `origin/main`
  - **Author:** `ajithalex2004 <alex@exlsolutions.ae>`
  - **Date:** `2026-09-10 11:43:18 +04:00` (07:43:18 UTC)
  - **Subject:** `feat(nav): move Service & Support Ticket Hub under Core Fleet Operations`
  - **Confirmation:** HTTP live inspection of `https://fleet360-app-production.up.railway.app/platform` and chunk `app/platform/page-4132b6392fa7f1bc.js` confirms the presence of `Service & Support Ticket Hub` and its operations subpages.
- **Staging Commit SHA:** `af67e03258e2b081c69a8bd35a55a558a747599d`
  - **Branch:** `origin/staging`
  - **Relationship:** Behind `main` by 18 commits (lacks recent service-ticket hardening and navigation updates).
  - **Subject:** `feat(ui): remove floating chat widget and remove chat-widget from Conversational Agents ecosystem`
- **Current Working Branch Commit SHA:** `8ab5173177e622a292f59ed24857f77f5b4c55ed`
  - **Branch:** `railway-migration` (`origin/railway-migration`)
  - **Relationship:** 2 commits ahead of `origin/main` containing AI platform quota and governance work.

### Active Railway Service & Environment
- **Railway Project Name:** `fleet360-railway`
- **Railway Project ID:** `ac5b8297-816b-44d3-bb61-41f079e92faa`
- **Active Environment:** `production` (`7dd6e11e-dae2-46c1-b4c6-6ee24441de4d`)
- **Active Service:** `fleet360-app` (`40e64e58-f468-4ebe-9412-99cd5af910aa`)
- **Active Deployment ID:** `1f7939ab-b436-43ce-b02b-620a459484fe`
  - **Status:** `SUCCESS`
  - **Created At:** `2026-09-10T09:18:21.594Z`
  - **Image Digest:** `sha256:33110cd8b129e6da40cbc4de2ba35e78ba66d11343efbabbbd65acd0d0b010ce`
  - **Domain:** `fleet360-app-production.up.railway.app`
  - **Runtime:** Railway V2 / Railpack Node.js `22.23.2` / Next.js 15 App Router

---

## 3. Database Topology, Branches & Roles

Introspected directly from live connection strings in Railway environment variables and `pg_roles`:

- **Database Name:** `neondb`
- **Neon Region & Host:** `ap-southeast-1.aws.neon.tech`
- **Neon Endpoint ID:** `ep-calm-heart-a15voo2a` (Compute: `ep-calm-heart-a15voo2a`, Pooler: `ep-calm-heart-a15voo2a-pooler`)
- **Neon Branch Name:** `main` (Default branch, Branch ID: `br-long-pine-a1b7tq46`)
- **PostgreSQL Version:** `PostgreSQL 16.8 on x86_64-pc-linux-gnu`

### Direct Role Inspection Results (`pg_roles`)

```json
[
  {
    "rolname": "fleet360_app",
    "rolsuper": false,
    "rolbypassrls": false,
    "rolcreaterole": false,
    "rolcreatedb": false
  },
  {
    "rolname": "neondb_owner",
    "rolsuper": false,
    "rolbypassrls": true,
    "rolcreaterole": true,
    "rolcreatedb": true
  }
]
```

- **Runtime Application Role (`fleet360_app`):**
  - Configured in `DATABASE_URL` (via PgBouncer pooler) and `RUNTIME_DIRECT_DATABASE_URL` (direct compute connection).
  - Unprivileged application role with `rolsuper = false` and `rolbypassrls = false`. Row-level security is enforced on every query executed under this role.
- **Controlled DDL / Migration Role (`neondb_owner`):**
  - Configured in `DIRECT_URL`.
  - **Database-owner role used for controlled migrations and DDL**. It holds `rolbypassrls = true`, `rolcreaterole = true`, `rolcreatedb = true`, but is **NOT** a PostgreSQL superuser (`rolsuper = false`).

---

## 4. Applied Migrations State

Extracted directly from `_prisma_migrations` and cross-referenced with `prisma/migrations` on commit `e02eaa4fa8b834a9374acc0931f9e90fee754992`:

- **Total Records in `_prisma_migrations`:** `160`
- **Finished Successfully:** `132`
- **Rolled Back / Resolved:** `28` (`rolled_back_at IS NOT NULL`)
- **Active Unresolved:** `0` (`finished_at IS NULL AND rolled_back_at IS NULL`)
- **Zero-Step Records:** `38` (28 rolled back + 10 zero-step baseline placeholder records)
- **Local Repository Migration Directories:** `131` directories in `prisma/migrations/` (136 total entries including 5 auxiliary non-migration `.sql` / `.toml` utility files).
- **Explanation of 131 Local Directories vs 132 DB Records:**
  - One historical migration, `20260902000000_p0_asset_tables_rls_direct`, finished successfully in the database on 2026-08-24 (`finished_at = 2026-08-24T09:30:41.073Z`, 1 step).
  - Its SQL statements were subsequently consolidated into the canonical baseline migrations during the Phase 0 hardening refactor, so no separate directory remains in `prisma/migrations/`.
  - Prisma recognizes this history cleanly: `npx prisma migrate status` reports `Database schema is up to date!` with zero pending migrations.

### Latest 10 Successfully Finished Migrations:
1. `20260910000028_leasing_portal_and_selfservice_tables_and_rls` (`2026-09-08T09:39:13.781Z`)
2. `20260910000029_service_tickets_tables_and_rls` (`2026-09-08T09:39:14.442Z`)
3. `20260910000030_shipper_portal_tables_and_rls` (`2026-09-08T09:39:15.122Z`)
4. `20260910000031_sso_table_and_rls` (`2026-09-08T09:39:15.796Z`)
5. `20260910000032_workflow_tables` (`2026-09-08T09:39:16.486Z`)
6. `20260910000033_service_config_engine_tables` (`2026-09-08T09:39:17.157Z`)
7. `20260910000034_logistics_domain_tables` (`2026-09-08T09:39:17.806Z`)
8. `20260910000035_add_exchange_partner_settlement_tables` (`2026-09-08T10:24:58.616Z`)
9. `20260910000036_add_finance_payables_table` (`2026-09-08T10:49:44.080Z`)
10. `20260910000037_add_toll_transactions_and_purchase_orders` (`2026-09-08T11:06:03.394Z`)

---

## 5. CI Results

### A. Production Baseline (`origin/main` at `e02eaa4fa8b834a9374acc0931f9e90fee754992`)

| Workflow Name | Run ID | Status | Conclusion | Duration |
| :--- | :--- | :--- | :--- | :--- |
| **CI** | `34453082500` | completed | **FAILURE** | 1m 22s |
| **Phase 0 — Cross-tenant isolation tests** | `34453082380` | completed | **FAILURE** | 4m 37s |
| **Tenant Safety Contract Enforcement** | `34453082363` | completed | **FAILURE** | 27s |
| **Tenant RLS Compliance Check** | `34453082357` | completed | **FAILURE** | 15s |
| **Build Check** | `34453082375` | completed | **SKIPPED** | 1s |

### B. Hardening Baseline (`hardening/ci-security-baseline` at `d1917eb529731671239850e334c441a1532eead4`)

| Workflow Name | Run ID | Status | Conclusion | Duration | Notes / Evidence |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **Tenant Safety Contract Enforcement** | `34518252524` | completed | **SUCCESS** | 24s | 0 unclassified findings; all 60 API route handlers accounted for |
| **Tenant RLS Compliance Check** | `34518252558` | completed | **SUCCESS** | 19s | 0 unclassified findings; all 51 route handlers accounted for |
| **Phase 0 — Cross-tenant isolation tests** | `34518252684` | completed | **SUCCESS** | 3m 17s | Go cross-tenant suite, TypeScript RLS suite, and SQL syntax checks all pass |
| **Build Check** | `34518252608` | completed | **SUCCESS** | 4m 31s | Node 20.x & Node 22.x matrix builds completed cleanly |
| **CI** | `34518252565` | completed | **SUCCESS** | 5m 47s | Full unit, integration, and lint suites (including new quotation tests) passed cleanly |

> [!NOTE]
> **Commit Progression on `hardening/ci-security-baseline`:**
> - `2dd2924295e8e81561f5926ec0fe6819eb31593c`: Core code and CI workflow repairs (All 5 runs green: 34513885858, 34513885939, 34513885898, 34513885984, 34513885962).
> - `c670ff4672e811c765fae3e4cfec2cf93bdafb37`: Release evidence documentation update (All 5 runs green: 34515705336, 34515705273, 34515705300, 34515705345, 34515705279).
> - `d1917eb529731671239850e334c441a1532eead4` (*Final Candidate*): Added empty-array safeguard in `withSystemJob`, unit tests in `tenant-rls-helpers.test.ts`, and unit tests in `leasing-quotation.test.ts` (All 5 runs green: 34518252524, 34518252558, 34518252684, 34518252608, 34518252565).

---

## 6. Scheduled Jobs Execution (Last 7 Days)

Introspected via GitHub Actions schedule history, runtime application logs, and PostgreSQL job tables:

### 1. External Cron Orchestration (GitHub Actions)
- **Workflow:** `Fleet documents sweep (cron)` (`.github/workflows/cron-fleet-documents.yml`)
- **Schedule:** Runs daily at ~07:30 UTC
- **Execution Log (Past 7 Days):**
  - `2026-09-10T07:41:19Z` — Run ID `34451208643` — **SUCCESS** (3m 27s)
  - `2026-09-09T07:42:27Z` — Run ID `34325224661` — **SUCCESS** (3m 16s)
  - `2026-09-08T07:36:43Z` — Run ID `34200199575` — **SUCCESS** (2m 54s)
  - `2026-09-07T07:43:35Z` — Run ID `34096881484` — **SUCCESS** (2m 52s)
  - `2026-09-06T07:26:59Z` — Run ID `34019174943` — **SUCCESS** (2m 30s)
  - `2026-09-05T07:14:46Z` — Run ID `33952010515` — **SUCCESS** (2m 22s)
  - `2026-09-04T07:33:51Z` — Run ID `33849305060` — **SUCCESS** (2m 20s)

### 2. In-Process Runtime Scheduler (`src/lib/jobs/scheduler.ts`)
- **Status:** Integrated into Next.js startup via `src/instrumentation-node.ts`.
- **Active Cron Triggers:** Dispatches POST calls to `/api/jobs/run?job=<name>` (e.g. `outbox-publisher`, `auto-close-trips`, `push-scheduler`, `document-expiry-sweep`).
- **Database Evidence of Job Runs:**
  - **`event_outbox` Publishing:** 5 rows completed and published in batch (e.g. `trip.completed` events processed by outbox publisher).
  - **AI Agent Runs (`public.agent_runs`):** 87 runs recorded in the last 7 days (most recent: `2026-09-10T02:06:23.824Z` for `demand-forecasting` and `incident-triage`).
  - **Audit Logs:** 14 audit log records created during the last 7 days.

> [!WARNING]
> **Complete Leasing automation coverage remains unverified pending job-by-job execution evidence.**  
> While the scheduler infrastructure and document sweeps are operating, specific Leasing sweeps (e.g., dunning, rental renewals, penalty sweeps, periodic billing sweeps) require individual proof of invocation and non-duplication in staging.

> [!CAUTION]
> **Dunning & collections automated dispatch remains BLOCKED for production as of 2026-09-12 — `DUNNING_DISPATCH_ENABLED` must stay unset/disabled in every environment, including staging, until the sequence below completes.**  
> A prior status of "verified in staging" (referenced externally as "Checkpoint 2") was investigated on 2026-09-11 against this repository's actual state and found unsupported (see the original finding, preserved below for the audit trail). The five gaps that finding identified have since been redesigned and implemented against real Postgres (`src/lib/finance/dunning-dispatch.ts`, `dunning-transition.ts`, `src/events/consumers/dunning-notice.consumer.ts`, `src/lib/jobs/dunning-sweep.ts`, `dunning-reconciliation.ts`, migration `20260911180000_dunning_collections_workflow`):
> - **Outstanding-balance divergence** — fixed: the sweep now reads the canonical balance via `getInvoiceOutstandingBalance`, the same function `invoice-balance.ts` exposes for payment/deposit accounting elsewhere.
> - **No suppression mechanism** — fixed: `LeaseDunningSuppression` (CUSTOMER/INVOICE/CONTRACT scope, DB `CHECK` constraint on scope/target consistency) is checked by the sweep, the pre-dispatch recheck, and the legal-referral approval route.
> - **No persisted stage machine** — fixed: `LeaseInvoice.currentDunningStage`/`dunningCollectionCycle` plus append-only `LeaseDunningStageTransition` (DB-level `REVOKE UPDATE, DELETE` from `fleet360_app`, verified via `information_schema.role_table_grants`); `LEGAL_REFERRAL` is reachable, gated on a `FINAL_NOTICE` that actually reached `SUBMITTED` at least 14 days earlier plus an explicit, permission-checked approval (`LeaseDunningLegalApproval`).
> - **No dispatch-safety gate** — fixed: `DUNNING_DISPATCH_ENABLED` (opt-in) and transport availability are checked before any claim; a closed gate marks the attempt `DEFERRED` (paused, resumable) rather than dropping or silently mock-sending it; `DUNNING_STAGING_RECIPIENT_OVERRIDE` is required and fails closed whenever the environment isn't `APP_ENV=production`.
> - **Synthetic contract auto-creation** — fixed: contract association is now a best-effort lookup only; an unresolved contract stays `null` with a captured warning, never a fabricated `LeaseContract2` row.
>
> New code has full local verification: `tests/unit/dunning-transition.test.ts` (29 tests), `tests/unit/dunning-notice-consumer.test.ts` (14 tests), and `tests/integration/dunning-collections-postgres.test.ts` (11 tests against real Postgres, including the five decisive tests named in the design plan: gate-off-then-recovery send, missing-transport-then-recovery, concurrent due-enqueue race, the send-attempt cap, and reconciliation racing a late outcome write) all pass locally as of 2026-09-12. **What has not yet happened**: (1) this has not yet run in CI (job `dunning-collections-integration` added to `phase0.yml` in this change, not yet exercised by a merged PR), and (2) no staging run with `DUNNING_STAGING_RECIPIENT_OVERRIDE` configured has produced the required observable evidence (a real `SUBMITTED` notice landing in the override inbox for synthetic data, and zero transport calls for a suppressed/settled/disputed synthetic invoice in the same run). Per the design plan's release-gate sequence, production `DUNNING_DISPATCH_ENABLED` may only be considered once both of those have passed — never as an automatic consequence of merging this change or of staging having it enabled.
>
> <details><summary>Original 2026-09-11 finding (superseded by the implementation above, preserved for audit trail)</summary>
>
> `scripts/staging-live-smoke.mjs` (added 2026-09-11, not wired into CI, no evidence of having been run) only asserted same-day database-row idempotency for a single invoice — it did not test notification suppression despite its docstring, and did not exercise the financial-correctness path. The sweep hardcoded `paidAmount: null` for every invoice; had no suppression/opt-out mechanism at any layer; recomputed stage from days-overdue on every run rather than tracking/transitioning it, with `LEGAL_REFERRAL` unreachable; had no dispatch-safety gate (whether an email sent or silently mock-logged depended entirely on ambient SMTP configuration); and could fabricate a placeholder `LeaseContract2` row as a side effect of sending a dunning activity when no real contract match existed.
> </details>

---

## 7. Evidence Validity & Invalidation Conditions

This evidence document is valid as of **2026-09-10 15:00 UTC** for Railway Deployment `1f7939ab-b436-43ce-b02b-620a459484fe` and Commit `e02eaa4fa8b834a9374acc0931f9e90fee754992`.

This evidence **must be invalidated and re-evaluated** upon any of the following triggers:
1. **A new deployment** to the Railway `production` environment;
2. **A database branch change** or migration applied to Neon branch `main` (`br-long-pine-a1b7tq46`);
3. **A database role or privilege change** on `fleet360_app` or `neondb_owner`;
4. **A database secret or token rotation** (including `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET`);
5. **A migration status change** or application of pending raw SQL schemas;
6. **A scheduler configuration change** (e.g., changes to `src/lib/jobs/scheduler.ts` or GitHub Actions crons).

---

## 8. Gate Sign-Off Table

| Gate | Owner | Status | Direct Evidence | Re-verification Trigger |
| :--- | :--- | :---: | :--- | :--- |
| **Production Baseline** | Hardening Engineer | **PASS** | Railway deployment `1f7939ab-b436-43ce-b02b-620a459484fe` matched to commit `e02eaa4fa8b834a9374acc0931f9e90fee754992` | New deployment / commit pushed |
| **Runtime Role Security** | Security Engineer | **PASS** | `pg_roles` shows `fleet360_app` has `rolsuper=false`, `rolbypassrls=false` | Database user/grant change |
| **Owner Credential Boundary** | Platform Engineer | **PARTIAL** | `neondb_owner` (`rolbypassrls=true`) is currently exposed in `DIRECT_URL` on long-running web service | Removal of `DIRECT_URL` from runtime service |
| **Migration Consistency** | Database Engineer | **PASS** | `_prisma_migrations` has 133 finished (including `20260910000038_service_case_costs_rls`), 0 unresolved failed; `prisma migrate status` clean | Any new schema migration |
| **Runtime DDL Elimination** | Architecture Engineer | **PASS** | `service_case_costs` table and RLS created via migration; runtime DDL eliminated from `src/lib/service-tickets/cost-ledger.ts`; guarded by `scripts/check-no-runtime-ddl.mjs` | DDL check in CI |
| **Tenant RLS Compliance** | Security Engineer | **PASS** | CI run `34518252558` PASSED; 51 route findings classified with defense-in-depth justification | Code modification to routes |
| **Tenant Safety Contract** | Security Engineer | **PASS** | CI run `34518252524` PASSED; 60 route findings classified with auth mechanism justification | Code modification to routes |
| **Phase 0 Isolation Tests** | Security Engineer | **PASS** | CI run `34518252684` PASSED (Go cross-tenant suite, TypeScript RLS suite with scoped test tenants, SQL syntax) | RLS test modification |
| **Production Build Check** | CI Engineer | **PASS** | CI run `34518252608` PASSED (Node 20.x & 22.x production builds succeeded) | Build config modification |
| **Leasing Scheduler Coverage** | QA / Operations | **PARTIAL** | Fleet Documents sweep passed; specific Leasing job sweeps remain unverified job-by-job | Staging execution of 8 Leasing sweeps |
| **Dunning & Collections Dispatch** | QA / Operations | **BLOCKED** | Investigated 2026-09-11: no "verified in staging" evidence exists in-repo; outstanding-balance calculation diverges from `invoice-balance.ts`, no suppression mechanism, no persisted stage machine, no dispatch-safety gate — see §6 warning above | Financial-calculation fix + dispatch gate + suppression list + real staging provider-call evidence, per remediation plan |
| **Leasing Quotation Creation** | Core Operations | **PASS** | `src/app/api/leasing/quotations/route.ts` functional verification complete; 5/5 unit tests passing (`tests/unit/leasing-quotation.test.ts`) | E2E Playwright funnel in staging |
