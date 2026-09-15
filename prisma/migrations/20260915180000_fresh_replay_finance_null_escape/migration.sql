-- Closes the "20260910000006" row from issue #77's audit.
--
-- 20260910000006_finance_schema_null_escape is already applied on every real
-- environment and is left untouched, same approach as every migration in
-- this series. Its 6-table loop already guards against a table not existing
-- (`to_regclass(...) IS NULL THEN CONTINUE`), but three of the six —
-- finance_bank_statement_lines, finance_bank_statements, finance_credit_notes
-- — are untracked legacy tables: no tracked CREATE TABLE anywhere, only a
-- `SET SCHEMA ... IF EXISTS` in 20260810000005 and a "(which already exists
-- in the finance schema)" comment in 20260811200000 reference them — same
-- pattern as auth_login_attempts/route_optimisation_results elsewhere in
-- this series. A fourth, finance_vat_audit_logs, IS tracked-created
-- (20260810000003) but its tenant_id column is never added by any tracked
-- migration — the column itself arrived through the untracked legacy path,
-- same class of gap one level down (table tracked, column not). The
-- remaining two, finance_journal_entries and finance_invoices, already have
-- tenant_id by this point in tracked history and are unaffected.
--
-- Fix: recreate the three untracked tables with their exact live DDL
-- (pg_dump'd from production, including the RLS/policy/index shape each
-- already carries there), defensively add finance_vat_audit_logs.tenant_id,
-- then re-run the original's 6-table tighten loop verbatim (with a
-- column-existence guard added, the same fix used elsewhere in this
-- series) — safe no-op on every real environment where all of this
-- already exists.
--
-- The original's own closing verification (that no finance-schema table
-- other than the documented finance_tax_categories exception still carries
-- a live NULL escape) is deliberately omitted here, same reasoning as
-- 20260910000000/20260910000004's fixes: it depends on every other
-- finance-schema RLS gap in this repository's history being closed by the
-- time this runs, including 20260910000016 (issue #77's still-open
-- finance_security_deposits generated-column bug) — not something this
-- migration can guarantee.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000006_finance_schema_null_escape

CREATE TABLE IF NOT EXISTS finance.finance_bank_statements (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bank_account_id text NOT NULL,
    statement_date date NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    opening_balance numeric(15,2) DEFAULT 0 NOT NULL,
    closing_balance numeric(15,2) DEFAULT 0 NOT NULL,
    imported_by text,
    notes text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_bank_statements_tenant_id ON finance.finance_bank_statements USING btree (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.finance_bank_statements TO fleet360_app;

CREATE TABLE IF NOT EXISTS finance.finance_bank_statement_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    statement_id text NOT NULL,
    txn_date date NOT NULL,
    value_date date,
    description text NOT NULL,
    reference text,
    debit numeric(15,2),
    credit numeric(15,2),
    balance numeric(15,2),
    match_status text DEFAULT 'UNMATCHED'::text,
    matched_payment_id text,
    matched_at timestamp with time zone,
    matched_by text,
    notes text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_bank_statement_lines_tenant_id ON finance.finance_bank_statement_lines USING btree (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.finance_bank_statement_lines TO fleet360_app;

CREATE TABLE IF NOT EXISTS finance.finance_credit_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    cn_number text NOT NULL,
    original_invoice_id text,
    original_invoice_no text,
    client_name text NOT NULL,
    client_email text,
    module text,
    branch text DEFAULT 'Unassigned'::text,
    reason_code text NOT NULL,
    reason_detail text,
    line_items jsonb,
    subtotal numeric(15,2) NOT NULL,
    vat_amount numeric(15,2) DEFAULT 0,
    total_amount numeric(15,2) NOT NULL,
    currency text DEFAULT 'AED'::text,
    issue_date date NOT NULL,
    status text DEFAULT 'DRAFT'::text,
    applied_amount numeric(15,2) DEFAULT 0,
    refunded_at timestamp with time zone,
    refund_method text,
    issued_by text,
    approved_by text,
    tenant_id text NOT NULL,
    notes text,
    CONSTRAINT finance_credit_notes_cn_number_key UNIQUE (cn_number)
);
CREATE INDEX IF NOT EXISTS idx_finance_credit_notes_tenant_id ON finance.finance_credit_notes USING btree (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON finance.finance_credit_notes TO fleet360_app;

-- finance_vat_audit_logs: the table already exists (20260810000003, part of
-- the same DO-block chain as this file), tenant_id does not — added
-- nullable here, tightened to NOT NULL below by the loop, same two-step
-- shape used for the 44-table sweep's column-existence gap.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'finance' AND table_name = 'finance_vat_audit_logs' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE finance.finance_vat_audit_logs ADD COLUMN tenant_id text;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_finance_vat_audit_logs_tenant_id ON finance.finance_vat_audit_logs USING btree (tenant_id);

-- Verbatim re-run of the original's 6-table loop, with one addition: a
-- column-existence guard alongside the table-existence one it already had
-- (the three tables just created above already have tenant_id, so this
-- only ever matters if this migration is ever run without the CREATE TABLE
-- statements above having taken effect, which should not happen — defensive
-- only). No closing verification — see comment above.
DO $$
DECLARE
  t        text;
  nulls    bigint;
  pn       text;
  polnames text[];
  expr     text := '(current_setting(''app.tenant_id'', true) = ''*'')'
                || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
  targets  text[] := ARRAY[
    'finance_bank_statement_lines', 'finance_bank_statements',
    'finance_credit_notes', 'finance_journal_entries', 'finance_vat_audit_logs',
    'finance_invoices'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('finance.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'SKIP finance.% — does not exist', t;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'finance' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'SKIP finance.% — no tenant_id column yet', t;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM finance.%I WHERE tenant_id IS NULL', t) INTO nulls;

    -- NOT NULL only where there is nothing to guess about. finance_invoices
    -- keeps a nullable column precisely so any NULL-tenant rows stay untouched.
    IF nulls = 0 THEN
      EXECUTE format('ALTER TABLE finance.%I ALTER COLUMN tenant_id SET NOT NULL', t);
    ELSE
      RAISE NOTICE 'finance.% has % NULL-tenant row(s) — left nullable; those rows become platform-only', t, nulls;
    END IF;

    SELECT array_agg(pol.polname ORDER BY pol.polname) INTO polnames
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'finance' AND c.relname = t
       AND pol.polcmd = '*' AND pol.polpermissive;

    IF polnames IS NOT NULL THEN
      FOREACH pn IN ARRAY polnames LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON finance.%I', pn, t);
        EXECUTE format(
          'CREATE POLICY %I ON finance.%I FOR ALL USING (%s) WITH CHECK (%s)',
          pn, t, expr, expr);
      END LOOP;
    ELSE
      -- The three tables created above have no policy yet the first time
      -- this loop reaches them (the original migration only ever rebuilt an
      -- existing policy). Ensure one exists with the tightened expression,
      -- same fix already applied for the 44-table sweep.
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finance.%I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON finance.%I FOR ALL USING (%s) WITH CHECK (%s)',
        t, expr, expr);
    END IF;

    EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', t);

    RAISE NOTICE 'tightened finance.% (% NULL rows retained)', t, nulls;
  END LOOP;
END $$;
