# Leasing Module — Functionality Gap Document

**Prepared as:** System analyst / product manager review
**Scope:** `src/app/api/leasing/**`, `src/app/leasing/**`, `prisma/schema.prisma` (Lease*/Lessee models), `src/lib/leasing/**`, `src/lib/jobs/**`
**Method:** Read-only static audit — no code changed. Findings verified against current `main`/`railway-migration` code as of 2026-09-02 (re-verified after several concurrent tenant-safety/RLS commits landed post the original 2026-09-01 pass).
**Companion artifact:** `.audit-reports/LEASING-FUNCTIONALITY-AUDIT.md` (original narrative audit — this document reformats and extends its Gap Analysis section into a PM-facing register, with G5's page count corrected and 4 previously-uncatalogued functionalities added: CRM & Leads, Field Operations, Branch Staff Management, Bulk Import).

---

## How to read this

Each gap has an ID (stable across both documents), a severity, the stage it sits in (see the mind map / sequence doc), the business impact in plain terms, the root cause, and a recommendation. Severity is about **business consequence**, not code complexity:

- **Critical** — breaks the core revenue workflow today, no workaround
- **High** — a real feature is unusable or invisible to users despite existing
- **Medium** — a real reliability, integrity, or safety gap that hasn't caused visible failure yet
- **Low** — cosmetic or minor consistency issue

---

## Gap register

| ID | Severity | Stage | Gap | Business impact |
|----|----------|-------|-----|------------------|
| G1 | ~~Critical~~ **FIXED 2026-09-02** | Quotation | ~~Creating a quotation throws an unhandled server error (undefined variable reference)~~ | Resolved: fixed the `req`/`request` bug, then found and fixed a second, previously-masked bug in the same path (nested vehicle create missing required `tenantId`). Verified live: quotation created end-to-end through the UI wizard. |
| G2 | Critical | Automation | The only scheduling config targets a platform (Vercel cron) this app isn't deployed on (it runs on Railway) | All 8 background jobs — expiry checks, dunning, billing consolidation — never run unless a human manually calls the endpoint. Documentation claims "14 scheduled jobs configured"; reality is zero running. |
| G3 | ~~Critical~~ **FIXED 2026-09-02** | Approval | ~~The only approval screen renders hardcoded mock data and never calls the real approve endpoint~~ | Resolved: page now fetches the real quotation + approval history and calls the real approve/convert endpoints. Also had to align the page's status pipeline to the backend's actual status vocabulary, which had drifted (see G16) — the buttons wouldn't have shown at the right times otherwise. Verified live: status persisted from `NEW` to `PENDING APPROVAL` after a real page reload. |
| G4 | Critical | Billing / Collections | Invoices and direct debits are pure record-keeping — no payment gateway or bank mandate integration exists for lessee billing | The system can compute what a lessee owes but cannot actually collect it. A "direct debit" doesn't debit anything. |
| G5 | ~~High~~ **FIXED 2026-09-02** | Cross-cutting (nav) | ~~23 of 35 leasing page directories have no navigation entry~~ — see resolution note below | ~~Staff cannot discover these screens without knowing the exact URL.~~ Resolved: `src/lib/nav/modules.ts` now lists 23 leasing sub-pages in 6 grouped sections (Sales, Contracts, Fleet & drivers, Billing & records, Master data, Monitoring). Per-page re-verification during the fix found the original count wrong: **10**, not 4, of the 24 nav-less directories are retired redirect stubs (`contracts`, `remarketing`, `direct-debits`, `branches`, plus `insurance`→`/fleet/insurance`, `fuel`→`/fleet/fuel`, `traffic-fines`→`/fleet/fines`, `payments`→`/finance/payments`, `receipts`→`/finance/payments`, `receivables`→`/finance/ar-aging` — all missed by the original audit). The other **12** real orphaned pages (Lead channels, CRM & leads, Transfers, Vehicle exchanges, Handover, Field operations, Pre-billing, Invoices, Documents, Lessees, Branch staff, Bulk import) now have nav entries; `returns` and `workflow` were deliberately left out since G8 confirms they're still mock-only with no backend — linking them would surface fake data, not fix G5. |
| G6 | High | Quotation | `POST /api/leasing/quotations` explicitly destructures `lineItems` out of the request body and discards them | The itemized pricing breakdown (accessories, services, insurance, driver add-ons) that the schema and UI were built for can never be entered. |
| G7 | High | Contract events | Accepting a renewal updates its own status only; the schema fields that should link it to the contract/quotation it produces are never written | "Propose a renewal" works; "turn an accepted renewal into an actual lease" does not. Staff have to manually create a fresh contract outside the renewal flow. |
| G8 | High | Contract events | `/leasing/returns` and `/leasing/workflow` render from hardcoded arrays with zero API calls; `returns` has no backend route at all | Any action a user takes on these screens (submit a return, approve a workflow item) is fiction — it's lost on refresh and never reaches the database. |
| G9 | High | Monitoring | Of 8 automated sweeps, only 2 notify anyone — and one of those notifies internal sales staff, not the customer | Document expiry, insurance lapse, mileage staleness, and billing consolidation can all fail silently. Combined with G2, nobody is told when something needs attention. |
| G10 | High | Cross-cutting | No shared state-machine/status-validation helper; every lifecycle route accepts any status string with no sequencing guard | A contract, quotation, or invoice can jump straight from `DRAFT` to `CLOSED` with no enforcement, or receive an invalid status entirely. |
| G11 | Medium | Self-service | The tenant portal identifies the "logged-in" lessee via a `?lesseeId=` URL parameter — no login, session, or password | Anyone who guesses or is handed a lessee ID can view that lessee's contract and billing data. The no-ID view lists every lessee in the tenant. This is a staff "view as customer" tool wearing a customer-portal skin, and it's also fully read-only (no payment, e-signature, document upload, or self-service requests). |
| G12 | Medium | Contract events | `/api/leasing/remarketing` returns HTTP 410 for every request; the 20-field `LeaseRemarketing` model is dead schema behind a deliberately disabled API | Confirmed intentional retirement, not a bug — flagged so it isn't mistaken for missing functionality during future planning. |
| G13 | Medium | Cross-cutting | Serial numbers (quotation, termination, renewal, invoice, mandate ref) are generated via unlocked `count()` → `+1` | Concurrent creates for the same tenant can compute the same number. The unique constraint turns this into a 500 rather than silent duplication, but it's a real reliability gap under load. |
| G14 | Medium | Data integrity | The Lessee↔Contract and Branch↔Contract relations lost their enforced foreign-key constraints during the V1→V2 schema migration | Referential integrity for these links depends entirely on application code being correct, not the database. |
| G15 | Medium | Data integrity | Legacy `/api/leasing/contracts` (non-v2) routes are live and write to the same production table as `contracts-v2`, but nothing in the UI calls them | An unmonitored, uncallable-by-the-UI write path into live contract data. Should likely be deleted rather than left live. |
| G16 | Medium | Quotation | The conversion allow-list uses status values (`CREDIT_APPROVED`, `PO_PREPARATION`) that don't match the schema's documented enum (`CREDIT_APPROVAL`, `PO_PREPARED`) | Evidence the status vocabulary drifted between schema documentation and implementation — a latent source of "why didn't this convert" support tickets. |
| G17 | Medium | Conversion | Quotation→contract conversion runs 4 separate database writes with no wrapping transaction | A failure partway through leaves an orphaned, half-created contract with no automatic cleanup. |
| G18 | Medium | Data integrity | The V1 table-drop migration references a preflight-checklist doc (`docs/AUDIT_SCHEMA_V1_V2.md`) that doesn't exist anywhere in the repo | No recorded evidence the documented safety check was performed before dropping production tables. |
| G19 | Medium | Collections | The email sender the dunning sweep calls falls back to a console-log mock if SMTP/integration config is absent at runtime | Whether lessees actually receive overdue-payment emails depends entirely on deploy-time config, with no visible failure signal if it's missing. |
| G20 | Low | Collections | Direct-debit `collectionDay` isn't validated against the documented 1–28 range | Minor data-quality gap. |
| G21 | Low | Cross-cutting | Dunning and invoice creation don't verify the referenced contract/lessee belongs to the caller's tenant (inconsistent with early-terminations/renewals/direct-debits, which do) | Minor tenant-isolation inconsistency; not confirmed exploitable but breaks the pattern used everywhere else. |
| G22 | Low | Cross-cutting | Several routes return the truncated placeholder string `'Internal server e'` instead of `'Internal server error'` | Cosmetic; signals rushed error handling in `quotations/[id]/convert` and all three `contracts-v2/[id]` handlers. |

---

## What's already solid (don't re-litigate these in planning)

- **Contract management (`contracts-v2`)** — full real CRUD: list, create, add-vehicle, generate payment schedule, PDF export.
- **Credit assessments** and **transfers** — genuinely complete end-to-end.
- **Amendments** and **early terminations** — real, including cascading side effects (e.g. an executed termination correctly flips the parent contract to `TERMINATED`).
- **Analytics dashboard** — live Prisma-backed KPI aggregation with proper loading/error states.
- **Driver allocation** — real assignment/release flow.
- **Field Operations app** — a genuinely wired mobile capture surface for mileage, fuel, and traffic-fine entries, feeding the same real API endpoints as the desktop pages.
- **CRM & Leads, Branch Staff Management, Bulk Import** — all fetch/write against real endpoints (`/api/leasing/crm`, `/api/branch-staff`, `/api/leasing/import/[resource]`); their only gap is G5 (no nav entry), not functionality.
- **Dunning sweep logic itself** (classification, message content, activity logging) is genuinely built — G2 (nothing triggers it) and G19 (delivery can no-op) are the actual gaps, not the business logic.
- **V1→V2 contract model migration is complete** at schema and UI level — G15/G18 are leftover cleanup items, not an active duplication risk.

---

## Recommended sequencing

If planning a remediation pass, tackle in this order — each unblocks the next:

1. ~~**G1**~~ — **done.** Quotations are the funnel entry point; nothing else mattered while this was broken.
2. **G2** — fix scheduling for the platform actually in use (Railway), since G9/G19 and half the Medium gaps are downstream of "nothing runs automatically."
3. ~~**G3**~~ — **done.** Approval UI wiring; the backend already existed, this was a frontend fix.
4. ~~**G5**~~ — **done.** Nav exposure; unlocked 12 already-built, already-working pages including the lessee master record. (Turned out the original count was off — see the G5 row for the corrected stub inventory.)
5. **G7, G6** — close the two half-built loops (renewal → contract, pricing line items) before they generate support tickets.
6. **G4, G11** — these are product/scope decisions (real payment collection, real portal auth), not quick fixes — flag for roadmap discussion rather than a sprint task.
7. Remaining Medium/Low items as hardening work alongside other leasing changes, not a dedicated pass.
