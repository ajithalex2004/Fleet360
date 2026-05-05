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
