-- Migration: 20260810000006_finance_ap_debit_notes_payment_alloc_profit_centres
-- Closes 4 Finance architecture gaps:
--   1. AP sub-ledger (finance_payables)
--   2. Debit Notes    (finance_debit_notes)
--   3. Payment Allocation many-to-many (finance_payment_allocations)
--   4. Profit Centres master + profit_centre column on journal lines & expenses

-- ── 1. Profit Centre master ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance.finance_profit_centres (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  code        TEXT        UNIQUE NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT,
  parent_code TEXT,
  -- Business unit this profit centre belongs to
  module      TEXT,       -- RENTAL | LEASING | LOGISTICS | BUS | MAINTENANCE | GENERAL

  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Optional planning budget in local currency
  budget      NUMERIC(15,2),
  -- Null = platform-wide; set to scope to a single tenant
  tenant_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_profit_centres_code
  ON finance.finance_profit_centres(code);
CREATE INDEX IF NOT EXISTS idx_profit_centres_tenant
  ON finance.finance_profit_centres(tenant_id);

-- Seed standard profit centres (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO finance.finance_profit_centres (code, name, module, description) VALUES
  ('PC-RENTAL',      'Rent-A-Car',            'RENTAL',      'Revenue and costs for the Rent-A-Car business unit'),
  ('PC-LEASING',     'Vehicle Leasing',        'LEASING',     'Revenue and costs for the Leasing business unit'),
  ('PC-LOGISTICS',   'Freight & Logistics',    'LOGISTICS',   'Revenue and costs for the Logistics & Freight business unit'),
  ('PC-BUS',         'Bus Operations',         'BUS',         'Revenue and costs for Bus / Public Transport operations'),
  ('PC-MAINTENANCE', 'Fleet Maintenance',      'MAINTENANCE', 'Costs for workshop and fleet maintenance services'),
  ('PC-ADMIN',       'Group Administration',   'GENERAL',     'Central administration and overhead costs'),
  ('PC-TECH',        'Technology & Platform',  'GENERAL',     'IT infrastructure, software, and platform costs')
ON CONFLICT (code) DO NOTHING;

-- ── 2. Add profit_centre to existing accounting tables ────────────────────────
-- IF EXISTS guards: these tables were runtime-DDL creations in production
-- and get their `finance.` schema via the 20260810000005_introduce_domain_schemas
-- migration's SET SCHEMA IF EXISTS calls. On a fresh shadow DB the source
-- tables never existed so the SET SCHEMA skipped, leaving these ALTERs
-- pointing at nonexistent tables. The follow-up migration
-- 20260811200000_create_missing_finance_tables materialises them; for
-- shadow-DB replay these ADD COLUMNs are moot.

ALTER TABLE IF EXISTS finance.finance_journal_lines
  ADD COLUMN IF NOT EXISTS profit_centre TEXT;

ALTER TABLE IF EXISTS finance.finance_expenses
  ADD COLUMN IF NOT EXISTS profit_centre TEXT;

-- ── 3. AP sub-ledger (finance_payables) ──────────────────────────────────────
--
-- Records vendor invoices / payable obligations.
-- Lifecycle: DRAFT → SUBMITTED → APPROVED → POSTED
-- Payment status: UNPAID → PARTIALLY_PAID → PAID (or OVERDUE | VOID)

CREATE TABLE IF NOT EXISTS finance.finance_payables (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,

  payable_number TEXT        UNIQUE NOT NULL,
  -- Vendor identification
  vendor_id      TEXT,
  vendor_name    TEXT        NOT NULL,
  vendor_email   TEXT,
  vendor_phone   TEXT,

  -- Source module that generated this payable
  module         TEXT,       -- MAINTENANCE | LOGISTICS | LEASING | GENERAL
  -- Source document type for lineage tracing
  source_type    TEXT,       -- MAINTENANCE_REQUEST | CARRIER_SETTLEMENT | VENDOR_INVOICE | MANUAL
  source_id      TEXT,

  description    TEXT,
  line_items     JSONB       NOT NULL DEFAULT '[]',

  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency       TEXT        NOT NULL DEFAULT 'AED',

  issue_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,

  -- UNPAID | PARTIALLY_PAID | PAID | OVERDUE | VOID
  payment_status TEXT        NOT NULL DEFAULT 'UNPAID',
  -- DRAFT | SUBMITTED | APPROVED | POSTED
  status         TEXT        NOT NULL DEFAULT 'DRAFT',

  cost_centre    TEXT,
  profit_centre  TEXT,

  -- Set to the JE id once the payable is POSTED to the GL
  journal_entry_id TEXT,

  prepared_by    TEXT,
  approved_by    TEXT,
  posted_by      TEXT,
  approved_at    TIMESTAMPTZ,
  posted_at      TIMESTAMPTZ,

  notes          TEXT,
  tenant_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_finance_payables_tenant
  ON finance.finance_payables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_payables_status
  ON finance.finance_payables(status);
CREATE INDEX IF NOT EXISTS idx_finance_payables_payment_status
  ON finance.finance_payables(payment_status);
CREATE INDEX IF NOT EXISTS idx_finance_payables_vendor
  ON finance.finance_payables(vendor_id);
CREATE INDEX IF NOT EXISTS idx_finance_payables_source
  ON finance.finance_payables(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_finance_payables_due_date
  ON finance.finance_payables(due_date)
  WHERE deleted_at IS NULL AND payment_status NOT IN ('PAID','VOID');

-- ── 4. Debit Notes (finance_debit_notes) ─────────────────────────────────────
--
-- Symmetric to finance_credit_notes.
-- AP-side: raised against a payable (vendor overcharged us → we send a DN to reduce the AP)
-- AR-side: raised against an invoice  (customer owes more → we send a DN to increase the AR)
-- Lifecycle: DRAFT → ISSUED → APPLIED | VOIDED

CREATE TABLE IF NOT EXISTS finance.finance_debit_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,

  dn_number   TEXT        UNIQUE NOT NULL,

  -- AP-side reference (debit note sent to vendor to reduce payable)
  original_payable_id TEXT,
  original_payable_no TEXT,
  -- AR-side reference (debit note sent to customer to increase receivable)
  original_invoice_id TEXT,
  original_invoice_no TEXT,

  -- "vendor_name" serves as the counterparty name regardless of AP/AR direction
  vendor_name TEXT        NOT NULL,
  vendor_email TEXT,

  module      TEXT,

  -- PRICE_CORRECTION | RETURN_OF_GOODS | SERVICE_SHORTFALL | OVERCHARGE | UNDERBILLING | OTHER
  reason_code   TEXT        NOT NULL,
  reason_detail TEXT,

  line_items  JSONB       NOT NULL DEFAULT '[]',

  subtotal    NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency    TEXT        NOT NULL DEFAULT 'AED',
  issue_date  DATE        NOT NULL DEFAULT CURRENT_DATE,

  -- DRAFT | ISSUED | APPLIED | VOIDED
  status      TEXT        NOT NULL DEFAULT 'DRAFT',
  -- How much of this debit note has been applied against its source document
  applied_amount NUMERIC(15,2) NOT NULL DEFAULT 0,

  issued_by   TEXT,
  approved_by TEXT,
  notes       TEXT,
  tenant_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_finance_debit_notes_tenant
  ON finance.finance_debit_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_debit_notes_status
  ON finance.finance_debit_notes(status);
CREATE INDEX IF NOT EXISTS idx_finance_debit_notes_payable
  ON finance.finance_debit_notes(original_payable_id)
  WHERE original_payable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_debit_notes_invoice
  ON finance.finance_debit_notes(original_invoice_id)
  WHERE original_invoice_id IS NOT NULL;

-- ── 5. Payment Allocations (finance_payment_allocations) ─────────────────────
--
-- Many-to-many: one payment can be split across multiple invoices (AR)
-- or multiple payables (AP). Partial allocation is supported via
-- allocated_amount < the invoice/payable total_amount.
--
-- After each INSERT the trigger fn update_document_paid_amount() recalculates
-- paid_amount and payment_status on the linked invoice or payable.

CREATE TABLE IF NOT EXISTS finance.finance_payment_allocations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  payment_id       UUID        NOT NULL
                     REFERENCES finance.finance_payments(id) ON DELETE CASCADE,

  -- AR allocation — links to a customer invoice
  invoice_id       UUID
                     REFERENCES finance.finance_invoices(id) ON DELETE SET NULL,

  -- AP allocation — links to a vendor payable
  payable_id       UUID
                     REFERENCES finance.finance_payables(id) ON DELETE SET NULL,

  allocated_amount NUMERIC(14,2) NOT NULL,
  allocation_date  DATE        NOT NULL DEFAULT CURRENT_DATE,

  notes            TEXT,
  allocated_by     TEXT,
  tenant_id        TEXT,

  -- Every allocation must target exactly one document
  CONSTRAINT chk_alloc_target
    CHECK (invoice_id IS NOT NULL OR payable_id IS NOT NULL),
  -- Prevent duplicate allocation of the same payment to the same document
  CONSTRAINT uq_alloc_payment_invoice UNIQUE NULLS NOT DISTINCT (payment_id, invoice_id),
  CONSTRAINT uq_alloc_payment_payable UNIQUE NULLS NOT DISTINCT (payment_id, payable_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment
  ON finance.finance_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice
  ON finance.finance_payment_allocations(invoice_id)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_alloc_payable
  ON finance.finance_payment_allocations(payable_id)
  WHERE payable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_alloc_tenant
  ON finance.finance_payment_allocations(tenant_id);

-- ── 6. Trigger: keep paid_amount / payment_status in sync ────────────────────
--
-- Fires AFTER INSERT OR UPDATE OR DELETE on finance_payment_allocations.
-- Recalculates the target document's paid_amount and flips payment_status
-- (UNPAID → PARTIALLY_PAID → PAID) automatically.

CREATE OR REPLACE FUNCTION finance.fn_sync_alloc_paid_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_invoice_id UUID;
  v_payable_id UUID;
  v_total      NUMERIC(14,2);
  v_paid       NUMERIC(14,2);
BEGIN
  -- Determine which document id changed (handles INSERT, UPDATE, DELETE)
  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
    v_payable_id := OLD.payable_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
    v_payable_id := NEW.payable_id;
  END IF;

  -- ── AR invoice ──────────────────────────────────────────────────────────
  IF v_invoice_id IS NOT NULL THEN
    SELECT COALESCE(SUM(allocated_amount),0)
      INTO v_paid
      FROM finance.finance_payment_allocations
     WHERE invoice_id = v_invoice_id;

    SELECT total_amount INTO v_total
      FROM finance.finance_invoices
     WHERE id = v_invoice_id;

    UPDATE finance.finance_invoices
       SET paid_amount     = v_paid,
           payment_status  = CASE
             WHEN v_paid <= 0                  THEN 'UNPAID'
             WHEN v_paid >= COALESCE(v_total,0) THEN 'PAID'
             ELSE 'PARTIALLY_PAID'
           END,
           updated_at = NOW()
     WHERE id = v_invoice_id;
  END IF;

  -- ── AP payable ──────────────────────────────────────────────────────────
  IF v_payable_id IS NOT NULL THEN
    SELECT COALESCE(SUM(allocated_amount),0)
      INTO v_paid
      FROM finance.finance_payment_allocations
     WHERE payable_id = v_payable_id;

    SELECT total_amount INTO v_total
      FROM finance.finance_payables
     WHERE id = v_payable_id;

    UPDATE finance.finance_payables
       SET paid_amount     = v_paid,
           payment_status  = CASE
             WHEN v_paid <= 0                  THEN 'UNPAID'
             WHEN v_paid >= COALESCE(v_total,0) THEN 'PAID'
             ELSE 'PARTIALLY_PAID'
           END,
           updated_at = NOW()
     WHERE id = v_payable_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_alloc_paid_amount
  ON finance.finance_payment_allocations;

CREATE TRIGGER trg_sync_alloc_paid_amount
  AFTER INSERT OR UPDATE OR DELETE
  ON finance.finance_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION finance.fn_sync_alloc_paid_amount();

-- ── 7. RLS on new tables (match existing finance table policy pattern) ────────

ALTER TABLE finance.finance_profit_centres    ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.finance_payables          ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.finance_debit_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.finance_payment_allocations ENABLE ROW LEVEL SECURITY;

-- Policy: superuser / service-role bypasses; tenant-scoped roles see only
-- their own rows (tenant_id match). Platform admin sees all.
CREATE POLICY tenant_isolation ON finance.finance_payables
  USING (tenant_id = current_setting('app.tenant_id', TRUE)
         OR current_setting('app.tenant_id', TRUE) = '*'
         OR current_setting('app.tenant_id', TRUE) IS NULL);

CREATE POLICY tenant_isolation ON finance.finance_debit_notes
  USING (tenant_id = current_setting('app.tenant_id', TRUE)
         OR current_setting('app.tenant_id', TRUE) = '*'
         OR current_setting('app.tenant_id', TRUE) IS NULL);

CREATE POLICY tenant_isolation ON finance.finance_payment_allocations
  USING (tenant_id = current_setting('app.tenant_id', TRUE)
         OR current_setting('app.tenant_id', TRUE) = '*'
         OR current_setting('app.tenant_id', TRUE) IS NULL);

-- Profit centres are platform-wide (no per-tenant isolation needed)
CREATE POLICY allow_all ON finance.finance_profit_centres USING (TRUE);

-- ── 8. Grants to existing roles ───────────────────────────────────────────────

GRANT ALL ON TABLE finance.finance_profit_centres       TO fleet360_api_role;
GRANT ALL ON TABLE finance.finance_payables             TO fleet360_api_role;
GRANT ALL ON TABLE finance.finance_debit_notes          TO fleet360_api_role;
GRANT ALL ON TABLE finance.finance_payment_allocations  TO fleet360_api_role;

-- AI role: read-only on payables for anomaly detection; no access to debit notes / allocations
GRANT SELECT ON TABLE finance.finance_payables TO fleet360_ai_role;
