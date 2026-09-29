-- Debit notes and payment allocations where they were never created, and
-- document numbers unique per tenant.
--
-- Migration 20260810000006 created finance_debit_notes and
-- finance_payment_allocations, but production has neither (in any schema),
-- so the debit note screens and payment allocation never worked there.
--
--   1. Creates finance_debit_notes where it is missing.
--   2. Creates finance_payment_allocations where it is missing, with its
--      foreign keys to payments, invoices and payables in whichever schema
--      each of those lives.
--   3. (Re)creates the trigger that keeps an invoice's or payable's
--      paid_amount and payment_status in step with its allocations, naming
--      the tables where they actually are (the original named finance.*).
--   4. Debit note and payable numbers become unique per tenant: they are
--      numbered from the tenant's own count (DN-yyyymm-nnnn, AP-yyyymm-nnnn),
--      so a platform-wide key rejected the second tenant's first document of
--      the month.
--   5. Row level security in the project's standard form on both new tables.
--
-- Idempotent. Written in the one form the Neon SQL Editor runs whole: plain
-- DO blocks, no named quote tags. The trigger function is created from a
-- string inside a DO block for that reason.

SELECT set_config('app.tenant_id', '*', false);

-- ── 1. debit notes ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF COALESCE(to_regclass('public.' || 'finance_debit_notes'), to_regclass('finance.' || 'finance_debit_notes')) IS NULL THEN
    CREATE TABLE finance.finance_debit_notes (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ,
      dn_number           TEXT        NOT NULL,
      original_payable_id TEXT,
      original_payable_no TEXT,
      original_invoice_id TEXT,
      original_invoice_no TEXT,
      vendor_name         TEXT        NOT NULL,
      vendor_email        TEXT,
      module              TEXT,
      reason_code         TEXT        NOT NULL,
      reason_detail       TEXT,
      line_items          JSONB       NOT NULL DEFAULT '[]',
      subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
      vat_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
      currency            TEXT        NOT NULL DEFAULT 'AED',
      issue_date          DATE        NOT NULL DEFAULT CURRENT_DATE,
      status              TEXT        NOT NULL DEFAULT 'DRAFT',
      applied_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
      issued_by           TEXT,
      approved_by         TEXT,
      notes               TEXT,
      tenant_id           TEXT
    );
    CREATE INDEX idx_finance_debit_notes_tenant  ON finance.finance_debit_notes (tenant_id);
    CREATE INDEX idx_finance_debit_notes_status  ON finance.finance_debit_notes (status);
    CREATE INDEX idx_finance_debit_notes_payable ON finance.finance_debit_notes (original_payable_id) WHERE original_payable_id IS NOT NULL;
    CREATE INDEX idx_finance_debit_notes_invoice ON finance.finance_debit_notes (original_invoice_id) WHERE original_invoice_id IS NOT NULL;
  END IF;
END $$;

-- ── 2. payment allocations ───────────────────────────────────────────────
DO $$
DECLARE
  payments regclass := COALESCE(to_regclass('public.' || 'finance_payments'), to_regclass('finance.' || 'finance_payments'));
  invoices regclass := COALESCE(to_regclass('public.' || 'finance_invoices'), to_regclass('finance.' || 'finance_invoices'));
  payables regclass := COALESCE(to_regclass('public.' || 'finance_payables'), to_regclass('finance.' || 'finance_payables'));
BEGIN
  IF COALESCE(to_regclass('public.' || 'finance_payment_allocations'), to_regclass('finance.' || 'finance_payment_allocations')) IS NOT NULL THEN
    RETURN;
  END IF;
  IF payments IS NULL OR invoices IS NULL OR payables IS NULL THEN
    RAISE NOTICE 'debit notes and allocations: payments, invoices or payables missing here, allocations skipped';
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE finance.finance_payment_allocations (
       id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       payment_id       UUID        NOT NULL REFERENCES %s (id) ON DELETE CASCADE,
       invoice_id       UUID        REFERENCES %s (id) ON DELETE SET NULL,
       payable_id       UUID        REFERENCES %s (id) ON DELETE SET NULL,
       allocated_amount NUMERIC(14,2) NOT NULL,
       allocation_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
       notes            TEXT,
       allocated_by     TEXT,
       tenant_id        TEXT,
       CONSTRAINT chk_alloc_target CHECK (invoice_id IS NOT NULL OR payable_id IS NOT NULL),
       CONSTRAINT uq_alloc_payment_invoice UNIQUE NULLS NOT DISTINCT (payment_id, invoice_id),
       CONSTRAINT uq_alloc_payment_payable UNIQUE NULLS NOT DISTINCT (payment_id, payable_id)
     )', payments, invoices, payables);
  CREATE INDEX idx_finance_alloc_payment ON finance.finance_payment_allocations (payment_id);
  CREATE INDEX idx_finance_alloc_invoice ON finance.finance_payment_allocations (invoice_id) WHERE invoice_id IS NOT NULL;
  CREATE INDEX idx_finance_alloc_payable ON finance.finance_payment_allocations (payable_id) WHERE payable_id IS NOT NULL;
  CREATE INDEX idx_finance_alloc_tenant  ON finance.finance_payment_allocations (tenant_id);
END $$;

-- ── 3. paid_amount trigger ───────────────────────────────────────────────
DO $$
DECLARE
  allocs   regclass := COALESCE(to_regclass('public.' || 'finance_payment_allocations'), to_regclass('finance.' || 'finance_payment_allocations'));
  invoices regclass := COALESCE(to_regclass('public.' || 'finance_invoices'), to_regclass('finance.' || 'finance_invoices'));
  payables regclass := COALESCE(to_regclass('public.' || 'finance_payables'), to_regclass('finance.' || 'finance_payables'));
  body text;
BEGIN
  IF allocs IS NULL OR invoices IS NULL OR payables IS NULL THEN
    RETURN;
  END IF;

  body := format(
    'DECLARE
       v_invoice_id UUID;
       v_payable_id UUID;
       v_total      NUMERIC(14,2);
       v_paid       NUMERIC(14,2);
     BEGIN
       IF TG_OP = ''DELETE'' THEN
         v_invoice_id := OLD.invoice_id;
         v_payable_id := OLD.payable_id;
       ELSE
         v_invoice_id := NEW.invoice_id;
         v_payable_id := NEW.payable_id;
       END IF;

       IF v_invoice_id IS NOT NULL THEN
         SELECT COALESCE(SUM(allocated_amount), 0) INTO v_paid FROM %1$s WHERE invoice_id = v_invoice_id;
         SELECT total_amount INTO v_total FROM %2$s WHERE id = v_invoice_id;
         UPDATE %2$s
            SET paid_amount = v_paid,
                payment_status = CASE
                  WHEN v_paid <= 0 THEN ''UNPAID''
                  WHEN v_paid >= COALESCE(v_total, 0) THEN ''PAID''
                  ELSE ''PARTIALLY_PAID'' END,
                updated_at = NOW()
          WHERE id = v_invoice_id;
       END IF;

       IF v_payable_id IS NOT NULL THEN
         SELECT COALESCE(SUM(allocated_amount), 0) INTO v_paid FROM %1$s WHERE payable_id = v_payable_id;
         SELECT total_amount INTO v_total FROM %3$s WHERE id = v_payable_id;
         UPDATE %3$s
            SET paid_amount = v_paid,
                payment_status = CASE
                  WHEN v_paid <= 0 THEN ''UNPAID''
                  WHEN v_paid >= COALESCE(v_total, 0) THEN ''PAID''
                  ELSE ''PARTIALLY_PAID'' END,
                updated_at = NOW()
          WHERE id = v_payable_id;
       END IF;

       RETURN NULL;
     END', allocs, invoices, payables);

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION finance.fn_sync_alloc_paid_amount() RETURNS TRIGGER LANGUAGE plpgsql AS %L',
    body);
  EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_alloc_paid_amount ON %s', allocs);
  EXECUTE format(
    'CREATE TRIGGER trg_sync_alloc_paid_amount AFTER INSERT OR UPDATE OR DELETE ON %s
       FOR EACH ROW EXECUTE FUNCTION finance.fn_sync_alloc_paid_amount()', allocs);
END $$;

-- ── 4. document numbers unique per tenant ────────────────────────────────
DO $$
DECLARE
  spec text[];
  rel regclass;
  col_attnum smallint;
  r record;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['finance_debit_notes', 'dn_number'],
    ARRAY['finance_payables',    'payable_number']
  ] LOOP
    rel := COALESCE(to_regclass('public.' || spec[1]), to_regclass('finance.' || spec[1]));
    IF rel IS NULL THEN
      CONTINUE;
    END IF;
    SELECT attnum INTO col_attnum FROM pg_attribute WHERE attrelid = rel AND attname = spec[2] AND NOT attisdropped;
    IF col_attnum IS NULL THEN
      CONTINUE;
    END IF;
    FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = rel AND contype = 'u' AND conkey = ARRAY[col_attnum] LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rel, r.conname);
    END LOOP;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s (tenant_id, %I)',
                   spec[1] || '_tenant_' || spec[2] || '_key', rel, spec[2]);
  END LOOP;
END $$;

-- ── 5. row level security ────────────────────────────────────────────────
DO $$
DECLARE
  tname text;
  rel regclass;
  pol record;
BEGIN
  FOREACH tname IN ARRAY ARRAY['finance_debit_notes', 'finance_payment_allocations'] LOOP
    rel := COALESCE(to_regclass('public.' || tname), to_regclass('finance.' || tname));
    IF rel IS NULL THEN
      CONTINUE;
    END IF;

    FOR pol IN SELECT p.polname FROM pg_policy p WHERE p.polrelid = rel LOOP
      EXECUTE format('DROP POLICY %I ON %s', pol.polname, rel);
    END LOOP;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO fleet360_app', rel);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s FOR ALL '
      'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
      rel
    );
  END LOOP;
END $$;
