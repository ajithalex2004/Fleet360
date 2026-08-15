-- Merge lineage for TripSchedule.
--
-- When two trips A and B are merged, a new trip M is created that
-- carries A's and B's passengers. A and B are marked with status='MERGED'
-- and merged_into_trip_id=M.id — this preserves the audit trail so
-- historical queries "who rode trip A on 2026-08-14?" still resolve
-- correctly, and analytics can distinguish organic cancellations from
-- merge-driven ones.
--
-- Self-FK to trip_schedules. Nullable — organic (non-merged) trips
-- carry NULL. ON DELETE SET NULL so hard-deleting the merged trip
-- doesn't cascade-nuke source-trip rows (deletes should be soft anyway;
-- this is belt-and-braces).

ALTER TABLE public.trip_schedules
  ADD COLUMN IF NOT EXISTS merged_into_trip_id TEXT REFERENCES public.trip_schedules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trip_schedules_merged_into
  ON public.trip_schedules(merged_into_trip_id)
  WHERE merged_into_trip_id IS NOT NULL;
