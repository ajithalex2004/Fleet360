-- Task 1 — trip_passenger.status → Postgres ENUM
--
-- Current: `status TEXT DEFAULT 'CONFIRMED'` (free-form string).
-- Target:  `status trip_passenger_status DEFAULT 'CONFIRMED'`.
--
-- Enum values (order = ordering the state machine expects):
--   CONFIRMED  — passenger is on the manifest for this trip
--   BOARDED    — driver / gateway marked the passenger on board
--   ALIGHTED   — passenger got off at their drop-off stop
--   ABSENT     — passenger did not board when the bus reached their stop
--   NO_SHOW    — passenger cancelled after boarding window closed
--
-- Safety: this env currently has ZERO rows in trip_passengers, so the
-- ALTER ... USING clause has no data to cast. Once populated, the same
-- migration on a live env needs a CHECK that every existing value is in
-- the enum before ALTER (a WHERE status NOT IN (...) sanity SELECT is
-- the standard preflight).

CREATE TYPE trip_passenger_status AS ENUM (
  'CONFIRMED',
  'BOARDED',
  'ALIGHTED',
  'ABSENT',
  'NO_SHOW',
  'CANCELLED',
  'WAITLISTED'
);
-- CANCELLED and WAITLISTED predate the epic and are already declared in
-- schema.prisma's TripPassengerStatus enum. They're kept so the sweep-
-- waitlist workflow (src/app/api/bus-ops/schedules/sweep-waitlist/) and
-- future cancellation flows keep working. Applied to already-created
-- enums via `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'X'`.

ALTER TABLE trip_passengers
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE trip_passenger_status USING status::trip_passenger_status,
  ALTER COLUMN status SET DEFAULT 'CONFIRMED'::trip_passenger_status;
