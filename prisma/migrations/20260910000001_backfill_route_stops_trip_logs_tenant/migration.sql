-- Recover the tenant on route_stops and trip_logs, then close their escape.
--
-- Companion to 20260910000000, which handled the 44 nullable-tenant tables
-- holding no NULL rows. These two hold NULL rows, but every one of them can be
-- recovered from a parent that already knows its tenant:
--
--   route_stops  34 of 34 NULL rows recoverable via route_id -> bus_routes
--   trip_logs     4 of  4 NULL rows recoverable via schedule_id -> trip_schedules
--
-- Both counts were verified as complete before this was written — there is no
-- residue to decide about, which is what separates these two from bookings and
-- customer_hierarchy (0 of 3 recoverable) and from auth_login_attempts (where
-- NULL has a legitimate meaning and a backfill would be inventing data).
--
-- TYPE MISMATCH, worth stating because it is the kind of thing that produces a
-- 42883 at the worst moment: trip_logs.tenant_id is text while
-- trip_schedules.tenant_id is uuid. The backfill casts explicitly. route_stops
-- and bus_routes are both text and need no cast.
--
-- route_stops.tenant_id carries a foreign key to tenants, so the backfilled
-- values must reference live tenants. They do: they come from
-- bus_routes.tenant_id, which is under the same constraint.
--
-- The UPDATE is scoped to `WHERE tenant_id IS NULL` so it cannot rewrite a row
-- that already has a tenant, and it is therefore safe to re-run.
--
-- Idempotent throughout.

-- ── route_stops ──────────────────────────────────────────────────────────────

UPDATE public.route_stops rs
   SET tenant_id = br.tenant_id
  FROM public.bus_routes br
 WHERE rs.route_id = br.id
   AND rs.tenant_id IS NULL
   AND br.tenant_id IS NOT NULL;

-- ── trip_logs ────────────────────────────────────────────────────────────────
-- trip_schedules.tenant_id is uuid, trip_logs.tenant_id is text.

UPDATE public.trip_logs tl
   SET tenant_id = ts.tenant_id::text
  FROM public.trip_schedules ts
 WHERE tl.schedule_id = ts.id
   AND tl.tenant_id IS NULL
   AND ts.tenant_id IS NOT NULL;

-- ── Constrain, and rebuild the policies without the NULL branch ──────────────

DO $$
DECLARE
  t        text;
  nulls    bigint;
  polnames text[];
  pn       text;
  expr     text := '(current_setting(''app.tenant_id'', true) = ''*'')'
                || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
BEGIN
  FOREACH t IN ARRAY ARRAY['route_stops', 'trip_logs'] LOOP

    -- Any row the backfill could not reach means an orphan whose parent is
    -- missing or itself untenanted. Stop rather than guess: NOT NULL would
    -- fail here anyway, and a clear message beats a constraint violation.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO nulls;
    IF nulls > 0 THEN
      RAISE EXCEPTION '% still has % NULL-tenant row(s) after backfill — the parent is missing or untenanted; resolve before constraining', t, nulls;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);

    SELECT array_agg(pol.polname ORDER BY pol.polname) INTO polnames
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t
       AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%'
       AND pol.polcmd = '*' AND pol.polpermissive;

    IF polnames IS NOT NULL THEN
      FOREACH pn IN ARRAY polnames LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pn, t);
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
          pn, t, expr, expr);
      END LOOP;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    RAISE NOTICE 'backfilled and constrained %', t;
  END LOOP;
END $$;

-- Verification in the same transaction: no NULL tenants, no live escape.
DO $$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM public.route_stops WHERE tenant_id IS NULL
    UNION ALL
    SELECT 1 FROM public.trip_logs WHERE tenant_id IS NULL
  ) x;
  IF bad > 0 THEN
    RAISE EXCEPTION 'verification failed: % NULL-tenant rows remain', bad;
  END IF;

  SELECT count(*) INTO bad
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('route_stops', 'trip_logs')
     AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%';
  IF bad > 0 THEN
    RAISE EXCEPTION 'verification failed: % policies still carry the NULL escape', bad;
  END IF;
END $$;
