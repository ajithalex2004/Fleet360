-- Migration: 20260810000000_enterprise_data_residency
--
-- Adds data residency tracking to the tenants table for ENTERPRISE tier.
-- Enterprise customers may have contractual or regulatory requirements
-- (GDPR / UAE PDPL) specifying which geographic region their data must
-- remain in.  GLOBAL is the default (current behaviour — single Neon DB).
--
-- Valid values: GLOBAL | EU | UAE | US
-- The application's DB router (src/lib/db-router.ts) maps each value to
-- a separate DATABASE_URL_* env var when present; it falls back to
-- DATABASE_URL for GLOBAL or unconfigured regions.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS data_residency TEXT NOT NULL DEFAULT 'GLOBAL';

-- Guard: reject unknown region codes at the DB level so no migration or
-- application bug can silently store an unsupported value.
ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_data_residency_check;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_data_residency_check
    CHECK (data_residency IN ('GLOBAL', 'EU', 'UAE', 'US'));

-- Index to make "give me all tenants in region X" O(log n) for the
-- connection-pool warm-up sweep and admin reporting.
CREATE INDEX IF NOT EXISTS tenants_data_residency_idx
  ON tenants (data_residency);

-- RLS policy comment: data_residency is a tenant-level attribute; the
-- existing per-row tenant_id policies already isolate rows. The residency
-- column doesn't need its own RLS policy — it's used purely for routing,
-- not access control.
