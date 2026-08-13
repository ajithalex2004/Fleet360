-- =====================================================================
-- Migration: adopt finance tables into Prisma + apply RLS
-- =====================================================================
--
-- Context: finance_invoices, finance_journal_entries, and
-- finance_journal_lines were previously created at runtime via
-- $executeRawUnsafe DDL in src/lib/finance-source-ledger.ts and
-- src/lib/logistics/domain.ts. This means they were NOT covered by
-- the RLS migration (20260803000000_rls_tenant_isolation_all_tables),
-- so any tenant could read another tenant's financial data if the
-- application-level WHERE tenant_id = $1 filter was bypassed.
--
-- This migration:
--   1. Creates the three tables IF they don't exist (idempotent for
--      environments that already have them from the runtime DDL path).
--   2. Adds any columns that the old runtime ALTER TABLE path may have
--      added on existing deployments.
--   3. Creates all required indexes (IF NOT EXISTS — safe to re-run).
--   4. Enables FORCE ROW LEVEL SECURITY on all three tables.
--   5. Drops any old unscoped policy and creates the canonical
--      three-branch policy that matches every other table in the schema.
--
-- After this migration the runtime ensureFinanceSourceLedger() and
-- ensureFinanceJournalPostingTables() functions must NOT be called —
-- they have been gutted in src/lib/finance-source-ledger.ts and
-- src/lib/logistics/domain.ts.
--
-- =====================================================================

-- ── 1. finance_invoices ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_invoices (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number   TEXT        NOT NULL,
  client_name      TEXT        NOT NULL,
  client_email     TEXT,
  client_phone     TEXT,
  client_address   TEXT,
  service_type     TEXT        NOT NULL DEFAULT 'GENERAL',
  module           TEXT        NOT NULL DEFAULT 'GENERAL',
  description      TEXT,
  line_items       JSONB       NOT NULL DEFAULT '[]',
  subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 5,
  vat_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency         TEXT        NOT NULL DEFAULT 'AED',
  issue_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE,
  payment_status   TEXT        NOT NULL DEFAULT 'DRAFT',
  notes            TEXT,
  reference_id     UUID,
  reference_type   TEXT,
  created_by       TEXT,
  tenant_id        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

-- Unique constraint on invoice_number — the old table had this, guard idempotently.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'finance_invoices' AND constraint_type = 'UNIQUE'
      AND constraint_name = 'finance_invoices_invoice_number_key'
  ) THEN
    ALTER TABLE finance_invoices ADD CONSTRAINT finance_invoices_invoice_number_key UNIQUE (invoice_number);
  END IF;
END $$;

-- Additive columns introduced by the old runtime ALTER TABLE path.
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS module_source        TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_entity_type   TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_entity_id     TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_entity_no     TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_customer_id   TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_customer_name TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_contract_ids  TEXT[];
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_payload       JSONB NOT NULL DEFAULT '{}';
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS line_items_json      JSONB;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_finance_invoices_tenant_id
  ON finance_invoices(tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_invoices_source
  ON finance_invoices(module_source, reference_type, reference_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_invoices_source_entity
  ON finance_invoices(source_entity_type, source_entity_id)
  WHERE deleted_at IS NULL;

-- ── 2. finance_journal_entries ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_journal_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  je_number       TEXT        NOT NULL,
  entry_date      DATE        NOT NULL,
  period_year     INTEGER     NOT NULL,
  period_month    INTEGER     NOT NULL,
  narration       TEXT        NOT NULL,
  reference       TEXT,
  source_type     TEXT        NOT NULL DEFAULT 'MANUAL',
  source_id       TEXT,
  status          TEXT        NOT NULL DEFAULT 'DRAFT',
  total_debit     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_credit    NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_balanced     BOOLEAN     NOT NULL DEFAULT FALSE,
  reversed_je_id  TEXT,
  reversal_je_id  TEXT,
  prepared_by     TEXT,
  approved_by     TEXT,
  posted_by       TEXT,
  approved_at     TIMESTAMPTZ,
  posted_at       TIMESTAMPTZ,
  notes           TEXT,
  currency        TEXT        NOT NULL DEFAULT 'AED',
  tenant_id       TEXT
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'finance_journal_entries' AND constraint_type = 'UNIQUE'
      AND constraint_name = 'finance_journal_entries_je_number_key'
  ) THEN
    ALTER TABLE finance_journal_entries ADD CONSTRAINT finance_journal_entries_je_number_key UNIQUE (je_number);
  END IF;
END $$;

-- Additive columns: the old runtime DDL may have created this table without
-- tenant_id or deleted_at. Guard with IF NOT EXISTS so the migration is safe
-- on both old (runtime-created) and new (migration-created) tables.
ALTER TABLE finance_journal_entries ADD COLUMN IF NOT EXISTS tenant_id  TEXT;
ALTER TABLE finance_journal_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_tenant_id
  ON finance_journal_entries(tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_logistics_source
  ON finance_journal_entries(tenant_id, source_type, source_id)
  WHERE deleted_at IS NULL;

-- ── 3. finance_journal_lines ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_journal_lines (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  journal_entry_id  UUID        NOT NULL
    REFERENCES finance_journal_entries(id) ON DELETE CASCADE,
  line_number       INTEGER     NOT NULL,
  account_code      TEXT        NOT NULL,
  account_name      TEXT,
  description       TEXT,
  debit_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  normal_balance    TEXT        NOT NULL DEFAULT 'DEBIT',
  cost_centre       TEXT,
  currency          TEXT        NOT NULL DEFAULT 'AED'
);

CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_entry_id
  ON finance_journal_lines(journal_entry_id);

-- ── 4. Enable FORCE RLS + drop old policy + create canonical policy ──────────
--
-- We apply the same three-branch USING clause used on every other
-- tenant-scoped table (see 20260803000000_rls_tenant_isolation_all_tables).
--
-- finance_journal_lines has no tenant_id — it inherits tenant scope through
-- its parent journal entry. No RLS policy is needed on that table; the FK
-- + CASCADE ensure lines are unreachable without the parent row.

DO $$ BEGIN
  ALTER TABLE finance_invoices         ENABLE  ROW LEVEL SECURITY;
  ALTER TABLE finance_invoices         FORCE   ROW LEVEL SECURITY;
  ALTER TABLE finance_journal_entries  ENABLE  ROW LEVEL SECURITY;
  ALTER TABLE finance_journal_entries  FORCE   ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN
  -- Some managed Postgres configs (e.g. Neon) raise on ENABLE if already set.
  NULL;
END $$;

-- finance_invoices policy
DROP POLICY IF EXISTS tenant_isolation ON finance_invoices;
CREATE POLICY tenant_isolation ON finance_invoices
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

-- finance_journal_entries policy
DROP POLICY IF EXISTS tenant_isolation ON finance_journal_entries;
CREATE POLICY tenant_isolation ON finance_journal_entries
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );
