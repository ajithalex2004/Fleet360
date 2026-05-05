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
**Status:** acknowledged · **Target:** before go-live · **Owner:** athom

`.env.test` (gitignored) contains a real Neon Postgres password
(`npg_7ndWFKRYEOt6`). The credential has lived in the OneDrive-synced project
folder for 4+ months, which is not the same threat model as plain text on the
network but is broader than acceptable for a production DB credential.

Before STS go-live, regenerate the Neon database credentials and update
`.env.test` (and any other `.env*` files) with the new value.

---

## KNOWN-PRISMA-001 — `prisma generate` fails with "Invalid character" on Node 22
**Status:** open · **Target:** v1.0 cleanup · **Owner:** core

`npx prisma generate` fails on this machine with a one-line `Error: Invalid character`
after DMMF retrieval succeeds. `prisma validate` passes; `prisma --version` works.
Engines (`query_engine-windows.dll.node`) are present.

**Likely cause:** Prisma 5.10.0 (`"prisma": "^5.10.0"` in package.json) was released
in early 2024 and has known incompatibilities with Node 22 (released Apr 2024).
The codegen step's wasm engine surfaces the incompatibility as a generic
"Invalid character" error.

**Workaround in code:** New schema fields are accessed via `(model as any).newField`
type assertion, with a `KNOWN-PRISMA-001` comment pointing here. The runtime works
fine after the migration runs — only TypeScript types are out of sync.

**Affected fields right now:**
- `LeaseContract2.mileageOverageRate` (added in
  `20260505000001_add_mileage_overage_rate` migration; used in
  `src/app/api/leasing/mileage-readings/route.ts`)

**Fix path:**
1. Upgrade Prisma to 5.20+ (or 6.x): `npm install -D prisma@latest --legacy-peer-deps`
2. Update `@prisma/client` to match
3. `npx prisma generate` should succeed
4. Remove the `(... as any).` casts and the KNOWN-PRISMA-001 comments

**Mitigation now:** Production deployment runs `npx prisma generate` as part of
the build step; if production is on Node 20 (per `engines: { node: ">=20.9.0" }`),
the generate succeeds and types are correct in the deployed bundle. Local dev on
Node 22 has stale types but runtime works.

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
