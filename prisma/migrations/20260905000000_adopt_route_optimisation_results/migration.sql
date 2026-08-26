-- Adopt route_optimisation_results as the persistent store for road-distance
-- optimisation previews.
--
-- The table already existed in the database, unused (0 rows) and absent from
-- schema.prisma — one of the tables covered by the documented drift. It has
-- the right shape (before/after km, saved km + pct, both sequences, duration,
-- a status lifecycle, UNIQUE route_id) but three defects that made it unusable
-- as-is. This migration fixes all three; it is additive apart from one type
-- change on an empty table.
--
-- 1. route_id was uuid while bus_routes.id is text. That mismatch is the same
--    class as the 42883 "operator does not exist: uuid = text" failures seen
--    elsewhere in this schema: any join or FK needs a cast, and the cast only
--    works while every route id happens to be UUID-shaped. Safe to correct
--    here precisely because the table is empty.
-- 2. No tenant_id, so the table could not be tenant-scoped and RLS had nothing
--    to filter on.
-- 3. No way to tell a stored result from a stale one. The stops PUT does not
--    bump bus_routes.updated_at, so timestamps cannot answer it. stops_hash
--    fingerprints the geocoded stop set: same hash means the stored result is
--    still valid and costs nothing to serve; a changed hash triggers exactly
--    one recompute.
--
-- Idempotent throughout — safe to re-run.

-- 1. route_id uuid -> text, to match bus_routes.id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'route_optimisation_results'
       AND column_name = 'route_id'
       AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.route_optimisation_results
      ALTER COLUMN route_id TYPE text USING route_id::text;
    RAISE NOTICE 'route_optimisation_results.route_id: uuid -> text';
  END IF;
END $$;

-- 2. tenant_id + stops_hash.
ALTER TABLE public.route_optimisation_results
  ADD COLUMN IF NOT EXISTS tenant_id  text,
  ADD COLUMN IF NOT EXISTS stops_hash text;

-- The table is empty, so there is nothing to backfill and NOT NULL is safe.
-- Guarded anyway: if rows somehow exist, leave the column nullable rather than
-- fail the migration, and let the application's own writes supply it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.route_optimisation_results LIMIT 1) THEN
    ALTER TABLE public.route_optimisation_results
      ALTER COLUMN tenant_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'route_optimisation_results not empty — tenant_id left nullable';
  END IF;
END $$;

-- 3. Real FK now that the types agree. Deleting a route discards its cached
--    preview; the preview is derived data and has no meaning without it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'route_optimisation_results_route_id_fkey'
       AND table_name = 'route_optimisation_results'
  ) THEN
    ALTER TABLE public.route_optimisation_results
      ADD CONSTRAINT route_optimisation_results_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES public.bus_routes(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_route_opt_tenant_route
  ON public.route_optimisation_results (tenant_id, route_id);

-- 4. RLS. USING gates reads, WITH CHECK blocks cross-tenant writes; both are
--    required. FORCE binds the table owner too. Matches the policy shape in
--    20260904000000_add_tenant_id_to_lease_rental_children.
ALTER TABLE public.route_optimisation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_optimisation_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.route_optimisation_results;
CREATE POLICY tenant_isolation ON public.route_optimisation_results FOR ALL
  USING (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
