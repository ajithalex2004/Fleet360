-- Resolve the finance_payments shadow: drop the unprotected public copy.
--
-- There are two tables named finance_payments:
--
--   public.finance_payments   8 columns, NO tenant_id, no RLS, 0 rows
--   finance.finance_payments  the same 8 columns PLUS tenant_id, RLS enabled
--                             AND forced with a tenant_isolation policy, 0 rows
--
-- search_path is `"$user", public, finance, ai`, so public wins and every
-- unqualified reference lands on the copy with no tenant column. Meanwhile
-- `finance_invoices` exists ONLY in the finance schema, so the handler in
-- src/app/api/finance/payments/route.ts runs a query that silently spans both
-- schemas: it reads public.finance_payments LEFT JOIN finance.finance_invoices.
--
-- This is the worst shape of failure in this whole series. The tenant context
-- can be set perfectly by withTenantRls, the policy on
-- finance.finance_payments can be perfectly correct, and the write still lands
-- somewhere no policy protects — with nothing raised. Switching the runtime
-- role to fleet360_app would not have surfaced it either.
--
-- DROPPING the public copy is safe and is the right resolution rather than
-- adding a tenant column to it:
--
--   * it holds 0 rows
--   * nothing references it — no inbound foreign keys, no views, no
--     materialised views (checked via pg_depend)
--   * finance.finance_payments is a strict superset of its columns, so every
--     query keeps working once the name resolves there
--   * the finance copy is ALREADY tenant-isolated and forced. Building a second
--     protected table would leave two, and the next person would have to work
--     out which one is real
--
-- One column differs in nullability, and in the direction that helps:
-- public.invoice_id is NOT NULL while finance.invoice_id is nullable. The
-- handler inserts `invoiceId ?? null`, so it can legitimately record a payment
-- with no invoice — which the public copy would have rejected and the finance
-- copy accepts.
--
-- finance.finance_payments.tenant_id is nullable and its policy still carries
-- the `tenant_id IS NULL` escape. Both are tightened here, on the same
-- reasoning as 20260910000000 and while the table is still empty.
--
-- The handler's INSERT does not supply tenant_id today; that is fixed in the
-- same commit. Before this migration it wrote an untenanted row into an
-- unprotected table; after it, the row is properly owned.
--
-- Idempotent.

DO $$
DECLARE
  n bigint;
  deps int;
BEGIN
  IF to_regclass('public.finance_payments') IS NULL THEN
    RAISE NOTICE 'public.finance_payments already gone';
  ELSE
    -- Refuse to drop a table that has acquired rows or dependants since this
    -- was written. Dropping data is not something to do on a stale assumption.
    EXECUTE 'SELECT count(*) FROM public.finance_payments' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'public.finance_payments now has % row(s) — refusing to drop; migrate them to finance.finance_payments first', n;
    END IF;

    SELECT count(*) INTO deps
      FROM pg_depend d
      JOIN pg_class src ON src.oid = d.refobjid
      JOIN pg_namespace ns ON ns.oid = src.relnamespace
     WHERE ns.nspname = 'public' AND src.relname = 'finance_payments'
       AND d.deptype IN ('n', 'a')
       AND d.objid <> src.oid
       AND EXISTS (SELECT 1 FROM pg_rewrite r WHERE r.oid = d.objid);
    IF deps > 0 THEN
      RAISE EXCEPTION 'public.finance_payments has % view dependency/ies — resolve before dropping', deps;
    END IF;

    DROP TABLE public.finance_payments;
    RAISE NOTICE 'dropped the unprotected public.finance_payments shadow';
  END IF;
END $$;

-- Tighten the surviving table while it is still empty.
DO $$
DECLARE
  nulls bigint;
  expr  text := '(current_setting(''app.tenant_id'', true) = ''*'')'
             || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
  pn    text;
BEGIN
  SELECT count(*) INTO nulls FROM finance.finance_payments WHERE tenant_id IS NULL;
  IF nulls = 0 THEN
    ALTER TABLE finance.finance_payments ALTER COLUMN tenant_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'finance.finance_payments has % NULL-tenant rows — column left nullable', nulls;
  END IF;

  FOR pn IN
    SELECT pol.polname FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'finance' AND c.relname = 'finance_payments'
       AND pol.polcmd = '*' AND pol.polpermissive
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON finance.finance_payments', pn);
    EXECUTE format(
      'CREATE POLICY %I ON finance.finance_payments FOR ALL USING (%s) WITH CHECK (%s)',
      pn, expr, expr);
  END LOOP;

  ALTER TABLE finance.finance_payments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finance.finance_payments FORCE ROW LEVEL SECURITY;
END $$;

-- Verify: exactly one finance_payments remains, it resolves there, it is
-- protected, and no name is shadowed across public/finance any more.
DO $$
DECLARE
  resolved text;
  shadowed text;
  protected boolean;
BEGIN
  SELECT n.nspname || '.' || c.relname INTO resolved
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.oid = to_regclass('finance_payments');

  IF resolved IS DISTINCT FROM 'finance.finance_payments' THEN
    RAISE EXCEPTION 'verification failed: unqualified finance_payments resolves to %', resolved;
  END IF;

  SELECT c.relrowsecurity AND c.relforcerowsecurity
         AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    INTO protected
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'finance' AND c.relname = 'finance_payments';
  IF NOT protected THEN
    RAISE EXCEPTION 'verification failed: finance.finance_payments is not enabled+forced with a policy';
  END IF;

  SELECT string_agg(a.table_name, ', ') INTO shadowed
    FROM information_schema.tables a
    JOIN information_schema.tables b
      ON b.table_name = a.table_name AND b.table_schema = 'finance'
   WHERE a.table_schema = 'public';
  IF shadowed IS NOT NULL THEN
    RAISE EXCEPTION 'verification failed: names still shadowed across public/finance: %', shadowed;
  END IF;
END $$;
