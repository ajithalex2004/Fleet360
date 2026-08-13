-- Backfill migration — add tenant_id + deleted_at to trip_schedules.
--
-- Original trip_schedules table (20260413143418_add_transport_modules)
-- was defined without tenant_id or deleted_at. Production databases
-- got both columns via the unversioned `tenant_isolation.sql` script
-- that was later removed from the tree (see cleanup commit 7ca921d2).
--
-- Subsequent migrations (20260804130000_trip_passengers_updated_at,
-- 20260806090000_trip_state_transitions, and more) reference those
-- columns and fail P3006 when Prisma replays history against a fresh
-- shadow DB in CI. This migration restores the missing add so the
-- history replays cleanly.
--
-- Fully idempotent — safe on production (which already has the
-- columns) via IF NOT EXISTS.
--
-- Placed at 20260803999000 so it sorts AFTER the 20260803* RLS
-- migration and BEFORE the 20260804* migrations that reference the
-- columns.

ALTER TABLE trip_schedules
  ADD COLUMN IF NOT EXISTS tenant_id  UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS trip_schedules_tenant_id_idx  ON trip_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS trip_schedules_deleted_at_idx ON trip_schedules(deleted_at);
