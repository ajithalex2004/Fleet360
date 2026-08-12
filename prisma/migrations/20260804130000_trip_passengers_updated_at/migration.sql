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
CREATE INDEX IF NOT EXISTS idx_trip_schedules_departure
  ON trip_schedules (departure_time)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trip_schedules_tenant_departure
  ON trip_schedules (tenant_id, departure_time)
  WHERE deleted_at IS NULL;

