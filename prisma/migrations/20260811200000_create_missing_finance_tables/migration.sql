-- Migration: 20260811200000_create_missing_finance_tables
--
-- Closes the remaining schema gap: 4 finance tables declared in schema.prisma
-- but never created in the dev DB (neither by the runtime DDL nor by any
-- prior migration). The Prisma client would crash at runtime on any query
-- against these models.
--
-- Tables created (in finance schema, per their @@schema("finance")):
--   1. finance_pdc_cheques        — Post-dated cheques (PDC) ledger
--   2. finance_expenses           — Expenses (purchases, bills, supplier invoices)
--   3. finance_collection_cases   — Dunning / collection cases
--   4. finance_bank_accounts      — Bank accounts (parent of bank statements)
--
-- Type choices follow the existing dev DB:
--   - tenant_id, vehicle_id, driver_id are TEXT (matching the actual
--     tenants/vehicles/drivers.id columns in this DB)
--   - finance_invoices.id is UUID, so invoiceId-style soft references
--     stay as TEXT (Prisma serialises UUIDs as strings; the user code
--     formats them when reading/writing)
--   - All Prisma @@schema("finance") tables use the finance schema
--
-- No indexes beyond what the Prisma model implies (UNIQUE on
-- expenseNo / caseNo). Tenant_id / status indexes can be added later
-- as performance work — not part of this gap-closing migration.

-- ── 1. finance_pdc_cheques ─────────────────────────────────────────────────────
-- Post-dated cheques. INCOMING (from client) or OUTGOING (to supplier).
-- Lifecycle: HELD | DEPOSITED | CLEARED | BOUNCED | CANCELLED | RETURNED.

CREATE TABLE IF NOT EXISTS finance.finance_pdc_cheques (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ(6)            DEFAULT NOW(),
  updated_at        TIMESTAMPTZ(6),
  deleted_at        TIMESTAMPTZ(6),

  cheque_number     TEXT         NOT NULL,
  bank_name         TEXT         NOT NULL,
  account_name      TEXT,
  cheque_date       DATE         NOT NULL,
  amount            NUMERIC(15,2) NOT NULL,
  currency          TEXT         NOT NULL DEFAULT 'AED',

  direction         TEXT         NOT NULL DEFAULT 'INCOMING',
  client_name       TEXT,
  client_ref        TEXT,

  status            TEXT         NOT NULL DEFAULT 'HELD',
  deposited_at      TIMESTAMPTZ(6),
  cleared_at        TIMESTAMPTZ(6),
  bounced_at        TIMESTAMPTZ(6),
  bounce_reason     TEXT,

  linked_invoice_id  TEXT,
  notes             TEXT,
  created_by        TEXT,
  tenant_id         TEXT
);

-- ── 2. finance_expenses ────────────────────────────────────────────────────────
-- Expenses: purchases, bills, supplier invoices. Many of the columns here
-- were retro-added by 20260810000006 (profit_centre) on a table that
-- never existed in dev — we add it now with the final shape.
-- Lifecycle: DRAFT | SUBMITTED | APPROVED | REJECTED | PAID.

CREATE TABLE IF NOT EXISTS finance.finance_expenses (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ(6)            DEFAULT NOW(),
  updated_at        TIMESTAMPTZ(6),
  deleted_at        TIMESTAMPTZ(6),

  expense_no        TEXT         NOT NULL UNIQUE,
  category          TEXT         NOT NULL,
  sub_category      TEXT,
  description       TEXT         NOT NULL,
  amount            NUMERIC(15,2) NOT NULL,
  currency          TEXT         NOT NULL DEFAULT 'AED',
  vat_amount        NUMERIC(15,2)            DEFAULT 0,
  total_amount      NUMERIC(15,2) NOT NULL,

  expense_date      DATE         NOT NULL,
  payment_method    TEXT,
  reference_no      TEXT,

  status            TEXT         NOT NULL DEFAULT 'DRAFT',

  vehicle_id        TEXT,
  driver_id         TEXT,
  cost_centre       TEXT,
  profit_centre     TEXT,

  receipt_url       TEXT,
  submitted_by      TEXT,
  submitted_at      TIMESTAMPTZ(6),
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ(6),
  rejected_by       TEXT,
  rejected_at       TIMESTAMPTZ(6),
  rejection_reason  TEXT,
  paid_at           TIMESTAMPTZ(6),
  notes             TEXT,
  tenant_id         TEXT
);

-- ── 3. finance_collection_cases ────────────────────────────────────────────────
-- Dunning / collection cases for overdue invoices.
-- Lifecycle: OPEN | CONTACTED | PROMISED | ESCALATED | LEGAL | SETTLED | WRITTEN_OFF | CLOSED.

CREATE TABLE IF NOT EXISTS finance.finance_collection_cases (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ(6)            DEFAULT NOW(),
  updated_at        TIMESTAMPTZ(6),
  deleted_at        TIMESTAMPTZ(6),

  case_no           TEXT         NOT NULL UNIQUE,
  invoice_id        TEXT         NOT NULL,
  invoice_no        TEXT         NOT NULL,
  client_name       TEXT         NOT NULL,
  client_email      TEXT,
  client_phone      TEXT,

  invoice_amount    NUMERIC(15,2) NOT NULL,
  paid_amount       NUMERIC(15,2)            DEFAULT 0,
  outstanding_amount NUMERIC(15,2) NOT NULL,
  due_date          DATE         NOT NULL,
  days_overdue      INTEGER      NOT NULL DEFAULT 0,

  status            TEXT         NOT NULL DEFAULT 'OPEN',
  dunning_stage     TEXT,
  last_contact_date DATE,
  promised_pay_date DATE,
  promised_amount   NUMERIC(15,2),

  assigned_to       TEXT,
  notes             TEXT,
  timeline          JSONB,
  tenant_id         TEXT
);

-- ── 4. finance_bank_accounts ───────────────────────────────────────────────────
-- Bank accounts. Parent of finance_bank_statements (which already exists
-- in the finance schema). Required for any bank-reconciliation path.

CREATE TABLE IF NOT EXISTS finance.finance_bank_accounts (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ(6)            DEFAULT NOW(),
  updated_at          TIMESTAMPTZ(6),
  deleted_at          TIMESTAMPTZ(6),

  bank_name           TEXT         NOT NULL,
  account_name        TEXT         NOT NULL,
  account_number      TEXT         NOT NULL,
  iban                TEXT,
  currency            TEXT         NOT NULL DEFAULT 'AED',
  branch_name         TEXT,
  swift_code          TEXT,

  is_default          BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,

  current_balance     NUMERIC(15,2)            DEFAULT 0,
  last_reconciled_at  TIMESTAMPTZ(6),

  tenant_id           TEXT
);

-- ── Grants: ensure the existing fleet360_api_role and fleet360_ai_role ────────
-- have the access they need for the new tables. fleet360_api_role has full
-- DML on the finance schema per migration 20260810000005; AI role is read-only
-- on payables (for anomaly detection) and no access to debit notes / allocations.
-- The new tables are not explicitly listed there, so we add minimal grants.

GRANT ALL ON TABLE finance.finance_pdc_cheques       TO fleet360_api_role;
GRANT ALL ON TABLE finance.finance_expenses          TO fleet360_api_role;
GRANT ALL ON TABLE finance.finance_collection_cases  TO fleet360_api_role;
GRANT ALL ON TABLE finance.finance_bank_accounts     TO fleet360_api_role;

-- No AI role grants: AI is not a consumer of these tables per the data
-- ownership work. Anomaly detection reads finance_payables (different
-- table, already granted in migration 006) and finance_invoices directly.
