-- Migration: 20260810000002_tenant_branches_and_fleet_columns
--
-- Creates the tenant_branches table that was previously created at runtime
-- by ensureTable() in src/app/api/tenant-branches/route.ts, and adds the
-- branch_id / trn columns that were also added at runtime by that function.
--
-- This migration must run BEFORE 20260810000001_finance_extended_columns
-- because that migration adds a FK from finance_invoices.branch_id →
-- tenant_branches(id).  If you are applying both for the first time, Prisma
-- migrate apply runs them in filename-timestamp order, so 000001 < 000002
-- would be wrong — but this file uses timestamp 000002 which sorts AFTER
-- 000001.  If your target DB already has tenant_branches (created at
-- runtime), every statement here uses IF NOT EXISTS / IF NOT EXIST guards
-- so the migration is fully idempotent.
--
-- After this migration is applied the ensureTable() function in the route
-- is redundant and has been removed.

-- ── tenant_branches ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_branches (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT        NOT NULL,
  branch_name             TEXT        NOT NULL,
  emirate                 TEXT        NOT NULL DEFAULT 'DUBAI',
  trade_license_no        TEXT,
  trade_license_authority TEXT,
  trade_license_expiry    DATE,
  billing_address         TEXT,
  billing_city            TEXT,
  billing_po_box          TEXT,
  contact_name            TEXT,
  contact_email           TEXT,
  contact_phone           TEXT,
  cost_center_code        TEXT,
  is_default              BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenant_branches_tenant
  ON tenant_branches(tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_branches_emirate
  ON tenant_branches(emirate)
  WHERE deleted_at IS NULL;

-- ── tenants: TRN (Tax Registration Number) ───────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trn TEXT;

-- ── vehicles: branch association ─────────────────────────────────────────────
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS branch_id UUID
    REFERENCES tenant_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_branch_id
  ON vehicles(branch_id)
  WHERE branch_id IS NOT NULL;

-- ── trip_logs: branch association ─────────────────────────────────────────────
ALTER TABLE trip_logs
  ADD COLUMN IF NOT EXISTS branch_id UUID
    REFERENCES tenant_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trip_logs_branch_id
  ON trip_logs(branch_id)
  WHERE branch_id IS NOT NULL;
