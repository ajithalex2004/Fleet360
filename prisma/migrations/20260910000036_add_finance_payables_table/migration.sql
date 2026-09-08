-- finance_payables (AP sub-ledger — vendor invoices and payable obligations).
--
-- Fully modeled in schema.prisma with an explicit lineage comment
-- ("MAINTENANCE_REQUEST | CARRIER_SETTLEMENT | VENDOR_INVOICE | MANUAL"),
-- but no migration was ever generated for it — same situation as the
-- Fleet360 Exchange partner-settlement tables (migration 20260910000035).
--
-- id uses native UUID (schema.prisma explicitly declares @db.Uuid here,
-- unlike most other models this session where String ids map to TEXT).

CREATE TABLE IF NOT EXISTS finance.finance_payables (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  payable_number    TEXT        NOT NULL UNIQUE,

  vendor_id         TEXT,
  vendor_name       TEXT        NOT NULL,
  vendor_email      TEXT,
  vendor_phone      TEXT,

  module            TEXT,
  source_type       TEXT,
  source_id         TEXT,

  description       TEXT,
  line_items        JSONB       NOT NULL DEFAULT '[]',

  subtotal          NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency          TEXT        NOT NULL DEFAULT 'AED',

  issue_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,

  payment_status    TEXT        NOT NULL DEFAULT 'UNPAID',
  status            TEXT        NOT NULL DEFAULT 'DRAFT',

  cost_centre       TEXT,
  profit_centre     TEXT,
  journal_entry_id  TEXT,

  prepared_by       TEXT,
  approved_by       TEXT,
  posted_by         TEXT,
  approved_at       TIMESTAMPTZ,
  posted_at         TIMESTAMPTZ,

  notes             TEXT,
  tenant_id         TEXT
);

CREATE INDEX IF NOT EXISTS idx_finance_payables_tenant ON finance.finance_payables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_payables_status ON finance.finance_payables(status);
CREATE INDEX IF NOT EXISTS idx_finance_payables_payment_status ON finance.finance_payables(payment_status);
CREATE INDEX IF NOT EXISTS idx_finance_payables_vendor ON finance.finance_payables(vendor_id);
CREATE INDEX IF NOT EXISTS idx_finance_payables_source ON finance.finance_payables(source_type, source_id);
