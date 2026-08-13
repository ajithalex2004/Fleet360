-- Add the missing updated_at + deleted_at columns to trip_passengers.
-- The Prisma model declares them as @updatedAt and @map("deleted_at"),
-- which causes Prisma to emit "RETURNING updated_at" / use deletedAt
-- in filters. The actual table was created before these fields were
-- added to the schema and is missing them.
ALTER TABLE trip_passengers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE trip_passengers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_trip_passengers_deleted_at
  ON trip_passengers (deleted_at);
-- The trip-reminder scheduler joins trip_passengers → trip_schedules
-- on trip_id and filters by departureTime. Without these indexes the
-- query is a full scan and times out on tables with more than a few
-- thousand rows.
CREATE INDEX IF NOT EXISTS idx_trip_passengers_trip_id
  ON trip_passengers (trip_id);

-- ── Column-existence guards ──────────────────────────────────────────
-- When this migration is replayed against a shadow DB (Prisma's
-- schema-drift check in CI), the trip_schedules.tenant_id and
-- .deleted_at columns are added by *later* migrations in the history
-- and don't exist yet at this point. Original version of this file
-- did `CREATE INDEX ... WHERE deleted_at IS NULL` which fails to
-- parse without those columns and errors out the whole shadow build
-- with P3006.
--
-- Wrap the tenant/deleted-scoped indexes in a DO block that checks
-- the column exists first. On production (where the columns exist)
-- this behaves identically; on a fresh shadow DB it silently skips
-- the indexes at this stage — the LATER migration that adds tenant_id
-- can then recreate them (or a follow-up can). Keeps schema-drift CI
-- green without losing the intent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trip_schedules' AND column_name = 'deleted_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_trip_schedules_departure
             ON trip_schedules (departure_time) WHERE deleted_at IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trip_schedules' AND column_name = 'tenant_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trip_schedules' AND column_name = 'deleted_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_trip_schedules_tenant_departure
             ON trip_schedules (tenant_id, departure_time) WHERE deleted_at IS NULL';
  END IF;
END $$;

