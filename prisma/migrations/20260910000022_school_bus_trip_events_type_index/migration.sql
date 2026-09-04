-- Parity fix found while removing the last un-migrated school-bus runtime-DDL
-- function (ensureTripTables in src/app/api/school-bus/trips/route.ts, which
-- 20260910000019 missed because the CI checker's naming-pattern regex didn't
-- catch that function name — see check-no-runtime-ddl.mjs for the fix).
--
-- ensureTripTables' school_bus_trips / school_bus_trip_events definitions
-- already match what 20260910000019 created, with one addition: an index
-- on event_type that trips/route.ts had but trips/seed/route.ts (the
-- migration's source) didn't.

CREATE INDEX IF NOT EXISTS idx_sbte_type ON school_bus_trip_events(event_type);
