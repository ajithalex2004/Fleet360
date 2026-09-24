# Fleet360 / XL AI Smart Mobility: Enterprise Multi-Tenant SaaS Architecture Audit

**Date:** 2026-09-24
**Perspective:** Senior System Analyst · Solution Architect · Product Manager
**Scope:** The whole repository at `claude/epic-clarke-9sjzec`: Next.js app (`src/`), Go backend (`backend/`), Prisma schema and migrations (`prisma/`), CI (`.github/workflows/`) and the existing docs (`docs/`).
**Method:** Static review of code, schema, configuration and CI. Nothing was load-tested or penetration-tested. Every finding cites the file it came from.

---

## 1. Executive summary

Fleet360 already has much of what an enterprise SaaS product needs. It has a tenant model and PostgreSQL row-level security (RLS) on about 256 tables. It has a least-privilege database role for the application, SSO, SCIM, MFA, IP allow-lists, Stripe subscriptions, a plan catalogue stored in the database, a transactional outbox, a data-residency router and CI checks for tenant isolation. The product covers every line of business in the Smart Mobility vision: Leasing, RAC, Staff Transport / Bus Ops, School Bus, Ambulance / Incidents, Logistics, Booking, Dispatch, Finance and the partner portals.

The gap is **consistency and operability, not features**. Almost every enterprise control exists, but none is applied everywhere by construction. Isolation still depends on each of the 811 route handlers following a convention. The system is also a very large single deployable split across two backends (Next.js and Go) and a single 7,300-line schema. That layout will limit scale, team velocity and enterprise sales conversations (security questionnaires, SLAs, data residency).

**Headline verdict:** The platform suits a small number of trusted tenants today. Four things block a safe, scalable multi-tenant enterprise SaaS:

1. **Fix one confirmed P0 security defect** (§3.1): unauthenticated callers can write to any tenant through three driver-app endpoints.
2. **Make tenant isolation structural** so it no longer depends on each developer following a convention.
3. **Separate the control plane (tenants, billing, entitlements) from the application plane (the mobility modules).**
4. **Split web, workers and real-time into separately scaled runtimes**, with per-tenant observability.

### Maturity scorecard (1 = ad hoc, 5 = enterprise-grade)

| # | Dimension | Score | One-line rationale |
|---|---|:-:|---|
| 1 | Tenant data isolation | **3.0** | RLS and an app role are in place, but tenant identity is still taken from a client header on public routes, and tables are still created at runtime |
| 2 | Identity, authN/authZ | **3.0** | SSO, SCIM, MFA and WebAuthn exist. Missing roles default to `TENANT_ADMIN`, and three RBAC models overlap |
| 3 | Tenant lifecycle (provision → offboard) | **3.0** | Provisioning, domain verification, invitations and offboarding tables exist. No end-to-end export or purge workflow is automated or evidenced |
| 4 | Commercial and billing (plans, metering) | **2.5** | Stripe and the DB plan catalogue exist. No usage metering pipeline and no per-module add-on SKUs |
| 5 | Application architecture and modularity | **2.0** | 811 API routes and 449 pages in one Next.js app, a partial Go migration via a shim, and a single 225-model schema |
| 6 | Scalability and resilience | **2.0** | Cron runs inside every web instance, the connection pool is tiny, and Neon cold-start workarounds are wired into the ORM layer |
| 7 | Observability and SRE | **2.0** | Sentry and zap only. No distributed tracing, per-tenant metrics, SLOs or status page |
| 8 | Integration and API platform | **2.5** | API keys, a version header and inbound webhooks exist. No public OpenAPI, outbound tenant webhooks or developer portal |
| 9 | Data and analytics platform | **2.0** | Power BI route and ESG libs. No warehouse or CDC, and reporting runs on the OLTP database |
| 10 | Compliance and governance | **2.5** | Audit logs and residency routing exist. Residency silently fails open, and PII is committed to the repo |
| 11 | SDLC, DevOps, repo hygiene | **3.0** | Strong isolation and migration CI gates. Root-folder clutter, a template README and document drift |

**Overall: about 2.6 / 5.** This is an advanced MVP / early-scale platform. The target for enterprise and government deals in the UAE/GCC is 4.0 or higher.

---

## 2. Current-state architecture (as found)

```
                ┌───────────────────────────── Clients ─────────────────────────────┐
                │ Operator web (449 pages) · Portals: booking, leasing, shipper,     │
                │ carrier, customer · Driver app (Capacitor) · Staff PWA · BLE gw    │
                └───────────────────────────────┬───────────────────────────────────┘
                                                │ xl-session cookie (HMAC) / device tokens
┌───────────────────────────────────────────────▼──────────────────────────────────────────────┐
│ Next.js 15 monolith (Railway, also Vercel crons in vercel.json)                              │
│  middleware.ts: session verify → rate-limit (Upstash) → inject x-tenant-id/x-user-role       │
│                 → api-shim proxies /api/logistics/* to Go with minted JWT                    │
│  811 route handlers · withTenantRls / withPlatformAdmin / withSystemJob wrappers             │
│  In-process: job scheduler (node-cron-like), outbox publisher, AI agents, runtime DDL        │
│  Prisma $use middleware: auto tenant tx + optional dual-write to LOCAL_DATABASE_URL          │
└───────────────┬──────────────────────────────────────────────┬───────────────────────────────┘
                │ Prisma (pool ~5)                             │ HTTP + JWT
                ▼                                              ▼
┌───────────────────────────────┐                ┌─────────────────────────────────────────┐
│ Neon Postgres (single shared) │◄───────────────│ Go backend (gin/gorm, 83 files)          │
│ 225 models, RLS on ~256 tbls  │                │ logistics, RFQ, rate engine, route opt,  │
│ app role fleet360_app         │                │ SSO, SCIM, billing, feature flags, ledger│
│ optional DATABASE_URL_{EU,UAE,US} (residency) │ └─────────────────────────────────────────┘
└───────────────────────────────┘
External: Stripe · OpenAI / Thesys · Twilio / WhatsApp · SMTP / SendGrid · Mapbox / Google · Sentry
```

**Key numbers:** 225 Prisma models (7,318 lines, one file) · 167 migrations · 811 `route.ts` · 449 `page.tsx` · 83 Go files · 197 unit/integration test files, 16 e2e specs, 23 Go test files · 8 CI workflows.

---

## 3. Findings and gaps

Severity: **P0** means fix before any additional tenant goes live. **P1** means fix before selling to enterprise or government. **P2** means needed to scale and differentiate.

### 3.1 Security and tenant isolation

#### 🔴 P0-1: Unauthenticated cross-tenant writes on driver-app endpoints (confirmed)

> **Status (2026-09-24): fixed in code, not yet deployed.** Middleware now strips client-sent identity headers on every path except CRON_SECRET scheduler calls (`src/lib/identity-headers.ts`). Driver-app routes get their tenant from a verified session cookie, and the three write endpoints also check the driver session themselves (`requireDriverSessionForTenant`). Regression tests: `tests/unit/middleware-identity-headers.test.ts`. The same flaw also let a forged header skip the secret check on `/api/push/run-scheduler` and `/api/cron/outbox-publish`; that is closed by the same change.

- `src/lib/auth-route-policies.ts` lists `/api/driver-app/` as a **public prefix**. It relies on "device-token auth" that each handler must implement itself.
- For public routes, `src/middleware.ts` returns `NextResponse.next()` **without stripping client-supplied `x-tenant-id`, `x-user-id` or `x-user-role` headers**. The same happens in the `CRON_SECRET` branch.
- `resolveAuthorizedTenant()` in `src/lib/tenant-context.ts` trusts `x-tenant-id` as though the middleware had injected it.
- As a result, `src/app/api/driver-app/emergency-sos/route.ts`, `.../telematics/live-location/route.ts` and `.../nrm-toggle/route.ts` perform tenant-scoped writes **with no driver or device credential check**. Anyone who knows or guesses a tenant UUID can inject CRITICAL SOS alerts, fake GPS pings, or toggle state in any tenant. RLS does not help, because RLS is scoped to the attacker-chosen tenant.
- Other driver-app routes call `requireDriverSession()` inside the transaction, which limits the damage. They still open an RLS transaction for a header-chosen tenant before checking authentication.

**Fix (small, high-leverage):**

1. In `middleware.ts`, always `delete` the headers `x-tenant-id`, `x-user-id`, `x-user-role`, `x-tenant-plan`, `x-impersonated-by` and `x-data-residency` from the inbound request before any branch, including the public and cron branches.
2. For device, portal and gateway routes, derive the tenant **from the verified credential** (device token, portal token or gateway HMAC), never from a header.
3. Add a CI rule that fails any handler under a public prefix that calls `requireAuthorizedTenant` without first verifying a credential.

#### 🔴 P0-2: Privilege fallbacks fail open

> **Status (2026-09-24): fixed in code, not yet deployed.** `verifySession()` now rejects a signed session with no role instead of treating it as `TENANT_ADMIN`. Every login flow already signs a role, so only legacy or malformed tokens are affected; those users are asked to sign in again. The admin defaults are removed from middleware, `driver-session.ts`, `access-control.ts`, `/api/auth/me` and two admin routes. The Go proxy (`api-shim.ts`) refuses with 401 rather than minting a backend token without a role. Twelve audit-log entries under `/api/admin/service-config` no longer label a missing role as `TENANT_ADMIN`. **Found while fixing:** only 9 of the 69 `/api/admin/*` routes check the caller's role (for example `/api/admin/roles/override` has no admin check), so any signed-in user of a tenant may be able to call them. That is tracked under P1-4.

- `middleware.ts` sets `x-user-role` to `session.role ?? 'TENANT_ADMIN'`.
- `src/lib/access-control.ts:140` and `src/lib/api-shim.ts:113` also default to `TENANT_ADMIN`. The Go JWT minted by the shim inherits that default.

A session or header with no role therefore receives **admin** rights. The default must be the *least* privilege (for example `VIEWER`), or the request must be rejected.

#### 🟠 P1-3: Tenant isolation is by convention, not by construction

- 636 of 685 routes (per `docs/RLS_ENFORCEMENT_ROLE_PLAN.md`) use a wrapper. The rest, and every new route, depend on reviewer discipline.
- **50 source files still run runtime DDL** (`ensure*Table`, `CREATE TABLE IF NOT EXISTS`). Tables created by `fleet360_app` are *owned* by it and bypass RLS unless `FORCE` is set. For that reason the app role still needs the `CREATE` privilege. See `docs/RETIRE_RUNTIME_DDL_PLAN.md`.
- **41 files use `$queryRawUnsafe` / `$executeRawUnsafe`.** That makes a large surface for SQL injection and missed tenant predicates.
- **17 models have a nullable `tenantId`** and about **56 models have no `tenantId`**. Some are legitimate global master data. Each one needs an explicit classification (global / platform / tenant).
- `docs/RLS_ENFORCEMENT_ROLE_PLAN.md` lists 7 tables that have `tenant_id` but RLS switched off.
- Composite foreign keys `(parent_id, tenant_id)` are mandated by `docs/TENANT_SAFETY_CONTRACT.md` rule 10, but they are not applied everywhere.

**Target:** Build a single `tenantDb(ctx)` data-access façade. It is the only way handlers can reach Prisma. Ban `prisma` imports in `src/app/api/**` using an ESLint rule. Ban `*Unsafe` except through a reviewed allow-list. Revoke `CREATE` from `fleet360_app`. Add a schema linter that fails CI when a model lacks a tenancy classification.

#### 🟠 P1-4: Three overlapping authorization models

> **Admin API role checks (2026-09-24): fixed in code, not yet deployed.** Most `/api/admin/*` routes had no role check. Any signed-in user of any tenant could reset any user's password (`users/set-password`), edit or list every user and tenant, and assign the platform `SUPER_ADMIN` role (`tenants/[id]/users`, invitations, SSO default role, or a tenant copy via `roles/override` or a role-code edit). Middleware now enforces one policy table (`src/lib/admin-access.ts`): every admin route method is classified as platform, tenant-admin or member, and anything unlisted requires `SUPER_ADMIN`. A CI test fails if a route is missing from the table. Handlers reachable by tenant admins or members are kept to the caller's tenant (`src/lib/admin-scope.ts`). Nobody but a platform admin can grant `SUPER_ADMIN`, and no tenant-owned role can carry that code. The broader consolidation into one policy engine below is still open.

`src/services/rbac.ts` (a hard-coded `Permission` enum), `src/lib/permissions*` / `access-control.ts`, and the database tables `Role`, `Permission`, `TenantModule` and `TenantFeatureOverride` all make authorization decisions.

Enterprise customers expect **tenant-defined roles, field-level and branch-level scoping, approval delegation and an access review export**. Consolidate into one policy engine: RBAC with ABAC attributes for tenant, branch, module and cost-centre. Cerbos or OpenFGA are candidates, or an in-house engine with the same shape. Make every decision auditable.

#### 🟠 P1-5: Data residency fails open

`src/lib/db-router.ts` routes ENTERPRISE tenants to `DATABASE_URL_{EU,UAE,US}`. If that variable is unset, it *logs a warning and falls back to the global database*. For UAE government and regulated customers (PDPL, NESA/ADHICS), that is a contractual breach, not a warning. The router must **fail closed** for any tenant whose residency is not `GLOBAL`. The Go backend, jobs, outbox, file storage, backups, logs and LLM calls also need residency awareness. Today only the Next.js Prisma path has it.

> **Status (2026-09-24): fixed in code (fail closed), not yet deployed.** Found while fixing: no route called the router, so every tenant's data already went to the global database whatever its residency. `src/lib/db-router.ts` now throws `DataResidencyUnavailableError` instead of falling back, for every plan. Every session issuer signs the tenant's residency into the session, and middleware answers **503** for a tenant whose region this deployment does not serve (`DATA_RESIDENCY_SERVED_REGIONS`, GLOBAL always served). Provisioning refuses an ENTERPRISE region the deployment cannot honour. This stops new data landing in the wrong region; it does not move data or add regional routing. Serving EU/UAE/US customers needs an in-region deployment (cell) with `DATA_RESIDENCY_SERVED_REGIONS` set. Background jobs, the Go backend, file storage, logs and LLM calls are still not residency-aware. Tests: `tests/unit/data-residency.test.ts`.

#### 🟠 P1-6: Secrets, PII and repository hygiene

- `backend/uploads/` contains a committed PDF whose name suggests a vehicle registration card. That is likely **personal data in git history**. Remove it, purge it from history, and add `backend/uploads/` to `.gitignore`.
- Per-tenant integration credentials (Twilio, SMTP, telematics) appear to be stored without envelope encryption. The only cipher usage found is in `src/lib/sso.ts`. Use KMS-backed envelope encryption with per-tenant data keys.
- `docs/KNOWN_GAPS.md` SEC-002: treat the Neon credentials as compromised until the rotation is evidenced.
- The repo root contains `errors.txt`, `tsc-out.txt`, `tsc-errors.txt`, empty files `node` and `TENANT-001`, `Dockerfile.unused`, several `.docx` files and a README that is still the Thesys template. None of this is a vulnerability on its own. It does fail an enterprise customer's code-escrow or due-diligence review.

### 3.2 Application architecture

#### 🟠 P1-7: One monolith, two backends, no enforced domain boundaries

- All modules (Leasing, RAC, STS, School Bus, Ambulance, Logistics, Finance, Exchange, AI agents) live in one Next.js deployable. They share one Prisma client and one schema. Any module can query any table.
- A **partial migration to Go** (logistics, RFQ, rate engine, SSO, SCIM, billing, feature flags) is bridged by `src/lib/api-shim.ts`. That leaves two languages, two ORMs (Prisma and GORM) and two tenancy implementations (`withTenantRls` and `auth.AsTenant`) to keep equivalent, plus a split ownership of the same tables.

**Recommendation:** Adopt a **modular monolith** explicitly. Microservices are not the next step.

- Organise code as `src/modules/<domain>/{api,domain,infra}` with public interfaces only, and enforce boundaries with `eslint-plugin-boundaries` or dependency-cruiser.
- Split the Prisma schema per domain using `prismaSchemaFolder` or multi-file schemas, and move tables into Postgres schemas per domain. That work has partly started (`finance`, `fleet`, `operations`, `spatial` …).
- **Decide the Go question now.** Either (a) Go owns compute-heavy engines (route optimisation, rate engine, ETA, telematics ingest) behind internal APIs, and TypeScript owns CRUD and workflow, or (b) freeze Go. The current "migrate module by module through a shim" approach doubles the tenancy-safety burden.

#### 🟠 P1-8: Background work runs inside web instances

- `src/instrumentation-node.ts` starts `src/lib/jobs/scheduler.ts` in **every** Next.js process. It schedules 15 jobs (dunning, billing sweeps, expiry sweeps, auto-close trips …) with **no leader election or distributed lock**. With two or more replicas, each job runs N times: duplicate dunning emails, duplicate fuel or fine billing, racing auto-close.
- The outbox publisher correctly uses `FOR UPDATE SKIP LOCKED`, so it is safe. The other jobs are not.
- `vercel.json` defines crons as well, which is a second scheduler for the same jobs.

**Target:** Run a dedicated **worker service**, separate from web, with a durable job queue (pg-boss, Graphile Worker, BullMQ, Temporal or Inngest). Enforce per-job idempotency keys and run jobs **per tenant**: fan out one job per tenant, each wrapped in `withTenantRls`. That isolates failures and allows per-tenant schedules and time zones. `Asia/Dubai` is currently hard-coded.

#### 🟡 P2-9: Real-time and event backbone

- The event bus is a Postgres outbox with in-process consumers (`src/events`). That design is sound for Phase 1.
- Dispatch, journey management, AVL, school-bus tracking and ambulance CAD need **low-latency fan-out at scale**: thousands of vehicles each pinging every 5–10 seconds.
  - Move telemetry ingest off the OLTP primary into a stream (Kafka, Redpanda, NATS JetStream, Kinesis) with a time-series store (TimescaleDB or ClickHouse).
  - Run the WebSocket gateway (`src/lib/realtime/ws-gateway.mjs`) as its own horizontally scaled service with tenant-partitioned channels.

#### 🟡 P2-10: Database connection and cold-start workarounds are wired into the ORM layer

`src/lib/prisma.ts` (490 lines) contains retry loops, keep-alive pings, pre-warm, P2028 handling, a **dual-write mirror to `LOCAL_DATABASE_URL`**, and auto-wrapping of every model call in a tenant transaction. With `DB_MAX_OPEN_CONNS=5`, each request that auto-opens a transaction consumes a pool slot, so throughput caps early.

- Remove the dual-write path from production code.
- Use PgBouncer in transaction mode, or Neon's pooler, with `SET LOCAL` semantics. That is already done through `set_config(..., true)`.
- Size pools per service.
- Consider Neon autoscaling with no scale-to-zero on production. Otherwise use Aurora or Azure PG Flexible, or a UAE-region provider, for residency.

### 3.3 SaaS control plane

This is the biggest structural product gap. Every enterprise SaaS has a **control plane** that is separate from the product, and Fleet360 mixes the two.

| Capability | Current | Gap / target |
|---|---|---|
| Tenant registry and hierarchy | `Tenant` → branches, customer hierarchy | Add **Platform → Partner / Reseller → Tenant (Operator) → Branch / Depot → Customer account**. Reseller/white-label is a core GCC go-to-market route (dealers, lessors, government holding companies). |
| Provisioning | `/api/tenants/provision`, domain verify | One idempotent **provisioning workflow**: create tenant, seed masters, default roles, entitlements, subdomain/custom domain + TLS, SSO, first admin, sample data, welcome sequence. It needs a status and must be retryable. |
| Entitlements | `plan` string, `TenantModule`, `TenantFeatureOverride`, Go `featureflags` | A single **entitlement service**: plan → modules → features → quotas (vehicles, drivers, trips/month, API calls, AI tokens, storage), evaluated in one place, cached and pushed to both backends. |
| Metering and billing | Stripe checkout/portal/webhook, `plan-usage.ts` counters | A **usage metering pipeline**: an event per billable unit (active vehicle-month, trip, booking, SMS/WhatsApp, AI tokens, API call), aggregated per tenant per period and pushed to Stripe Billing meters. Add UAE VAT e-invoicing, AED pricing, annual prepaid contracts and PO-based invoicing for enterprises. |
| Tenant configuration | `TenantSettings`, branding, languages | A versioned, schema-validated tenant configuration: workflows, SLAs, numbering, tax, calendars, time zone, working hours. Tenant admins self-serve it with an audit trail. |
| Offboarding and data rights | `TenantOffboarding` model | Automated **export** (full tenant data dump, documents), **retention hold**, **crypto-shred / purge**, and a certificate of deletion. Enterprise RFPs require this. |
| Platform operations console | `/platform`, `/admin/*`, impersonation | Support impersonation with **reason code, time limit, customer consent and audit**. Add a tenant health view (errors, latency, usage, billing state) and a kill switch per tenant or module. |

### 3.4 Observability, SRE and operations

- Add **OpenTelemetry** traces, metrics and logs across Next.js, Go and workers. Every span, log and metric must carry `tenant_id`, `module` and `request_id`.
- Define per-tenant dashboards and **SLOs** (for example dispatch API p95 below 300 ms, 99.9% monthly availability, SOS alert delivery within 5 s) with error budgets.
- Enterprise contracts need a public **status page**, an incident process, an RPO/RTO statement and a tested DR runbook. Today there is Neon 7-day PITR only (`KNOWN_GAPS.md` OBS-001) and no cross-region replica.
- Detect noisy neighbours with per-tenant rate limits (already in `rate-limit-scope.ts`), per-tenant DB statement timeouts and per-tenant query budgets.
- Ambulance and incident management is **life-safety**. It needs its own availability tier, degraded-mode operation, and SOS paths that do not depend on the same pool as reporting queries.

### 3.5 Integration and API platform

- Publish a versioned **OpenAPI 3.1** spec for a stable public API subset. The current version header is a start.
- Add **outbound webhooks** per tenant (signed, retried, with a delivery log). Enterprises integrate Fleet360 with ERP (SAP, Oracle, D365), HRMS (staff rosters), SIS (school rosters), government portals (RTA/ITC, Salik, traffic fines, Tasjeel) and insurers.
- Build a **connector framework** with per-tenant credentials and envelope encryption for telematics OEMs (Teltonika, Samsara, Geotab), fuel cards, and payment gateways (Stripe, Checkout.com, Network International, Telr for the UAE).
- Add scoped **API keys and OAuth2 client credentials** per tenant, with rate plans, plus a developer portal.

### 3.6 Data and analytics

- Reporting runs on the transactional database. Add **CDC** (Debezium or Neon logical replication) into a warehouse (BigQuery, Snowflake, ClickHouse or Fabric) with tenant-partitioned semantic models.
- Embedded analytics should use per-tenant row filters. The Power BI route exists; extend it with RLS roles per tenant.
- AI agents (`src/lib/agents`, 20+) call OpenAI with a global key. Enterprises will ask for:
  - per-tenant opt-in or opt-out
  - residency-aware model endpoints (Azure OpenAI UAE North, or Claude on AWS Bedrock in-region)
  - prompt and response audit logging
  - PII redaction
  - per-tenant token metering and billing

### 3.7 Compliance readiness (UAE/GCC enterprise and government)

| Requirement | Status |
|---|---|
| UAE PDPL / DIFC DP / ADGM: data inventory, DSR (access / erase), consent, DPO | Partial: no DSR workflow or data map |
| Data residency (UAE in-country for government and semi-government) | Fails closed now (P1-5); needs an in-region deployment to serve |
| ISO 27001 / SOC 2 Type II evidence | CI gates are good evidence sources. Formal control mapping is missing |
| NESA/IAS, ADHICS (health data for ambulance) | Not addressed. Ambulance PHI needs field-level encryption and access logging |
| School transport (child data, parent consent, RTA/ITC school bus rules) | Module exists. Child-data protections are not explicit |
| Immutable audit log | `audit.ts`, `platform-audit-log.ts` exist. Need append-only, tamper-evident storage (hash chain or WORM) and customer export |
| Pen-test and vulnerability management | Not evidenced in the repo |

### 3.8 SDLC and engineering governance

**Strengths to keep:**

- Tenant-isolation CI (`tenant-safety.yml`, `tenant-rls-check.yml`, `phase0.yml`)
- Migration safety gate
- Credential scanner
- Type-check ratchet

**Gaps:**

- Documentation drift. `KNOWN_GAPS.md` still calls TENANT-001 "open" although the `20260815140000_tenant_001_leasing_rental_isolation` migration exists. `RLS_ENFORCEMENT_ROLE_PLAN.md` says "not applied" while `RELEASE_EVIDENCE.md` verifies the `fleet360_app` runtime. Keep **one** living architecture record (ADRs in `docs/adr/`) and archive the rest.
- There are more than 20 status or summary markdown files at the root and in `docs/`. Consolidate them into README, ARCHITECTURE, RUNBOOK, SECURITY and ADRs.
- Add environment promotion (dev → staging → prod) with **ephemeral per-PR databases** (Neon branching makes this cheap).
- Add contract tests between the Next.js shim and the Go API.
- Add load tests per module and a tenant-isolation fuzz test that runs every route as tenant A against tenant B's IDs.

---

## 4. Target architecture (12-month view)

```
                         ┌──────────────── Edge: WAF, CDN, custom domains/TLS per tenant ───────────────┐
                         └───────────────┬──────────────────────────────────────────┬───────────────────┘
                                         │                                          │
             ┌───────────────────────────▼──────────────┐          ┌────────────────▼────────────────┐
             │ CONTROL PLANE (platform team)            │          │ APPLICATION PLANE               │
             │ • Tenant registry & hierarchy (reseller) │  config  │ Web/BFF (Next.js)  – UI + BFF   │
             │ • Identity: SSO/SCIM/MFA, policy engine  │ ───────► │ Domain modules (modular mono):  │
             │ • Entitlements & quotas                  │  tokens  │  Leasing · RAC · Staff Tx ·     │
             │ • Metering → Billing (Stripe, VAT)       │          │  School Bus · Ambulance/Incident│
             │ • Provisioning / offboarding workflows   │ ◄─────── │  Logistics · Booking/Dispatch/  │
             │ • Platform console, support, audit       │  usage   │  Journey · Finance · Maintenance│
             └──────────────────────────────────────────┘  events  │ Engines (Go): routing, rating,  │
                                                                   │  ETA, telematics ingest         │
                                                                   │ Workers: durable queue, per-    │
                                                                   │  tenant jobs, outbox relay      │
                                                                   │ Realtime gateway (WS, scaled)   │
                                                                   └───────┬───────────────┬─────────┘
                                                                           │               │
               ┌──────────────────────── Data plane (per deployment "cell") ▼───────────────▼─────────┐
               │ Postgres (RLS, FORCE, tenant-classified schema) · Stream (telemetry/events) ·         │
               │ Time-series store · Object storage (per-tenant prefixes, KMS keys) · Cache · Search   │
               │ CDC → Warehouse (tenant-partitioned) → Embedded BI / AI                               │
               └──────────────────────────────────────────────────────────────────────────────────────┘
               Cells: Shared-UAE · Shared-Global · Dedicated (Enterprise/Gov, per-tenant DB or full stack)
```

**Tiered tenancy model** (sold as a product lever):

| Tier | Isolation | Target customer | Price signal |
|---|---|---|---|
| **Pooled** | Shared app + shared DB with RLS | SMB fleets, RAC branches, schools | Per vehicle / month |
| **Bridge** | Shared app, **dedicated database** per tenant (the router pattern you already have) | Mid-market lessors, logistics operators | Platform fee plus per vehicle |
| **Silo / Cell** | Dedicated stack in the customer's region or cloud (UAE-North, sovereign) | Government, RTA contractors, ambulance / health, large corporates | Annual licence plus managed service |

The same codebase serves all three tiers. The control plane decides where each tenant lives.

---

## 5. Prioritised roadmap

### Phase 0: Stabilise and secure (0–30 days)

1. **P0-1** Strip identity headers in middleware. Derive the tenant from the credential on the driver-app, portal and gateway routes. Add a CI rule for public-prefix handlers.
2. **P0-2** Make role fallbacks least-privilege or reject the request.
3. Make residency routing fail closed (P1-5).
4. Remove the committed PII from `backend/uploads/` and git history. Finish the SEC-002 credential rotation. Set `PHASEGATE_DEBUG_TOKEN`.
5. Add leader election or advisory locks to `scheduler.ts` immediately, as a stop-gap until the worker service exists. Remove the duplicate Vercel crons.
6. Clean up the repo root and replace the README. Reconcile `KNOWN_GAPS.md` and the RLS plan with the actual state.

### Phase 1: Isolation by construction and control plane v1 (30–90 days)

7. Build the `tenantDb` façade. Add ESLint bans on direct `prisma` and `*Unsafe` use in route handlers. Classify every model's tenancy in CI.
8. Retire runtime DDL, then revoke `CREATE` from `fleet360_app`. Set `FORCE RLS` on 100% of tables. Add composite foreign keys.
9. Unify RBAC into one policy engine with tenant-defined roles and branch scoping.
10. Build the entitlement service (plan → module → feature → quota) shared by Next.js and Go.
11. Run a dedicated worker service with a durable queue and per-tenant job fan-out.
12. Instrument with OpenTelemetry, tagging every signal with `tenant_id`. Build the first per-tenant SLO dashboards.

### Phase 2: Scale and monetise (90–180 days)

13. Usage metering pipeline feeding Stripe meters. Add AED/VAT e-invoicing and annual contracts.
14. Tenant hierarchy with a reseller/partner tier and white-label: custom domain, branding, email sender.
15. Automated provisioning and offboarding workflows (export, purge, certificate).
16. Public API (OpenAPI), outbound webhooks and a connector framework with encrypted per-tenant credentials.
17. Telemetry stream and time-series store. Scale-out real-time gateway.
18. Finish the modular-monolith boundaries and the domain-split schema. Make the Go engines internal services.

### Phase 3: Enterprise and government readiness (180–365 days)

19. Cell-based deployment: UAE sovereign cell, dedicated-tenant cells, infrastructure as code (Terraform) per cell.
20. SOC 2 Type II / ISO 27001 programme. PDPL DSR tooling. ADHICS controls for ambulance data.
21. CDC into a warehouse, embedded BI and residency-aware AI with per-tenant AI governance.
22. DR: cross-region replica, quarterly restore drills, published RPO ≤ 15 min and RTO ≤ 4 h.

---

## 6. Product manager insights (commercial lens)

1. **Sell modules, not a monolith.** Your seven lines of business are separate buying centres: the leasing CFO, the RAC ops head, the HR facilities manager, the school principal or transport coordinator, the health authority, and the logistics GM. Package them as **Platform Core** (fleet, drivers, maintenance, finance, portals, AI) plus **Module add-ons**. The entitlement service (Phase 1, item 10) is the technical enabler for this pricing model.
2. **Lead with the shared core as the moat.** One vehicle and driver master across leasing, rental, staff transport and logistics means **cross-module utilisation**: a leased vehicle can be redeployed to RAC or a staff shuttle. Point solutions cannot match this, so make it the headline of the pitch.
3. **The reseller/partner tier is a GCC growth lever.** Dealers, leasing majors and government holding companies want to offer the platform under their own brand to their sub-fleets. Build the hierarchy (Phase 2, item 14) before the first partner deal, not after.
4. **Data residency and sovereignty win government deals.** A UAE-hosted cell with a documented isolation model, audit trail and DR is often the qualifying criterion. Tiered tenancy turns that cost into a premium SKU.
5. **Life-safety modules need a different promise.** Ambulance, incident and school bus (child safety) should carry a higher SLA tier, separate on-call and separate infrastructure priority. That justifies premium pricing.
6. **Meter what customers value:** active vehicles, completed trips/journeys, bookings, and AI-assisted actions. Usage data also becomes the customer-success health score that drives renewal and upsell.
7. **Enterprise sales hygiene:** keep a security whitepaper, a completed CAIQ/SIG questionnaire, a DPA template, a pen-test letter, an SLA schedule and an architecture one-pager ready. Most of the evidence already exists in CI and the docs. It needs packaging.

---

## 7. Appendix: evidence index

| Finding | Evidence |
|---|---|
| Public driver-app prefix | `src/lib/auth-route-policies.ts` (`'/api/driver-app/'`) |
| Headers not stripped on public / cron path | `src/middleware.ts` steps 1 and 1b |
| Header-trusting tenant resolution | `src/lib/tenant-context.ts` `resolveAuthorizedTenant` |
| Unauthenticated tenant writes | `src/app/api/driver-app/{emergency-sos,telematics/live-location,nrm-toggle}/route.ts` |
| `TENANT_ADMIN` fallbacks | `src/middleware.ts`, `src/lib/access-control.ts:140`, `src/lib/api-shim.ts:113` |
| Residency fail-open | `src/lib/db-router.ts` `getOrCreateRegionalClient` |
| In-process scheduler, no lock | `src/instrumentation-node.ts`, `src/lib/jobs/scheduler.ts` |
| Duplicate cron definitions | `vercel.json` |
| Dual-write mirror | `src/lib/prisma.ts` (`LOCAL_DATABASE_URL`, `$use` dual-write) |
| Runtime DDL (50 files), raw unsafe SQL (41 files) | `grep` across `src/` |
| RLS/app-role history | `docs/RLS_ENFORCEMENT_ROLE_PLAN.md`, `docs/RELEASE_EVIDENCE.md` |
| Existing SaaS layer | `prisma/schema.prisma` `Tenant`, `Subscription`, `SsoConfig`, `ScimToken`, `IpAllowlist`, `TenantFeatureOverride`, `TenantOffboarding` |
| Committed upload | `backend/uploads/*.pdf` |
