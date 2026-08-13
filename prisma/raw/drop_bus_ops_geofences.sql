-- Phase 3a — drop the legacy public.bus_ops_geofences table.
--
-- Data was id-preserving backfilled to spatial.places in Phase 1
-- (see add_spatial_places.sql). /api/bus-ops/geofences swapped its
-- storage to spatial.places in Phase 2a (commit c137ac17). No writes
-- have landed here since. This drop closes out the sunset.
--
-- Safety preflight — refuses to drop if any rows exist that DON'T have
-- a corresponding Place row (via id preservation OR source_id link).
-- Any such row would be data loss, so the operator has to reconcile
-- manually before re-running. On environments that already backfilled
-- this DO-block is a no-op.
DO $$
DECLARE
  orphan_count INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bus_ops_geofences') THEN
    SELECT COUNT(*) INTO orphan_count
    FROM public.bus_ops_geofences g
    WHERE NOT EXISTS (
      SELECT 1 FROM spatial.places p
      WHERE p.id = g.id::TEXT
         OR (p.source_module = 'bus-ops' AND p.source_id = g.id::TEXT)
    );
    IF orphan_count > 0 THEN
      RAISE EXCEPTION 'Refusing to drop bus_ops_geofences: % row(s) not in spatial.places. Re-run the Phase 1 backfill first.', orphan_count;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS public.bus_ops_geofences;
