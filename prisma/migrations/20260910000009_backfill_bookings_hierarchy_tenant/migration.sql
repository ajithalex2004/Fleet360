-- The last two live nullable escapes: recover the tenant, do not delete.
--
-- bookings and customer_hierarchy were held back from every earlier migration
-- in this series because their 3+3 NULL-tenant rows had no obvious attribution
-- path and both looked like seed data. They looked that way; they are not.
-- Running the same evidence standard used on the 17 finance_invoices found a
-- definitive owner for all six.
--
-- BOOKINGS — 3 rows, all recoverable.
--
--   booking_ref   LOG-MQPDYKIP, LOG-MQPDTTZK, LOG-MQPED8H7
--
-- Each of those is EQUAL to the shipment_no of a live, non-deleted row in
-- public.logistics_shipment_orders, and all three of those shipments belong to
-- tenant 35ad69c6. Two of the bookings independently corroborate it: their
-- notes JSON carries a shipmentId pointing at the same shipment.
--
-- This is a match on a business identifier to an existing owned record, not an
-- inference from naming or timing. 3/3 recoverable, 0 ambiguous — no booking
-- matches shipments belonging to more than one tenant.
--
-- CUSTOMER_HIERARCHY — 3 rows, all recoverable.
--
--   REGION      AD    "Abu Dhabi"
--   DEPARTMENT  TRANS "Transport"   parent = the region
--   UNIT        OPS   "Operations"  parent = the department
--
-- A coherent three-level tree, and public.customers row e0aca62b references all
-- three at once (region_id, department_id, unit_id). That customer belongs to
-- tenant 35ad69c6, and both customers in the database do. 3/3 recoverable,
-- 0 ambiguous.
--
-- Note this is the OPPOSITE conclusion to finance_invoices, reached with the
-- same method. There the names were "RBAC Test Client" and "Isolation Test
-- Client", nothing referenced the rows, and no owned record matched. Here a
-- live shipment and a live customer point straight at them. Resemblance to seed
-- data was never the deciding evidence in either case.
--
-- TYPE MISMATCH, worth stating because it is exactly the shape that produces a
-- 42883 at the worst moment: bookings.tenant_id is uuid while its source,
-- logistics_shipment_orders.tenant_id, is text. The cast is explicit below.
-- customer_hierarchy and customers are both text and need none.
--
-- Both UPDATEs are scoped to `WHERE tenant_id IS NULL` so they cannot rewrite
-- an owned row, and are therefore safe to re-run.
--
-- Idempotent.

-- ── bookings ────────────────────────────────────────────────────────────────

UPDATE public.bookings b
   SET tenant_id = s.tenant_id::uuid
  FROM public.logistics_shipment_orders s
 WHERE s.shipment_no = b.booking_ref
   AND b.tenant_id IS NULL
   AND s.tenant_id IS NOT NULL;

-- ── customer_hierarchy ──────────────────────────────────────────────────────
-- DISTINCT because one customer references three different nodes; without it
-- the join would be fine here but the intent would be less clear.

UPDATE public.customer_hierarchy ch
   SET tenant_id = c.tenant_id
  FROM public.customers c
 WHERE ch.id IN (c.region_id, c.department_id, c.unit_id)
   AND ch.tenant_id IS NULL
   AND c.tenant_id IS NOT NULL;

-- ── Constrain and drop the escape ───────────────────────────────────────────

DO $$
DECLARE
  t       text;
  coltype text;
  nulls   bigint;
  expr    text;
  pn      text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings', 'customer_hierarchy'] LOOP

    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO nulls;
    IF nulls > 0 THEN
      RAISE EXCEPTION
        'public.% still has % NULL-tenant row(s) after backfill — the source record is missing or itself untenanted; resolve before constraining', t, nulls;
    END IF;

    SELECT data_type INTO coltype FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id';

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);

    FOR pn IN
      SELECT pol.polname FROM pg_policy pol
        JOIN pg_class c ON c.oid = pol.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = t
         AND pol.polcmd = '*' AND pol.polpermissive
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pn, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
        pn, t, expr, expr);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    RAISE NOTICE 'backfilled and constrained public.% (tenant_id %)', t, coltype;
  END LOOP;
END $$;

-- Verify: the backfilled tenant must MATCH the source record, not merely be
-- non-null. A backfill that assigns the wrong tenant is worse than none.
DO $$
DECLARE
  wrong bigint;
  live  text;
BEGIN
  SELECT count(*) INTO wrong
    FROM public.bookings b
    JOIN public.logistics_shipment_orders s ON s.shipment_no = b.booking_ref
   WHERE b.tenant_id::text IS DISTINCT FROM s.tenant_id;
  IF wrong > 0 THEN
    RAISE EXCEPTION 'verification failed: % booking(s) do not match their shipment tenant', wrong;
  END IF;

  SELECT count(*) INTO wrong
    FROM public.customer_hierarchy ch
    JOIN public.customers c ON ch.id IN (c.region_id, c.department_id, c.unit_id)
   WHERE ch.tenant_id IS DISTINCT FROM c.tenant_id;
  IF wrong > 0 THEN
    RAISE EXCEPTION 'verification failed: % hierarchy node(s) do not match their customer tenant', wrong;
  END IF;

  -- And nothing anywhere should carry a live escape now except the two
  -- documented global-reference models.
  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO live
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname AND col.table_name = c.relname
     AND col.column_name = 'tenant_id'
   WHERE c.relkind = 'r'
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_%'
     AND col.is_nullable = 'YES'
     AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                  AND pg_get_expr(p.polqual, p.polrelid) LIKE '%tenant_id IS NULL%')
     AND (n.nspname || '.' || c.relname) NOT IN (
       'public.roles', 'finance.finance_tax_categories'
     );
  IF live IS NOT NULL THEN
    RAISE EXCEPTION 'verification failed: live NULL escape outside the two allowlisted global models: %', live;
  END IF;
END $$;
