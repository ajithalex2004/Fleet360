# Leasing Module — Functionality Audit & Gap Analysis

**Scope:** `src/app/api/leasing/**` (92 route files), `prisma/schema.prisma` (32 Lease*/Lessee models), `src/app/leasing/**` (35 page directories), `src/app/portal/[tenantSlug]/leasing/**`, `src/lib/leasing/**`, `src/lib/jobs/**`, scheduling config.
**Method:** Read-only static audit — no code was changed. Findings are based on direct code inspection (route bodies, schema comments, migration files), not runtime testing.
**Date:** 2026-09-01

---

## 1. Functional Sequence Map

The module is designed around this lifecycle (present in schema + API even where the UI/automation doesn't complete the loop):

```
1. Lead Capture       Inquiries → Inquiry Activities (calls/emails/follow-ups) → Lead Channels (webhook intake)
2. Quotation           Quotation (+ Vehicles, + Line Items) → internal approval → customer approval
3. Credit & Risk       Credit Assessment per Lessee (limit, score, risk rating)
4. Approval            Multi-step Approval (Quotation | Contract, ordered steps, approve/reject)
5. Conversion           Quotation → Contract (LeaseContract2) + Contract Vehicles + Payment Schedule
6. Driver Allocation   Driver ↔ Contract/Vehicle assignment, release
7. In-Life Vehicle Ops Mileage Readings, Vehicle Exchanges, Handover
8. Ancillary Billing    Fuel Logs, Traffic Fines (consolidated into invoices via sweep)
9. Insurance           Policy tracking, renewal reminders, Claims
10. Billing            Payment schedule, Pre-Billing Statements, Invoices (+ Lines), Receipts
11. Collections         Direct Debits, Dunning Activities, Receivables view
12. Documents           Per-entity document store (contract/lessee/quotation/vehicle), expiry tracking
13. Contract Events    Renewal, Early Termination, Remarketing/disposal (retired)
14. Monitoring          Alerts (variance/expiry/overdue/approval/mileage), Telematics feed
15. Reporting           Analytics dashboard (KPIs, trends, top contracts)
16. Self-Service       Tenant portal (view-only, staff-operated "view as customer")
17. Automation          8 scheduled sweeps intended to run unattended
```

Every stage above has *some* schema and API presence. The gaps documented below are about which stages are actually usable end-to-end versus which look complete but are broken, disconnected, or silently non-functional.

---

## 2. Gap Analysis (ranked by severity)

### CRITICAL — breaks the core workflow today

**G1. Quotation creation is completely broken.**
`POST /api/leasing/quotations` has `export async function POST(request: NextRequest)`, but the first line inside references an undefined `req` instead of `request` (`requireAuthorizedTenant(req)`). This throws a `ReferenceError` before the `try/catch` block even starts. **Every attempt to create a quotation — the entry point of the entire leasing sales funnel — currently fails with an unhandled 500.** This is the single most important finding in this audit: everything downstream (approval, conversion to contract, billing) depends on a quotation existing.

**G2. Zero automation runs in production.**
The repo's only scheduling artifact is `vercel.json`'s `crons` array (1 entry: dunning sweep). The app is deployed on **Railway**, which does not read `vercel.json` cron config at all. There is no `railway.json`/`railway.toml` cron equivalent, no `node-cron`-style in-process scheduler, and no GitHub Actions `schedule:` trigger. Result: **all 8 leasing sweep jobs** (document expiry, insurance expiry, mileage staleness, dunning, inquiry follow-ups, fuel billing consolidation, traffic-fine billing consolidation) **only run if a human or external system manually calls the endpoint.** `DEPLOYMENT_GUIDE.md` claims "14 scheduled jobs configured" — false on two counts (only 1 cron entry exists in the repo, and it doesn't execute on the actual deployment target).

**G3. The approval workflow UI is 100% fake data.**
`LeaseApprovalStep` has real backing routes (`approval-steps/route.ts`, `quotations/[id]/approve/route.ts`), but the only screen that surfaces approvals — `src/app/leasing/quotations/[id]/page.tsx` — populates itself from a hardcoded `mockApprovalSteps` array and a commented-out `// In production, fetch from /api/leasing/quotations/[id]`. Clicking "Approve Internally" mutates local React state only; it never calls the real approve endpoint. Every reviewer sees the identical 3 fake steps regardless of which quotation they open, and nothing is ever persisted. A real backend exists with no real frontend attached.

**G4. No actual money movement anywhere in Leasing.**
`LeaseInvoice` and `LeaseDirectDebit` are pure record-keeping. Invoice creation computes totals and stores a row; it never attempts to charge anything. Direct debit creation generates a `mandateRef` string and stores a row; there is no bank/payment-gateway API call, no mandate submission, no actual debit execution. The only real Stripe integration in the codebase (`src/lib/billing.ts`) is for Fleet360's own SaaS subscription billing of *tenants*, unrelated to collecting rent from lessees. A "direct debit" in this product does not debit anything.

### HIGH — significant, user-facing functionality is missing or unreachable

**G5. Two-thirds of the module is unreachable through navigation.**
The Leasing nav (`src/lib/nav/modules.ts`) exposes 12 links. 23 page directories exist with no nav entry at all, including the **entire lessee master record** (`/leasing/lessees`) and the **entire billing chain** (`invoices`, `receipts`, `receivables`, `pre-billing`, `payments`) — a user cannot find their way to any of these without knowing the exact URL. (3 of the 23 are intentionally-retired redirect stubs — `contracts`, `remarketing`, `direct-debits` — and shouldn't be counted as missing functionality, but the other 20 are real, functioning pages with no way in.)

**G6. Quotation line-item pricing can be viewed but never entered.**
`LeaseQuotationItem` (accessories, services, insurance, maintenance, driver add-ons — the detailed pricing breakdown) is included in every quotation GET response, but `POST /api/leasing/quotations` explicitly destructures `lineItems` out of the request body and discards it — only `vehicles` gets written. There is no other route that writes this model. The pricing-breakdown feature the schema was built for cannot be used.

**G7. Renewals never produce a new contract.**
Accepting a renewal (`PATCH .../renewals/[id]`, status → `ACCEPTED`) updates the renewal record's own status and stamps `customerResponseAt` — nothing more. `LeaseRenewal.newContractId`/`newQuotationId` exist in the schema specifically to link a renewal to the contract it produces, but no route ever writes to them. The "propose a renewal" half of the feature is built; "turn an accepted renewal into an actual lease" is not.

**G8. `returns` and `workflow` pages are UI-only mocks with no backend at all.**
Both pages populate their tables from hardcoded arrays in a `useEffect`, with zero `fetch()` calls. `src/app/api/leasing/returns/` exists as an empty directory (no `route.ts`). Any action a user takes on these pages (submitting a return, approving a workflow item) only mutates local React state and is lost on refresh.

**G9. Most automation is invisible even when triggered manually.**
Of the 8 sweeps, only 2 send any human-facing notification: dunning (emails the lessee, if SMTP/SendGrid is configured) and inquiry follow-ups (emails/WhatsApps the *internal sales team*, never the customer). The other 6 — document expiry, insurance expiry, mileage staleness, fuel billing, fine billing — only write `LeaseAlert` rows or flip status flags. Combined with G5 (Alerts page has no nav link) and G2 (nothing runs automatically anyway), a lessee's insurance can lapse or a compliance document can expire with literally no one notified.

**G10. No status-transition enforcement anywhere.**
Every lifecycle route (contracts, quotations, invoices, direct debits, renewals, terminations) accepts whatever status string the caller sends with no enum validation and no sequencing guard. A handful of routes have hardcoded side effects tied to specific string values (e.g. setting `EXECUTED` on a termination cascades the parent contract to `TERMINATED`), but nothing stops a caller from jumping straight from `DRAFT` to `CLOSED`, or submitting an invalid status entirely. There is no shared state-machine helper used across these routes.

### MEDIUM

**G11. Self-service portal has no authentication and is fully read-only.**
`src/app/portal/[tenantSlug]/leasing/` identifies the "logged in" lessee purely via a `?lesseeId=` URL parameter — no login, session, or password anywhere in the portal code. Its own doc comment admits this: *"Lessee-level email auth is deferred to v1.1."* The no-`lesseeId` view lists every lessee in the tenant with a search box — a real customer login would never expose that. Functionally it's an internal "view as customer" staff tool, not a securable customer portal. Even setting auth aside, every sub-page is explicitly read-only (footer text tells the lessee to "contact your account manager" for anything) — no online payment, no e-signature for renewals, no document upload, no damage reporting, no self-service renewal/termination request.

**G12. Remarketing/disposal is fully retired.**
`/api/leasing/remarketing` (both routes) returns HTTP 410 Gone for every request with a hardcoded `{error: 'retired', redirectTo: '/leasing'}` — no Prisma access at all. The 20-field `LeaseRemarketing` model (sale stage workflow, book/residual/asking price, buyer tracking) is dead schema behind a deliberately disabled API.

**G13. Serial-number generation is race-condition prone.**
Quotation numbers, termination numbers, renewal numbers, invoice numbers, and direct-debit mandate refs are all generated via a `count()` → `+1` → format pattern with no locking. Concurrent creates for the same tenant can compute the same number; the unique constraint will turn this into a 500 rather than silent duplication, but it's a real reliability gap under load.

**G14. Foreign keys silently dropped during the V1→V2 migration.**
Schema comments (Layer 2.7) document that the `Lessee ↔ LeaseContract2` and `LeaseBranch ↔ LeaseContract2` relations lost their enforced FK constraints during cleanup — they exist as Prisma-level relations only. Data integrity for these links depends entirely on application code being correct, not the database.

**G15. Legacy `/api/leasing/contracts` (non-v2) routes are live, unused, and write to the same production table.**
The v1 URL namespace was patched to alias `LeaseContract2` after the real V1 model was dropped, so these routes function correctly — but nothing in the codebase calls them (confirmed no `fetch('/api/leasing/contracts')` anywhere). They're an unmonitored, uncallable-by-the-UI write path into live contract data that should probably be deleted rather than left live.

**G16. Inconsistent status vocabulary between schema and code.**
The quotation-conversion allow-list (`quotations/[id]/convert/route.ts`) uses status values (`CREDIT_APPROVED`, `PO_PREPARATION`) that don't match the schema comment's documented enum (`CREDIT_APPROVAL`, `PO_PREPARED`) — evidence the status vocabulary drifted between when the schema was documented and when this route was written.

**G17. No transaction safety in quotation→contract conversion.**
Converting an approved quotation into a contract does 4 separate database calls (create contract, create each vehicle, bulk-create payment schedule, update quotation status) with no wrapping transaction. A failure partway through leaves an orphaned, half-created contract with no automatic cleanup.

**G18. Missing migration preflight documentation.**
The V1 table-drop migration (`20260626000001_drop_lease_v1_tables`) references `docs/AUDIT_SCHEMA_V1_V2.md` as the preflight checklist that should have been run before dropping `lease_contracts`/`lease_payments`/`lease_vehicle_returns` in production — that file does not exist anywhere in the repo. No recorded evidence the documented safety check was ever performed.

**G19. Dunning emails can silently no-op.**
The email sender the dunning sweep actually calls (`src/services/email/emailService.ts`) falls back to a `console.log('[EMAIL SERVICE] MOCK EMAIL SENT...')` with no real send if SMTP/integration config isn't set at runtime. Whether lessees actually receive overdue-payment emails depends entirely on whether that config happens to be present in the deployed environment.

### LOW

- Direct debit `collectionDay` isn't validated against the documented 1–28 range.
- Dunning-activity creation (`receivables/dunning/route.ts`) doesn't verify the referenced contract belongs to the caller's tenant before writing (inconsistent with early-terminations/renewals/direct-debits, which all do this check).
- Invoice creation doesn't validate the `lesseeId` belongs to the tenant either (same inconsistency).
- Several routes return the truncated placeholder error string `'Internal server e'` instead of `'Internal server error'` (`quotations/[id]/convert`, all three handlers in `contracts-v2/[id]/route.ts`) — cosmetic, but signals rushed error-handling.

---

## 3. What's Actually Solid

Worth stating plainly so this isn't read as "the module doesn't work":

- **Contract management (`contracts-v2`)** is a real, fully-wired CRUD system — list, create, add-vehicle, generate payment schedule, PDF export all function against real data.
- **Credit assessments** and **transfers** pages are genuinely complete end-to-end (verified GET/POST/PATCH all wired).
- **Analytics dashboard** is a real KPI view backed by live Prisma aggregation, with a proper loading/error-fallback state.
- **26 of 32 Lease* models** have full, real API coverage (create/read at minimum) once you account for nested-relation writes.
- **Dunning sweep logic itself** (classification, email content, activity logging) is genuinely built — it's the *triggering* mechanism (G2) and *email delivery config* (G19) that are the gaps, not the business logic.
- The **V1→V2 contract model migration is actually complete** at the schema and UI layer — this is not an active duplication problem, just leftover dead API surface (G15) and a missing paper trail (G18).

---

## 4. Suggested Priority Order (for discussion, not a commitment)

If tackled, the highest-leverage sequence would likely be: **G1** (quotations are the funnel entry point — nothing else matters if this is broken) → **G2** (fix scheduling for the platform actually in use) → **G3** (approval UI wiring, since the backend already exists) → **G5** (nav exposure — cheap, unlocks a lot of already-built pages) → **G9/G19** (notification delivery) → everything else.
