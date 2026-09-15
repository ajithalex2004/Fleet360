-- Closes the "20260910000009" row from issue #77's audit.
--
-- 20260910000009_backfill_bookings_hierarchy_tenant is already applied on
-- every real environment and is left untouched, same approach as every
-- migration in this series. It backfills bookings.tenant_id by joining to
-- public.logistics_shipment_orders on a matching business identifier
-- (shipment_no = booking_ref) — but that table is not created by any
-- tracked migration until 20260914000000_logistics_shipping_requests and
-- friends, 25 migrations later in this repository's history. On live this
-- was never a problem (the table already existed via the untracked legacy
-- path long before this migration first ran); on a fresh replay it
-- genuinely does not exist yet at this point, so the UPDATE's plain FROM
-- reference fails with 42P01 before the migration gets anywhere near its
-- tighten loop.
--
-- A second, independent gap in the same statement: public.bookings.tenant_id
-- itself (uuid, confirmed via production) is not added by ANY tracked
-- migration anywhere in this repository's history — unlike every other gap
-- in this series, there is no later migration that supplies it either. It
-- reached its live shape entirely through the untracked legacy path, same
-- category as the tables recreated wholesale elsewhere in this series, just
-- one column instead of a whole table. Added defensively below, nullable,
-- before the backfill runs — the original's own tighten loop (SET NOT NULL
-- once nulls = 0) still applies verbatim afterward. customer_hierarchy.
-- tenant_id, by contrast, already exists at this point (confirmed directly)
-- — only bookings needs this.
--
-- The customer_hierarchy half of the same migration backfills via
-- public.customers, which has existed since much earlier in tracked
-- history (closed for its own NULL-escape gap by this series'
-- 20260824000000 fix) — not affected, left as-is.
--
-- This is not a data-loss risk on a fresh replay either way: both target
-- tables are empty at this point on any genuinely fresh database (no
-- application data exists yet during initial deployment), so there are no
-- rows for the backfill to recover in the first place — the original
-- migration's own tighten loop already only requires nulls = 0, which an
-- empty table satisfies trivially regardless of whether the backfill UPDATE
-- ran. Guarding the bookings backfill on the source table's existence (via
-- dynamic SQL, since a plain UPDATE would still fail to parse against a
-- missing relation even inside a false IF branch) is therefore sufficient
-- and loses nothing: it is a real recovery step for live's already-existing
-- rows, and a no-op for a replay with nothing yet to recover.
--
-- The original's closing verification is the same global,
-- every-non-system-schema NULL-escape check as
-- 20260910000000/20260910000004/20260910000006/20260910000008's fixes
-- already had to omit, here down to just two allow-listed exceptions —
-- even more order-dependent, not less. Omitted for the same reason. The two
-- narrower, self-contained verifications (backfilled tenant must match its
-- source record) are kept — they are scoped only to these two tables and
-- hold trivially on an empty table.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000009_backfill_bookings_hierarchy_tenant

-- ── bookings ────────────────────────────────────────────────────────────────

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS tenant_id uuid;
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON public.bookings USING btree (tenant_id);

DO $$
BEGIN
  IF to_regclass('public.logistics_shipment_orders') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.bookings b
         SET tenant_id = s.tenant_id::uuid
        FROM public.logistics_shipment_orders s
       WHERE s.shipment_no = b.booking_ref
         AND b.tenant_id IS NULL
         AND s.tenant_id IS NOT NULL
    $sql$;
  ELSE
    RAISE NOTICE 'SKIP bookings backfill — public.logistics_shipment_orders does not exist yet';
  END IF;
END $$;

-- ── customer_hierarchy ──────────────────────────────────────────────────────

UPDATE public.customer_hierarchy ch
   SET tenant_id = c.tenant_id
  FROM public.customers c
 WHERE ch.id IN (c.region_id, c.department_id, c.unit_id)
   AND ch.tenant_id IS NULL
   AND c.tenant_id IS NOT NULL;

-- ── Constrain and drop the escape ───────────────────────────────────────────
-- Verbatim from the original.

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
-- non-null. Scoped to these two tables only — holds trivially on an empty
-- fresh-replay table. The original's third, global cross-schema check is
-- omitted; see the comment above.
DO $$
DECLARE
  wrong bigint;
BEGIN
  IF to_regclass('public.logistics_shipment_orders') IS NOT NULL THEN
    SELECT count(*) INTO wrong
      FROM public.bookings b
      JOIN public.logistics_shipment_orders s ON s.shipment_no = b.booking_ref
     WHERE b.tenant_id::text IS DISTINCT FROM s.tenant_id;
    IF wrong > 0 THEN
      RAISE EXCEPTION 'verification failed: % booking(s) do not match their shipment tenant', wrong;
    END IF;
  END IF;

  SELECT count(*) INTO wrong
    FROM public.customer_hierarchy ch
    JOIN public.customers c ON ch.id IN (c.region_id, c.department_id, c.unit_id)
   WHERE ch.tenant_id IS DISTINCT FROM c.tenant_id;
  IF wrong > 0 THEN
    RAISE EXCEPTION 'verification failed: % hierarchy node(s) do not match their customer tenant', wrong;
  END IF;
END $$;
