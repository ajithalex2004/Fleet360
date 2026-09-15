-- Closes the 20260904000000 row from issue #77's audit.
--
-- 20260904000000_add_tenant_id_to_lease_rental_children is already applied
-- on every real environment and is left untouched, same approach as every
-- migration in this series. It's already fully idempotent and defensive
-- (skips cleanly if a child table doesn't exist, only backfills NULLs, only
-- sets NOT NULL if nothing is left unattributed) — the only reason it fails
-- on a fresh replay is that 7 of its 11 target tables derive tenant_id from
-- a parent (rental_agreements, rental_invoices, rental_bookings) that
-- doesn't have that column yet at this point in history. That column is
-- added later, by 20260914140000/20260914150000 (#73/#74/#78) — a pure
-- ordering problem, same class as #76's spatial.places fix, not a missing-
-- table problem. Confirmed directly against a paused fresh replay: the 3
-- LEASE parents (lease_contracts_v2, lease_invoices, lease_quotations)
-- already have tenant_id from earlier, unrelated migrations by this point —
-- only the 3 RENTAL parents are the actual gap, affecting 7 of the 11
-- child tables (all but the 4 lease_* ones).
--
-- This migration is a verbatim re-run of the original's own DO block. It
-- doesn't need new defensiveness — the original was already correct and
-- idempotent — it just needs to run again after the rental parents' own
-- tenant_id columns exist, which they will by this point in migration
-- order. Safe no-op on every real environment, where all 11 tables already
-- have tenant_id + RLS from the original migration.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260904000000_add_tenant_id_to_lease_rental_children

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
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = r.child
    ) THEN
      RAISE NOTICE 'skip %: table not present', r.child;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = r.parent AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'skip %: parent %.tenant_id does not exist yet (should not happen this late in migration order — investigate if seen)', r.child, r.parent;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id TEXT', r.child);

    EXECUTE format(
      'UPDATE public.%I c SET tenant_id = p.tenant_id
         FROM public.%I p
        WHERE p.id = c.%I AND c.tenant_id IS NULL',
      r.child, r.parent, r.fk_col);

    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', r.child)
      INTO remaining;
    IF remaining = 0 THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', r.child);
    ELSE
      RAISE NOTICE '% : % row(s) have no parent to derive tenant_id from; column left nullable', r.child, remaining;
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant ON public.%I(tenant_id)', r.child, r.child);

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

    RAISE NOTICE 'tenant_id + RLS ensured on %', r.child;
  END LOOP;
END $$;
