-- Migration: 20260810000001_finance_extended_columns
--
-- Adds the three columns that were previously added at runtime by
-- src/app/api/finance/ar-aging/route.ts bootstrap() function, plus the
-- billing_runs table previously created at runtime by
-- src/app/api/billing/auto-invoice/route.ts ensureTables().
--
-- After this migration those runtime DDL calls must be no-ops. The
-- columns are already covered by the RLS migration
-- 20260809000000_adopt_finance_tables_with_rls (finance_invoices has
-- FORCE ROW LEVEL SECURITY and a tenant_isolation policy), so we only
-- need to add the missing columns and the new table here.

-- ── finance_invoices: ar-aging columns ───────────────────────────────────────
-- Previously added by bootstrap() in /api/finance/ar-aging/route.ts on
-- every GET request. Moving them here makes them migration-managed and
-- avoids the runtime DDL anti-pattern.

ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch        TEXT DEFAULT 'Dubai';
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS vehicle_no    TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS contract_type TEXT;

-- ── billing_runs ──────────────────────────────────────────────────────────────
-- Previously created at runtime by ensureTables() in
-- /api/billing/auto-invoice/route.ts. Moving to a proper migration so
-- that Prisma migrate status can track it and schema drift is visible.
--
-- billing_runs is a platform-level audit table (one row per billing sweep
-- across all tenants), so it does NOT get a tenant_id column or RLS policy.

CREATE TABLE IF NOT EXISTS billing_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_date         DATE        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'RUNNING',
  total_tenants    INTEGER     NOT NULL DEFAULT 0,
  invoices_created INTEGER     NOT NULL DEFAULT 0,
  total_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  errors           JSONB       NOT NULL DEFAULT '[]',
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_runs_run_date
  ON billing_runs(run_date DESC);

-- ── finance_payments ──────────────────────────────────────────────────────────
-- Previously created at runtime by ensureTables() in
-- /api/finance/payments/route.ts. Moving here so the table is
-- migration-managed and RLS-covered. finance_payments is tenant-scoped
-- through its FK to finance_invoices — invoices already have RLS, so a
-- separate tenant_id + policy on payments would be redundant. We add
-- tenant_id anyway for explicit defence-in-depth filtering.

CREATE TABLE IF NOT EXISTS finance_payments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID        REFERENCES finance_invoices(id) ON DELETE SET NULL,
  tenant_id      TEXT,
  amount         NUMERIC(14,2) NOT NULL,
  payment_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT        NOT NULL DEFAULT 'BANK_TRANSFER',
  reference      TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guard: if the table pre-existed (created by runtime DDL before this migration),
-- it may be missing tenant_id.  ADD COLUMN IF NOT EXISTS is idempotent.
ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE finance_payments ENABLE  ROW LEVEL SECURITY;
ALTER TABLE finance_payments FORCE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON finance_payments;
CREATE POLICY tenant_isolation ON finance_payments
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

CREATE INDEX IF NOT EXISTS idx_finance_payments_tenant
  ON finance_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_payments_invoice
  ON finance_payments(invoice_id);

-- ── finance_invoices: branch/tenant-branches columns ─────────────────────────
-- Previously added at runtime by ensureTable() in
-- /api/tenant-branches/route.ts. Moving here so they are migration-managed.

ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_id            UUID REFERENCES tenant_branches(id) ON DELETE SET NULL;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_name          TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_trade_license TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_address       TEXT;
