-- Adds tenant_id + RLS to 11 lease/rental child tables that had neither.
--
-- WHY THIS EXISTS
-- prisma/schema.prisma declares a tenantId on all of these models, and the
-- tenant-safety work assumed they were scoped. They are not: the columns do
-- not exist in the database. Verified directly:
--
--   table                        tenant_id  RLS    policies
--   lease_contract_vehicles      false      false  0
--   lease_invoice_lines          false      false  0
--   lease_quotation_items        false      false  0
--   lease_quotation_vehicles     false      false  0
--   rental_additional_charges    false      false  0
--   rental_extensions            false      false  0
--   rental_invoice_line_items    false      false  0
--   rental_invoice_payments      false      false  0
--   rental_payments              false      false  0
--   rental_vehicle_exchanges     false      false  0
--   vehicle_inspections          false      false  0
--
-- Two consequences. Any Prisma read of these models fails with P2022 ("column
-- does not exist"), the same way maintenance_requests did before
-- 20260903000000. And more seriously, these hold lease/rental financial detail
-- — invoice lines, payments, additional charges, extensions, contract vehicles,
-- quotation items, inspections — with no tenant column, so no row-level tenant
-- isolation is possible on them at all. They already contain data
-- (lease_contract_vehicles 3 rows, lease_quotation_vehicles 6 rows).
--
-- BACKFILL IS UNAMBIGUOUS
-- Each table has exactly one FK to a parent that does carry tenant_id, so the
-- value is derived rather than guessed:
--
--   lease_contract_vehicles.contract_id   -> lease_contracts_v2.id
--   lease_invoice_lines.invoice_id        -> lease_invoices.id
--   lease_quotation_items.quotation_id    -> lease_quotations.id
--   lease_quotation_vehicles.quotation_id -> lease_quotations.id
--   rental_additional_charges.agreement_id-> rental_agreements.id
--   rental_extensions.agreement_id        -> rental_agreements.id
--   rental_invoice_line_items.invoice_id  -> rental_invoices.id
--   rental_invoice_payments.invoice_id    -> rental_invoices.id
--   rental_payments.agreement_id          -> rental_agreements.id
--   rental_vehicle_exchanges.agreement_id -> rental_agreements.id
--   vehicle_inspections.booking_id        -> rental_bookings.id
--
-- NOT NULL is applied only when the backfill left no nulls. A nullable FK with
-- no parent cannot be attributed to a tenant, and guessing would be worse than
-- leaving the column nullable and visible. The DO block reports any such rows
-- via RAISE NOTICE rather than failing the migration.
--
-- Idempotent throughout, and additive: no column, row or table is dropped.

DO $$
DECLARE
  r RECORD;
  remaining BIGINT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('lease_contract_vehicles',   'contract_id',  'lease_contracts_v2'),
      ('lease_invoice_lines',       'invoice_id',   'lease_invoices'),
      ('lease_quotation_items',     'quotation_id', 'lease_quotations'),
      ('lease_quotation_vehicles',  'quotation_id', 'lease_quotations'),
      ('rental_additional_charges', 'agreement_id', 'rental_agreements'),
      ('rental_extensions',         'agreement_id', 'rental_agreements'),
      ('rental_invoice_line_items', 'invoice_id',   'rental_invoices'),
      ('rental_invoice_payments',   'invoice_id',   'rental_invoices'),
      ('rental_payments',           'agreement_id', 'rental_agreements'),
      ('rental_vehicle_exchanges',  'agreement_id', 'rental_agreements'),
      ('vehicle_inspections',       'booking_id',   'rental_bookings')
    ) AS t(child, fk_col, parent)
  LOOP
    -- Skip cleanly if a table isn't present in this environment.
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = r.child
    ) THEN
      RAISE NOTICE 'skip %: table not present', r.child;
      CONTINUE;
    END IF;

    -- 1. Column, nullable for now so the backfill can run.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id TEXT', r.child);

    -- 2. Derive from the parent. Only fills nulls, so re-running is a no-op.
    EXECUTE format(
      'UPDATE public.%I c SET tenant_id = p.tenant_id
         FROM public.%I p
        WHERE p.id = c.%I AND c.tenant_id IS NULL',
      r.child, r.parent, r.fk_col);

    -- 3. NOT NULL only if nothing was left unattributed.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', r.child)
      INTO remaining;
    IF remaining = 0 THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', r.child);
    ELSE
      RAISE NOTICE '% : % row(s) have no parent to derive tenant_id from; column left nullable', r.child, remaining;
    END IF;

    -- 4. Index — every tenant-scoped read filters on this.
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant ON public.%I(tenant_id)', r.child, r.child);

    -- 5. RLS. USING gates reads, WITH CHECK blocks cross-tenant writes; both
    --    are required. FORCE makes it apply to the table owner too, which is
    --    how the application connects. Matches
    --    20260902000000_p0_apply_rls_all_tables.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.child);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', r.child);
    EXECUTE format($pol$
      CREATE POLICY tenant_isolation ON public.%I FOR ALL
      USING (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      )
      WITH CHECK (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      )
    $pol$, r.child);

    RAISE NOTICE 'tenant_id + RLS applied to %', r.child;
  END LOOP;
END $$;
