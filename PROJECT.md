# Project: Fleet360 Codebase Audit & Remediation

## Architecture
- **Framework**: Multi-tenant Next.js (App Router, TypeScript) + Go Backend Microservice (`backend/`).
- **Database**: PostgreSQL with Row-Level Security (RLS) managed via Prisma ORM (`prisma/schema.prisma` and SQL migrations).
- **Background Tasks**: Redis / In-process Scheduler (`src/lib/jobs/**`).
- **Mobile**: Driver Application with Capacitor / React and offline-first IndexedDB sync (`src/lib/driver-offline/**`, `mobile-app/**`).
- **AI Layer**: Unified AI Gateway with policy enforcement, rate limits, and token accounting (`src/lib/agents/gateway/**`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | SQL Parameterization | Parameterize all raw SQL queries in `customers/**`, `customers/[id]/documents`, and stats routes | M1 | survey_1 |
| F02 | Tenant Auth Checks | Fix `requireAuthorizedTenant` checks to verify `!auth.ok` rather than `instanceof NextResponse` | M1 | survey_1 |
| F03 | Roster OTP Hardening | CSPRNG OTP generation, Redis/memory store, remove '849201' demo bypass, expiration, rate limits, bind tenant ID | M1 | survey_1 |
| F04 | Domain & Provisioning Security | Fix unauthenticated domain verification token disclosure and unauthorized enterprise provisioning | M1 | survey_1 |
| F05 | Webhook Signature Verification | Enforce Twilio and Meta/WhatsApp HMAC signatures on JSON payloads and fail closed on missing secrets | M1 | survey_1 |
| F06 | Cross-Tenant Isolation | Add tenant scoping to `report_schedules`, `hos_logs`, `corporate-clients`, and eliminate RLS `*` escalation | M1 | survey_1 |
| F07 | Secret & RBAC Hardening | Remove insecure fallback secrets, enforce RBAC on driver routes, preserve real user roles on impersonation | M1 | survey_1 |
| F08 | Auth Limits & Headers | Enforce login rate limiting, PBKDF2 password length caps, and global security headers | M1 | survey_1 |
| F09 | Timestamp Arithmetic Fix | Fix PostgreSQL error 42883 (`scheduled_date + scheduled_start`) in school bus trips without swallowing errors | M1 | survey_1 |
| F10 | Dispatch Schema Migration | Sync 17 missing columns (`dispatch_jobs`, `driver_availability`) in database migrations so `/api/readyz` passes | M1 | survey_1 |
| F11 | Scheduler Connection Timeout Fix | Fix background job scheduler and sweep adapters 10.5s `ConnectTimeoutError` hairpinning on `NEXT_PUBLIC_APP_URL` | M1 | survey_1 |
| F12 | Public Origin Resolution | Implement robust public origin resolution (`getPublicOrigin`) for reverse-proxy environments | M1 | survey_1 |
| F13 | UAE VAT 201 Rebuild | Rebuild UAE VAT reporting from posted invoices/credit note subledgers and general ledger lines (Box 1 & 8) | M2 | survey_2 |
| F14 | UAE FTA FAF Generation | Generate valid FTA Audit File (FAF v1.0.0) with GeneralLedger, Customer, Supplier, and Supply sections | M2 | survey_2 |
| F15 | Leasing Fine Tax Split | Split leasing traffic fines: 0% statutory fine principal vs 5% standard VAT on admin fee recharge | M2 | survey_2 |
| F16 | Freight Exchange GL Postings | Ensure atomic double-entry GL postings for Freight Exchange invoices; isolate Output VAT from revenue | M2 | survey_2 |
| F17 | Freight Exchange UI Fix | Fix hardcoded partner ID and invalid enum values in invoice submission; fix statement PDF link | M2 | survey_2 |
| F18 | SaaS Billing Isolation | Isolate Fleet360 platform SaaS billing (`SUB-*`) from customer tenant AR ledgers into dedicated billing records | M2 | survey_2 |
| F19 | Accounting Controls & SoD | Enforce period controls (`assertPeriodOpen`) and Maker-Checker segregation of duties on journal entries | M2 | survey_2 |
| F20 | Credit Note GL Integrity | Post double-entry GL reversals for Credit Notes and eliminate false `paid_amount` cash collection inflation | M2 | survey_2 |
| F21 | Decimal Monetary Types | Migrate monetary columns in Prisma schema and Go models from IEEE-754 `Float`/`float64` to `Decimal` | M2 | survey_2 |
| F22 | Empty State 422 Validation | Return HTTP 422 with clear validation errors instead of mock fallbacks in self-billing & scope3-report | M2 | survey_2 |
| F23 | Maintenance State Transitions | Wire invoice entry and job closure to backend APIs and update vehicle status (`AVAILABLE`) | M3 | survey_3 |
| F24 | Grounded Vehicle Safety | Include `GROUNDED` and `!vehicle.isActive` in `vehicle-availability.ts`; ground on pre-trip safety failures | M3 | survey_3 |
| F25 | Driver Fuel Bridging | Bridge `fuel_entries` to `public.fuel_logs`, update odometer, emit `FUEL_FILLED`, trigger `FinanceFuelConsumer` | M3 | survey_3 |
| F26 | Driver Expense Bridging | Bridge `expense_entries` to `finance.finance_expenses` and GL lines | M3 | survey_3 |
| F27 | Multi-Vertical Fine Matching | Expand fine and toll matching across Drayage, Logistics, Bus-Ops, School-Bus, and Leasing with GL postings | M3 | survey_3 |
| F28 | Mobile Offline Sync Engine | Fix Capacitor `API_BASE`, Bearer JWT auth, CORS headers (`X-Offline-*`), and 4xx quarantine queue | M3 | survey_3 |
| F29 | Stop Arrive & Photo Sync | Implement stop arrival endpoint and serialize base64 defect photos from IndexedDB `dvir_photos` | M3 | survey_3 |
| F30 | Driver Identity & OCR Fix | Resolve `User.id` vs `Driver.id`, support shift vehicle GPS pings, remove mock 99% OCR fallbacks | M3 | survey_3 |
| F31 | Demurrage & Dispatch UI Fix | Persist demurrage config to database; fix candidate scoring, cancel job, and vehicle assignment in dispatch | M3 | survey_3 |
| F32 | AI Gateway Metering | Enforce AI gateway rate limiting, vision spend metering, and token accounting across all LLM callers | M4 | survey_3 |
| F33 | Prompt Injection Defense | Enforce `role: 'user'` in `/api/chat`; fix Gemini key in URL and OpenAI reasoning model parameters | M4 | survey_3 |
| F34 | Readyz Go Decoupling | Decouple Next.js `/api/readyz` from Go backend; report Go service status as `degraded` in `/api/health` | M4 | survey_3 |
| F35 | Go Parity & Hardening | Add proxy timeout in `api-shim.ts`, pass `impersonatedBy` in JWT, increase DB pool size, protect debug endpoint | M4 | survey_3 |
| F36 | Railway Deployment Automation | Automate `prisma migrate deploy` on Railway and move `@prisma/client` to dependencies | M4 | survey_3 |
| F37 | Schema Drift & Validator | Update schema validator for all 251 models; scope multi-tenant unique keys (`@@unique([tenantId, ...])`) | M4 | survey_3 |
| F38 | TypeScript Build Checking | Enable `typescript: { ignoreBuildErrors: false }` in Next.js config and fix `tsconfig.finance.json` paths | M4 | survey_3 |
| F39 | Git Artifact Cleanup | Clean committed build artifacts (.apk, .dex, .docx, temp txt) from version control | M4 | survey_3 |
| F40 | E2E Test Suite & Hardening | Pass 100% of requirement-driven E2E test suite (Tiers 1-4) and Tier 5 adversarial coverage hardening | Final | dual_track |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | E2E Testing Track | Requirement-driven test suite (Tiers 1-4) published via TEST_READY.md (420 tests) | none | DONE |
| M1 | Tier 0 Critical Security & Production Runtime Breakages | F01 to F12: SQL parameterization, tenant auth checks, OTP, webhooks, RLS, dispatch schema migration, timestamp arithmetic, scheduler timeout, origin resolution | none | DONE |
| M2 | Tier 1 Financial, UAE VAT / FTA FAF & Double-Entry GL Integrity | F13 to F22: UAE VAT rebuild, FTA FAF v1.0.0, fine tax split, Exchange GL atomicity, SaaS billing isolation, period controls/SoD, decimal types, 422 validations | M1 | DONE |
| M3 | Tier 2 Operational Silos, Stubbed Workflows & Mobile Driver App | F23 to F31: Maintenance workflow transitions, grounded vehicle enforcement, fuel/expense bridging, multi-vertical fine matching, mobile offline sync engine, CORS, photo sync | M1 | DONE |
| M4 | Tier 3 AI Governance, Go Backend Parity, Schema Drift & DevOps Hygiene | F32 to F39: AI gateway metering, prompt injection defense, readyz decoupling, Go parity, Railway deploy migration, schema validator, TS build error checking, git hygiene | M1 | DONE |
| M5 | Final Milestone: 100% E2E Test Pass & Adversarial Hardening | F40: Phase 1 (100% pass of Tiers 1-4) + Phase 2 (Tier 5 adversarial hardening) + M5-R6 Gate Squad Iteration 2 PASS (442 pages built, 420/420 Playwright, 4,282 Vitest passed, 6/6 static, Go 17/17, Auditor CLEAN) | M0, M1, M2, M3, M4 | DONE |

## Interface Contracts

### 1. Tenant Authorization Contract (`src/lib/tenant-context.ts`)
- `requireAuthorizedTenant(req: Request | NextRequest): Promise<AuthorizedTenantResult>`
- Returns: `{ ok: true, tenantId: string, userId: string | null, role: string | null }` OR `{ ok: false, status: 400 | 401 | 403, error: string }`.
- Consumers MUST check `if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });`.

### 2. Vehicle Availability Contract (`src/lib/fleet/vehicle-availability.ts`)
- `VEHICLE_UNASSIGNABLE_STATUSES` includes `'MAINTENANCE'`, `'IN_MAINTENANCE'`, `'UNDER_REPAIR'`, `'OUT_OF_SERVICE'`, `'INACTIVE'`, `'SOLD'`, `'DECOMMISSIONED'`, `'PENDING_INSPECTION'`, and `'GROUNDED'`.
- `checkVehicleAssignable` returns `{ assignable: false, reason: string }` if `vehicle.status` is in `VEHICLE_UNASSIGNABLE_STATUSES` or `!vehicle.isActive`.

### 3. Driver Fuel Ingestion & Subledger Contract
- `POST /api/driver-app/fuel-entries` writes to `fuel_entries` and synchronously creates corresponding record in `public.fuel_logs` within transaction.
- Updates `Vehicle.odometerReading`.
- Emits `FUEL_FILLED` event (`src/events/contracts/fuel.events.ts`) to trigger `FinanceFuelConsumer` for GL postings.

### 4. Readiness & Health Contract (`src/app/api/readyz`, `src/app/api/health`)
- `/api/readyz`: Returns `200` `{ status: 'ready' }` based on Next.js database connectivity and schema completeness. Does NOT fail with 503 if Go backend is unreachable.
- `/api/health`: Surfaces Go backend connectivity. If Go is down, returns `200` with `services: { goBackend: 'degraded' }`.

### 5. Origin Resolution Contract (`src/lib/public-origin.ts`)
- `getPublicOrigin(req: Request | NextRequest): string`
- Evaluates `X-Forwarded-Proto`, `X-Forwarded-Host`, `NEXT_PUBLIC_APP_URL`, falling back to request URL origin. Resolves reverse-proxy host instead of internal `http://localhost:8080`.

## Code Layout
- `src/app/api/` — Next.js API route handlers (REST endpoints).
- `src/lib/` — Domain services, utilities, database connectors, and security helpers.
- `src/events/` — Event contracts and consumers.
- `prisma/` — Prisma schema and SQL migrations.
- `backend/` — Go microservice for background processing and billing.
- `mobile-app/` — Capacitor / React mobile driver application codebase.
- `tests/` — Automated test suites, integration tests, and verification scripts.
