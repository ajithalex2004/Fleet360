-- Close the nullable-tenant escape in the `finance` schema.
--
-- These tables were invisible to the audit until scripts/check-rls-effective.mjs
-- stopped hardcoding schema 'public'. They are the same class as the 44 handled
-- by 20260910000000 and were missed for the same reason
-- 20260910000004's four were: the checker was not looking at the schema.
--
-- FIVE TABLES, 0 rows each, treated exactly as in 20260910000000 —
-- tenant_id SET NOT NULL and the `tenant_id IS NULL` branch dropped from both
-- halves of the policy:
--
--   finance_bank_statement_lines
--   finance_bank_statements
--   finance_credit_notes
--   finance_journal_entries
--   finance_vat_audit_logs
--
-- FINANCE_INVOICES — 18 rows, 17 with no tenant.
--
-- Those 17 carry invoice_number, client_name and amounts, and the IS NULL
-- branch makes every one of them readable by every tenant. The single tenanted
-- invoice belongs to a tenant whose id begins `debug-te`, and all 17 NULL rows
-- were created on one day, so they look like a bulk seed — but that is a
-- resemblance, not provenance, and this migration does not delete or reassign
-- them.
--
-- Instead the escape is dropped from the policy and the column left nullable,
-- the same shape used for auth_login_attempts in 20260910000003: the rows stay
-- exactly as they are and become reachable only under withPlatformAdmin.
--
-- This breaks nothing. Any correctly tenant-scoped query already excludes them
-- — src/app/api/finance/payments/route.ts filters `i.tenant_id = $1`, so it has
-- never returned them. What changes is that a query which FORGOT to scope stops
-- being rescued by the policy, which is the entire point.
--
-- WITH CHECK drops the branch too, unlike auth_login_attempts. An unattributable
-- login attempt is a legitimate state; an invoice with no tenant is not, so new
-- ones are rejected rather than permitted.
--
-- NOT TOUCHED: finance_tax_categories.
--
-- Its 4 NULL-tenant rows are UAE VAT reference data — STANDARD 5%, ZERO,
-- EXEMPT, OUT_OF_SCOPE — and dropping the escape would stop tenant sessions
-- reading them, which is a functional regression rather than a security fix.
--
-- It also surfaced something that needs a decision before anyone tightens it:
-- the same four categories exist TWICE, once with tenant_id NULL and once with
-- the literal string '__global'. Two competing conventions for "shared row" are
-- in the table at the same time, and neither is readable by an ordinary tenant
-- session under a strictly tenant-scoped policy — '__global' only matches when
-- app.tenant_id is itself '__global'. Resolving that is a data-model question,
-- not a policy one, and guessing here would either duplicate or hide the VAT
-- rates the finance module depends on.
--
-- Idempotent.

DO $$
DECLARE
  t     text;
  nulls bigint;
  pn    text;
  expr  text := '(current_setting(''app.tenant_id'', true) = ''*'')'
             || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
  targets text[] := ARRAY[
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

    EXECUTE format('SELECT count(*) FROM finance.%I WHERE tenant_id IS NULL', t) INTO nulls;

    -- NOT NULL only where there is nothing to guess about. finance_invoices
    -- keeps a nullable column precisely so its 17 rows can stay untouched.
    IF nulls = 0 THEN
      EXECUTE format('ALTER TABLE finance.%I ALTER COLUMN tenant_id SET NOT NULL', t);
    ELSE
      RAISE NOTICE 'finance.% has % NULL-tenant row(s) — left nullable; those rows become platform-only', t, nulls;
    END IF;

    FOR pn IN
      SELECT pol.polname FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'finance' AND c.relname = t
         AND pol.polcmd = '*' AND pol.polpermissive
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON finance.%I', pn, t);
      EXECUTE format(
        'CREATE POLICY %I ON finance.%I FOR ALL USING (%s) WITH CHECK (%s)',
        pn, t, expr, expr);
    END LOOP;

    EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', t);

    RAISE NOTICE 'tightened finance.% (% NULL rows retained)', t, nulls;
  END LOOP;
END $$;

-- Verify: the only live escape left in `finance` is the documented
-- tax-categories one.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname AND col.table_name = c.relname
     AND col.column_name = 'tenant_id'
   WHERE n.nspname = 'finance'
     AND col.is_nullable = 'YES'
     AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                  AND pg_get_expr(p.polqual, p.polrelid) LIKE '%tenant_id IS NULL%')
     AND c.relname <> 'finance_tax_categories';

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'verification failed: finance tables still carry a live NULL escape: %', bad;
  END IF;
END $$;
